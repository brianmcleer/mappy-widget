/*
  answer.ts - turns retrieval hits into a reply: a short sentence or two, where the thing
  lives, and buttons for what Mappy can do about it. Pure TypeScript, so the settings panel
  can preview exactly what users will see.
*/
import type { Doc, MappyAction, SearchHit } from './types'
import type { MappyIndex } from './engine'
import { clip } from './text'
import { V } from './voice'

export interface Reply {
  text: string
  sources?: Array<{ title: string, detail: string }>
  table?: { columns: string[], rows: string[][], rowActions?: Array<MappyAction | undefined> }
  /** A picture from an MCP tool (a static map), as a data: or https: address. */
  image?: { src: string, alt: string }
  page?: { offset: number, size: number, hasNext: boolean }
  actions?: MappyAction[]
  /** Follow-up suggestions shown as chips. */
  suggest?: string[]
  mood?: 'happy' | 'think' | 'confused' | 'wave' | 'search' | 'celebrate' | 'sleep' | 'talk' | 'point' | 'pleased' | 'acknowledge' | 'attention' | 'love' | 'excited' | 'dance' | 'roll' | 'dizzy' | 'party'
    // the Clippy pack (runtime/components/Acts.tsx)
    | 'processing' | 'writing' | 'checking' | 'alert' | 'explain' | 'knock' | 'print' | 'trash' | 'mail' | 'save' | 'artsy' | 'techy' | 'wizardy' | 'airplane' | 'bike' | 'congratulate' | 'goodbye'
    // the second pack: map life
    // feelings (brain/feelings.ts)
    | 'sorry' | 'sad' | 'shy' | 'proud' | 'surprised' | 'laugh' | 'hug' | 'grateful' | 'cheer' | 'sleepy' | 'curious'
    | 'calling' | 'camera' | 'route' | 'pindrop' | 'measure' | 'chart' | 'idea' | 'layers' | 'treasure' | 'boat' | 'kite' | 'juggle' | 'coffee'
  /** A keepsake picture: the passport page or a postcard. */
  keepsake?: import('./keepsakes').KeepsakeCard
  /** A small bar chart of the table (labels and numbers), drawn by the chat. */
  chart?: { title?: string, rows: Array<{ label: string, value: number }>, unit?: string }
  /** A small muted line under the answer ("AI answer. Check anything important."). */
  note?: string
  /** Thumbs up and down under an AI answer: the requests each one sends. */
  rate?: { up: string, down: string }
  /** Feature search results, filled by the runtime. */
  results?: any[]
  list?: ListRow[]
  /** Element Mappy should point at while saying this (a widget, the layer list, the map). */
  pointAt?: HTMLElement | null
  /** The answer is a page found in the app's own help or layer list, not something worked out from the data. */
  lookedUp?: boolean
  /** A small file the person can save with one click (the questions he missed, as a CSV). */
  save?: { name: string, text: string, type: string, label: string }
  /** Something the widget itself should do: pause or resume motion, speak, resize or move Mappy. */
  effect?: 'pause' | 'resume' | 'speak' | 'smaller' | 'bigger' | 'left' | 'right' | 'otherCorner' | 'copy' | 'export' | 'quietTips' | 'forgetAll'
}

/** One clickable row in a reply. `glyph` is decorative; `sr` is what a screen reader hears instead. */
export interface ListRow {
  label: string
  action?: MappyAction
  glyph?: string
  sr?: string
  indent?: number
  detail?: string
}

const KIND_WORD: { [k: string]: string } = {
  widget: 'tool', page: 'page', view: 'view', dialog: 'window', layer: 'layer', table: 'table',
  link: 'link', text: 'note', guide: 'guide', domain: 'list of values', faq: 'answer', note: 'note',
  doc: 'help topic', bookmark: 'bookmark', datasource: 'data source', app: 'app', item: 'item'
}

/** One doc to a short spoken answer. */
export function describeDoc (d: Doc): string {
  const body = clip(d.text || '', d.kind === 'faq' || d.kind === 'note' || d.kind === 'doc' || d.kind === 'domain' ? 700 : 320)
  if (d.kind === 'faq' || d.kind === 'note' || d.kind === 'doc') return body
  if (d.kind === 'domain') return body
  if (d.kind === 'link') return `${d.title}. ${body}`
  const lead = d.kind === 'widget' ? `**${d.title}** is a tool in this app.` : `**${d.title}** (${KIND_WORD[d.kind] || d.kind}).`
  const where = d.where ? ` You'll find it ${d.where}.` : ''
  return `${lead} ${body}${where}`.replace(/\s+/g, ' ').trim()
}

