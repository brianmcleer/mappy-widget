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
  const open = async (title = 'Mappy') => {
    if (current.current && !current.current.closed) { current.current.focus(); return }
    if (pending.current) return
    const api = (window as any).documentPictureInPicture
    if (!api?.requestWindow) throw new Error('Desktop floating is not supported in this browser. Open the app in a browser with Document Picture-in-Picture support.')
    pending.current = true
    try {
      const child: Window = await api.requestWindow({ width: 400, height: 640 })
      if (!mounted.current) { child.close(); return }
      current.current = child
      child.document.title = title
      child.document.documentElement.lang = document.documentElement.lang || 'en'
      injectStyles(child.document)
      const style = child.document.createElement('style')
      // The window is the chat: it fills the window edge to edge and grows with it.
      style.textContent = `html,body{margin:0;height:100%;overflow:hidden;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}
        .mappy-layer{font-family:inherit}`
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
