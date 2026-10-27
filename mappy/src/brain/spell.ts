/*
  spell.ts - forgives typos the way a person would. Before Mappy reads a request he fixes
  slips like "trun on parcles", "lsit layres", "zoomin", "lay ers" or "opne the legnd".

  How: a word he knows is never touched, and every English word counts as known (a compact
  filter over Open English WordNet in the language pack), so "county", "mesa" and "elm" stay.
  An unknown word becomes the closest of, in this order of trust:
    0. command words (turn, list, zoom, open...)
    1. names in this app (layers, tools, pages, fields)
    2. map words and their synonyms
  when the match is close enough and clearly better than the next best. Closeness counts
  keyboard slips (neighbouring keys), swapped letters and doubled letters as small mistakes.

  Values are protected: quoted text, numbers, anything after "where" or "equals", and the
  thing being searched for ("find Smith in parcels") only ever snaps to names in this app.
  Pure TypeScript.
*/
import { stem, isStop } from './text'

export interface Correction {
  text: string
  changed: boolean
  /** Each fix made, as [what was typed, what Mappy read]. */
  swaps: Array<[string, string]>
}

interface Entry { w: string, tier: number, prior: number }

const COMMAND_WORDS = (
  'turn switch toggle shut on off show hide display enable disable add remove list open close launch start run ' +
  'find search locate lookup look where what which who why how many much count number zoom pan fly go take ' +
  'navigate jump in out full home extent layer layers group groups table tables tool tools widget widgets page pages ' +
  'view views window windows tab tabs link links bookmark bookmarks preset presets favorite favorites starred only ' +
  'just solo isolate everything every all none clear reset undo repeat again select expand reveal highlight point ' +
  'opacity transparency percent scale set make filter sort summarize summary statistics stats average total ' +
  'minimum maximum fields field attributes attribute columns column values value rows row records record next ' +
  'previous more less results result first second third last top bottom help commands examples tip joke thanks ' +
  'thank hello goodbye about explain describe inside data ideas explore quality missing null empty browse print ' +
  'legend measure draw share export download address geocode coordinates where am here visible hidden active ' +
  'turned showing please could would should can will you mappy map maps the and then with from into onto this that ' +
  'these those them they there their its your my our me want need like know tell give get see let use apply load ' +
  'diagnose troubleshoot status diagnostics forget context conversation cancel choose pick sleep nap quiet ' +
  'sort sorted order ordered asc desc ascending descending largest smallest biggest highest lowest top bottom ' +
  'over under above below greater less than between equals equal contains group grouped per each by ' +
  'mean median sum min max unique distinct duplicate duplicates nulls blank blanks percent share'
).split(' ')

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const KEY_POS: { [c: string]: [number, number] } = {}
KEY_ROWS.forEach((row, y) => { for (let x = 0; x < row.length; x++) KEY_POS[row[x]] = [x + y * 0.5, y] })
const VOWELS = /[aeiouy]/

function neighbours (a: string, b: string): boolean {
  const p = KEY_POS[a]; const q = KEY_POS[b]
  if (!p || !q) return false
  return Math.abs(p[0] - q[0]) <= 1.01 && Math.abs(p[1] - q[1]) <= 1
}

function subCost (a: string, b: string): number {
  if (a === b) return 0
  if (neighbours(a, b)) return 0.65
  if (VOWELS.test(a) && VOWELS.test(b)) return 0.7
  return 1
}

/**
 * How far apart two words are as typing mistakes: a weighted Damerau distance where a
 * neighbouring key, a vowel mix-up, swapped letters or a doubled letter cost less than a
 * random wrong letter. A wrong first letter costs a little extra (people rarely miss it).
 * Returns cap + 1 once the cap is passed.
 */
