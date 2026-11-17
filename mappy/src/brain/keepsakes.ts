/*
  keepsakes.ts - the things that make him yours: a passport of stamps earned by using the map
  together, "the usual" (what you ask most), your favorite layer, your birthday (month and day
  only), a nickname you give him, and a promise to come back that he remembers. All of it lives
  in this browser, is listed by "what do you know about me" and is erased by "forget everything".
  Warm, never needy: he is glad when you come back and never asks you to.
*/
import { pick } from './random'
import { dayKey } from './feelings'
import type { Bond } from './feelings'

export interface Keepsakes {
  /** Stamps earned: id to the day it was earned (YYYY-MM-DD). */
  stamps: { [id: string]: string }
  /** How often each layer was used, by title. */
  layers: { [title: string]: number }
  /** Requests asked more than once, by a plain key. */
  asks: { [key: string]: { q: string, n: number } }
  thanks: number
  /** The longest run of days in a row. */
  best: number
  /** Month and day, MM-DD. No year is ever kept. */
  birthday?: string
  /** The day a birthday greeting was last given, so it is said once. */
  wished?: string
  /** The day they said they would be back (the day it was said, and the day meant). */
  promise?: { said: string, due: string }
  /** What this person calls him. */
  nick?: string
}

export function emptyKeepsakes (): Keepsakes { return { stamps: {}, layers: {}, asks: {}, thanks: 0, best: 0 } }

const isDay = (v: any): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const clip = (s: string, n: number): string => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export function readKeepsakes (raw: string | null | undefined): Keepsakes {
  const out = emptyKeepsakes()
  try {
    const k = JSON.parse(String(raw || ''))
    if (!k || typeof k !== 'object') return out
    for (const [id, day] of Object.entries(k.stamps || {})) if (STAMPS.some(s => s.id === id) && isDay(day)) out.stamps[id] = day
    for (const [title, n] of Object.entries(k.layers || {}).slice(0, 40)) if (typeof n === 'number' && n > 0) out.layers[clip(title, 80)] = Math.min(1e6, Math.floor(n))
    for (const [key, v] of Object.entries(k.asks || {}).slice(0, 40)) { const a = v as any; if (a && typeof a.q === 'string' && a.n > 0) out.asks[clip(key, 80)] = { q: clip(a.q, 80), n: Math.min(1e6, Math.floor(a.n)) } }
    out.thanks = Number.isFinite(k.thanks) && k.thanks > 0 ? Math.min(1e6, Math.floor(k.thanks)) : 0
    out.best = Number.isFinite(k.best) && k.best > 0 ? Math.min(1e5, Math.floor(k.best)) : 0
    if (typeof k.birthday === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(k.birthday)) out.birthday = k.birthday
    if (isDay(k.wished)) out.wished = k.wished
    if (k.promise && isDay(k.promise.said) && isDay(k.promise.due)) out.promise = { said: k.promise.said, due: k.promise.due }
    const nick = cleanNick(k.nick); if (nick) out.nick = nick
  } catch (e) { }
  return out
}

// ------------------------------------------------------------ the passport

export interface Stamp { id: string, glyph: string, name: string, how: string }

