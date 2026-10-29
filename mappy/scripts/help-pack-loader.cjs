const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const KEEP = /overview|feature|usage|using|use|how|configur|setting|option|tip|faq|help|what|work|guide|step|tool|button|mode/i
const DROP = /install|setup|set up|requirement|licen|telemetry|credit|locali[sz]ation|visual studio|editor|typescript|changelog|build|publish|contribut|feedback|release|develop|deploy|version|bridge|handoff|audit|validation|standards|implementation|maintenance|architecture|verification/i

// Runs only at build time. No other widget's JavaScript is executed.
function buildPack (widgetsRoot, widgetRoot, watch = {}) {
  const ts = require(require.resolve('typescript', { paths: [widgetRoot, widgetsRoot, watch.compilerRoot || widgetRoot] }))
  const cache = new Map()
  function source (relative) {
    const filename = path.resolve(widgetRoot, relative)
    const allowed = ['src/brain/text.ts', 'src/brain/guides.ts', 'src/setting/widgetHelp.ts'].map(p => path.resolve(widgetRoot, p))
    if (!allowed.includes(filename)) throw new Error('Unexpected help-parser dependency')
    if (cache.has(filename)) return cache.get(filename).exports
    watch.file?.(filename)
    const m = new Module(filename, module)
    cache.set(filename, m)
    m.filename = filename
    m.require = request => source(path.relative(widgetRoot, path.resolve(path.dirname(filename), request + '.ts')))
    m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename)
    return m.exports
  }
  const { mdSections, chunk } = source('src/brain/guides.ts')
  const { helpTopics } = source('src/setting/widgetHelp.ts')
  const { hash } = source('src/brain/text.ts')
  const pack = { version: 1, widgets: [], notes: [] }
  watch.context?.(widgetsRoot)
  function read (filename) {
    // One open handle: what is checked is what is read (no check-then-read gap).
    let fd
    try { fd = fs.openSync(filename, 'r') } catch (e) { watch.missing?.(filename); return '' }
    try {
      const info = fs.fstatSync(fd)
      if (!info.isFile() || info.size > 2000000) return ''
      watch.file?.(filename)
      return fs.readFileSync(fd, 'utf8')
    } finally { fs.closeSync(fd) }
  }
  for (const dir of fs.readdirSync(widgetsRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dir.isDirectory() || /^[_.]/.test(dir.name) || /backup|copy|claude outputs/i.test(dir.name)) continue
    const root = path.join(widgetsRoot, dir.name)
    let manifest
    try { manifest = JSON.parse(read(path.join(root, 'manifest.json'))) } catch { continue }
    if (manifest.type && manifest.type !== 'widget') continue
    const label = String(manifest.label || manifest.name || dir.name)
    const docs = []
    const push = (heading, text, help = false) => {
      if (!text || text.length < 30) return
      for (const [i, body] of chunk(text, 850).slice(0, 6).entries()) {
        docs.push({ id: 'fdoc:' + dir.name + ':' + hash(heading + i), kind: 'doc', title: label + ': ' + heading, text: body, keys: dir.name.replace(/[-_]/g, ' ') + ' ' + label + ' help guide', src: 'folder', help })
      }
    }
    push('Overview', String(manifest.description || ''))
    for (const sec of mdSections(read(path.join(root, 'README.md')))) {
      if (!DROP.test(sec.heading) && (sec.level <= 1 || KEEP.test(sec.heading))) push(sec.heading, sec.text)
    }
    const guides = path.join(root, 'docs')
    if (fs.existsSync(guides) && !fs.lstatSync(guides).isSymbolicLink()) {
      watch.context?.(guides)
      for (const name of fs.readdirSync(guides).filter(n => /\.md$/i.test(n) && !DROP.test(n)).sort().slice(0, 40)) {
        for (const sec of mdSections(read(path.join(guides, name)))) if (!DROP.test(sec.heading)) push(sec.heading, sec.text)
      }
    }
    for (const topic of helpTopics(read(path.join(root, 'src/runtime/translations/default.ts')))) push(topic.title, topic.text, true)
    pack.widgets.push({ folder: dir.name, label, docs: docs.slice(0, 160) })
  }
  let total = 0
  for (const widget of pack.widgets) widget.docs = widget.docs.filter(doc => { total += Buffer.byteLength(JSON.stringify(doc)); return total <= 5000000 })
  if (total > 5000000) pack.notes.push('Help pack reached its 5 MB limit; some topics were omitted.')
  return pack
}
module.exports = function helpPackLoader () {
  this.cacheable?.()
  const widgetRoot = path.resolve(__dirname, '..')
  const hostWidgets = path.join(this.rootContext || '', 'your-extensions/widgets')
  const widgetsRoot = path.basename(path.dirname(widgetRoot)) === 'widgets' ? path.dirname(widgetRoot) : hostWidgets
  try {
    return 'module.exports = ' + JSON.stringify(buildPack(widgetsRoot, widgetRoot, {
      compilerRoot: this.rootContext,
      file: p => this.addDependency(p), context: p => this.addContextDependency(p), missing: p => this.addMissingDependency(p)
    }))
  } catch (error) {
    this.emitWarning(new Error('Mappy local help pack: ' + error.message))
    return 'module.exports = ' + JSON.stringify({ version: 1, widgets: [], notes: ['The local help pack could not be generated. Rebuild Mappy inside the Experience Builder widgets folder.'] })
  }
}
module.exports.buildPack = buildPack
