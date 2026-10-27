/*
  deepScan.ts - builds Mappy's brain in the builder.

  Reads the app being edited and follows everything it points at: each web map (title,
  summary, description, tags, bookmarks, basemap), each operational layer and table (the
  service's own description, every field and alias, every coded value list), the portal
  items behind those layers, standalone service data sources, and every widget's manifest.
  The result is stored in the widget config, so end users get the knowledge instantly with
  no scanning, and the scan runs with the builder's own sign-in.

  The Maps SDK request module is loaded at click time (never a static esri import in a
  settings bundle; WIDGETHANDOFF 12.1).
*/
import { loadArcGISJSAPIModules } from 'jimu-core'
import type { Brain, Doc, LayerHint } from '../brain/types'
import { mapDataSources, serviceDataSources, extractApp } from '../brain/extract'
import { docsFromLayer, layerHint, layerInfoFromRest } from '../brain/layers'
import type { LayerInfo } from '../brain/layers'
import { stripHtml, clip, layerKey, hash } from '../brain/text'
import { eachKey } from '../brain/appModel'
import { isOutOfTheBox } from '../brain/builtin'
import { loadMissingManifests } from '../brain/manifests'
import { esriDocsForApp } from '../brain/docsPack'
import { htmlSections, mdSections, guideDocs } from '../brain/guides'
import { isUsefulUrl } from '../brain/extract'
import type { Doc as BrainDoc } from '../brain/types'

export interface ScanOptions {
  webMaps: boolean
  services: boolean
  items: boolean
  manifests: boolean
  /** ArcGIS documentation (bundled pack) for the out-of-the-box widgets the app uses. */
  esriDocs: boolean
  /** Help guide pages the app embeds or links to, read section by section. */
  guides: boolean
  /** Hard cap on layers/tables read, protects huge maps. */
  maxLayers: number
}

export interface ScanProgress {
  step: string
  done: number
  total: number
  log: string
}

type Progress = (p: ScanProgress) => void

const MAX_BRAIN_CHARS = 900000

