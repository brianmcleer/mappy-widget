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
test('a layer that is turned off still answers data questions, and offers to turn on', async () => {
  const { mind, queries, layer } = fixture()
  const reply = await mind.respond('summarize ACRES in parcels')
  assert.ok(reply.table); assert.equal(queries.length, 1)
  assert.ok(reply.actions.some(a => a.type === 'layerOn' && a.label === 'Turn on Parcels'))
  assert.equal(layer.visible, false, 'asking never turns a layer on by itself')
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
  assert.match((await mind.respond('explore parcels')).text, /questions for \*\*Parcels\*\*/)
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
  // Only one layer is on: "turn off a layer" needs no question.
  const off = await mind.respond('turn off a layer')
  assert.match(off.text, /only layer on, so I used it/)
  assert.equal(layer.visible, false)
  await mind.respond('select a layer')
  await mind.respond('1')
  assert.equal(layer.visible, true)
  // "Show table" right after working with Parcels is its table.
  const table = await mind.respond('show table')
  assert.ok(table.table)
  assert.equal(queries.length, 1)
  // With nothing worked on and nothing on, he asks.
  const { mind: m2, queries: q2 } = fixture()
  await m2.respond('show table')
  assert.equal(q2.length, 0)
  const picked = await m2.respond('Parcels')
  assert.ok(picked.table, 'a table from a layer that is off still opens')
  assert.ok(picked.actions.some(a => a.type === 'layerOn'))
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
  assert.equal(goes[0].scale, 2400)
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
  assert.match(g.text, /Average \*\*Lot Area\*\* by \*\*Zoning\*\*: \*\*C-1\*\* is highest at 9, and \*\*R-4\*\* is lowest at 2\.5/)
  assert.deepEqual(g.table.columns, ['Zoning', 'Parcels', 'Average Lot Area'])
  assert.deepEqual(queries[queries.length - 1].outStatistics.map(s => s.statisticType), ['count', 'avg'])
  const ed = await mind.respond('how many parcels were edited in the last 7 days')
  assert.match(ed.text, /parcels match \(edited in the last 7 days\)/)
  assert.match(queries[queries.length - 1].where, /last_edited_date >= TIMESTAMP '/)
})


test('predictive text: names after verbs, bookmarks, fields, code lists, addresses', async () => {
  const { completeText, addressFragment, withAddress, addressQuestions } = require('../src/brain/complete.ts')
  const src = {
    layers: ['Parcels', 'Zoning Districts', 'Fire Hydrants'], widgets: ['Legend', 'Print'], bookmarks: ['Downtown', 'Airport'],
    fieldsOf: l => l.toLowerCase() === 'parcels' ? ['Owner name', 'Lot Area', 'Zoning', 'Status'] : [],
    valuesOf: (l, f) => f.toLowerCase() === 'zoning' ? ['R-4', 'R-8', 'C-1'] : f.toLowerCase() === 'status' ? ['Active', 'Retired'] : [],
    places: true
  }
  assert.deepEqual(completeText('t', src), [])
  assert.deepEqual(completeText('zoom to d', src), ['zoom to Downtown'])
  assert.deepEqual(completeText('zoom to ', src), ['zoom to Airport', 'zoom to Parcels', 'zoom to Downtown', 'zoom to Fire Hydrants', 'zoom to Zoning Districts'])
  assert.deepEqual(completeText('open le', src), ['open Legend'])
  assert.deepEqual(completeText('where are the fi', src), ['where are the Fire Hydrants'])
  assert.deepEqual(completeText('count parcels by ', src), ['count parcels by Zoning', 'count parcels by Status', 'count parcels by Lot Area', 'count parcels by Owner name'])
  assert.deepEqual(completeText('count parcels by zo', src), ['count parcels by Zoning'])
  assert.deepEqual(completeText('parcels where zoning is r', src), ['parcels where zoning is R-4', 'parcels where zoning is R-8'])
  assert.deepEqual(completeText('parcels where status is ', src), ['parcels where status is Active', 'parcels where status is Retired'])
  assert.deepEqual(completeText('what percent of parcels are ', src), ['what percent of parcels are Zoning', 'what percent of parcels are Status', 'what percent of parcels are Lot Area', 'what percent of parcels are Owner name'])
  assert.ok(completeText('who', src).includes('who owns'))
  assert.ok(!completeText('who', { ...src, places: false }).includes('who owns'))
  assert.ok(completeText('parc', src).includes('turn on Parcels'))
  assert.deepEqual(completeText('airp', src), ['zoom to Airport'])
  assert.equal(addressFragment('who owns 250 n 5'), '250 n 5')
  assert.equal(addressFragment('250 N 5th St'), '250 N 5th St')
  assert.equal(addressFragment('closest hydrant to 1718 white'), '1718 white')
  assert.equal(addressFragment('3 largest parcels'), null)
  assert.equal(addressFragment('parcels over 5 acres'), null)
  assert.equal(addressFragment('zoom to 39.06, -108.55'), null)
  assert.equal(addressFragment('turn on parcels'), null)
  assert.equal(withAddress('who owns 250 n 5', '250 n 5', '250 N 5th St'), 'who owns 250 N 5th St')
  assert.deepEqual(addressQuestions('250 N 5th St', false), ['zoom to 250 N 5th St'])
  assert.equal(addressQuestions('250 N 5th St', true).length, 4)

  // Through the Mind, with a locator that suggests.
  const { live, layer } = fixture()
  layer.fields = [...fields, { name: 'ZONING', type: 'string', domain: { type: 'coded-value', codedValues: [{ code: 'R4', name: 'R-4' }, { code: 'C1', name: 'C-1' }] } }]
  live.jmv.view.center = { latitude: 39, longitude: -108 }
  const asked = []
  sdkLoader = async () => [{ suggestLocations: async (url, params) => { asked.push(params.text); return [{ text: '250 N 5th St, Springfield' }, { text: '250 N 5th Ave, Springfield' }] } }, async () => ({ data: { capabilities: 'Geocode,ReverseGeocode,Suggest' } })]
  const docs = [{ id: 'bm:1', kind: 'bookmark', title: 'Downtown', text: '', src: 'live' }]
  const mind = new Mind({ live, index: new MappyIndex(docs), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', geocoders: [{ url: 'https://city.test/GeocodeServer', name: 'City' }] })
  assert.deepEqual(await mind.completeAsync('who owns 250 n 5'), ['who owns 250 N 5th St, Springfield', 'who owns 250 N 5th Ave, Springfield'])
  assert.deepEqual(asked, ['250 n 5'])
  const bare = await mind.completeAsync('250 n 5th')
  assert.equal(bare[0], 'zoom to 250 N 5th St, Springfield')
  assert.ok(bare.includes('who owns 250 N 5th St, Springfield'))
  assert.deepEqual(await mind.completeAsync('zoom to dow'), ['zoom to Downtown'])
  assert.deepEqual(await mind.completeAsync('parcels where zoning is c'), ['parcels where zoning is C-1'])
  assert.equal(asked.length, 2, 'no locator call without an address')
  // A locator without Suggest, or one that fails, leaves the local completions.
  sdkLoader = async () => [{ suggestLocations: async () => { throw new Error('down') } }, async () => ({ data: { capabilities: 'Geocode' } })]
  assert.deepEqual(await mind.completeAsync('who owns 250 n 5'), [])
  sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }
})


test('the layer we are working with fills in bare follow-ups: open table, fields, label it, only it', async () => {
  assert.equal(contextualCommand('open table', 'Annexations'), 'show table Annexations')
  assert.equal(contextualCommand('show the attribute table', 'Annexations'), 'show table Annexations')
  assert.equal(contextualCommand('put it in a table', 'Annexations'), 'show table Annexations')
  assert.equal(contextualCommand('fields', 'Annexations'), 'fields in Annexations')
  assert.equal(contextualCommand("what's in it", 'Annexations'), 'fields in Annexations')
  assert.equal(contextualCommand('label it', 'Annexations'), 'label Annexations')
  assert.equal(contextualCommand('fade it', 'Annexations'), 'fade Annexations')
  assert.equal(contextualCommand('only it', 'Annexations'), 'show only Annexations')
  assert.equal(contextualCommand('explore', 'Annexations'), 'explore Annexations')
  assert.equal(contextualCommand('largest', 'Annexations'), 'largest Annexations')
  assert.equal(contextualCommand('open table', ''), 'open table')
  assert.equal(contextualCommand('show table parcels', 'Annexations'), 'show table parcels')
  const { mind, live, layer, entry } = fixture()
  const other = { id: 'zoning', title: 'Zoning', type: 'feature', visible: false, opacity: 1, fields, objectIdField: 'OBJECTID', createQuery: () => ({ where: '1=1' }), queryFeatureCount: async () => 3, queryFeatures: async () => ({ features: [] }) }
  live.jmv.view.map.layers.push(other)
  // No layer yet, two layers off: he asks.
  const ask = await mind.respond('open table')
  assert.match(ask.text, /Which layer should I open as a table/)
  await mind.respond('cancel')
  // After turning one on, "open table" means that one.
  await mind.respond('turn on parcels')
  const t = await mind.respond('open table')
  assert.match(t.text, /\*\*Parcels\*\*/)
  assert.ok(t.table || t.page, 'rows came back')
  const f = await mind.respond('fields')
  assert.match(f.text, /Owner name|Lot Area/)
  // Fresh mind, only one layer on: no question, a note instead.
  const { mind: m2, live: l2 } = fixture()
  l2.jmv.view.map.layers.push({ ...other, visible: false })
  l2.jmv.view.map.layers[0].visible = true
  const t2 = await m2.respond('open table')
  assert.match(t2.text, /^\*\*Parcels\*\* is the only layer on, so I used it\./)
  assert.match(t2.text, /\*\*Parcels\*\*: rows/)
  // Turn off with two on: asks, the ones that are on first.
  l2.jmv.view.map.layers[1].visible = true
  const off = await m2.respond('turn off a layer')
  assert.match(off.text, /The ones that are on come first/)
  assert.equal(off.list.length, 2)
})


const GIS_TOOLS = [{"name": "geocode", "title": "Find an address", "description": "Geocode: find the location of a street address, intersection or place name with the city address locator.", "inputSchema": {"type": "object", "properties": {"address": {"type": "string", "description": "Address or place, for example 250 N 5th St."}, "max_results": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}}, "required": ["address"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Find an address"}}, {"name": "nearest_feature", "title": "Closest feature", "description": "Nearest / closest feature: the closest sewer line, water main, hydrant, park, school, bus stop or any layer to an address or point, with the distance in feet.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "address": {"type": "string", "description": "Street address or place (instead of latitude and longitude)."}, "latitude": {"type": "number"}, "longitude": {"type": "number"}, "max_results": {"type": "integer", "minimum": 1, "maximum": 10, "default": 3}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Closest feature"}}, {"name": "features_near", "title": "Features within a distance", "description": "Features within a distance (buffer) of an address or point: what hydrants are within 500 feet, how many parcels within a quarter mile.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "address": {"type": "string", "description": "Street address or place (instead of latitude and longitude)."}, "latitude": {"type": "number"}, "longitude": {"type": "number"}, "distance_feet": {"type": "number", "minimum": 1, "maximum": 26400, "default": 500}, "max_results": {"type": "integer", "minimum": 1, "maximum": 25, "default": 25}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Features within a distance"}}, {"name": "identify", "title": "What's here", "description": "Identify / property report: what is at an address or point, such as the parcel and owner, zoning district, flood zone and every other layer at that spot.", "inputSchema": {"type": "object", "properties": {"address": {"type": "string", "description": "Street address or place (instead of latitude and longitude)."}, "latitude": {"type": "number"}, "longitude": {"type": "number"}, "layer": {"type": "string", "description": "Only this layer (optional), such as zoning or flood zone."}}, "required": []}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "What's here"}}, {"name": "summarize_layer", "title": "Summarize a layer", "description": "Summary statistics: count features grouped by a field (sewer mains by material, parcels by zoning) and the total, optionally only those matching some text.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "group_by": {"type": "string", "description": "Field to group by, by name or alias (optional)."}, "text": {"type": "string", "description": "Only features matching these words (optional)."}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Summarize a layer"}}]
test('any coordinate system: places on a state plane map are remembered and reused', async () => {
  const { toLatLon, setProjectionOperator, needsProjection } = require('../src/runtime/project.ts')
  assert.deepEqual(toLatLon({ x: -108.5, y: 39.1, spatialReference: { wkid: 4326 } }), [39.1, -108.5])
  assert.deepEqual(toLatLon({ latitude: 39.1, longitude: -108.5 }), [39.1, -108.5])
  const merc = toLatLon({ x: -12078000, y: 4737000, spatialReference: { wkid: 102100 } })
  assert.ok(Math.abs(merc[0] - 39.1) < 0.2 && Math.abs(merc[1] + 108.5) < 0.2)
  assert.equal(needsProjection({ wkid: 2232 }), true)
  assert.equal(needsProjection({ wkid: 3857 }), false)
  // State plane before the engine is loaded: unknown, so callers ask.
  setProjectionOperator(null)
  assert.equal(toLatLon({ x: 3150000, y: 1420000, spatialReference: { wkid: 2232 } }), null)
  // With the engine: projected.
  setProjectionOperator({ execute: (g, sr) => ({ latitude: 39.07, longitude: -108.56 }) })
  assert.deepEqual(toLatLon({ x: 3150000, y: 1420000, spatialReference: { wkid: 2232 } }), [39.07, -108.56])

  // The locator's own X/Y attributes give the place in longitude and latitude on any map.
  const { geocodeAddress } = require('../src/runtime/geocoder.ts')
  sdkLoader = async () => [{ addressToLocations: async (url, params) => { assert.ok(params.outFields.includes('X')); return [{ address: '1138 White Ave, Springfield', score: 100, location: { x: 3150000, y: 1420000, spatialReference: { wkid: 2232 } }, attributes: { X: -108.56, Y: 39.07 } }] } }, {}]
  const found = await geocodeAddress('1138 white', [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }], { spatialReference: { wkid: 2232 } })
  assert.deepEqual(found.results[0].latLon, [39.07, -108.56])

  // After "zoom to <address>" on a state plane map, "what zoning is this in" knows the place.
  const { live } = fixture()
  live.jmv.view.spatialReference = { wkid: 2232 }
  live.jmv.view.extent = { xmin: 3140000, ymin: 1410000, xmax: 3160000, ymax: 1430000, spatialReference: { wkid: 2232 } }
  live.jmv.view.center = { x: 3150000, y: 1420000, spatialReference: { wkid: 2232 } }
  live.jmv.view.graphics = { add () {}, remove () {}, toArray: () => [] }
  const calls = []
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS_TOOLS, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'At that spot, Zoning: R-4' }], structuredContent: { results: [{ layer: 'Zoning', summary: 'Zone: R-4', count: 1 }] } } } }
  sdkLoader = async (mods) => mods[0] === 'esri/Graphic' ? [function G (o) { Object.assign(this, o) }] : [{ addressToLocations: async () => [{ address: '1138 White Ave, Springfield', score: 100, location: { x: 3150000, y: 1420000, spatialReference: { wkid: 2232 } }, attributes: { X: -108.56, Y: 39.07 } }] }, {}]
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', geocoders: [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }], mcp: port })
  const shown = await mind.respond('zoom to 1138 White Ave')
  assert.match(shown.text, /Showing \*\*1138 White Ave/)
  const zone = await mind.respond('what zoning is this in')
  assert.doesNotMatch(zone.text, /Which place do you mean/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'identify')
  assert.ok(Math.abs(calls[0][1].latitude - 39.07) < 0.001 && Math.abs(calls[0][1].longitude + 108.56) < 0.001, JSON.stringify(calls[0][1]))
  sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }
})


