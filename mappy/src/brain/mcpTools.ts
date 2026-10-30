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
import { keyLabel } from './fields'

export interface McpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: { type?: string, properties?: { [k: string]: McpProp }, required?: string[] }
  annotations?: { title?: string, readOnlyHint?: boolean, destructiveHint?: boolean, idempotentHint?: boolean, openWorldHint?: boolean }
}
export interface McpProp { type?: string | string[], description?: string, enum?: any[], default?: any, items?: any, minimum?: number, maximum?: number }

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

/**
 * Tools people may use: the builder's choice for each tool listed in settings; tools the
 * server added since (not in the saved list yet) are on when they cannot change data.
 */
export function usableTools (tools: McpTool[], prefs?: McpToolPref[]): McpTool[] {
  const chosen = new Map((prefs || []).map(p => [p.name, p]))
  return tools.filter(t => chosen.has(t.name) ? chosen.get(t.name)!.enabled : !changesData(t))
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
  if (HERE.test(q) || /\bwhat(?:'s| is)\s+(?:here|at)\b/i.test(q)) out.push('identify what is at point')
  return out.join(' ')
}

/** The tool that best matches a request, or null when nothing clearly fits. */
export function matchTool (q: string, tools: McpTool[]): { tool: McpTool, score: number } | null {
  return rankTools(q, tools)[0] || null
}

/** A question about things around a place, in plain words. */
export interface PlaceQuestion {
  kind: 'nearest' | 'within' | 'at' | 'summary'
  /** What to look for: "sewer line", "hydrants", "zoning". */
  thing?: string
  /** An address or place name, when one was given. */
  place?: string
  /** "here", "near me": the map. */
  here?: boolean
  limit?: number
  feet?: number
  groupBy?: string
  /** "is 1138 White Ave in city limits": answer yes or no. */
  yesNo?: boolean
  /** A value of the feature there, not which feature: "acres", "year built". */
  field?: string
}

const UNIT_FEET: { [k: string]: number } = { foot: 1, feet: 1, ft: 1, mile: 5280, miles: 5280, mi: 5280, meter: 3.28084, meters: 3.28084, m: 3.28084, metre: 3.28084, metres: 3.28084, block: 330, blocks: 330, yard: 3, yards: 3, yd: 3 }
const ME = /^(?:me|here|my (?:current )?location|where i am|this (?:spot|place|point)|the map(?: center)?|the middle of the map)$/i

function cleanThing (s: string): string {
  return s.replace(/^\s*(?:(?:what|which|where|how many|how far|show me|find|list|tell me|give me|are there|is there|is|are|the|a|an|any|all|some|me|to)\b\s*)+/i, '')
    .replace(/\s+(?:is|are|located|there)\s*$/i, '').replace(/[?.!,]+$/, '').trim()
}

function cleanPlace (s: string): { place?: string, here?: boolean } {
  const p = s.replace(/[?.!]+$/, '').replace(/^\s*(?:the\s+)?(?:address\s+)?/i, '').trim()
  if (!p) return {}
  if (ME.test(p)) return { here: true }
  return { place: p }
}

/** Looks like a street address or a place, not a layer name: "250 N 5th St", "City Hall, Springfield". */
export function looksLikePlace (s: string): boolean {
  return STREET.test(s) || /^\d+\s+\w+/.test(s.trim()) || /^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(s.trim()) || ME.test(s.trim())
}

/**
 * Reads "what is the closest sewer line to 250 N 5th St", "hydrants within 500 ft of here",
 * "what zone is 250 N 5th St", "who owns 123 Main St", "count sewer mains by material".
 */
export function parsePlaceQuestion (input: string): PlaceQuestion | null {
  let q = input.trim().replace(/[?!.]+$/, '').replace(/\s+/g, ' ')
  if (!q || q.length > 300) return null
  // "What parcels are near here", "which hydrants are close to 250 N 5th St": a thing near a place.
  q = q.replace(/^(?:what|which)\s+(.+?)\s+(?:are|is)\s+(?:near|nearby|around|close to|next to)\s+(.+)$/i, '$1 near $2')
  // "Whose property is this", "whose house is that": who owns it.
  q = q.replace(/^whose\s+(?:property|parcel|land|house|lot|building|home)\s+is\s+(this|that|it|here)$/i, 'who owns $1')
  const limited = q.match(/^(?:show|find|give me|just|only)\s+(\d+)\s+(.+)$/i)
  const nearestLimit = q.match(/^(?:the\s+)?(?:closest|nearest)\s+(\d+)\s+(.+)$/i)
  if (limited || nearestLimit) {
    const m = limited || nearestLimit!
    const parsed = parsePlaceQuestion(limited ? m[2] : `closest ${m[2]}`)
    if (parsed && ['nearest', 'within'].includes(parsed.kind)) return { ...parsed, limit: Number(m[1]) }
  }
  // Within a distance: "hydrants within 500 feet of 250 N 5th St", "parks within a mile of me".
  const words = q.replace(/\b(?:a|one) quarter(?: of a)? mile\b|\ba quarter mile\b/i, '1320 ft').replace(/\bhalf (?:a )?mile\b/i, '2640 ft').replace(/\b(?:a|one) mile\b/i, '5280 ft').replace(/\ba block\b/i, '330 ft')
  const within = words.match(/^(.*?)\b(?:within|in(?: a radius of)?|inside)\s+(\d[\d,]*(?:\.\d+)?)\s*(feet|foot|ft|miles?|mi|meters?|metres?|m|blocks?|yards?|yd)\b\s*(?:of|from|around)\s+(.+)$/i)
  if (within) {
    const thing = cleanThing(within[1])
    if (thing) return { kind: 'within', thing, feet: Math.round(Number(within[2].replace(/,/g, '')) * (UNIT_FEET[within[3].toLowerCase()] || 1)), ...cleanPlace(within[4]) }
  }
  // Nearest: "closest sewer line to X", "which hydrant is nearest to me", "how far is the nearest park".
  const near1 = q.match(/^(?:.*?\b)?(?:closest|nearest|close(?:st)? by)\s+(.+?)(?:\s+(?:to|from|near|by|for|around)\s+(.+))?$/i)
  if (near1 && !/^(?:to|from)\b/i.test(near1[1])) {
    const thing = cleanThing(near1[1].replace(/\s+(?:is|are)\s*$/i, ''))
    if (thing) return { kind: 'nearest', thing, ...(near1[2] ? cleanPlace(near1[2]) : {}) }
  }
  const near2 = q.match(/^(.+?)\s+(?:is|are)?\s*(?:the\s+)?(?:closest|nearest|close)\s+(?:to|from)\s+(.+)$/i)
  if (near2 && cleanThing(near2[1])) return { kind: 'nearest', thing: cleanThing(near2[1]), ...cleanPlace(near2[2]) }
  const near3 = q.match(/^(?:(?:are there|is there|any|show me|find|where are(?: the)?)\s+)?(.+?)\s+(?:near|nearby|around|by|next to)\s+(.+)$/i)
  if (near3 && looksLikePlace(cleanPlace(near3[2]).place || (cleanPlace(near3[2]).here ? 'here' : '')) && cleanThing(near3[1])) return { kind: 'nearest', thing: cleanThing(near3[1]), ...cleanPlace(near3[2]) }
  // Summary: "count sewer mains by material", "break down parcels by zoning".
  const sum = q.match(/^(?:how many|count|summari[sz]e|break ?down|tally|group)\s+(?:the\s+)?(.+?)\s+(?:by|per|for each|grouped by)\s+(?:the\s+)?([\w ]{2,40})$/i)
  if (sum) return { kind: 'summary', thing: cleanThing(sum[1]).replace(/\s+(?:are there|there are)$/i, ''), groupBy: sum[2].replace(/\s+(?:are there|is it)$/i, '').trim() }
  // At a place: "who owns 123 Main St", "what zone is 250 N 5th St", "what's at 250 N 5th St", "is 123 Main St in a flood zone".
  const everyday = everydayPlaceQuestion(q)
  if (everyday) return everyday
  const owner = q.match(/^(?:who owns|who is the owner of|owner of|who's the owner of)\s+(.+)$/i)
  if (owner && looksLikePlace(owner[1])) return { kind: 'at', thing: 'parcel', ...cleanPlace(owner[1]) }
  const zoneIs = q.match(/^what\s+(\w[\w ]{1,30}?)\s+is\s+(.+?)(?:\s+in)?$/i)
  if (zoneIs && looksLikePlace(zoneIs[2]) && !/^(?:time|day)$/i.test(zoneIs[1])) return { kind: 'at', thing: zoneIs[1], ...cleanPlace(zoneIs[2]) }
  const theXOf = q.match(/^(?:what(?:'s|s| is| are)|show me|tell me|give me|find|get)\s+(?:the\s+)?(.+?)\s+(?:of|at|for|on)\s+(.+)$/i)
  if (theXOf && looksLikePlace(theXOf[2]) && cleanThing(theXOf[1])) return { kind: 'at', thing: cleanThing(theXOf[1]), ...cleanPlace(theXOf[2]) }
  const inA = q.match(/^(?:is|are)\s+(.+?)\s+(?:in|inside|within|part of|located in)\s+(?:a|an|the)?\s*(.+)$/i)
  if (inA && looksLikePlace(inA[1])) return { kind: 'at', thing: inA[2], yesNo: true, ...cleanPlace(inA[1]) }
  const inB = q.match(/^(?:does|do)\s+(.+?)\s+(?:sit|fall|lie)\s+(?:in|inside|within)\s+(?:a|an|the)?\s*(.+)$/i)
  if (inB && looksLikePlace(inB[1])) return { kind: 'at', thing: inB[2], yesNo: true, ...cleanPlace(inB[1]) }
  const at = q.match(/^(?:what(?:'s|s| is)(?: there)? at|tell me about|what do you know about|info(?:rmation)? (?:on|about|for)|property report (?:for|on)|report (?:for|on)|look up|lookup)\s+(.+)$/i)
  if (at && looksLikePlace(at[1])) return { kind: 'at', ...cleanPlace(at[1]) }
  if (/^(?:what(?:'s|s| is) (?:here|at this (?:spot|point|place))|what am i looking at|tell me about (?:here|this (?:spot|place)))$/i.test(q)) return { kind: 'at', here: true }
  return null
}

/**
 * The ways people ask about a property that are not "what X is Y in": pickup days, schools,
 * representatives, who serves it, its size and age. Each maps onto a layer word (and a field
 * for size and age), so the same server tools answer them.
 */
function everydayPlaceQuestion (q: string): PlaceQuestion | null {
  const P = (s: string) => looksLikePlace(s.trim()) || /^my (?:address|house|home|place)$/i.test(s.trim())
  const at = (thing: string, place: string, field?: string): PlaceQuestion => ({ kind: 'at', thing, ...(field ? { field } : {}), ...cleanPlace(place) })
  let m: RegExpMatchArray | null
  // Pickup: "when is trash pickup at X", "what day is recycling for X", "trash day for X".
  if ((m = q.match(/^(?:when|what day|which day)\s+(?:is|are|does|do)\s+(?:the\s+)?(trash|garbage|refuse|recycling|recycle|yard waste|compost)\b.*?\s+(?:at|for|on|in)\s+(.+)$/i)) && P(m[2])) return at(/recycl/i.test(m[1]) ? 'recycling pickup day' : 'trash pickup day', m[2])
  if ((m = q.match(/^(?:(?:what(?:'s|s| is)\s+(?:the\s+)?)?)(trash|garbage|recycling)\s+(?:pickup\s+)?day\s+(?:at|for)\s+(.+)$/i)) && P(m[2])) return at(/recycl/i.test(m[1]) ? 'recycling pickup day' : 'trash pickup day', m[2])
  // Schools: "which school does X go to", "what high school is X zoned for".
  if ((m = q.match(/^(?:what|which)\s+(elementary|middle|high|junior high)?\s*school\s+(?:does|do|is|would)\s+(.+?)\s+(?:go to|attend|zoned for|in|feed (?:in)?to|belong to)$/i)) && P(m[2])) return at(`${m[1] ? m[1] + ' ' : ''}school attendance`, m[2])
  if ((m = q.match(/^(?:what|which)\s+(elementary|middle|high|junior high)?\s*schools?\s+(?:serve|serves|cover|covers)\s+(.+)$/i)) && P(m[2])) return at(`${m[1] ? m[1] + ' ' : ''}school attendance`, m[2])
  // "which council district is X in", "what fire district is X in".
  if ((m = q.match(/^(?:what|which)\s+(.{3,40}?)\s+(?:is|are)\s+(.+?)\s+(?:in|within|inside|part of)$/i)) && P(m[2]) && !/^(?:closest|nearest)/i.test(m[1])) { const thing = cleanThing(m[1]); if (thing) return at(thing, m[2]) }
  // Representatives: "who is the council rep for X", "who represents X".
  if ((m = q.match(/^who(?:'s| is)?\s+(?:the\s+)?(?:city\s+)?(?:council\s*(?:member|rep|representative|person)?|rep|representative)\s+(?:for|of|at)\s+(.+)$/i)) && P(m[1])) return at('council district', m[1], 'representative')
  if ((m = q.match(/^who\s+represents\s+(.+)$/i)) && P(m[1])) return at('council district', m[1], 'representative')
  // Providers: "what water district serves X", "who provides sewer to X".
  if ((m = q.match(/^(?:what|which|who)(?:'s| is)?\s+(?:the\s+)?(water|sewer|sanitation|electric|electricity|power|gas|irrigation|drainage|fire)\s*(?:district|provider|company|utility|service)?\s+(?:serves|serving|covers|provides|for|at)\s+(.+)$/i)) && P(m[2])) return at(`${m[1].toLowerCase().replace(/electricity|power/, 'electric')} district`, m[2])
  if ((m = q.match(/^who\s+(?:provides|supplies|serves)\s+(water|sewer|electric|electricity|power|gas|irrigation)\s+(?:to|for|at)\s+(.+)$/i)) && P(m[2])) return at(`${m[1].toLowerCase().replace(/electricity|power/, 'electric')} district`, m[2])
  // Size and age: "how many acres is X", "how big is the parcel at X", "when was X built".
  if ((m = q.match(/^(?:how many acres|how big|how large|what(?:'s| is) the (?:lot |parcel )?(?:size|acreage|area))\s+(?:is|of|at|for)\s+(?:the\s+)?(?:(?:lot|parcel|property)\s+(?:at|of|for)\s+)?(.+)$/i)) && P(m[1])) return at('parcel', m[1], 'acres')
  if ((m = q.match(/^(?:when|what year)\s+was\s+(.+?)\s+built$/i)) && P(m[1])) return at('parcel', m[1], 'year built')
  if ((m = q.match(/^how old is\s+(?:the\s+)?(?:house|home|building)?\s*(?:at\s+)?(.+)$/i)) && P(m[1])) return at('parcel', m[1], 'year built')
  if ((m = q.match(/^what(?:'s| is) the (?:parcel|tax|account)\s*(?:number|id|#)\s+(?:for|of|at)\s+(.+)$/i)) && P(m[1])) return at('parcel', m[1], 'parcel number')
  if ((m = q.match(/^what(?:'s| is) the legal description\s+(?:for|of|at)\s+(.+)$/i)) && P(m[1])) return at('parcel', m[1], 'legal description')
  // "The flood zone for 1718 White Ave", "zoning of 1718 White Ave", "owner of 250 N 5th St": a thing and a place, no question word.
  if ((m = q.match(/^(?:the\s+)?(zoning|zone|zoning district|flood zone|floodplain|owner|owner name|council district|council member|trash day|trash pickup day|pickup day|recycling day|school district|school|water district|sewer district|fire district|acreage|acres|year built|parcel number|legal description|elevation|address)\s+(?:for|at|of|on)\s+(.+)$/i)) && P(m[2])) {
    const thing = m[1].toLowerCase()
    return /^(?:zone|zoning district)$/.test(thing) ? at('zoning', m[2]) : /^owner/.test(thing) ? at('parcel', m[2], 'owner') : /^(?:acreage|acres)$/.test(thing) ? at('parcel', m[2], 'acres') : thing === 'year built' ? at('parcel', m[2], 'year built') : thing === 'parcel number' ? at('parcel', m[2], 'parcel number') : thing === 'legal description' ? at('parcel', m[2], 'legal description') : /trash|pickup/.test(thing) ? at('trash pickup day', m[2]) : thing === 'recycling day' ? at('recycling pickup day', m[2]) : thing === 'council member' ? at('council district', m[2], 'representative') : thing === 'school' ? at('school attendance', m[2]) : at(thing, m[2])
  }
  // "What street is this", "what is the address here": the closest address to the middle of the map.
  if (/^(?:what (?:street|road) (?:is this|am i on|is that)|what(?:'s| is) (?:the name of )?(?:this|that) (?:street|road)|what(?:'s| is) the address (?:here|of this (?:place|spot))|what address is (?:this|here)|where exactly am i)$/i.test(q)) return { kind: 'at', thing: 'address', here: true }
  // "What is near 1718 White Ave", "what's around City Hall": everything at and around a place.
  if ((m = q.match(/^what(?:'s| is| are)\s+(?:near|nearby|around|close to|by)\s+(.+)$/i)) && P(m[1])) return { kind: 'at', ...cleanPlace(m[1]) }
  // Anything else shaped "what/which/when/who ... for/at/of/serves PLACE".
  if ((m = q.match(/^(?:what|which|when|who)(?:'s|s| is| are| does)?\s+(?:the\s+)?(.{3,50}?)\s+(?:for|at|of|serve|serves|serving|cover|covers|covering)\s+(.+)$/i)) && P(m[2])) {
    const thing = cleanThing(m[1]).replace(/^(?:day|name)\s+(?:is|of)\s+/i, '')
    if (thing && !/^(?:closest|nearest|distance)/i.test(thing)) return at(thing, m[2])
  }
  return null
}

const KIND_TOOL: { [k in PlaceQuestion['kind']]: RegExp } = {
  nearest: /\b(nearest|closest)\b/i,
  within: /\b(within|buffer|radius)\b/i,
  at: /\b(identify|what(?:'s| is) (?:here|at)|property report)\b/i,
  summary: /\b(summar\w*|statistics?|group(?:ed)? by)\b/i
}

/** Is this tool made for this kind of place question (a nearest tool for "closest ...")? */
export function placeToolFits (tool: McpTool, pq: PlaceQuestion): boolean {
  if (!KIND_TOOL[pq.kind].test(`${tool.name.replace(/[_-]+/g, ' ')} ${toolLabel(tool)} ${tool.description || ''}`)) return false
  // "Closest sewer pipe to ..." names a thing to look for: a geocoder ("the address nearest a
  // point") has no layer input and cannot answer it, however close its wording.
  if (pq.thing && !ADDRESS_ASK.test(pq.thing) && isGeocoder(tool) && !layerKeyOf(tool)) return false
  return true
}

const ADDRESS_ASK = /^(?:the )?(?:nearest |closest )?(?:street )?address$/i

function isGeocoder (tool: McpTool): boolean {
  const words = nameWordsOf(tool)
  return words.includes('geocode') || words.includes('geocoder') || /\b(reverse|geocod\w*)\b/i.test(toolLabel(tool) + ' ' + (tool.description || '').slice(0, 40))
}

function layerKeyOf (tool: McpTool): string | undefined {
  return Object.keys(tool.inputSchema?.properties || {}).find(k => LAYER_KEY.test(k.replace(/[_-]+/g, ' ')))
}

/** The place inputs a tool still needs (an address, or latitude and longitude). */
export function placeKeys (tool: McpTool): { address?: string, lat?: string, lon?: string } {
  const props = tool.inputSchema?.properties || {}
  const keys = Object.keys(props)
  return { address: keys.find(k => ADDRESS_KEY.test(k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')) && typeOf(props[k]) === 'string'), lat: keys.find(k => LAT.test(k)), lon: keys.find(k => LON.test(k)) }
}

const FIND_WORDS = /\b(find|search|look ?up|locate|show me|where (?:is|are)|who owns|owned by)\b/i
const COUNT_WORDS = /\b(how many|count|number of|total)\b/i
const CONTENT_WORDS = /\b(maps?|apps?|applications?|dashboards?|documents?|items?|web ?maps?|layers? about|data about|datasets?)\b/i

/**
 * Tools that fit a request, best first. Word match on the tool's name and description, plus
 * what the request looks like: a layer named in the request, "here" (a point on the map),
 * "how many", "find", "maps about". Empty when nothing clearly fits.
 */
export function rankTools (q: string, tools: McpTool[]): Array<{ tool: McpTool, score: number }> {
  if (!tools.length) return []
  const fq = flat(q)
  const named = tools.find(t => fq === flat(t.name) || fq.startsWith(flat(t.name) + ' ') || fq.startsWith(flat(toolLabel(t)) + ' '))
  if (named) return [{ tool: named, score: 99 }]
  const docs: Doc[] = tools.map((t, i) => ({
    id: String(i),
    kind: 'doc',
    title: toolLabel(t) + ' ' + t.name.replace(/[_-]+/g, ' '),
    text: clip(t.description || '', 600),
    keys: Object.keys(t.inputSchema?.properties || {}).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  }))
  const base = new Map<number, number>()
  for (const h of new MappyIndex(docs).search(q + ' ' + cues(q), { limit: tools.length })) base.set(Number(h.doc.id), h.score)
  const here = HERE.test(q)
  const pq = parsePlaceQuestion(q)
  const scored = tools.map((tool, i) => {
    const props = tool.inputSchema?.properties || {}
    const keys = Object.keys(props)
    const words = nameWordsOf(tool)
    let s = base.get(i) || 0
    // A layer (or other listed choice) named in the request points at the tools that take it.
    if (keys.some(k => Array.isArray(props[k].enum) && props[k].enum!.some(v => typeof v === 'string' && v.length > 2 && new RegExp('(?:^|[^\\w])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'i').test(q)))) s += 2.5
    const point = keys.some(k => LAT.test(k)) || keys.some(k => PLACE_OBJ.test(k))
    const coords = /-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(q)
    if (here && point) s += 2.5
    if (here && !point && !STREET.test(q)) s -= 1.5
    // A point tool without "here" or coordinates would quietly use the map center: only when nothing else fits.
    if (point && !here && !coords && !(pq && (pq.place || pq.here) && keys.some(k => ADDRESS_KEY.test(k)))) s -= 2.5
    if (pq) {
      const about = `${tool.name.replace(/[_-]+/g, ' ')} ${toolLabel(tool)} ${tool.description || ''}`
      // "What's the address here" wants the reverse geocoder, not identify.
      const wantsAddress = pq.kind === 'at' && /^(?:the )?(?:nearest |closest )?(?:street )?address$/i.test(pq.thing || '')
      if (wantsAddress) s += /\breverse\b/i.test(about) ? 8 : 0
      else if (KIND_TOOL[pq.kind].test(about)) {
        s += 6
        // A thing to look for ("sanitary pipe near ...") belongs to a tool with a layer input.
        if (pq.thing && pq.kind !== 'at') s += layerKeyOf(tool) ? 2 : (isGeocoder(tool) ? -6 : -1)
      }
      else if (pq.kind === 'at' && keys.some(k => LAT.test(k)) && !/\b(reverse|elevation|route)\b/i.test(about) && !words.includes('geocode')) s += 1
      // "Who owns X", "what zone is X in": a thing at the place, which a geocoder cannot answer.
      if (pq.kind === 'at' && pq.thing && !wantsAddress && isGeocoder(tool)) s -= 3
    }
    // Tools built for assistants (lists of filters, objects): Mappy fills plain inputs only, so a simpler tool goes first.
    if (keys.some(k => ['array', 'object'].includes(typeOf(props[k])))) s -= 2
    if (COUNT_WORDS.test(q)) s += words.includes('count') ? 3 : -0.5
    if (FIND_WORDS.test(q) && (words.includes('find') || words.includes('search')) && !words.includes('content')) s += 1.5
    if (CONTENT_WORDS.test(q)) s += words.includes('content') ? 3 : 0
    if (/\baddress\b/i.test(q) && here) s += words.includes('reverse') ? 3 : 0
    return { tool, score: s }
  }).filter(x => x.score >= 1.2).sort((a, b) => b.score - a.score)
  if (scored.length > 1 && scored[0].score < scored[1].score * 1.15) return scored.slice(0, 3).map(x => ({ ...x, score: x.score - 0.01 })).filter((x, i, all) => i === 0 || x.score > all[0].score * 0.6)
  return scored
}

function nameWordsOf (t: McpTool): string[] {
  return t.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean)
}

const ADDRESS_KEY = /^(address|single ?line|singleline|single ?line ?address|full ?address|street ?address|input ?address|place|location|from|origin|start)$/i
const LAYER_KEY = /^(layer|layers|layer ?name|layer ?id|what|thing|category|feature ?type|dataset)$/i
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

/** Validate scalar inputs against the tool's advertised choices and numeric limits. */
export function toolValueError (prop: McpProp, value: any): string | null {
  if (Array.isArray(prop.enum) && !prop.enum.includes(value)) return `Choose one of: ${prop.enum.map(String).join(', ')}.`
  const ty = typeOf(prop)
  if (['number', 'integer'].includes(ty)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (ty === 'integer' && !Number.isInteger(value))) return `Please enter a valid ${ty}.`
    if (typeof prop.minimum === 'number' && value < prop.minimum) return `Use a value of at least ${prop.minimum}.`
    if (typeof prop.maximum === 'number' && value > prop.maximum) return `Use a value no greater than ${prop.maximum}.`
  }
  return null
}

/** Read one explicitly requested input without rewriting names or addresses. */
export function toolAnswer (prop: McpProp, text: string): { value?: any, error?: string } {
  const raw = text.trim()
  if (!raw) return { error: 'Please enter a value.' }
  const ty = typeOf(prop)
  if (Array.isArray(prop.enum)) {
    const value = prop.enum.find(v => String(v).toLowerCase() === raw.toLowerCase())
    return value === undefined ? { error: `Choose one of: ${prop.enum.map(String).join(', ')}.` } : { value }
  }
  if (['integer', 'number'].includes(ty) && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return { error: 'Please enter a number.' }
  const value = coerce(prop, raw)
  if (value === undefined || (ty === 'integer' && !Number.isInteger(Number(raw.replace(/,/g, ''))))) return { error: `Please enter a valid ${ty}.` }
  if (ty === 'object' && (value === null || Array.isArray(value) || typeof value !== 'object')) return { error: 'Please enter a JSON object.' }
  const error = toolValueError(prop, value)
  return error ? { error } : { value }
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
  const placed = fillPlaceQuestion(tool, text, map)
  if (placed) return placed
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

/** The listed choice closest to plain words ("sewer line" -> "Sanitary Sewer Mains"), or null. */
export function closestChoice (words: string, choices: any[]): string | null {
  const stem = (w: string) => w.toLowerCase().replace(/ies$/, 'y').replace(/(ch|sh|ss|x)es$/, '$1').replace(/([^s])s$/, '$1')
  const want = flat(words).split(' ').filter(w => w.length > 1).map(stem)
  if (!want.length) return null
  let best: string | null = null; let score = 0
  for (const c of choices) {
    if (typeof c !== 'string') continue
    const have = flat(c).split(' ').map(stem)
    const s = want.filter(w => have.some(h => h === w || (w.length > 3 && (h.startsWith(w) || w.startsWith(h))))).length / want.length + (flat(c) === flat(words) ? 1 : 0)
    if (s > score) { best = c; score = s }
  }
  return score >= 0.5 ? best : null
}

/**
 * Inputs for a plain question about a place ("closest sewer line to 250 N 5th St"): the layer
 * from the thing named, the address or the map for the place, the distance. Null when the
 * request is not one, or the tool takes neither a place nor a layer.
 */
function fillPlaceQuestion (tool: McpTool, text: string, map?: MapContext): { args: { [k: string]: any }, missing: string[] } | null {
  const pq = parsePlaceQuestion(text)
  if (!pq) return null
  const props = tool.inputSchema?.properties || {}
  const keys = Object.keys(props)
  const required = tool.inputSchema?.required || []
  const layerKey = keys.find(k => LAYER_KEY.test(k.replace(/[_-]+/g, ' ')))
  const addrKey = keys.find(k => ADDRESS_KEY.test(k.replace(/[_-]+/g, ' ')) && typeOf(props[k]) === 'string')
  const latKey = keys.find(k => LAT.test(k)); const lonKey = keys.find(k => LON.test(k))
  if (!layerKey && !addrKey && !latKey) return null
  const args: { [k: string]: any } = {}
  if (layerKey && pq.thing) {
    const e = props[layerKey].enum
    const pick = Array.isArray(e) ? closestChoice(pq.thing, e) : pq.thing
    if (pick) args[layerKey] = pick
  }
  if (pq.kind === 'summary') {
    const g = keys.find(k => /^(group ?by|field|by|group ?field)$/i.test(k.replace(/[_-]+/g, ' ')))
    if (g && pq.groupBy) args[g] = pq.groupBy
  }
  const coords = pq.place && pq.place.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
  if (coords && latKey && lonKey) { args[latKey] = Number(coords[1]); args[lonKey] = Number(coords[2]) }
  else if (pq.place && addrKey) args[addrKey] = pq.place
  else if (pq.here && map?.center && latKey && lonKey) { args[latKey] = round(map.center[0]); args[lonKey] = round(map.center[1]) }
  if (pq.limit !== undefined) {
    const limitKey = keys.find(k => /^(max_?results|limit|count|num)$/i.test(k))
    if (limitKey) args[limitKey] = pq.limit
  }
  if (pq.feet !== undefined) {
    const d = keys.find(k => /^(distance|radius|buffer)/i.test(k))
    if (d) args[d] = /mile/i.test(d) ? Math.round(pq.feet / 5280 * 100) / 100 : (/meter|metre/i.test(d) || /_m$/i.test(d)) ? Math.round(pq.feet / 3.28084) : pq.feet
  }
  for (const k of keys) if (args[k] === undefined && props[k].default !== undefined) args[k] = props[k].default
  const missing = required.filter(k => args[k] === undefined || args[k] === '')
  // A place is needed even when the schema lets the server decide between address and point.
  const hasPlace = (addrKey && args[addrKey] !== undefined) || (latKey && args[latKey] !== undefined)
  if (!hasPlace && (addrKey || latKey) && pq.kind !== 'summary') missing.push(addrKey || latKey!)
  return { args, missing }
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
    .replace(/^\s*(?:where(?:'s| is| are)|find|locate|look up|lookup|show me|search(?: for)?|what(?:'s| is))\b/i, ' ')
    .replace(/^\s*(?:how many|count(?: the)?|number of|total)\b(?:\s+(?:are there|are|is))?/i, ' ')
    .replace(/\b(?:are there|in total)\s*[?]*\s*$/i, ' ')
    .replace(/^\s*(?:maps?|apps?|layers?|data|items?)\s+(?:about|for|on|of|with)\b/i, ' ')
    .replace(/\s+(?:in|on|from|within|for|at)(?:\s+the)?\s*$/i, ' ')
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
  choices?: Array<{ label: string, point?: [number, number] }>
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
    // Web Mercator (wkid 102100/3857), common in ArcGIS answers: meters to degrees.
    const wkid = c.spatialReference?.latestWkid ?? c.spatialReference?.wkid ?? o.spatialReference?.latestWkid ?? o.spatialReference?.wkid
    if ((wkid === 102100 || wkid === 3857 || wkid === 102113) && num(c.x) && num(c.y)) {
      const lon = +c.x / 6378137 * 180 / Math.PI
      const lat = (2 * Math.atan(Math.exp(+c.y / 6378137)) - Math.PI / 2) * 180 / Math.PI
      const q = pick(lon, lat); if (q) return q
    }
    if (Array.isArray(c.coordinates) && c.coordinates.length >= 2 && scalar(c.coordinates[0])) { const q = pick(c.coordinates[0], c.coordinates[1]); if (q) return q }
  }
  return null
}

/** An MCP tools/call result as something Mappy can say and show. */
export function viewResult (result: any, label: string): McpView {
  const content: any[] = Array.isArray(result?.content) ? result.content : []
  const texts = content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text.trim()).filter(Boolean)
  const img = content.find(c => c?.type === 'image' && typeof c.data === 'string' && /^image\/(png|jpe?g|gif|webp)$/.test(c.mimeType || ''))
  // Links to things the server made or found (MCP resource links and embedded resources).
  const links = content.filter(c => (c?.type === 'resource_link' && /^https:\/\//.test(c.uri || '')) || (c?.type === 'resource' && /^https:\/\//.test(c.resource?.uri || '')))
    .map(c => `${c.title || c.name || c.resource?.title || 'Link'}: ${c.uri || c.resource?.uri}`)
  for (const c of content) if (c?.type === 'resource' && typeof c.resource?.text === 'string' && c.resource.text.trim()) texts.push(c.resource.text.trim())
  if (result?.isError) return { text: `${label} could not do that: ${clip(texts.join(' ') || 'no reason given', 400)}`, error: true }
  let data = result?.structuredContent
  if (data === undefined && texts.length === 1 && /^[[{]/.test(texts[0])) { try { data = JSON.parse(texts[0]) } catch (e) { } }
  const view: McpView = { text: '' }
  if (img) view.image = { src: `data:${img.mimeType};base64,${img.data}`, alt: `Image from ${label}` }
  const rows = data !== undefined ? rowsIn(data) : null
  if (rows) {
    const flatRows = rows.slice(0, 25).map(flatRow)
    view.choices = rows.slice(0, 25).map((row, index) => {
      const flat = flatRows[index]
      const key = Object.keys(flat).find(k => /^(name|title|label|address|facility[ _]?id|parcel[ _]?(?:id|number))$/i.test(k) && flat[k] != null)
      return { label: key ? clip(String(flat[key]), 100) : `Result ${index + 1}`, point: pointIn(row) || undefined }
    })
    const cols: string[] = []
    for (const r of flatRows) for (const k of Object.keys(r)) if (cols.length < 6 && !cols.includes(k) && !/^(objectid|fid|shape|geometry|spatialreference|latitude|longitude|lat|lon|lng|x|y)$/i.test(k)) cols.push(k)
    if (cols.length) view.table = { columns: cols.map(keyLabel), rows: flatRows.map(r => cols.map(c => r[c] === null || r[c] === undefined ? '' : String(r[c]))) }
    view.point = pointIn(rows[0]) || undefined
    view.text = `${label} found ${rows.length} ${rows.length === 1 ? 'result' : 'results'}${rows.length > 25 ? ' (showing the first 25)' : ''}.`
  } else if (data !== undefined && data !== null && typeof data === 'object') {
    view.point = pointIn(data) || undefined
    const flatData = flatRow(data)
    const pairs = Object.keys(flatData).filter(k => flatData[k] !== null && flatData[k] !== '').slice(0, 8).map(k => `${keyLabel(k)}: ${clip(String(flatData[k]), 80)}`)
    const emptyList = Object.keys(data).some(k => Array.isArray(data[k]) && data[k].length === 0)
    // The server's own first line ("Nearest address: ...") reads better than raw fields when it has one.
    const lead = texts.length && !/^[[{]/.test(texts[0]) ? texts[0].split('\n')[0] : ''
    view.text = lead || (emptyList ? `${label} found nothing for that.` : pairs.length ? `${label} says: ${pairs.join('; ')}.` : `${label} answered.`)
  }
  if (rows && texts.length && !/^[[{]/.test(texts[0])) {
    // A heading with a list under it ("At 250 N 5th St (2 layers):" then "- **Parcels**: ...") is the answer itself.
    const lines = texts[0].split('\n')
    const list = /:\s*$/.test(lines[0]) ? lines.slice(1).filter(l => /^\s*[-*] /.test(l)).slice(0, 12) : []
    view.text = list.length ? [lines[0], ...list].join('\n') : lines[0]
    if (list.length) delete view.table
  }
  if (!view.text) view.text = texts.length ? clip(texts.join('\n\n'), 1200) : (img ? `Here is what ${label} sent back.` : links.length ? `${label} sent back:` : `${label} finished with nothing to show.`)
  if (links.length) view.text += '\n' + links.slice(0, 6).map(l => `- ${l}`).join('\n')
  return view
}
