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
import type { JimuMapView } from 'jimu-arcgis'
import type { Doc, LayerHint } from '../brain/types'
import { docsFromLayer, pickSearchFields } from '../brain/layers'
import type { FieldInfo, LayerInfo } from '../brain/layers'
import { layerKey, flat, tokenize } from '../brain/text'
import { findBridge, onBridgeChange } from './layerList'
import type { LayerListBridge } from './layerList'

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
  layers: Array<{ target: any, visible: boolean, opacity: number }>
}

const TAG = '__mappy'
const HIGHLIGHT_RGB = [230, 119, 0]
const toArr = (c: any): any[] => { try { return c ? (c.toArray ? c.toArray() : Array.isArray(c) ? c : Array.from(c)) : [] } catch (e) { return [] } }
const isSublayer = (l: any): boolean => !!l && (l.declaredClass === 'esri.layers.support.Sublayer' || (l.layer && l.id != null && typeof l.layer === 'object' && !l.layers))

export class LiveMap {
  private history: Array<{ label: string, changes: Array<{ target: any, prop: string, before: any, after: any }> }> = []

  snapshot (): MapSnapshot {
    return { view: this.view, layers: this.entries().map(e => { const target = this.target(e); return { target, visible: target.visible, opacity: target.opacity } }) }
  }

  remember (before: MapSnapshot, label: string): boolean {
    if (before.view !== this.view) return false
    const changes: Array<{ target: any, prop: string, before: any, after: any }> = []
    for (const item of before.layers) for (const prop of ['visible', 'opacity']) {
      if (item[prop as 'visible' | 'opacity'] !== item.target[prop]) changes.push({ target: item.target, prop, before: item[prop as 'visible' | 'opacity'], after: item.target[prop] })
    }
    if (!changes.length) return false
    this.history.push({ label, changes })
    this.history = this.history.slice(-20)
    return true
  }

  undo (): string {
    const item = this.history.pop()
    if (!item) return 'There are no Mappy layer changes to undo on this map.'
    const current = new Set(this.entries().map(e => this.target(e)))
    let restored = 0
    for (const change of item.changes) {
      // Do not overwrite changes made later by another widget or by the user.
      if (current.has(change.target) && change.target[change.prop] === change.after) {
        try { change.target[change.prop] = change.before; restored++ } catch (e) { }
      }
    }
    this.changed(true)
    return restored ? `Undid ${item.label}.${restored < item.changes.length ? ' Later changes made outside Mappy were kept.' : ''}` : 'Nothing restored: these layers were removed or changed outside Mappy.'
  }
  jmv: JimuMapView | null = null
  private home: any = null
  private highlightHandles: any[] = []
  private listeners: Array<() => void> = []
  private dragCount = 0
  private dragTimer: any = null
  private lastSig = ''
  onBusy: (() => void) | null = null
  /** Layers added, removed, switched, or a layer list appeared: Mappy rebuilds what he sees. */
  onLayersChanged: (() => void) | null = null

  get view (): any { return this.jmv?.view || null }
  get ready (): boolean { return !!this.view }
  /** The layer list Mappy works through, when one publishes the bridge for this map. */
  get bridge (): LayerListBridge | null { return findBridge(this.view) }

