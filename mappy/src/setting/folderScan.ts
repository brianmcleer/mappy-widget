/*
  folderScan.ts - reads files on the author's own computer through the browser's folder
  picker (Edge and Chrome). Nothing is uploaded: the text goes into the brain stored with
  the app, like the deep scan.

  Two scans:
  1. Experience Builder folder. Accepts the EB install root, client, your-extensions\widgets,
     or one widget folder. For each custom widget the app uses (or all of them) it reads
       manifest.json                          label and description
       README.md                              user-facing sections (features, usage, settings, tips)
       docs\*.md                              help guides and how-tos
       src\runtime\translations\default.ts    the in-widget help guide text (keys starting with
                                              "help"), grouped into topics, plus any long sentence
                                              a user reads
     and links each topic to "open the widget's own help guide".
  2. Help files folder. Any folder of saved guide pages (.html, .htm, .md, .txt), for guides
     whose web server does not let the builder read them. One fact per heading.

  node_modules, dist, .vs, .git, i18n backups and Claude outputs are never opened.
*/
import { helpTopics } from './widgetHelp'
export { helpTopics } from './widgetHelp'
import type { Doc, MappyAction } from '../brain/types'
import { clip, hash } from '../brain/text'
import { htmlSections, mdSections, stripMd, chunk, guideDocs } from '../brain/guides'
import { customWidgetFolders } from './deepScan'

const README_KEEP = /(overview|feature|usage|using|use|how|configur|setting|option|tip|faq|help|what|work|guide|step|tool|button|mode)/i
const README_DROP = /(install|setup|set up|requirement|licen|troubleshoot.*duplicated|telemetry|credit|locali[sz]ation|visual studio|editor|typescript|changelog|build|publish|contribut|feedback|release|develop|deploy|version|bridge)/i
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vs', '.git', '.vscode', 'i18n', 'backup', 'Claude outputs', 'tests', '__tests__', 'coverage'])

export function folderPickerSupported (): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

export interface FolderScanResult {
  docs: Doc[]
  widgetsRead: string[]
  notes: string[]
}

async function pick (id: string): Promise<any | null> {
  const picker = (window as any).showDirectoryPicker
  if (typeof picker !== 'function') throw new Error('This browser has no folder picker. Use Microsoft Edge or Google Chrome.')
  try {
    return await picker({ id, mode: 'read' })
  } catch (e: any) {
    if (e?.name === 'AbortError') return null
    throw e
  }
}

export async function scanFolder (appConfig: any, onlyUsed: boolean, onLog: (msg: string) => void): Promise<FolderScanResult | null> {
  const root = await pick('mappy-eb-folder')
  if (!root) return null
  const used = customWidgetFolders(appConfig)
  const widgetsDir = await findWidgetsDir(root)
  const notes: string[] = []
  const docs: Doc[] = []
  const widgetsRead: string[] = []

  const folders: Array<{ name: string, dir: any }> = []
  if (widgetsDir === 'self') folders.push({ name: root.name, dir: root })
  else if (widgetsDir) {
    for await (const [name, handle] of widgetsDir.entries()) {
      if (handle.kind !== 'directory' || SKIP_DIRS.has(name) || name.startsWith('_') || name.startsWith('.')) continue
      folders.push({ name, dir: handle })
    }
  } else {
    throw new Error('No widgets found there. Pick the Experience Builder folder, its client folder, or client\\your-extensions\\widgets.')
  }

  for (const f of folders) {
    if (onlyUsed && !used.has(f.name)) continue
    const ids = used.get(f.name) || []
    const manifest = await readJson(f.dir, ['manifest.json'])
    if (!manifest) continue
    const label: string = manifest.label || manifest.name || f.name
    const open: MappyAction[] | undefined = ids.length ? [{ type: 'openWidget', ids, label: `Open ${label}` }] : undefined
    const before = docs.length
    const keys = f.name.replace(/[-_]/g, ' ') + ' ' + label + ' widget tool help how to'

    if (manifest.description) {
      docs.push({ id: 'fdoc:' + f.name + ':manifest', kind: 'doc', title: label, text: String(manifest.description), keys, actions: open, src: 'folder' })
    }

    const readme = await readText(f.dir, ['README.md'])
    if (readme) {
      for (const sec of mdSections(readme)) {
        const keep = sec.level <= 1 || (README_KEEP.test(sec.heading) && !README_DROP.test(sec.heading))
        if (!keep || sec.text.length < 30) continue
        pushChunks(docs, f.name, label, sec.heading, sec.text, keys, open)
      }
    }

    const docsDir = await subdir(f.dir, ['docs'])
    if (docsDir) {
      for await (const [name, h] of docsDir.entries()) {
        if (h.kind !== 'file' || !/\.md$/i.test(name) || /changelog|porting|maintenance|code_structure|storage|export_format|handoff/i.test(name)) continue
        const md = await (await h.getFile()).text()
        for (const sec of mdSections(md)) if (sec.text.length >= 30 && !README_DROP.test(sec.heading)) pushChunks(docs, f.name, label, sec.heading, sec.text, keys, open)
      }
    }

    const tr = await readText(f.dir, ['src', 'runtime', 'translations', 'default.ts'])
    if (tr) {
      const topics = helpTopics(tr)
      const helpAction: MappyAction[] | undefined = ids.length ? [{ type: 'widgetHelp', ids, label: `Open the ${label} help guide` }, { type: 'openWidget', ids, label: `Open ${label}` }] : undefined
      for (const t of topics) pushChunks(docs, f.name, label, t.title, t.text, keys + ' in-widget help guide', helpAction)
    }

    if (docs.length > before) widgetsRead.push(label)
  }
  notes.push(`Read ${widgetsRead.length} widget folder${widgetsRead.length === 1 ? '' : 's'}: ${widgetsRead.join(', ')}`)
  onLog(notes[notes.length - 1])
  return { docs, widgetsRead, notes }
}

