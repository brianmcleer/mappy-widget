/*
  spatial.ts - questions that cross layers: one thing asked about by where it is relative to
  another. "Parcels within 300 ft of 250 N 5th St", "hydrants in the floodplain", "R-4 parcels
  over 5 acres within a mile of a school", "how many hydrants per council district", "parcels
  not within 500 ft of a hydrant", "owners within 300 ft of this parcel".

  This file only splits the sentence: the thing asked about, the relation, the distance, and the
  words for the other side. Each side is then read by the ordinary question reader against the
  layers' real fields and values (brain/ask.ts), and run by runtime/spatial.ts. Pure logic.
*/

export type Relation = 'within' | 'in' | 'touch' | 'outside'

export interface SpatialRead {
  /** The side asked about, as words for the question reader: "how many parcels zoned r-4". */
  target: string
  /** The other side: a layer ("a school"), a named feature ("Ward 3"), a place or address, "here", "it". */
  anchor: string
  relation: Relation
  /** For within (and outside with a distance): how far, in feet. */
  feet?: number
  /** The distance as the person said it: "300 ft", "a quarter mile". */
  distance?: string
  /** "Near" was said with no distance, so one was assumed. */
  assumed?: boolean
  /** One answer per area of the anchor layer: "hydrants per council district". */
  per?: boolean
  /** With per: "which district has the most hydrants" asks for one end of the ranking. */
  rank?: 'most' | 'fewest'
  /** A notification list: the owners of parcels near a place. */
  notify?: boolean
  /** The words can only be about place ("cross", "intersect", "inside"), so it is read this way first. */
  strong?: boolean
}

