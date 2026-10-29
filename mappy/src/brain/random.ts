/*
  random.ts - one random number source for jokes, idle timing and coin flips. Nothing here is a
  secret or a key; Web Crypto is used when the browser has it so code scanners do not mistake a
  joke picker for a credential generator, and a small xorshift seeded from the clock stands in
  when it does not (very old browsers, Node tests).
*/

let seed = (Date.now() ^ 0x9e3779b9) >>> 0 || 1

function xorshift (): number {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >>> 17
  seed ^= seed << 5; seed >>>= 0
  return seed / 4294967296
}

/** A number in [0, 1), like Math.random. */
export function rand (): number {
  try {
    const c: any = (globalThis as any).crypto
    if (c && typeof c.getRandomValues === 'function') {
      const a = new Uint32Array(1)
      c.getRandomValues(a)
      return a[0] / 4294967296
    }
  } catch (e) { }
  return xorshift()
}

/** One of the items. */
export function pick<T> (arr: T[]): T { return arr[Math.floor(rand() * arr.length)] }

/** A shuffled copy. */
export function shuffle<T> (arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t }
  return a
}
