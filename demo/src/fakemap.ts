/*
  fakemap.ts - a tiny stand-in for the ArcGIS Maps SDK, just big enough for Mappy to live in.
  A made-up town drawn in SVG, with layers that answer the same calls a feature layer does
  (visible, opacity, definitionExpression, queryFeatures with where clauses, statistics,
  distance and extent filters) and a view that pans, zooms, pins and highlights. Nothing here
  talks to a server: the whole demo runs in the page.
*/

export const SR = { wkid: 4326, isWGS84: true }
/** Meters per degree at the town's latitude; the SVG is drawn in these local meters. */
const MX = 85394
const MY = 111000
export const ORIGIN = { lon: -100.02, lat: 40.012 }
export const toXY = (lon: number, lat: number): [number, number] => [(lon - ORIGIN.lon) * MX, (ORIGIN.lat - lat) * MY]
const toLonLat = (x: number, y: number): [number, number] => [ORIGIN.lon + x / MX, ORIGIN.lat - y / MY]

// ---------------------------------------------------------------- geometry

export class Point {
  type = 'point'
  spatialReference = SR
  x: number; y: number
  constructor (p: any) { this.x = Number(p.x ?? p.longitude); this.y = Number(p.y ?? p.latitude) }
  get longitude (): number { return this.x }
  get latitude (): number { return this.y }
  get extent (): Extent { return new Extent({ xmin: this.x, ymin: this.y, xmax: this.x, ymax: this.y }) }
  clone (): Point { return new Point(this) }
  toJSON (): any { return { x: this.x, y: this.y, spatialReference: { wkid: 4326 } } }
}

export class Extent {
  type = 'extent'
  spatialReference = SR
  xmin: number; ymin: number; xmax: number; ymax: number
  constructor (e: any) { this.xmin = e.xmin; this.ymin = e.ymin; this.xmax = e.xmax; this.ymax = e.ymax }
  get width (): number { return this.xmax - this.xmin }
  get height (): number { return this.ymax - this.ymin }
  get center (): Point { return new Point({ x: (this.xmin + this.xmax) / 2, y: (this.ymin + this.ymax) / 2 }) }
  get extent (): Extent { return this }
  expand (f: number): Extent { const c = this.center; const w = this.width * f / 2; const h = this.height * f / 2; return new Extent({ xmin: c.x - w, xmax: c.x + w, ymin: c.y - h, ymax: c.y + h }) }
  clone (): Extent { return new Extent(this) }
  contains (p: any): boolean { return p.x >= this.xmin && p.x <= this.xmax && p.y >= this.ymin && p.y <= this.ymax }
  intersects (o: Extent): boolean { return !(o.xmin > this.xmax || o.xmax < this.xmin || o.ymin > this.ymax || o.ymax < this.ymin) }
  toJSON (): any { return { xmin: this.xmin, ymin: this.ymin, xmax: this.xmax, ymax: this.ymax, spatialReference: { wkid: 4326 } } }
}

const boundsOf = (coords: number[][]): Extent => new Extent({ xmin: Math.min(...coords.map(c => c[0])), xmax: Math.max(...coords.map(c => c[0])), ymin: Math.min(...coords.map(c => c[1])), ymax: Math.max(...coords.map(c => c[1])) })

export class Polygon {
  type = 'polygon'
  spatialReference = SR
  rings: number[][][]
  constructor (p: any) { this.rings = p.rings }
  get extent (): Extent { return boundsOf(this.rings[0]) }
  get centroid (): Point { return this.extent.center }
  clone (): Polygon { return new Polygon({ rings: JSON.parse(JSON.stringify(this.rings)) }) }
  toJSON (): any { return { rings: this.rings, spatialReference: { wkid: 4326 } } }
}

export class Polyline {
  type = 'polyline'
  spatialReference = SR
  paths: number[][][]
  constructor (p: any) { this.paths = p.paths }
  get extent (): Extent { return boundsOf(this.paths.reduce((a, b) => a.concat(b), [] as number[][])) }
  clone (): Polyline { return new Polyline({ paths: JSON.parse(JSON.stringify(this.paths)) }) }
  toJSON (): any { return { paths: this.paths, spatialReference: { wkid: 4326 } } }
}

export class Graphic {
  geometry: any; attributes: any; symbol: any; layer: any; popupTemplate: any
  constructor (g: any = {}) { this.geometry = g.geometry; this.attributes = g.attributes || {}; this.symbol = g.symbol; this.layer = g.layer; this.popupTemplate = g.popupTemplate }
  clone (): Graphic { return new Graphic(this) }
}

