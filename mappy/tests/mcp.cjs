// node tests/mcp.cjs [path to the host's typescript package]
// The MCP server path: the browser client against a fake Streamable HTTP server, tool picking,
// input filling, the ask-first rule, and what Mappy shows.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require(process.argv[2] || 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const originalLoad = Module._load
Module._load = function (name, ...args) { if (name === 'jimu-core') return { loadArcGISJSAPIModules: async () => { throw new Error('Unexpected SDK call in test') } }; return originalLoad.call(this, name, ...args) }
const { McpClient, safeServerUrl } = require('../src/runtime/mcp.ts')
const { matchTool, rankTools, fillArgs, usableTools, needsConfirm, viewResult, changesData } = require('../src/brain/mcpTools.ts')
const { LiveMap } = require('../src/runtime/live.ts')
const { Mind } = require('../src/runtime/mind.ts')
const { MappyIndex } = require('../src/brain/engine.ts')

const TOOLS = [
  { name: 'geocode', description: 'Find the location of an address or place name.', inputSchema: { type: 'object', properties: { address: { type: 'string', description: 'Address or place' }, maxResults: { type: 'integer', default: 3 } }, required: ['address'] }, annotations: { readOnlyHint: true } },
  { name: 'route', description: 'Driving or walking directions between two places.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, mode: { type: 'string', enum: ['driving', 'walking'] } }, required: ['from', 'to'] }, annotations: { readOnlyHint: true } },
  { name: 'elevation', description: 'Ground elevation at a point.', inputSchema: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } }, required: ['latitude', 'longitude'] }, annotations: { readOnlyHint: true } },
  { name: 'static_map', description: 'A picture of a map around a place.', inputSchema: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] }, annotations: { readOnlyHint: true } },
  { name: 'delete_features', description: 'Delete features from a layer.', inputSchema: { type: 'object', properties: { where: { type: 'string' } }, required: ['where'] } }
]

/** A fake MCP server speaking Streamable HTTP: JSON for most answers, an event stream for tools/call. */
function fakeServer () {
  const log = []
  let sessions = 0
  const fetcher = async (url, init) => {
    const msg = JSON.parse(init.body)
    log.push({ method: msg.method, headers: init.headers, params: msg.params })
    const head = new Map([['content-type', 'application/json']])
    const reply = (status, body, extra = {}) => ({ status, ok: status < 300, headers: { get: k => (extra[k] ?? head.get(k)) || null }, text: async () => body })
    if (msg.method === 'initialize') return reply(200, JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake-arcgis' }, capabilities: { tools: {} } } }), { 'mcp-session-id': 'S' + (++sessions) })
    if (msg.method === 'notifications/initialized') return reply(202, '')
    if (init.headers['mcp-session-id'] !== 'S' + sessions) return reply(400, 'no session')
    if (msg.method === 'tools/list') return reply(200, JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }))
    if (msg.method === 'tools/call') {
      const { name, arguments: a } = msg.params
      let result
      if (name === 'geocode') result = { content: [{ type: 'text', text: JSON.stringify({ candidates: [{ address: a.address.toUpperCase(), score: 100, location: { x: -108.55, y: 39.06 } }] }) }] }
      else if (name === 'static_map') result = { content: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }] }
      else if (name === 'elevation') result = { structuredContent: { elevation: 1397, units: 'm' }, content: [{ type: 'text', text: '1397 m' }] }
      else if (name === 'delete_features') result = { content: [{ type: 'text', text: 'deleted 3' }] }
      else result = { isError: true, content: [{ type: 'text', text: 'unknown tool' }] }
      return reply(200, `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`, { 'content-type': 'text/event-stream' })
    }
    return reply(200, JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }))
  }
  return { fetcher, log }
}

function mindWith (client, prefs) {
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const port = { label: 'ArcGIS Location Services', fallback: true, prefs, tools: () => client.listTools(), call: (n, a) => client.callTool(n, a) }
  return new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
}

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('only https servers (http on localhost)', () => {
  assert.ok(safeServerUrl('https://mcp.example.com/mcp'))
  assert.ok(safeServerUrl('http://localhost:8808/mcp'))
  assert.ok(!safeServerUrl('http://mcp.example.com/mcp'))
  assert.ok(!safeServerUrl('javascript:alert(1)'))
  assert.throws(() => new McpClient({ url: 'ftp://x' }))
})
test('client: handshake, session, tools, event-stream answers, token', async () => {
  const { fetcher, log } = fakeServer()
  const c = new McpClient({ url: 'https://mcp.example.com/mcp', auth: 'arcgis' }, () => 'TOKEN', fetcher)
  const tools = await c.listTools()
  assert.equal(tools.length, 5)
  assert.equal(c.serverName, 'fake-arcgis')
  const r = await c.callTool('elevation', { latitude: 39, longitude: -108 })
  assert.equal(r.structuredContent.elevation, 1397)
  assert.deepEqual(log.map(l => l.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
  assert.equal(log[2].headers.authorization, 'Bearer TOKEN')
  assert.equal(log[2].headers['mcp-protocol-version'], '2025-06-18')
})
test('picking a tool and filling its inputs from plain words', () => {
  assert.equal(matchTool('where is 250 N 5th St', TOOLS).tool.name, 'geocode')
  assert.equal(matchTool('walking directions from city hall to the library', TOOLS).tool.name, 'route')
  assert.equal(matchTool('purple monkey dishwasher', TOOLS), null)
  assert.deepEqual(fillArgs(TOOLS[0], 'geocode 250 N 5th St, Grand Junction').args, { address: '250 N 5th St, Grand Junction', maxResults: 3 })
  assert.deepEqual(fillArgs(TOOLS[2], 'elevation at 39.06, -108.55').args, { latitude: 39.06, longitude: -108.55 })
  assert.deepEqual(fillArgs(TOOLS[1], 'route from=City Hall; to=Library walking').args, { from: 'City Hall', to: 'Library', mode: 'walking' })
  assert.deepEqual(fillArgs(TOOLS[1], 'directions to the zoo').missing, ['from', 'to'])
  assert.deepEqual(fillArgs(TOOLS[1], 'walking directions from City Hall to the library').args, { from: 'City Hall', to: 'the library', mode: 'walking' })
})
test('inputs the request leaves out come from the map ("here")', () => {
  const map = { center: [39.07, -108.56], zoom: 14.4, extent: [-108.6, 39.0, -108.5, 39.1] }
  assert.deepEqual(fillArgs(TOOLS[2], 'elevation here', map).args, { latitude: 39.07, longitude: -108.56 })
  const rev = { name: 'reverse_geocode', inputSchema: { type: 'object', properties: { location: { type: 'object' } }, required: ['location'] } }
  assert.deepEqual(fillArgs(rev, "what's the address here", map).args.location, { x: -108.56, y: 39.07, spatialReference: { wkid: 4326 } })
  const pic = { name: 'map_with_overlay', inputSchema: { type: 'object', properties: { extent: { type: 'array' }, zoom: { type: 'integer' }, style: { type: 'string', enum: ['streets', 'imagery'] } }, required: ['extent'] } }
  const filled = fillArgs(pic, 'picture of this area imagery', map).args
  assert.deepEqual(filled.extent, [-108.6, 39, -108.5, 39.1]); assert.equal(filled.style, 'imagery')
  assert.deepEqual(fillArgs(TOOLS[0], 'geocode 250 N 5th St', map).args, { address: '250 N 5th St', maxResults: 3 }, 'typed values win over the map')
})
test('change detection reads names in any style; hostile names cannot hang or crash', () => {
  for (const name of ['deleteFeatures', 'DeleteFeatures', 'deletefeatures', 'apply_edits', 'applyEdits', 'updateItem', 'add-item', 'overwrite']) assert.ok(changesData({ name }), name)
  for (const name of ['find_address_candidates', 'addressLookup', 'reverse_geocode', 'getElevation', 'query_features', 'searchContent']) assert.ok(!changesData({ name }), name)
  const evil = { name: 'x', inputSchema: { type: 'object', properties: { '(a+)+$': { type: 'number' }, '+limit': { type: 'number' }, 'mode': { type: 'string', enum: ['(a+)+$', 'x.*'] } } } }
  const t0 = Date.now(); fillArgs(evil, 'a'.repeat(40) + '! 5'); assert.ok(Date.now() - t0 < 200)
  assert.equal(viewResult({ structuredContent: { results: [{ name: 'A', x: '', y: '' }] } }, 'S').point, undefined)
})
test('a stream left open still answers, and the chosen protocol version is used', async () => {
  const enc = new TextEncoder()
  const calls = []
  const fetcher = async (url, init) => {
    const msg = JSON.parse(init.body); calls.push(init.headers['mcp-protocol-version'] || '')
    const hdr = (h) => ({ get: k => h[k] || null })
    if (msg.method === 'initialize') return { status: 200, ok: true, headers: hdr({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'old' } } }) }
    if (msg.method === 'notifications/initialized') return { status: 202, ok: true, headers: hdr({}), text: async () => '' }
    let sent = false
    const body = { getReader: () => ({ read: () => sent ? new Promise(() => {}) : (sent = true, Promise.resolve({ value: enc.encode('data: ' + JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }) + '\n\n'), done: false })), cancel: () => {} }) }
    return { status: 200, ok: true, headers: hdr({ 'content-type': 'text/event-stream' }), body, text: () => new Promise(() => {}) }
  }
  const c = new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher)
  assert.deepEqual(await c.listTools(), [])
  assert.equal(calls[calls.length - 1], '2025-03-26')
})
// The tool list of the in-house server (mcp-server/gis_mcp.py) for layers Parcels and Zoning.
const GIS = [{"name": "geocode", "title": "Find an address", "description": "Geocode: find the location of a street address, intersection or place name with the city address locator.", "inputSchema": {"type": "object", "properties": {"address": {"type": "string", "description": "Address or place, for example 250 N 5th St."}, "max_results": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}}, "required": ["address"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Find an address"}}, {"name": "reverse_geocode", "title": "Address at a point", "description": "Reverse geocode: the street address nearest a point (latitude and longitude).", "inputSchema": {"type": "object", "properties": {"latitude": {"type": "number"}, "longitude": {"type": "number"}}, "required": ["latitude", "longitude"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Address at a point"}}, {"name": "identify", "title": "What's here", "description": "Identify: what is at a point, such as the parcel, zoning district, flood zone and other layers at that spot.", "inputSchema": {"type": "object", "properties": {"latitude": {"type": "number"}, "longitude": {"type": "number"}, "layer": {"type": "string", "description": "Only this layer (optional).", "enum": ["Parcels", "Zoning"]}}, "required": ["latitude", "longitude"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "What's here"}}, {"name": "find_features", "title": "Search a layer", "description": "Find features in a layer by name, address, owner, number or id. Returns matching records with a location.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "Layer name, as list_layers shows it.", "enum": ["Parcels", "Zoning"]}, "text": {"type": "string", "description": "Words to look for."}, "max_results": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10}}, "required": ["layer", "text"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Search a layer"}}, {"name": "count_features", "title": "Count features", "description": "Count how many features a layer has, optionally only those matching some text.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "Layer name, as list_layers shows it.", "enum": ["Parcels", "Zoning"]}, "text": {"type": "string", "description": "Only count features matching these words (optional)."}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Count features"}}, {"name": "list_layers", "title": "List searchable layers", "description": "List the GIS layers these tools can search and identify.", "inputSchema": {"type": "object", "properties": {}}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "List searchable layers"}}, {"name": "search_content", "title": "Find maps and data", "description": "Search Portal for maps, apps, layers and documents by keyword.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string", "description": "Keywords, for example zoning or storm sewer."}, "max_results": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10}}, "required": ["query"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Find maps and data"}}]
test('in-house server: the right tool for each way of asking', () => {
  const { rankTools } = require('../src/brain/mcpTools.ts')
  const map = { center: [39.064, -108.5505], zoom: 15 }
  const pick = q => { const r = rankTools(q, GIS); const ready = r.find(x => x.score >= r[0].score * 0.6 && !fillArgs(x.tool, q, map).missing.length); return (ready || r[0]).tool.name }
  assert.equal(pick('where is 250 N 5th St'), 'geocode')
  assert.equal(pick("what's here"), 'identify')
  assert.equal(pick("what's the address here"), 'reverse_geocode')
  assert.equal(pick("find o'brien in parcels"), 'find_features')
  assert.equal(pick('how many parcels'), 'count_features')
  assert.equal(pick('find maps about zoning'), 'search_content')
  assert.deepEqual(fillArgs(GIS.find(t => t.name === 'find_features'), "find o'brien in parcels", map).args, { layer: 'Parcels', text: "o'brien", max_results: 10 })
  assert.deepEqual(fillArgs(GIS.find(t => t.name === 'count_features'), 'how many parcels are there', map).args, { layer: 'Parcels' })
})
test('tools that could change data are off unless the builder turns them on, and always ask first', () => {
  assert.ok(changesData(TOOLS[4]))
  assert.ok(!usableTools(TOOLS).some(t => t.name === 'delete_features'))
  const prefs = [{ name: 'geocode', enabled: true }, { name: 'delete_features', enabled: true }]
  assert.deepEqual(usableTools(TOOLS, prefs).map(t => t.name), ['geocode', 'route', 'elevation', 'static_map', 'delete_features'], 'tools the server added since are on when read-only')
  assert.deepEqual(usableTools(TOOLS, [...prefs, { name: 'route', enabled: false }]).map(t => t.name), ['geocode', 'elevation', 'static_map', 'delete_features'], 'turned off stays off')
  assert.ok(!usableTools(TOOLS, [{ name: 'geocode', enabled: true }]).some(t => t.name === 'delete_features'), 'a new tool that could change data stays off')
  assert.ok(needsConfirm(TOOLS[4], prefs))
  assert.ok(!needsConfirm(TOOLS[0], prefs))
})
test('results become words, tables, pictures and a zoom point', () => {
  const v = viewResult({ content: [{ type: 'text', text: '{"candidates":[{"address":"A","score":99,"location":{"x":-108.5,"y":39.1}}]}' }] }, 'Server')
  assert.match(v.text, /found 1 result/)
  assert.deepEqual(v.table.columns, ['Address', 'Score'], 'server keys shown readable')
  assert.deepEqual(v.point, [39.1, -108.5])
  assert.match(viewResult({ content: [{ type: 'image', mimeType: 'image/png', data: 'AAA' }] }, 'S').image.src, /^data:image\/png;base64,/)
  assert.equal(viewResult({ content: [{ type: 'image', mimeType: 'text/html', data: 'AAA' }] }, 'S').image, undefined)
  assert.ok(viewResult({ isError: true, content: [{ type: 'text', text: 'nope' }] }, 'S').error)
})
test('Mind: ask the server, act on the answer, and confirm before changes', async () => {
  const { fetcher, log } = fakeServer()
  const client = new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher)
  const mind = mindWith(client, [{ name: 'geocode', enabled: true }, { name: 'static_map', enabled: true }, { name: 'delete_features', enabled: true }])
  const list = await mind.respond('list server tools')
  assert.equal(list.list.length, 5, 'saved three plus two read-only tools not in the saved list')
  const geo = await mind.respond('ask the server where is 250 N 5th St')
  assert.match(geo.text, /found 1 result/)
  assert.ok(geo.actions.some(a => a.q === 'zoom to 39.06, -108.55'))
  const pic = await mind.respond('use static_map with place=Grand Junction')
  assert.ok(pic.image)
  const calls = log.filter(l => l.method === 'tools/call').length
  const ask = await mind.respond('use delete_features with where=1=1')
  assert.match(ask.text, /may change data/)
  assert.equal(log.filter(l => l.method === 'tools/call').length, calls, 'nothing runs before Run is pressed')
  const cancel = await mind.respond('__mcp:cancel')
  assert.match(cancel.text, /Nothing was sent/)
  assert.match((await mind.respond(ask.actions[0].q)).text, /no longer waiting/)
})
test('Mind: when stuck, offers the server as a button without sending anything', async () => {
  const { fetcher, log } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  const r = await mind.respond('geocode 250 N 5th St')
  const offer = (r.actions || []).find(a => /^__mcp:ask:/.test(a.q || ''))
  assert.ok(offer, r.text)
  assert.equal(log.filter(l => l.method === 'tools/call').length, 0)
  assert.match((await mind.respond(offer.q)).text, /found 1 result/)
})
test('Mind without a server says how to add one', async () => {
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  assert.match((await mind.respond('list server tools')).text, /No MCP server is connected/)
})

