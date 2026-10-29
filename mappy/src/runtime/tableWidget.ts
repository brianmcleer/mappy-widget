/*
  tableWidget.ts - puts records in the app's own Table widget, the way a person would.
  Opens the Table first (walking into the sidebar, panel or controller that holds it). Then:
  - the whole layer, when the Table already has a tab for it: switches to that tab;
  - anything narrower (a condition, "within 500 ft of ...", the features just found): runs the
    Table's own View in table action, so a new tab opens with exactly those rows.
  Works with any app that has Esri's Table widget; nothing here knows a specific layout.
*/
import { getAppStore, appActions, DataActionManager, DataLevel } from 'jimu-core'
import type { AppModel } from '../brain/appModel'
import { compileCondition } from '../brain/analysis'
import type { LayerEntry, LiveMap } from './live'
import { openWidget, bestWidgetId, wait, pulse, widgetEl } from './navigate'

/** Most rows sent to the Table at once. The Table pages them itself. */
export const TABLE_ROW_CAP = 2000

/** What to show: a condition in words, features near a point, or features by object id. */
export interface TableRequest {
  condition?: string
  inView?: boolean
  near?: { lat: number, lon: number, feet: number }
  ids?: Array<number | string>
  /** Tab name; defaults to the layer's title (and the condition). */
  label?: string
}

export interface TableResult { ok: boolean, count: number, capped: boolean, switched?: boolean, message?: string }

/** Table widgets placed in the app (one per screen size, perhaps). */
export function tableWidgetIds (appConfig: any): string[] {
  const widgets = appConfig?.widgets || {}
  return Object.keys(widgets).filter(id => {
    const w = widgets[id]
    const name = String(w?.manifest?.name || '')
    const uri = String(w?.uri || '')
    return name === 'table' || /widgets\/common\/table\/?$/.test(uri)
  })
}

function jimuLayerViewFor (live: LiveMap, entry: LayerEntry): any {
  const jmv: any = live.jmv
  if (!jmv) return null
  const target = live.target(entry)
  try { const v = jmv.getJimuLayerViewByAPILayer?.(target); if (v) return v } catch (e) { }
  const views: any[] = Object.values(jmv.jimuLayerViews || {})
  return views.find(v => v?.layer === target) || views.find(v => target?.id != null && v?.layer?.id === target.id && (v?.layer?.parent || v?.layer?.layer) === (target.parent || target.layer)) || null
}

async function dataSourceFor (live: LiveMap, entry: LayerEntry): Promise<any> {
  const v = jimuLayerViewFor(live, entry)
  if (!v) return null
  try { const ds = v.getLayerDataSource?.(); if (ds) return ds } catch (e) { }
  for (const make of ['getOrCreateLayerDataSource', 'createLayerDataSource']) {
    try { if (typeof v[make] === 'function') { const ds = await v[make](); if (ds) return ds } } catch (e) { }
  }
  return null
}

function viewInTableAction (tableId: string): any {
  const all: any[] = DataActionManager.getInstance().getActions() || []
  return all.find(a => a?.widgetId === tableId && a?.name === 'viewInTable') ||
    all.find(a => a?.widgetId === tableId && /viewintable/i.test(String(a?.id || a?.name || ''))) || null
}

/** The Table's own tab for this layer, when the app author set one up. */
function configuredTab (tableId: string, ds: any): string | null {
  const cfg = getAppStore().getState()?.appConfig?.widgets?.[tableId]?.config
  const tabs: any[] = (cfg?.layersConfig?.asMutable ? cfg.layersConfig.asMutable({ deep: true }) : cfg?.layersConfig) || []
  const ids = new Set([ds?.id, ds?.getMainDataSource?.()?.id, ds?.getDataSourceJson?.()?.id].filter(Boolean))
  const hit = tabs.find(t => ids.has(t?.useDataSource?.dataSourceId) || ids.has(t?.useDataSource?.mainDataSourceId))
  return hit ? String(hit.id) : null
}

