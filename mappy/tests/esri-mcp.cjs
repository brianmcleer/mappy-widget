// node tests/esri-mcp.cjs [path to the host's typescript package]
// Mappy with Esri's own MCP server (MCP for ArcGIS Enterprise, default catalog): the tools are
// used by name with the inputs Esri documents, and their answers are read whatever shape they take.
// The stand-in server below follows https://doc.esri.com/en/mcp-arcgis-enterprise/latest/ (2026.0).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require(process.argv[2] || 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const originalLoad = Module._load
Module._load = function (name, ...args) { if (name === 'jimu-core') return { loadArcGISJSAPIModules: async () => { throw new Error('Unexpected SDK call in test') } }; return originalLoad.call(this, name, ...args) }
const E = require('../src/brain/esriMcp.ts')
const { McpClient } = require('../src/runtime/mcp.ts')
const { LiveMap } = require('../src/runtime/live.ts')
const { Mind } = require('../src/runtime/mind.ts')
const { MappyIndex } = require('../src/brain/engine.ts')

const obj = (properties, required = []) => ({ type: 'object', properties, required })
const ro = { readOnlyHint: true }
/** The default catalog's built-in tools, with the inputs Esri documents. */
const CATALOG = [
  { name: 'search_portal_content', description: 'Search the portal for items.', inputSchema: obj({ q: { type: 'string' }, type: { type: 'string' }, typekeyword: { type: 'string' }, tag: { type: 'string' }, owner: { type: 'string' }, start: { type: 'integer' }, num: { type: 'integer' }, sortField: { type: 'string' }, sortOrder: { type: 'string' } }), annotations: ro },
  { name: 'describe_item', description: 'Describe a portal item by id.', inputSchema: obj({ itemId: { type: 'string' }, fetchAdditionalDetails: { type: 'boolean' } }, ['itemId']), annotations: ro },
  { name: 'describe_layer', description: 'Fields and example values of a layer.', inputSchema: obj({ serviceUrl: { type: 'string' }, layerId: { type: 'integer' } }, ['serviceUrl', 'layerId']), annotations: ro },
  { name: 'query_data', description: 'Query a feature layer or table.', inputSchema: obj({ layerOrTableUrl: { type: 'string' }, where: { type: 'string' }, geometry: { type: 'string' }, geometryType: { type: 'string' }, statistics: { type: 'array', items: obj({ statisticType: { type: 'string' }, onField: { type: 'string' } }) }, groupByField: { type: 'string' }, orderByFields: { type: 'array', items: { type: 'string' } }, pageSize: { type: 'integer' }, resultOffset: { type: 'integer' }, returnGeometry: { type: 'boolean' } }, ['layerOrTableUrl']), annotations: ro },
  { name: 'get_map_image', description: 'Export a map image from a map service.', inputSchema: obj({ serviceUrl: { type: 'string' }, bbox: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' } }), annotations: ro },
  { name: 'find_address_candidates', description: 'Find candidate locations for an address.', inputSchema: obj({ singleLine: { type: 'string' }, outWkid: { type: 'integer' }, searchExtent: { type: 'string' }, geocodeServerName: { type: 'string' }, geocodeServerUrl: { type: 'string' } }, ['singleLine']), annotations: ro },
  { name: 'reverse_geocode', description: 'Nearest street address for a coordinate.', inputSchema: obj({ x: { type: 'number' }, y: { type: 'number' }, wkid: { type: 'integer' }, outSR: { type: 'integer' } }, ['x', 'y']), annotations: ro },
  { name: 'solve_route', description: 'Route between a start and an end.', inputSchema: obj({ start: { type: 'object' }, end: { type: 'object' }, stops: { type: 'array' }, travelMode: { type: 'string' }, inWkid: { type: 'integer' }, outWkid: { type: 'integer' } }, ['start', 'end']), annotations: ro },
  { name: 'get_gp_task_definition', description: 'A geoprocessing task and its inputs.', inputSchema: obj({ taskUrl: { type: 'string' } }), annotations: ro },
  { name: 'get_gp_task_job_status', description: 'Status of a geoprocessing job.', inputSchema: obj({ jobId: { type: 'string' } }), annotations: ro },
  { name: 'get_search_portal_content_passthrough_instructions', description: 'How to write a raw search.', inputSchema: obj({}), annotations: ro }
]

const STOPS_URL = 'https://gis.example.org/server/rest/services/Transit/FeatureServer'
const STOPS = [
  { OBJECTID: 1, STOP_NAME: 'Main & 1st', ROUTE: 'Red', SHELTER: 'Yes', RIDERS: 420 },
  { OBJECTID: 2, STOP_NAME: 'Main & 5th', ROUTE: 'Red', SHELTER: 'No', RIDERS: 150 },
  { OBJECTID: 3, STOP_NAME: 'Oak & 2nd', ROUTE: 'Blue', SHELTER: 'Yes', RIDERS: 610 },
  { OBJECTID: 4, STOP_NAME: 'Oak & 9th', ROUTE: 'Blue', SHELTER: 'No', RIDERS: 90 },
  { OBJECTID: 5, STOP_NAME: 'Depot', ROUTE: 'Blue', SHELTER: 'Yes', RIDERS: 980 },
  { OBJECTID: 6, STOP_NAME: 'Mall', ROUTE: 'Green', SHELTER: 'No', RIDERS: 300 }
]
const ITEMS = [
  { id: 'a'.repeat(32), title: 'Bus Stops', type: 'Feature Service', url: STOPS_URL, snippet: 'Every transit stop.', owner: 'gis', tags: ['mcp'] },
  { id: 'b'.repeat(32), title: 'Zoning Map', type: 'Web Map', snippet: 'Zoning districts.', owner: 'planning', tags: ['mcp'] },
  { id: 'c'.repeat(32), title: 'Zoning Districts', type: 'Feature Service', url: 'https://gis.example.org/server/rest/services/Zoning/FeatureServer', snippet: 'Zoning polygons.', owner: 'planning', tags: ['mcp'] },
  { id: 'd'.repeat(32), title: 'Zoning Overlays', type: 'Feature Service', url: 'https://gis.example.org/server/rest/services/Overlays/FeatureServer', snippet: 'Overlay districts.', owner: 'planning', tags: ['mcp'] }
]
/** A small SQL-92 WHERE reader for the stand-in: =, <>, <, >, <=, >=, AND, IS NOT NULL, quoted text. */
function matches (where, row) {
  if (!where || where === '1=1') return true
  const js = where.replace(/\b1\s*=\s*1\b/g, 'true').replace(/'((?:[^']|'')*)'/g, (m, v) => JSON.stringify(v.replace(/''/g, "'"))).replace(/\bIS NOT NULL\b/gi, '!= null').replace(/\bIS NULL\b/gi, '== null')
    .replace(/<>/g, '!==').replace(/(^|[^<>!=])=(?!=)/g, '$1===').replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\b([A-Z][A-Z_]+)\b(?!")/g, (m, f) => f in row ? `row[${JSON.stringify(f)}]` : m)
  // eslint-disable-next-line no-new-func
  return !!new Function('row', `return (${js})`)(row)
}
function text (data) { return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false } }

/** A stand-in for MCP for ArcGIS Enterprise. `shape` picks how answers are wrapped, since Esri does not pin it down. */
function enterprise (shape = 'structured') {
  const calls = []
  const wrap = data => shape === 'structured' ? { content: [{ type: 'text', text: 'ok' }], structuredContent: data, isError: false } : text(data)
  const tools = {
    search_portal_content: a => {
      const q = String(a.q || '').toLowerCase().replace(/s\b/g, '')
      const hits = ITEMS.filter(i => (!a.type || i.type === a.type) && (!q || q.split(/\s+/).some(w => `${i.title} ${i.snippet}`.toLowerCase().includes(w)))).slice(0, a.num || 5)
      return wrap({ total: hits.length, results: hits.map(i => i.url === STOPS_URL ? { ...i, serviceDefinition: { layers: [{ id: 0, name: 'Bus Stops' }, { id: 1, name: 'Bus Routes' }], tables: [] } } : i) })
    },
    describe_item: a => wrap({ item: ITEMS.find(i => i.id === a.itemId), additionalDetails: { layers: [{ id: 0, name: 'Districts' }] } }),
    describe_layer: a => {
      assert.ok(!/\/\d+$/.test(a.serviceUrl), 'describe_layer gets the service URL, not the layer URL')
      assert.equal(typeof a.layerId, 'number')
      if (a.serviceUrl !== STOPS_URL) return wrap({ name: 'Districts', type: 'Feature Layer', fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }, { name: 'ZONE', type: 'esriFieldTypeString', alias: 'Zone', sampleValues: ['R-4', 'C-1'] }] })
      return wrap({ name: 'Bus Stops', type: 'Feature Layer', geometryType: 'esriGeometryPoint', maxRecordCount: 2000, fields: [
        { name: 'OBJECTID', type: 'esriFieldTypeOID', alias: 'OBJECTID' },
        { name: 'STOP_NAME', type: 'esriFieldTypeString', alias: 'Stop Name', fieldValueType: 'nameOrTitle', sampleValues: ['Main & 1st', 'Depot'] },
        { name: 'ROUTE', type: 'esriFieldTypeString', alias: 'Route', sampleValues: ['Red', 'Blue', 'Green'] },
        { name: 'SHELTER', type: 'esriFieldTypeString', alias: 'Shelter', sampleValues: ['Yes', 'No'] },
        { name: 'RIDERS', type: 'esriFieldTypeInteger', alias: 'Daily Riders', fieldValueType: 'countOrAmount', sampleValues: [420, 150] }
      ] })
    },
    query_data: a => {
      assert.equal(a.layerOrTableUrl, STOPS_URL + '/0')
      const rows = STOPS.filter(r => matches(a.where, r))
      if (a.statistics) {
        const groups = new Map()
        for (const r of rows) { const k = a.groupByField ? r[a.groupByField] : '_'; groups.set(k, [...(groups.get(k) || []), r]) }
        if (!a.groupByField && !groups.size) groups.set('_', [])
        let out = Array.from(groups, ([k, list]) => {
          const row = a.groupByField ? { [a.groupByField]: k } : {}
          for (const s of a.statistics) { const v = list.map(r => r[s.onField]).filter(x => x != null); row[`${s.statisticType}_${s.onField}`] = s.statisticType === 'count' ? v.length : s.statisticType === 'sum' ? v.reduce((x, y) => x + y, 0) : s.statisticType === 'avg' ? v.reduce((x, y) => x + y, 0) / (v.length || 1) : s.statisticType === 'max' ? Math.max(...v) : Math.min(...v) }
          return row
        })
        for (const o of (a.orderByFields || []).slice(0, 1)) { const [f, d] = o.split(' '); out = out.sort((x, y) => (x[f] > y[f] ? 1 : x[f] < y[f] ? -1 : 0) * (/desc/i.test(d) ? -1 : 1)) }
        return wrap({ statistics: out })
      }
      let list = rows.slice()
      for (const o of (a.orderByFields || []).slice(0, 1)) { const [f, d] = o.split(' '); list = list.sort((x, y) => (x[f] > y[f] ? 1 : x[f] < y[f] ? -1 : 0) * (/desc/i.test(d) ? -1 : 1)) }
      const page = list.slice(a.resultOffset || 0, (a.resultOffset || 0) + (a.pageSize || 100))
      return wrap({ features: page.map(attributes => ({ attributes })), totalCount: rows.length, exceededTransferLimit: rows.length > page.length })
    },
    find_address_candidates: a => { assert.equal(a.outWkid, 4326); return wrap({ spatialReference: { wkid: 4326 }, candidates: /city hall/i.test(a.singleLine) ? [{ address: '250 N 5th St', location: { x: -108.5650, y: 39.0690 }, score: 100, attributes: {} }] : /library/i.test(a.singleLine) ? [{ address: '443 N 6th St', location: { x: -108.5630, y: 39.0710 }, score: 98, attributes: {} }] : [] }) },
    reverse_geocode: a => wrap({ address: '250 N 5th St, Springfield', houseNumber: '250', city: 'Springfield', locationType: 'PointAddress', location: { x: a.x, y: a.y, spatialReference: { wkid: 4326 } } }),
    solve_route: a => {
      assert.deepEqual(Object.keys(a.start).sort(), ['name', 'x', 'y']); assert.ok(a.start.x < 0 && a.start.y > 0, 'x is longitude')
      return wrap({ geometry: { paths: [[[a.start.x, a.start.y], [-108.564, 39.0695], [a.end.x, a.end.y]]], spatialReference: { wkid: 4326 } }, directions: ['Start at ' + a.start.name, 'Go north on N 5th St', 'Turn right on Grand Ave', 'Arrive at ' + a.end.name], distance: 0.4, distanceUnits: 'esriNAUMiles', duration: a.travelMode === 'Walking Time' ? 8 : 2, durationUnits: 'esriNAUMinutes' })
    },
    get_map_image: () => wrap({ href: 'https://gis.example.org/server/rest/directories/arcgisoutput/_ags_map1.png', width: 400, height: 300, extent: {}, scale: 5000 })
  }
  const port = { label: 'ArcGIS Enterprise', fallback: true, prefs: [], tools: async () => CATALOG, call: async (name, args) => { calls.push({ name, args }); return tools[name] ? tools[name](args) : { isError: true, content: [{ type: 'text', text: 'Unknown tool' }] } } }
  return { port, calls }
}