test('everyday phrasings: existence, lighter/darker, several layers, owners, dates, odds and ends', async () => {
  const { live, layer, mind } = fixture()
  const zoning = { id: 'zoning', title: 'Zoning Districts', type: 'feature', visible: false, opacity: 1, fields, objectIdField: 'OBJECTID', createQuery: () => ({ where: '1=1' }), queryFeatureCount: async () => 3, queryFeatures: async () => ({ features: [] }) }
  live.jmv.view.map.layers.push(zoning)
  const names = ['is there a sewer layer', 'do you have zoning', 'turn the parcels back on', 'make the parcels lighter', 'turn parcels down', 'back to the whole city', "what's the name of this map", 'what else is there', 'how many parcels can i see', 'what day is it', 'can i download the parcels', 'the map is broken', 'where the parks at', 'fit the parcels on screen', 'can you make the hydrants bigger', 'which layer is this', 'i hate this map', 'close the chat', 'all off', 'how does this work', 'i want to see the zoning']
  const expect = ['hasLayer', 'hasLayer', 'layerOn', 'opacityStep', 'opacityStep', 'home', 'about', 'help', 'count', 'today', 'download', 'mapBlank', 'showLayer', 'goto', 'styleAsk', 'whichLayer', 'frustrated', 'sleep', 'allOff', 'help', 'showLayer']
  names.forEach((q, i) => assert.equal(parseIntent(q).name, expect[i], q))
  assert.equal(parseIntent('how many parcels can i see').scope, 'view')
  assert.equal(parseIntent('export chat').name, 'exportChat')
  assert.equal(parseIntent('the parcels layer is not showing').name, 'layerDiagnosis')

  assert.match((await mind.respond('do you have zoning')).text, /Yes: \*\*Zoning Districts\*\* is in this map, and it is off right now/)
  assert.match((await mind.respond('is there a sewer layer')).text, /No layer called "sewer"/)
  await mind.respond('turn on parcels')
  const lighter = await mind.respond('make the parcels lighter')
  assert.match(lighter.text, /75% opacity/)
  assert.equal(layer.opacity, 0.75)
  await mind.respond('make the parcels darker')
  assert.equal(layer.opacity, 1)
  assert.match((await mind.respond('make it darker')).text, /already as solid/)
  const both = await mind.respond('turn on parcels and zoning districts')
  assert.equal(zoning.visible, true)
  assert.match(both.text, /Zoning Districts/)
  assert.match((await mind.respond('turn off parcels, zoning districts')).text, /Parcels.*Zoning Districts/s)
  assert.equal(layer.visible, false); assert.equal(zoning.visible, false)
  assert.match((await mind.respond('what day is it')).text, /^It is \w+day, /)
  assert.match((await mind.respond('can you make the hydrants bigger')).text, /set by whoever made the map/)
  assert.match((await mind.respond('how do i turn on a layer')).text, /"turn on parcels"/)
  assert.match((await mind.respond('hydrants?')).text, /hydrants/i)
  // Analysis phrasings.
  assert.deepEqual(parseAnalysis('list parcels owned by smith'), { kind: 'filter', layer: 'parcels', condition: 'owner contains smith', inView: false })
  assert.deepEqual(parseAnalysis('how many parcels does smith own'), { kind: 'countWhere', layer: 'parcels', condition: 'owner contains smith', inView: false })
  assert.deepEqual(parseAnalysis('what zoning is most common'), { kind: 'group', layer: '*field*', field: 'zoning', inView: false, limit: 5, order: 'desc' })
  assert.deepEqual(parseAnalysis('parcels where the owner is smith'), { kind: 'filter', layer: 'parcels', condition: 'the owner is smith', inView: false })
  assert.deepEqual(parseAnalysis('show me the parcels that were edited this week'), { kind: 'filter', layer: 'parcels', condition: 'edited date this week', inView: false })
  assert.deepEqual(parseAnalysis('which parcels changed recently'), { kind: 'filter', layer: 'parcels', condition: 'changed date recently', inView: false })
  assert.equal(parseAnalysis('add parcels to the table'), null)
  assert.equal(require('../src/brain/analysis.ts').tablePhrase('add parcels to the table'), 'show table parcels')
  const f2 = [...fields, { name: 'ZONING', alias: 'Zoning', type: 'string' }]
  assert.equal(compileCondition('the owner is smith', f2), "OWNER = 'smith'")
  assert.equal(compileCondition('zone is R-4', f2), "ZONING = 'R-4'")
  assert.equal(compileCondition('area > 5', f2), 'ACRES > 5')
  assert.equal(compileCondition('owner contains smith', f2), "UPPER(OWNER) LIKE '%SMITH%'")
})

test('map moves: calm motion jumps, scale policy keeps distance', async () => {
  const { live, layer, entry } = fixture()
  const goes = []
  live.jmv.view.goTo = async (t, o) => { goes.push([t, o]); if (t && t.scale) live.jmv.view.scale = t.scale }
  live.jmv.view.scale = 50000
  layer.visible = true
  // Flying: short, eased.
  await live.go({ scale: 1000 }, 900)
  assert.deepEqual(goes[0][1], { duration: 700, easing: 'ease-out' })
  // Calm: no animation at all.
  live.reducedMotion = true
  await live.go({ scale: 2000 })
  assert.deepEqual(goes[1][1], { animate: false })
  live.reducedMotion = false
  // Zoom in and out go by scale, so they work on maps without zoom levels.
  live.jmv.view.scale = 4000; live.jmv.view.zoom = -1
  await live.zoom('in'); assert.equal(goes[2][0].scale, 2000)
  await live.zoom('out'); assert.equal(goes[3][0].scale, 4000)
  // A tiny parcel never fills the screen: the move backs off to a few houses.
  live.jmv.view.goTo = async (t, o) => { goes.push([t, o]); live.jmv.view.scale = t && t.scale ? t.scale : 150 }
  live.jmv.view.popup = { selectedFeature: { layer, geometry: { type: 'polygon', extent: { expand: f => ({ expanded: f }) } } } }
  await live.zoomToSelected()
  assert.deepEqual(goes[goes.length - 2][0], { expanded: 1.6 })
  assert.equal(goes[goes.length - 1][0].scale, 600)
  // An address lands at a city block.
  live.jmv.view.goTo = async (t, o) => { goes.push([t, o]) }
  live.jmv.view.graphics = { add () {}, remove () {} }
  sdkLoader = async () => [function G (o) { Object.assign(this, o) }]
  assert.equal(await live.showAddress({ x: 1, y: 2 }), true)
  assert.equal(goes[goes.length - 1][0].scale, 2400)
  sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }
})


test('map filters: only show, hide, clear, undo; charts; saved views; zoom steps; density; compare', async () => {
  const { live, layer, mind } = fixture()
  layer.visible = true; layer.definitionExpression = null
  layer.queryFeatureCount = async q => (q.where && /ACRES > 5/.test(q.where)) ? 7 : 42
  for (const [q, name] of [['only show parcels over 5 acres on the map', 'mapFilter'], ['filter the parcels layer to acres > 5', 'mapFilter'], ['hide parcels under an acre', 'mapFilter'], ['clear the filter', 'mapUnfilter'], ['remove the filter on parcels', 'mapUnfilter'], ['what is filtered', 'mapFilters'], ['save this view as home base', 'saveView'], ['bookmark this spot as lunch', 'saveView'], ['my saved views', 'listViews'], ['delete the home base view', 'deleteView'], ['chart parcels by zoning', 'chart'], ['chart that', 'chartLast'], ['pan left', 'pan'], ['north up', 'rotate'], ['rotate the map 45 degrees', 'rotate'], ['zoom in twice', 'zoom'], ['zoom out a bit', 'zoom'], ['drop a pin here', 'pin'], ['undo the last two things', 'undoMany'], ['what did you just do', 'lastAction'], ['why did you do that', 'explainLast'], ['shorter', 'shorter'], ['how many hydrants per square mile', 'density'], ['compare parcels and zoning', 'compareLayers'], ["what's the difference between zoning and land use", 'difference'], ['whats the average lot size', 'avgSize'], ['how many parcels are there in total', 'count'], ['got it thanks', 'thanks']]) assert.equal(parseIntent(q).name, name, q)
  assert.equal(parseIntent('zoom in twice').target, '2')
  assert.equal(parseAnalysis('which parcel is biggest').kind, 'browse')
  assert.deepEqual(parseAnalysis('highlight parcels over 5 acres'), { kind: 'filter', layer: 'parcels', condition: 'acres > 5', inView: false })

  const f = await mind.respond('only show parcels over 5 acres on the map')
  assert.match(f.text, /\*\*Parcels\*\* now shows only \*\*acres > 5\*\* \(7 features\)/)
  assert.equal(layer.definitionExpression, 'ACRES > 5')
  const list = await mind.respond('what is filtered')
  assert.match(list.list[0].label, /Parcels: acres > 5/)
  assert.match((await mind.respond('undo')).text, /Undid only show parcels over 5 acres/)
  assert.equal(layer.definitionExpression, null)
  assert.match((await mind.respond('redo')).text, /now shows only/)
  assert.equal(layer.definitionExpression, 'ACRES > 5')
  await mind.respond('hide parcels under 1 acre')
  assert.equal(layer.definitionExpression, 'NOT (ACRES < 1)')
  assert.match((await mind.respond('clear the filter')).text, /\*\*Parcels\*\* shows everything again/)
  assert.equal(layer.definitionExpression, null)
  // The author's own filter stays underneath.
  layer.definitionExpression = 'ACTIVE = 1'
  await mind.respond('only show parcels where owner contains smith')
  assert.equal(layer.definitionExpression, "(ACTIVE = 1) AND (UPPER(OWNER) LIKE '%SMITH%')")
  await mind.respond('remove the filter on parcels')
  assert.equal(layer.definitionExpression, 'ACTIVE = 1')

  // Charts from grouped counts.
  layer.queryFeatures = async q => ({ features: [{ attributes: { ZONING: 'R-4', mappy_count: 30 } }, { attributes: { ZONING: 'C-1', mappy_count: 12 } }] })
  layer.fields = [...fields, { name: 'ZONING', alias: 'Zoning', type: 'string' }]
  const c = await mind.respond('chart parcels by zoning')
  assert.deepEqual(c.chart.rows, [{ label: 'R-4', value: 30 }, { label: 'C-1', value: 12 }])
  const c2 = await mind.respond('count parcels by zoning')
  assert.ok(c2.table)
  assert.deepEqual((await mind.respond('chart that')).chart.rows.length, 2)

  // Saved views live in the store.
  const kept = {}
  mind.ctx.store = { get: k => kept[k] || null, set: (k, v) => { if (v === null) delete kept[k]; else kept[k] = v } }
  live.jmv.view.viewpoint = { toJSON: () => ({ scale: 5000, targetGeometry: { x: 1, y: 2 } }) }
  assert.match((await mind.respond('save this view as home base')).text, /Saved this view as \*\*home base\*\*/)
  assert.equal(Object.keys(kept).filter(k => /^mappy-views/.test(k)).length, 1)
  const gone = []
  live.jmv.view.goTo = async t => { gone.push(t) }
  sdkLoader = async () => [{ fromJSON: j => ({ ...j, fromJSON: true }) }]
  assert.match((await mind.respond('go to home base')).text, /Back to \*\*home base\*\*/)
  assert.equal(gone[gone.length - 1].fromJSON, true)
  assert.match((await mind.respond('my saved views')).list[0].label, /home base/)
  assert.match((await mind.respond('delete the home base view')).text, /Forgot the \*\*home base\*\* view/)
  assert.equal(Object.keys(kept).filter(k => /^mappy-views/.test(k)).length, 0)
  sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }

  // Zoom steps, pans, turns.
  live.jmv.view.scale = 8000
  live.jmv.view.goTo = async (t) => { gone.push(t); if (t.scale) live.jmv.view.scale = t.scale }
  await mind.respond('zoom in twice'); assert.equal(live.jmv.view.scale, 2000)
  await mind.respond('zoom out a bit'); assert.ok(Math.abs(live.jmv.view.scale - 2000 * Math.SQRT2) < 1)
  live.jmv.view.extent = { xmin: -108.6, ymin: 39.0, xmax: -108.5, ymax: 39.1, spatialReference: { wkid: 4326 } }
  live.jmv.view.center = { x: -108.55, y: 39.05, spatialReference: { wkid: 4326 }, clone () { return { ...this } } }
  const pan = await mind.respond('pan left'); assert.match(pan.text, /Moved the map west/)
  assert.ok(Math.abs(gone[gone.length - 1].center.x - (-108.55 - 0.1 / 3)) < 1e-9)
  live.jmv.view.rotation = 0
  assert.match((await mind.respond('rotate the map 45 degrees')).text, /Turned the map 45°/)
  assert.equal(gone[gone.length - 1].rotation, 45)
  assert.match((await mind.respond('north up')).text, /North is up/)

  // Density from the view.
  layer.queryFeatureCount = async () => 50
  const d = await mind.respond('how many parcels per square mile')
  assert.match(d.text, /parcels per square mile/)
  // Compare two layers.
  const zoning = { id: 'zoning', title: 'Zoning Districts', type: 'feature', visible: true, opacity: 1, fields, objectIdField: 'OBJECTID', geometryType: 'polygon', createQuery: () => ({ where: '1=1' }), queryFeatureCount: async () => 9, queryFeatures: async () => ({ features: [] }) }
  live.jmv.view.map.layers.push(zoning)
  const cmp = await mind.respond('compare parcels and zoning districts')
  assert.deepEqual(cmp.table.columns, ['Layer', 'Shape', 'Features', 'Fields', 'Now'])
  assert.equal(cmp.table.rows[1][2], '9')
  assert.match((await mind.respond("what's the difference between an easement and a right of way")).text, /\*\*easement\*\*/)
})

