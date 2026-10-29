/** A deliberately small query language: field names are resolved from metadata. */
import { fieldLabel } from './fields'
export interface AnalysisRequest {
  kind: 'stats' | 'group' | 'filter' | 'countWhere' | 'browse' | 'quality'
  layer: string
  field?: string
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
  if (['browse', 'filter', 'countWhere'].includes(previous.kind)) {
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

export function resolveField (fields: QueryField[], name: string): QueryField {
  if (name === '*size*') { const f = sizeField(fields); if (f) return f; throw new Error('This layer has no size field (acres, area or length) to rank by.') }
  if (name === '*year*') { const f = fields.filter(numericField).find(x => /year|\byr\b|built|install/i.test(`${x.name} ${x.alias || ''}`)); if (f) return f; throw new Error('This layer has no year field (year built, install year) to compare.') }
  const key = fieldKey(name)
  const exact = fields.filter(f => fieldKey(f.name) === key)
  const matches = exact.length ? exact : fields.filter(f => fieldKey(f.alias || '') === key || fieldKey(fieldLabel(f)) === key)
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
    const conditionLike = /(?:[<>=]|\b(?:is|equals|contains|starts with|between|greater|less|more|fewer|over|under|at least|at most|not)\b)/i.test(filtered[1]) && !/^(?:i am|i was|the \w+ (?:are|is)|it is|they are)\b/i.test(filtered[1])
    const command = conditionLike ? filtered[0].match(/^(filter|select|show(?: me)?|find|count|how many|list|which|what)\s+(?:the\s+|all\s+)?(.+)$/i) : null
    if (command) return { kind: /count|how many/i.test(command[1]) ? 'countWhere' : 'filter', layer: unquote(command[2]), condition: filtered[1], inView }
    // "Parcels where owner is Smith": a layer name alone (with "where" only).
    if (conditionLike && /\s+where\s+/i.test(q) && /^(?:the\s+)?[a-z][a-z0-9 _'-]{1,40}$/i.test(filtered[0])) return { kind: 'filter', layer: unquote(filtered[0].replace(/^the\s+/i, '')), condition: filtered[1], inView }
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

/** Compile ONE condition. No raw SQL, Boolean clauses, or inferred field identifiers. */
export function compileCondition (text: string, fields: QueryField[]): string {
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
  const aliases: Record<string, string> = { 'more than': '>', 'fewer than': '<', over: '>', under: '<', 'greater than': '>', 'less than': '<', 'greater than or equal to': '>=', 'less than or equal to': '<=', 'at least': '>=', 'at most': '<=', 'is not': '<>', '!=': '<>', equals: '=', is: '=' }
  const operator = m[2].toLowerCase().replace(/^is (?!(?:not)$)/, '')
  const op = aliases[operator] || operator
  let value: any = unquote(m[3])
  const coded = field.domain?.codedValues?.filter((c: any) => String(c.name).toLowerCase() === String(value).toLowerCase()) || []
  if (coded.length === 1) value = coded[0].code
  if (numericField(field)) {
    try { value = numberValue(String(value)) } catch (e) { throw new Error(`${fieldLabel(field)} needs a finite number or a coded value label.`) }
    if (op === 'contains' || op === 'starts with') throw new Error('Use a comparison such as = or > for a numeric field.')
    return `${field.name} ${op} ${Number(value)}`
  }
  if (!/^(?:string|esriFieldTypeString)$/i.test(field.type || '')) throw new Error('Conditions currently support text and numeric fields; use the app filter tool for dates and other types.')
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
  let m = t.match(/^(?:open|show|view|put|load|display|pull up|bring up)(?: me)?(?: all)? (?:the )?(.+?) (?:in|into|on|as) (?:a |the )?(?:attribute )?table\b(.*)$/i)
  if (m && !notLayer(m[1])) return `show table ${m[1]}${tail(m[2])}`
  m = t.match(/^(?:open|show|view|display|pull up|bring up)(?: me)? (?:the |an? )?(?:attribute )?table (?:for|of) (?:the )?(.+?)(\s+(?:where|with|whose|in view|sorted by)\b.*)?$/i)
  if (m && !notLayer(m[1])) return `show table ${m[1]}${tail(m[2] || '')}`
  m = t.match(/^(?:open|show|view|display|pull up|bring up)(?: me)? (?:the )?(.+?) (?:attribute )?table(\s+(?:where|with|whose|in view|sorted by)\b.*)?$/i)
  if (m && !/^(?:a|the|attribute)$/i.test(m[1]) && !/\s(?:in|into|as|on)(?:\s+(?:a|an|the))?$/i.test(m[1]) && !notLayer(m[1])) return `show table ${m[1]}${tail(m[2] || '')}`
  return null
}