function mindWith (port, extra = {}) {
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const drawn = []
  live.showPlaces = async (origin, spots, opts) => { drawn.push({ origin, spots, opts }); return true }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port, portalUrl: 'https://gis.example.org/portal', ...extra })
  return { mind, drawn }
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('the catalog is recognised by its tool names, also behind a prefix', () => {
  const cat = E.esriCatalog(CATALOG)
  assert.equal(cat.query.name, 'query_data'); assert.equal(cat.route.name, 'solve_route'); assert.equal(cat.geocode.name, 'find_address_candidates')
  const passed = E.esriCatalog(CATALOG.map(t => ({ ...t, name: 'enterprise_' + t.name })))
  assert.equal(passed.layer.name, 'enterprise_describe_layer')
  assert.equal(E.esriCatalog([{ name: 'geocode' }, { name: 'query_data' }]), null, 'one matching name is not a catalog')
})

test('inputs follow Esri\'s documented names and shapes', () => {
  const cat = E.esriCatalog(CATALOG)
  assert.deepEqual(E.geocodeArgs(cat.geocode, '250 N 5th St'), { singleLine: '250 N 5th St', outWkid: 4326 })
  assert.deepEqual(E.reverseArgs(cat.reverse, 39.07, -108.56), { x: -108.56, y: 39.07, wkid: 4326 })
  const r = E.routeArgs(cat.route, { label: 'City Hall', at: [39.069, -108.565] }, { label: 'Library', at: [39.071, -108.563] }, 'walking')
  assert.deepEqual(r, { start: { x: -108.565, y: 39.069, name: 'City Hall' }, end: { x: -108.563, y: 39.071, name: 'Library' }, travelMode: 'Walking Time', inWkid: 4326, outWkid: 4326 })
  assert.equal(E.routeArgs(cat.route, { label: 'A', at: [1, 2] }, { label: 'B', at: [3, 4] }).travelMode, undefined, 'driving by time is the route layer default')
  assert.deepEqual(E.layerRef('https://x/arcgis/rest/services/A/FeatureServer/3?f=json'), { serviceUrl: 'https://x/arcgis/rest/services/A/FeatureServer', layerId: 3 })
  assert.deepEqual(E.describeLayerArgs(cat.layer, 'https://x/rest/services/A/MapServer'), { serviceUrl: 'https://x/rest/services/A/MapServer', layerId: 0 })
  const q = E.queryArgs(cat.query, 'https://x/FeatureServer/0', { where: "ROUTE = 'Red'", statistics: [{ type: 'avg', field: 'RIDERS', as: 'v' }], groupBy: 'ROUTE', orderBy: ['avg_RIDERS DESC'] })
  assert.deepEqual(q, { layerOrTableUrl: 'https://x/FeatureServer/0', where: "ROUTE = 'Red'", statistics: [{ statisticType: 'avg', onField: 'RIDERS' }], groupByField: 'ROUTE', orderByFields: ['avg_RIDERS DESC'], returnGeometry: false })
  // A schema that wants sort entries as objects gets objects.
  const objTool = { name: 'query_data', inputSchema: obj({ layerOrTableUrl: { type: 'string' }, orderByFields: { type: 'array', items: obj({ fieldName: { type: 'string' }, sortOrder: { type: 'string', enum: ['ascending', 'descending'] } }) }, pageSize: { type: 'integer' } }) }
  assert.deepEqual(E.queryArgs(objTool, 'u', { orderBy: ['RIDERS DESC'], pageSize: 5000 }), { layerOrTableUrl: 'u', orderByFields: [{ fieldName: 'RIDERS', sortOrder: 'descending' }], pageSize: 1000 })
})

