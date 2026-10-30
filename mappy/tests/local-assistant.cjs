// node tests/local-assistant.cjs [path to the host's typescript package]
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(process.argv[2] || 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const originalLoad = Module._load
let sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }
Module._load = function (name, ...args) { if (name === 'jimu-core') return { loadArcGISJSAPIModules: (...args) => sdkLoader(...args) }; return originalLoad.call(this, name, ...args) }
const { parseIntent } = require('../src/brain/intents.ts')
const { normalizeCommand, splitCommands, contextualCommand } = require('../src/brain/conversation.ts')
const { parseAnalysis, compileCondition } = require('../src/brain/analysis.ts')
const { analyzeLayer } = require('../src/runtime/analysis.ts')
const { LiveMap } = require('../src/runtime/live.ts')
const { Mind } = require('../src/runtime/mind.ts')
const { MappyIndex } = require('../src/brain/engine.ts')
const { tableCsv } = require('../src/brain/export.ts')
let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])
const fields = [
  { name: 'OBJECTID', type: 'oid' }, { name: 'ACRES', alias: 'Lot Area', type: 'double' },
  { name: 'OWNER', alias: 'Owner name', type: 'string' },
  { name: 'STATUS', type: 'integer', domain: { codedValues: [{ code: 1, name: 'Active' }] } }
]
function fixture () {
  const queries = []
  const layer = { id: 'parcels', title: 'Parcels', type: 'feature', visible: false, opacity: 1, fields, objectIdField: 'OBJECTID', displayField: 'OWNER', createQuery: () => ({ where: 'ACTIVE = 1' }), queryFeatureCount: async q => { queries.push(q); return 42 }, queryFeatures: async q => { queries.push(q); return { features: [{ attributes: { OBJECTID: 1, OWNER: 'Smith', ACRES: 5, mappy_count: 2, mappy_sum: 10, mappy_min: 4, mappy_max: 6, mappy_avg: 5 } }] } } }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [layer], tables: [] }, extent: { id: 'extent' }, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  return { layer, live, mind, queries, entry: live.entries()[0] }
}
test('polite commands and punctuation', () => {
  assert.equal(parseIntent('Mappy, could you please turn on parcels?').name, 'layerOn')
  assert.equal(normalizeCommand('please list layers'), 'list layers')
})
test('view counts strip scope from target', () => {
  assert.deepEqual(parseIntent('how many parcels in view'), { name: 'count', target: 'parcels', scope: 'view', raw: 'how many parcels in view' })
})
test('transparency is inverse opacity', () => {
  assert.equal(parseIntent('set parcels transparency to 20%').value, '80')
  assert.equal(parseIntent('set parcels opacity to 20%').value, '20')
})
test('quoted values and layer names survive planning', () => {
  assert.deepEqual(splitCommands('turn on Parks and Recreation then count it'), ['turn on Parks and Recreation', 'count it'])
  assert.deepEqual(splitCommands('find "Here then There; Inc" in parcels'), ['find "Here then There; Inc" in parcels'])
  assert.deepEqual(splitCommands("find O'Brien in parcels then list layers"), ["find O'Brien in parcels", 'list layers'])
})
test('context changes targets but never filter/search values', () => {
  assert.equal(contextualCommand('zoom to it', 'Parcels'), 'zoom to Parcels')
  assert.equal(contextualCommand('how many in view', 'Parcels'), 'count Parcels in view')
  assert.equal(contextualCommand('find it', 'Parcels'), 'find it')
  assert.equal(contextualCommand('filter parcels where owner equals it', 'Parcels'), 'filter parcels where owner equals it')
})
test('analysis scope and fields', () => {
  assert.deepEqual(parseAnalysis('summarize Lot Area in parcels in view'), { kind: 'stats', field: 'Lot Area', layer: 'parcels', inView: true })
  assert.equal(parseAnalysis('count parcels by STATUS').kind, 'group')
  assert.equal(parseAnalysis('how many parcels where ACRES > 5').kind, 'countWhere')
})
test('safe metadata and typed literals', () => {
  assert.equal(compileCondition('Lot Area >= 5', fields), 'ACRES >= 5')
  assert.equal(compileCondition('STATUS equals Active', fields), 'STATUS = 1')
  assert.equal(compileCondition("owner equals O'Brien", fields), "OWNER = 'O''Brien'")
  assert.equal(compileCondition("owner equals 'x\' OR 1=1 --'", fields), "OWNER = 'x'' OR 1=1 --'")
  assert.equal(compileCondition('owner is missing', fields), 'OWNER IS NULL')
  assert.throws(() => compileCondition('ACRES > 1 OR 1=1', fields))
  assert.throws(() => compileCondition('secret = 1', fields))
  assert.throws(() => compileCondition('owner contains %', fields))
  assert.throws(() => compileCondition('ACRES = Infinity', fields))
})
test('multi-step commands share context and undo as one transaction', async () => {
  const { mind, layer } = fixture()
  const reply = await mind.respond('turn on parcels then set it opacity to 35%')
  assert.equal(layer.visible, true)
  assert.equal(layer.opacity, 0.35)
  assert.match(reply.text, /1\./)
  assert.equal(reply.actions[0].q, 'undo')
  await mind.respond('undo')
  assert.equal(layer.visible, false)
  assert.equal(layer.opacity, 1)
})
test('undo preserves later external changes', async () => {
  const { mind, layer } = fixture()
  await mind.respond('set parcels opacity to 25%')
  layer.opacity = 0.8
  await mind.respond('undo')
  assert.equal(layer.opacity, 0.8)
})
test('failed step stops later mutations', async () => {
  const { mind, layer } = fixture()
  const result = await mind.respond('turn on parcels then set it opacity to 125% then turn off parcels')
  assert.equal(layer.visible, true)
  assert.equal(layer.opacity, 1)
  assert.match(result.text, /remaining steps were not run/)
})
test('long chains are rejected before any mutation', async () => {
  const { mind, layer } = fixture()
  await mind.respond(Array(6).fill('turn on parcels').join(' then '))
  assert.equal(layer.visible, false)
})
test('ambiguous layer titles ask before changing anything', async () => {
  const { mind, live, layer } = fixture()
  live.view.map.layers.push({ ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' })
  const reply = await mind.respond('turn on parcels')
  assert.equal(reply.mood, 'think')
  assert.equal(layer.visible, false)
  assert.equal(reply.list.length, 2)
})
test('statistics preserve definition and extent and return a table', async () => {
  const { live, entry, queries } = fixture()
  const reply = await analyzeLayer(live, entry, parseAnalysis('summarize ACRES in parcels in view'), 8)
  assert.equal(queries[0].where, 'ACTIVE = 1')
  assert.equal(queries[0].geometry, live.view.extent)
  assert.equal(queries[0].outStatistics.length, 5)
  assert.equal(reply.table.rows.length, 5)
  assert.equal(reply.table.rows[4][1], '5')
})
test('conditional counts use server count without result cap', async () => {
  const { live, entry, queries } = fixture()
  const reply = await analyzeLayer(live, entry, parseAnalysis('count parcels where ACRES > 5'), 8)
  assert.match(queries[0].where, /\(ACTIVE = 1\) AND \(ACRES > 5\)/)
  assert.match(reply.text, /42/)
  assert.equal(queries[0].num, undefined)
})
test('query setting disables new analysis paths', async () => {
  const { mind, queries } = fixture()
  mind.ctx.featureSearch = false
  const reply = await mind.respond('count parcels by STATUS')
  assert.match(reply.text, /disabled/)
  assert.equal(queries.length, 0)
})
test('hidden layers are never queried by analytics', async () => {
  const { mind, queries } = fixture()
  const reply = await mind.respond('summarize ACRES in parcels')
  assert.equal(reply.mood, 'confused')
  assert.equal(queries.length, 0)
})
test('map switch drops conversation context', async () => {
  const { mind, live } = fixture()
  await mind.respond('turn on parcels')
  live.jmv = { view: { map: { layers: [], tables: [] } } }
  const reply = await mind.respond('turn off it')
  assert.match(reply.text, /"it"/)
})
test('a map switch during a query stops the remaining command sequence', async () => {
  const { mind, live, layer } = fixture()
  layer.visible = true
  const nextLayer = { ...layer, visible: false }
  layer.queryFeatureCount = async () => { live.jmv = { view: { map: { layers: [nextLayer], tables: [] } } }; return 42 }
  const reply = await mind.respond('count parcels then turn on parcels')
  assert.match(reply.text, /active map changed/)
  assert.equal(nextLayer.visible, false)
})
test('numeric object IDs are searchable without string fields', async () => {
  const { live, layer, queries } = fixture()
  layer.visible = true
  layer.fields = [fields[0]]
  layer.displayField = 'OBJECTID'
  const results = await live.search('7', { max: 8 })
  assert.match(queries[0].where, /OBJECTID = 7/)
  assert.equal(results.length, 1)
})
test('query results flag a cap without changing the layer definition', async () => {
  const { live, layer, entry, queries } = fixture()
  layer.definitionExpression = 'ACTIVE = 1'
  const result = await analyzeLayer(live, entry, parseAnalysis('select parcels where OWNER equals Smith'), 1)
  assert.match(result.text, /result limit reached/)
  assert.equal(layer.definitionExpression, 'ACTIVE = 1')
  assert.equal(queries[0].num, 1)
})
test('non-numeric statistics offer categorical counts', async () => {
  const { live, entry } = fixture()
  await assert.rejects(() => analyzeLayer(live, entry, parseAnalysis('summarize OWNER in parcels'), 8), /not numeric/)
})
test('missing extent never silently expands a scoped analysis', async () => {
  const { live, entry, queries } = fixture()
  live.view.extent = null
  await assert.rejects(() => analyzeLayer(live, entry, parseAnalysis('count parcels by STATUS in view'), 8), /extent/)
  assert.equal(queries.length, 0)
})
test('truncated grouping is clearly labelled as partial', async () => {
  const { live, layer, entry } = fixture()
  layer.queryFeatures = async () => ({ exceededTransferLimit: true, features: [{ attributes: { STATUS: 1, mappy_count: 12 } }] })
  const result = await analyzeLayer(live, entry, parseAnalysis('count parcels by STATUS'), 8)
  assert.match(result.text, /partial results/)
  assert.equal(result.table.rows[0][0], 'Active')
})
test('layer rows select and show even when the layer is already visible', () => {
  const { mind, layer } = fixture()
  layer.visible = true
  const reply = mind.listLayers(false)
  assert.equal(reply.list[0].action.type, 'layerOn')
  assert.match(reply.list[0].action.label, /Select and show/)
})
test('show only one layer, said every which way', () => {
  for (const q of ['turn on only towers and everything else off', 'turn on just towers', 'turn on towers and everything else off', 'turn on towers and turn the rest off', 'turn everything off except towers', 'hide all layers but towers', 'show towers only', 'only show towers']) {
    const it = parseIntent(q)
    assert.equal(it.name, 'solo', q)
    assert.equal(it.target, 'towers', q)
  }
})
test('"turn on only X and everything else off" reaches the layer whole, typos and all', async () => {
  const { mind, layer } = fixture()
  const r = await mind.respond('turn on only parcels and everything else off')
  assert.match(r.text, /^Showing only \*\*/, r.text)
  assert.equal(layer.visible, true)
  assert.doesNotMatch(r.text, /I read that as/)
})
test('show-only and table phrases leave ordinary requests alone', () => {
  const { tablePhrase } = require('../src/brain/analysis.ts')
  assert.equal(parseIntent('only show me parcels').target, 'parcels')
  assert.equal(parseIntent('show only the parcels layer').name, 'solo')
  for (const q of ['just show me how to print', 'only the owner can edit this?', 'only show parcels where acres > 5']) assert.notEqual(parseIntent(q).name, 'solo', q)
  for (const q of ['open the table of contents', 'table of contents', 'show the results in a table']) assert.equal(tablePhrase(q), null, q)
})
test('plain show and select layer commands enable the layer', () => {
  assert.equal(parseIntent('show me parcels layer').name, 'layerOn')
  assert.equal(parseIntent('select layer parcels').name, 'layerOn')
})
test('table browsing uses stable order, typed values and bounded pages', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  layer.queryFeatures = async q => { queries.push(q); return { features: Array.from({ length: 9 }, (_, i) => ({ attributes: { OBJECTID: (q.start || 0) + i + 1, OWNER: 'Owner ' + i, ACRES: 2, STATUS: 1 } })) } }
  const first = await mind.respond('show table parcels')
  assert.equal(first.table.rows.length, 8)
  assert.equal(first.table.rows[0][2], 'Active', 'object ids are not shown')
  assert.equal(queries[0].returnGeometry, false)
  assert.deepEqual(queries[0].orderByFields, ['OBJECTID ASC'])
  const next = await mind.respond('next page')
  assert.equal(queries[1].start, 8)
  assert.match(next.text, /rows 9/)
  await mind.respond('previous page')
  assert.equal(queries[2].start, 0)
})
test('repeat returns the answer without rerunning the query', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  const first = await mind.respond('count parcels')
  const repeated = await mind.respond('say that again')
  assert.equal(repeated.text, first.text)
  assert.equal(queries.length, 1)
})
test('new chat clears table pagination state', async () => {
  const { mind, layer } = fixture()
  layer.visible = true
  await mind.respond('show table parcels')
  await mind.respond('forget context')
  const reply = await mind.respond('next page')
  assert.match(reply.text, /Open a table first/)
})
test('table CSV quotes delimiters and neutralizes formulas', () => {
  const csv = tableCsv(['Owner', 'Value'], [['Smith, Jane', '=HYPERLINK("bad")'], ['A\nB', '42']])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"Smith, Jane"'))
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'))
  assert.ok(csv.includes('"A\nB","42"'))
})
test('standalone table conditions return readable rows without zoom actions', async () => {
  const { live, entry, queries } = fixture()
  entry.isTable = true
  const reply = await analyzeLayer(live, entry, parseAnalysis('filter parcels where ACRES > 1'), 8)
  assert.ok(reply.table)
  assert.equal(reply.results, undefined)
  assert.equal(queries[0].returnGeometry, false)
})
test('service row caps do not skip records on the next page', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  layer.queryFeatures = async q => { queries.push(q); return { exceededTransferLimit: true, features: Array.from({ length: 3 }, (_, i) => ({ attributes: { OBJECTID: (q.start || 0) + i + 1 } })) } }
  await mind.respond('show table parcels')
  await mind.respond('next page')
  assert.equal(queries[1].start, 3)
})
test('natural numeric requests resolve to metadata-backed summaries', () => {
  assert.equal(parseAnalysis('what is the average acres in parcels').kind, 'stats')
  assert.equal(parseAnalysis('total acres in parcels in view').inView, true)
})
test('filtered summaries keep authored filters and extent', async () => {
  const { live, entry, queries } = fixture()
  const reply = await analyzeLayer(live, entry, parseAnalysis('summarize acres in parcels where STATUS equals Active in view'), 8)
  assert.match(queries[0].where, /\(ACTIVE = 1\) AND \(STATUS = 1\)/)
  assert.equal(queries[0].geometry.id, 'extent')
  assert.equal(queries[0].outStatistics.length, 5)
  assert.ok(reply.table)
})
test('ranked rows resolve aliases, sort stably and respect the app cap', async () => {
  const { live, entry, queries } = fixture()
  const reply = await analyzeLayer(live, entry, parseAnalysis('top 20 parcels by Lot Area'), 8)
  assert.deepEqual(queries[0].orderByFields, ['ACRES DESC', 'OBJECTID ASC'])
  assert.equal(queries[0].num, 9)
  assert.equal(reply.page.hasNext, false)
  assert.match(reply.text, /limits each result to 8/)
  await assert.rejects(() => analyzeLayer(live, entry, parseAnalysis('top 3 parcels by unknown'), 8), /Which one do you mean/)
})
test('filtered table pagination retains the same condition', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  layer.queryFeatures = async q => { queries.push(q); return { exceededTransferLimit: true, features: [{ attributes: { OBJECTID: 1 } }] } }
  await mind.respond('show table parcels where STATUS equals Active')
  await mind.respond('next page')
  assert.equal(queries.length, 2)
  assert.equal(queries[1].where, queries[0].where)
  assert.match(queries[1].where, /STATUS = 1/)
})
test('layer diagnosis reports actual visibility and offers recovery', async () => {
  const { mind, layer } = fixture()
  layer.opacity = 0
  const reply = await mind.respond("why can't I see parcels?")
  assert.match(reply.text, /turned off/)
  assert.match(reply.text, /zero opacity/)
  assert.ok(reply.actions.some(a => a.type === 'layerOn'))
})
test('natural wrappers preserve supported commands', () => {
  assert.equal(parseIntent('I want to show parcels layer').name, 'layerOn')
  assert.equal(normalizeCommand('help me find Main St'), 'find Main St')
})
test('automatic map choice never guesses between maps or replaces selection', () => {
  const { defaultMapIds } = require('../src/setting/setup.ts')
  const app = { widgets: { a: { uri: 'widgets/arcgis/map/' }, b: { uri: 'widgets/mappy/' } } }
  assert.deepEqual(defaultMapIds(app, []), ['a'])
  assert.equal(defaultMapIds(app, ['custom']), null)
  app.widgets.b.uri = 'widgets/arcgis/map/'
  assert.equal(defaultMapIds(app, []), null)
  assert.equal(defaultMapIds({}, []), null)
})
test('natural address prompts preserve street and city text', () => {
  const { addressPrompt } = require('../src/brain/addresses.ts')
  assert.equal(addressPrompt('Please could you take me to 250 North 5th Street, Grand Junction?'), '250 North 5th Street, Grand Junction')
  assert.equal(addressPrompt('find the address of City Hall'), 'City Hall')
  assert.equal(addressPrompt('take me to the address 123 Main St'), '123 Main St')
  assert.equal(addressPrompt('123 Main St'), '123 Main St')
  for (const q of ['count parcels', 'find 12345', 'zoom to 39.1, -108.5', 'what can you do?']) assert.equal(addressPrompt(q), null)
})
test('context never replaces a quoted filter value and keeps view-count scope', async () => {
  assert.equal(contextualCommand('summarize acres in it where OWNER equals it', 'Parcels'), 'summarize acres in Parcels where OWNER equals it')
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('how many parcels in view')
  await mind.respond('what about parcels')
  assert.equal(queries[1].geometry.id, 'extent')
})
test('configured locator discovery respects authored restrictions and has no public fallback', () => {
  const { configuredGeocoders } = require('../src/brain/addresses.ts')
  const url = 'https://example.test/arcgis/rest/services/City/GeocodeServer'
  const app = { widgets: { search: { uri: 'widgets/search-custom/', config: { customConfig: { sources: [{ url, name: 'City', countryCode: 'US', withinViewEnabled: true }, { url: 'https://bad.test/FeatureServer' }] } } } } }
  const result = configuredGeocoders(app, { helperServices: { geocode: [{ url: 'https://other.test/GeocodeServer' }] } })
  assert.equal(result.length, 1); assert.equal(result[0].url, url); assert.equal(result[0].withinViewEnabled, true)
  assert.deepEqual(configuredGeocoders({}, {}), [])
  assert.deepEqual(configuredGeocoders({}, { helperServices: { geocode: [{ url, geosearch: false }] } }), [])
})
test('geocoder uses the metadata single-line field, restrictions and service candidate geometry', async () => {
  const { geocodeAddress } = require('../src/runtime/geocoder.ts')
  let sent
  const result = await geocodeAddress('123 Main', [{ url: 'https://city.test/GeocodeServer', name: 'City', countryCode: 'US', categories: ['Address'], withinViewEnabled: true, suffix: 'Grand Junction' }], { extent: { id: 'extent' }, spatialReference: { wkid: 3857 } }, async () => [
    { addressToLocations: async (url, params) => { sent = params; return [{ address: '123 Main St', score: 98, location: { x: 1, y: 2 } }] } },
    async () => ({ data: { singleLineAddressField: { name: 'StreetAddress' } } })
  ])
  assert.equal(sent.address.StreetAddress, '123 Main Grand Junction'); assert.equal(sent.countryCode, 'US')
  assert.deepEqual(sent.categories, ['Address']); assert.equal(sent.searchExtent.id, 'extent')
  assert.equal(result.results[0].label, '123 Main St'); assert.equal(result.failed, 0)
})
test('address choices require selection, stay on the originating map and expire', async () => {
  const { mind, live } = fixture()
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  sdkLoader = async () => [{ addressToLocations: async () => [1, 2].map(i => ({ address: `${i} Main St`, score: 99, location: { x: i, y: 2 } })) }, {}]
  let shown = 0
  live.showAddress = async p => { shown = p.x; return true }
  const reply = await mind.respond('take me to 123 Main St')
  assert.equal(shown, 0); assert.equal(reply.list.length, 2)
  await mind.respond('show the second result'); assert.equal(shown, 2)
  live.jmv = { view: { map: { layers: [], tables: [] } } }
  const stale = await mind.respond(reply.list[0].action.q)
  assert.match(stale.text, /no longer available/); assert.equal(shown, 2)
})
test('named layer search never sends an address to the geocoder', async () => {
  const { mind, live, layer } = fixture()
  layer.visible = true
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City' }]
  let searched
  live.search = async term => { searched = term; return [] }
  sdkLoader = async () => { throw new Error('Must not geocode a scoped feature search') }
  await mind.respond('find 123 Main St in parcels')
  assert.equal(searched, '123 Main St')
})
test('disabled address queries and missing locators explain the issue', async () => {
  const { mind } = fixture()
  assert.match((await mind.respond('find address 123 Main St')).text, /No address locator/)
  mind.ctx.featureSearch = false
  assert.match((await mind.respond('find address 123 Main St')).text, /disabled/)
})
test('unique high-score addresses zoom and no-match responses do not', async () => {
  const { mind, live } = fixture()
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  let moved = 0
  live.showAddress = async () => { moved++; return true }
  sdkLoader = async () => [{ addressToLocations: async () => [{ address: '123 Main St', score: 100, location: { x: 1, y: 2 } }] }, {}]
  assert.match((await mind.respond('find address 123 Main St')).text, /Showing/)
  assert.equal(moved, 1)
  assert.match((await mind.respond('zoom to it')).text, /Showing/)
  assert.equal(moved, 2)
  sdkLoader = async () => [{ addressToLocations: async () => [] }, {}]
  assert.match((await mind.respond('find address 999 Main St')).text, /No address matched/)
  assert.equal(moved, 2)
})
test('map changes during geocoding discard candidates without moving either map', async () => {
  const { mind, live } = fixture()
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  live.showAddress = async () => { throw new Error('Must not navigate after map change') }
  sdkLoader = async () => [{ addressToLocations: async () => {
    live.jmv = { view: { map: { layers: [], tables: [] } } }
    return [{ address: '123 Main St', score: 100, location: { x: 1, y: 2 } }]
  } }, {}]
  assert.match((await mind.respond('find address 123 Main St')).text, /map changed/i)
})
test('locator failure is reported rather than fabricated as no match', async () => {
  const { mind } = fixture()
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  sdkLoader = async () => [{ addressToLocations: async () => { throw new Error('Service unavailable') } }, {}]
  assert.match((await mind.respond('find address 123 Main St')).text, /could not complete/)
})
test('low-score singleton addresses require a choice and address chains do not guess', async () => {
  const { mind, live } = fixture()
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  live.showAddress = async () => { throw new Error('Low score must not auto-navigate') }
  sdkLoader = async () => [{ addressToLocations: async () => [{ address: '123 Main St', score: 55, location: { x: 1, y: 2 } }] }, {}]
  assert.equal((await mind.respond('find address 123 Main St')).list.length, 1)
  assert.match((await mind.respond('find address 123 Main St then zoom to it')).text, /on its own/)
})
test('conversational result numbers do not capture street addresses', () => {
  const { resultNumber, addressPlace } = require('../src/brain/addresses.ts')
  for (const q of ['the second one', 'use number 2', 'pick the 2nd match', '2', 'show the second result']) assert.equal(resultNumber(q), 2)
  assert.equal(resultNumber('250 North 5th Street'), null)
  assert.equal(addressPlace('Actually, in Fruita'), 'Fruita')
  assert.equal(addressPlace('in view'), null)
})
test('city refinements replace prior refinements without losing the original street', async () => {
  const { mind } = fixture()
  const queries = []
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  sdkLoader = async () => [{ addressToLocations: async (_, q) => { queries.push(q.address.SingleLine); return [] } }, {}]
  await mind.respond('find address 123 Main St')
  await mind.respond('in Grand Junction')
  await mind.respond('actually, in Fruita')
  assert.deepEqual(queries, ['123 Main St', '123 Main St, Grand Junction', '123 Main St, Fruita'])
  await mind.respond('no, 125 Main Street')
  await mind.respond('in Fruita')
  assert.equal(queries[3], '125 Main Street')
  assert.equal(queries[4], '125 Main Street, Fruita')
})
test('thanks preserves address choices, while a new topic expires them', async () => {
  const { mind, live } = fixture()
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  sdkLoader = async () => [{ addressToLocations: async () => [1, 2].map(i => ({ address: `${i} Main`, score: 90, location: { x: i, y: 1 } })) }, {}]
  let shown = 0
  live.showAddress = async p => { shown = p.x; return true }
  const reply = await mind.respond('123 Main St')
  await mind.respond('thanks')
  await mind.respond('the second one')
  assert.equal(shown, 2)
  await mind.respond('list layers')
  assert.match((await mind.respond(reply.list[0].action.q)).text, /no longer available/)
})
test('a city correction cannot bypass the prompt-length or map-context guards', async () => {
  const { mind, live } = fixture()
  let calls = 0
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  sdkLoader = async () => [{ addressToLocations: async () => { calls++; return [] } }, {}]
  await mind.respond('123 Main St')
  assert.match((await mind.respond('in ' + 'x'.repeat(2000))).text, /2,000/)
  assert.equal(calls, 1)
  live.jmv = { view: { map: { layers: [], tables: [] } } }
  await mind.respond('in Fruita')
  assert.equal(calls, 1)
})
test('everyday filter and ranking phrases resolve without SQL wording', () => {
  const request = parseAnalysis('show me parcels with acres over 5 in view')
  assert.equal(request.kind, 'filter'); assert.equal(request.layer, 'parcels'); assert.equal(request.condition, 'acres over 5'); assert.equal(request.inView, true)
  assert.equal(parseAnalysis('how many parcels with acres is more than 5').kind, 'countWhere')
  const ranked = parseAnalysis('show me the 5 largest parcels by Lot Area')
  assert.equal(ranked.kind, 'browse'); assert.equal(ranked.order, 'desc'); assert.equal(ranked.limit, 5)
  assert.equal(parseAnalysis('3 smallest parcels by acres').order, 'asc')
})
test('natural comparisons, grouped numbers and numeric ranges remain typed', () => {
  assert.equal(compileCondition('acres is more than 5', fields), 'ACRES > 5')
  assert.equal(compileCondition('acres under 1,250.5', fields), 'ACRES < 1250.5')
  assert.equal(compileCondition('acres is at least 2', fields), 'ACRES >= 2')
  assert.equal(compileCondition('acres is between 5 and 10', fields), '(ACRES >= 5 AND ACRES <= 10)')
  assert.throws(() => compileCondition('acres between 10 and 5', fields), /lower value/)
  assert.throws(() => compileCondition('owner between 5 and 10', fields), /numeric/)
  assert.throws(() => compileCondition('acres over 12,34', fields), /finite number/)
  assert.throws(() => compileCondition('acres over 5 OR 1=1', fields), /finite number/)
})
test('filter delimiter recognition preserves quoted layer names and literal text', () => {
  const request = parseAnalysis('show table "Parcels with Easements" where OWNER equals "Somewhere with Trees"')
  assert.equal(request.layer, 'Parcels with Easements')
  assert.equal(request.condition, 'OWNER equals "Somewhere with Trees"')
  assert.equal(compileCondition(request.condition, fields), "OWNER = 'Somewhere with Trees'")
  assert.equal(contextualCommand('show it with owner equals it', 'Parcels'), 'show Parcels with owner equals it')
})
test('matching-count and table follow-ups preserve the filter and map extent', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('show parcels with acres over 5 in view')
  await mind.respond('how many of those?')
  await mind.respond('show them in a table')
  assert.equal(queries.length, 3)
  for (const query of queries) { assert.equal(query.where, '(ACTIVE = 1) AND (ACRES > 5)'); assert.equal(query.geometry.id, 'extent') }
  assert.equal(queries[2].returnGeometry, false)
})
test('ranked follow-ups report the displayed subset without counting the whole layer', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('show the 5 largest parcels by acres')
  const reply = await mind.respond('how many of those?')
  assert.match(reply.text, /showed 1 ranked row/)
  assert.equal(queries.length, 1)
})
test('failed new analyses and clear-results commands cannot reuse stale verbal selections', async () => {
  const { mind, layer } = fixture()
  layer.visible = true
  const first = await mind.respond('show parcels with acres over 5')
  assert.ok(first.suggest.includes('How many of those?'))
  await mind.respond('show parcels with missing_field over 5')
  assert.match((await mind.respond('show the first result')).text, /no result with that number/)
  await mind.respond('show parcels with acres over 5')
  await mind.respond('clear results')
  assert.match((await mind.respond('show the first result')).text, /no result with that number/)
})
test('data exploration creates runnable metadata-backed ideas without reading records', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  assert.equal(parseIntent('what can I ask about parcels?').name, 'dataIdeas')
  const reply = await mind.respond('explore parcels')
  assert.equal(queries.length, 0)
  assert.ok(reply.list.some(r => r.label === 'Summarize Lot Area'))
  assert.ok(reply.list.some(r => r.label === 'Find Active records'))
  const idea = reply.list.find(r => r.label === 'Summarize Lot Area')
  const result = await mind.respond(idea.action.q)
  assert.ok(result.table); assert.equal(queries.length, 1)
})
test('data ideas respect statistics, ordering and standalone table capabilities', () => {
  const { dataIdeas } = require('../src/brain/ideas.ts')
  const ideas = dataIdeas('parcels', fields, { table: true, statistics: false, order: false })
  assert.ok(!ideas.some(i => /summarize|top 5|in view| by /i.test(i.query)))
  assert.ok(ideas.some(i => i.query === 'show table parcels'))
  assert.ok(!dataIdeas('parcels', [{ name: 'OBJECTID', type: 'oid' }]).some(i => /summarize|top 5/.test(i.query)))
})
test('exploration does not bypass hidden layers or disabled queries', async () => {
  const { mind, layer, queries } = fixture()
  assert.match((await mind.respond('explore parcels')).text, /isn't drawing/)
  layer.visible = true; mind.ctx.featureSearch = false
  const reply = await mind.respond('give me ideas for parcels')
  assert.match(reply.text, /queries are disabled/)
  assert.equal(reply.list, undefined)
  assert.equal(queries.length, 0)
})
test('explore data uses actual available layer names', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  const reply = await mind.respond('explore data')
  assert.equal(reply.list.length, 1)
  assert.match(reply.list[0].label, /Parcels/)
  assert.equal(queries.length, 0)
})
test('layer clarification resumes the original action on only the chosen layer and remains undoable', async () => {
  const { mind, live, layer } = fixture()
  const second = { ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' }
  live.view.map.layers.push(second)
  const reply = await mind.respond('turn on parcels')
  assert.equal(reply.mood, 'think')
  await mind.respond('the second one')
  // ArcGIS lists layers in reverse draw order: the original layer is row two.
  assert.equal(layer.visible, true); assert.equal(second.visible, false)
  await mind.respond('undo')
  assert.equal(layer.visible, false)
})
test('layer clarification never rewrites a field with the same name as the layer', async () => {
  const { mind, live, layer, queries } = fixture()
  layer.visible = true; layer.fields = [{ name: 'parcels', type: 'double' }]
  live.view.map.layers.push({ ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' })
  const choice = await mind.respond('summarize parcels in parcels')
  assert.equal(choice.mood, 'think')
  await mind.respond(choice.list[1].action.q)
  assert.equal(queries[0].outStatistics[0].onStatisticField, 'parcels')
})
test('cancel and map changes invalidate old layer-choice buttons', async () => {
  const { mind, live, layer } = fixture()
  live.view.map.layers.push({ ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' })
  const choice = await mind.respond('turn on parcels')
  assert.match((await mind.respond('cancel')).text, /Cancelled/)
  assert.match((await mind.respond(choice.list[0].action.q)).text, /unavailable/)
  const next = await mind.respond('turn on parcels')
  live.jmv = { view: { map: { layers: [layer], tables: [] } } }
  assert.match((await mind.respond(next.list[0].action.q)).text, /unavailable/)
  assert.equal(layer.visible, false)
})
test('clarifying a step never silently resumes the rest of a stopped command chain', async () => {
  const { mind, live, layer } = fixture()
  const second = { ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' }
  live.view.map.layers.push(second)
  await mind.respond('turn on parcels then set it opacity to 20%')
  await mind.respond('choose number 2')
  assert.equal(layer.visible, true); assert.equal(layer.opacity, 1); assert.equal(second.visible, false)
})
test('a full layer path can answer the clarification', async () => {
  const { mind, live, layer } = fixture()
  const second = { ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' }
  live.view.map.layers = [
    { id: 'north', title: 'North', type: 'group', visible: true, layers: [layer] },
    { id: 'south', title: 'South', type: 'group', visible: true, layers: [second] }
  ]
  await mind.respond('turn on parcels')
  await mind.respond('South > Parcels')
  assert.equal(layer.visible, false); assert.equal(second.visible, true)
})
test('asynchronous scoped searches clarify layers without changing the search text', async () => {
  const { mind, live, layer } = fixture()
  layer.visible = true
  live.view.map.layers.push({ ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' })
  let term
  live.search = async text => { term = text; return [] }
  const reply = await mind.respond('find Parcels in parcels')
  assert.equal(reply.mood, 'think')
  await mind.respond('the first one')
  assert.equal(term, 'Parcels')
})
test('removed layers cannot be activated through an old clarification', async () => {
  const { mind, live, layer } = fixture()
  const second = { ...layer, id: 'second', url: 'https://example.test/FeatureServer/1' }
  live.view.map.layers.push(second)
  const reply = await mind.respond('turn on parcels')
  live.view.map.layers = [layer]
  assert.match((await mind.respond(reply.list[0].action.q)).text, /no longer in the map/)
  assert.equal(layer.visible, false)
})
test('natural sorting accepts aliases and alphabetical directions', () => {
  const { analysisFollowup } = require('../src/brain/analysis.ts')
  const previous = parseAnalysis('show table parcels where STATUS equals Active')
  const request = parseAnalysis(analysisFollowup('sort by Owner name A to Z', previous))
  assert.equal(request.field, 'Owner name'); assert.equal(request.order, 'asc'); assert.equal(request.condition, 'STATUS equals Active')
  assert.equal(parseAnalysis(analysisFollowup('sort by acres highest first', previous)).order, 'desc')
})
test('sorted paging preserves ordering, filter, stable ID tie-breaker and page offsets', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  layer.queryFeatures = async q => { queries.push(q); return { exceededTransferLimit: true, features: Array.from({ length: 9 }, (_, i) => ({ attributes: { OBJECTID: i + 1, ACRES: 10 } })) } }
  await mind.respond('show table parcels where STATUS equals Active')
  await mind.respond('sort by acres descending')
  await mind.respond('show more')
  await mind.respond('back a page')
  for (const query of queries.slice(1)) {
    assert.deepEqual(query.orderByFields, ['ACRES DESC', 'OBJECTID ASC'])
    assert.equal(query.where, '(ACTIVE = 1) AND (STATUS = 1)')
  }
  assert.equal(queries[2].start, 8); assert.equal(queries[3].start, 0)
  await mind.respond('reverse the order')
  assert.deepEqual(queries[4].orderByFields, ['ACRES ASC', 'OBJECTID ASC'])
  assert.equal(queries[4].start, 0)
})
test('sorting keeps current-view scope and refuses unsupported or unknown fields', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('show table parcels in view')
  await mind.respond('sort by acres descending')
  assert.equal(queries[1].geometry.id, 'extent')
  assert.match((await mind.respond('sort by missing_field descending')).text, /Which one do you mean/)
  assert.equal(queries.length, 2)
  layer.capabilities = { query: { supportsOrderBy: false } }
  assert.match((await mind.respond('show table parcels sorted by acres desc')).text, /does not support sorted/)
  assert.equal(queries.length, 2)
})
test('sorting follow-ups never silently expand a ranked subset or sort aggregate output as raw data', () => {
  const { analysisFollowup } = require('../src/brain/analysis.ts')
  assert.equal(analysisFollowup('sort by owner A to Z', parseAnalysis('top 5 parcels by acres')), null)
  assert.equal(analysisFollowup('sort by acres descending', parseAnalysis('summarize acres in parcels')), null)
})
test('quality prompts preserve conditions and current-view scope', () => {
  const q = parseAnalysis("what's missing in parcels where STATUS equals Active in view")
  assert.equal(q.kind, 'quality'); assert.equal(q.layer, 'parcels'); assert.equal(q.condition, 'STATUS equals Active'); assert.equal(q.inView, true)
})
test('quality uses complete aggregate counts rather than sampling visible rows', async () => {
  const { live, layer, entry, queries } = fixture()
  layer.queryFeatures = async q => { queries.push(q); return { features: [{ attributes: { mappy_total: 1000, mappy_f0: 750, mappy_f1: 1000, mappy_f2: 500 } }] } }
  const reply = await analyzeLayer(live, entry, parseAnalysis('check data quality for parcels where STATUS equals Active in view'), 8)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].where, '(ACTIVE = 1) AND (STATUS = 1)')
  assert.equal(queries[0].geometry.id, 'extent'); assert.equal(queries[0].returnGeometry, false)
  assert.equal(queries[0].num, undefined); assert.equal(queries[0].outStatistics.length, 4)
  assert.deepEqual(reply.table.rows[0], ['Status', '500', '500', '50.0%'], 'field names shown readable')
  assert.match(reply.text, /empty strings/)
})
test('empty and inconsistent quality results never become false completeness claims', async () => {
  const { live, layer, entry } = fixture()
  const request = parseAnalysis('check missing values in parcels')
  layer.queryFeatures = async () => ({ features: [{ attributes: { mappy_total: 0, mappy_f0: 0, mappy_f1: 0, mappy_f2: 0 } }] })
  const empty = await analyzeLayer(live, entry, request, 8)
  assert.ok(empty.table.rows.every(row => row[3] === 'N/A'))
  layer.queryFeatures = async () => ({ features: [{ attributes: { mappy_total: 2, mappy_f0: 3 } }] })
  await assert.rejects(() => analyzeLayer(live, entry, request, 8), /inconsistent/)
  layer.queryFeatures = async () => ({ exceededTransferLimit: true, features: [] })
  await assert.rejects(() => analyzeLayer(live, entry, request, 8), /partial statistics/)
})
test('quality is bounded to twelve fields and honors query capability', async () => {
  const { live, layer, entry } = fixture()
  layer.fields = [fields[0], ...Array.from({ length: 20 }, (_, i) => ({ name: `F${i}`, type: 'string' }))]
  layer.queryFeatures = async q => ({ features: [{ attributes: Object.fromEntries(q.outStatistics.map(s => [s.outStatisticFieldName, 10])) }] })
  const reply = await analyzeLayer(live, entry, parseAnalysis('data quality for parcels'), 8)
  assert.equal(reply.table.rows.length, 12); assert.match(reply.text, /12 of 20 supported/)
  layer.capabilities = { query: { supportsStatistics: false } }
  await assert.rejects(() => analyzeLayer(live, entry, parseAnalysis('data quality for parcels'), 8), /does not support statistics/)
})
test('quality drill-downs do not discard an existing filter or imply a combined null count', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  layer.queryFeatures = async q => { queries.push(q); return { features: [{ attributes: { mappy_total: 10, mappy_f0: 8, mappy_f1: 5, mappy_f2: 10 } }] } }
  const filtered = await mind.respond('check data quality for parcels where STATUS equals Active')
  assert.equal(filtered.actions.length, 1)
  assert.match(filtered.actions[0].q, /where STATUS equals Active/)
  assert.match((await mind.respond('how many of those?')).text, /separately for each field/)
  assert.equal(queries.length, 1)
  const whole = await mind.respond('check data quality for parcels in view')
  assert.ok(whole.actions.some(a => /OWNER is null in view/.test(a.q || '')))
})
test('incomplete layer commands collect a target before acting', async () => {
  const { mind, layer, queries } = fixture()
  const prompt = await mind.respond('please turn on a layer')
  assert.equal(prompt.mood, 'think')
  assert.equal(prompt.list.length, 1)
  assert.equal(layer.visible, false)
  await mind.respond('Parcels')
  assert.equal(layer.visible, true)
  await mind.respond('turn off a layer')
  await mind.respond('the first one')
  assert.equal(layer.visible, false)
  await mind.respond('select a layer')
  await mind.respond('1')
  assert.equal(layer.visible, true)
  await mind.respond('show table')
  assert.equal(queries.length, 0)
  const table = await mind.respond('Parcels')
  assert.ok(table.table)
  assert.equal(queries.length, 1)
})

test('incomplete layer choices expire on cancel, map changes, and new requests', async () => {
  const { mind, live, layer } = fixture()
  const choice = await mind.respond('turn on a layer')
  await mind.respond('cancel')
  await mind.respond(choice.list[0].action.q)
  assert.equal(layer.visible, false)
  const next = await mind.respond('turn on a layer')
  live.jmv = { view: { ...live.view } }
  await mind.respond(next.list[0].action.q)
  assert.equal(layer.visible, false)
  const other = await mind.respond('turn on a layer')
  await mind.respond('list layers')
  await mind.respond(other.list[0].action.q)
  assert.equal(layer.visible, false)
})

test('layer choices search beyond the first eight and preserve the intended action', async () => {
  const { mind, live, layer } = fixture()
  const layers = Array.from({ length: 12 }, (_, i) => ({ ...layer, id: 'layer' + i, title: i === 0 ? 'Storm Drains' : 'District ' + i, visible: false }))
  live.jmv.view.map.layers = layers
  const prompt = await mind.respond('turn on a layer')
  assert.equal(prompt.list.length, 8)
  assert.ok(!prompt.list.some(row => row.label.includes('Storm Drains')))
  await mind.respond('choose storm')
  assert.equal(layers[0].visible, true)
  assert.equal(layers.filter(l => l.visible).length, 1)
})

test('layer names narrow in stages, and an unknown answer keeps the pending action', async () => {
  const { mind, live, layer } = fixture()
  const north = { ...layer, id: 'north', title: 'North Storm Drains', visible: false }
  const south = { ...layer, id: 'south', title: 'South Storm Drains', visible: false }
  live.jmv.view.map.layers = [north, south, { ...layer, id: 'roads', title: 'Roads', visible: false }]
  const original = await mind.respond('turn on a layer')
  const narrowed = await mind.respond('choose storm')
  assert.equal(narrowed.list.length, 2)
  await mind.respond(original.list[0].action.q)
  assert.equal(north.visible, false)
  assert.equal(south.visible, false)
  const retry = await mind.respond('choose nonexistent')
  assert.match(retry.text, /could not match/)
  assert.equal(retry.list.length, 2)
  await mind.respond('the north one')
  assert.equal(north.visible, true)
  assert.equal(south.visible, false)
})

test('layer follow-ups preserve names, values and filters', () => {
  for (const q of ['hide it', 'turn it off']) assert.equal(contextualCommand(q, 'Parcels'), 'turn off Parcels')
  for (const q of ['show it', 'turn it back on']) assert.equal(contextualCommand(q, 'Parcels'), 'turn on Parcels')
  assert.equal(contextualCommand('show its table', 'Parcels'), 'show table Parcels')
  assert.equal(contextualCommand('list its fields', 'Parcels'), 'fields in Parcels')
  assert.equal(contextualCommand('explore it', 'Parcels'), 'explore Parcels')
  for (const q of ['find hide it in parcels', 'show parcels where OWNER equals show it', 'hide it']) assert.equal(contextualCommand(q), q)
  assert.equal(contextualCommand('show parcels where OWNER equals hide it', 'Roads'), 'show parcels where OWNER equals hide it')
})

test('clicking a layer before any chat establishes memory for subsequent requests', async () => {
  const { mind, layer, entry, queries } = fixture()
  await mind.act({ type: 'layerOn', id: entry.key })
  assert.equal(layer.visible, true)
  await mind.respond('hide it')
  assert.equal(layer.visible, false)
  await mind.respond('turn it back on')
  assert.equal(layer.visible, true)
  assert.ok((await mind.respond('show its table')).table)
  assert.equal(queries.length, 1)
})

test('layer button memory follows the selected layer and expires across maps', async () => {
  const { mind, live, layer, entry } = fixture()
  await mind.act({ type: 'solo', id: entry.key })
  await mind.respond('hide it')
  assert.equal(layer.visible, false)
  await mind.respond('turn it back on')
  live.jmv = { view: { ...live.view } }
  await mind.respond('hide it')
  assert.equal(layer.visible, true)
})

test('natural table and count follow-ups retain the filter and view extent', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('show parcels with acres over 5 in view')
  await mind.respond('show its table')
  await mind.respond('how many matched?')
  await mind.respond('show matching rows')
  assert.equal(queries.length, 4)
  for (const query of queries) {
    assert.equal(query.where, '(ACTIVE = 1) AND (ACRES > 5)')
    assert.equal(query.geometry.id, 'extent')
  }
})

test('table follow-ups keep ordering and do not expand ranked or quality results', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('show table parcels sorted by ACRES desc where ACRES over 5')
  await mind.respond('show its table')
  assert.deepEqual(queries[1].orderByFields, queries[0].orderByFields)
  assert.equal(queries[1].where, queries[0].where)
  await mind.respond('top 5 parcels by ACRES')
  const before = queries.length
  assert.match((await mind.respond('show its table')).text, /ranked or summarized/)
  await mind.respond('how many matched?')
  assert.equal(queries.length, before)
})

test('data tasks expose editable scope, filters, and sorting without losing authored filters', async () => {
  const { mind, layer, queries } = fixture()
  layer.visible = true
  await mind.respond('show table parcels sorted by ACRES desc where ACRES over 5')
  assert.equal(mind.task().layer, 'Parcels')
  assert.equal(mind.task().filter, 'ACRES over 5')
  const click = label => mind.respond(mind.task().actions.find(a => a.label === label).command)
  await click('Use current view')
  assert.equal(queries.at(-1).geometry.id, 'extent')
  assert.equal(queries.at(-1).where, '(ACTIVE = 1) AND (ACRES > 5)')
  await click('Count matches')
  await click('Show matching rows')
  assert.deepEqual(queries.at(-1).orderByFields, ['ACRES DESC', 'OBJECTID ASC'])
  assert.equal(queries.at(-1).geometry.id, 'extent')
  await click('Remove my filter')
  assert.equal(queries.at(-1).where, 'ACTIVE = 1')
  assert.equal(queries.at(-1).geometry.id, 'extent')
  assert.equal(mind.task().filter, 'No additional filter')
  await mind.respond('use whole layer')
  assert.equal(queries.at(-1).geometry, undefined)
  assert.deepEqual(queries.at(-1).orderByFields, ['ACRES DESC', 'OBJECTID ASC'])
})

test('task revisions reject stale controls and retain last successful state on failure', async () => {
  const { mind, layer, queries, live } = fixture()
  layer.visible = true
  await mind.respond('show table parcels where ACRES over 5')
  const first = mind.task()
  await mind.respond(first.actions[0].command)
  const n = queries.length
  assert.match((await mind.respond(first.actions[0].command)).text, /changed or is no longer/)
  assert.equal(queries.length, n)
  const successful = mind.task()
  layer.queryFeatures = async () => { throw new Error('Service unavailable') }
  assert.match((await mind.respond('use current view')).text, /Service unavailable/)
  assert.deepEqual(mind.task(), successful)
  live.jmv = { view: { ...live.view } }
  assert.equal(mind.task(), null)
  await mind.respond(successful.actions[0].command)
  assert.equal(queries.length, n)
})

test('task controls respect disabled queries, removed layers, reset, and ranked subsets', async () => {
  const { mind, layer, queries, live } = fixture()
  layer.visible = true
  await mind.respond('top 5 parcels by ACRES where ACRES over 5')
  assert.ok(!mind.task().actions.some(a => /Count matches|Show matching rows/.test(a.label)))
  const current = mind.task()
  const n = queries.length
  mind.ctx.featureSearch = false
  await mind.respond(current.actions[0].command)
  assert.equal(queries.length, n)
  mind.ctx.featureSearch = true
  live.jmv.view.map.layers = []
  assert.equal(mind.task(), null)
  await mind.respond(current.actions[0].command)
  assert.equal(queries.length, n)
  live.jmv.view.map.layers = [layer]
  await mind.respond('forget context')
  assert.equal(mind.task(), null)
})

test('guided tour walks the widgets, next and stop', async () => {
  const { live } = fixture()
  const docs = [
    { id: 'widget:legend:legend', kind: 'widget', title: 'Legend', text: 'Shows the symbols on the map. More words here.', where: 'in the sidebar', actions: [{ type: 'openWidget', ids: ['w1'], label: 'Open Legend' }], src: 'live' },
    { id: 'widget:print:print', kind: 'widget', title: 'Print', text: 'Makes a PDF of the map.', actions: [{ type: 'openWidget', ids: ['w2'], label: 'Open Print' }], src: 'live' }
  ]
  const mind = new Mind({ live, index: new MappyIndex(docs), model: { isPlaced: () => true }, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  assert.equal(parseIntent('show me around').name, 'tour')
  assert.equal(parseIntent('give me a tour').name, 'tour')
  assert.equal(parseIntent('next').name, 'tourNext')
  assert.equal(parseIntent('next page').name, 'ask')
  assert.equal(parseIntent('stop tour').name, 'tourStop')
  const r1 = await mind.respond('show me around')
  assert.match(r1.text, /2 tools/)
  assert.match(r1.text, /\*\*Legend\*\* \(1 of 2\)\. Shows the symbols on the map\. It lives in the sidebar\./)
  assert.deepEqual(r1.suggest, ['Next', 'Stop tour'])
  const r2 = await mind.respond('next')
  assert.match(r2.text, /\*\*Print\*\* \(2 of 2\)/)
  assert.deepEqual(r2.suggest, ['Finish tour', 'Stop tour'])
  const r3 = await mind.respond('finish tour')
  assert.match(r3.text, /That is everything/)
  const r4 = await mind.respond('show me around')
  assert.match(r4.text, /Legend/)
  const r5 = await mind.respond('stop tour')
  assert.match(r5.text, /Tour over/)
  // "next" with no tour running repeats the last reply instead of erroring.
  const r6 = await mind.respond('next')
  assert.match(r6.text, /Tour over/)
})

test('try again re-runs the last real request, and what did I change reads the history', async () => {
  const { mind, live, entry } = fixture()
  assert.equal(parseIntent('try again').name, 'tryAgain')
  assert.equal(parseIntent('what did I change').name, 'changes')
  const first = await mind.respond('try again')
  assert.match(first.text, /Nothing to run again/)
  const none = await mind.respond('what did i change')
  assert.match(none.text, /not changed any layers/)
  await mind.respond('turn on parcels')
  assert.equal(live.isVisible(entry), true)
  live.setVisible(entry, false)
  const again = await mind.respond('try again')
  assert.match(again.text, /^\(Again: turn on parcels\)/)
  assert.equal(live.isVisible(entry), true)
  const done = await mind.respond('what did i change')
  assert.match(done.text, /What I changed/)
  assert.ok(done.list.length >= 2)
  assert.match(done.list[0].label, /^1\. turn on parcels/i)
  // Control words never become the thing to run again.
  await mind.respond('undo')
  const again2 = await mind.respond('again')
  assert.match(again2.text, /^\(Again: turn on parcels\)/)
})

test('what did I click reads the open popup', async () => {
  const { mind, live, layer } = fixture()
  assert.equal(parseIntent('what did i click').name, 'clicked')
  assert.equal(parseIntent("what's this").name, 'clicked')
  assert.equal(parseIntent('what is this app').name, 'about')
  const none = await mind.respond('what did I click')
  assert.match(none.text, /Nothing is selected/)
  live.jmv.view.popup = { selectedFeature: { layer, attributes: { OBJECTID: 7, OWNER: 'Smith', ACRES: 5, Shape__Area: 12 } } }
  const r = await mind.respond('what did I click')
  assert.match(r.text, /\*\*Parcels\*\* feature/)
  assert.deepEqual(r.table.columns, ['Field', 'Value'])
  assert.deepEqual(r.table.rows, [['Owner name', 'Smith'], ['Lot Area', '5']])
  assert.deepEqual(r.suggest, ['How many Parcels in view', 'Fields in Parcels', 'Explore Parcels'])
})

test('typeahead completes starters, layers after verbs and widgets after open', () => {
  const { live } = fixture()
  const docs = [{ id: 'widget:legend:legend', kind: 'widget', title: 'Legend', text: 'Symbols.', actions: [{ type: 'openWidget', ids: ['w1'], label: 'Open Legend' }], src: 'live' }]
  const mind = new Mind({ live, index: new MappyIndex(docs), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  assert.deepEqual(mind.complete('t'), [])
  assert.ok(mind.complete('tu').includes('turn on'))
  assert.deepEqual(mind.complete('turn on par'), ['turn on Parcels'])
  assert.deepEqual(mind.complete('open le'), ['open Legend'])
  assert.ok(mind.complete('parc').includes('turn on Parcels'))
  assert.ok(mind.complete('leg').includes('open Legend'))
  assert.ok(mind.complete('what did').includes('what did I change'))
  assert.ok(mind.complete('show me around').length === 0)
  assert.ok(mind.complete('zzz').length === 0)
})

;(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('PASS', name) } catch (e) { console.error('FAIL', name, e); process.exitCode = 1 }
  }
  console.log(`${passed}/${tests.length} tests passed`)
})()

test("what's on the map, copy that, export chat and zoom to the selected feature", async () => {
  const { mind, live, layer } = fixture()
  assert.equal(parseIntent("what's on the map").name, 'mapSummary')
  assert.equal(parseIntent('what am I looking at').name, 'mapSummary')
  assert.equal(parseIntent('copy that').name, 'copyAnswer')
  assert.equal(parseIntent('export chat').name, 'exportChat')
  assert.equal(parseIntent('save this conversation').name, 'exportChat')
  live.jmv.view.center = { latitude: 39.1, longitude: -108.5 }; live.jmv.view.scale = 5000
  live.jmv.view.map.basemap = { title: 'Streets' }
  const off = await mind.respond('what is on the map')
  assert.match(off.text, /None of the 1 layers are turned on\. Basemap: \*\*Streets\*\*\. The map is centered at 39\.10000, -108\.50000/)
  await mind.respond('turn on parcels')
  const on = await mind.respond('what is on the map')
  assert.match(on.text, /1 of 1 layers are drawing: \*\*Parcels\*\*\./)
  assert.match(on.text, /1 layer change this session/)
  assert.ok(on.suggest.includes('What did I change'))
  const copy = await mind.respond('copy that')
  assert.equal(copy.effect, 'copy')
  const exp = await mind.respond('export chat')
  assert.equal(exp.effect, 'export')
  const goes = []
  live.jmv.view.goTo = async t => { goes.push(t) }
  live.jmv.view.popup = { selectedFeature: { layer, geometry: { type: 'point', x: 1, y: 2 }, attributes: { OWNER: 'Smith' } } }
  const r = await mind.respond('what did I click')
  assert.deepEqual(r.actions, [{ type: 'ask', q: '__zoomsel', label: 'Zoom to it' }])
  const z = await mind.respond('__zoomsel')
  assert.match(z.text, /There it is/)
  assert.equal(goes.length, 1)
  assert.equal(goes[0].scale, 2500)
})


test('knowledge feed: validation, docs, glossary terms and facts', async () => {
  const { cleanFeed, feedDocs, describeFeed } = require('../src/brain/feed.ts')
  const { addTerms, lookupTerm } = require('../src/brain/glossary.ts')
  assert.equal(cleanFeed(null), null)
  assert.equal(cleanFeed({ format: 2, version: '2026.10.29' }), null)
  assert.equal(cleanFeed({ format: 1, version: 'latest' }), null)
  assert.equal(cleanFeed([]), null)
  const feed = cleanFeed({
    format: 1, version: '2026.10.29.2', about: 'test <b>feed</b>',
    languagePack: { format: 1, version: '2026.10.29' },
    faq: [{ q: 'Is the map a survey?', a: 'No, it is <i>general</i> reference.', url: 'https://example.org/x' }, { q: 'x', a: 'short' }, { q: 'Bad link', a: 'An answer here.', url: 'javascript:alert(1)' }],
    glossary: [{ term: 'Hillshade', aliases: ['shaded relief', 'x'], text: 'Shading that makes terrain stand out.' }, { term: 'z', text: 'too short' }],
    facts: ['A fact long enough to keep.', 'short', 42],
    tips: ['Say "undo" to reverse a layer change.']
  })
  assert.ok(feed)
  assert.equal(feed.version, '2026.10.29.2')
  assert.equal(feed.about, 'test feed')
  assert.equal(feed.languagePack.version, '2026.10.29')
  assert.deepEqual(feed.faq, [{ q: 'Is the map a survey?', a: 'No, it is general reference.', url: 'https://example.org/x' }, { q: 'Bad link', a: 'An answer here.', url: undefined }])
  assert.deepEqual(feed.glossary, [{ term: 'hillshade', aliases: ['shaded relief'], text: 'Shading that makes terrain stand out.' }])
  assert.deepEqual(feed.facts, ['A fact long enough to keep.'])
  assert.equal(feed.tips.length, 1)
  assert.equal(describeFeed(feed), 'feed 2026.10.29.2: language pack 2026.10.29, 2 answers, 1 term, 1 fact, 1 tip')
  const docs = feedDocs(feed)
  assert.equal(docs.length, 3)
  assert.equal(docs[0].kind, 'faq'); assert.equal(docs[0].boost, 1.2); assert.equal(docs[0].actions[0].url, 'https://example.org/x')
  assert.equal(docs[2].kind, 'guide')
  assert.deepEqual(feedDocs(null), [])
  // Terms: new words are added, built-in meanings are kept.
  assert.equal(lookupTerm('hillshade'), null)
  const before = lookupTerm('parcel').text
  assert.equal(addTerms([...feed.glossary, { term: 'parcel', text: 'Something else entirely, long enough.' }]), 2)
  assert.equal(lookupTerm('shaded relief').text, 'Shading that makes terrain stand out.')
  assert.equal(lookupTerm('hillshades').term, 'hillshade')
  assert.equal(lookupTerm('parcel').text, before)
  // The feed's facts and answers reach Mappy through the context, like the builder's own.
  const { live } = fixture()
  const mind = new Mind({ live, index: new MappyIndex(docs), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', place: { org: 'the City', name: '', website: '', facts: feed.facts }, feedInfo: describeFeed(feed) })
  const d = await mind.respond('diagnostics')
  assert.match(d.text, /Knowledge feed 2026\.10\.29\.2: language pack/)
  const a = await mind.respond('is the map a survey')
  assert.match(a.text, /general reference/)
  // The project's own feed passes the same checks.
  const shipped = cleanFeed(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', 'feed.json'), 'utf8')))
  assert.ok(shipped && shipped.faq.length >= 3 && shipped.facts.length >= 10 && shipped.languagePack)
  for (const f of shipped.facts) assert.doesNotMatch(f, /grand junction|colorado/i)
})


test('dates, several conditions, value lists, percent and grouped statistics', async () => {
  const { compileConditions, splitConditions } = require('../src/brain/analysis.ts')
  const { parseWhen, parsePeriod } = require('../src/brain/dates.ts')
  const now = new Date(2026, 9, 30, 10, 0, 0) // Fri Oct 30 2026
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const r = (p) => { const x = parseWhen(p, now); return x ? [x.from && ymd(x.from), x.to && ymd(x.to)] : null }
  assert.deepEqual(r('in the last 7 days'), ['2026-10-24', '2026-10-31'])
  assert.deepEqual(r('past week'), ['2026-10-24', '2026-10-31'])
  assert.deepEqual(r('in the last 3 months'), ['2026-07-31', '2026-10-31'])
  assert.deepEqual(r('today'), ['2026-10-30', '2026-10-31'])
  assert.deepEqual(r('yesterday'), ['2026-10-29', '2026-10-30'])
  assert.deepEqual(r('this year'), ['2026-01-01', '2026-10-31'])
  assert.deepEqual(r('last year'), ['2025-01-01', '2026-01-01'])
  assert.deepEqual(r('last month'), ['2026-09-01', '2026-10-01'])
  assert.deepEqual(r('this week'), ['2026-10-25', '2026-10-31'])
  assert.deepEqual(r('since 2020'), ['2020-01-01', undefined])
  assert.deepEqual(r('after March 2024'), ['2024-04-01', undefined])
  assert.deepEqual(r('before 1990'), [undefined, '1990-01-01'])
  assert.deepEqual(r('on 6/1/2025'), ['2025-06-01', '2025-06-02'])
  assert.deepEqual(r('on June 1, 2025'), ['2025-06-01', '2025-06-02'])
  assert.deepEqual(r('in 2023'), ['2023-01-01', '2024-01-01'])
  assert.deepEqual(r('during May'), ['2026-05-01', '2026-06-01'])
  assert.deepEqual(r('between 2020 and 2022'), ['2020-01-01', '2023-01-01'])
  assert.equal(r('between 2022 and 2020'), null)
  assert.equal(r('on 2/30/2025'), null)
  assert.equal(r('in a while'), null)
  assert.equal(parsePeriod('Smith'), null)

  const f2 = [...fields, { name: 'last_edited_date', alias: 'Last Edited', type: 'date' }, { name: 'INSTALLDATE', alias: 'Install Date', type: 'date' }, { name: 'ZONING', type: 'string' }, { name: 'INSP_DAY', alias: 'Inspection Day', type: 'date-only' }]
  assert.equal(compileCondition('edited date in the last 7 days', f2, now), "(last_edited_date >= TIMESTAMP '2026-10-24 00:00:00' AND last_edited_date < TIMESTAMP '2026-10-31 00:00:00')")
  assert.equal(compileCondition('installed date before 1990', f2, now), "INSTALLDATE < TIMESTAMP '1990-01-01 00:00:00'")
  assert.equal(compileCondition('install date after 2015', f2, now), "INSTALLDATE >= TIMESTAMP '2016-01-01 00:00:00'")
  assert.equal(compileCondition('install date > 2015', f2, now), "INSTALLDATE >= TIMESTAMP '2016-01-01 00:00:00'")
  assert.equal(compileCondition('inspection day on 2025-06-01', f2, now), "(INSP_DAY >= DATE '2025-06-01' AND INSP_DAY < DATE '2025-06-02')")
  assert.equal(compileCondition('*year* < 1990', f2, now), "INSTALLDATE < TIMESTAMP '1990-01-01 00:00:00'")
  assert.throws(() => compileCondition('install date in a while', f2, now), /Use a time like/)
  assert.throws(() => compileCondition('inspected date this year', fields, now), /no date fields/)
  // Year fields: whole years.
  const yf = [...fields, { name: 'YEAR_BUILT', alias: 'Year Built', type: 'integer' }]
  assert.equal(compileCondition('built date before 1990', yf, now), 'YEAR_BUILT < 1990')
  assert.equal(compileCondition('year built between 1990 and 1999', yf, now), '(YEAR_BUILT >= 1990 AND YEAR_BUILT < 2000)')
  assert.equal(compileCondition('built date in 1995', yf, now), '(YEAR_BUILT >= 1995 AND YEAR_BUILT < 1996)')
  // Lists and several conditions.
  assert.equal(compileCondition('zoning is R-4 or R-8 or RM-8', f2), "ZONING IN ('R-4', 'R-8', 'RM-8')")
  assert.equal(compileCondition('zoning is not R-4 or R-8', f2), "ZONING NOT IN ('R-4', 'R-8')")
  assert.equal(compileCondition('status is Active or 2', f2), 'STATUS IN (1, 2)')
  assert.equal(compileCondition("zoning is 'R-4 or R-8'", f2), "ZONING = 'R-4 or R-8'")
  assert.throws(() => compileCondition('acres = 1 or 1=1', f2), /numbers or coded/)
  assert.deepEqual(splitConditions('acres > 5 and zoning is R-4'), ['acres > 5', 'zoning is R-4'])
  assert.deepEqual(splitConditions('acres between 5 and 10 and zoning is R-4'), ['acres between 5 and 10', 'zoning is R-4'])
  assert.deepEqual(splitConditions("owner is 'Smith and Sons' and acres > 1"), ["owner is 'Smith and Sons'", 'acres > 1'])
  assert.deepEqual(splitConditions('edited date between March 2020 and May 2021 and acres > 1'), ['edited date between March 2020 and May 2021', 'acres > 1'])
  assert.equal(compileConditions('acres > 5 and zoning is R-4', f2), "(ACRES > 5) AND (ZONING = 'R-4')")
  assert.throws(() => compileConditions('acres > 1 and acres > 2 and acres > 3 and acres > 4', f2), /up to three/)
  assert.throws(() => compileConditions('acres > 1 and 1=1', f2))

  // Asking.
  assert.deepEqual(parseAnalysis('parcels edited in the last 7 days'), { kind: 'filter', layer: 'parcels', condition: 'edited date in the last 7 days', inView: false })
  assert.deepEqual(parseAnalysis('how many hydrants were inspected this year'), { kind: 'countWhere', layer: 'hydrants', condition: 'inspected date this year', inView: false })
  assert.deepEqual(parseAnalysis('show manholes installed before 1990 in view'), { kind: 'filter', layer: 'manholes', condition: 'installed date before 1990', inView: true })
  assert.deepEqual(parseAnalysis('what percent of parcels are over 5 acres'), { kind: 'percent', layer: 'parcels', condition: 'acres > 5', inView: false })
  assert.deepEqual(parseAnalysis('what share of hydrants were inspected this year'), { kind: 'percent', layer: 'hydrants', condition: 'inspected date this year', inView: false })
  assert.deepEqual(parseAnalysis('what percent of parcels where zoning is R-4'), { kind: 'percent', layer: 'parcels', condition: 'zoning is R-4', inView: false })
  assert.deepEqual(parseAnalysis('average acres by zoning in parcels'), { kind: 'group', stat: 'avg', valueField: 'acres', field: 'zoning', layer: 'parcels', inView: false })
  assert.deepEqual(parseAnalysis('total length of sewer mains by material'), { kind: 'group', stat: 'sum', valueField: 'length', layer: 'sewer mains', field: 'material', inView: false })
  assert.deepEqual(parseAnalysis('how many parcels per zoning'), { kind: 'group', layer: 'parcels', field: 'zoning', inView: false })
  assert.equal(parseAnalysis('average acres in parcels').kind, 'stats')
  assert.deepEqual(parseAnalysis('filter parcels where acres > 5 and owner contains Smith'), { kind: 'filter', layer: 'parcels', condition: 'acres > 5 and owner contains Smith', inView: false })
  assert.deepEqual(parseAnalysis('parcels where edited date is in the last 30 days'), { kind: 'filter', layer: 'parcels', condition: 'edited date is in the last 30 days', inView: false })

  // Running them against the live layer.
  const { mind, layer, queries } = fixture()
  layer.visible = true
  layer.fields = [...layer.fields, { name: 'last_edited_date', alias: 'Last Edited', type: 'date' }, { name: 'ZONING', type: 'string' }]
  let n = 0
  layer.queryFeatureCount = async q => { queries.push(q); return n++ % 2 ? 40 : 10 }
  const pct = await mind.respond('what percent of parcels are over 5 acres')
  assert.match(pct.text, /\*\*25%\*\* of \*\*Parcels\*\* \(10 of 40\)/)
  assert.match(queries[queries.length - 2].where, /ACRES > 5/)
  assert.doesNotMatch(queries[queries.length - 1].where, /ACRES/)
  assert.equal(pct.actions[0].label, 'Show them')
  layer.queryFeatures = async q => { queries.push(q); return { features: [{ attributes: { ZONING: 'R-4', mappy_count: 3, mappy_value: 2.5 } }, { attributes: { ZONING: 'C-1', mappy_count: 2, mappy_value: 9 } }] } }
  const g = await mind.respond('average acres by zoning in parcels')
  assert.match(g.text, /\*\*C-1\*\* has the highest average Lot Area \(9\); the lowest is \*\*R-4\*\* \(2\.5\)/)
  assert.deepEqual(g.table.columns, ['Zoning', 'Count', 'Average Lot Area'])
  assert.deepEqual(queries[queries.length - 1].outStatistics.map(s => s.statisticType), ['count', 'avg'])
  const ed = await mind.respond('how many parcels were edited in the last 7 days')
  assert.match(ed.text, /matching records in \*\*Parcels\*\*/)
  assert.match(queries[queries.length - 1].where, /last_edited_date >= TIMESTAMP '/)
})

