/*
  text.ts - Mappy's language helpers: HTML stripping, tokenizing, a light stemmer,
  GIS synonyms and typo tolerance. Pure TypeScript, no imports.
*/

const STOP = new Set((
  'a an and are as at be been but by can could did do does for from had has have how i if in into is it its ' +
  'me my of on or our please so that the their them then there these this those to us was we were what when ' +
  'where which who why will with would you your yours about any some all just get got show tell give let ' +
  'find search look see want need like know thing things also only very much many more most here hey hi mappy ' +
  'widget tool panel button app application map maps'
).split(' '))

/** Words that carry meaning in a question but are not worth indexing as content. */
export function isStop (t: string): boolean { return STOP.has(t) }

/** Groups of words that mean the same thing to someone using a map. Every member maps to every other. */
const SYN_GROUPS: string[][] = [
  ['parcel', 'property', 'lot', 'tax', 'assessor', 'apn', 'pin', 'land'],
  ['owner', 'ownership', 'owned', 'landowner'],
  ['address', 'addresses', 'situs', 'location', 'street address'],
  ['road', 'street', 'streets', 'roads', 'centerline', 'highway', 'avenue', 'route'],
  ['layer', 'layers', 'data', 'dataset', 'overlay'],
  ['legend', 'symbol', 'symbology', 'key'],
  ['print', 'printing', 'pdf', 'export map', 'printout'],
  ['measure', 'measurement', 'distance', 'area', 'length', 'ruler'],
  ['draw', 'sketch', 'markup', 'redline', 'annotate'],
  ['search', 'find', 'locate', 'lookup', 'geocode'],
  ['basemap', 'background', 'imagery', 'aerial', 'satellite', 'topo'],
  ['zoning', 'zone', 'zones', 'land use', 'landuse'],
  ['water', 'hydrant', 'main', 'valve'],
  ['sewer', 'manhole', 'wastewater', 'sanitary'],
  ['storm', 'stormwater', 'drainage', 'culvert', 'inlet'],
  ['school', 'schools', 'education'],
  ['park', 'parks', 'trail', 'trails', 'open space', 'recreation'],
  ['council', 'district', 'ward', 'precinct'],
  ['flood', 'floodplain', 'fema', 'hazard'],
  ['bookmark', 'bookmarks', 'saved place', 'saved view'],
  ['table', 'attribute', 'attributes', 'records', 'rows'],
  ['select', 'selection', 'pick', 'choose'],
  ['filter', 'query', 'subset'],
  ['coordinates', 'coordinate', 'lat', 'lon', 'latitude', 'longitude', 'xy'],
  ['share', 'link', 'url', 'email', 'qr'],
  ['help', 'guide', 'instructions', 'manual', 'how to', 'tutorial'],
  ['contact', 'phone', 'call', 'email', 'helpdesk', 'help desk', 'support', 'question'],
  ['label', 'labels', 'mailing', 'mail', 'notification'],
  ['report', 'reports', 'summary'],
  ['elevation', 'contour', 'contours', 'height', 'terrain'],
  ['building', 'buildings', 'footprint', 'structure'],
  ['crime', 'police', 'incident'],
  ['traffic', 'counts', 'volume', 'aadt'],
  ['permit', 'permits', 'planning', 'project', 'development'],
  ['open', 'launch', 'start', 'bring up', 'pull up'],
  ['close', 'hide', 'dismiss']
]

const SYN = new Map<string, Set<string>>()
for (const g of SYN_GROUPS) {
  const stems = g.flatMap(w => tokenize(w, false))
  for (const s of stems) {
    if (!SYN.has(s)) SYN.set(s, new Set())
    for (const o of stems) if (o !== s) SYN.get(s)!.add(o)
  }
}

/** Synonym stems for a stem (not including itself). */
export function synonyms (stem: string): string[] {
  const s = SYN.get(stem)
  return s ? Array.from(s) : []
}

/** A light English stemmer: enough to match "layers" with "layer" and "parcels" with "parcel". */
export function stem (w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('sses')) return w.slice(0, -2)
  if (w.endsWith('ments') && w.length > 9) return w.slice(0, -5)
  if (w.endsWith('ment') && w.length > 8) return w.slice(0, -4)
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3)
  if (w.endsWith('ed') && w.length > 4 && !w.endsWith('eed')) return w.slice(0, -2)
  if (w.endsWith('es') && w.length > 4 && /(ch|sh|x|z|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1)
  return w
}

/** Lowercase word tokens, camelCase and snake_case split, stemmed. */
export function tokenize (text: string, dropStop = true): string[] {
  if (!text) return []
  const spaced = String(text)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .toLowerCase()
  const raw = spaced.match(/[a-z0-9]+/g) || []
  const out: string[] = []
  for (const r of raw) {
    if (r.length < 2 && !/\d/.test(r)) continue
    if (dropStop && STOP.has(r)) continue
    out.push(stem(r))
  }
  return out
}

const ENTITIES: { [k: string]: string } = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** HTML to readable text. Keeps link targets as "text (url)". */
export function stripHtml (html: string): string {
  if (!html) return ''
  let s = String(html)
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<exp[^>]*>[\s\S]*?<\/exp>/gi, ' ')
  s = s.replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => {
    const t = txt.replace(/<[^>]+>/g, '').trim()
    if (!t || t === href) return ' ' + href + ' '
    return ' ' + t + ' (' + href.replace(/^mailto:/, '') + ') '
  })
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/&(#?\w+);/g, (m, k) => ENTITIES[k] ?? (k.startsWith('#') ? String.fromCharCode(parseInt(k.slice(1), 10) || 32) : ' '))
  return s.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

export function clip (s: string, n: number): string {
  if (!s) return ''
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...'
}

/** Optimal string alignment distance, capped: returns cap+1 once it is exceeded. */
export function editDistance (a: string, b: string, cap = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  const m = a.length; const n = b.length
  let prev2: number[] = new Array(n + 1).fill(0)
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap) return cap + 1
    prev2 = prev; prev = cur
  }
  return prev[n]
}

/** Stable key for a layer: lowercase url without token/query, or the title. */
export function layerKey (url?: string, title?: string): string {
  if (url) return String(url).split('?')[0].replace(/\/+$/, '').toLowerCase()
  return 'title:' + String(title || '').trim().toLowerCase()
}

/** "Search Custom 6" -> "Search Custom"; builder adds numbers to duplicate labels. */
export function cleanLabel (label: string): string {
  return String(label || '').replace(/\s+\d+$/, '').trim()
}

export function uniq<T> (arr: T[]): T[] { return Array.from(new Set(arr)) }

/** Lowercased text without punctuation, for contains checks. */
export function flat (s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function hash (s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36)
}