test('answers are read whatever shape they take', () => {
  assert.equal(E.toolData({ content: [{ type: 'text', text: '{"a":1}' }] }).a, 1)
  assert.equal(E.toolData({ isError: true, structuredContent: { a: 1 } }), null)
  assert.deepEqual(E.readCandidates({ candidates: [{ address: 'B', location: { x: -100, y: 40 }, score: 80 }, { address: 'A', location: { x: -101, y: 41 }, score: 99 }, { address: 'far', location: { x: 700000, y: 4300000 } }] }).map(c => c.address), ['A', 'B'])
  assert.equal(E.readReverse({ address: { Match_addr: '1 Main St' } }), '1 Main St')
  const web = E.readRoute({ routes: { features: [{ geometry: { paths: [[[-12085000, 4730000], [-12084000, 4731000]]], spatialReference: { wkid: 102100 } }, attributes: { Total_Miles: 12.34, Total_TravelTime: 95 } }] }, directions: [{ text: 'Go' }] })
  assert.equal(web.distance, '12 mi'); assert.equal(web.time, '1 hr 35 min'); assert.ok(Math.abs(web.path[0][0] - 39.05) < 0.2 && Math.abs(web.path[0][1] + 108.56) < 0.2, JSON.stringify(web.path[0])); assert.deepEqual(web.steps, ['Go'])
  assert.equal(E.readRoute({ nothing: true }), null)
  assert.equal(E.readItems({ results: [{ id: 'x' }, { item: { id: 'e'.repeat(32), title: 'T', url: 'https://h/FeatureServer/' } }] })[0].url, 'https://h/FeatureServer')
  const got = E.readQuery({ features: [{ attributes: { A: 1 } }, { A: 2 }], totalCount: 9 })
  assert.deepEqual(got.rows, [{ A: 1 }, { A: 2 }]); assert.equal(got.total, 9); assert.equal(got.more, true)
  assert.equal(E.statValue({ AVG_riders: 3 }, 'avg', 'RIDERS'), 3)
  assert.equal(E.readMapImage({ href: 'http://plain/x.png' }), null, 'https only')
  assert.equal(E.readJob({ jobId: 'j1', jobStatus: 'esriJobSucceeded' }).state, 'done')
})