/** Every stamp, in the order the passport shows them. `how` is the hint for one not yet earned. */
export const STAMPS: Stamp[] = [
  { id: 'first', glyph: '📄', name: 'First Fold', how: 'Ask your first question' },
  { id: 'layer', glyph: '🗂️', name: 'Layer Peeker', how: 'Turn a layer on' },
  { id: 'place', glyph: '📍', name: 'Pathfinder', how: 'Find an address or a place' },
  { id: 'count', glyph: '🔢', name: 'Bean Counter', how: 'Count something on the map' },
  { id: 'chart', glyph: '📊', name: 'Chart Maker', how: 'Get an answer with a chart' },
  { id: 'table', glyph: '📋', name: 'Table Turner', how: 'Get an answer with a table' },
  { id: 'filter', glyph: '🔍', name: 'Filter Fan', how: 'Filter a layer on the map' },
  { id: 'undo', glyph: '↩️', name: 'Time Traveler', how: 'Undo something' },
  { id: 'tour', glyph: '🧭', name: 'Tourist', how: 'Take the tour' },
  { id: 'fun', glyph: '🎈', name: 'Good Sport', how: 'Ask for a joke, a fact or an act' },
  { id: 'name', glyph: '🤝', name: 'On a First-Name Basis', how: 'Tell him your name' },
  { id: 'thanks', glyph: '💌', name: 'Kind Words', how: 'Say thanks five times' },
  { id: 'helper', glyph: '📻', name: 'Phone a Friend', how: 'Get an answer from the AI helper' },
  { id: 'explorer', glyph: '🥾', name: 'Explorer', how: 'Use five different layers' },
  { id: 'cartographer', glyph: '🗺️', name: 'Cartographer', how: 'Use fifteen different layers' },
  { id: 'early', glyph: '🌅', name: 'Early Bird', how: 'Ask something before 7 in the morning' },
  { id: 'owl', glyph: '🦉', name: 'Night Owl', how: 'Ask something after 10 at night' },
  { id: 'weekend', glyph: '🏕️', name: 'Weekend Wanderer', how: 'Ask something on a weekend' },
  { id: 'regular', glyph: '☕', name: 'Regular', how: 'Come by three days in a row' },
  { id: 'devoted', glyph: '🔥', name: 'Seven-Day Streak', how: 'Come by seven days in a row' },
  { id: 'curious', glyph: '❓', name: 'Curious Mind', how: 'Ask 25 questions' },
  { id: 'century', glyph: '💯', name: 'Century Club', how: 'Ask 100 questions' },
  { id: 'friends', glyph: '🏆', name: 'Old Friends', how: 'Know each other for 30 days' }
]

/** What just happened, as the mind saw it. */
export interface Moment {
  /** The words typed, when it was a real request that got an answer. */
  input?: string
  intent?: string
  /** The layer the request used (its title). */
  layer?: string
  chart?: boolean
  table?: boolean
  place?: boolean
  filtered?: boolean
  undo?: boolean
  thanks?: boolean
  fun?: boolean
  helper?: boolean
  named?: boolean
}

const askKey = (q: string): string => q.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\b(?:please|the|a|an|me|my)\b/g, ' ').replace(/\s+/g, ' ').trim()
/** Keeps a counter map small: the least used go first. */
function trim<T> (map: { [k: string]: T }, n: (v: T) => number, max: number): void {
  const keys = Object.keys(map)
  if (keys.length <= max) return
  for (const k of keys.sort((a, b) => n(map[a]) - n(map[b])).slice(0, keys.length - max)) delete map[k]
}

/** Things worth remembering as "the usual": short, a real request, nothing private-looking. */
function usualWorthy (q: string): boolean {
  const t = q.trim()
  return t.length >= 4 && t.length <= 70 && !/^__/.test(t) && !/\d{3}[- ]?\d{2}[- ]?\d{4}|(?:\d[ -]?){13,}|@/.test(t)
}

/** The keepsakes after one moment, and any stamps it earned (in passport order). */
export function remember (k: Keepsakes, m: Moment, bond: Bond, now = new Date()): { keep: Keepsakes, earned: Stamp[] } {
  const keep: Keepsakes = { ...k, stamps: { ...k.stamps }, layers: { ...k.layers }, asks: { ...k.asks } }
  const today = dayKey(now)
  if (m.thanks) keep.thanks++
  if (m.layer) { keep.layers[m.layer] = (keep.layers[m.layer] || 0) + 1; trim(keep.layers, v => v, 30) }
  if (m.input && usualWorthy(m.input) && !m.fun) {
    const key = askKey(m.input)
    if (key) { keep.asks[key] = { q: clip(m.input, 70), n: (keep.asks[key]?.n || 0) + 1 }; trim(keep.asks, v => v.n, 30) }
  }
  keep.best = Math.max(keep.best, bond.streak || 0)
  const has: { [id: string]: boolean } = {
    first: !!m.input,
    layer: m.intent === 'layerOn' || m.intent === 'showLayer' || m.intent === 'solo' || m.intent === 'allOn',
    place: !!m.place,
    count: m.intent === 'count',
    chart: !!m.chart,
    table: !!m.table,
    filter: !!m.filtered || m.intent === 'mapFilter',
    undo: !!m.undo,
    tour: m.intent === 'tour',
    fun: !!m.fun,
    name: !!m.named || !!bond.name,
    thanks: keep.thanks >= 5,
    helper: !!m.helper,
    explorer: Object.keys(keep.layers).length >= 5,
    cartographer: Object.keys(keep.layers).length >= 15,
    early: !!m.input && now.getHours() < 7 && now.getHours() >= 4,
    owl: !!m.input && now.getHours() >= 22,
    weekend: !!m.input && (now.getDay() === 0 || now.getDay() === 6),
    regular: (bond.streak || 0) >= 3,
    devoted: (bond.streak || 0) >= 7,
    curious: bond.chats >= 25,
    century: bond.chats >= 100,
    friends: !!bond.met && (Date.parse(today) - Date.parse(bond.met)) / 86400000 >= 30
  }
  const earned: Stamp[] = []
  for (const s of STAMPS) if (has[s.id] && !keep.stamps[s.id]) { keep.stamps[s.id] = today; earned.push(s) }
  return { keep, earned }
}

