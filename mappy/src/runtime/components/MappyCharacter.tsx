/*
  MappyCharacter.tsx - the little folded paper map. Pure SVG + CSS animation, no images,
  original art. Eyes follow the pointer (or whatever he is pointing at), he blinks, bobs while
  idle, unfolds when he arrives and folds up when he leaves, and acts out a mood:
  wave, talk, think, search, listen, point, happy, pleased, acknowledge, celebrate,
  confused, sleep, attention.

  It is a real <button> (WCAG 4.1.2): Enter or Space opens the chat, Shift+F10 or the
  context-menu key opens his menu, arrow keys move him (2.5.7, no dragging needed).
*/
import { React } from 'jimu-core'

export type Mood = 'idle' | 'wave' | 'talk' | 'think' | 'search' | 'happy' | 'pleased' | 'acknowledge' | 'celebrate' | 'confused' | 'sleep' | 'attention' | 'listen' | 'point'
export type PointDir = 'left' | 'right' | 'up' | 'down'

interface Props {
  id: string
  mood: Mood
  px: number
  label: string
  expanded: boolean
  controls: string
  describedBy?: string
  still: boolean
  phase: 'enter' | 'shown' | 'exit'
  /** Screen point to look at (overrides the pointer). */
  lookAt?: { x: number, y: number } | null
  pointDir?: PointDir | null
  onActivate?: () => void
  onPointerDown?: (e: any) => void
  onDoubleClick?: () => void
  onKeyDown?: (e: any) => void
  onContextMenu?: (e: any) => void
  buttonRef?: any
}

const BROWS: { [m: string]: [string, string] } = {
  idle: ['M33 33 Q40 30 47 33', 'M53 33 Q60 30 67 33'],
  talk: ['M33 32 Q40 29 47 32', 'M53 32 Q60 29 67 32'],
  wave: ['M33 31 Q40 27 47 31', 'M53 31 Q60 27 67 31'],
  happy: ['M33 31 Q40 27 47 31', 'M53 31 Q60 27 67 31'],
  pleased: ['M33 31 Q40 28 47 31', 'M53 31 Q60 28 67 31'],
  acknowledge: ['M33 32 Q40 30 47 32', 'M53 32 Q60 30 67 32'],
  celebrate: ['M33 29 Q40 25 47 29', 'M53 29 Q60 25 67 29'],
  think: ['M33 34 Q40 32 47 30', 'M53 31 Q60 29 67 33'],
  search: ['M33 33 L47 31', 'M53 31 L67 33'],
  listen: ['M33 31 Q40 29 47 32', 'M53 32 Q60 29 67 31'],
  point: ['M33 31 Q40 28 47 31', 'M53 31 Q60 28 67 31'],
  confused: ['M33 30 Q40 33 47 34', 'M53 31 Q60 27 67 31'],
  sleep: ['M33 36 Q40 35 47 36', 'M53 36 Q60 35 67 36'],
  attention: ['M33 28 Q40 24 47 28', 'M53 28 Q60 24 67 28']
}

const MOUTH: { [m: string]: string } = {
  idle: 'M43 63 Q50 68 57 63',
  talk: 'M44 62 Q50 70 56 62 Q50 66 44 62',
  wave: 'M42 62 Q50 70 58 62',
  happy: 'M41 61 Q50 72 59 61',
  pleased: 'M42 62 Q50 70 58 62',
  acknowledge: 'M44 63 Q50 67 56 63',
  celebrate: 'M41 60 Q50 74 59 60 Z',
  think: 'M45 65 Q50 64 56 63',
  search: 'M46 64 Q50 65 54 64',
  listen: 'M46 63 Q50 66 54 63',
  point: 'M43 62 Q50 69 57 62',
  confused: 'M44 65 Q47 62 50 65 Q53 68 56 64',
  sleep: 'M46 64 Q50 66 54 64',
  attention: 'M46 61 Q50 69 54 61 Q50 65 46 61'
}

/** Arm angle per direction, from the side of the map that faces it. */
const ARM: { [d: string]: { x: number, y: number, rot: number } } = {
  right: { x: 88, y: 56, rot: 0 },
  left: { x: 12, y: 56, rot: 180 },
  up: { x: 76, y: 16, rot: -70 },
  down: { x: 80, y: 90, rot: 60 }
}

