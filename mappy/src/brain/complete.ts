/*
  complete.ts - predictive text for the chat box, from what the app actually has: starters,
  layer and tool names after the verbs that take them, bookmarks after "zoom to", fields after
  "count X by" and "fields in", a field's own code list after "where field is", and the question
  people ask about an address once one is typed. Pure TypeScript; the address suggestions from
  the locator are fetched by the runtime and merged here (addressFragment / withAddress).
*/

export interface CompleteSource {
  layers: string[]
  widgets: string[]
  bookmarks: string[]
  /** Field labels for a layer named the way the layer list shows it; [] when unknown. */
  fieldsOf: (layer: string) => string[]
  /** Code list labels for a field of a layer; [] when it has none. */
  valuesOf: (layer: string, field: string) => string[]
  /** An address locator or a GIS server is connected: place questions make sense. */
  places: boolean
}

const STARTERS = [
  'turn on ', 'turn off ', 'show only ', 'where are the ', 'how many ', 'fields in ', 'explore ', 'open ', 'close ', 'zoom to ', 'find ', 'what does ', 'what is ',
  'list layers', 'list widgets', 'list bookmarks', 'show me around', 'what did I change', 'what is on the map', 'undo', 'tip', 'help', 'tell me a joke', 'print the map',
  'share the map', 'measure', 'reset the map', 'what percent of ', 'average ', 'count ', 'label the ', 'satellite view', 'go back', 'what is the scale'
]
const PLACE_STARTERS = ['who owns ', 'what zone is ', 'closest ', 'directions to ', 'what is at ', 'hydrants within 500 ft of ', 'compare ']

/** The address being typed at the end of the text ("who owns 250 n 5" -> "250 n 5"), or null. */
export function addressFragment (text: string): string | null {
  const m = String(text || '').match(/(?:^|\s)(\d{1,6}[a-z]?\s+(?:[nsew]\.?\s+)?[a-z][a-z0-9 .'-]*)$/i)
  if (!m) return null
  const frag = m[1].trim()
  // "3 largest parcels", "5 acres", "2 miles": a count or a measure, not an address.
  if (/^\d+\s+(?:largest|smallest|biggest|acres?|miles?|feet|ft|meters?|km|percent|days?|weeks?|months?|years?|of|in|or|and|the)\b/i.test(frag)) return null
  // Coordinates and scales are not addresses.
  if (/^\d+\s*[:,]/.test(frag)) return null
  return frag
}

/** The text with the address fragment at its end swapped for a suggestion. */
export function withAddress (text: string, fragment: string, suggestion: string): string {
  const at = text.toLowerCase().lastIndexOf(fragment.toLowerCase())
  return at < 0 ? text : text.slice(0, at) + suggestion
}

/** The questions people ask about an address, for a bare address in the box. */
export function addressQuestions (address: string, places: boolean): string[] {
  const out = [`zoom to ${address}`]
  if (places) out.push(`who owns ${address}`, `what is at ${address}`, `closest hydrant to ${address}`)
  return out
}

const starts = (s: string, p: string): boolean => s.toLowerCase().startsWith(p) && s.toLowerCase() !== p
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Up to `max` continuations of `prefix` (two letters or more), shortest first. Names from the app
 * come after the verbs that take them, and a layer's own fields and code lists when a layer is named.
 */
export function completeText (prefix: string, src: CompleteSource, max = 5): string[] {
  // Trailing space kept: "zoom to " lists the places, "zoom to" is still being typed.
  const p = prefix.toLowerCase().replace(/\s+/g, ' ').replace(/^\s+/, '')
  const pt = p.trim()
  if (pt.length < 2) return []
  const out = new Set<string>()
  const add = (s: string) => { if (s && norm(s) !== pt && norm(s).startsWith(pt)) out.add(s) }
  const names = (list: string[], frag: string, head: string) => { for (const n of list) if ((frag.length || (head.endsWith(' ') && list.length <= 12)) && n.toLowerCase().startsWith(frag)) out.add(head + n) }

  for (const s of [...STARTERS, ...(src.places ? PLACE_STARTERS : [])]) add(s.trim())

  // "zoom to dow" -> bookmarks, then layers.
  let m = p.match(/^((?:zoom|go|fly|take me) to (?:the )?)(.*)$/)
  if (m) { names(src.bookmarks, m[2], m[1]); names(src.layers, m[2], m[1]) }
  // "open le" -> widgets.
  m = p.match(/^((?:open|close|launch|show me|start) (?:the )?)(.*)$/)
  if (m) names(src.widgets, m[2], m[1])
  // "turn on par", "where are the par", "fields in par", "how many par", "label the par" -> layers.
  m = p.match(/^((?:turn on|turn off|show only|only show|show|hide|where are the|where are|how many|fields in|explore|find|label the|label|count|summarize|describe|what is in|average \S+ (?:in|of|by) ?)\s+)(.*)$/)
  if (m && !/^(?:open|close)/.test(m[1])) names(src.layers, m[2], m[1])
  // "count parcels by zo", "parcels where zo", "fields in parcels", "average acres in parcels by " -> fields of that layer.
  m = p.match(/^(.*?\b)((?:count|group|break down|summarize) (.+?) by |(.+?) where |average (.+?) by |total (.+?) by |what (?:percent|share) of (.+?) are |largest (.+?) by )(.*)$/)
  if (m) {
    const layer = (m[3] || m[4] || m[5] || m[6] || m[7] || m[8] || '').replace(/^(?:the|all) /, '').trim()
    const frag = m[9]
    const fields = src.fieldsOf(layer)
    if (fields.length) {
      // "parcels where zoning is R-" -> the field's code list.
      const cond = frag.match(/^(.+?) (?:is|equals|=|is not|contains) (.*)$/)
      if (cond) {
        const field = fields.find(f => f.toLowerCase() === cond[1].trim()) || cond[1].trim()
        for (const v of src.valuesOf(layer, field)) if (v.toLowerCase().startsWith(cond[2])) out.add(prefix.slice(0, prefix.length - cond[2].length) + v)
      } else {
        for (const f of fields) if (f.toLowerCase().startsWith(frag) && (frag.length || fields.length <= 12)) out.add(prefix.slice(0, prefix.length - frag.length) + f)
      }
    }
  }
  // A bare layer or tool name: the most common thing to do with it.
  if (!/\s/.test(pt) || out.size === 0) {
    names(src.layers, pt, 'turn on ')
    names(src.widgets, pt, 'open ')
    names(src.bookmarks, pt, 'zoom to ')
  }
  return Array.from(out).sort((a, b) => a.length - b.length).slice(0, max)
}
