import { normalizeCommand } from './conversation'

/** Address routing is conservative; arbitrary app questions are never sent to a locator. */
export function addressPrompt (input: string): string | null {
  const q = normalizeCommand(input).replace(/[?!]+$/, '').trim()
  const explicit = q.match(/^(?:geocode|what(?:'s| is) (?:the )?address of|find (?:the )?address(?: of| at)?|look up (?:the )?address(?: of| at)?|search for (?:the )?address(?: of| at)?)\s+(.+)$/i)
  if (explicit) return explicit[1].trim()
  const command = q.match(/^(?:find|locate|search(?: for)?|look up|where is|where's|show me|take me to|go to|zoom to|navigate to)\s+(.+)$/i)
  const named = command?.[1].match(/^(?:the )?(?:address|location)(?: of| at)?\s+(.+)$/i)
  if (named) return named[1].trim()
  const target = (command?.[1] || q).replace(/^the address\s+/i, '')
  // Require a street number plus street words, not a numeric ID or coordinates.
  return /^\d+[a-z]?(?:-\d+)?\s+(?=.*[a-z])[a-z0-9 .,'#/-]+$/i.test(target) ? target : null
}

export interface GeocoderSource {
  url: string
  name: string
  singleLineFieldName?: string
  prefix?: string
  suffix?: string
  countryCode?: string
  categories?: string[]
  withinViewEnabled?: boolean
}

/** Conversational choices, without confusing an address number with a result number. */
export function resultNumber (input: string): number | null {
  const m = normalizeCommand(input).match(/^(?:(?:show|open|use|choose|pick|zoom to)\s+)?(?:the\s+)?(?:number\s+|result\s+)?(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)(?:\s+(?:one|result|match|address))?[!.?]*$/i)
  if (!m) return null
  return ({ first: 1, second: 2, third: 3, fourth: 4, fifth: 5 } as any)[m[1].toLowerCase()] || parseInt(m[1], 10)
}

/** A city correction applies only while an address search is the active conversation. */
export function addressPlace (input: string): string | null {
  const m = normalizeCommand(input).match(/^(?:(?:no|actually|i meant)[,\s]+)?in\s+(.+?)[?!]*$/i)
  if (!m || /^(?:view|the (?:map|current view)|here|this (?:map|view))$/i.test(m[1])) return null
  return m[1].trim()
}

/** Only configured locator endpoints; never silently substitute a public world service. */
export function configuredGeocoders (app: any, portal: any): GeocoderSource[] {
  const sources: GeocoderSource[] = []
  const add = (value: any) => {
    if (!value || value.enabled === false || value.geosearch === false) return
    const url = String(value.url || '').replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s?#]+\/GeocodeServer$/i.test(url) || sources.some(s => s.url.toLowerCase() === url.toLowerCase())) return
    sources.push({ url, name: value.name || value.label || 'Configured address locator', singleLineFieldName: value.singleLineFieldName,
      prefix: value.prefix, suffix: value.suffix, countryCode: value.countryCode, categories: value.categories, withinViewEnabled: value.withinViewEnabled })
  }
  for (const widget of Object.values(app?.widgets || {}) as any[]) {
    if (!/(?:search|geocod|locat)/i.test(widget.uri || '')) continue
    for (const source of widget.config?.customConfig?.sources || widget.config?.sources || []) add(source)
  }
  // Preserve explicitly authored source restrictions by using app sources first.
  if (sources.length) return sources
  for (const utility of Object.values(app?.utilities || {}) as any[]) add({ ...utility.orgSetting, ...utility })
  if (sources.length) return sources
  for (const source of portal?.helperServices?.geocode || []) add(source)
  return sources
}