/** A geometry from whatever the caller handed over (a class instance or plain JSON). */
export function asGeometry (g: any): any {
  if (!g) return null
  if (g instanceof Point || g instanceof Polygon || g instanceof Polyline || g instanceof Extent) return g
  if (g.rings) return new Polygon(g)
  if (g.paths) return new Polyline(g)
  if (Number.isFinite(g.xmin)) return new Extent(g)
  if (Number.isFinite(g.x ?? g.longitude)) return new Point(g)
  return null
}

const FEET_PER_M = 3.28084
const metersBetween = (a: [number, number], b: [number, number]): number => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY)
const inRing = (p: [number, number], ring: number[][]): boolean => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const segDist = (p: [number, number], a: number[], b: number[]): number => {
  const ax = (a[0] - p[0]) * MX; const ay = (a[1] - p[1]) * MY; const bx = (b[0] - p[0]) * MX; const by = (b[1] - p[1]) * MY
  const dx = bx - ax; const dy = by - ay
  const t = Math.max(0, Math.min(1, (dx || dy) ? -(ax * dx + ay * dy) / (dx * dx + dy * dy) : 0))
  return Math.hypot(ax + t * dx, ay + t * dy)
}
/** Meters from a point to a geometry (0 inside a polygon). */
function distanceTo (p: [number, number], g: any): number {
  if (g.type === 'point') return metersBetween(p, [g.x, g.y])
  const lines: number[][][] = g.type === 'polygon' ? g.rings : g.paths
  if (g.type === 'polygon' && inRing(p, g.rings[0])) return 0
  let best = Infinity
  for (const line of lines) for (let i = 1; i < line.length; i++) best = Math.min(best, segDist(p, line[i - 1], line[i]))
  return best
}

// ---------------------------------------------------------------- a small SQL where-clause reader

type Tok = { t: 'num' | 'str' | 'id' | 'op' | 'kw', v: any }
const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'LIKE', 'IN', 'IS', 'NULL', 'BETWEEN', 'UPPER', 'LOWER', 'TIMESTAMP', 'DATE', 'CAST', 'AS', 'VARCHAR', 'CHAR', 'ESCAPE'])
function tokens (sql: string): Tok[] {
  const out: Tok[] = []
  const re = /\s*(?:(\d+(?:\.\d+)?)|'((?:[^']|'')*)'|(<>|!=|>=|<=|=|>|<|\(|\)|,)|([A-Za-z_][\w.]*))/y
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while (re.lastIndex < sql.length && (m = re.exec(sql))) {
    if (m[1] !== undefined) out.push({ t: 'num', v: Number(m[1]) })
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2].replace(/''/g, "'") })
    else if (m[3] !== undefined) out.push({ t: 'op', v: m[3] })
    else if (m[4] !== undefined) out.push(KEYWORDS.has(m[4].toUpperCase()) ? { t: 'kw', v: m[4].toUpperCase() } : { t: 'id', v: m[4] })
    if (m[0] === '') break
  }
  return out
}

