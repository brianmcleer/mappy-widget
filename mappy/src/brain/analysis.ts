/** A deliberately small query language: field names are resolved from metadata. */
import { fieldLabel } from './fields'
import { parseWhen, dateClause, yearClause, dateCompare } from './dates'
export interface AnalysisRequest {
  kind: 'stats' | 'group' | 'filter' | 'countWhere' | 'browse' | 'quality' | 'percent'
  layer: string
  field?: string
  /** Grouped statistics: "average acres by zoning" groups by `field` and takes `stat` of `valueField`. */
  stat?: 'avg' | 'sum' | 'min' | 'max'
  valueField?: string
  condition?: string
  inView: boolean
  offset?: number
  limit?: number
  order?: 'asc' | 'desc'
}
export interface QueryField { name: string, alias?: string, type?: string, domain?: any }
const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2')
const fieldKey = (s: string) => unquote(s).toLowerCase().replace(/[\s_]+/g, '')

/** Find a filter delimiter without interpreting words inside quoted names or values. */
function filterParts (text: string): [string, string] | null {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || (ch === "'" && !/\w/.test(text[i - 1] || ''))) { quote = ch; continue }
    const m = text.slice(i).match(/^\s+(?:where|with)\s+/i)
    if (m) return [text.slice(0, i), text.slice(i + m[0].length)]
  }
  return null
}

export function resultCountFollowup (input: string): boolean {
  return /^(?:(?:how many|count)(?: of)? (?:those|them|matches|matching (?:rows|features|records))|how many (?:are there|matched)|count (?:the )?(?:results|matches))[.!?]*$/i.test(input.trim())
}

export function resultTableFollowup (input: string): boolean {
  return /^(?:(?:show|put) (?:those|them|the results|the matches) in (?:a |the )?table|(?:show|open|browse) (?:its|their|the results?) (?:table|rows|records)|(?:show|open|browse) (?:the )?(?:matching rows|matching records|matches|results))[.!?]*$/i.test(input.trim())
}

export function analysisFollowup (input: string, previous?: AnalysisRequest | null): string | null {
  if (!previous || previous.limit) return null
  const q = input.trim().replace(/[?!]+$/, '')
  const layer = JSON.stringify(previous.layer)
  const condition = previous.condition ? ` where ${previous.condition}` : ''
  const scope = previous.inView ? ' in view' : ''
  if (['browse', 'filter', 'countWhere', 'percent'].includes(previous.kind)) {
    const sort = q.match(/^(?:sort|order)(?: (?:them|those|the table|the results))? by\s+(.+?)(?:\s+(ascending|descending|asc|desc|a to z|z to a|highest first|lowest first))?$/i)
    if (sort) return `show table ${layer} sorted by ${JSON.stringify(unquote(sort[1]))} ${/^(?:desc|descending|z to a|highest first)$/i.test(sort[2] || '') ? 'desc' : 'asc'}${condition}${scope}`
    if (previous.kind === 'browse' && previous.field && /^(?:reverse (?:the )?(?:sort )?order|sort (?:it |them )?the other way)$/i.test(q)) return `show table ${layer} sorted by ${JSON.stringify(previous.field)} ${previous.order === 'desc' ? 'asc' : 'desc'}${condition}${scope}`
  }
  if (resultCountFollowup(q)) return `count ${layer}${condition}${scope}`
  if (resultTableFollowup(q)) {
    if (previous.limit) return null // A ranked subset is not the entire filtered dataset.
    const sort = previous.kind === 'browse' && previous.field ? ` sorted by ${JSON.stringify(previous.field)} ${previous.order || 'asc'}` : ''
    return `show table ${layer}${sort}${condition}${scope}`
  }
  return null
}
/** The field that means size for a layer: acres, area, length, in that order. */
export function sizeField (fields: QueryField[]): QueryField | null {
  const num = fields.filter(numericField)
  const by = (re: RegExp) => num.find(f => re.test(f.name) || re.test(f.alias || ''))
  return by(/acre/i) || by(/\barea\b|sq_?f(?:ee)?t|sqft|square/i) || by(/shape.?(?:st)?area/i) || by(/length|\blen\b|miles|feet/i) || by(/shape.?(?:st)?len/i) || null
}

