/*
  admin.ts - knowledge the app author types in the settings panel: questions and answers,
  and free-form notes. These outrank everything else Mappy finds on its own.
*/
import type { Doc } from './types'
import { hash, clip } from './text'

export interface FaqEntry { q: string, a: string, url?: string }

export function adminDocs (faq: FaqEntry[] | undefined, notes: string | undefined): Doc[] {
  const docs: Doc[] = []
  for (const f of faq || []) {
    if (!f || !f.q || !f.a) continue
    docs.push({
      id: 'faq:' + hash(f.q),
      kind: 'faq',
      title: f.q,
      text: f.a,
      keys: f.q,
      actions: f.url ? [{ type: 'url', url: f.url, label: 'Open link' }] : undefined,
      src: 'admin',
      boost: 1.6
    })
  }
  const paras = String(notes || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  paras.forEach((p, i) => {
    const firstLine = p.split('\n')[0]
    docs.push({
      id: 'note:' + hash(p) + i,
      kind: 'note',
      title: clip(firstLine, 70),
      text: p,
      src: 'admin',
      boost: 1.3
    })
  })
  return docs
}