export function typoCost (a: string, b: string, cap = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) * 0.5 > cap) return cap + 1
  const m = a.length; const n = b.length
  const d: number[][] = []
  for (let i = 0; i <= m; i++) { d.push(new Array(n + 1).fill(0)); d[i][0] = i }
  for (let j = 0; j <= n; j++) d[0][j] = j * 0.8
  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= n; j++) {
      const ca = a[i - 1]; const cb = b[j - 1]
      const del = ca === a[i - 2] || ca === b[j - 1] ? 0.5 : 1
      // A letter left out is the most common slip of all, so it costs less than an extra one.
      const ins = cb === b[j - 2] || cb === a[i - 1] ? 0.5 : 0.8
      let v = Math.min(d[i - 1][j] + del, d[i][j - 1] + ins, d[i - 1][j - 1] + subCost(ca, cb))
      if (i > 1 && j > 1 && ca === b[j - 2] && a[i - 2] === cb) v = Math.min(v, d[i - 2][j - 2] + 0.5)
      d[i][j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap + 0.5) return cap + 1
  }
  let cost = d[m][n]
  if (a[0] !== b[0]) cost += 0.2
  cost = Math.round(cost * 100) / 100
  return cost > cap + 1e-9 ? cap + 1 : cost
}

/**
 * How a word sounds, roughly: "elevashun" and "elevation", "skool" and "school", "fone" and
 * "phone" share a key. Used only when spelling distance finds nothing.
 */
export function soundKey (w: string): string {
  let s = w.toLowerCase().replace(/[^a-z]/g, '')
  if (!s) return ''
  s = s.replace(/^kn|^gn|^pn|^wr/, m => m[1]).replace(/^x/, 's')
    .replace(/(?:tion|sion|shun|cian|tian)/g, 'xn').replace(/sch/g, 'sk').replace(/ph/g, 'f').replace(/gh(?![aeiou])/g, '')
    .replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/dg/g, 'j')
    .replace(/x(?!n)/g, 'ks').replace(/z/g, 's').replace(/wh/g, 'w').replace(/sh/g, 'x').replace(/th/g, '0')
  const head = s[0]
  const body = s.slice(1).replace(/[aeiouyhw]/g, '')
  return (head + body).replace(/(.)\1+/g, '$1')
}

/** Two-letter slips that only make sense after a command word: "zoom ot", "turn of", "turn no". */
const AFTER: { [verb: string]: { [typed: string]: string } } = {
  zoom: { ot: 'out', ou: 'out', uot: 'out', oit: 'out', iut: 'out', im: 'in', un: 'in', inn: 'in', ni: 'in' },
  turn: { of: 'off', og: 'off', oof: 'off', ofd: 'off', no: 'on', om: 'on', onn: 'on', pn: 'on', ob: 'on' }
}
AFTER.switch = AFTER.turn
AFTER.toggle = AFTER.turn
AFTER.flip = AFTER.turn

/** Most a word of this length may be off by and still be fixed. */
function allowance (len: number, tier = 9): number {
  if (len <= 3) return tier === 0 ? 1.05 : 0.65
  if (len === 4) return 1.05
  if (len <= 6) return 1.3
  if (len <= 9) return 1.8
  return 2.25
}

// ---------------------------------------------------------------- every English word
/**
 * A compact "is this a real word?" check (a Bloom filter) over every word in Open English
 * WordNet, so real words and many place words ("county", "mesa", "canyon", "elm") are never
 * "fixed". It can say yes to a few non-words (about 1 in 100); it never says no to a real one.
 */