/** Date, date-only and timestamp-offset fields. */
export const dateField = (f: QueryField): boolean => /^(?:date|date-only|timestamp-offset|esriFieldTypeDate|esriFieldTypeDateOnly|esriFieldTypeTimestampOffset)$/i.test(f.type || '')
const dateOnlyField = (f: QueryField): boolean => /^(?:date-only|esriFieldTypeDateOnly)$/i.test(f.type || '')

/** Which words point at which date field: "edited" at last_edited_date, "installed" at INSTALL_DATE. */
const DATE_HINTS: Array<[RegExp, RegExp]> = [
  [/^(?:edited|updated|changed|modified)$/, /last.?edit|edit.?date|editdate|modif|updated|last.?update|changed/i],
  [/^(?:created|added|entered|recorded)$/, /creat|added|entered|record/i],
  [/^(?:installed|placed|set)$/, /install|in.?service|placed/i],
  [/^(?:inspected|checked|surveyed|tested|flushed|cleaned|maintained|serviced)$/, /inspect|survey|test|flush|clean|maint|service|check/i],
  [/^(?:built|constructed)$/, /built|construct|install/i],
  [/^(?:replaced|repaired|rehabbed|lined|paved|painted)$/, /replac|repair|rehab|lin(?:ed|ing)|pave|paint/i],
  [/^(?:sold|transferred)$/, /sale|sold|transfer|deed/i],
  [/^(?:issued|opened|submitted|reported|requested)$/, /issue|open|submit|report|request|receiv/i],
  [/^(?:closed|completed|finished|resolved)$/, /clos|complet|finish|resolv/i],
  [/^(?:flown|captured|collected|acquired)$/, /flown|flight|captur|collect|acqui/i]
]

/** The date field a verb points at ("edited" -> last_edited_date), or the only date field there is. Null when there is none. */
export function dateFieldFor (fields: QueryField[], verb: string): QueryField | null {
  const dates = fields.filter(dateField)
  const hint = DATE_HINTS.find(([v]) => v.test(verb.toLowerCase()))
  if (hint) { const f = dates.find(d => hint[1].test(`${d.name} ${d.alias || ''}`)); if (f) return f }
  return dates.length === 1 ? dates[0] : null
}

/** The numeric year field a verb points at ("built" -> YEAR_BUILT), for layers that store years, not dates. */
function yearFieldFor (fields: QueryField[], verb: string): QueryField | null {
  const years = fields.filter(numericField).filter(x => /year|\byr\b/i.test(`${x.name} ${x.alias || ''}`))
  const hint = DATE_HINTS.find(([v]) => v.test(verb.toLowerCase()))
  return (hint && years.find(y => hint[1].test(`${y.name} ${y.alias || ''}`))) || (years.length === 1 ? years[0] : null)
}

