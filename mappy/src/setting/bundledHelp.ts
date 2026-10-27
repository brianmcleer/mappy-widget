import type { Doc, MappyAction } from '../brain/types'
import { customWidgetFolders } from './deepScan'
import type { FolderScanResult } from './folderScan'

export async function scanBundledHelp (appConfig: any, onlyUsed: boolean, onLog: (message: string) => void): Promise<FolderScanResult> {
  const { default: pack } = await import('!!../../scripts/help-pack-loader.cjs!./local-help-pack.js')
  if (!pack.widgets.length) throw new Error(pack.notes[0] || 'No installed widget help is available. Rebuild Mappy inside Experience Builder.')
  const used = customWidgetFolders(appConfig)
  const docs: Doc[] = []
  const widgetsRead: string[] = []
  for (const widget of pack.widgets) {
    if (onlyUsed && !used.has(widget.folder)) continue
    const ids = used.get(widget.folder) || []
    for (const item of widget.docs) {
      const { help, ...doc } = item
      const actions: MappyAction[] = ids.length ? [
        ...(help ? [{ type: 'widgetHelp' as const, ids, label: `Open the ${widget.label} help guide` }] : []),
        { type: 'openWidget', ids, label: `Open ${widget.label}` }
      ] : []
      docs.push({ ...doc, actions })
    }
    if (widget.docs.length) widgetsRead.push(widget.label)
  }
  const notes = [...pack.notes, `Imported ${docs.length} help topics from ${widgetsRead.length} installed widgets. No folder selection needed.`]
  notes.forEach(onLog)
  return { docs, widgetsRead, notes }
}