export class KnownWords {
  constructor (private bits: Uint8Array, private m: number, private k: number) {}
  static hashes (w: string): [number, number] {
    let h1 = 2166136261; let h2 = 5381
    for (let i = 0; i < w.length; i++) { const c = w.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0 }
    return [h1 >>> 0, (h2 >>> 0) | 1]
  }
  has (w: string): boolean {
    const [a, b] = KnownWords.hashes(w)
    for (let i = 0; i < this.k; i++) { const bit = (a + Math.imul(i, b)) >>> 0; const j = bit % this.m; if (!(this.bits[j >> 3] & (1 << (j & 7)))) return false }
    return true
  }
  static build (words: Iterable<string>, bitsPerWord = 10, k = 7): { m: number, k: number, n: number, b64: string } {
    const list = Array.from(new Set(Array.from(words)))
    const m = Math.max(64, Math.ceil(list.length * bitsPerWord / 8) * 8)
    const bits = new Uint8Array(m / 8)
    for (const w of list) {
      const [a, b] = KnownWords.hashes(w)
      for (let i = 0; i < k; i++) { const j = ((a + Math.imul(i, b)) >>> 0) % m; bits[j >> 3] |= 1 << (j & 7) }
    }
    return { m, k, n: list.length, b64: toBase64(bits) }
  }
  static from (p: { m: number, k: number, b64: string } | null | undefined): KnownWords | null {
    if (!p || !Number.isInteger(p.m) || !Number.isInteger(p.k) || p.k < 1 || p.k > 16 || typeof p.b64 !== 'string') return null
    const bits = fromBase64(p.b64)
    if (bits.length * 8 < p.m) return null
    return new KnownWords(bits, p.m, p.k)
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64 (bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}
function fromBase64 (s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255
  }
  return out
}

/** The word and every way to write it with one letter left out. */
function deletes (w: string): string[] {
  const out = [w]
  for (let i = 0; i < w.length; i++) out.push(w.slice(0, i) + w.slice(i + 1))
  return out
}

const SHARED_DELS = new Map<string, Map<string, string[]>>()

export class Lexicon {
  /** Command words, app names and map words (tiers 0 to 2), by length: few, so scanned in full. */
  private byLen = new Map<number, Entry[]>()
  /** Everyday English (tier 3): thousands, so found through a one-letter-left-out index. */
  private plain: string[] = []
  private dels: Map<string, string[]> | null = null
  private best = new Map<string, Entry>()
  /** Pack fixes: a known misspelling to the word meant ("teh" to "the"). */
  fixes = new Map<string, string>()

  add (words: Iterable<string>, tier: number, prior = 0): void {
    for (const raw of words) {
      const w = String(raw || '').toLowerCase()
      if (!/^[a-z]{2,24}$/.test(w)) continue
      const have = this.best.get(w)
      if (have && have.tier <= tier) continue
      const e: Entry = { w, tier, prior }
      this.best.set(w, e)
      if (tier >= 3) { this.plain.push(w); this.dels = null; continue }
      const list = this.byLen.get(w.length) || []
      if (have && have.tier < 3) list.splice(list.indexOf(have), 1, e)
      else list.push(e)
      this.byLen.set(w.length, list)
    }
  }

  /** Everyday words one slip away (any single insert, delete, change or swap). */
  private plainNear (w: string): Entry[] {
    if (!this.dels) {
      // The index depends only on the word list, so lexicons built from the same pack share it.
      const key = this.plain.length + ':' + this.plain[0] + ':' + this.plain[this.plain.length - 1]
      let dels = SHARED_DELS.get(key)
      if (!dels) {
        dels = new Map<string, string[]>()
        for (const word of this.plain) {
          for (const d of deletes(word)) { const l = dels.get(d); if (l) l.push(word); else dels.set(d, [word]) }
        }
        SHARED_DELS.clear()
        SHARED_DELS.set(key, dels)
      }
      this.dels = dels
    }
    const out: Entry[] = []
    const seen = new Set<string>()
    for (const d of deletes(w)) {
      for (const cand of this.dels.get(d) || []) {
        if (seen.has(cand)) continue
        seen.add(cand)
        const e = this.best.get(cand)
        if (e && e.tier >= 3) out.push(e)
      }
    }
    return out
  }

  private around (w: string, spread: number, english: boolean): Entry[] {
    const out: Entry[] = []
    for (let len = w.length - spread; len <= w.length + spread; len++) for (const e of this.byLen.get(len) || []) out.push(e)
    return english ? out.concat(this.plainNear(w)) : out
  }

