/*
  ask.ts (runtime) - runs a question read by brain/ask.ts against the live layer and says the
  answer the way a person would: the number first, then how it was read, then what to do next.
  Also builds the schema the reader needs, including the distinct values of short text fields
  (read once per layer and kept for the session). Read-only: layers are queried, never changed.
*/
import type { Ask, AskLayer } from '../brain/ask'
import { askSaid, askWhere } from '../brain/ask'
import { numericField, dateField } from '../brain/analysis'
import type { QueryField } from '../brain/analysis'
import type { Reply } from '../brain/answer'
import type { LayerEntry, LiveMap } from './live'
import { withTimeout, feetBetween } from './live'
import { toLatLon } from './project'
import { fieldLabel } from '../brain/fields'

const VALUES = new WeakMap<object, { [field: string]: string[] }>()
const LOADING = new WeakMap<object, Promise<{ [field: string]: string[] }>>()
const MAX_VALUES = 60
const isText = (f: any): boolean => /^(?:string|esriFieldTypeString)$/i.test(f.type || '')
const hidden = (f: any): boolean => /geometry|blob|raster|xml|oid|global-?id/i.test(f.type || '') || /^(?:objectid|fid|oid|globalid)$|globalid|shape[._]/i.test(f.name)

/** What the reader needs to know about a layer, with whatever values have been read so far. */
export function schemaOf (live: LiveMap, e: LayerEntry): AskLayer {
  const t = live.target(e)
  return { key: e.key, title: e.title, fields: Array.from(t?.fields || []) as QueryField[], values: (t && VALUES.get(t)) || undefined, displayField: t?.displayField, isTable: e.isTable }
}

/** Reads the distinct values of a layer's short text fields, once. Fields with many values (names, addresses) are left as free text. */
export async function loadValues (live: LiveMap, e: LayerEntry): Promise<void> {
  const t = live.target(e)
  if (!t || typeof t.queryFeatures !== 'function' || VALUES.has(t)) return
  if (!LOADING.has(t)) {
    LOADING.set(t, (async () => {
      const out: { [field: string]: string[] } = {}
      try {
        if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
        // Fields that hold a short list of kinds (zoning, status, material) come first; names, addresses,
        // ids and notes are free text and are not worth a query each.
        const kind = (f: any): number => {
          const n = `${f.name} ${f.alias || ''} ${fieldLabel(f)}`.toLowerCase()
          if (/\b(?:id|guid|url|email|phone|notes?|comments?|legal|description|desc|mailing|address|location|user|editor|account|number|num|no|zip|pointer|reception|grantee|grantor|unit)\b|\d(?:st|nd|rd|th)\b/.test(n)) return f.name === t.displayField ? 1 : -1
          let score = 2
          if (/zon|land ?use|\buse\b|type|status|class|categor|material|surface|district|kind|condition|rating|owner(?:ship)? type|jurisdiction|ward|neighbou?rhood|city|state|direction|mode|group|code|flag|compliant/.test(n)) score += 3
          if (f.name === t.displayField) score += 2
          if (f.length && f.length <= 50) score += 1
          return score
        }
        const fields = (Array.from(t.fields || []) as any[]).filter(f => isText(f) && !hidden(f) && !f.domain?.codedValues && /^[a-z_][a-z0-9_.]*$/i.test(f.name) && !(f.length > 255)).map(f => ({ f, k: kind(f) })).filter(x => x.k > 0).sort((a, b) => b.k - a.k).slice(0, 14).map(x => x.f)
        await Promise.all(fields.map(async f => {
          try {
            const q: any = t.createQuery ? t.createQuery() : { where: t.definitionExpression || '1=1' }
            q.where = q.where || '1=1'; q.outFields = [f.name]; q.returnDistinctValues = true; q.returnGeometry = false; q.orderByFields = [f.name]; q.num = MAX_VALUES + 1
            const r = await withTimeout(t.queryFeatures(q), 6000)
            const vals = Array.from(new Set((Array.from(r?.features || []) as any[]).map(g => g.attributes?.[f.name]).filter(v => v != null && String(v).trim() !== '').map(v => String(v))))
            // A field with more values than this is free text (owners, addresses): matched by "contains", not by value.
            if (vals.length && vals.length <= MAX_VALUES && !r?.exceededTransferLimit) out[f.name] = vals
          } catch (err) { /* a field that cannot be read is just not matched by value */ }
        }))
      } catch (err) { }
      VALUES.set(t, out)
      return out
    })())
  }
  await LOADING.get(t)
}

