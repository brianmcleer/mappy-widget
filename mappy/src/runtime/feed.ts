/*
  feed.ts (runtime) - fetches the knowledge feed once a day and keeps the last good copy in
  browser storage, so a slow or missing network never slows Mappy down: he starts with what
  is bundled, then takes the feed when it arrives. Only https addresses, only JSON under
  2 MB, and only a feed that passes cleanFeed() is used.
*/
import { cleanFeed, FEED_MAX_BYTES, type KnowledgeFeed } from '../brain/feed'

const DAY = 24 * 60 * 60 * 1000
const key = (url: string): string => 'mappy-feed:' + url

interface Cached { at: number, etag?: string, feed: KnowledgeFeed }

function readCache (url: string): Cached | null {
  try {
    const raw = localStorage.getItem(key(url))
    if (!raw) return null
    const c = JSON.parse(raw)
    const feed = cleanFeed(c?.feed)
    return feed && typeof c.at === 'number' ? { at: c.at, etag: typeof c.etag === 'string' ? c.etag : undefined, feed } : null
  } catch (e) { return null }
}

function writeCache (url: string, c: Cached): void {
  try { localStorage.setItem(key(url), JSON.stringify(c)) } catch (e) { }
}

/** The cached feed for a url, without touching the network. */
export function cachedFeed (url: string): KnowledgeFeed | null { return readCache(url)?.feed || null }

/**
 * The feed at `url`: from cache when it was fetched less than `maxAge` ago (a day), else
 * fetched now (and cached). Null when there is none to be had. `force` ignores the cache.
 */
export async function loadFeed (url: string, opts: { maxAge?: number, force?: boolean, signal?: AbortSignal } = {}): Promise<{ feed: KnowledgeFeed | null, fromCache: boolean, error?: string }> {
  const target = String(url || '').trim()
  if (!/^https:\/\//i.test(target)) return { feed: null, fromCache: false, error: 'The feed address must start with https://.' }
  const cached = readCache(target)
  if (cached && !opts.force && Date.now() - cached.at < (opts.maxAge ?? DAY)) return { feed: cached.feed, fromCache: true }
  try {
    const headers: { [k: string]: string } = { Accept: 'application/json' }
    if (cached?.etag && !opts.force) headers['If-None-Match'] = cached.etag
    const r = await fetch(target, { headers, signal: opts.signal, cache: 'no-cache', credentials: 'omit' })
    if (r.status === 304 && cached) { writeCache(target, { ...cached, at: Date.now() }); return { feed: cached.feed, fromCache: true } }
    if (!r.ok) throw new Error(`${r.status} from ${new URL(target).host}`)
    const len = Number(r.headers.get('content-length') || 0)
    if (len > FEED_MAX_BYTES) throw new Error('The feed is bigger than 2 MB.')
    const text = await r.text()
    if (text.length > FEED_MAX_BYTES) throw new Error('The feed is bigger than 2 MB.')
    const feed = cleanFeed(JSON.parse(text))
    if (!feed) throw new Error('That is not a Mappy knowledge feed (format 1 with a version).')
    writeCache(target, { at: Date.now(), etag: r.headers.get('etag') || undefined, feed })
    return { feed, fromCache: false }
  } catch (e) {
    // Keep the last good copy when the network is down.
    return { feed: cached?.feed || null, fromCache: !!cached, error: e instanceof Error ? e.message : 'The feed could not be read.' }
  }
}

/** Forgets the cached copy, so the next load fetches. */
export function forgetFeed (url: string): void { try { localStorage.removeItem(key(url)) } catch (e) { } }
