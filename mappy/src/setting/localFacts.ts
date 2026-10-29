/*
  localFacts.ts - builds a starter set of local fun facts for the app's place from open
  sources, for the builder to read, prune and keep. Only the builder's browser ever calls
  the network; the facts are saved with the app, so end users download nothing.

  Source: Wikipedia's public REST API (text under CC BY-SA 4.0), the page for the place
  itself plus a few pages for places near it (parks, landmarks, rivers). Every fact keeps
  the page title it came from, and the builder decides what stays. Nothing is saved until
  they click Save. Pure text processing lives here so it can be tested without a browser.
*/

export interface BuiltFact { text: string, source: string, url: string }
export interface FactBuild { facts: BuiltFact[], pages: string[], note: string }

const WIKI = 'https://en.wikipedia.org'

/** Sentences worth keeping as a fun fact: real sentences, not too long, no list fragments or editorial words. */
export function pickFacts (extract: string, max = 6): string[] {
  // Abbreviations keep their period so "U.S. Highway 50" does not end a sentence.
  const text = String(extract || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').replace(/\b(U\.S|U\.K|St|Mt|Mts|Ft|Dr|Mr|Mrs|Ms|No|Co|Jr|Sr|vs|etc|approx|est)\.(?=\s)/g, '$1\u2024').trim()
  const parts = text.split(/(?<=[.!?])\s+/).map(x => x.replace(/\u2024/g, '.'))
  const out: string[] = []
  for (const raw of parts) {
    const s = raw.trim()
    if (s.length < 40 || s.length > 220) continue
    if (!/[.!?]$/.test(s)) continue
    if (/\b(?:citation needed|disambiguation|may refer to|see also|is a (?:list|category)|according to the \d{4} census|as of \d{4}, the population)\b/i.test(s)) continue
    if (/\b(?:controvers|lawsuit|killed|murder|crime|war crime|scandal|arrested|riot|shooting|disaster victims)\w*/i.test(s)) continue
    if (/^\(|^[a-z]/.test(s)) continue
    // Addresses and store lists are not fun facts.
    if (/\blocated at \d|\banchor stores?\b|\bmanaged by\b|\bowned by\b/i.test(s)) continue
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** Dedupe by the first few words and keep the list short enough to read in settings. */
export function tidy (facts: BuiltFact[], max = 24): BuiltFact[] {
  const seen = new Set<string>()
  const out: BuiltFact[] = []
  for (const f of facts) {
    const key = f.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').slice(0, 7).join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
    if (out.length >= max) break
  }
  return out
}

/** The one-line form saved in settings: the fact and where it came from. */
export function factLine (f: BuiltFact): string { return `${f.text} (${f.source}, Wikipedia)` }

async function getJson (url: string, signal?: AbortSignal): Promise<any> {
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`)
  return r.json()
}

/** The summary of one page: title, extract, coordinates, canonical url. Null when there is no such page. */
async function summary (title: string, signal?: AbortSignal): Promise<any | null> {
  try {
    const s = await getJson(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, signal)
    if (!s || s.type === 'disambiguation' || !s.extract) return null
    return s
  } catch (e) { return null }
}

/** Wikipedia's own search, for "Springfield, Illinois", "Lyon, France" or a misspelling: the best page title, or null. */
async function searchTitle (q: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const r = await getJson(`${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=8&format=json&origin=*`, signal)
    const hits: any[] = r?.query?.search || []
    if (!hits.length) return null
    // Prefer a place page over a person, a team or a list with the same words.
    const placey = hits.find(h => /\b(?:city|town|village|county|municipality|borough|commune|district|census-designated|settlement|capital|region|province|state|country)\b/i.test(String(h.snippet || '')) && !/\blist of\b/i.test(h.title))
    return String((placey || hits[0]).title)
  } catch (e) { return null }
}

/**
 * Builds facts for a place: its own page first ("Springfield, Illinois", "Lyon, France"),
 * found by title and then by Wikipedia search, then up to eight pages within 10 km of it
 * (geosearch), skipping people, companies and lists. `progress` gets a line as it goes.
 */
export async function buildLocalFacts (place: string, region: string, opts: { signal?: AbortSignal, radiusMeters?: number, nearby?: number, progress?: (line: string) => void } = {}): Promise<FactBuild> {
  const name = place.trim()
  const say = opts.progress || (() => {})
  if (!name) return { facts: [], pages: [], note: 'Give the place a name first.' }
  const where = region.trim()
  const full = where && !name.toLowerCase().includes(where.toLowerCase()) ? `${name}, ${where}` : name
  const tries = Array.from(new Set([full, name]))
  let main: any = null
  for (const t of tries) { say(`Looking for "${t}" on Wikipedia...`); main = await summary(t, opts.signal); if (main) break }
  if (!main) {
    say(`No page called "${full}"; searching...`)
    const found = await searchTitle(full, opts.signal)
    if (found) main = await summary(found, opts.signal)
  }
  if (!main) return { facts: [], pages: [], note: `Wikipedia has no page for "${full}". Try the city with its state, or the city with its country ("Lyon, France").` }
  say(`Reading "${main.title}"...`)
  // The page's whole introduction (the summary alone is two sentences).
  let intro = String(main.extract || '')
  try {
    const q = await getJson(`${WIKI}/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(main.title)}&format=json&origin=*`, opts.signal)
    const page: any = Object.values(q?.query?.pages || {})[0]
    if (page?.extract && page.extract.length > intro.length) intro = page.extract
  } catch (e) { }
  const facts: BuiltFact[] = pickFacts(intro, 10).map(text => ({ text, source: main.title, url: main.content_urls?.desktop?.page || '' }))
  const pages = [String(main.title)]
  const at = main.coordinates
  if (at && typeof at.lat === 'number') {
    try {
      const near = await getJson(`${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${at.lat}%7C${at.lon}&gsradius=${opts.radiusMeters || 10000}&gslimit=${(opts.nearby || 8) * 4}&format=json&origin=*`, opts.signal)
      // Parks, landmarks, rivers, museums: not hospitals, schools, places of worship, companies or lists.
      const titles: string[] = (near?.query?.geosearch || []).map((g: any) => String(g.title)).filter((t: string) => t !== main.title && !/\b(?:list of|school|academy|university|college|district|hospital|medical|clinic|incorporated|LLC|Inc\.|company|corporation|church|chapel|temple|mosque|synagogue|cathedral|cemetery|prison|jail|courthouse|police|station|mall|shopping|store|casino|hotel|motel|bank|plaza)\b/i.test(t))
      let taken = 0
      for (const t of titles) {
        if (taken >= (opts.nearby || 8)) break
        say(`Reading nearby: "${t}"...`)
        const s = await summary(t, opts.signal)
        if (!s || /\b(?:person|politician|businessperson|singer|actor|murder|crime)\b/i.test(s.description || '')) continue
        const picked = pickFacts(s.extract, 2)
        if (!picked.length) continue
        pages.push(String(s.title)); taken++
        for (const text of picked) facts.push({ text, source: s.title, url: s.content_urls?.desktop?.page || '' })
      }
    } catch (e) { }
  }
  const all = tidy(facts)
  return { facts: all, pages, note: all.length ? `${all.length} facts from ${pages.length} Wikipedia page${pages.length === 1 ? '' : 's'} (CC BY-SA). Read them over, delete any you do not want, then Save.` : 'Nothing usable came back. You can type facts by hand below.' }
}
