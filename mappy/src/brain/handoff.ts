/*
  handoff.ts - the third place Mappy can turn for help: an AI assistant in its own tab (Claude
  by default). Mappy never calls a model. When "Where he gets help" is set to an assistant and
  he is stuck, his answer carries one link that opens the assistant with the question already
  written, an optional prefix in front (a skill or plugin name, "/my-gis"), and a line about
  where the map was. Nothing leaves the app until the person clicks. Pure TypeScript.
*/

/** Which helper the builder chose: the app alone, an MCP server, or an AI assistant. */
export type HelperMode = 'local' | 'mcp' | 'assistant'

export interface AssistantSettings {
  /** Name in the chat ("Claude"). */
  label?: string
  /** Address that opens the assistant with a question; {q} is replaced by the question. */
  url?: string
  /** Written in front of every question: a skill, plugin or instruction ("/my-gis"). */
  prefix?: string
  /** Add a line about the map (place, center, layers on). Undefined means on. */
  context?: boolean
  /** Offer the assistant only to people signed in to the portal. Undefined means on. */
  signedInOnly?: boolean
}

export interface AssistantPort { label: string, url: string, prefix: string, context: boolean }

export interface HandoffContext {
  app?: string
  /** The address or place the conversation is about. */
  place?: string
  /** Map center as latitude, longitude. */
  center?: [number, number]
  layersOn?: string[]
  /** The layer of the feature under the open popup. */
  selected?: string
}

export const DEFAULT_ASSISTANT_LABEL = 'Claude'
export const DEFAULT_ASSISTANT_URL = 'https://claude.ai/new?q={q}'
const MAX_QUESTION = 1200
const MAX_PROMPT = 1800

/** Only https addresses with a host; the question goes where {q} is (or in a q parameter). */
export function safeAssistantUrl (template: string): boolean {
  try {
    const u = new URL(String(template || '').replace('{q}', 'x'))
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password
  } catch (e) { return false }
}

/** The helper in effect: the builder's choice, or (older apps) the server when one is connected. */
export function helperMode (helper: any, mcp: any): HelperMode {
  if (helper === 'local' || helper === 'mcp' || helper === 'assistant') return helper
  return mcp && mcp.url && mcp.enabled !== false ? 'mcp' : 'local'
}

/** Settings as the runtime uses them, or null when the address is not usable. */
export function assistantPort (s: AssistantSettings | null | undefined): AssistantPort | null {
  const url = String(s?.url || '').trim() || DEFAULT_ASSISTANT_URL
  if (!safeAssistantUrl(url)) return null
  return {
    label: one(String(s?.label || '')).slice(0, 40) || DEFAULT_ASSISTANT_LABEL,
    url,
    prefix: one(String(s?.prefix || '')).slice(0, 200),
    context: s?.context !== false
  }
}

/** One line of plain text: no control characters, no runs of spaces. */
function one (s: string): string {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const clipTo = (s: string, n: number): string => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s

/** The line about the map, or '' when there is nothing worth saying. */
export function contextLine (c: HandoffContext | null | undefined): string {
  if (!c) return ''
  const parts: string[] = []
  const place = one(c.place || '')
  const center = c.center && Number.isFinite(c.center[0]) && Number.isFinite(c.center[1]) ? `${c.center[0].toFixed(5)}, ${c.center[1].toFixed(5)}` : ''
  if (place) parts.push(`looking at ${clipTo(place, 120)}${center ? ` (map center ${center})` : ''}`)
  else if (center) parts.push(`map center ${center}`)
  const layers = (c.layersOn || []).map(one).filter(Boolean)
  if (layers.length) parts.push(`layers on: ${layers.slice(0, 8).map(l => clipTo(l, 40)).join(', ')}${layers.length > 8 ? ` and ${layers.length - 8} more` : ''}`)
  const selected = one(c.selected || '')
  if (selected) parts.push(`a ${clipTo(selected, 40)} feature is selected`)
  if (!parts.length) return ''
  const app = one(c.app || '')
  return `(Asked from the map app${app ? ` "${clipTo(app, 60)}"` : ''}: ${parts.join('; ')}.)`
}

/** What is written into the assistant: prefix, the question, then the line about the map. */
export function handoffPrompt (port: AssistantPort, question: string, context?: HandoffContext | null): string {
  const q = clipTo(one(question), MAX_QUESTION)
  if (!q) return ''
  const head = `${port.prefix ? port.prefix + ' ' : ''}${q}`
  const line = port.context ? contextLine(context) : ''
  return clipTo(line ? `${head}\n\n${line}` : head, MAX_PROMPT)
}

/** The link that opens the assistant with the question written, or null when there is nothing to ask. */
export function handoffUrl (port: AssistantPort | null | undefined, question: string, context?: HandoffContext | null): string | null {
  if (!port || !safeAssistantUrl(port.url)) return null
  const prompt = handoffPrompt(port, question, context)
  if (!prompt) return null
  const q = encodeURIComponent(prompt)
  if (port.url.includes('{q}')) return port.url.split('{q}').join(q)
  return `${port.url}${port.url.includes('?') ? '&' : '?'}q=${q}`
}

/** Work that suits an assistant better than a map helper: writing, making, explaining at length. */
export function assistantJob (text: string): boolean {
  return /^(?:(?:can|could|would) you |please |i (?:need|want|would like) (?:you to |a |an )?)?(?:make|create|build|draw|design|write|draft|compose|summari[sz]e|analy[sz]e|explain|research|generate|prepare|put together|come up with|recommend|suggest|brainstorm|translate|report|a report|a map|a summary|a memo|an email|a chart|a table|a spreadsheet)\b/i.test(one(text))
}

/**
 * "ask Claude how many ...", "send that to Claude", "open this in the assistant": the question
 * to hand over ('' means the last thing asked), or null when the words are not a handoff.
 */
export function parseHandoff (text: string, label: string): { question: string } | null {
  const name = one(label).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const who = `(?:the\\s+)?(?:${name ? name + '|' : ''}claude|ai(?: assistant)?|assistant|chatbot)`
  const t = one(text)
  let m = t.match(new RegExp(`^(?:ask|tell|try|check with|see what|see if)\\s+${who}(?:\\s+(?:says?|thinks?|knows?))?\\b[:,]?\\s*(.*)$`, 'i'))
  if (!m) m = t.match(new RegExp(`^(?:send|hand|pass|give|take|open|forward)\\s+(?:this|that|it|my question|the question)?\\s*(?:off\\s+|over\\s+)?(?:to|in|with)\\s+${who}\\b[:,]?\\s*(.*)$`, 'i'))
  if (!m) return null
  const rest = m[1].replace(/^(?:to|about|for|if|whether)\s+/i, '').replace(/[?.!]+$/, '').trim()
  // "ask Claude about this", "ask Claude instead", "ask Claude that": the last thing asked.
  if (!rest || /^(?:this|that|it|instead|please|the same(?: thing| question)?|again|then|too)$/i.test(rest)) return { question: '' }
  return { question: m[1].replace(/^(?:to|about|for)\s+/i, '').trim() }
}