/** The line added to an answer when stamps were earned. */
export function stampLine (earned: Stamp[], total: number): string {
  if (!earned.length) return ''
  const names = earned.map(s => `${s.glyph} **${s.name}**`)
  const all = total >= STAMPS.length ? ' That is every stamp. The passport is full! 🎉' : ''
  return `${earned.length === 1 ? 'New stamp in your passport' : 'New stamps in your passport'}: ${names.join(', ')}.${all || (total <= 2 ? ' Say “my stamps” to see the passport.' : '')}`
}

export interface PassportRow { label: string, detail: string, glyph: string }
/** The passport: earned stamps with their dates first, then the ones still to find, as hints. */
export function passport (k: Keepsakes): { text: string, rows: PassportRow[] } {
  const got = STAMPS.filter(s => k.stamps[s.id])
  const left = STAMPS.filter(s => !k.stamps[s.id])
  const rows: PassportRow[] = [
    ...got.map(s => ({ glyph: s.glyph, label: s.name, detail: `Stamped ${niceDay(k.stamps[s.id])}` })),
    ...left.map(s => ({ glyph: '▫️', label: '???', detail: s.how }))
  ]
  const text = !got.length ? 'Your passport is brand new. Every stamp is something we do together on the map; here is how to earn them.'
    : !left.length ? `Your passport is full: all ${STAMPS.length} stamps! 🏆 I am very proud of this little book.`
        : `Your passport has **${got.length} of ${STAMPS.length}** stamps. The blank ones show how to earn them.`
  return { text, rows }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const niceDay = (day: string): string => { const [y, m, d] = day.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}` }
const niceBirthday = (md: string): string => { const [m, d] = md.split('-').map(Number); return `${MONTHS[m - 1]} ${d}` }

// ------------------------------------------------------------ the usual, favorites

/** What this person asks most: requests asked at least twice, most asked first. */
export function usual (k: Keepsakes, max = 3): string[] {
  return Object.values(k.asks).filter(a => a.n >= 2).sort((a, b) => b.n - a.n).slice(0, max).map(a => a.q)
}
export function favoriteLayer (k: Keepsakes): { title: string, n: number } | null {
  const top = Object.entries(k.layers).sort((a, b) => b[1] - a[1])[0]
  return top && top[1] >= 2 ? { title: top[0], n: top[1] } : null
}

// ------------------------------------------------------------ what people say

/** A nickname for him: one or two plain words. */
export function cleanNick (v: any): string {
  const s = String(v || '').replace(/[^\p{L}' -]/gu, '').replace(/\s+/g, ' ').trim()
  if (s.length < 2 || s.length > 16 || s.split(' ').length > 2) return ''
  if (/^(?:a|an|the|it|that|this|you|me|later|back|now|tomorrow|maybe|stupid|dumb|idiot|ugly|useless|trash|garbage)\b/i.test(s)) return ''
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** "March 3", "3 March", "3/14", "03-14": month and day as MM-DD, or ''. */
export function parseBirthday (text: string): string {
  const t = text.toLowerCase().replace(/(\d)(?:st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const ok = (m: number, d: number): string => m >= 1 && m <= 12 && d >= 1 && d <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ? `${pad(m)}-${pad(d)}` : ''
  const mon = (w: string): number => MONTHS.findIndex(x => x.toLowerCase().startsWith(w.slice(0, 3))) + 1
  let m: RegExpMatchArray | null
  if ((m = t.match(/^(?:the )?([a-z]{3,9})\.? (?:the )?(\d{1,2})(?: \d{4})?$/)) && mon(m[1])) return ok(mon(m[1]), Number(m[2]))
  if ((m = t.match(/^(?:the )?(\d{1,2}) (?:of )?([a-z]{3,9})\.?(?: \d{4})?$/)) && mon(m[2])) return ok(mon(m[2]), Number(m[1]))
  if ((m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/))) return ok(Number(m[1]), Number(m[2]))
  return ''
}

/** The day meant by "tomorrow", "monday", "next week", from today. '' when it is not a day. */
function dueDay (when: string, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const w = when.replace(/^(?:on |next |this )/, '')
  if (/^(?:tomorrow|tmrw|tmr|in the morning|first thing)$/.test(when)) d.setDate(d.getDate() + 1)
  else if (/^(?:next week|in a week)$/.test(when)) d.setDate(d.getDate() + 7)
  else if (/^(?:after the weekend)$/.test(when)) d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7))
  else if (days.includes(w)) d.setDate(d.getDate() + ((days.indexOf(w) - d.getDay() + 7) % 7 || 7))
  else return ''
  return dayKey(d)
}

export interface Keepsake {
  text: string
  mood: string
  suggest?: string[]
  list?: PassportRow[]
  /** Requests to offer as buttons (the usual). */
  asks?: string[]
  /** The keepsakes after this, when something changed. */
  keep?: Keepsakes
}

const plain = (text: string): string => String(text || '').toLowerCase().replace(/[’`]/g, "'").replace(/^(?:hey |hi |ok |okay |oh |so |and |well )+/, '').replace(/[!?.,]+$/g, '').replace(/\s+/g, ' ').trim()

