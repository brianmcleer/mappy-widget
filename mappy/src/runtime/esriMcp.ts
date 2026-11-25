/*
  esriMcp.ts (runtime) - a layer that lives in the portal, not on this map, asked through
  Esri's MCP server (MCP for ArcGIS Enterprise). It looks like a feature layer to Mappy's own
  question runner (fields, queryFeatures, queryFeatureCount), and turns each query into one
  query_data call. So "how many", "list", "biggest", "average by" and the rest work on portal
  layers exactly as they do on map layers, with the signed-in person's own permissions.
*/
import type { McpPort, McpTool } from '../brain/mcpTools'
import type { QueryField } from '../brain/analysis'
import type { AskLayer } from '../brain/ask'
import { queryArgs, readQuery, statValue, toolData, toolError, type RemoteQuery } from '../brain/esriMcp'

export type RemoteSchema = AskLayer & { objectIdField: string, geometryType: string, maxRecordCount: number }

export class RemoteLayer {
  readonly fields: QueryField[]
  readonly displayField: string
  readonly objectIdField: string
  readonly title: string
  readonly geometryType = ''
  readonly loaded = true
  readonly definitionExpression = ''
  readonly capabilities = { query: { supportsStatistics: true, supportsOrderBy: true, supportsPagination: true, supportsDistinct: true } }
  /** How many query_data calls this layer has made (for the source line and for tests). */
  calls = 0

  constructor (private port: McpPort, private tool: McpTool, readonly url: string, readonly schema: RemoteSchema) {
    this.fields = schema.fields
    this.title = schema.title
    this.objectIdField = schema.objectIdField
    const text = (f: QueryField): boolean => /string/i.test(f.type || '')
    this.displayField = schema.displayField || schema.fields.find(f => text(f) && /name|title|label/i.test(`${f.name} ${f.alias || ''}`))?.name || schema.fields.find(text)?.name || ''
  }

  createQuery (): any { return { where: '1=1', outFields: ['*'], returnGeometry: false } }

  private async ask (q: RemoteQuery): Promise<ReturnType<typeof readQuery>> {
    this.calls++
    const raw = await this.port.call(this.tool.name, queryArgs(this.tool, this.url, q), 30000)
    if (raw?.isError) throw new Error(`${this.port.label} could not answer that about **${this.title}**: ${toolError(raw)}`)
    return readQuery(toolData(raw))
  }

  async queryFeatureCount (q: any): Promise<number> {
    const field = this.objectIdField || this.fields[0].name
    const got = await this.ask({ where: q?.where, statistics: [{ type: 'count', field, as: 'n' }] })
    const row = got.stats[0] || got.rows[0]
    const n = Number(row ? statValue(row, 'count', field, 'n') : got.total)
    if (!Number.isFinite(n)) throw new Error(`${this.port.label} did not return a count for **${this.title}**.`)
    return n
  }

  async queryFeatures (q: any): Promise<{ features: Array<{ attributes: any, geometry: null }>, exceededTransferLimit: boolean }> {
    const stats: any[] = Array.isArray(q?.outStatistics) ? q.outStatistics : []
    if (stats.length) {
      const wanted = stats.map(s => ({ type: String(s.statisticType), field: String(s.onStatisticField), as: String(s.outStatisticFieldName || `${s.statisticType}_${s.onStatisticField}`) }))
      const group: string | undefined = Array.isArray(q.groupByFieldsForStatistics) ? q.groupByFieldsForStatistics[0] : undefined
      // Ordering by one of our own names for a statistic: Esri calls it "{type}_{field}".
      const orderBy = (Array.isArray(q.orderByFields) ? q.orderByFields : []).map((o: string) => {
        const [name, dir] = String(o).split(/\s+/)
        const hit = wanted.find(w => w.as === name)
        return `${hit ? `${hit.type}_${hit.field}` : name}${dir ? ' ' + dir : ''}`
      })
      const got = await this.ask({ where: q.where, statistics: wanted, groupBy: group, orderBy })
      const rows = got.stats.length ? got.stats : got.rows
      let features = rows.map(row => {
        const attributes: any = {}
        if (group) attributes[group] = row[group] ?? row[Object.keys(row).find(k => k.toLowerCase() === group.toLowerCase()) || '']
        for (const w of wanted) attributes[w.as] = statValue(row, w.type, w.field, w.as)
        return { attributes, geometry: null }
      })
      if (Number.isFinite(q.num) && q.num > 0) features = features.slice(0, q.num)
      return { features, exceededTransferLimit: false }
    }
    if (q?.returnDistinctValues && Array.isArray(q.outFields) && q.outFields.length === 1) {
      const f = String(q.outFields[0])
      const got = await this.ask({ where: q.where, statistics: [{ type: 'count', field: f, as: 'n' }], groupBy: f, orderBy: [`${f} ASC`] })
      return { features: (got.stats.length ? got.stats : got.rows).map(row => ({ attributes: { [f]: row[f] }, geometry: null })), exceededTransferLimit: false }
    }
    const size = Number.isFinite(q?.num) && q.num > 0 ? Math.min(q.num, this.schema.maxRecordCount || 1000) : 100
    const got = await this.ask({ where: q?.where, orderBy: Array.isArray(q?.orderByFields) ? q.orderByFields : undefined, pageSize: size, offset: Number(q?.start) || undefined })
    return { features: got.rows.slice(0, size).map(attributes => ({ attributes, geometry: null })), exceededTransferLimit: got.more }
  }
}
