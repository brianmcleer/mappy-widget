/*
  ask.ts - reads a plain question about the map's data against what the layers really hold:
  their names, their fields and the values in those fields. "How many parcels are zoned R-4",
  "most expensive parcel", "average acres by zoning", "streets with 4 lanes", "parks with a
  playground", "what is the max height in MU". Every word of the question has to land on a
  layer, a field, a value or a known phrase; a word that lands on nothing is reported back
  rather than ignored, so he never answers a different question than the one asked.

  Pure: no network and no map here. The runtime supplies the schema (and the distinct values of
  short text fields) and runs the query this produces.
*/
import { fieldLabel } from './fields'
import { parseWhen, dateClause, yearClause } from './dates'
import { numericField, dateField, dateFieldFor, sizeField } from './analysis'
import type { QueryField } from './analysis'

export interface AskLayer {
  key: string
  title: string
  fields: QueryField[]
  /** Distinct values of short text fields, by field name (coded-value names are read from the fields). */
  values?: { [field: string]: string[] }
  displayField?: string
  isTable?: boolean
}

export interface Clause { field: QueryField, sql: string, said: string }

export interface Ask {
  layer: string
  kind: 'count' | 'list' | 'top' | 'stat' | 'group' | 'distinct' | 'attr'
  clauses: Clause[]
  /** The field measured, ranked, listed or looked up. */
  field?: QueryField
  stat?: 'avg' | 'sum'
  group?: QueryField
  order?: 'asc' | 'desc'
  limit?: number
  chart?: boolean
  /** The word used for a ranking ("biggest", "most expensive"). */
  superlative?: string
  /** Words that landed on nothing in the layer. The runtime tries them as text in the layer's names, then says so. */
  unknown: string[]
  /** Words were left over that the layer's values might explain (when they have not been read yet). */
  loose?: boolean
}

/** True when two short keys differ by one letter (changed, missing or extra). */
function near1 (a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0; let j = 0; let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
const nk = (s: string): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const stem = (w: string): string => w.length > 3 ? w.replace(/(?:ies)$/, 'y').replace(/(?:ing|ed|es|s)$/, '') : w
const sqlName = (f: QueryField): string => { if (!/^[a-z_][a-z0-9_.]*$/i.test(f.name)) throw new Error('This field name is not supported for queries.'); return f.name }
const quote = (v: string): string => `'${String(v).replace(/'/g, "''")}'`
const isText = (f: QueryField): boolean => /^(?:string|esriFieldTypeString)$/i.test(f.type || '')
const hidden = (f: QueryField): boolean => /geometry|blob|raster|xml|oid|global-?id/i.test(f.type || '') || /^(?:objectid|fid|oid|globalid)$|globalid|shape[._]/i.test(f.name)

/** Everyday words and the kind of field they mean. */
const SYNONYMS: Array<[RegExp, RegExp]> = [
  [/^(?:acres?|acreage|area|size|sized|big|bigger|biggest|large|larger|largest|small|smaller|smallest|sqft|footage)$/, /acre|\barea\b|sq_?f|sqft|size/i],
  [/^(?:value|valued|values|worth|cost|costs|assessed|assessment|appraised|appraisal|market|expensive|cheap|cheapest|valuable|priciest|dollars?)$/, /assess|apprais|value|\bval\b|cost|market|amount/i],
  [/^(?:price|priced|prices)$/, /price|value|cost|amount/i],
  [/^(?:built|constructed|age|old|older|oldest|new|newer|newest)$/, /year.?built|yr.?built|built|construct|install|open/i],
  [/^(?:installed|install|installation)$/, /install/i],
  [/^(?:opened|open|opening|established)$/, /open|establish/i],
  [/^(?:owner|owners|owned|owns|own|landowner|belongs?|belonging)$/, /owner|own_?name/i],
  [/^(?:zoned|zone|zones|zoning|district|districts)$/, /zon/i],
  [/^(?:use|used|uses|landuse)$/, /land.?use|use.?(?:code|type|desc)|\buse\b/i],
  [/^(?:long|longer|longest|short|shorter|shortest|length)$/, /length|\blen\b|miles|feet/i],
  [/^(?:tall|taller|tallest|height|heights|high|higher)$/, /height|\bht\b|elev/i],
  [/^(?:wide|wider|widest|narrow|narrowest|width|diameter|diameters|dia|inch|inches)$/, /width|\bdia(?:m|meter)?\b|_dia\b/i],
  [/^(?:fast|faster|fastest|slow|slowest|speed|mph)$/, /speed|mph/i],
  [/^(?:name|names|named|called)$/, /name/i],
  [/^(?:address|addresses|addr|located|location)$/, /addr|situs|location/i],
  [/^(?:status|condition|state)$/, /status|condition/i],
  [/^(?:type|types|kind|kinds|category|categories|class|classes)$/, /type|class|categ|kind/i],
  [/^(?:material|materials|made)$/, /material|matl|surface/i],
  [/^(?:flow|gpm|pressure)$/, /flow|gpm|press/i],
  [/^(?:population|people|residents)$/, /\bpop/i],
  [/^(?:sold|sale|sales|selling|sell|sells)$/, /sale|sold|sdate|sprice/i],
  [/^(?:bedrooms?|beds?)$/, /bedroom|bdrm|\bbeds?\b/i], [/^(?:bathrooms?|baths?)$/, /bathroom|bth|\bbaths?\b/i], [/^(?:pressure|psi)$/, /press|psi/i], [/^(?:neighborhood|neighbourhood)$/, /neighbo|nbhd/i],
  [/^(?:inspected|inspection|inspections)$/, /inspect/i],
  [/^(?:lanes?)$/, /lane/i],
  [/^(?:year|years)$/, /year|\byr\b/i]
]

/** The field a word or short phrase means, or null. `want` narrows it to numeric or text fields. */
export function fieldFor (phrase: string, fields: QueryField[], want?: 'number' | 'text' | 'date'): QueryField | null {
  const words = phrase.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !/^(?:the|a|an|of|its|their|in|is|are)$/.test(w))
  if (!words.length) return null
  const key = words.join('')
  const pool = fields.filter(f => !hidden(f) && (want === 'number' ? numericField(f) : want === 'text' ? isText(f) : want === 'date' ? dateField(f) || (numericField(f) && /year|\byr\b/i.test(`${f.name} ${f.alias || ''} ${fieldLabel(f)}`)) : true))
  let best: QueryField | null = null; let top = 0
  for (const f of pool) {
    const names = [f.name, f.alias || '', fieldLabel(f)]
    const tokens = new Set(names.join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean).map(stem))
    const label = `${f.name} ${f.alias || ''} ${fieldLabel(f)}`
    const shown = fieldLabel(f)
    // Several fields of the same kind (land, improvement and total value; this year's and last year's):
    // the plain one is meant unless the words say otherwise.
    let bias = -tokens.size * 0.005
    if (/\btotal\b/i.test(shown) && !/\b(?:number|count|units|buildings|rooms)\b/i.test(shown)) bias += 0.12
    if (/current|actual|market/i.test(shown)) bias += 0.06
    if (/previous|prior|effective|adjust|school/i.test(shown)) bias -= 0.25
    if (/\b(?:land|improvement)\b/i.test(shown) && /value/i.test(shown) && !words.some(w => /^(?:land|improvements?)$/.test(w))) bias -= 0.15
    if (/\b(?:sale|price)\b/i.test(shown) && !words.some(w => /^(?:sold|sale|sales|price|priced|prices|sell|selling)$/.test(w))) bias -= 0.1
    let score = 0
    if (names.some(n => nk(n) === key)) score = 5
    else if (names.some(n => stem(nk(n)) === stem(key))) score = 4.5
    else if (words.every(w => tokens.has(stem(w)))) score = 3 + words.length * 0.2 + bias
    else {
      // Every word has to point at this field, by its own name or by an everyday word for it.
      const hits = words.filter(w => SYNONYMS.some(([q, fld]) => q.test(w) && fld.test(label)))
      if (hits.length && words.every(w => hits.includes(w) || tokens.has(stem(w)))) score = 1.5 + hits.length * 0.3 + (words.some(w => tokens.has(stem(w))) ? 1 : 0) + bias
    }
    if (score > top) { top = score; best = f }
  }
  return top >= 1.5 ? best : null
}