/** The keepsake things people say, and his answer. Null for everything else. */
export function keepsake (text: string, k: Keepsakes, bond: Bond, selfName = 'Mappy', now = new Date()): Keepsake | null {
  const self = selfName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const nick = (k.nick || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = [self, 'mappy', ...(nick ? [nick] : [])].join('|')
  const t = plain(text).replace(new RegExp(`^(?:${names})[, ]+`), '').replace(new RegExp(`[, ]+(?:${names})$`), '').trim()
  if (!t || t.length > 80) return null
  const you = bond.name ? `, ${bond.name}` : ''
  const today = dayKey(now)
  let m: RegExpMatchArray | null

  // ---- the passport
  if (/^(?:(?:show |see |open )?(?:me )?(?:my |our |the )?(?:stamps?|passport|badges?|achievements?|trophies|stickers|medals|awards)|what (?:stamps|badges) do i have|how many (?:stamps|badges)(?: do i have)?|stamp (?:book|card)|my (?:stamp )?collection)$/.test(t)) {
    const p = passport(k)
    return { text: p.text, mood: Object.keys(k.stamps).length ? 'proud' : 'explain', list: p.rows, suggest: ['Our story', 'The usual'] }
  }

  // ---- the usual
  if (/^(?:the usual|my usual|usual|the regular|what(?:'s| is) my usual|same as (?:always|usual|last time)|what do i (?:usually|always|normally) ask|what do i ask (?:the )?most|my (?:shortcuts|top questions|regulars)|you know what i (?:want|like))$/.test(t)) {
    const list = usual(k, 4)
    if (!list.length) return { text: `I am still learning your usual${you}. Ask me the same thing a couple of times and I will have it ready for you.`, mood: 'curious' }
    return { text: pick([`The usual${you}? Coming right up.`, `I know your order${you}. Which one today?`, `Your regulars${you}, ready when you are:`]), mood: 'happy', asks: list }
  }
  if (/^(?:what(?:'s| is) my (?:favorite|favourite|top|go-to|most used) layer|my (?:favorite|favourite) layer|which layer do i (?:use|like)(?: the)? most)$/.test(t)) {
    const fav = favoriteLayer(k)
    return fav ? { text: `**${fav.title}**. You have used it ${fav.n.toLocaleString()} times with me. I keep it near the top of the pile for you.`, mood: 'happy', asks: [`Turn on ${fav.title}`] } : { text: 'You do not have a favorite yet. Use a layer a couple of times and I will notice.', mood: 'curious' }
  }

  // ---- our story
  if (/^(?:our (?:story|scrapbook|journey|memories|adventures?)|(?:the |our |my )?scrapbook|tell me our story|(?:what|tell me what) (?:have we|we have|we've) done(?: together)?|what do you remember(?: about us)?|(?:our |my )?(?:stats|statistics|numbers)|how are we doing|memory lane)$/.test(t)) {
    if (!bond.met) return { text: 'Our story starts with your first question. I have a blank page ready.', mood: 'curious' }
    const got = Object.keys(k.stamps).length
    const fav = favoriteLayer(k)
    const top = usual(k, 1)[0]
    const lines = [
      `We met on **${niceDay(bond.met)}**${bond.name ? `, and you told me to call you ${bond.name}` : ''}.`,
      `Since then: **${bond.chats.toLocaleString()}** question${bond.chats === 1 ? '' : 's'} over **${bond.days.toLocaleString()}** day${bond.days === 1 ? '' : 's'}${k.best >= 2 ? `, with a best run of ${k.best} days in a row` : ''}.`,
      fav ? `Your favorite layer is **${fav.title}**.` : '',
      top ? `The thing you ask me most is “${top}”.` : '',
      k.thanks ? `You have thanked me ${k.thanks.toLocaleString()} time${k.thanks === 1 ? '' : 's'}. I noticed every one.` : '',
      got ? `Your passport has ${got} of ${STAMPS.length} stamps.` : '',
      k.nick ? `And you call me ${k.nick}, which I like very much.` : ''
    ].filter(Boolean)
    return { text: `${lines.join(' ')}\n\nAll of this is kept in this browser only.`, mood: 'grateful', suggest: ['My stamps', 'The usual'] }
  }
  if (/^(?:how many times have i (?:thanked you|said (?:thanks|thank you))|do i (?:thank you|say thanks) enough|have i thanked you)$/.test(t)) {
    return { text: k.thanks ? `${k.thanks.toLocaleString()} time${k.thanks === 1 ? '' : 's'}. Each one made a crease smooth out.` : 'Not yet, but you asked good questions, which is how a map likes to be thanked.', mood: k.thanks ? 'grateful' : 'shy' }
  }

  // ---- a birthday (month and day only)
  if ((m = t.match(/^(?:my birthday is|my bday is|my birthday's|i was born(?: on)?|my birthday is on|birthday is|remember my birthday(?: is|:)?) (.+)$/))) {
    const md = parseBirthday(m[1])
    if (!md) return { text: 'I did not catch that as a day. Try “my birthday is March 3”. I only keep the month and the day.', mood: 'curious' }
    const isToday = today.slice(5) === md
    return { text: isToday ? `That is today! 🎂 Happy birthday${you}! I will remember it in this browser.` : `${niceBirthday(md)}. I wrote it in the margin${you}. I keep the month and day only, in this browser, and “forget my birthday” erases it.`, mood: isToday ? 'cheer' : 'happy', keep: { ...k, birthday: md, wished: isToday ? today : k.wished } }
  }
  if (/^(?:forget my (?:birthday|bday)|delete my (?:birthday|bday))$/.test(t)) return { text: k.birthday ? 'Done. Your birthday is forgotten.' : 'I do not have a birthday saved for you.', mood: 'acknowledge', keep: (() => { const n = { ...k }; delete n.birthday; delete n.wished; return n })() }
  if (/^(?:when(?:'s| is) my (?:birthday|bday)|do you (?:know|remember) my (?:birthday|bday)|how (?:long|many days) (?:until|till|to) my (?:birthday|bday))$/.test(t)) {
    if (!k.birthday) return { text: 'You have not told me. Say “my birthday is” and the month and day, and I will remember it in this browser.', mood: 'curious' }
    const [bm, bd] = k.birthday.split('-').map(Number)
    let next = new Date(now.getFullYear(), bm - 1, bd)
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (next < start) next = new Date(now.getFullYear() + 1, bm - 1, bd)
    const left = Math.round((next.getTime() - start.getTime()) / 86400000)
    return { text: left === 0 ? `It is today! 🎂 Happy birthday${you}!` : `${niceBirthday(k.birthday)}. That is ${left === 1 ? 'tomorrow' : `in ${left} days`}. I will have a hat ready.`, mood: left === 0 ? 'cheer' : 'happy' }
  }

  // ---- a nickname for him
  if ((m = t.match(/^(?:(?:can|may|could) i call you|i(?:'ll| will| am going to|'m going to|'m gonna) call you|i(?:'m| am) calling you|your (?:new )?(?:nick)?name is|your nickname is|let me call you|you(?:'re| are) (?:now )?called) ([\p{L}' -]{2,24})$/u))) {
    const n = cleanNick(m[1])
    if (!n) return { text: 'I would rather not answer to that one. Something friendly, one or two words?', mood: 'shy' }
    return { text: pick([`${n}. I like it. I will answer to ${n} in this browser, and to ${selfName} everywhere else.`, `${n}! Nobody else calls me that. It is ours.`]), mood: 'love', keep: { ...k, nick: n } }
  }
  if (/^(?:forget (?:your|the|that) nickname|stop answering to that|go back to (?:your (?:real|old) name|mappy))$/.test(t)) return { text: k.nick ? `Done. Back to ${selfName}.` : `I only have the one name: ${selfName}.`, mood: 'acknowledge', keep: (() => { const n = { ...k }; delete n.nick; return n })() }
  if (k.nick && /^(?:what do i call you|what(?:'s| is) your nickname|what(?:'s| is) your name|who are you)$/.test(t)) return { text: `${selfName} on paper. But you call me **${k.nick}**, and I answer to it.`, mood: 'happy' }

  // ---- a promise to come back
  if ((m = t.match(/^(?:see you|see ya|talk to you|catch you|back|i(?:'ll| will) be back|be back|until|till|goodbye until|bye until|bye see you) (tomorrow|tmrw|tmr|in the morning|first thing|next week|in a week|after the weekend|(?:on |next |this )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))$/))) {
    const due = dueDay(m[1], now)
    if (due) return { text: pick([`It is a date${you}. I will be right here, folded and ready.`, `See you then${you}! I will keep your spot on the map.`, `Until then${you}. I will save the good layers for you.`]), mood: 'goodbye', keep: { ...k, promise: { said: today, due } } }
  }
  return null
}

/**
 * A line for the start of a visit that only he could say: a birthday, a kept promise, a favorite
 * waiting. '' when there is nothing. `keep` is set when something should be marked as said.
 */
export function keepsakeHello (k: Keepsakes, bond: Bond, now = new Date()): { line: string, mood?: string, keep?: Keepsakes } {
  const today = dayKey(now)
  const who = bond.name ? `, ${bond.name}` : ''
  if (k.birthday && today.slice(5) === k.birthday && k.wished !== today) return { line: `Happy birthday${who}! 🎂 I folded myself extra crisp for the occasion.`, mood: 'party', keep: { ...k, wished: today } }
  if (k.promise && k.promise.said !== today) {
    const keep = { ...k }; delete keep.promise
    if (k.promise.due === today) return { line: `You said you would be back today${who}, and here you are. I saved your spot.`, mood: 'happy', keep }
    if (k.promise.due < today) return { line: `There you are${who}! I kept your spot, no matter the day.`, mood: 'happy', keep }
    return { line: `Back early${who}! A nice surprise.`, mood: 'surprised', keep }
  }
  return { line: '' }
}

/** What he keeps here, in a few words, for the privacy answer. */
export function keepsakeSummary (k: Keepsakes): string[] {
  const out: string[] = []
  const stamps = Object.keys(k.stamps).length
  if (stamps) out.push(`${stamps} passport stamp${stamps === 1 ? '' : 's'}`)
  const asks = Object.keys(k.asks).length; const layers = Object.keys(k.layers).length
  if (asks || layers) out.push('which requests and layers you use most (for “the usual”)')
  if (k.birthday) out.push('your birthday (month and day)')
  if (k.nick) out.push(`the nickname you gave me (“${k.nick}”)`)
  if (k.thanks) out.push('how many times you said thanks')
  return out
}