  bind (jmv: JimuMapView | null): void {
    this.unbind()
    this.jmv = jmv
    const view = this.view
    if (!view) return
    try { view.when?.(() => { try { this.home = view.viewpoint?.clone?.() || null } catch (e) { } }) } catch (e) { }
    try {
      const h1 = view.on('drag', (evt: any) => { if (evt?.action === 'end') this.bump() })
      const h2 = view.on('mouse-wheel', () => this.bump())
      this.listeners.push(() => h1?.remove?.(), () => h2?.remove?.())
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
    clearTimeout(this.dragTimer)
    this.dragTimer = null
    this.dragCount = 0
  }

  private changed (force: boolean): void {
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
  entries (): LayerEntry[] {
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

    const walkSub = (s: any, owner: any, anc: any[]) => {
      if (!s || s.listMode === 'hide') return
      const title = s.title || `Layer ${s.id}`
      const url = s.url || (owner.url ? `${owner.url}/${s.id}` : undefined)
      const kids = topFirst(s.sublayers)
      const isGroup = kids.length > 0
      out.push({ key: isGroup ? 'group:' + flat(pathOf(anc, title)) : layerKey(url, title), title, layer: owner, sublayer: s, isGroup, parentTitle: anc[anc.length - 1]?.title, ancestors: anc, path: pathOf(anc, title), depth: anc.length })
      if (isGroup && s.listMode !== 'hide-children') kids.forEach(k => walkSub(k, owner, [...anc, s]))
    }
    const walk = (layer: any, anc: any[]) => {
      if (!layer || basemapLayers.has(layer) || layer.listMode === 'hide') return
      if (layer.type === 'graphics' || String(layer.id || '').startsWith(TAG)) return
      const title = layer.title || layer.id
      const parentTitle = anc[anc.length - 1]?.title
      if (layer.type === 'group') {
        out.push({ key: 'group:' + flat(pathOf(anc, title)), title, layer, isGroup: true, parentTitle, ancestors: anc, path: pathOf(anc, title), depth: anc.length, exclusive: layer.visibilityMode === 'exclusive' })
        if (layer.listMode !== 'hide-children') topFirst(layer.layers).forEach(l => walk(l, [...anc, layer]))
        return
      }
      const subs = topFirst(layer.sublayers)
      if ((layer.type === 'map-image' || layer.type === 'tile') && subs.length) {
        out.push({ key: layerKey(layer.url, title), title, layer, isGroup: true, parentTitle, ancestors: anc, path: pathOf(anc, title), depth: anc.length })
        if (layer.listMode !== 'hide-children') subs.forEach(s => walkSub(s, layer, [...anc, layer]))
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
        if (r?.extent && r.count !== 0) { await view.goTo(r.extent.expand ? r.extent.expand(1.1) : r.extent, { duration: 900 }); return true }
      }
    } catch (err) { }
    try {
      if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
      const ext = t.fullExtent || e.layer.fullExtent
      if (ext) { await view.goTo(ext, { duration: 900 }); return true }
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
    if (next !== scale && isFinite(next)) { try { await view.goTo({ scale: next }, { duration: 700 }) } catch (err) { } }
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
          const detail = hit && hit !== display ? `${(fields.find(f => f.name === hit)?.alias) || hit}: ${a[hit]}` : ''
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
    try { await view.goTo(isPoint ? { target: g.geometry, scale: Math.min(view.scale || 4000, 2400) } : { target: g.geometry }, { duration: 900 }) } catch (e) { }
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
      await withTimeout(view.goTo({ target: location, scale: 2400 }, { duration: 900 }), 10000)
      if (view !== this.view) return false
      this.clear()
      const marker = new Graphic({ geometry: location, attributes: { [TAG]: true }, symbol: { type: 'simple-marker', size: 16, color: HIGHLIGHT_RGB, outline: { color: 'white', width: 2 } } })
      view.graphics.add(marker)
      this.highlightHandles.push({ remove: () => { try { view.graphics.remove(marker) } catch (e) { } } })
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
      if (vp) await view.goTo(vp, { duration: 900 })
    } catch (e) { }
  }

  async zoom (dir: 'in' | 'out'): Promise<void> {
    const view = this.view
    if (!view) return
    try { await view.goTo({ zoom: (view.zoom ?? 10) + (dir === 'in' ? 1 : -1) }, { duration: 500 }) } catch (e) { }
  }

  async goBookmark (index: number): Promise<boolean> {
    try {
      const b = toArr(this.view?.map?.bookmarks)[index]
      if (b?.viewpoint) { await this.view.goTo(b.viewpoint, { duration: 900 }); return true }
      if (b?.extent) { await this.view.goTo(b.extent, { duration: 900 }); return true }
    } catch (e) { }
    return false
  }

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
