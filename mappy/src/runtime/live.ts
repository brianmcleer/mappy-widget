/*
  live.ts - Mappy's hands on the map.

  Layers are seen the way the layer list shows them. When a layer list widget publishes the
  layer list bridge (layerList.ts) for this map, Mappy reads the tree from it (hidden rows
  left out, display names, groups at any depth) and switches layers through it, so the list
  stays in charge. Without one he walks the map himself with the same rules: groups, map image
  sublayers and group sublayers are entries; turning a layer on also turns on every group
  above it; a group with nothing on inside gets its layers turned on.

  What Mappy "sees" (search, counts, fields, facts) is only what is actually drawing: the
  layer and every group above it on. Off layers are known by name only, so he can turn them on.

  Every Maps SDK module is loaded at call time through loadArcGISJSAPIModules, and every path
  is guarded so a layer that fails never breaks the chat.
*/
import { loadArcGISJSAPIModules } from 'jimu-core'
import { toLatLon } from './project'
import type { JimuMapView } from 'jimu-arcgis'
import type { Doc, LayerHint } from '../brain/types'
import { docsFromLayer, pickSearchFields } from '../brain/layers'
import type { FieldInfo, LayerInfo } from '../brain/layers'
import { layerKey, flat, tokenize } from '../brain/text'
import { findBridge, onBridgeChange } from './layerList'
import type { LayerListBridge } from './layerList'
import { fieldLabel } from '../brain/fields'

export interface LayerEntry {
  key: string
  /** Name as the layer list shows it. */
  title: string
  /** The Maps SDK layer: the layer itself, a group layer, or the map image layer that owns a sublayer. */
  layer: any
  sublayer?: any
  isTable?: boolean
  /** Holds other layers: group layer, map image service, group sublayer. */
  isGroup?: boolean
  parentTitle?: string
  /** Containers above, outermost first. */
  ancestors: any[]
  /** "Utilities > Water > Hydrants". */
  path: string
  depth: number
  exclusive?: boolean
  favorite?: boolean
}

export type LayerStatus = 'on' | 'off' | 'hidden' | 'scale'

export interface ToggleResult { parents: string[], children: string[] }

export interface FeatureResult {
  entry: LayerEntry
  graphic: any
  label: string
  detail: string
}

export interface MapSnapshot {
  view: any
  layers: Array<{ target: any, visible: boolean, opacity: number, definitionExpression?: string }>
}

const TAG = '__mappy'
/** Scales for each kind of move (1:n). A city block is about 1:2,400; a few houses 1:600; a whole layer never closer than 1:1,200. */
export const SCALE = { address: 2400, feature: 2400, place: 1500, closest: 600, layerMin: 1200, coordinates: 2400, world: 10000000 }
const HIGHLIGHT_RGB = [230, 119, 0]
const toArr = (c: any): any[] => { try { return c ? (c.toArray ? c.toArray() : Array.isArray(c) ? c : Array.from(c)) : [] } catch (e) { return [] } }
const isSublayer = (l: any): boolean => !!l && (l.declaredClass === 'esri.layers.support.Sublayer' || (l.layer && l.id != null && typeof l.layer === 'object' && !l.layers))

export class LiveMap {
  private history: Array<{ label: string, changes: Array<{ target: any, prop: string, before: any, after: any }> }> = []

  snapshot (): MapSnapshot {
    return { view: this.view, layers: this.entries().map(e => { const target = this.target(e); return { target, visible: target.visible, opacity: target.opacity, definitionExpression: target.definitionExpression } }) }
  }

  remember (before: MapSnapshot, label: string): boolean {
    if (before.view !== this.view) return false
    const changes: Array<{ target: any, prop: string, before: any, after: any }> = []
    for (const item of before.layers) for (const prop of ['visible', 'opacity', 'definitionExpression'] as const) {
      if ((item[prop] ?? undefined) !== (item.target[prop] ?? undefined)) changes.push({ target: item.target, prop, before: item[prop], after: item.target[prop] })
    }
    if (!changes.length) return false
    this.history.push({ label, changes })
    this.history = this.history.slice(-20)
    return true
  }

  /** What Mappy changed on this map so far, oldest first ("turning on Parcels"). */
  changesSoFar (): string[] { return this.history.map(h => h.label) }

  /** The feature whose popup is open, with its layer's title, or null. */
  selectedFeature (): { title: string, attributes: { [k: string]: any }, fields: Array<{ name: string, alias?: string }> } | null {
    try {
      const f = this.view?.popup?.selectedFeature
      if (!f) return null
      const layer = f.layer || f.sourceLayer
      return { title: String(layer?.title || ''), attributes: f.attributes || {}, fields: (layer?.fields || []).map((x: any) => ({ name: x.name, alias: x.alias })) }
    } catch (e) { return null }
  }

  undo (): string {
    const item = this.history.pop()
    if (!item) return 'There are no Mappy layer changes to undo on this map.'
    const current = new Set(this.entries().map(e => this.target(e)))
    let restored = 0
    for (const change of item.changes) {
      // Do not overwrite changes made later by another widget or by the user.
      if (current.has(change.target) && change.target[change.prop] === change.after) {
        try {
          change.target[change.prop] = change.before; restored++
          if (change.prop === 'definitionExpression') { const f = this.filters.get(change.target); if (f && (f.base || undefined) === (change.before || undefined)) this.filters.delete(change.target) }
        } catch (e) { }
      }
    }
    this.changed(true)
    return restored ? `Undid ${item.label}.${restored < item.changes.length ? ' Later changes made outside Mappy were kept.' : ''}` : 'Nothing restored: these layers were removed or changed outside Mappy.'
  }
  jmv: JimuMapView | null = null
  private home: any = null
  /** Where the map has been, newest last, for "go back". */
  private extents: any[] = []
  private goingBack = false
  private basemaps: any[] | null = null
  private highlightHandles: any[] = []
  private listeners: Array<() => void> = []
  private dragCount = 0
  private dragTimer: any = null
  private lastSig = ''
  onBusy: (() => void) | null = null
  /** Layers added, removed, switched, or a layer list appeared: Mappy rebuilds what he sees. */
  onLayersChanged: (() => void) | null = null
  /** The user opened a popup on a feature: Mappy can offer what he knows about that layer. */
  onPopup: ((layerTitle: string, feature: any) => void) | null = null