const moneyish = (f: QueryField): boolean => /assess|apprais|value|price|cost|amount|\bfee\b|tax/i.test(`${f.name} ${f.alias || ''}`) && !/code|type|class/i.test(`${f.name} ${f.alias || ''}`)
const yearish = (f: QueryField): boolean => /year|\byr\b/i.test(`${f.name} ${f.alias || ''}`)

/** A stored value the way a person would write it: a code's name, a date, dollars, a plain number. */
export function sayValue (f: QueryField, v: any): string {
  if (v == null || v === '') return 'no value'
  const code = f.domain?.codedValues?.find((c: any) => c.code === v)
  if (code) return String(code.name)
  if (dateField(f) && (typeof v === 'number' || v instanceof Date)) { const d = new Date(v); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  if (typeof v === 'number') {
    if (yearish(f) && Number.isInteger(v)) return String(v)
    if (moneyish(f)) return '$' + Math.round(v).toLocaleString()
    return v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 })
  }
  return String(v).slice(0, 200)
}
/** The value with its field's name when the name is a unit ("3.8 acres"), else "Speed Limit 30". */
function sayMeasure (f: QueryField, v: any): string {
  const label = fieldLabel(f)
  return /^(?:acres|miles|feet|lanes|stories|units)$/i.test(label) ? `${sayValue(f, v)} ${label.toLowerCase()}` : `${label} ${sayValue(f, v)}`
}

const nounOf = (title: string): { one: string, many: string } => {
  const many = title.toLowerCase()
  return { one: /ies$/.test(many) ? many.replace(/ies$/, 'y') : /(?:ss|us|is)$/.test(many) ? many : many.replace(/s$/, ''), many: /s$/.test(many) ? many : many + (/(?:ing|ation)$/.test(many) ? ' areas' : ' records') }
}
const listOut = (items: string[]): string => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

export interface AskRun { reply: Reply, count?: number }

/**
 * "How long is Maple St" on a line layer with no length field: measured along the lines themselves.
 * Null when the layer is not lines, nothing matches, or the shapes cannot be read as latitude and longitude.
 */
export async function lineLength (live: LiveMap, entry: LayerEntry, ask: Ask): Promise<{ feet: number, pieces: number, capped: boolean } | null> {
  const target = live.target(entry)
  if (!target || typeof target.queryFeatures !== 'function' || !/polyline|line/i.test(String(target.geometryType || ''))) return null
  const q: any = target.createQuery ? target.createQuery() : { where: target.definitionExpression || '1=1' }
  const where = askWhere(ask)
  if (!where) return null
  q.where = q.where && q.where !== '1=1' ? `(${q.where}) AND (${where})` : where
  q.outFields = target.objectIdField ? [target.objectIdField] : []
  q.returnGeometry = true
  q.outSpatialReference = { wkid: 4326 }
  q.num = 500
  const res: any = await withTimeout(target.queryFeatures(q), 12000)
  const features = Array.from(res?.features || []) as any[]
  if (!features.length) return null
  let feet = 0
  for (const g of features) {
    const geom = g.geometry
    const sr = geom?.spatialReference || res?.spatialReference || { wkid: 4326 }
    for (const path of Array.isArray(geom?.paths) ? geom.paths : []) {
      let before: [number, number] | null = null
      for (const v of path) {
        const at = Array.isArray(v) ? toLatLon({ x: v[0], y: v[1], spatialReference: sr }) : null
        if (!at) return null
        if (before) feet += feetBetween(before, at)
        before = at
      }
    }
  }
  return feet > 0 ? { feet, pieces: features.length, capped: !!res?.exceededTransferLimit || features.length >= 500 } : null
}

/**
 * "Longest street" on a line layer with no length field: every line measured, pieces with the same
 * name added up, longest (or shortest) first. Null when it cannot be measured or the layer is too big to read whole.
 */
