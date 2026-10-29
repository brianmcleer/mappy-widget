/*
  layers.ts - turns layer descriptions (from a service's REST JSON during the deep scan, or
  from the live Maps SDK layer at runtime) into things Mappy knows, and picks the fields
  worth searching. Pure TypeScript.
*/
import type { Doc, LayerHint } from './types'
import { stripHtml, clip, layerKey } from './text'
import { fieldLabel } from './fields'

export interface FieldInfo {
  name: string
  alias?: string
  type?: string
  codes?: Array<[string | number, string]>
}

export interface LayerInfo {
  url?: string
  title: string
  isTable?: boolean
  geometryType?: string
  description?: string
  copyright?: string
  displayField?: string
  fields: FieldInfo[]
  itemSnippet?: string
  itemDescription?: string
  mapTitle?: string
  parentTitle?: string
}

const SKIP_FIELD = /^(objectid|objectid_\d+|fid|oid|globalid|guid|shape|shape[._].*|st_area.*|st_length.*|created_user|created_date|last_edited_user|last_edited_date|creationdate|creator|editdate|editor|gdb_.*|se_anno_cad_data)$/i
const GOOD_SEARCH = /(name|addr|address|street|owner|parcel|pin|apn|num|number|label|title|location|situs|subdiv|business|facility|site|code|id$|_id|tag|asset)/i

const GEOM: { [k: string]: string } = {
  esriGeometryPoint: 'point', esriGeometryMultipoint: 'point', esriGeometryPolyline: 'line', esriGeometryPolygon: 'polygon',
  point: 'point', multipoint: 'point', polyline: 'line', polygon: 'polygon'
}

export function shortType (t?: string): string {
  return String(t || '').replace(/^esriFieldType/, '').toLowerCase()
}

/** Up to four string fields worth a LIKE search, best first. */
export function pickSearchFields (fields: FieldInfo[], displayField?: string): string[] {
  const strings = fields.filter(f => /string/i.test(f.type || '') && !SKIP_FIELD.test(f.name))
  const scored = strings.map(f => {
    let s = 0
    if (displayField && f.name.toLowerCase() === displayField.toLowerCase()) s += 5
    if (GOOD_SEARCH.test(f.name) || GOOD_SEARCH.test(f.alias || '')) s += 3
    if (f.codes && f.codes.length) s -= 2
    return { f, s }
  })
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, 4).map(x => x.f.name)
}

export function layerHint (info: LayerInfo): LayerHint {
  const key = layerKey(info.url, info.title)
  return {
    key,
    title: info.title,
    url: info.url,
    displayField: info.displayField,
    fields: info.fields.filter(f => !SKIP_FIELD.test(f.name)).slice(0, 80).map(f => [f.name, fieldLabel(f), shortType(f.type)] as [string, string, string]),
    searchFields: pickSearchFields(info.fields, info.displayField),
    geometryType: GEOM[info.geometryType || ''] || info.geometryType
  }
}

export function docsFromLayer (info: LayerInfo, src: Doc['src']): Doc[] {
  const key = layerKey(info.url, info.title)
  const fields = info.fields.filter(f => !SKIP_FIELD.test(f.name))
  const geom = GEOM[info.geometryType || ''] || ''
  const kind = info.isTable ? 'table' : 'layer'
  const desc = clip(stripHtml(info.description || info.itemSnippet || info.itemDescription || ''), 600)
  const aliases = fields.slice(0, 30).map(f => fieldLabel(f))
  const docs: Doc[] = [{
    id: kind + ':' + key,
    kind,
    title: info.title,
    text: [
      info.isTable ? 'A table of records.' : `A ${geom ? geom + ' ' : ''}layer on the map.`,
      desc,
      aliases.length ? `Fields: ${aliases.join(', ')}.` : '',
      info.copyright ? `Source: ${clip(stripHtml(info.copyright), 160)}.` : ''
    ].filter(Boolean).join(' '),
    keys: [fields.map(f => f.name).join(' '), info.parentTitle || '', info.mapTitle || ''].join(' '),
    where: info.parentTitle ? `in the "${info.parentTitle}" group` : (info.mapTitle ? `in the "${info.mapTitle}" map` : ''),
    layer: key,
    actions: info.isTable ? undefined : [
      { type: 'layerOn', id: key, label: 'Turn on' },
      { type: 'zoomLayer', id: key, label: 'Zoom to it' }
    ],
    src
  }]
  for (const f of fields) {
    if (!f.codes || !f.codes.length) continue
    const list = f.codes.slice(0, 120).map(([c, n]) => String(c) === String(n) ? String(n) : `${n} (${c})`)
    docs.push({
      id: 'domain:' + key + ':' + f.name.toLowerCase(),
      kind: 'domain',
      title: `${fieldLabel(f)} in ${info.title}`,
      text: `Possible ${fieldLabel(f)} values in ${info.title}: ${clip(list.join(', '), 900)}.`,
      keys: `${f.name} values types categories codes list`,
      layer: key,
      src
    })
  }
  return docs
}

/** A REST layer JSON (FeatureServer/0?f=json) to LayerInfo. */
export function layerInfoFromRest (json: any, url: string, extra?: Partial<LayerInfo>): LayerInfo {
  const fields: FieldInfo[] = (json?.fields || []).map((f: any) => {
    const codes = f.domain?.type === 'codedValue' ? (f.domain.codedValues || []).map((cv: any) => [cv.code, cv.name]) : undefined
    return { name: f.name, alias: f.alias, type: f.type, codes }
  })
  // Subtype domains add codes too.
  return {
    url,
    title: extra?.title || json?.name || url,
    isTable: json?.type === 'Table',
    geometryType: json?.geometryType,
    description: json?.description,
    copyright: json?.copyrightText,
    displayField: json?.displayField,
    fields,
    ...extra
  }
}
