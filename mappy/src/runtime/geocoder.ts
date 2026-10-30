import { loadArcGISJSAPIModules } from 'jimu-core'
import type { GeocoderSource } from '../brain/addresses'
import { withTimeout } from './live'

export interface AddressResult { label: string, score: number, location: any, source: string, latLon?: [number, number] }
export async function geocodeAddress (text: string, sources: GeocoderSource[], view: any, load = loadArcGISJSAPIModules): Promise<{ results: AddressResult[], failed: number }> {
  const [locator, request] = await load(['esri/rest/locator', 'esri/request'])
  const results: AddressResult[] = []
  let failed = 0
  for (const source of sources.slice(0, 3)) {
    try {
      let field = source.singleLineFieldName
      if (!field) {
        const info = await withTimeout(request(source.url, { query: { f: 'json' }, responseType: 'json' }), 8000)
        field = info?.data?.singleLineAddressField?.name
      }
      if (!field) throw new Error('This locator has no single-line address field.')
      if (source.withinViewEnabled && !view?.extent) throw new Error('The locator requires a map extent.')
      const params: any = { address: { [field]: [source.prefix, text, source.suffix].filter(Boolean).join(' ') }, maxLocations: 5, outFields: ['Match_addr', 'Addr_type', 'X', 'Y', 'DisplayX', 'DisplayY'], outSpatialReference: view?.spatialReference }
      if (source.countryCode) params.countryCode = source.countryCode
      if (source.categories?.length) params.categories = source.categories
      if (source.withinViewEnabled) params.searchExtent = view.extent
      const candidates = await withTimeout(locator.addressToLocations(source.url, params), 12000)
      for (const c of candidates || []) {
        if (!c.location || !Number.isFinite(c.location.x) || !Number.isFinite(c.location.y)) continue
        const label = String(c.address || c.attributes?.Match_addr || text)
        if (results.some(r => r.label === label && r.location.x === c.location.x && r.location.y === c.location.y)) continue
        // Locators also give the match in longitude and latitude (X, Y), which spares a projection on state plane maps.
        const a = c.attributes || {}
        const lon = Number(a.X ?? a.DisplayX); const lat = Number(a.Y ?? a.DisplayY)
        const latLon: [number, number] | undefined = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : undefined
        results.push({ label, score: Number.isFinite(c.score) ? c.score : 0, location: c.location, source: source.name, latLon })
      }
      // Prefer the author's first locator that returns candidates; no address fan-out.
      if (results.length) break
    } catch (e) { failed++ }
  }
  return { results: results.sort((a, b) => b.score - a.score).slice(0, 5), failed }
}

/**
 * Address suggestions while typing, from the first locator that offers Suggest (the same call
 * the Search widget makes). Up to five texts; [] when none or when the locator cannot suggest.
 */
export async function suggestAddresses (text: string, sources: GeocoderSource[], view: any, load = loadArcGISJSAPIModules, signal?: AbortSignal): Promise<string[]> {
  const t = String(text || '').trim()
  if (t.length < 3) return []
  const [locator, request] = await load(['esri/rest/locator', 'esri/request'])
  for (const source of sources.slice(0, 3)) {
    try {
      const info = await withTimeout(request(source.url, { query: { f: 'json' }, responseType: 'json', signal }), 6000)
      if (!/suggest/i.test(String(info?.data?.capabilities || ''))) continue
      const params: any = { text: [source.prefix, t, source.suffix].filter(Boolean).join(' '), maxSuggestions: 5 }
      if (source.countryCode) params.countryCode = source.countryCode
      if (source.categories?.length) params.categories = source.categories
      if (view?.center) params.location = view.center
      if (source.withinViewEnabled && view?.extent) params.searchExtent = view.extent
      const out = await withTimeout(locator.suggestLocations(source.url, params, { signal }), 6000)
      const texts: string[] = (out || []).map((x: any) => String(x?.text || '')).filter(Boolean)
      if (texts.length) return Array.from(new Set<string>(texts)).slice(0, 5)
    } catch (e) { if (signal?.aborted) return [] }
  }
  return []
}
