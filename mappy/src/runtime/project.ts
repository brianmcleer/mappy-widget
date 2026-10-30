/*
  project.ts - points to latitude and longitude on any map, including local coordinate systems
  (state plane). WGS84 and Web Mercator are plain math; anything else goes through the Maps
  SDK's projection engine, loaded once in the background so the conversion itself stays
  synchronous (the Mind reads places while it answers). Until it has loaded, unknown systems
  give null and callers fall back to asking.
*/
import { loadArcGISJSAPIModules } from 'jimu-core'

let operator: any = null
let loading: Promise<void> | null = null
let WGS84: any = null

/** Starts loading the projection engine; cheap to call more than once. */
export function warmProjection (load = loadArcGISJSAPIModules): Promise<void> {
  if (operator || loading) return loading || Promise.resolve()
  loading = (async () => {
    try {
      const [op, SpatialReference] = await load(['esri/geometry/operators/projectOperator', 'esri/geometry/SpatialReference'])
      if (!op.isLoaded()) await op.load()
      WGS84 = SpatialReference.WGS84 || new SpatialReference({ wkid: 4326 })
      operator = op
    } catch (e) { operator = null }
    loading = null
  })()
  return loading
}

/** For tests: a stand-in operator with execute(point, sr). */
export function setProjectionOperator (op: any, wgs84: any = { wkid: 4326 }): void { operator = op; WGS84 = wgs84 }

const flat = (sr: any): 'wgs84' | 'mercator' | null => !sr || sr.isWGS84 || sr.wkid === 4326 ? 'wgs84' : (sr.isWebMercator || [102100, 3857, 102113].includes(sr.wkid)) ? 'mercator' : null

/** [latitude, longitude] for a point-like {x, y, spatialReference} or {latitude, longitude}; null when it cannot be known yet. */
export function toLatLon (p: any): [number, number] | null {
  if (!p) return null
  if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) return [p.latitude, p.longitude]
  const x = Number(p.x); const y = Number(p.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const kind = flat(p.spatialReference)
  if (kind === 'wgs84') return Math.abs(y) <= 90 && Math.abs(x) <= 180 ? [y, x] : null
  if (kind === 'mercator') return [(Math.PI / 2 - 2 * Math.atan(Math.exp(-y / 6378137))) * 180 / Math.PI, x / 6378137 * 180 / Math.PI]
  if (!operator || !p.spatialReference) { warmProjection().catch(() => {}); return null }
  try {
    const geometry = typeof p.clone === 'function' ? p : { type: 'point', x, y, spatialReference: p.spatialReference }
    const out = operator.execute(geometry, WGS84)
    const lat = Number(out?.latitude ?? out?.y); const lon = Number(out?.longitude ?? out?.x)
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null
  } catch (e) { return null }
}

/** Does the point's coordinate system need the projection engine (a local or state plane system)? */
export function needsProjection (sr: any): boolean { return flat(sr) === null }
