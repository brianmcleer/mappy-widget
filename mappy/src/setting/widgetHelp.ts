import { clip } from '../brain/text'
/** "helpStartTitle" -> "Start". */
function topicName (prefix: string): string {
  return prefix.replace(/^help/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Help'
}

/**
 * The in-widget help guide text from translations/default.ts, grouped into topics by key
 * ("helpStartTitle", "helpStartBody1", "helpStartBody2" -> topic "Start"), titled by its
 * Title or Heading key when there is one. Long user-facing sentences under other keys are
 * gathered into a "More" topic.
 */
export function helpTopics (src: string): Array<{ title: string, text: string }> {
  const rx = /(?:^|[,{\s])['"]?([A-Za-z_][\w]*)['"]?\s*:\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g
  const groups = new Map<string, { title?: string, parts: string[] }>()
  const more: string[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(src))) {
    const key = m[1]
    const val = m[3].replace(/\\n/g, ' ').replace(/\\(['"`])/g, '$1').replace(/\{(\w+)\}/g, (mm: string, k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()).trim()
    if (!val) continue
    if (/^help/i.test(key)) {
      if (/guide matches|search the guide|^close$|^help$/i.test(val)) continue
      // Topic = "help" plus the first word: helpStartTitle, helpStart1Search -> helpStart.
      const pm = key.match(/^(help[A-Z][a-z]+)/)
      const prefix = pm ? pm[1] : 'help'
      if (prefix === 'helpTitle' || key === 'helpTitle') continue
      if (!groups.has(prefix)) groups.set(prefix, { parts: [] })
      const g = groups.get(prefix)!
      if (/^help[A-Z][a-z]+(Title|Heading)$/.test(key) && val.length < 80) g.title = val
      else if (val.length >= 12) g.parts.push(val)
    } else if (val.length >= 60 && /\s/.test(val) && /[.!?]$/.test(val)) more.push(val)
  }
  const out: Array<{ title: string, text: string }> = []
  groups.forEach((g, prefix) => {
    if (!g.parts.length) return
    out.push({ title: g.title || topicName(prefix), text: Array.from(new Set(g.parts)).join(' ') })
  })
  if (more.length) out.push({ title: 'More', text: clip(Array.from(new Set(more)).join(' '), 2500) })
  return out
}

