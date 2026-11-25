// node tests/send-place.cjs [path to the host's typescript package]
// Handing a place to another widget: which widgets the app wired to Mappy's location message,
// how a request for one is read, and the whole turn on the made-up town.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require(process.argv[2] || 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const path = require('node:path')
const Module = require('node:module')
const S = require('../src/brain/sendPlace.ts')

const tests = []
const test = (name, fn) => tests.push([name, fn])

const app = {
  widgets: {
    w1: { label: 'Mappy', uri: 'widgets/mappy/' },
    w2: { label: 'Property Report', uri: 'widgets/property-report/' },
    w3: { label: 'Property Report', uri: 'widgets/property-report/' },
    w4: { label: 'Map', uri: 'widgets/arcgis/arcgis-map/' },
    w5: { label: 'Zone Lookup', uri: 'widgets/zone-lookup/' },
    w6: { label: 'Search', uri: 'widgets/common/search/' }
  },
  messageConfigs: {
    m1: { id: 'm1', widgetId: 'w1', messageType: 'LOCATION_CHANGE', actions: [{ widgetId: 'w2', actionName: 'generateReport' }, { widgetId: 'w3', actionName: 'generateReport' }, { widgetId: 'w4', actionName: 'panTo' }] },
    m2: { id: 'm2', widgetId: 'w6', messageType: 'DATA_RECORDS_SELECTION_CHANGE', actions: [{ widgetId: 'w5', actionName: 'x' }] }
  }
}
const one = [{ ids: ['w2', 'w3'], label: 'Property Report' }]
const two = [...one, { ids: ['w5'], label: 'Zoning Report' }]

test('the wired widgets come from the app config, maps and other widgets\' wiring left out', () => {
  assert.deepEqual(S.placeTargets(app, 'w1'), one)
  assert.deepEqual(S.placeTargets(app, 'w6'), [])
  assert.deepEqual(S.placeTargets({}, 'w1'), [])
  assert.deepEqual(S.placeTargets(null, 'w1'), [])
})

test('a request for a wired widget with a place is read', () => {
  const r = t => { const x = S.readSend(t, one); return x && x.place }
  assert.equal(r('property report for 250 N 5th St'), '250 N 5th St')
  assert.equal(r('Report for 250 N 5th St?'), '250 N 5th St')
  assert.equal(r('can you run the property report on 110 Maple St'), '110 Maple St')
  assert.equal(r('give me a report for the address 110 Maple St'), '110 Maple St')
  assert.equal(r('open property report for this parcel'), 'it')
  assert.equal(r('property report here'), 'it')
  assert.equal(r('report for it'), 'it')
  assert.equal(r('tell me everything about 250 Oak St'), '250 Oak St')
  assert.equal(r('full details on that property'), 'it')
  assert.equal(r('Property Report for 39.064000, -108.550000'), '39.064000, -108.550000')
})

test('ordinary sentences and bare widget names are left alone', () => {
  for (const t of ['property report', 'open property report', 'how do I report a pothole', 'report a problem', 'parcels within 300 ft of 250 Oak St', 'who owns 250 Oak St', 'what is the property report', 'zoom to 250 Oak St', 'hello']) assert.equal(S.readSend(t, one), null, t)
  assert.equal(S.readSend('report for 250 Oak St', []), null)
})

test('with two widgets sharing a word, only the whole name picks one', () => {
  assert.equal(S.readSend('report for 250 Oak St', two), null)
  assert.equal(S.readSend('zoning report for 250 Oak St', two).target.label, 'Zoning Report')
  assert.equal(S.readSend('property report for 250 Oak St', two).target.label, 'Property Report')
  assert.equal(S.readSend('everything about 250 Oak St', two), null)
})

