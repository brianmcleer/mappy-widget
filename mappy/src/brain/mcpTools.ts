/*
  mcpTools.ts - the second way Mappy can help: tools on an MCP server (Model Context
  Protocol) the builder connects in settings, such as ArcGIS Location Platform's MCP
  (geocoding, routing, elevation, static maps) or a portal MCP server (content search,
  feature queries). Mappy still has no language model: he picks the tool whose name and
  description best match the request, fills its inputs from what was typed, asks before
  anything that could change data, and turns the answer into words, a table or a picture.

  Pure TypeScript: picking, filling, safety rules and result formatting. The network client
  is runtime/mcp.ts.
*/
import type { Doc } from './types'
import { MappyIndex } from './engine'
import { clip, flat } from './text'

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: { type?: string, properties?: { [k: string]: McpProp }, required?: string[] }
  annotations?: { title?: string, readOnlyHint?: boolean, destructiveHint?: boolean, idempotentHint?: boolean, openWorldHint?: boolean }
}
export interface McpProp { type?: string | string[], description?: string, enum?: any[], default?: any, items?: any }

/** The builder's choice for one tool (settings). */
export interface McpToolPref { name: string, enabled: boolean, confirm?: boolean }

/** What the runtime gives the Mind: a connected server, already filtered by the builder's choices. */
export interface McpPort {
  label: string
  /** Offer the server when Mappy cannot answer from the app himself. */
  fallback: boolean
  tools: () => Promise<McpTool[]>
  call: (name: string, args: { [k: string]: any }) => Promise<any>
  prefs?: McpToolPref[]
}

/** Verbs that change something, matched as whole words in the tool name ("deleteFeatures", "apply_edits"). */
const CHANGE_VERBS = new Set(('add create insert update edit edits apply delete remove drop truncate publish share unshare move clone ' +
  'upload import offboard reassign stop start restart clean purge set write invite sync execute submit modify send post overwrite ' +
  'patch put append replace rename disable enable reset revoke grant transfer cancel approve reject merge split register unregister').split(' '))

function nameWords (name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean)
}

/**
 * Could this tool change something? The server's hints decide; without hints, the words in its
 * name ("delete_features", "deleteFeatures"). A run-together name ("deletefeatures") starts
 * with a verb too.
 */
export function changesData (t: McpTool): boolean {
  if (t.annotations?.destructiveHint) return true
  if (t.annotations?.readOnlyHint === true) return false
  if (t.annotations?.readOnlyHint === false) return true
  const words = nameWords(t.name)
  if (words.some(w => CHANGE_VERBS.has(w))) return true
  const flatName = t.name.toLowerCase().replace(/[^a-z]/g, '')
  return words.length === 1 && !/^address/.test(flatName) && Array.from(CHANGE_VERBS).some(v => v.length >= 3 && flatName.startsWith(v) && flatName.length > v.length)
}

/** Tools people may use: the builder's list when there is one, otherwise read-only tools only. */
export function usableTools (tools: McpTool[], prefs?: McpToolPref[]): McpTool[] {
  if (prefs && prefs.length) {
    const on = new Map(prefs.filter(p => p.enabled).map(p => [p.name, p]))
    return tools.filter(t => on.has(t.name))
  }
  return tools.filter(t => !changesData(t))
}

/** Ask before running? Always for tools that could change data; otherwise the builder decides. */
export function needsConfirm (t: McpTool, prefs?: McpToolPref[]): boolean {
  if (changesData(t)) return true
  return !!prefs?.find(p => p.name === t.name)?.confirm
}

export function toolLabel (t: McpTool): string {
  return t.annotations?.title || t.title || t.name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase())
}

