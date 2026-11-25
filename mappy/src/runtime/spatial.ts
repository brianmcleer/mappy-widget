/*
  spatial.ts (runtime) - runs a question that crosses layers. The other side of the question
  (a layer, a named feature, a place) becomes shapes; the layer asked about is then limited to
  what lies within, inside, next to or outside those shapes, and the ordinary question runner
  (runtime/ask.ts) answers from that limited layer. So counts, lists, rankings, averages and
  groups all work across layers with no second code path.

  The layer service does the geometry: each step is a query with a shape, a distance and a
  relation. Nothing is unioned or buffered in the browser, so this needs no extra SDK modules
  and gives the same answer the layer's own query would.
*/
import type { QueryField } from '../brain/analysis'
import type { SpatialRead } from '../brain/spatial'
import { circleRing, bufferRing, csvCell } from '../brain/spatial'
import { fieldFor } from '../brain/ask'
import { fieldLabel } from '../brain/fields'
import { LiveMap, withTimeout } from './live'
import type { LayerEntry } from './live'
import { sayValue } from './ask'

/** The most features the other side of a question may have (each one is a query). */
export const MAX_ANCHORS = 300
/** The most object ids a limited layer is asked for at once. Beyond this only the count is given. */
export const MAX_IDS = 4000
/** Two lots that share a line are rarely drawn to the inch: this close counts as touching. */
const TOUCH_FEET = 3

export interface Anchor {
  /** How the other side reads in an answer: "250 N 5th St", "Compass Park", "a park (3)". */
  label: string
  /** Shapes in longitude and latitude (Esri JSON with spatialReference 4326). */
  geoms: any[]
  /** True when the shapes are areas (polygons). */
  area: boolean
  /** When the other side is features of a layer: which layer, and their object ids. */
  key?: string
  ids?: number[]
  /** Names of the features, in the same order as geoms (for per-area answers). */
  names?: string[]
  /** More features matched than could be used. */
  capped?: number
}

export interface Scope {
  key: string
  /** "within 300 ft of 250 N 5th St". */
  said: string
  /** A view of the map where the asked-about layer only has what the scope allows. */
  live: LiveMap
  /** The object ids the scope came down to, when it was worked out as a list. */
  ids?: number[]
  /** The question's own filter was used to work the list out, so a share "of those in the area" cannot be given. */
  narrowed?: boolean
}

const WGS = { wkid: 4326 }
const isArea = (g: any): boolean => Array.isArray(g?.rings)
const jsonOf = (g: any): any => {
  if (!g) return null
  const j = typeof g.toJSON === 'function' ? g.toJSON() : g
  return { ...j, spatialReference: j.spatialReference || WGS }
}
const typeOf = (g: any): string => Array.isArray(g?.rings) ? 'polygon' : Array.isArray(g?.paths) ? 'polyline' : Array.isArray(g?.points) ? 'multipoint' : 'point'
/** A shape as a query takes it: plain JSON with its type named. */
const forQuery = (g: any): any => ({ type: typeOf(g), ...g })
const baseWhere = (t: any): string => { const q: any = t.createQuery ? t.createQuery() : null; return String(q?.where || t.definitionExpression || '1=1') }
const both = (a: string, b: string): string => !b || b === '1=1' ? (a || '1=1') : !a || a === '1=1' ? b : `(${a}) AND (${b})`

