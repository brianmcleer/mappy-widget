/*
  factSources.ts - open sources for a place's fun facts beyond Wikipedia, each a small function
  that returns BuiltFacts with the source named and its license. Only the builder's browser
  ever calls these; the facts are saved with the app. Every source fails quietly on its own,
  so one being down never spoils the rest.

    Wikidata (CC0)            population, area, elevation, founded, named after, sister cities, time zone, nickname
    Open-Meteo (CC BY 4.0)    climate normals from ten years of daily weather
    USGS EPQS (public domain) elevation at the spot, US only
    US Census ACS (public)    population, median age, households, median home value, US only, needs a free key
    Wikivoyage (CC BY-SA)     what the place is known for, in travel-guide words
    DBpedia (CC BY-SA)        Wikipedia's infobox as data, when Wikidata is thin
    OpenStreetMap (ODbL)      counts of parks, playgrounds, schools, libraries, trails nearby

  The text shaping lives here as pure functions (climateFacts, wikidataFacts, osmFacts...) so
  it can be tested without a browser; the fetches are thin wrappers around them.
*/
import type { BuiltFact } from './localFacts'

export type SourceId = 'wikidata' | 'climate' | 'usgs' | 'census' | 'wikivoyage' | 'dbpedia' | 'osm'
export const SOURCES: Array<{ id: SourceId, name: string, license: string, note: string, us?: boolean, key?: boolean }> = [
  { id: 'wikidata', name: 'Wikidata', license: 'CC0', note: 'Population, area, elevation, founded, named after, sister cities, time zone.' },
  { id: 'climate', name: 'Open-Meteo', license: 'CC BY 4.0', note: 'Climate normals: average summer high, winter low, rain and snow, from ten years of daily weather.' },
  { id: 'osm', name: 'OpenStreetMap', license: 'ODbL', note: 'How many parks, playgrounds, schools, libraries and trails are within five miles.' },
  { id: 'wikivoyage', name: 'Wikivoyage', license: 'CC BY-SA', note: 'What the place is known for, in travel-guide words.' },
  { id: 'dbpedia', name: 'DBpedia', license: 'CC BY-SA', note: "Wikipedia's infobox as data, used when Wikidata is thin." },
  { id: 'usgs', name: 'USGS', license: 'Public domain', note: 'Elevation at the spot (United States).', us: true },
  { id: 'census', name: 'US Census', license: 'Public domain', note: 'Population, median age, households, median home value (United States, needs a free API key).', us: true, key: true }
]

export interface Spot { lat: number, lon: number, place: string, us: boolean, qid?: string, title?: string, metric?: boolean }

