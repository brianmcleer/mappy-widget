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

;(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('PASS', name) } catch (e) { console.error('FAIL', name, e); process.exitCode = 1 }
  }
  console.log(`${passed}/${tests.length} tests passed`)
})()
