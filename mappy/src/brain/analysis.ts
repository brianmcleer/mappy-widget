/** A deliberately small query language: field names are resolved from metadata. */
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
  if (/^(?:how many|count)(?: of)? (?:those|them|matches|matching (?:rows|features|records))$/i.test(q)) return `count ${layer}${condition}${scope}`
  if (/^(?:show|put) (?:those|them|the results|the matches) in (?:a |the )?table$/i.test(q)) {
    if (previous.limit) return null // A ranked subset is not the entire filtered dataset.
    return `show table ${layer}${condition}${scope}`
  }
  return null
}
export function resolveField (fields: QueryField[], name: string): QueryField {
  const key = fieldKey(name)
  const exact = fields.filter(f => fieldKey(f.name) === key)
  const matches = exact.length ? exact : fields.filter(f => fieldKey(f.alias || '') === key)
  if (matches.length !== 1) throw new Error(`Choose an exact field name: ${fields.slice(0, 18).map(f => f.alias || f.name).join(', ')}.`)
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
    const command = filtered[0].match(/^(filter|select|show(?: me)?|find|count|how many)\s+(?:the\s+)?(.+)$/i)
    if (command) return { kind: /count|how many/i.test(command[1]) ? 'countWhere' : 'filter', layer: unquote(command[2]), condition: filtered[1], inView }
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
    try { value = numberValue(String(value)) } catch (e) { throw new Error(`${field.alias || field.name} needs a finite number or a coded value label.`) }
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
