// Ask Mappy questions against public ArcGIS REST layers, with no map and no browser.
// Each layer URL is wrapped so it answers like a map layer, and the real Mind runs on top.
// Read-only: it only sends query requests. Needs Node, the typescript package, and curl.
//
//   node tools/ask-rest.cjs --layer "Parcels=https://host/arcgis/rest/services/X/MapServer/18" \
//        --layer "Fire Hydrants=https://host/.../MapServer/19" --locator https://host/.../GeocodeServer \
//        "how many parcels are within 300 ft of 250 Main St" "how many of those are zoned R-4"
//
//   --owners   turn on owner lists near a place        --log   print every request
//   --center "39.07,-108.56"   where "here" is
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { execFile } = require('node:child_process')
const ts = require('typescript')
const SRC = path.join(__dirname, '..', 'src')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const LOG = process.argv.includes('--log')
const argv = process.argv.slice(2)
const flag = name => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[++i]); return out }
const LAYERS = flag('--layer').map((v, i) => { const at = v.indexOf('='); const url = v.slice(at + 1).replace(/\/+$/, ''); if (at < 1 || !/^https:\/\/.+\/(?:MapServer|FeatureServer)\/\d+$/i.test(url)) { console.error('Each --layer is "Title=https://.../MapServer/<number>" (or FeatureServer). Got: ' + v); process.exit(2) } return ['layer' + i, v.slice(0, at), url] })
const LOCATOR = (flag('--locator')[0] || '').replace(/\/+$/, '')
const CENTER = (flag('--center')[0] || '0,0').split(',').map(Number)
const QUESTIONS = (() => { const out = []; for (let i = 0; i < argv.length; i++) { if (['--layer', '--locator', '--center'].includes(argv[i])) { i++; continue } if (!argv[i].startsWith('--')) out.push(argv[i]) } return out })()
if (!LAYERS.length || !QUESTIONS.length) { console.error('Usage: node tools/ask-rest.cjs --layer "Title=<layer url>" [--layer ...] [--locator <GeocodeServer url>] [--owners] [--log] "question" ...'); process.exit(2) }
let calls = 0
function post (url, params) {
  calls++
  const args = ['-sS', '--max-time', '60', '-X', 'POST', url]
  const tmp = []
  for (const k of Object.keys(params)) {
    if (params[k] === undefined || params[k] === null) continue
    const v = typeof params[k] === 'string' ? params[k] : JSON.stringify(params[k])
    // Big values (a district's outline) go through a file: a command line has a size limit.
    if (v.length > 4000) { const f = path.join(require('node:os').tmpdir(), `mappy-real-${process.pid}-${calls}-${k}.txt`); fs.writeFileSync(f, v); tmp.push(f); args.push('--data-urlencode', `${k}@${f}`) } else args.push('--data-urlencode', `${k}=${v}`)
  }
  return new Promise((resolve, reject) => execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, out) => { for (const f of tmp) { try { fs.unlinkSync(f) } catch (e) { } } if (err) return reject(err); try { const j = JSON.parse(out); if (j.error) return reject(new Error(`${j.error.code} ${j.error.message} ${(j.error.details || []).join(' ')}`)); resolve(j) } catch (e) { reject(new Error('Not JSON: ' + out.slice(0, 200))) } }))
}
const REL = { intersects: 'esriSpatialRelIntersects', contains: 'esriSpatialRelContains', within: 'esriSpatialRelWithin', overlaps: 'esriSpatialRelOverlaps', touches: 'esriSpatialRelTouches', crosses: 'esriSpatialRelCrosses' }
const UNITS = { feet: 'esriSRUnit_Foot', meters: 'esriSRUnit_Meter', miles: 'esriSRUnit_StatuteMile', kilometers: 'esriSRUnit_Kilometer' }
const GT = { point: 'esriGeometryPoint', polygon: 'esriGeometryPolygon', polyline: 'esriGeometryPolyline', multipoint: 'esriGeometryMultipoint', extent: 'esriGeometryEnvelope' }
class RestLayer {
  constructor (id, title, url, meta) {
    Object.assign(this, { id, title, url, type: 'feature', visible: true, opacity: 1, loaded: true, definitionExpression: '', fields: meta.fields, objectIdField: (meta.fields.find(f => f.type === 'esriFieldTypeOID') || {}).name, displayField: meta.displayField, geometryType: String(meta.geometryType || '').replace('esriGeometry', '').toLowerCase(), capabilities: { query: { supportsStatistics: true, supportsOrderBy: true, supportsPagination: true } }, maxRecordCount: meta.maxRecordCount })
  }
  createQuery () { return { where: '1=1', outFields: ['*'], returnGeometry: true } }
  params (q) {
    const p = { f: 'json', where: q.where || '1=1' }
    const g = q.geometry
    if (g) {
      const { type, ...json } = g
      const kind = type || (g.rings ? 'polygon' : g.paths ? 'polyline' : 'point')
      p.geometry = JSON.stringify(json); p.geometryType = GT[kind]; p.inSR = (g.spatialReference && g.spatialReference.wkid) || 4326
      p.spatialRel = REL[q.spatialRelationship || 'intersects']
      if (!p.spatialRel) throw new Error('relation ' + q.spatialRelationship)
      if (q.distance) { p.distance = q.distance; p.units = UNITS[q.units]; if (!p.units) throw new Error('units ' + q.units) }
    }
    if (Array.isArray(q.objectIds)) p.objectIds = q.objectIds.join(',')
    if (Array.isArray(q.outStatistics) && q.outStatistics.length) p.outStatistics = JSON.stringify(q.outStatistics)
    if (Array.isArray(q.groupByFieldsForStatistics) && q.groupByFieldsForStatistics.length) p.groupByFieldsForStatistics = q.groupByFieldsForStatistics.join(',')
    if (Array.isArray(q.orderByFields) && q.orderByFields.length) p.orderByFields = q.orderByFields.join(',')
    return p
  }
  async run (kind, p) { const t0 = Date.now(); let j; try { j = await post(this.url + '/query', p) } catch (e) { if (LOG) console.log('      FAILED', this.id, kind, p.geometryType || '', String(e.message).slice(0, 200)); throw e } if (LOG) console.log(`      ${this.id}.${kind} ${p.spatialRel ? p.spatialRel.replace('esriSpatialRel', '') + (p.distance ? ' ' + p.distance + 'ft' : '') : ''} ${p.objectIds ? 'ids:' + p.objectIds.split(',').length : ''} ${p.geometryType || ""} where=${String(p.where).slice(0, 60)} ${Date.now() - t0}ms`); return j }
  async queryFeatures (q) {
    const p = this.params(q)
    p.outFields = Array.isArray(q.outFields) && q.outFields.length ? q.outFields.join(',') : (p.outStatistics ? undefined : '*')
    p.returnGeometry = !!q.returnGeometry && !p.outStatistics
    if (q.outSpatialReference) p.outSR = q.outSpatialReference.wkid || 4326
    if (q.num) p.resultRecordCount = q.num
    if (q.start) p.resultOffset = q.start
    if (q.returnDistinctValues) p.returnDistinctValues = true
    const j = await this.run('features', p)
    const sr = j.spatialReference || { wkid: 4326 }
    return { features: (j.features || []).map(f => ({ attributes: f.attributes, geometry: f.geometry ? { ...f.geometry, type: f.geometry.rings ? 'polygon' : f.geometry.paths ? 'polyline' : 'point', spatialReference: sr, extent: null } : null, layer: this })), exceededTransferLimit: !!j.exceededTransferLimit }
  }
  async queryFeatureCount (q) { const j = await this.run('count', { ...this.params(q), returnCountOnly: true }); return j.count }
  async queryObjectIds (q) { const j = await this.run('ids', { ...this.params(q), returnIdsOnly: true }); return j.objectIds || [] }
}
const locator = { addressToLocations: async (url, params) => { const j = await post(LOCATOR + '/findAddressCandidates', { f: 'json', SingleLine: Object.values(params.address || {})[0], outSR: 4326, maxLocations: params.maxLocations || 5, outFields: 'Match_addr,Addr_type' }); return (j.candidates || []).map(c => ({ address: c.address, score: c.score, location: { type: 'point', x: c.location.x, y: c.location.y, longitude: c.location.x, latitude: c.location.y, spatialReference: { wkid: 4326 } }, attributes: c.attributes })) } }
const MODULES = { 'esri/rest/locator': locator, 'esri/request': async () => ({ data: { capabilities: 'Geocode', singleLineAddressField: { name: 'SingleLine' } } }) }
const originalLoad = Module._load
Module._load = function (name, ...args) { if (name === 'jimu-core') return { loadArcGISJSAPIModules: async names => names.map(n => { if (!(n in MODULES)) throw new Error('no ' + n); return MODULES[n] }), getAppStore: () => ({ getState: () => ({}) }) }; return originalLoad.call(this, name, ...args) }

