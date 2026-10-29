/*
  navigate.ts - takes the user to things in the app: pages, views, windows and widgets.
  Opening a widget walks the path the app model computed (page, then view or window, then
  the toolbar or panel holding it), asks Experience Builder to open it, falls back to
  clicking its toolbar button, and then pulses an outline around it so the user sees where
  it is. Works on any app; nothing here knows about a specific layout.
*/
import { getAppStore, appActions, jimuHistory } from 'jimu-core'
import type { AppModel, Hop } from '../brain/appModel'

const PULSE_CLASS = 'mappy-pulse'

function state (): any {
  try { return getAppStore().getState() } catch (e) { return null }
}

function dispatch (action: any): void {
  try { getAppStore().dispatch(action) } catch (e) { }
}

export function widgetEl (id: string): HTMLElement | null {
  const sel = [`[data-widgetid="${id}"]`, `[data-widget-id="${id}"]`, `.widget-${id}`]
  for (const s of sel) {
    const all = Array.from(document.querySelectorAll(s)) as HTMLElement[]
    const vis = all.find(isShown)
    if (vis) return vis
    if (all[0]) return all[0]
  }
  return null
}

function isShown (el: HTMLElement | null): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const cs = window.getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
}

/** Of several copies of a widget (one per screen size), the one the user can reach now. */
export function bestWidgetId (ids: string[], model: AppModel): string {
  if (ids.length <= 1) return ids[0]
  const reachable = ids.find(id => isShown(widgetEl(id)))
  if (reachable) return reachable
  const viaParent = ids.find(id => {
    const path = model.pathToWidget(id)
    const parent = [...path].reverse().find(h => h.type === 'widget')
    return parent ? isShown(widgetEl(parent.id)) : false
  })
  if (viaParent) return viaParent
  const curPage = state()?.appRuntimeInfo?.currentPageId
  const onPage = ids.find(id => model.pathToWidget(id).some(h => h.type === 'page' && h.id === curPage))
  return onPage || ids[0]
}

export function pulse (el: HTMLElement | null): void {
  if (!el) return
  try {
    el.classList.remove(PULSE_CLASS)
    void el.offsetWidth
    el.classList.add(PULSE_CLASS)
    setTimeout(() => el.classList.remove(PULSE_CLASS), 2600)
    let still = false
    try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { }
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: still ? 'auto' : 'smooth' })
  } catch (e) { }
}

async function walk (path: Hop[]): Promise<void> {
  const st = state()
  for (const h of path) {
    if (h.type === 'page' && st?.appRuntimeInfo?.currentPageId !== h.id) {
      try { jimuHistory.changePage(h.id) } catch (e) { }
      await wait(350)
    } else if (h.type === 'dialog') {
      try { jimuHistory.changeDialog(h.id) } catch (e) { }
      await wait(300)
    } else if (h.type === 'view' && h.sectionId) {
      try { jimuHistory.changeView(h.sectionId, h.id) } catch (e) { }
      await wait(250)
    } else if (h.type === 'widget' && h.name !== 'controller') {
      // Sidebars, panels and accordions: ask them to open; harmless if they ignore it.
      dispatch(appActions.openWidget(h.id))
      if (/sidebar/i.test(h.name || '')) await expandSidebar(h)
    }
  }
}

/**
 * A Sidebar (Esri's or Sidebar Custom) has one collapsible panel, named by its collapseSide
 * setting (FIRST or SECOND), shown when its "collapse" state is true (what its own Open
 * sidebar action sets). Open it only when what we want is in that panel; the other panel is
 * always showing. Sidebars inside sidebars are opened one by one on the way in.
 */
async function expandSidebar (h: Hop): Promise<void> {
  const st = state()
  const w = st?.appConfig?.widgets?.[h.id]
  const sideName = String(w?.config?.collapseSide || 'FIRST').toUpperCase() === 'SECOND' ? 'SECOND' : 'FIRST'
  const side = w?.layouts?.[sideName]
  const sideIds: string[] = side ? (typeof side === 'string' ? [side] : Object.values(side).map(String)) : []
  if (sideIds.length && h.layoutId && !sideIds.includes(h.layoutId)) return
  const open = st?.widgetsState?.[h.id]?.collapse ?? (w?.config?.defaultState !== 0)
  if (open) return
  dispatch(appActions.widgetStatePropChange(h.id, 'collapse', true))
  await wait(350)
}

