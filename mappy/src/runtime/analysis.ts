import type { AnalysisRequest } from '../brain/analysis'
import { compileConditions, numericField, resolveField } from '../brain/analysis'
import type { Reply } from '../brain/answer'
import type { LayerEntry, LiveMap } from './live'
import { withTimeout } from './live'
import { fieldLabel } from '../brain/fields'

/** Query the existing layer; never overwrite its definition expression or source data. */
export async function analyzeLayer (live: LiveMap, entry: LayerEntry, request: AnalysisRequest, max: number): Promise<Reply> {
  if (entry.isTable && request.inView) throw new Error('Standalone tables have no map geometry. Remove "in view" to query their records.')
  const target = live.target(entry)
  if (!target || typeof target.queryFeatures !== 'function') throw new Error('This layer does not support feature queries.')
  if (target.load && !target.loaded) await withTimeout(target.load(), 8000)
  const fields = Array.from(target.fields || []) as any[]
  const q: any = target.createQuery ? target.createQuery() : { where: target.definitionExpression || '1=1' }
  q.where = q.where || target.definitionExpression || '1=1'
  const base = q.where
  if (request.condition) q.where = `(${q.where}) AND (${compileConditions(request.condition, fields)})`
  q.returnGeometry = false
  if (request.inView) {
    if (!live.view?.extent) throw new Error('The current map extent is not available yet.')
    q.geometry = live.view.extent
    q.spatialRelationship = 'intersects'
  }
  const scope = (request.inView ? 'in the current map extent' : 'across the layer') + (request.condition ? `, where ${request.condition}` : '')
  const source = { title: entry.title, detail: `Live layer query · ${scope} · ${new Date().toLocaleTimeString()}` }
  if (request.kind === 'browse') {
    if (request.limit != null && (!Number.isFinite(request.limit) || request.limit < 1)) throw new Error('Ask for at least one ranked row.')
    const sort = request.field ? resolveField(fields, request.field) : null
    if (sort && target.capabilities?.query?.supportsOrderBy === false) throw new Error('This layer does not support sorted queries.')
    // People-facing columns: no object ids, global ids or shape fields.
    const readable = fields.filter(f => !/geometry|blob|raster|xml|oid|global-?id/i.test(f.type || '') && !/^(?:objectid|fid|oid|globalid)$|globalid|shape[._]/i.test(f.name) && f.name !== target.objectIdField)
    const columns = (sort ? [sort, ...readable.filter(f => f.name !== sort.name)] : readable).slice(0, 8)
    if (!columns.length) throw new Error('No readable fields are available for this table.')
    const offset = Math.max(0, request.offset || 0)
    const canPage = !request.inView && !!target.objectIdField && target.capabilities?.query?.supportsPagination !== false && target.capabilities?.query?.supportsOrderBy !== false
    if (offset && !canPage) throw new Error('This table does not support stable pagination.')
    q.outFields = columns.map(f => f.name)
    q.returnGeometry = false
    q.num = max + 1
    if (canPage) { q.start = offset; q.orderByFields = [target.objectIdField + ' ASC'] }
    if (sort) q.orderByFields = [sort.name + (request.order === 'asc' ? ' ASC' : ' DESC'), ...(target.objectIdField && target.objectIdField !== sort.name ? [target.objectIdField + ' ASC'] : [])]
    const pageSize = Math.min(max, request.limit || max)
    q.num = pageSize + 1
    const result = await withTimeout(target.queryFeatures(q), 12000)
    const features = (Array.from(result?.features || []) as any[])
    const shown = features.slice(0, pageSize)
    const more = features.length > pageSize || !!result.exceededTransferLimit
    const actions: any[] = []
    if (canPage && offset > 0) actions.push({ type: 'ask', q: 'previous page', label: 'Previous rows' })
    if (canPage && more && shown.length && !request.limit) actions.push({ type: 'ask', q: 'next page', label: 'Next rows' })
    return { text: shown.length ? `**${entry.title}**: rows ${offset + 1}–${offset + shown.length}, ${scope}.${sort ? ` Sorted by ${fieldLabel(sort)}, ${request.order === 'asc' ? 'lowest first' : 'highest first'}.` : ''}${request.limit && request.limit > max ? ` The app limits each result to ${max} rows.` : ''}${more ? ' More rows are available.' : ''} Showing ${columns.length} columns.` : `No rows returned from **${entry.title}** ${scope}.`, mood: 'talk', sources: [source], actions,
      page: { offset, size: offset === 0 && more && shown.length > 0 ? Math.min(pageSize, shown.length) : pageSize, hasNext: !request.limit && canPage && more && shown.length > 0 },
      table: { columns: columns.map(f => fieldLabel(f)), rows: shown.map(feature => columns.map(f => {
        const value = feature.attributes?.[f.name]
        if (value == null) return '—'
        const code = f.domain?.codedValues?.find((c: any) => c.code === value)
        if (code) return String(code.name)
        if (/^(date|esriFieldTypeDate)$/i.test(f.type || '') && typeof value === 'number') return new Date(value).toLocaleString()
        return format(value).slice(0, 300)
      })) }
    }
  }
  if (request.kind === 'percent') {
    if (!request.condition) throw new Error('Say which ones to count, for example: what percent of parcels are over 5 acres.')
    if (typeof target.queryFeatureCount !== 'function') throw new Error('This layer does not support count queries.')
    const all = typeof q.clone === 'function' ? q.clone() : { ...q }
    all.where = base
    const [part, whole] = await Promise.all([withTimeout(target.queryFeatureCount(q), 12000), withTimeout(target.queryFeatureCount(all), 12000)])
    if (!Number.isFinite(part) || !Number.isFinite(whole)) throw new Error('The layer did not return valid counts.')
    const pct = whole ? (part / whole) * 100 : 0
    const shown = pct === 0 || pct === 100 || pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)
    return {
      text: whole ? `**${shown}%** of **${entry.title}** (${part.toLocaleString()} of ${whole.toLocaleString()}), ${scope}.` : `**${entry.title}** has no records ${request.inView ? 'in the current map extent' : 'to compare'}.`,
      mood: 'talk', sources: [source],
      actions: part ? [{ type: 'ask', q: `filter ${entry.key} where ${request.condition}${request.inView ? ' in view' : ''}`, label: 'Show them' }] : undefined
    }
  }
  if (request.kind === 'filter' || request.kind === 'countWhere') {
    if (request.kind === 'countWhere') {
      if (typeof target.queryFeatureCount !== 'function') throw new Error('This layer does not support count queries.')
      const count = await withTimeout(target.queryFeatureCount(q), 12000)
      if (!Number.isFinite(count)) throw new Error('The layer did not return a valid count.')
      return { text: `**${count.toLocaleString()}** matching records in **${entry.title}**, ${scope}.`, mood: 'talk', sources: [source] }
    }
    q.outFields = ['*']
    q.returnGeometry = !entry.isTable
    if (!entry.isTable) q.outSpatialReference = live.view.spatialReference
    q.num = max
    const result = await withTimeout(target.queryFeatures(q), 12000)
    const features = Array.from(result?.features || []) as any[]
    const results = features.slice(0, max).map(g => ({ entry, graphic: g, label: String(g.attributes?.[target.displayField] ?? g.attributes?.[target.objectIdField] ?? 'Feature'), detail: request.condition }))
    if (entry.isTable) {
      const columns = fields.filter(f => !/geometry|blob|raster|xml|oid|global-?id/i.test(f.type || '') && !/^(?:objectid|fid|oid|globalid)$|globalid|shape[._]/i.test(f.name) && f.name !== target.objectIdField).slice(0, 8)
      return { text: `${results.length} matching rows from **${entry.title}**.${result.exceededTransferLimit || features.length >= max ? ' Result limit reached; use a count query for the full matching count.' : ''}`, mood: 'talk', sources: [source], table: { columns: columns.map(f => fieldLabel(f)), rows: features.slice(0, max).map(g => columns.map(f => {
        const value = g.attributes?.[f.name]
        const code = f.domain?.codedValues?.find((c: any) => c.code === value)
        return code ? String(code.name) : format(value).slice(0, 300)
      })) } }
    }
    // Nothing matched an exact text match: offer the looser "contains".
    const looser = !results.length && request.condition && /^(.+?)\s+(?:is|equals|=)\s+(.+)$/i.test(request.condition) && !/\b(?:contains|starts with|null|empty|missing|between)\b/i.test(request.condition)
      ? request.condition.replace(/^(.+?)\s+(?:is|equals|=)\s+(.+)$/i, '$1 contains $2') : ''
    return { text: results.length ? `Showing ${results.length}${result.exceededTransferLimit || features.length >= max ? ' (result limit reached)' : ''} matching features from **${entry.title}** ${scope}. The map layer itself is unchanged.` : `No features in **${entry.title}** match ${request.condition} ${scope}.${looser ? ' Names are often longer than one word; try "contains".' : ''}`, results, mood: results.length ? 'talk' : 'think', sources: [source], ...(looser ? { actions: [{ type: 'ask', q: `filter ${entry.key} where ${looser}${request.inView ? ' in view' : ''}`, label: `Try ${looser}` }] } : {}) }
  }
  if (target.capabilities?.query?.supportsStatistics === false) throw new Error('This layer does not support statistics. Try its table or analysis tool.')
  // Avoid inherited projections and pagination in aggregate queries.
  q.outFields = []
  q.orderByFields = []
  q.num = undefined
  q.start = undefined
  q.groupByFieldsForStatistics = []
  if (request.kind === 'quality') {
    if (!target.objectIdField) throw new Error('This check needs an object-ID field for a reliable total.')
    const id = resolveField(fields, target.objectIdField)
    const usable = fields.filter(f => f.name !== id.name && /^[a-z_][a-z0-9_.]*$/i.test(f.name || '') && !/oid|geometry|blob|raster|xml|globalid/i.test(f.type || '') && !/^shape(?:[._]|$)/i.test(f.name))
    const checked = usable.slice(0, 12)
    if (!checked.length) throw new Error('This layer has no supported attribute fields to check.')
    q.outStatistics = [
      { statisticType: 'count', onStatisticField: id.name, outStatisticFieldName: 'mappy_total' },
      ...checked.map((f, i) => ({ statisticType: 'count', onStatisticField: f.name, outStatisticFieldName: `mappy_f${i}` }))
    ]
    const result = await withTimeout(target.queryFeatures(q), 12000)
    if (result?.exceededTransferLimit) throw new Error('The service returned partial statistics; I cannot report reliable completeness percentages.')
    const values = result?.features?.[0]?.attributes
    const total = values?.mappy_total
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('The service did not return a valid record total.')
    const rows = checked.map((f, i) => {
      const present = values[`mappy_f${i}`]
      if (!Number.isSafeInteger(present) || present < 0 || present > total) throw new Error('The service returned incomplete or inconsistent field counts.')
      return { name: f.name, label: fieldLabel(f), present, missing: total - present }
    }).sort((a, b) => b.missing - a.missing)
    return { text: `**${entry.title}**: checked ${checked.length}${usable.length > checked.length ? ` of ${usable.length} supported` : ''} fields across ${total.toLocaleString()} matching records, ${scope}. Missing means null; empty strings, placeholder values and incorrect values are not detected.${total === 0 ? ' No records matched, so completeness is not applicable.' : ''}`, mood: 'talk', sources: [source],
      table: { columns: ['Field', 'Populated', 'Null', 'Completeness'], rows: rows.map(row => [row.label, row.present.toLocaleString(), row.missing.toLocaleString(), total ? `${(row.present / total * 100).toFixed(1)}%` : 'N/A']) },
      actions: [{ type: 'ask', label: 'Browse checked records', q: `show table ${entry.key}${request.condition ? ` where ${request.condition}` : ''}${request.inView ? ' in view' : ''}` },
        ...(!request.condition ? rows.filter(row => row.missing > 0).slice(0, 2).map(row => ({ type: 'ask' as const, label: `Missing ${row.label}`, q: `filter ${entry.key} where ${row.name} is null${request.inView ? ' in view' : ''}` })) : [])] }
  }
  const field = resolveField(fields, request.field || '')
  if (request.kind === 'stats') {
    if (!numericField(field)) throw new Error(`${fieldLabel(field)} is not numeric. Try "count ${entry.title} by ${fieldLabel(field)}".`)
    const stats = ['count', 'sum', 'min', 'max', 'avg']
    q.outStatistics = stats.map(stat => ({ statisticType: stat, onStatisticField: field.name, outStatisticFieldName: 'mappy_' + stat }))
    const result = await withTimeout(target.queryFeatures(q), 12000)
    const values = result?.features?.[0]?.attributes
    if (!values) throw new Error('The layer returned no statistics.')
    return {
      text: `**${fieldLabel(field)}** in **${entry.title}**, ${scope}. Count includes non-null values; units are those of the source field.`,
      mood: 'talk', sources: [source],
      table: { columns: ['Statistic', 'Value'], rows: stats.map(stat => [({ count: 'Count', sum: 'Total', min: 'Minimum', max: 'Maximum', avg: 'Average' } as any)[stat], format(values['mappy_' + stat])]) }
    }
  }
  q.groupByFieldsForStatistics = [field.name]
  q.outStatistics = [{ statisticType: 'count', onStatisticField: target.objectIdField || field.name, outStatisticFieldName: 'mappy_count' }]
  // "Average acres by zoning": a statistic of another field for each group.
  if (request.stat) {
    const value = resolveField(fields, request.valueField || '')
    if (!numericField(value)) throw new Error(`${fieldLabel(value)} is not numeric, so it has no ${request.stat === 'avg' ? 'average' : request.stat === 'sum' ? 'total' : request.stat === 'min' ? 'minimum' : 'maximum'}.`)
    q.outStatistics.push({ statisticType: request.stat, onStatisticField: value.name, outStatisticFieldName: 'mappy_value' })
    const result = await withTimeout(target.queryFeatures(q), 12000)
    const statName = ({ avg: 'Average', sum: 'Total', min: 'Minimum', max: 'Maximum' } as any)[request.stat]
    const rows = (Array.from(result?.features || []) as any[]).map(g => {
      const v = g.attributes?.[field.name]
      const code = field.domain?.codedValues?.find((c: any) => c.code === v)
      return { label: String(code?.name ?? v ?? '(missing)'), count: Number(g.attributes?.mappy_count || 0), value: Number(g.attributes?.mappy_value) }
    }).filter(r => Number.isFinite(r.value)).sort((a, b) => b.value - a.value)
    if (!rows.length) throw new Error('The layer returned no grouped statistics.')
    const limit = 25
    const lead = `**${rows[0].label}** has the highest ${statName.toLowerCase()} ${fieldLabel(value)} (${format(rows[0].value)})${rows.length > 1 ? `; the lowest is **${rows[rows.length - 1].label}** (${format(rows[rows.length - 1].value)})` : ''}.`
    return {
      text: `${lead} ${statName} **${fieldLabel(value)}** by **${fieldLabel(field)}** in **${entry.title}**, ${scope}.${result.exceededTransferLimit ? ' The service truncated the groups; these are partial results.' : ''}${rows.length > limit ? ` Showing ${limit} of ${rows.length} groups.` : ''}`,
      mood: 'talk', sources: [source],
      table: { columns: [fieldLabel(field), 'Count', `${statName} ${fieldLabel(value)}`], rows: rows.slice(0, limit).map(r => [r.label, r.count.toLocaleString(), format(r.value)]) }
    }
  }
  const result = await withTimeout(target.queryFeatures(q), 12000)
  const rows = (Array.from(result?.features || []) as any[]).map(g => {
    const value = g.attributes?.[field.name]
    const code = field.domain?.codedValues?.find((c: any) => c.code === value)
    return [String(code?.name ?? value ?? '(missing)'), Number(g.attributes?.mappy_count || 0)] as [string, number]
  }).sort((a, b) => request.order === 'asc' ? a[1] - b[1] : b[1] - a[1])
  const limit = request.limit || 25
  // "Which zoning has the most parcels": lead with the answer.
  const lead = request.limit && rows.length ? `**${rows[0][0]}** has the ${request.order === 'asc' ? 'fewest' : 'most'} ${entry.title.toLowerCase()} (${rows[0][1].toLocaleString()})${rows.length > 1 ? `, then ${rows.slice(1, Math.min(3, limit)).map(([l, c]) => `${l} (${c.toLocaleString()})`).join(' and ')}` : ''}.` : ''
  return { text: lead || `**${entry.title}** grouped by **${fieldLabel(field)}**, ${scope}.${result.exceededTransferLimit ? ' The service truncated the groups; these are partial results.' : ''}${rows.length > limit ? ` Showing ${limit} of ${rows.length} returned groups.` : ''}`, mood: lead ? 'pleased' : 'talk', sources: [source], table: { columns: [fieldLabel(field), 'Count'], rows: rows.slice(0, limit).map(([label, count]) => [label, count.toLocaleString()]) } }
}

function format (value: unknown): string {
  return value == null ? 'No value' : typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(value)
}