// Place tools of the in-house server (gis_mcp.py 1.1): plain questions about places.
const GIS2 = [{"name": "geocode", "title": "Find an address", "description": "Geocode: find the location of a street address, intersection or place name with the city address locator.", "inputSchema": {"type": "object", "properties": {"address": {"type": "string", "description": "Address or place, for example 250 N 5th St."}, "max_results": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5}}, "required": ["address"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Find an address"}}, {"name": "nearest_feature", "title": "Closest feature", "description": "Nearest / closest feature: the closest sewer line, water main, hydrant, park, school, bus stop or any layer to an address or point, with the distance in feet.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "address": {"type": "string", "description": "Street address or place (instead of latitude and longitude)."}, "latitude": {"type": "number"}, "longitude": {"type": "number"}, "max_results": {"type": "integer", "minimum": 1, "maximum": 10, "default": 3}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Closest feature"}}, {"name": "features_near", "title": "Features within a distance", "description": "Features within a distance (buffer) of an address or point: what hydrants are within 500 feet, how many parcels within a quarter mile.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "address": {"type": "string", "description": "Street address or place (instead of latitude and longitude)."}, "latitude": {"type": "number"}, "longitude": {"type": "number"}, "distance_feet": {"type": "number", "minimum": 1, "maximum": 26400, "default": 500}, "max_results": {"type": "integer", "minimum": 1, "maximum": 25, "default": 25}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Features within a distance"}}, {"name": "identify", "title": "What's here", "description": "Identify / property report: what is at an address or point, such as the parcel and owner, zoning district, flood zone and every other layer at that spot.", "inputSchema": {"type": "object", "properties": {"address": {"type": "string", "description": "Street address or place (instead of latitude and longitude)."}, "latitude": {"type": "number"}, "longitude": {"type": "number"}, "layer": {"type": "string", "description": "Only this layer (optional), such as zoning or flood zone."}}, "required": []}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "What's here"}}, {"name": "summarize_layer", "title": "Summarize a layer", "description": "Summary statistics: count features grouped by a field (sewer mains by material, parcels by zoning) and the total, optionally only those matching some text.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "group_by": {"type": "string", "description": "Field to group by, by name or alias (optional)."}, "text": {"type": "string", "description": "Only features matching these words (optional)."}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Summarize a layer"}}]

test('plain questions about places: what is asked, and the inputs', () => {
  const { parsePlaceQuestion, rankTools } = require('../src/brain/mcpTools.ts')
  const P = parsePlaceQuestion
  assert.deepEqual(P('what is the closest sewer lien to 250 N 5th St?'), { kind: 'nearest', thing: 'sewer lien', place: '250 N 5th St' })
  assert.deepEqual(P('which hydrant is nearest to me'), { kind: 'nearest', thing: 'hydrant', here: true })
  assert.deepEqual(P('nearest fire station'), { kind: 'nearest', thing: 'fire station' })
  assert.deepEqual(P('how many parcels are within a quarter mile of here'), { kind: 'within', thing: 'parcels', feet: 1320, here: true })
  assert.deepEqual(P('who owns 123 Main St'), { kind: 'at', thing: 'parcel', place: '123 Main St' })
  assert.deepEqual(P('what zone is 250 N 5th St in'), { kind: 'at', thing: 'zone', place: '250 N 5th St' })
  assert.deepEqual(P('count sewer mains by material'), { kind: 'summary', thing: 'sewer mains', groupBy: 'material' })
  for (const q of ['turn on parcels', 'zoom to 250 N 5th St', 'what is the parcels layer', 'where is 250 N 5th St', 'what time is it']) assert.equal(P(q), null, q)
  const map = { center: [39.0639, -108.5506] }
  const best = q => rankTools(q, GIS2)[0].tool.name
  assert.equal(best('what is the closest sewer line to 250 N 5th St'), 'nearest_feature')
  assert.equal(best('hydrants within 500 ft of 250 N 5th St'), 'features_near')
  assert.equal(best('who owns 250 N 5th St'), 'identify')
  assert.equal(best('count sewer mains by material'), 'summarize_layer')
  const T = n => GIS2.find(t => t.name === n)
  assert.deepEqual(fillArgs(T('nearest_feature'), 'closest sewer line to 250 N 5th St', map).args, { layer: 'sewer line', address: '250 N 5th St', max_results: 3 })
  assert.deepEqual(fillArgs(T('nearest_feature'), 'closest hydrant to here', map).args, { layer: 'hydrant', latitude: 39.0639, longitude: -108.5506, max_results: 3 })
  assert.deepEqual(fillArgs(T('nearest_feature'), 'nearest hydrant', map).missing, ['address'], 'asks where instead of guessing')
  assert.equal(fillArgs(T('features_near'), 'parks within 2 miles of 250 N 5th St', map).args.distance_feet, 10560)
  assert.deepEqual(fillArgs(T('summarize_layer'), 'count sewer mains by material', map).args, { layer: 'sewer mains', group_by: 'material' })
  // gis-mcp 1.6 adds describe_layer and query_layer for assistants; plain place questions still pick the same tools.
  const GIS3 = GIS2.concat([{"name": "describe_layer", "title": "Describe a layer", "description": "The schema of a layer before querying it: every field with its type (text, number, date) and allowed values, the record count, the geometry type and when the data was last edited. Use it to pick fields for query_layer.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Describe a layer"}}, {"name": "query_layer", "title": "Query a layer", "description": "Structured data question on one layer, with no SQL: filters on fields (=, !=, >, >=, <, <=, contains, starts_with, in, not_in, between, is_null, not_null, in_last_days), then either rows (fields, order_by, descending, max_results), a count (count_only), or a statistic (count, sum, avg, min, max of stat_field), optionally per group_by value. Dates are YYYY-MM-DD; in_last_days takes a number of days. Coded values can be given by label or code. Call describe_layer first to see field names and values.", "inputSchema": {"type": "object", "properties": {"layer": {"type": "string", "description": "What to look for, as a layer name or plain words such as sewer line, fire hydrant, park or zoning."}, "filters": {"type": "array", "maxItems": 5, "description": "All must match (AND).", "items": {"type": "object", "properties": {"field": {"type": "string", "description": "Field name or alias."}, "op": {"type": "string", "enum": ["=", "!=", ">", ">=", "<", "<=", "contains", "starts_with", "in", "not_in", "between", "is_null", "not_null", "in_last_days"]}, "value": {"description": "A number, text, date (YYYY-MM-DD), or for in/not_in a list. Days for in_last_days."}, "value2": {"description": "Upper bound for between."}}, "required": ["field", "op"]}}, "text": {"type": "string", "description": "Also only features matching these words (optional)."}, "count_only": {"type": "boolean", "default": false}, "statistic": {"type": "string", "enum": ["count", "sum", "avg", "min", "max"]}, "stat_field": {"type": "string", "description": "Field for sum, avg, min or max."}, "group_by": {"type": "string", "description": "Field to group the statistic by (optional)."}, "fields": {"type": "array", "items": {"type": "string"}, "maxItems": 15, "description": "Fields to return with rows (optional)."}, "order_by": {"type": "string", "description": "Field to sort rows by (optional)."}, "descending": {"type": "boolean", "default": false}, "max_results": {"type": "integer", "minimum": 1, "maximum": 25, "default": 25}}, "required": ["layer"]}, "annotations": {"readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "title": "Query a layer"}}])
  const best3 = q => rankTools(q, GIS3)[0].tool.name
  assert.equal(best3('what is the closest sewer line to 250 N 5th St'), 'nearest_feature')
  assert.equal(best3('hydrants within 500 ft of 250 N 5th St'), 'features_near')
  assert.equal(best3('who owns 250 N 5th St'), 'identify')
  assert.equal(best3('what zone is 250 N 5th St in'), 'identify')
  assert.equal(best3('count sewer mains by material'), 'summarize_layer')
})
test('Mind: plain place questions, "my address", and asking where', async () => {
  const calls = []
  const answers = {
    nearest_feature: a => ({ content: [{ type: 'text', text: `The closest sanitary sewer main to ${a.address || 'that spot'} is SM-101, about 75 ft away.` }], structuredContent: { layer: 'Sanitary Sewer Mains', features: [{ 'Facility ID': 'SM-101', distance_feet: 73, latitude: 39.0641, longitude: -108.5506 }] } }),
    identify: a => ({ content: [{ type: 'text', text: `At ${a.address}, Parcels: Owner: DOE JANE; Acres: 0.21` }], structuredContent: { results: [{ layer: 'Parcels', summary: 'Owner: DOE JANE; Acres: 0.21', count: 1 }] } })
  }
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return answers[n] ? answers[n](a) : { isError: true, content: [{ type: 'text', text: 'no' }] } } }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  const ask = await mind.respond('what is the closest sewer lien to my address')
  assert.match(ask.text, /What is your address/)
  assert.equal(calls.length, 0)
  const got = await mind.respond('250 N 5th St')
  assert.match(got.text, /closest sanitary sewer main to 250 N 5th St is SM-101/)
  assert.match(got.text, /remember 250 N 5th St/)
  assert.deepEqual(calls[0], ['nearest_feature', { layer: 'sewer lien', address: '250 N 5th St', max_results: 3 }])
  assert.ok(got.actions.some(a => a.label === 'Zoom there'))
  assert.match((await mind.respond('closest sewer line to my house')).text, /SM-101/, 'remembered')
  const where = await mind.respond('nearest manhole')
  assert.match(where.text, /Closest to where/)
  assert.deepEqual(where.actions.map(a => a.label), ['250 N 5th St', 'Middle of the map'])
  await mind.respond('here')
  assert.deepEqual(calls[calls.length - 1][1], { layer: 'manhole', latitude: 39.07, longitude: -108.56, max_results: 3 })
  const owner = await mind.respond('who owns my address')
  assert.match(owner.text, /^\*\*DOE JANE\*\* owns 250 N 5th St/)
  assert.match((await mind.respond('forget my address')).text, /no longer have an address/)
})

test('Mind: a place answer turns on its layer, and undo turns it back off', async () => {
  const hydrants = { id: 'fh', title: 'Fire Hydrants', type: 'feature', visible: false, opacity: 1, fields: [] }
  const sewer = { id: 'ss', title: 'Sewer', type: 'group', visible: false, layers: [] }
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => ({ content: [{ type: 'text', text: 'The closest fire hydrant to 250 N 5th St is FH-9, about 40 ft away.' }],
    structuredContent: { layer: 'Water - Fire Hydrants', from: { place: '250 N 5th St', latitude: 39.0639, longitude: -108.5506 }, features: [{ 'Facility ID': 'FH-9', distance_feet: 40, latitude: 39.064, longitude: -108.5506 }] } }) }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [hydrants, sewer], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  const r = await mind.respond('closest hydrant to 250 N 5th St')
  assert.match(r.text, /FH-9/)
  assert.match(r.text, /turned on \*\*Fire Hydrants\*\*/)
  assert.equal(hydrants.visible, true)
  assert.ok(r.actions.some(a => a.label === 'Undo'))
  await mind.respond('undo')
  assert.equal(hydrants.visible, false)
  assert.equal(live.matchTitle('Sanitary Sewer Mains'), null, 'a loose word match is not enough')
  assert.equal(live.matchTitle('fire hydrant').title, 'Fire Hydrants')
})

test('nested layers at any depth: the tree, same-named layers, and turning one on', () => {
  const sub = (id, title, kids) => ({ id, title, visible: false, sublayers: kids || null })
  const sanitary = sub(7, 'Manholes'); const storm = sub(5, 'Manholes')
  const valves = sub(3, 'System Valves')
  const utility = { id: 'u', title: 'Utility', type: 'map-image', url: 'https://s/arcgis/rest/services/Utility/MapServer', visible: false,
    sublayers: [sub(0, 'Water', [sub(1, 'Fire Hydrants'), sub(2, 'Valves', [valves])]), sub(4, 'Storm', [storm]), sub(6, 'Sanitary', [sanitary])],
    subtables: [{ id: 10, title: 'Hydrant Inspections' }] }
  const outer = { id: 'g1', title: 'Infrastructure', type: 'group', visible: false, layers: [{ id: 'g2', title: 'Underground', type: 'group', visible: false, layers: [utility] }] }
  const wms = { id: 'w', title: 'State WMS', type: 'wms', visible: true, sublayers: [{ id: 'a', title: 'Roads', visible: true, sublayers: [{ id: 'b', title: 'Highways', visible: true }] }] }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [outer, wms], tables: [] }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const paths = live.entries().map(e => e.path)
  for (const p of ['Infrastructure > Underground > Utility > Water > Valves > System Valves', 'Infrastructure > Underground > Utility > Storm > Manholes',
    'Infrastructure > Underground > Utility > Sanitary > Manholes', 'Infrastructure > Underground > Utility > Hydrant Inspections', 'State WMS > Roads > Highways']) assert.ok(paths.includes(p), p)
  assert.ok(live.entries().find(e => e.title === 'Hydrant Inspections').isTable)
  const e = live.matchTitle('Sanitary - Manholes', 'Utility > Sanitary > Manholes')
  assert.equal(e.path, 'Infrastructure > Underground > Utility > Sanitary > Manholes', 'the group words pick the right one')
  assert.equal(live.matchTitle('Storm - Manholes', 'Utility > Storm > Manholes').sublayer, storm)
  assert.equal(live.matchTitle('System Valves', 'Utility > Water > Valves > System Valves').sublayer, valves)
  live.setVisible(e, true)
  assert.ok(sanitary.visible && utility.visible && outer.visible && outer.layers[0].visible, 'every level above it turned on')
  assert.equal(storm.visible, false, 'the other Manholes stays off')
  assert.equal(live.isVisible(e), true)
})

test('Mind: "who owns it" means the place just shown, and outlines the parcel', async () => {
  const calls = []
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => {
    calls.push([n, a])
    if (n === 'nearest_feature') return { content: [{ type: 'text', text: 'The closest fire hydrant to 250 N 5th St is FH-9, about 40 ft away.' }], structuredContent: { layer: 'Fire Hydrants', from: { place: '250 N 5th St', latitude: 39.0639, longitude: -108.5506 }, features: [{ latitude: 39.064, longitude: -108.5506 }] } }
    return { content: [{ type: 'text', text: 'At that spot, Parcels: Owner: DOE JANE; Acres: 0.21' }], structuredContent: { results: [{ layer: 'Parcels', layer_path: 'Search > Parcels', summary: 'Joint Owner: DOE JOHN; Owner: DOE JANE; Acres: 0.21', count: 1, geometry: { rings: [[[-108.551, 39.0635], [-108.55, 39.0635], [-108.55, 39.0645], [-108.551, 39.0635]]] } }], latitude: 39.0639, longitude: -108.5506 } }
  } }
  const parcels = { id: 'p', title: 'Parcels', type: 'feature', visible: false, fields: [] }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [parcels], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  await mind.respond('closest hydrant to 250 N 5th St')
  for (const q of ['who owns it', 'who owns this property?', 'who owns']) {
    const r = await mind.respond(q)
    assert.deepEqual(calls[calls.length - 1], ['identify', { layer: 'parcel', latitude: 39.0639, longitude: -108.5506 }], q)
    assert.match(r.text, /^\*\*DOE JANE\*\* and DOE JOHN own 250 N 5th St/, q)
    assert.doesNotMatch(r.text, /Acres|Joint|that spot/, 'one answer, not the whole record')
    assert.equal(r.table, undefined)
    assert.match(r.sources[0].detail, /Joint Owner: DOE JOHN\nOwner: DOE JANE\nAcres: 0.21/, 'the record is under Details')
  }
  assert.equal(parcels.visible, true, 'the parcel layer is turned on')
  const zone = await mind.respond('what zone is this in')
  assert.deepEqual(calls[calls.length - 1][1], { layer: 'zone', latitude: 39.0639, longitude: -108.5506 })
})

test('Mind: parcels from the app\'s own map: who owns, yes or no, no server needed', async () => {
  const queries = []
  const parcel = { attributes: { OBJECTID: 7, PARCEL_NUM: '2945-144-11-002', OWNER: 'DOE JANE', JTOWNER: 'DOE JOHN', LOCATION: '1138 WHITE AVE', Acres: 0.21 }, geometry: { type: 'polygon', rings: [] } }
  const layer = (id, title, hit, extra = {}) => ({ id, title, type: 'feature', visible: false, geometryType: 'polygon', fields: Object.keys((hit || parcel).attributes).map(name => ({ name })), queryFeatures: async q => { queries.push([title, q]); return { features: hit ? [hit] : [] } }, ...extra })
  const parcels = layer('p', 'Parcels', parcel)
  // A boundary whose display field is an address (city hall), with the city name in another field.
  const limits = layer('c', 'City Limits', { attributes: { OBJECTID: 1, HALL_ADDRESS: '250 N. 5th St', MUNICIPALITY: 'Springfield', PHONE: '555-010-0100', WEBSITE: 'https://www.example.org', ZIP: '81501' }, geometry: { type: 'polygon' } }, { displayField: 'HALL_ADDRESS' })
  const zoning = layer('z', 'Zoning', { attributes: { OBJECTID: 3, ZONE_CODE: 'R4', ORDINANCE: '4410', SITUS: '1138 WHITE AVE' }, geometry: { type: 'polygon' } }, { displayField: 'SITUS', fields: [{ name: 'OBJECTID' }, { name: 'ZONE_CODE', alias: 'Zone', domain: { codedValues: [{ code: 'R4', name: 'Residential 4 du/ac' }] } }, { name: 'ORDINANCE' }, { name: 'SITUS', alias: 'Address' }] })
  const flood = layer('f', 'FEMA Flood Zones', null)
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [parcels, limits, zoning, flood], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {}, graphics: { add () {}, remove () {} } } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  const own = await mind.respond('who owns here')
  assert.match(own.text, /^\*\*DOE JANE\*\* owns the middle of the map\./, 'owner, not the joint owner')
  assert.match(own.text, /Parcel 2945-144-11-002/)
  assert.equal(parcels.visible, true, 'parcels turned on')
  assert.deepEqual(queries[0][1].geometry, { type: 'point', x: -108.56, y: 39.07, spatialReference: { wkid: 4326 } })
  assert.equal(queries[0][1].spatialRelationship, 'intersects')
  const yes = await mind.respond('is 39.07, -108.56 in city limits')
  assert.match(yes.text, /^\*\*Yes\.\*\* that spot is in City Limits \(Springfield\)\./, 'the name, not the address field')
  const city = await mind.respond('what city is 39.07, -108.56 in')
  assert.match(city.text, /is in \*\*Springfield\*\*/)
  const zone = await mind.respond('what zone is 39.07, -108.56 in')
  assert.match(zone.text, /^That spot is zoned \*\*Residential 4 du\/ac\*\*\./, 'coded value name from the zone field')
  assert.equal(yes.table, undefined, 'a yes or no, not a table')
  const no = await mind.respond('is 39.07, -108.56 in a flood zone')
  assert.match(no.text, /^\*\*No\.\*\* that spot is not in FEMA Flood Zones/)
  const it = await mind.respond('who owns it')
  assert.match(it.text, /DOE JANE/, '"it" is the spot just asked about')
})

