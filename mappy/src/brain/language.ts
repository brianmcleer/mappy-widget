/*
  language.ts - Mappy's language pack: extra synonyms, everyday English words for typo
  fixing, known misspellings and alternate ways to say a command ("unhide" means "turn on").

  The pack is built by the repository's GitHub Action (language/build.mjs) from open data
  (Open English WordNet) and from phrases people report Mappy missed, tested against the
  phrase suite before it ships. The widget bundles one (languagePack.ts); the builder can pull
  a newer one in settings, which is stored with the app. End users never download anything.

  Pure TypeScript.
*/
import BUNDLED from './languagePack'
import { setLanguageWords, SYNONYM_WORDS } from './text'
import { baseLexicon, correctTypos, wordsOf, LEADS, KnownWords } from './spell'
import type { Correction, Lexicon } from './spell'
import { normalizeCommand } from './conversation'
import { parseIntent } from './intents'

export interface LanguagePack {
  format: 1
  /** "2026.10.27": newer packs sort later. */
  version: string
  /** Extra synonym groups; each member means every other member. */
  synonyms: string[][]
  /** Leading phrases said another way, [said, means]: ["unhide", "turn on"]. */
  rewrites: Array<[string, string]>
  /** Known misspellings to the word meant, plus irregular forms ("drew" to "draw"). */
  fixes: { [typed: string]: string }
  /** Everyday English words, space separated (older packs; newer packs use `known`). */
  words: string
  /** Every English word in Open English WordNet, as a compact yes/no filter (see KnownWords). */
  known?: { m: number, k: number, n?: number, b64: string } | null
  sources?: Array<{ name: string, license: string, url: string }>
  stats?: { [k: string]: number }
}

/** Where builders get newer packs. Forks change this one line. */
export const LANGUAGE_REPO = 'brianmcleer/mappy-widget'
export const LANGUAGE_URL = `https://raw.githubusercontent.com/${LANGUAGE_REPO}/HEAD/language/language-pack.json`

