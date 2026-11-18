/*
  care.ts - the parts of a good helper that are not about the map: handing off to a real person,
  being plain about privacy, and keeping the questions he could not answer so the people who run
  the app can teach him. No network here. The person to ask comes from the builder's settings;
  the missed questions and everything he remembers stay in this browser until someone chooses
  to send them.
*/
import type { MappyAction } from './types'

/** The person or team behind the app, typed by the builder. Any one way to reach them is enough. */
export interface Contact {
  /** How he names them: "the GIS team", "Sam at the front desk". */
  name: string
  email?: string
  phone?: string
  /** A page to go to (a help desk, a request form). https only. */
  url?: string
  /** When they answer: "weekdays 8 to 5". */
  hours?: string
}

const clip = (s: string, n: number): string => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** A contact as typed in settings, checked: null when there is no usable way to reach anyone. */
export function cleanContact (raw: any): Contact | null {
  if (!raw || typeof raw !== 'object') return null
  const email = String(raw.email || '').trim()
  const phone = String(raw.phone || '').trim()
  const url = String(raw.url || '').trim()
  const out: Contact = { name: clip(raw.name || '', 60) || 'a person' }
  if (/^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[a-z]{2,}$/i.test(email) && email.length <= 120) out.email = email
  if (/^[+()\d][\d\s().+-]{5,24}(?:\s?(?:x|ext\.?)\s?\d{1,6})?$/i.test(phone) && (phone.match(/\d/g) || []).length >= 7) out.phone = phone
  if (/^https:\/\/[^\s<>"']+$/i.test(url) && url.length <= 500) out.url = url
  const hours = clip(raw.hours || '', 80)
  if (hours) out.hours = hours
  return out.email || out.phone || out.url ? out : null
}

export type CareAsk = 'person' | 'privacy' | 'forgetAll' | 'missed' | 'clearMissed' | 'saveMissed'

const plain = (text: string): string => String(text || '').toLowerCase().replace(/[’`]/g, "'").replace(/^(?:hey |hi |ok |okay |please |mappy,? )+/, '').replace(/(?:,? please)?[!?.,]+$/g, '').replace(/\s+/g, ' ').trim()

/** Is this one of the helper-care requests? Whole sentences only, so real map requests pass through. */
export function parseCare (input: string): CareAsk | null {
  const t = plain(input)
  if (!t || t.length > 90) return null
  const who = "(?:a |an |the |some ?)?(?:real |live |actual )?(?:person|human|someone|somebody|people|agent|representative|rep|staff|employee|operator|support|help ?desk|gis|gis (?:team|staff|division|department|office)|map (?:team|people)|admin|administrator|the (?:team|office))"
  if (new RegExp(`^(?:(?:can|could|may) i |i (?:want|need|would like|'d like) to |let me |how (?:do|can) i )?(?:talk|speak|chat|get in touch|get help|reach out|connect)(?: (?:to|with|from))? ${who}$`).test(t)) return 'person'
  if (new RegExp(`^(?:(?:can|could|may) i |i (?:want|need|would like|'d like) to |how (?:do|can) i )?(?:contact|email|call|reach|message|ask) ${who}$`).test(t)) return 'person'
  if (new RegExp(`^(?:i (?:want|need) |get me |give me |is there )?${who}(?: (?:please|i can (?:talk|speak) to|to (?:talk|speak) to|to help(?: me)?))?$`).test(t) && /person|human|someone|somebody|agent|representative|rep\b|operator/.test(t)) return 'person'
  if (/^(?:who (?:do|can|should) i (?:contact|call|email|ask|talk to)(?: (?:for|about) (?:help|this|this (?:app|map)|more(?: help)?|questions?|support))?|who (?:runs|made|maintains|manages|is behind) this(?: (?:app|map|site|page))?|contact(?: (?:us|info|information|support|details))?|support|help ?desk|who can help(?: me)?|(?:is there|i need) (?:someone|somebody|anyone) (?:who can|to) help(?: me)?|report (?:a |an )?(?:problem|issue|bug|error|mistake) with (?:this|the) (?:app|map|data|site)|(?:the |this )?(?:data|map|app) is (?:wrong|broken|out of date|outdated)|something is (?:wrong|broken)|this is (?:wrong|broken)|send feedback|give feedback|feedback)$/.test(t)) return 'person'

  if (/^(?:forget everything|forget all(?: of it| about me)?|erase (?:everything|my data|it all|all of it)|delete (?:everything|my data|my (?:info|information|history))|clear (?:everything|my data|my (?:info|information|history)|all (?:my )?data)|wipe (?:everything|my data)|reset (?:everything|your memory|memory)|forget everything (?:about me|you know(?: about me)?))$/.test(t)) return 'forgetAll'
  if (/^(?:privacy|privacy (?:policy|notice|info|statement)|is this (?:private|confidential|anonymous|secure|safe)|(?:is|are) (?:this|my (?:chat|chats|questions?|conversation|data|info|information)) (?:private|saved|stored|recorded|logged|tracked|shared|safe|secure|kept|being (?:saved|stored|recorded|logged|tracked|shared))|(?:do|are) you (?:save|store|record|log|track|keep|share|sell|collect|saving|storing|recording|logging|tracking|keeping|sharing|selling|collecting) (?:this|me|my .+|what i .+|anything|everything|data|information|any (?:data|information))|what (?:do you|does (?:this|mappy)) (?:know|remember|store|save|keep|collect|have|track) (?:about|on) me|what (?:data|information|info) do you (?:keep|store|save|collect|have|track|share)(?: (?:about|on) me)?|(?:who|what) (?:can see|sees|reads|gets) (?:this|my (?:chat|chats|questions?|conversation|data))|where (?:does|do) (?:this|my (?:chat|chats|questions?|data|info|information)) go|(?:are|is) (?:you|this|mappy) (?:tracking|recording|watching|listening to|spying on) me|do you use (?:cookies|ai|my data)|is (?:this|my data) (?:used|sent) (?:to|for) (?:ai|train|training).*)$/.test(t)) return 'privacy'
  if (/^(?:clear|erase|delete|forget|empty) (?:the |your |my )?(?:missed|unanswered) (?:questions?|list)$/.test(t)) return 'clearMissed'
  if (/^(?:save|download|export|get) (?:the |your |my )?(?:missed|unanswered) (?:questions?|list)(?: (?:as|to) (?:a )?(?:csv|file|spreadsheet|excel))?$/.test(t)) return 'saveMissed'
  if (/^(?:what (?:did|have|couldn'?t|could you not|can'?t) you (?:miss(?:ed)?|answer|not (?:answer|know|understand))|what (?:didn'?t|did not|don'?t) you (?:know|understand|get|answer)|(?:show |list )?(?:the |your |my )?(?:missed|unanswered) questions?|what (?:stumped|confused) you|what should you learn)$/.test(t)) return 'missed'
  return null
}

// ------------------------------------------------------------ the person to ask

/** A mailto link with the question already written. Nothing is sent until the person sends it. */
export function mailLink (contact: Contact, opts: { app?: string, question?: string, said?: string, where?: string } = {}): string {
  if (!contact.email) return ''
  const lines: string[] = []
  if (opts.question) lines.push(`My question: ${clip(opts.question, 400)}`)
  if (opts.said) lines.push(`What the map helper said: ${clip(opts.said.replace(/\*\*/g, ''), 400)}`)
  if (opts.where) lines.push(`Where I was: ${clip(opts.where, 300)}`)
  lines.push('', '(Add anything else here.)')
  const subject = `Question about ${clip(opts.app || 'the map', 80)}`
  return `mailto:${encodeURIComponent(contact.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`
}

/** The ways to reach the person, as buttons: email first (it carries the question), then phone, then the page. */
export function contactActions (contact: Contact, opts: { app?: string, question?: string, said?: string, where?: string } = {}): MappyAction[] {
  const out: MappyAction[] = []
  const mail = mailLink(contact, opts)
  if (mail) out.push({ type: 'url', url: mail, label: clip(`Email ${contact.name}`, 40) })
  if (contact.phone) out.push({ type: 'url', url: `tel:${contact.phone.replace(/\s?(?:x|ext\.?)\s?\d+$/i, '').replace(/[^\d+]/g, '')}`, label: `Call ${contact.phone}` })
  if (contact.url) out.push({ type: 'url', url: contact.url, label: mail || contact.phone ? 'Open the help page' : clip(`Contact ${contact.name}`, 40) })
  return out
}

/** "Talk to a person": who they are, when they answer and how to reach them. */
export function contactText (contact: Contact, question?: string): string {
  const ways: string[] = []
  if (contact.email) ways.push(`email **${contact.email}**`)
  if (contact.phone) ways.push(`call **${contact.phone}**`)
  if (contact.url && !ways.length) ways.push('use the help page')
  const how = ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}` : ways[0]
  const lead = `You can reach **${contact.name}**: ${how}.${contact.hours ? ` They answer ${contact.hours}.` : ''}`
  return contact.email && question ? `${lead}\n\nThe email button writes your last question in for you (“${clip(question, 80)}”). Nothing is sent until you send it.` : lead
}

/** One line added to an answer when he has been stuck twice in a row. */
export function stuckLine (contact: Contact): string { return `I am not getting this one. **${contact.name}** can help${contact.hours ? ` (${contact.hours})` : ''}.` }

// ------------------------------------------------------------ what he could not answer

export interface Miss { q: string, at: number, n: number }
const MISS_MAX = 40

export function readMisses (raw: string | null | undefined): Miss[] {
  try {
    const list = JSON.parse(raw || '[]')
    if (!Array.isArray(list)) return []
    return list.filter(m => m && typeof m.q === 'string' && m.q.trim()).map(m => ({ q: clip(m.q, 160), at: Number(m.at) || 0, n: Math.max(1, Math.min(999, Math.floor(Number(m.n) || 1))) })).slice(0, MISS_MAX)
  } catch (e) { return [] }
}

/** Is this worth keeping as a missed question? A few words, not a chip, not something private. */
export function worthKeeping (q: string): boolean {
  const t = String(q || '').trim()
  if (t.length < 6 || t.length > 160 || /^__/.test(t) || t.split(/\s+/).length < 2) return false
  // Numbers that look like a card, a Social Security number, a phone or an email stay out.
  if (/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/.test(t) || /(?:\d[ -]?){13,19}/.test(t) || /@[a-z0-9-]+\.[a-z]{2,}/i.test(t) || /\b\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/.test(t)) return false
  return true
}

/** The list with one more miss: the same question again counts up and moves to the front. */
export function addMiss (list: Miss[], q: string, now = Date.now()): Miss[] {
  if (!worthKeeping(q)) return list
  const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const k = key(q)
  const old = list.find(m => key(m.q) === k)
  const rest = list.filter(m => m !== old)
  return [{ q: clip(q, 160), at: now, n: (old?.n || 0) + 1 }, ...rest].slice(0, MISS_MAX)
}

/** The missed questions as plain text, for an email or a file. */
export function missesText (list: Miss[]): string {
  return list.map(m => `${new Date(m.at).toISOString().slice(0, 10)}  ${m.n > 1 ? `(x${m.n}) ` : ''}${m.q}`).join('\n')
}

/**
 * The missed questions as a CSV for a spreadsheet: date, times asked, question. Cells that start
 * like a formula are made harmless.
 */
export function missesCsv (list: Miss[]): string {
  const cell = (v: string): string => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return ['Last asked,Times asked,Question', ...list.map(m => [new Date(m.at).toISOString().slice(0, 10), String(m.n), cell(m.q)].join(','))].join('\r\n') + '\r\n'
}

/** A missed question as it may leave the browser for the usage table: house and other long numbers masked. */
export function maskNumbers (q: string): string {
  return clip(String(q || '').replace(/\d{3,}/g, '#').replace(/\s+/g, ' ').trim(), 120)
}

/** A mailto link that carries the missed questions to the person who runs the app. */
export function missesMail (contact: Contact, list: Miss[], app?: string): string {
  if (!contact.email || !list.length) return ''
  const body = `Questions the map helper could not answer in ${clip(app || 'the map', 80)}:\n\n${missesText(list.slice(0, 20))}`
  return `mailto:${encodeURIComponent(contact.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(`Missed questions: ${clip(app || 'the map', 60)}`)}&body=${encodeURIComponent(body)}`
}

// ------------------------------------------------------------ privacy, in plain words

export interface PrivacyFacts {
  name: string
  /** 'local' | 'mcp' | 'assistant' | 'claude' */
  helper: string
  helperLabel?: string
  serverLabel?: string
  /** What he has for this person right now. */
  knowsName?: string
  chats?: number
  misses?: number
  savedViews?: number
  telemetry?: boolean
  /** The builder also sends questions he could not answer to the usage table. */
  sharesMisses?: boolean
  locator?: boolean
  sharePicture?: boolean
  feed?: boolean
  /** More things kept in the browser (stamps, the usual, a birthday), each a few words. */
  extras?: string[]
}

/** What he keeps, where it lives and what leaves the browser, for this app as it is set up. */
export function privacyText (f: PrivacyFacts): string {
  const kept: string[] = ['this conversation (so it is still here when you reload)']
  if (f.knowsName) kept.push(`your first name (“${f.knowsName}”), because you told me`)
  kept.push(`a count of our questions${f.chats ? ` (${f.chats.toLocaleString()} so far)` : ''}`)
  if (f.savedViews) kept.push(`${f.savedViews} saved map view${f.savedViews === 1 ? '' : 's'}`)
  for (const x of f.extras || []) kept.push(x)
  if (f.misses) kept.push(`${f.misses} question${f.misses === 1 ? '' : 's'} I could not answer`)
  const lines = [
    `**Kept in this browser only:** ${kept.join('; ')}. It is not sent anywhere, and “forget everything” erases it.`
  ]
  const leaves: string[] = []
  if (f.locator) leaves.push('an address you ask about goes to the app\'s address search')
  leaves.push('layer questions go to the map\'s own services, under your sign-in')
  if (f.helper === 'mcp' || f.helper === 'claude') leaves.push(`place questions go to ${f.serverLabel || 'the GIS server'}`)
  if (f.helper === 'claude') leaves.push(`a question I cannot answer goes to ${f.helperLabel || 'an AI assistant'} through that server, with a line about where the map is${f.sharePicture ? ' and, for questions about the screen, a small picture of the map' : ''}. A question with a card or Social Security number in it is never sent`)
  if (f.helper === 'assistant') leaves.push(`nothing goes to ${f.helperLabel || 'the AI assistant'} unless you click its link, which opens it with your question written in`)
  lines.push(`**What leaves the browser:** ${leaves.join('; ')}.`)
  lines.push(f.telemetry ? (f.sharesMisses ? '**Usage counts:** the app builder turned on anonymous usage counts (which features are used, and errors), and a question I could not answer is sent along so the people who run this app can teach me. No names; long numbers are masked.' : '**Usage counts:** the app builder turned on anonymous usage counts (which features are used, and errors). No names and no question text.') : '**Usage tracking:** off.')
  lines.push(`I am a program, not a person${f.helper === 'claude' || f.helper === 'assistant' ? '' : ', and I do not use AI'}. I do not sell or share anything.`)
  return lines.join('\n\n')
}