/** The values a text field is known to hold: coded-value names, then the distinct values read from the service. */
function knownValues (layer: AskLayer, f: QueryField): Array<{ label: string, stored: any }> {
  const coded = f.domain?.codedValues
  if (Array.isArray(coded) && coded.length) return coded.map((c: any) => ({ label: String(c.name), stored: c.code }))
  return (layer.values?.[f.name] || []).map(v => ({ label: String(v), stored: v }))
}

interface LayerHit { layer: AskLayer, start: number, end: number }
/** The layer a sentence names: "parcels", "the fire hydrants", "hydrant". The longest name wins. */
export function mentionedLayer (text: string, layers: AskLayer[]): LayerHit | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9$%.<>=+-]+/g, ' ')} `
  const tailCount = new Map<string, number>()
  const tail = (l: AskLayer): string => l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').pop() || ''
  for (const l of layers) tailCount.set(stem(tail(l)), (tailCount.get(stem(tail(l))) || 0) + 1)
  let best: LayerHit | null = null; let bestLen = 0
  for (const l of layers) {
    const title = l.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!title) continue
    const forms = new Set<string>([title, title.replace(/s$/, ''), title.replace(/ies$/, 'y'), title + 's'])
    const last = tail(l)
    // "hydrants" for Fire Hydrants, when no other layer ends the same way.
    if (last !== title && last.length >= 4 && tailCount.get(stem(last)) === 1) { forms.add(last); forms.add(last.replace(/s$/, '')); forms.add(last + 's') }
    for (const form of forms) {
      if (form.length < 3) continue
      const at = t.indexOf(` ${form} `)
      if (at >= 0 && form.length > bestLen) { best = { layer: l, start: at, end: at + form.length + 1 }; bestLen = form.length }
    }
  }
  return best
}

const NUM = '\\$?\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k|m|thousand|million|mil)?\\b'
const toNumber = (digits: string, scale?: string): number => Number(digits.replace(/,/g, '')) * (/^(?:k|thousand)$/i.test(scale || '') ? 1e3 : /^(?:m|mil|million)$/i.test(scale || '') ? 1e6 : 1)
const SPATIAL = /\b(?:near|nearest|closest|close to|next to|adjacent|around|within \d[\d,.]* ?(?:ft|feet|foot|m|meters?|mi|miles?|km|yards?|blocks?)|how far|distance|inside|intersect\w*|touch\w*|across from|between .+ and .+ (?:st|ave|rd|dr|blvd)\b)\b/i
const STOP = new Set(('a an the of in on at to for from by with and or is are was were be been do does did has have had that which who whom what whats where when how many much there their its it this these those them they all any every each me my i you your we us our show list find get give tell see display please can could would should will want need like look looking up about map layer layers data ' +
  'anything something everything any anyone whatever what\'s who\'s where\'s how\'s that\'s it\'s whats wheres hows only just also both some more than as not no yes ones one thing things kind sort currently now today right here located within total number count records features rows items entries listed exist existing available do there\'s whose into out so then where whether if exactly equal equals named called').split(' '))

const SUPERLATIVES: Array<[RegExp, string, 'asc' | 'desc', ('number' | 'date')?]> = [
  [/\b(?:biggest|largest|hugest)\b/, 'size', 'desc'], [/\b(?:smallest|tiniest|littlest)\b/, 'size', 'asc'],
  [/\b(?:most expensive|priciest|most valuable|highest valued|highest value|highest priced|most costly)\b/, 'value', 'desc'], [/\b(?:cheapest|least expensive|least valuable|lowest valued|lowest value|lowest priced)\b/, 'value', 'asc'],
  [/\b(?:oldest|earliest)\b/, 'old', 'asc', 'date'], [/\b(?:newest|latest|most recent|youngest)\b/, 'old', 'desc', 'date'],
  [/\b(?:longest)\b/, 'long', 'desc'], [/\b(?:shortest)\b/, 'long', 'asc'],
  [/\b(?:tallest)\b/, 'tall', 'desc'], [/\b(?:widest)\b/, 'wide', 'desc'], [/\b(?:narrowest)\b/, 'wide', 'asc'],
  [/\b(?:fastest)\b/, 'fast', 'desc'], [/\b(?:slowest)\b/, 'fast', 'asc']
]
const VERBS = 'sold|built|constructed|installed|inspected|edited|updated|modified|created|added|issued|opened|closed|completed|replaced|repaired|paved|surveyed|tested|flushed|cleaned|reported|submitted|transferred'

/**
 * Reads one question against the layers. Null when it is not a data question he can ground (a
 * command, a place question, small talk), so the older readings get their turn.
 */
export function readAsk (input: string, layers: AskLayer[], opts: { fallback?: string, now?: Date, why?: { ungrounded?: boolean } } = {}): Ask | null {
  const now = opts.now || new Date()
  let t = ` ${input.toLowerCase().replace(/[’`]/g, "'").replace(/[?!]+\s*$/, '').replace(/(\d),(\d{3})/g, '$1$2').replace(/[^a-z0-9$%.<>=+' -]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  t = t.replace(/\b(are|is|was|were|do|does|did|have|has)n't\b/g, '$1 not').replace(/\bnon[- ](?=[a-z])/g, 'not ').replace(/\b(?:that|which) (?:are|is) not\b/g, 'not')
  if (t.length < 5 || t.length > 200 || SPATIAL.test(t)) return null
  if (/\b(?:percent|percentage|share of|fraction|proportion|%|in (?:the )?(?:current |map )?(?:view|extent)|on (?:the |my )?screen)\b/.test(t)) return null
  if (/^ (?:turn|switch|toggle|hide|zoom|pan|go|open|close|print|measure|undo|redo|save|delete|only show|filter|clear|reset|pin|drop|rotate|tilt|set|make|change) /.test(t)) return null
  const eat = (re: RegExp): RegExpMatchArray | null => { const m = t.match(re); if (m) t = `${t.slice(0, m.index)} ${t.slice((m.index || 0) + m[0].length)}`.replace(/\s+/g, ' '); return m }

  // From here on, a null means the words did not land on the layers as known so far (their values may not be read yet).
  if (opts.why) opts.why.ungrounded = true
  // A field named outright ("max height", "speed limit", "year built") is tagged first, so its words are not read as anything else.
  const tagged: QueryField[] = []
  {
    const all = layers.flatMap(l => l.fields.filter(f => !hidden(f)).map(f => ({ f, label: fieldLabel(f).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() }))).filter(x => x.label.split(' ').length >= 2).sort((a, b) => b.label.length - a.label.length)
    for (const x of all) { const at = t.indexOf(` ${x.label} `); if (at >= 0 && tagged.length < 20) { let i = tagged.findIndex(f => f.name === x.f.name && fieldLabel(f) === fieldLabel(x.f)); if (i < 0) { tagged.push(x.f); i = tagged.length - 1 } t = `${t.slice(0, at)} fld${String.fromCharCode(97 + i)}x ${t.slice(at + x.label.length + 1)}` } }
  }
  const tagOf = (w: string): QueryField | null => { const g = w.match(/^fld([a-z])x$/); return g ? tagged[g[1].charCodeAt(0) - 97] || null : null }

  // ---- the shape of the question
  let ownerRank: '' | 'land' | 'count' = ''
  { const w = t.match(/^ (?:who|which owner|what owner) (?:owns|has|holds) the (most|least|fewest) (.+?) $/); if (w) { ownerRank = /land|acre|area|property|ground/.test(w[2]) ? 'land' : 'count'; t = ` ${w[2].replace(/\b(?:land|acres?|acreage|area|property|ground)\b/g, ' ')} ${w[1]} ` } }
  const chart = !!eat(/\b(?:pie chart|bar chart|chart|graph|plot|histogram|pie)\b(?: of| for| showing)?/)
  let limit: number | undefined
  let m = eat(/\b(?:top|first|biggest|largest) (\d{1,3})\b/) || eat(/\b(\d{1,2}) (?=biggest|largest|smallest|oldest|newest|most|least|cheapest|longest|shortest|tallest|highest|lowest)/)
  if (m) limit = Math.max(1, Math.min(50, Number(m[1])))
  const counting = !!eat(/\b(?:how many|count(?: up| of| the)?|number of|total number of|how much of)\b/)
  let stat: Ask['stat'] | undefined
  if (eat(/\b(?:average|avg|mean|typical)\b/)) stat = 'avg'
  else if (eat(/\b(?:total|sum(?: of)?|combined|altogether|add up)\b/)) stat = 'sum'
  let superlative = ''; let supClass = ''; let order: 'asc' | 'desc' | undefined; let supDate = false
  for (const [re, cls, dir, kind] of SUPERLATIVES) { const s = eat(re); if (s) { superlative = s[0].trim(); supClass = cls; order = dir; supDate = kind === 'date'; break } }
  let rankWords = ''
  let common: '' | 'asc' | 'desc' = ''
  { const c = eat(/\b(most|least) (?:common|frequent|popular|typical|usual)\b/); if (c) common = c[1] === 'most' ? 'desc' : 'asc' }
  const countDistinct = counting && !!eat(/\b(?:different|distinct|unique|separate)\b/)
  if (!superlative && (m = eat(/\b(most|highest|greatest|maximum|max|least|lowest|fewest|minimum|min)\b/))) { rankWords = m[1]; order = /most|high|great|max/.test(m[1]) ? 'desc' : 'asc' }
  const distinctStrong = !!eat(/\b(?:what|which|list|show)(?: are)?(?: the| all(?: the)?)?(?: different| distinct| unique| possible)? (?:types|kinds|values|categories|options)(?: of)?\b/) || !!eat(/\b(?:types|kinds|values|categories|options) (?:are there|exist|do you have)\b/)
  const distinctAsk = distinctStrong || / are there $| (?:exist|do we have|do you have) $/.test(t) && /^ (?:what|which) /.test(t) && !counting
  let groupPhrase = ''
  eat(/\b(?:break down|breakdown(?: of)?|broken down)\b/)

  // ---- the layer
  let hit = mentionedLayer(t, layers)
  let layer: AskLayer | null = hit ? hit.layer : null
  if (hit) t = `${t.slice(0, hit.start)} ¦ ${t.slice(hit.end)}`.replace(/\s+/g, ' ')
  const rest = (): string[] => t.replace(/¦/g, ' ').split(/\s+/).filter(Boolean)
  // "by zoning", "per owner", "for each land use": what follows, up to the layer's name or the end.
  const beforeGroup = t
  if ((m = eat(/\b(?:grouped by|broken down by|by|per|for each|for every)\s+([a-z][a-z0-9 ]{1,40}?)\s*(?:(?:in|for|of|on|across|from)\s+(?:the\s+)?¦\s*)?$/))) groupPhrase = m[1].trim()
  if (!layer) {
    // No layer named: the one whose fields and values the words land on, the one in use first.
    const words = t.replace(/¦/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d/.test(w))
    let top = 0
    for (const l of layers) {
      let score = l.key === opts.fallback ? 0.4 : 0
      for (const w of words) {
        const tag = tagOf(w)
        if (tag) { if (l.fields.includes(tag)) score += 2; continue }
        if (fieldFor(w, l.fields)) score += 1
        else if (l.fields.some(f => knownValues(l, f).some(v => nk(v.label) === nk(w) || (w.length > 3 && v.label.toLowerCase().split(/[^a-z0-9]+/).includes(w))))) score += 1
      }
      if (score > top) { top = score; layer = l }
    }
    // "What is the tallest building allowed": no layer or field named, but only one layer measures that.
    if (top < 1 && supClass && /^(?:tall|long|wide|deep)$/.test(supClass)) {
      const fit = layers.filter(l => fieldFor(supClass, l.fields, 'number'))
      if (fit.length === 1) { layer = fit[0]; top = 1; t = t.replace(/\b(?:buildings?|structures?|allowed|permitted|possible|here|in town|in the city)\b/g, ' ').replace(/\s+/g, ' ') }
    }
    if (top < 1 && ownerRank) layer = layers.find(l => fieldFor('owner', l.fields, 'text')) || null
    // "What about the smallest", "how many": no layer and no field named, so the layer in use.
    const shaped = !!(superlative || stat || counting || rankWords || common)
    if (top < 1 && !ownerRank && shaped && opts.fallback) { layer = layers.find(l => l.key === opts.fallback) || null; if (layer) top = 1 }
    if (!layer || (top < 1 && !ownerRank)) return null
  }
  const L = layer as AskLayer
  const fields = L.fields
  const clauses: Clause[] = []
  const fieldOf = (phrase: string, want?: 'number' | 'text' | 'date'): QueryField | null => {
    for (const w of phrase.split(' ')) { const f = tagOf(w); if (f && fields.includes(f)) return f }
    return fieldFor(phrase.replace(/\bfld[a-z]x\b/g, ' '), fields, want)
  }
  // "by owner" groups; "owned by Rivera" does not: when the words after "by" are not a field, they go back.
  let groupField = groupPhrase ? fieldOf(groupPhrase) : null
  if (groupPhrase && !groupField) { const at = beforeGroup.lastIndexOf(groupPhrase); t = `${t} ${beforeGroup.slice(Math.max(0, beforeGroup.lastIndexOf(' ', at - 2)), at)} ${groupPhrase} `.replace(/\s+/g, ' ') }
  // "Which land use has the highest average value", "which zoning has the most parcels": the field asked about is the group.
  { const w = t.match(/^ (?:which|what) ([a-z ]{2,30}?) (?:has|have|had|holds|gets|contains) (?:the )?/); if (w && !groupField) { const f = fieldOf(w[1].trim()); if (f && !numericField(f)) { groupField = f; t = ` ${t.slice((w.index || 0) + w[0].length)} ` } } }
  // "top 5 parcels by assessed value": a number field after "by" is what to rank on, not groups.
  let rankField: QueryField | null = null
  if (groupField && numericField(groupField) && (limit || superlative || rankWords) && !/year|\byr\b/i.test(`${groupField.name} ${groupField.alias || ''}`)) { rankField = groupField; groupField = null }

  // ---- dates: "sold in 2025", "installed before 1990", "inspected in the last 30 days"
  for (let guard = 0; guard < 3; guard++) {
    const v = t.match(new RegExp(`\\b(${VERBS})\\s+((?:before|after|since|in|during|on|between|from|this|last|past|within|over|yesterday|today)\\b[a-z0-9 /-]*)`))
    if (!v) break
    const words = v[2].trim().split(' ')
    let done = false
    for (let n = Math.min(words.length, 7); n >= 1 && !done; n--) {
      const range = parseWhen(words.slice(0, n).join(' '), now)
      if (!range) continue
      const df = fieldFor(v[1], fields.filter(dateField)) || dateFieldFor(fields, v[1])
      const yf = fields.filter(numericField).find(f => /year|\byr\b/i.test(`${f.name} ${f.alias || ''}`) && (fieldFor(v[1], [f]) || fields.filter(numericField).filter(x => /year|\byr\b/i.test(`${x.name} ${x.alias || ''}`)).length === 1))
      const f = df && fieldFor(v[1], [df]) ? df : yf || fieldFor(v[1], fields, 'date') || df
      if (!f) break
      clauses.push({ field: f, sql: dateField(f) ? dateClause(sqlName(f), range) : yearClause(sqlName(f), range), said: `${v[1]} ${words.slice(0, n).join(' ')}` })
      t = t.replace(`${v[1]} ${words.slice(0, n).join(' ')}`, ' ')
      done = true
    }
    if (!done) break
  }

  // ---- numbers: "over 5 acres", "worth more than 500000", "between 2 and 5 acres", "4 lanes", "built before 1960"
  const UNIT = '(acres?|ac|sq ?ft|square feet|feet|foot|ft|inch(?:es)?|in|miles?|mi|lanes?|mph|gpm|psi|years? old|years?|stories|floors|units|bedrooms?|beds?|bathrooms?|baths?|people|dollars?|%)'
  const unitField = (unit: string, before: string, money: boolean): QueryField | null => {
    const u = unit.replace(/s$/, '')
    const bw = before.split(' ').filter(w => w && !/^(?:for|at|of|is|are|was|were|with|a|an|the|that|which|have|has|having|and)$/.test(w))
    const tries = [bw.slice(-3).join(' '), bw.slice(-2).join(' '), bw.slice(-1).join(' ')].filter(Boolean)
    for (const p of tries) { const f = fieldOf(p, 'number'); if (f) return f }
    if (money) return fieldFor('value', fields, 'number')
    if (u) return fieldFor(/^(?:ac|acre)$/.test(u) ? 'acres' : /sq ?ft|square/.test(u) ? 'area' : /^(?:feet|foot|ft|mile|mi)$/.test(u) ? 'length' : /^(?:inch|inche|in)$/.test(u) ? 'diameter' : /years? old|year/.test(unit) ? 'year' : /^bed/.test(u) ? 'bedrooms' : /^bath/.test(u) ? 'bathrooms' : u, fields, 'number')
    return null
  }
  const OPS: Array<[string, string, string]> = [
    ['at least|no less than|or more|>=', '>=', 'at least'], ['at most|no more than|up to|or less|or fewer|<=', '<=', 'at most'],
    ['over|above|more than|greater than|bigger than|larger than|higher than|taller than|longer than|older than|exceeding|exceeds|>', '>', 'over'],
    ['under|below|less than|smaller than|fewer than|lower than|shorter than|newer than|<', '<', 'under'],
    ['exactly|equal to|equals|=', '=', '']
  ]
  if ((m = t.match(new RegExp(`([a-z ]*?)\\bbetween ${NUM} (?:and|to) ${NUM}\\s?${UNIT}?`)))) {
    const lo = toNumber(m[2], m[3]); const hi = toNumber(m[4], m[5])
    const f = unitField(m[6] || '', m[1].trim(), /\$/.test(m[0])) || fieldFor(t.slice((m.index || 0) + m[0].length).trim().split(' ').slice(0, 2).join(' '), fields, 'number')
    if (f && lo <= hi) { clauses.push({ field: f, sql: `(${sqlName(f)} >= ${lo} AND ${sqlName(f)} <= ${hi})`, said: `${fieldLabel(f)} between ${lo.toLocaleString()} and ${hi.toLocaleString()}` }); t = t.replace(m[0], ` ${m[1]} `) }
  }
  for (let guard = 0; guard < 4; guard++) {
    let found = false
    for (const [words, op, saidOp] of OPS) {
      const re = new RegExp(`([a-z¦ ]*?)(?:\\b|(?<=\\s))(?:is |are |was |were |of |at |that (?:is|are) )?(?:${words})\\s?${NUM}\\+?\\s?${UNIT}?`)
      const c = t.match(re)
      if (!c) continue
      const value = toNumber(c[2], c[3])
      const before = c[1].replace(/¦/g, ' ').replace(/\s+/g, ' ').trim()
      const after = t.slice((c.index || 0) + c[0].length).trim().split(' ').slice(0, 2).join(' ')
      // "before/after 1990" on its own is a year; a four-digit number with "built" or "installed" too.
      const f = unitField(c[4] || '', before, /\$/.test(c[0])) || fieldOf(after, 'number')
      if (!f) continue
      // "older than 30 years": a year field compared the other way round.
      const years = /years? old/.test(c[4] || '') || (/years?/.test(c[4] || '') && /older|newer/.test(c[0]))
      const sqlOp = years ? ({ '>': '<', '<': '>', '>=': '<=', '<=': '>=', '=': '=' } as any)[op] : op
      const sqlValue = years ? now.getFullYear() - value : value
      clauses.push({ field: f, sql: `${sqlName(f)} ${sqlOp} ${sqlValue}`, said: `${fieldLabel(f)} ${years ? (op === '>' ? 'before' : op === '<' ? 'after' : 'in') : saidOp} ${years ? sqlValue : value.toLocaleString()}`.replace(/\s+/g, ' ') })
      t = t.replace(c[0], ` ${c[1].split(' ').filter(w => w === '¦' || (tagOf(w) !== f && !fieldFor(w, [f as QueryField]))).join(' ')} `)
      found = true
      break
    }
    if (!found) break
  }
  // "built before 1960", "installed after 2010" with a year field (no date phrase caught it above).
  if ((m = t.match(new RegExp(`\\b(${VERBS}|built)\\s+(before|after|since|in)\\s+(\\d{4})\\b`)))) {
    const f = fieldFor(m[1], fields, 'date') || fieldFor('year', fields, 'number')
    if (f && numericField(f)) { const y = Number(m[3]); const op = m[2] === 'before' ? '<' : m[2] === 'after' ? '>' : m[2] === 'since' ? '>=' : '='; clauses.push({ field: f, sql: `${sqlName(f)} ${op} ${y}`, said: `${m[1]} ${m[2]} ${y}` }); t = t.replace(m[0], ' ') }
  }
  // "built in the 1950s", "from the 1990s": a decade on a year field.
  if ((m = t.match(new RegExp(`\\b(?:(${VERBS}|built)\\s+)?(?:in|during|from) the (\\d{3})0s\\b`)))) {
    const f = (m[1] && fieldFor(m[1], fields, 'date')) || fieldFor('year', fields, 'number')
    if (f && numericField(f)) { const y = Number(m[2]) * 10; clauses.push({ field: f, sql: `(${sqlName(f)} >= ${y} AND ${sqlName(f)} <= ${y + 9})`, said: `${fieldLabel(f)} in the ${y}s` }); t = t.replace(m[0], ' ') }
  }
  // "diameter 8", "with a speed limit of 30": a number field's own word, then a number.
  if ((m = t.match(/\b([a-z]{3,}(?: [a-z]{3,})?|fld[a-z]x)\s+(?:of |is |= ?|equal to )?(\d[\d.]*)\b(?!\s*(?:st|nd|rd|th|ave|street)\b)/))) {
    const f = fieldOf(m[1], 'number') || fieldOf(m[1].split(' ').pop() as string, 'number')
    if (f && !/year|\byr\b/i.test(`${f.name} ${f.alias || ''} ${fieldLabel(f)}`) && !clauses.some(c => c.field === f)) { clauses.push({ field: f, sql: `${sqlName(f)} = ${Number(m[2])}`, said: `${fieldLabel(f)} ${Number(m[2])}` }); t = t.replace(m[0], ' ') }
  }
  // "4 lanes", "4-lane", "2 stories": a whole number right before a field's own word.
  if ((m = t.match(/\b(\d{1,4})[ -]([a-z0-9]{3,})\b/))) {
    const f = fieldOf(m[2], 'number')
    if (f && /integer|short|long/i.test(f.type || '') && !/year|\byr\b/i.test(`${f.name} ${f.alias || ''}`)) { clauses.push({ field: f, sql: `${sqlName(f)} = ${Number(m[1])}`, said: `${Number(m[1])} ${fieldLabel(f).toLowerCase()}` }); t = t.replace(m[0], ' ') }
  }

  // ---- values: words that are a value some field really holds ("R-4", "commercial", "out of service")
  const textFields = fields.filter(f => !hidden(f) && (isText(f) || f.domain?.codedValues))
  const byField = new Map<QueryField, Array<{ label: string, stored: any, not: boolean }>>()
  for (let guard = 0; guard < 6; guard++) {
    const words = t.split(' ').filter(Boolean)
    let best: { f: QueryField, v: { label: string, stored: any }, from: number, n: number } | null = null
    for (let n = Math.min(5, words.length); n >= 1 && !best; n--) {
      for (let i = 0; i + n <= words.length && !best; i++) {
        const gram = words.slice(i, i + n)
        if (gram.includes('¦') || gram.every(w => STOP.has(w)) || gram.some(w => tagOf(w))) continue
        const key = nk(gram.join(' '))
        if (key.length < 2) continue
        const cands: Array<{ f: QueryField, v: { label: string, stored: any } }> = []
        for (const f of textFields) for (const v of knownValues(L, f)) { const vk = nk(v.label); if (vk === key || (key.length > 3 && (vk === key.replace(/s$/, '') || vk + 's' === key)) || nk(String(v.stored)) === key) cands.push({ f, v }) }
        // A near miss on a longer value is a typo ("servce", "comercial"), read as the value.
        if (!cands.length && key.length >= 6) for (const f of textFields) for (const v of knownValues(L, f)) { const vk = nk(v.label); if (Math.abs(vk.length - key.length) <= 1 && vk[0] === key[0] && near1(vk, key)) cands.push({ f, v }) }
        if (!cands.length) continue
        // The same word in two fields: the field named next to it wins ("zoned commercial", "commercial use").
        const near = [words[i - 1], words[i - 2], words[i + n], words[i + n + 1]].filter(Boolean)
        const pickC = cands.find(c => near.some(w => tagOf(w) === c.f || fieldFor(w, [c.f]))) || cands[0]
        best = { ...pickC, from: i, n }
      }
    }
    if (!best) break
    const words2 = t.split(' ').filter(Boolean)
    // "not zoned R-4", "not in R-4", "except commercial": a no-word just before, with only the field's own word or small words between.
    const back = words2.slice(Math.max(0, best.from - 3), best.from)
    let not = false
    for (let k = back.length - 1; k >= 0; k--) { if (/^(?:not|no|except|excluding|without|but|besides)$/.test(back[k])) { not = true; break } if (!(STOP.has(back[k]) || fieldFor(back[k], [best.f]) || tagOf(back[k]) === best.f)) break }
    if (not) for (let k = best.from - 1; k >= Math.max(0, best.from - 3); k--) if (/^(?:not|no|except|excluding|without|but|besides)$/.test(words2[k])) { words2[k] = ''; break }
    const list = byField.get(best.f) || []
    list.push({ ...best.v, not }); byField.set(best.f, list)
    // Take the value out, and the field's own word beside it ("zoned", "status", "use").
    words2.splice(best.from, best.n, '¦')
    for (const at of [best.from - 1, best.from + 1]) if (words2[at] && words2[at] !== '¦' && fieldFor(words2[at], [best.f]) && !/^\d/.test(words2[at])) words2[at] = ''
    t = ` ${words2.filter(Boolean).join(' ')} `
  }
  for (const [f, list] of byField) {
    const lit = (v: any): string => typeof v === 'number' ? String(v) : quote(String(v))
    const yes = list.filter(v => !v.not); const no = list.filter(v => v.not)
    if (yes.length) clauses.push({ field: f, sql: yes.length === 1 ? `${sqlName(f)} = ${lit(yes[0].stored)}` : `${sqlName(f)} IN (${yes.map(v => lit(v.stored)).join(', ')})`, said: `${fieldLabel(f)} ${yes.map(v => v.label).join(' or ')}` })
    if (no.length) clauses.push({ field: f, sql: no.length === 1 ? `${sqlName(f)} <> ${lit(no[0].stored)}` : `${sqlName(f)} NOT IN (${no.map(v => lit(v.stored)).join(', ')})`, said: `${fieldLabel(f)} not ${no.map(v => v.label).join(' or ')}` })
  }

  // ---- yes or no fields: "with a playground", "that have playgrounds", "without a playground"
  for (let guard = 0; guard < 3; guard++) {
    const y = t.match(/\b(with(?:out)?|(?:that |which )?(?:have|has|having)|(?:that |which )?(?:don't|do not|doesn't|does not) have|with no|no)\s+(?:a |an |any |the )?([a-z]{3,}(?: [a-z]{3,})?)\b/)
    if (!y) break
    const f = fieldFor(y[2], fields) || fieldFor(y[2].split(' ')[0], fields)
    const vals = f ? knownValues(L, f) : []
    const yesV = vals.find(v => /^(?:yes|y|true|t|1)$/i.test(v.label)); const noV = vals.find(v => /^(?:no|n|false|f|0)$/i.test(v.label))
    if (!f || !yesV || !noV) break
    const neg = /without|don't|do not|doesn't|does not|\bno\b/.test(y[1])
    const v = neg ? noV : yesV
    clauses.push({ field: f, sql: `${sqlName(f)} = ${typeof v.stored === 'number' ? v.stored : quote(String(v.stored))}`, said: `${neg ? 'without' : 'with'} ${fieldLabel(f).toLowerCase()}` })
    t = t.replace(y[0], ' ')
  }

  // ---- free text: "owned by Rivera", "on Maple St", "named Compass"
  const freeText = (re: RegExp, hint: string): void => {
    const x = t.match(re)
    if (!x) return
    const f = fieldFor(hint, fields, 'text')
    const value = (x[1] || '').replace(/¦/g, ' ').replace(/\b(?:everything|anything|all|what|which|parcels?|properties|property|land|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
    if (!f || value.length < 2 || /[%_]/.test(value)) return
    clauses.push({ field: f, sql: `UPPER(${sqlName(f)}) LIKE ${quote('%' + value.toUpperCase() + '%')}`, said: `${fieldLabel(f)} containing “${value}”` })
    t = t.replace(x[0], ' ')
  }
  freeText(/\b(?:owned by|belonging to|belongs to|owner is|owner named|owner)\s+([a-z0-9&.' -]{2,40}?)\s*(?=$| and | that | with | in | over | under )/, 'owner')
  freeText(/\b(?:does|do)\s+([a-z0-9&.' -]{2,40}?)\s+own\b/, 'owner')
  if (!/^ (?:who|what|which|whose) /.test(t)) freeText(/\b([a-z0-9&.' -]{2,30}?)\s+owns\b/, 'owner')
  freeText(/\b(?:named|called)\s+([a-z0-9&.' -]{2,40}?)\s*(?=$| and | that | with )/, 'name')
  freeText(/\b(?:on|along)\s+([a-z0-9.' -]{2,30}? (?:st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|way|ct|court|pl|place|hwy|highway))\b/, fieldFor('address', fields, 'text') ? 'address' : 'name')

  // ---- what is asked for
  const left = rest().filter(w => !STOP.has(w) && !/^[\d$%.<>=+-]+$/.test(w))
  const looseWords = left.length > 0
  if (ownerRank) { const of = fieldFor('owner', fields, 'text'); if (of) { const size = fieldFor('acres', fields, 'number'); return { layer: L.key, kind: 'group', clauses, group: of, field: ownerRank === 'land' && size ? size : undefined, stat: ownerRank === 'land' && size ? 'sum' : undefined, order: order || 'desc', limit: limit || 5, unknown: [] } } }
  // A field named in what is left: the thing measured, ranked or listed.
  let field: QueryField | null = null
  const takeField = (want?: 'number' | 'text' | 'date'): QueryField | null => {
    for (let i = 0; i < left.length; i++) { const f = tagOf(left[i]); if (f && fields.includes(f) && (!want || (want === 'number' ? numericField(f) : want === 'text' ? isText(f) : true))) { left.splice(i, 1); return f } }
    for (let n = Math.min(3, left.length); n >= 1; n--) {
      for (let i = 0; i + n <= left.length; i++) {
        const f = fieldFor(left.slice(i, i + n).join(' '), fields, want)
        if (f && !clauses.some(c => c.field === f && n === 1 && !want)) { left.splice(i, n); return f }
      }
    }
    return null
  }
  let kind: Ask['kind'] = 'list'
  if (groupField && !numericField(groupField) && (superlative || rankWords)) {
    // "Which land use has the highest average value": groups ranked by a number; with no number named, by how many.
    field = rankField || takeField('number') || (superlative ? fieldFor(supClass, fields, 'number') : null)
    kind = 'group'; limit = limit || 5
    if (field) stat = stat || 'avg'; else stat = undefined
  } else if (superlative) {
    kind = 'top'
    field = rankField || (supDate ? (fieldFor(supClass, fields, 'date') || fields.find(f => dateField(f)) || null) : supClass === 'size' ? (sizeField(fields) || fieldFor(supClass, fields, 'number')) : fieldFor(supClass, fields, 'number'))
    if (supDate && !field) field = fieldFor('year', fields, 'number')
    // "biggest" with a number field named: that field. Without one, the layer's size field.
    if (!field) return null
  } else if (rankWords || (rankField && limit)) {
    field = rankField || takeField('number')
    if (field) kind = 'top'
    else if (groupField || (field = takeField())) { kind = 'group'; limit = limit || 5 } else return null
  } else if (stat) {
    field = takeField('number')
    if (!field) { field = fieldFor('size', fields, 'number'); if (!field || !/size|area|acre|big|large/.test(input.toLowerCase())) return null }
    kind = groupField ? 'group' : 'stat'
  } else if (common) { const f = groupField || takeField() || (hit ? fields.find(x => x.name === L.displayField) || null : null); if (!f) return null; groupField = f; kind = 'group'; order = common; limit = limit || 5 } else if (countDistinct) { field = takeField(); if (!field) return null; kind = 'distinct' } else if (groupField) kind = 'group'
  else if (counting && !groupField && (field = takeField('number')) && !/year|\byr\b/i.test(`${field.name} ${field.alias || ''}`)) { stat = 'sum'; kind = 'stat' }
  else if (distinctAsk) { field = takeField() || (hit && distinctStrong && !left.length ? fields.find(f => f.name === L.displayField) || null : null); if (!field) return null; kind = 'distinct' } else if (counting) kind = 'count'
  else if (chart) { field = takeField(); if (!field) return null; kind = 'group' } else {
    // "what is the max height in MU", "speed limit on Oak St": one field of the records that match.
    field = clauses.length || left.length ? takeField() : null
    // "Which parks are ADA compliant": a yes-or-no flag stored as 1 and 0 is a filter, not a thing to look up.
    if (field && !clauses.length && !left.length && /small-?integer|esriFieldTypeSmallInteger/i.test(field.type || '') && /\b(?:are|is|have|has)\b/.test(input.toLowerCase())) { clauses.push({ field, sql: `${sqlName(field)} = 1`, said: fieldLabel(field) }); field = null }
    if (field && !clauses.some(c => c.field === field)) kind = 'attr'
    else { field = null; kind = 'list' }
  }
  if (kind === 'group' && !groupField && field && !stat && !rankWords) { /* chart of land use */ }
  const group = kind === 'group' ? (groupField || (stat || rankWords ? null : field)) : null
  if (kind === 'group' && !group) {
    // "which owner has the most parcels": the text field named is the group.
    if (field && !numericField(field)) return { layer: L.key, kind, clauses, group: field, order: order || 'desc', limit, chart, unknown: left.filter(w => w.length > 1 && !tagOf(w)) }
    return null
  }
  // Nothing recognized beyond a layer name: not a data question (the layer card answers "parcels").
  if (kind === 'list' && !clauses.length && !left.length && !/^ (?:which|what|list|show|find|get|give) /.test(` ${input.toLowerCase()} `.replace(/\s+/g, ' '))) return null
  if (kind === 'list' && !clauses.length && !left.length) return null
  const unknown = left.filter(w => w.length > 1 && !tagOf(w) && !fieldFor(w, fields))
  return {
    layer: L.key, kind, clauses,
    field: kind === 'group' ? (stat ? field || undefined : undefined) : field || undefined,
    stat, group: group || undefined, order: order || (kind === 'group' ? 'desc' : undefined), limit: kind === 'top' ? limit || 1 : limit, chart: chart || undefined,
    superlative: superlative || (rankWords && field ? `${/most|high|great|max/.test(rankWords) ? 'highest' : 'lowest'} ${fieldLabel(field)}` : '') || undefined,
    unknown,
    loose: looseWords
  }
}

/** The filter as one WHERE clause ('' when there is none). */
export function askWhere (ask: Ask): string { return ask.clauses.map(c => c.sql).join(' AND ') }
/** The filter in words: "Zoning R-4, Acres over 5". */
export function askSaid (ask: Ask): string { return ask.clauses.map(c => c.said).join(', ') }

/**
 * A thing on the map called by its own name: "Maple St", "Compass Park", "H-107". Matches the
 * words against the values of each layer's name field. Null when no layer has exactly that name.
 */
export function namedFeature (phrase: string, layers: AskLayer[]): { layer: AskLayer, field: QueryField, value: string } | null {
  const key = nk(phrase.replace(/^(?:the|a|an)\s+/i, ''))
  if (key.length < 3) return null
  for (const l of layers) {
    const f = l.fields.find(x => x.name === l.displayField)
    if (!f) continue
    const v = (l.values?.[f.name] || []).find(x => nk(x) === key)
    if (v) return { layer: l, field: f, value: v }
  }
  return null
}
