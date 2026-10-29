/*
  feed.ts - the knowledge feed: one JSON file the widget fetches at runtime so Mappy keeps
  getting better without an app update. It carries the language pack (words, phrasings,
  misspellings), questions and answers, glossary terms, fun facts and tips. The GitHub
  Action rebuilds the project's feed every week; a builder can point at their own copy
  (an internal web folder) or turn the feed off.

  Everything here is pure text checking, so it can be tested without a browser: a feed
  that fails a check is ignored and the bundled knowledge stays in use.
*/
import type { Doc } from './types'
import type { FaqEntry } from './admin'
import type { Term } from './glossary'
import { stripTags } from './text'

export interface KnowledgeFeed {
  format: 1
  /** "2026.10.29" or "2026.10.29.2": compared part by part, as numbers. */
  version: string
  /** A language pack (language.ts), applied when newer than the one in use. */
  languagePack?: any
  faq: FaqEntry[]
  glossary: Term[]
  facts: string[]
  tips: string[]
  /** One line about where it came from, shown in settings. */
  about?: string
}

export const FEED_FORMAT = 1
/** The project's own feed, rebuilt weekly by the GitHub Action. */
export const DEFAULT_FEED_URL = 'https://raw.githubusercontent.com/brianmcleer/mappy-widget/master/knowledge/feed.json'
/** Feeds bigger than this are ignored before parsing. */
export const FEED_MAX_BYTES = 2 * 1024 * 1024
const LIMITS = { faq: 500, glossary: 500, facts: 300, tips: 100 }

const line = (v: any, max: number): string => stripTags(String(v ?? '')).replace(/\s+/g, ' ').trim().slice(0, max)
const safeUrl = (u: any): string | undefined => { const s = String(u || '').trim(); return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 500 ? s : undefined }

/** A feed from any JSON, or null when it is not one. Bad entries are dropped, not the whole feed. */
export function cleanFeed (raw: any): KnowledgeFeed | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (Number(raw.format) !== FEED_FORMAT) return null
  const version = String(raw.version || '').trim()
  if (!/^\d{4}(?:\.\d{1,3}){1,4}$/.test(version)) return null
  const faq: FaqEntry[] = []
  for (const f of Array.isArray(raw.faq) ? raw.faq.slice(0, LIMITS.faq) : []) {
    const q = line(f?.q, 300); const a = line(f?.a, 2000)
    if (q.length >= 3 && a.length >= 2) faq.push({ q, a, url: safeUrl(f?.url) })
  }
  const glossary: Term[] = []
  for (const t of Array.isArray(raw.glossary) ? raw.glossary.slice(0, LIMITS.glossary) : []) {
    const term = line(t?.term, 80).toLowerCase(); const text = line(t?.text, 600)
    if (term.length >= 2 && text.length >= 10) {
      const aliases = (Array.isArray(t?.aliases) ? t.aliases : []).map((x: any) => line(x, 80).toLowerCase()).filter((x: string) => x.length >= 2).slice(0, 8)
      glossary.push({ term, text, aliases: aliases.length ? aliases : undefined })
    }
  }
  const strings = (key: 'facts' | 'tips', max: number): string[] => (Array.isArray(raw[key]) ? raw[key].slice(0, LIMITS[key]) : []).map((x: any) => line(x, max)).filter((x: string) => x.length >= 10)
  const languagePack = raw.languagePack && typeof raw.languagePack === 'object' && !Array.isArray(raw.languagePack) ? raw.languagePack : undefined
  return { format: 1, version, languagePack, faq, glossary, facts: strings('facts', 400), tips: strings('tips', 300), about: raw.about ? line(raw.about, 200) : undefined }
}

/** The feed's questions, answers and tips as index documents. The app author's own FAQ still outranks them. */
export function feedDocs (feed: KnowledgeFeed | null): Doc[] {
  if (!feed) return []
  const docs: Doc[] = []
  feed.faq.forEach((f, i) => docs.push({ id: `feed:faq:${i}`, kind: 'faq', title: f.q, text: f.a, keys: f.q, actions: f.url ? [{ type: 'url', url: f.url, label: 'Open link' }] : undefined, src: 'builtin', boost: 1.2 }))
  feed.tips.forEach((t, i) => docs.push({ id: `feed:tip:${i}`, kind: 'guide', title: 'Tip', text: t, src: 'builtin' }))
  return docs
}

/** What a feed holds, for settings and diagnostics: "412 words, 18 answers, 9 terms, 40 facts". */
export function describeFeed (feed: KnowledgeFeed | null): string {
  if (!feed) return 'no feed'
  const parts: string[] = []
  if (feed.languagePack?.version) parts.push(`language pack ${feed.languagePack.version}`)
  if (feed.faq.length) parts.push(`${feed.faq.length} answer${feed.faq.length === 1 ? '' : 's'}`)
  if (feed.glossary.length) parts.push(`${feed.glossary.length} term${feed.glossary.length === 1 ? '' : 's'}`)
  if (feed.facts.length) parts.push(`${feed.facts.length} fact${feed.facts.length === 1 ? '' : 's'}`)
  if (feed.tips.length) parts.push(`${feed.tips.length} tip${feed.tips.length === 1 ? '' : 's'}`)
  return `feed ${feed.version}: ${parts.join(', ') || 'empty'}`
}
