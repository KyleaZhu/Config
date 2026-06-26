import { connect } from 'cloudflare:sockets'

const UUID = '5e43fca9-456b-4a62-8003-c94242ddbe6c' // vless UUID
const PROXY = 'ProxyIP.US.CMLiussss.net' // (optional) reverse proxy for CF websites
const CONCUR = 4 // concurrent connections per race round
const BUFFER_SIZE = 16 * 1024 // download/upload buffer size in bytes

const hex = c => (c > 64 ? c + 9 : c) & 0xF
const idB = new Uint8Array(16)
for (let i = 0, p = 0, c, h; i < 16; i++) {
    c = UUID.charCodeAt(p++);
    c === 45 && (c = UUID.charCodeAt(p++));
    h = hex(c);
    c = UUID.charCodeAt(p++);
    c === 45 && (c = UUID.charCodeAt(p++));
    idB[i] = h << 4 | hex(c);
}
const [I0, I1, I2, I3, I4, I5, I6, I7, I8, I9, I10, I11, I12, I13, I14, I15] = idB
const matchID = c => c[1] === I0 && c[2] === I1 && c[3] === I2 && c[4] === I3 && c[5] === I4 && c[6] === I5 && c[7] === I6 && c[8] === I7 && c[9] === I8 && c[10] === I9 && c[11] === I10 && c[12] === I11 && c[13] === I12 && c[14] === I13 && c[15] === I14 && c[16] === I15

const decoder = new TextDecoder()

const ADDRESS_TYPE_IPV4 = 1
const ADDRESS_TYPE_URL = 2
const ADDRESS_TYPE_IPV6 = 3

async function read_vless_header(readable) {
    const reader = readable.getReader({ mode: 'byob' })
    const MAX_HEADER = 512
    let buf = new Uint8Array(new ArrayBuffer(MAX_HEADER))
    let cursor = 0
    let done = false

    const fill = async (needed) => {
        if (done || cursor >= needed) return true
        if (cursor + needed > buf.length) {
            const tmp = new Uint8Array(new ArrayBuffer(Math.max(buf.length, cursor + needed) * 2))
            tmp.set(buf.subarray(0, cursor))
            buf = tmp
        }
        const r = await reader.readAtLeast(
            needed - cursor,
            new Uint8Array(buf.buffer, cursor, buf.length - cursor),
        )
        done = r.done
        if (!r.value?.byteLength) return false
        buf = new Uint8Array(r.value.buffer)
        cursor += r.value.byteLength
        return cursor >= needed
    }

    if (!await fill(1 + 16 + 1)) return `header too short`

    const version = buf[0]
    if (!matchID(buf)) return `invalid UUID`

    const pb_len = buf[1 + 16]
    const addr_plus1 = 1 + 16 + 1 + pb_len + 1 + 2 + 1

    if (!await fill(addr_plus1 + 1)) return `header too short`

    const cmd = buf[1 + 16 + 1 + pb_len]
    if (cmd !== 1) return `unsupported command: ${cmd}`

    const port = (buf[addr_plus1 - 1 - 2] << 8) + buf[addr_plus1 - 1 - 1]
    const atype = buf[addr_plus1 - 1]

    let header_len = -1
    if (atype === ADDRESS_TYPE_IPV4) {
        header_len = addr_plus1 + 4
    } else if (atype === ADDRESS_TYPE_IPV6) {
        header_len = addr_plus1 + 16
    } else if (atype === ADDRESS_TYPE_URL) {
        header_len = addr_plus1 + 1 + buf[addr_plus1]
    }
    if (header_len < 0) return 'read address type failed'

    if (!await fill(header_len)) return `read address failed`

    let hostname = ''
    const idx = addr_plus1
    switch (atype) {
        case ADDRESS_TYPE_IPV4:
            hostname = buf.slice(idx, idx + 4).join('.')
            break
        case ADDRESS_TYPE_URL:
            hostname = decoder.decode(buf.slice(idx + 1, idx + 1 + buf[idx]))
            break
        case ADDRESS_TYPE_IPV6:
            hostname = buf.slice(idx, idx + 16)
                .reduce((s, b2, i2, a) =>
                    i2 % 2 ? s.concat(((a[i2 - 1] << 8) + b2).toString(16)) : s, [])
                .join(':')
            break
    }
    if (hostname.length < 1) return 'failed to parse hostname'

    const data = buf.slice(header_len, cursor)
    return {
        hostname,
        port,
        data,
        resp: new Uint8Array([version, 0]),
        reader,
        done,
    }
}

