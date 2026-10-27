// node tests/typos.cjs [path to the host's typescript package]
// Typo forgiveness and the language pack, end to end through Mappy's own reader.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require(process.argv[2] || 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const originalLoad = Module._load
Module._load = function (name, ...args) { if (name === 'jimu-core') return { loadArcGISJSAPIModules: async () => { throw new Error('Unexpected SDK call in test') } }; return originalLoad.call(this, name, ...args) }
const { lexiconFor, readRequest, applyLanguagePack, languagePack, bundledVersion, cleanPack } = require('../src/brain/language.ts')
const { typoCost } = require('../src/brain/spell.ts')
const { parseIntent } = require('../src/brain/intents.ts')
const { LiveMap } = require('../src/runtime/live.ts')
const { Mind } = require('../src/runtime/mind.ts')
const { MappyIndex } = require('../src/brain/engine.ts')

const names = ['Parcels', 'Zoning Districts', 'Fire Hydrants', 'Legend', 'Print', 'Bookmarks', 'Owner Name']
const lex = lexiconFor(names)
const read = s => readRequest(s, lex).text
const pick = i => [i.name, i.target, i.value]
const tests = []
const test = (name, fn) => tests.push([name, fn])

test('small slips cost less than random letters', () => {
  assert.ok(typoCost('parcles', 'parcels') < typoCost('parcxls', 'parcels'))
  assert.ok(typoCost('layres', 'layers') <= 0.5)
  assert.ok(typoCost('opn', 'open') < typoCost('opn', 'on'))
})
test('commands read through typos', () => {
  assert.equal(parseIntent(read('trun on parcles')).name, 'layerOn')
  assert.equal(parseIntent(read('trun on parcles')).target, 'parcels')
  assert.equal(parseIntent(read('lsit layres')).name, 'listLayers')
  assert.equal(parseIntent(read('zoomin')).name, 'zoom')
  assert.equal(read('list lay ers'), 'list layers')
  assert.equal(read('opne the legnd'), 'open the legend')
  assert.equal(parseIntent(read('tunr off fier hydrants')).target, 'fire hydrants')
})
test('shorthand and other phrasings', () => {
  assert.equal(read('pls turn on zoning districts'), 'turn on zoning districts')
  assert.equal(parseIntent(read('unhide parcels')).name, 'layerOn')
  assert.equal(parseIntent(read('turn of parcels')).name, 'layerOff')
})
test('sound-alikes, two-letter slips and real words in the wrong place', () => {
  assert.equal(read('turn on fier hidrants'), 'turn on fire hydrants')
  assert.equal(read('zoom ot'), 'zoom out')
  assert.equal(parseIntent(read('turn no zoning districts')).name, 'layerOn')
  assert.equal(parseIntent(read('lose the legend')).name, 'close')
  assert.equal(parseIntent(read('lost layers')).name, 'listLayers')
  assert.equal(parseIntent(read('urn on zoning districts')).name, 'layerOn')
  assert.equal(parseIntent(read('turn on everyting')).name, 'allOn')
  assert.equal(parseIntent(read('turn everything on')).name, 'allOn')
})
test('numbers in words and other ways to say transparency', () => {
  assert.deepEqual(pick(parseIntent(read('set parcels opacity to fifty percent'))), ['opacity', 'parcels', '50'])
  assert.deepEqual(pick(parseIntent(read('make parcels 75 percent transparent'))), ['opacity', 'parcels', '25'])
  assert.deepEqual(pick(parseIntent(read('fade the parcels'))), ['opacity', 'parcels', '50'])
})
test('values, names and conditions are never rewritten', () => {
  for (const s of ['zoom to mesa county', 'show the river', 'find elm ave', 'find ute ave', 'zoom to las colonias', 'find pitkin ave', 'zoom to cortez', 'geocode 715 rood ave', 'where is café rio', 'find Drew in parcels', 'how many parcels where owner equals Drew', 'find owner jose', 'find Smith in parcels', "find O'Brien in parcels", 'find "Teh Bakery" in parcels', 'find 123 Mian St', 'count parcels where ACRES > 5', 'how many parcels where owner equals Jonhson', 'zoom to 39.06, -108.55']) {
    assert.equal(read(s), s)
  }
})
test('a bad pack is refused and an older pack never replaces a newer one', () => {
  assert.equal(cleanPack({ format: 2 }), null)
  assert.equal(cleanPack({ format: 1, version: 'soon' }), null)
  const before = languagePack().version
  assert.equal(applyLanguagePack({ format: 1, version: '2000.01.01', synonyms: [], rewrites: [], fixes: {}, words: '' }), false)
  assert.equal(languagePack().version, before)
  assert.ok(bundledVersion() >= '2026.10.27')
  const p = cleanPack({ format: 1, version: '2099.01.01', synonyms: [['a<b>', 'c']], rewrites: [['(.*)', 'x']], fixes: { 'x y': 'z' }, words: '<script>' })
  assert.deepEqual(p.synonyms, []); assert.deepEqual(p.rewrites, []); assert.deepEqual(p.fixes, {}); assert.ok(!/</.test(p.words))
})
test('Mind fixes typos, acts, and says how he read it', async () => {
  const layer = { id: 'parcels', title: 'Parcels', type: 'feature', visible: false, opacity: 1, fields: [{ name: 'OWNER', alias: 'Owner name', type: 'string' }] }
  const live = new LiveMap()
  live.jmv = { view: { map: { layers: [layer], tables: [] }, extent: {}, spatialReference: { wkid: 4326 }, goTo: async () => {} } }
  const mind = new Mind({ live, index: new MappyIndex([]), model: {}, hints: new Map(), name: 'Mappy', appTitle: 'Test map', featureSearch: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '' })
  const reply = await mind.respond('trun on parcles')
  assert.equal(layer.visible, true)
  assert.match(reply.text, /I read that as “turn on parcels”/)
  const plain = await mind.respond('turn off parcels')
  assert.doesNotMatch(plain.text, /I read that as/)
  assert.ok(!plain.actions.some(a => a.label === 'Undo'), 'one undo button, not two')
  const stuck = await mind.respond('zmo in')
  assert.match(stuck.text, /Did you mean “zoom in”\?/)
  assert.ok(stuck.actions.some(a => a.q === 'zoom in'))
  const all = await mind.respond('turn on all teh layers')
  assert.equal(layer.visible, true)
  assert.match(all.text, /Turned on 1 layer/)
})

;(async () => {
  let passed = 0
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('PASS', name) } catch (e) { console.error('FAIL', name, e); process.exitCode = 1 }
  }
  console.log(`${passed}/${tests.length} typo tests passed`)
})()
