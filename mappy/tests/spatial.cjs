// node tests/spatial.cjs [path to the host's typescript package]
// Questions that cross layers: how the sentence is split, and the answers on a made-up town
// (the playground's Mapleton: 36 parcels, 16 hydrants, 3 parks, 4 zoning areas, streets), whose
// layers answer real spatial queries (a shape, a distance, a relation).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(process.argv[2] || 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const S = require('../src/brain/spatial.ts')
const { authorAnswerFits } = require('../src/brain/answer.ts')

const tests = []
const test = (name, fn) => tests.push([name, fn])

test('the sentence is split into the thing, the relation, the distance and the other side', () => {
  const r = t => S.splitSpatial(t)
  assert.deepEqual(r('parcels within 300 ft of 250 N 5th St'), { target: 'parcels', anchor: '250 N 5th St', relation: 'within', feet: 300, distance: '300 ft' })
  assert.deepEqual(r('how many R-4 parcels over 5 acres are within a mile of a school?'), { target: 'how many R-4 parcels over 5 acres', anchor: 'school', relation: 'within', feet: 5280, distance: '1 mi' })
  assert.equal(r('hydrants within a quarter mile of the library').distance, 'a quarter mile')
  assert.equal(r('parcels within 2 blocks of City Hall').feet, 660)
  assert.equal(r('parcels in a 500 foot radius of 110 Maple St').feet, 500)
  assert.deepEqual(r('parcels near a park'), { target: 'parcels', anchor: 'park', relation: 'within', feet: 500, distance: '500 ft', assumed: true })
  assert.deepEqual(r('parcels that are adjacent to Compass Park'), { target: 'parcels', anchor: 'Compass Park', relation: 'touch' })
  assert.equal(r('parcels that share a lot line with 250 Oak St').relation, 'touch')
  assert.deepEqual(r('parcels not within 500 ft of a hydrant'), { target: 'parcels', anchor: 'hydrant', relation: 'outside', feet: 500, distance: '500 ft' })
  assert.equal(r('parcels over 5 acres more than 300 ft from a hydrant').target, 'parcels over 5 acres')
  assert.deepEqual(r('parcels outside the city limits'), { target: 'parcels', anchor: 'city limits', relation: 'outside' })
  assert.deepEqual(r('hydrants in the floodplain'), { target: 'hydrants', anchor: 'floodplain', relation: 'in', strong: false })
  assert.equal(r('which streets cross the C-1 zone').strong, true)
  assert.equal(r('parcels inside Ward 3').strong, true)
  assert.deepEqual(r('how many hydrants per council district'), { target: 'how many hydrants', anchor: 'council district', relation: 'in', per: true })
  assert.deepEqual(r('parks in each ward'), { target: 'how many parks', anchor: 'ward', relation: 'in', per: true })
  assert.deepEqual(r('which district has the fewest hydrants'), { target: 'how many hydrants', anchor: 'district', relation: 'in', per: true, rank: 'fewest' })
})

test('notice lists are recognised in the ways people ask for them', () => {
  const want = { target: 'list parcels', anchor: '250 Oak St', relation: 'within', feet: 300, distance: '300 ft', notify: true }
  for (const t of ['owners within 300 ft of 250 Oak St', 'who do I notify within 300 feet of 250 Oak St', 'notification list within 300 ft of 250 Oak St', 'mailing list for parcels within 300 ft of 250 Oak St', 'neighbors within 300 ft of 250 Oak St', '300 ft notice list for 250 Oak St', 'property owners within a 300 foot radius of 250 Oak St', 'who is within 300 ft of 250 Oak St']) assert.deepEqual(S.splitSpatial(t), want, t)
  assert.deepEqual(S.splitSpatial('notification list for 250 Oak St'), { target: 'list parcels', anchor: '250 Oak St', relation: 'within', notify: true })
  assert.deepEqual(S.distanceSwap('what about 500 ft'), { feet: 500, said: '500 ft' })
  assert.deepEqual(S.distanceSwap('make it a quarter mile'), { feet: 1320, said: 'a quarter mile' })
  assert.deepEqual(S.distanceSwap('300 ft'), { feet: 300, said: '300 ft' })
  assert.equal(S.distanceSwap('what about R-8'), null)
  assert.equal(S.distanceSwap('5 acres'), null)
})

test('ordinary sentences are not mistaken for place questions', () => {
  for (const t of ['sort by acres descending', 'zoom in', 'count parcels by zoning', 'hello there', 'who owns 250 Oak St', 'how far is City Hall from the library', 'closest hydrant to City Hall', 'parcels around 5 acres']) {
    const r = S.splitSpatial(t)
    assert.ok(!r || (r.relation === 'in' && !r.strong && !r.per), `${t} -> ${JSON.stringify(r)}`)
  }
  assert.equal(S.splitSpatial('hydrants out of service'), null)
  // "In" is read, but marked as not certain: the runtime only believes it when the ordinary readers come up empty.
  assert.equal(S.splitSpatial('parcels in R-4').strong, false)
})

test('small helpers: a circle to draw, a safe spreadsheet cell, an author answer that fits', () => {
  const ring = S.circleRing(39, -108, 528)
  assert.equal(ring.length, 73); assert.deepEqual(ring[0], ring[72])
  assert.ok(Math.abs((ring[18][1] - 39) * 364567.2 - 528) < 1, 'the top of the circle is 528 ft north')
  assert.equal(S.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"'); assert.equal(S.csvCell('Smith, Jo'), '"Smith, Jo"'); assert.equal(S.csvCell(null), '')
  // The distance drawn around a lot: a square pushed out by 100 ft has straight sides 100 ft out and rounded corners.
  const k = 364567.2; const kx = k * Math.cos(39 * Math.PI / 180)
  const lot = [[-108, 39], [-108 + 200 / kx, 39], [-108 + 200 / kx, 39 + 200 / k], [-108, 39 + 200 / k], [-108, 39]]
  const around = S.bufferRing(lot, 100)
  const feetOut = around.map(p => { const x = (p[0] + 108) * kx; const y = (p[1] - 39) * k; const dx = Math.max(0 - x, 0, x - 200); const dy = Math.max(0 - y, 0, y - 200); return Math.hypot(dx, dy) })
  assert.ok(feetOut.every(d => Math.abs(d - 100) < 1.5), 'every point of the line is 100 ft from the lot')
  assert.deepEqual(around[0], around[around.length - 1]); assert.deepEqual(S.bufferRing(lot, 0), [])
  const faq = { kind: 'faq', title: 'Is this a real place', keys: 'Is this a real place', text: 'No. Mapleton is made up for this demo: every street, owner and hydrant is invented.' }
  assert.equal(authorAnswerFits('hydrants in service', faq), false, 'one stray word in the answer is not a match')
  assert.equal(authorAnswerFits('is Mapleton a real town', faq), true)
  assert.equal(authorAnswerFits('are the streets and owners invented', faq), true, 'two words of the answer')
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
  const drawn = []
  const show = live.showPlaces.bind(live)
  live.showPlaces = async (origin, spots, opts) => { drawn.push({ origin, spots, opts }); return show(origin, spots, opts) }
  const mind = new Mind({ index: new MappyIndex(live.docs()), model: {}, live, hints: new Map(), name: 'Mappy', appTitle: 'the Mapleton map', featureSearch: true, notifyLists: true, maxResults: 8, showInLayerList: false, layerListIds: [], layerListLabel: '', geocoders: [{ url: 'https://demo.invalid/GeocodeServer', name: 'Mapleton addresses', singleLineFieldName: 'SingleLine' }], typoFix: true, store: { get: () => null, set: () => {} }, ...extra })
  const layer = id => t.layers.find(l => l.id === id)
  // Every query a layer is asked, so the tests can check what was sent.
  const sent = []
  for (const l of t.layers) for (const m of ['queryFeatures', 'queryFeatureCount', 'queryObjectIds']) { const real = l[m].bind(l); l[m] = async q => { sent.push({ layer: l.id, method: m, q: { ...q } }); return real(q) } }
  const say = async q => { const r = await mind.respond(q); return { ...r, text: r.text.split('\n\nNew stamp')[0].split('\n\n♥')[0].split('\n\nThat was our')[0] } }
  return { mind, live, say, layer, drawn, sent, town: t }
}
const T = (name, fn) => test(name, haveTown ? fn : async () => { console.log('    (skipped: the playground town in ../demo is not here)') })

T('within a distance of a named feature, with follow-ups that keep the place', async () => {
  const { say, layer, drawn } = town()
  let r = await say('parcels within 300 ft of Compass Park')
  assert.equal(r.text, '**8** parcels are within 300 ft of Compass Park. Here are the first 8; choose one to zoom to it.')
  assert.equal(r.results.length, 8); assert.match(r.note, /Measured from its edge/)
  assert.equal(drawn[drawn.length - 1].opts.rings.length, 1); assert.equal(drawn[drawn.length - 1].opts.around.length, 1, 'the park is outlined on the map, with the 300 ft line around it')
  r = await say('how many of those are zoned R-4')
  assert.equal(r.text, '**2** parcels match (Zoning R-4, within 300 ft of Compass Park). That is 25% of the 8 within 300 ft of Compass Park.')
  // On the map, the exact features by id (a place cannot be written as a layer filter).
  r = await say('__ask:map')
  assert.match(r.text, /now shows only the ones that match \(Zoning R-4, within 300 ft of Compass Park\): 2/)
  assert.match(layer('parcels').definitionExpression, /^OBJECTID IN \(\d+, \d+\)$/)
  await say('clear the filter')
  await say('parcels within 300 ft of Compass Park'); await say('how many of those are zoned R-4')
  r = await say('which of those is the biggest')
  assert.match(r.text, /^The biggest parcel \(Zoning R-4, within 300 ft of Compass Park\) is \*\*151 Oak St\*\*: 7\.4 acres/)
  // A swap keeps the question and the place, and changes the one thing.
  r = await say('what about R-8')
  assert.match(r.text, /^The biggest parcel \(Zoning R-8, within 300 ft of Compass Park\) is \*\*311 Oak St\*\*/)
})

T('the other side can be a whole layer, a filtered layer, a place, "it" or "here"', async () => {
  const { say, sent } = town()
  let r = await say('how many parcels are within 500 ft of a hydrant')
  assert.equal(r.text, 'There are **32** parcels within 500 ft of a fire hydrant.')
  assert.equal(sent.filter(s => s.layer === 'parcels' && s.method === 'queryObjectIds' && s.q.distance === 500 && s.q.units === 'feet').length, 16, 'one query per hydrant, done by the layer service')
  r = await say('parcels within a quarter mile of an out of service hydrant')
  assert.match(r.text, /^\*\*10\*\* parcels are within a quarter mile of fire hydrants \(Status Out of service\)/)
  r = await say('out of service hydrants within 1000 ft of a park')
  assert.equal(r.text, '**1** fire hydrant matches (Status Out of service, within 1,000 ft of a park): **H-109**.')
  r = await say('commercial parcels within 400 ft of Legend Green')
  assert.equal(r.text, '**2** parcels match (Land Use Commercial, within 400 ft of Legend Green): **350 Oak St** and **351 Birch St**.')
  r = await say('average assessed value of parcels within 500 ft of a park')
  assert.match(r.text, /^The average \*\*Assessed Value\*\* of the 22 parcels \(within 500 ft of a park\) is \*\*\$455,636\*\*/)
  r = await say('count parcels by land use within 600 ft of Compass Park')
  assert.match(r.text, /\*\*Commercial\*\* has the most parcels \(within 600 ft of Compass Park\): 5/); assert.ok(r.chart)
  r = await say('biggest parcel within 800 ft of City Hall')
  assert.match(r.text, /^The biggest parcel \(within 800 ft of City Hall\) is \*\*311 Oak St\*\*/)
  // "It" after finding a place is that place; for parcels the distance runs from its lot line, and it is not its own neighbour.
  await say('find 250 Oak St')
  r = await say('parcels within 200 ft of it')
  assert.equal(r.text, '**5** parcels are within 200 ft of 250 Oak St: **210 Oak St**, **211 Birch St**, **251 Birch St**, **311 Oak St** and **310 Oak St**.')
  r = await say('parcels next to it')
  assert.equal(r.text, '**3** parcels are next to 250 Oak St: **210 Oak St**, **211 Birch St** and **251 Birch St**.')
  assert.match(r.note, /within 3 ft, so lots across a street do not count/)
  r = await say('parcels near City Hall')
  assert.match(r.text, /^\*\*6\*\* parcels are within 500 ft of City Hall/); assert.match(r.note, /“Near” taken as 500 ft/)
})

T('inside, crossing and outside an area; sharing only an edge is not "in"', async () => {
  const { say } = town()
  let r = await say('hydrants in the R-8 zone')
  assert.equal(r.text, '**3** fire hydrants are in R-8: **H-103**, **H-104** and **H-111**.')
  r = await say('how many hydrants in MU')
  assert.equal(r.text, 'There is **1** fire hydrant in MU.')
  r = await say('parcels inside the MU zone')
  assert.equal(r.text, '**4** parcels are in MU: **310 Oak St**, **350 Oak St**, **311 Birch St** and **351 Birch St**.', 'the same four whose Zoning field says MU: neighbours that only touch the edge are left out')
  r = await say('which streets intersect the C-1 zone')
  assert.match(r.text, /^\*\*5\*\* streets are in or crossing C-1: \*\*Oak St\*\*/)
  r = await say('how many parcels are outside the MU zone')
  assert.equal(r.text, 'There are **32** parcels outside MU.')
  r = await say('parcels not within 200 ft of a hydrant')
  assert.match(r.text, /^\*\*9\*\* parcels are more than 200 ft from a fire hydrant/)
  r = await say('parcels over 5 acres more than 300 ft from a hydrant')
  assert.match(r.text, /^\*\*7\*\* parcels match \(Acres over 5, more than 300 ft from a fire hydrant\)/)
  // Words that are filters stay filters.
  r = await say('parcels in MU')
  assert.match(r.text, /^\*\*4\*\* parcels match \(Zoning MU\)/)
  r = await say('how many parcels in each zoning district')
  assert.match(r.text, /^\*\*R-8\*\* has the most parcels: 16/, 'the Zoning field answers this without a spatial count')
})

T('one answer per area, and which area has the most', async () => {
  const { say } = town()
  let r = await say('how many hydrants per zoning district')
  assert.match(r.text, /^\*\*R-4\*\* has the most fire hydrants: \*\*4\*\*\. Then R-8 \(3\) and C-1 \(2\)\. 4 areas counted\./)
  assert.deepEqual(r.table.columns, ['Zoning', 'Fire Hydrants']); assert.equal(r.table.rows.length, 4); assert.equal(r.chart.rows[0].value, 4)
  assert.match(r.note, /counted in both/)
  r = await say('which zoning district has the fewest hydrants')
  assert.match(r.text, /has the fewest fire hydrants|tie for the fewest fire hydrants/)
  r = await say('hydrants per park')
  assert.equal(r.text, 'No fire hydrants are in any of the 3 parks.')
  r = await say('which zoning district has the most parcels')
  assert.match(r.text, /^\*\*R-8\*\* has the most parcels: \*\*16\*\*/)
})

T('a notice list: owners, mailing addresses, the subject marked, a spreadsheet, and another distance', async () => {
  const { say, drawn } = town()
  let r = await say('owners within 300 ft of 250 Oak St')
  assert.equal(r.text, '**7** parcels are within 300 ft of 250 Oak St, with **6** different owners. The distance is measured from the lot line, and the subject property is in the list and marked. The 300 ft line is drawn on the map.')
  assert.deepEqual(r.table.columns, ['Owner', 'Mailing address', 'Address', 'Parcel Number', 'Note'])
  const subject = r.table.rows.find(x => x[4] === 'Subject property')
  assert.deepEqual(subject.slice(0, 4), ['Town of Mapleton', 'PO Box 110, Mapleton', '250 Oak St', 'MP-1010'])
  assert.match(r.save.name, /^notice-list-300ft-\d{4}-\d\d-\d\d\.csv$/); assert.match(r.save.label, /^Save all 7 as a spreadsheet file$/)
  const lines = r.save.text.trim().split('\r\n')
  assert.equal(lines[0], 'Owner,Mailing address,Address,Parcel Number,Note'); assert.equal(lines.length, 8)
  assert.ok(lines.includes('Town of Mapleton,"PO Box 110, Mapleton",250 Oak St,MP-1010,Subject property'))
  assert.match(r.note, /Check it against the official notice requirements/)
  assert.equal(drawn[drawn.length - 1].opts.rings.length, 1); assert.equal(drawn[drawn.length - 1].opts.around.length, 1, 'the lot, and the 300 ft line around it')
  r = await say('what about 150 ft')
  assert.match(r.text, /^\*\*6\*\* parcels are within 150 ft of 250 Oak St, with \*\*5\*\* different owners/)
  // No distance given: he asks, and the next distance is the answer.
  r = await say('notification list for 110 Maple St')
  assert.equal(r.text, 'How far out from 110 Maple St? Say a distance, like “300 ft”.')
  r = await say('500 ft')
  assert.match(r.text, /^\*\*4\*\* parcels are within 500 ft of 110 Maple St, with \*\*4\*\* different owners/)
  r = await say('owners within 300 ft of 999 Nowhere Blvd')
  assert.match(r.text, /I could not find “999 Nowhere Blvd”/)
})

T('owner lists are the builder\'s choice: off, the same question lists the parcels only', async () => {
  const { say } = town({ notifyLists: false })
  const r = await say('owners within 300 ft of 250 Oak St')
  assert.match(r.text, /^\*\*6\*\* parcels are within 300 ft of 250 Oak St/, r.text)
  assert.equal(r.save, undefined); assert.equal(r.table, undefined)
  assert.doesNotMatch(r.text, /Town of Mapleton|Rivera|owner/i)
  assert.match(r.note, /Owner lists to save are turned on by whoever built this app/)
})

T('he says so when the other side is too big, is nothing, or is not an area', async () => {
  const { say, layer, town: t } = town()
  // More than 300 things to measure from: he stops rather than flood the service.
  const hydrants = layer('hydrants')
  const first = hydrants.features[0]
  for (let i = 0; i < 320; i++) hydrants.features.push(new fake.Graphic({ attributes: { ...first.attributes, OBJECTID: 1000 + i, FACILITYID: 'X-' + i }, geometry: first.geometry, layer: hydrants }))
  let r = await say('how many parcels are within 500 ft of a hydrant')
  assert.match(r.text, /^That would compare against 336 hydrant, and I stop at 300/)
  hydrants.features.length = 16
  r = await say('parcels within 300 ft of a chip seal street')
  assert.match(r.text, /parcels? (?:is|are) within 300 ft of streets \(Surface Chip seal\)/)
  r = await say('how many hydrants per street')
  assert.match(r.text, /needs a layer of areas/)
  assert.ok(t.layers.length >= 5)
})

T('"is this address in that zone" answers about the zone that was named', async () => {
  const { say } = town()
  assert.match((await say('is 250 Oak St in the MU zone')).text, /^\*\*No\.\*\* 250 Oak St is in \*\*C-1\*\*, not MU zone \(Zoning\)\./)
  assert.match((await say('is 250 Oak St in the C-1 zone')).text, /^\*\*Yes\.\*\* 250 Oak St is in C-1 \(Zoning\)\./)
  assert.match((await say('is 310 Oak St in MU')).text, /^\*\*Yes\.\*\* 310 Oak St is in MU \(Zoning\)\./)
  assert.match((await say('is 250 Oak St in MU')).text, /^\*\*No\.\*\* 250 Oak St is in \*\*C-1\*\*, not MU \(Zoning\)\./)
})

;(async () => {
  let pass = 0
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('PASS', name) } catch (e) { console.log('FAIL', name, '\n   ', (e && e.stack || String(e)).split('\n').slice(0, 7).join('\n    ')) }
  }
  console.log(`${pass}/${tests.length} cross-layer tests passed`)
  process.exit(pass === tests.length ? 0 : 1)
})()