test('field labels: the alias when it is a real label, else the name made readable', () => {
  const { fieldLabel, humanizeName } = require('../src/brain/fields.ts')
  const cases = [
    [{ name: 'PARCEL_NUM' }, 'Parcel Number'], [{ name: 'PARCEL_NUM', alias: 'Parcel Number' }, 'Parcel Number'], [{ name: 'OWNER', alias: 'OWNER' }, 'Owner'],
    [{ name: 'JTOWNER' }, 'Joint Owner'], [{ name: 'OWNERNAME' }, 'Owner Name'], [{ name: 'yearBuilt' }, 'Year Built'], [{ name: 'AYB1ST' }, 'Actual Year Built 1st'],
    [{ name: 'SUBDIVISIO' }, 'Subdivision'], [{ name: 'Shape.STArea()' }, 'Area'], [{ name: 'gjgis.DBO.Parcels.SITUS_ADDR' }, 'Situs Address'],
    [{ name: 'FACILITYID' }, 'Facility ID'], [{ name: 'FLD_ZONE' }, 'Flood Zone'], [{ name: 'FILE_NO' }, 'File Number'], [{ name: 'NO_PARKING' }, 'No Parking'],
    [{ name: 'ZONE', alias: 'ZONE CODE' }, 'Zone Code'], [{ name: 'LOC', alias: 'Location Address' }, 'Location Address'], [{ name: 'distance_feet' }, 'Distance (ft)']
  ]
  for (const [f, want] of cases) assert.equal(fieldLabel(f), want, JSON.stringify(f))
  assert.equal(humanizeName('MATERIAL'), 'Material', 'a plain word stays one word')
})