export async function rankLines (live: LiveMap, entry: LayerEntry, order: 'asc' | 'desc'): Promise<Array<{ label: string, feet: number }> | null> {
  const target = live.target(entry)
  if (!target || typeof target.queryFeatures !== 'function' || !/polyline|line/i.test(String(target.geometryType || ''))) return null
  const name = String(target.displayField || '')
  if (!name || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) return null
  const q: any = target.createQuery ? target.createQuery() : { where: target.definitionExpression || '1=1' }
  q.where = q.where || '1=1'
  q.outFields = [name]
  q.returnGeometry = true
  q.outSpatialReference = { wkid: 4326 }
  q.num = 2000
  const res: any = await withTimeout(target.queryFeatures(q), 15000)
  const features = Array.from(res?.features || []) as any[]
  if (!features.length || res?.exceededTransferLimit || features.length >= 2000) return null
  const sums = new Map<string, number>()
  for (const g of features) {
    const label = String(g.attributes?.[name] ?? '').trim()
    if (!label) continue
    const sr = g.geometry?.spatialReference || res?.spatialReference || { wkid: 4326 }
    let feet = 0
    for (const path of Array.isArray(g.geometry?.paths) ? g.geometry.paths : []) {
      let before: [number, number] | null = null
      for (const v of path) {
        const at = Array.isArray(v) ? toLatLon({ x: v[0], y: v[1], spatialReference: sr }) : null
        if (!at) return null
        if (before) feet += feetBetween(before, at)
        before = at
      }
    }
    sums.set(label, (sums.get(label) || 0) + feet)
  }
  const rows = Array.from(sums, ([label, feet]) => ({ label, feet })).filter(r => r.feet > 0)
  return rows.length ? rows.sort((a, b) => order === 'asc' ? a.feet - b.feet : b.feet - a.feet) : null
}