async function getJson (url: string, signal?: AbortSignal, headers: { [k: string]: string } = {}): Promise<any> {
  const r = await fetch(url, { signal, headers: { Accept: 'application/json', ...headers } })
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`)
  return r.json()
}

const n = (v: any): number | null => { const x = Number(v); return Number.isFinite(x) ? x : null }
const num = (v: number, digits = 0): string => v.toLocaleString(undefined, { maximumFractionDigits: digits })
const year = (iso: string): string => { const m = String(iso || '').match(/^[+-]?(\d{4})/); return m ? String(Number(m[1])) : '' }

// ------------------------------------------------------------------ Wikidata (CC0)

/** Facts from a Wikidata entity's claims, already fetched as JSON (entities[qid]). Pure. */
export function wikidataFacts (entity: any, place: string, labels: { [qid: string]: string } = {}): BuiltFact[] {
  const out: BuiltFact[] = []
  const claims = entity?.claims || {}
  const src = { source: 'Wikidata', url: entity?.id ? `https://www.wikidata.org/wiki/${entity.id}` : 'https://www.wikidata.org' }
  const best = (prop: string): any => {
    const list: any[] = claims[prop] || []
    // The preferred rank first, then the most recent "point in time", then the first.
    const ranked = list.filter(c => c.rank === 'preferred')
    const pick = (ranked.length ? ranked : list).slice().sort((a, b) => String(b.qualifiers?.P585?.[0]?.datavalue?.value?.time || '').localeCompare(String(a.qualifiers?.P585?.[0]?.datavalue?.value?.time || '')))[0]
    return pick?.mainsnak?.datavalue?.value
  }
  const quantity = (prop: string): number | null => { const v = best(prop); return v && v.amount != null ? n(v.amount) : null }
  const unitOf = (prop: string): string => { const v = best(prop); return String(v?.unit || '').split('/').pop() || '' }
  const when = (prop: string): string => { const v = best(prop); return v?.time ? year(v.time) : '' }
  const ids = (prop: string, max = 3): string[] => (claims[prop] || []).map((c: any) => c.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, max)
  const label = (qid: string): string => labels[qid] || ''
  const asOf = (prop: string): string => { const list: any[] = claims[prop] || []; const t = list.map(c => c.qualifiers?.P585?.[0]?.datavalue?.value?.time).filter(Boolean).sort().pop(); return t ? year(t) : '' }

  const pop = quantity('P1082')
  if (pop && pop > 0) out.push({ text: `${place} had a population of about ${num(pop)}${asOf('P1082') ? ` in ${asOf('P1082')}` : ''}.`, ...src })
  const area = quantity('P2046')
  if (area && area > 0) {
    const unit = unitOf('P2046')
    // Q712226 square kilometre, Q232291 square mile, Q35852 hectare, Q81292 acre
    const sqkm = unit === 'Q712226' ? area : unit === 'Q232291' ? area * 2.58999 : unit === 'Q35852' ? area / 100 : unit === 'Q81292' ? area / 247.105 : null
    if (sqkm) out.push({ text: `${place} covers about ${num(sqkm * 0.386102, 1)} square miles (${num(sqkm, 1)} km²).`, ...src })
  }
  const elev = quantity('P2044')
  if (elev !== null) {
    const unit = unitOf('P2044')
    const m = unit === 'Q3710' ? elev * 0.3048 : elev // Q3710 foot, Q11573 metre
    out.push({ text: `${place} sits at about ${num(m * 3.28084)} feet (${num(m)} m) above sea level.`, ...src })
  }
  const founded = when('P571')
  if (founded) out.push({ text: `${place} was founded in ${founded}.`, ...src })
  const named = ids('P138', 1).map(label).filter(Boolean)
  if (named.length) out.push({ text: `${place} is named after ${named[0]}.`, ...src })
  const sisters = ids('P190', 4).map(label).filter(Boolean)
  if (sisters.length) out.push({ text: `${place} has sister cit${sisters.length === 1 ? 'y' : 'ies'}: ${sisters.join(', ')}.`, ...src })
  const tz = ids('P421', 1).map(label).filter(Boolean)
  if (tz.length) out.push({ text: `${place} keeps ${tz[0].replace(/^UTC/, 'UTC ')} time.`, ...src })
  const nick = best('P1449')
  if (nick?.text) out.push({ text: `${place} is nicknamed "${nick.text}".`, ...src })
  const motto = best('P1546')
  if (motto?.text) out.push({ text: `${place}'s motto is "${motto.text}".`, ...src })
  const water = quantity('P2927')
  if (water && water > 0) out.push({ text: `About ${num(water, 1)}% of ${place} is water.`, ...src })
  return out
}

const WD = 'https://www.wikidata.org'
export async function fetchWikidata (spot: Spot, signal?: AbortSignal): Promise<BuiltFact[]> {
  if (!spot.qid) return []
  const data = await getJson(`${WD}/wiki/Special:EntityData/${encodeURIComponent(spot.qid)}.json`, signal)
  const entity = data?.entities?.[spot.qid]
  if (!entity) return []
  // Labels for the few linked items we mention (named after, sister cities, time zone).
  const want = new Set<string>()
  for (const p of ['P138', 'P190', 'P421']) for (const c of (entity.claims?.[p] || []).slice(0, 4)) { const id = c.mainsnak?.datavalue?.value?.id; if (id) want.add(id) }
  const labels: { [qid: string]: string } = {}
  if (want.size) {
    try {
      const r = await getJson(`${WD}/w/api.php?action=wbgetentities&ids=${Array.from(want).join('|')}&props=labels&languages=en&format=json&origin=*`, signal)
      for (const [id, e] of Object.entries<any>(r?.entities || {})) labels[id] = e?.labels?.en?.value || ''
    } catch (e) { }
  }
  return wikidataFacts(entity, spot.place, labels)
}

// ------------------------------------------------------------------ Open-Meteo (CC BY 4.0)

