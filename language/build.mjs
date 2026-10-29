#!/usr/bin/env node
/*
  build.mjs - builds Mappy's language pack and only keeps what makes him understand more.

    node language/build.mjs [--issues issues.json] [--wordnet file.xml.gz] [--check]

  1. Reads Open English WordNet (open data, CC BY 4.0): everyday English words, so Mappy can
     tell a typo from a real word, synonyms for the map words in seed.json, and irregular forms.
  2. Reads phrases people reported Mappy missed (GitHub issues labelled "language", exported
     with `gh issue list --json`), and works out a fix for each: a misspelling, a synonym or
     another way to start a command.
  3. Runs the phrase test set (examples.json plus every reported phrase) through the widget's
     own code. Each new piece is kept only when nothing that passed before fails with it.
  4. Writes language/language-pack.json, mappy/src/brain/languagePack.ts, language/learned.json
     and language/report.md. Writes nothing when the pack did not change.

  --check only scores the current pack (used on pull requests). Needs Node 18+ and the
  typescript package (npm i --no-save typescript).
*/
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const widget = path.join(root, 'mappy')
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const CHECK = args.includes('--check')
const WORDNET_FALLBACK = 'https://github.com/globalwordnet/english-wordnet/releases/download/2025-edition/english-wordnet-2025.xml.gz'

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return d } }
const writeIfChanged = (f, text) => { let old = null; try { old = fs.readFileSync(f, 'utf8') } catch (e) { old = null }; if (old === text) return false; fs.writeFileSync(f, text); return true }
const log = (...m) => console.log('[language]', ...m)

// ---------------------------------------------------------------- the widget's own code
function loadWidget () {
  const ts = require(arg('--typescript') ? path.resolve(arg('--typescript')) : 'typescript')
  const Module = require('node:module')
  require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file)
  const load = Module._load
  Module._load = function (name, ...rest) { if (name === 'jimu-core') return {}; return load.call(this, name, ...rest) }
  const b = (f) => require(path.join(widget, 'src', 'brain', f))
  return { language: b('language.ts'), intents: b('intents.ts'), engine: b('engine.ts'), esri: b('esriDocs.ts'), spell: b('spell.ts') }
}