  tierOf (w: string): number | undefined { return this.best.get(w)?.tier }

  /** Every real English word (see KnownWords); set from the language pack. */
  known: KnownWords | null = null

  knows (w: string): boolean {
    if (this.best.has(w) || isStop(w) || (this.known && w.length >= 2 && this.known.has(w))) return true
    const s = stem(w)
    if (s !== w && (s.length >= 4 || w.length - s.length === 1) && (this.best.has(s) || (this.known && this.known.has(s)))) return true
    // "zoomed", "mapped", "layering": stem away a doubled consonant or a dropped e.
    if (/(ed|ing|er|es|s)$/.test(w)) {
      const suffix = (w.match(/(ed|ing|er|es|s)$/) as RegExpMatchArray)[1]
      const base = w.slice(0, -suffix.length)
      // A short base hides typos ("leged" is not "leg" + ed), so only longer bases count.
      if (base.length >= 4 && (this.best.has(base) || this.best.has(base + 'e'))) return true
      if (suffix !== 's' && suffix !== 'es' && /(.)\1$/.test(base) && this.best.has(base.slice(0, -1))) return true
    }
    return false
  }

  /** Closest known word, or null when nothing is close enough or two words are equally close. */
  nearest (w: string, maxTier = 9, cap = allowance(w.length), minTier = 0, lead = false): string | null {
    let first: { e: Entry, s: number } | null = null
    let second: { e: Entry, s: number } | null = null
    {
      for (const e of this.around(w, 2, maxTier >= 3)) {
        if (e.tier > maxTier || e.tier < minTier) continue
        // A three-letter word stretches further only as the first word of a request ("opn legend");
        // map words only fix small slips ("whitewater" is not "wastewater").
        let limit = w.length <= 3 && e.tier === 0 && lead && cap === allowance(w.length) ? allowance(w.length, 0) : cap
        if (e.tier === 2) limit = Math.min(limit, 1.3)
        const c = typoCost(w, e.w, limit)
        if (c > limit + 1e-9) continue
        // Everyday English only fixes a single slip: an unknown word is more often a name than a typo.
        if (e.tier >= 3 && c > 0.7) continue
        const s = c + e.tier * 0.12 - e.prior * 0.04 - (lead && LEADS.has(e.w) ? 0.12 : 0)
        if (!first || s < first.s) { second = first; first = { e, s } } else if (!second || s < second.s) second = { e, s }
      }
    }
    if (!first) return null
    if (second && second.s - first.s < 0.08 && second.e.tier === first.e.tier) return null
    return first.e.w
  }

  /** A word that sounds the same, from commands, app names and map words only, when it is the only one. */
  soundsLike (w: string, maxTier = 2): string | null {
    const key = soundKey(w)
    if (key.length < 3) return null
    let found: Entry | null = null
    {
      for (const e of this.around(w, 3, false)) {
        if (e.tier > maxTier || soundKey(e.w) !== key || typoCost(w, e.w, 3) > 3) continue
        if (found && found.w !== e.w && found.tier === e.tier) return null
        if (!found || e.tier < found.tier) found = e
      }
    }
    return found ? found.w : null
  }

  /** Known words (commands, app names, map words) close to a word, closest first, with their cost. */
  closeTo (w: string, cap: number, maxTier = 2): Array<{ w: string, cost: number, tier: number }> {
    const out: Array<{ w: string, cost: number, tier: number }> = []
    for (const e of this.around(w, 3, false)) {
      if (e.tier > maxTier || e.w === w) continue
      const c = typoCost(w, e.w, cap)
      if (c <= cap + 1e-9) out.push({ w: e.w, cost: c, tier: e.tier })
    }
    return out.sort((a, b) => a.cost - b.cost || a.tier - b.tier).slice(0, 4)
  }