test('disabled tools and replaced servers invalidate cached tools and confirmations', async () => {
  const { fetcher, log } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher), [{ name: 'delete_features', enabled: true }])
  const pending = await mind.respond('use delete_features with where=1=1')
  mind.ctx.mcp.prefs[0].enabled = false
  await mind.respond(pending.actions[0].q)
  const disabled = await mind.respond('use delete_features with where=1=1')
  assert.ok(!disabled.actions?.some(a => /^__mcp:run:/.test(a.q)))
  assert.equal(log.filter(l => l.method === 'tools/call').length, 0)
  mind.ctx.mcp.prefs[0].enabled = true
  const next = await mind.respond('use delete_features with where=1=1')
  mind.ctx.mcp = { ...mind.ctx.mcp }
  assert.match((await mind.respond(next.actions[0].q)).text, /no longer waiting/)
})

test('current confirmation executes once; map changes invalidate it', async () => {
  const { fetcher, log } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher), [{ name: 'delete_features', enabled: true }])
  const pending = await mind.respond('use delete_features with where=1=1')
  assert.match((await mind.respond(pending.actions[0].q)).text, /deleted 3/)
  assert.match((await mind.respond(pending.actions[0].q)).text, /no longer waiting/)
  const next = await mind.respond('use delete_features with where=1=1')
  mind.ctx.live.jmv = { view: { ...mind.ctx.live.view } }
  assert.match((await mind.respond(next.actions[0].q)).text, /no longer waiting/)
  assert.equal(log.filter(l => l.method === 'tools/call').length, 1)
})

test('reset and cancellation invalidate pending server actions' , async () => {
  const { fetcher, log } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher), [{ name: 'delete_features', enabled: true }])
  for (const command of ['forget context', 'start over', 'cancel', 'never mind']) {
    const pending = await mind.respond('use delete_features with where=1=1')
    await mind.respond(command)
    assert.match((await mind.respond(pending.actions[0].q)).text, /no longer waiting/)
  }
  assert.equal(log.filter(l => l.method === 'tools/call').length, 0)
})

test('CRLF streams resolve without waiting for connection close, across chunk boundaries', async () => {
  for (const ending of ['\n\n', '\r\n\r\n']) {
    const client = new McpClient({ url: 'https://mcp.example.com/mcp' })
    const chunks = Array.from('data: {"id":7,"result":{"ok":true}}' + ending)
    let cancelled = false
    const response = { body: { getReader: () => ({
      read: () => chunks.length ? Promise.resolve({ value: new TextEncoder().encode(chunks.shift()), done: false }) : new Promise(() => {}),
      cancel: () => { cancelled = true }
    }) } }
    let timer
    try {
      const answer = await Promise.race([client.readStream(response, 7), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('complete stream did not resolve')), 500) })])
      assert.equal(answer.result.ok, true)
      assert.equal(cancelled, true)
    } finally { clearTimeout(timer) }
  }
})