test('closest and within from the app\'s own layers when no server has a tool for it', async () => {
  const { live, layer, mind } = fixture()
  layer.visible = true
  const asked = []
  layer.queryFeatures = async q => {
    asked.push(q)
    if (q.distance) return { features: [{ attributes: { OBJECTID: 1, OWNER: 'Near' }, geometry: { x: -108.5000, y: 39.0700 } }, { attributes: { OBJECTID: 2, OWNER: 'Far' }, geometry: { x: -108.5100, y: 39.0700 } }] }
    return { features: [] }
  }
  live.jmv.view.graphics = { add () {}, remove () {}, toArray: () => [] }
  sdkLoader = async (mods) => mods[0] === 'esri/Graphic' ? [function G (o) { Object.assign(this, o) }, function P (o) { Object.assign(this, o) }, function L (o) { Object.assign(this, o) }, function Y (o) { Object.assign(this, o) }] : [{ addressToLocations: async () => [{ address: '1138 White Ave', score: 100, location: { x: -108.5, y: 39.07, spatialReference: { wkid: 4326 } }, attributes: { X: -108.5, Y: 39.07 } }] }, {}]
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  const r = await mind.respond('closest parcel to 1138 White Ave')
  assert.match(r.text, /The closest \*\*Parcel\*\* to 1138 White Ave is \*\*Near\*\*, right there; then Far \(2,8\d\d ft\)/)
  assert.equal(r.results.length, 2)
  assert.equal(asked[0].units, 'feet')
  const w = await mind.respond('parcels within 500 ft of 1138 White Ave')
  assert.match(w.text, /\*\*2 Parcels\*\* within 500 ft of 1138 White Ave/)
  // No place yet: asks where.
  const ask = await mind.respond('closest parcel')
  assert.match(ask.text, /Closest to where/)
  live.jmv.view.center = { latitude: 39.07, longitude: -108.5 }
  const here = await mind.respond('here')
  assert.match(here.text, /closest \*\*Parcel\*\* to the middle of the map/)
  // A server that fails on the question falls back to the layers too.
  mind.ctx.mcp = { label: 'ArcGIS Location Services', fallback: true, tools: async () => [{ name: 'places', description: 'Find places near a point', inputSchema: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, category: { type: 'string' } } } }], call: async () => { throw new Error('Internal error') } }
  const fb = await mind.respond('closest parcel to 1138 White Ave')
  assert.match(fb.text, /The closest \*\*Parcel\*\*/)
  sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }
})


test('a place stays remembered by name across follow-ups; "zoning" never means a flood zone', async () => {
  const { live, layer, mind } = fixture()
  layer.visible = true
  const flood = { id: 'flood', title: 'FEMA Flood Zones', type: 'feature', visible: true, opacity: 1, fields: [{ name: 'OBJECTID', type: 'oid' }, { name: 'ZONE', alias: 'Zone', type: 'string' }], objectIdField: 'OBJECTID', displayField: 'ZONE', geometryType: 'polygon', createQuery: () => ({ where: '1=1' }), queryFeatureCount: async () => 1, queryFeatures: async () => ({ features: [{ attributes: { OBJECTID: 1, ZONE: 'X' }, geometry: { type: 'polygon', rings: [] } }] }) }
  live.jmv.view.map.layers.push(flood)
  assert.equal(live.matchTitle('zoning'), null)
  assert.equal(live.matchTitle('flood zone').title, 'FEMA Flood Zones')
  live.jmv.view.graphics = { add () {}, remove () {}, toArray: () => [] }
  live.jmv.view.spatialReference = { wkid: 4326 }
  mind.ctx.geocoders = [{ url: 'https://city.test/GeocodeServer', name: 'City', singleLineFieldName: 'SingleLine' }]
  sdkLoader = async (mods) => mods[0] === 'esri/Graphic' ? [function G (o) { Object.assign(this, o) }, function P (o) { Object.assign(this, o) }, function L (o) { Object.assign(this, o) }, function Y (o) { Object.assign(this, o) }] : [{ addressToLocations: async () => [{ address: '1138 White Ave', score: 100, location: { x: -108.5532, y: 39.0695, spatialReference: { wkid: 4326 } }, attributes: { X: -108.5532, Y: 39.0695 } }] }, {}]
  await mind.respond('zoom to 1138 White Ave')
  const z = await mind.respond('what zoning is this in')
  assert.match(z.text, /This map has no \*\*zoning\*\* layer/)
  // Chips name the place, not its coordinates.
  layer.queryFeatures = async () => ({ features: [{ attributes: { OBJECTID: 1, OWNER: 'Smith', ACRES: 1 }, geometry: { type: 'polygon', rings: [], extent: { center: { x: -108.5532, y: 39.0695 } } } }] })
  const who = await mind.respond('who owns this')
  assert.match(who.text, /Smith/)
  for (const c of who.suggest || []) assert.doesNotMatch(c, /\d{2}\.\d{4}/, c)
  sdkLoader = async () => { throw new Error('Unexpected SDK call in test') }
})


