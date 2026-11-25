/*
  esriMcp.ts - what Mappy knows about Esri's own MCP server, "MCP for ArcGIS Enterprise"
  (MCP Services on the hosting server; https://<domain>/<server-context>/mcp/default).

  Its default catalog has a fixed set of tools: search_portal_content, describe_item,
  describe_layer, query_data, get_map_image, find_address_candidates, reverse_geocode,
  solve_route and two geoprocessing helpers. Mappy has no language model, so he cannot read a
  tool description and improvise; this file is how he uses those tools on purpose: which tool
  answers which kind of request, how its inputs are filled, and how its answer is read.

  Esri documents the tools' inputs but not the exact shape of every answer, so the readers
  here accept the shapes ArcGIS REST and Esri's examples use and never assume one key. Pure
  logic, no esri or jimu imports; the runtime side is runtime/esriMcp.ts.
*/
import type { McpTool, McpProp } from './mcpTools'
import type { AskLayer } from './ask'
import type { QueryField } from './analysis'

/** The built-in tools of the default catalog, by the job they do for Mappy. */
const ROLES: { [role: string]: string } = {
  search: 'search_portal_content',
  item: 'describe_item',
  layer: 'describe_layer',
  query: 'query_data',
  image: 'get_map_image',
  geocode: 'find_address_candidates',
  reverse: 'reverse_geocode',
  route: 'solve_route',
  gpDefinition: 'get_gp_task_definition',
  gpStatus: 'get_gp_task_job_status'
}

export interface EsriCatalog {
  search?: McpTool, item?: McpTool, layer?: McpTool, query?: McpTool, image?: McpTool
  geocode?: McpTool, reverse?: McpTool, route?: McpTool, gpDefinition?: McpTool, gpStatus?: McpTool
}

/**
 * The Esri tools among a server's tools, or null when this is not an ArcGIS Enterprise catalog.
 * A name counts as written or behind a prefix ("enterprise_query_data"), which is how another
 * server passes these tools through. Three of them make a catalog; one alone could be anyone's.
 */
export function esriCatalog (tools: McpTool[]): EsriCatalog | null {
  const out: EsriCatalog = {}
  let found = 0
  for (const role of Object.keys(ROLES)) {
    const name = ROLES[role]
    const hit = tools.find(t => t.name === name) || tools.find(t => t.name.toLowerCase().endsWith('_' + name))
    if (hit) { (out as any)[role] = hit; found++ }
  }
  return found >= 3 ? out : null
}

/** True for a tool that is part of Esri's catalog plumbing and not something to offer a person by name. */
export function esriHelperTool (name: string): boolean {
  return /(?:^|_)(?:get_search_portal_content_passthrough_instructions|get_gp_task_definition|get_gp_task_job_status|describe_item|describe_layer)$/.test(name)
}

