/*
  mapFacts.ts - fun facts from the app's own map, worked out while it runs: how many of a
  thing there are, how many miles of line, the largest area, the oldest or newest by a year
  or date field. Always current, different for every organization, nothing saved. A few
  cheap statistics queries per layer, at most eight layers, only layers that are on (people
  see what they can check), and quietly nothing when a layer cannot answer.
*/
import type { LiveMap, LayerEntry } from './live'
import { withTimeout } from './live'
import { fieldLabel } from '../brain/fields'

const num = (v: number, d = 0): string => v.toLocaleString(undefined, { maximumFractionDigits: d })
const one = (title: string): string => title.replace(/ies$/i, 'y').replace(/(ch|sh|ss|x)es$/i, '$1').replace(/([^s])s$/i, '$1')

/** Facts for one layer from what its queries returned. Pure, so it can be tested. */
export function layerFacts (title: string, geometry: string, s: { count?: number | null, lengthFt?: number | null, largest?: { name: string, acres: number } | null, oldest?: { name: string, year: number } | null, newest?: { year: number } | null }): string[] {
  const out: string[] = []
  const t = title.toLowerCase()
  if (s.count && s.count > 1) out.push(`This map has ${num(s.count)} ${t}.`)
  if (s.lengthFt && s.lengthFt > 5280) out.push(`There are about ${num(s.lengthFt / 5280)} miles of ${t} on this map${s.lengthFt > 5280 * 24901 ? ', more than the way around the Earth' : s.lengthFt > 5280 * 2800 ? ', more than the drive from coast to coast' : s.lengthFt > 5280 * 26.2 ? `, about ${num(s.lengthFt / 5280 / 26.2)} marathons` : ''}.`)
  if (s.largest && s.largest.acres > 0) out.push(`The largest of the ${t} is ${s.largest.name}, at about ${num(s.largest.acres, 1)} acres.`)
  if (s.oldest && s.oldest.year > 1700 && s.oldest.year < new Date().getFullYear()) out.push(`The oldest ${one(title).toLowerCase()} on record here dates from ${s.oldest.year}${s.oldest.name ? ` (${s.oldest.name})` : ''}.`)
  if (s.newest && s.oldest && s.newest.year > s.oldest.year && s.newest.year <= new Date().getFullYear()) out.push(`The ${t} on this map span ${s.newest.year - s.oldest.year} years, from ${s.oldest.year} to ${s.newest.year}.`)
  void geometry
  return out
}

/** Facts for up to `max` layers that are on: counts, line miles, the largest area, the oldest by year. */
export async function buildMapFacts (live: LiveMap, max = 8): Promise<string[]> {
  if (!live.ready) return []
  const facts: string[] = []
  const entries = live.entries().filter(e => !e.isGroup && !e.isTable && live.isVisible(e)).slice(0, max)
  for (const e of entries) {
    try { facts.push(...await factsFor(live, e)) } catch (err) { }
  }
  return facts
}

async function factsFor (live: LiveMap, e: LayerEntry): Promise<string[]> {
  const t = live.target(e)
  if (!t || typeof t.queryFeatures !== 'function') return []
  if (t.load && !t.loaded) await withTimeout(t.load(), 8000)
  if (t.capabilities?.query?.supportsStatistics === false) return []
  const fields: any[] = Array.from(t.fields || [])
  const geom = String(t.geometryType || '')
  const where = t.definitionExpression || '1=1'
  const oid = t.objectIdField || fields.find(f => f.type === 'oid')?.name
  const numeric = (f: any) => /integer|double|single|small-integer|big-integer|long/i.test(f.type || '')
  const lengthF = /polyline/i.test(geom) ? fields.find(f => numeric(f) && /shape.*len|^st_length|length$/i.test(f.name)) : null
  const acresF = /polygon/i.test(geom) ? (fields.find(f => numeric(f) && /acre/i.test(`${f.name} ${f.alias || ''}`)) || fields.find(f => numeric(f) && /shape.*area|^st_area/i.test(f.name))) : null
  const yearF = fields.find(f => numeric(f) && /year|\byr\b/i.test(`${f.name} ${f.alias || ''}`) && /install|built|constr|placed|service/i.test(`${f.name} ${f.alias || ''}`))
    || fields.find(f => /date/i.test(f.type || '') && /install|built|constr|placed|in.?service/i.test(`${f.name} ${f.alias || ''}`))
  const stats: any[] = []
  if (oid) stats.push({ statisticType: 'count', onStatisticField: oid, outStatisticFieldName: 'mf_count' })
  if (lengthF) stats.push({ statisticType: 'sum', onStatisticField: lengthF.name, outStatisticFieldName: 'mf_len' })
  if (yearF) { stats.push({ statisticType: 'min', onStatisticField: yearF.name, outStatisticFieldName: 'mf_min' }); stats.push({ statisticType: 'max', onStatisticField: yearF.name, outStatisticFieldName: 'mf_max' }) }
  if (!stats.length) return []
  const r = await withTimeout(t.queryFeatures({ where, outStatistics: stats, returnGeometry: false }), 10000)
  const a = r?.features?.[0]?.attributes || {}
  const get = (k: string): number | null => { const v = a[k] ?? a[k.toUpperCase()]; const n = Number(v); return v == null || !Number.isFinite(n) ? null : n }
  // Length units: feet for state plane and US feet systems, metres otherwise.
  const sr = live.view?.spatialReference
  const feet = /foot|feet|ft/i.test(String(sr?.unit || sr?.wkt || '')) || (sr?.wkid >= 2200 && sr?.wkid <= 2300) || (sr?.wkid >= 3400 && sr?.wkid <= 3600)
  const lenRaw = get('mf_len')
  const lengthFt = lenRaw === null ? null : (/len/i.test(lengthF?.name || '') && /shape|st_/i.test(lengthF?.name || '') ? (feet ? lenRaw : lenRaw * 3.28084) : lenRaw)
  const yearOf = (v: number | null): number | null => v === null ? null : v > 3000 ? new Date(v).getFullYear() : v
  const minYear = yearOf(get('mf_min')); const maxYear = yearOf(get('mf_max'))
  // The largest area by name.
  let largest: { name: string, acres: number } | null = null
  if (acresF) {
    try {
      const q = await withTimeout(t.queryFeatures({ where, outFields: [acresF.name, t.displayField || oid].filter(Boolean), orderByFields: [`${acresF.name} DESC`], num: 1, returnGeometry: false }), 10000)
      const f = q?.features?.[0]?.attributes
      if (f) {
        const raw = Number(f[acresF.name])
        const acres = /acre/i.test(`${acresF.name} ${acresF.alias || ''}`) ? raw : raw / (feet ? 43560 : 4046.86)
        const name = t.displayField && f[t.displayField] != null ? String(f[t.displayField]) : ''
        if (name && Number.isFinite(acres)) largest = { name, acres }
      }
    } catch (err) { }
  }
  void fieldLabel
  return layerFacts(e.title, geom, {
    count: get('mf_count'),
    lengthFt,
    largest,
    oldest: minYear && minYear > 1700 ? { name: '', year: minYear } : null,
    newest: maxYear ? { year: maxYear } : null
  })
}