test('what is asked: routes, portal searches, things', () => {
  assert.deepEqual(E.parseRoute('route from City Hall to the library'), { from: 'City Hall', to: 'the library', mode: 'driving', shortest: false })
  assert.deepEqual(E.parseRoute('how do I walk to 250 Oak St?'), { from: '', to: '250 Oak St', mode: 'walking', shortest: false })
  assert.equal(E.parseRoute('zoom to the library'), null)
  assert.deepEqual(E.parseContentSearch('find maps about zoning'), { q: 'zoning', type: 'Web Map' })
  assert.deepEqual(E.parseContentSearch('search the portal for flood data'), { q: 'flood data' })
  assert.deepEqual(E.parseContentSearch('what dashboards do we have'), { q: '', type: 'Dashboard' })
  for (const mine of ['list layers', 'show me the layers', 'find parcels on Main St', 'find 250 Oak St', 'show me the legend', 'what layers are on']) assert.equal(E.parseContentSearch(mine), null, mine)
  assert.equal(E.askedThing('how many bus stops have a shelter?'), 'bus stops')
  assert.equal(E.askedThing('list the bus stops on the red route'), 'bus stops')
  assert.equal(E.askedThing('zoom in'), null)
})

test('the endpoint is worked out from the hosting server', () => {
  assert.equal(E.enterpriseMcpUrl('https://gis.example.org/server'), 'https://gis.example.org/server/mcp/default')
  assert.equal(E.enterpriseMcpUrl('https://gis.example.org/server/rest/services/'), 'https://gis.example.org/server/mcp/default')
  assert.equal(E.enterpriseMcpUrl('https://gis.example.org/server/mcp/' + 'f'.repeat(32)), 'https://gis.example.org/server/mcp/' + 'f'.repeat(32), 'a custom catalog is kept')
  assert.equal(E.enterpriseMcpUrl('http://gis.example.org/server'), '', 'https only')
  assert.equal(E.hostingServerUrl({ servers: [{ url: 'https://a/gp', serverRole: 'FEDERATED_SERVER' }, { url: 'https://a/server/', serverRole: 'HOSTING_SERVER' }] }), 'https://a/server')
  assert.equal(E.hostingServerUrl({ error: { code: 403 } }), '')
  assert.ok(E.isEnterpriseMcpUrl('https://a/server/mcp/default')); assert.ok(!E.isEnterpriseMcpUrl('https://a/gis-mcp/mcp'))
})