;(async () => {
  const { LiveMap } = require(path.join(SRC, 'runtime/live.ts'))
  const { Mind } = require(path.join(SRC, 'runtime/mind.ts'))
  const { MappyIndex } = require(path.join(SRC, 'brain/engine.ts'))
  const layers = []
  for (const [id, title, url] of LAYERS) layers.push(new RestLayer(id, title, url, await post(url, { f: 'json' })))
  const live = new LiveMap()
  live.jmv = { view: { map: { layers, tables: [] }, extent: {}, center: { latitude: CENTER[0], longitude: CENTER[1] }, spatialReference: { wkid: 4326 }, goTo: async () => {}, graphics: { add: () => {}, remove: () => {}, removeAll: () => {} } } }
  const mind = new Mind({ live, index: new MappyIndex(live.docs()), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'REST layers', featureSearch: true, notifyLists: process.argv.includes('--owners'), maxResults: 6, showInLayerList: false, layerListIds: [], layerListLabel: '', geocoders: LOCATOR ? [{ url: LOCATOR, name: 'Locator', singleLineFieldName: 'SingleLine' }] : [], typoFix: true, store: { get: () => null, set: () => {} } })
  for (const q of QUESTIONS) {
    const before = calls; const t0 = Date.now()
    let r
    try { r = await mind.respond(q) } catch (e) { r = { text: 'THREW ' + (e && e.stack || e) } }
    console.log(`\n> ${q}\n  [${r.mood}] ${String(r.text).split('\n\nNew stamp')[0].replace(/\n/g, ' / ').slice(0, 420)}${r.note ? `\n  note: ${r.note}` : ''}${r.table ? `\n  table: ${r.table.columns.join(' | ')} (${r.table.rows.length} rows) e.g. ${JSON.stringify(r.table.rows[0]).slice(0, 160)}` : ''}\n  (${calls - before} REST calls, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  }
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
