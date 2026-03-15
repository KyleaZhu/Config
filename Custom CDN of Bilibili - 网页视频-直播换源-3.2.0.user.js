// ==UserScript==
// @name         Custom CDN of Bilibili - 网页视频/直播换源
// @description  内置专属优质CDN节点池 (阿里/腾讯/百度/华为)
// @namespace    CCB_Private_Lite
// @license      MIT
// @version      3.2.0
// @author       KyleaZhu
// @run-at       document-start
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/festival/*
// @match        https://www.bilibili.com/list/*
// @match        https://live.bilibili.com/*
// @match        https://player.bilibili.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

;(() => {
    const defaultCdnNode = '使用默认源'
    const manualRegionName = '手动输入自定义域名'
    const mainHost = 'www.bilibili.com'
    const liveHost = 'live.bilibili.com'

    // 内置你提供的专属 CDN 节点池
    const MY_CDN_LIST = [
        { name: "使用 B 站默认源", value: defaultCdnNode },
        { name: "阿里云 CDN (mirrorali)", value: "upos-sz-mirrorali.bilivideo.com" },
        { name: "阿里云 CDN (mirroralib)", value: "upos-sz-mirroralib.bilivideo.com" },
        { name: "阿里云 CDN (mirroralio1)", value: "upos-sz-mirroralio1.bilivideo.com" },
        { name: "腾讯云 CDN (mirrorcos)", value: "upos-sz-mirrorcos.bilivideo.com" },
        { name: "腾讯云 VOD (mirrorcosb)", value: "upos-sz-mirrorcosb.bilivideo.com" },
        { name: "腾讯云 CDN (mirrorcoso1)", value: "upos-sz-mirrorcoso1.bilivideo.com" },
        { name: "华为云 融合 (mirrorhw)", value: "upos-sz-mirrorhw.bilivideo.com" },
        { name: "华为云 融合 (mirrorhwb)", value: "upos-sz-mirrorhwb.bilivideo.com" },
        { name: "华为云 融合 (mirrorhwo1)", value: "upos-sz-mirrorhwo1.bilivideo.com" },
        { name: "华为云 融合 (mirror08c)", value: "upos-sz-mirror08c.bilivideo.com" },
        { name: "华为云 融合 (mirror08h)", value: "upos-sz-mirror08h.bilivideo.com" },
        { name: "华为云 融合 (mirror08ct)", value: "upos-sz-mirror08ct.bilivideo.com" },
        { name: "百度云 CDN (mirrorbd)", value: "upos-sz-mirrorbd.bilivideo.com" },
        { name: "手动输入自定义节点", value: manualRegionName }
    ];

    const mainCdnNodeStored = 'CCB_main'
    const liveCdnNodeStored = 'CCB_live'
    const powerModeStored = 'powerMode'
    const liveModeStored = 'liveMode'

    const logger = ((...args) => {
        console.warn(`[CCB Private] ${args}`, args)
    })

    const isLiveContext = () => location.host === liveHost
    const getContextKey = () => isLiveContext() ? 'live' : 'main'

    const getTargetCdnNode = (ctx = getContextKey()) => GM_getValue(
        ctx === 'live' ? liveCdnNodeStored : mainCdnNodeStored,
        defaultCdnNode
    )
    const setTargetCdnNode = (ctx, value) => GM_setValue(
        ctx === 'live' ? liveCdnNodeStored : mainCdnNodeStored,
        value
    )

    const getPowerMode = () => GM_getValue(powerModeStored, true)
    const getLiveMode = () => GM_getValue(liveModeStored, false)
    const isCcbEnabled = () => getTargetCdnNode() !== defaultCdnNode

    const hasMediaDomain = (s) => typeof s === 'string' && (
        s.indexOf('bilivideo.') !== -1
        || s.indexOf('acgvideo.') !== -1
        || s.indexOf('edge.mountaintoys.cn') !== -1
        || s.indexOf('akamaized.net') !== -1
    )

    const isLiveRoomPage = () => {
        if (location.host !== liveHost) return false
        const p = location.pathname || '/'
        return /^\/\d+\/?$/.test(p) || /^\/blanc\/\d+\/?$/.test(p)
    }

    const shouldApplyReplacement = () => {
        if (!isCcbEnabled()) return false
        if (location.host === liveHost) {
            if (!isLiveRoomPage()) return false
            if (!getLiveMode()) return false
        }
        return true
    }

    const shouldInstallWorkerHooks = () => {
        if (!shouldApplyReplacement()) return false
        const host = location.host
        const pathname = location.pathname || '/'
        if (host === mainHost) {
            return pathname.startsWith('/video/') || pathname.startsWith('/list/') || pathname.startsWith('/festival/')
        }
        if (host === liveHost) return isLiveRoomPage()
        return false
    }

    const getReplacement = () => {
        let target = getTargetCdnNode()
        if (target.indexOf('://') === -1) target = 'https://' + target
        if (!target.endsWith('/')) target = target + '/'
        return target
    }

    const getReplacementNoSlash = () => {
        const r = getReplacement()
        return r.endsWith('/') ? r.slice(0, -1) : r
    }

    const getReplacementHost = () => {
        try { return new URL(getReplacement()).host } catch (_) { return '' }
    }

    const IGNORE_HOST_RE = /^(?:bvc|data|pbp|api|api\w+)\./

    const replaceMediaUrl = (s) => {
        if (typeof s !== 'string') return s
        if (!shouldApplyReplacement()) return s
        if (!hasMediaDomain(s)) return s

        try {
            const u = new URL(s.startsWith('//') ? `https:${s}` : s)
            if (IGNORE_HOST_RE.test(u.hostname)) return s
        } catch (_) {
            const m = s.match(/^https?:\/\/([\w.-]+)/) || s.match(/^\/\/([\w.-]+)/)
            if (m && IGNORE_HOST_RE.test(m[1])) return s
        }

        if (s.startsWith('http://') || s.startsWith('https://')) return s.replace(/^https?:\/\/.*?\//, getReplacement())
        if (s.startsWith('//')) return s.replace(/^\/\/.*?\//, getReplacement().replace(/^https?:/, ''))
        if (/^[^/]+\//.test(s)) return s.replace(/^[^/]+\//, `${getReplacementHost()}/`)
        return s
    }

    const replaceMediaHostValue = (s) => {
        if (typeof s !== 'string') return s
        if (!shouldApplyReplacement()) return s
        if (!hasMediaDomain(s)) return s

        try {
            const u = new URL(s.startsWith('//') ? `https:${s}` : s)
            if (IGNORE_HOST_RE.test(u.hostname)) return s
        } catch (_) {
            const m = s.match(/^https?:\/\/([\w.-]+)/) || s.match(/^\/\/([\w.-]+)/)
            if (m && IGNORE_HOST_RE.test(m[1])) return s
        }

        if (s.startsWith('http://') || s.startsWith('https://')) return getReplacementNoSlash()
        if (s.startsWith('//')) return getReplacementNoSlash().replace(/^https?:/, '')
        if (/^[^/]+$/.test(s)) return getReplacementHost()
        return s
    }

    const deepReplacePlayInfo = (obj) => {
        if (!obj || typeof obj !== 'object') return
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                const item = obj[i]
                if (typeof item === 'string') {
                    const out = hasMediaDomain(item) ? replaceMediaUrl(item) : item
                    if (out !== item) obj[i] = out
                } else {
                    deepReplacePlayInfo(item)
                }
            }
            return
        }
        for (const k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) continue
            const v = obj[k]
            if (typeof v === 'string') {
                if (k === 'host') {
                    if (hasMediaDomain(v)) obj[k] = replaceMediaHostValue(v)
                } else {
                    if (hasMediaDomain(v)) obj[k] = replaceMediaUrl(v)
                }
            } else if (Array.isArray(v) && k === 'backup_url') {
                if (!getPowerMode()) continue
                for (let i = 0; i < v.length; i++) {
                    const s = v[i]
                    if (typeof s === 'string') {
                        if (hasMediaDomain(s)) v[i] = replaceMediaUrl(s)
                    }
                    else deepReplacePlayInfo(s)
                }
            } else if (typeof v === 'object') {
                deepReplacePlayInfo(v)
            }
        }
    }

    const transformPlayUrlResponse = (playInfo) => {
        if (!playInfo || typeof playInfo !== 'object') return
        if (playInfo.code !== (void 0) && playInfo.code !== 0) return
        deepReplacePlayInfo(playInfo)
    }

    const transformLiveNeptune = (obj) => {
        if (!obj || typeof obj !== 'object') return
        if (!getReplacementHost()) return

        const playurl =
            (obj && obj.roomInitRes && obj.roomInitRes.data && obj.roomInitRes.data.playurl_info && obj.roomInitRes.data.playurl_info.playurl) ||
            (obj && obj.data && obj.data.playurl_info && obj.data.playurl_info.playurl) ||
            (obj && obj.result && obj.result.playurl_info && obj.result.playurl_info.playurl) ||
            (obj && obj.playurl_info && obj.playurl_info.playurl)
        if (!playurl || typeof playurl !== 'object') return

        const streams = playurl.stream
        if (!Array.isArray(streams)) return
        for (let si = 0; si < streams.length; si++) {
            const s = streams[si]
            const formats = s && s.format
            if (!Array.isArray(formats)) continue
            for (let fi = 0; fi < formats.length; fi++) {
                const f = formats[fi]
                const codecs = f && f.codec
                if (!Array.isArray(codecs)) continue
                for (let ci = 0; ci < codecs.length; ci++) {
                    const c = codecs[ci]
                    const infos = c && c.url_info
                    if (!Array.isArray(infos)) continue
                    for (let ii = 0; ii < infos.length; ii++) {
                        const info = infos[ii]
                        if (info && typeof info.host === 'string') info.host = replaceMediaHostValue(info.host)
                    }
                }
            }
        }
    }

    const replaceBilivideoInText = (text) => {
        if (!shouldApplyReplacement()) return text
        if (typeof text !== 'string') return text
        if (text.indexOf('bilivideo.') === -1
            && text.indexOf('acgvideo.') === -1
            && text.indexOf('edge.mountaintoys.cn') === -1
            && text.indexOf('akamaized.net') === -1
        ) return text
        const out = text.replace(/https?:\/\/[^"'\s]*?\.(?:(?:bilivideo|acgvideo)\.(?:com|cn)|edge\.mountaintoys\.cn|akamaized\.net)\//g, getReplacement())
        const host = getReplacementHost()
        if (!host) return out
        return out.replace(/\b[\w.-]+\.(?:(?:bilivideo|acgvideo)\.(?:com|cn)|edge\.mountaintoys\.cn|akamaized\.net)\b/g, host)
    }

    const installCcbWorkerRuntime = (cfg) => {
        const forceReplace = !!(cfg && cfg.forceReplace)
        const shouldApply = () => forceReplace
        const Replacement = (cfg && typeof cfg.replacement === 'string') ? cfg.replacement : ''
        const replacementHost = (cfg && typeof cfg.replacementHost === 'string') ? cfg.replacementHost : ''
        const getHost = () => replacementHost
        const IgnoreHostRe = /^(?:bvc|data|pbp|api|api\w+)\./
        const hasMedia = (s) => typeof s === 'string' && (
            s.indexOf('bilivideo.') !== -1
            || s.indexOf('acgvideo.') !== -1
            || s.indexOf('edge.mountaintoys.cn') !== -1
            || s.indexOf('akamaized.net') !== -1
        )

        const replaceUrl = (s) => {
            if (typeof s !== 'string') return s
            if (!shouldApply()) return s
            if (!hasMedia(s)) return s
            try {
                const u = new URL(s.startsWith('//') ? `https:${s}` : s)
                if (IgnoreHostRe.test(u.hostname)) return s
            } catch (_) {
                const m = s.match(/^https?:\/\/([\w.-]+)/) || s.match(/^\/\/([\w.-]+)/)
                if (m && IgnoreHostRe.test(m[1])) return s
            }
            if (s.startsWith('http://') || s.startsWith('https://')) return s.replace(/^https?:\/\/.*?\//, Replacement)
            if (s.startsWith('//')) return s.replace(/^\/\/.*?\//, Replacement.replace(/^https?:/, ''))
            if (/^[^/]+\//.test(s)) return s.replace(/^[^/]+\//, `${getHost()}/`)
            return s
        }

        const Ofetch = self.fetch
        if (Ofetch) {
            self.fetch = (input, init) => {
                try {
                    const s = typeof input === 'string' ? input : (input && input.url)
                    if (typeof s === 'string') {
                        const r = replaceUrl(s)
                        if (r !== s) {
                            if (typeof input === 'string') input = r
                            else {
                                const Req = self.Request || Request
                                if (Req) input = new Req(r, input)
                            }
                        }
                    }
                } catch (_) {}
                return Ofetch(input, init)
            }
        }

        if (self.XMLHttpRequest) {
            const OX = self.XMLHttpRequest
            class X extends OX {
                open(...args) {
                    try { if (typeof args[1] === 'string') args[1] = replaceUrl(args[1]) } catch (_) {}
                    return super.open(...args)
                }
            }
            self.XMLHttpRequest = X
        }
    }

    const buildWorkerPrelude = () => {
        const cfg = {
            forceReplace: shouldApplyReplacement(),
            replacement: getReplacement(),
            replacementHost: getReplacementHost(),
        }
        const runtime = `(${installCcbWorkerRuntime.toString()})(${JSON.stringify(cfg)});`
        return `(() => {\n  if (self.__CCB_WORKER_PRELUDE__) return;\n  self.__CCB_WORKER_PRELUDE__ = true;\n  try { ${runtime} } catch (_) {}\n})();\n`
    }

    const interceptNetResponse = (theWindow => {
        const interceptors = []
        const register = (handler) => interceptors.push(handler)

        const handle = (response, url, meta) => interceptors.reduce((modified, h) => {
            const ret = h(modified, url, meta)
            return ret ? ret : modified
        }, response)

        const hookWindow = (w) => {
            try {
                if (!w || !w.XMLHttpRequest || !w.fetch) return false
                const hooked = w.__CCB_NET_HOOKED__
                if (hooked && hooked.xhr === w.XMLHttpRequest && hooked.fetch === w.fetch) return true

                const OX = w.XMLHttpRequest
                class XHR extends OX {
                    open(...args) {
                        try { if (typeof args[1] === 'string') args[1] = replaceMediaUrl(args[1]) } catch (_) {}
                        return super.open(...args)
                    }
                    get responseText() {
                        if (this.readyState !== this.DONE) return super.responseText
                        return handle(super.responseText, this.responseURL, { type: 'xhr', xhr: this })
                    }
                    get response() {
                        if (this.readyState !== this.DONE) return super.response
                        return handle(super.response, this.responseURL, { type: 'xhr', xhr: this })
                    }
                }
                w.XMLHttpRequest = XHR

                const Ofetch = w.fetch
                w.fetch = (input, init) => {
                    const s0 = typeof input === 'string' ? input : (input && input.url)
                    if (typeof s0 === 'string') {
                        const r = replaceMediaUrl(s0)
                        if (r !== s0) {
                            if (typeof input === 'string') input = r
                            else input = new (w.Request || Request)(r, input)
                        }
                    }

                    const s = typeof input === 'string' ? input : (input && input.url)
                    let resolvedUrl = s
                    try { resolvedUrl = new URL(s, w.location && w.location.href ? w.location.href : location.href).href } catch (_) {}

                    const shouldIntercept = handle(null, resolvedUrl, { type: 'fetch', input, init })
                    if (!shouldIntercept) return Ofetch(input, init)
                    return Ofetch(input, init).then(resp => new Promise((resolve) => {
                        resp.text().then(text => {
                            const out = handle(text, resolvedUrl, { type: 'fetch', input, init, response: resp })
                            resolve(new (w.Response || Response)(out, { status: resp.status, statusText: resp.statusText, headers: resp.headers }))
                        })
                    }))
                }

                try {
                    const bHooked = w.__CCB_BLOB_HOOKED__
                    if (w.Blob && (!bHooked || bHooked !== w.Blob)) {
                        const OBlob = w.Blob
                        w.Blob = function (parts, options) {
                            const type = options && options.type ? String(options.type) : ''
                            const looksJs = /javascript/i.test(type)
                                || (Array.isArray(parts) && parts.some(p => typeof p === 'string' && /importScripts|WorkerGlobalScope|bili/i.test(p)))
                            if (looksJs && shouldInstallWorkerHooks()) {
                                const injected = [buildWorkerPrelude(), ...(Array.isArray(parts) ? parts : [parts])]
                                return new OBlob(injected, options)
                            }
                            return new OBlob(parts, options)
                        }
                        w.__CCB_BLOB_HOOKED__ = w.Blob
                    }
                } catch (_) {}

                try {
                    const wHooked = w.__CCB_WORKER_WRAPPED__
                    if (w.Worker && (!wHooked || wHooked !== w.Worker)) {
                        const OWorker = w.Worker
                        w.Worker = function (scriptURL, options) {
                            try {
                                if (!shouldInstallWorkerHooks()) return new OWorker(scriptURL, options)
                                const raw = (typeof scriptURL === 'string') ? scriptURL : String(scriptURL)
                                if (raw.startsWith('blob:') || raw.startsWith('data:')) return new OWorker(scriptURL, options)
                                const isModule = options && options.type === 'module'
                                const wrapperCode = isModule
                                    ? `${buildWorkerPrelude()}\nimport ${JSON.stringify(raw)};\n`
                                    : `${buildWorkerPrelude()}\nimportScripts(${JSON.stringify(raw)});\n`
                                const blob = new w.Blob([wrapperCode], { type: 'application/javascript' })
                                const url = w.URL.createObjectURL(blob)
                                return new OWorker(url, options)
                            } catch (_) {
                                return new OWorker(scriptURL, options)
                            }
                        }
                        w.__CCB_WORKER_WRAPPED__ = w.Worker
                    }
                } catch (_) {}

                w.__CCB_NET_HOOKED__ = { xhr: w.XMLHttpRequest, fetch: w.fetch }
                return true
            } catch (_) {
                return false
            }
        }

        hookWindow(theWindow)
        register._hookWindow = hookWindow
        return register
    })(unsafeWindow)

    const PLAYURL_PATHS = [
        '/x/player/wbi/playurl',
        '/x/player/playurl'
    ]

    interceptNetResponse((response, url) => {
        if (!isCcbEnabled()) return
        const u = typeof url === 'string' ? url : (url && url.url) || String(url)
        if (!PLAYURL_PATHS.some(p => u.includes(p))) return
        if (response === null) return true

        try {
            if (typeof response === 'string') {
                const obj = JSON.parse(response)
                transformPlayUrlResponse(obj)
                return JSON.stringify(obj)
            }
            if (response && typeof response === 'object') {
                transformPlayUrlResponse(response)
                return response
            }
        } catch (e) {
            logger('处理 playurl 失败:', e)
        }
    })

    interceptNetResponse((response, url) => {
        if (!isCcbEnabled()) return
        if (!getLiveMode()) return
        const raw = typeof url === 'string' ? url : (url && url.url) || ''
        let u
        try { u = new URL(raw || String(url), location.href) } catch (_) { return }
        const p = u.pathname || ''
        if (!(/\/xlive\/web-room\/v\d+\/index\/getRoomPlayInfo\/?$/.test(p) || /\/room\/v1\/Room\/playUrl\/?$/.test(p))) return
        if (response === null) return true
        if (!isLiveRoomPage()) return
        try {
            const obj = typeof response === 'string' ? JSON.parse(response) : response
            transformLiveNeptune(obj)
            return (typeof response === 'string') ? JSON.stringify(obj) : obj
        } catch (e) {
            logger('处理直播 playurl 失败:', e)
        }
    })

    interceptNetResponse((response, url) => {
        if (!isCcbEnabled()) return
        if (!getLiveMode()) return
        const u = typeof url === 'string' ? url : (url && url.url) || String(url)
        if (!u.includes('/xlive/play-gateway/master/url')) return
        if (response === null) return true
        return replaceBilivideoInText(response)
    })

    const installLiveBootstrapHooks = () => {
        if (!getLiveMode() || !isLiveRoomPage() || !isCcbEnabled()) return
        const seen = new WeakSet()
        const tryRewrite = (obj) => {
            if (!obj || typeof obj !== 'object') return
            if (seen.has(obj)) return
            seen.add(obj)
            transformLiveNeptune(obj)
        }
        try {
            const propName = '__NEPTUNE_IS_MY_WAIFU__'
            let internal = unsafeWindow[propName]
            if (internal && typeof internal === 'object') tryRewrite(internal)
            Object.defineProperty(unsafeWindow, propName, {
                configurable: true,
                get: () => internal,
                set: (v) => {
                    internal = v
                    if (v && typeof v === 'object') tryRewrite(v)
                }
            })
        } catch (e) {
            logger('直播首播 Hook 安装失败:', String(e))
        }
    }

    installLiveBootstrapHooks()

    const watchGlobal = (name, handler) => {
        try {
            if (unsafeWindow[name] && typeof unsafeWindow[name] === 'object') handler(unsafeWindow[name])
            let internal = unsafeWindow[name]
            Object.defineProperty(unsafeWindow, name, {
                configurable: true,
                get: () => internal,
                set: (v) => {
                    internal = v
                    if (v && typeof v === 'object') handler(v)
                }
            })
        } catch (_) {}
    }

    watchGlobal('__playinfo__', (obj) => {
        if (!isCcbEnabled()) return
        try { transformPlayUrlResponse(obj) } catch (_) {}
    })
    watchGlobal('__INITIAL_STATE__', (obj) => {
        if (!isCcbEnabled()) return
        try { transformPlayUrlResponse(obj) } catch (_) {}
    })

    const createButton = (text, primary, second) => {
        const btn = document.createElement('button')
        btn.textContent = text
        btn.style.cssText = [
            'border:0',
            'border-radius:8px',
            'padding:8px 10px',
            'cursor:pointer',
            'color:#fff',
            `background:${primary ? '#2b74ff' : (second ? '#1bc543ff' : '#444')}`,
        ].join(';')
        return btn
    }

    const openPanel = () => {
        const existing = document.querySelector('#ccb-settings-panel')
        if (existing) {
            existing.remove()
            return
        }

        const root = document.createElement('div')
        root.id = 'ccb-settings-panel'
        root.style.cssText = [
            'position:fixed',
            'z-index:2147483647',
            'right:18px',
            'top:18px',
            'width:360px',
            'max-width:calc(100vw - 36px)',
            'max-height:calc(100vh - 36px)',
            'overflow:auto',
            'background:rgba(20,20,20,.96)',
            'border:1px solid #333',
            'border-radius:10px',
            'box-shadow:0 8px 24px rgba(0,0,0,.35)',
            'color:#fff',
            'font-size:12px',
            'font-family:system-ui,-apple-system,sans-serif',
        ].join(';')

        const header = document.createElement('div')
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid #2f2f2f'
        const title = document.createElement('div')
        title.textContent = 'B站换源设置 (内置私有池版)'
        title.style.cssText = 'font-weight:700;font-size:13px'
        const closeBtn = createButton('关闭', false, false)
        closeBtn.addEventListener('click', () => { try { root.remove() } catch (_) {} })
        header.appendChild(title)
        header.appendChild(closeBtn)
        root.appendChild(header)

        const body = document.createElement('div')
        body.style.cssText = 'padding:12px'
        root.appendChild(body)

        const mkSectionTitle = (text) => {
            const t = document.createElement('div')
            t.textContent = text
            t.style.cssText = 'font-weight:700;font-size:12px;margin:2px 0 8px;color:#e5e5e5'
            return t
        }

        const mkSectionBox = () => {
            const box = document.createElement('div')
            box.style.cssText = 'border:1px solid #2f2f2f;border-radius:10px;padding:10px;margin:10px 0;background:rgba(0,0,0,.12)'
            return box
        }

        const mkInput = (value) => {
            const inp = document.createElement('input')
            inp.type = 'text'
            inp.placeholder = '例如: upos-sz-mirrorali.bilivideo.com'
            inp.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #333;border-radius:8px;padding:8px;outline:none'
            inp.value = value || ''
            return inp
        }

        const mountNodeSelect = (ctx, hostBox) => {
            let nodeValue = getTargetCdnNode(ctx)

            const row = document.createElement('div')
            row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0'
            const label = document.createElement('div')
            label.textContent = '节点'
            label.style.cssText = 'color:#bbb;width:30px;'
            row.appendChild(label)

            const sel = document.createElement('select')
            sel.style.cssText = 'flex:1;background:#111;color:#fff;border:1px solid #333;border-radius:8px;padding:8px;width:100%;'

            MY_CDN_LIST.forEach(item => {
                const opt = document.createElement('option')
                opt.value = item.value
                opt.textContent = item.name
                sel.appendChild(opt)
            })

            const isCustom = nodeValue !== defaultCdnNode && !MY_CDN_LIST.find(c => c.value === nodeValue);
            sel.value = isCustom ? manualRegionName : nodeValue;
            row.appendChild(sel)
            hostBox.appendChild(row)

            const inpRow = document.createElement('div')
            inpRow.style.cssText = 'display:flex;margin-top:8px;gap:8px;'
            const inp = mkInput(nodeValue === defaultCdnNode || !isCustom ? '' : nodeValue)
            inpRow.appendChild(inp)
            inpRow.style.display = sel.value === manualRegionName ? 'flex' : 'none'
            hostBox.appendChild(inpRow)

            sel.addEventListener('change', () => {
                if (sel.value === manualRegionName) {
                    inpRow.style.display = 'flex'
                    setTargetCdnNode(ctx, inp.value.trim() || defaultCdnNode)
                } else {
                    inpRow.style.display = 'none'
                    setTargetCdnNode(ctx, sel.value)
                }
            })

            inp.addEventListener('input', () => {
                setTargetCdnNode(ctx, inp.value.trim() || defaultCdnNode)
            })
        }

        const mainBox = mkSectionBox()
        mainBox.appendChild(mkSectionTitle('视频换源'))
        body.appendChild(mainBox)
        mountNodeSelect('main', mainBox)

        const liveBox = mkSectionBox()
        liveBox.appendChild(mkSectionTitle('直播换源'))
        body.appendChild(liveBox)
        mountNodeSelect('live', liveBox)

        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px'
        const powerBtn = createButton(getPowerMode() ? '强力替换模式：ON' : '强力替换模式：OFF', true, false)
        powerBtn.addEventListener('click', () => {
            const next = !getPowerMode()
            GM_setValue(powerModeStored, next)
            powerBtn.textContent = next ? '强力替换模式：ON' : '强力替换模式：OFF'
        })
        const liveBtn = createButton(getLiveMode() ? '适用直播：ON' : '适用直播：OFF', true, false)
        liveBtn.addEventListener('click', () => {
            const next = !getLiveMode()
            GM_setValue(liveModeStored, next)
            liveBtn.textContent = next ? '适用直播：ON' : '适用直播：OFF'
        })
        const applyBtn = createButton('应用并刷新', false, true)
        applyBtn.addEventListener('click', () => { location.reload() })

        actions.appendChild(powerBtn)
        actions.appendChild(liveBtn)
        actions.appendChild(applyBtn)
        body.appendChild(actions)

        document.documentElement.appendChild(root)
    }

    if (window.top === window) {
        const stripNodeSuffix = (s) => String(s).replace(/(?:\.bilivideo\.(?:com|cn)|\.edge\.mountaintoys\.cn)$/i, '')
        const mainNodeName = stripNodeSuffix(getTargetCdnNode('main'))
        GM_registerMenuCommand(`配置 B 站 CDN 节点(当前:${mainNodeName})`, () => { openPanel() })
    }

    logger('CCB 加载完成', { host: location.host, path: location.pathname })
})()
