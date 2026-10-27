/*
  placement.ts - keeps Mappy and his speech bubble inside the browser tab.

  The bubble tries, in order: above him, below him, beside him (the roomier side), then
  whichever of above or below has more room, with its height capped to the space and the
  rest scrolling inside. Horizontally it lines up with him and is clamped to the tab with a
  margin; the tail always points at his middle. Pure math, no DOM, so it is easy to test.
*/

export type TailSide = 'down' | 'up' | 'left' | 'right'

export interface Rect { left: number, top: number, right: number, bottom: number, width: number, height: number }

export interface Placement {
  left: number
  top: number
  /** Set when the bubble sits above Mappy: it is anchored by its bottom edge so it grows upward. */
  bottom?: number
  width: number
  maxHeight: number
  tail: TailSide
  /** Tail position along the bubble edge (px from the left for up/down, from the top for left/right). */
  tailOffset: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, hi < lo ? lo : v))

export function placeBubble (anchor: Rect, naturalHeight: number, vw: number, vh: number, opts: { gap?: number, margin?: number, maxWidth?: number, maxHeight?: number, preferLeftAligned?: boolean } = {}): Placement {
  const gap = opts.gap ?? 12
  const m = opts.margin ?? 8
  const width = Math.max(200, Math.min(opts.maxWidth ?? 360, vw - 2 * m))
  const h = Math.max(120, naturalHeight)
  const cx = anchor.left + anchor.width / 2
  const cy = anchor.top + anchor.height / 2
  const above = anchor.top - gap - m
  const below = vh - anchor.bottom - gap - m
  const leftSpace = anchor.left - gap - m
  const rightSpace = vw - anchor.right - gap - m
  const want = Math.min(h, 300)
  const cap = opts.maxHeight ?? 540

  const horizontal = (): { left: number, tailOffset: number } => {
    // Line the bubble's near edge up with Mappy, then keep it inside the tab.
    const alignLeft = opts.preferLeftAligned ?? (cx < vw / 2)
    let left = alignLeft ? anchor.left - 8 : anchor.right - width + 8
    left = clamp(left, m, vw - width - m)
    return { left, tailOffset: clamp(cx - left - 8, 14, width - 30) }
  }

  if (above >= want || (above >= 160 && above >= below)) {
    const maxHeight = Math.min(cap, Math.max(120, above))
    const height = Math.min(h, maxHeight)
    const { left, tailOffset } = horizontal()
    return { left, top: Math.max(m, anchor.top - gap - height), bottom: vh - (anchor.top - gap), width, maxHeight, tail: 'down', tailOffset }
  }
  if (below >= want) {
    const maxHeight = Math.min(cap, Math.max(120, below))
    const { left, tailOffset } = horizontal()
    return { left, top: anchor.bottom + gap, width, maxHeight, tail: 'up', tailOffset }
  }
  const side = Math.max(leftSpace, rightSpace)
  if (side >= 220) {
    const w = Math.min(width, side)
    const maxHeight = Math.min(cap, vh - 2 * m)
    const height = Math.min(h, maxHeight)
    const top = clamp(cy - height / 2, m, vh - height - m)
    const onLeft = leftSpace >= rightSpace
    return {
      left: onLeft ? anchor.left - gap - w : anchor.right + gap,
      top,
      width: w,
      maxHeight,
      tail: onLeft ? 'right' : 'left',
      tailOffset: clamp(cy - top - 8, 14, height - 30)
    }
  }
  // Very small tab: use the larger of above and below, overlapping Mappy if it must.
  const useAbove = above >= below
  const room = Math.min(cap, Math.max(120, useAbove ? anchor.top - m : vh - anchor.top - m))
  const height = Math.min(h, room)
  const { left, tailOffset } = horizontal()
  return { left, top: useAbove ? Math.max(m, anchor.top - height) : clamp(anchor.bottom, m, vh - height - m), width, maxHeight: room, tail: useAbove ? 'down' : 'up', tailOffset }
}

/** Keeps the character fully in the tab. Position is measured from the chosen corner's edges. */
export function clampCharacter (pos: { x: number, y: number }, size: number, vw: number, vh: number, margin = 8): { x: number, y: number } {
  const h = size * 1.1
  return {
    x: clamp(pos.x, margin, vw - size - margin),
    y: clamp(pos.y, margin, vh - h - margin)
  }
}

export function viewport (): { w: number, h: number } {
  try {
    const vv: any = (window as any).visualViewport
    if (vv && vv.width && vv.height) return { w: Math.round(vv.width), h: Math.round(vv.height) }
  } catch (e) { }
  return { w: window.innerWidth || document.documentElement.clientWidth, h: window.innerHeight || document.documentElement.clientHeight }
}