function feetToMeters (ft: number): number { return ft * 0.3048 }

/** Opens the Table and shows these records in it. `from` is the widget asking (Mappy). */
export async function openInTable (live: LiveMap, model: AppModel, entry: LayerEntry, req: TableRequest, from: string): Promise<TableResult> {
  const ids = tableWidgetIds(getAppStore().getState()?.appConfig)
  if (!ids.length) return { ok: false, count: 0, capped: false, message: 'This app has no Table.' }
  const tableId = bestWidgetId(ids, model)
  const ds = await dataSourceFor(live, entry)
  if (!ds || typeof ds.query !== 'function') return { ok: false, count: 0, capped: false, message: `The Table cannot read ${entry.title} from this map.` }
  const whole = !req.condition && !req.near && !req.ids?.length && !req.inView

  // The whole layer, and the Table already has a tab for it: just show that tab.
  const tab = whole ? configuredTab(tableId, ds) : null
  const tableLabel = String(getAppStore().getState()?.appConfig?.widgets?.[tableId]?.label || 'Table')
  if (tab) {
    await openWidget(ids, tableLabel, model, { pulse: false })
    getAppStore().dispatch(appActions.widgetStatePropChange(tableId, 'activeTabId', tab))
    getAppStore().dispatch(appActions.widgetStatePropChange(tableId, 'settingChangeTab', true))
    // The Table reads the request once; clear it so people can switch tabs freely afterwards.
    setTimeout(() => getAppStore().dispatch(appActions.widgetStatePropChange(tableId, 'settingChangeTab', false)), 800)
    pulse(widgetEl(tableId))
    let count = 0
    try { count = await ds.queryCount?.({ where: '1=1' }).then((r: any) => r?.count ?? 0) } catch (e) { }
    return { ok: true, count, capped: false, switched: true }
  }

  const target = live.target(entry)
  const params: any = { where: '1=1', outFields: ['*'], returnGeometry: true, pageSize: TABLE_ROW_CAP, page: 1 }
  if (req.condition) params.where = compileCondition(req.condition, Array.from(target?.fields || []) as any[])
  if (req.ids?.length) {
    const oid = target?.objectIdField || 'OBJECTID'
    params.where = `(${params.where}) AND ${oid} IN (${req.ids.map(v => typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`).join(',')})`
  }
  if (req.near) {
    params.geometry = { x: req.near.lon, y: req.near.lat, spatialReference: { wkid: 4326 } }
    params.geometryType = 'esriGeometryPoint'
    params.spatialRel = 'esriSpatialRelIntersects'
    params.distance = feetToMeters(req.near.feet)
    params.units = 'esriSRUnit_Meter'
  } else if (req.inView && live.view?.extent) {
    params.geometry = live.view.extent.toJSON ? live.view.extent.toJSON() : live.view.extent
    params.spatialRel = 'esriSpatialRelIntersects'
  }
  const result = await ds.query(params)
  const records: any[] = result?.records || []
  if (!records.length) return { ok: false, count: 0, capped: false, message: `No ${entry.title} records match.` }
  // Open the Table first (expands its sidebar or panel), then hand it the records.
  await openWidget(ids, tableLabel, model, { pulse: false })
  // The Table loads on first open; its View in table action registers a moment later.
  let action = viewInTableAction(tableId)
  for (let i = 0; !action && i < 20; i++) { await wait(200); action = viewInTableAction(tableId) }
  if (!action) return { ok: false, count: records.length, capped: false, message: 'The Table is not ready to take records yet. Try again in a moment.' }
  const label = req.label || (req.condition ? `${entry.title} (${req.condition})` : entry.title)
  const dataSets: any[] = [{ dataSource: ds, records, name: label, label, type: 'loaded' }]
  await DataActionManager.getInstance().executeDataAction(action, dataSets, DataLevel.Records, from)
  pulse(widgetEl(tableId))
  return { ok: true, count: records.length, capped: records.length >= TABLE_ROW_CAP || !!result?.exceededTransferLimit }
}