test('missing tool inputs are collected conversationally without rewriting values', async () => {
  const calls = []
  const tool = { name: 'trip', inputSchema: { properties: { origin: { type: 'string' }, destination: { type: 'string' }, count: { type: 'integer' } }, required: ['origin', 'destination', 'count'] }, annotations: { readOnlyHint: true } }
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  mind.ctx.mcp = { label: 'Test', fallback: false, tools: async () => [tool], call: async (n, a) => { calls.push(a); return { content: [{ type: 'text', text: 'Trip ready' }] } } }
  assert.match((await mind.respond('use trip')).text, /origin/)
  assert.match((await mind.respond('123 Parcles St')).text, /destination/)
  assert.match((await mind.respond('Fifty Percent Cafe')).text, /count/)
  assert.match((await mind.respond('1.5')).text, /valid integer/)
  assert.equal(calls.length, 0)
  assert.match((await mind.respond('2')).text, /Trip ready/)
  assert.deepEqual(calls, [{ origin: '123 Parcles St', destination: 'Fifty Percent Cafe', count: 2 }])
  await mind.respond('use trip')
  assert.match((await mind.respond('cancel')).text, /Cancelled/)
  await mind.respond('123 Main St')
  assert.equal(calls.length, 1)
  await mind.respond('use trip')
  await mind.respond('list layers')
  assert.equal(mind.mcpDraft, null)
  for (const change of [
    () => { mind.ctx.mcp = { ...mind.ctx.mcp } },
    () => { mind.ctx.live.jmv = { view: { ...mind.ctx.live.view } } },
    () => { mind.ctx.mcp.prefs = [{ name: 'trip', enabled: false }] }
  ]) {
    await mind.respond('use trip')
    change()
    await mind.respond('123 Main St')
    assert.equal(mind.mcpDraft, null)
    assert.equal(calls.length, 1)
  }
})

test('collected inputs still require confirmation for changes', async () => {
  const { fetcher, log } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher), [{ name: 'delete_features', enabled: true }])
  assert.match((await mind.respond('use delete_features')).text, /where/)
  const ready = await mind.respond('OBJECTID = 7')
  assert.match(ready.text, /may change data/)
  assert.equal(log.filter(l => l.method === 'tools/call').length, 0)
  await mind.respond(ready.actions[0].q)
  assert.equal(log.filter(l => l.method === 'tools/call').length, 1)
})


test('place conversations keep the origin while changing layers, radius, and address', async () => {
  const calls = []
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  mind.ctx.live.jmv.view.center = { latitude: 39.07, longitude: -108.56 }
  mind.ctx.mcp = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'Found matching features.' }], structuredContent: { features: [] } } } }
  await mind.respond('nearest sewer line to here')
  mind.ctx.live.jmv.view.center = { latitude: 40, longitude: -109 }
  await mind.respond('what about hydrants?')
  assert.deepEqual(calls.at(-1), ['nearest_feature', { layer: 'hydrants', latitude: 39.07, longitude: -108.56, max_results: 3 }])
  await mind.respond('within 1,000 feet?')
  assert.equal(calls.at(-1)[0], 'features_near')
  assert.equal(calls.at(-1)[1].distance_feet, 1000)
  assert.equal(calls.at(-1)[1].latitude, 39.07)
  await mind.respond('actually at 123 Parcles St')
  assert.equal(calls.at(-1)[1].address, '123 Parcles St')
  assert.equal(calls.at(-1)[1].distance_feet, 1000)
  await mind.respond('and parks')
  assert.equal(calls.at(-1)[1].layer, 'parks')
  assert.equal(calls.at(-1)[1].address, '123 Parcles St')
  const n = calls.length
  await mind.respond('forget context')
  await mind.respond('within 2,000 feet')
  assert.equal(calls.length, n)
})

test('a failed local boundary lookup never becomes a negative answer', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  mind.ctx.mcp = null; mind.ctx.featureSearch = true
  mind.ctx.live.jmv.view.center = { latitude: 39.07, longitude: -108.56 }
  mind.ctx.live.jmv.view.map.layers = [{ id: 'city', title: 'City Limits', type: 'feature', visible: true, geometryType: 'polygon', fields: [], queryFeatures: async () => { throw new Error('Service offline') } }]
  const reply = await mind.respond('is here in city limits')
  assert.match(reply.text, /could not verify/)
  assert.doesNotMatch(reply.text, /\*\*No/)
})

test('in-flight MCP answers are discarded after map or server changes', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  let finish, started
  const ready = new Promise(resolve => { started = resolve })
  mind.ctx.mcp = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async () => { started(); return new Promise(resolve => { finish = resolve }) } }
  const response = mind.respond('nearest hydrant to 123 Main St')
  await ready
  mind.ctx.live.jmv = { view: { ...mind.ctx.live.view } }
  finish({ content: [{ type: 'text', text: 'Old map answer' }] })
  assert.match((await response).text, /changed while I was working/)
  assert.equal(mind.placeConversation, null)
})

test('explicit GIS tools ask for both the layer and their optional address-or-point input', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  const calls = []
  mind.ctx.mcp = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'Done' }] } } }
  assert.match((await mind.respond('use nearest_feature')).text, /layer/)
  assert.match((await mind.respond('hydrants')).text, /address/)
  assert.equal(calls.length, 0)
  await mind.respond('123 Parcles St')
  assert.deepEqual(calls[0], ['nearest_feature', { layer: 'hydrants', address: '123 Parcles St', max_results: 3 }])
})

test('a place pronoun without context asks where instead of using the map center', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  const calls = []
  mind.ctx.live.jmv.view.center = { latitude: 39.07, longitude: -108.56 }
  mind.ctx.mcp = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'Done' }] } } }
  assert.match((await mind.respond('who owns it')).text, /Which place/)
  assert.equal(calls.length, 0)
  await mind.respond('250 N 5th St')
  assert.equal(calls[0][0], 'identify')
  assert.equal(calls[0][1].address, '250 N 5th St')
})

test('result limits are natural follow-ups and preserve layer, origin and radius', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  const calls = []
  mind.ctx.mcp = { label: 'GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'Found records' }] } } }
  await mind.respond('nearest hydrant to 250 N 5th St')
  await mind.respond('show 5 results')
  assert.equal(calls.at(-1)[1].max_results, 5)
  assert.equal(calls.at(-1)[1].address, '250 N 5th St')
  await mind.respond('within half a mile')
  assert.equal(calls.at(-1)[1].distance_feet, 2640)
  assert.equal(calls.at(-1)[1].max_results, 5)
  await mind.respond('and parks')
  assert.equal(calls.at(-1)[1].layer, 'parks')
  assert.equal(calls.at(-1)[1].max_results, 5)
})

test('out-of-range values ask for repair without querying or discarding other inputs', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  const calls = []
  mind.ctx.mcp = { label: 'GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'Found records' }] } } }
  assert.match((await mind.respond('hydrants within 0 feet of 250 N 5th St')).text, /at least 1/)
  assert.equal(calls.length, 0)
  await mind.respond('500')
  assert.equal(calls.at(-1)[1].distance_feet, 500)
  await mind.respond('and parks')
  assert.equal(calls.at(-1)[1].layer, 'parks')
  assert.equal(calls.at(-1)[1].distance_feet, 500)
  assert.equal(calls.at(-1)[1].address, '250 N 5th St')
  assert.match((await mind.respond('show 99 closest hydrants to 250 N 5th St')).text, /no greater than 10/)
  const n = calls.length
  assert.match((await mind.respond('3.5')).text, /valid integer/)
  assert.equal(calls.length, n)
  await mind.respond('3')
  assert.equal(calls.at(-1)[1].max_results, 3)
})

test('MCP result rows and ordinals select a feature for the next place question', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  const calls = [], shown = []
  mind.ctx.live.showPlaces = async (origin, points) => { shown.push(points); return true }
  mind.ctx.mcp = { label: 'GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => {
    calls.push([n, a])
    return n === 'identify' ? { content: [{ type: 'text', text: 'Selected parcel' }] } : { content: [{ type: 'text', text: 'Two hydrants' }], structuredContent: { features: [{ name: 'FH-1', latitude: 39.1, longitude: -108.5 }, { name: 'FH-2', latitude: 39.2, longitude: -108.6 }] } }
  } }
  const reply = await mind.respond('closest hydrants to 250 N 5th St')
  assert.equal(reply.table.rowActions.length, 2)
  assert.match((await mind.respond('the second one')).text, /FH-2/)
  assert.deepEqual(shown.at(-1), [[39.2, -108.6]])
  await mind.respond('who owns it')
  assert.deepEqual(calls.at(-1), ['identify', { layer: 'parcel', latitude: 39.2, longitude: -108.6 }])
  assert.match((await mind.respond(reply.table.rowActions[0].q)).text, /no longer available/)
})

test('server result choices expire on map switch and cannot zoom rows without coordinates', async () => {
  const { fetcher } = fakeServer()
  const mind = mindWith(new McpClient({ url: 'https://mcp.example.com/mcp' }, null, fetcher))
  let moves = 0
  mind.ctx.live.showPlaces = async () => { moves++; return true }
  mind.ctx.mcp = { label: 'GIS', fallback: true, tools: async () => GIS2, call: async () => ({ content: [{ type: 'text', text: 'Results' }], structuredContent: { features: [{ name: 'Unknown' }, { name: 'Located', latitude: 39.2, longitude: -108.6 }] } }) }
  const reply = await mind.respond('use nearest_feature with layer=hydrants, address=250 N 5th St')
  assert.equal(reply.table.rowActions[0], undefined)
  assert.match((await mind.respond('the first one')).text, /no usable map location/)
  assert.equal(moves, 0)
  mind.ctx.live.jmv = { view: { ...mind.ctx.live.view } }
  await mind.respond(reply.table.rowActions[1].q)
  assert.equal(moves, 0)
})

test('Mind: "who owns it" after the Search widget uses its result marker', async () => {
  const calls = []
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'At that spot, Parcel: Owner: ROE RICK' }], structuredContent: { results: [{ layer: 'Parcel', layer_path: 'Property Information > Parcel', summary: 'Parcel Number: 2945-1; Owner: ROE RICK', count: 1 }], latitude: a.latitude, longitude: a.longitude } } } }
  const live = new LiveMap()
  // The Search widget's result graphic, in Web Mercator, with the locator's label.
  const x = -108.5446 * 6378137 * Math.PI / 180
  const y = Math.log(Math.tan(Math.PI / 4 + 39.0695 * Math.PI / 360)) * 6378137
  const searchPin = { geometry: { type: 'point', x, y, spatialReference: { wkid: 102100 } }, attributes: { Match_addr: '1718 WHITE AVE, GRAND JUNCTION, CO' }, visible: true }
  live.jmv = { view: { map: { layers: [], tables: [], allLayers: [] }, center: { latitude: 39.08, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 102100 }, graphics: [searchPin], goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  const r = await mind.respond('who owns it')
  const args = calls[calls.length - 1][1]
  assert.ok(Math.abs(args.latitude - 39.0695) < 1e-4 && Math.abs(args.longitude + 108.5446) < 1e-4, JSON.stringify(args))
  assert.match(r.text, /^\*\*ROE RICK\*\* owns 1718 White Ave\./)
})