const STREET = /\b\d+[a-z]?\s+(?:[nsew]\.?\s+)?[\w.' -]*\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pl|place|hwy|highway|pkwy|parkway|cir|circle|trl|trail)\b/i

/** What a request looks like, in words tools use: an address, a point, directions. */
function cues (q: string): string {
  const out: string[] = []
  if (STREET.test(q) || /^(?:where is|where's|locate|geocode)\b/i.test(q.trim())) out.push('geocode address location place find')
  if (/-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(q)) out.push('latitude longitude point location')
  if (/\b(directions?|route|drive|driving|walk|walking|get from|how do i get)\b|\bfrom\b.+\bto\b/i.test(q)) out.push('route directions travel from to')
  if (/\b(picture|image|snapshot|static map|map of)\b/i.test(q)) out.push('static map image picture')
  if (/\b(how high|elevation|altitude|height above)\b/i.test(q)) out.push('elevation height')
  return out.join(' ')
}

/** The tool that best matches a request, or null when nothing clearly fits. */
export function matchTool (q: string, tools: McpTool[]): { tool: McpTool, score: number } | null {
  if (!tools.length) return null
  const fq = flat(q)
  const named = tools.find(t => fq === flat(t.name) || fq.startsWith(flat(t.name) + ' ') || fq.startsWith(flat(toolLabel(t)) + ' '))
  if (named) return { tool: named, score: 99 }
  const docs: Doc[] = tools.map((t, i) => ({
    id: String(i),
    kind: 'doc',
    title: toolLabel(t) + ' ' + t.name.replace(/[_-]+/g, ' '),
    text: clip(t.description || '', 600),
    keys: Object.keys(t.inputSchema?.properties || {}).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  }))
  const hits = new MappyIndex(docs).search(q + ' ' + cues(q), { limit: 2 })
  if (!hits.length || hits[0].score < 1.2) return null
  if (hits[1] && hits[0].score < hits[1].score * 1.2) return null
  return { tool: tools[Number(hits[0].doc.id)], score: hits[0].score }
}

const FREE = /^(address|single ?line|singleline|query|q|text|search|search ?text|keyword|keywords|term|location|place|name|input|prompt|question|where|filter)$/i
const LAT = /^(lat|latitude|y)$/i
const LON = /^(lon|lng|long|longitude|x)$/i

function typeOf (p: McpProp): string { return Array.isArray(p.type) ? (p.type.find(x => x !== 'null') || 'string') : (p.type || 'string') }

function coerce (p: McpProp, v: string): any {
  const t = typeOf(p)
  const s = v.trim().replace(/^["']|["']$/g, '')
  if (t === 'number' || t === 'integer') { const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? (t === 'integer' ? Math.round(n) : n) : undefined }
  if (t === 'boolean') return /^(true|yes|on|1)$/i.test(s) ? true : /^(false|no|off|0)$/i.test(s) ? false : undefined
  if (t === 'array') return s.split(/\s*[,;]\s*/).filter(Boolean)
  if (t === 'object') { try { return JSON.parse(s) } catch (e) { return undefined } }
  return s
}

/** Where the map is right now, for inputs the request leaves out ("elevation here"). Latitude and longitude in WGS84. */
export interface MapContext {
  center?: [number, number]
  zoom?: number
  /** [xmin, ymin, xmax, ymax] in longitude and latitude. */
  extent?: [number, number, number, number]
}

const HERE = /\b(here|this (?:spot|place|point|area|map|view)|the map cent(?:er|re)|map cent(?:er|re)|middle of the map|current (?:view|location|map))\b/i
const PLACE_OBJ = /^(location|point|center|centre|position|coordinates?|geometry)$/i
const EXTENT = /^(extent|bbox|bounds|bounding ?box|envelope)$/i

/**
 * Fills a tool's inputs from what was typed: "name=value" pairs, coordinates, numbers, listed
 * choices, and the rest of the request for the one free-text input (an address, a query).
 * With a map context, inputs for a place, zoom or extent the request leaves out (or calls
 * "here") come from the map as it is now.
 */
export function fillArgs (tool: McpTool, text: string, map?: MapContext): { args: { [k: string]: any }, missing: string[] } {
  const out = fillFromText(tool, HERE.test(text) && map?.center ? text.replace(HERE, ' ') : text)
  if (!map) return out
  const props = tool.inputSchema?.properties || {}
  const required = tool.inputSchema?.required || []
  const args = out.args
  const here = HERE.test(text)
  const want = (k: string) => args[k] === undefined && (required.includes(k) || here)
  const keys = Object.keys(props)
  const latKey = keys.find(k => LAT.test(k)); const lonKey = keys.find(k => LON.test(k))
  if (map.center && latKey && lonKey && want(latKey) && want(lonKey)) { args[latKey] = round(map.center[0]); args[lonKey] = round(map.center[1]) }
  // "here" means the map, even where the free text would otherwise have gone.
  if (here) for (const k of keys) if (PLACE_OBJ.test(k) && typeof args[k] === 'string' && !/\d/.test(args[k])) delete args[k]
  for (const k of keys) {
    if (!want(k)) continue
    const p = props[k]; const ty = typeOf(p)
    if (map.center && PLACE_OBJ.test(k)) {
      if (ty === 'object') args[k] = { x: round(map.center[1]), y: round(map.center[0]), spatialReference: { wkid: 4326 } }
      else if (ty === 'array') args[k] = [round(map.center[1]), round(map.center[0])]
      else if (ty === 'string') args[k] = `${round(map.center[1])},${round(map.center[0])}`
    } else if (map.extent && EXTENT.test(k.replace(/[_-]+/g, ' '))) {
      const [a, b, c, d] = map.extent.map(round)
      if (ty === 'object') args[k] = { xmin: a, ymin: b, xmax: c, ymax: d, spatialReference: { wkid: 4326 } }
      else if (ty === 'array') args[k] = [a, b, c, d]
      else if (ty === 'string') args[k] = `${a},${b},${c},${d}`
    } else if (map.zoom !== undefined && /^(zoom|zoom ?level|level|lod)$/i.test(k.replace(/[_-]+/g, ' ')) && ['number', 'integer'].includes(ty)) {
      args[k] = Math.round(map.zoom)
    }
  }
  return { args, missing: required.filter(k => args[k] === undefined || args[k] === '') }
}

function round (n: number): number { return Math.round(n * 1e6) / 1e6 }

function fillFromText (tool: McpTool, text: string): { args: { [k: string]: any }, missing: string[] } {
  const props = tool.inputSchema?.properties || {}
  const required = tool.inputSchema?.required || []
  const args: { [k: string]: any } = {}
  const keys = Object.keys(props)
  const byFlat = new Map(keys.map(k => [flat(k).replace(/ /g, ''), k]))
  let rest = String(text || '')

  // Listed choices named in the text ("driving", "walking").
  for (const k of keys) {
    const e = props[k].enum
    if (args[k] !== undefined || !Array.isArray(e)) continue
    const esc = (v: string) => v.slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const hit = e.slice(0, 50).find(v => typeof v === 'string' && v.length > 0 && new RegExp('(?:^|[^\\w])' + esc(v) + '(?![\\w])', 'i').test(rest))
    if (hit !== undefined) { args[k] = hit; rest = rest.replace(new RegExp('(^|[^\\w])' + esc(String(hit)) + '(?![\\w])', 'i'), '$1 ') }
  }
  // name=value, name: value
  rest = rest.replace(/\b([A-Za-z_][\w]*)\s*[=:]\s*("[^"]*"|'[^']*'|[^,;]+)/g, (m, k, v) => {
    const key = byFlat.get(flat(k).replace(/ /g, ''))
    if (!key) return m
    const val = coerce(props[key], v)
    if (val === undefined) return m
    args[key] = val
    return ' '
  })
  // "from City Hall to the library" for from/to (origin/destination, start/end) inputs.
  const pair = [['from', 'to'], ['origin', 'destination'], ['start', 'end'], ['start', 'stop']].map(([a, b]) => [keys.find(k => flat(k) === a), keys.find(k => flat(k) === b)]).find(([a, b]) => a && b)
  if (pair && args[pair[0]!] === undefined && args[pair[1]!] === undefined) {
    const m = rest.match(/\bfrom\s+(.+?)\s+to\s+(.+?)\s*[?.!]*$/i)
    if (m) { args[pair[0]!] = m[1].trim(); args[pair[1]!] = m[2].trim(); rest = rest.replace(m[0], ' ') }
  }
  // "39.06, -108.55": latitude then longitude
  const ll = rest.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/)
  const latKey = keys.find(k => LAT.test(k)); const lonKey = keys.find(k => LON.test(k))
  if (ll && latKey && lonKey && args[latKey] === undefined && args[lonKey] === undefined) {
    args[latKey] = Number(ll[1]); args[lonKey] = Number(ll[2]); rest = rest.replace(ll[0], ' ')
  }
  // "<name> 5" for number inputs, or the only number for the only number input.
  const numKeys = keys.filter(k => ['number', 'integer'].includes(typeOf(props[k])) && args[k] === undefined && !LAT.test(k) && !LON.test(k))
  for (const k of numKeys) {
    if (!/^[\w -]{1,40}$/.test(k)) continue
    const words = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = rest.match(new RegExp('\\b' + words + '\\s+(?:of\\s+|to\\s+)?(-?\\d+(?:\\.\\d+)?)', 'i'))
    if (m) { args[k] = coerce(props[k], m[1]); rest = rest.replace(m[0], ' ') }
  }
  const leftNums = rest.match(/-?\d+(?:\.\d+)?(?![\w.])/g) || []
  const openNum = numKeys.filter(k => args[k] === undefined)
  if (openNum.length === 1 && leftNums.length === 1 && !/[a-z]/i.test(rest.replace(leftNums[0], '').replace(/\b(top|limit|max|count|of|the|show|me|results?)\b/gi, '').trim())) {
    args[openNum[0]] = coerce(props[openNum[0]], leftNums[0])
  }
  // The rest of the request for the one free-text input.
  const free = rest.replace(new RegExp('\\b(' + [tool.name, toolLabel(tool)].map(s => flat(s).replace(/[^a-z0-9 ]/g, '').replace(/ /g, '\\s+')).filter(Boolean).join('|') + ')\\b', 'ig'), ' ')
    .replace(/^\s*(?:please\s+)?(?:use|run|call|ask)\b/i, ' ')
    .replace(/^\s*(?:the\s+)?(?:tool|server|mcp)\b/i, ' ')
    .replace(/^\s*(?:with|for|on|about|to)\b/i, ' ')
    .replace(/^\s*(?:where(?:'s| is| are)|find|locate|look up|lookup|show me|what(?:'s| is))\b/i, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:?!.]+$/g, '')
  const strKeys = keys.filter(k => typeOf(props[k]) === 'string' && args[k] === undefined && !props[k].enum)
  const target = strKeys.find(k => FREE.test(k.replace(/[_-]+/g, ' '))) ||
    (strKeys.filter(k => required.includes(k)).length === 1 ? strKeys.find(k => required.includes(k)) : undefined) ||
    (strKeys.length === 1 ? strKeys[0] : undefined)
  if (target && free) args[target] = free
  for (const k of keys) if (args[k] === undefined && props[k].default !== undefined) args[k] = props[k].default
  return { args, missing: required.filter(k => args[k] === undefined || args[k] === '') }
}

/** A short, readable "name=value" list for confirmations. */
export function describeArgs (args: { [k: string]: any }): string {
  const parts = Object.keys(args).map(k => `${k} = ${typeof args[k] === 'string' ? `“${clip(args[k], 60)}”` : clip(JSON.stringify(args[k]), 60)}`)
  return parts.length ? parts.join(', ') : 'no inputs'
}

export interface McpView {
  text: string
  table?: { columns: string[], rows: string[][] }
  image?: { src: string, alt: string }
  /** Where to zoom: [latitude, longitude]. */
  point?: [number, number]
  error?: boolean
}

function scalar (v: any): boolean { return v === null || ['string', 'number', 'boolean'].includes(typeof v) }

/** Rows inside a JSON answer: the answer itself, or its first list of objects (candidates, features, results...). */
function rowsIn (v: any, depth = 0): any[] | null {
  if (Array.isArray(v)) return v.length && v.every(x => x && typeof x === 'object') ? v : null
  if (!v || typeof v !== 'object' || depth > 3) return null
  for (const k of Object.keys(v)) { const r = rowsIn(v[k], depth + 1); if (r) return r }
  return null
}

function flatRow (o: any): { [k: string]: any } {
  const out: { [k: string]: any } = {}
  for (const k of Object.keys(o || {})) {
    const v = o[k]
    if (scalar(v)) out[k] = v
    else if (v && typeof v === 'object' && !Array.isArray(v) && (k === 'attributes' || k === 'properties')) Object.assign(out, flatRow(v))
  }
  return out
}

function pointIn (o: any): [number, number] | null {
  if (!o || typeof o !== 'object') return null
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v))
  const pick = (x: any, y: any) => (num(x) && num(y) && Math.abs(+y) <= 90 && Math.abs(+x) <= 180 && (+x !== 0 || +y !== 0)) ? [+y, +x] as [number, number] : null
  const cands = [o.location, o.geometry, o, o.attributes, o.properties, o.point]
  for (const c of cands) {
    if (!c || typeof c !== 'object') continue
    const p = pick(c.longitude ?? c.lon ?? c.lng ?? c.x, c.latitude ?? c.lat ?? c.y)
    if (p) return p
    if (Array.isArray(c.coordinates) && c.coordinates.length >= 2 && scalar(c.coordinates[0])) { const q = pick(c.coordinates[0], c.coordinates[1]); if (q) return q }
  }
  return null
}