async function pool<T> (items: T[], size: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0
  const run = async (): Promise<void> => { while (next < items.length) { const i = next++; await work(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run))
}

/** The features of a layer that make up the other side of a question, as shapes in longitude and latitude. */
export async function anchorFromLayer (live: LiveMap, entry: LayerEntry, where: string, label: string): Promise<Anchor> {
  const t = live.target(entry)
  if (!t || typeof t.queryFeatures !== 'function') throw new Error(`**${entry.title}** cannot be used that way: it does not answer queries.`)
  if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
  const q: any = t.createQuery ? t.createQuery() : { where: t.definitionExpression || '1=1' }
  q.where = both(String(q.where || '1=1'), where)
  q.outFields = [t.objectIdField, t.displayField].filter(Boolean)
  q.returnGeometry = true
  q.outSpatialReference = WGS
  q.num = MAX_ANCHORS + 1
  const res: any = await withTimeout(t.queryFeatures(q), 15000)
  const all = (Array.from(res?.features || []) as any[]).filter(f => f?.geometry)
  const used = all.slice(0, MAX_ANCHORS)
  let capped: number | undefined
  if (all.length > MAX_ANCHORS || res?.exceededTransferLimit) {
    try { const c: any = t.createQuery ? t.createQuery() : {}; c.where = q.where; capped = Number(await withTimeout(t.queryFeatureCount(c), 12000)) } catch (e) { capped = all.length }
  }
  const geoms = used.map(f => jsonOf(f.geometry))
  const display = (Array.from(t.fields || []) as QueryField[]).find(f => f.name === t.displayField)
  return {
    label, geoms, area: geoms.length > 0 && geoms.every(isArea), key: entry.key,
    ids: t.objectIdField ? used.map(f => Number(f.attributes?.[t.objectIdField])).filter(Number.isFinite) : undefined,
    names: used.map((f, i) => { const v = t.displayField ? f.attributes?.[t.displayField] : null; return v == null || v === '' ? `${entry.title} ${i + 1}` : (display ? sayValue(display, v) : String(v)) }),
    capped
  }
}

/** The parcel (or other area) a point falls in, as an anchor. Null when none does. */
export async function areaAt (live: LiveMap, entry: LayerEntry, at: [number, number], label: string): Promise<Anchor | null> {
  const t = live.target(entry)
  if (!t || typeof t.queryFeatures !== 'function') return null
  const q: any = t.createQuery ? t.createQuery() : { where: t.definitionExpression || '1=1' }
  q.geometry = { type: 'point', x: at[1], y: at[0], spatialReference: WGS }
  q.spatialRelationship = 'intersects'
  q.outFields = [t.objectIdField, t.displayField].filter(Boolean)
  q.returnGeometry = true
  q.outSpatialReference = WGS
  q.num = 1
  const res: any = await withTimeout(t.queryFeatures(q), 12000)
  const f = (Array.from(res?.features || []) as any[])[0]
  if (!f?.geometry) return null
  const g = jsonOf(f.geometry)
  return { label, geoms: [g], area: isArea(g), key: entry.key, ids: t.objectIdField && Number.isFinite(Number(f.attributes?.[t.objectIdField])) ? [Number(f.attributes[t.objectIdField])] : undefined }
}

export function pointAnchor (at: [number, number], label: string): Anchor {
  return { label, geoms: [{ x: at[1], y: at[0], spatialReference: WGS }], area: false }
}

/** Object ids of a layer's features that match a query. Throws when the layer can only return part of them. */
async function idsOf (t: any, q: any): Promise<number[]> {
  if (typeof t.queryObjectIds === 'function') {
    const ids: any = await withTimeout(t.queryObjectIds(q), 15000)
    return (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite)
  }
  q.outFields = [t.objectIdField]; q.returnGeometry = false; q.num = 2000
  const res: any = await withTimeout(t.queryFeatures(q), 15000)
  if (res?.exceededTransferLimit) throw new Error('That layer returns its records a page at a time, and this question needs all of them at once. Narrow it and try again.')
  return (Array.from(res?.features || []) as any[]).map(f => Number(f.attributes?.[t.objectIdField])).filter(Number.isFinite)
}

function spatialQuery (t: any, where: string, g: any, relation: string, feet: number): any {
  const q: any = t.createQuery ? t.createQuery() : { where: t.definitionExpression || '1=1' }
  q.where = both(String(q.where || '1=1'), where)
  q.geometry = forQuery(g)
  q.spatialRelationship = relation
  if (feet > 0) { q.distance = feet; q.units = 'feet' }
  return q
}

/** A layer that answers like the real one, but every query it starts already carries the limit. */
function limited (real: any, apply: (q: any) => void): any {
  const start = (): any => { const q: any = real.createQuery ? real.createQuery() : { where: real.definitionExpression || '1=1' }; apply(q); return q }
  const out: any = {
    createQuery: start,
    queryFeatures: (q: any) => real.queryFeatures(q),
    queryFeatureCount: (q: any) => real.queryFeatureCount(q),
    load: () => (real.load ? real.load() : Promise.resolve())
  }
  if (typeof real.queryObjectIds === 'function') out.queryObjectIds = (q: any) => real.queryObjectIds(q)
  for (const k of ['fields', 'displayField', 'objectIdField', 'capabilities', 'definitionExpression', 'geometryType', 'title', 'loaded', 'popupTemplate', 'id']) Object.defineProperty(out, k, { get: () => real[k], enumerable: true })
  return out
}

function scopedLive (live: LiveMap, key: string, layer: any): LiveMap {
  const view: any = Object.create(live)
  view.target = (e: LayerEntry) => e.key === key ? layer : live.target(e)
  return view as LiveMap
}

/**
 * Limits a layer to what lies in the given relation to the anchor. One shape and a simple
 * relation is a single filter on every query; anything else (several shapes, areas inside
 * areas, "outside", "next to" in the same layer) is worked out as a list of object ids.
 * Returns `count` alone when that list is too long to carry.
 */
export async function buildScope (live: LiveMap, entry: LayerEntry, read: SpatialRead, anchor: Anchor, said: string, where = '', keepSelf = false): Promise<{ scope?: Scope, count?: number }> {
  const real = live.target(entry)
  if (!real || typeof real.queryFeatures !== 'function') throw new Error(`**${entry.title}** does not answer queries, so I cannot ask where its features are.`)
  if (real.load && !real.loaded) await withTimeout(real.load(), 8000)
  if (!anchor.geoms.length) return { scope: { key: entry.key, said, live: scopedLive(live, entry.key, limited(real, q => { q.objectIds = [-1] })), ids: [] } }
  const areaTarget = /polygon/i.test(String(real.geometryType || ''))
  const feet = read.relation === 'within' ? Number(read.feet) : read.relation === 'touch' ? TOUCH_FEET : read.relation === 'outside' && read.feet ? Number(read.feet) : 0
  // Areas in areas: sharing only an edge is not "in". The interiors must meet (inside, overlapping, or around it).
  const interior = (read.relation === 'in' || (read.relation === 'outside' && !read.feet)) && areaTarget && anchor.area
  // A thing is not its own neighbour, unless the list is meant to include it (a notice list names the subject property too).
  const same = !keepSelf && anchor.key === entry.key && !!anchor.ids?.length
  const simple = anchor.geoms.length === 1 && !interior && read.relation !== 'outside' && !(same && real.objectIdField)
  if (simple) {
    const g = forQuery(anchor.geoms[0])
    return { scope: { key: entry.key, said, live: scopedLive(live, entry.key, limited(real, q => { q.geometry = g; q.spatialRelationship = 'intersects'; if (feet > 0) { q.distance = feet; q.units = 'feet' } })) } }
  }
  if (!real.objectIdField) throw new Error(`**${entry.title}** has no id field, so I cannot work that out across layers.`)
  const relations = interior ? ['contains', 'overlaps', 'within'] : ['intersects']
  const gather = async (filter: string): Promise<number[]> => {
    const inside = new Set<number>()
    await pool(anchor.geoms, 6, async g => {
      for (const rel of relations) for (const id of await idsOf(real, spatialQuery(real, read.relation === 'outside' ? '' : filter, g, rel, feet))) inside.add(id)
    })
    if (same) for (const id of anchor.ids!) inside.delete(id)
    if (read.relation !== 'outside') return Array.from(inside)
    const q: any = real.createQuery ? real.createQuery() : { where: real.definitionExpression || '1=1' }
    q.where = both(String(q.where || '1=1'), filter)
    return (await idsOf(real, q)).filter(id => !inside.has(id) && !(same && anchor.ids!.includes(id)))
  }
  // First without the question's own filter, so "12 of the 40 in that area" can be said. When that
  // list is too long, the filter is used to shorten it, and the share is left out.
  let ids = await gather('')
  let narrowed = false
  if (ids.length > MAX_IDS && where) { ids = await gather(where); narrowed = true }
  if (ids.length > MAX_IDS) return { count: ids.length }
  ids.sort((a, b) => a - b)
  return { scope: { key: entry.key, said, live: scopedLive(live, entry.key, limited(real, q => { q.objectIds = ids.length ? ids : [-1] })), ids, narrowed } }
}

/** How many of a layer's features fall in each area of the anchor, most first. */
export async function countPerArea (live: LiveMap, entry: LayerEntry, anchor: Anchor, where: string): Promise<Array<{ label: string, count: number }>> {
  const real = live.target(entry)
  if (!real || typeof real.queryFeatureCount !== 'function') throw new Error(`**${entry.title}** does not answer queries.`)
  if (real.load && !real.loaded) await withTimeout(real.load(), 8000)
  const areaTarget = /polygon/i.test(String(real.geometryType || ''))
  const totals = new Map<string, number>()
  const order: string[] = []
  const counts: number[] = new Array(anchor.geoms.length).fill(0)
  await pool(anchor.geoms, 6, async (g, i) => {
    if (areaTarget && anchor.area && real.objectIdField) {
      const seen = new Set<number>()
      for (const rel of ['contains', 'overlaps', 'within']) for (const id of await idsOf(real, spatialQuery(real, where, g, rel, 0))) seen.add(id)
      counts[i] = seen.size
    } else counts[i] = Number(await withTimeout(real.queryFeatureCount(spatialQuery(real, where, g, 'intersects', 0)), 12000)) || 0
  })
  // Areas with the same name (a district drawn in several pieces) are added up.
  anchor.geoms.forEach((g, i) => { const name = anchor.names?.[i] || `Area ${i + 1}`; if (!totals.has(name)) order.push(name); totals.set(name, (totals.get(name) || 0) + counts[i]) })
  return order.map(label => ({ label, count: totals.get(label) || 0 }))
}

/** What to draw for an anchor: its own outlines, and the distance around it (a circle for a point, the outline pushed out for an area). */
export function anchorRings (anchor: Anchor, feet: number): { own: number[][][], around: number[][][] } {
  const own: number[][][] = []
  const around: number[][][] = []
  const few = anchor.geoms.length <= 12
  for (const g of anchor.geoms.slice(0, 60)) {
    if (Array.isArray(g.rings)) {
      for (const r of g.rings.slice(0, 20)) own.push(r)
      if (feet > 0 && few && g.rings[0]) { const b = bufferRing(g.rings[0], feet); if (b.length) around.push(b) }
    } else if (Number.isFinite(g.x) && feet > 0 && few) around.push(circleRing(g.y, g.x, feet))
  }
  return { own, around }
}

/** A point to start a map view from: the first shape's own point or first corner, as [latitude, longitude]. */
export function anchorPoint (anchor: Anchor): [number, number] | null {
  const g = anchor.geoms[0]
  if (!g) return null
  if (Number.isFinite(g.x)) return [g.y, g.x]
  const v = g.rings?.[0]?.[0] || g.paths?.[0]?.[0]
  return v ? [v[1], v[0]] : null
}

export interface NoticeList { columns: string[], rows: string[][], csv: string, owners: number, parcels: number, ownerField: string, hasMailing: boolean, features: any[], capped: boolean }

/**
 * The owners of the parcels a scope came down to, as a table and a spreadsheet: owner, mailing
 * address, the property's own address and its parcel number, from whichever of those the layer has.
 */
export async function noticeList (scope: Scope, entry: LayerEntry, subjectIds: number[], view: any): Promise<NoticeList> {
  const t = scope.live.target(entry)
  const fields = Array.from(t.fields || []) as QueryField[]
  const text = (f: QueryField): boolean => /string/i.test(f.type || '')
  const owner = fieldFor('owner', fields, 'text') || fields.find(f => text(f) && /owner|taxpayer/i.test(`${f.name} ${f.alias || ''}`) && !/addr|city|state|zip|mail/i.test(`${f.name} ${f.alias || ''}`)) || null
  const named = (re: RegExp, not?: RegExp): QueryField | undefined => fields.find(f => re.test(`${f.name} ${f.alias || ''}`) && !(not && not.test(`${f.name} ${f.alias || ''}`)))
  const mail = /mail|owner.?add|own.?add|taxpayer.?add|\bm_?addr/i
  const mailLines = fields.filter(f => mail.test(`${f.name} ${f.alias || ''}`) && !/city|state|zip|postal|country/i.test(`${f.name} ${f.alias || ''}`)).slice(0, 2)
  const mailCity = named(/(?:mail|own).*city|city.*(?:mail|own)/i); const mailState = named(/(?:mail|own).*state|state.*(?:mail|own)/i); const mailZip = named(/(?:mail|own).*(?:zip|postal)|(?:zip|postal).*(?:mail|own)/i)
  const site = fieldFor('site address', fields, 'text') || fieldFor('address', fields, 'text') || named(/situs|site.?add|prop.*add|location/i, mail) || null
  const number = fieldFor('parcel number', fields) || named(/parcel.?(?:num|no|id)|\bpin\b|\bapn\b|account/i) || null
  const q: any = t.createQuery()
  q.outFields = ['*']; q.returnGeometry = true; q.num = 2001
  if (view?.spatialReference) q.outSpatialReference = view.spatialReference
  if (owner) q.orderByFields = [`${owner.name} ASC`]
  const res: any = await withTimeout(t.queryFeatures(q), 20000)
  const features = (Array.from(res?.features || []) as any[]).slice(0, 2000)
  const val = (f: QueryField | null | undefined, a: any): string => { const v = f ? a?.[f.name] : null; return v === null || v === undefined ? '' : String(sayValue(f as QueryField, v)).trim() }
  const mailing = (a: any): string => {
    const street = mailLines.map(f => val(f, a)).filter(Boolean).join(', ')
    const tail = [val(mailCity, a), [val(mailState, a), val(mailZip, a)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    return [street, tail].filter(Boolean).join(', ')
  }
  const hasMailing = mailLines.length > 0
  const columns = [owner ? fieldLabel(owner) : '', hasMailing ? 'Mailing address' : '', site ? fieldLabel(site) : '', number && number !== site ? fieldLabel(number) : '', 'Note'].filter((c, i) => c && (i !== 4 || subjectIds.length > 0))
  const rows = features.map(g => {
    const a = g.attributes || {}
    const subject = subjectIds.includes(Number(a[t.objectIdField]))
    return [owner ? val(owner, a) : null, hasMailing ? mailing(a) : null, site ? val(site, a) : null, number && number !== site ? val(number, a) : null, subjectIds.length ? (subject ? 'Subject property' : '') : null].filter(v => v !== null) as string[]
  })
  const owners = owner ? new Set(features.map(g => val(owner, g.attributes).toLowerCase()).filter(Boolean)).size : 0
  const csv = [columns.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n') + '\r\n'
  return { columns, rows, csv, owners, parcels: features.length, ownerField: owner ? fieldLabel(owner) : '', hasMailing, features, capped: !!res?.exceededTransferLimit || (Array.from(res?.features || []) as any[]).length > 2000 }
}
