/*
  extract.ts - turns any Experience Builder app config into things Mappy knows:
  the app itself, pages, windows, views, every widget (what it does, where it lives, the
  text and links configured inside it), data sources and links. Pure TypeScript.

  Works on the plain config JSON, so the runtime (live app state) and the settings panel
  (builder state, deep scan) share it.
*/
import type { Doc, MappyAction } from './types'
import { AppModel, eachKey } from './appModel'
import { BUILTIN_WIDGETS, PLUMBING, widgetName } from './builtin'
import { stripHtml, clip, cleanLabel, hash, uniq } from './text'

/** Config keys whose string values are worth reading. */
const TEXT_KEYS = /^(text|label|title|name|content|tooltip|tooltipText|alttext|placeholder|description|hint|helptext|message|caption|header|footer|expression|value|url|href|linkurl|buttontext|prompt|greeting|question|answer|summary|notes?|displayname|alias|heading|subtitle|body|html|instructions|emptymessage|nodatamessage)$/i
/** Keys never worth reading, and never descended into. */
const SKIP_KEYS = /^(id|icon|svg|style|styles|uri|datasourceid|maindatasourceid|rootdatasourceid|dataviewid|configid|outputdatasourceid|widgetid|layoutid|bbox|setting|theme|color|colors|background|border|font.*|size|sizes|position|transform|symbol.*|renderer|geometry|extent|viewpoint|initialmapstate|imageparam|imageurl|originalurl|filename|originalname|path|properties|uniqueid|sql|where|parts|exp|filter|sqlexprobj|templates?)$/i
const URL_RX = /(https?:\/\/[^\s"'<>)]+|mailto:[^\s"'<>)]+)/gi

const MAX_WIDGET_TEXT = 2400
const MAX_TOOL_TEXT = 700

/** Service endpoints and portal roots are plumbing, not links a user wants. */
export function isUsefulUrl (u: string): boolean {
  if (/^mailto:/i.test(u)) return /@/.test(u)
  if (/\/(rest\/services|sharing\/rest|arcgis\/rest)\b|\/(featureserver|mapserver|geocodeserver|imageserver|gpserver)\b/i.test(u)) return false
  if (/^https?:\/\/[^/]+\/(portal|arcgis|server)\/?$/i.test(u)) return false
  if (/[?&=]$/.test(u)) return false
  return /^https?:\/\/[^/]+\.[^/]+/i.test(u)
}

export interface ExtractResult {
  docs: Doc[]
  model: AppModel
}

/** Map widgets' web map / web scene data sources, for the deep scan. */
export function mapDataSources (appConfig: any): Array<{ id: string, itemId: string, portalUrl?: string, type: string, label?: string }> {
  const out: Array<{ id: string, itemId: string, portalUrl?: string, type: string, label?: string }> = []
  eachKey(appConfig?.dataSources, (ds, id) => {
    if ((ds.type === 'WEB_MAP' || ds.type === 'WEB_SCENE') && ds.itemId) {
      out.push({ id, itemId: ds.itemId, portalUrl: ds.portalUrl || appConfig?.attributes?.portalUrl, type: ds.type, label: ds.label || ds.sourceLabel })
    }
  })
  return out
}

/** Feature layer / service data sources that are not widget outputs. */
export function serviceDataSources (appConfig: any): Array<{ id: string, url: string, label?: string, itemId?: string }> {
  const out: Array<{ id: string, url: string, label?: string, itemId?: string }> = []
  eachKey(appConfig?.dataSources, (ds, id) => {
    if (/_output_/.test(id) || ds.isOutputFromWidget) return
    if (ds.url && /\/(featureserver|mapserver)/i.test(ds.url)) out.push({ id, url: ds.url, label: ds.label || ds.sourceLabel, itemId: ds.itemId })
  })
  return out
}

export function extractApp (appConfig: any, manifests?: { [uri: string]: any }): ExtractResult {
  const c = appConfig || {}
  const model = new AppModel(c)
  const docs: Doc[] = []
  const attrs = c.attributes || {}
  const appTitle: string = attrs.title || c.name || 'this app'

  // ---- the app
  const pageList = Object.keys(c.pages || {}).filter(id => c.pages[id].isVisible !== false)
  docs.push({
    id: 'app',
    kind: 'app',
    title: appTitle,
    text: [
      attrs.description ? stripHtml(attrs.description) : '',
      attrs.snippet || '',
      `${appTitle} has ${pageList.length} page${pageList.length === 1 ? '' : 's'}.`
    ].filter(Boolean).join(' '),
    keys: ['about app application site experience purpose', (attrs.tags || []).join(' ')].join(' '),
    src: 'live'
  })

  // ---- pages
  eachKey(c.pages, (p, id) => {
    if (p.isVisible === false) return
    if (p.type === 'LINK' && p.linkUrl) {
      docs.push({ id: 'page:' + id, kind: 'link', title: p.label, text: `A menu link to ${p.linkUrl}.`, keys: 'page link', actions: [{ type: 'url', url: p.linkUrl, label: 'Open link' }], src: 'live' })
      return
    }
    docs.push({
      id: 'page:' + id,
      kind: 'page',
      title: p.label || id,
      text: p.isDefault ? 'The page the app opens on.' : 'A page in this app.',
      keys: 'page screen',
      actions: [{ type: 'page', id, label: 'Go there' }],
      src: 'live'
    })
  })

  // ---- windows (dialogs)
  eachKey(c.dialogs, (d, id) => {
    docs.push({
      id: 'dialog:' + id,
      kind: 'dialog',
      title: d.label || id,
      text: d.isSplash ? 'The splash window shown when the app opens.' : 'A window that opens over the page.',
      keys: d.isSplash ? 'splash welcome intro disclaimer window popup' : 'window dialog popup',
      actions: [{ type: 'dialog', id, label: 'Open it' }],
      src: 'live'
    })
  })

  // ---- sections and views
  eachKey(c.views, (v, id) => {
    const path = model.pathToView(id)
    const sectionId = Object.keys(c.sections || {}).find(s => (c.sections[s].views || []).includes(id))
    docs.push({
      id: 'view:' + id,
      kind: 'view',
      title: v.label || id,
      text: 'A view (tab) in the app.',
      keys: 'view tab panel',
      where: model.describePath(path),
      actions: sectionId ? [{ type: 'view', id, sectionId, label: 'Show it' }] : undefined,
      src: 'live'
    })
  })

  // ---- widgets
  const groups = new Map<string, Doc>()
  const linkSeen = new Set<string>()
  eachKey(c.widgets, (w, id) => {
    if (!model.isPlaced(id)) return
    const uri: string = w.uri || ''
    const name = widgetName(uri)
    const manifest = w.manifest || manifests?.[uri] || c.widgetsManifest?.[uri] || null
    const builtin = BUILTIN_WIDGETS[name]
    let label = cleanLabel(w.label || manifest?.label || name)
    if (manifest?.label && label.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase().replace(/[^a-z]/g, '')) label = manifest.label
    const path = model.pathToWidget(id)
    const where = model.describePath(path)
    const strings = collectStrings(w.config)
    const contentText = clip(uniq(strings.texts).join(' \n'), MAX_WIDGET_TEXT)

    // Links configured in the widget (buttons, images, text, embeds, link lists).
    const contentWidget = name === 'text' || name === 'embed' || name === 'image' || name === 'button'
    for (const u of strings.urls) {
      if (!isUsefulUrl(u)) continue
      const key = u.toLowerCase().replace(/\/+$/, '')
      if (linkSeen.has(key)) continue
      const isMail = /^mailto:/i.test(u)
      const ctx = strings.urlContext[u] || ''
      // In tool widgets only keep links that carry their own name (a link list, a menu).
      if (!contentWidget && !isMail && (!ctx || cleanLabel(ctx).toLowerCase() === label.toLowerCase() || /^(url|link|href)$/i.test(ctx) || /^[A-Z0-9_]+$/.test(ctx))) continue
      linkSeen.add(key)
      docs.push({
        id: 'link:' + hash(key),
        kind: 'link',
        title: isMail ? `Email ${u.replace(/^mailto:/i, '')}` : clip(ctx || label, 80),
        text: `${isMail ? 'Contact email' : 'Link'} found in "${label}": ${u.replace(/^mailto:/i, '')}`,
        keys: isMail ? 'contact email help support' : 'link website page url',
        where,
        actions: [{ type: 'url', url: u, label: isMail ? 'Send email' : 'Open link' }],
        src: 'live'
      })
    }

    const isContainer = !!w.layouts && name !== 'arcgis-map'
    const plumbing = PLUMBING.has(name) || isContainer || /^widgets\/layout\//.test(uri)

    if (contentWidget) {
      const body = contentText
      if (!body) return
      const key = 'text:' + hash(body)
      if (groups.has(key)) { groups.get(key)!.actions![0].ids!.push(id); return }
      const first = body.split(/\n/)[0]
      const d: Doc = {
        id: key,
        kind: name === 'embed' ? 'guide' : 'text',
        title: label && !/^(text|embed|image|button)$/i.test(label) ? label : (/^https?:/i.test(first) ? 'Embedded page (' + first.replace(/^https?:\/\//i, '').split('/')[0] + ')' : clip(first, 60)),
        text: body,
        keys: name === 'embed' ? 'embedded page help guide' : '',
        where,
        actions: name === 'embed' ? [{ type: 'openWidget', ids: [id], label: `Show "${label}"` }] : [{ type: 'openWidget', ids: [id], label: 'Show me' }],
        src: 'live'
      }
      groups.set(key, d)
      docs.push(d)
      return
    }
    if (plumbing) return

    const groupKey = 'widget:' + name + ':' + label.toLowerCase()
    const existing = groups.get(groupKey)
    if (existing) { existing.actions![0].ids!.push(id); return }
    const description: string = manifest?.description || builtin?.does || ''
    const d: Doc = {
      id: groupKey,
      kind: 'widget',
      title: label,
      text: [description, builtin?.how || '', clip(sentences(strings.texts).join(' ').replace(URL_RX, ' '), MAX_TOOL_TEXT)].filter(Boolean).join(' '),
      keys: [name.replace(/[-_]/g, ' '), manifest?.label || '', builtin?.keys || ''].join(' '),
      where,
      actions: [{ type: 'openWidget', ids: [id], label: `Open ${label}` }],
      src: 'live'
    }
    groups.set(groupKey, d)
    docs.push(d)
  })

  // ---- data sources the app uses directly (not widget outputs)
  eachKey(c.dataSources, (ds, id) => {
    if (/_output_/.test(id) || ds.isOutputFromWidget) return
    const label = ds.label || ds.sourceLabel
    if (!label) return
    docs.push({
      id: 'ds:' + id,
      kind: 'datasource',
      title: label,
      text: `A ${String(ds.type || 'data').toLowerCase().replace(/_/g, ' ')} data source${ds.url ? ' at ' + ds.url : ''}.`,
      keys: 'data source',
      src: 'live'
    })
  })

  return { docs, model }
}

/** Only text that reads like a sentence or a heading a user would see (tool configs are full of labels like "Line 1"). */
function sentences (texts: string[]): string[] {
  return uniq(texts.filter(t => {
    if (/\{[^}]*\}/.test(t)) return false
    const words = t.split(/\s+/)
    if (words.length < 5) return false
    return words.filter(w => /^[a-z][a-z'’-]+[.,!?:;]?$/i.test(w)).length >= words.length * 0.6
  }))
}

function looksLikeCode (t: string): boolean {
  if (/\b(var|let|const|function|return|if|for)\b[\s\S]*[;={}]/.test(t)) return true
  if ((t.match(/[;{}=$<>]/g) || []).length > Math.max(4, t.length / 25)) return true
  if (/^\s*[\[{]/.test(t) && /[\]}]\s*$/.test(t)) return true
  return false
}

interface Collected { texts: string[], urls: string[], urlContext: { [url: string]: string } }

/** Walks a widget config and pulls out human text and links. */
export function collectStrings (config: any): Collected {
  const out: Collected = { texts: [], urls: [], urlContext: {} }
  let budget = 6000
  const seen = new Set<any>()
  const visit = (v: any, key: string, depth: number, parentLabel: string) => {
    if (budget <= 0 || v == null || depth > 9) return
    if (typeof v === 'string') {
      if (SKIP_KEYS.test(key)) return
      const isHtml = /<\/?(p|span|a|div|strong|br|li)\b/i.test(v)
      if (!isHtml && !TEXT_KEYS.test(key)) {
        // Still catch bare links anywhere.
        const m = v.match(URL_RX)
        if (m && v.length < 400) m.forEach(u => addUrl(u, parentLabel))
        return
      }
      if (/^\$\{|^[{[]/.test(v.trim()) && !isHtml) return
      const text = isHtml ? stripHtml(v) : v.trim()
      ;(v.match(URL_RX) || []).forEach(u => addUrl(u, text.length < 120 ? text.replace(URL_RX, '').trim() || parentLabel : parentLabel))
      if (!/[a-z]{2}/i.test(text)) return
      if (/^[a-z0-9_-]{16,}$/i.test(text)) return
      if (looksLikeCode(text)) return
      if (/^(true|false|none|auto|default|custom|fit|fill|_blank|_self|_top)$/i.test(text)) return
      const t = text.replace(URL_RX, m => m).trim()
      if (t.length < 3) return
      budget -= t.length
      out.texts.push(t)
      return
    }
    if (typeof v !== 'object') return
    if (seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { v.slice(0, 200).forEach(x => visit(x, key, depth + 1, parentLabel)); return }
    const label = typeof v.label === 'string' ? v.label : typeof v.name === 'string' ? v.name : typeof v.text === 'string' && v.text.length < 80 ? v.text : parentLabel
    for (const k of Object.keys(v)) {
      if (SKIP_KEYS.test(k) && !(k === 'value' || k === 'url')) continue
      visit(v[k], k, depth + 1, label)
    }
  }
  const addUrl = (u: string, ctx: string) => {
    const clean = u.replace(/[.,;]+$/, '').replace(/&amp;/g, '&')
    if (/\$\{|\.(png|jpe?g|gif|svg|webp|css|js|woff2?)(\?|$)/i.test(clean)) return
    if (/fonts\.googleapis|fonts\.gstatic/i.test(clean)) return
    if (!out.urls.includes(clean)) { out.urls.push(clean); out.urlContext[clean] = clip(stripHtml(ctx || ''), 80) }
  }
  visit(config, '', 0, '')
  return out
}

/** Actions for the widget doc, for callers that only have a widget id. */
export function openWidgetAction (ids: string[], label: string): MappyAction {
  return { type: 'openWidget', ids, label: `Open ${label}` }
}