/** Climate normals from Open-Meteo's daily archive (ten years): the sentences people enjoy. Pure. */
export function climateFacts (daily: { time: string[], temperature_2m_max: Array<number | null>, temperature_2m_min: Array<number | null>, precipitation_sum: Array<number | null>, snowfall_sum?: Array<number | null> }, place: string, metric: boolean): BuiltFact[] {
  const out: BuiltFact[] = []
  const src = { source: 'Open-Meteo', url: 'https://open-meteo.com/' }
  if (!daily?.time?.length) return out
  const months: Array<{ hi: number[], lo: number[] }> = Array.from({ length: 12 }, () => ({ hi: [], lo: [] }))
  const years = new Map<string, { rain: number, snow: number, hot: number, cold: number, wet: number }>()
  let hottest = -Infinity; let coldest = Infinity
  daily.time.forEach((t, i) => {
    const m = Number(t.slice(5, 7)) - 1; const y = t.slice(0, 4)
    const hi = daily.temperature_2m_max[i]; const lo = daily.temperature_2m_min[i]; const p = daily.precipitation_sum[i]; const s = daily.snowfall_sum?.[i]
    if (hi != null) { months[m].hi.push(hi); if (hi > hottest) hottest = hi }
    if (lo != null) { months[m].lo.push(lo); if (lo < coldest) coldest = lo }
    const yr = years.get(y) || { rain: 0, snow: 0, hot: 0, cold: 0, wet: 0 }
    if (p != null) { yr.rain += p; if (p > (metric ? 0.25 : 0.01)) yr.wet++ }
    if (s != null) yr.snow += s
    if (hi != null && hi >= (metric ? 32.2 : 90)) yr.hot++
    if (lo != null && lo <= (metric ? 0 : 32)) yr.cold++
    years.set(y, yr)
  })
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  const deg = metric ? '°C' : '°F'
  const warm = months.map((m, i) => ({ i, v: avg(m.hi) })).filter(x => x.v !== null).sort((a, b) => b.v! - a.v!)[0]
  const cool = months.map((m, i) => ({ i, v: avg(m.lo) })).filter(x => x.v !== null).sort((a, b) => a.v! - b.v!)[0]
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  if (warm && cool) out.push({ text: `${place}'s warmest month is ${MONTH[warm.i]}, with afternoons around ${Math.round(warm.v!)}${deg}; ${MONTH[cool.i]} nights drop to about ${Math.round(cool.v!)}${deg}.`, ...src })
  const full = Array.from(years.values()).filter(y => y.rain > 0 || y.snow > 0)
  if (full.length >= 3) {
    const rain = avg(full.map(y => y.rain))!; const snow = avg(full.map(y => y.snow))!
    const wet = Math.round(avg(full.map(y => y.wet))!)
    out.push({ text: metric ? `${place} gets about ${num(rain)} mm of precipitation a year, on roughly ${wet} days.` : `${place} gets about ${num(rain, 1)} inches of precipitation a year, on roughly ${wet} days.`, ...src })
    if (snow > (metric ? 2 : 1)) out.push({ text: metric ? `${place} sees about ${num(snow)} cm of snow in a typical year.` : `${place} sees about ${num(snow)} inches of snow in a typical year.`, ...src })
    const hot = Math.round(avg(full.map(y => y.hot))!); const cold = Math.round(avg(full.map(y => y.cold))!)
    if (hot > 0) out.push({ text: `${place} has about ${hot} days a year at or above ${metric ? '32°C' : '90°F'}.`, ...src })
    if (cold > 0) out.push({ text: `${place} has about ${cold} nights a year at or below freezing.`, ...src })
  }
  if (Number.isFinite(hottest) && Number.isFinite(coldest)) out.push({ text: `In the last ten years ${place} has ranged from ${Math.round(coldest)}${deg} to ${Math.round(hottest)}${deg}.`, ...src })
  return out
}