/** An MCP tools/call result as something Mappy can say and show. */
export function viewResult (result: any, label: string): McpView {
  const content: any[] = Array.isArray(result?.content) ? result.content : []
  const texts = content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text.trim()).filter(Boolean)
  const img = content.find(c => c?.type === 'image' && typeof c.data === 'string' && /^image\/(png|jpe?g|gif|webp)$/.test(c.mimeType || ''))
  if (result?.isError) return { text: `${label} could not do that: ${clip(texts.join(' ') || 'no reason given', 400)}`, error: true }
  let data = result?.structuredContent
  if (data === undefined && texts.length === 1 && /^[[{]/.test(texts[0])) { try { data = JSON.parse(texts[0]) } catch (e) { } }
  const view: McpView = { text: '' }
  if (img) view.image = { src: `data:${img.mimeType};base64,${img.data}`, alt: `Image from ${label}` }
  const rows = data !== undefined ? rowsIn(data) : null
  if (rows) {
    const flatRows = rows.slice(0, 25).map(flatRow)
    const cols: string[] = []
    for (const r of flatRows) for (const k of Object.keys(r)) if (cols.length < 6 && !cols.includes(k) && !/^(objectid|fid|shape|geometry|spatialreference)$/i.test(k)) cols.push(k)
    if (cols.length) view.table = { columns: cols, rows: flatRows.map(r => cols.map(c => r[c] === null || r[c] === undefined ? '' : String(r[c]))) }
    view.point = pointIn(rows[0]) || undefined
    view.text = `${label} found ${rows.length} ${rows.length === 1 ? 'result' : 'results'}${rows.length > 25 ? ' (showing the first 25)' : ''}.`
  } else if (data !== undefined && data !== null && typeof data === 'object') {
    view.point = pointIn(data) || undefined
    const pairs = Object.keys(flatRow(data)).slice(0, 8).map(k => `${k}: ${clip(String(flatRow(data)[k]), 80)}`)
    view.text = pairs.length ? `${label} says: ${pairs.join('; ')}.` : `${label} answered.`
  }
  if (!view.text) view.text = texts.length ? clip(texts.join('\n\n'), 1200) : (img ? `Here is what ${label} sent back.` : `${label} finished with nothing to show.`)
  return view
}