// ---------------------------------------------------------------- scoring
function makeScorer (w, examples) {
  const docs = Object.keys(w.esri.ESRI_DOCS).map(name => {
    const d = w.esri.ESRI_DOCS[name]
    return { id: name, kind: 'widget', title: d.title, text: [d.summary, ...(d.howTo || []), ...(d.tips || [])].join(' '), keys: name.replace(/-/g, ' ') }
  })
  return (pack) => {
    w.language.applyLanguagePack(pack, true)
    const lex = w.language.lexiconFor(examples.appNames)
    const read = (s) => w.language.readRequest(s, lex).text
    const sig = (s) => { const i = w.intents.parseIntent(s); return [i.name, (i.target || '').toLowerCase(), i.value || '', i.scope || ''].join('|') }
    const index = new w.engine.MappyIndex(docs)
    const results = []
    for (const e of examples.same) {
      const got = sig(read(e.say)); const want = sig(read(e.same))
      results.push({ id: 'same:' + e.say, ok: got === want, got: read(e.say), want: e.same })
    }
    // Clean phrases get retyped with slips: one slip per word (counted and gated), and
    // harder ones, two slips or a missing first letter (counted only, to see progress).
    const seen = new Set()
    for (const e of examples.same) {
      if (/[A-Z0-9"']/.test(e.same)) continue
      const want = sig(read(e.same))
      const hard = [...typoVariants('x' + e.same).map(v => v.slice(1)), ...typoVariants(e.same).map(v => typoVariants(v)[1] || v)]
      for (const [v, kind] of [...typoVariants(e.same).map(v => [v, 'typo']), ...hard.map(v => [v, 'hard'])]) {
        if (seen.has(v) || v === e.same) continue
        seen.add(v)
        const got = read(v)
        results.push({ id: kind + ':' + v, ok: sig(got) === want, got, want: e.same, typo: kind === 'typo', hard: kind === 'hard' })
      }
    }
    for (const k of examples.keep) {
      const got = read(k); const want = w.language.normalize(k)
      results.push({ id: 'keep:' + k, ok: got === want, got, want })
    }
    for (const a of examples.ask) {
      const top = index.search(read(a.ask), { limit: 1 })[0]
      results.push({ id: 'ask:' + a.ask, ok: !!top && top.doc.id === a.expect, got: top ? top.doc.id : '(nothing)', want: a.expect })
    }
    return { pass: new Set(results.filter(r => r.ok && !r.hard).map(r => r.id)), results: results.filter(r => !r.hard), hard: results.filter(r => r.hard) }
  }
}

// ---------------------------------------------------------------- typo stress test
// Every test phrase is retyped with the slips people make (swapped letters, a missed key, a
// neighbouring key, a doubled letter), the same way every run, so the score is comparable.
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const NEAR = {}
KEYS.forEach((row, y) => [...row].forEach((c, x) => {
  NEAR[c] = []
  KEYS.forEach((r2, y2) => [...r2].forEach((d, x2) => { if (d !== c && Math.abs(y - y2) <= 1 && Math.abs((x + y * 0.5) - (x2 + y2 * 0.5)) <= 1) NEAR[c].push(d) }))
}))
function seeded (s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000 } }
function slip (word, kind, rnd) {
  const i = 1 + Math.floor(rnd() * (word.length - 2))
  if (kind === 'swap') return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)
  if (kind === 'drop') return word.slice(0, i) + word.slice(i + 1)
  if (kind === 'double') return word.slice(0, i) + word[i] + word.slice(i)
  const n = NEAR[word[i]] || []
  return n.length ? word.slice(0, i) + n[Math.floor(rnd() * n.length)] + word.slice(i + 1) : word
}
export function typoVariants (say) {
  const rnd = seeded(say)
  const words = say.split(' ')
  const spots = words.map((w, i) => i).filter(i => /^[a-z]{4,}$/.test(words[i]))
  const out = []
  for (const kind of ['swap', 'drop', 'near', 'double']) {
    if (!spots.length) break
    const i = spots[Math.floor(rnd() * spots.length)]
    const typo = slip(words[i], kind, rnd)
    if (typo !== words[i]) out.push(words.map((w, j) => j === i ? typo : w).join(' '))
  }
  return out
}

const noWorse = (before, after) => { for (const id of before) if (!after.has(id)) return false; return true }