/** A tool's answer as data: its structured content, or the JSON it sent as text. */
export function toolData (raw: any): any {
  if (!raw || raw.isError) return null
  if (raw.structuredContent !== undefined && raw.structuredContent !== null) return raw.structuredContent
  const texts = (Array.isArray(raw.content) ? raw.content : []).filter((c: any) => c?.type === 'text' && typeof c.text === 'string').map((c: any) => c.text.trim())
  for (const t of texts) { if (/^[[{]/.test(t)) { try { return JSON.parse(t) } catch (e) { } } }
  return null
}

/** What a failed tool said, in a sentence. */
export function toolError (raw: any): string {
  if (!raw?.isError) return ''
  const said = (Array.isArray(raw.content) ? raw.content : []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join(' ').replace(/\s+/g, ' ').trim()
  return said.slice(0, 300) || 'no reason given'
}

const props = (t?: McpTool): { [k: string]: McpProp } => (t?.inputSchema?.properties || {}) as any
/** The input a tool really has for a documented name, whatever its letter case or underscores. */
function key (t: McpTool | undefined, ...names: string[]): string | undefined {
  const keys = Object.keys(props(t))
  const flat = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const n of names) { const hit = keys.find(k => flat(k) === flat(n)); if (hit) return hit }
  // No schema to check against (a server that lists none): trust the documented name.
  return keys.length ? undefined : names[0]
}
function put (args: { [k: string]: any }, t: McpTool | undefined, names: string[], value: any): void {
  if (value === undefined || value === null || value === '') return
  const k = key(t, ...names)
  if (k) args[k] = value
}

// ------------------------------------------------------------ addresses and routes

export interface Candidate { address: string, lat: number, lon: number, score: number }

export function geocodeArgs (tool: McpTool, address: string): { [k: string]: any } {
  const args: { [k: string]: any } = {}
  put(args, tool, ['singleLine', 'address', 'text'], address)
  put(args, tool, ['outWkid', 'outSR'], 4326)
  return args
}

/** Address candidates, best first. Coordinates that are not longitude and latitude are left out. */
export function readCandidates (data: any): Candidate[] {
  const list: any[] = Array.isArray(data?.candidates) ? data.candidates : Array.isArray(data?.results) ? data.results : Array.isArray(data?.locations) ? data.locations : Array.isArray(data) ? data : []
  const out: Candidate[] = []
  for (const c of list) {
    const at = c?.location || c?.geometry || c
    const lon = Number(at?.x ?? at?.longitude ?? at?.lon); const lat = Number(at?.y ?? at?.latitude ?? at?.lat)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    out.push({ address: String(c.address ?? c.name ?? c.attributes?.Match_addr ?? c.attributes?.LongLabel ?? '').trim(), lat, lon, score: Number.isFinite(Number(c.score)) ? Number(c.score) : 100 })
  }
  return out.sort((a, b) => b.score - a.score)
}

export function reverseArgs (tool: McpTool, lat: number, lon: number): { [k: string]: any } {
  const args: { [k: string]: any } = {}
  put(args, tool, ['x', 'longitude', 'lon'], Number(lon.toFixed(6)))
  put(args, tool, ['y', 'latitude', 'lat'], Number(lat.toFixed(6)))
  put(args, tool, ['wkid', 'inWkid'], 4326)
  return args
}

/** The street address in a reverse geocode answer ("250 Oak St"), or ''. */
export function readReverse (data: any): string {
  const a = data?.address
  const text = typeof a === 'string' ? a : (a?.Match_addr || a?.LongLabel || a?.Address || data?.Match_addr || data?.LongLabel || '')
  return String(text || '').trim()
}

export type TravelMode = 'driving' | 'walking' | 'trucking'

/** The route layer's own name for a way of travelling ("Walking Time"), or nothing so its default is used. */
export function travelModeName (tool: McpTool, mode: TravelMode, shortest = false): string | undefined {
  const want = mode === 'walking' ? 'walking' : mode === 'trucking' ? 'trucking' : 'driving'
  const measure = shortest ? 'distance' : 'time'
  const k = key(tool, 'travelMode')
  const listed: string[] = (k && Array.isArray(props(tool)[k]?.enum) ? props(tool)[k].enum : []) as string[]
  if (listed.length) {
    return listed.find(n => n.toLowerCase() === `${want} ${measure}`) || listed.find(n => n.toLowerCase().startsWith(want) && !/rural/i.test(n)) || undefined
  }
  // Driving by time is every route layer's default: leave it unsaid.
  if (want === 'driving' && !shortest) return undefined
  return `${want[0].toUpperCase()}${want.slice(1)} ${measure[0].toUpperCase()}${measure.slice(1)}`
}

export function routeArgs (tool: McpTool, from: { label: string, at: [number, number] }, to: { label: string, at: [number, number] }, mode: TravelMode = 'driving', shortest = false): { [k: string]: any } {
  const point = (p: { label: string, at: [number, number] }): any => ({ x: Number(p.at[1].toFixed(6)), y: Number(p.at[0].toFixed(6)), name: p.label.slice(0, 80) })
  const args: { [k: string]: any } = {}
  put(args, tool, ['start', 'from', 'origin'], point(from))
  put(args, tool, ['end', 'to', 'destination'], point(to))
  put(args, tool, ['travelMode'], travelModeName(tool, mode, shortest))
  put(args, tool, ['inWkid'], 4326)
  put(args, tool, ['outWkid'], 4326)
  return args
}

export interface RouteAnswer {
  /** The path as [latitude, longitude] points (empty when the answer had no usable line). */
  path: Array<[number, number]>
  /** "3.2 mi", "12 min": as the server measured them, in its own units. */
  distance: string
  time: string
  steps: string[]
}

const UNIT: { [u: string]: string } = { esrinaumiles: 'mi', esrinaukilometers: 'km', esrinaumeters: 'm', esrinaufeet: 'ft', esrinauyards: 'yd', esrinaunauticalmiles: 'nmi', esrinauminutes: 'min', esrinauhours: 'hr', esrinauseconds: 'sec', esrinaudays: 'days', miles: 'mi', kilometers: 'km', meters: 'm', feet: 'ft', minutes: 'min', hours: 'hr', seconds: 'sec' }
function amount (value: any, unit: any, fallback: string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return ''
  const u = UNIT[String(unit || '').toLowerCase().replace(/[^a-z]/g, '')] || fallback
  if (u === 'min' && n >= 90) return `${Math.floor(n / 60)} hr ${Math.round(n % 60)} min`
  return `${n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(0) : n.toFixed(1)} ${u}`
}

/** A solve_route answer: the line to draw, how far, how long, and the turn-by-turn steps. */
export function readRoute (data: any): RouteAnswer | null {
  if (!data || typeof data !== 'object') return null
  const route = data.route || data.routes?.features?.[0] || data.routes?.[0] || data
  const geom = route.geometry || data.geometry || data.routeGeometry || route.routeGeometry
  const wkid = geom?.spatialReference?.latestWkid ?? geom?.spatialReference?.wkid ?? data.spatialReference?.latestWkid ?? data.spatialReference?.wkid ?? 4326
  const path: Array<[number, number]> = []
  for (const part of Array.isArray(geom?.paths) ? geom.paths : []) {
    for (const v of Array.isArray(part) ? part : []) {
      let lon = Number(v?.[0]); let lat = Number(v?.[1])
      if (wkid === 102100 || wkid === 3857 || wkid === 102113) { lon = lon / 6378137 * 180 / Math.PI; lat = (2 * Math.atan(Math.exp(lat / 6378137)) - Math.PI / 2) * 180 / Math.PI }
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) path.push([lat, lon])
    }
  }
  const attrs = route.attributes || {}
  const distance = amount(data.distance ?? data.totalDistance ?? route.distance ?? attrs.Total_Miles ?? attrs.Total_Kilometers ?? attrs.Shape_Length, data.distanceUnits ?? route.distanceUnits ?? (attrs.Total_Kilometers !== undefined && attrs.Total_Miles === undefined ? 'kilometers' : 'miles'), 'mi')
  const time = amount(data.duration ?? data.totalTime ?? data.time ?? route.duration ?? attrs.Total_TravelTime ?? attrs.Total_Minutes, data.durationUnits ?? route.durationUnits ?? 'minutes', 'min')
  const rawSteps: any[] = Array.isArray(data.directions) ? data.directions : Array.isArray(data.directions?.features) ? data.directions.features : Array.isArray(data.steps) ? data.steps : Array.isArray(route.directions) ? route.directions : []
  const steps = rawSteps.map(s => typeof s === 'string' ? s : String(s?.text ?? s?.instruction ?? s?.attributes?.text ?? '')).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 40)
  if (!path.length && !distance && !steps.length) return null
  return { path, distance, time, steps }
}

