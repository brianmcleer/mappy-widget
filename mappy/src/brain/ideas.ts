import { numericField } from './analysis'
import { fieldLabel } from './fields'

export interface DataIdea { label: string, detail: string, query: string }

/** Build runnable questions from metadata, without guessing field meanings or querying records. */
export function dataIdeas (layer: string, fields: any[], options: { table?: boolean, statistics?: boolean, order?: boolean } = {}): DataIdea[] {
  const ideas: DataIdea[] = [
    { label: 'Count all records', detail: 'Ask the service for the total, rather than counting one result page.', query: `count ${layer}` },
    { label: 'Browse the records', detail: 'Open a bounded table with CSV export.', query: `show table ${layer}` }
  ]
  if (!options.table) ideas.push({ label: 'Count records on screen', detail: 'Limit the count to the current map extent.', query: `count ${layer} in view` })
  const usable = fields.filter(f => /^[a-z_][a-z0-9_.]*$/i.test(f.name || '') && !/^(?:objectid|globalid|fid|shape(?:[._].*)?)$/i.test(f.name) && !/oid|geometry|globalid/i.test(f.type || ''))
  const metric = usable.find(f => numericField(f) && !f.domain?.codedValues?.length)
  if (usable.length && options.statistics !== false && fields.some(f => /^(?:oid|esriFieldTypeOID)$/i.test(f.type || ''))) ideas.push({ label: 'Check missing values', detail: 'Count null values in up to 12 fields using service statistics.', query: `check data quality for ${layer}` })
  if (metric && options.statistics !== false) ideas.push({ label: `Summarize ${fieldLabel(metric)}`, detail: 'Count, total, average, minimum and maximum in source units.', query: `summarize ${metric.name} in ${layer}` })
  if (metric && options.order !== false) ideas.push({ label: `Highest ${fieldLabel(metric)}`, detail: 'Show up to five records, sorted by this numeric field.', query: `top 5 ${layer} by ${metric.name}` })
  const category = usable.find(f => f.domain?.codedValues?.length) || usable.find(f => /^(?:string|esriFieldTypeString)$/i.test(f.type || ''))
  if (category && options.statistics !== false) ideas.push({ label: `Break down by ${fieldLabel(category)}`, detail: 'Count records by category; partial service results are labelled.', query: `count ${layer} by ${category.name}` })
  const code = category?.domain?.codedValues?.find((v: any) => typeof v.name === 'string' && !/["\\\r\n]/.test(v.name))
  if (code) ideas.push({ label: `Find ${code.name} records`, detail: `Uses the configured value for ${fieldLabel(category)}.`, query: `filter ${layer} where ${category.name} equals "${code.name}"` })
  return ideas
}
