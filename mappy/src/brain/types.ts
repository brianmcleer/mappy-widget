/*
  types.ts - shared shapes for Mappy's brain.
  Pure TypeScript. No jimu, no esri imports: the runtime and the settings panel both use it.
*/

export type DocKind =
  | 'app' | 'page' | 'view' | 'section' | 'dialog' | 'screen'
  | 'widget' | 'text' | 'link'
  | 'map' | 'layer' | 'table' | 'field' | 'domain' | 'datasource' | 'bookmark' | 'basemap'
  | 'item' | 'faq' | 'note' | 'doc' | 'guide'

export type ActionType =
  | 'openWidget' | 'closeWidget' | 'page' | 'view' | 'dialog'
  | 'layerOn' | 'layerOff' | 'zoomLayer' | 'url' | 'bookmark' | 'ask' | 'feature'
  | 'reveal' | 'preset' | 'solo' | 'fitScale' | 'openLayerList' | 'widgetHelp'

export interface MappyAction {
  type: ActionType
  /** Widget ids (several when the same widget exists once per screen size), page, view, dialog or layer key. */
  ids?: string[]
  id?: string
  sectionId?: string
  url?: string
  label?: string
  /** For 'ask': the question to send. */
  q?: string
}

/** One thing Mappy knows. Kept small: the scanned brain is stored inside the app config. */
export interface Doc {
  id: string
  kind: DocKind
  title: string
  /** Plain text body, already stripped of HTML. */
  text: string
  /** Extra search words (manifest name, aliases, field names). */
  keys?: string
  /** Where it lives in the app, for answers ("in the Widget Controller on the City Map page"). */
  where?: string
  actions?: MappyAction[]
  /** Normalized layer key for layer, field and domain docs. */
  layer?: string
  /** Where this knowledge came from. */
  src?: 'live' | 'scan' | 'folder' | 'admin' | 'builtin'
  /** Multiplies the score. Admin FAQ entries get a boost. */
  boost?: number
}

export interface LayerHint {
  /** Normalized key: lowercased service url, or title when there is no url. */
  key: string
  title: string
  url?: string
  displayField?: string
  /** [name, alias, esriFieldType short] */
  fields: Array<[string, string, string]>
  /** String fields worth searching with LIKE. */
  searchFields: string[]
  geometryType?: string
}

export interface Brain {
  v: 1
  builtAt: number
  appTitle?: string
  stats: { [kind: string]: number }
  docs: Doc[]
  layers: LayerHint[]
  /** Widget manifests by uri (label, description), read during the scan. */
  manifests?: { [uri: string]: { label?: string, description?: string } }
  /** Scan log lines kept for the settings panel. */
  notes?: string[]
}

export interface SearchHit {
  doc: Doc
  score: number
}

export interface Intent {
  name: string
  target?: string
  value?: string
  scope?: string
  raw: string
}
