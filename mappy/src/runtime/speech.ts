/*
  speech.ts (runtime) - reads answers aloud with the browser's own voice, picked for how natural
  it sounds (brain/speech.ts). The answer is cleaned for speech and spoken a sentence at a time,
  so long answers are not cut off part way.
*/
import { sayable, sentences, pickVoice } from '../brain/speech'
import type { VoiceSettings } from '../brain/speech'

export interface SpeakerOptions {
  voice?: VoiceSettings | null
  lang?: string
}

const synth = (): any => { try { return (window as any).speechSynthesis || null } catch (e) { return null } }

export class Speaker {
  constructor (private readonly opts: () => SpeakerOptions) {}

  /** Can anything be read aloud here at all? */
  available (): boolean { return !!synth() }

  stop (): void {
    try { synth()?.cancel() } catch (e) { }
  }

  /** Reads an answer aloud, replacing whatever was being read. */
  async speak (text: string): Promise<void> {
    this.stop()
    const said = sayable(text)
    const s = synth()
    if (!said || !s) return
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