/** Runs the question. Throws with a plain sentence when the layer cannot answer it. */
export async function runAsk (live: LiveMap, entry: LayerEntry, ask: Ask, max: number): Promise<Reply> {
  const target = live.target(entry)
  if (!target || typeof target.queryFeatures !== 'function') throw new Error(`**${entry.title}** does not support questions about its records.`)
  if (target.load && !target.loaded) await withTimeout(target.load(), 8000)
  const fresh = (): any => { const q: any = target.createQuery ? target.createQuery() : { where: target.definitionExpression || '1=1' }; q.where = q.where || target.definitionExpression || '1=1'; q.returnGeometry = false; return q }
  const base = fresh().where
  const where = askWhere(ask)
  const full = where ? `(${base}) AND (${where})` : base
  const said = askSaid(ask)
  const noun = nounOf(entry.title)
  const n = (count: number): string => `**${count.toLocaleString()}** ${count === 1 ? noun.one : noun.many}`
  const source = { title: entry.title, detail: `Live layer query${said ? ` · ${said}` : ''} · ${new Date().toLocaleTimeString()}` }
  const read = said ? ` (${said})` : ''
  const fields = Array.from(target.fields || []) as QueryField[]
  const display = fields.find(f => f.name === target.displayField) || fields.find(f => isText(f) && !hidden(f)) || fields.find(f => !hidden(f))
  const labelOf = (g: any): string => { const v = display ? g.attributes?.[display.name] : null; return v == null || v === '' ? String(g.attributes?.[target.objectIdField] ?? 'Feature') : sayValue(display as QueryField, v) }
  const count = async (w: string): Promise<number> => { const q = fresh(); q.where = w; const c = await withTimeout(target.queryFeatureCount(q), 12000); if (!Number.isFinite(c)) throw new Error('The layer did not return a count.'); return c as number }
  const results = (features: any[], detail?: (g: any) => string): any[] => features.map(g => ({ entry, graphic: g, label: labelOf(g), detail: detail ? detail(g) : said || undefined }))
  const withShape = (q: any): void => { q.outFields = ['*']; q.returnGeometry = !entry.isTable; if (!entry.isTable && live.view?.spatialReference) q.outSpatialReference = live.view.spatialReference }

  if (ask.kind === 'count') {
    const [whole, part] = await Promise.all([where ? count(base) : Promise.resolve(-1), count(full)])
    if (!where) return { text: `There ${part === 1 ? 'is' : 'are'} ${n(part)}.`, mood: 'acknowledge', sources: [source] }
    const pct = whole > 0 ? Math.round(part / whole * 100) : 0
    return { text: part ? `${n(part)} match${part === 1 ? 'es' : ''}${read}. That is ${pct < 1 ? 'under 1' : pct}% of the ${whole.toLocaleString()} in the layer.` : `No ${noun.many} match${read}. The layer has ${whole.toLocaleString()}.`, mood: part ? 'acknowledge' : 'think', sources: [source] }
  }

  if (ask.kind === 'list' || ask.kind === 'attr') {
    const q = fresh(); q.where = full; withShape(q); q.num = max + 1
    if (target.objectIdField) q.orderByFields = [target.objectIdField + ' ASC']
    const [res, total] = await Promise.all([withTimeout(target.queryFeatures(q), 12000), count(full)])
    const features = (Array.from((res as any)?.features || []) as any[]).slice(0, max)
    if (!features.length) return { text: `No ${noun.many} match${read}.`, mood: 'think', sources: [source] }
    if (ask.kind === 'attr' && ask.field) {
      const f = ask.field
      const values = features.map(g => g.attributes?.[f.name])
      const same = values.every(v => v === values[0])
      if (total === 1) return { text: `**${labelOf(features[0])}**: ${fieldLabel(f)} is **${sayValue(f, values[0])}**.`, mood: 'pleased', sources: [source], results: results(features) }
      if (same && total <= max) return { text: `${fieldLabel(f)} is **${sayValue(f, values[0])}** for all ${total.toLocaleString()} matching ${noun.many}${read}.`, mood: 'pleased', sources: [source], results: results(features) }
      return { text: `${n(total)} match${read}. Here is **${fieldLabel(f)}** for ${total > features.length ? `the first ${features.length}` : 'each'}:`, mood: 'talk', sources: [source], results: results(features, g => sayMeasure(f, g.attributes?.[f.name])), table: { columns: [display ? fieldLabel(display) : entry.title, fieldLabel(f)], rows: features.map(g => [labelOf(g), sayValue(f, g.attributes?.[f.name])]) } }
    }
    const names = features.slice(0, 5).map(g => `**${labelOf(g)}**`)
    return { text: total <= 5 ? `${n(total)} match${total === 1 ? 'es' : ''}${read}: ${listOut(names)}.` : `${n(total)} match${read}. Here are the first ${features.length}; choose one to zoom to it.`, mood: 'talk', sources: [source], results: results(features) }
  }

  if (ask.kind === 'top' && ask.field) {
    const f = ask.field
    if (target.capabilities?.query?.supportsOrderBy === false) throw new Error(`**${entry.title}** cannot be sorted, so I cannot rank it.`)
    const limit = Math.max(1, ask.limit || 1)
    // A year of 0 is "not recorded" in many layers, so it never counts as the oldest.
    const real = numericField(f) && yearish(f) ? ` AND ${f.name} > 0` : ''
    const q = fresh(); q.where = `(${full}) AND ${f.name} IS NOT NULL${real}`; withShape(q)
    q.orderByFields = [`${f.name} ${ask.order === 'asc' ? 'ASC' : 'DESC'}`, ...(target.objectIdField ? [target.objectIdField + ' ASC'] : [])]
    q.num = Math.max(limit, 3)
    const res: any = await withTimeout(target.queryFeatures(q), 12000)
    const features = Array.from(res?.features || []) as any[]
    if (!features.length) return { text: `No ${noun.many}${read ? ` match${read}` : ` have a ${fieldLabel(f)} to rank by`}.`, mood: 'think', sources: [source] }
    const word = ask.superlative || (ask.order === 'asc' ? `lowest ${fieldLabel(f)}` : `highest ${fieldLabel(f)}`)
    if (limit === 1) {
      const first = features[0]
      const tied = features.filter((g, i) => g.attributes?.[f.name] === first.attributes?.[f.name] && (i === 0 || labelOf(g) !== labelOf(first)))
      const next = features.slice(1).filter(g => labelOf(g) !== labelOf(first)).slice(0, 2).map(g => `${labelOf(g)} (${sayValue(f, g.attributes?.[f.name])})`)
      const lead = /^(?:highest|lowest) /.test(word) ? `The ${noun.one} with the ${word}` : `The ${word} ${noun.one}`
      return { text: `${lead}${said ? ` (${said})` : ''} is **${labelOf(first)}**: ${sayMeasure(f, first.attributes?.[f.name])}.${tied.length > 1 ? ` Tied with ${listOut(tied.slice(1).map(labelOf))}${tied.length === features.length && features.length >= 3 ? ', and maybe more' : ''}.` : next.length ? ` Next: ${next.join(', ')}.` : ''}`, mood: 'pleased', sources: [source], results: results([first], g => sayMeasure(f, g.attributes?.[f.name])) }
    }
    const shown = features.slice(0, limit)
    return { text: `The ${shown.length} ${noun.many} with the ${/^(?:highest|lowest) /.test(word) ? word : `${ask.order === 'asc' ? 'lowest' : 'highest'} ${fieldLabel(f)}`}${read}, ${ask.order === 'asc' ? 'lowest' : 'highest'} first:`, mood: 'talk', sources: [source], results: results(shown, g => sayMeasure(f, g.attributes?.[f.name])), table: { columns: [display ? fieldLabel(display) : entry.title, fieldLabel(f)], rows: shown.map(g => [labelOf(g), sayValue(f, g.attributes?.[f.name])]) } }
  }

  if (target.capabilities?.query?.supportsStatistics === false) throw new Error(`**${entry.title}** does not support totals and averages. Its table or the app's analysis tool can do that.`)
  const idField = target.objectIdField || (ask.field || ask.group || fields[0]).name
  const stats = (q: any): void => { q.outFields = []; q.orderByFields = []; q.num = undefined; q.start = undefined }

  if (ask.kind === 'stat' && ask.field && ask.stat) {
    const f = ask.field
    if (!numericField(f)) throw new Error(`${fieldLabel(f)} is not a number, so it has no ${ask.stat === 'avg' ? 'average' : 'total'}. Try "count ${noun.many} by ${fieldLabel(f).toLowerCase()}".`)
    const q = fresh(); q.where = full; stats(q); q.groupByFieldsForStatistics = []
    q.outStatistics = [{ statisticType: ask.stat, onStatisticField: f.name, outStatisticFieldName: 'mappy_value' }, { statisticType: 'count', onStatisticField: f.name, outStatisticFieldName: 'mappy_count' }, { statisticType: 'min', onStatisticField: f.name, outStatisticFieldName: 'mappy_min' }, { statisticType: 'max', onStatisticField: f.name, outStatisticFieldName: 'mappy_max' }]
    const res: any = await withTimeout(target.queryFeatures(q), 12000)
    const a = res?.features?.[0]?.attributes
    const c = Number(a?.mappy_count || 0)
    if (!a || !c) return { text: `No ${noun.many}${read ? ` match${read}` : ` have a ${fieldLabel(f)}`}, so there is nothing to ${ask.stat === 'avg' ? 'average' : 'add up'}.`, mood: 'think', sources: [source] }
    return { text: `The ${ask.stat === 'avg' ? 'average' : 'total'} **${fieldLabel(f)}** of the ${c.toLocaleString()} ${c === 1 ? noun.one : noun.many}${read} is **${sayValue(f, Number(a.mappy_value))}**.${Number.isFinite(Number(a.mappy_min)) && Number.isFinite(Number(a.mappy_max)) && c > 1 ? ` They range from ${sayValue(f, Number(a.mappy_min))} to ${sayValue(f, Number(a.mappy_max))}.` : ''}`, mood: 'talk', sources: [source] }
  }

  if ((ask.kind === 'group' || ask.kind === 'distinct') && (ask.group || ask.field)) {
    const g = (ask.kind === 'distinct' ? ask.field : ask.group) as QueryField
    const value = ask.kind === 'group' && ask.stat ? ask.field : undefined
    if (value && !numericField(value)) throw new Error(`${fieldLabel(value)} is not a number, so it has no ${ask.stat === 'avg' ? 'average' : 'total'}.`)
    const q = fresh(); q.where = full; stats(q); q.groupByFieldsForStatistics = [g.name]
    q.outStatistics = [{ statisticType: 'count', onStatisticField: idField, outStatisticFieldName: 'mappy_count' }]
    if (value) q.outStatistics.push({ statisticType: ask.stat, onStatisticField: value.name, outStatisticFieldName: 'mappy_value' })
    const res: any = await withTimeout(target.queryFeatures(q), 12000)
    let rows = (Array.from(res?.features || []) as any[]).map(x => ({ label: x.attributes?.[g.name] == null || x.attributes?.[g.name] === '' ? '(none)' : sayValue(g, x.attributes[g.name]), count: Number(x.attributes?.mappy_count || 0), value: value ? Number(x.attributes?.mappy_value) : 0 }))
    if (!rows.length) return { text: `No ${noun.many} match${read}.`, mood: 'think', sources: [source] }
    const by = (r: typeof rows[0]): number => value ? r.value : r.count
    rows = rows.filter(r => Number.isFinite(by(r))).sort((a, b) => ask.order === 'asc' ? by(a) - by(b) : by(b) - by(a))
    const partial = res?.exceededTransferLimit ? ' The service cut the list short, so these are partial.' : ''
    const shown = rows.slice(0, ask.limit ? Math.max(ask.limit, 3) : 25)
    const statName = ask.stat === 'avg' ? 'Average' : 'Total'
    const cell = (r: typeof rows[0]): string => value ? sayValue(value, r.value) : r.count.toLocaleString()
    let text: string
    if (ask.kind === 'distinct') text = `**${fieldLabel(g)}** has ${rows.length.toLocaleString()} value${rows.length === 1 ? '' : 's'} in ${entry.title}${read}: ${listOut(shown.slice(0, 8).map(r => `**${r.label}** (${r.count.toLocaleString()})`))}${rows.length > 8 ? ', and more in the table' : ''}.`
    else if (value) {
      // The far end is only named when every group is shown; otherwise it is just where the list stops.
      const whole = rows.length <= shown.length
      const rest = shown.length > 1 ? (whole ? `, and **${shown[shown.length - 1].label}** is ${ask.order === 'asc' ? 'highest' : 'lowest'} at ${cell(shown[shown.length - 1])}` : `. Then ${listOut(shown.slice(1, 3).map(r => `${r.label} (${cell(r)})`))}`) : ''
      text = `${statName} **${fieldLabel(value)}** by **${fieldLabel(g)}**${read}: **${shown[0].label}** is ${ask.order === 'asc' ? 'lowest' : 'highest'} at ${cell(shown[0])}${rest}.`
    } else if (shown.length > 1 && shown[1].count === shown[0].count) {
      const even = shown.filter(r => r.count === shown[0].count)
      const more = even.length === shown.length && rows.length > shown.length
      text = `${listOut(even.slice(0, 4).map(r => `**${r.label}**`))}${even.length > 4 || more ? ' and others' : ''} tie for the ${ask.order === 'asc' ? 'fewest' : 'most'} ${noun.many}${read}: ${shown[0].count.toLocaleString()} each.`
    }
    else text = `**${shown[0].label}** has the ${ask.order === 'asc' ? 'fewest' : 'most'} ${noun.many}${read}: ${shown[0].count.toLocaleString()}${shown.length > 1 ? `. Then ${listOut(shown.slice(1, 3).map(r => `${r.label} (${r.count.toLocaleString()})`))}` : ''}.`
    const chartable = shown.length >= 2 && shown.length <= 12
    return {
      text: text + partial + (rows.length > shown.length ? ` Showing ${shown.length} of ${rows.length.toLocaleString()}.` : ''), mood: 'talk', sources: [source],
      table: { columns: value ? [fieldLabel(g), noun.many.replace(/^./, c => c.toUpperCase()), `${statName} ${fieldLabel(value)}`] : [fieldLabel(g), noun.many.replace(/^./, c => c.toUpperCase())], rows: shown.map(r => value ? [r.label, r.count.toLocaleString(), cell(r)] : [r.label, r.count.toLocaleString()]) },
      chart: chartable && (ask.chart || !value || true) ? { title: value ? `${statName} ${fieldLabel(value)} by ${fieldLabel(g)}` : `${entry.title} by ${fieldLabel(g)}`, rows: shown.map(r => ({ label: r.label, value: Math.round(by(r) * 100) / 100 })), unit: value ? undefined : noun.many } : undefined
    }
  }
  throw new Error('I read that as a question about the data, but could not work out what to measure.')
}