/** A where clause as a test for one record. Anything it cannot read matches everything. */
export function whereTest (where: string | undefined, dateFields: Set<string>): (a: any) => boolean {
  const sql = String(where || '').trim()
  if (!sql || sql === '1=1') return () => true
  const tk = tokens(sql)
  let i = 0
  const peek = (): Tok | undefined => tk[i]
  const take = (): Tok => tk[i++]
  const isKw = (v: string): boolean => peek()?.t === 'kw' && peek()!.v === v
  const isOp = (v: string): boolean => peek()?.t === 'op' && peek()!.v === v
  type Fn = (a: any) => any
  const operand = (): Fn => {
    const t = take()
    if (!t) return () => null
    if (t.t === 'num' || t.t === 'str') return () => t.v
    if (t.t === 'kw' && (t.v === 'UPPER' || t.v === 'LOWER')) { take(); const inner = operand(); take(); return a => { const v = inner(a); return v == null ? v : (t.v === 'UPPER' ? String(v).toUpperCase() : String(v).toLowerCase()) } }
    if (t.t === 'kw' && (t.v === 'TIMESTAMP' || t.v === 'DATE')) { const s = take(); const ms = Date.parse(String(s?.v || '').replace(' ', 'T')); return () => ms }
    if (t.t === 'kw' && t.v === 'CAST') { take(); const inner = operand(); while (peek() && !isOp(')')) take(); take(); return a => { const v = inner(a); return v == null ? v : String(v) } }
    if (t.t === 'op' && t.v === '(') { const e = or(); take(); return e }
    if (t.t === 'id') { const key = t.v; return a => { const k = Object.keys(a).find(x => x.toLowerCase() === key.toLowerCase()); return k ? a[k] : null } }
    return () => null
  }
  const like = (pattern: string): RegExp => new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
  const cmp = (): Fn => {
    const left = operand()
    let negate = false
    if (isKw('NOT')) { take(); negate = true }
    if (isKw('LIKE')) { take(); const p = operand(); if (isKw('ESCAPE')) { take(); take() } return a => { const v = left(a); const r = v != null && like(String(p(a))).test(String(v)); return negate ? !r : r } }
    if (isKw('IN')) { take(); take(); const items: Fn[] = []; while (peek() && !isOp(')')) { items.push(operand()); if (isOp(',')) take() } take(); return a => { const v = left(a); const r = items.some(f => String(f(a)).toLowerCase() === String(v).toLowerCase()); return negate ? !r : r } }
    if (isKw('BETWEEN')) { take(); const lo = operand(); take(); const hi = operand(); return a => { const v = left(a); const r = v != null && v >= lo(a) && v <= hi(a); return negate ? !r : r } }
    if (isKw('IS')) { take(); let not = false; if (isKw('NOT')) { take(); not = true } take(); return a => { const v = left(a); const r = v == null || v === ''; return not ? !r : r } }
    if (peek()?.t === 'op' && ['=', '<>', '!=', '>', '>=', '<', '<='].includes(peek()!.v)) {
      const op = take().v; const right = operand()
      return a => {
        let l = left(a); let r = right(a)
        if (l == null || r == null) return false
        if (typeof l === 'string' && typeof r === 'string') { l = l.toLowerCase(); r = r.toLowerCase() } else { l = Number(l); r = Number(r) }
        return op === '=' ? l === r : op === '<>' || op === '!=' ? l !== r : op === '>' ? l > r : op === '>=' ? l >= r : op === '<' ? l < r : l <= r
      }
    }
    return left
  }
  const not = (): Fn => { if (isKw('NOT')) { take(); const e = not(); return a => !e(a) } return cmp() }
  const and = (): Fn => { let e = not(); while (isKw('AND')) { take(); const r = not(); const l = e; e = a => !!l(a) && !!r(a) } return e }
  function or (): Fn { let e = and(); while (isKw('OR')) { take(); const r = and(); const l = e; e = a => !!l(a) || !!r(a) } return e }
  try { const test = or(); return a => { try { return !!test(a) } catch (e) { return true } } } catch (e) { return () => true }
}

// ---------------------------------------------------------------- layers

export interface FakeField { name: string, alias: string, type: string, domain?: any }

export class FakeLayer {
  type = 'feature'
  loaded = true
  url = ''
  objectIdField = 'OBJECTID'
  minScale = 0
  maxScale = 0
  popupEnabled = true
  listMode = 'show'
  labelsVisible = false
  capabilities = { query: { supportsStatistics: true, supportsOrderBy: true, supportsPagination: true, supportsDistance: true } }
  private _visible: boolean
  private _opacity = 1
  private _where = ''
  features: Graphic[]
  highlighted = new Set<number>()
  onChange: () => void = () => {}
  constructor (public id: string, public title: string, public geometryType: 'point' | 'polygon' | 'polyline', public fields: FakeField[], public displayField: string, rows: Array<{ attributes: any, geometry: any }>, visible: boolean, public style: { fill?: string, stroke?: string, by?: string, colors?: { [v: string]: string } }) {
    this._visible = visible
    this.features = rows.map((r, i) => new Graphic({ attributes: { OBJECTID: i + 1, ...r.attributes }, geometry: r.geometry, layer: this }))
  }
  get visible (): boolean { return this._visible }
  set visible (v: boolean) { this._visible = !!v; this.onChange() }
  get opacity (): number { return this._opacity }
  set opacity (v: number) { this._opacity = Number(v); this.onChange() }
  get definitionExpression (): string { return this._where }
  set definitionExpression (v: string) { this._where = v || ''; this.onChange() }
  get fullExtent (): Extent { return unionExtent(this.features.map(f => f.geometry.extent)) }
  get spatialReference (): any { return SR }
  load (): Promise<this> { return Promise.resolve(this) }
  when (): Promise<this> { return Promise.resolve(this) }
  createQuery (): any { return { where: this._where || '1=1', outFields: ['*'], returnGeometry: false } }
  private dates (): Set<string> { return new Set(this.fields.filter(f => /date/i.test(f.type)).map(f => f.name)) }
  /** The features drawn on the map right now (the layer's own filter applied). */
  drawn (): Graphic[] { const t = whereTest(this._where, this.dates()); return this.features.filter(f => t(f.attributes)) }