for (const shape of ['structured', 'text']) {
  test(`a data question no map layer answers is asked of the portal layer (${shape} answers)`, async () => {
    const { port, calls } = enterprise(shape)
    const { mind } = mindWith(port)
    let r = await mind.respond('how many bus stops are there?')
    assert.match(r.text, /There are \*\*6\*\* bus stops/, r.text)
    assert.deepEqual(calls.map(c => c.name), ['search_portal_content', 'describe_layer', 'query_data'], 'describe_layer always comes before query_data')
    assert.deepEqual(calls[0].args, { q: 'bus stops', type: 'Feature Service', num: 5 })
    assert.deepEqual(calls[1].args, { serviceUrl: STOPS_URL, layerId: 0 })
    assert.match(r.sources[0].title, /Bus Stops \(portal layer, not on this map\)/)
    assert.equal(r.actions[0].url, 'https://gis.example.org/portal/home/item.html?id=' + 'a'.repeat(32))
    // The same reader that works on map layers: a filter from the layer's example values, a count with a share.
    r = await mind.respond('how many of them are on the red route')
    assert.match(r.text, /\*\*2\*\* bus stops match \(Route Red\)\. That is 33% of the 6/, r.text)
    assert.equal(calls.filter(c => c.name === 'describe_layer').length, 1, 'the layer is described once')
    assert.match(calls[calls.length - 1].args.where, /ROUTE = 'Red'/)
    r = await mind.respond('what about blue')
    assert.match(r.text, /\*\*3\*\* bus stops match \(Route Blue\)/, r.text)
    r = await mind.respond('list them')
    assert.match(r.text, /Oak & 2nd/); assert.match(r.text, /Depot/)
    assert.equal(r.results, undefined, 'nothing to click onto this map')
  })
}

