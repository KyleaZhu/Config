import { connect } from 'cloudflare:sockets'

// configurations
const UUID = '5e43fca9-456b-4a62-8003-c94242ddbe6c' // vless UUID
const PROXY = 'ProxyIP.US.CMLiussss.net' // (optional) reverse proxy for CF websites. e.g. ProxyIP.US.CMLiussss.net

const BUFFER_SIZE = 32 * 1024 // download/upload buffer size in bytes

function validate_uuid(id, uuid) {
    for (let index = 0; index < 16; index++) {
        const v = id[index]
        const u = uuid[index]
        if (v !== u) {
            return false
        }
    }
    return true
}

function parse_uuid(uuid) {
    uuid = uuid.replaceAll('-', '')
    const r = []
    for (let index = 0; index < 16; index++) {
        const v = parseInt(uuid.substr(index * 2, 2), 16)
        r.push(v)
    }
    return r
}

function get_buffer(size) {
    return new Uint8Array(new ArrayBuffer(size || BUFFER_SIZE))
}

const decoder = new TextDecoder()

const ADDRESS_TYPE_IPV4 = 1
const ADDRESS_TYPE_URL = 2
const ADDRESS_TYPE_IPV6 = 3

async function read_vless_header(readable, uuid_str) {
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
    const id = buf.slice(1, 1 + 16)
    const uuid = parse_uuid(uuid_str)
    if (!validate_uuid(id, uuid)) return `invalid UUID`

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

async function upload_to_remote(writer, vless) {
    async function inner_upload(d) {
        if (!d) return
        await writer.write(d)
    }

    await inner_upload(vless.data)
    while (!vless.done) {
        const r = await vless.reader.read(get_buffer())
        await inner_upload(r.value)
        vless.done = r.done
    }
}

function create_uploader(vless, writable) {
    const done = new Promise((resolve, reject) => {
        const writer = writable.getWriter()
        upload_to_remote(writer, vless)
            .then(resolve)
            .catch(reject)
            .finally(() => {
                writer.close().catch(() => {})
            })
    })

    return { done }
}

function create_downloader(resp, remote_readable) {
    let stream

    const done = new Promise((resolve, reject) => {
        stream = new TransformStream(
            {
                start(controller) {
                    controller.enqueue(resp)
                },
                transform(chunk, controller) {
                    controller.enqueue(chunk)
                },
                cancel(reason) {
                    reject(`download cancelled: ${reason}`)
                },
            },
            null,
            new ByteLengthQueuingStrategy({ highWaterMark: BUFFER_SIZE }),
        )
        remote_readable.pipeTo(stream.writable).catch(reject).finally(resolve)
    })

    return {
        readable: stream.readable,
        done,
    }
}

async function connect_to_remote(vless, ...remotes) {
    const hostname = remotes.shift()
    if (!hostname || hostname.length < 1) {
        return null
    }

    const retry = () => connect_to_remote(vless, ...remotes)
    let remote
    try {
        remote = connect({ hostname: hostname, port: vless.port })
        await remote.opened
    } catch (err) {
        return await retry()
    }

    const uploader = create_uploader(vless, remote.writable)
    const downloader = create_downloader(vless.resp, remote.readable)
    return {
        downloader,
        uploader,
    }
}

async function handle_xhttp_client(body, cfg) {
    const vless = await read_vless_header(body, cfg.UUID)
    if (typeof vless !== 'object' || !vless) {
        return null
    }

    const r = await connect_to_remote(vless, vless.hostname, cfg.PROXY)
    if (r === null) {
        return null
    }

    const connection_closed = new Promise((resolve, _) => {
        r.downloader.done
            .catch(() => {})
            .finally(() => r.uploader.done)
            .catch(() => {})
            .finally(() => resolve())
    })

    return {
        readable: r.downloader.readable,
        closed: connection_closed,
    }
}

async function handle_post(request, cfg) {
    return await handle_xhttp_client(request.body, cfg)
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
    const cfg = {
        UUID: env.UUID || UUID,
        PROXY: env.PROXY || PROXY,
    }

    if (!cfg.UUID) {
        return new Response(`Error: UUID is empty`)
    }

    if (request.method === 'POST') {
        const r = await handle_post(request, cfg)
        if (r) {
            ctx.waitUntil(r.closed)
            return new Response(r.readable, {
                headers: {
                    'X-Accel-Buffering': 'no',
                    'Cache-Control': 'no-store',
                    'Content-Type': 'application/octet-stream',
                },
            })
        }
    }

    if (request.method === 'GET') {
        const url = new URL(request.url)
        const items = [url.pathname, url.search]
        for (let item of items) {
            if (item.indexOf(`${cfg.UUID}`) >= 0) {
                const link = create_vless_link(url, cfg.UUID)
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
