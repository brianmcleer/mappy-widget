import { React } from 'jimu-core'
import { injectStyles } from './styles'

/** A browser-owned desktop window. The map and assistant logic remain in the app tab. */
export function useDesktopWindow () {
  const [desktop, setDesktop] = React.useState<Window | null>(null)
  const current = React.useRef<Window | null>(null)
  const pending = React.useRef(false)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; current.current?.close(); current.current = null }
  }, [])
  const open = async () => {
    if (current.current && !current.current.closed) { current.current.focus(); return }
    if (pending.current) return
    const api = (window as any).documentPictureInPicture
    if (!api?.requestWindow) throw new Error('Desktop floating is not supported in this browser. Open the app in a browser with Document Picture-in-Picture support.')
    pending.current = true
    try {
      const child: Window = await api.requestWindow({ width: 420, height: 650 })
      if (!mounted.current) { child.close(); return }
      current.current = child
      child.document.title = 'Mappy desktop companion'
      child.document.documentElement.lang = document.documentElement.lang || 'en'
      injectStyles(child.document)
      const style = child.document.createElement('style')
      style.textContent = `body{margin:0;font:14px system-ui,sans-serif;background:#f5f0df;color:#302719}
        .mappy-desktop-bar{position:fixed;top:0;left:0;right:0;z-index:2147483001;padding:6px 12px;display:flex;align-items:center;gap:8px;background:#f5f0df;font-size:12px}
        .mappy-desktop-bar button{margin-left:auto;min-height:28px;cursor:pointer}
        .mappy-bubble{left:12px!important;top:48px!important;width:calc(100vw - 24px)!important;max-height:calc(100vh - 160px)!important;visibility:visible!important}
        .mappy-char-wrap{left:auto!important;right:12px!important;bottom:8px!important}
        .mappy-char-wrap>div{max-width:90px;max-height:99px}.mappy-char{max-width:90px;max-height:99px}
        .mappy-tail{display:none}.mappy-layer{font-family:system-ui,sans-serif}
        @media(max-height:400px){.mappy-char-wrap{display:none}.mappy-bubble{max-height:calc(100vh - 60px)!important}}`
      child.document.head.appendChild(style)
      child.addEventListener('pagehide', () => {
        if (current.current !== child) return
        current.current = null
        if (mounted.current) setDesktop(null)
      }, { once: true })
      setDesktop(child)
    } finally { pending.current = false }
  }
  return { desktop, open, close: () => current.current?.close() }
}
