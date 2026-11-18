/*
  speech.ts - what he says out loud and in which voice. Pure: turns an answer into words a voice
  can read (no markup, no web addresses, units spelled out), cuts it into sentence-sized pieces,
  and ranks the voices a browser offers so a natural one is picked over the robotic default.
  The talking itself is in runtime/speech.ts.
*/

export interface VoiceInfo { name: string, lang: string, localService?: boolean, default?: boolean }

/** How he reads an answer aloud, from settings. */
export interface VoiceSettings {
  /** A browser voice to prefer when the person's browser has it. */
  name?: string
  /** Speed: 1 is normal. */
  rate?: number
  /**
   * Let him use the browser's online voices (Edge's "Online (Natural)", Chrome's Google voices). They sound
   * better, but the browser sends the words to its maker to be spoken. Off unless the builder turns it on.
   */
  online?: boolean
}

/** An answer as words to say: the answer itself, without markup, links, emoji or his asides. */
export function sayable (text: string): string {
  let t = String(text || '')
  // Asides are for the eye: stamps, hearts, how a typo was read.
  t = t.split(/\n{2,}/).filter(p => !/^(?:New stamps? in your passport|[♥♡]+ |\(I read that as)/.test(p.trim())).join('\n\n')
  t = t.replace(/^Reading that aloud: /, '')
  t = t.replace(/https?:\/\/\S+/g, ' link ').replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' an email address ')
  t = t.replace(/\*\*|__|`/g, '').replace(/^[#>\-•]\s*/gm, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  t = t.replace(/[\u{1F000}-\u{1FAFF}☀-➿️‍]/gu, ' ')
  // Units and signs a voice would stumble on.
  t = t.replace(/(\d)\s?%/g, '$1 percent').replace(/\s&\s/g, ' and ').replace(/·/g, ', ').replace(/\s[–—]\s/g, ', ')
  t = t.replace(/(\d)\s?sq\.? ?ft\b/gi, '$1 square feet').replace(/(\d)\s?ft\b/gi, '$1 feet').replace(/(\d)\s?mi\b/gi, '$1 miles').replace(/(\d)\s?ac\b/gi, '$1 acres').replace(/\b1:(\d[\d,]*)/g, '1 to $1')
  t = t.replace(/\((?:lat, long|latitude, longitude)\)/gi, '').replace(/\s*\n+\s*/g, '. ').replace(/\.\s*\./g, '.').replace(/:\s*\./g, '.')
  return t.replace(/\s+/g, ' ').replace(/\s([.,!?;:])/g, '$1').trim()
}

/** The words cut into pieces of about `max` letters, at sentence ends where there are any. */
export function sentences (text: string, max = 240): string[] {
  const said = String(text || '').trim()
  if (!said) return []
  const parts = said.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [said]
  const out: string[] = []
  let cur = ''
  const push = (): void => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const raw of parts) {
    let p = raw.trim()
    if (!p) continue
    // A very long sentence is cut at commas, then at spaces.
    while (p.length > max) {
      const cut = Math.max(p.lastIndexOf(', ', max), p.lastIndexOf('; ', max))
      const at = cut > max * 0.4 ? cut + 1 : p.lastIndexOf(' ', max) > 0 ? p.lastIndexOf(' ', max) : max
      push(); out.push(p.slice(0, at).trim()); p = p.slice(at).trim()
    }
    if (cur && (cur + ' ' + p).length > max) push()
    cur = cur ? `${cur} ${p}` : p
  }
  push()
  return out
}

/** How natural a browser voice is likely to sound for this language. Higher is better. */
export function voiceScore (v: VoiceInfo, lang: string, wanted?: string): number {
  const name = String(v.name || '')
  const want = String(lang || 'en-US').toLowerCase()
  const has = String(v.lang || '').toLowerCase().replace('_', '-')
  let score = 0
  if (wanted && name.toLowerCase() === wanted.toLowerCase()) score += 1000
  if (has === want) score += 30; else if (has.split('-')[0] === want.split('-')[0]) score += 15; else score -= 200
  // Neural voices: Edge's "Online (Natural)", Chrome's Google voices, Apple's premium and enhanced ones.
  if (/natural|neural/i.test(name)) score += 100
  if (/\b(?:premium|enhanced|siri)\b/i.test(name)) score += 60
  if (/^google\b/i.test(name)) score += 40
  if (/multilingual/i.test(name)) score -= 5
  if (/\b(?:aria|jenny|ava|emma|andrew|brian|guy|samantha|allison|susan|karen|daniel)\b/i.test(name)) score += 8
  if (/espeak|compact|eloquence|novelty|whisper|bells|bad news|organ|trinoids|zarvox|albert|bahh|boing|bubbles|cellos|jester|junior|ralph|fred\b|superstar|wobble|grandma|grandpa|rocko|shelley|sandy|reed|flo\b|eddy/i.test(name)) score -= 80
  if (v.default) score += 1
  return score
}

/**
 * The most natural voice on offer for the language, or null when there are none. Voices the
 * browser speaks through its maker's service (localService false) are left out unless `online`
 * is allowed, so answers are not sent anywhere the builder did not choose.
 */
export function pickVoice<T extends VoiceInfo> (voices: T[], lang = 'en-US', wanted?: string, online = false): T | null {
  const all = voices || []
  const pool = online ? all : all.filter(v => v.localService !== false)
  let best: T | null = null; let top = -Infinity
  for (const v of pool) { const s = voiceScore(v, lang, wanted); if (s > top) { top = s; best = v } }
  return top > -100 ? best : pool[0] || null
}
