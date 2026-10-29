/*
  MappyCharacter.tsx - the little folded paper map. Pure SVG + CSS animation, no images,
  original art. Eyes follow the pointer (or whatever he is pointing at), he blinks, bobs while
  idle, unfolds when he arrives and folds up when he leaves, and acts out a mood:
  wave, talk, think, search, listen, point, happy, pleased, acknowledge, celebrate,
  confused, sleep, attention, love (hearts), excited (happy dance).
  Like a friend he reacts to you: he leans toward the pointer, blushes and waves when you
  hover over him, squishes and pops a heart when you boop him, swings when you carry him,
  and fills quiet moments with little skits (peek, stretch, refold, compass, dance, wink,
  paper heart). Every bit of motion stops under reduced motion or "Pause animation".

  It is a real <button> (WCAG 4.1.2): Enter or Space opens the chat, Shift+F10 or the
  context-menu key opens his menu, arrow keys move him (2.5.7, no dragging needed).
*/
import { React } from 'jimu-core'
import { seasonalHat } from '../../brain/fun'
import { rand } from '../../brain/random'
import { Costume, HEART } from './Costumes'
import { Act, ACT_MOODS, IDLE_ACTS } from './Acts'

export type Mood = 'idle' | 'wave' | 'talk' | 'think' | 'search' | 'happy' | 'pleased' | 'acknowledge' | 'celebrate' | 'confused' | 'sleep' | 'attention' | 'listen' | 'point' | 'love' | 'excited' | 'dance' | 'roll' | 'dizzy' | 'party'
  | typeof ACT_MOODS[number]

/** The face an act borrows: a trophy raise smiles like a celebration, an alert looks alert. */
const ACT_FACE: { [m: string]: string } = { congratulate: 'celebrate', alert: 'attention', goodbye: 'wave', processing: 'think', checking: 'idle', explain: 'talk', knock: 'attention', print: 'pleased', trash: 'excited', mail: 'pleased', save: 'pleased', artsy: 'happy', techy: 'idle', wizardy: 'excited', airplane: 'excited', bike: 'happy', writing: 'idle' }
export type PointDir = 'left' | 'right' | 'up' | 'down'

interface Props {
  id: string
  mood: Mood
  /** Force one idle act (previews and tests); normally he picks his own. */
  skit?: string
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
  /** Override the time-of-year hat (null for none); the date picks it otherwise. */
  hat?: string | null
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
  attention: ['M33 28 Q40 24 47 28', 'M53 28 Q60 24 67 28'],
  love: ['M33 31 Q40 27 47 31', 'M53 31 Q60 27 67 31'],
  excited: ['M33 28 Q40 23 47 28', 'M53 28 Q60 23 67 28'],
  dance: ['M33 30 Q40 26 47 30', 'M53 30 Q60 26 67 30'],
  roll: ['M33 29 Q40 25 47 29', 'M53 29 Q60 25 67 29'],
  dizzy: ['M33 32 Q40 30 47 33', 'M53 33 Q60 30 67 32'],
  party: ['M33 28 Q40 23 47 28', 'M53 28 Q60 23 67 28']
}

/** Confetti: where each piece flies to (x, y offsets in the drawing) and its color. */
const CONFETTI: Array<[number, number, string]> = [[-38, -30, '#e0533f'], [36, -34, '#5fa8e0'], [-26, -44, '#f2b632'], [28, -48, '#93c47d'], [-44, -8, '#5fa8e0'], [44, -12, '#e0533f'], [-12, -50, '#93c47d'], [12, -46, '#f2b632']]


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
  attention: 'M46 61 Q50 69 54 61 Q50 65 46 61',
  love: 'M41 61 Q50 72 59 61',
  excited: 'M41 60 Q50 74 59 60 Z',
  dance: 'M41 61 Q50 72 59 61',
  roll: 'M44 62 Q50 70 56 62 Q50 66 44 62',
  dizzy: 'M43 65 Q46 62 50 65 Q54 68 57 64',
  party: 'M41 60 Q50 74 59 60 Z'
}

/** Arm angle per direction, from the side of the map that faces it. */
const ARM: { [d: string]: { x: number, y: number, rot: number } } = {
  right: { x: 88, y: 56, rot: 0 },
  left: { x: 12, y: 56, rot: 180 },
  up: { x: 76, y: 16, rot: -70 },
  down: { x: 80, y: 90, rot: 60 }
}

/** A skit for the weather his costume says it is: winter shivers, summer fans, spring sneezes. */
const WEATHER_SKIT: { [hat: string]: string } = {
  beanie: 'shiver', snowflake: 'shiver', mittens: 'shiver', cocoa: 'shiver', penguin: 'shiver', polarbear: 'shiver', lantern: 'shiver', cookie: 'shiver', mountain: 'shiver', groundhog: 'shiver',
  shades: 'fan', sun: 'fan', lemonade: 'fan', watermelon: 'fan', snorkel: 'fan', sharkfin: 'fan', fireworks: 'fan',
  flower: 'sneeze', flowerbasket: 'sneeze', seedling: 'sneeze', bee: 'sneeze', butterfly: 'sneeze', sunhat: 'sneeze', sapling: 'sneeze'
}

