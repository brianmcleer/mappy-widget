/*
  sendPlace.ts - handing a place to another widget in the app.
  Mappy publishes Experience Builder's own "location changes" message. Whatever the builder
  wires to it on Mappy's Action tab (a report widget, a lookup tool, anything with a message
  action that takes a location) becomes something people can ask for by its name:
  "property report for 250 Main St", "run the site lookup on this parcel".
  Nothing here knows any particular widget: the names come from the app's own config.
*/

import { distanceSwap } from './spatial'

/** A widget wired to Mappy's location message: its label and its ids (one per screen size). */
export interface PlaceTarget { ids: string[], label: string }

export const PLACE_MESSAGE = 'LOCATION_CHANGE'

const flat = (s: string): string => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const each = (o: any): any[] => { try { return o ? Object.keys(o).map(k => o[k]) : [] } catch (e) { return [] } }

/** The widgets the builder wired to this widget's location message, maps left out (a map only pans). */
export function placeTargets (appConfig: any, widgetId: string): PlaceTarget[] {
  const out: PlaceTarget[] = []
  if (!appConfig || !widgetId) return out
  for (const m of each(appConfig.messageConfigs)) {
    if (!m || m.widgetId !== widgetId || m.messageType !== PLACE_MESSAGE) continue
    for (const a of each(m.actions)) {
      const id = a?.widgetId
      const w = id && appConfig.widgets?.[id]
      if (!w || id === widgetId || /arcgis-map\/?$/.test(String(w.uri || ''))) continue
      const label = String(w.label || '').trim()
      if (!label) continue
      const same = out.find(t => flat(t.label) === flat(label))
      if (same) { if (!same.ids.includes(id)) same.ids.push(id) } else out.push({ ids: [id], label })
    }
  }
  return out
}

const GENERIC = new Set(['widget', 'tool', 'tools', 'panel', 'the', 'and', 'for', 'map', 'city', 'county', 'new', 'custom', 'advanced'])
const LEAD = "(?:please\\s+)?(?:(?:can|could|would|will) you\\s+)?(?:(?:open|show|run|get|make|generate|create|give|pull up|pull|start|do|print|build|i need|i want|i would like|i'd like)\\s+)?(?:me\\s+)?(?:up\\s+)?(?:a|an|the|my)?\\s*"
const IT = /^(?:it|this|that|there|here|this one|that one|(?:this|that|the|the selected|the current|my) (?:parcel|property|lot|address|place|spot|site|location|feature|one))$/

/** The names a widget answers to: its whole label, and its last telling word when no other target shares it. */
function namesFor (t: PlaceTarget, all: PlaceTarget[]): string[] {
  const full = flat(t.label)
  const words = full.split(' ').filter(w => w.length >= 4 && !GENERIC.has(w))
  const head = words[words.length - 1]
  const names = [full]
  if (head && head !== full && !all.some(o => o !== t && flat(o.label).split(' ').includes(head))) names.push(head)
  return names
}

/** "Property report for 250 Main St" -> which wired widget, and the place in the person's words ("it" for the place on hand). */
export function readSend (text: string, targets: PlaceTarget[]): { target: PlaceTarget, place: string, feet?: number, distance?: string } | null {
  if (!targets?.length) return null
  const t = String(text || '').trim().replace(/[?.!]+$/, '').replace(/\s+/g, ' ')
  if (!t || t.length > 200) return null
  const place = (p: string): string => { const w = p.trim().replace(/^(?:the address\s+|address\s+)/i, ''); return IT.test(w.toLowerCase()) ? 'it' : w }
  for (const target of targets) {
    for (const name of namesFor(target, targets)) {
      const n = name.split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+')
      // "Mailing labels within 300 ft of 250 Main St": the distance goes along for widgets that take one.
      const around = t.match(new RegExp(`^${LEAD}${n}s?\\s+(?:for\\s+(?:everything|everyone|all|parcels|properties|owners|lots|neighbou?rs)\\s+)?within\\s+(.+?)\\s+of\\s+(.+)$`, 'i'))
      const far = around && distanceSwap(around[1])
      if (around && far) return { target, place: place(around[2]), feet: far.feet, distance: far.said }
      const withPlace = t.match(new RegExp(`^${LEAD}${n}s?\\s+(?:for|on|at|of|about)\\s+(.+)$`, 'i'))
      if (withPlace) {
        const tail = withPlace[1].match(/^(.+?),?\s+(?:within|with a buffer of|buffered by|plus)\s+(.+)$/i)
        const d = tail && distanceSwap(tail[2])
        return tail && d ? { target, place: place(tail[1]), feet: d.feet, distance: d.said } : { target, place: place(withPlace[1]) }
      }
      if (new RegExp(`^${LEAD}${n}s?\\s+(?:here|there|for (?:it|this|that))$`, 'i').test(t)) return { target, place: 'it' }
    }
  }
  // One wired widget: "everything about 250 Main St" can only mean it.
  if (targets.length === 1) {
    const all = t.match(/^(?:(?:tell|show|give) me\s+)?(?:everything|all (?:the )?(?:details|info|information)|(?:the )?full (?:details|picture|rundown|story))\s+(?:about|on|for)\s+(.+)$/i)
    if (all) return { target: targets[0], place: place(all[1]) }
  }
  return null
}

/** The chip offered after he finds a place: the widget's name, and the question it sends. */
export function sendChip (t: PlaceTarget, lat: number, lon: number): { label: string, q: string } {
  return { label: t.label, q: `${t.label} for ${lat.toFixed(6)}, ${lon.toFixed(6)}` }
}