export function resolveField (fields: QueryField[], name: string): QueryField {
  if (name === '*size*') { const f = sizeField(fields); if (f) return f; throw new Error('This layer has no size field (acres, area or length) to rank by.') }
  if (name === '*year*') {
    const f = fields.filter(numericField).find(x => /year|\byr\b|built|install/i.test(`${x.name} ${x.alias || ''}`)) || fields.filter(dateField).find(x => /built|install|construct|in.?service/i.test(`${x.name} ${x.alias || ''}`))
    if (f) return f
    throw new Error('This layer has no year field (year built, install year) to compare.')
  }
  const key = fieldKey(unquote(name).replace(/^(?:the|its|their)\s+/i, ''))
  const exact = fields.filter(f => fieldKey(f.name) === key)
  let matches = exact.length ? exact : fields.filter(f => fieldKey(f.alias || '') === key || fieldKey(fieldLabel(f)) === key)
  // "zone" for Zoning, "owner" for Owner name, "area" for Lot Area: one field whose words start the same way.
  if (!matches.length && key.length >= 3) {
    const stem = (x: string) => x.replace(/(?:ing|es|s|e)$/, '')
    const loose = fields.filter(f => {
      const names = [f.name, f.alias || '', fieldLabel(f)].map(fieldKey)
      return names.some(n => n === key || stem(n) === stem(key) || (key.length >= 4 && (n.startsWith(key) || n.endsWith(key))) || n.split(/[^a-z0-9]+/).includes(key))
        || [f.name, f.alias || '', fieldLabel(f)].some(n => n.toLowerCase().split(/[\s_]+/).map(stem).includes(stem(key)))
    })
    if (loose.length === 1) matches = loose
  }
  // "edited date", "installed date": the date field the verb points at.
  const verb = !matches.length && unquote(name).trim().match(/^([a-z]+)\s+date$/i)
  if (verb) {
    const f = dateFieldFor(fields, verb[1]) || yearFieldFor(fields, verb[1])
    if (!f) {
      const dates = fields.filter(dateField)
      throw new Error(dates.length ? `Which date? This layer has ${dates.map(d => fieldLabel(d)).join(', ')}.` : 'This layer has no date fields to ask about.')
    }
    matches = [f]
  }
  if (matches.length !== 1) throw new Error(`Which one do you mean? Try one of these: ${fields.filter(f => !/^(?:objectid|fid|globalid|shape.*)$/i.test(f.name)).slice(0, 18).map(f => fieldLabel(f)).join(', ')}.`)
  if (!/^[a-z_][a-z0-9_.]*$/i.test(matches[0].name)) throw new Error('This field name is not supported for queries.')
  return matches[0]
}
export const numericField = (f: QueryField): boolean => /^(?:small-integer|integer|single|double|long|short|oid|big-integer|esriFieldType(?:SmallInteger|Integer|Single|Double|OID|BigInteger))$/i.test(f.type || '')

