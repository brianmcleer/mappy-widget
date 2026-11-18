/*
  speech.ts (runtime) - reads answers aloud. Two voices, one behaviour: the open-source voice on
  the GIS server when the builder chose it (a sentence goes up, a WAV comes back and plays; the
  next sentence is fetched while this one plays), and the browser's own voice otherwise, picked
  for how natural it sounds. If the server voice fails, the browser's takes over for a while, so
  read-aloud never goes silent.
*/
import { sayable, sentences, pickVoice, speakUrl } from '../brain/speech'
import type { VoiceSettings } from '../brain/speech'

export interface SpeakerOptions {
  voice?: VoiceSettings | null
  /** The MCP server address from settings; the voice endpoint sits beside it. */
  mcpUrl?: string
  /** Sign-in headers for the server, the same ones the MCP calls use. */
  headers?: () => Promise<{ [k: string]: string }>
  lang?: string
}

const synth = (): any => { try { return (window as any).speechSynthesis || null } catch (e) { return null } }

export class Speaker {
  private run = 0
  private audio: HTMLAudioElement | null = null
  private abort: AbortController | null = null
  private urls: string[] = []
  /** The server voice failed: use the browser's until this time. */
  private serverDownUntil = 0

  constructor (private readonly opts: () => SpeakerOptions) {}

  /** Can anything be read aloud here at all? */
  available (): boolean { return !!synth() || this.serverUrl() !== '' }

  private serverUrl (): string {
    const o = this.opts()
    return o.voice?.source === 'server' ? speakUrl(o.mcpUrl) : ''
  }

  stop (): void {
    this.run++
    try { this.abort?.abort() } catch (e) { }
    this.abort = null
    try { if (this.audio) { this.audio.pause(); this.audio.src = '' } } catch (e) { }
    this.audio = null
    for (const u of this.urls) { try { URL.revokeObjectURL(u) } catch (e) { } }
    this.urls = []
    try { synth()?.cancel() } catch (e) { }
  }

  /** Reads an answer aloud, replacing whatever was being read. */
  async speak (text: string): Promise<void> {
    this.stop()
    const said = sayable(text)
    if (!said) return
    const run = this.run
    const url = this.serverUrl()
    if (url && Date.now() > this.serverDownUntil) {
      // About a sentence at a time, so the first words come back quickly and the rest is made while they play.
      const parts = sentences(said, 150)
      const done = await this.fromServer(url, parts, run)
      if (done >= parts.length || run !== this.run) return
      // The server could not say it (or the rest of it): the browser's voice finishes.
      this.serverDownUntil = Date.now() + 5 * 60000
      this.fromBrowser(parts.slice(done).join(' '), run)
      return
    }
    this.fromBrowser(said, run)
  }

  /** Plays the pieces from the server one after another. Returns how many were said. */
  private async fromServer (url: string, parts: string[], run: number): Promise<number> {
    const o = this.opts()
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    this.abort = ctrl
    const fetchOne = async (piece: string): Promise<string | null> => {
      try {
        const headers: { [k: string]: string } = { 'content-type': 'application/json', accept: 'audio/wav' }
        try { const more = o.headers ? await o.headers() : {}; for (const k of Object.keys(more)) if (/^authorization$/i.test(k) || /^x-/i.test(k)) headers[k] = more[k] } catch (e) { }
        const timer = setTimeout(() => { try { ctrl?.abort() } catch (e) { } }, 30000)
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ text: piece, voice: o.voice?.serverVoice || undefined, speed: o.voice?.rate || undefined }), signal: ctrl?.signal, credentials: 'omit' })
        clearTimeout(timer)
        if (!res.ok || !/audio\//i.test(res.headers.get('content-type') || '')) return null
        const blob = await res.blob()
        if (!blob.size) return null
        const obj = URL.createObjectURL(blob)
        this.urls.push(obj)
        return obj
      } catch (e) { return null }
    }
    let next: Promise<string | null> = fetchOne(parts[0])
    for (let i = 0; i < parts.length; i++) {
      const src = await next
      if (run !== this.run) return parts.length
      if (!src) return i
      // The next sentence is made while this one plays.
      if (i + 1 < parts.length) next = fetchOne(parts[i + 1])
      const ok = await this.play(src, run)
      if (run !== this.run) return parts.length
      if (!ok) return i
    }
    return parts.length
  }

  private play (src: string, run: number): Promise<boolean> {
    return new Promise(resolve => {
      try {
        const a = new Audio(src)
        this.audio = a
        a.onended = () => resolve(true)
        a.onerror = () => resolve(false)
        a.onpause = () => { if (run !== this.run) resolve(true) }
        const p = a.play()
        if (p && typeof p.catch === 'function') p.catch(() => resolve(false))
      } catch (e) { resolve(false) }
    })
  }

  private fromBrowser (said: string, run: number): void {
    const s = synth()
    if (!s || run !== this.run) return
    try {
      const o = this.opts()
      const lang = o.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US'
      const voice = pickVoice(Array.from(s.getVoices() || []) as any[], lang, o.voice?.name, o.voice?.online === true)
      // Short utterances: some browsers cut off a long one part way through.
      for (const piece of sentences(said, 200)) {
        const u = new (window as any).SpeechSynthesisUtterance(piece)
        if (voice) { u.voice = voice; u.lang = (voice as any).lang }
        u.rate = Math.max(0.6, Math.min(1.6, Number(o.voice?.rate) || 1))
        s.speak(u)
      }
    } catch (e) { }
  }
}

/** The voices this browser has, once they are loaded (they arrive late in some browsers). */
export function browserVoices (): Promise<Array<{ name: string, lang: string, localService?: boolean, default?: boolean }>> {
  return new Promise(resolve => {
    const s = synth()
    if (!s) { resolve([]); return }
    const now = Array.from(s.getVoices() || []) as any[]
    if (now.length) { resolve(now); return }
    let done = false
    const finish = (): void => { if (done) return; done = true; resolve(Array.from(s.getVoices() || []) as any[]) }
    try { s.addEventListener('voiceschanged', finish, { once: true }) } catch (e) { }
    setTimeout(finish, 1200)
  })
}
