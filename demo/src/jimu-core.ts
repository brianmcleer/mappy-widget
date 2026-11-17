/*
  jimu-core.ts - what the demo gives Mappy in place of Experience Builder: React, and the few
  Maps SDK modules he loads by name (graphics, geometry, a locator), all pointed at the made-up
  town. The widget's own code is used as it is; only this file and fakemap.ts stand in for the
  framework underneath it.
*/
import * as ReactNS from 'react'
import * as ReactDOMNS from 'react-dom'
import { Graphic, Point, Polygon, Polyline, asGeometry } from './fakemap'

export const React = ReactNS
export const ReactDOM = ReactDOMNS

let places: Array<{ label: string, lon: number, lat: number }> = []
export function setPlaces (list: Array<{ label: string, lon: number, lat: number }>): void { places = list }

const norm = (s: string): string => String(s || '').toLowerCase().replace(/\b(street)\b/g, 'st').replace(/\b(avenue)\b/g, 'ave').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const locator = {
  async addressToLocations (url: string, params: any): Promise<any[]> {
    const text = norm(String(Object.values(params?.address || {})[0] || ''))
    if (!text) return []
    const words = text.split(' ')
    const scored = places.map(p => {
      const label = norm(p.label)
      const score = label === text ? 100 : label.startsWith(text) || text.startsWith(label) ? 94 : words.every(w => label.includes(w)) ? 88 : words.filter(w => w.length > 2 && label.split(' ').includes(w)).length >= Math.max(2, words.length - 1) ? 80 : 0
      return { p, score }
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, params?.maxLocations || 5)
    return scored.map(({ p, score }) => ({ address: p.label, score, location: new Point({ x: p.lon, y: p.lat }), attributes: { Match_addr: p.label, Addr_type: 'PointAddress', X: p.lon, Y: p.lat } }))
  },
  async suggestLocations (url: string, params: any): Promise<any[]> {
    const text = norm(params?.text || '')
    if (text.length < 2) return []
    return places.filter(p => norm(p.label).startsWith(text) || norm(p.label).includes(' ' + text)).slice(0, 5).map(p => ({ text: p.label, magicKey: p.label }))
  },
  async locationToAddress (url: string, params: any): Promise<any> {
    const g = asGeometry(params?.location)
    if (!g || !places.length) throw new Error('No address there.')
    const best = places.map(p => ({ p, d: Math.hypot((p.lon - g.x) * 85394, (p.lat - g.y) * 111000) })).sort((a, b) => a.d - b.d)[0]
    if (best.d > 400) throw new Error('No address there.')
    return { address: best.p.label, location: new Point({ x: best.p.lon, y: best.p.lat }), attributes: { Match_addr: best.p.label } }
  }
}

const request = async (): Promise<any> => ({ data: { capabilities: 'Geocode,ReverseGeocode,Suggest', singleLineAddressField: { name: 'SingleLine' } } })

const MODULES: { [name: string]: any } = {
  'esri/Graphic': Graphic,
  'esri/geometry/Point': Point,
  'esri/geometry/Polygon': Polygon,
  'esri/geometry/Polyline': Polyline,
  'esri/Viewpoint': { fromJSON: (j: any) => ({ scale: j?.scale, rotation: 0, targetGeometry: asGeometry(j?.targetGeometry) }) },
  'esri/geometry/operators/projectOperator': { isLoaded: () => true, load: async () => {}, execute: (g: any) => g },
  'esri/geometry/projection': { isLoaded: () => true, load: async () => {}, project: (g: any) => g },
  'esri/rest/locator': locator,
  'esri/request': request
}

export async function loadArcGISJSAPIModules (names: string[]): Promise<any[]> {
  return names.map(n => {
    if (!(n in MODULES)) throw new Error(`The demo has no stand-in for ${n}.`)
    return MODULES[n]
  })
}

// Experience Builder's app store and history: there is no app around the demo, so these do nothing.
export const getAppStore = (): any => ({ getState: () => ({ appConfig: {}, appRuntimeInfo: {} }), dispatch: () => {} })
export const appActions: any = new Proxy({}, { get: () => () => ({ type: 'demo' }) })
export const jimuHistory: any = { changeView: () => {}, changePage: () => {}, changeDialog: () => {}, browserHistory: { push: () => {} } }
export const SessionManager: any = { getInstance: () => ({ getMainSession: () => null }) }
