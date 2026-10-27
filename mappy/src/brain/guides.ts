/*
  guides.ts - reads help guides (HTML or Markdown) into sections Mappy can answer from:
  one fact per heading, long sections split at sentence boundaries, each pointing back to
  the page (and the heading's anchor when it has one). Uses the browser's DOMParser for HTML.
*/
import type { Doc } from './types'
import { clip, hash, stripHtml } from './text'

export interface GuideSection { heading: string, anchor?: string, text: string, level: number }

const MAX_CHUNK = 900

/** HTML page to sections by h1-h4 (falls back to the whole body when it has no headings). */
export function htmlSections (html: string): { title: string, sections: GuideSection[] } {
  let doc: Document | null = null
  try { doc = new DOMParser().parseFromString(html, 'text/html') } catch (e) { doc = null }
  if (!doc) return { title: '', sections: [{ heading: 'Guide', text: stripHtml(html), level: 1 }] }
  doc.querySelectorAll('script, style, noscript, nav, header nav, footer, svg, iframe, form, button').forEach(n => n.remove())
  const title = (doc.querySelector('title')?.textContent || doc.querySelector('h1')?.textContent || '').trim()
  const body = doc.body
  if (!body) return { title, sections: [] }
  const sections: GuideSection[] = []
  let cur: GuideSection = { heading: title || 'Overview', text: '', level: 1 }
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT)
  const blocks = new Set(['P', 'LI', 'TD', 'TH', 'DT', 'DD', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION', 'SUMMARY'])
  let node = walker.nextNode() as HTMLElement | null
  while (node) {
    const tag = node.tagName
    if (/^H[1-4]$/.test(tag)) {
      if (cur.text.trim()) sections.push(cur)
      const anchor = node.id || (node.querySelector('[id]') as HTMLElement | null)?.id || (node.closest('section[id]') as HTMLElement | null)?.id || undefined
      cur = { heading: (node.textContent || '').replace(/\s+/g, ' ').trim(), anchor, text: '', level: Number(tag[1]) }
    } else if (blocks.has(tag) && !node.closest('li li, td td')) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (t && !(tag === 'LI' && node.querySelector('p'))) cur.text += t + (/[.!?:]$/.test(t) ? ' ' : '. ')
    }
    node = walker.nextNode() as HTMLElement | null
  }
  if (cur.text.trim()) sections.push(cur)
  if (!sections.length) sections.push({ heading: title || 'Guide', text: (body.textContent || '').replace(/\s+/g, ' ').trim(), level: 1 })
  return { title, sections }
}

/** Markdown to sections by #-headings. */
export function mdSections (md: string): GuideSection[] {
  const lines = String(md || '').replace(/\r/g, '').split('\n')
  const out: GuideSection[] = []
  let cur: GuideSection = { heading: 'Overview', text: '', level: 1 }
  let inCode = false
  for (const line of lines) {
    if (/^```/.test(line)) { inCode = !inCode; continue }
    if (inCode) continue
    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*$/)
    if (h) {
      if (cur.text.trim()) out.push(cur)
      cur = { heading: h[2].replace(/`/g, ''), level: h[1].length, text: '' }
      continue
    }
    cur.text += line + '\n'
  }
  if (cur.text.trim()) out.push(cur)
  return out.map(s => ({ ...s, text: stripMd(s.text) }))
}

export function stripMd (s: string): string {
  return stripHtml(String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_`>#]+/g, ' ')
    .replace(/\|/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function chunk (text: string, max = MAX_CHUNK): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  const parts = text.split(/(?<=[.!?])\s+/)
  let cur = ''
  for (const s of parts) {
    if ((cur + ' ' + s).length > max && cur) { out.push(cur.trim()); cur = '' }
    cur += ' ' + s
  }
  if (cur.trim()) out.push(clip(cur.trim(), max))
  return out
}

/** Guide sections to facts. `url` gets the heading anchor appended when there is one. */
export function guideDocs (source: string, pageTitle: string, sections: GuideSection[], url: string | undefined, src: Doc['src'], idPrefix: string, maxDocs = 60): Doc[] {
  const docs: Doc[] = []
  for (const s of sections) {
    if (s.text.length < 25) continue
    const parts = chunk(s.text)
    parts.slice(0, 4).forEach((p, i) => {
      if (docs.length >= maxDocs) return
      const title = s.heading && s.heading !== pageTitle ? `${pageTitle || source}: ${s.heading}` : (pageTitle || source)
      docs.push({
        id: `${idPrefix}:${hash(source + s.heading + i)}`,
        kind: 'guide',
        title: parts.length > 1 ? `${title} (${i + 1})` : title,
        text: p,
        keys: `${source} ${pageTitle} help guide how to`,
        actions: url ? [{ type: 'url', url: s.anchor ? `${url.split('#')[0]}#${s.anchor}` : url, label: 'Open the guide' }] : undefined,
        src,
        boost: 1.1
      })
    })
  }
  return docs
}