const SMALL = new Set('a an the is are was were do does did how what where when who why which can could i you we my our your this that it its to of in on at for with and or me show tell about there any some be has have not no'.split(' '))
const contentWords = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !SMALL.has(w)).map(w => w.length > 3 ? w.replace(/ies$/, 'y').replace(/(?:es|s|ing|ed)$/, '') : w)

/**
 * An answer the app's author wrote fits a question when the question shares a word with the
 * author's own question, or two with the answer. One stray word in the answer ("every street,
 * owner and hydrant is invented") does not make it the answer to "hydrants in service".
 */
export function authorAnswerFits (q: string, d: Doc): boolean {
  const asked = Array.from(new Set(contentWords(q)))
  if (!asked.length) return true
  const title = new Set(contentWords(`${d.title || ''} ${(d as any).keys || ''}`))
  if (asked.some(w => title.has(w))) return true
  const body = new Set(contentWords(d.text || ''))
  return asked.filter(w => body.has(w)).length >= 2
}

export function answerQuestion (ix: MappyIndex, q: string): Reply {
  const hits = ix.search(q, { limit: 6 }).filter(h => !['faq', 'note'].includes(h.doc.kind as string) || authorAnswerFits(q, h.doc))
  if (!hits.length) return { text: V.notFound(q), mood: 'confused', suggest: ['What can you do?', 'List the tools', 'List the layers'] }
  const top = hits[0]
  const second = hits[1]
  const confident = !second || top.score > second.score * 1.35 || top.score >= 6
  if (!confident && top.score < 2.5) return { text: V.notFound(q), mood: 'confused', list: hits.slice(0, 3).map(h => toListItem(h)), suggest: ['What can you do?', 'List the tools'] }
  if (confident) {
    const extra = top.doc.kind === 'widget' ? howToFor(ix, top.doc) : null
    return {
      text: extra ? `**${top.doc.title}** is a tool in this app. ${clip(extra.text, 700)}${top.doc.where ? ` You'll find it ${top.doc.where}.` : ''}` : describeDoc(top.doc),
      actions: [...(top.doc.actions || []), ...(extra?.actions || []).filter(a => a.type !== 'openWidget')].slice(0, 4),
      mood: 'talk',
      lookedUp: true,
      sources: [top.doc, ...(extra ? [extra] : [])].map(d => ({ title: d.title, detail: ({ live: 'Live app or map', scan: 'Saved deep scan', folder: 'Imported help', admin: 'App author', builtin: 'Built-in guide' } as any)[d.src || 'live'] })),
      list: hits.slice(1, 4).filter(h => h.score > top.score * 0.45).map(h => toListItem(h))
    }
  }
  // One or two words that only brush against a few help topics: say so, with a way forward, instead of a list of guesses.
  const words = q.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 2 && top.score < 5) {
    return {
      text: `I'm not sure what you mean by **${q.trim()}**. Ask it as a question or a request and I'll do my best: "where is ...", "turn on ...", "what is ...", "closest ... to ...".`,
      mood: 'confused',
      list: hits.slice(0, 2).filter(h => h.score >= top.score * 0.7).map(h => toListItem(h)),
      suggest: ['What can you do?', `What is ${words.join(' ')}?`, 'Tell me a fun fact']
    }
  }
  return {
    text: V.unsure(),
    mood: 'think',
    list: hits.slice(0, 5).filter(h => h.score >= top.score * 0.5).map(h => toListItem(h))
  }
}

/** The ArcGIS documentation (or folder-scan help) for the same widget, to answer "how do I..." in full. */
function howToFor (ix: MappyIndex, w: Doc): Doc | null {
  const ids = new Set((w.actions || []).flatMap(a => a.ids || []))
  if (!ids.size) return null
  const shares = (d: Doc) => (d.actions || []).some(a => (a.ids || []).some(id => ids.has(id)))
  return ix.docs.find(d => /^esri:.*:about$/.test(d.id) && shares(d)) ||
    ix.docs.find(d => d.src === 'folder' && d.kind === 'doc' && /start here|how to|usage|using/i.test(d.title) && shares(d)) ||
    null
}

function toListItem (h: SearchHit): ListRow {
  const d = h.doc
  return { label: `${d.title} (${KIND_WORD[d.kind] || d.kind})`, action: { type: 'ask', q: '__doc:' + d.id, label: d.title } }
}