export async function fetchClimate (spot: Spot, signal?: AbortSignal): Promise<BuiltFact[]> {
  const end = new Date(); end.setDate(end.getDate() - 7)
  const start = new Date(end); start.setFullYear(end.getFullYear() - 10)
  const d = (x: Date) => x.toISOString().slice(0, 10)
  const metric = !!spot.metric
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${spot.lat}&longitude=${spot.lon}&start_date=${d(start)}&end_date=${d(end)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum&timezone=auto${metric ? '' : '&temperature_unit=fahrenheit&precipitation_unit=inch'}`
  const r = await getJson(url, signal)
  return climateFacts(r?.daily, spot.place, metric)
}

// ------------------------------------------------------------------ USGS elevation (public domain, US)

export async function fetchUsgsElevation (spot: Spot, signal?: AbortSignal): Promise<BuiltFact[]> {
  if (!spot.us) return []
  const r = await getJson(`https://epqs.nationalmap.gov/v1/json?x=${spot.lon}&y=${spot.lat}&units=Feet&wkid=4326&includeDate=false`, signal)
  const v = n(r?.value)
  if (v === null || v < -1500 || v > 30000) return []
  return [{ text: `The middle of ${spot.place} is ${num(v)} feet above sea level, according to the USGS.`, source: 'USGS', url: 'https://www.usgs.gov/' }]
}

// ------------------------------------------------------------------ US Census ACS (public domain, US)

/** Facts from one ACS profile row, as the API returns it (header row + data row). Pure. */
export function censusFacts (rows: string[][], place: string): BuiltFact[] {
  if (!rows || rows.length < 2) return []
  const head = rows[0]; const row = rows[1]
  const get = (code: string): number | null => { const i = head.indexOf(code); const v = i >= 0 ? n(row[i]) : null; return v !== null && v > -1 ? v : null }
  const out: BuiltFact[] = []
  const src = { source: 'US Census ACS', url: 'https://www.census.gov/programs-surveys/acs' }
  const pop = get('DP05_0001E'); if (pop) out.push({ text: `The Census Bureau estimates ${place}'s population at ${num(pop)}.`, ...src })
  const age = get('DP05_0018E'); if (age) out.push({ text: `The median age in ${place} is ${num(age, 1)}.`, ...src })
  const hh = get('DP02_0001E'); if (hh) out.push({ text: `${place} has about ${num(hh)} households.`, ...src })
  const home = get('DP04_0089E'); if (home) out.push({ text: `The median home value in ${place} is about $${num(home)}.`, ...src })
  const commute = get('DP03_0025E'); if (commute) out.push({ text: `The average commute in ${place} is about ${num(commute)} minutes.`, ...src })
  return out
}

export async function fetchCensus (spot: Spot, key: string, signal?: AbortSignal): Promise<BuiltFact[]> {
  if (!spot.us || !key) return []
  // The Census place under the spot, from TIGERweb (an ArcGIS service, so a browser may call it):
  // incorporated places first, then census-designated places.
  let placeRow: any = null
  for (const layer of [28, 30]) {
    const g = await getJson(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/${layer}/query?geometry=${spot.lon},${spot.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=NAME,STATE,PLACE&returnGeometry=false&f=json`, signal)
    placeRow = g?.features?.[0]?.attributes
    if (placeRow?.STATE && placeRow?.PLACE) break
  }
  if (!placeRow?.STATE || !placeRow?.PLACE) return []
  const vintage = new Date().getFullYear() - 2
  const url = `https://api.census.gov/data/${vintage}/acs/acs5/profile?get=NAME,DP05_0001E,DP05_0018E,DP02_0001E,DP04_0089E,DP03_0025E&for=place:${placeRow.PLACE}&in=state:${placeRow.STATE}&key=${encodeURIComponent(key)}`
  const rows = await getJson(url, signal)
  return censusFacts(rows, spot.place)
}

// ------------------------------------------------------------------ Wikivoyage (CC BY-SA)

export async function fetchWikivoyage (spot: Spot, pickFacts: (text: string, max: number) => string[], signal?: AbortSignal): Promise<BuiltFact[]> {
  // Wikivoyage titles are often the bare name ("Grand Junction"), Wikipedia's carry the state ("Grand Junction, Colorado").
  const titles = Array.from(new Set([spot.title || '', spot.place, String(spot.title || '').split(',')[0].trim()].filter(Boolean)))
  let page: any = null
  for (const title of titles) {
    const r = await getJson(`https://en.wikivoyage.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`, signal)
    const p: any = Object.values(r?.query?.pages || {})[0]
    if (p && p.missing === undefined && p.extract) { page = p; break }
  }
  if (!page) return []
  const url = `https://en.wikivoyage.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`
  return pickFacts(page.extract, 4).map(text => ({ text, source: `${page.title} on Wikivoyage`, url }))
}

// ------------------------------------------------------------------ DBpedia (CC BY-SA)

/** Facts from a DBpedia resource's JSON-LD-ish map (the resource's own property map). Pure. */
export function dbpediaFacts (props: { [p: string]: Array<{ value: any, type?: string }> }, place: string, have: BuiltFact[]): BuiltFact[] {
  const out: BuiltFact[] = []
  const src = { source: 'DBpedia', url: 'https://dbpedia.org/' }
  const has = (re: RegExp) => have.some(f => re.test(f.text))
  const first = (p: string): any => (props[p] || [])[0]?.value
  const pop = n(first('http://dbpedia.org/ontology/populationTotal'))
  if (pop && !has(/population/i)) out.push({ text: `${place} has a population of about ${num(pop)}.`, ...src })
  const area = n(first('http://dbpedia.org/ontology/areaTotal'))
  if (area && !has(/square miles/i)) out.push({ text: `${place} covers about ${num(area / 2589988, 1)} square miles.`, ...src })
  const elev = n(first('http://dbpedia.org/ontology/elevation'))
  if (elev !== null && !has(/above sea level/i)) out.push({ text: `${place} is about ${num(elev * 3.28084)} feet above sea level.`, ...src })
  const nick = first('http://dbpedia.org/property/nickname') ?? first('http://xmlns.com/foaf/0.1/nick')
  if (typeof nick === 'string' && nick.length < 60 && !has(/nicknamed/i)) out.push({ text: `${place} is nicknamed "${nick.replace(/^"|"$/g, '')}".`, ...src })
  return out
}

export async function fetchDbpedia (spot: Spot, have: BuiltFact[], signal?: AbortSignal): Promise<BuiltFact[]> {
  const title = (spot.title || spot.place).replace(/ /g, '_')
  const r = await getJson(`https://dbpedia.org/data/${encodeURIComponent(title)}.json`, signal)
  const props = r?.[`http://dbpedia.org/resource/${title}`]
  if (!props) return []
  return dbpediaFacts(props, spot.place, have)
}

// ------------------------------------------------------------------ OpenStreetMap via Overpass (ODbL)

export const OSM_KINDS: Array<{ key: string, label: string, one: string, many: string }> = [
  { key: '["leisure"="park"]', label: 'parks', one: 'park', many: 'parks' },
  { key: '["leisure"="playground"]', label: 'playgrounds', one: 'playground', many: 'playgrounds' },
  { key: '["amenity"="school"]', label: 'schools', one: 'school', many: 'schools' },
  { key: '["amenity"="library"]', label: 'libraries', one: 'library', many: 'libraries' },
  { key: '["route"="hiking"]', label: 'trails', one: 'hiking route', many: 'hiking routes' },
  { key: '["amenity"="drinking_water"]', label: 'fountains', one: 'public drinking fountain', many: 'public drinking fountains' }
]

/** Facts from counts per kind, pure. */
export function osmFacts (counts: { [label: string]: number }, place: string, miles: number): BuiltFact[] {
  const out: BuiltFact[] = []
  const src = { source: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' }
  for (const k of OSM_KINDS) {
    const c = counts[k.label]
    if (!c || c < 1) continue
    out.push({ text: `OpenStreetMap shows ${num(c)} ${c === 1 ? k.one : k.many} within ${miles} miles of ${place}.`, ...src })
  }
  return out
}

/** One Overpass query that counts every kind at once (one request, kind to the public servers). */
export function osmQuery (lat: number, lon: number, miles = 5): string {
  const radius = Math.round(miles * 1609.34)
  return '[out:json][timeout:25];' + OSM_KINDS.map((k, i) => `nwr${k.key}(around:${radius},${lat},${lon})->.s${i};.s${i} out count;`).join('')
}

/** Counts per kind from the combined query's answer, in OSM_KINDS order. Pure. */
export function osmCounts (r: any): { [label: string]: number } {
  const out: { [label: string]: number } = {}
  const els: any[] = Array.isArray(r?.elements) ? r.elements : []
  OSM_KINDS.forEach((k, i) => { const t = n(els[i]?.tags?.total); if (t !== null) out[k.label] = t })
  return out
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

export async function fetchOsm (spot: Spot, signal?: AbortSignal, miles = 5): Promise<BuiltFact[]> {
  const body = 'data=' + encodeURIComponent(osmQuery(spot.lat, spot.lon, miles))
  // The public servers are often busy: a few tries with a growing wait, across two servers.
  const waits = [0, 3000, 8000]
  let last = ''
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise(res => setTimeout(res, waits[i]))
    if (signal?.aborted) break
    const url = OVERPASS[i % OVERPASS.length]
    // Each try gets 25 seconds of its own (a busy server can hang instead of saying so), and Stop still stops it.
    const own = new AbortController()
    const stop = () => own.abort()
    signal?.addEventListener('abort', stop)
    const timer = setTimeout(stop, 25000)
    try {
      const r = await fetch(url, { method: 'POST', body, signal: own.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } })
      if (!r.ok) { last = `${r.status} from ${new URL(url).host}`; continue }
      return osmFacts(osmCounts(await r.json()), spot.place, miles)
    } catch (e) { last = own.signal.aborted && !signal?.aborted ? `no answer from ${new URL(url).host} in 25 seconds` : (e instanceof Error ? e.message : 'no answer'); if (signal?.aborted) break } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
  }
  throw new Error(`the OpenStreetMap servers are busy (${last}); try again in a few minutes`)
}
