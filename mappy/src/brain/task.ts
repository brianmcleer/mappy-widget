import type { AnalysisRequest } from './analysis'

export type TaskOperation = 'refresh' | 'view' | 'all' | 'unfilter' | 'rows' | 'count'
export interface TaskSummary {
  layer: string
  kind: string
  scope: string
  filter: string
  ordering?: string
  completed: string
  actions: Array<{ label: string, command: string }>
}

/** Change one part of an existing task, preserving the rest of the query. */
export function reviseTask (request: AnalysisRequest, operation: TaskOperation): AnalysisRequest {
  const next = { ...request, offset: undefined }
  if (operation === 'view') next.inView = true
  else if (operation === 'all') next.inView = false
  else if (operation === 'unfilter') { delete next.condition; if (next.kind === 'filter') next.kind = 'browse' }
  else if (operation === 'rows' || operation === 'count') {
    if (next.limit || !['browse', 'filter', 'countWhere'].includes(next.kind)) throw new Error('Choose a layer explicitly to expand a ranked or summarized result.')
    next.kind = operation === 'rows' ? 'browse' : 'countWhere'
  }
  return next
}

export function taskSummary (request: AnalysisRequest, layer: string, sequence: number, completed: string): TaskSummary {
  const kinds = { browse: 'Rows', filter: 'Matching features', countWhere: 'Count', stats: 'Statistics', group: request.stat ? 'Grouped statistics' : 'Grouped counts', quality: 'Data quality', percent: 'Percent' }
  const action = (label: string, operation: TaskOperation) => ({ label, command: `__task:${sequence}:${operation}` })
  const actions = [action('Refresh', 'refresh'), action(request.inView ? 'Use whole layer' : 'Use current view', request.inView ? 'all' : 'view')]
  if (request.condition) actions.push(action('Remove my filter', 'unfilter'))
  if (!request.limit && ['browse', 'filter', 'countWhere'].includes(request.kind)) actions.push(action(request.kind === 'countWhere' ? 'Show matching rows' : 'Count matches', request.kind === 'countWhere' ? 'rows' : 'count'))
  return {
    layer, kind: (request.limit ? `Top/bottom ${request.limit} · ` : '') + kinds[request.kind],
    scope: request.inView ? 'Current map view at run time' : 'Whole layer',
    filter: request.condition || 'No additional filter',
    ordering: request.field ? `${request.field}${request.order ? ` · ${request.order === 'desc' ? 'descending' : 'ascending'}` : ''}` : undefined,
    completed, actions
  }
}
