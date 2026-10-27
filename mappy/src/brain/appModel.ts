/*
  appModel.ts - reads an Experience Builder app config (plain JSON, any app) and answers
  "where does this widget live, and how do I get the user there?". Pure TypeScript.

  The config has no parent pointers, so this builds them once: every layout is owned by a
  page, view, dialog, screen, header, footer or a container widget (controller, sidebar,
  column...), and every layout item is a widget or a section.
*/

export type HopType = 'page' | 'view' | 'dialog' | 'widget' | 'screen' | 'header' | 'footer' | 'section'

export interface Hop {
  type: HopType
  id: string
  label: string
  /** For a view: its section. */
  sectionId?: string
  /** For a widget hop: the manifest folder name (controller, sidebar...). */
  name?: string
}

interface Owner { type: HopType, id: string }

export class AppModel {
  cfg: any
  private layoutOwner = new Map<string, Owner>()
  private widgetLayouts = new Map<string, string[]>()
  private sectionLayouts = new Map<string, string[]>()
  private viewSection = new Map<string, string>()

  constructor (appConfig: any) {
    this.cfg = appConfig || {}
    const c = this.cfg
    const own = (layoutRef: any, owner: Owner) => {
      if (!layoutRef) return
      if (typeof layoutRef === 'string') { this.layoutOwner.set(layoutRef, owner); return }
      Object.keys(layoutRef).forEach(k => {
        const v = layoutRef[k]
        if (typeof v === 'string') this.layoutOwner.set(v, owner)
        else if (v && typeof v === 'object') own(v, owner)
      })
    }
    eachKey(c.pages, (p, id) => own(p.layout, { type: 'page', id }))
    eachKey(c.views, (v, id) => own(v.layout, { type: 'view', id }))
    eachKey(c.dialogs, (d, id) => own(d.layout, { type: 'dialog', id }))
    eachKey(c.screens, (s, id) => { own(s.panel?.layout, { type: 'screen', id }); own(s.main?.layout, { type: 'screen', id }) })
    if (c.header) own(c.header.layout, { type: 'header', id: 'header' })
    if (c.footer) own(c.footer.layout, { type: 'footer', id: 'footer' })
    eachKey(c.widgets, (w, id) => own(w.layouts, { type: 'widget', id }))
    eachKey(c.sections, (s, id) => (s.views || []).forEach((v: string) => this.viewSection.set(v, id)))
    eachKey(c.layouts, (l, lid) => {
      eachKey(l.content, (item) => {
        if (!item || item.isPending) return
        if (item.widgetId) push(this.widgetLayouts, item.widgetId, lid)
        if (item.sectionId) push(this.sectionLayouts, item.sectionId, lid)
      })
    })
  }

  label (h: Owner): string {
    const c = this.cfg
    switch (h.type) {
      case 'page': return c.pages?.[h.id]?.label || h.id
      case 'view': return c.views?.[h.id]?.label || h.id
      case 'dialog': return c.dialogs?.[h.id]?.label || h.id
      case 'screen': return c.screens?.[h.id]?.label || h.id
      case 'widget': return c.widgets?.[h.id]?.label || h.id
      case 'section': return c.sections?.[h.id]?.label || h.id
      case 'header': return 'header'
      case 'footer': return 'footer'
    }
    return h.id
  }

  private hop (o: Owner): Hop {
    const h: Hop = { type: o.type, id: o.id, label: this.label(o) }
    if (o.type === 'view') h.sectionId = this.viewSection.get(o.id)
    if (o.type === 'widget') h.name = folder(this.cfg.widgets?.[o.id]?.uri)
    return h
  }

  /** Outermost first: page/dialog -> ... -> direct parent. Empty when the widget is not placed. */
  pathToWidget (widgetId: string): Hop[] {
    return this.pathFrom(this.widgetLayouts.get(widgetId) || [], new Set([widgetId]))
  }

  pathToView (viewId: string): Hop[] {
    const sid = this.viewSection.get(viewId)
    if (!sid) return []
    return this.pathFrom(this.sectionLayouts.get(sid) || [], new Set())
  }

  isPlaced (widgetId: string): boolean {
    return (this.widgetLayouts.get(widgetId) || []).length > 0
  }

  private pathFrom (layouts: string[], seen: Set<string>): Hop[] {
    for (const lid of layouts) {
      const owner = this.layoutOwner.get(lid)
      if (!owner) continue
      if (seen.has(owner.id)) continue
      seen.add(owner.id)
      let parent: Hop[] = []
      if (owner.type === 'widget') parent = this.pathFrom(this.widgetLayouts.get(owner.id) || [], seen)
      else if (owner.type === 'view') {
        const sid = this.viewSection.get(owner.id)
        if (sid) parent = this.pathFrom(this.sectionLayouts.get(sid) || [], seen)
      } else if (owner.type === 'screen') {
        const groupId = Object.keys(this.cfg.screenGroups || {}).find(g => (this.cfg.screenGroups[g].screens || []).includes(owner.id))
        if (groupId) {
          const gl: string[] = []
          eachKey(this.cfg.layouts, (l, id) => eachKey(l.content, (it) => { if (it?.screenGroupId === groupId) gl.push(id) }))
          parent = this.pathFrom(gl, seen)
        }
      }
      return [...parent, this.hop(owner)]
    }
    return []
  }

  /** Plain words for where something lives: 'in the "Widget Controller" on the "City Map" page'. */
  describePath (path: Hop[]): string {
    if (!path.length) return ''
    const parts: string[] = []
    for (let i = path.length - 1; i >= 0; i--) {
      const h = path[i]
      if (h.type === 'page') parts.push(`on the "${h.label}" page`)
      else if (h.type === 'dialog') parts.push(`in the "${h.label}" window`)
      else if (h.type === 'view') parts.push(`in the "${h.label}" view`)
      else if (h.type === 'header') parts.push('in the header')
      else if (h.type === 'footer') parts.push('in the footer')
      else if (h.type === 'screen') parts.push(`in the "${h.label}" screen`)
      else if (h.type === 'widget') {
        const n = h.name || ''
        if (n === 'controller') parts.push(`in the toolbar ("${h.label}")`)
        else if (/sidebar/.test(n)) parts.push(`in the "${h.label}" side panel`)
        else if (/column|row|fixed|card|section|accordion|grid/.test(n)) continue
        else parts.push(`inside "${h.label}"`)
      }
    }
    return parts.slice(0, 3).join(', ')
  }
}

function folder (uri: string): string {
  const p = String(uri || '').split('/').filter(Boolean)
  return p[p.length - 1] || ''
}

function push (m: Map<string, string[]>, k: string, v: string): void {
  const a = m.get(k)
  if (a) { if (!a.includes(v)) a.push(v) } else m.set(k, [v])
}

export function eachKey (obj: any, fn: (v: any, k: string) => void): void {
  if (!obj || typeof obj !== 'object') return
  for (const k of Object.keys(obj)) fn(obj[k], k)
}
