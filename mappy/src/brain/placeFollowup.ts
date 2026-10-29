import { looksLikePlace, parsePlaceQuestion } from './mcpTools'
import type { PlaceQuestion } from './mcpTools'

/** A narrow, explicit edit to the previous GIS question; never a free-form tool call. */
export function followPlaceQuestion (input: string, previous: PlaceQuestion): string | null {
  const q = input.trim().replace(/[?!]+$/, '').replace(/\s+instead$/i, '')
  const next = { ...previous }
  const about = q.match(/^(?:what about|how about|and)\s+(.+)$/i)
  const move = q.match(/^(?:(?:actually|no)[, ]+)?(?:at|near|from|use)\s+(.+)$/i)
  const radius = q.match(/^(?:within|make (?:it|that))\s+(.+)$/i)
  const limit = q.match(/^(?:show|give me|just|only)(?: me)?(?: the)?\s+(\d+)(?:\s+(?:results?|matches|features|nearest|closest))?$/i)
  const group = q.match(/^(?:group (?:them|those) |break (?:them|those) down )?by\s+(.+)$/i)
  if (limit && ['nearest', 'within'].includes(next.kind)) next.limit = Number(limit[1])
  else if (move && looksLikePlace(move[1])) { next.place = move[1]; next.here = false }
  else if (radius && next.thing && ['nearest', 'within'].includes(next.kind)) {
    const parsed = parsePlaceQuestion(`${next.thing} within ${radius[1]} of ${next.place || 'here'}`)
    if (!parsed || parsed.kind !== 'within' || !Number.isFinite(parsed.feet)) return null
    return renderPlaceQuestion({ ...parsed, limit: next.limit })
  } else if (group && next.kind === 'summary') next.groupBy = group[1]
  else if (about) {
    if (looksLikePlace(about[1])) { next.place = about[1]; next.here = false }
    else if (/^[\p{L}][\p{L}\p{N} _/-]{1,70}$/u.test(about[1]) && !/^(?:show|find|turn|use|run|call|delete|remove|open|close)\b/i.test(about[1])) next.thing = about[1]
    else return null
  } else return null
  return renderPlaceQuestion(next)
}

export function renderPlaceQuestion (p: PlaceQuestion): string | null {
  const place = p.place || (p.here ? 'here' : '')
  if (p.kind === 'summary') return p.thing && p.groupBy ? `count ${p.thing} by ${p.groupBy}` : null
  if (!place) return null
  const limit = p.limit !== undefined ? `show ${p.limit} ` : ''
  if (p.kind === 'nearest') return p.thing ? `${limit}closest ${p.thing} to ${place}` : null
  if (p.kind === 'within') return p.thing && p.feet !== undefined ? `${limit}${p.thing} within ${p.feet} ft of ${place}` : null
  if (p.yesNo && p.thing) return `is ${place} in ${p.thing}`
  if (p.thing === 'parcel') return `who owns ${place}`
  return p.thing ? `what is ${p.thing} at ${place}` : `what is at ${place}`
}
