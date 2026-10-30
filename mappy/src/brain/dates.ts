/*
  dates.ts - plain-language time phrases for data questions: "in the last 30 days", "this
  year", "since March 2024", "before 1990", "on 6/1/2025", "between 2020 and 2022". Each
  phrase becomes a range [from, to) of local calendar time, and then a WHERE clause on a
  date field (or on a numeric year field when the layer stores years). Pure TypeScript.
*/

export interface TimeRange { from?: Date, to?: Date }
interface Period { start: Date, end: Date, kind: 'day' | 'month' | 'year' }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthIndex = (s: string): number => {
  const t = s.toLowerCase().replace(/\.$/, '')
  if (t.length < 3) return -1
  return MONTHS.findIndex(m => m.startsWith(t) && (t.length >= 3))
}

const day = (y: number, m: number, d: number): Date => new Date(y, m, d)
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const startOfDay = (d: Date): Date => day(d.getFullYear(), d.getMonth(), d.getDate())
const valid = (y: number, m: number, d: number): boolean => { const x = day(y, m, d); return y >= 1000 && y <= 2999 && x.getFullYear() === y && x.getMonth() === m && x.getDate() === d }

/** One calendar period: "2024", "March 2024", "March", "2024-03-05", "3/5/2024", "March 5, 2024". Null when it is none. */
export function parsePeriod (text: string, now = new Date()): Period | null {
  const t = String(text || '').trim().replace(/[?.!]+$/, '').replace(/^(?:the\s+)?/i, '')
  let m = t.match(/^(\d{4})$/)
  if (m) { const y = Number(m[1]); return y >= 1000 && y <= 2999 ? { start: day(y, 0, 1), end: day(y + 1, 0, 1), kind: 'year' } : null }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) { const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]; return valid(y, mo, d) ? { start: day(y, mo, d), end: day(y, mo, d + 1), kind: 'day' } : null }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) { const [mo, d, y] = [Number(m[1]) - 1, Number(m[2]), Number(m[3])]; return valid(y, mo, d) ? { start: day(y, mo, d), end: day(y, mo, d + 1), kind: 'day' } : null }
  m = t.match(/^(\d{4})-(\d{1,2})$/)
  if (m) { const [y, mo] = [Number(m[1]), Number(m[2]) - 1]; return mo >= 0 && mo < 12 && y >= 1000 ? { start: day(y, mo, 1), end: day(y, mo + 1, 1), kind: 'month' } : null }
  m = t.match(/^([a-z]+\.?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i)
  if (m) { const mo = monthIndex(m[1]); const [d, y] = [Number(m[2]), Number(m[3])]; return mo >= 0 && valid(y, mo, d) ? { start: day(y, mo, d), end: day(y, mo, d + 1), kind: 'day' } : null }
  m = t.match(/^([a-z]+\.?)\s+(\d{4})$/i)
  if (m) { const mo = monthIndex(m[1]); const y = Number(m[2]); return mo >= 0 && y >= 1000 && y <= 2999 ? { start: day(y, mo, 1), end: day(y, mo + 1, 1), kind: 'month' } : null }
  m = t.match(/^([a-z]+\.?)$/i)
  if (m) { const mo = monthIndex(m[1]); const y = now.getFullYear(); return mo >= 0 ? { start: day(y, mo, 1), end: day(y, mo + 1, 1), kind: 'month' } : null }
  return null
}

const UNIT_DAYS: { [u: string]: number } = { day: 1, week: 7, month: 0, year: 0 }

/**
 * A time phrase as a range: "in the last 30 days", "past week", "today", "yesterday",
 * "this month", "last year", "since 2020", "after March 2024", "before 1990", "on 6/1/2025",
 * "in 2023", "during May", "between 2020 and 2022", "from 2020 to 2022". `from` is
 * inclusive, `to` exclusive. Null when the phrase is not one of them.
 */