/**
 * Words the reader could not place: try them as text in the layer's free-text fields (names,
 * addresses, owners). Returns the clause to add when exactly that phrase is found there.
 */
export async function probeText (live: LiveMap, entry: LayerEntry, phrase: string, where: string): Promise<{ field: QueryField, sql: string, said: string } | null> {
  const target = live.target(entry)
  const text = phrase.replace(/[%_']/g, ' ').replace(/\s+/g, ' ').trim()
  if (!target || text.length < 3 || typeof target.queryFeatureCount !== 'function') return null
  const known = VALUES.get(target) || {}
  const fields = (Array.from(target.fields || []) as any[]).filter(f => isText(f) && !hidden(f) && !f.domain?.codedValues && (!known[f.name] || f.name === target.displayField) && /^[a-z_][a-z0-9_.]*$/i.test(f.name))
  const order = [...fields.filter(f => f.name === target.displayField), ...fields.filter(f => f.name !== target.displayField)].slice(0, 4)
  for (const f of order) {
    try {
      const q: any = target.createQuery ? target.createQuery() : { where: '1=1' }
      const sql = `UPPER(${f.name}) LIKE '%${text.toUpperCase()}%'`
      q.where = `(${q.where || '1=1'})${where ? ` AND (${where})` : ''} AND ${sql}`
      const c = await withTimeout(target.queryFeatureCount(q), 8000)
      if (Number(c) > 0) return { field: f, sql, said: `${fieldLabel(f)} containing “${text}”` }
    } catch (err) { }
  }
  return null
}
