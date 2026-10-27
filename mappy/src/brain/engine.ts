/*
  engine.ts - Mappy's retrieval brain.
  A BM25 index over everything Mappy knows about the app, with field weights (title counts
  more than body), synonym expansion, prefix matching and typo tolerance. Runs entirely in
  the browser, in a few milliseconds, with no model download and no network calls.
*/
import type { Doc, DocKind, SearchHit } from './types'
import { tokenize, synonyms, editDistance, flat } from './text'
import './language'

interface Posting { d: number, tf: number }

const W_TITLE = 3
const W_KEYS = 2
const W_TEXT = 1
const W_WHERE = 0.5
const K1 = 1.2
const B = 0.75

export interface SearchOptions {
  kinds?: DocKind[]
  limit?: number
  /** Minimum score to return. */
  min?: number
}

export class MappyIndex {
  docs: Doc[] = []
  private post = new Map<string, Posting[]>()
  private len: number[] = []
  private avg = 1
  private vocab: string[] = []
  private titleFlat: string[] = []
  private byId = new Map<string, number>()

  constructor (docs?: Doc[]) { if (docs) this.build(docs) }

  build (docs: Doc[]): void {
    this.docs = []
    this.post.clear()
    this.len = []
    this.titleFlat = []
    this.byId.clear()
    for (const d of docs) {
      if (!d || !d.id) continue
      const existing = this.byId.get(d.id)
      if (existing !== undefined) { this.docs[existing] = d; continue }
      this.byId.set(d.id, this.docs.length)
      this.docs.push(d)
    }
    this.docs.forEach((d, i) => {
      const tf = new Map<string, number>()
      const addAll = (text: string | undefined, w: number) => {
        for (const t of tokenize(text || '')) tf.set(t, (tf.get(t) || 0) + w)
      }
      addAll(d.title, W_TITLE)
      addAll(d.keys, W_KEYS)
      addAll(d.text, W_TEXT)
      addAll(d.where, W_WHERE)
      let total = 0
      tf.forEach((v, t) => {
        total += v
        let list = this.post.get(t)
        if (!list) { list = []; this.post.set(t, list) }
        list.push({ d: i, tf: v })
      })
      this.len[i] = total
      this.titleFlat[i] = flat(d.title)
    })
    const sum = this.len.reduce((a, b) => a + b, 0)
    this.avg = this.docs.length ? Math.max(1, sum / this.docs.length) : 1
    this.vocab = Array.from(this.post.keys())
  }

  get size (): number { return this.docs.length }

  getById (id: string): Doc | undefined {
    const i = this.byId.get(id)
    return i === undefined ? undefined : this.docs[i]
  }

  /** Query terms with weights: the words themselves, then synonyms, prefixes and near spellings. */
  private expand (q: string): Map<string, number> {
    const terms = new Map<string, number>()
    const put = (t: string, w: number) => { if ((terms.get(t) || 0) < w) terms.set(t, w) }
    for (const t of tokenize(q)) {
      if (this.post.has(t)) put(t, 1)
      for (const s of synonyms(t)) if (this.post.has(s)) put(s, 0.45)
      if (t.length >= 3) {
        let fuzzyHits = 0
        for (const v of this.vocab) {
          if (v === t) continue
          if (v.startsWith(t) && v.length > t.length) { put(v, this.post.has(t) ? 0.35 : 0.7); continue }
          if (t.length >= 4 && fuzzyHits < 6) {
            const cap = t.length >= 7 || (!this.post.has(t) && t.length >= 5) ? 2 : 1
            if (editDistance(t, v, cap) <= cap) { put(v, this.post.has(t) ? 0.3 : 0.75); fuzzyHits++ }
          }
        }
      }
    }
    return terms
  }

  search (q: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = opts.limit ?? 8
    const kinds = opts.kinds ? new Set(opts.kinds) : null
    const terms = this.expand(q)
    const scores = new Map<number, number>()
    const N = this.docs.length || 1
    terms.forEach((w, t) => {
      const list = this.post.get(t)
      if (!list) return
      const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5))
      for (const p of list) {
        if (kinds && !kinds.has(this.docs[p.d].kind)) continue
        const norm = p.tf * (K1 + 1) / (p.tf + K1 * (1 - B + B * this.len[p.d] / this.avg))
        scores.set(p.d, (scores.get(p.d) || 0) + w * idf * norm)
      }
    })
    // Phrase bonus: the whole query (or the doc title) appears verbatim.
    const fq = flat(q)
    if (fq.length >= 3) {
      scores.forEach((s, i) => {
        const tf = this.titleFlat[i]
        if (tf === fq) scores.set(i, s * 2.2 + 3)
        else if (tf && (tf.includes(fq) || (tf.length >= 4 && fq.includes(tf)))) scores.set(i, s * 1.5 + 1)
      })
    }
    const hits: SearchHit[] = []
    scores.forEach((s, i) => {
      const d = this.docs[i]
      const score = s * (d.boost || 1)
      if (score >= (opts.min ?? 0.15)) hits.push({ doc: d, score })
    })
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }

  /**
   * Best single match for a name the user typed ("the legend", "parcels layer").
   * Exact and contained title matches win before ranked search.
   */
  resolve (name: string, kinds: DocKind[], min = 0.8, ranked = true): Doc | null {
    const f = flat(name).replace(/\b(the|a|an|my|widget|tool|panel|layer|page|view|tab|window|dialog)\b/g, ' ').replace(/\s+/g, ' ').trim()
    if (!f) return null
    const pool = this.docs.filter(d => kinds.includes(d.kind))
    const exact = pool.find(d => flat(d.title) === f)
    if (exact) return exact
    const starts = pool.filter(d => flat(d.title).startsWith(f))
    if (starts.length) return starts.sort((a, b) => a.title.length - b.title.length)[0]
    const contains = pool.filter(d => flat(d.title).includes(f) || (f.length >= 4 && f.includes(flat(d.title)) && flat(d.title).length >= 3))
    if (contains.length) return contains.sort((a, b) => b.title.length - a.title.length)[0]
    if (!ranked) return null
    const hits = this.search(name, { kinds, limit: 1, min })
    return hits.length ? hits[0].doc : null
  }
}