export function parseWhen (phrase: string, now = new Date()): TimeRange | null {
  const t = String(phrase || '').trim().toLowerCase().replace(/[?.!]+$/, '').replace(/^(?:is|was|were|are)\s+/, '').trim()
  const today = startOfDay(now)
  let m = t.match(/^(?:in|within|over|during)?\s*(?:the\s+)?(?:last|past|previous)\s+(\d{1,4}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)?\s*(day|week|month|year)s?$/)
  if (m) {
    const words: { [w: string]: number } = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 }
    const raw = m[1] || ''
    const n = raw ? (words[raw] ?? Number(raw)) : 1
    // "last month" alone (no number, no "the") is the previous calendar month; handled below.
    if (!raw && /^last\s/.test(t)) { /* fall through */ } else {
      if (!Number.isFinite(n) || n < 1 || n > 5000) return null
      const unit = m[2]
      const from = UNIT_DAYS[unit] ? addDays(today, -n * UNIT_DAYS[unit] + 1)
        : unit === 'month' ? day(today.getFullYear(), today.getMonth() - n, today.getDate() + 1)
          : day(today.getFullYear() - n, today.getMonth(), today.getDate() + 1)
      return { from, to: addDays(today, 1) }
    }
  }
  if (t === 'today') return { from: today, to: addDays(today, 1) }
  if (t === 'yesterday') return { from: addDays(today, -1), to: today }
  m = t.match(/^(this|last|previous)\s+(week|month|year)$/)
  if (m) {
    const back = m[1] === 'this' ? 0 : 1
    if (m[2] === 'week') { const start = addDays(today, -today.getDay() - 7 * back); return { from: start, to: back ? addDays(start, 7) : addDays(today, 1) } }
    if (m[2] === 'month') { const start = day(today.getFullYear(), today.getMonth() - back, 1); return { from: start, to: back ? day(today.getFullYear(), today.getMonth(), 1) : addDays(today, 1) } }
    const start = day(today.getFullYear() - back, 0, 1); return { from: start, to: back ? day(today.getFullYear(), 0, 1) : addDays(today, 1) }
  }
  m = t.match(/^(?:between|from)\s+(.+?)\s+(?:and|to|through|until)\s+(.+)$/)
  if (m) { const a = parsePeriod(m[1], now); const b = parsePeriod(m[2], now); return a && b && a.start < b.end ? { from: a.start, to: b.end } : null }
  m = t.match(/^(since|after|before|on|in|during|from|until|by)\s+(.+)$/)
  if (m) {
    const p = parsePeriod(m[2], now)
    if (!p) return null
    switch (m[1]) {
      case 'since': case 'from': return { from: p.start }
      case 'after': return { from: p.end }
      case 'before': case 'until': case 'by': return { to: p.start }
      default: return { from: p.start, to: p.end }
    }
  }
  return null
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** The literal ArcGIS standardized SQL takes: TIMESTAMP 'YYYY-MM-DD HH:MM:SS', or DATE 'YYYY-MM-DD' for date-only fields. */
export function sqlDate (d: Date, dateOnly = false): string {
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return dateOnly ? `DATE '${ymd}'` : `TIMESTAMP '${ymd} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}'`
}

/** A range as a WHERE clause on a date field. */
export function dateClause (field: string, range: TimeRange, dateOnly = false): string {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(field)) throw new Error('This field name is not supported for queries.')
  const parts: string[] = []
  if (range.from) parts.push(`${field} >= ${sqlDate(range.from, dateOnly)}`)
  if (range.to) parts.push(`${field} < ${sqlDate(range.to, dateOnly)}`)
  if (!parts.length) throw new Error('That time range is empty.')
  return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`
}

/** The same range on a numeric year field (1990, 2024): whole years only. */
export function yearClause (field: string, range: TimeRange): string {
  if (!/^[a-z_][a-z0-9_.]*$/i.test(field)) throw new Error('This field name is not supported for queries.')
  const parts: string[] = []
  const whole = (d: Date) => d.getMonth() === 0 && d.getDate() === 1
  if (range.from) parts.push(`${field} >= ${range.from.getFullYear() + (whole(range.from) ? 0 : 1)}`)
  if (range.to) parts.push(`${field} < ${range.to.getFullYear() + (whole(range.to) ? 0 : 1)}`)
  if (!parts.length) throw new Error('That time range is empty.')
  return parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`
}

/** A comparison on a date field with a calendar value: "install date > 2015", "inspected = 2024-05-01". */
export function dateCompare (field: string, op: string, value: string, now = new Date(), dateOnly = false): string {
  const p = parsePeriod(value, now)
  if (!p) throw new Error('Use a date like 2024, March 2024, 2024-03-05 or 3/5/2024.')
  switch (op) {
    case '>': return dateClause(field, { from: p.end }, dateOnly)
    case '>=': return dateClause(field, { from: p.start }, dateOnly)
    case '<': return dateClause(field, { to: p.start }, dateOnly)
    case '<=': return dateClause(field, { to: p.end }, dateOnly)
    case '=': return dateClause(field, { from: p.start, to: p.end }, dateOnly)
    case '<>': case '!=': return `NOT ${dateClause(field, { from: p.start, to: p.end }, dateOnly).replace(/^(?!\()(.*)$/, '($1)')}`
    default: throw new Error('Use before, after, on, in, or a comparison such as > or < with a date.')
  }
}