  private select (q: any): Graphic[] {
    const test = whereTest(q?.where, this.dates())
    let list = this.features.filter(f => test(f.attributes))
    if (Array.isArray(q?.objectIds)) list = list.filter(f => q.objectIds.includes(f.attributes.OBJECTID))
    const g = asGeometry(q?.geometry)
    if (g) {
      const meters = q.distance ? Number(q.distance) / (/(meter|metre)/i.test(String(q.units || '')) ? 1 : /mile/i.test(String(q.units || '')) ? 1 / 1609.34 : /kilometer/i.test(String(q.units || '')) ? 0.001 : FEET_PER_M) : 0
      if (g.type === 'extent' && !meters) list = list.filter(f => g.intersects(f.geometry.extent))
      else {
        const p: [number, number] = g.type === 'point' ? [g.x, g.y] : [g.extent.center.x, g.extent.center.y]
        list = list.filter(f => distanceTo(p, f.geometry) <= meters + (g.type === 'point' ? 0 : Math.max(g.extent.width * MX, g.extent.height * MY) / 2))
      }
    }
    return list
  }

  async queryFeatureCount (q: any): Promise<number> { return this.select(q).length }

  async queryExtent (q: any): Promise<any> { const list = this.select(q); return { count: list.length, extent: list.length ? unionExtent(list.map(f => f.geometry.extent)) : null } }

  async queryObjectIds (q: any): Promise<number[]> { return this.select(q).map(f => f.attributes.OBJECTID) }

  async queryFeatures (q: any = {}): Promise<{ features: Graphic[], exceededTransferLimit: boolean, fields: FakeField[] }> {
    let list = this.select(q)
    if (Array.isArray(q.outStatistics) && q.outStatistics.length) {
      const groups = new Map<string, Graphic[]>()
      const by: string[] = q.groupByFieldsForStatistics || []
      for (const f of list) { const key = JSON.stringify(by.map(b => f.attributes[b] ?? null)); if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(f) }
      if (!by.length && !groups.size) groups.set('[]', [])
      let rows = Array.from(groups.entries()).map(([key, fs]) => {
        const attributes: any = {}
        by.forEach((b, i) => { attributes[b] = JSON.parse(key)[i] })
        for (const s of q.outStatistics) {
          const vals = fs.map(f => f.attributes[s.onStatisticField]).filter(v => v != null && v !== '')
          const nums = vals.map(Number).filter(Number.isFinite)
          const type = String(s.statisticType).toLowerCase()
          attributes[s.outStatisticFieldName || `${type}_${s.onStatisticField}`] = type === 'count' ? vals.length
            : !nums.length ? null
              : type === 'sum' ? nums.reduce((a, b) => a + b, 0)
                : type === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length
                  : type === 'min' ? Math.min(...nums) : type === 'max' ? Math.max(...nums) : null
        }
        return new Graphic({ attributes })
      })
      rows = orderRows(rows, q.orderByFields)
      if (q.num) rows = rows.slice(q.start || 0, (q.start || 0) + q.num)
      return { features: rows, exceededTransferLimit: false, fields: this.fields }
    }
    list = orderRows(list, q.orderByFields)
    if (q.returnDistinctValues && Array.isArray(q.outFields)) {
      const seen = new Set<string>()
      list = list.filter(f => { const k = JSON.stringify(q.outFields.map((o: string) => f.attributes[o])); if (seen.has(k)) return false; seen.add(k); return true })
    }
    const total = list.length
    const start = Number(q.start) || 0
    if (q.num) list = list.slice(start, start + Number(q.num))
    return { features: list.map(f => new Graphic({ attributes: { ...f.attributes }, geometry: q.returnGeometry === false ? undefined : f.geometry, layer: this })), exceededTransferLimit: start + list.length < total, fields: this.fields }
  }
}