const WORD = /^[a-z][a-z' -]{0,38}[a-z]$|^[a-z]$/
/** A phrasing: plain words, with at most one * standing for the rest of the request. */
const PHRASE = /^(?:[a-z][a-z' -]{0,38}[a-z]|[a-z])(?: \*(?: [a-z][a-z' -]{0,30}[a-z])?)?$|^\* [a-z][a-z' -]{0,30}[a-z]$/

/** Checks a pack from anywhere (a download, the app config) and keeps only safe, plain entries. */
export function cleanPack (p: any): LanguagePack | null {
  if (!p || p.format !== 1 || typeof p.version !== 'string' || !/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(p.version)) return null
  const word = (w: any) => typeof w === 'string' && WORD.test(w.toLowerCase().trim())
  const synonyms = (Array.isArray(p.synonyms) ? p.synonyms : []).slice(0, 4000)
    .map((g: any) => (Array.isArray(g) ? g : []).filter(word).map((w: string) => w.toLowerCase().trim()).slice(0, 24))
    .filter((g: string[]) => g.length > 1)
  const rewrites = (Array.isArray(p.rewrites) ? p.rewrites : []).slice(0, 2000)
    .filter((r: any) => Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string' && PHRASE.test(r[0].toLowerCase().trim()) && PHRASE.test(r[1].toLowerCase().trim()) && (r[0].split('*').length === r[1].split('*').length))
    .map((r: string[]) => [r[0].toLowerCase().trim(), r[1].toLowerCase().trim()] as [string, string])
  const fixes: { [k: string]: string } = {}
  if (p.fixes && typeof p.fixes === 'object') {
    for (const k of Object.keys(p.fixes).slice(0, 20000)) if (/^[a-z][a-z0-9]{0,23}$/.test(k) && word(p.fixes[k])) fixes[k] = String(p.fixes[k]).toLowerCase()
  }
  const words = typeof p.words === 'string' ? p.words.toLowerCase().replace(/[^a-z ]+/g, ' ').slice(0, 400000) : ''
  const k = p.known
  const known = k && Number.isInteger(k.m) && k.m > 0 && k.m <= 8000000 && Number.isInteger(k.k) && k.k >= 1 && k.k <= 16 && typeof k.b64 === 'string' && /^[A-Za-z0-9+/=]*$/.test(k.b64) && k.b64.length * 6 >= k.m
    ? { m: k.m, k: k.k, n: Number(k.n) || 0, b64: k.b64 } : null
  return { format: 1, version: p.version, synonyms, rewrites, fixes, words, known, sources: Array.isArray(p.sources) ? p.sources.slice(0, 20) : [], stats: p.stats && typeof p.stats === 'object' ? p.stats : {} }
}

/** "2026.11.02.10" is newer than "2026.11.02.9": versions compare part by part, as numbers. */
export function compareVersions (a: string, b: string): number {
  const x = String(a || '').split('.').map(Number); const y = String(b || '').split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

let current: LanguagePack = cleanPack(BUNDLED) || { format: 1, version: '0000.00.00', synonyms: [], rewrites: [], fixes: {}, words: '' }
let rewrites: Array<[string, string]> = []
let english: string[] = []
let generation = 0
let knownWords: KnownWords | null = null

function install (p: LanguagePack): void {
  current = p
  setLanguageWords(p.synonyms, p.fixes)
  rewrites = p.rewrites.slice().sort((a, b) => b[0].length - a[0].length)
  english = p.words ? p.words.split(' ').filter(Boolean) : []
  knownWords = KnownWords.from(p.known)
  generation++
}
install(current)

/** The pack in use. */
export function languagePack (): LanguagePack { return current }
export function bundledVersion (): string { return (cleanPack(BUNDLED)?.version) || '0000.00.00' }

/**
 * Use a pack (from settings) when it is newer than the one in use. Returns true when it
 * was installed. Pass force to go back to an older one (the bundled pack).
 */
export function applyLanguagePack (p: any, force = false): boolean {
  const clean = cleanPack(p)
  if (!clean) return false
  if (!force && compareVersions(clean.version, current.version) <= 0) return false
  install(clean)
  return true
}

const templates = new Map<string, RegExp>()
function template (from: string): RegExp {
  let rx = templates.get(from)
  if (!rx) {
    rx = new RegExp('^' + from.split('*').map(p => p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ?(.+?) ?') + '[?.!]*$', 'i')
    templates.set(from, rx)
  }
  return rx
}

/**
 * "unhide parcels" to "turn on parcels": a phrase at the start of a request. A phrase with a
 * * in it is a pattern for the whole request: "make * visible" to "turn on *".
 */
export function rewritePhrasing (text: string): string {
  const low = text.toLowerCase()
  for (const [from, to] of rewrites) {
    if (from.includes('*')) {
      const m = text.match(template(from))
      if (m && m[1]) return to.replace('*', () => m[1])
      continue
    }
    if (low === from || low.startsWith(from + ' ')) return to + text.slice(from.length)
  }
  return text
}

const cache = new WeakMap<object, { key: string, gen: number, lex: Lexicon }>()

/** The typo lexicon for an app: base words plus the names in it (layers, tools, pages). */
export function lexiconFor (names: string[], owner?: object): Lexicon {
  const key = names.join('|')
  const hit = owner ? cache.get(owner) : undefined
  if (hit && hit.key === key && hit.gen === generation) return hit.lex
  const lex = baseLexicon(SYNONYM_WORDS(), english, current.fixes)
  lex.known = knownWords
  lex.add(wordsOf(names), 1)
  for (const n of names) { const f = String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (f) lex.names.add(f) }
  // Words in the pack's phrasings are words Mappy knows ("unhide" is not a typo of "untied").
  lex.add(wordsOf(current.rewrites.map(r => r[0] + ' ' + r[1])), 0)
  if (owner) cache.set(owner, { key, gen: generation, lex })
  return lex
}

/** Polite wrappers stripped ("could you please ..."), as Mappy always did. */
export const normalize = normalizeCommand

/**
 * What Mappy actually reads: typos fixed, polite wrappers stripped, then another way of
 * saying a command turned into the usual one ("unhide parcels" to "turn on parcels").
 */
/**
 * How much sense a reading makes: something Mappy can do, aimed at names that are in this
 * app, made of words he knows. Used to choose between readings when a typo is a real word
 * ("lose the legend", "only sow parcels", "turn on tails").
 */
function sense (text: string, lex: Lexicon): number {
  const it = parseIntent(text)
  if (it.name === 'ask') return 0
  const target = String(it.target || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  // A command with nothing to aim at ("zoom in", "list layers") makes full sense.
  if (!target) return 3.5
  let s = 2
  // A target that starts with a little joining word ("open on zoning") was not meant.
  if (/^(on|off|in|out|to|of|at|by|for|up)\b/.test(target)) s -= 1
  const words = target.split(' ').filter(w => w.length > 2)
  // Names in this app and map words support a reading; bare command words do not ("run on all layers").
  if (words.length) s += 1.5 * words.filter(w => { const t = lex.tierOf(w); return t === 1 || t === 2 }).length / words.length
  if (lex.names.has(target) || lex.names.has(target.replace(/ (layer|layers|group|tool|widget)$/, ''))) s += 1
  return s
}

const UNITS: { [w: string]: number } = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS: { [w: string]: number } = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "fifty percent" to "50%", "half" to "50%", "75 percent" to "75%", for opacity and the like. */
export function numbersInWords (text: string): string {
  return text
    .replace(/\b(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](one|two|three|four|five|six|seven|eight|nine))?|(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|(a |one )?hundred)\s*(?:percent|per cent|%)/gi,
      (m, tens, unit, small, hundred) => `${hundred !== undefined && !tens && !small ? 100 : tens ? TENS[tens.toLowerCase()] + (unit ? UNITS[unit.toLowerCase()] : 0) : UNITS[String(small).toLowerCase()]}%`)
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:percent|per cent|pct)\b/gi, '$1%')
    .replace(/\b(?:to\s+)?(?:half|halfway)\s+(?:transparent|see[- ]through|opacity)\b/gi, 'to 50%')
}

function read (input: string, lex: Lexicon): Correction {
  const fixed = correctTypos(input, lex)
  const plain = numbersInWords(normalizeCommand(fixed.text))
  const text = rewritePhrasing(plain)
  return { text, changed: fixed.changed || text !== plain, swaps: fixed.swaps }
}

const QUESTION = /^(how|what|why|who|when|which|can|is|are|do|does|i|a|an|the|in|on|to|of|and|then|all|every)$/i

/**
 * Other sensible readings of a request Mappy could not act on, best first, for a Clippy-style
 * "Did you mean ...?" (each is a request he can do). Empty when nothing makes sense.
 */
export function didYouMean (input: string, lex: Lexicon, max = 2): string[] {
  const src = String(input)
  const first = read(src, lex).text
  const out: Array<{ text: string, score: number }> = []
  for (const m of Array.from(src.matchAll(/\p{L}+/gu)).filter(m => /^[A-Za-z]+$/.test(m[0])).slice(0, 4)) {
    const low = m[0].toLowerCase()
    if (low.length < 2 || QUESTION.test(low)) continue
    const cap = Math.min(1.8, 0.85 + low.length * 0.15)
    for (const alt of lex.closeTo(low, cap, 2)) {
      const text = read(src.slice(0, m.index!) + alt.w + src.slice(m.index! + m[0].length), lex).text
      if (text === first || out.some(o => o.text === text)) continue
      const score = sense(text, lex) - alt.cost * 0.6
      if (score >= 2.5) out.push({ text, score })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map(o => o.text)
}

export function readRequest (input: string, lex: Lexicon): Correction {
  const first = read(input, lex)
  const base = sense(first.text, lex)
  if (base >= 4.5) return first
  // A typo that spells a real word: try the closest known words in the first few word
  // positions (one change at a time) and keep the reading that makes clearly more sense.
  const src = String(input)
  const lockAt = (() => { const m = src.slice(1).match(/\s(?:where|with|equals?|contains|like|between)\s|[=<>"]/i); return m ? m.index! + 1 : src.length })()
  const spots = Array.from(src.matchAll(/\p{L}+/gu)).filter(m => /^[A-Za-z]+$/.test(m[0]) && m.index! < lockAt).slice(0, 5)
  let best = { reading: first, score: base, cost: 0 }
  for (const m of spots) {
    const word = m[0]
    const low = word.toLowerCase()
    if (low.length < 3 || QUESTION.test(low) || (m.index! > 0 && /^[A-Z]/.test(word)) || LEADS.has(low)) continue
    const tier = lex.tierOf(low)
    // Names and map words are meant as typed. A command word is only second-guessed as the
    // first word, and only toward a word requests start with ("run on zoning" to "turn on").
    if (tier === 1 || tier === 2 || (tier === 0 && m.index! > 0)) continue
    for (const alt of lex.closeTo(low, Math.min(1.65, 0.65 + low.length * 0.12), tier === 0 ? 0 : 2)) {
      if (tier === 0 && !LEADS.has(alt.w)) continue
      const retyped = src.slice(0, m.index!) + alt.w + src.slice(m.index! + word.length)
      const r = read(retyped, lex)
      const score = sense(r.text, lex) - alt.cost * 0.6
      if (score > best.score + 0.5 || (score > best.score && best.cost && alt.cost < best.cost)) {
        best = { reading: { text: r.text, changed: true, swaps: [[word, alt.w], ...r.swaps] }, score, cost: alt.cost }
      }
    }
  }
  return best.reading
}
