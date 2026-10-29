/*
  Builds knowledge/feed.json, the file Mappy fetches at runtime: knowledge.json (answers, terms,
  facts, tips, edited by people) plus the current language pack. Runs in the GitHub Action
  after the language pack build, and by hand: node knowledge/build.mjs [--check] [--typescript <path to the typescript package>].

  The feed is validated with the widget's own cleanFeed() before it is written, so a feed
  that the widget would ignore never ships.
*/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const require = createRequire(import.meta.url)
const check = process.argv.includes('--check')

// Run the widget's TypeScript as-is (the tests do the same). --typescript <path> names the package when it is elsewhere.
const tsArg = process.argv.indexOf('--typescript')
const ts = require(tsArg > -1 ? path.resolve(process.argv[tsArg + 1]) : 'typescript')
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
const { cleanFeed, describeFeed } = require(path.join(root, 'mappy', 'src', 'brain', 'feed.ts'))

const knowledge = JSON.parse(fs.readFileSync(path.join(here, 'knowledge.json'), 'utf8'))
let pack = null
try { pack = JSON.parse(fs.readFileSync(path.join(root, 'language', 'language-pack.json'), 'utf8')) } catch (e) { pack = null }

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.')
const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'feed.json'), 'utf8')) } catch (e) { return null } })()
const content = { faq: knowledge.faq || [], glossary: knowledge.glossary || [], facts: knowledge.facts || [], tips: knowledge.tips || [], about: knowledge.about || '' }
const same = prev && JSON.stringify({ ...content, pack: pack?.version }) === JSON.stringify({ faq: prev.faq, glossary: prev.glossary, facts: prev.facts, tips: prev.tips, about: prev.about, pack: prev.languagePack?.version })

// The version rises whenever the content changes: today, or today.N when built again the same day.
let version = today
if (prev?.version?.startsWith(today)) { const n = Number(prev.version.split('.')[3] || 0); version = same ? prev.version : `${today}.${n + 1}` }
const feed = { format: 1, version, about: content.about, languagePack: pack || undefined, ...content }

const clean = cleanFeed(feed)
if (!clean) { console.error('[knowledge] the feed does not pass cleanFeed()'); process.exit(1) }
const dropped = ['faq', 'glossary', 'facts', 'tips'].filter(k => clean[k].length !== content[k].length)
if (dropped.length) { console.error(`[knowledge] entries would be dropped by the widget in: ${dropped.join(', ')}. Fix knowledge.json.`); process.exit(1) }
if (pack && !clean.languagePack) { console.error('[knowledge] the language pack did not survive'); process.exit(1) }

const text = JSON.stringify(feed) + '\n'
if (check) {
  const current = (() => { try { return fs.readFileSync(path.join(here, 'feed.json'), 'utf8') } catch (e) { return '' } })()
  const ok = same && current.length > 0
  console.log(`[knowledge] ${describeFeed(clean)}; ${ok ? 'feed.json is current' : 'feed.json needs a rebuild (node knowledge/build.mjs)'}`)
  process.exit(ok ? 0 : 1)
}
if (same) { console.log(`[knowledge] no change (${describeFeed(clean)})`); process.exit(0) }
fs.writeFileSync(path.join(here, 'feed.json'), text)
console.log(`[knowledge] wrote feed.json: ${describeFeed(clean)} (${(text.length / 1024).toFixed(0)} KB)`)
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=true\nversion=${version}\n`)