function orderRows (rows: Graphic[], order?: string[]): Graphic[] {
  if (!order?.length) return rows
  const keys = order.map(o => { const [f, dir] = String(o).trim().split(/\s+/); return { f, desc: /^desc/i.test(dir || '') } })
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = a.attributes[k.f]; const y = b.attributes[k.f]
      if (x === y) continue
      if (x == null) return 1
      if (y == null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return k.desc ? -c : c
    }
    return 0
  })
}

export function unionExtent (list: Extent[]): Extent {
  return new Extent({ xmin: Math.min(...list.map(e => e.xmin)), ymin: Math.min(...list.map(e => e.ymin)), xmax: Math.max(...list.map(e => e.xmax)), ymax: Math.max(...list.map(e => e.ymax)) })
}

// ---------------------------------------------------------------- the view

type Watcher = (v: any) => void

export class FakeView {
  type = '2d'
  spatialReference = SR
  ready = true
  stationary = true
  rotation = 0
  map: { layers: FakeLayer[], tables: any[], basemap: { title: string } }
  graphics: { items: Graphic[], add: (g: Graphic) => void, remove: (g: Graphic) => void, removeAll: () => void, addMany: (g: Graphic[]) => void, removeMany: (g: Graphic[]) => void }
  popup: any
  private cx: number
  private cy: number
  private _scale: number
  private home: { cx: number, cy: number, scale: number }
  private watchers = new Map<string, Set<Watcher>>()
  private listeners = new Map<string, Set<(e: any) => void>>()
  private anim = 0
  width = 1000
  height = 700
  /** Called whenever something drawn has changed. */
  onRender: () => void = () => {}

  constructor (layers: FakeLayer[], start: { lon: number, lat: number, scale: number }) {
    this.map = { layers, tables: [], basemap: { title: 'Paper streets' } }
    this.cx = start.lon; this.cy = start.lat; this._scale = start.scale
    this.home = { cx: this.cx, cy: this.cy, scale: this._scale }
    for (const l of layers) l.onChange = () => this.onRender()
    const items: Graphic[] = []
    this.graphics = {
      items,
      add: g => { items.push(g); this.onRender() },
      addMany: gs => { items.push(...gs); this.onRender() },
      remove: g => { const i = items.indexOf(g); if (i >= 0) items.splice(i, 1); this.onRender() },
      removeMany: gs => { for (const g of gs) { const i = items.indexOf(g); if (i >= 0) items.splice(i, 1) } this.onRender() },
      removeAll: () => { items.length = 0; this.onRender() }
    }
    const self = this
    this.popup = {
      visible: false,
      selectedFeature: null as Graphic | null,
      open (o: any) { this.selectedFeature = o?.features?.[0] || null; this.visible = !!this.selectedFeature; self.emit('popup.selectedFeature', this.selectedFeature); self.onRender() },
      close () { this.selectedFeature = null; this.visible = false; self.emit('popup.selectedFeature', null); self.onRender() }
    }
  }

  /** Meters across one screen pixel at the current scale (96 dots per inch). */
  get mpp (): number { return this._scale / 3779.5 }
  get scale (): number { return this._scale }
  get zoom (): number { return -1 }
  get center (): Point { return new Point({ x: this.cx, y: this.cy }) }
  get extent (): Extent {
    const hw = this.width * this.mpp / 2 / MX; const hh = this.height * this.mpp / 2 / MY
    return new Extent({ xmin: this.cx - hw, xmax: this.cx + hw, ymin: this.cy - hh, ymax: this.cy + hh })
  }
  get viewpoint (): any {
    const v = { scale: this._scale, rotation: this.rotation, targetGeometry: this.center, clone: () => ({ ...v, clone: v.clone, toJSON: v.toJSON }), toJSON: () => ({ scale: v.scale, rotation: 0, targetGeometry: v.targetGeometry.toJSON() }) }
    return v
  }
  /** The SVG viewBox for what is on screen, in local meters. */
  viewBox (): [number, number, number, number] {
    const [x, y] = toXY(this.cx, this.cy)
    const w = this.width * this.mpp; const h = this.height * this.mpp
    return [x - w / 2, y - h / 2, w, h]
  }
  toMap (p: { x: number, y: number }): Point { const [vx, vy, vw, vh] = this.viewBox(); const [lon, lat] = toLonLat(vx + p.x / this.width * vw, vy + p.y / this.height * vh); return new Point({ x: lon, y: lat }) }
  toScreen (p: any): { x: number, y: number } { const [vx, vy, vw, vh] = this.viewBox(); const [x, y] = toXY(p.x, p.y); return { x: (x - vx) / vw * this.width, y: (y - vy) / vh * this.height } }