  /** The widget's own switch for calm map moves (Pause, or the builder's setting). The OS preference counts too. */
  reducedMotion = false
  /** Jumps instead of flying: the OS "reduce motion" preference, the widget paused, or the builder's setting. */
  get calm (): boolean {
    if (this.reducedMotion) return true
    try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } catch (e) { return false }
  }

  /**
   * One place for every map move: durations are short (at most 700 ms, slower for small
   * nudges), the easing settles gently, and under reduced motion the map jumps with no
   * animation at all. A target scale never goes closer than the minimum for its kind.
   */
  async go (target: any, ms = 700): Promise<void> {
    const view = this.view
    if (!view) return
    const opts = this.calm ? { animate: false } : { duration: Math.min(700, Math.max(200, ms)), easing: 'ease-out' }
    await withTimeout(view.goTo(target, opts), 12000)
  }

  /** After zooming to a geometry: never closer than `min` (1:600 is a few houses), so a tiny parcel or a point does not fill the screen. */
  private async backOffTo (min: number): Promise<void> {
    const view = this.view
    if (view?.scale && view.scale < min) { try { await this.go({ scale: min }, 250) } catch (e) { } }
  }

  get view (): any { return this.jmv?.view || null }
  get ready (): boolean { return !!this.view }
  /** The layer list Mappy works through, when one publishes the bridge for this map. */
  get bridge (): LayerListBridge | null { return findBridge(this.view) }

  bind (jmv: JimuMapView | null): void {
    this.unbind()
    this.jmv = jmv
    const view = this.view
    if (!view) return
    try { view.when?.(() => { try { this.home = view.viewpoint?.clone?.() || null; const vp = view.viewpoint?.clone?.(); if (vp && !this.extents.length) this.extents.push(vp) } catch (e) { } }) } catch (e) { }
    try {
      const h1 = view.on('drag', (evt: any) => { if (evt?.action === 'end') this.bump() })
      const h2 = view.on('mouse-wheel', () => this.bump())
      this.listeners.push(() => h1?.remove?.(), () => h2?.remove?.())
    } catch (e) { }
    // Remember each place the map settles, so "go back" can return there.
    try {
      const h3 = view.watch?.('stationary', (still: boolean) => {
        if (!still) return
        // Arriving from "go back" is not a new place to remember.
        if (this.goingBack) { this.goingBack = false; return }
        try {
          const vp = view.viewpoint?.clone?.()
          if (!vp) return
          const last = this.extents[this.extents.length - 1]
          if (last && Math.abs(last.scale - vp.scale) < 1 && last.targetGeometry?.x === vp.targetGeometry?.x && last.targetGeometry?.y === vp.targetGeometry?.y) return
          this.extents.push(vp)
          if (this.extents.length > 30) this.extents.shift()
        } catch (e) { }
      })
      this.listeners.push(() => h3?.remove?.())
    } catch (e) { }
    // The feature under an open popup, for "what did I click" and popup tips.
    try {
      const h4 = view.watch?.('popup.selectedFeature', (f: any) => {
        if (!f) return
        try { this.onPopup?.(String(f.layer?.title || f.sourceLayer?.title || ''), f) } catch (e) { }
      })
      this.listeners.push(() => h4?.remove?.())
    } catch (e) { }
    this.listeners.push(onBridgeChange(() => this.changed(true)))
    // Visibility, scale and tree changes from anywhere (the layer list, presets, other
    // widgets): a cheap signature checked while the page is visible.
    const poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      this.changed(false)
    }, 1200)
    this.listeners.push(() => clearInterval(poll))
  }

  unbind (): void {
    this.listeners.forEach(fn => { try { fn() } catch (e) { } })
    this.listeners = []
    this.clear()
    this.jmv = null
    this.lastSig = ''
    this.history = []
    this.home = null
    this.extents = []
    this.basemaps = null
    clearTimeout(this.dragTimer)
    this.dragTimer = null
    this.dragCount = 0
  }

  private changed (force: boolean): void {
    this.entriesCache = null
    let sig = ''
    try { sig = this.entries().map(e => e.key + ':' + this.status(e)).join('|') + '#' + (this.bridge?.widgetId || '') } catch (e) { }
    if (force || sig !== this.lastSig) {
      this.lastSig = sig
      try { this.onLayersChanged?.() } catch (e) { }
    }
  }

  private bump (): void {
    this.dragCount++
    if (!this.dragTimer) this.dragTimer = setTimeout(() => { this.dragCount = 0; this.dragTimer = null }, 25000)
    if (this.dragCount >= 10) { this.dragCount = 0; try { this.onBusy?.() } catch (e) { } }
  }

  // ------------------------------------------------------------------ the layer tree

  /** Layer tree, top of the list first, groups included, through the layer list when there is one. */
  /** The layer tree is read many times while one request is answered; the same reading is reused for a moment. */
  private entriesCache: { at: number, view: any, sig: string, list: LayerEntry[] } | null = null

  entries (): LayerEntry[] {
    const c = this.entriesCache
    const now = Date.now()
    const map = this.view?.map
    const sig = `${toArr(map?.layers).length}/${toArr(map?.tables).length}/${toArr(map?.allLayers).length}`
    if (c && c.view === this.view && c.sig === sig && now - c.at < 250) return c.list
    const list = this.entriesNow()
    this.entriesCache = { at: now, view: this.view, sig, list }
    return list
  }

  private entriesNow (): LayerEntry[] {
    const b = this.bridge
    if (b) {
      try {
        const entries = this.fromBridge(b)
        const targets = new Set(entries.map(e => this.target(e)))
        return [...entries, ...this.fromMap().filter(e => e.isTable && !targets.has(this.target(e)))]
      } catch (e) { }
    }
    return this.fromMap()
  }

  private fromBridge (b: LayerListBridge): LayerEntry[] {
    return b.items().filter(it => it && it.layer).map(it => {
      const sub = isSublayer(it.layer)
      const owner = sub ? (it.layer.layer || it.ancestors.find((a: any) => a && !isSublayer(a)) || it.layer) : it.layer
      const url = sub ? (it.layer.url || (owner?.url ? `${owner.url}/${it.layer.id}` : undefined)) : this.urlOf(it.layer)
      const isTable = !!it.isTable || !!it.layer.isTable || it.layer.type === 'table'
      return {
        key: it.isGroup ? (it.layer.type === 'map-image' || it.layer.type === 'tile' ? layerKey(it.layer.url, it.title) : 'group:' + flat(it.path)) : layerKey(url, it.rawTitle || it.title),
        title: it.title,
        layer: owner,
        sublayer: sub ? it.layer : undefined,
        isTable,
        isGroup: it.isGroup,
        parentTitle: it.path.split(' > ').slice(-2, -1)[0],
        ancestors: it.ancestors || [],
        path: it.path,
        depth: it.depth,
        exclusive: it.exclusive,
        favorite: it.favorite
      } as LayerEntry
    })
  }

  private urlOf (layer: any): string | undefined {
    if (!layer?.url) return undefined
    return layer.layerId != null && !/\/\d+$/.test(layer.url) ? `${layer.url}/${layer.layerId}` : layer.url
  }

  private fromMap (): LayerEntry[] {
    const map = this.view?.map
    if (!map) return []
    const out: LayerEntry[] = []
    const basemapLayers = new Set<any>()
    try {
      map.basemap?.baseLayers?.forEach((l: any) => basemapLayers.add(l))
      map.basemap?.referenceLayers?.forEach((l: any) => basemapLayers.add(l))
    } catch (e) { }
    const topFirst = (c: any): any[] => toArr(c).slice().reverse()
    const pathOf = (anc: any[], title: string) => [...anc.map(a => a.title).filter(Boolean), title].join(' > ')

    const seen = new Set<any>()
    const walkSub = (s: any, owner: any, anc: any[]) => {
      if (!s || s.listMode === 'hide' || seen.has(s) || anc.length > 30) return
      seen.add(s)
      const title = s.title || s.name || `Layer ${s.id}`
      const url = s.url || (owner.url && s.id != null ? `${owner.url}/${s.id}` : undefined)
      const kids = topFirst(s.sublayers || s.layers)
      const isGroup = kids.length > 0
      out.push({ key: isGroup ? 'group:' + flat(pathOf(anc, title)) : layerKey(url, title), title, layer: owner, sublayer: s, isGroup, parentTitle: anc[anc.length - 1]?.title, ancestors: anc, path: pathOf(anc, title), depth: anc.length })
      if (isGroup && s.listMode !== 'hide-children') kids.forEach(k => walkSub(k, owner, [...anc, s]))
    }
    const walk = (layer: any, anc: any[]) => {
      if (!layer || basemapLayers.has(layer) || layer.listMode === 'hide' || seen.has(layer) || anc.length > 30) return
      seen.add(layer)
      if (layer.type === 'graphics' || String(layer.id || '').startsWith(TAG)) return
      const title = layer.title || layer.id
      const parentTitle = anc[anc.length - 1]?.title
      if (layer.type === 'group') {
        out.push({ key: 'group:' + flat(pathOf(anc, title)), title, layer, isGroup: true, parentTitle, ancestors: anc, path: pathOf(anc, title), depth: anc.length, exclusive: layer.visibilityMode === 'exclusive' })
        if (layer.listMode !== 'hide-children') topFirst(layer.layers).forEach(l => walk(l, [...anc, layer]))
        return
      }
      // Any layer that holds sublayers, at any depth: map image, tile, WMS, KML, subtype group.
      const subs = topFirst(layer.sublayers)
      if (subs.length && layer.type !== 'group') {
        out.push({ key: layerKey(this.urlOf(layer) || layer.url, title), title, layer, isGroup: true, parentTitle, ancestors: anc, path: pathOf(anc, title), depth: anc.length })
        if (layer.listMode !== 'hide-children') subs.forEach(s => walkSub(s, layer, [...anc, layer]))
        // Tables inside a map image service ("subtables").
        toArr(layer.subtables).forEach((t: any) => {
          const tTitle = t.title || `Table ${t.id}`
          out.push({ key: layerKey(t.url || (layer.url ? `${layer.url}/${t.id}` : undefined), tTitle), title: tTitle, layer, sublayer: t, isTable: true, parentTitle: title, ancestors: [...anc, layer], path: pathOf([...anc, layer], tTitle), depth: anc.length + 1 })
        })
        return
      }
      out.push({ key: layerKey(this.urlOf(layer), title), title, layer, parentTitle, ancestors: anc, path: pathOf(anc, title), depth: anc.length })
    }
    topFirst(map.layers).forEach(l => walk(l, []))
    toArr(map.tables).forEach((t: any) => {
      out.push({ key: layerKey(this.urlOf(t), t.title), title: t.title || t.id, layer: t, isTable: true, ancestors: [], path: t.title || t.id, depth: 0 })
    })
    return out
  }

  target (e: LayerEntry): any { return e.sublayer || e.layer }

  children (e: LayerEntry, all?: LayerEntry[]): LayerEntry[] {
    if (!e.isGroup) return []
    const t = this.target(e)
    return (all || this.entries()).filter(x => x.ancestors.length === e.ancestors.length + 1 && x.ancestors[x.ancestors.length - 1] === t)
  }

  isOn (e: LayerEntry): boolean { return e.isTable ? true : !!this.target(e)?.visible }

  hiddenBy (e: LayerEntry): string | null {
    const off = e.ancestors.find(a => a && a.visible === false)
    return off ? (off.title || 'its group') : null
  }

  outOfScale (e: LayerEntry): boolean {
    const scale = this.view?.scale
    if (!scale || e.isTable) return false
    for (const l of [...e.ancestors, this.target(e)]) {
      const min = Number(l?.minScale) || 0
      const max = Number(l?.maxScale) || 0
      if ((min > 0 && scale > min) || (max > 0 && scale < max)) return true
    }
    return false
  }

  /** Drawing right now: on, every group above it on. */
  isVisible (e: LayerEntry): boolean { return this.isOn(e) && !this.hiddenBy(e) }

  /** What Mappy can look inside: a visible layer or table, not a group. */
  canSee (e: LayerEntry): boolean { return !e.isGroup && this.isVisible(e) }

  status (e: LayerEntry): LayerStatus {
    if (!this.isOn(e)) return 'off'
    if (this.hiddenBy(e)) return 'hidden'
    if (this.outOfScale(e)) return 'scale'
    return 'on'
  }

  /** Keys of everything Mappy can see right now (layers plus the groups that are on). */
  seenKeys (): Set<string> {
    return new Set(this.entries().filter(e => this.isVisible(e)).map(e => e.key))
  }

  /** Keys of every row the layer list shows, on or off. */
  listedKeys (): Set<string> {
    return new Set(this.entries().map(e => e.key))
  }

  // ------------------------------------------------------------------ knowledge

  info (e: LayerEntry): LayerInfo {
    const t = this.target(e)
    const fields: FieldInfo[] = toArr(t?.fields).map((f: any) => ({
      name: f.name,
      alias: f.alias,
      type: f.type,
      codes: f.domain?.type === 'coded-value' ? toArr(f.domain.codedValues).map((cv: any) => [cv.code, cv.name]) : undefined
    }))
    return {
      url: t?.url,
      title: e.title,
      isTable: e.isTable,
      geometryType: t?.geometryType,
      description: t?.portalItem?.snippet || t?.description || '',
      copyright: t?.copyright,
      displayField: t?.displayField,
      fields,
      parentTitle: e.parentTitle
    }
  }

  private groupDoc (e: LayerEntry, all: LayerEntry[]): Doc {
    const kids = this.children(e, all)
    const on = kids.filter(k => this.isOn(k)).map(k => k.title)
    return {
      id: 'layer:' + e.key,
      kind: 'layer',
      title: e.title,
      text: `A group of ${kids.length} layer${kids.length === 1 ? '' : 's'}${kids.length ? ': ' + kids.slice(0, 25).map(k => k.title).join(', ') : ''}.${on.length ? ' On now: ' + on.slice(0, 12).join(', ') + '.' : ''}${e.exclusive ? ' Only one of them shows at a time.' : ''}`,
      keys: 'group folder layers ' + kids.map(k => k.title).join(' '),
      where: e.parentTitle ? `in the "${e.parentTitle}" group` : '',
      layer: e.key,
      actions: [{ type: 'reveal', id: e.key, label: 'Show in the layer list' }],
      src: 'live'
    }
  }

  /**
   * Facts about the map. Only layers that are drawing are described in full; a group that is
   * on gets a short fact naming what it holds. Off layers are not described at all.
   */
  docs (): Doc[] {
    const out: Doc[] = []
    const all = this.entries()
    for (const e of all) {
      if (!this.isVisible(e)) continue
      if (e.isGroup) out.push(this.groupDoc(e, all))
      else {
        const d = docsFromLayer({ ...this.info(e), parentTitle: e.parentTitle }, 'live')
        if (d[0]) {
          d[0].id = (e.isTable ? 'table:' : 'layer:') + e.key
          d[0].layer = e.key
          d[0].actions = [{ type: 'zoomLayer', id: e.key, label: 'Zoom to it' }, { type: 'reveal', id: e.key, label: 'Show in the layer list' }]
        }
        d.forEach(x => { x.layer = e.key })
        out.push(...d)
      }
    }
    try {
      toArr(this.view?.map?.bookmarks).forEach((b: any, i: number) => {
        if (!b?.name) return
        out.push({ id: 'bookmark:' + i + ':' + flat(b.name), kind: 'bookmark', title: b.name, text: `A saved place on the map: ${b.name}.`, keys: 'bookmark place', actions: [{ type: 'bookmark', id: String(i), label: 'Go there' }], src: 'live' })
      })
    } catch (e) { }
    try {
      const bm = this.view?.map?.basemap
      if (bm?.title) out.push({ id: 'basemap:live', kind: 'basemap', title: bm.title, text: `The current basemap (background map) is ${bm.title}.`, keys: 'basemap background imagery', src: 'live' })
    } catch (e) { }
    const b = this.bridge
    if (b) {
      try {
        b.presets().forEach(p => out.push({ id: 'preset:' + p.id, kind: 'view', title: p.name, text: `A preset layer view in ${b.label}. It turns a set of layers on and the rest off.`, keys: 'preset layer view saved set', actions: [{ type: 'preset', id: p.id, label: 'Apply it' }], src: 'live' }))
      } catch (e) { }
    }
    return out
  }

  async warmFields (max = 40): Promise<void> {
    const list = this.entries().filter(e => !e.isGroup && this.isVisible(e)).slice(0, max)
    let i = 0
    const next = async (): Promise<void> => {
      const e = list[i++]
      if (!e) return
      try { const t = this.target(e); if (t?.load && !t.loaded) await withTimeout(t.load(), 8000) } catch (err) { }
      return next()
    }
    await Promise.all([next(), next(), next(), next()])
  }

  find (keyOrTitle: string): LayerEntry | null {
    const all = this.entries()
    const k = String(keyOrTitle || '').toLowerCase()
    return all.find(e => e.key === k) ||
      all.find(e => flat(e.path) === flat(keyOrTitle)) ||
      all.find(e => flat(e.title) === flat(keyOrTitle)) ||
      null
  }

  // ------------------------------------------------------------------ switching

  setVisible (e: LayerEntry, on: boolean): ToggleResult {
    this.entriesCache = null
    const t = this.target(e)
    if (!t) return { parents: [], children: [] }
    const b = this.bridge
    if (b) {
      try { return b.setVisible(t, on) } catch (err) { }
    }
    const res: ToggleResult = { parents: [], children: [] }
    const set = (x: any, v: boolean) => { try { if (x && typeof x.visible === 'boolean') x.visible = v } catch (err) { } }
    if (!on) { set(t, false); return res }
    for (const a of e.ancestors) if (a && a.visible === false) { set(a, true); res.parents.push(a.title || 'group') }
    set(t, true)
    if (e.isGroup) {
      const kids = this.children(e)
      if (kids.length && !kids.some(k => this.isOn(k))) {
        for (const k of (t.visibilityMode === 'exclusive' ? kids.slice(0, 1) : kids)) { set(this.target(k), true); res.children.push(k.title) }
      }
    }
    return res
  }

  /** Everything off except this layer (and the groups above it), the way "solo" works in a layer list. */
  solo (e: LayerEntry): { off: number, result: ToggleResult } {
    const all = this.entries()
    const keep = new Set<any>([this.target(e), ...e.ancestors])
    const inside = e.isGroup ? new Set(all.filter(x => x.ancestors.includes(this.target(e))).map(x => this.target(x))) : new Set<any>()
    let off = 0
    for (const x of all) {
      const t = this.target(x)
      if (x.isTable || x.isGroup || keep.has(t) || inside.has(t)) continue
      if (this.isOn(x)) { this.setVisible(x, false); off++ }
    }
    return { off, result: this.setVisible(e, true) }
  }

  /** Turns off every layer the list shows (groups keep their own box). */
  allOff (): number {
    let n = 0
    for (const x of this.entries()) {
      if (x.isTable || x.isGroup) continue
      if (this.isOn(x)) { this.setVisible(x, false); n++ }
    }
    return n
  }

  /** Layers "turn everything on" would switch on: off layers outside pick-one groups. */
  allOnCandidates (): LayerEntry[] {
    return this.entries().filter(x => !x.isTable && !x.isGroup && !this.isOn(x) && !x.ancestors.some((a: any) => a?.visibilityMode === 'exclusive'))
  }

  /** Turns on every layer the list shows (and the groups above them), skipping pick-one groups. */
  allOn (): number {
    let n = 0
    for (const x of this.allOnCandidates()) { this.setVisible(x, true); n++ }
    return n
  }

  /** Shows the row in the layer list (opens the groups above it and flashes it). */
  reveal (e: LayerEntry): boolean {
    const b = this.bridge
    if (!b) return false
    try { return b.reveal(this.target(e)) } catch (err) { return false }
  }

  setOpacity (e: LayerEntry, pct: number): void {
    const t = this.target(e)
    try { if (t) t.opacity = Math.max(0, Math.min(1, pct / 100)) } catch (err) { }
  }

  // ------------------------------------------------------------------ navigation

  async zoomTo (e: LayerEntry): Promise<boolean> {
    const ok = await this.zoomExtent(e)
    if (ok && this.outOfScale(e)) await this.fitScale(e)
    return ok
  }

  private async zoomExtent (e: LayerEntry): Promise<boolean> {
    const view = this.view
    const t = this.target(e)
    if (!view || !t) return false
    try {
      if (!e.isGroup && typeof t.queryExtent === 'function') {
        const r = await withTimeout(t.queryExtent({ where: t.definitionExpression || '1=1', outSpatialReference: view.spatialReference }), 10000)
        if (r?.extent && r.count !== 0) { await this.go(r.extent.expand ? r.extent.expand(1.15) : r.extent); await this.backOffTo(SCALE.layerMin); return true }
      }
    } catch (err) { }
    try {
      if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
      const ext = t.fullExtent || e.layer.fullExtent
      if (ext) { await this.go(ext); await this.backOffTo(SCALE.layerMin); return true }
    } catch (err) { }
    return false
  }

  /** Moves to the nearest scale where the layer and its groups draw. */
  async fitScale (e: LayerEntry): Promise<void> {
    const view = this.view
    if (!view) return
    let lo = 0
    let hi = Infinity
    for (const l of [...e.ancestors, this.target(e)]) {
      const min = Number(l?.minScale) || 0
      const max = Number(l?.maxScale) || 0
      if (min > 0) hi = Math.min(hi, min)
      if (max > 0) lo = Math.max(lo, max)
    }
    const scale = view.scale
    let next = scale
    if (scale > hi) next = hi * 0.8
    else if (scale < lo) next = lo * 1.25
    if (next !== scale && isFinite(next)) { try { await this.go({ scale: next }, 500) } catch (err) { } }
  }

  async count (e: LayerEntry, inView: boolean): Promise<number | null> {
    const t = this.target(e)
    if (!t || e.isGroup || typeof t.queryFeatureCount !== 'function') return null
    try {
      const q: any = { where: t.definitionExpression || '1=1' }
      if (inView && this.view?.extent) q.geometry = this.view.extent
      return await withTimeout(t.queryFeatureCount(q), 12000)
    } catch (err) { return null }
  }

  /**
   * Feature search across the layers Mappy can see (visible in the layer list), with LIKE on
   * their best string fields. A group as the scope searches the visible layers inside it.
   */
  async search (term: string, opts: { scope?: LayerEntry | null, hints?: Map<string, LayerHint>, max: number }): Promise<FeatureResult[]> {
    const view = this.view
    if (!view) return []
    const all = this.entries()
    let entries: LayerEntry[]
    if (opts.scope) {
      const st = this.target(opts.scope)
      entries = opts.scope.isGroup ? all.filter(x => !x.isGroup && x.ancestors.includes(st)) : [opts.scope]
    } else entries = all.filter(e => !e.isTable && !e.isGroup)
    entries = entries.filter(e => this.canSee(e))
    let words = term
    if (!opts.scope) {
      const tt = tokenize(term)
      const scoped = entries.filter(e => tokenize(e.title).some(w => tt.includes(w)))
      if (scoped.length && tt.length > 1) {
        const titleWords = new Set(scoped.flatMap(e => tokenize(e.title)))
        const rest = term.split(/\s+/).filter(w => !titleWords.has(tokenize(w)[0] || '')).join(' ').trim()
        if (rest.length >= 2) { entries = scoped; words = rest }
      }
    }
    const needle = words.toUpperCase().replace(/'/g, "''").trim()
    if (needle.length < 2 && !/^\d$/.test(needle)) return []
    entries = entries.sort((a, b) => Number(!this.outOfScale(b)) - Number(!this.outOfScale(a))).slice(0, 16)
    const jobs = entries.map(async (e): Promise<FeatureResult[]> => {
      const t = this.target(e)
      if (!t || typeof t.queryFeatures !== 'function') return []
      try { if (t.load && !t.loaded) await withTimeout(t.load(), 8000) } catch (err) { return [] }
      const hint = opts.hints?.get(e.key)
      const fields: FieldInfo[] = toArr(t.fields).map((f: any) => ({ name: f.name, alias: f.alias, type: f.type }))
      const candidates = hint?.searchFields?.length ? hint.searchFields : pickSearchFields(fields, t.displayField)
      const searchFields = candidates.filter(name => /^[a-z_][a-z0-9_.]*$/i.test(name) && fields.some(f => f.name === name && /^(string|esriFieldTypeString)$/i.test(f.type || '')))
      const numeric = /^\d+$/.test(words.trim()) ? fields.filter(f => /^(?:oid|integer|small-integer|big-integer|esriFieldType(?:OID|Integer|SmallInteger|BigInteger))$/i.test(f.type || '') && /^[a-z_][a-z0-9_.]*$/i.test(f.name) && (f.name === t.objectIdField || /(^|_)(id|number|no)($|_)/i.test(f.name))) : []
      if (!searchFields.length && !numeric.length) return []
      const where = [...searchFields.map(f => `UPPER(${f}) LIKE '%${needle}%'`), ...numeric.map(f => `${f.name} = ${words.trim()}`)].join(' OR ')
      const display = t.displayField || hint?.displayField || searchFields[0] || numeric[0]?.name
      try {
        const fs = await withTimeout(t.queryFeatures({
          where: t.definitionExpression ? `(${t.definitionExpression}) AND (${where})` : where,
          outFields: Array.from(new Set([display, ...searchFields, t.objectIdField].filter(Boolean))),
          returnGeometry: true,
          outSpatialReference: view.spatialReference,
          num: opts.max
        }), 10000)
        return toArr(fs?.features).map((g: any) => {
          const a = g.attributes || {}
          const label = String(a[display] ?? searchFields.map(f => a[f]).find(v => v != null && v !== '') ?? 'Feature')
          const hit = searchFields.find(f => a[f] != null && String(a[f]).toUpperCase().includes(needle))
          const detail = hit && hit !== display ? `${fieldLabel(fields.find(f => f.name === hit) || { name: hit })}: ${a[hit]}` : ''
          return { entry: e, graphic: g, label, detail }
        })
      } catch (err) { return [] }
    })
    const flatList = (await Promise.all(jobs)).flat()
    flatList.sort((a, b) => Number(b.label.toUpperCase() === needle) - Number(a.label.toUpperCase() === needle))
    return flatList.slice(0, opts.max)
  }

  /** Off layers whose name matches, for "turn it on and I'll look" hints. */
  offMatches (term: string): LayerEntry[] {
    const tt = tokenize(term)
    return this.entries().filter(e => !e.isGroup && !this.canSee(e) && tokenize(e.title).some(w => tt.includes(w))).slice(0, 3)
  }

  async show (r: FeatureResult): Promise<void> {
    const view = this.view
    if (!view || !r.graphic?.geometry) return
    if (!this.entries().some(e => this.target(e) === this.target(r.entry))) return
    this.clear()
    const g = r.graphic
    const isPoint = /point/i.test(g.geometry.type || '')
    // A point: a block around it, closer only if the map already was. An area: the feature with room around it, never closer than a few houses.
    try {
      if (isPoint) await this.go({ target: g.geometry, scale: Math.min(view.scale || SCALE.feature, SCALE.feature) })
      else { const ext = g.geometry.extent; await this.go(ext?.expand ? ext.expand(1.6) : { target: g.geometry }); await this.backOffTo(SCALE.closest) }
    } catch (e) { }
    if (view !== this.view) return
    await this.highlight(r)
    try {
      if (typeof view.openPopup === 'function') {
        if (!r.graphic.layer && !r.entry.sublayer) r.graphic.layer = r.entry.layer
        view.openPopup({ features: [r.graphic], location: isPoint ? g.geometry : (g.geometry.extent?.center || undefined) })
      }
    } catch (e) { }
  }

  async showAddress (location: any): Promise<boolean> {
    const view = this.view
    if (!view || !location || !Number.isFinite(location.x) || !Number.isFinite(location.y)) return false
    try {
      const [Graphic] = await loadArcGISJSAPIModules(['esri/Graphic'])
      if (view !== this.view) return false
      await this.go({ target: location, scale: SCALE.address })
      if (view !== this.view) return false
      this.clear()
      const marker = new Graphic({ geometry: location, attributes: { [TAG]: true }, symbol: { type: 'simple-marker', size: 16, color: HIGHLIGHT_RGB, outline: { color: 'white', width: 2 } } })
      view.graphics.add(marker)
      this.highlightHandles.push({ remove: () => { try { view.graphics.remove(marker) } catch (e) { } } })
      return true
    } catch (e) { return false }
  }

  /**
   * The app's layer for a name a server used ("Sanitary Sewer Mains", "Water - Fire Hydrants"):
   * the same title, else the closest title by words. Feature layers before groups and tables.
   */
  matchTitle (name: string, serverPath?: string): LayerEntry | null {
    const stem = (w: string) => w.toLowerCase().replace(/ies$/, 'y').replace(/(ch|sh|ss|x)es$/, '$1').replace(/([^s])s$/, '$1')
    const words = (t: string) => flat(t).split(' ').filter(w => w.length > 1).map(stem)
    const all = this.entries().filter(e => !e.isTable)
    const leaves = all.filter(e => !e.isGroup)
    // Groups and service above the layer on the server ("Utility > Storm > Manholes").
    const context = words([serverPath || '', name].join(' '))
    const near = (e: LayerEntry) => { const p = words(e.path); return context.filter(w => p.includes(w)).length }
    const best = (list: LayerEntry[]) => list.slice().sort((a, b) => near(b) - near(a) || a.depth - b.depth)[0] || null
    // The same title: the full name, then the name without the group the server added ("Storm - Manholes").
    const base = String(name).split(' - ').pop() || name
    for (const t of [name, base]) {
      const same = leaves.filter(e => flat(e.title) === flat(t))
      if (same.length) return best(same)
    }
    const byPath = this.find(name)
    if (byPath && !byPath.isTable) return byPath
    const want = words(base)
    if (!want.length) return null
    let pick: LayerEntry | null = null; let score = 0
    for (const e of all) {
      const have = words(e.title)
      // Other forms of one word: "zone" is the Zoning layer, "limit" the City Limits boundary.
      // Count the title's words that were matched, once each ("sanitary sewer" is one sewer).
      const hit = new Set(want.map(w => have.includes(w) ? w : (FORMS[w] || []).find(f => have.includes(f))).filter(Boolean)).size
      if (!hit) continue
      const s = hit / want.length + hit / Math.max(have.length, 1) * 0.5 - (e.isGroup ? 0.3 : 0) + near(e) * 0.05
      if (s > score) { pick = e; score = s }
    }
    return score >= 0.75 ? pick : null
  }

  /**
   * The feature of a layer at a spot: the parcel under an address point, the city limits or
   * flood zone around it. The spot is a map point, or [latitude, longitude].
   */
  async featureAt (e: LayerEntry, at: any, strict = false): Promise<any | null> {
    const view = this.view
    const t = this.target(e)
    if (!view || !t || typeof t.queryFeatures !== 'function') { if (strict) throw new Error('This layer cannot be queried.'); return null }
    try {
      if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
      // Plain JSON autocasts to a Point in the query; WGS84 is projected by the server.
      const geometry = Array.isArray(at) ? { type: 'point', x: at[1], y: at[0], spatialReference: { wkid: 4326 } } : at
      const polygon = /polygon/i.test(String(t.geometryType || ''))
      const fs = await withTimeout(t.queryFeatures({
        geometry,
        spatialRelationship: 'intersects',
        ...(polygon ? {} : { distance: 15, units: 'feet' }),
        where: t.definitionExpression || '1=1',
        outFields: ['*'],
        returnGeometry: true,
        outSpatialReference: view.spatialReference,
        num: 1
      }), 10000)
      return toArr(fs?.features)[0] || null
    } catch (err) { if (strict) throw err; return null }
  }

  /**
   * Features of a layer within `feet` of a spot ([latitude, longitude] or a point), nearest first
   * with the distance in feet to each one's closest vertex. Up to `limit`. Throws when the layer
   * cannot be queried, so the caller can say so.
   */
  async near (e: LayerEntry, at: [number, number] | any, feet: number, limit = 10): Promise<Array<{ graphic: any, feet: number, latLon: [number, number] }>> {
    const view = this.view
    const t = this.target(e)
    if (!view || !t || typeof t.queryFeatures !== 'function') throw new Error('This layer cannot be queried.')
    if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
    const origin: [number, number] | null = Array.isArray(at) ? [Number(at[0]), Number(at[1])] : toLatLon(at)
    if (!origin) throw new Error('I could not read that spot.')
    const geometry = { type: 'point', x: origin[1], y: origin[0], spatialReference: { wkid: 4326 } }
    const fs = await withTimeout(t.queryFeatures({
      geometry, spatialRelationship: 'intersects', distance: Math.max(1, feet), units: 'feet',
      where: t.definitionExpression || '1=1', outFields: ['*'], returnGeometry: true, outSpatialReference: { wkid: 4326 }, num: Math.max(limit * 4, 40)
    }), 12000)
    const out: Array<{ graphic: any, feet: number, latLon: [number, number] }> = []
    for (const g of toArr(fs?.features)) {
      const near = nearestVertex(g.geometry, origin)
      if (!near) continue
      out.push({ graphic: g, feet: near.feet, latLon: near.latLon })
    }
    out.sort((a, b) => a.feet - b.feet)
    return out.slice(0, limit)
  }

  /** The parcel layers in this map, best first: one named Parcels, polygons, ones already on. */
  parcelLayers (): LayerEntry[] {
    const rank = (e: LayerEntry) => {
      const t = this.target(e)
      return (/^(tax )?parcels?$/i.test(e.title.trim()) ? 0 : 4) + (/polygon/i.test(String(t?.geometryType || 'polygon')) ? 0 : 2) + (this.isVisible(e) ? 0 : 1)
    }
    return this.entries().filter(e => !e.isGroup && !e.isTable && /parcel|tax lots?|property/i.test(e.title) && !/annotation|label|line|dimension|point/i.test(e.title))
      .sort((a, b) => rank(a) - rank(b))
  }

  /** A pin at an address, kept with other highlights (not clearing them). */
  // ------------------------------------------------------------------ filters, pans, rotation

  /** What Mappy filtered a layer to (the author's own filter, if any, is kept underneath and restored). */
  private filters = new Map<any, { base: string, where: string, said: string }>()

  /** Shows only the features matching `where` on the map, on top of the author's own filter. */
  setFilter (e: LayerEntry, where: string, said: string): boolean {
    const t = this.target(e)
    if (!t || (!('definitionExpression' in t) && typeof t.queryFeatures !== 'function')) return false
    const had = this.filters.get(t)
    const base = had ? had.base : (t.definitionExpression || '')
    try { t.definitionExpression = base ? `(${base}) AND (${where})` : where } catch (err) { return false }
    this.filters.set(t, { base, where, said })
    this.entriesCache = null
    return true
  }

  /** Back to everything the author showed. True when there was a filter to clear. */
  clearFilter (e: LayerEntry): boolean {
    const t = this.target(e)
    const had = t ? this.filters.get(t) : null
    if (!t || !had) return false
    try { t.definitionExpression = had.base || null } catch (err) { }
    this.filters.delete(t)
    return true
  }

  /** The layers Mappy is filtering right now, with what each shows. */
  filtered (): Array<{ entry: LayerEntry, said: string }> {
    const out: Array<{ entry: LayerEntry, said: string }> = []
    for (const e of this.entries()) { const f = this.filters.get(this.target(e)); if (f) out.push({ entry: e, said: f.said }) }
    return out
  }

  /** Moves the view a third of the screen in a compass direction. */
  async pan (dir: 'north' | 'south' | 'east' | 'west'): Promise<boolean> {
    const view = this.view
    const ext = view?.extent
    if (!ext) return false
    try {
      const dx = (ext.xmax - ext.xmin) / 3; const dy = (ext.ymax - ext.ymin) / 3
      const c = view.center.clone ? view.center.clone() : { ...view.center }
      c.x += dir === 'east' ? dx : dir === 'west' ? -dx : 0
      c.y += dir === 'north' ? dy : dir === 'south' ? -dy : 0
      await this.go({ center: c }, 500)
      return true
    } catch (e) { return false }
  }

  /** Turns the map: north up (0), or by `degrees` from where it is. */
  async rotate (degrees: number | 'north'): Promise<boolean> {
    const view = this.view
    if (!view) return false
    try { await this.go({ rotation: degrees === 'north' ? 0 : ((Number(view.rotation) || 0) + degrees) % 360 }, 500); return true } catch (e) { return false }
  }

  /** The area the map shows right now, in square miles (from the extent in latitude and longitude). */
  viewAreaSqMiles (): number | null {
    const ext = this.view?.extent
    if (!ext) return null
    const a = toLatLon({ x: ext.xmin, y: ext.ymin, spatialReference: ext.spatialReference || this.view.spatialReference })
    const b = toLatLon({ x: ext.xmax, y: ext.ymax, spatialReference: ext.spatialReference || this.view.spatialReference })
    if (!a || !b) return null
    const w = feetBetween([a[0], a[1]], [a[0], b[1]]); const h = feetBetween([a[0], a[1]], [b[0], a[1]])
    return (w * h) / (5280 * 5280)
  }

  /** The current viewpoint, to come back to ("save this view as home base"). */
  viewpoint (): any | null { try { return this.view?.viewpoint?.clone?.() || this.view?.viewpoint?.toJSON?.() || null } catch (e) { return null } }

  /** Back to a saved viewpoint (a Viewpoint, or its JSON). */
  async goViewpoint (vp: any): Promise<boolean> {
    if (!vp || !this.view) return false
    try {
      let target = vp
      if (!vp.clone && (vp.targetGeometry || vp.scale)) { const [Viewpoint] = await loadArcGISJSAPIModules(['esri/Viewpoint']); target = Viewpoint.fromJSON(vp) }
      await this.go(target)
      return true
    } catch (e) { return false }
  }

  async pin (location: any): Promise<void> {
    const view = this.view
    if (!view || !location) return
    try {
      const [Graphic] = await loadArcGISJSAPIModules(['esri/Graphic'])
      const marker = new Graphic({ geometry: location, attributes: { [TAG]: true }, symbol: { type: 'simple-marker', size: 14, color: [0, 92, 230], outline: { color: 'white', width: 2 } } })
      view.graphics.add(marker)
      this.highlightHandles.push({ remove: () => { try { view.graphics.remove(marker) } catch (e) { } } })
    } catch (e) { }
  }

  /**
   * Shows a server's answer on the map: a pin at the place asked about, rings on the features
   * found, a dashed line to the closest one, and a zoom that fits them. Points are
   * [latitude, longitude]. Cleared like other Mappy highlights.
   */
  async showPlaces (origin: [number, number] | null, spots: Array<[number, number]>, opts: { line?: boolean, rings?: number[][][] } = {}): Promise<boolean> {
    const view = this.view
    if (!view || (!origin && !spots.length)) return false
    try {
      const [Graphic, Point, Polyline, Polygon] = await loadArcGISJSAPIModules(['esri/Graphic', 'esri/geometry/Point', 'esri/geometry/Polyline', 'esri/geometry/Polygon'])
      if (view !== this.view) return false
      const sr = view.spatialReference
      const flatEarth = !sr || sr.isWGS84 || sr.isWebMercator || [4326, 102100, 3857, 102113].includes(sr.wkid)
      let project = (g: any) => g
      if (!flatEarth) {
        // A local coordinate system (state plane): project from WGS84 first.
        try {
          const [op] = await loadArcGISJSAPIModules(['esri/geometry/operators/projectOperator'])
          if (!op.isLoaded()) await op.load()
          project = (g: any) => op.execute(g, sr)
        } catch (e) {
          try {
            const [projection] = await loadArcGISJSAPIModules(['esri/geometry/projection'])
            await projection.load()
            project = (g: any) => projection.project(g, sr)
          } catch (e2) { return false }
        }
      }
      const pt = (ll: [number, number]) => project(new Point({ latitude: ll[0], longitude: ll[1] }))
      this.clear()
      const add = (geometry: any, symbol: any) => {
        const g = new Graphic({ geometry, symbol, attributes: { [TAG]: true } })
        view.graphics.add(g)
        this.highlightHandles.push({ remove: () => { try { view.graphics.remove(g) } catch (e) { } } })
        return g
      }
      const marks: any[] = []
      // An area answered about (the parcel for "who owns it"): outline it and fit it.
      if (opts.rings?.length) {
        marks.push(add(project(new Polygon({ rings: opts.rings, spatialReference: { wkid: 4326 } })),
          { type: 'simple-fill', color: [...HIGHLIGHT_RGB, 0.12], outline: { color: HIGHLIGHT_RGB, width: 3 } }))
      }
      if (origin && opts.line && spots[0]) {
        add(project(new Polyline({ paths: [[[origin[1], origin[0]], [spots[0][1], spots[0][0]]]], spatialReference: { wkid: 4326 } })),
          { type: 'simple-line', style: 'short-dash', color: HIGHLIGHT_RGB, width: 2 })
      }
      spots.slice(0, 25).forEach((s, i) => {
        marks.push(add(pt(s), { type: 'simple-marker', style: 'circle', size: i === 0 ? 22 : 16, color: [0, 0, 0, 0], outline: { color: HIGHLIGHT_RGB, width: i === 0 ? 3 : 2 } }))
      })
      if (origin) marks.push(add(pt(origin), { type: 'simple-marker', style: 'circle', size: 12, color: [0, 92, 230], outline: { color: 'white', width: 2 } }))
      const targets = marks.map(m => m.geometry)
      const single = targets.length === 1
      await this.go(single ? { target: targets[0], scale: SCALE.place } : targets)
      // Several pins: a little room around them, and never closer than a few houses.
      if (!single) { await this.backOffTo(SCALE.closest); if (view.scale) await this.go({ scale: view.scale * 1.3 }, 250) }
      return true
    } catch (e) { return false }
  }

  private async highlight (r: FeatureResult): Promise<void> {
    const view = this.view
    try {
      if (!r.entry.sublayer) {
        const lv = await withTimeout(view.whenLayerView(r.entry.layer), 6000)
        if (lv?.highlight) { this.highlightHandles.push(lv.highlight(r.graphic)); return }
      }
    } catch (e) { }
    try {
      const [Graphic] = await loadArcGISJSAPIModules(['esri/Graphic'])
      const type = String(r.graphic.geometry.type || '')
      const symbol = /point/.test(type)
        ? { type: 'simple-marker', style: 'circle', size: 20, color: [0, 0, 0, 0], outline: { color: HIGHLIGHT_RGB, width: 3 } }
        : /polyline/.test(type)
          ? { type: 'simple-line', color: HIGHLIGHT_RGB, width: 4 }
          : { type: 'simple-fill', color: [...HIGHLIGHT_RGB, 0.15], outline: { color: HIGHLIGHT_RGB, width: 3 } }
      const g = new Graphic({ geometry: r.graphic.geometry, symbol, attributes: { [TAG]: true } })
      view.graphics.add(g)
      this.highlightHandles.push({ remove: () => { try { view.graphics.remove(g) } catch (e) { } } })
    } catch (e) { }
  }

  clear (): void {
    this.highlightHandles.forEach(h => { try { h?.remove?.() } catch (e) { } })
    this.highlightHandles = []
  }

  async goHome (): Promise<void> {
    const view = this.view
    if (!view) return
    try {
      const vp = this.home || view.map?.initialViewProperties?.viewpoint
      if (vp) await this.go(vp)
    } catch (e) { }
  }

  /** Back to where the map was before the last move. False when there is nowhere to go. */
  async goBack (): Promise<boolean> {
    const view = this.view
    if (!view || this.extents.length < 2) return false
    this.extents.pop()
    const prev = this.extents[this.extents.length - 1]
    this.goingBack = true
    try { await this.go(prev, 500); return true } catch (e) { this.goingBack = false; return false } finally { setTimeout(() => { this.goingBack = false }, 2500) }
  }

  /** The basemaps the app's portal offers, by title. */
  async listBasemaps (): Promise<Array<{ title: string, id: string }>> {
    if (this.basemaps) return this.basemaps.map(b => ({ title: b.title, id: b.id }))
    try {
      const [Portal] = await loadArcGISJSAPIModules(['esri/portal/Portal'])
      const portal = this.view?.map?.portalItem?.portal || Portal.getDefault()
      await withTimeout(portal.load(), 8000)
      const list = await withTimeout(portal.fetchBasemaps(), 10000)
      const found = toArr(list).filter((b: any) => b?.title)
      if (found.length) this.basemaps = found
      return found.map((b: any) => ({ title: b.title, id: b.id }))
    } catch (e) { return [] }
  }

  /** Switch the background to the basemap whose name has these words ("imagery", "topo"). */
  async setBasemap (words: string): Promise<{ title: string } | null> {
    const view = this.view
    if (!view?.map) return null
    const want = flat(words).replace(/\b(?:view|map|basemap|background|the|to|a)\b/g, ' ').trim().split(/\s+/).filter(Boolean)
    const SYN: { [k: string]: string[] } = { satellite: ['imagery', 'aerial', 'satellite', 'hybrid'], aerial: ['imagery', 'aerial', 'satellite', 'hybrid'], imagery: ['imagery', 'aerial', 'satellite', 'hybrid'], street: ['streets', 'street', 'navigation', 'road'], streets: ['streets', 'street', 'navigation', 'road'], topo: ['topographic', 'topo', 'terrain'], terrain: ['topographic', 'topo', 'terrain', 'hillshade'], gray: ['gray', 'grey', 'light'], grey: ['gray', 'grey', 'light'], dark: ['dark', 'night'], plain: ['gray', 'grey', 'light', 'canvas'] }
    const wants = want.flatMap(w => SYN[w] || [w])
    const all = await this.listBasemaps()
    const score = (title: string) => { const t = flat(title); return wants.filter(w => t.includes(w)).length + (/label|hybrid/.test(t) && wants.includes('imagery') ? 0.5 : 0) }
    const best = all.map(b => ({ b, s: score(b.title) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)[0]
    if (!best) return null
    const bm = (this.basemaps || []).find(b => b.id === best.b.id)
    try { view.map.basemap = bm; return { title: best.b.title } } catch (e) { return null }
  }

  async zoom (dir: 'in' | 'out', steps = 1): Promise<void> {
    const view = this.view
    if (!view) return
    // By scale, not zoom level: zoom levels do not exist on maps in a local coordinate system. Each step halves or doubles.
    const factor = Math.pow(2, Math.max(0.25, Math.min(6, steps)))
    try { if (view.scale) await this.go({ scale: Math.max(100, dir === 'in' ? view.scale / factor : view.scale * factor) }, 400) } catch (e) { }
  }

  async goBookmark (index: number): Promise<boolean> {
    try {
      const b = toArr(this.view?.map?.bookmarks)[index]
      if (b?.viewpoint) { await this.go(b.viewpoint); return true }
      if (b?.extent) { await this.go(b.extent); return true }
    } catch (e) { }
    return false
  }

  /** Zooms to the feature whose popup is open. False when there is none. */
  async zoomToSelected (): Promise<boolean> {
    try {
      const f = this.view?.popup?.selectedFeature
      if (!f?.geometry) return false
      if (f.geometry.type === 'point') await this.go({ target: f.geometry, scale: Math.min(this.view.scale || SCALE.feature, SCALE.feature) })
      else { const ext = f.geometry.extent; await this.go(ext?.expand ? ext.expand(1.6) : f.geometry); await this.backOffTo(SCALE.closest) }
      return true
    } catch (e) { return false }
  }

  /** The basemap's title, when the map has one. */
  basemapTitle (): string { try { return String(this.view?.map?.basemap?.title || '') } catch (e) { return '' } }

  whereAmI (): string {
    const view = this.view
    if (!view?.center) return ''
    const c = view.center
    const scale = view.scale ? `1:${Math.round(view.scale).toLocaleString()}` : ''
    if (c.latitude != null && c.longitude != null) {
      return `The map is centered at ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)} (lat, long)${scale ? ', scale ' + scale : ''}.`
    }
    return `The map is centered at x ${Math.round(c.x)}, y ${Math.round(c.y)} (wkid ${c.spatialReference?.wkid ?? '?'})${scale ? ', scale ' + scale : ''}.`
  }

  /** The map's element, for Mappy to point at. */
  mapElement (): HTMLElement | null {
    try { return this.view?.container || null } catch (e) { return null }
  }
}

export function withTimeout (p: any, ms: number): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Word forms a layer title may use instead of the word asked ("what zone" -> Zoning). */
const FORMS: { [k: string]: string[] } = {
  zone: ['zoning'], zoning: ['zone'], zoned: ['zoning', 'zone'],
  limit: ['boundary', 'limits'], boundary: ['limit', 'limits'], city: ['municipal', 'municipality'],
  owner: ['parcel', 'ownership'], lot: ['parcel'], property: ['parcel'],
  floodplain: ['flood'], fema: ['flood'], sewer: ['sanitary'], sanitary: ['sewer'], storm: ['stormwater', 'drainage'],
  school: ['attendance'], trash: ['refuse', 'garbage', 'solid'], garbage: ['trash', 'refuse'], recycle: ['recycling'], recycling: ['recycle']
}

/** Feet between two [latitude, longitude] points (haversine). */
export function feetBetween (a: [number, number], b: [number, number]): number {
  const R = 20902231 // feet
  const dLat = (b[0] - a[0]) * Math.PI / 180; const dLon = (b[1] - a[1]) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The closest vertex of a WGS84 geometry to a spot, with the distance in feet. Inside a polygon counts as 0. */
export function nearestVertex (geometry: any, origin: [number, number]): { feet: number, latLon: [number, number] } | null {
  if (!geometry) return null
  const pts: Array<[number, number]> = []
  if (Number.isFinite(geometry.latitude) && Number.isFinite(geometry.longitude)) pts.push([geometry.latitude, geometry.longitude])
  else if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) pts.push([geometry.y, geometry.x])
  for (const part of toArr(geometry.paths).concat(toArr(geometry.rings))) for (const v of toArr(part)) if (Array.isArray(v) && v.length >= 2) pts.push([v[1], v[0]])
  for (const v of toArr(geometry.points)) if (Array.isArray(v)) pts.push([v[1], v[0]])
  if (!pts.length) return null
  let best: { feet: number, latLon: [number, number] } | null = null
  for (const p of pts) { const f = feetBetween(origin, p); if (!best || f < best.feet) best = { feet: f, latLon: p } }
  if (best && toArr(geometry.rings).length && insideRings(geometry.rings, origin)) best = { feet: 0, latLon: origin }
  return best
}

function insideRings (rings: any, origin: [number, number]): boolean {
  let inside = false
  for (const ring of toArr(rings)) {
    const r = toArr(ring)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0]; const yi = r[i][1]; const xj = r[j][0]; const yj = r[j][1]
      if (((yi > origin[0]) !== (yj > origin[0])) && (origin[1] < (xj - xi) * (origin[0] - yi) / (yj - yi) + xi)) inside = !inside
    }
  }
  return inside
}
