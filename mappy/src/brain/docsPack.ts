/*
  docsPack.ts - turns the bundled ArcGIS documentation (esriDocs.ts) into things Mappy knows,
  only for the out-of-the-box widgets this app actually places, and under the names the app
  gives them ("Reports" for a Query widget). Pure TypeScript.
*/
import type { Doc, MappyAction } from './types'
import { ESRI_DOCS } from './esriDocs'
import { AppModel, eachKey } from './appModel'
import { isOutOfTheBox, widgetName } from './builtin'
import { cleanLabel } from './text'

export interface DocsPackResult {
  docs: Doc[]
  /** Widget folder names that got documentation, for the settings log. */
  covered: string[]
}

export function esriDocsForApp (appConfig: any): DocsPackResult {
  const model = new AppModel(appConfig)
  const byName = new Map<string, { ids: string[], labels: Set<string> }>()
  eachKey(appConfig?.widgets, (w, id) => {
    if (!w?.uri || !isOutOfTheBox(w.uri) || !model.isPlaced(id)) return
    const name = widgetName(w.uri)
    if (!ESRI_DOCS[name]) return
    if (!byName.has(name)) byName.set(name, { ids: [], labels: new Set() })
    const g = byName.get(name)!
    g.ids.push(id)
    if (w.label) g.labels.add(cleanLabel(w.label))
  })
  const docs: Doc[] = []
  byName.forEach((g, name) => {
    const d = ESRI_DOCS[name]
    const labels = Array.from(g.labels)
    const label = labels[0] || d.title
    const aka = labels.length && !labels.some(l => l.toLowerCase() === d.title.toLowerCase()) ? ` (the ${d.title} widget)` : ''
    const open: MappyAction = { type: 'openWidget', ids: g.ids, label: `Open ${label}` }
    const keys = [name.replace(/-/g, ' '), d.title, ...labels, 'how to use help'].join(' ')
    const steps = d.howTo.map((h, i) => `${i + 1}. ${h.replace(/\.$/, '')}.`).join(' ')
    docs.push({
      id: `esri:${name}:about`,
      kind: 'doc',
      title: `${label}${aka}: how to use it`,
      text: [d.summary, steps ? `Here's how: ${steps}` : ''].filter(Boolean).join(' '),
      keys,
      actions: [open],
      src: 'scan',
      boost: 1.15
    })
    if (d.tips.length) {
      docs.push({
        id: `esri:${name}:tips`,
        kind: 'doc',
        title: `${label}: good to know`,
        text: 'Good to know: ' + d.tips.join(' '),
        keys: keys + ' tips tricks why',
        actions: [open],
        src: 'scan'
      })
    }
    d.faq.forEach((f, i) => {
      docs.push({
        id: `esri:${name}:faq${i}`,
        kind: 'faq',
        title: f.q.replace(/\bthe (widget|tool)\b/i, label),
        text: f.a,
        keys: keys + ' ' + f.q,
        actions: [open],
        src: 'scan',
        boost: 1.1
      })
    })
  })
  return { docs, covered: Array.from(byName.keys()) }
}