async function upload_to_remote(writer, vless, readBuf) {
    async function inner_upload(d) {
        if (!d) return
        await writer.write(d)
    }

    await inner_upload(vless.data)
    while (!vless.done) {
        const r = await vless.reader.read(readBuf)
        if (r.done) break
        if (!r.value?.byteLength) continue
        readBuf = new Uint8Array(r.value.buffer)
        await inner_upload(r.value)
    }
}

function create_uploader(vless, writable) {
    const done = new Promise((resolve, reject) => {
        const writer = writable.getWriter()
        const readBuf = new Uint8Array(new ArrayBuffer(BUFFER_SIZE))
        upload_to_remote(writer, vless, readBuf)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                writer.close().catch(() => {})
            })
    })

    return { done }
}

function create_downloader(resp, remote_readable) {
    const reader = remote_readable.getReader()
    let doneResolve
    const done = new Promise(resolve => { doneResolve = resolve })

    const readable = new ReadableStream({
        start(controller) {
            controller.enqueue(resp)
        },
        async pull(controller) {
            try {
                const { done: d, value } = await reader.read()
                if (d) {
                    controller.close()
                    doneResolve()
                    return
                }
                controller.enqueue(value)
            } catch (err) {
                controller.error(err)
                doneResolve()
            }
        },
        cancel(reason) {
            reader.cancel(reason).finally(doneResolve)
        }
    })

    return { readable, done }
}

function sprout(hostname, port) {
    const s = connect({ hostname, port })
    return s.opened.then(() => s)
}

function raceSprout(hostname, port, concur) {
    const ts = Array.from({ length: concur }, () => sprout(hostname, port))
    return Promise.any(ts).then(w => {
        ts.forEach(t => t.then(s => s !== w && s.close(), () => {}))
        return w
    })
}

async function connect_to_remote(vless, ...remotes) {
    for (const hostname of remotes) {
        if (!hostname || hostname.length < 1) continue
        try {
            const remote = await raceSprout(hostname, vless.port, CONCUR)
            const uploader = create_uploader(vless, remote.writable)
            const downloader = create_downloader(vless.resp, remote.readable)
            return { downloader, uploader }
        } catch (_) { }
    }
    return null
}

async function handle_xhttp_client(body) {
    const vless = await read_vless_header(body)
    if (typeof vless !== 'object' || !vless) {
        return null
    }

    const r = await connect_to_remote(vless, vless.hostname, PROXY)
    if (r === null) {
        return null
    }

    return {
        readable: r.downloader.readable,
        upload_done: r.uploader.done,
    }
}

async function handle_post(request) {
    return await handle_xhttp_client(request.body)
}

function create_vless_link(url, uuid) {
    const host = url.hostname
    const params = new URLSearchParams({
        encryption: 'none',
        security: 'tls',
        sni: host,
        name: 'XHTTP',
        type: 'xhttp',
        host: host,
        path: '/',
        fp: 'firefox',
        alpn: 'h3,h2',
        mode: 'stream-one',
        insecure: '0',
        allowInsecure: '0',
        ech: 'cloudflare-ech.com+https://223.5.5.5/dns-query',
    })
    return `vless://${uuid}@${host}:443?${params.toString()}#${params.get('name')}`
}

async function fetch(request, env, ctx) {
    if (request.method === 'POST') {
        const r = await handle_post(request)
        if (r) {
            ctx.waitUntil(r.upload_done)
            return new Response(r.readable, {
                headers: {
                    'X-Accel-Buffering': 'no',
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/octet-stream',
                },
            })
        }
        return new Response('Upstream unreachable', { status: 502 })
    }

    if (request.method === 'GET') {
        const url = new URL(request.url)
        const items = [url.pathname, url.search]
        for (let item of items) {
            if (item.indexOf(UUID) >= 0) {
                const link = create_vless_link(url, UUID)
                return new Response(link, {
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                    },
                })
            }
        }
    }
    return new Response(`Hello world!`)
}

export default {
    fetch,
}