export async function deepScan (appConfig: any, opts: ScanOptions, onProgress: Progress, cancelled: () => boolean): Promise<Brain> {
  const [esriRequest] = await loadArcGISJSAPIModules(['esri/request'])
  const notes: string[] = []
  const docs: Doc[] = []
  const hints: LayerHint[] = []
  const seenLayers = new Set<string>()
  let done = 0
  let total = 1
  const log = (step: string, msg: string) => {
    notes.push(msg)
    onProgress({ step, done, total, log: msg })
  }
  const getJson = async (url: string, query: any = {}): Promise<any> => {
    const res = await esriRequest(url, { query: { f: 'json', ...query }, responseType: 'json', timeout: 25000 })
    const data = res?.data
    if (data?.error) throw new Error(data.error.message || 'Request failed')
    return data
  }
  const portalRest = (p?: string) => String(p || appConfig?.attributes?.portalUrl || '').replace(/\/+$/, '') + '/sharing/rest'

  // ---------------------------------------------------------------- manifests
  const manifests: { [uri: string]: { label?: string, description?: string } } = {}
  if (opts.manifests) {
    Object.assign(manifests, await loadMissingManifests(appConfig, {}))
    log('manifests', `Read ${Object.keys(manifests).length} widget manifests.`)
  }

  // ---------------------------------------------------------------- layer readers
  const layerQueue: Array<{ url: string, extra: Partial<LayerInfo>, itemId?: string }> = []
  const queueLayer = (url: string, extra: Partial<LayerInfo>, itemId?: string) => {
    const key = layerKey(url)
    if (seenLayers.has(key)) return
    seenLayers.add(key)
    layerQueue.push({ url, extra, itemId })
  }

  /** A service root: one /layers call returns every layer and table with fields. */
  const expandService = async (url: string, extra: Partial<LayerInfo>, onlyIds?: number[]) => {
    try {
      const all = await getJson(url.replace(/\/+$/, '') + '/layers')
      const items: any[] = [...(all.layers || []), ...(all.tables || [])]
      for (const l of items) {
        if (l.type === 'Group Layer' || (l.subLayers && l.subLayers.length && !l.fields)) continue
        if (onlyIds && !onlyIds.includes(l.id)) continue
        const lurl = url.replace(/\/+$/, '') + '/' + l.id
        const key = layerKey(lurl)
        if (seenLayers.has(key)) continue
        seenLayers.add(key)
        const parent = items.find(p => p.id === l.parentLayer?.id)
        pushLayer(layerInfoFromRest(l, lurl, { ...extra, title: l.name, parentTitle: parent?.name || extra.title }))
      }
    } catch (e: any) {
      notes.push(`Could not read ${url}: ${e?.message || e}`)
    }
  }

  const itemInfo = new Map<string, any>()
  const pushLayer = (info: LayerInfo) => {
    if (hints.length >= opts.maxLayers) return
    const ld = docsFromLayer(info, 'scan')
    docs.push(...ld)
    hints.push(layerHint(info))
  }

  // ---------------------------------------------------------------- web maps
  const maps = opts.webMaps ? mapDataSources(appConfig) : []
  total = maps.length + 1
  for (const m of maps) {
    if (cancelled()) break
    const rest = portalRest(m.portalUrl)
    try {
      const item = await getJson(`${rest}/content/items/${m.itemId}`)
      const data = await getJson(`${rest}/content/items/${m.itemId}/data`)
      const title = item.title || m.label || 'Web map'
      docs.push({
        id: 'map:' + m.itemId,
        kind: 'map',
        title,
        text: [item.snippet, clip(stripHtml(item.description || ''), 900), item.accessInformation ? 'Credits: ' + stripHtml(item.accessInformation) : '', item.licenseInfo ? clip(stripHtml(item.licenseInfo), 300) : ''].filter(Boolean).join(' '),
        keys: ['map web map', (item.tags || []).join(' ')].join(' '),
        src: 'scan'
      })
      if (data?.baseMap?.title) {
        docs.push({ id: 'basemap:' + m.itemId, kind: 'basemap', title: data.baseMap.title, text: `The basemap (background) of ${title} is ${data.baseMap.title}.`, keys: 'basemap background', src: 'scan' })
      }
      ;(data?.bookmarks || []).forEach((b: any, i: number) => {
        if (b?.name) docs.push({ id: 'bookmark:' + i + ':' + hash(b.name), kind: 'bookmark', title: b.name, text: `A saved place in ${title}: ${b.name}.`, keys: 'bookmark place', actions: [{ type: 'bookmark', id: String(i), label: 'Go there' }], src: 'scan' })
      })
      const walk = (layers: any[], parentTitle?: string) => {
        for (const l of layers || []) {
          if (l.layers && (l.layerType === 'GroupLayer' || !l.url)) { walk(l.layers, l.title); continue }
          if (l.featureCollection) {
            for (const fl of l.featureCollection.layers || []) {
              const ld = fl.layerDefinition || {}
              pushLayer(layerInfoFromRest({ ...ld, name: fl.layerDefinition?.name || l.title }, '', { title: l.title, parentTitle, mapTitle: title }))
            }
            continue
          }
          if (!l.url) continue
          const extra: Partial<LayerInfo> = { title: l.title, parentTitle, mapTitle: title }
          if (/\/(mapserver|featureserver)\/?$/i.test(l.url)) {
            layerQueue.push({ url: l.url, extra: { ...extra, title: l.title }, itemId: l.itemId })
          } else if (/\/(mapserver|featureserver)\/\d+\/?$/i.test(l.url)) {
            queueLayer(l.url, extra, l.itemId)
          } else {
            docs.push({ id: 'layer:' + layerKey(l.url, l.title), kind: 'layer', title: l.title || 'Layer', text: `A ${String(l.layerType || 'map').replace(/^ArcGIS/, '').replace(/Layer$/, '').toLowerCase()} layer in ${title}.`, layer: layerKey(l.url, l.title), actions: [{ type: 'layerOn', id: layerKey(l.url, l.title), label: 'Turn on' }], src: 'scan' })
          }
          if (l.itemId) itemInfo.set(l.itemId, layerKey(l.url, l.title))
        }
      }
      walk(data?.operationalLayers || [])
      for (const t of data?.tables || []) if (t.url) queueLayer(t.url, { title: t.title, mapTitle: title, isTable: true }, t.itemId)
      log('webmap', `Read web map "${title}" (${(data?.operationalLayers || []).length} top-level layers).`)
    } catch (e: any) {
      log('webmap', `Could not read web map ${m.itemId}: ${e?.message || e}`)
    }
    done++
  }

  // ---------------------------------------------------------------- standalone data sources
  if (opts.services) {
    for (const ds of serviceDataSources(appConfig)) {
      if (/\/\d+\/?$/.test(ds.url)) queueLayer(ds.url, { title: ds.label })
      else layerQueue.push({ url: ds.url, extra: { title: ds.label } })
    }
  }

  // ---------------------------------------------------------------- read services
  if (opts.services) {
    total = layerQueue.length
    done = 0
    const queue = layerQueue.slice()
    const worker = async () => {
      while (queue.length && !cancelled() && hints.length < opts.maxLayers) {
        const job = queue.shift()!
        try {
          if (/\/(mapserver|featureserver)\/?$/i.test(job.url)) {
            await expandService(job.url, job.extra)
          } else {
            const json = await getJson(job.url)
            pushLayer(layerInfoFromRest(json, job.url, { ...job.extra, title: job.extra.title || json.name }))
          }
        } catch (e: any) {
          notes.push(`Could not read ${job.extra.title || job.url}: ${e?.message || e}`)
        }
        done++
        onProgress({ step: 'services', done, total, log: `Reading layers ${done}/${total}` })
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    log('services', `Read ${hints.length} layers and tables.`)
  } else {
    // Still record the layers by name so Mappy knows they exist.
    for (const j of layerQueue) pushLayer({ url: j.url, title: j.extra.title || j.url, fields: [], ...j.extra })
  }

  // ---------------------------------------------------------------- portal items behind layers
  if (opts.items && itemInfo.size) {
    const rest = portalRest()
    const ids = Array.from(itemInfo.keys()).slice(0, 60)
    let n = 0
    for (const id of ids) {
      if (cancelled()) break
      try {
        const it = await getJson(`${rest}/content/items/${id}`)
        const text = [it.snippet, clip(stripHtml(it.description || ''), 800), it.accessInformation ? 'Credits: ' + stripHtml(it.accessInformation) : ''].filter(Boolean).join(' ')
        if (text) {
          docs.push({ id: 'item:' + id, kind: 'item', title: it.title, text, keys: (it.tags || []).join(' ') + ' about description source', layer: itemInfo.get(id) || undefined, src: 'scan' })
          n++
        }
      } catch (e) { }
    }
    log('items', `Read ${n} layer item descriptions.`)
  }

  // ---------------------------------------------------------------- ArcGIS documentation
  if (opts.esriDocs && !cancelled()) {
    const pack = esriDocsForApp(appConfig)
    docs.push(...pack.docs)
    log('docs', pack.covered.length ? `Added ArcGIS documentation for ${pack.covered.length} out-of-the-box widgets: ${pack.covered.join(', ')}.` : 'No out-of-the-box widgets with ArcGIS documentation in this app.')
  }

  // ---------------------------------------------------------------- help guides
  if (opts.guides && !cancelled()) {
    const g = await crawlGuides(appConfig, msg => log('guides', msg), cancelled)
    docs.push(...g)
  }

  // ---------------------------------------------------------------- pack
  const brain: Brain = {
    v: 1,
    builtAt: Date.now(),
    appTitle: appConfig?.attributes?.title,
    stats: {},
    docs: dedupe(docs),
    layers: hints,
    manifests,
    notes: notes.slice(-40)
  }
  shrink(brain)
  brain.stats = statsFor(brain, appConfig)
  return brain
}

/** Folder-scan docs replace the previous folder docs; everything else is kept. */
export function mergeFolderDocs (brain: Brain | null, folderDocs: Doc[], appConfig: any): Brain {
  const base: Brain = brain || { v: 1, builtAt: Date.now(), appTitle: appConfig?.attributes?.title, stats: {}, docs: [], layers: [], manifests: {}, notes: [] }
  const kept = base.docs.filter(d => d.src !== 'folder')
  const out: Brain = { ...base, docs: dedupe([...kept, ...folderDocs]), builtAt: Date.now() }
  shrink(out)
  out.stats = statsFor(out, appConfig)
  return out
}

export function statsFor (brain: Brain, appConfig: any): { [k: string]: number } {
  const s: { [k: string]: number } = {}
  for (const d of brain.docs) s[d.kind] = (s[d.kind] || 0) + 1
  try { s._app = extractApp(appConfig, brain.manifests).docs.length } catch (e) { }
  s._chars = JSON.stringify(brain).length
  return s
}

function dedupe (docs: Doc[]): Doc[] {
  const m = new Map<string, Doc>()
  for (const d of docs) m.set(d.id, d)
  return Array.from(m.values())
}

/** Keeps the stored brain under the size cap: trims long texts, then drops the least useful kinds. */
function shrink (brain: Brain): void {
  const size = () => JSON.stringify(brain).length
  if (size() <= MAX_BRAIN_CHARS) return
  for (const d of brain.docs) d.text = clip(d.text, d.kind === 'doc' ? 700 : 400)
  for (const h of brain.layers) h.fields = h.fields.slice(0, 40)
  const order: Doc['kind'][] = ['item', 'domain', 'datasource', 'doc']
  for (const k of order) {
    if (size() <= MAX_BRAIN_CHARS) return
    brain.docs = brain.docs.filter(d => d.kind !== k)
  }
}

export function customWidgetFolders (appConfig: any): Map<string, string[]> {
  const m = new Map<string, string[]>()
  eachKey(appConfig?.widgets, (w, id) => {
    if (!w?.uri || isOutOfTheBox(w.uri)) return
    const name = String(w.uri).split('/').filter(Boolean).pop() || ''
    if (!m.has(name)) m.set(name, [])
    m.get(name)!.push(id)
  })
  return m
}

const GUIDE_HINT = /(help|guide|manual|faq|how[\s-]?to|instruction|tutorial|user|training|getting[\s-]?started|quick[\s-]?start|documentation|docs)/i

/** Guide pages the app embeds (Embed widgets) or links to with a help-like name or address. */
export function guideUrls (appConfig: any): string[] {
  const out: string[] = []
  const add = (u: string) => { const c = u.split('#')[0]; if (!out.includes(c)) out.push(c) }
  let docs: BrainDoc[] = []
  try { docs = extractApp(appConfig).docs } catch (e) { docs = [] }
  for (const d of docs) {
    const urls = (d.actions || []).filter(a => a.type === 'url' && a.url).map(a => a.url as string)
    const inText = (d.text.match(/https?:\/\/[^\s"'<>)]+/g) || [])
    for (const u of [...urls, ...inText]) {
      if (!/^https?:/i.test(u) || !isUsefulUrl(u) || /\.(pdf|zip|png|jpe?g|gif|docx?|xlsx?)(\?|$)/i.test(u)) continue
      if (/survey123|arcgis\.com\/apps\/|\/experience\/|\/webappviewer\//i.test(u)) continue
      if (d.kind === 'guide' || GUIDE_HINT.test(u) || GUIDE_HINT.test(d.title)) add(u)
    }
  }
  return out.slice(0, 12)
}

/**
 * Reads each guide page (and up to 12 linked pages beside it on the same site and folder),
 * one fact per heading. Pages whose server does not allow reading from the builder are
 * reported in the log; their files can be added with the help files folder scan instead.
 */
export async function crawlGuides (appConfig: any, onLog: (msg: string) => void, cancelled: () => boolean): Promise<BrainDoc[]> {
  const roots = guideUrls(appConfig)
  if (!roots.length) { onLog('No help guide pages found in the app.'); return [] }
  const docs: BrainDoc[] = []
  for (const root of roots) {
    if (cancelled()) break
    const seen = new Set<string>()
    const queue = [root]
    let pages = 0
    let blocked = false
    while (queue.length && pages < 13 && !cancelled()) {
      const url = queue.shift()!
      if (seen.has(url)) continue
      seen.add(url)
      let text = ''
      try {
        const r = await fetch(url, { credentials: 'include', mode: 'cors' })
        if (!r.ok) { if (url === root) onLog(`Could not read ${url} (HTTP ${r.status}).`); continue }
        const type = r.headers.get('content-type') || ''
        if (!/html|markdown|text\/plain/i.test(type) && !/\.(md|txt)(\?|$)/i.test(url)) continue
        text = await r.text()
        pages++
        if (/\.(md)(\?|$)/i.test(url) || /markdown/i.test(type)) {
          docs.push(...guideDocs(url.split('/').pop() || url, '', mdSections(text), url, 'scan', 'guide'))
          continue
        }
        const { title, sections } = htmlSections(text)
        docs.push(...guideDocs(new URL(url).host, title, sections, url, 'scan', 'guide'))
        // Follow links to other pages of the same guide (same site, same folder).
        try {
          const base = new URL(url)
          const folder = base.pathname.replace(/[^/]*$/, '')
          const hrefs = Array.from(text.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)).map(m => m[1])
          for (const h of hrefs) {
            let abs: URL
            try { abs = new URL(h, base) } catch (e) { continue }
            if (abs.host !== base.host || !abs.pathname.startsWith(folder) || !/\.(html?|md)$/i.test(abs.pathname)) continue
            const u = abs.origin + abs.pathname
            if (!seen.has(u) && !queue.includes(u)) queue.push(u)
          }
        } catch (e) { }
      } catch (e) {
        if (url === root) { blocked = true; onLog(`Could not read ${url}: the site does not allow reading it from the builder. Save the guide's files and add them with "Help files folder".`) }
      }
    }
    if (!blocked && pages) onLog(`Read ${pages} guide page${pages === 1 ? '' : 's'} from ${root}.`)
  }
  return docs
}
