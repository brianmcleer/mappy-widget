/** Local conversation planning. No network, model, or generated executable code. */
export function normalizeCommand (input: string): string {
  let text = input.trim().replace(/[’‘]/g, "'")
  for (let i = 0; i < 3; i++) text = text
    .replace(/^(?:hey\s+mappy[,!]?\s+|mappy[,!]?\s+|(?:ok|okay|alright|so|now|then|also|and|next|um|uh|hmm)[,]?\s+(?=\S+\s+\S))/i, '')
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
  // Whole follow-up phrases only: never replace text embedded in a value or condition.
  const q = input.trim().replace(/[.!?]+$/, '')
  if (/^(?:hide|disable|turn off) (?:it|that layer|this layer)$|^turn (?:it|that layer|this layer) off$/i.test(q)) return `turn off ${layer}`
  if (/^(?:show|enable|turn on) (?:it|that layer|this layer)$|^turn (?:it|that layer|this layer) (?:on|back on)$|^show (?:it|that layer|this layer) again$/i.test(q)) return `turn on ${layer}`
  // Bare follow-ups right after working with a layer: "open table", "fields", "label it", "fade it", "only it".
  if (/^(?:open|show|browse|view|display|pull up|bring up)(?: me)?(?: the| a| its)?(?: attribute)? table$|^(?:the )?(?:attribute )?table$|^(?:open|show|put) (?:it|that|this|that layer|this layer|them|those) (?:in|as) (?:a |the )?table$|^(?:add|put|send) (?:it|that|them|those|the layer|that layer|this layer) (?:to|in|into) (?:a |the )?table$|^(?:open|show) (?:the )?table (?:for|of) (?:it|that|this)$/i.test(q)) return `show table ${layer}`
  if (/^(?:turn|switch) off (?:the|that|this) layer$|^(?:hide|disable|remove) (?:the|that|this) layer$|^turn the layer off$/i.test(q)) return `turn off ${layer}`
  if (/^(?:fields|columns|attributes|what fields|which fields|what(?:'s| is) in it|what does it (?:have|contain)|show (?:the )?fields)$/i.test(q)) return `fields in ${layer}`
  if (/^(?:label(?: it| them| that)?|labels|labels on|turn on (?:the )?labels|add labels|show labels)$/i.test(q)) return `label ${layer}`
  if (/^(?:unlabel(?: it| them)?|labels off|turn off (?:the )?labels|hide (?:the )?labels|remove (?:the )?labels)$/i.test(q)) return `turn off labels for ${layer}`
  if (/^(?:fade(?: it| that)?|make it (?:transparent|see[- ]through)|dim it)$/i.test(q)) return `fade ${layer}`
  if (/^(?:solo(?: it)?|only (?:it|that|this|that one)|show only (?:it|that|this)|just (?:it|that one)|isolate it|hide everything else|turn everything else off)$/i.test(q)) return `show only ${layer}`
  if (/^(?:summari[sz]e(?: it| that)?|explore(?: it| that)?|describe (?:it|that)|what can i ask(?: about it)?|data ideas)$/i.test(q)) return `explore ${layer}`
  if (/^(?:largest|biggest|the largest one|which is (?:the )?(?:largest|biggest))$/i.test(q)) return `largest ${layer}`
  if (/^(?:smallest|the smallest one|which is (?:the )?smallest)$/i.test(q)) return `smallest ${layer}`
  if (/^(?:when was it (?:last )?updated|how (?:current|old|recent) is it|when updated|last updated)$/i.test(q)) return `when was ${layer} updated`
  if (/^(?:where is it|where is it in the (?:layer list|list|toc)|find it in the (?:layer list|list))$/i.test(q)) return `where is ${layer} in the layer list`
  if (/^(?:show|open|browse) (?:its|that layer's|this layer's) (?:table|rows|records)$|^(?:show|open|browse) (?:the )?table (?:for|of) (?:it|that layer|this layer)$/i.test(q)) return `show table ${layer}`
  if (/^(?:show|list) (?:its|that layer's|this layer's) (?:fields|columns|attributes)$|^what (?:fields|columns|attributes) does it have$/i.test(q)) return `fields in ${layer}`
  if (/^(?:explore|describe) (?:it|that layer|this layer)$|^what can i ask about (?:it|that layer|this layer)$/i.test(q)) return `explore ${layer}`
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