test('portal layers answer rankings, averages and groups through query_data statistics', async () => {
  const { port, calls } = enterprise()
  const { mind } = mindWith(port)
  await mind.respond('how many bus stops are there')
  let r = await mind.respond('which of those has the most daily riders')
  assert.match(r.text, /Depot/, r.text); assert.match(r.text, /980/)
  assert.deepEqual(calls[calls.length - 1].args.orderByFields.slice(0, 1), ['RIDERS DESC'])
  r = await mind.respond('average daily riders of bus stops by route')
  assert.match(r.text, /Blue/, r.text); assert.match(r.text, /560/)
  const stat = calls.filter(c => c.name === 'query_data' && c.args.statistics && c.args.groupByField).pop()
  assert.equal(stat.args.groupByField, 'ROUTE'); assert.ok(stat.args.statistics.some(s => s.statisticType === 'avg' && s.onField === 'RIDERS'))
  r = await mind.respond('what fields does it have')
  assert.deepEqual(r.table.rows.find(x => x[0] === 'Daily Riders'), ['Daily Riders', 'Integer'])
})

test('several portal layers fit: he asks which, then answers the first question', async () => {
  const { port, calls } = enterprise()
  const { mind } = mindWith(port)
  let r = await mind.respond('how many zoning areas are there')
  assert.match(r.text, /the portal has 2 that could fit/, r.text)
  assert.equal(calls.filter(c => c.name === 'query_data').length, 0, 'nothing is queried before a choice')
  assert.equal(r.list[0].action.q, '__portal:0')
  r = await mind.respond('__portal:0')
  assert.deepEqual(calls.map(c => c.name).slice(1, 3), ['describe_item', 'describe_layer'], 'layers are looked up when the search did not list them')
})