/** "Route from A to B", "directions to the library", "how do I walk from A to B". */
export function parseRoute (text: string): { from: string, to: string, mode: TravelMode, shortest: boolean } | null {
  const t = text.trim().replace(/[?.!]+$/, '')
  const mode: TravelMode = /\b(?:walk|walking|on foot)\b/i.test(t) ? 'walking' : /\b(?:truck|trucking)\b/i.test(t) ? 'trucking' : 'driving'
  const shortest = /\bshortest\b/i.test(t)
  const m = t.match(/^(?:what(?:'s| is) the |show (?:me )?(?:the |a )?|get (?:me )?(?:the |a )?|give me (?:the |a )?|find (?:me )?(?:the |a )?|plan (?:me )?(?:the |a )?)?(?:(?:fastest|shortest|best|quickest|driving|walking|truck(?:ing)?) )*(?:route|directions|way|path|drive|walk)\s+(?:from\s+(.+?)\s+)?to\s+(.+?)(?:\s+from\s+(.+))?$/i) ||
    t.match(/^how (?:do|can|would) (?:i|we|you) (?:get|drive|walk|go)\s+(?:from\s+(.+?)\s+)?to\s+(.+?)(?:\s+from\s+(.+))?$/i) ||
    t.match(/^(?:drive|walk|navigate|take me|route me|directions)\s+(?:from\s+(.+?)\s+)?to\s+(.+?)(?:\s+from\s+(.+))?$/i)
  if (!m) return null
  const strip = (s: string): string => String(s || '').replace(/\s+(?:by (?:car|foot|truck)|on foot|walking|driving)$/i, '').trim()
  const to = strip(m[2]); const from = strip(m[1] || m[3] || '')
  if (!to || to.length > 80 || from.length > 80) return null
  return { from, to, mode, shortest }
}

// ------------------------------------------------------------ portal content

export interface PortalItem { id: string, title: string, type: string, url: string, snippet: string, owner: string, layers: Array<{ id: number, name: string, isTable?: boolean }> }

const ITEM_TYPES: Array<[RegExp, string]> = [
  [/\bweb ?maps?\b|\bmaps?\b/i, 'Web Map'], [/\bdashboards?\b/i, 'Dashboard'], [/\b(?:web )?(?:apps?|applications?|experiences?)\b/i, 'Web Experience'],
  [/\bfeature (?:services?|layers?)\b|\blayers?\b|\bdata(?:sets?)?\b|\btables?\b/i, 'Feature Service'], [/\bmap services?\b/i, 'Map Service'], [/\bstory ?maps?\b|\bstories\b/i, 'StoryMap'], [/\bscenes?\b/i, 'Web Scene']
]

/**
 * "Find maps about zoning", "search the portal for flood data", "is there a layer for bus stops",
 * "what dashboards do we have". The words to search for, and an item type only when one was named.
 */
export function parseContentSearch (text: string): { q: string, type?: string } | null {
  const t = text.trim().replace(/[?.!]+$/, '')
  let m = t.match(/^(?:search|look|check) (?:in |through |on )?(?:the |our |my )?(?:portal|organization|org|enterprise|arcgis)(?: content)? for (.{2,80})$/i)
  if (m) return typed(m[1])
  m = t.match(/^(?:find|search for|look for|show me|list|are there|is there|do we have|what) (?:me )?(?:any |an? |the |all |some |our )?((?:web ?maps?|maps?|dashboards?|apps?|applications?|experiences?|feature (?:services?|layers?)|layers?|data(?:sets?)?|tables?|story ?maps?|scenes?|items?|content))(?: (?:do we have|are there|exist))?(?: (?:about|for|on|of|with|showing|related to|named|called|tagged) (.{2,80}?))?(?: in (?:the |our )?(?:portal|organization|org))?$/i)
  // Without "about X" it must say the portal or "do we have": "list layers" is about this map.
  if (m && (m[2] || /\b(?:portal|organization|org)\b/i.test(t) || /\bdo we have\b/i.test(t))) {
    const type = /^(?:items?|content)$/i.test(m[1]) ? undefined : ITEM_TYPES.find(([re]) => re.test(m![1]))?.[1]
    return { q: (m[2] || '').trim(), type }
  }
  return null
}
function typed (words: string): { q: string, type?: string } {
  const m = words.match(/^(?:any |an? |the |all )?((?:web ?maps?|maps?|dashboards?|apps?|feature (?:services?|layers?)|layers?|story ?maps?|scenes?)) (?:about|for|on|of|showing) (.+)$/i)
  if (m) return { q: m[2].trim(), type: ITEM_TYPES.find(([re]) => re.test(m[1]))?.[1] }
  return { q: words.trim() }
}

export function searchArgs (tool: McpTool, q: string, type?: string, num = 8): { [k: string]: any } {
  const args: { [k: string]: any } = {}
  put(args, tool, ['q', 'query', 'text'], q)
  put(args, tool, ['type'], type)
  put(args, tool, ['num', 'pageSize', 'limit'], num)
  return args
}

function layerList (def: any): Array<{ id: number, name: string, isTable?: boolean }> {
  const out: Array<{ id: number, name: string, isTable?: boolean }> = []
  for (const l of Array.isArray(def?.layers) ? def.layers : []) if (Number.isInteger(Number(l?.id)) && !Array.isArray(l?.subLayerIds)) out.push({ id: Number(l.id), name: String(l.name || `Layer ${l.id}`) })
  for (const l of Array.isArray(def?.tables) ? def.tables : []) if (Number.isInteger(Number(l?.id))) out.push({ id: Number(l.id), name: String(l.name || `Table ${l.id}`), isTable: true })
  return out
}

/** Portal items in a search or describe_item answer. */
export function readItems (data: any): PortalItem[] {
  const list: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : data?.id ? [data] : data?.item?.id ? [data] : []
  const out: PortalItem[] = []
  for (const row of list) {
    const it = row?.item?.id ? row.item : row
    if (!it || typeof it.id !== 'string' || !/^[0-9a-f]{32}$/i.test(it.id)) continue
    const def = row.serviceDefinition || row.additionalDetails || row.definition || it.serviceDefinition || it.additionalDetails
    out.push({
      id: it.id, title: String(it.title || it.name || 'Untitled').trim(), type: String(it.type || '').trim(),
      url: typeof it.url === 'string' && /^https:\/\//i.test(it.url) ? it.url.replace(/\/+$/, '') : '',
      snippet: String(it.snippet || it.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
      owner: String(it.owner || '').trim(), layers: layerList(def)
    })
  }
  return out
}

/** An item that holds records Mappy can ask questions of. */
export function queryable (it: PortalItem): boolean { return !!it.url && /\/(?:FeatureServer|MapServer)(?:\/\d+)?$/i.test(it.url) }

/** describe_layer wants the service and the layer number apart: ".../FeatureServer/2" is service + 2. */
export function layerRef (url: string, layerId?: number): { serviceUrl: string, layerId: number } {
  const clean = url.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const m = clean.match(/^(.*\/(?:FeatureServer|MapServer))\/(\d+)$/i)
  return m ? { serviceUrl: m[1], layerId: layerId ?? Number(m[2]) } : { serviceUrl: clean, layerId: layerId ?? 0 }
}

export function describeLayerArgs (tool: McpTool, url: string, layerId?: number): { [k: string]: any } {
  const ref = layerRef(url, layerId)
  const args: { [k: string]: any } = {}
  put(args, tool, ['serviceUrl', 'url'], ref.serviceUrl)
  const k = key(tool, 'layerId', 'layer')
  if (k) args[k] = ref.layerId
  return args
}

export function describeItemArgs (tool: McpTool, id: string): { [k: string]: any } {
  const args: { [k: string]: any } = {}
  put(args, tool, ['itemId', 'id', 'item'], id)
  return args
}

/** The layer of a service whose name best fits the words asked about (the first one when none stands out). */
export function pickLayer (layers: Array<{ id: number, name: string, isTable?: boolean }>, words: string): { id: number, name: string, isTable?: boolean } | null {
  if (!layers.length) return null
  const flat = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(w => w.length > 2).map(w => w.replace(/(?:es|s)$/, ''))
  const want = flat(words)
  let best = layers[0]; let top = 0
  for (const l of layers) {
    const have = flat(l.name)
    const score = want.filter(w => have.includes(w)).length / Math.max(1, have.length) + (l.isTable ? -0.01 : 0)
    if (score > top) { top = score; best = l }
  }
  return best
}

/**
 * A describe_layer answer as the schema Mappy's question reader works from: the fields, and
 * for text fields the example values Esri sends (real values from the layer), so "zoned R-4"
 * can land on the right field.
 */
export function readLayerSchema (data: any, layerKey: string, fallbackTitle: string): (AskLayer & { objectIdField: string, geometryType: string, maxRecordCount: number }) | null {
  const d = data?.layer || data?.definition || data
  const list: any[] = Array.isArray(d?.fields) ? d.fields : []
  const fields: QueryField[] = []
  const values: { [f: string]: string[] } = {}
  for (const f of list) {
    const name = String(f?.name || '')
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) continue
    const type = String(f.type || f.fieldType || 'esriFieldTypeString')
    fields.push({ name, alias: String(f.alias || name), type, domain: f.domain || undefined })
    const samples = f.sampleValues ?? f.samples ?? f.exampleValues ?? f.examples ?? f.sample_values
    if (/string/i.test(type) && Array.isArray(samples)) {
      const seen = Array.from(new Set(samples.filter((v: any) => v !== null && v !== undefined && String(v).trim() !== '').map((v: any) => String(v).trim()))) as string[]
      if (seen.length && seen.every(v => v.length <= 60)) values[name] = seen.slice(0, 60)
    }
  }
  if (!fields.length) return null
  const oid = String(d.objectIdField || fields.find(f => /oid$/i.test(f.type || ''))?.name || '')
  const display = String(d.displayField || d.displayFieldName || '')
  return {
    key: layerKey, title: String(d.name || fallbackTitle || 'Layer').trim(), fields, values,
    displayField: fields.some(f => f.name === display) ? display : undefined,
    isTable: /table/i.test(String(d.type || '')) || undefined,
    objectIdField: oid, geometryType: String(d.geometryType || ''), maxRecordCount: Number(d.maxRecordCount) || 1000
  }
}

// ------------------------------------------------------------ query_data

export interface RemoteQuery {
  where?: string
  statistics?: Array<{ type: string, field: string, as: string }>
  groupBy?: string
  orderBy?: string[]
  pageSize?: number
  offset?: number
}

/** query_data inputs, shaped by the tool's own schema where it says how a list item looks. */
export function queryArgs (tool: McpTool, layerUrl: string, q: RemoteQuery): { [k: string]: any } {
  const args: { [k: string]: any } = {}
  put(args, tool, ['layerOrTableUrl', 'layerUrl', 'url'], layerUrl)
  put(args, tool, ['where'], q.where && q.where !== '1=1' ? q.where : undefined)
  if (q.statistics?.length) put(args, tool, ['statistics', 'outStatistics'], q.statistics.map(s => ({ statisticType: s.type, onField: s.field })))
  if (q.groupBy) put(args, tool, ['groupByField', 'groupByFieldsForStatistics'], q.groupBy)
  if (q.orderBy?.length) {
    const k = key(tool, 'orderByFields', 'orderBy')
    const item: any = k ? (props(tool)[k] as any)?.items : null
    const ip = item?.properties ? Object.keys(item.properties) : []
    // A list of objects when the schema says so ({field, order}); else "FIELD DESC" as ArcGIS REST writes it.
    if (k && ip.length) {
      const fk = ip.find(p => /field|name|column/i.test(p)) || ip[0]; const ok = ip.find(p => /order|direction|sort/i.test(p))
      args[k] = q.orderBy.map(o => { const [f, dir] = o.split(/\s+/); const row: any = { [fk]: f }; if (ok) row[ok] = pickEnum(item.properties[ok]?.enum, dir || 'ASC'); return row })
    } else if (k) args[k] = q.orderBy
  }
  if (!q.statistics?.length) { put(args, tool, ['pageSize', 'num', 'resultRecordCount'], Math.max(1, Math.min(1000, q.pageSize || 100))); if (q.offset) put(args, tool, ['resultOffset', 'offset'], q.offset) }
  put(args, tool, ['returnGeometry'], false)
  return args
}
function pickEnum (list: any, dir: string): string {
  const want = /desc/i.test(dir) ? 'desc' : 'asc'
  return Array.isArray(list) ? (list.find((v: any) => String(v).toLowerCase().startsWith(want)) ?? dir) : dir.toUpperCase()
}

const attrsOf = (row: any): { [k: string]: any } => (row && typeof row === 'object' ? (row.attributes || row.properties || row) : {})

/** The records, statistics rows and total in a query_data answer. */
export function readQuery (data: any): { rows: Array<{ [k: string]: any }>, stats: Array<{ [k: string]: any }>, total: number | null, more: boolean } {
  if (!data || typeof data !== 'object') return { rows: [], stats: [], total: null, more: false }
  const firstList = (...lists: any[]): any[] => lists.find(l => Array.isArray(l)) || []
  const rows = firstList(data.features, data.records, data.rows, data.results, data.data, Array.isArray(data) ? data : undefined).map(attrsOf)
  const stats = firstList(data.statistics, data.stats, data.aggregations).map(attrsOf)
  const totalRaw = data.totalCount ?? data.total ?? data.count ?? data.matchingRecords ?? data.totalRecords
  const total = Number.isFinite(Number(totalRaw)) && totalRaw !== null && totalRaw !== '' ? Number(totalRaw) : null
  const more = !!(data.exceededTransferLimit || data.hasMore || data.moreRecordsAvailable) || (total !== null && total > rows.length && !stats.length)
  return { rows, stats, total, more }
}

/** One statistic out of a statistics row: Esri names it "{type}_{field}" ("avg_Acres"); letter case and an alias are tolerated. */
export function statValue (row: { [k: string]: any }, type: string, field: string, alias?: string): any {
  const want = `${type}_${field}`.toLowerCase()
  for (const k of Object.keys(row)) if (k.toLowerCase() === want) return row[k]
  if (alias) for (const k of Object.keys(row)) if (k.toLowerCase() === alias.toLowerCase()) return row[k]
  // One number in the row and one statistic asked for: that is it.
  const nums = Object.keys(row).filter(k => typeof row[k] === 'number')
  return nums.length === 1 ? row[nums[0]] : undefined
}

// ------------------------------------------------------------ maps and geoprocessing

/** A get_map_image answer: the temporary https address of the picture. */
export function readMapImage (data: any): { src: string, width?: number, height?: number } | null {
  const href = data?.href || data?.url || data?.imageUrl
  return typeof href === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(href) ? { src: href, width: Number(data.width) || undefined, height: Number(data.height) || undefined } : null
}

/** A geoprocessing answer that is still running: its job and state. */
export function readJob (data: any): { id: string, state: 'running' | 'done' | 'failed', message: string } | null {
  const id = data?.jobId || data?.jobID || data?.job_id
  if (typeof id !== 'string' || !id) return null
  const s = String(data.jobStatus || data.status || '').toLowerCase()
  const state = /succeed/.test(s) ? 'done' : /fail|cancel|timed/.test(s) ? 'failed' : 'running'
  const msgs: any[] = Array.isArray(data.messages) ? data.messages : []
  return { id, state, message: msgs.map(m => typeof m === 'string' ? m : String(m?.description || '')).filter(Boolean).slice(-2).join(' ').slice(0, 300) }
}

/** The thing a data question is about, when no layer on the map answers it: "how many bus stops are there" -> "bus stops". */
export function askedThing (text: string): string | null {
  const t = text.trim().replace(/[?.!]+$/, '').replace(/\s+/g, ' ')
  const m = t.match(/^(?:how many|count(?: (?:the|all))?|number of|list(?: (?:the|all))?|show me (?:the|all)?|which|what is the (?:average|total|largest|smallest|biggest|oldest|newest|longest) (?:\w+ )?(?:of|for) (?:the |all )?|(?:the )?(?:largest|smallest|biggest|oldest|newest|longest|most \w+|least \w+))\s+(.+)$/i)
  if (!m) return null
  const thing = m[1].replace(/\s+(?:are|is|were|was|do|does|did|have|has|that|which|with|where|in|on|by|over|under|above|below|more|less|built|installed|zoned|owned|since|before|after|greater|at least|at most)\b.*$/i, '').replace(/^(?:the|all|of the|of) /i, '').trim()
  return thing.length >= 3 && thing.length <= 50 && !/^(?:there|them|those|these|it|that)$/i.test(thing) ? thing : null
}

// ------------------------------------------------------------ finding the endpoint

/**
 * The default catalog's address from whatever the builder has: the hosting server
 * ("https://host/server"), its REST address, or the endpoint itself. '' when it is not https.
 */
export function enterpriseMcpUrl (input: string): string {
  const u = String(input || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '')
  if (!/^https:\/\/[^/\s]+\/[^\s]+$/i.test(u)) return ''
  if (/\/mcp\/[^/]+$/i.test(u)) return u
  return u.replace(/\/(?:rest(?:\/services.*)?|admin|manager|mcp)$/i, '') + '/mcp/default'
}

/** True for an address that is an ArcGIS Enterprise MCP catalog (default or custom). */
export function isEnterpriseMcpUrl (url: string): boolean { return /^https:\/\/[^/\s]+\/[^\s]+\/mcp\/(?:default|[0-9a-f]{32})$/i.test(String(url || '').trim()) }

/** The hosting server's address in a portal's list of federated servers (portals/self/servers). */
export function hostingServerUrl (data: any): string {
  const list: any[] = Array.isArray(data?.servers) ? data.servers : []
  const host = list.find(s => /HOSTING/i.test(String(s?.serverRole || ''))) || list.find(s => s?.isHosted) || null
  const url = String(host?.url || '').replace(/\/+$/, '')
  return /^https:\/\//i.test(url) ? url : ''
}
