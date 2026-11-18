// Accessibility check of the playground in a real browser: automated WCAG 2.1 and 2.2 AA rules
// (axe-core) in light, dark and high-contrast colors, then the things rules cannot see: keyboard,
// focus, small targets, narrow screens and reduced motion.
// Needs Playwright with Chromium and axe-core (npm i --no-save playwright axe-core).
//   node build.mjs && node a11y.mjs
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const url = 'file://' + resolve(dirname(fileURLToPath(import.meta.url)), 'dist/index.html')
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const browser = await chromium.launch()
let checks = 0
const ok = (what) => { checks++; console.log('ok ', what) }
const open = async (opts) => { const p = await browser.newPage({ viewport: { width: 1100, height: 800 }, ...opts }); await p.goto(url); await p.waitForFunction(() => window.mappyDemo); return p }
const ask = async (p, q) => {
  const before = await p.evaluate(() => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length)
  await p.fill('.mappy-bubble input', q); await p.press('.mappy-bubble input', 'Enter')
  await p.waitForFunction(n => document.querySelectorAll('.mappy-msg:not(.mappy-user)').length > n && !document.querySelector('.mappy-typing'), before, { timeout: 15000 })
  await p.waitForTimeout(700)
}
// Answers of every kind on screen: a count, a chart, a table, a list, a card, an address, a miss.
const TALK = ['how many parcels are zoned R-4', 'count parcels by zoning', 'top 5 parcels by assessed value', 'list layers', 'find 250 Oak St', 'my stamps', 'asdf qwer zxcv', 'what did you miss']

for (const colors of [{ colorScheme: 'light' }, { colorScheme: 'dark' }, { forcedColors: 'active' }]) {
  const p = await open(colors)
  await p.click('#mappy-demo'); await p.waitForSelector('.mappy-bubble input')
  for (const q of TALK) await ask(p, q)
  await p.addScriptTag({ content: axe })
  const found = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations.map(v => ({ id: v.id, help: v.help, nodes: v.nodes.map(n => n.target.join(' ')) })))
  // The character's costume can carry drawn letters (a "GIS" badge on GIS Day). They are decoration inside a hidden picture; his name is the button's label.
  const real = found.filter(v => !(v.id === 'label-content-name-mismatch' && v.nodes.every(n => n === '#mappy-demo')))
  assert.deepEqual(real, [], 'automated rules, ' + JSON.stringify(colors))
  ok('automated WCAG rules pass with ' + JSON.stringify(colors))
  await p.close()
}

{ // Keyboard only.
  const p = await open({})
  const focused = () => p.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}#${e.id}.${e.className}` : '' })
  await p.focus('#mappy-demo'); await p.keyboard.press('Enter'); await p.waitForSelector('.mappy-bubble input'); await p.waitForTimeout(600)
  assert.match(await focused(), /^INPUT/, 'opening with the keyboard puts the cursor in the question box')
  ok('opening with the keyboard lands in the question box')
  for (const q of ['count parcels by zoning', 'what did you miss', 'how many parcels are zoned R-4']) await ask(p, q)
  const small = await p.evaluate(() => Array.from(document.querySelectorAll('.mappy-bubble button, .mappy-bubble a, .mappy-bubble input, .mappy-bubble summary')).filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } }).filter(x => x.w < 24 || x.h < 24))
  assert.deepEqual(small, [], 'every control is at least 24 by 24 px')
  ok('every control is at least 24 by 24 px')
  await p.focus('.mappy-bubble input')
  let reached = 0
  for (let i = 0; i < 80; i++) {
    await p.keyboard.press('Shift+Tab')
    const at = await p.evaluate(() => { const e = document.activeElement; if (!e || !e.closest('.mappy-bubble')) return null; const cs = getComputedStyle(e); return { name: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none' } })
    if (!at) break
    reached++
    assert.ok(at.ring, 'a focus ring on ' + at.name)
  }
  assert.ok(reached >= 10, 'the keyboard reaches the controls in the chat: ' + reached)
  ok(`the keyboard reaches ${reached} controls, each with a focus ring`)
  assert.ok(await p.evaluate(() => !!document.querySelector('.mappy-bubble[role="dialog"][aria-labelledby], .mappy-bubble[role="dialog"][aria-label]')), 'the chat is a named dialog')
  assert.ok(await p.evaluate(() => !!document.querySelector('[role="status"][aria-live="polite"]')), 'answers are announced politely')
  ok('the chat is a named dialog and answers are announced')
  await p.focus('.mappy-bubble input'); await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  assert.equal(await p.evaluate(() => !!document.querySelector('.mappy-bubble')), false, 'Esc closes the chat')
  assert.match(await focused(), /#mappy-demo/, 'and focus goes back to Mappy')
  ok('Esc closes the chat and returns focus to Mappy')
  await p.close()
}

{ // A phone-width screen (also what 400% zoom on a desktop gives): no sideways scrolling, nothing cut off.
  const p = await open({ viewport: { width: 320, height: 640 } })
  await p.click('#mappy-demo'); await p.waitForSelector('.mappy-bubble input')
  await ask(p, 'top 5 parcels by assessed value'); await ask(p, 'count parcels by zoning')
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no sideways scrolling at 320 px')
  assert.equal(await p.evaluate(() => Array.from(document.querySelectorAll('.mappy-bubble *')).filter(e => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 2 && !e.closest('.mappy-table-wrap')).length), 0, 'nothing runs off the side')
  ok('fits a 320 px screen with no sideways scrolling')
  await p.close()
}

{ // Reduced motion: nothing keeps moving.
  const p = await open({ reducedMotion: 'reduce' })
  await p.click('#mappy-demo'); await p.waitForSelector('.mappy-bubble input'); await ask(p, 'hello'); await p.waitForTimeout(1200)
  assert.deepEqual(await p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.animationName || a.transitionProperty || '?')), [], 'no running animation with reduced motion')
  ok('nothing animates when the device asks for reduced motion')
  await p.close()
}

await browser.close()
console.log(`${checks} accessibility checks passed`)
