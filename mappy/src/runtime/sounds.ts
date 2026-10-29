/*
  sounds.ts - the little noises that made the old Office Assistant feel present: a pop when
  he arrives, a whoosh when he folds away, a knock when he wants attention, a ta-da for good
  news, a wobble for an alert, a boing for a boop. Synthesized on the spot with WebAudio,
  so there are no files to load. Off unless the app's settings turn them on, quiet, and
  never before the person has interacted with the page (browsers block sound until then).
*/

import { rand } from '../brain/random'

export type SoundName = 'pop' | 'whoosh' | 'knock' | 'tada' | 'alert' | 'boing' | 'tick' | 'ding'

let ctx: AudioContext | null = null
let lastAt = 0

function audio (): AudioContext | null {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx!.state === 'suspended') { ctx!.resume().catch(() => {}) }
    return ctx
  } catch (e) { return null }
}

/** One note: frequency sweep from f0 to f1 over `dur` seconds, with a soft envelope. */
function tone (ac: AudioContext, f0: number, f1: number, dur: number, type: OscillatorType, gain = 0.08, at = 0): void {
  const o = ac.createOscillator(); const g = ac.createGain()
  o.type = type
  const t = ac.currentTime + at
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(ac.destination)
  o.start(t); o.stop(t + dur + 0.02)
}

/** A short burst of noise (the knock, the whoosh). */
function noise (ac: AudioContext, dur: number, gain: number, at = 0, lowpass = 1200): void {
  const n = Math.floor(ac.sampleRate * dur)
  const buf = ac.createBuffer(1, n, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (rand() * 2 - 1) * (1 - i / n)
  const src = ac.createBufferSource(); src.buffer = buf
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass
  const g = ac.createGain(); g.gain.value = gain
  src.connect(f); f.connect(g); g.connect(ac.destination)
  src.start(ac.currentTime + at)
}

/** Plays one of his sounds. Quiet, short, and never more than a few a second. */
export function play (name: SoundName): void {
  const now = Date.now()
  if (now - lastAt < 120) return
  lastAt = now
  const ac = audio()
  if (!ac) return
  try {
    switch (name) {
      case 'pop': tone(ac, 300, 900, 0.12, 'sine', 0.09); break
      case 'whoosh': noise(ac, 0.35, 0.05, 0, 900); tone(ac, 700, 150, 0.3, 'sine', 0.03); break
      case 'knock': noise(ac, 0.06, 0.12, 0, 600); noise(ac, 0.06, 0.12, 0.18, 600); break
      case 'tada': tone(ac, 523, 523, 0.12, 'triangle', 0.07); tone(ac, 659, 659, 0.12, 'triangle', 0.07, 0.12); tone(ac, 784, 784, 0.3, 'triangle', 0.08, 0.24); break
      case 'alert': tone(ac, 440, 330, 0.18, 'square', 0.035); tone(ac, 440, 330, 0.18, 'square', 0.035, 0.22); break
      case 'boing': tone(ac, 180, 520, 0.22, 'sine', 0.08); break
      case 'tick': tone(ac, 1200, 900, 0.03, 'square', 0.02); break
      case 'ding': tone(ac, 880, 1760, 0.25, 'sine', 0.06); break
    }
  } catch (e) { }
}

/** The sound that goes with a mood change, if any. */
export function soundFor (mood: string): SoundName | null {
  switch (mood) {
    case 'wave': return 'pop'
    case 'knock': case 'attention': return 'knock'
    case 'celebrate': case 'congratulate': case 'party': return 'tada'
    case 'alert': return 'alert'
    case 'dizzy': case 'roll': return 'boing'
    case 'pleased': case 'checking': return 'ding'
    case 'processing': return 'tick'
    default: return null
  }
}
