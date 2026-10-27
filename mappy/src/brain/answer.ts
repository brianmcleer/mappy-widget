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
  table?: { columns: string[], rows: string[][] }
  page?: { offset: number, size: number, hasNext: boolean }
  actions?: MappyAction[]
  /** Follow-up suggestions shown as chips. */
  suggest?: string[]
  mood?: 'happy' | 'think' | 'confused' | 'wave' | 'search' | 'celebrate' | 'sleep' | 'talk' | 'point' | 'pleased' | 'acknowledge' | 'attention'
  /** Feature search results, filled by the runtime. */
  results?: any[]
  list?: ListRow[]
  /** Element Mappy should point at while saying this (a widget, the layer list, the map). */
  pointAt?: HTMLElement | null
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

export function answerQuestion (ix: MappyIndex, q: string): Reply {
  const hits = ix.search(q, { limit: 6 })
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
      sources: [top.doc, ...(extra ? [extra] : [])].map(d => ({ title: d.title, detail: ({ live: 'Live app or map', scan: 'Saved deep scan', folder: 'Imported help', admin: 'App author', builtin: 'Built-in guide' } as any)[d.src || 'live'] })),
      list: hits.slice(1, 4).filter(h => h.score > top.score * 0.45).map(h => toListItem(h))
    }
  }
  return {
    text: V.unsure(),
    mood: 'think',
    list: hits.slice(0, 5).map(h => toListItem(h))
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