/** Any folder of saved guide pages. */
export async function scanHelpFolder (onLog: (msg: string) => void): Promise<FolderScanResult | null> {
  const root = await pick('mappy-help-folder')
  if (!root) return null
  const docs: Doc[] = []
  const read: string[] = []
  let files = 0
  const walk = async (dir: any, path: string, depth: number) => {
    if (depth > 5 || files >= 200) return
    for await (const [name, h] of dir.entries()) {
      if (files >= 200) return
      if (h.kind === 'directory') {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) await walk(h, path + name + '/', depth + 1)
        continue
      }
      if (!/\.(html?|md|txt)$/i.test(name)) continue
      const file = await h.getFile()
      if (file.size > 3_000_000) continue
      const text = await file.text()
      files++
      const rel = path + name
      if (/\.html?$/i.test(name)) {
        const { title, sections } = htmlSections(text)
        const d = guideDocs(rel, title || name.replace(/\.html?$/i, ''), sections, undefined, 'folder', 'hdoc')
        docs.push(...d)
        if (d.length) read.push(title || rel)
      } else if (/\.md$/i.test(name)) {
        const d = guideDocs(rel, name.replace(/\.md$/i, ''), mdSections(text), undefined, 'folder', 'hdoc')
        docs.push(...d)
        if (d.length) read.push(rel)
      } else {
        const d = guideDocs(rel, name.replace(/\.txt$/i, ''), [{ heading: name, text: text.replace(/\s+/g, ' '), level: 1 }], undefined, 'folder', 'hdoc')
        docs.push(...d)
        if (d.length) read.push(rel)
      }
    }
  }
  await walk(root, '', 0)
  const msg = `Read ${read.length} help file${read.length === 1 ? '' : 's'} (${docs.length} topics) from "${root.name}".`
  onLog(msg)
  return { docs: docs.slice(0, 400), widgetsRead: read, notes: [msg] }
}

function pushChunks (docs: Doc[], folder: string, label: string, heading: string, body: string, keys: string, actions?: MappyAction[]): void {
  const clean = stripMd(body)
  chunk(clean, 850).slice(0, 6).forEach((p, i, all) => {
    docs.push({
      id: 'fdoc:' + folder + ':' + hash(heading + i),
      kind: 'doc',
      title: `${label}: ${heading}${all.length > 1 ? ` (${i + 1})` : ''}`,
      text: p,
      keys,
      actions,
      src: 'folder'
    })
  })
}

async function subdir (dir: any, path: string[]): Promise<any | null> {
  let d = dir
  for (const p of path) {
    try { d = await d.getDirectoryHandle(p) } catch (e) { return null }
  }
  return d
}

async function readText (dir: any, path: string[]): Promise<string | null> {
  const d = await subdir(dir, path.slice(0, -1))
  if (!d) return null
  try {
    const fh = await d.getFileHandle(path[path.length - 1])
    const file = await fh.getFile()
    if (file.size > 2_000_000) return null
    return await file.text()
  } catch (e) { return null }
}

async function readJson (dir: any, path: string[]): Promise<any | null> {
  const t = await readText(dir, path)
  if (!t) return null
  try { return JSON.parse(t) } catch (e) { return null }
}

async function findWidgetsDir (root: any): Promise<any | 'self' | null> {
  if (await readJson(root, ['manifest.json'])) return 'self'
  for (const c of [['client', 'your-extensions', 'widgets'], ['your-extensions', 'widgets'], ['widgets']]) {
    const d = await subdir(root, c)
    if (d) return d
  }
  for await (const [name, h] of root.entries()) {
    if (h.kind === 'directory' && !SKIP_DIRS.has(name)) {
      if (await readJson(h, ['manifest.json'])) return root
    }
  }
  return null
}