test('Mind: everyday property questions get one focused answer each', async () => {
  const calls = []
  const record = {
    parcel: { layer: 'Parcel', layer_path: 'Property Information > Parcel', summary: 'Parcel Number: 2945-123-45-001; Acres: 0.1837; Owner: ROE RICK; Mailing Address: PO BOX 1; Year Built: 1954; Legal Description: LOT 4 BLK 2 ELMWOOD' },
    zone: { layer: 'Zoning', layer_path: 'Property Information > Zoning > Zoning', summary: 'Zone: R-8; Ordinance: 4410' },
    trash: { layer: 'Trash Pickup Day', layer_path: 'Property Information > Trash and Recycling > Trash Pickup Day', summary: 'Pickup Day: Tuesday' },
    council: { layer: 'City Council Districts', layer_path: 'Property Information > Districts > City Council Districts', summary: 'District: C; Rep Name: Pat Doe; Phone: 970-555-0100' },
    school: [{ layer: 'Elementary School Attendance Areas', summary: 'Name: Nisley Elementary; URL: https://x' }, { layer: 'Middle School Attendance Areas', summary: 'Name: Orchard Avenue Middle' }, { layer: 'High School Attendance Areas', summary: 'Name: Grand Junction High' }]
  }
  const pick = layer => /parcel/.test(layer) ? [record.parcel] : /zon/.test(layer) ? [record.zone] : /trash/.test(layer) ? [record.trash] : /council/.test(layer) ? [record.council] : /school/.test(layer) ? record.school : []
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push([n, a]); const results = a.layer ? pick(a.layer) : [record.parcel, record.zone, record.trash]; return { content: [{ type: 'text', text: 'x' }], structuredContent: { results, place: '1718 White Ave', latitude: 39.0695, longitude: -108.5446 } } } }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  const ask = async q => (await mind.respond(q)).text
  assert.match(await ask('how many acres is 1718 White Ave'), /^1718 White Ave is \*\*0\.18 acres\*\* \(about 8,002 sq ft\)\./)
  assert.match(await ask('when was 1718 White Ave built'), /^1718 White Ave was built in \*\*1954\*\* \(about \d+ years old\)\./)
  assert.match(await ask('what is the parcel number for 1718 White Ave'), /parcel number for 1718 White Ave is \*\*2945-123-45-001\*\*/)
  assert.match(await ask('when is trash pickup at 1718 White Ave'), /^Trash pickup at 1718 White Ave is on \*\*Tuesday\*\*\./)
  assert.match(await ask('who is the council rep for 1718 White Ave'), /\*\*Pat Doe\*\*/)
  const school = await ask('which school does 1718 White Ave go to')
  assert.match(school, /Elementary School:\*\* Nisley Elementary/)
  assert.match(school, /High School:\*\* Grand Junction High/)
  const both = await ask('who owns 1718 White Ave and what zone is it')
  assert.match(both, /^\*\*ROE RICK\*\* owns 1718 White Ave\. \(Parcel 2945-123-45-001\)\n\n1718 White Ave is zoned \*\*R-8\*\*/)
  const report = await ask('tell me about 1718 White Ave')
  assert.match(report, /^\*\*1718 White Ave\*\*\n- \*\*Owner:\*\* ROE RICK \(Parcel 2945-123-45-001\)\n- \*\*Zoning:\*\* R-8\n- \*\*Trash Pickup Day:\*\* Tuesday/)
  await ask('my address is 1718 White Ave')
  assert.match(await ask('when is my trash day'), /Tuesday/)
  assert.equal(calls[calls.length - 1][1].address, '1718 White Ave')
})

test('Mind: "show table" opens the app\'s Table widget; "in chat" keeps rows in the conversation', async () => {
  const hydrants = { id: 'h', title: 'Hydrants', type: 'feature', visible: true, fields: [{ name: 'OBJECTID', type: 'oid' }, { name: 'STATUS', type: 'string' }], objectIdField: 'OBJECTID', displayField: 'STATUS', loaded: true,
    createQuery: () => ({ where: '1=1' }), queryFeatures: async () => ({ features: [{ attributes: { OBJECTID: 1, STATUS: 'Active' } }] }), queryFeatureCount: async () => 1 }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [hydrants], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {}, scale: 1000 } }
  const sent = []
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '',
    openInTable: async (entry, req) => { sent.push([entry.title, req.condition, !!req.inView]); return { ok: true, count: 42, capped: false } } })
  const r = await mind.respond('show table hydrants')
  assert.deepEqual(sent[0], ['Hydrants', undefined, false])
  assert.match(r.text, /^Opened \*\*Hydrants\*\* in the Table: 42 records\./)
  assert.match(r.actions[0].q, /in chat$/)
  const near = await mind.respond('show hydrants where status is active')
  const btn = (near.actions || []).find(a => a.label === 'Open in Table')
  assert.ok(btn, 'filter answers offer the Table')
  const opened = await mind.respond(btn.q)
  assert.match(opened.text, /^Opened \*\*Hydrants\*\* in the Table: 42 records where status is active\./)
  const here = await mind.respond(r.actions[0].q)
  assert.equal(sent.length, 2, 'in chat does not open the Table')
  assert.doesNotMatch(here.text, /Opened/)
  await mind.respond('open hydrants in the table')
  assert.equal(sent.length, 3, 'everyday wording opens the Table too')
})