test('portal content search lists items; layers can be asked, others open', async () => {
  const { port } = enterprise()
  const { mind } = mindWith(port)
  const r = await mind.respond('find maps about zoning')
  assert.match(r.text, /I found 1 web map about “zoning” in the portal/, r.text)
  assert.equal(r.list[0].action.url, 'https://gis.example.org/portal/home/item.html?id=' + 'b'.repeat(32))
  const all = await mind.respond('search the portal for zoning')
  assert.equal(all.list.length, 3); assert.equal(all.list[1].action.q, '__portal:1')
  const none = await mind.respond('search the portal for unicorns')
  assert.match(none.text, /Only items tagged \*\*mcp\*\* can be found/)
})

test('a route is planned on the organization\'s roads and drawn on the map', async () => {
  const { port, calls } = enterprise()
  const { mind, drawn } = mindWith(port)
  const r = await mind.respond('directions from City Hall to the library')
  assert.match(r.text, /Driving from 250 N 5th St to \*\*443 N 6th St\*\*: \*\*0\.4 mi, about 2\.0 min\*\*/, r.text)
  assert.match(r.text, /1\. Start at 250 N 5th St\n2\. Go north on N 5th St/)
  assert.equal(drawn[drawn.length - 1].opts.path.length, 3, 'the road the route follows, not a straight line')
  assert.deepEqual(calls.map(c => c.name), ['find_address_candidates', 'find_address_candidates', 'solve_route'])
  const walk = await mind.respond('walking directions to the library from City Hall')
  assert.match(walk.text, /Walking from/); assert.equal(calls[calls.length - 1].args.travelMode, 'Walking Time')
})

test('get_map_image shows the picture from its temporary address', async () => {
  const { port } = enterprise()
  const { mind } = mindWith(port)
  const r = await mind.respond('use the server get map image')
  const shown = r.image || (await mind.respond((r.actions || []).find(a => /^__mcp/.test(a.q || ''))?.q || 'yes')).image
  assert.equal(shown.src, 'https://gis.example.org/server/rest/directories/arcgisoutput/_ags_map1.png')  // From a host outside the organization's site it is a link to open, not a picture loaded into the chat.
  const away = mindWith(enterprise().port, { portalUrl: 'https://portal.elsewhere.net/portal' }).mind
  let far = await away.respond('use the server get map image')
  const go = (far.actions || []).find(a => /^__mcp/.test(a.q || '')); if (go) far = await away.respond(go.q)
  assert.equal(far.image, undefined); assert.equal(far.actions[0].url, 'https://gis.example.org/server/rest/directories/arcgisoutput/_ags_map1.png')
})