const UNIT_FEET: { [k: string]: number } = { foot: 1, feet: 1, ft: 1, "'": 1, mile: 5280, miles: 5280, mi: 5280, meter: 3.28084, meters: 3.28084, metre: 3.28084, metres: 3.28084, m: 3.28084, kilometer: 3280.84, kilometers: 3280.84, km: 3280.84, block: 330, blocks: 330, yard: 3, yards: 3, yd: 3, yds: 3 }
const DIST = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(feet|foot|ft|'|miles?|mi|meters?|metres?|m|kilometers?|km|blocks?|yards?|yds?)\b`
/** How far "near" means when no distance is given. */
export const NEAR_FEET = 500

/** Spoken distances as numbers: "a quarter mile" -> "1320 ft". */
function plainDistances (s: string): string {
  return s.replace(/\b(?:a|one) quarter(?: of a)? mile\b|\bquarter mile\b/gi, '1320 ft').replace(/\b(?:a )?half(?: a)? mile\b/gi, '2640 ft')
    .replace(/\b(?:a|one) mile\b/gi, '5280 ft').replace(/\b(?:a|one) block\b/gi, '330 ft').replace(/\b(\d+)-(foot|ft|mile|meter|block|yard)\b/gi, '$1 $2')
}

/** A distance in feet and as said ("300 ft", "0.5 mi"), or null. */
export function readDistance (num: string, unit: string): { feet: number, said: string } | null {
  const n = Number(String(num).replace(/,/g, ''))
  const per = UNIT_FEET[unit.toLowerCase()]
  if (!Number.isFinite(n) || n <= 0 || !per) return null
  const feet = n * per
  if (feet > 5280 * 50) return null
  const u = unit.toLowerCase()
  const said = /^(?:foot|feet|ft|')$/.test(u) ? `${n.toLocaleString()} ft` : /^mi/.test(u) ? `${n} mi` : /^(?:m|met)/.test(u) ? `${n.toLocaleString()} m` : /^k/.test(u) ? `${n} km` : /^block/.test(u) ? `${n} block${n === 1 ? '' : 's'}` : `${n.toLocaleString()} yd`
  return { feet, said: said === '5,280 ft' ? '1 mi' : said === '2,640 ft' ? 'half a mile' : said === '1,320 ft' ? 'a quarter mile' : said === '330 ft' && /block/.test(u) ? '1 block' : said }
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,?.!]+$/g, '').trim()
/** Linking words left dangling on the asked-about side: "parcels that are", "hydrants which". */
const trimTarget = (s: string): string => clean(s.replace(/\s+(?:that|which|who)(?:\s+(?:are|is|were|lie|lies|sit|sits|fall|falls))?$/i, '').replace(/\s+(?:are|is|were|located|lying|sitting|there)$/i, '').replace(/\s+(?:that|which)$/i, ''))
const trimAnchor = (s: string): string => clean(s.replace(/^(?:the|a|an|any|each|every|all|some|one of the|our|my)\s+/i, '').replace(/\s+(?:on the map|in town|in the city)$/i, ''))

/**
 * Splits a question that relates two things by place. Null when the sentence has no such
 * relation; the caller still has to check that both sides mean something in this map.
 */
export function splitSpatial (input: string): SpatialRead | null {
  const t = plainDistances(clean(input))
  if (t.length < 8 || t.length > 220 || /^__/.test(t)) return null
  let m: RegExpMatchArray | null

  // A notification list: the owners near a place.
  m = t.match(new RegExp(String.raw`^(?:(?:who|whom) (?:do|should|must|would) (?:i|we) (?:notify|notice|mail)|(?:(?:make|create|build|get|give me|show me|i need) (?:me )?(?:a |an |the )?)?(?:public )?(?:notification|notice|noticing|mailing|mail(?:ing)? label|neighbou?r(?:hood)?|owner) (?:list|labels?)|(?:(?:list|show|find|get|who are)(?: me)? )?(?:the |all (?:the )?)?(?:property |land ?)?(?:owners?|neighbou?rs)|who(?: owns| lives| is)?)\b(?: (?:for|of))?(?: (?:parcels?|propert(?:y|ies)|land|everything|everyone))?\s*(?:that (?:is|are) |who (?:is|are) |(?:is|are) )?(?:within|inside|in a radius of|in)\s+(?:a |an )?(?:radius of )?${DIST}\s*(?:radius )?(?:of|from|around)\s+(.+)$`, 'i'))
  if (m) { const d = readDistance(m[1], m[2]); if (d) return { target: 'list parcels', anchor: trimAnchor(m[3]), relation: 'within', feet: d.feet, distance: d.said, notify: true } }
  m = t.match(new RegExp(String.raw`^(?:(?:make|create|build|get|give me|show me|i need) (?:me )?)?(?:a |an |the )?${DIST}\s*(?:public )?(?:notification|notice|noticing|mailing|buffer) (?:list|labels?)?\s*(?:for|of|around|from)\s+(.+)$`, 'i'))
  if (m) { const d = readDistance(m[1], m[2]); if (d) return { target: 'list parcels', anchor: trimAnchor(m[3]), relation: 'within', feet: d.feet, distance: d.said, notify: true } }

  // A notice list with no distance yet: the caller asks how far.
  m = t.match(/^(?:(?:make|create|build|get|give me|show me|i need) (?:me )?(?:a |an |the )?)?(?:public )?(?:notification|notice|noticing|mailing|mail(?:ing)? label) (?:list|labels?)\s+(?:for|of|around|near)\s+(.+)$/i) || t.match(/^(?:who|whom) (?:do|should|must|would) (?:i|we) (?:notify|notice|mail) (?:for|about|around|near)\s+(.+)$/i)
  if (m) return { target: 'list parcels', anchor: trimAnchor(m[1]), relation: 'within', notify: true }

  // "Which district has the most hydrants", "what ward has the fewest parks".
  m = t.match(/^(?:which|what) (.+?) (?:has|have|contains?|holds?) (?:the )?(most|fewest|least|highest number of|lowest number of|largest number of|smallest number of) (.+)$/i)
  if (m) return { target: `how many ${trimTarget(m[3])}`, anchor: trimAnchor(m[1]), relation: 'in', per: true, rank: /fewest|least|lowest|smallest/i.test(m[2]) ? 'fewest' : 'most' }

  // "Hydrants per council district", "how many parcels in each zoning district", "count parks by ward".
  m = t.match(/^(.+?)\s+(?:per|(?:in|inside|within|for) (?:each|every)|by each|for each|broken (?:down|out) by|in every)\s+(.+)$/i)
  if (m && !/^\d/.test(m[2])) return { target: countIfBare(trimTarget(m[1])), anchor: trimAnchor(m[2]), relation: 'in', per: true }

  // "Not within 500 ft of a hydrant", "more than a mile from a park", "outside the floodplain".
  m = t.match(new RegExp(String.raw`^(.+?)\s+(?:(?:that|which) (?:are|is) |(?:are|is) )?(?:not within|not inside|more than|over|farther than|further than|beyond|at least|outside of|outside)\s+${DIST}\s*(?:of|from|away from)\s+(.+)$`, 'i'))
  if (m) { const d = readDistance(m[2], m[3]); if (d) return { target: trimTarget(m[1]), anchor: trimAnchor(m[4]), relation: 'outside', feet: d.feet, distance: d.said } }
  m = t.match(/^(.+?)\s+(?:(?:that|which) (?:are|is) |(?:are|is) )?(?:outside of|outside|not in|not inside|not within|not on|not covered by|that (?:do not|don't) (?:intersect|touch|cross)|out of)\s+(?!service\b)(.+)$/i)
  if (m) return { target: trimTarget(m[1]), anchor: trimAnchor(m[2]), relation: 'outside' }

  // "Within 300 ft of ...", "300 ft from ...", "in a 500 ft radius of ...".
  m = t.match(new RegExp(String.raw`^(.+?)\s+(?:(?:that|which) (?:are|is) |(?:are|is) |located |lying )?(?:within|inside|less than|under|no more than|at most|in a radius of|in)\s+(?:a |an )?(?:radius of )?${DIST}\s*(?:radius )?(?:of|from|around)\s+(.+)$`, 'i'))
  if (m) { const d = readDistance(m[2], m[3]); if (d) return { target: trimTarget(m[1]), anchor: trimAnchor(m[4]), relation: 'within', feet: d.feet, distance: d.said } }

  // Sharing an edge: "parcels adjacent to Compass Park", "parcels touching the floodplain".
  m = t.match(/^(.+?)\s+(?:(?:that|which) (?:are|is) |(?:are|is) )?(?:adjacent to|adjoining|abutting|bordering|next to|next door to|touching|(?:that|which) (?:touch|touches|border|borders|abut|abuts|adjoin|adjoins)|sharing (?:a |an )?(?:border|boundary|edge|lot line|property line) with|(?:that|which) share (?:a |an )?(?:border|boundary|edge|lot line|property line) with)\s+(.+)$/i)
  if (m) return { target: trimTarget(m[1]), anchor: trimAnchor(m[2]), relation: 'touch' }

  // Near, with no distance: a short walk is assumed, and said.
  m = t.match(/^(.+?)\s+(?:(?:that|which) (?:are|is) |(?:are|is) )?(?:near|nearby|close to|close by|in the vicinity of|around(?! \d))\s+(.+)$/i)
  if (m && !/^(?:how far|how close|closest|nearest)\b/i.test(m[1])) return { target: trimTarget(m[1]), anchor: trimAnchor(m[2]), relation: 'within', feet: NEAR_FEET, distance: `${NEAR_FEET} ft`, assumed: true }

  // Inside an area. "In" is the most common word there is, so this one is only believed when the
  // other side turns out to be a layer of areas or a named area on this map (the runtime checks).
  m = t.match(/^(.+?)\s+(?:(?:that|which) (?:are|is|lie|lies|fall|falls|sit|sits) |(?:are|is) |located |lying |falling |sitting )?(?:inside of|inside|within|in|on|covered by|(?:(?:that|which) )?(?:intersect|intersects|cross|crosses|overlap|overlaps|(?:run|runs|go|goes|pass|passes|cut|cuts) through)|intersecting|crossing|overlapping|running through|passing through)\s+(.+)$/i)
  if (m) {
    // "Cross", "intersect", "run through", "inside" can only be about place; "in" and "on" usually are not.
    const strong = /\b(?:inside|intersect\w*|cross(?:es|ing)?|overlap\w*|(?:run|runs|running|go|goes|pass|passes|passing|cut|cuts) through|covered by)\s+\S+(?:\s+\S+)*$/i.test(t.slice(m[1].length)) && !/^\s*(?:in|on|within)\s/i.test(t.slice(m[1].length))
    return { target: trimTarget(m[1]), anchor: trimAnchor(m[2]), relation: 'in', strong }
  }
  return null
}

/** "Hydrants" on its own, in a per-area question, means "how many hydrants". */
function countIfBare (s: string): string {
  return /^(?:how many|count|number of|list|show|which|what|total|average|sum)\b/i.test(s) ? s : `how many ${s.replace(/^(?:the|all) /i, '')}`
}

/** "What about 500 ft", "make it a mile", "try 1000 feet": the same question at another distance. */
export function distanceSwap (input: string): { feet: number, said: string } | null {
  const t = plainDistances(clean(input))
  const m = t.match(new RegExp(String.raw`^(?:(?:and |or |now )?(?:what|how) about|make it|try|change (?:it|that) to|use|and|or|now|with|at)?\s*(?:within |a |an )?${DIST}(?: instead| radius| buffer)?$`, 'i'))
  return m ? readDistance(m[1], m[2]) : null
}

/** How the relation reads in an answer: "within 300 ft of 250 Oak St". */
export function relationSaid (r: SpatialRead, anchorLabel: string): string {
  if (r.relation === 'within') return `within ${r.distance} of ${anchorLabel}`
  if (r.relation === 'touch') return `next to ${anchorLabel}`
  if (r.relation === 'outside') return r.feet ? `more than ${r.distance} from ${anchorLabel}` : `outside ${anchorLabel}`
  return `in ${anchorLabel}`
}

/** A circle around a point as a ring of [longitude, latitude], for drawing a distance on the map. */
export function circleRing (lat: number, lon: number, feet: number, steps = 72): number[][] {
  const ring: number[][] = []
  const dLat = feet / 364567.2
  const dLon = feet / (364567.2 * Math.max(0.05, Math.cos(lat * Math.PI / 180)))
  for (let i = 0; i <= steps; i++) { const a = i / steps * 2 * Math.PI; ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]) }
  return ring
}

/** A CSV cell that a spreadsheet will not run as a formula. */
export function csvCell (v: any): string {
  const s0 = v === null || v === undefined ? '' : String(v)
  const s = /^[=+\-@\t\r]/.test(s0) ? `'${s0}` : s0
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * A distance drawn around an area: the outline pushed out by `feet`, with rounded corners.
 * Worked from the area's outer corners (its convex hull), so it is exact for an ordinary lot and
 * a little generous where a shape bends inward. For drawing only; the layer service does the measuring.
 */
export function bufferRing (ring: number[][], feet: number, arcStep = 15): number[][] {
  const pts = ring.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length < 3 || !(feet > 0)) return []
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length
  const lon0 = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const kx = 364567.2 * Math.max(0.05, Math.cos(lat0 * Math.PI / 180)); const ky = 364567.2
  const xy = pts.map(p => [(p[0] - lon0) * kx, (p[1] - lat0) * ky])
  // Convex hull, counter-clockwise (monotone chain).
  const sorted = xy.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o: number[], a: number[], b: number[]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: number[][] = []
  for (const p of sorted) { while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p) }
  const upper: number[][] = []
  for (const p of sorted.slice().reverse()) { while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p) }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  if (hull.length < 3) return []
  const out: number[][] = []
  const n = hull.length
  for (let i = 0; i < n; i++) {
    const prev = hull[(i + n - 1) % n]; const cur = hull[i]; const next = hull[(i + 1) % n]
    // Outward directions of the two edges that meet here; the corner is an arc from one to the other.
    let a0 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]) - Math.PI / 2
    let a1 = Math.atan2(next[1] - cur[1], next[0] - cur[0]) - Math.PI / 2
    while (a1 < a0) a1 += 2 * Math.PI
    const steps = Math.max(1, Math.ceil((a1 - a0) * 180 / Math.PI / arcStep))
    for (let s = 0; s <= steps; s++) { const a = a0 + (a1 - a0) * s / steps; out.push([cur[0] + feet * Math.cos(a), cur[1] + feet * Math.sin(a)]) }
  }
  out.push(out[0])
  // Clockwise, the way ArcGIS writes an outer ring.
  return out.reverse().map(p => [lon0 + p[0] / kx, lat0 + p[1] / ky])
}