  /** Names in this app, flattened ("fire hydrants"), for judging whether a reading makes sense. */
  names = new Set<string>()

  /** Command words close to what was typed, closest first, for when the first reading made no sense. */
  commandsNear (w: string): string[] {
    const cap = Math.max(1.05, allowance(w.length))
    const out: Array<{ w: string, s: number }> = []
    {
      for (const e of this.around(w, 2, false)) {
        if (e.tier !== 0 || e.w === w) continue
        const c = typoCost(w, e.w, cap)
        if (c <= cap + 1e-9) out.push({ w: e.w, s: c - (LEADS.has(e.w) ? 0.12 : 0) })
      }
    }
    return out.sort((a, b) => a.s - b.s).slice(0, 5).map(x => x.w)
  }

  /** "turnon" to "turn on", "listlayers" to "list layers". */
  split (w: string, plainEnglish = true): string | null {
    if (w.length < 4) return null
    for (let i = 2; i <= w.length - 2; i++) {
      const a = w.slice(0, i); const b = w.slice(i)
      const ta = this.tierOf(a); const tb = this.tierOf(b)
      if (ta === undefined || tb === undefined) continue
      if ((ta <= 2 && tb <= 2) || (plainEnglish && a.length >= 3 && b.length >= 3 && ta <= 3 && tb <= 3)) return a + ' ' + b
    }
    return null
  }
}

/** Command words, map words and synonyms; the base every lexicon starts from. */
/** The words requests start with most; they win ties ("thrn" is "turn", not "then"). */
export const LEADS = new Set('turn list open close zoom show hide find search count where what how only select switch go take explore summarize clear'.split(' '))

export function baseLexicon (synonymWords: Iterable<string>, english: Iterable<string>, fixes: { [w: string]: string } = {}): Lexicon {
  const lex = new Lexicon()
  lex.add(Array.from(LEADS), 0, 2)
  lex.add(COMMAND_WORDS, 0, 1)
  lex.add(synonymWords, 2)
  lex.add(english, 3)
  for (const k of Object.keys(fixes)) lex.fixes.set(k.toLowerCase(), String(fixes[k]).toLowerCase())
  return lex
}

/** Words worth knowing from names in the app: "Fire Hydrants" gives "fire" and "hydrants". */
export function wordsOf (names: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const n of names) {
    for (const w of String(n || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z]{3,24}/g) || []) out.add(w)
  }
  return Array.from(out)
}

const VALUE_VERBS = /^(?:find|search|locate|lookup|geocode|filter|where)$/
const SCOPE_WORDS = /^(?:in|on|from|within)$/
/** Where a condition starts ("where owner equals O'Brien"); nothing after it is changed. */
const CONDITION = /\s(?:where|with|equals?|contains|like|between|starts with|ends with)\s|[=<>]/i