test('open fact sources: Wikidata, climate, Census, DBpedia, OSM shaping, and facts from the map itself', async () => {
  const { wikidataFacts, climateFacts, censusFacts, dbpediaFacts, osmFacts, SOURCES } = require('../src/setting/factSources.ts')
  const { factLine } = require('../src/setting/localFacts.ts')
  assert.deepEqual(SOURCES.map(x => x.id), ['wikidata', 'climate', 'osm', 'wikivoyage', 'dbpedia', 'usgs', 'census'])
  const q = (amount, unit) => ({ mainsnak: { datavalue: { value: { amount: String(amount), unit: 'http://www.wikidata.org/entity/' + unit } } } })
  const entity = { id: 'Q1', claims: {
    P1082: [{ ...q('+65000', 'Q199'), qualifiers: { P585: [{ datavalue: { value: { time: '+2020-01-01T00:00:00Z' } } }] } }, { ...q('+58000', 'Q199'), qualifiers: { P585: [{ datavalue: { value: { time: '+2010-01-01T00:00:00Z' } } }] } }],
    P2046: [q('+100', 'Q712226')], P2044: [q('+1397', 'Q11573')],
    P571: [{ mainsnak: { datavalue: { value: { time: '+1882-00-00T00:00:00Z' } } } }],
    P138: [{ mainsnak: { datavalue: { value: { id: 'Q9' } } } }],
    P190: [{ mainsnak: { datavalue: { value: { id: 'Q8' } } } }],
    P1449: [{ mainsnak: { datavalue: { value: { text: 'River City' } } } }]
  } }
  const wd = wikidataFacts(entity, 'Springfield', { Q9: 'the two rivers', Q8: 'El Jadida' }).map(f => f.text)
  assert.ok(wd.includes('Springfield had a population of about 65,000 in 2020.'), wd.join(' | '))
  assert.ok(wd.includes('Springfield covers about 38.6 square miles (100 km²).'))
  assert.ok(wd.includes('Springfield sits at about 4,583 feet (1,397 m) above sea level.'))
  assert.ok(wd.includes('Springfield was founded in 1882.'))
  assert.ok(wd.includes('Springfield is named after the two rivers.'))
  assert.ok(wd.includes('Springfield has sister city: El Jadida.'))
  assert.ok(wd.includes('Springfield is nicknamed "River City".'))
  assert.equal(factLine({ text: 'X.', source: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q1' }), 'X. (Wikidata)')
  assert.equal(factLine({ text: 'X.', source: 'Springfield', url: 'https://en.wikipedia.org/wiki/Springfield' }), 'X. (Springfield, Wikipedia)')
  // Climate: three years of a simple pattern.
  const time = []; const hi = []; const lo = []; const p = []; const sn = []
  for (let y = 2021; y <= 2023; y++) for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
    time.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    hi.push(m === 7 ? 95 : 60); lo.push(m === 1 ? 15 : 40); p.push(d === 1 ? 0.5 : 0); sn.push(m === 1 && d === 2 ? 4 : 0)
  }
  const cl = climateFacts({ time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: p, snowfall_sum: sn }, 'Springfield', false).map(f => f.text)
  assert.ok(cl[0].startsWith("Springfield's warmest month is July, with afternoons around 95°F; January nights drop to about 15°F."), cl[0])
  assert.ok(cl.some(t => /about 6 inches of precipitation a year, on roughly 12 days/.test(t)), cl.join(' | '))
  assert.ok(cl.some(t => /about 4 inches of snow/.test(t)))
  assert.ok(cl.some(t => /about 28 days a year at or above 90°F/.test(t)))
  assert.ok(cl.some(t => /about 28 nights a year at or below freezing/.test(t)))
  assert.deepEqual(climateFacts({ time: [] }, 'X', false), [])
  // Census profile row.
  const ce = censusFacts([['NAME', 'DP05_0001E', 'DP05_0018E', 'DP02_0001E', 'DP04_0089E', 'DP03_0025E', 'state', 'place'], ['X city', '65000', '38.4', '26000', '310000', '-666666666', '08', '31660']], 'Springfield').map(f => f.text)
  assert.deepEqual(ce, ["The Census Bureau estimates Springfield's population at 65,000.", 'The median age in Springfield is 38.4.', 'Springfield has about 26,000 households.', 'The median home value in Springfield is about $310,000.'])
  // DBpedia fills only what is missing.
  const db = dbpediaFacts({ 'http://dbpedia.org/ontology/populationTotal': [{ value: 65000 }], 'http://dbpedia.org/ontology/elevation': [{ value: 1397 }] }, 'Springfield', [{ text: 'Springfield had a population of about 65,000 in 2020.', source: 'Wikidata', url: '' }]).map(f => f.text)
  assert.deepEqual(db, ['Springfield is about 4,583 feet above sea level.'])
  // OSM counts.
  const { osmQuery, osmCounts } = require('../src/setting/factSources.ts')
  assert.match(osmQuery(39.07, -108.55), /^\[out:json\]\[timeout:25\];nwr\["leisure"="park"\]\(around:8047,39\.07,-108\.55\)->\.s0;\.s0 out count;/)
  assert.deepEqual(osmCounts({ elements: [{ tags: { total: '41' } }, { tags: { total: '1' } }, { tags: { total: '0' } }] }), { parks: 41, playgrounds: 1, schools: 0 })
  const os = osmFacts({ parks: 41, playgrounds: 1, schools: 0 }, 'Springfield', 5).map(f => f.text)
  assert.deepEqual(os, ['OpenStreetMap shows 41 parks within 5 miles of Springfield.', 'OpenStreetMap shows 1 playground within 5 miles of Springfield.'])

  // Facts from the map itself.
  const { layerFacts, buildMapFacts } = require('../src/runtime/mapFacts.ts')
  assert.deepEqual(layerFacts('Sewer Mains', 'polyline', { count: 9812, lengthFt: 412 * 5280 }), ['This map has 9,812 sewer mains.', 'There are about 412 miles of sewer mains on this map, about 16 marathons.'])
  assert.deepEqual(layerFacts('Parks', 'polygon', { count: 3, largest: { name: 'Lincoln Park', acres: 86.2 } }), ['This map has 3 parks.', 'The largest of the parks is Lincoln Park, at about 86.2 acres.'])
  assert.deepEqual(layerFacts('Hydrants', 'point', { count: 2314, oldest: { name: '', year: 1952 }, newest: { year: 2025 } }), ['This map has 2,314 hydrants.', 'The oldest hydrant on record here dates from 1952.', 'The hydrants on this map span 73 years, from 1952 to 2025.'])
  const { live, layer } = fixture()
  layer.visible = true; layer.geometryType = 'polygon'
  layer.queryFeatures = async q => q.outStatistics ? { features: [{ attributes: { mf_count: 42 } }] } : { features: [{ attributes: { ACRES: 12.5, OWNER: 'Big Lot LLC' } }] }
  const mf = await buildMapFacts(live)
  assert.deepEqual(mf, ['This map has 42 parcels.', 'The largest of the parcels is Big Lot LLC, at about 12.5 acres.'])
})


test('one helper choice: the app alone, the MCP server, or an AI assistant', () => {
  const { helperMode, assistantPort, safeAssistantUrl } = require('../src/brain/handoff.ts')
  assert.equal(helperMode(undefined, null), 'local')
  assert.equal(helperMode(undefined, { url: 'https://s/mcp' }), 'mcp')
  assert.equal(helperMode(undefined, { url: 'https://s/mcp', enabled: false }), 'local')
  assert.equal(helperMode('assistant', { url: 'https://s/mcp' }), 'assistant')
  assert.equal(helperMode('local', { url: 'https://s/mcp' }), 'local')
  assert.equal(helperMode('bogus', null), 'local')
  assert.deepEqual(assistantPort(null), { label: 'Claude', url: 'https://claude.ai/new?q={q}', prefix: '', context: true })
  assert.equal(assistantPort({ url: 'http://plain.example/?q={q}' }), null)
  assert.equal(assistantPort({ url: 'javascript:alert(1)' }), null)
  assert.equal(safeAssistantUrl('https://user:pw@example.com/?q={q}'), false)
  assert.equal(assistantPort({ label: '  Helper\nBot ', prefix: '/my-gis', context: false }).label, 'Helper Bot')
})

test('a handed-over question carries the prefix, the question and where the map is', () => {
  const { assistantPort, handoffPrompt, handoffUrl, contextLine, parseHandoff, assistantJob } = require('../src/brain/handoff.ts')
  const port = assistantPort({ prefix: '/my-gis' })
  const ctx = { app: 'Test map', place: '250 N 5th St', center: [39.0672, -108.5645], layersOn: ['Parcels', 'Zoning'], selected: 'Parcels' }
  assert.equal(contextLine(ctx), '(Asked from the map app "Test map": looking at 250 N 5th St (map center 39.06720, -108.56450); layers on: Parcels, Zoning; a Parcels feature is selected.)')
  assert.equal(contextLine({ app: 'Test map' }), '')
  assert.equal(handoffPrompt(port, '  what is\nthe zoning history here? ', ctx), '/my-gis what is the zoning history here?\n\n' + contextLine(ctx))
  assert.equal(handoffPrompt(assistantPort({ context: false }), 'hello there', ctx), 'hello there')
  assert.equal(handoffPrompt(port, '   ', ctx), '')
  const url = handoffUrl(port, 'who owns & what?', null)
  assert.equal(url, 'https://claude.ai/new?q=' + encodeURIComponent('/my-gis who owns & what?'))
  assert.equal(handoffUrl(assistantPort({ url: 'https://chat.example/start' }), 'hi there', null), 'https://chat.example/start?q=hi%20there')
  assert.equal(handoffUrl(assistantPort({ url: 'https://chat.example/start?m=1' }), 'hi there', null), 'https://chat.example/start?m=1&q=hi%20there')
  assert.equal(handoffUrl(null, 'hi', null), null)
  assert.ok(handoffPrompt(port, 'x'.repeat(5000), ctx).length <= 1800)
  assert.deepEqual(parseHandoff('ask Claude how many parcels sold last year', 'Claude'), { question: 'how many parcels sold last year' })
  assert.deepEqual(parseHandoff('ask claude about this', 'Claude'), { question: '' })
  assert.deepEqual(parseHandoff('send that to Claude', 'Claude'), { question: '' })
  assert.deepEqual(parseHandoff('open this in the assistant', 'Claude'), { question: '' })
  assert.deepEqual(parseHandoff('ask GeoBot: what is zoning', 'GeoBot'), { question: 'what is zoning' })
  assert.equal(parseHandoff('ask the server where is city hall', 'Claude'), null)
  assert.equal(parseHandoff('turn on parcels', 'Claude'), null)
  assert.equal(assistantJob('make me a map of zoning around City Hall'), true)
  assert.equal(assistantJob('can you write a summary of the parcels'), true)
  assert.equal(assistantJob('turn on parcels'), false)
})

test('with an assistant as the helper, stuck answers and "ask Claude" carry one link to it', async () => {
  const { assistantPort } = require('../src/brain/handoff.ts')
  const { live } = fixture()
  const base = { live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' }
  const mind = new Mind({ ...base, assistant: assistantPort({ prefix: '/my-gis' }) })
  const links = r => (r.actions || []).filter(a => a.type === 'url' && /^https:\/\/claude\.ai\/new\?q=/.test(a.url))
  // He still does map work himself: no link on an answer he has.
  const on = await mind.respond('turn on parcels')
  assert.equal(links(on).length, 0)
  // Stuck: one link, question and prefix inside.
  const stuck = await mind.respond('why did the zoning change downtown in the nineties')
  assert.equal(links(stuck).length, 1)
  assert.equal(stuck.actions[0].label, 'Ask Claude')
  assert.match(decodeURIComponent(stuck.actions[0].url), /^https:\/\/claude\.ai\/new\?q=\/my-gis why did the zoning change downtown in the nineties/)
  assert.match(decodeURIComponent(stuck.actions[0].url), /Asked from the map app "Test map"/)
  assert.match(stuck.text, /\*\*Claude\*\* may be able to answer/)
  assert.notEqual(stuck.mood, 'confused')
  // "ask Claude" alone sends the last real question.
  const again = await mind.respond('ask Claude')
  assert.equal(links(again).length, 1)
  assert.match(decodeURIComponent(again.actions[0].url), /why did the zoning change downtown in the nineties/)
  // With a question of its own.
  const direct = await mind.respond('ask Claude what air photos exist from before 1980')
  assert.equal(direct.actions.length, 1)
  assert.match(decodeURIComponent(direct.actions[0].url), /\/my-gis what air photos exist from before 1980/)
  assert.match(direct.text, /opens in a new tab/)
  assert.doesNotMatch(direct.text, /I read that as/)
  assert.doesNotMatch((await mind.respond('ask claude waht air fotos exist from befor 1980')).text, /I read that as/)
  // A stray word or two, or something he can fix himself, gets no link.
  assert.equal(links(await mind.respond('asdf qwer')).length, 0)
  // Work for an assistant gets a plain handoff, one button only.
  const job = await mind.respond('write me a memo about flood risk for the council')
  if (links(job).length) { assert.equal(job.actions.length, 1); assert.match(job.text, /more than a map helper can do/) }
  // Typeahead offers it.
  assert.ok((mind.complete('ask c') || []).some(x => /^ask Claude/i.test(x)))
  // No assistant: nothing about Claude anywhere.
  const plainMind = new Mind(base)
  const lost = await plainMind.respond('why did the zoning change downtown in the nineties')
  assert.equal(links(lost).length, 0)
  assert.doesNotMatch(lost.text, /Claude/)
  const asked = await plainMind.respond('ask Claude what air photos exist')
  assert.equal(links(asked).length, 0)
})

test('Claude usage: how many are left is said before the limit, and on request', async () => {
  const { usageNote, usageQuestion } = require('../src/brain/handoff.ts')
  assert.equal(usageNote({ left_today: 20, left_month: 300, warn_at: 5 }, 'Claude'), '')
  assert.equal(usageNote({ left_today: 3, left_month: 300, warn_at: 5 }, 'Claude'), '3 Claude questions left for you today.')
  assert.equal(usageNote({ left_today: 1, left_month: null, warn_at: 5 }, 'Claude'), '1 Claude question left for you today.')
  assert.equal(usageNote({ left_today: 0, left_month: 40 }, 'Claude'), 'That was your last Claude question today. They come back tomorrow.')
  assert.equal(usageNote({ left_today: 4, left_month: 2, warn_at: 5 }, 'Claude'), '2 Claude questions left for you this month.')
  assert.equal(usageNote({ left_today: null, left_month: null, server_low: true }, 'Claude'), 'Claude is close to its shared limit for now, so it may pause soon.')
  assert.equal(usageNote({ left_today: 'many', warn_at: 5 }, 'Claude'), '')
  assert.equal(usageNote(null, 'Claude'), '')
  for (const q of ['how many claude questions do I have left?', 'my Claude usage', 'what is my limit', 'my usage', 'how many questions do I have left today', 'Claude usage', 'how much claude have I used']) assert.ok(usageQuestion(q, 'Claude'), q)
  for (const q of ['how many parcels are left of main', 'what is the speed limit on main st', 'land use near me', 'how many hydrants', 'city limits']) assert.ok(!usageQuestion(q, 'Claude'), q)
  const { live } = fixture()
  const calls = []
  let limits = { left_today: 3, left_month: 200, per_day: 50, warn_at: 5 }
  let fail = null
  const port = {
    label: 'City GIS', fallback: true, prefs: [],
    tools: async () => [{ name: 'ask_assistant', description: 'Ask Claude', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, annotations: { readOnlyHint: true } },
      { name: 'assistant_usage', description: 'My usage', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }],
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === 'assistant_usage') return { content: [{ type: 'text', text: 'You have asked Claude 47 of 50 questions today and 300 of 500 this month. 3 left today.' }], isError: false }
      if (fail) return { content: [{ type: 'text', text: fail }], isError: true }
      return { content: [{ type: 'text', text: 'It changed in 1994.' }], structuredContent: { answer: 'It changed in 1994.', limits }, isError: false }
    }
  }
  const base = { live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' }
  const mind = new Mind({ ...base, mcp: port, serverAssistant: { label: 'Claude', note: 'Answered by AI.' } })
  let r = await mind.respond('ask claude why did the zoning change downtown')
  assert.equal(r.note, 'Answered by AI. 3 Claude questions left for you today.')
  limits = { left_today: 30, left_month: 200, warn_at: 5 }
  r = await mind.respond('ask claude why did the zoning change uptown')
  assert.equal(r.note, 'Answered by AI.', 'quiet when there is plenty left')
  // Right after a Claude answer, a question he can answer from the layers stays his and costs nothing.
  { const before = calls.filter(c => c.name === 'ask_assistant').length
    live.jmv.view.map.layers[0].visible = true
    const own = await mind.respond('how many parcels are there')
    assert.match(own.text, /parcels/i); assert.equal(calls.filter(c => c.name === 'ask_assistant').length, before, own.text)
    await mind.respond('why is that the case for downtown')
    assert.equal(calls.filter(c => c.name === 'ask_assistant').length, before + 1, 'other follow-ups still go to Claude') }
  r = await mind.respond('how many Claude questions do I have left?')
  assert.match(r.text, /47 of 50 questions today/)
  assert.equal(calls.pop().name, 'assistant_usage', 'the count comes from the server, and asking it costs nothing')
  // Out of questions: the server's own words are shown, even when Claude was only the quiet second try.
  fail = 'You have used your 50 Claude questions for today. They come back tomorrow.'
  r = await mind.respond('why did the zoning change in the nineties around the old depot')
  assert.match(r.text, /used your 50 Claude questions for today/)
  // A server without per-person counts says so plainly.
  const old = new Mind({ ...base, mcp: { ...port, tools: async () => (await port.tools()).slice(0, 1) }, serverAssistant: { label: 'Claude' } })
  assert.match((await old.respond('my claude usage')).text, /does not keep a count per person/)
  // No Claude here: the words are an ordinary question again.
  const none = new Mind(base)
  assert.doesNotMatch((await none.respond('my usage')).text, /Claude/)
})

test('Claude through the GIS server answers inside the chat, with history and limits', async () => {
  const { live } = fixture()
  const calls = []
  let answer = { content: [{ type: 'text', text: 'There are **31** hydrants within 300 meters.' }], structuredContent: { answer: 'There are **31** hydrants within 300 meters.', tools_used: ['features_near', 'features_near'] }, isError: false }
  const port = {
    label: 'City GIS', fallback: true, prefs: [],
    tools: async () => [{ name: 'ask_assistant', description: 'Ask Claude', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, annotations: { readOnlyHint: true } },
      { name: 'geocode', description: 'Find an address', inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] }, annotations: { readOnlyHint: true } }],
    call: async (name, args, timeout) => { calls.push({ name, args, timeout }); return typeof answer === 'function' ? answer() : answer }
  }
  const base = { live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' }
  const mind = new Mind({ ...base, mcp: port, serverAssistant: { label: 'Claude' } })
  // Map work stays his.
  await mind.respond('turn on parcels')
  assert.equal(calls.filter(c => c.name === 'ask_assistant').length, 0)
  // Stuck: Claude answers here, no link, no button.
  const r = await mind.respond('why did the zoning change downtown in the nineties')
  const asked = calls.filter(c => c.name === 'ask_assistant')
  assert.equal(asked.length, 1)
  assert.equal(asked[0].args.question, 'why did the zoning change downtown in the nineties')
  assert.ok(asked[0].timeout >= 60000, 'a longer wait for an answer that takes steps')
  assert.match(asked[0].args.context || '', /Asked from the map app "Test map"/)
  assert.match(r.text, /\*\*31\*\* hydrants/)
  assert.equal((r.actions || []).length, 0)
  assert.deepEqual(r.sources, [{ title: 'Claude', detail: 'using City GIS: features near' }])
  assert.equal(r.note, undefined, 'no note unless the builder set one')
  const noted = new Mind({ ...base, mcp: port, serverAssistant: { label: 'Claude', note: 'AI answer. Check anything important.' } })
  assert.equal((await noted.respond('ask claude how many parks are there')).note, 'AI answer. Check anything important.')
  // A follow-up carries the earlier turn.
  answer = { content: [{ type: 'text', text: 'Most are cast iron.' }], structuredContent: { answer: 'Most are cast iron.', tools_used: [] }, isError: false }
  const f = await mind.respond('ask claude what are they made of')
  const last = calls.filter(c => c.name === 'ask_assistant').pop()
  assert.equal(last.args.question, 'what are they made of')
  assert.equal(last.args.history[0].a, 'There are **31** hydrants within 300 meters.')
  assert.match(f.text, /cast iron/)
  assert.deepEqual(f.sources, [{ title: 'Claude', detail: 'through City GIS' }])
  // Buttons Claude asked for and its follow-up suggestions; a suggested follow-up goes back to Claude.
  answer = { content: [{ type: 'text', text: 'City Hall is in **MU-3**.' }], structuredContent: { answer: 'City Hall is in **MU-3**.', tools_used: ['identify'], followups: ['What does MU-3 allow?', '__evil', 'Which parcels nearby are R-8?'], map: [{ type: 'place', latitude: 39.0672, longitude: -108.5645, label: 'City Hall' }, { type: 'layer', layer: 'Zoning' }, { type: 'place', latitude: 999, longitude: 0, label: 'bad' }] }, isError: false }
  const z = await mind.respond('ask claude what zoning is city hall in')
  assert.deepEqual(z.actions, [{ type: 'ask', q: 'zoom to 39.0672, -108.5645', label: 'Zoom to City Hall' }, { type: 'ask', q: 'turn on Zoning', label: 'Turn on Zoning' }])
  assert.deepEqual(z.suggest, ['What does MU-3 allow?', 'Which parcels nearby are R-8?'])
  let n = calls.filter(c => c.name === 'ask_assistant').length
  answer = { content: [{ type: 'text', text: 'Mixed use.' }], structuredContent: { answer: 'Mixed use.' }, isError: false }
  assert.match((await mind.respond('What does MU-3 allow?')).text, /Mixed use/)
  assert.equal(calls.filter(c => c.name === 'ask_assistant').length, n + 1)
  // The conversation stays with Claude for question-shaped follow-ups, but map commands stay his.
  assert.match((await mind.respond('and what about the ones on main street')).text, /Mixed use/)
  n = calls.filter(c => c.name === 'ask_assistant').length
  await mind.respond('turn off parcels')
  await mind.respond('list layers')
  assert.equal(calls.filter(c => c.name === 'ask_assistant').length, n)
  // "ask Claude about this" carries what he had just said.
  await mind.respond('list layers')
  await mind.respond('ask claude about this')
  assert.match(calls.filter(c => c.name === 'ask_assistant').pop().args.context, /The map helper had answered: "/)
  // The feature under the open popup goes along as a line.
  live.jmv.view.popup = { selectedFeature: { layer: { title: 'Parcels', fields: [{ name: 'OWNER', alias: 'Owner' }] }, attributes: { OBJECTID: 7, OWNER: 'Smith', ACRES: 5 } } }
  await mind.respond('ask claude who owns this')
  assert.match(calls.filter(c => c.name === 'ask_assistant').pop().args.context, /\(Selected Parcels feature: Owner: Smith; ACRES: 5\.\)/)
  live.jmv.view.popup = null
  // A long question that only got a word search back goes to Claude instead.
  answer = { content: [{ type: 'text', text: 'Thirty-one.' }], structuredContent: { answer: 'Thirty-one.' }, isError: false }
  await mind.respond('forget context')
  assert.match((await mind.respond('how many fire hydrants are within 300 meters of city hall')).text, /Thirty-one/)
  // A chart, a table and a command button from Claude; only commands he understands become buttons.
  answer = { content: [{ type: 'text', text: 'Mostly R-4.' }], structuredContent: { answer: 'Mostly R-4.', chart: { title: 'Parcels by zoning', unit: 'parcels', rows: [{ label: 'R-4', value: 120 }, { label: 'R-8', value: 80 }, { label: 'x', value: 'bad' }] }, table: { columns: ['Zone', 'Count'], rows: [['R-4', 120], ['R-8']] },
    map: [{ type: 'command', command: 'turn on parcels', label: 'Show the parcels' }, { type: 'command', command: 'do a barrel roll for the council', label: 'nope' }, { type: 'command', command: '__mcp:run:1', label: 'sneaky' }] }, isError: false }
  const c2 = await mind.respond('ask claude which zoning has the most parcels')
  assert.deepEqual(c2.chart, { title: 'Parcels by zoning', rows: [{ label: 'R-4', value: 120 }, { label: 'R-8', value: 80 }], unit: 'parcels' })
  assert.deepEqual(c2.table, { columns: ['Zone', 'Count'], rows: [['R-4', '120'], ['R-8', '']] })
  assert.deepEqual(c2.actions, [{ type: 'ask', q: 'turn on parcels', label: 'Show the parcels' }])
  // A picture of the map goes along only when the builder turned it on, and only for questions about the screen.
  live.jmv.view.width = 800; live.jmv.view.height = 600
  const shots = []
  live.jmv.view.takeScreenshot = async o => { shots.push(o); return { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(o.width > 500 ? 200000 : 5000) } }
  answer = { content: [{ type: 'text', text: 'Mostly houses.' }], structuredContent: { answer: 'Mostly houses.', saw_map: true }, isError: false }
  await mind.respond('ask claude what am I looking at on the map')
  assert.equal(calls.filter(c => c.name === 'ask_assistant').pop().args.image, undefined, 'off by default')
  const eyes = new Mind({ ...base, mcp: port, serverAssistant: { label: 'Claude', sharePicture: true } })
  const seen = await eyes.respond('ask claude what am I looking at on the map')
  const sent = calls.filter(c => c.name === 'ask_assistant').pop().args
  assert.match(sent.image, /^data:image\/jpeg;base64,A{5000}$/, 'the smaller size that fits')
  assert.deepEqual(shots.map(o => [o.width, o.height]), [[640, 480], [440, 330]])
  assert.match(seen.sources[0].detail, /with a picture of the map/)
  await eyes.respond('ask claude how many parks does the city have')
  assert.equal(calls.filter(c => c.name === 'ask_assistant').pop().args.image, undefined, 'not for questions that are not about the screen')
  delete live.jmv.view.takeScreenshot
  // His own table answers offer Claude; the chip sends his answer and a few rows along.
  live.entries()[0] && (live.jmv.view.map.layers[0].visible = true)
  const counted = await mind.respond('count parcels by owner')
  assert.ok(counted.table, 'a grouped count is a table: ' + counted.text)
  {
    assert.ok(counted.suggest.includes('Ask Claude about this'))
    await mind.respond('Ask Claude about this')
    const ctx2 = calls.filter(c => c.name === 'ask_assistant').pop().args
    assert.equal(ctx2.question, 'count parcels by owner')
    assert.match(ctx2.context, /The map helper had answered: "/)
    assert.match(ctx2.context, /Its table, /)
  }
  // Thumbs: only when the server keeps ratings; one rating per answer goes to it.
  const ratingPort = { ...port, tools: async () => [...(await port.tools()), { name: 'assistant_feedback', inputSchema: { type: 'object', properties: {} } }] }
  const rater = new Mind({ ...base, mcp: ratingPort, serverAssistant: { label: 'Claude' } })
  answer = { content: [{ type: 'text', text: 'Twelve parks.' }], structuredContent: { answer: 'Twelve parks.' }, isError: false }
  const toRate = await rater.respond('ask claude how many parks are there')
  assert.match(toRate.rate.down, /^__claudefb:down:\d+$/)
  answer = { content: [{ type: 'text', text: 'Thank you. Noted.' }], structuredContent: { saved: true }, isError: false }
  const down = await rater.respond(toRate.rate.down)
  assert.equal(down.mood, 'sorry')
  const sentFb = calls.filter(c => c.name === 'assistant_feedback').pop()
  assert.deepEqual(sentFb.args, { question: 'how many parks are there', answer: 'Twelve parks.', helpful: false })
  assert.match((await rater.respond(toRate.rate.up)).text, /Already noted/)
  assert.equal(calls.filter(c => c.name === 'assistant_feedback').length, 1)
  assert.equal(z.rate, undefined, 'no thumbs when the server does not take ratings')
  // The app's own help and layer names go along; a card or Social Security number never does.
  const helper = new Mind({ ...base, index: new MappyIndex([{ id: 'faq:1', kind: 'faq', title: 'How do I print to PDF', text: 'Open the Print tool, choose Letter landscape, then Export.', keys: 'print pdf export', src: 'admin' }, { id: 'w:1', kind: 'widget', title: 'Print', text: 'Prints the map.', keys: 'print', src: 'live' }]), mcp: port, serverAssistant: { label: 'Claude' } })
  answer = { content: [{ type: 'text', text: 'Use Print.' }], structuredContent: { answer: 'Use Print.' }, isError: false }
  await helper.respond('ask claude how do i print to pdf')
  const helpCtx = calls.filter(c => c.name === 'ask_assistant').pop().args.context
  assert.match(helpCtx, /From this app's own help: How do I print to PDF: Open the Print tool, choose Letter landscape, then Export\./)
  assert.match(helpCtx, /\(Tools in this app: Print\.\)/)
  assert.match(helpCtx, /\(Layers in this map: Parcels\.\)/)
  n = calls.filter(c => c.name === 'ask_assistant').length
  assert.match((await helper.respond('ask claude who has the card 4111 1111 1111 1111')).text, /did not send it/)
  assert.match((await helper.respond('ask claude about ssn 123-45-6789')).text, /did not send it/)
  assert.equal(calls.filter(c => c.name === 'ask_assistant').length, n)
  await helper.respond('ask claude about parcel 2945-143-08-002 and permit 20261117000123')
  assert.equal(calls.filter(c => c.name === 'ask_assistant').length, n + 1, 'parcel and permit numbers are not private numbers')
  // A question in another language that Claude answers gets no "I read that as" note.
  answer = { content: [{ type: 'text', text: 'Hay tres parques.' }], structuredContent: { answer: 'Hay tres parques.' }, isError: false }
  const es = await mind.respond('¿cuántos parques hay en la ciudad?')
  assert.match(es.text, /Hay tres parques/)
  assert.doesNotMatch(es.text, /I read that as/)
  // Server limits read plainly, even when he was only stuck.
  answer = { content: [{ type: 'text', text: 'That is a lot of questions in an hour. Please wait a few minutes and ask again.' }], isError: true }
  assert.match((await mind.respond('which streets flood most often in spring storms')).text, /a lot of questions/)
  // Other server errors when stuck: his own reply stands.
  answer = { content: [{ type: 'text', text: 'Claude could not answer that one.' }], isError: true }
  const quiet = await mind.respond('which streets flood most often in summer storms')
  assert.doesNotMatch(quiet.text, /could not answer that one/)
  // A server without the tool: plain message on request.
  const bare = { ...port, tools: async () => [] }
  const m2 = new Mind({ ...base, mcp: bare, serverAssistant: { label: 'Claude' } })
  assert.match((await m2.respond('ask claude how many parks')).text, /not turned on for City GIS/)
  // In plain MCP mode, ask_assistant is never matched as an ordinary tool.
  const m3 = new Mind({ ...base, mcp: port })
  calls.length = 0
  await m3.respond('why did the zoning change downtown in the nineties')
  assert.equal(calls.filter(c => c.name === 'ask_assistant').length, 0)
  assert.ok((mind.complete('ask c') || []).some(x => /^ask Claude/i.test(x)))
})

test('the handoff can open the Claude desktop app', () => {
  const { assistantPort, handoffUrl, safeAssistantUrl, helperMode } = require('../src/brain/handoff.ts')
  assert.equal(helperMode('claude', null), 'claude')
  const app = assistantPort({ openIn: 'app', prefix: '/cgj-gis' })
  assert.equal(app.url, 'claude://claude.ai/new?q={q}')
  assert.equal(handoffUrl(app, 'zoning at city hall', null), 'claude://claude.ai/new?q=' + encodeURIComponent('/cgj-gis zoning at city hall'))
  assert.equal(safeAssistantUrl('claude://claude.ai/new?q={q}'), true)
  assert.equal(safeAssistantUrl('claude://evil.example/new?q={q}'), false)
  assert.equal(safeAssistantUrl('claude://claude.ai/code/new?folder=C:/'), false)
  assert.equal(assistantPort({ openIn: 'app', url: 'https://chat.example/?q={q}' }).url, 'https://chat.example/?q={q}', 'an address set by hand wins')
})

test('the second pack of acts: asked for by name, and shown at the right moments', async () => {
  const { ACT_MOODS, IDLE_ACTS, ACT_ASKS } = require('../src/brain/acts.ts')
  for (const name of ['calling', 'camera', 'route', 'pindrop', 'measure', 'chart', 'idea', 'layers', 'treasure', 'boat', 'kite', 'juggle', 'coffee']) assert.ok(ACT_MOODS.includes(name), name)
  for (const name of ['treasure', 'boat', 'kite', 'telescope', 'juggle', 'coffee', 'umbrella']) assert.ok(IDLE_ACTS.includes(name), name)
  const { mind } = fixture()
  for (const [say, mood] of [['find treasure', 'treasure'], ['be a boat', 'boat'], ['fly a kite', 'kite'], ['juggle', 'juggle'], ['coffee break', 'coffee'], ['say cheese', 'camera']]) {
    assert.ok(ACT_ASKS.some(([re, act]) => re.test(say) && act === mood), say)
    assert.equal((await mind.respond(say)).mood, mood, say)
  }
  assert.equal((await mind.respond('list layers')).mood, 'layers')
  // Every act has a drawing and motion of its own.
  const acts = fs.readFileSync(path.join(__dirname, '../src/runtime/components/Acts.tsx'), 'utf8')
  for (const name of [...ACT_MOODS, ...IDLE_ACTS]) {
    assert.ok(acts.includes(`case '${name}':`), 'drawing for ' + name)
    assert.ok(name === 'goodbye' || acts.includes(`.mappy-act-${name} `) || acts.includes(`mappy-${name}`) || /^(fingertap|headscratch|browraise|sway|atom|stack|airplane|glasses|headphones|bike|artsy|techy|wizardy|processing|writing|checking|alert|explain|knock|print|trash|mail|save|congratulate|calling|camera|route|pindrop|measure|chart|idea|layers|treasure|boat|kite|telescope|juggle|coffee|umbrella)$/.test(name), 'motion for ' + name)
  }
})

test('feelings: the small things people say to a friend, and what he remembers', () => {
  const { feel, emptyBond, bumpBond, readBond, milestone, welcomeBack, bondSummary, cleanName } = require('../src/brain/feelings.ts')
  const b = emptyBond()
  const mood = t => (feel(t, b) || {}).mood
  for (const [say, want] of [['how are you', /happy|sleepy/], ['Hey Mappy, how are you?', /happy|sleepy/], ["you're so cute", /shy/], ['good boy', /proud/], ['you are a lifesaver', /grateful/],
    ['you are useless', /sad/], ['sorry', /hug/], ['hug', /hug/], ['high five', /cheer/], ['lol', /laugh/], ['boo', /surprised/], ['guess what', /curious/], ['good night', /sleepy/],
    ["i'm so tired", /coffee/], ['rough day', /hug/], ["i'm sad", /hug/], ['it worked', /cheer/], ['wish me luck', /cheer/], ["i'm bored", /curious/], ['cheer me up', /grateful/],
    ['do you have feelings', /curious/], ['do you like me', /shy/], ['can we be friends', /love/], ["it's my birthday", /party/]]) assert.match(String(mood(say)), want, say)
  // Real requests are left alone.
  for (const say of ['turn on parcels', 'yes', 'ok', 'good', 'how many parcels', 'zoom to 250 N 5th St', 'find Smith in parcels', 'sad road', 'i am looking for parks', 'call 911', 'what is zoning', 'help', 'no', 'thanks']) assert.equal(feel(say, b), null, say)
  // Honest about what he is, and he points people toward people.
  assert.match(feel('are you alive', b).text, /paper and code/)
  assert.match(feel("i'm lonely", b).text, /someone good is close by/)
  // Names: offered, kept, used, forgotten.
  assert.deepEqual([cleanName('sam'), cleanName('mary jo'), cleanName('tired'), cleanName('x'), cleanName('a b c')], ['Sam', 'Mary Jo', '', '', ''])
  const named = feel('call me sam', b)
  assert.equal(named.name, 'Sam')
  assert.match(named.text, /Nice to meet you, Sam|Sam! Good name/)
  assert.equal(feel('call me tired', b).name, undefined)
  const known = { ...b, name: 'Sam', met: '2026-11-01', last: '2026-11-16', chats: 41, days: 9, streak: 3 }
  assert.match(feel('what is my name', known, 'Mappy', new Date(2026, 10, 17)).text, /^You are Sam! We met 16 days ago, Sam\. Since then: 41 questions over 9 days, 3 days in a row/)
  assert.equal(feel('forget my name', known).name, null)
  assert.match(feel('how long have we known each other', b).text, /only just met/)
  // The count: a new day, a streak, a gap.
  let bond = bumpBond(emptyBond(), new Date(2026, 10, 15))
  assert.deepEqual(bond, { chats: 1, days: 1, streak: 1, met: '2026-11-15', last: '2026-11-15' })
  bond = bumpBond(bond, new Date(2026, 10, 15)); assert.equal(bond.days, 1)
  bond = bumpBond(bond, new Date(2026, 10, 16)); assert.equal(bond.streak, 2)
  bond = bumpBond(bond, new Date(2026, 10, 17)); assert.deepEqual([bond.streak, bond.days, bond.chats], [3, 3, 4])
  bond = bumpBond(bond, new Date(2026, 10, 20)); assert.equal(bond.streak, 1)
  assert.deepEqual(readBond(JSON.stringify(bond)), bond)
  assert.deepEqual(readBond('{"name":"<script>","chats":-5,"met":"yesterday"}'), { name: 'Script', chats: 0, days: 0, streak: 0 })
  assert.deepEqual(readBond('not json'), emptyBond())
  assert.equal(milestone(100).includes('One hundred'), true)
  assert.equal(milestone(101), '')
  // The start of a visit.
  assert.equal(welcomeBack(emptyBond()), '')
  assert.equal(welcomeBack({ ...known, last: '2026-11-16' }, new Date(2026, 10, 17, 9)), 'Good morning, Sam! Day 4 in a row. I like this habit.')
  assert.equal(welcomeBack({ ...known, last: '2026-10-01' }, new Date(2026, 10, 17, 14)), 'Good afternoon, Sam! It has been a while. I kept your spot on the map.')
  assert.equal(welcomeBack({ ...known, name: undefined, last: '2026-11-17' }, new Date(2026, 10, 17, 14)), '')
  assert.equal(welcomeBack({ ...known, last: '2026-11-17' }, new Date(2026, 10, 17, 20)), 'Good evening, Sam!')
  assert.match(bondSummary(known, new Date(2026, 10, 17)), /in this browser only/)
})

test('feelings in the chat: moods, a remembered name, and a milestone line', async () => {
  const { live } = fixture()
  const kept = {}
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', store: { get: k => kept[k] ?? null, set: (k, v) => { if (v === null) delete kept[k]; else kept[k] = v } } })
  assert.equal((await mind.respond('hug')).mood, 'hug')
  assert.equal((await mind.respond('you are so cute')).mood, 'shy')
  assert.match((await mind.respond('call me Sam')).text, /Sam/)
  assert.equal(JSON.parse(kept['mappy-bond']).name, 'Sam')
  assert.match((await mind.respond('did you miss me')).text, /Sam/)
  assert.match((await mind.respond('what is my name')).text, /^You are Sam!/)
  await mind.respond('forget my name')
  assert.equal(JSON.parse(kept['mappy-bond']).name, undefined)
  // Questions together are counted, and the tenth gets a line.
  const before = JSON.parse(kept['mappy-bond']).chats
  let last
  for (let i = before; i < 10; i++) last = await mind.respond('list layers')
  assert.match(last.text, /our 10th question together/)
  assert.doesNotMatch((await mind.respond('list layers')).text, /question together/)
  // A real request with a feeling word in it is still a request.
  assert.notEqual((await mind.respond('turn on parcels')).mood, 'hug')
  // Jokes and holiday fun off: no small talk, no milestones.
  const plainMind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', fun: false })
  assert.notEqual((await plainMind.respond('rough day')).mood, 'hug')
  assert.equal(plainMind.welcome(), '')
})

test('"clear the filter" clears the map filter even when a data answer is on the table', async () => {
  const { live, mind, layer } = fixture()
  layer.visible = true
  await mind.respond('count parcels by owner')
  await mind.respond('only show parcels over 2 acres on the map')
  assert.ok(live.filtered().length, 'a map filter is on')
  const r = await mind.respond('clear the filter')
  assert.equal(live.filtered().length, 0, r.text)
})

test('a person to ask, privacy in plain words, forget everything and the missed list', async () => {
  const { parseCare, cleanContact, addMiss, worthKeeping } = require('../src/brain/care.ts')
  for (const q of ['talk to a person', 'can I speak to a human?', 'I need to talk to someone', 'contact support', 'who do I contact', 'report a problem with this map', 'the data is wrong', 'email the gis team', 'feedback']) assert.equal(parseCare(q), 'person', q)
  for (const q of ['privacy', 'what do you know about me', 'do you save my questions', 'is this private?', 'are you tracking me', 'where does my data go', 'who can see my chat']) assert.equal(parseCare(q), 'privacy', q)
  for (const q of ['forget everything', 'delete my data', 'erase everything']) assert.equal(parseCare(q), 'forgetAll', q)
  for (const q of ['what did you miss', 'missed questions', 'what stumped you']) assert.equal(parseCare(q), 'missed', q)
  // Real requests are never mistaken for these.
  for (const q of ['turn on parcels', 'who owns 250 Main St', 'find Smith in parcels', 'contact layer', 'who owns this', 'this is wrong layer', 'zoom to the support center', 'count people by status', 'call me Sam', 'forget my name', 'clear the filter', 'what do you know', 'who do I contact about a pothole']) assert.equal(parseCare(q), null, q)
  // Settings are checked: a bad email or an http page is left out, and nothing usable means no contact.
  assert.equal(cleanContact({ name: 'GIS', email: 'not an email', url: 'http://x.org' }), null)
  assert.deepEqual(cleanContact({ name: ' the GIS team ', email: 'gis@example.org', phone: '555-555-0100 x12', url: 'javascript:alert(1)', hours: 'weekdays 8 to 5' }), { name: 'the GIS team', email: 'gis@example.org', phone: '555-555-0100 x12', hours: 'weekdays 8 to 5' })
  // Private-looking text never goes on the missed list; a repeat counts up.
  assert.equal(worthKeeping('my ssn is 123-45-6789 what now'), false)
  assert.equal(worthKeeping('email me at sam@example.org'), false)
  assert.equal(addMiss(addMiss([], 'where is the moon base', 1), 'Where is the moon base?', 2)[0].n, 2)

  const { live } = fixture()
  const kept = {}
  const store = { get: k => (k in kept ? kept[k] : null), set: (k, v) => { if (v === null) delete kept[k]; else kept[k] = v } }
  const base = { live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', store }
  const mind = new Mind({ ...base, contact: cleanContact({ name: 'the GIS team', email: 'gis@example.org', phone: '555-555-0100', hours: 'weekdays 8 to 5' }) })
  // Asked for: who, when and how, with the last question written into the email.
  await mind.respond('list layers')
  const person = await mind.respond('talk to a person')
  assert.match(person.text, /the GIS team/); assert.match(person.text, /weekdays 8 to 5/)
  assert.match(person.actions[0].url, /^mailto:gis@example\.org\?subject=Question%20about%20Test%20map&body=/)
  assert.match(decodeURIComponent(person.actions[0].url), /My question: list layers/)
  assert.equal(person.actions[1].url, 'tel:5555550100')
  // Stuck once: no person yet. Stuck twice in a row: the person is offered, and both are remembered.
  const one = await mind.respond('where is the moon base located')
  assert.equal(one.mood, 'confused'); assert.ok(!(one.actions || []).some(a => /^mailto:/.test(a.url || '')))
  const two = await mind.respond('how tall is the moon base tower')
  assert.match(two.text, /the GIS team\*\* can help/); assert.ok(two.actions.some(a => /^mailto:/.test(a.url || '')))
  assert.equal(JSON.parse(kept['mappy-missed']).length, 2)
  // A good answer resets the count.
  await mind.respond('list layers')
  assert.ok(!((await mind.respond('where is the moon base located')).actions || []).some(a => /^mailto:/.test(a.url || '')))
  // The missed list, with a button that mails it.
  const missed = await mind.respond('what did you miss')
  assert.equal(missed.list.length, 2); assert.match(missed.list[0].detail, /asked 2 times/)
  assert.match(decodeURIComponent(missed.actions[0].url), /moon base tower/)
  // One click saves them as a spreadsheet file; formulas are made harmless.
  assert.equal(missed.save.label, 'Save as a spreadsheet file'); assert.match(missed.save.name, /^missed-questions-\d{4}-\d\d-\d\d\.csv$/)
  assert.match(missed.save.text, /^Last asked,Times asked,Question\r\n\d{4}-\d\d-\d\d,2,where is the moon base located\r\n/)
  assert.equal((await mind.respond('save missed questions')).save.text, missed.save.text)
  { const { missesCsv, maskNumbers, parseCare: pc } = require('../src/brain/care.ts')
    assert.match(missesCsv([{ q: '=cmd("x"), now', at: 0, n: 1 }]), /1970-01-01,1,"'=cmd\(""x""\), now"/)
    assert.equal(maskNumbers('who owns 2501  Oak St, parcel 2945-143-00-012'), 'who owns # Oak St, parcel #-#-00-#')
    assert.equal(pc('export the missed questions as a csv'), 'saveMissed') }
  // Sent to the usage table only when the builder turned that on, with long numbers masked.
  { const sent = []
    const quiet = new Mind({ ...base, store: { get: () => null, set: () => {} }, beacon: { action: (n, d) => sent.push([n, d]), error: () => {} } })
    await quiet.respond('where is moon base 4471 located')
    assert.ok(!sent.some(x => x[0] === 'miss'), 'off by default')
    const loud = new Mind({ ...base, store: { get: () => null, set: () => {} }, shareMisses: true, beacon: { action: (n, d) => sent.push([n, d]), error: () => {} } })
    await loud.respond('where is moon base 4471 located')
    assert.deepEqual(sent.filter(x => x[0] === 'miss'), [['miss', 'where is moon base # located']])
    await loud.respond('my card is 4111 1111 1111 1111 where is it')
    assert.equal(sent.filter(x => x[0] === 'miss').length, 1, 'private numbers never leave') }
  // Privacy: what is kept here, what leaves, and no claim of AI for a local helper.
  await mind.respond('call me Sam')
  const privacy = await mind.respond('what do you know about me')
  assert.match(privacy.text, /Kept in this browser only/); assert.match(privacy.text, /“Sam”/); assert.match(privacy.text, /Usage tracking:\*\* off/); assert.match(privacy.text, /do not use AI/)
  // Forget everything: the browser is clean and the widget is told to clear the chat.
  const gone = await mind.respond('forget everything')
  assert.equal(gone.effect, 'forgetAll')
  assert.equal(kept['mappy-missed'], undefined); assert.equal(kept['mappy-bond'], undefined)
  assert.match((await mind.respond('what did you miss')).text, /Nothing on my list/)
  // No contact set up: honest about it, and never a made-up address.
  const alone = new Mind({ ...base, store: undefined, place: { org: 'the County', name: '', website: 'https://example.org', facts: [] } })
  const none = await alone.respond('talk to a human')
  assert.match(none.text, /not a person/); assert.equal(none.actions[0].url, 'https://example.org')
  await alone.respond('where is the moon base located')
  assert.ok(!((await alone.respond('how tall is the moon base tower')).actions || []).some(a => /^mailto:/.test(a.url || '')))
})

test('keepsakes: passport stamps, the usual, a birthday, a nickname and a promise to come back', async () => {
  const K = require('../src/brain/keepsakes.ts')
  // Birthdays: month and day only, in the ways people write them.
  assert.equal(K.parseBirthday('March 3'), '03-03'); assert.equal(K.parseBirthday('3rd of march'), '03-03'); assert.equal(K.parseBirthday('12/25'), '12-25'); assert.equal(K.parseBirthday('Feb 30'), ''); assert.equal(K.parseBirthday('soon'), '')
  assert.equal(K.cleanNick('pip'), 'Pip'); assert.equal(K.cleanNick('stupid'), ''); assert.equal(K.cleanNick('x'), '')
  // A stored blob is read back safely: unknown stamps and odd values are dropped.
  const odd = K.readKeepsakes(JSON.stringify({ stamps: { first: '2026-01-01', hacker: '2026-01-01', chart: 'yesterday' }, thanks: -4, birthday: '13-40', nick: '<b>', layers: { Parcels: 3 } }))
  assert.deepEqual(odd.stamps, { first: '2026-01-01' }); assert.equal(odd.thanks, 0); assert.equal(odd.birthday, undefined); assert.equal(odd.nick, undefined); assert.equal(odd.layers.Parcels, 3)
  // Stamps are earned once, in passport order.
  const bond = { chats: 1, days: 1, streak: 1, met: '2026-11-17', last: '2026-11-17' }
  const noon = new Date(2026, 10, 17, 12)
  const a = K.remember(K.emptyKeepsakes(), { input: 'turn on parcels', intent: 'layerOn', layer: 'Parcels' }, bond, noon)
  assert.deepEqual(a.earned.map(s => s.id), ['first', 'layer'])
  assert.deepEqual(K.remember(a.keep, { input: 'turn on parcels', intent: 'layerOn', layer: 'Parcels' }, bond, noon).earned, [])
  assert.deepEqual(K.remember(a.keep, { input: 'count parcels' , intent: 'count' }, bond, new Date(2026, 10, 21, 23)).earned.map(s => s.id), ['count', 'owl', 'weekend'])
  assert.deepEqual(K.remember(a.keep, {}, { ...bond, streak: 7, chats: 100 }, noon).earned.map(s => s.id), ['regular', 'devoted', 'curious', 'century'])
  // A greeting only he could give: a birthday (once), and a kept promise.
  const bday = K.keepsakeHello({ ...K.emptyKeepsakes(), birthday: '11-17' }, { ...bond, name: 'Sam' }, noon)
  assert.match(bday.line, /Happy birthday, Sam/); assert.equal(K.keepsakeHello(bday.keep, bond, noon).line, '')
  const kept1 = K.keepsake('see you tomorrow', K.emptyKeepsakes(), bond, 'Mappy', noon)
  assert.deepEqual(kept1.keep.promise, { said: '2026-11-17', due: '2026-11-18' })
  assert.equal(K.keepsakeHello(kept1.keep, bond, noon).line, '')
  const back = K.keepsakeHello(kept1.keep, bond, new Date(2026, 10, 18, 9))
  assert.match(back.line, /You said you would be back today/); assert.equal(back.keep.promise, undefined)
  assert.match(K.keepsakeHello(kept1.keep, bond, new Date(2026, 10, 25, 9)).line, /I kept your spot/)
  assert.deepEqual(K.keepsake('see you monday', K.emptyKeepsakes(), bond, 'Mappy', noon).keep.promise.due, '2026-11-23')
  // Real requests are left alone.
  for (const q of ['turn on parcels', 'show stamps layer', 'find usual in parcels', 'my birthday layer', 'see you', 'call me Sam', 'who are you', 'what is my favorite color', 'zoom to passport office']) assert.equal(K.keepsake(q, K.emptyKeepsakes(), bond), null, q)

  // In the chat.
  const { live, layer } = fixture()
  const kept = {}
  const store = { get: k => (k in kept ? kept[k] : null), set: (k, v) => { if (v === null) delete kept[k]; else kept[k] = v } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', store })
  const first = await mind.respond('turn on parcels')
  assert.match(first.text, /New stamps in your passport: 📄 \*\*First Fold\*\*, 🗂️ \*\*Layer Peeker\*\*/); assert.match(first.text, /my stamps/)
  assert.doesNotMatch((await mind.respond('turn on parcels')).text, /stamp/)
  assert.match((await mind.respond('count parcels by owner')).text, /Chart Maker|Table Turner/)
  // A miss earns nothing and is not a "usual".
  assert.doesNotMatch((await mind.respond('where is the moon base located')).text, /stamp/)
  const book = await mind.respond('my stamps')
  assert.doesNotMatch(book.text, /New stamp/)
  assert.match(book.text, /of 23\*\* stamps/); assert.equal(book.keepsake.kind, 'passport'); assert.equal(book.keepsake.stamps.length, 23); assert.match(book.keepsake.stamps[0].day, /^[A-Z][a-z]{2} \d+, \d{4}$/); assert.equal(book.keepsake.stamps[22].day, undefined)
  // The usual: asked twice, offered as a button, and under the greeting.
  assert.deepEqual(mind.usual(), ['turn on parcels'])
  const usual = await mind.respond('the usual')
  assert.equal(usual.actions[0].q, 'turn on parcels')
  assert.match((await mind.respond("what's my favorite layer")).text, /\*\*Parcels\*\*/)
  // A nickname: he answers to it.
  assert.match((await mind.respond('can I call you Pip?')).text, /Pip/)
  assert.equal((await mind.respond('hey pip, how are you')).mood === 'confused', false)
  assert.match((await mind.respond('what do I call you')).text, /you call me \*\*Pip\*\*/)
  // Thanks are counted, and the fifth earns a stamp.
  let thanks
  for (let i = 0; i < 5; i++) thanks = await mind.respond('thanks')
  assert.match(thanks.text, /Kind Words/)
  assert.match((await mind.respond('how many times have I thanked you')).text, /^5 times/)
  // A birthday, kept as month and day; our story pulls it together; privacy lists it.
  assert.match((await mind.respond('my birthday is March 3, 1990')).text, /March 3\. I wrote it in the margin/)
  assert.equal(JSON.parse(kept['mappy-keepsakes']).birthday, '03-03')
  const story = await mind.respond('our story')
  assert.match(story.text, /We met on/); assert.match(story.text, /favorite layer is \*\*Parcels\*\*/); assert.match(story.text, /you call me Pip/)
  const privacy = await mind.respond('what do you know about me')
  assert.match(privacy.text, /passport stamps/); assert.match(privacy.text, /your birthday \(month and day\)/)
  // How close you are, in hearts; a new level is said once.
  assert.equal(K.closeness(K.emptyKeepsakes(), { chats: 0, days: 0, streak: 0 }).name, 'New Fold')
  assert.equal(K.closeness({ ...K.emptyKeepsakes(), stamps: { first: '2026-01-01', layer: '2026-01-01' } }, { chats: 5, days: 1, streak: 1 }).name, 'Pen Pals')
  const up = K.remember(K.emptyKeepsakes(), { input: 'list layers' }, { chats: 110, days: 2, streak: 1 }, noon)
  assert.match(up.levelUp, /♥♥♥♡♡ We just became \*\*Trail Buddies\*\*/); assert.equal(K.remember(up.keep, { input: 'list layers' }, { chats: 111, days: 2, streak: 1 }, noon).levelUp, '')
  assert.match((await mind.respond('how close are we')).text, /♥+♡* \*\*/)
  // A postcard: a picture with their name in it, safely.
  const card = await mind.respond('write me a postcard')
  assert.equal(card.keepsake.kind, 'postcard'); assert.equal(card.keepsake.from, 'Pip')
  const svg = K.postcardSvg({ ...card.keepsake, to: '<Sam & "Co">' })
  assert.match(svg, /^<svg xmlns/); assert.match(svg, /Dear &lt;Sam &amp; &quot;Co&quot;&gt;,/); assert.doesNotMatch(svg, /<script|<Sam/)
  // A hard day is remembered for one kind word next time, then let go.
  await mind.respond('rough day')
  assert.equal(JSON.parse(kept['mappy-keepsakes']).rough.length, 10)
  const tomorrow = new Date(Date.now() + 86400000)
  assert.match(mind.welcome(tomorrow), /kinder than last time|a little lighter today/)
  assert.equal(JSON.parse(kept['mappy-keepsakes']).rough, undefined)
  // Forget everything takes the keepsakes too.
  await mind.respond('forget everything')
  assert.equal(kept['mappy-keepsakes'], undefined); assert.deepEqual(mind.usual(), [])
  // Fun turned off: no stamps, no keepsake talk.
  const plainMind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', fun: false })
  layer.visible = false
  assert.doesNotMatch((await plainMind.respond('turn on parcels')).text, /stamp/)
  assert.doesNotMatch((await plainMind.respond('my stamps')).text, /passport/)
})

test('plain questions are read against what the layers hold: names, fields and values', async () => {
  const { readAsk, fieldFor, namedFeature } = require('../src/brain/ask.ts')
  const S = (n, a) => ({ name: n, alias: a, type: 'esriFieldTypeString' }); const N = (n, a, t = 'esriFieldTypeDouble') => ({ name: n, alias: a, type: t }); const D = (n, a) => ({ name: n, alias: a, type: 'esriFieldTypeDate' })
  const layers = [
    { key: 'hydrants', title: 'Fire Hydrants', displayField: 'FACILITYID', fields: [S('FACILITYID', 'Facility ID'), N('INSTALL_YEAR', 'Install Year', 'esriFieldTypeInteger'), S('STATUS', 'Status'), N('FLOW_GPM', 'Flow (GPM)', 'esriFieldTypeInteger'), D('LAST_INSPECTED', 'Last Inspected')], values: { STATUS: ['Active', 'Out of service'] } },
    { key: 'streets', title: 'Streets', displayField: 'NAME', fields: [S('NAME', 'Street Name'), S('SURFACE', 'Surface'), N('LANES', 'Lanes', 'esriFieldTypeInteger'), N('SPEED_LIMIT', 'Speed Limit', 'esriFieldTypeInteger')], values: { NAME: ['Maple St', 'Oak St'], SURFACE: ['Asphalt', 'Chip seal'] } },
    { key: 'parks', title: 'Parks', displayField: 'NAME', fields: [S('NAME', 'Park Name'), N('ACRES', 'Acres'), S('PLAYGROUND', 'Playground'), N('OPENED', 'Year Opened', 'esriFieldTypeInteger')], values: { NAME: ['Compass Park', 'Fold Field'], PLAYGROUND: ['Yes', 'No'] } },
    { key: 'parcels', title: 'Parcels', displayField: 'ADDRESS', fields: [S('ADDRESS', 'Address'), S('OWNER', 'Owner'), N('ACRES', 'Acres'), S('ZONING', 'Zoning'), S('LAND_USE', 'Land Use'), N('YEAR_BUILT', 'Year Built', 'esriFieldTypeInteger'), D('SALE_DATE', 'Sale Date'), N('ASSESSED_VALUE', 'Assessed Value', 'esriFieldTypeInteger')], values: { OWNER: ['Rivera', 'Town of Mapleton'], ZONING: ['R-4', 'R-8', 'C-1', 'MU'], LAND_USE: ['Residential', 'Commercial', 'Civic'] } },
    { key: 'zoning', title: 'Zoning', displayField: 'ZONE', fields: [S('ZONE', 'Zone'), N('MAX_HEIGHT_FT', 'Max Height (ft)', 'esriFieldTypeInteger')], values: { ZONE: ['R-4', 'R-8', 'C-1', 'MU'] } }
  ]
  const now = new Date(2026, 10, 17)
  const read = (q, fallback) => { const a = readAsk(q, layers, { now, fallback }); return a && { layer: a.layer, kind: a.kind, where: a.clauses.map(c => c.sql).join(' AND '), field: a.field && a.field.name, stat: a.stat, group: a.group && a.group.name, order: a.order, limit: a.limit, unknown: a.unknown.join(' ') } }
  const is = (q, want, fallback) => { const got = read(q, fallback); for (const k of Object.keys(want)) assert.equal(got && got[k], want[k], `${q}: ${k} (${JSON.stringify(got)})`) }
  // Values people say are matched to the field that holds them.
  is('how many parcels are zoned R-4', { layer: 'parcels', kind: 'count', where: "ZONING = 'R-4'" })
  is('how many R-4 parcels', { kind: 'count', where: "ZONING = 'R-4'" })
  is('which parcels are commercial', { kind: 'list', where: "LAND_USE = 'Commercial'" })
  is('hydrants out of service', { layer: 'hydrants', where: "STATUS = 'Out of service'" })
  is('parcels not zoned R-4', { where: "ZONING <> 'R-4'" })
  is("how many parcels aren't residential", { kind: 'count', where: "LAND_USE <> 'Residential'" })
  is('comercial parcels', { where: "LAND_USE = 'Commercial'" })
  is('parcels owned by Rivera', { kind: 'list', where: "OWNER = 'Rivera'" })
  is('show me everything owned by Town of Mapleton', { layer: 'parcels', where: "OWNER = 'Town of Mapleton'" })
  // Numbers land on the field the words point at, not on the first number field.
  is('parcels worth more than 500000', { where: 'ASSESSED_VALUE > 500000' })
  is('parcels over $500,000', { where: 'ASSESSED_VALUE > 500000' })
  is('commercial parcels worth more than 600k', { where: "ASSESSED_VALUE > 600000 AND LAND_USE = 'Commercial'" })
  is('parcels between 2 and 5 acres', { where: '(ACRES >= 2 AND ACRES <= 5)' })
  is('parcels bigger than 5 acres in R-4', { where: "ACRES > 5 AND ZONING = 'R-4'" })
  is('which streets have 4 lanes', { layer: 'streets', where: 'LANES = 4' })
  is('streets with speed limit over 25', { layer: 'streets', where: 'SPEED_LIMIT > 25' })
  is('hydrants with flow under 1000 gpm', { layer: 'hydrants', where: 'FLOW_GPM < 1000' })
  // Time: verbs pick the date or year field.
  is('parcels built before 1960', { where: 'YEAR_BUILT < 1960' })
  is('hydrants installed after 2010', { where: 'INSTALL_YEAR >= 2011' })
  is('how many parcels were built in the 1950s', { kind: 'count', where: '(YEAR_BUILT >= 1950 AND YEAR_BUILT <= 1959)' })
  is('parcels older than 50 years', { where: 'YEAR_BUILT < 1976' })
  assert.match(read('parcels sold in 2025').where, /^\(SALE_DATE >= TIMESTAMP '2025-01-01 00:00:00' AND SALE_DATE < TIMESTAMP '2026-01-01 00:00:00'\)$/)
  // Yes and no fields.
  is('parks with a playground', { layer: 'parks', where: "PLAYGROUND = 'Yes'" })
  is('parks without a playground', { where: "PLAYGROUND = 'No'" })
  // Rankings, totals and averages.
  is('biggest parcel', { kind: 'top', field: 'ACRES', order: 'desc', limit: 1 })
  is('most expensive parcel', { kind: 'top', field: 'ASSESSED_VALUE', order: 'desc' })
  is('cheapest parcel', { kind: 'top', field: 'ASSESSED_VALUE', order: 'asc' })
  is('oldest hydrant', { layer: 'hydrants', kind: 'top', field: 'INSTALL_YEAR', order: 'asc' })
  is('top 5 parcels by assessed value', { kind: 'top', field: 'ASSESSED_VALUE', limit: 5 })
  is('average assessed value', { layer: 'parcels', kind: 'stat', stat: 'avg', field: 'ASSESSED_VALUE' })
  is('total acres of parcels', { kind: 'stat', stat: 'sum', field: 'ACRES' })
  is('how many acres are zoned R-4', { kind: 'stat', stat: 'sum', field: 'ACRES', where: "ZONING = 'R-4'" })
  // Groups and value lists.
  is('parcels by land use', { kind: 'group', group: 'LAND_USE' })
  is('average acres by zoning in parcels', { kind: 'group', group: 'ZONING', stat: 'avg', field: 'ACRES' })
  is('which zoning has the most parcels', { layer: 'parcels', kind: 'group', group: 'ZONING', order: 'desc' })
  is('which land use has the highest average value', { kind: 'group', group: 'LAND_USE', stat: 'avg', field: 'ASSESSED_VALUE' })
  is('least common land use', { kind: 'group', group: 'LAND_USE', order: 'asc' })
  is('who owns the most land', { layer: 'parcels', kind: 'group', group: 'OWNER', stat: 'sum', field: 'ACRES' })
  is('what zoning types are there', { layer: 'zoning', kind: 'distinct', field: 'ZONE' })
  is('how many different owners are there', { kind: 'distinct', field: 'OWNER' })
  // One field of the records that match; a field named outright keeps its words ("max" is not a ranking here).
  is('what is the max height in MU', { layer: 'zoning', kind: 'attr', field: 'MAX_HEIGHT_FT', where: "ZONE = 'MU'" })
  is("what's the speed limit on Oak St", { layer: 'streets', kind: 'attr', field: 'SPEED_LIMIT', where: "NAME = 'Oak St'" })
  // Follow-ups with no layer said use the one in hand.
  is('what about the smallest', { layer: 'parcels', kind: 'top', field: 'ACRES', order: 'asc' }, 'parcels')
  is('which are out of service', { layer: 'hydrants', where: "STATUS = 'Out of service'" }, 'hydrants')
  // A word that lands on nothing is reported, never dropped.
  is('how many haunted parcels', { kind: 'count', unknown: 'haunted' })
  // Not data questions: commands, places, percent, small talk, a bare layer name.
  for (const q of ['turn on parcels', 'zoom to parcels', 'parcels', 'show parcels', 'what parks are there', 'closest hydrant to City Hall', 'hydrants within 500 feet of City Hall', 'what percent of parcels are over 5 acres', 'how many parcels in view', 'hello', 'what can you do', 'how do I print']) assert.equal(readAsk(q, layers, { now }), null, q)
  assert.equal(fieldFor('zoned mu', layers[3].fields), null, 'a field word plus a value is not a field name')
  assert.equal(namedFeature('Maple St', layers).layer.key, 'streets'); assert.equal(namedFeature('the moon', layers), null)

  // In the chat: the number first, how it was read, and what to do next.
  const { mind, layer, queries } = fixture()
  const n = await mind.respond('how many parcels')
  assert.match(n.text, /^There are \*\*42\*\* parcels\./); assert.equal(queries.length, 1)
  assert.ok(n.actions.some(a => a.label === 'Turn on Parcels'), 'a layer that is off still answers, and offers to turn on')
  assert.equal(layer.visible, false)
  const stuck = await mind.respond('how many haunted parcels')
  // (This fixture answers every text search, so the word is found as text here; a real layer reports it.)
  assert.ok(/parcels match|could not match/.test(stuck.text))
})

test('read aloud: what is said, how it is cut, and which voice is picked', () => {
  const { sayable, sentences, pickVoice, voiceScore } = require('../src/brain/speech.ts')
  // The answer without markup, links, emoji or asides; units a voice can read.
  assert.equal(sayable('**8** parcels match (Zoning R-4). That is 22% of the 36 in the layer.\n\nNew stamp in your passport: 🔢 **Bean Counter**.'), '8 parcels match (Zoning R-4). That is 22 percent of the 36 in the layer.')
  assert.equal(sayable('City Hall is **610 ft** from the library 🎉 see https://example.org/x\n\n(I read that as “city hall”.)'), 'City Hall is 610 feet from the library see link')
  assert.equal(sayable('♥♥♡♡♡ We are **Pen Pals** now.'), '')
  assert.equal(sayable('Owner: **Smith** · Parcel MP-1010\nscale 1:2,400'), 'Owner: Smith, Parcel MP-1010. scale 1 to 2,400')
  // Sentence-sized pieces, never longer than asked.
  assert.deepEqual(sentences('One. Two! Three?', 8), ['One.', 'Two!', 'Three?'])
  assert.deepEqual(sentences('One. Two! Three?', 40), ['One. Two! Three?'])
  const long = sentences('a'.repeat(30) + ', ' + 'b '.repeat(60) + '. Short one.', 60)
  assert.ok(long.length >= 3 && long.every(p => p.length <= 60), JSON.stringify(long.map(p => p.length)))
  assert.deepEqual(sentences('', 50), [])
  // A natural voice beats the default; the right language beats a nicer voice in another one; a preferred name wins.
  const voices = [{ name: 'Microsoft David - English (United States)', lang: 'en-US', default: true, localService: true }, { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false }, { name: 'Microsoft Denise Online (Natural) - French (France)', lang: 'fr-FR', localService: false }, { name: 'Google UK English Female', lang: 'en-GB', localService: false }, { name: 'Zarvox', lang: 'en-US', localService: true }, { name: 'Samantha (Enhanced)', lang: 'en-US', localService: true }]
  // Online voices send the words to the browser's maker, so they are used only when the builder allows it.
  assert.equal(pickVoice(voices, 'en-US').name, 'Samantha (Enhanced)')
  assert.equal(pickVoice(voices, 'en-US', 'Google UK English Female').name, 'Samantha (Enhanced)')
  assert.match(pickVoice(voices, 'en-US', undefined, true).name, /Aria Online \(Natural\)/)
  assert.match(pickVoice(voices, 'fr-CA', undefined, true).name, /Denise/)
  assert.equal(pickVoice(voices, 'en-US', 'Google UK English Female', true).name, 'Google UK English Female')
  assert.equal(pickVoice(voices.slice(0, 1).concat(voices.slice(4, 5)), 'en-US').name, 'Microsoft David - English (United States)')
  assert.ok(voiceScore(voices[4], 'en-US') < voiceScore(voices[0], 'en-US'))
  assert.equal(pickVoice([], 'en-US'), null)
})

test('questions land on the right field when names are short forms with no aliases (assessor and utility layers)', () => {
  const { readAsk } = require('../src/brain/ask.ts')
  const { fieldLabel } = require('../src/brain/fields.ts')
  const f = (name, type = 'string', alias) => ({ name, alias: alias || name, type })
  const layers = [
    { key: 'parcels', title: 'Parcels', displayField: 'STRNAME', fields: [f('OBJECTID', 'oid'), f('PARCEL_NUM'), f('LOCATION'), f('OWNER'), f('JTOWNER'), f('STRNAME'), f('SPRICE', 'double'), f('SDATE', 'date'), f('PROPTYPE'), f('AYB1ST', 'integer'), f('EFFYRBLT1ST', 'integer'), f('TOTHTSQF', 'double'), f('BDRMS1ST', 'integer'), f('LNDUSE'), f('LNDVALCUR', 'double'), f('IMPVALCUR', 'double'), f('TOTVALCUR', 'double'), f('LNDVALPRE', 'double'), f('TOTVALPRE', 'double'), f('ZONING'), f('Acres', 'double'), f('created_date', 'date'), f('last_edited_date', 'date')] },
    { key: 'sewer', title: 'Sewer Lines', displayField: 'PIPE_ID', fields: [f('OBJECTID', 'oid'), f('PIPE_ID', 'string', 'Pipe ID'), f('PIPE_DIA', 'integer', 'Dia/Height (in)'), f('PIPE_DT_CONS', 'date', 'Date Constructed'), f('PIPE_LENGTH', 'double', 'Length (ft)'), f('PIPE_SLOPE', 'double', 'Slope %')] },
    { key: 'parks', title: 'Parks', displayField: 'Name', fields: [f('OBJECTID', 'oid'), f('Name'), f('Acreage', 'double'), f('ADACompliant', 'small-integer'), f('Installed', 'date'), f('Type')] }
  ]
  // Short forms read as words.
  for (const [name, label] of [['SPRICE', 'Sale Price'], ['SDATE', 'Sale Date'], ['TOTVALCUR', 'Total Value Current'], ['LNDVALCUR', 'Land Value Current'], ['LNDUSE', 'Land Use'], ['PROPTYPE', 'Property Type'], ['AYB1ST', 'Actual Year Built 1st'], ['BDRMS1ST', 'Bedrooms 1st']]) assert.equal(fieldLabel({ name }), label, name)
  const now = new Date(2026, 10, 17)
  const is = (q, want) => { const a = readAsk(q, layers, { now }); const got = a && { layer: a.layer, kind: a.kind, where: a.clauses.map(c => c.sql).join(' AND '), field: a.field && a.field.name, group: a.group && a.group.name, order: a.order }; for (const k of Object.keys(want)) assert.equal(got && got[k], want[k], `${q}: ${k} (${JSON.stringify(got)})`) }
  // Value means the total, current one; size means acres, not heated square feet; old means year built.
  is('most expensive parcel', { kind: 'top', field: 'TOTVALCUR', order: 'desc' })
  is('average parcel value', { kind: 'stat', field: 'TOTVALCUR' })
  is('parcels worth more than 1000000', { where: 'TOTVALCUR > 1000000' })
  is('biggest parcel', { kind: 'top', field: 'Acres' })
  is('oldest parcel', { kind: 'top', field: 'AYB1ST', order: 'asc' })
  is('parcels built before 1950', { where: 'AYB1ST < 1950' })
  // Sales have their own price and date.
  is('parcels sold for more than 500000', { where: 'SPRICE > 500000' })
  is('highest sale price', { kind: 'top', field: 'SPRICE' })
  assert.match(readAsk('parcels sold in 2025', layers, { now }).clauses[0].sql, /^\(SDATE >= TIMESTAMP '2025-01-01/)
  is('parcels with more than 4 bedrooms', { where: 'BDRMS1ST > 4' })
  is('parcels by land use', { kind: 'group', group: 'LNDUSE' })
  is('parcels owned by Smith Family Trust', { where: "UPPER(OWNER) LIKE '%SMITH FAMILY TRUST%'" })
  // Pipes: inches mean diameter, a field's word then a number is "equals".
  is('sewer lines over 12 inches', { layer: 'sewer', where: 'PIPE_DIA > 12' })
  is('sewer lines with diameter 8', { where: 'PIPE_DIA = 8' })
  is('longest sewer line', { kind: 'top', field: 'PIPE_LENGTH' })
  is('oldest sewer line', { kind: 'top', field: 'PIPE_DT_CONS', order: 'asc' })
  // A flag stored as 1 and 0.
  is('which parks are ADA compliant', { layer: 'parks', kind: 'list', where: 'ADACompliant = 1' })
  is('total acreage of parks', { kind: 'stat', field: 'Acreage' })
})

test('census and place-in-numbers questions answer from the saved facts', async () => {
  const { live } = fixture()
  const facts = ["The Census Bureau estimates Springfield's population at 65,560. (US Census ACS)", 'The median age in Springfield is 38.9. (US Census ACS)', 'The median home value in Springfield is about $331,000. (US Census ACS)', 'Springfield sees about 22 inches of snow in a typical year. (Open-Meteo)', 'Springfield sits at about 4,583 feet (1,397 m) above sea level. (Wikidata)']
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', place: { org: 'the City', name: 'Springfield', website: '', facts } })
  for (const q of ['census', 'census facts', 'show me the census data', "what's the population", 'what is the median home value', 'how many people live here', 'how much snow do we get', 'demographics', 'whats the elevation']) assert.equal(parseIntent(q).name, 'placeStats', q)
  const c = await mind.respond('census facts')
  assert.match(c.text, /Springfield in numbers/)
  assert.equal(c.list.length, 3)
  assert.match((await mind.respond("what's the population")).text, /population at 65,560/)
  assert.match((await mind.respond('median home value')).text, /\$331,000/)
  assert.match((await mind.respond('how much snow do we get')).text, /22 inches of snow/)
  const none = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', place: { org: 'the City', name: 'Springfield', website: '', facts: [] } })
  assert.match((await none.respond('census')).text, /add a free Census API key/)
})

