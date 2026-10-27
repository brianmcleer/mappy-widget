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
const { matchTool, fillArgs, usableTools, needsConfirm, viewResult, changesData } = require('../src/brain/mcpTools.ts')
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
test('tools that could change data are off unless the builder turns them on, and always ask first', () => {
  assert.ok(changesData(TOOLS[4]))
  assert.ok(!usableTools(TOOLS).some(t => t.name === 'delete_features'))
  const prefs = [{ name: 'geocode', enabled: true }, { name: 'delete_features', enabled: true }]
  assert.deepEqual(usableTools(TOOLS, prefs).map(t => t.name), ['geocode', 'delete_features'])
  assert.ok(needsConfirm(TOOLS[4], prefs))
  assert.ok(!needsConfirm(TOOLS[0], prefs))
})
test('results become words, tables, pictures and a zoom point', () => {
  const v = viewResult({ content: [{ type: 'text', text: '{"candidates":[{"address":"A","score":99,"location":{"x":-108.5,"y":39.1}}]}' }] }, 'Server')
  assert.match(v.text, /found 1 result/)
  assert.deepEqual(v.table.columns, ['address', 'score'])
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
  assert.equal(list.list.length, 3)
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

;(async () => {
  let passed = 0
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('PASS', name) } catch (e) { console.error('FAIL', name, e); process.exitCode = 1 }
  }
  console.log(`${passed}/${tests.length} MCP tests passed`)
})()