/** Click the toolbar button that opens a widget held in a widget controller. */
function clickControllerButton (controllerId: string, widgetId: string, label: string): boolean {
  const ctrl = widgetEl(controllerId)
  if (!ctrl) return false
  const want = label.trim().toLowerCase()
  const candidates = Array.from(ctrl.querySelectorAll('button, [role="button"], [role="tab"], a')) as HTMLElement[]
  const match = candidates.find(b => {
    const names = [b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-widgetid'), b.textContent]
      .filter(Boolean).map(s => String(s).trim().toLowerCase())
    return names.includes(want) || names.includes(widgetId.toLowerCase())
  })
  if (match) { match.click(); return true }
  return false
}

export async function openWidget (ids: string[], label: string, model: AppModel, opts: { pulse?: boolean } = {}): Promise<{ ok: boolean, where: string, el: HTMLElement | null }> {
  const id = bestWidgetId(ids, model)
  const path = model.pathToWidget(id)
  const where = model.describePath(path)
  await walk(path)
  dispatch(appActions.openWidget(id))
  try { dispatch(appActions.activateWidget(id)) } catch (e) { }
  await wait(450)
  let el = widgetEl(id)
  const ctrl = [...path].reverse().find(h => h.type === 'widget' && h.name === 'controller')
  if (!isShown(el) && ctrl) {
    if (clickControllerButton(ctrl.id, id, label)) {
      await wait(450)
      el = widgetEl(id)
    }
  }
  if (isShown(el)) { if (opts.pulse !== false) pulse(el); return { ok: true, where, el } }
  // Could not see it: point at the toolbar or panel that holds it instead.
  const holder = [...path].reverse().find(h => h.type === 'widget')
  const holderEl = holder ? widgetEl(holder.id) : null
  if (isShown(holderEl)) { if (opts.pulse !== false) pulse(holderEl); return { ok: true, where, el: holderEl } }
  return { ok: false, where, el: null }
}

/** A help button inside this element: a "Help", "Help guide", "How to use" or "?" button that is showing. */
function helpButtonIn (scope: Element): HTMLElement | null {
  const all = Array.from(scope.querySelectorAll('button, [role="button"], a')) as HTMLElement[]
  const said = (b: HTMLElement) => [b.getAttribute('aria-label'), b.getAttribute('title'), b.textContent].filter(Boolean).map(t => String(t).trim()).join(' ')
  const hits = all.filter(b => !b.closest('.mappy-bubble, .mappy-layer') && isShown(b) && (/\b(help|guide|how to use|instructions|tutorial)\b/i.test(said(b)) || said(b) === '?'))
  // Prefer a plain "Help" button over links inside help text.
  return hits.find(b => b.tagName === 'BUTTON') || hits[0] || null
}

/**
 * Opens a widget, then its own help guide (the question-mark button most widgets carry).
 * Widgets load on first open and may sit in a controller panel, so it keeps looking for the
 * button for a few seconds, in every copy of the widget on screen and its panel.
 */
export async function openWidgetHelp (ids: string[], label: string, model: AppModel): Promise<HTMLElement | null> {
  const r = await openWidget(ids, label, model, { pulse: false })
  const id = bestWidgetId(ids, model)
  const sel = [`[data-widgetid="${id}"]`, `[data-widget-id="${id}"]`, `.widget-${id}`].join(',')
  for (let i = 0; i < 20; i++) {
    const hosts = Array.from(document.querySelectorAll(sel)) as Element[]
    // The widget, and the panel or popper around it (a controller draws its header there).
    const scopes = [...hosts, ...hosts.map(h => h.closest('[role="dialog"], .popper, .widget-controller-panel, .panel, .jimu-widget-panel')).filter(Boolean) as Element[]]
    for (const scope of scopes) {
      const btn = helpButtonIn(scope)
      if (btn) {
        // Already open (a toggle that says so): leave it open.
        if (btn.getAttribute('aria-expanded') !== 'true' && btn.getAttribute('aria-pressed') !== 'true') btn.click()
        await wait(300)
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"], .modal.show, [role="dialog"]:not(.mappy-bubble)') as HTMLElement | null
        pulse(dialog && isShown(dialog) ? dialog : btn)
        return dialog && isShown(dialog) ? dialog : btn
      }
    }
    await wait(200)
  }
  if (r.el) pulse(r.el)
  return null
}

export function closeWidget (ids: string[]): void {
  for (const id of ids) dispatch(appActions.closeWidget(id))
}

export async function goPage (id: string): Promise<void> { try { jimuHistory.changePage(id) } catch (e) { } }
export async function goDialog (id: string): Promise<void> { try { jimuHistory.changeDialog(id) } catch (e) { } }
export async function goView (sectionId: string, viewId: string, model: AppModel): Promise<void> {
  await walk(model.pathToView(viewId))
  try { jimuHistory.changeView(sectionId, viewId) } catch (e) { }
}

export function openUrl (url: string): void {
  try {
    if (/^mailto:/i.test(url)) { window.location.href = url; return }
    window.open(url, '_blank', 'noopener')
  } catch (e) { }
}

export function wait (ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }
