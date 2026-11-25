// End-to-end check of the playground in a real browser: the widget's own brain, character and
// chat, on the made-up town. Needs Playwright with Chromium (npm i -D playwright; npx playwright install chromium).
//   node build.mjs && node e2e.mjs
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const page_ = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), 'dist/index.html')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const problems = []
page.on('pageerror', e => problems.push(e.message))
await page.goto(page_)
await page.waitForSelector('#mappy-demo')
await page.click('#mappy-demo')
await page.waitForSelector('.mappy-bubble input')

const readLast = () => page.evaluate(() => { const all = Array.from(document.querySelectorAll('.mappy-msg:not(.mappy-user)')); return all.length ? all[all.length - 1].textContent : '' })
// Answers type themselves out: wait until the words stop changing.
const lastReply = async () => {
  let prev = ''
  for (let i = 0; i < 60; i++) { const now = await readLast(); if (now && now === prev) return now; prev = now; await page.waitForTimeout(350) }
  return prev
}
const say = async (text, want, ms = 9000) => {
  const before = await page.evaluate(() => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length)
  await page.fill('.mappy-bubble input', text)
  await page.press('.mappy-bubble input', 'Enter')
  await page.waitForFunction(n => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length > n && !document.querySelector('.mappy-typing'), before, { timeout: ms })
  const got = await lastReply()
  if (want) assert.match(got, want, `"${text}" -> ${got.slice(0, 200)}`)
  return got
}
const layerOn = id => page.evaluate(id => window.mappyDemo.town.layers.find(l => l.id === id).visible, id)
const mood = () => page.evaluate(() => (document.querySelector('#mappy-demo').className.match(/mappy-mood-(\w+)/) || [])[1])
let n = 0
const step = async (name, fn) => { await fn(); n++; console.log('ok  ' + name) }

await step('greets on open', async () => assert.match(await lastReply(), /Mapleton is a made-up town/))
await step('turns a layer on, and the map follows', async () => { assert.equal(await layerOn('zoning'), false); await say('turn on zoning', /Zoning/); assert.equal(await layerOn('zoning'), true) })
await step('reads past typos', async () => { await say('trun off zonign', /Zoning/); assert.equal(await layerOn('zoning'), false) })
await step('finds an address and its owner', async () => { await say('who owns 250 Oak St', /Town of Mapleton/); assert.ok(await page.evaluate(() => window.mappyDemo.view.graphics.items.length > 0), 'something is drawn on the map') })
await step('remembers the place for a follow-up', async () => { await say('what zoning is this in', /C-1/) })
await step('counts and groups', async () => { await say('how many parcels', /36/); await say('count parcels by zoning', /has the most parcels: 16/) })
await step('filters the map and clears it', async () => {
  const all = await page.evaluate(() => window.mappyDemo.town.layers.find(l => l.id === 'parcels').drawn().length)
  await say('only show parcels over 7 acres on the map', /parcels/i)
  const some = await page.evaluate(() => window.mappyDemo.town.layers.find(l => l.id === 'parcels').drawn().length)
  assert.ok(some > 0 && some < all, `${some} of ${all} drawn`)
  await say('clear the filter')
  assert.equal(await page.evaluate(() => window.mappyDemo.town.layers.find(l => l.id === 'parcels').drawn().length), all)
})
await step('answers from a layer that is off, and offers to turn it on', async () => { await say('closest fire hydrant to City Hall', /H-\d+/); assert.ok(await page.$('.mappy-bubble button:has-text("Turn on Fire Hydrants")')) })
await step('finds the closest hydrant with no server', async () => { await say('turn on fire hydrants', /Fire Hydrants/); await say('closest fire hydrant to City Hall', /H-\d+/); await say('turn off fire hydrants') })
await step('has feelings', async () => { await say('hug', /hug|crease|corners/i); assert.equal(await mood(), 'hug') })
await step('remembers a name', async () => { await say('call me Sam', /Sam/); await say('what is my name', /You are Sam/) })
await step('does an act when asked', async () => { await say('juggle', /pins/i); assert.equal(await mood(), 'juggle') })
await step('hands a hard question to the helper, and shows it is not his own', async () => {
  const got = await say('ask Claude which zoning district has the most parcels', /has the most parcels/, 15000)
  assert.match(got, /No AI was called/)
  assert.ok(await page.$('.mappy-chart'), 'a chart is drawn')
  assert.ok(await page.$('.mappy-ratebtn'), 'thumbs are offered')
})
await step('follow-up chips go back to the helper', async () => {
  const chip = await page.$('.mappy-bubble button.mappy-chip:has-text("What does MU zoning mean?")')
  assert.ok(chip, 'a follow-up chip')
  const before = await page.evaluate(() => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length)
  await chip.click()
  await page.waitForFunction(n => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length > n && !document.querySelector('.mappy-typing'), before, { timeout: 15000 })
  assert.match(await lastReply(), /Mixed Use/)
})
await step('rates an answer', async () => {
  const before = await page.evaluate(() => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length)
  await page.click('.mappy-ratebtn[aria-label="Helpful"]')
  await page.waitForFunction(n => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length > n && !document.querySelector('.mappy-typing'), before, { timeout: 9000 })
  assert.match(await lastReply(), /Noted|passed that along/)
})
await step('a question in Spanish is answered in Spanish', async () => { const got = await say('¿cuántos parques hay en la ciudad?', /parques/, 15000); assert.doesNotMatch(got, /I read that as/) })
await step('keeps private numbers in the browser', async () => { await say('ask Claude about card 4111 1111 1111 1111', /did not send it/) })
await step('hands off to a person and is plain about privacy', async () => { await say('talk to a person', /Mapleton map desk/); await say('what do you know about me', /Kept in this browser only/) })
await step('keeps a passport and learns the usual', async () => { await say('my stamps', /Your passport has \*?\*?\d+ of 23/); await say('our story', /We met on/) })
await step('reads plain questions against the data', async () => {
  // The chat keeps its last 60 messages; start a fresh one so new answers can be counted.
  await page.click('.mappy-bubble button:has-text("New chat")'); await page.waitForTimeout(600)
  await say('how many parcels are zoned R-4', /8 parcels match \(Zoning R-4\)/)
  await say('which ones are over 5 acres', /5 parcels match \(Zoning R-4, Acres over 5\)/)
  await say('most expensive parcel', /The most expensive parcel is 110 Maple St/)
  await say('who owns it', /110 Maple St: Owner is/)
  await say('oldest hydrant', /The oldest fire hydrant is H-107/)
  await say('parcels not zoned R-4', /28 parcels match \(Zoning not R-4\)/)
})
await step('undo works', async () => { await say('turn on fire hydrants'); assert.equal(await layerOn('hydrants'), true); await say('undo'); assert.equal(await layerOn('hydrants'), false) })
await step('swaps, lengths and two-slip typos', async () => {
  await page.click('.mappy-bubble button:has-text("New chat")'); await page.waitForTimeout(600)
  await say('how many parcels are zoned R-4', /8 parcels match \(Zoning R-4\)/)
  await say('what about R-8', /16 parcels match \(Zoning R-8\)/)
  await say('how long is Maple St', /Maple St is about 0\.8 mi/)
  await say('longest street', /The longest in Streets is/)
  await say('what is the tallest building allowed', /MU: Max Height \(ft\) 65/)
  await say('cuot parcels', /There are 36 parcels/)
})
await step('questions that cross layers', async () => {
  await page.click('.mappy-bubble button:has-text("New chat")'); await page.waitForTimeout(600)
  await say('parcels within 300 ft of Compass Park', /8 parcels are within 300 ft of Compass Park/)
  await say('how many of those are zoned R-4', /2 parcels match \(Zoning R-4, within 300 ft of Compass Park\)\. That is 25% of the 8/)
  await say('how many hydrants per zoning district', /R-4 has the most fire hydrants: 4/)
  await say('parcels not within 200 ft of a hydrant', /9 parcels are more than 200 ft from a fire hydrant/)
  const got = await say('owners within 300 ft of 250 Oak St', /7 parcels are within 300 ft of 250 Oak St, with 6 different owners/)
  assert.match(got, /Mailing address/); assert.match(got, /The 300 ft line is drawn on the map/)
  assert.ok(await page.evaluate(() => window.mappyDemo.view.graphics.items.some(g => g.symbol && g.symbol.outline && g.symbol.outline.style === 'dash')), 'the distance is drawn as a dashed line')
  await say('what about 150 ft', /6 parcels are within 150 ft of 250 Oak St/)
  await say('is 250 Oak St in the MU zone', /No\. 250 Oak St is in C-1, not MU zone/)
})
await step('no errors in the page', async () => assert.deepEqual(problems, []))

await browser.close()
console.log(`${n} playground checks passed`)