test('Mind: easter eggs are fun and never swallow real questions', async () => {
  const mind = new Mind({ live: new LiveMap(), index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  const seen = new Set()
  for (let i = 0; i < 5; i++) seen.add((await mind.respond('tell me a joke')).text)
  assert.equal(seen.size, 5, 'no repeated jokes in a row')
  assert.equal((await mind.respond('do a dance')).mood, 'dance')
  assert.equal((await mind.respond('do a barrel roll')).mood, 'roll')
  assert.equal((await mind.respond('party mode')).mood, 'party')
  assert.equal((await mind.respond('knock knock')).text, "Who's there?")
  assert.equal((await mind.respond('Atlas')).text, 'Atlas who?')
  assert.equal((await mind.respond('Atlas-t you found me')).mood, 'celebrate')
  assert.match((await mind.respond('tell me a knock knock joke')).text, /^Knock knock/)
  const who = await mind.respond("who's there?")
  assert.ok(who.text.length > 1)
  assert.equal((await mind.respond(who.text.replace(/\.$/, '') + ' who?')).mood, 'celebrate')
  assert.match((await mind.respond('rock')).text, /^You: rock\. Me: (rock|paper|scissors)\./)
  assert.match((await mind.respond('roll a d20')).text, /rolled a \*\*\d+\*\* \(d20\)/)
  await mind.respond('tell me a riddle')
  assert.doesNotMatch((await mind.respond('turn on parcels')).text, /answer/i, 'a command is not a riddle guess')
  for (const q of ['who is your agency contact', 'did you know the parcel number for 1718 white ave', 'roll diesel tank layer on']) assert.ok(!/^🗺️|rolled a|Old enough/.test((await mind.respond(q)).text), q)
  for (const q of ['should i turn on parcels', 'show table parcels', 'who owns 250 n 5th st', 'what zone is 1718 white ave in']) {
    assert.ok(!['dance', 'roll', 'party'].includes((await mind.respond(q)).mood), q)
  }
})

test('ready for Esri MCP answers: Web Mercator points, links, prefixed tool names, camelCase address inputs', () => {
  const { placeKeys } = require('../src/brain/mcpTools.ts')
  const v = viewResult({ content: [{ type: 'text', text: 'Found it.' }, { type: 'resource_link', uri: 'https://example.com/map.png', name: 'Static map' }], structuredContent: { candidates: [{ address: '250 N 5th St', location: { x: -12083587.6, y: 4733563.4, spatialReference: { wkid: 102100 } }, score: 100 }] } }, 'Esri')
  assert.ok(v.point && Math.abs(v.point[0] - 39.06) < 0.05 && Math.abs(v.point[1] + 108.55) < 0.05, JSON.stringify(v.point))
  assert.match(v.text, /Static map: https:\/\/example.com\/map.png/)
  assert.equal(placeKeys({ name: 'esri_geocode', inputSchema: { type: 'object', properties: { singleLineAddress: { type: 'string' } } } }).address, 'singleLineAddress')
})

test('the time of year: friendly for everyone, nothing religious or political', () => {
  const { season } = require('../src/brain/fun.ts')
  const on = (y, m, d) => season(new Date(y, m - 1, d))
  assert.equal(on(2026, 10, 28).hat, 'pumpkin')
  assert.equal(on(2026, 11, 18).hat, 'gisday', 'third Wednesday of November')
  assert.match(on(2026, 11, 18).greeting, /Happy GIS Day/)
  assert.equal(on(2026, 11, 26).hat, 'autumn', 'fourth Thursday of November')
  assert.equal(on(2026, 4, 1).hat, 'party', 'April Fools')
  assert.equal(on(2026, 4, 5).hat, 'umbrella', 'spring showers, not tied to any religious date')
  assert.equal(on(2026, 4, 15).hat, 'flower', 'spring')
  assert.equal(on(2026, 12, 20).hat, 'snowflake')
  assert.equal(on(2026, 7, 4).hat, 'fireworks', 'no flag worn as a costume')
  assert.equal(on(2026, 5, 20).hat, 'bee', 'World Bee Day')
  assert.equal(on(2026, 10, 4).hat, 'taco', 'Taco Day beats World Animal Day')
  assert.equal(on(2026, 4, 24).hat, 'sapling', 'Arbor Day, last Friday of April')
  assert.equal(on(2026, 6, 5).hat, 'donut', 'Donut Day, first Friday of June')
  assert.equal(on(2028, 2, 29).hat, 'frog', 'Leap Day')
  const { allHats, dayFeel } = require('../src/brain/fun.ts')
  assert.ok(allHats().length >= 60, `${allHats().length} outfits`)
  // Every outfit in the calendar is drawn, over more than just his head.
  const art = fs.readFileSync(__dirname + '/../src/runtime/components/Costumes.tsx', 'utf8')
  for (const h of allHats()) {
    const body = art.slice(art.indexOf(`case '${h}':`), art.indexOf('\n    case ', art.indexOf(`case '${h}':`) + 1))
    assert.ok(body.length > 50, `${h} is drawn`)
    assert.ok((body.match(/\b(held|wear|buddy|drift)\(/g) || []).length >= 1, `${h} has more than a hat`)
  }
  assert.match(dayFeel(new Date(2026, 9, 26, 8)).line, /Monday/)
  assert.match(dayFeel(new Date(2026, 9, 30, 16)).line, /Friday/)
  assert.equal(dayFeel(new Date(2026, 9, 28, 10)).line, '')
  // Nothing in him is tied to one town: no Grand Junction or Colorado in the built-in lines, facts or art.
  const { Fun, outfitAsk } = require('../src/brain/fun.ts')
  const src = ['fun.ts', 'glossary.ts'].map(f => fs.readFileSync(__dirname + '/../src/brain/' + f, 'utf8')).join('\n') + art
  assert.doesNotMatch(src, /grand junction|gunnison|mesa county|gjcity|\bGJ\b/i)
  // The organization's name flows into the asides; local facts flow into "fun fact".
  const { outOfScope } = require('../src/brain/glossary.ts')
  assert.match(outOfScope('what are the office hours').text, /The City's website/)
  assert.match(outOfScope('what are the office hours', 'Mesa County').text, /Mesa County's website/)
  assert.match(outOfScope('where do i pay my bill', 'the Water District').text, /the Water District's website/)
  const fun = new Fun()
  fun.setPlace({ org: 'Mesa County', name: 'Grand Junction', facts: ['Local fact one.'] })
  const facts = new Set(); for (let i = 0; i < 40; i++) facts.add(fun.reply('fun fact').text)
  assert.ok(Array.from(facts).some(f => /Local fact one/.test(f)), 'local facts come up')
  // Asking about his outfit, by name or by its pieces, gets the reason he is dressed that way.
  assert.ok(outfitAsk('why the pi symbol', new Date(2026, 2, 14)))
  assert.ok(outfitAsk('what is that on your head', new Date(2026, 2, 14)))
  assert.ok(!outfitAsk('what is pi', new Date(2026, 2, 14)), 'a definition is not an outfit question')
  assert.ok(outfitAsk('why the pumpkin', new Date(2026, 9, 28)))
  assert.ok(!outfitAsk('where is the pumpkin layer', new Date(2026, 9, 28)))
  // Local facts from open sources: sentence picking is careful.
  const { pickFacts, tidy, factLine } = require('../src/setting/localFacts.ts')
  const picked = pickFacts('Example City is a home rule municipality in Example County. It sits at 4,583 feet along the Example River, which joins the North Fork there. As of 2020, the population was 65,560. The downtown grid is rotated to follow the river. [citation needed] it has a park.')
  assert.deepEqual(picked, ['Example City is a home rule municipality in Example County.', 'It sits at 4,583 feet along the Example River, which joins the North Fork there.', 'The downtown grid is rotated to follow the river.'])
  assert.equal(tidy([{ text: 'A b c d e f g h one.', source: 'X', url: '' }, { text: 'A b c d e f g h two.', source: 'Y', url: '' }]).length, 1)
  assert.equal(factLine({ text: 'Fact.', source: 'Example City', url: '' }), 'Fact. (Example City, Wikipedia)')
  // The Clippy pack: every act has motion, the chat can ask for the fun ones, and work gets the right act.
  const { ACT_MOODS, IDLE_ACTS, ACT_ASKS } = require('../src/brain/acts.ts')
  const actsSrc = fs.readFileSync(__dirname + '/../src/runtime/components/Acts.tsx', 'utf8')
  for (const a of [...ACT_MOODS, ...IDLE_ACTS]) assert.ok(actsSrc.includes(`.mappy-act-${a} `) || actsSrc.includes(`.mappy-act-${a}{`) || actsSrc.includes(`case '${a}':`), `${a} has an act`)
  assert.ok(ACT_MOODS.length + IDLE_ACTS.length >= 25)
  const fun2 = new Fun()
  assert.equal(fun2.reply('get wizardy').mood, 'wizardy')
  assert.equal(fun2.reply('paper airplane').mood, 'airplane')
  assert.equal(fun2.reply('do a trick').mood, 'airplane')
  assert.equal(fun2.reply('ride your bike').mood, 'bike')
  assert.equal(fun2.reply('get techy').mood, 'techy')
  assert.equal(fun2.reply('print the parcels layer'), null, 'a real request is not an act')
  assert.ok(ACT_ASKS.length >= 6)
  const worn = new Set()
  const said = []
  for (let day = new Date(2026, 0, 1); day.getFullYear() === 2026; day = new Date(day.getTime() + 86400000)) { const s = season(day); said.push(s.greeting, ...s.jokes); worn.add(s.hat) }
  assert.ok(worn.size >= 60, `${worn.size} different outfits over a year`)
  assert.doesNotMatch(said.join(' '), /\b(christ\w*|easter|santa|church|god|pray\w*|bless\w*|saint|st\. patrick|hanukkah|diwali|ramadan|eid|pilgrim\w*|witch\w*|devil|hell|politic\w*|democrat\w*|republican\w*|election\w*|flag)\b/i)
})

test('Mind: meanings, code lists, asides, scale, back and basemaps', async () => {
  const zoning = { id: 'z', title: 'Zoning', type: 'feature', visible: true, geometryType: 'polygon', fields: [{ name: 'OBJECTID' }, { name: 'ZONE_CODE', alias: 'Zone', domain: { type: 'coded-value', codedValues: [{ code: 'R4', name: 'Residential 4 du/ac' }, { code: 'C1', name: 'Light Commercial' }] } }], queryFeatures: async () => ({ features: [] }) }
  const parcels = { id: 'p', title: 'Parcels', type: 'feature', visible: false, geometryType: 'polygon', fields: [{ name: 'OBJECTID' }, { name: 'OWNER' }], queryFeatures: async () => ({ features: [] }) }
  const live = new LiveMap()
  const gone = []
  let vp = { scale: 5000, targetGeometry: { x: 1, y: 1 }, clone () { return { ...this } } }
  live.jmv = { view: { map: { layers: [zoning, parcels], tables: [], basemap: { title: 'Streets' } }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, scale: 5000, zoom: 15, spatialReference: { wkid: 4326 }, goTo: async (t) => { gone.push(t) }, get viewpoint () { return vp } } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  const parcel = await mind.respond('what is a parcel')
  assert.match(parcel.text, /^\*\*Parcel\*\*: A piece of land/)
  assert.match(parcel.text, /This map has a \*\*Parcels\*\* layer/)
  assert.equal(parcel.actions[0].type, 'layerOn')
  assert.match((await mind.respond('what does R4 mean')).text, /^\*\*R4\*\* is \*\*Residential 4 du\/ac\*\* \(Zone in Zoning\)/)
  assert.match((await mind.respond('what is RM-8')).text, /residential, medium density/)
  assert.match((await mind.respond('what does zone AE mean')).text, /1%-chance floodplain/)
  const types = await mind.respond('what zoning types are there')
  assert.match(types.text, /\*\*Zone\*\* in \*\*Zoning\*\* can be 2 things:\n- Residential 4 du\/ac \(R4\)/)
  assert.match((await mind.respond('what is the weather')).text, /flood zone/)
  assert.match((await mind.respond('what time does city hall close')).text, /website/)
  assert.match((await mind.respond('what is the scale')).text, /\*\*1:5,000\*\*.*417 feet/)
  assert.match((await mind.respond('go back')).text, /nowhere to go back/)
  live.extents.push(vp); vp = { scale: 2000, targetGeometry: { x: 2, y: 2 }, clone () { return { ...this } } }; live.extents.push(vp)
  assert.match((await mind.respond('go back')).text, /^Back to where the map was/)
  assert.equal(gone[gone.length - 1].scale, 5000)
  assert.match((await mind.respond('what is here')).text, /./)
})

test('Mind: where are the parks, list the parks, labels, map blank, data info, cancel and ack', async () => {
  const parks = { id: 'k', title: 'Parks', type: 'feature', visible: false, geometryType: 'polygon', displayField: 'NAME', labelingInfo: [{}], labelsVisible: false, loaded: true, objectIdField: 'OBJECTID', minScale: 0, maxScale: 0, editingInfo: { lastEditDate: new Date(2026, 9, 1, 12).getTime() }, copyright: 'City of Grand Junction Parks and Recreation',
    fields: [{ name: 'OBJECTID', type: 'oid' }, { name: 'NAME', alias: 'Park Name', type: 'string' }, { name: 'ACRES', type: 'double' }], fullExtent: { xmin: -108.6, ymin: 39, xmax: -108.5, ymax: 39.1 },
    createQuery: () => ({ where: '1=1' }), queryFeatures: async () => ({ features: [{ attributes: { OBJECTID: 1, NAME: 'Lincoln Park', ACRES: 30 } }, { attributes: { OBJECTID: 2, NAME: 'Canyon View Park', ACRES: 110 } }] }), queryFeatureCount: async () => 2, queryExtent: async () => ({ extent: { xmin: -108.6, ymin: 39, xmax: -108.5, ymax: 39.1 } }) }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [parks], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, scale: 5000, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  const blank = await mind.respond('nothing is on the map')
  assert.match(blank.text, /^No layers are on right now \(1 available\)/)
  const where = await mind.respond('where are the parks')
  assert.match(where.text, /^Here are \*\*Parks\*\*, turned on/)
  assert.equal(parks.visible, true)
  const list = await mind.respond('what parks are there')
  assert.match(list.text, /^\*\*Parks\*\* \(first 2\):\n- Lincoln Park\n- Canyon View Park/)
  assert.match((await mind.respond('label the parks')).text, /^Labels on for \*\*Parks\*\*/)
  assert.equal(parks.labelsVisible, true)
  assert.match((await mind.respond('when was the parks data updated')).text, /\*\*Parks\*\*: last edited on \*\*October 1, 2026\*\*; source: City of Grand Junction Parks/)
  assert.match((await mind.respond('is this map accurate')).text, /general reference/)
  assert.match((await mind.respond('largest park')).text, /Parks/)
  assert.match((await mind.respond('ok')).text, /^(?:Okay!|Got it\.|👍|Right on\.|Sure thing\.)$/)
  assert.match((await mind.respond('cancel')).text, /^(?:Okay\.|No problem\.|Sure thing\.)$/)
  assert.match((await mind.respond('there is a pothole on my street')).text, /report/i)
})

test('Mind: kind words get hearts, not a lookup', async () => {
  const mind = new Mind({ live: new LiveMap(), index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  for (const q of ['i love you mappy', "you're the best", 'you are my bff', 'high five']) {
    const r = await mind.respond(q)
    assert.equal(r.mood, 'love', q + ': ' + r.text)
  }
  // "Good job" earns a trophy; "bye" is a bike ride off.
  assert.equal((await mind.respond('good job')).mood, 'congratulate')
  assert.equal((await mind.respond('bye')).mood, 'goodbye')
  assert.equal((await mind.respond('go to sleep')).mood, 'sleep')
  assert.ok(['love', 'pleased'].includes((await mind.respond('thanks')).mood))
})

test('Mind: suggestions say exactly which layer they mean, and only offer layers that exist', async () => {
  const list = { name: 'list_layers', description: 'List searchable layers.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }
  const names = ['Property Information > Parcel', 'Property Information > Zoning', 'Trash Pickup Day', 'Hazards > FEMA Flood Zones']
  const port = { label: 'City GIS', fallback: true, tools: async () => [...GIS2, list], call: async (n, a) => n === 'list_layers' ? { structuredContent: { layers: names.map(p => ({ name: p.split(' > ').pop(), path: p })) }, content: [] } : { content: [{ type: 'text', text: 'x' }], structuredContent: { results: [{ layer: 'Trash Pickup Day', summary: 'Pickup Day: Tuesday' }], place: '1718 White Ave', latitude: 39.0695, longitude: -108.5446 } } }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  await mind.respond('when is trash pickup at 1718 White Ave')
  await new Promise(r => setTimeout(r, 10))
  const r = await mind.respond('what zone is 1718 White Ave in')
  const s = r.suggest.join(' | ')
  assert.doesNotMatch(s, /What zone/, 'never the vague "zone"')
  assert.match(s, /Is 1718 White Ave in a flood zone\?/, 'the other kind of zone, spelled out')
  assert.doesNotMatch(s, /council|school/i, 'no suggestions for layers the server does not have')
})

test('Mind: "who owns this" with a parcel popup open answers from that feature', async () => {
  const calls = []
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => { calls.push(n); return { structuredContent: { results: [] }, content: [] } } }
  const parcels = { id: 'p', title: 'Tax Parcels', type: 'feature', visible: true, geometryType: 'polygon', fields: [{ name: 'OWNER_NAME' }, { name: 'PARCEL_NUM' }, { name: 'ACRES' }], queryFeatures: async () => { throw new Error('should not query') } }
  const feature = { attributes: { OWNER_NAME: 'POPUP PAT', PARCEL_NUM: '2945-9', ACRES: 1.5 }, geometry: { type: 'polygon', rings: [] }, layer: parcels }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [parcels], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {}, graphics: { add () {}, remove () {} },
    popup: { visible: true, title: 'Parcel 2945-9', location: { latitude: 39.071, longitude: -108.561 }, selectedFeature: feature } } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  const r = await mind.respond('who owns this')
  assert.match(r.text, /^\*\*POPUP PAT\*\* owns Parcel 2945-9\./)
  assert.deepEqual(calls, [], 'nothing sent to the server')
})

test('Mind: distance between two places, and what an owner owns', async () => {
  const calls = []
  const spots = { '1718 WHITE AVE': [39.0695, -108.5446], 'CITY HALL': [39.0639, -108.5506] }
  const port = { label: 'City GIS', fallback: true, tools: async () => [...GIS2, ...GIS.filter(t => t.name === 'find_features')], call: async (n, a) => {
    calls.push([n, a])
    if (n === 'geocode') { const k = Object.keys(spots).find(x => a.address.toUpperCase().includes(x)); return { structuredContent: { candidates: k ? [{ address: k + ', GRAND JUNCTION', score: 100, latitude: spots[k][0], longitude: spots[k][1] }] : [] }, content: [{ type: 'text', text: 'x' }] } }
    if (n === 'identify') { const big = Math.abs(a.latitude - 39.0695) < 1e-3; return { content: [{ type: 'text', text: 'x' }], structuredContent: { results: [{ layer: 'Parcel', summary: big ? 'Parcel Number: 1; Acres: 0.5; Owner: ROE RICK; Year Built: 1954' : 'Parcel Number: 2; Acres: 0.2; Owner: CITY; Year Built: 1990' }] } } }
    if (n === 'find_features') return { content: [{ type: 'text', text: 'Found 2 in Parcels matching "DOE JANE".' }], structuredContent: { layer: 'Parcels', features: [{ Owner: 'DOE JANE', Address: '250 N 5TH ST', latitude: 39.06, longitude: -108.55 }, { Owner: 'DOE JANE', Address: '12 MAIN ST', latitude: 39.07, longitude: -108.56 }] } }
    return { content: [], structuredContent: {} }
  } }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  const d = await mind.respond('how far is 1718 White Ave from City Hall')
  assert.match(d.text, /^1718 White Ave is \*\*0\.5 mi\*\* from City Hall in a straight line \(about 2,6\d\d ft\)/)
  const dir = await mind.respond('directions to City Hall from 1718 White Ave')
  assert.match(dir.text, /^\*\*City Hall\*\* is about \*\*0\.5 mi\*\* from 1718 White Ave/)
  assert.match(dir.actions[0].url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=39\.0695/)
  assert.match((await mind.respond('what are the coordinates of 1718 White Ave')).text, /\*\*1718 White Ave\*\* is at \*\*39\.069500, -108\.544600\*\*/)
  const cmp = await mind.respond('which is bigger, 1718 White Ave or City Hall')
  assert.match(cmp.text, /^\*\*1718 White Ave\*\* is bigger: 0\.50 acres vs 0\.20\./)
  assert.deepEqual(cmp.table.columns, ['', '1718 White Ave', 'City Hall'])
  assert.match((await mind.respond('compare 1718 White Ave and City Hall')).text, /is bigger/)
  assert.match((await mind.respond('is City Hall older than 1718 White Ave')).text, /\*\*1718 White Ave\*\* is older \(built 1954 vs 1990\)/)
  const own = await mind.respond('what properties does Jane Doe own')
  assert.deepEqual(calls[calls.length - 1], ['find_features', { layer: 'Parcels', text: 'JANE DOE', max_results: 25 }])
  assert.match(own.text, /^Parcels matching owner “Jane Doe”/)
  assert.equal(await mind.respond('how far is nowhere land from City Hall').then(r => r.mood), 'confused')
})

test('live server shape: a reverse geocoder never steals "pipe near <address>", and answering a place swaps it in', async () => {
  // The city server lists reverse_geocode ("the street address nearest a point") before nearest_feature.
  const LIVE = [GIS2[0], { name: 'reverse_geocode', title: 'Address at a point', description: 'Reverse geocode: the street address nearest a point (latitude and longitude).', inputSchema: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } }, required: ['latitude', 'longitude'] }, annotations: { readOnlyHint: true } }, ...GIS2.slice(1), { name: 'list_layers', title: 'List searchable layers', description: 'List the GIS layers these tools can search and identify.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }]
  const calls = []
  const port = { label: 'City GIS', fallback: true, tools: async () => LIVE, call: async (n, a) => { calls.push([n, a]); return n === 'list_layers' ? { content: [{ type: 'text', text: 'Sanitary Mains' }] } : { content: [{ type: 'text', text: `The closest ${a.layer} to 1138 White Ave is X, about 50 ft away.` }], structuredContent: { layer: 'Sanitary Mains', from: { place: '1138 White Ave', latitude: 39.07, longitude: -108.55 }, features: [{ Name: 'X', distance_feet: 50, latitude: 39.0701, longitude: -108.5501 }] } } } }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  assert.equal(rankTools('sanitary pipe near 1138 white ave', LIVE)[0].tool.name, 'nearest_feature')
  const r = await mind.respond('sanitary pipe near 1138 white ave')
  assert.match(r.text, /closest sanitary pipe to 1138 White Ave/)
  assert.deepEqual(calls.filter(c => c[0] === 'nearest_feature').pop()[1], { layer: 'sanitary pipe', address: '1138 white ave', max_results: 3 })
  // No place at all: ask once, then take the answer as the place (not glued onto the question).
  assert.match((await mind.respond('closest hydrant')).text, /^Closest to where\?/)
  await mind.respond('1138 white ave')
  assert.deepEqual(calls.pop()[1], { layer: 'hydrant', address: '1138 white ave', max_results: 3 })
  // "What is the address here" still goes to the reverse geocoder.
  await mind.respond('what is the address here')
  assert.equal(calls.pop()[0], 'reverse_geocode')
})

test('flood zones: A and V zones are the floodplain, X is not', async () => {
  const zone = { v: 'AE', sub: '' }
  const port = { label: 'City GIS', fallback: true, tools: async () => GIS2, call: async (n, a) => ({ content: [], structuredContent: { results: [{ layer: 'FEMA Flood Zones', summary: `Flood Zone: ${zone.v}; Zone Subtype: ${zone.sub}; SFHA: ${/^[AV]/.test(zone.v) ? 'T' : 'F'}` }] } }) }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [], tables: [] }, center: { latitude: 39.07, longitude: -108.56 }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'T', featureSearch: false, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', mcp: port })
  assert.match((await mind.respond('is 1718 White Ave in a flood zone')).text, /^\*\*Yes\.\*\* 1718 White Ave is in FEMA flood Zone AE/)
  zone.v = 'X'; zone.sub = 'AREA OF MINIMAL FLOOD HAZARD'
  assert.match((await mind.respond('is 1718 White Ave in a flood zone')).text, /^\*\*No\.\*\* 1718 White Ave is in Zone X, outside/)
  zone.v = 'X'; zone.sub = '0.2 PCT ANNUAL CHANCE FLOOD HAZARD'
  assert.match((await mind.respond('is 1718 White Ave in the floodplain')).text, /^\*\*No, but close\.\*\*/)
})

;(async () => {
  let passed = 0
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('PASS', name) } catch (e) { console.error('FAIL', name, e); process.exitCode = 1 }
  }
  console.log(`${passed}/${tests.length} MCP tests passed`)
})()
