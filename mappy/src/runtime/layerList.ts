/*
  layerList.ts - finds a layer list widget that publishes the layer list bridge
  (window.__exbLayerLists, contract version 1; Map Layers Custom 1.50.0 and later) for the
  same map, so Mappy sees layers exactly as that list shows them and changes them through it.
  Types are copied here on purpose: widgets never import each other.
*/

export const BRIDGE_KEY = '__exbLayerLists'
export const BRIDGE_EVENT = 'exb-layer-list-change'

export interface BridgeItem {
  isTable?: boolean
  layer: any
  title: string
  rawTitle: string
  path: string
  depth: number
  isGroup: boolean
  visible: boolean
  effective: boolean
  inScale: boolean
  ancestors: any[]
  exclusive: boolean
  favorite: boolean
}

export interface LayerListBridge {
  version: number
  widgetId: string
  label: string
  readonly ready: boolean
  readonly view: any
  readonly mapWidgetId: string | null
  readonly element: HTMLElement | null
  items: () => BridgeItem[]
  setVisible: (layer: any, on: boolean) => { parents: string[], children: string[] }
  reveal: (layer: any) => boolean
  presets: () => Array<{ id: string, name: string }>
  applyPreset: (idOrName: string) => boolean
  favorites: () => string[]
}

export function allBridges (): LayerListBridge[] {
  try {
    const reg = (window as any)[BRIDGE_KEY] || {}
    return Object.keys(reg).map(k => reg[k]).filter(b => b && b.version >= 1 && typeof b.items === 'function')
  } catch (e) { return [] }
}

/** The ready list for this view (or this view's map), the one on screen first. */
export function findBridge (view: any): LayerListBridge | null {
  if (!view) return null
  const list = allBridges().filter(b => {
    try { return b.ready && (b.view === view || (b.view?.map && b.view.map === view.map)) } catch (e) { return false }
  })
  if (!list.length) return null
  const shown = list.find(b => isShown(b.element))
  return shown || list[0]
}

export function isShown (el: HTMLElement | null): boolean {
  if (!el) return false
  try {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const cs = window.getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  } catch (e) { return false }
}

export function onBridgeChange (cb: () => void): () => void {
  const fn = () => { try { cb() } catch (e) { } }
  try { window.addEventListener(BRIDGE_EVENT, fn) } catch (e) { }
  return () => { try { window.removeEventListener(BRIDGE_EVENT, fn) } catch (e) { } }
}

/** Waits for a ready list for this view to appear (after Mappy opens it). */
export function waitForBridge (view: any, ms = 3500): Promise<LayerListBridge | null> {
  return new Promise(resolve => {
    const now = findBridge(view)
    if (now && isShown(now.element)) { resolve(now); return }
    let done = false
    const finish = (b: LayerListBridge | null) => { if (!done) { done = true; off(); clearInterval(poll); clearTimeout(t); resolve(b) } }
    const check = () => { const b = findBridge(view); if (b && isShown(b.element)) finish(b) }
    const off = onBridgeChange(check)
    const poll = setInterval(check, 200)
    const t = setTimeout(() => finish(findBridge(view)), ms)
  })
}