export default function MappyCharacter (props: Props): any {
  const { mood, px, still } = props
  const ref = React.useRef<any>(null)
  const [look, setLook] = React.useState<[number, number]>([0, 0])
  const [skit, setSkit] = React.useState('')
  const skitIndex = React.useRef(0)
  React.useEffect(() => {
    setSkit('')
    if (still || mood !== 'idle' || props.expanded || props.phase !== 'shown') return
    let next: any
    let finish: any
    const perform = () => {
      if ((ref.current?.ownerDocument || document).hidden) { next = setTimeout(perform, 20000); return }
      const acts = ['peek', 'stretch', 'refold', 'compass']
      setSkit(acts[skitIndex.current++ % acts.length])
      finish = setTimeout(() => setSkit(''), 3600)
      next = setTimeout(perform, 24000)
    }
    next = setTimeout(perform, 12000)
    return () => { clearTimeout(next); clearTimeout(finish) }
  }, [still, mood, props.expanded, props.phase])

  const aim = (tx: number, ty: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = tx - (r.left + r.width / 2)
    const dy = ty - (r.top + r.height * 0.4)
    const d = Math.max(1, Math.hypot(dx, dy))
    const k = Math.min(1, d / 220)
    setLook([(dx / d) * 3.2 * k, (dy / d) * 3.2 * k])
  }

  React.useEffect(() => {
    if (still) { setLook([0, 0]); return }
    if (props.lookAt) { aim(props.lookAt.x, props.lookAt.y); return }
    const ownerWindow = ref.current?.ownerDocument.defaultView || window
    let raf = 0
    const onMove = (e: any) => {
      if (raf) return
      raf = ownerWindow.requestAnimationFrame(() => { raf = 0; aim(e.clientX, e.clientY) })
    }
    ownerWindow.addEventListener('pointermove', onMove, { passive: true })
    return () => { ownerWindow.removeEventListener('pointermove', onMove); if (raf) ownerWindow.cancelAnimationFrame(raf) }
  }, [props.lookAt?.x, props.lookAt?.y, still])

  let [lx, ly] = look
  if (mood === 'think') { lx = 2.4; ly = -2.6 }
  if (mood === 'sleep') { lx = 0; ly = 0 }
  if (mood === 'listen') { lx = -1.5; ly = 2.4 }
  const eyesClosed = mood === 'sleep'
  const brows = BROWS[mood] || BROWS.idle
  const mouth = MOUTH[mood] || MOUTH.idle
  const arm = props.pointDir ? ARM[props.pointDir] : null

  const setRefs = (el: any) => {
    ref.current = el
    if (typeof props.buttonRef === 'function') props.buttonRef(el)
    else if (props.buttonRef) props.buttonRef.current = el
  }

  const cls = ['mappy-char', `mappy-mood-${mood}`]
  if (props.phase === 'enter') cls.push('mappy-enter')
  if (props.phase === 'exit') cls.push('mappy-exit')
  if (still) cls.push('mappy-still')
  if (skit && mood === 'idle' && !props.expanded) cls.push(`mappy-skit-${skit}`)

  return (
    <button
      type='button'
      id={props.id}
      ref={setRefs}
      className={cls.join(' ')}
      style={{ width: px, height: px * 1.1, ['--mappy-lunge' as any]: props.pointDir === 'left' ? '-6px' : '6px' }}
      aria-label={props.label}
      aria-expanded={props.expanded}
      aria-controls={props.expanded ? props.controls : undefined}
      aria-haspopup='dialog'
      aria-describedby={props.describedBy}
      onClick={() => props.onActivate?.()}
      onKeyDown={props.onKeyDown}
      onPointerDown={props.onPointerDown}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      <svg viewBox='0 0 100 110' width='100%' height='100%' aria-hidden='true' focusable='false'>
        <ellipse className='mappy-shadow' cx='50' cy='104' rx='28' ry='4' />
        <g className='mappy-body'>
          {arm && (
            <g className='mappy-arm' transform={`translate(${arm.x} ${arm.y}) rotate(${arm.rot})`}>
              <path d='M0 -4 L16 -5 L16 5 L0 4 Z' fill='#f1e3bd' stroke='#7a5c2e' strokeWidth='1.4' strokeLinejoin='round' />
              <path d='M16 -5 L24 0 L16 5 Z' fill='#e0533f' stroke='#8f2a1d' strokeWidth='1.2' strokeLinejoin='round' />
              <line x1='6' y1='-4.5' x2='6' y2='4.5' stroke='#c9b27f' strokeWidth='0.8' />
            </g>
          )}
          <polygon points='12,18 38,13 38,92 12,96' fill='#f1e3bd' stroke='#7a5c2e' strokeWidth='1.6' strokeLinejoin='round' />
          <polygon points='38,13 62,18 62,96 38,92' fill='#fbf2d8' stroke='#7a5c2e' strokeWidth='1.6' strokeLinejoin='round' />
          <polygon points='62,18 88,13 88,92 62,96' fill='#eddcb2' stroke='#7a5c2e' strokeWidth='1.6' strokeLinejoin='round' />
          <g stroke='#c9b27f' strokeWidth='0.6' opacity='0.6'>
            <line x1='12' y1='40' x2='88' y2='38' />
            <line x1='12' y1='72' x2='88' y2='70' />
            <line x1='25' y1='16' x2='25' y2='94' />
            <line x1='75' y1='16' x2='75' y2='94' />
          </g>
          <ellipse cx='74' cy='82' rx='8' ry='5.5' fill='#93c47d' opacity='0.9' />
          <path d='M12 76 C26 66 40 86 56 74 S78 62 88 66' fill='none' stroke='#5fa8e0' strokeWidth='4' strokeLinecap='round' opacity='0.85' />
          <path d='M18 88 L30 80 L44 86 L54 78' fill='none' stroke='#d9534f' strokeWidth='2' strokeDasharray='3 3' strokeLinecap='round' />
          <g>
            <path d='M24 20 C18 20 15 25 18 30 L24 38 L30 30 C33 25 30 20 24 20 Z' fill='#e0533f' stroke='#8f2a1d' strokeWidth='1' />
            <circle cx='24' cy='26.5' r='2.6' fill='#fff' />
          </g>
          {!arm && <polygon className='mappy-hand' points='88,13 97,8 93,24 88,22' fill='#fbf2d8' stroke='#7a5c2e' strokeWidth='1.4' strokeLinejoin='round' />}
          <circle cx='31' cy='58' r='4' fill='#f4a6a0' opacity='0.55' />
          <circle cx='69' cy='58' r='4' fill='#f4a6a0' opacity='0.55' />
          <g className={eyesClosed ? '' : 'mappy-eyes'}>
            {eyesClosed
              ? <g stroke='#2c2216' strokeWidth='2' fill='none' strokeLinecap='round'>
                  <path d='M33 46 Q40 50 47 46' />
                  <path d='M53 46 Q60 50 67 46' />
                </g>
              : <g>
                  <ellipse cx='40' cy='45' rx='8' ry='9.5' fill='#fff' stroke='#2c2216' strokeWidth='1.6' />
                  <ellipse cx='60' cy='45' rx='8' ry='9.5' fill='#fff' stroke='#2c2216' strokeWidth='1.6' />
                  <g transform={`translate(${lx.toFixed(2)} ${ly.toFixed(2)})`}>
                    <circle cx='40' cy='46' r='3.8' fill='#1d1d1d' />
                    <circle cx='60' cy='46' r='3.8' fill='#1d1d1d' />
                    <circle cx='41.3' cy='44.6' r='1.2' fill='#fff' />
                    <circle cx='61.3' cy='44.6' r='1.2' fill='#fff' />
                  </g>
                </g>}
          </g>
          <g stroke='#2c2216' strokeWidth='2.2' fill='none' strokeLinecap='round'>
            <path d={brows[0]} />
            <path d={brows[1]} />
          </g>
          <path className='mappy-mouth' d={mouth} fill={mood === 'celebrate' ? '#7a2b22' : 'none'} stroke='#2c2216' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
        </g>
        {skit === 'compass' && mood === 'idle' && <g className='mappy-compass'>
          <circle cx='85' cy='78' r='11' fill='#fbf2d8' stroke='#7a5c2e' strokeWidth='2' />
          <g className='mappy-needle'><path d='M85 68 L88 78 L85 88 L82 78 Z' fill='#e0533f' /><path d='M85 78 L85 88 L82 78 Z' fill='#5fa8e0' /></g>
          <circle cx='85' cy='78' r='2' fill='#7a5c2e' />
        </g>}
        {mood === 'think' && <g className='mappy-dots' fill='#7a5c2e'><circle cx='80' cy='6' r='2' /><circle cx='87' cy='4' r='2' /><circle cx='94' cy='6' r='2' /></g>}
        {mood === 'confused' && <text x='86' y='12' fontSize='14' fontWeight='700' fill='#7a5c2e' fontFamily='sans-serif'>?</text>}
        {mood === 'sleep' && <text className='mappy-zzz' x='74' y='12' fontSize='10' fontWeight='700' fill='#7a5c2e' fontFamily='sans-serif'>z z Z</text>}
        {mood === 'celebrate' && <g className='mappy-sparkle' fill='#f2b632'>
          <path d='M6 10 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z' />
          <path d='M92 30 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 z' />
        </g>}
        {mood === 'search' && <g className='mappy-glass' stroke='#2c2216' strokeWidth='2.4' fill='rgba(180,220,255,.35)'>
          <circle cx='84' cy='58' r='8' />
          <line x1='90' y1='64' x2='97' y2='72' strokeLinecap='round' />
        </g>}
        {mood === 'listen' && <g fill='none' stroke='#7a5c2e' strokeWidth='1.6' strokeLinecap='round'>
          <path d='M4 44 Q0 50 4 56' /><path d='M8 46 Q5 50 8 54' />
        </g>}
      </svg>
    </button>
  )
}