export default function MappyCharacter (props: Props): any {
  const { mood, px, still } = props
  const ref = React.useRef<any>(null)
  const [look, setLook] = React.useState<[number, number]>([0, 0])
  const [skitState, setSkit] = React.useState('')
  const skit = props.skit || skitState
  const skitIndex = React.useRef(0)
  const hatNow = () => (props.hat !== undefined ? props.hat : seasonalHat()) || ''
  React.useEffect(() => {
    setSkit('')
    if (still || mood !== 'idle' || props.expanded || props.phase !== 'shown') return
    let next: any
    let finish: any
    const perform = () => {
      if ((ref.current?.ownerDocument || document).hidden) { next = setTimeout(perform, 20000); return }
      // Little moments between tasks, with a few for the weather he is dressed for.
      // His own little life between tasks (the Clippy pack lives in Acts.tsx), plus a skit for the weather he is dressed for.
      const acts = ['peek', 'fingertap', 'dance', 'browraise', 'stretch', 'atom', 'wink', 'headscratch', 'lookaround', 'stack', 'refold', 'glasses', 'heart', 'sway', 'hum', 'airplane', 'compass', 'headphones', 'yawn', 'artsy', 'wizardy', 'techy', 'bike']
      const weather = WEATHER_SKIT[hatNow()]
      if (weather) acts.splice(3, 0, weather)
      const next_ = acts[skitIndex.current++ % acts.length]
      setSkit(next_)
      finish = setTimeout(() => setSkit(''), (IDLE_ACTS as readonly string[]).includes(next_) ? 4400 : 3600)
      next = setTimeout(perform, 16000 + rand() * 8000)
    }
    next = setTimeout(perform, 8000)
    return () => { clearTimeout(next); clearTimeout(finish) }
  }, [still, mood, props.expanded, props.phase])

  // Hover: he notices you. Boop (a quick press): he squishes and pops a heart.
  const [hover, setHover] = React.useState(false)
  const [boop, setBoop] = React.useState(0)
  const boopTimer = React.useRef<any>(null)
  React.useEffect(() => () => clearTimeout(boopTimer.current), [])
  const doBoop = () => {
    if (still) return
    setBoop(n => n + 1)
    clearTimeout(boopTimer.current)
    boopTimer.current = setTimeout(() => setBoop(0), 900)
  }

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
  const happyEyes = mood === 'love' || mood === 'excited' || mood === 'dance' || mood === 'party' || mood === 'congratulate'
  const dizzy = mood === 'dizzy'
  const hatOfDay = mood === 'party' ? 'party' : props.hat !== undefined ? props.hat : seasonalHat()
  const wink = skit === 'wink' && mood === 'idle' && !props.expanded
  const pupil = mood === 'love' || mood === 'excited' || hover ? 4.6 : 3.8
  // He leans a little toward whatever he is looking at.
  const lean = still ? 0 : Math.max(-4, Math.min(4, lx * 1.2))
  const face = ACT_FACE[mood] || mood
  const brows = BROWS[face] || BROWS.idle
  const mouth = skit === 'yawn' && mood === 'idle' ? 'M46 61 Q50 58 54 61 Q56 68 50 70 Q44 68 46 61 Z' : skit === 'hum' && mood === 'idle' ? 'M44 63 Q50 66 56 63 Q50 68 44 63' : MOUTH[face] || MOUTH.idle
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
  if (hover && !still) cls.push('mappy-hover')
  if (boop) cls.push('mappy-boop')
  if (skit && mood === 'idle' && !props.expanded) cls.push(`mappy-skit-${skit}`)
  const act = (ACT_MOODS as readonly string[]).includes(mood) ? mood : (mood === 'idle' && !props.expanded && (IDLE_ACTS as readonly string[]).includes(skit) ? skit : '')
  if (act) cls.push(`mappy-act-${act}`)
  // An act with a hat of its own (beret, antenna, wizard hat) takes the seasonal one off for a moment.
  const hat = ['artsy', 'techy', 'wizardy', 'airplane', 'stack'].includes(act) ? null : hatOfDay

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
      onPointerDown={(e: any) => { doBoop(); props.onPointerDown?.(e) }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      <svg viewBox='0 0 100 110' width='100%' height='100%' aria-hidden='true' focusable='false'>
        <ellipse className='mappy-shadow' cx='50' cy='104' rx='28' ry='4' />
        <g className='mappy-leaner' style={{ transform: `rotate(${lean.toFixed(2)}deg)` }}>
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
          <circle className='mappy-cheek' cx='31' cy='58' r='4' fill='#f4a6a0' opacity='0.55' />
          <circle className='mappy-cheek' cx='69' cy='58' r='4' fill='#f4a6a0' opacity='0.55' />
          <g className={eyesClosed || happyEyes || dizzy ? '' : 'mappy-eyes'}>
            {dizzy
              ? <g className='mappy-spiral' stroke='#2c2216' strokeWidth='1.6' fill='#fff'>
                  <circle cx='40' cy='45' r='8' /><circle cx='60' cy='45' r='8' />
                  <path d='M40 45 m-1 0 a1 1 0 1 1 2 0 a3 3 0 1 1 -5 0 a5 5 0 1 1 9 0' fill='none' />
                  <path d='M60 45 m-1 0 a1 1 0 1 1 2 0 a3 3 0 1 1 -5 0 a5 5 0 1 1 9 0' fill='none' />
                </g>
              : eyesClosed
              ? <g stroke='#2c2216' strokeWidth='2' fill='none' strokeLinecap='round'>
                  <path d='M33 46 Q40 50 47 46' />
                  <path d='M53 46 Q60 50 67 46' />
                </g>
              : happyEyes
                ? <g stroke='#2c2216' strokeWidth='2.6' fill='none' strokeLinecap='round'>
                    <path d='M33 48 Q40 39 47 48' />
                    <path d='M53 48 Q60 39 67 48' />
                  </g>
                : <g>
                    <ellipse cx='40' cy='45' rx='8' ry='9.5' fill='#fff' stroke='#2c2216' strokeWidth='1.6' />
                    {wink
                      ? <path className='mappy-wink' d='M52 46 Q60 50 68 46' stroke='#2c2216' strokeWidth='2.2' fill='none' strokeLinecap='round' />
                      : <ellipse cx='60' cy='45' rx='8' ry='9.5' fill='#fff' stroke='#2c2216' strokeWidth='1.6' />}
                    <g className='mappy-pupils' transform={`translate(${lx.toFixed(2)} ${ly.toFixed(2)})`}>
                      <circle cx='40' cy='46' r={pupil} fill='#1d1d1d' />
                      {!wink && <circle cx='60' cy='46' r={pupil} fill='#1d1d1d' />}
                      <circle cx='41.3' cy='44.6' r='1.2' fill='#fff' />
                      {!wink && <circle cx='61.3' cy='44.6' r='1.2' fill='#fff' />}
                    </g>
                  </g>}
          </g>
          <g className='mappy-brows' stroke='#2c2216' strokeWidth='2.2' fill='none' strokeLinecap='round'>
            <path d={brows[0]} />
            <path d={brows[1]} />
          </g>
          <path className='mappy-mouth' d={mouth} fill={face === 'celebrate' || face === 'excited' || face === 'party' ? '#7a2b22' : 'none'} stroke='#2c2216' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
          {(face === 'celebrate' || face === 'excited' || face === 'party') && <path d='M45 67 Q50 71 55 67' fill='#e8837a' stroke='none' />}
          {hat && <Costume kind={hat} />}
        </g>
        {act && !still && <Act act={act} />}
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
        {!still && (mood === 'love' || (skit === 'heart' && mood === 'idle')) && <g className='mappy-hearts' fill='#e0533f'>
          {[[78, 22, 1], [90, 34, 0.7], [14, 26, 0.8]].map(([x, y, k], i) => <path key={i} className='mappy-heart' style={{ animationDelay: `${i * 0.35}s` }} transform={`translate(${x} ${y}) scale(${k})`} d={HEART} />)}
        </g>}
        {boop > 0 && !still && <path className='mappy-boop-heart' transform='translate(50 6)' d={HEART} fill='#e0533f' />}
        {!still && (mood === 'celebrate' || mood === 'excited' || mood === 'party' || mood === 'congratulate') && <g className='mappy-confetti'>
          {CONFETTI.map((c, i) => <rect key={i} x={50} y={30} width='3.2' height='5' rx='1' fill={c[2]} style={{ ['--cx' as any]: `${c[0]}px`, ['--cy' as any]: `${c[1]}px`, animationDelay: `${(i % 4) * 0.08}s` }} />)}
        </g>}
        {skit === 'fan' && mood === 'idle' && !still && <path className='mappy-sweat' d='M18 30 q0 -3 1.5 -5 q1.5 2 1.5 5 q0 2 -1.5 2 q-1.5 0 -1.5 -2 Z' fill='#5fa8e0' />}
        {skit === 'sneeze' && mood === 'idle' && !still && <text className='mappy-achoo' x='70' y='30' fontSize='9' fontWeight='700' fill='#7a5c2e' fontFamily='sans-serif' style={{ transformBox: 'fill-box', transformOrigin: 'center' } as any}>achoo!</text>}
        {(mood === 'dance' || ((skit === 'dance' || skit === 'hum') && mood === 'idle')) && <g className='mappy-notes' fill='#7a5c2e' fontFamily='sans-serif' fontWeight='700'>
          <text x='84' y='18' fontSize='13'>♪</text>
          <text x='8' y='14' fontSize='11'>♫</text>
        </g>}
      </svg>
    </button>
  )
}