// ---------------------------------------------------------------- Open English WordNet
async function wordnetFile () {
  const local = arg('--wordnet')
  if (local) return local
  const cache = path.join(here, '.cache')
  fs.mkdirSync(cache, { recursive: true })
  let url = WORDNET_FALLBACK
  try {
    const r = await fetch('https://api.github.com/repos/globalwordnet/english-wordnet/releases/latest', { headers: process.env.GITHUB_TOKEN ? { authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {} })
    const rel = await r.json()
    const asset = (rel.assets || []).find(a => /^english-wordnet-\d{4}\.xml\.gz$/.test(a.name))
    if (asset) url = asset.browser_download_url
  } catch (e) { }
  const file = path.join(cache, path.basename(url))
  let cached = false
  try { cached = fs.statSync(file).size > 0 } catch (e) { cached = false }
  if (!cached) {
    log('downloading', url)
    const r = await fetch(url)
    if (!r.ok) throw new Error('WordNet download failed: ' + r.status)
    const body = Buffer.from(await r.arrayBuffer())
    // The release asset is a gzip file; anything else is not written to disk.
    if (body.length < 1000 || body[0] !== 0x1f || body[1] !== 0x8b) throw new Error('WordNet download is not a gzip file')
    fs.writeFileSync(file, body, { flag: 'wx' })
  }
  return file
}

async function readWordnet (file) {
  const entries = new Map() // id -> { lemma, pos, senses: [synset], forms: [] }
  const synsets = new Map() // id -> { members: [entry id], def }
  const senseCount = new Map()
  let cur = null; let syn = null; let edition = ''
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity })
  for await (const line of rl) {
    let m
    if (!edition && !line.startsWith('<?xml') && (m = line.match(/\bversion="([^"]+)"/))) edition = m[1]
    if ((m = line.match(/<LexicalEntry id="([^"]+)"/))) { cur = { id: m[1], lemma: '', pos: '', senses: [], forms: [] }; continue }
    if (cur) {
      if ((m = line.match(/<Lemma writtenForm="([^"]+)" partOfSpeech="(\w)"/))) { cur.lemma = m[1]; cur.pos = m[2]; continue }
      if ((m = line.match(/<Form writtenForm="([^"]+)"/))) { cur.forms.push(m[1]); continue }
      if ((m = line.match(/<Sense id="[^"]+".*?synset="([^"]+)"/))) { cur.senses.push(m[1]); continue }
      if (line.includes('</LexicalEntry>')) {
        entries.set(cur.id, cur)
        senseCount.set(cur.lemma, (senseCount.get(cur.lemma) || 0) + cur.senses.length)
        cur = null
      }
      continue
    }
    if ((m = line.match(/<Synset id="([^"]+)".*?members="([^"]+)"/))) { syn = { members: m[2].split(' '), def: '' }; synsets.set(m[1], syn); continue }
    if (syn && (m = line.match(/<Definition>(.*?)<\/Definition>/))) { syn.def = m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'); syn = null }
  }
  return { entries, synsets, senseCount, edition }
}

function fromWordnet (wn, seed) {
  const block = new Set(seed.block.map(s => s.toLowerCase()))
  const plain = (s) => s.replace(/_/g, ' ').toLowerCase()
  const okWord = (s) => /^[a-z]{3,16}( [a-z]{3,16})?$/.test(s) && !block.has(s)
  // Everyday words: lemmas with several meanings are the common ones.
  const words = new Set()
  // Every single word in WordNet, with its irregular forms: real words are never "fixed".
  wn.entries.forEach(e => {
    const lemma = e.lemma.toLowerCase()
    if (/^[a-z]{2,20}$/.test(lemma)) words.add(lemma)
    for (const f of e.forms) { const x = f.toLowerCase(); if (/^[a-z]{2,20}$/.test(x)) words.add(x) }
  })
  const byLemma = new Map()
  wn.entries.forEach(e => { const k = e.lemma + ':' + e.pos; if (!byLemma.has(k)) byLemma.set(k, e) })
  const lemmaOf = (id) => wn.entries.get(id)?.lemma || ''
  const synonyms = []; const fixes = {}; const notes = []
  for (const s of seed.words) {
    const e = byLemma.get(s.w + ':' + s.pos)
    if (!e) { notes.push(`"${s.w}" (${s.pos}) is not in WordNet`); continue }
    const rx = new RegExp(s.sense, 'i')
    const hit = e.senses.map(id => ({ id, ...wn.synsets.get(id) })).filter(x => x.def && rx.test(x.def))
    if (!hit.length) { notes.push(`no meaning of "${s.w}" matches /${s.sense}/`); continue }
    const group = new Set([s.w])
    for (const h of hit.slice(0, 2)) for (const m of h.members) { const w = plain(lemmaOf(m)); if (w && okWord(w)) group.add(w) }
    if (group.size > 1) synonyms.push(Array.from(group).slice(0, 10))
    // Irregular forms of verbs ("drew", "drawn" to "draw") when the form is not a word of its own.
    if (s.pos === 'v') for (const f of e.forms) if (/^[a-z]+$/.test(f) && !wn.senseCount.has(f) && !/(ed|ing|s)$/.test(f)) fixes[f] = s.w
  }
  return { words: Array.from(words).sort(), synonyms, fixes, notes }
}

// ---------------------------------------------------------------- reported phrases
const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** Reported phrases from `gh api repos/OWNER/REPO/issues?labels=language` (or `gh issue list --json number,title,body`). */
function parseIssues (file) {
  const list = readJson(file, [])
  const out = []
  for (const i of Array.isArray(list) ? list : []) {
    if (i.pull_request) continue
    const body = String(i.body || '')
    const field = (label) => { const m = body.match(new RegExp('###\\s*' + label + '[^\\n]*\\n+([\\s\\S]*?)(?=\\n###|$)', 'i')); return m ? m[1].trim().replace(/^_No response_$/i, '') : '' }
    const say = field('What did you type').split('\n')[0].trim()
    const same = field('What should Mappy have understood').split('\n')[0].trim()
    if (!say || !same || say.length > 200 || same.length > 200) continue
    out.push({ say, same, issue: i.number, trusted: TRUSTED.has(String(i.author_association || i.authorAssociation || '').toUpperCase()) })
  }
  return out
}

/** The smallest change that would make `say` read as `same`. */
function candidatesFor (r, spell) {
  const a = r.say.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/)
  const b = r.same.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').trim().split(/\s+/)
  const out = []
  if (a.length === b.length) {
    const diff = a.map((w, i) => i).filter(i => a[i] !== b[i])
    if (diff.length === 1) {
      const x = a[diff[0]]; const y = b[diff[0]]
      if (/^[a-z][a-z0-9]{0,23}$/.test(x) && /^[a-z]+$/.test(y)) {
        if (spell.typoCost(x, y, 3) <= 3) out.push({ kind: 'fix', from: x, to: y })
        out.push({ kind: 'synonym', group: [x, y] })
      }
    }
  }
  // Words both share (the layer or tool name) become a *: "make parcels visable" and
  // "turn on parcels" teach "make * visable" means "turn on *", for every layer.
  let run = { i: -1, j: -1, n: 0 }
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    let n = 0
    while (i + n < a.length && j + n < b.length && a[i + n] === b[j + n]) n++
    if (n > run.n) run = { i, j, n }
  }
  if (run.n) {
    const ta = [...a.slice(0, run.i), '*', ...a.slice(run.i + run.n)].join(' ')
    const tb = [...b.slice(0, run.j), '*', ...b.slice(run.j + run.n)].join(' ')
    if (ta !== tb && ta !== '*' && tb !== '*' && /^[a-z' *]+$/.test(ta + tb)) out.unshift({ kind: 'rewrite', from: ta, to: tb })
  }
  let k = 0
  while (k < Math.min(a.length, b.length) && a[a.length - 1 - k] === b[b.length - 1 - k]) k++
  const pa = a.slice(0, a.length - k).join(' '); const pb = b.slice(0, b.length - k).join(' ')
  if (pa && pb && pa !== pb && pa.split(' ').length <= 5 && /^[a-z' ]+$/.test(pa) && /^[a-z' ]+$/.test(pb)) out.push({ kind: 'rewrite', from: pa, to: pb })
  return out
}

// ---------------------------------------------------------------- pack helpers
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '.')
const body = (p) => JSON.stringify({ synonyms: p.synonyms, rewrites: p.rewrites, fixes: p.fixes, words: p.words, known: p.known ? p.known.b64.length + ':' + p.known.b64.slice(0, 64) + p.known.b64.slice(-64) : '' })
function withItem (p, c) {
  const q = { ...p, synonyms: p.synonyms.slice(), rewrites: p.rewrites.slice(), fixes: { ...p.fixes } }
  if (c.kind === 'fix') q.fixes[c.from] = c.to
  if (c.kind === 'synonym') q.synonyms.push(c.group)
  if (c.kind === 'rewrite') q.rewrites.push([c.from, c.to])
  return q
}
const describe = (c) => c.kind === 'fix' ? `misspelling "${c.from}" means "${c.to}"` : c.kind === 'synonym' ? `"${c.group.join('" = "')}"` : `"${c.from} ..." means "${c.to} ..."`

// ---------------------------------------------------------------- main
async function main () {
  const w = loadWidget()
  const seed = readJson(path.join(here, 'seed.json'), { words: [], block: [], phrasings: [] })
  const examples = readJson(path.join(here, 'examples.json'), { appNames: [], same: [], keep: [], ask: [] })
  const learned = readJson(path.join(here, 'learned.json'), { about: '', fixes: {}, synonyms: [], rewrites: [], phrases: [] })
  for (const p of learned.phrases) examples.same.push({ say: p.say, same: p.same })
  const previous = readJson(path.join(here, 'language-pack.json'), null)
  const score = makeScorer(w, examples)

  if (CHECK) {
    const s = score(previous || w.language.languagePack())
    const fails = s.results.filter(r => !r.ok)
    log(`${s.results.filter(r => !r.typo && r.ok).length}/${s.results.filter(r => !r.typo).length} phrases understood, ${s.results.filter(r => r.typo && r.ok).length}/${s.results.filter(r => r.typo).length} generated typos read right`)
    for (const f of fails) log('  miss:', f.id, '->', JSON.stringify(f.got), 'wanted', JSON.stringify(f.want))
    log(`harder typos: ${s.hard.filter(r => r.ok).length}/${s.hard.length}`)
    if (args.includes('--verbose')) for (const f of s.hard.filter(r => !r.ok)) log('  hard:', f.id.slice(5), '->', JSON.stringify(f.got))
    // Every check that passed when the pack was built must still pass (checks removed since are ignored).
    const promised = readJson(path.join(here, 'passing.json'), [])
    const ids = new Set(s.results.map(r => r.id))
    const broken = promised.filter(id => ids.has(id) && !s.pass.has(id))
    if (broken.length) {
      log(`${broken.length} check(s) passed when the pack was built and fail now (a code change made Mappy worse at reading):`)
      for (const id of broken.slice(0, 30)) log('  broke:', id)
      process.exitCode = 1
    }
    return
  }

  const wn = await readWordnet(await wordnetFile())
  log(`WordNet ${wn.edition}: ${wn.entries.size} entries`)
  const fromWn = fromWordnet(wn, seed)
  const empty = { format: 1, version: '0000.00.00', synonyms: [], rewrites: [], fixes: {}, words: '' }

  // Start from WordNet words alone, then add each piece only when nothing regresses.
  let pack = { ...empty, words: '', known: w.spell.KnownWords.build(fromWn.words), fixes: { ...fromWn.fixes } }
  const baseline = score(previous || empty)
  let best = score(pack)
  const report = { kept: [], dropped: [], issuesLearned: [], issuesOpen: [], untrusted: [] }
  const tryAdd = (c, why) => {
    const next = withItem(pack, c)
    const s = score(next)
    if (noWorse(best.pass, s.pass)) { pack = next; const gained = s.pass.size - best.pass.size; best = s; report.kept.push(`${describe(c)} (${why}${gained ? `, +${gained} understood` : ''})`); return true }
    report.dropped.push(`${describe(c)} (${why}): broke ${[...best.pass].filter(id => !s.pass.has(id)).slice(0, 3).join('; ')}`)
    return false
  }
  for (const [from, to] of seed.phrasings) if (from !== to) tryAdd({ kind: 'rewrite', from, to }, 'seed phrasing')
  for (const k of Object.keys(seed.fixes || {})) tryAdd({ kind: 'fix', from: k, to: seed.fixes[k] }, 'seed shorthand')
  for (const g of fromWn.synonyms) tryAdd({ kind: 'synonym', group: g }, 'WordNet')
  for (const k of Object.keys(learned.fixes)) tryAdd({ kind: 'fix', from: k, to: learned.fixes[k] }, 'reported before')
  for (const g of learned.synonyms) tryAdd({ kind: 'synonym', group: g }, 'reported before')
  for (const r of learned.rewrites) tryAdd({ kind: 'rewrite', from: r[0], to: r[1] }, 'reported before')

  // New reports: learn the smallest change that makes each one work.
  const reported = arg('--issues') ? parseIssues(arg('--issues')) : []
  for (const r of reported) {
    if (learned.phrases.some(p => p.say === r.say && p.same === r.same)) continue
    examples.same.push({ say: r.say, same: r.same })
    const id = 'same:' + r.say
    const now = score(pack)
    best = now
    let ok = now.pass.has(id)
    if (!ok) {
      for (const c of candidatesFor(r, w.spell)) {
        const next = withItem(pack, c)
        const s = score(next)
        const before = new Set([...best.pass].filter(x => x !== id))
        if (s.pass.has(id) && noWorse(before, s.pass)) {
          pack = next; best = s; ok = true
          if (c.kind === 'fix') learned.fixes[c.from] = c.to
          if (c.kind === 'synonym') learned.synonyms.push(c.group)
          if (c.kind === 'rewrite') learned.rewrites.push([c.from, c.to])
          report.kept.push(`${describe(c)} (issue #${r.issue})`)
          break
        }
      }
    }
    if (ok) { learned.phrases.push({ say: r.say, same: r.same, issue: r.issue }); report.issuesLearned.push(r.issue); if (!r.trusted) report.untrusted.push(r.issue) } else {
      examples.same.pop()
      report.issuesOpen.push(r.issue)
    }
  }

  let final = score(pack)
  if (previous && !noWorse(baseline.pass, final.pass)) {
    // Never ship a pack that understands less than the one out there: keep the old one.
    report.dropped.push(`the whole rebuild: it broke ${[...baseline.pass].filter(id => !final.pass.has(id)).slice(0, 5).join('; ')}`)
    pack = { ...previous }
    final = score(pack)
  }
  const changed = !previous || body(previous) !== body(pack) || previous.stats?.understood !== final.pass.size || previous.stats?.phrases !== final.results.length
  pack.version = changed ? today() : previous.version
  if (changed && previous && previous.version.startsWith(pack.version)) pack.version = previous.version.split('.').length > 3 ? previous.version.replace(/\.(\d+)$/, (m, n) => '.' + (Number(n) + 1)) : pack.version + '.1'
  // Versions compare part by part as numbers in the widget ("2026.11.02.10" is after ".9").
  pack.sources = [
    { name: `Open English WordNet ${wn.edition}`, license: 'CC BY 4.0', url: 'https://github.com/globalwordnet/english-wordnet' },
    { name: 'Phrases reported by Mappy users', license: 'Apache-2.0', url: 'https://github.com/' + (process.env.GITHUB_REPOSITORY || 'brianmcleer/mappy-widget') + '/issues?q=label%3Alanguage' }
  ]
  pack.stats = { hardTypos: Math.round(100 * final.hard.filter(r => r.ok).length / Math.max(1, final.hard.length)), typoRobustness: Math.round(100 * final.results.filter(r => r.typo && r.ok).length / Math.max(1, final.results.filter(r => r.typo).length)), words: pack.known?.n || (pack.words ? pack.words.split(' ').length : 0), synonyms: pack.synonyms.length, rewrites: pack.rewrites.length, fixes: Object.keys(pack.fixes).length, understood: final.pass.size, phrases: final.results.length }

  const lines = [
    `## Language pack ${pack.version}`,
    '',
    `Mappy understands **${final.results.filter(r => !r.typo && r.ok).length} of ${final.results.filter(r => !r.typo).length}** test phrases and reads through **${final.results.filter(r => r.typo && r.ok).length} of ${final.results.filter(r => r.typo).length}** generated typos (${Math.round(100 * final.results.filter(r => r.typo && r.ok).length / Math.max(1, final.results.filter(r => r.typo).length))}%). Harder typos (two slips, or a missing first letter): **${final.hard.filter(r => r.ok).length} of ${final.hard.length}** (${Math.round(100 * final.hard.filter(r => r.ok).length / Math.max(1, final.hard.length))}%), was ${baseline.hard.filter(r => r.ok).length}. Before this build: ${baseline.pass.size} of ${baseline.results.length} gated checks passed.`,
    '',
    `${pack.stats.words} known English words, ${pack.stats.synonyms} synonym groups, ${pack.stats.rewrites} phrasings, ${pack.stats.fixes} known misspellings.`,
    ''
  ]
  if (report.issuesLearned.length) lines.push('### Learned from reports', '', ...report.issuesLearned.map(n => `- Closes #${n}${report.untrusted.includes(n) ? ' (from outside the project: review before merging)' : ''}`), '')
  if (report.issuesOpen.length) lines.push('### Reports not learned yet (need a code change)', '', ...report.issuesOpen.map(n => `- #${n}`), '')
  if (report.kept.length) lines.push('<details><summary>Kept</summary>', '', ...report.kept.map(k => `- ${k}`), '', '</details>', '')
  if (report.dropped.length) lines.push('<details><summary>Left out (would have broken a phrase)</summary>', '', ...report.dropped.map(k => `- ${k}`), '', '</details>', '')
  const misses = final.results.filter(r => !r.ok)
  const plainMisses = misses.filter(r => !r.typo)
  const typoMisses = misses.filter(r => r.typo)
  if (plainMisses.length) lines.push('<details><summary>Still missed</summary>', '', ...plainMisses.map(r => `- \`${r.id}\` read as \`${r.got}\`, wanted \`${r.want}\``), '', '</details>', '')
  const hardMisses = final.hard.filter(r => !r.ok)
  if (hardMisses.length) lines.push(`<details><summary>Harder typos still missed (${hardMisses.length})</summary>`, '', ...hardMisses.slice(0, 80).map(r => `- \`${r.id.slice(5)}\` read as \`${r.got}\`, wanted \`${r.want}\``), '', '</details>', '')
  if (typoMisses.length) lines.push(`<details><summary>Typos still missed (${typoMisses.length})</summary>`, '', ...typoMisses.slice(0, 60).map(r => `- \`${r.id.slice(5)}\` read as \`${r.got}\`, wanted \`${r.want}\``), '', '</details>', '')
  if (fromWn.notes.length) lines.push('<details><summary>Seed notes</summary>', '', ...fromWn.notes.map(n => `- ${n}`), '', '</details>', '')
  fs.writeFileSync(path.join(here, 'report.md'), lines.join('\n'))

  if (!changed && !report.issuesLearned.length) { log('no change'); setOutput('changed', 'false'); return }
  learned.about = 'What the weekly build learned from reported phrases. Edit or delete lines freely; the build tests everything again each run.'
  writeIfChanged(path.join(here, 'learned.json'), JSON.stringify(learned, null, 2) + '\n')
  writeIfChanged(path.join(here, 'language-pack.json'), JSON.stringify(pack) + '\n')
  writeIfChanged(path.join(here, 'passing.json'), JSON.stringify([...final.pass].sort(), null, 0).replace(/","/g, '",\n"') + '\n')
  writeIfChanged(path.join(widget, 'src', 'brain', 'languagePack.ts'), packModule(pack))
  log(`pack ${pack.version}: ${final.pass.size}/${final.results.length} understood`)
  setOutput('changed', 'true')
  setOutput('version', pack.version)
  setOutput('trusted', report.untrusted.length ? 'false' : 'true')
}

export function packModule (pack) {
  return `/* Generated by language/build.mjs from Open English WordNet (CC BY 4.0) and reported phrases.
   Do not edit by hand: change language/seed.json or language/learned.json in the repository. */
const PACK: any = ${JSON.stringify(pack)}
export default PACK
`
}

function setOutput (k, v) { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`) }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1) })
}
