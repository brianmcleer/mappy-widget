/*
  manifests.ts - reads custom widgets' manifest.json at run time when the app config did not
  carry them, so Mappy can describe every tool in any app. Uses XMLHttpRequest, not fetch:
  some deployments wrap the global fetch (a CDN cache shim) and rewrite absolute URLs.
*/
import { isOutOfTheBox } from './builtin'

export type ManifestMap = { [uri: string]: { label?: string, description?: string } }

function getJson (url: string): Promise<any> {
  return new Promise(resolve => {
    try {
      const x = new XMLHttpRequest()
      x.open('GET', url, true)
      x.timeout = 8000
      x.onload = () => { try { resolve(x.status >= 200 && x.status < 300 ? JSON.parse(x.responseText) : null) } catch (e) { resolve(null) } }
      x.onerror = () => resolve(null)
      x.ontimeout = () => resolve(null)
      x.send()
    } catch (e) { resolve(null) }
  })
}

function bases (): string[] {
  const out: string[] = []
  try {
    const jc: any = (window as any).jimuConfig || {}
    if (jc.baseUrl) out.push(String(jc.baseUrl).replace(/\/?$/, '/'))
    if (jc.mountPath) out.push(window.location.origin + String(jc.mountPath).replace(/\/?$/, '/'))
  } catch (e) { }
  try { out.push(new URL('.', document.baseURI).href) } catch (e) { }
  out.push(window.location.origin + '/')
  return Array.from(new Set(out))
}

/** Manifests for custom widgets in the app that are missing from `known`. */
export async function loadMissingManifests (appConfig: any, known: ManifestMap): Promise<ManifestMap> {
  const out: ManifestMap = {}
  const widgets = appConfig?.widgets || {}
  const uris = new Set<string>()
  for (const id of Object.keys(widgets)) {
    const w = widgets[id]
    if (!w?.uri || isOutOfTheBox(w.uri) || w.manifest?.description || known[w.uri] || appConfig?.widgetsManifest?.[w.uri]) continue
    uris.add(w.uri)
  }
  let roots = bases()
  let misses = 0
  for (const uri of Array.from(uris).slice(0, 60)) {
    let hit = false
    for (const b of roots) {
      const m = await getJson(b + uri + 'manifest.json')
      if (m && (m.name || m.label)) {
        out[uri] = { label: m.label, description: m.description }
        roots = [b] // the first base that works is the one for every widget
        hit = true
        break
      }
    }
    if (!hit && ++misses >= 2 && !Object.keys(out).length) break // this deployment does not serve manifests
  }
  return out
}