test('a geoprocessing web tool that runs as a job is waited for', async () => {
  const { port, calls } = enterprise()
  const list = await port.tools()
  port.tools = async () => [...list, { name: 'FloodDepth', description: 'Estimate flood depth for an area.', inputSchema: obj({ area: { type: 'string' } }, ['area']), annotations: ro }]
  let polls = 0
  const base = port.call
  port.call = async (name, args) => {
    if (name === 'FloodDepth') { calls.push({ name, args }); return { content: [{ type: 'text', text: JSON.stringify({ jobId: 'j123', jobStatus: 'esriJobSubmitted' }) }] } }
    if (name === 'get_gp_task_job_status') { calls.push({ name, args }); polls++; return { content: [{ type: 'text', text: JSON.stringify(polls < 2 ? { jobId: 'j123', jobStatus: 'esriJobExecuting' } : { jobId: 'j123', jobStatus: 'esriJobSucceeded', results: { depth_ft: 2.5 } }) }] } }
    return base(name, args)
  }
  const { mind } = mindWith(port, { jobPollMs: 5 })
  let r = await mind.respond('use the server flood depth area=downtown')
  const go = (r.actions || []).find(a => /^__mcp/.test(a.q || ''))
  if (go) r = await mind.respond(go.q)
  assert.equal(polls, 2, r.text)
  assert.deepEqual(calls.filter(c => c.name === 'get_gp_task_job_status')[0].args, { jobId: 'j123' })
  assert.doesNotMatch(r.text, /still running|did not finish/)
})

test('the client sends the ArcGIS sign-in the way the server takes it', async () => {
  const seen = []
  const make = accept => async (url, init) => {
    seen.push({ url, auth: init.headers.authorization, esri: init.headers['x-esri-authorization'] })
    const msg = JSON.parse(init.body)
    const ok = accept({ url, h: init.headers })
    const res = (status, body) => ({ status, ok: status < 300, headers: { get: k => k === 'content-type' ? 'application/json' : k === 'mcp-session-id' ? 'S1' : null }, text: async () => body })
    if (!ok) return res(401, '')
    if (msg.method === 'notifications/initialized') return res(202, '')
    return res(200, JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: msg.method === 'initialize' ? { protocolVersion: '2025-06-18', serverInfo: { name: 'arcgis' }, capabilities: {} } : { tools: [] } }))
  }
  const url = 'https://gis.example.org/server/mcp/default'
  // A bearer header first.
  await new McpClient({ url, auth: 'arcgis' }, () => 'TOKEN', make(x => x.h.authorization === 'Bearer TOKEN')).listTools()
  assert.ok(seen.every(s => s.url === url && s.auth === 'Bearer TOKEN'))
  // Refused: the ArcGIS header is tried, and remembered.
  seen.length = 0
  const c2 = new McpClient({ url, auth: 'arcgis' }, () => 'TOKEN', make(x => x.h['x-esri-authorization'] === 'Bearer TOKEN'))
  await c2.listTools()
  assert.equal(seen[0].auth, 'Bearer TOKEN'); assert.equal(seen[seen.length - 1].esri, 'Bearer TOKEN'); assert.equal(seen[seen.length - 1].auth, undefined)
  // The token never goes in the address unless the builder allowed that.
  seen.length = 0
  await assert.rejects(new McpClient({ url, auth: 'arcgis' }, () => 'TOKEN', make(x => /[?&]token=TOKEN/.test(x.url))).listTools(), /needs a sign-in/)
  assert.ok(seen.every(s => !/token=/.test(s.url)))
  seen.length = 0
  await new McpClient({ url, auth: 'arcgis', tokenInAddress: true }, () => 'TOKEN', make(x => /[?&]token=TOKEN/.test(x.url))).listTools()
  assert.match(seen[seen.length - 1].url, /^https:\/\/gis\.example\.org\/server\/mcp\/default\?token=TOKEN$/)
})

;(async () => {
  let pass = 0
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('PASS', name) } catch (e) { console.log('FAIL', name, '\n   ', (e && e.stack || String(e)).split('\n').slice(0, 6).join('\n    ')) }
  }
  console.log(`${pass}/${tests.length} ArcGIS Enterprise MCP tests passed`)
  if (pass !== tests.length) process.exit(1)
})()
