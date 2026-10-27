/** Local conversation planning. No network, model, or generated executable code. */
export function normalizeCommand (input: string): string {
  let text = input.trim().replace(/[’‘]/g, "'")
  for (let i = 0; i < 3; i++) text = text
    .replace(/^(?:hey\s+mappy[,!]?\s+|mappy[,!]?\s+)/i, '')
    .replace(/^(?:(?:can|could|would|will) you(?: please)?\s+|please\s+)/i, '')
    .replace(/^(?:i (?:want|need|would like) to|let's|let us)\s+(?=find|show|open|turn|count|select|zoom|browse|locate|geocode|go|navigate|summari[sz]e)/i, '')
    .replace(/^help me\s+(?=find|show|open|turn|count|select|zoom|browse)/i, '')
    .replace(/^tell me\s+(?=how many)/i, '')
    .replace(/\s+please[.!?]*$/i, '').trim()
  return text
}

/** Only explicit separators outside quotes; never split layer names on plain "and". */
export function splitCommands (input: string): string[] {
  const parts: string[] = []
  let start = 0
  let quote = ''
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    // Apostrophes inside words are not quoted strings.
    if (ch === '"' || (ch === "'" && !/\w/.test(input[i - 1] || ''))) { quote = ch; continue }
    const separator = input.slice(i).match(/^(?:;|\s+(?:and then|then)\s+)/i)
    if (!separator) continue
    parts.push(input.slice(start, i).trim())
    i += separator[0].length - 1
    start = i + 1
  }
  parts.push(input.slice(start).trim())
  return parts.filter(Boolean)
}

export function contextualCommand (input: string, layer?: string): string {
  if (!layer) return input
  // Restrict substitutions to command targets, never values in a search/filter.
  if (/^(?:find|search|filter|select)\b/i.test(input)) return input
  if (/^(?:how many|count)(?: of)? (?:them|those|these)(?: in view| here)?[?!]*$/i.test(input)) {
    return `count ${layer}${/in view|here/i.test(input) ? ' in view' : ''}`
  }
  if (/^(?:just |only )?(?:in view|here|on screen)[?!]*$/i.test(input)) return `count ${layer} in view`
  if (/^(?:how many|count)(?: in view| here| on screen)?[?!]*$/i.test(input)) return `count ${layer}${/in view|here|on screen/i.test(input) ? ' in view' : ''}`
  const condition = input.search(/\s+(?:where|with)\s+/i)
  const prefix = condition < 0 ? input : input.slice(0, condition)
  const tail = condition < 0 ? '' : input.slice(condition)
  return prefix.replace(/\b(?:it|that layer|this layer)(?=\s*(?:[?!]*$|(?:opacity|transparency)\b))/gi, () => layer) + tail
}