export function parseAnalysis (text: string): AnalysisRequest | null {
  const inView = /\s+(?:in view|on screen|here)[?.!]*$/i.test(text)
  const q = text.replace(/\s+(?:in view|on screen|here)[?.!]*$/i, '').replace(/[?!]+$/, '').trim()
  const filtered = filterParts(q)
  if (filtered) {
    const base = parseAnalysis(filtered[0])
    if (base) return { ...base, condition: filtered[1], inView }
    // Only a real condition ("acres > 5", "owner contains Smith"), never "where the hydrants are".
    const conditionLike = /(?:[<>=]|\b(?:is|equals|contains|starts with|between|greater|less|more|fewer|over|under|at least|at most|not|before|after|since|during|last|this|today|yesterday)\b)/i.test(filtered[1]) && !/^(?:i am|i was|it is|they are)\b/i.test(filtered[1]) && !/^the \w+ (?:are|is)(?:\s+(?:located|at|in|on|near|here|there|shown|showing|drawn))?$/i.test(filtered[1])
    const share = conditionLike ? filtered[0].match(/^(?:what|which)\s+(?:percent(?:age)?|share|fraction|portion|proportion)\s+of\s+(?:the\s+|all\s+)?(.+)$/i) : null
    if (share) return { kind: 'percent', layer: unquote(share[1]), condition: filtered[1], inView }
    const command = conditionLike ? filtered[0].match(/^(filter|select|show(?: me)?|find|count|how many|list|which|what)\s+(?:the\s+|all\s+)?(.+)$/i) : null
    if (command) return { kind: /count|how many/i.test(command[1]) ? 'countWhere' : 'filter', layer: unquote(command[2]), condition: filtered[1], inView }
    // "Parcels where owner is Smith": a layer name alone (with "where" only).
    if (conditionLike && /\s+where\s+/i.test(q) && /^(?:the\s+)?[a-z][a-z0-9 _'-]{1,40}$/i.test(filtered[0])) return { kind: 'filter', layer: unquote(filtered[0].replace(/^the\s+/i, '')), condition: filtered[1], inView }
  }
  // "Parcels owned by Smith", "list parcels owned by smith", "how many parcels does Smith own", "Smith's parcels".
  const owned = q.match(/^(?:show(?: me)?\s+|find\s+|list\s+|count\s+|how many\s+|which\s+|what\s+)?(?:the\s+|all\s+)?(.+?)\s+(?:owned|held) by\s+(.+)$/i) || q.match(/^how many\s+(.+?)\s+(?:does|do)\s+(.+?)\s+own$/i)
  if (owned) {
    const counting = /^(?:count|how many)\b/i.test(q)
    return { kind: counting ? 'countWhere' : 'filter', layer: unquote(owned[1]), condition: `owner contains ${unquote(owned[2]).replace(/^(?:the\s+)?/i, '')}`, inView }
  }
  // "What zoning is most common": the layer is whichever has that field (resolved by the caller when missing).
  const common = q.match(/^(?:what|which)\s+(.+?)\s+is\s+(?:the\s+)?(most|least)\s+common(?:\s+(?:in|among|for)\s+(.+))?$/i)
  if (common && common[3]) return { kind: 'group', layer: unquote(common[3]), field: unquote(common[1]), inView, limit: 5, order: common[2].toLowerCase() === 'least' ? 'asc' : 'desc' }
  if (common) return { kind: 'group', layer: '*field*', field: unquote(common[1]), inView, limit: 5, order: common[2].toLowerCase() === 'least' ? 'asc' : 'desc' }
  // "What percent of parcels are over 5 acres", "what share of hydrants were inspected this year".
  const pct = q.match(/^(?:what|which)\s+(?:percent(?:age)?|share|fraction|portion|proportion)\s+of\s+(?:the\s+|all\s+)?(.+?)\s+(?:are|is|were|was|have|has|got)\s+(.+)$/i)
  if (pct) {
    const inner = parseAnalysis(`${pct[1]} ${pct[2]}`)
    const condition = inner?.condition && ['filter', 'countWhere'].includes(inner.kind) ? inner.condition : pct[2]
    return { kind: 'percent', layer: unquote(inner?.condition ? inner.layer : pct[1]), condition, inView }
  }
  // "Average acres by zoning in parcels", "total length of sewer mains by material".
  const STAT = '(average|avg|mean|total|sum|minimum|min|smallest|maximum|max|largest)'
  const toStat = (w: string): 'avg' | 'sum' | 'min' | 'max' => /^(?:average|avg|mean)$/i.test(w) ? 'avg' : /^(?:total|sum)$/i.test(w) ? 'sum' : /^(?:minimum|min|smallest)$/i.test(w) ? 'min' : 'max'
  let gs = q.match(new RegExp(`^(?:what(?:'s| is| are)\\s+(?:the\\s+)?)?${STAT}\\s+(.+?)\\s+(?:in|of|for)\\s+(?:the\\s+|all\\s+)?(.+?)\\s+(?:by|per|for each|in each)\\s+(.+)$`, 'i'))
  if (gs) return { kind: 'group', stat: toStat(gs[1]), valueField: unquote(gs[2]), layer: unquote(gs[3]), field: unquote(gs[4]), inView }
  gs = q.match(new RegExp(`^(?:what(?:'s| is| are)\\s+(?:the\\s+)?)?${STAT}\\s+(.+?)\\s+(?:by|per|for each|in each)\\s+(.+?)\\s+(?:in|of|for)\\s+(?:the\\s+|all\\s+)?(.+)$`, 'i'))
  if (gs) return { kind: 'group', stat: toStat(gs[1]), valueField: unquote(gs[2]), field: unquote(gs[3]), layer: unquote(gs[4]), inView }
  // "How many parcels per zoning", "how many hydrants in each district".
  const per = q.match(/^how many\s+(?:the\s+)?(.+?)\s+(?:per|in each|for each|by)\s+(.+)$/i)
  if (per) return { kind: 'group', layer: unquote(per[1]), field: unquote(per[2]), inView }
  // "Parcels edited in the last 7 days", "how many hydrants were inspected this year",
  // "manholes installed before 1990", "permits issued since March 2024".
  const dated = q.match(new RegExp(`^(?:show(?: me)?\\s+|find\\s+|list\\s+|count\\s+|how many\\s+|which\\s+|what\\s+)?(?:the\\s+|all\\s+|all the\\s+)?(.+?)\\s+(?:(?:that|which|who)\\s+)?(?:(?:were|was|are|is|have been|has been|got|been|have|has)\\s+)?(${DATE_VERBS})\\s+(.+)$`, 'i'))
  if (dated && parseWhen(dated[3])) {
    const counting = /^(?:count|how many)\b/i.test(q)
    return { kind: counting ? 'countWhere' : 'filter', layer: unquote(dated[1]), condition: `${dated[2].toLowerCase()} date ${dated[3].trim()}`, inView }
  }
  // "Which zoning has the most parcels", "what zone type is most common in parcels".
  const most = q.match(/^(?:which|what)\s+(.+?)\s+(?:has|have)\s+the\s+(most|fewest|least)\s+(.+)$/i) || q.match(/^(?:which|what)\s+(.+?)\s+is\s+(?:the\s+)?(most|least)\s+common\s+(?:in|among|for)\s+(.+)$/i)
  if (most) return { kind: 'group', layer: unquote(most[3]), field: unquote(most[1]), inView, limit: 5, order: /fewest|least/i.test(most[2]) ? 'asc' : 'desc' }
  // "Largest parcel", "the 3 smallest parks", "biggest lot in view": ranked by the layer's size field.
  const sized = q.match(/^(?:(?:what(?:'s| is| are)|which(?: is| are)?|show(?: me)?|find)\s+)?(?:the\s+)?(?:(\d+)\s+)?(largest|biggest|smallest|longest|shortest|tiniest)\s+(?:(\d+)\s+)?(.+)$/i)
  if (sized && !/\bby\b/i.test(sized[4])) return { kind: 'browse', layer: unquote(sized[4]), field: '*size*', limit: Number(sized[1] || sized[3] || 1), order: /smallest|shortest|tiniest/i.test(sized[2]) ? 'asc' : 'desc', inView }
  // "Parcels bigger than 5 acres", "hydrants older than 1990", "parcels over 2 acres".
  const compare = q.match(/^(?:show(?: me)?\s+|find\s+|list\s+|count\s+|how many\s+)?(?:the\s+)?(.+?)\s+(bigger|larger|greater|more|over|above|smaller|less|under|below|fewer|newer|older|longer|shorter|higher|lower)\s+(?:than\s+)?([\d,.]+)\s*([a-z][a-z _]*)?$/i)
  if (compare) {
    const op = /bigger|larger|greater|more|over|above|newer|longer|higher/i.test(compare[2]) ? '>' : '<'
    const unit = (compare[4] || '').trim()
    const field = unit && !/^(?:feet|ft|foot|meters?|m|miles?)$/i.test(unit) ? unit.replace(/^(?:sq\.? ?ft|square feet)$/i, 'area') : /older|newer/i.test(compare[2]) ? '*year*' : unit ? 'length' : 'acres'
    const flip = /older/i.test(compare[2]) ? '<' : /newer/i.test(compare[2]) ? '>' : op
    const counting = /^(?:count|how many)\b/i.test(q)
    const layer = compare[1].replace(/^(?:which|what)\s+/i, '').replace(/\s+(?:are|is)$/i, '')
    return { kind: counting ? 'countWhere' : 'filter', layer: unquote(layer), condition: `${field} ${flip} ${compare[3].replace(/,/g, '')}`, inView }
  }
  const quality = q.match(/^(?:check (?:the )?data quality (?:for|in|of)|data quality (?:for|in|of)|what(?:'s| is) missing (?:in|from)|check missing values (?:in|for))\s+(.+)$/i)
  if (quality) return { kind: 'quality', layer: unquote(quality[1]), inView }
  const naturalRank = q.match(/^(?:show(?: me)?\s+)?(?:the\s+)?(\d+)\s+(largest|highest|smallest|lowest)\s+(.+?)\s+by\s+(.+)$/i)
  if (naturalRank) return { kind: 'browse', layer: unquote(naturalRank[3]), field: unquote(naturalRank[4]), limit: Number(naturalRank[1]), order: /smallest|lowest/i.test(naturalRank[2]) ? 'asc' : 'desc', inView }
  const ranked = q.match(/^(top|bottom)\s+(\d+)\s+(.+?)\s+by\s+(.+)$/i)
  if (ranked) return { kind: 'browse', layer: unquote(ranked[3]), field: unquote(ranked[4]), limit: Number(ranked[2]), order: ranked[1].toLowerCase() === 'top' ? 'desc' : 'asc', inView }
  const sorted = q.match(/^(?:show|open|browse)\s+(?:the\s+)?table\s+(?:for\s+)?(.+?)\s+sorted by\s+(.+?)\s+(ascending|descending|asc|desc|a to z|z to a|highest first|lowest first)$/i)
  if (sorted) return { kind: 'browse', layer: unquote(sorted[1]), field: unquote(sorted[2]), order: /^(?:desc|descending|z to a|highest first)$/i.test(sorted[3]) ? 'desc' : 'asc', inView }
  const rows = q.match(/^(?:show|open|browse)\s+(?:the\s+)?table\s+(?:for\s+)?(.+)$/i) || q.match(/^(?:show|list|browse)\s+(?:the\s+)?(?:rows|records)\s+(?:in|from|of)\s+(.+)$/i)
  if (rows) return { kind: 'browse', layer: unquote(rows[1]), inView }
  const numeric = q.match(/^(?:what(?:'s| is)\s+(?:the\s+)?)?(?:average|total|sum|minimum|maximum)(?:\s+of)?\s+(.+?)\s+(?:in|of|for)\s+(.+)$/i)
  if (numeric) return { kind: 'stats', field: unquote(numeric[1]), layer: unquote(numeric[2]), inView }
  let m = q.match(/^(?:summari[sz]e|statistics (?:for|of)|stats (?:for|of))\s+(.+?)\s+(?:in|of|for)\s+(.+)$/i)
  if (m) return { kind: 'stats', field: unquote(m[1]), layer: unquote(m[2]), inView }
  m = q.match(/^(?:count|group|break down)\s+(.+?)\s+by\s+(.+)$/i)
  if (m) return { kind: 'group', layer: unquote(m[1]), field: unquote(m[2]), inView }
  m = q.match(/^(filter|select|count|how many)\s+(.+?)\s+where\s+(.+)$/i)
  if (m) return { kind: /count|how many/i.test(m[1]) ? 'countWhere' : 'filter', layer: unquote(m[2]), condition: m[3], inView }
  return null
}

const DATE_VERBS = 'edited|updated|changed|modified|created|added|entered|recorded|installed|placed|inspected|checked|surveyed|tested|flushed|cleaned|maintained|serviced|built|constructed|replaced|repaired|rehabbed|lined|paved|painted|sold|transferred|issued|opened|submitted|reported|requested|closed|completed|finished|resolved|flown|captured|collected|acquired'
const WHEN_START = /\s+((?:is\s+|was\s+|were\s+)?(?:in the (?:last|past)|within the (?:last|past)|over the (?:last|past)|during the (?:last|past)|the (?:last|past)|last|past|this|previous|today|yesterday|recently|lately|ever|since|after|before|on|in|during|between|from|until|by)\b.*)$/i

/**
 * Up to three conditions joined with "and" ("acres > 5 and zoning is R-4"), each compiled on
 * its own and joined with AND. The "and" of "between 5 and 10" and anything in quotes stay put.
 */
export function compileConditions (text: string, fields: QueryField[], now = new Date()): string {
  const parts = splitConditions(text)
  if (parts.length > 3) throw new Error('Use up to three conditions joined with "and".')
  const compiled = parts.map(p => compileCondition(p, fields, now))
  return compiled.length === 1 ? compiled[0] : compiled.map(c => `(${c})`).join(' AND ')
}

export function splitConditions (text: string): string[] {
  const out: string[] = []
  let quote = ''
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || (ch === "'" && !/\w/.test(text[i - 1] || ''))) { quote = ch; continue }
    const m = text.slice(i).match(/^\s+and\s+/i)
    if (!m) continue
    const seg = text.slice(start, i)
    // "between 5 and 10", "between March 2020 and May 2021": the range's own "and".
    if (/\b(?:between|from)\b/i.test(seg) && !/\b(?:between|from)\b.*\band\b/i.test(seg)) continue
    out.push(seg.trim())
    start = i + m[0].length
    i = start - 1
  }
  out.push(text.slice(start).trim())
  return out.filter(Boolean)
}

/** Compile ONE condition. No raw SQL, Boolean clauses, or inferred field identifiers. */
export function compileCondition (text: string, fields: QueryField[], now = new Date()): string {
  // Time phrases on a date (or year) field: "edited date in the last 7 days", "install date before 1990".
  for (let at = text.search(WHEN_START); at > 0; ) {
    const head = text.slice(0, at); const tail = text.slice(at).trim()
    let field: QueryField | null = null
    try { field = resolveField(fields, head) } catch (e) {
      // "inspected date this year" on a layer without that date: say so, not "use one condition".
      if (/^\s*[a-z]+\s+date\s*$/i.test(head) && parseWhen(tail, now)) throw e
      field = null
    }
    if (field && (dateField(field) || (numericField(field) && /year|\byr\b/i.test(`${field.name} ${field.alias || ''}`)))) {
      const range = parseWhen(tail, now)
      if (!range) throw new Error('Use a time like "in the last 30 days", "this year", "since 2020", "before March 2024" or "between 2020 and 2022".')
      return dateField(field) ? dateClause(field.name, range, dateOnlyField(field)) : yearClause(field.name, range)
    }
    const next = text.slice(at + 1).search(WHEN_START)
    at = next < 0 ? -1 : at + 1 + next
  }
  const range = text.match(/^(.+?)\s+(?:is\s+)?between\s+([+-]?[\d,.]+)\s+and\s+([+-]?[\d,.]+)$/i)
  if (range) {
    const field = resolveField(fields, range[1])
    if (!numericField(field)) throw new Error('Between currently supports numeric fields only.')
    const low = numberValue(range[2]); const high = numberValue(range[3])
    if (low > high) throw new Error('Put the lower value first, for example acres between 5 and 10.')
    return `(${field.name} >= ${low} AND ${field.name} <= ${high})`
  }
  const nullMatch = text.match(/^(.+?)\s+is\s+(not\s+)?(?:null|empty|missing)$/i)
  if (nullMatch) return `${resolveField(fields, nullMatch[1]).name} IS ${nullMatch[2] ? 'NOT ' : ''}NULL`
  const m = text.match(/^(.+?)\s*(>=|<=|!=|<>|=|>|<|\b(?:is )?(?:greater than or equal to|less than or equal to|greater than|less than|more than|fewer than|at least|at most|over|under)\b|\bis not\b|\bequals\b|\bis\b|\bcontains\b|\bstarts with\b)\s*(.+)$/i)
  if (!m) throw new Error('Use one condition, for example: acres > 5, status equals Active, or owner contains Smith.')
  const field = resolveField(fields, m[1])
  const quoted = /^\s*["']/.test(m[3])
  const aliases: Record<string, string> = { 'more than': '>', 'fewer than': '<', over: '>', under: '<', 'greater than': '>', 'less than': '<', 'greater than or equal to': '>=', 'less than or equal to': '<=', 'at least': '>=', 'at most': '<=', 'is not': '<>', '!=': '<>', equals: '=', is: '=' }
  const operator = m[2].toLowerCase().replace(/^is (?!(?:not)$)/, '')
  const op = aliases[operator] || operator
  let value: any = unquote(m[3])
  if (dateField(field)) {
    if (op === 'contains' || op === 'starts with') throw new Error('Use before, after, on, in or a comparison with a date field.')
    return dateCompare(field.name, op === 'is' ? '=' : op, String(value), now, dateOnlyField(field))
  }
  // "zoning is R-4 or R-8 or RM-8": one field, a short list of values.
  if ((op === '=' || op === '<>') && !quoted && /\s+or\s+/i.test(String(value))) {
    const items = String(value).split(/\s*,?\s+or\s+|\s*,\s*/i).map(x => unquote(x)).filter(Boolean)
    if (items.length > 10) throw new Error('Use up to ten values with "or".')
    const one = (x: string): string => {
      const c = field.domain?.codedValues?.filter((cv: any) => String(cv.name).toLowerCase() === x.toLowerCase()) || []
      const v: any = c.length === 1 ? c[0].code : x
      if (numericField(field)) { try { return String(numberValue(String(v))) } catch (e) { throw new Error(`${fieldLabel(field)} needs numbers or coded value labels.`) } }
      if (!/^(?:string|esriFieldTypeString)$/i.test(field.type || '')) throw new Error('Lists work on text and numeric fields.')
      return `'${String(v).replace(/'/g, "''")}'`
    }
    return `${field.name} ${op === '<>' ? 'NOT IN' : 'IN'} (${items.map(one).join(', ')})`
  }
  const coded = field.domain?.codedValues?.filter((c: any) => String(c.name).toLowerCase() === String(value).toLowerCase()) || []
  if (coded.length === 1) value = coded[0].code
  if (numericField(field)) {
    try { value = numberValue(String(value)) } catch (e) { throw new Error(`${fieldLabel(field)} needs a finite number or a coded value label.`) }
    if (op === 'contains' || op === 'starts with') throw new Error('Use a comparison such as = or > for a numeric field.')
    return `${field.name} ${op} ${Number(value)}`
  }
  if (!/^(?:string|esriFieldTypeString)$/i.test(field.type || '')) throw new Error('Conditions work on text, number and date fields; use the app filter tool for other types.')
  const escaped = String(value).replace(/'/g, "''")
  if (op === 'contains' || op === 'starts with') {
    if (/[%_]/.test(escaped)) throw new Error('Use equals for text containing % or _; wildcard searches are not supported.')
    return `UPPER(${field.name}) LIKE '${op === 'contains' ? '%' : ''}${escaped.toUpperCase()}%'`
  }
  return `${field.name} ${op} '${escaped}'`
}

function numberValue (text: string): number {
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Use a number with valid thousands separators.')
  const value = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(value)) throw new Error('Use a finite number.')
  return value
}

/**
 * Everyday ways to ask for a table, as "show table LAYER ...": "open hydrants in the table",
 * "show the parcels table", "attribute table for hydrants where status is active". Null when
 * the text is not one of them.
 */
export function tablePhrase (q: string): string | null {
  const t = q.trim().replace(/[?.!]+$/, '')
  if (/^show table\b/i.test(t) || /table of contents|\btoc\b/i.test(t)) return null
  // "Show the results in a table" means what was just found, not a layer called results.
  const notLayer = (x: string) => /^(?:results?|them|those|these|it|that|this|the results|my results|everything|all)$/i.test(x.trim())
  const tail = (rest: string) => rest ? ' ' + rest.trim() : ''
  let m = t.match(/^(?:open|show|view|put|load|display|pull up|bring up|add|send)(?: me)?(?: all)? (?:the )?(.+?) (?:in|into|on|as|to) (?:a |the )?(?:attribute )?table\b(.*)$/i)
  if (m && !notLayer(m[1])) return `show table ${m[1]}${tail(m[2])}`
  m = t.match(/^(?:open|show|view|display|pull up|bring up)(?: me)? (?:the |an? )?(?:attribute )?table (?:for|of) (?:the )?(.+?)(\s+(?:where|with|whose|in view|sorted by)\b.*)?$/i)
  if (m && !notLayer(m[1])) return `show table ${m[1]}${tail(m[2] || '')}`
  m = t.match(/^(?:open|show|view|display|pull up|bring up)(?: me)? (?:the )?(.+?) (?:attribute )?table(\s+(?:where|with|whose|in view|sorted by)\b.*)?$/i)
  if (m && !/^(?:a|the|attribute)$/i.test(m[1]) && !/\s(?:in|into|as|on)(?:\s+(?:a|an|the))?$/i.test(m[1]) && !notLayer(m[1])) return `show table ${m[1]}${tail(m[2] || '')}`
  return null
}