function keepCase (typed: string, fixed: string): string {
  if (typed === typed.toUpperCase() && typed.length > 1) return fixed.toUpperCase()
  if (typed[0] === typed[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1)
  return fixed
}

/**
 * Read a request the way a forgiving person would. `app` holds the names in this app at
 * tier 1 (see wordsOf). Returns the fixed text and what was changed.
 */
export function correctTypos (input: string, lex: Lexicon): Correction {
  const swaps: Array<[string, string]> = []
  const text = String(input || '')
  if (!text.trim() || /^__/.test(text) || text.length > 500) return { text, changed: false, swaps }
  // Split into words and the spaces and marks between them, so the rest of the text survives as typed.
  const parts = text.match(/"[^"]*"?|'[^']*'(?=\s|$)|\p{L}[\p{L}'\u2019]*|\d[\w.,:-]*|\s+|[^\s\p{L}\d]+/gu) || [text]
  const words: number[] = []
  // Only plain a-z words are read for typos; "café", "Señora" and other languages are left as typed.
  parts.forEach((p, i) => { if (/^[A-Za-z][A-Za-z']*$/.test(p)) words.push(i) })

  // Join a word broken by a stray space: "lay ers", "book marks".
  for (let k = 0; k < words.length - 1; k++) {
    const i = words[k]; const j = words[k + 1]
    if (j !== i + 2 || !/^ $/.test(parts[i + 1])) continue
    const a = parts[i].toLowerCase(); const b = parts[j].toLowerCase()
    if (lex.knows(a) && lex.knows(b)) continue
    const joined = a + b
    const tier = lex.tierOf(joined) ?? lex.tierOf(stem(joined))
    if (tier === undefined || tier > 2) continue
    swaps.push([parts[i] + ' ' + parts[j], joined])
    parts[i] = keepCase(parts[i], joined); parts[i + 1] = ''; parts[j] = ''
    words.splice(k + 1, 1)
  }

  // Another language ("zeige alle ebenen"): most unknown words have nothing close in English,
  // so leave the whole request as typed rather than "fix" the few that look English.
  {
    let unknown = 0; let lost = 0
    for (const i of words) {
      const low = parts[i].toLowerCase()
      if (low.length < 3 || lex.knows(low) || lex.fixes.has(low)) continue
      unknown++
      if (!lex.split(low, false) && !lex.nearest(low, 2) && !lex.soundsLike(low)) lost++
    }
    if (lost >= 2 && lost * 2 > unknown) return { text, changed: false, swaps }
  }

  let mode: 'free' | 'value' | 'locked' = 'free'
  let first = true
  const lockAt = (() => { const m = text.slice(1).match(CONDITION); return m ? m.index! + 1 : Infinity })()
  let at = 0
  const offset: number[] = parts.map(p => { const o = at; at += p.length; return o })
  for (const i of words) {
    if (offset[i] > lockAt) mode = 'locked'
    const typed = parts[i]
    if (!typed) continue
    const low = typed.toLowerCase().replace(/'s$/, '')
    const proper = !first && /^[A-Z]/.test(typed) && typed !== typed.toUpperCase()
    let fixed: string | null = null
    // Known slips ("teh", "pls") only in the request itself, never in a name or a searched value.
    if (lex.fixes.has(low) && mode === 'free' && !proper) fixed = lex.fixes.get(low)!
    else if (mode !== 'locked' && low.length >= 3 && !/'/.test(low) && !lex.knows(low)) {
      if (proper || mode === 'value') {
        // A Name or a searched-for value only snaps to a name in this app, and only for a small slip.
        fixed = lex.nearest(low, 1, Math.min(proper ? 1.05 : 1.3, allowance(low.length)), 1)
      } else {
        // Map words joined together first ("turnon"), then the closest command, app or map
        // word ("everyting"), then one that sounds the same. Never everyday English: an unknown
        // word is more often a name ("Pitkin", "Rood") than a typo of some other English word.
        fixed = lex.split(low, false) || lex.nearest(low, 2, allowance(low.length), 0, first) || lex.soundsLike(low)
      }
    }
    const now = (fixed || low)
    if (fixed && fixed !== low) {
      swaps.push([typed, fixed])
      parts[i] = keepCase(typed, fixed)
    }
    const head = now.split(' ').pop() as string
    if (first && VALUE_VERBS.test(now.split(' ')[0])) mode = 'value'
    else if (mode === 'value' && SCOPE_WORDS.test(head)) mode = 'free'
    first = false
  }
  // Two-letter slips after a command word ("zoom ot", "turn of parcels").
  const live = words.filter(i => parts[i])
  for (let k = 1; k < live.length; k++) {
    const verb = parts[live[k - 1]].toLowerCase()
    const typed = parts[live[k]]
    const fix = AFTER[verb]?.[typed.toLowerCase()]
    if (fix && offset[live[k]] < lockAt) { swaps.push([typed, fix]); parts[live[k]] = fix }
  }
  const out = parts.join('').replace(/ {2,}/g, ' ')
  return { text: out, changed: swaps.length > 0, swaps }
}