// ---- the town
const demo = path.join(__dirname, '..', '..', 'demo', 'src')
const haveTown = fs.existsSync(path.join(demo, 'town.ts'))
let fake = null
if (haveTown) {
  // The playground map moves with animation frames; here it jumps.
  global.cancelAnimationFrame = () => {}
  fake = require(path.join(demo, 'fakemap.ts'))
  const places = []
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const locator = { addressToLocations: async (url, params) => { const text = norm(Object.values(params?.address || {})[0]); return places.filter(p => norm(p.label) === text).map(p => ({ address: p.label, score: 100, location: new fake.Point({ x: p.lon, y: p.lat }), attributes: { Match_addr: p.label } })) } }
  const MODULES = { 'esri/Graphic': fake.Graphic, 'esri/geometry/Point': fake.Point, 'esri/geometry/Polygon': fake.Polygon, 'esri/geometry/Polyline': fake.Polyline, 'esri/rest/locator': locator, 'esri/request': async () => ({ data: { capabilities: 'Geocode', singleLineAddressField: { name: 'SingleLine' } } }), 'esri/geometry/operators/projectOperator': { isLoaded: () => true, load: async () => {}, execute: g => g }, 'esri/geometry/projection': { isLoaded: () => true, load: async () => {}, project: g => g }, 'esri/Viewpoint': { fromJSON: j => ({ scale: j?.scale, rotation: 0, targetGeometry: fake.asGeometry(j?.targetGeometry) }) } }
  const originalLoad = Module._load
  Module._load = function (name, ...args) { if (name === 'jimu-core') return { loadArcGISJSAPIModules: async names => names.map(n => { if (!(n in MODULES)) throw new Error('no stand-in for ' + n); return MODULES[n] }), getAppStore: () => ({ getState: () => ({}) }) }; return originalLoad.call(this, name, ...args) }
  fake.places = places
}

function town (extra = {}) {
  const { buildTown } = require(path.join(demo, 'town.ts'))
  const { LiveMap } = require('../src/runtime/live.ts')
  const { Mind } = require('../src/runtime/mind.ts')
  const { MappyIndex } = require('../src/brain/engine.ts')
  const t = buildTown()
  fake.places.length = 0; fake.places.push(...t.places)
  const view = new fake.FakeView(t.layers, t.start)
  const live = new LiveMap(); live.bind({ view })
  const sent = []
  const mind = new Mind({ index: new MappyIndex(live.docs()), model: {}, live, hints: new Map(), name: 'Mappy', appTitle: 'the Mapleton map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', geocoders: [{ url: 'https://demo.invalid/GeocodeServer', name: 'Mapleton addresses', singleLineFieldName: 'SingleLine' }], typoFix: true, store: { get: () => null, set: () => {} }, placeTargets: one, sendPlace: async (target, at) => { sent.push({ target, at }); return true }, ...extra })
  return { mind, sent, live }
}

if (haveTown) {
test('the whole turn: the address is found, handed over, and remembered', async () => {
  const { mind, sent } = town()
  let r = await mind.respond('property report for 250 Oak St')
  assert.equal(sent.length, 1, r.text)
  assert.equal(sent[0].target.label, 'Property Report')
  assert.ok(Number.isFinite(sent[0].at.lat) && Number.isFinite(sent[0].at.lon))
  assert.match(r.text, /^I sent \*\*250 Oak St\*\* to \*\*Property Report\*\*\./i)
  assert.ok(!(r.actions || []).some(a => a.label === 'Property Report'), 'no chip for what was just done')
  r = await mind.respond('report for it')
  assert.equal(sent.length, 2, r.text)
  assert.ok(Math.abs(sent[1].at.lat - sent[0].at.lat) < 1e-6)
})

test('finding a place offers the widget, and the chip sends that place', async () => {
  const { mind, sent } = town()
  const r = await mind.respond('where is 250 Oak St')
  const chip = (r.actions || []).find(a => a.label === 'Property Report')
  assert.ok(chip && chip.type === 'ask', JSON.stringify(r.actions))
  const r2 = await mind.respond(chip.q)
  assert.equal(sent.length, 1, r2.text)
  assert.match(r2.text, /250 Oak St/i)
})

test('nothing wired, nothing changes; a place he cannot find is said plainly', async () => {
  const a = town({ placeTargets: [] })
  const r = await a.mind.respond('where is 250 Oak St')
  assert.ok(!(r.actions || []).some(x => x.label === 'Property Report'))
  const b = town()
  const r2 = await b.mind.respond('property report for 99999 Nowhere Blvd')
  assert.equal(b.sent.length, 0)
  assert.match(r2.text, /could not find/i)
  const r3 = await b.mind.respond('property report for it')
  assert.equal(b.sent.length, 0); assert.match(r3.text, /Which place/)
})
}

;(async () => {
  let bad = 0
  for (const [name, fn] of tests) { try { await fn(); console.log('ok  ', name) } catch (e) { bad++; console.log('FAIL', name, '\n', e.message) } }
  console.log(bad ? `${bad} failed` : `${tests.length} passed`)
  process.exit(bad ? 1 : 0)
})()