  when (cb?: () => void): Promise<this> { try { cb?.() } catch (e) { } return Promise.resolve(this) }
  whenLayerView (layer: FakeLayer): Promise<any> {
    return Promise.resolve({
      layer,
      highlight: (target: any) => {
        const ids: number[] = (Array.isArray(target) ? target : [target]).map((t: any) => typeof t === 'number' ? t : t?.attributes?.OBJECTID).filter((n: any) => Number.isFinite(n))
        ids.forEach(id => layer.highlighted.add(id)); this.onRender()
        return { remove: () => { ids.forEach(id => layer.highlighted.delete(id)); this.onRender() } }
      }
    })
  }
  on (name: string, cb: (e: any) => void): { remove: () => void } {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(cb)
    return { remove: () => this.listeners.get(name)?.delete(cb) }
  }
  fire (name: string, e: any): void { this.listeners.get(name)?.forEach(cb => { try { cb(e) } catch (err) { } }) }
  watch (prop: string, cb: Watcher): { remove: () => void } {
    if (!this.watchers.has(prop)) this.watchers.set(prop, new Set())
    this.watchers.get(prop)!.add(cb)
    return { remove: () => this.watchers.get(prop)?.delete(cb) }
  }
  private emit (prop: string, v: any): void { this.watchers.get(prop)?.forEach(cb => { try { cb(v) } catch (e) { } }) }

  /** Where a goTo target lands: a center and a scale. */
  private resolve (target: any): { cx: number, cy: number, scale: number } {
    let scale: number | undefined = Number.isFinite(target?.scale) ? Number(target.scale) : undefined
    let center: any = target?.center
    let what: any = target?.target ?? target?.targetGeometry ?? (target?.geometry ? target : undefined) ?? (asGeometry(target) || (Array.isArray(target) ? target : undefined))
    if (Array.isArray(center)) center = { x: center[0], y: center[1] }
    const geoms: any[] = []
    const collect = (t: any) => { if (!t) return; if (Array.isArray(t)) { t.forEach(collect); return } const g = asGeometry(t.geometry || t.targetGeometry || t); if (g) geoms.push(g) }
    collect(what)
    if (center) { const c = asGeometry(center); if (c) return { cx: c.x, cy: c.y, scale: scale ?? this._scale } }
    if (!geoms.length) return { cx: this.cx, cy: this.cy, scale: scale ?? this._scale }
    const ext = unionExtent(geoms.map(g => g.extent))
    const c = ext.center
    if (scale === undefined) {
      const wm = ext.width * MX; const hm = ext.height * MY
      scale = wm < 1 && hm < 1 ? this._scale : Math.max(wm / (this.width * 0.8), hm / (this.height * 0.8)) * 3779.5
    }
    return { cx: c.x, cy: c.y, scale: Math.max(150, Math.min(60000, scale)) }
  }

  goTo (target: any, opts: any = {}): Promise<void> {
    const to = this.resolve(target)
    cancelAnimationFrame(this.anim)
    if (opts.animate === false || typeof requestAnimationFrame === 'undefined') { this.cx = to.cx; this.cy = to.cy; this._scale = to.scale; this.settle(); return Promise.resolve() }
    const from = { cx: this.cx, cy: this.cy, scale: this._scale }
    const ms = Math.max(120, Math.min(900, Number(opts.duration) || 600))
    const t0 = performance.now()
    this.stationary = false
    return new Promise(resolve => {
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms)
        const e = 1 - Math.pow(1 - k, 3)
        this.cx = from.cx + (to.cx - from.cx) * e
        this.cy = from.cy + (to.cy - from.cy) * e
        this._scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * e)
        this.onRender()
        if (k < 1) this.anim = requestAnimationFrame(step)
        else { this.settle(); resolve() }
      }
      this.anim = requestAnimationFrame(step)
    })
  }
  private settle (): void { this.stationary = true; this.onRender(); this.emit('stationary', true); this.emit('extent', this.extent); this.emit('scale', this._scale) }
  /** Drag and wheel from the page. */
  panBy (dxPx: number, dyPx: number): void { this.cx -= dxPx * this.mpp / MX; this.cy += dyPx * this.mpp / MY; this.onRender() }
  zoomBy (factor: number): void { this._scale = Math.max(150, Math.min(60000, this._scale * factor)); this.settle() }
  goHome (): Promise<void> { return this.goTo({ center: { x: this.home.cx, y: this.home.cy }, scale: this.home.scale }) }
}
