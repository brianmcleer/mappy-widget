/*
  Acts.tsx - the Clippy pack: the little performances that made the Office Assistant feel
  alive, redrawn for a folded paper map. Clippy had about forty of them (idle finger tap,
  head scratch, side to side, snooze, atom, rope pile; get artsy, techy, wizardy; search,
  write, print, save, send mail, empty trash, check something, process, explain, alert,
  congratulate, get attention, greeting, goodbye on a bicycle). This file holds the props
  that go with each act; the motion is CSS in styles.ts, keyed by the mappy-act-<name>
  class. An act is either a mood the chat asks for (processing, alert, print...) or an
  idle skit he does when nobody is typing (finger tap, atom, paper airplane...).
  Pure SVG, original art, nothing copied.
*/
import { React } from 'jimu-core'

const OUT = '#7a5c2e'
const INK = '#2c2216'

import { ACT_MOODS, IDLE_ACTS } from '../../brain/acts'
export { ACT_MOODS, IDLE_ACTS, ACT_ASKS } from '../../brain/acts'
export type { ActName } from '../../brain/acts'

/** A small gear, centered. */
const gear = (r: number, color: string) => <g>{[0, 45, 90, 135, 180, 225, 270, 315].map(a => <rect key={a} x={-r * 0.22} y={-r - r * 0.35} width={r * 0.44} height={r * 0.5} fill={color} transform={`rotate(${a})`} />)}<circle r={r} fill={color} /><circle r={r * 0.4} fill='#fff' /></g>
const glasses = <g className='mappy-glasses' fill='none' stroke={INK} strokeWidth='1.8'><circle cx='40' cy='45' r='10' /><circle cx='60' cy='45' r='10' /><path d='M50 45 L50 45 M30 44 L22 40 M70 44 L78 40' /><path d='M49 44 Q50 42 51 44' /></g>
const planeShape = 'M0 0 L-36 -8 L-28 0 L-36 8 Z M-28 0 L-8 0'

/** The props for one act, drawn over the whole character. Null for acts with CSS-only motion. */
export function Act (props: { act: string }): any {
  switch (props.act) {
    // ---- idle life
    case 'fingertap': return <g className='mappy-tapmarks' stroke={OUT} strokeWidth='1.4' fill='none' strokeLinecap='round'><path d='M99 6 q2 2 0 4' /><path d='M102 4 q3 3 0 8' /><path d='M105 2 q4 4 0 12' /></g>
    case 'headscratch': return <text className='mappy-float-q' x='64' y='4' fontSize='13' fontWeight='700' fill={OUT} fontFamily='sans-serif'>?</text>
    case 'atom': return <g className='mappy-atom'>
      <g className='mappy-orbit' style={{ animationDuration: '1.6s' }}><ellipse cx='50' cy='55' rx='46' ry='14' fill='none' stroke='#5fa8e0' strokeWidth='1.2' opacity='.7' /><circle cx='96' cy='55' r='3.5' fill='#5fa8e0' /></g>
      <g className='mappy-orbit' style={{ animationDuration: '2.2s', animationDirection: 'reverse' }}><ellipse cx='50' cy='55' rx='46' ry='14' fill='none' stroke='#e0533f' strokeWidth='1.2' opacity='.7' transform='rotate(60 50 55)' /><circle cx='50' cy='55' r='3.5' fill='#e0533f' transform='rotate(60 50 55) translate(46 0)' /></g>
      <g className='mappy-orbit' style={{ animationDuration: '1.9s' }}><ellipse cx='50' cy='55' rx='46' ry='14' fill='none' stroke='#f2b632' strokeWidth='1.2' opacity='.7' transform='rotate(-60 50 55)' /><circle cx='50' cy='55' r='3.5' fill='#f2b632' transform='rotate(-60 50 55) translate(-46 0)' /></g>
    </g>
    case 'stack': return <g className='mappy-stackpile'>{[0, 1, 2, 3].map(i => <path key={i} d={`M${14 + i} ${96 - i * 4} L${86 - i} ${96 - i * 4} L${86 - i} ${99 - i * 4} L${14 + i} ${99 - i * 4} Z`} fill={i % 2 ? '#f1e3bd' : '#fbf2d8'} stroke={OUT} strokeWidth='1' />)}</g>
    case 'airplane': return <g className='mappy-plane'><g transform='translate(50 60)'><path d={planeShape} fill='#fbf2d8' stroke={OUT} strokeWidth='1.4' strokeLinejoin='round' /><path d='M-36 -8 L-8 0' stroke='#c9b27f' strokeWidth='.6' /><circle cx='-20' cy='-3' r='1.6' fill='#1d1d1d' /><circle cx='-14' cy='-2' r='1.6' fill='#1d1d1d' /><path d='M-40 1 l-6 0 M-42 4 l-8 0 M-41 -2 l-5 0' stroke='#9ccbe8' strokeWidth='1' strokeLinecap='round' opacity='.8' /></g></g>
    case 'glasses': return <>{glasses}<g className='mappy-readsheet'><path d='M70 70 L96 64 L98 90 L72 96 Z' fill='#fff' stroke={OUT} strokeWidth='1' strokeLinejoin='round' /><path d='M75 75 L92 71 M75 79 L92 75 M75 83 L90 79 M75 87 L88 83' stroke='#bbb' strokeWidth='1' /></g></>
    case 'headphones': return <g className='mappy-phones'><path d='M14 44 Q14 2 50 2 Q86 2 86 44' fill='none' stroke={INK} strokeWidth='3.2' strokeLinecap='round' /><rect x='6' y='38' width='12' height='18' rx='4' fill={INK} /><rect x='82' y='38' width='12' height='18' rx='4' fill={INK} /><rect x='9' y='41' width='6' height='12' rx='2' fill='#5fa8e0' /><rect x='85' y='41' width='6' height='12' rx='2' fill='#5fa8e0' /><g className='mappy-soundwaves' fill='none' stroke='#5fa8e0' strokeWidth='1.4' strokeLinecap='round'><path d='M2 42 q-3 5 0 10' /><path d='M-2 39 q-5 8 0 16' /><path d='M98 42 q3 5 0 10' /><path d='M102 39 q5 8 0 16' /></g></g>
    case 'browraise': return null
    case 'sway': return null
    case 'bike': return <g className='mappy-bike'><g className='mappy-wheel' style={{ transformOrigin: '28px 104px' }}><circle cx='28' cy='104' r='9' fill='none' stroke={INK} strokeWidth='2' /><path d='M28 95 L28 113 M19 104 L37 104 M21.6 97.6 L34.4 110.4 M21.6 110.4 L34.4 97.6' stroke={INK} strokeWidth='.8' /></g><g className='mappy-wheel' style={{ transformOrigin: '72px 104px' }}><circle cx='72' cy='104' r='9' fill='none' stroke={INK} strokeWidth='2' /><path d='M72 95 L72 113 M63 104 L81 104 M65.6 97.6 L78.4 110.4 M65.6 110.4 L78.4 97.6' stroke={INK} strokeWidth='.8' /></g><path d='M28 104 L44 92 L64 92 L72 104 M44 92 L50 104 L72 104 M64 92 L60 84 M50 104 L36 104' fill='none' stroke='#e0533f' strokeWidth='2.4' strokeLinejoin='round' strokeLinecap='round' /><path d='M58 84 L66 84' stroke={INK} strokeWidth='2.4' strokeLinecap='round' /><g className='mappy-speedlines' stroke='#9ccbe8' strokeWidth='1.4' strokeLinecap='round'><path d='M96 70 l10 0 M100 78 l12 0 M97 86 l9 0' /></g></g>
    // ---- transformations
    case 'artsy': return <g className='mappy-artsy'><g className='mappy-act-hat'><path d='M30 14 Q34 -4 56 -2 Q70 0 70 12 Q58 6 46 10 Q38 12 30 14 Z' fill='#2c2216' /><ellipse cx='54' cy='-2' rx='2' ry='2.4' fill='#2c2216' /></g><g className='mappy-palette'><path d='M98 2 q-10 -2 -12 8 q-1 9 8 10 q4 0 4 -3 q0 -3 3 -3 q6 0 6 -5 q0 -7 -9 -7 Z' fill='#f1e3bd' stroke={OUT} strokeWidth='1' /><circle cx='92' cy='7' r='1.8' fill='#e0533f' /><circle cx='97' cy='5' r='1.8' fill='#5fa8e0' /><circle cx='102' cy='7' r='1.8' fill='#f2b632' /><circle cx='92' cy='13' r='1.8' fill='#6aa84f' /></g><path className='mappy-brushstroke' d='M20 86 q12 -12 24 0 t24 0' fill='none' stroke='#e0533f' strokeWidth='3' strokeLinecap='round' /></g>
    case 'techy': return <g className='mappy-techy'><g className='mappy-act-hat'><path d='M50 13 L50 -4' stroke='#8aa0b8' strokeWidth='2' /><circle className='mappy-blink-light' cx='50' cy='-6' r='3' fill='#e0533f' /><path d='M44 2 L56 2' stroke='#8aa0b8' strokeWidth='1.5' /></g><g className='mappy-pixel-eyes'><rect x='34' y='40' width='12' height='10' fill='#1d1d1d' /><rect x='54' y='40' width='12' height='10' fill='#1d1d1d' /><rect x='36' y='42' width='3' height='3' fill='#93c47d' /><rect x='41' y='45' width='3' height='3' fill='#93c47d' /><rect x='56' y='42' width='3' height='3' fill='#93c47d' /><rect x='61' y='45' width='3' height='3' fill='#93c47d' /></g><g className='mappy-binary' fontFamily='monospace' fontSize='6' fill='#5fa8e0' fontWeight='700'><text x='2' y='30'>1 0</text><text x='92' y='24'>0 1</text><text x='4' y='70'>1 1 0</text><text x='90' y='64'>1 0</text><text x='0' y='92'>0 1</text><text x='94' y='90'>1</text></g></g>
    case 'wizardy': return <g className='mappy-wizardy'><g className='mappy-act-hat'><path d='M32 17 L50 -22 L68 17 Z' fill='#5e3d8f' stroke='#3d2560' strokeWidth='1.3' strokeLinejoin='round' /><path d='M26 17 Q50 24 74 17 L74 20 Q50 27 26 20 Z' fill='#5e3d8f' stroke='#3d2560' strokeWidth='1' /><path d='M50 -22 q6 -2 4 4' stroke='#5e3d8f' strokeWidth='3' strokeLinecap='round' fill='none' /><path d='M44 2 l1.2 2.6 l2.8 .4 l-2 2 l.5 2.8 l-2.5 -1.3 l-2.5 1.3 l.5 -2.8 l-2 -2 l2.8 -.4 Z M56 -6 l1 2 l2.2 .3 l-1.6 1.6 l.4 2.2 l-2 -1 l-2 1 l.4 -2.2 l-1.6 -1.6 l2.2 -.3 Z' fill='#f2b632' /></g><g className='mappy-wand'><path d='M93 13 L108 -8' stroke={INK} strokeWidth='2' strokeLinecap='round' /><path d='M104 -3 L108 -8' stroke='#fff' strokeWidth='2' strokeLinecap='round' /></g><g className='mappy-sparkles' fill='#f2b632'>{[[108, -12], [114, -4], [102, -14], [112, -16], [118, -10]].map(([x, y], i) => <path key={i} className='mappy-sparkle-star' style={{ animationDelay: `${i * 0.15}s` }} d={`M${x} ${y - 3} l1 2 l2.2 .3 l-1.6 1.6 l.4 2.2 l-2 -1 l-2 1 l.4 -2.2 l-1.6 -1.6 l2.2 -.3 Z`} />)}</g><g className='mappy-mapstars' fill='#fff'>{[[24, 60], [70, 48], [40, 84], [78, 88], [30, 36]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r='1.4' style={{ animationDelay: `${i * 0.2}s` }} />)}</g></g>
    // ---- at work
    case 'processing': return <g className='mappy-gears'><g transform='translate(80 4)'><g className='mappy-gear'>{gear(6, '#8aa0b8')}</g></g><g transform='translate(93 12)'><g className='mappy-gear mappy-gear-ccw'>{gear(4.5, '#5fa8e0')}</g></g><g transform='translate(68 12)'><g className='mappy-gear mappy-gear-ccw'>{gear(4, '#e0533f')}</g></g></g>
    case 'writing': return <g className='mappy-writing'><g className='mappy-pen'><g transform='translate(70 84) rotate(-40)'><rect x='-2' y='-18' width='4' height='18' fill='#f2b632' stroke='#b8860b' strokeWidth='.6' /><path d='M-2 0 L0 4 L2 0 Z' fill='#f1e3bd' stroke='#b8860b' strokeWidth='.6' /><path d='M-.8 1.5 L0 4 L.8 1.5 Z' fill={INK} /><rect x='-2' y='-18' width='4' height='3' fill='#ef6f8f' /></g></g><path className='mappy-inkline' d='M16 78 q6 -4 12 0 t12 0 t12 0 t10 0 M16 85 q6 -4 12 0 t12 0 t12 0 M16 92 q6 -4 12 0 t12 0 t8 0' fill='none' stroke='#2c5f8a' strokeWidth='1.6' strokeLinecap='round' /></g>
    case 'checking': return <>{glasses}<g className='mappy-checklist'><path d='M70 70 L96 64 L98 90 L72 96 Z' fill='#fff' stroke={OUT} strokeWidth='1' strokeLinejoin='round' /><path d='M80 75 L92 72 M80 81 L92 78 M80 87 L90 84' stroke='#bbb' strokeWidth='1' />{[76, 82, 88].map((y, i) => <path key={y} className='mappy-tick' style={{ animationDelay: `${0.5 + i * 0.55}s` }} d={`M74 ${y} l1.6 1.8 l3 -3.6`} fill='none' stroke='#6aa84f' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' />)}</g></>
    case 'alert': return <g className='mappy-alertmark'><circle cx='84' cy='8' r='9' fill='#f2b632' stroke='#b8860b' strokeWidth='1.2' /><path d='M84 2 L84 10' stroke={INK} strokeWidth='2.6' strokeLinecap='round' /><circle cx='84' cy='13.5' r='1.5' fill={INK} /></g>
    case 'explain': return <g className='mappy-explain'><g className='mappy-pointerstick'><path d='M93 13 L106 -10' stroke={OUT} strokeWidth='1.8' strokeLinecap='round' /><circle cx='106' cy='-10' r='2.2' fill='#e0533f' /></g><g className='mappy-board'><rect x='0' y='-20' width='34' height='24' rx='2' fill='#2e6f3e' stroke='#5a3d1a' strokeWidth='1.5' /><path d='M5 -13 L20 -13 M5 -8 L26 -8 M5 -3 L14 -3' stroke='#fff' strokeWidth='1.2' strokeLinecap='round' opacity='.9' /><path d='M22 -5 l5 3 l-5 3 Z' fill='#f2b632' /></g></g>
    case 'knock': return <g className='mappy-knockrings' fill='none' stroke={OUT} strokeWidth='1.4'><circle className='mappy-ring' cx='100' cy='8' r='4' /><circle className='mappy-ring' cx='100' cy='8' r='4' style={{ animationDelay: '.35s' }} /><text className='mappy-knocktext' x='70' y='-4' fontSize='7' fontWeight='700' fill={OUT} stroke='none' fontFamily='sans-serif'>knock knock</text></g>
    case 'print': return <g className='mappy-printer'><rect x='-8' y='78' width='34' height='16' rx='2' fill='#8aa0b8' stroke='#5a6e85' strokeWidth='1.2' /><rect x='-4' y='72' width='26' height='7' fill='#c8d6e5' stroke='#5a6e85' strokeWidth='1' /><circle cx='20' cy='84' r='1.6' fill='#93c47d' /><g className='mappy-printsheet'><rect x='-2' y='92' width='22' height='16' fill='#fff' stroke={OUT} strokeWidth='.8' /><path d='M2 96 L16 96 M2 99 L14 99 M2 102 L12 102' stroke='#5fa8e0' strokeWidth='1' /></g></g>
    case 'trash': return <g className='mappy-bin'><path d='M4 70 L26 70 L24 100 L6 100 Z' fill='#5fa8e0' stroke='#2c5f8a' strokeWidth='1.4' strokeLinejoin='round' /><path d='M8 76 L9 95 M15 76 L15 95 M22 76 L21 95' stroke='#2c5f8a' strokeWidth='1' /><g className='mappy-binlid'><rect x='1' y='66' width='28' height='5' rx='1.5' fill='#2c5f8a' /><rect x='11' y='62' width='8' height='4' rx='1' fill='#2c5f8a' /></g><path d='M10 82 l10 0 l-2 -6 l-6 0 Z' fill='#fff' opacity='.5' /></g>
    case 'mail': return <g className='mappy-envelope'><g className='mappy-letter'><rect x='-12' y='20' width='30' height='20' rx='1.5' fill='#fff' stroke={OUT} strokeWidth='1.2' /><path d='M-12 20 L3 32 L18 20' fill='none' stroke={OUT} strokeWidth='1.2' /><rect x='9' y='23' width='6' height='5' fill='#e0533f' /></g></g>
    case 'save': return <g className='mappy-floppy'><g className='mappy-disk'><rect x='-14' y='26' width='26' height='26' rx='2' fill='#2c5f8a' /><rect x='-9' y='26' width='16' height='9' fill='#c8d6e5' /><rect x='-6' y='40' width='10' height='12' fill='#fff' stroke='#2c5f8a' strokeWidth='.6' /><rect x='2' y='28' width='3' height='5' fill='#2c5f8a' /></g></g>
    case 'congratulate': return <g className='mappy-trophy'><g className='mappy-trophy-cup'><path d='M96 -4 L110 -4 L108 8 Q103 14 98 8 Z' fill='#f2b632' stroke='#b8860b' strokeWidth='1' strokeLinejoin='round' /><path d='M96 -1 q-5 0 -4 5 q1 4 6 3 M110 -1 q5 0 4 5 q-1 4 -6 3' fill='none' stroke='#b8860b' strokeWidth='1.2' /><rect x='100' y='13' width='6' height='3' fill='#b8860b' /><rect x='98' y='16' width='10' height='2.5' fill='#7a5c2e' /><path d='M101 2 l1 2 l2 .3 l-1.5 1.4 l.4 2 l-1.9 -1 l-1.9 1 l.4 -2 l-1.5 -1.4 l2 -.3 Z' fill='#fff' opacity='.8' /></g></g>
    case 'goodbye': return <g className='mappy-bike'><g className='mappy-wheel' style={{ transformOrigin: '28px 104px' }}><circle cx='28' cy='104' r='9' fill='none' stroke={INK} strokeWidth='2' /><path d='M28 95 L28 113 M19 104 L37 104' stroke={INK} strokeWidth='.8' /></g><g className='mappy-wheel' style={{ transformOrigin: '72px 104px' }}><circle cx='72' cy='104' r='9' fill='none' stroke={INK} strokeWidth='2' /><path d='M72 95 L72 113 M63 104 L81 104' stroke={INK} strokeWidth='.8' /></g><path d='M28 104 L44 92 L64 92 L72 104 M44 92 L50 104 L72 104 M64 92 L60 84' fill='none' stroke='#e0533f' strokeWidth='2.4' strokeLinejoin='round' strokeLinecap='round' /></g>
  }
  return null
}

/** The CSS for every act. Appended to the widget's stylesheet. */
export const ACT_CSS = `
.mappy-act-hat{transform-box:view-box;transform-origin:50px 14px}
/* idle life */
.mappy-act-fingertap .mappy-hand{animation:mappy-tap .22s ease-in-out 10}
.mappy-act-fingertap .mappy-pupils{animation:mappy-eyeroll 2.2s ease-in-out 1}
.mappy-tapmarks path{opacity:0;animation:mappy-tapmark .44s ease-out 5}
.mappy-tapmarks path:nth-child(2){animation-delay:.07s}.mappy-tapmarks path:nth-child(3){animation-delay:.14s}
@keyframes mappy-tap{0%,100%{transform:rotate(0)}50%{transform:rotate(-14deg) translateY(2px)}}
@keyframes mappy-tapmark{0%{opacity:0}30%{opacity:1}100%{opacity:0}}
@keyframes mappy-eyeroll{0%,100%{transform:translate(0,0)}30%{transform:translate(3px,-2px)}60%{transform:translate(-3px,-2px)}}
.mappy-act-headscratch .mappy-hand{animation:mappy-scratch 2.6s ease-in-out 1}
@keyframes mappy-scratch{0%,100%{transform:none}25%,75%{transform:translate(-28px,-12px) rotate(-70deg)}35%,55%{transform:translate(-30px,-13px) rotate(-78deg)}45%,65%{transform:translate(-26px,-11px) rotate(-62deg)}}
.mappy-act-headscratch .mappy-body{animation:mappy-tilt 2.6s ease-in-out 1}
.mappy-float-q{animation:mappy-float 1.3s ease-in-out 2}
.mappy-act-browraise .mappy-brows path:first-child{animation:mappy-browup 1.4s ease-in-out 2}
.mappy-act-browraise .mappy-brows path:last-child{animation:mappy-browup 1.4s ease-in-out 2 .7s}
@keyframes mappy-browup{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.mappy-brows path{transform-box:view-box;transform-origin:50px 46px}
.mappy-act-sway .mappy-body{animation:mappy-sidetoside 2.4s ease-in-out 2}
.mappy-act-sway .mappy-pupils{animation:mappy-sidetoside-eyes 2.4s ease-in-out 2}
@keyframes mappy-sidetoside{0%,100%{transform:none}25%{transform:translateX(-7px) rotate(-5deg)}75%{transform:translateX(7px) rotate(5deg)}}
@keyframes mappy-sidetoside-eyes{0%,100%{transform:translate(0,0)}25%{transform:translate(3px,0)}75%{transform:translate(-3px,0)}}
.mappy-orbit{transform-box:view-box;transform-origin:50px 55px;animation:mappy-twirl 2s linear infinite}
.mappy-act-atom .mappy-body{animation:mappy-atomspin 3.6s ease-in-out 1}
@keyframes mappy-atomspin{0%,100%{transform:none}20%{transform:scale(.9) rotate(-8deg)}50%{transform:scale(.92) rotate(10deg)}80%{transform:scale(.9) rotate(-6deg)}}
.mappy-act-stack .mappy-body{animation:mappy-stack 3.4s ease-in-out 1}
@keyframes mappy-stack{0%,100%{transform:none}20%{transform:scaleY(1.06)}32%,62%{transform:scaleY(.06) scaleX(1.04)}74%{transform:scaleY(1.12) scaleX(.96)}84%{transform:scaleY(.95)}}
.mappy-stackpile{opacity:0;animation:mappy-stackpile 3.4s linear 1}
@keyframes mappy-stackpile{0%,28%{opacity:0}34%,62%{opacity:1}66%,100%{opacity:0}}
.mappy-act-airplane .mappy-body{animation:mappy-foldaway 4.2s ease-in-out 1}
@keyframes mappy-foldaway{0%,100%{transform:none}12%{transform:scaleX(.6) rotate(-10deg)}20%,78%{transform:scale(.02) rotate(-30deg)}86%{transform:scale(1.08) rotate(6deg)}93%{transform:scale(.96)}}
.mappy-plane{opacity:0;transform-box:view-box;transform-origin:50px 60px;animation:mappy-fly 4.2s ease-in-out 1}
@keyframes mappy-fly{0%,18%{opacity:0;transform:translate(0,0) rotate(0) scale(.4)}22%{opacity:1;transform:translate(0,0) rotate(0) scale(1)}35%{transform:translate(30px,-30px) rotate(-30deg)}50%{transform:translate(-10px,-56px) rotate(-200deg)}62%{transform:translate(-40px,-20px) rotate(-330deg)}75%{opacity:1;transform:translate(0,0) rotate(-360deg) scale(1)}80%,100%{opacity:0;transform:translate(0,0) rotate(-360deg) scale(.4)}}
.mappy-act-glasses .mappy-body{animation:mappy-tilt 3.4s ease-in-out 1}
.mappy-act-glasses .mappy-pupils,.mappy-act-checking .mappy-pupils{animation:mappy-readeyes 1.2s ease-in-out 3}
@keyframes mappy-readeyes{0%,100%{transform:translate(-2.5px,2.5px)}50%{transform:translate(2.5px,2.5px)}}
.mappy-readsheet,.mappy-checklist{transform-box:view-box;transform-origin:84px 80px;animation:mappy-sheetin .5s ease-out 1}
@keyframes mappy-sheetin{0%{opacity:0;transform:translateY(12px) rotate(8deg)}100%{opacity:1;transform:none}}
.mappy-act-headphones .mappy-body{animation:mappy-nod .5s ease-in-out 7}
.mappy-soundwaves path{animation:mappy-wavepulse .5s ease-in-out 7}
.mappy-soundwaves path:nth-child(2n){animation-delay:.25s}
@keyframes mappy-wavepulse{0%,100%{opacity:.2}50%{opacity:1}}
.mappy-act-bike .mappy-leaner,.mappy-act-goodbye .mappy-leaner{animation:mappy-ride 3.6s ease-in-out 1}
@keyframes mappy-ride{0%{transform:translateX(0)}15%{transform:translateX(-6px) rotate(-3deg)}50%{transform:translateX(-120px) rotate(-5deg)}51%{transform:translateX(130px) rotate(-5deg)}85%{transform:translateX(4px) rotate(2deg)}100%{transform:translateX(0)}}
.mappy-act-goodbye .mappy-leaner{animation:mappy-rideoff 1.6s ease-in 1 forwards}
@keyframes mappy-rideoff{0%{transform:translateX(0)}20%{transform:translateX(6px) rotate(3deg)}100%{transform:translateX(-160px) rotate(-6deg);opacity:0}}
.mappy-act-bike .mappy-body,.mappy-act-goodbye .mappy-body{animation:mappy-pedal .3s ease-in-out 12}
@keyframes mappy-pedal{0%,100%{transform:translateY(-6px)}50%{transform:translateY(-8px) rotate(1deg)}}
.mappy-wheel{animation:mappy-twirl .5s linear 8}
.mappy-act-bike .mappy-speedlines{animation:mappy-wavepulse .3s linear 12}
/* transformations */
.mappy-act-artsy .mappy-act-hat{animation:mappy-dropin .5s ease-out 1}
.mappy-act-techy .mappy-act-hat,.mappy-act-wizardy .mappy-act-hat{animation:mappy-dropin .5s ease-out 1}
@keyframes mappy-dropin{0%{opacity:0;transform:translateY(-14px)}60%{transform:translateY(2px)}100%{opacity:1;transform:none}}
.mappy-palette{transform-box:view-box;transform-origin:88px 20px;animation:mappy-wave .6s ease-in-out 4}
.mappy-brushstroke{stroke-dasharray:70;stroke-dashoffset:70;animation:mappy-draw 2s ease-in-out 1 forwards .6s}
@keyframes mappy-draw{to{stroke-dashoffset:0}}
.mappy-act-artsy .mappy-body{animation:mappy-tilt 3s ease-in-out 1}
.mappy-blink-light{animation:mappy-wavepulse .6s linear 6}
.mappy-binary text{animation:mappy-binary 1.2s linear 3}
.mappy-binary text:nth-child(2n){animation-delay:.4s}.mappy-binary text:nth-child(3n){animation-delay:.8s}
@keyframes mappy-binary{0%{opacity:0;transform:translateY(-6px)}30%{opacity:1}100%{opacity:0;transform:translateY(10px)}}
.mappy-act-techy .mappy-body{animation:mappy-robot 3.2s steps(6) 1}
@keyframes mappy-robot{0%,100%{transform:none}25%{transform:rotate(-4deg) translateX(-3px)}50%{transform:rotate(0) translateY(-3px)}75%{transform:rotate(4deg) translateX(3px)}}
.mappy-wand{transform-box:view-box;transform-origin:93px 13px;animation:mappy-wandwave 1.2s ease-in-out 3}
@keyframes mappy-wandwave{0%,100%{transform:rotate(0)}30%{transform:rotate(-30deg)}70%{transform:rotate(12deg)}}
.mappy-sparkle-star{opacity:0;animation:mappy-sparklepop 1.2s ease-out 3}
@keyframes mappy-sparklepop{0%{opacity:0;transform:scale(.3)}30%{opacity:1;transform:scale(1.2)}100%{opacity:0;transform:scale(.6) translateY(-6px)}}
.mappy-sparkle-star{transform-box:fill-box;transform-origin:center}
.mappy-mapstars circle{opacity:0;animation:mappy-sparklepop 1.5s ease-out 2 .8s}
.mappy-act-wizardy .mappy-body{animation:mappy-float-body 3.6s ease-in-out 1}
@keyframes mappy-float-body{0%,100%{transform:none}30%,70%{transform:translateY(-10px)}}
/* at work */
.mappy-gear{transform-box:fill-box;transform-origin:center;animation:mappy-twirl 1.6s linear infinite}
.mappy-gear-ccw{animation-direction:reverse;animation-duration:1.2s}
.mappy-act-processing .mappy-body{animation:mappy-bob 1.2s ease-in-out infinite}
.mappy-pen{transform-box:view-box;transform-origin:70px 84px;animation:mappy-scribble .35s ease-in-out 10}
@keyframes mappy-scribble{0%,100%{transform:translate(-44px,-6px) rotate(-8deg)}50%{transform:translate(-6px,6px) rotate(4deg)}}
.mappy-inkline{stroke-dasharray:140;stroke-dashoffset:140;animation:mappy-draw 3.4s linear 1 forwards}
.mappy-act-writing .mappy-body{animation:mappy-nod 1.1s ease-in-out 3}
.mappy-tick{opacity:0;animation:mappy-tickin .4s ease-out 1 forwards}
@keyframes mappy-tickin{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:none}}
.mappy-tick{transform-box:fill-box;transform-origin:center}
.mappy-act-checking .mappy-body{animation:mappy-nod .9s ease-in-out 3 .6s}
.mappy-act-alert .mappy-body{animation:mappy-alertshake .5s ease-in-out 3}
@keyframes mappy-alertshake{0%,100%{transform:none}20%{transform:translateX(-3px) rotate(-2deg) scaleY(1.03)}60%{transform:translateX(3px) rotate(2deg) scaleY(1.03)}}
.mappy-alertmark{transform-box:fill-box;transform-origin:center bottom;animation:mappy-alertpop 1.4s ease-in-out 2}
@keyframes mappy-alertpop{0%{opacity:0;transform:scale(.3)}25%{opacity:1;transform:scale(1.25)}50%{transform:scale(1)}75%{transform:scale(1.15)}100%{transform:scale(1)}}
.mappy-pointerstick{transform-box:view-box;transform-origin:93px 13px;animation:mappy-point-stick 1.3s ease-in-out 3}
@keyframes mappy-point-stick{0%,100%{transform:rotate(0)}50%{transform:rotate(14deg)}}
.mappy-board{animation:mappy-dropin .5s ease-out 1}
.mappy-act-explain .mappy-body{animation:mappy-nod 1.3s ease-in-out 3}
.mappy-act-knock .mappy-hand{animation:mappy-knock .4s ease-in-out 6}
@keyframes mappy-knock{0%,100%{transform:rotate(0)}40%{transform:rotate(-40deg) translateX(6px)}50%{transform:rotate(-10deg) translateX(10px)}}
.mappy-act-knock .mappy-body{animation:mappy-lunge .4s ease-in-out 6}
@keyframes mappy-lunge{0%,100%{transform:none}50%{transform:translateX(4px) scale(1.02)}}
.mappy-ring{opacity:0;transform-box:fill-box;transform-origin:center;animation:mappy-ring .8s ease-out 3}
@keyframes mappy-ring{0%{opacity:.9;transform:scale(.4)}100%{opacity:0;transform:scale(2.4)}}
.mappy-knocktext{animation:mappy-float 1.2s ease-in-out 2}
.mappy-printsheet{animation:mappy-printout 2.4s ease-in-out 1 forwards}
@keyframes mappy-printout{0%{transform:translateY(-16px);opacity:0}20%{opacity:1}100%{transform:translateY(0)}}
.mappy-printer{animation:mappy-dropin .4s ease-out 1}
.mappy-act-print .mappy-body{animation:mappy-nod .4s ease-in-out 6}
.mappy-act-trash .mappy-body{animation:mappy-binjump 3.2s ease-in-out 1}
@keyframes mappy-binjump{0%,100%{transform:none}20%{transform:translateY(-14px) rotate(-10deg)}40%,60%{transform:translate(-30px,10px) rotate(-70deg) scale(.6)}75%{transform:translate(-10px,-20px) rotate(-20deg) scale(1.05)}88%{transform:translateY(0) scale(1.06,.94)}}
.mappy-binlid{transform-box:fill-box;transform-origin:left bottom;animation:mappy-lid 3.2s ease-in-out 1}
@keyframes mappy-lid{0%,100%{transform:none}30%,70%{transform:rotate(-60deg)}}
.mappy-bin{animation:mappy-dropin .4s ease-out 1}
.mappy-letter{transform-box:fill-box;transform-origin:center;animation:mappy-sendmail 2.4s ease-in 1 forwards}
@keyframes mappy-sendmail{0%{opacity:0;transform:translate(86px,-14px) scale(.6)}25%{opacity:1;transform:translate(86px,-18px) scale(1)}55%{transform:translate(70px,-34px) rotate(-10deg)}100%{opacity:0;transform:translate(-60px,-90px) rotate(-30deg)}}
.mappy-act-mail .mappy-hand{animation:mappy-wave .4s ease-in-out 5 1.2s}
.mappy-disk{transform-box:fill-box;transform-origin:center;animation:mappy-savedisk 2.6s ease-in-out 1 forwards}
@keyframes mappy-savedisk{0%{opacity:0;transform:translate(86px,-20px) scale(.5)}25%{opacity:1;transform:translate(86px,-26px) scale(1)}60%{transform:translate(86px,-26px) scale(1)}100%{opacity:0;transform:translate(24px,50px) scale(.2)}}
.mappy-act-save .mappy-body{animation:mappy-nod .8s ease-in-out 3}
.mappy-trophy-cup{transform-box:view-box;transform-origin:93px 13px;animation:mappy-raise 1.6s ease-in-out 2}
@keyframes mappy-raise{0%,100%{transform:rotate(0)}50%{transform:rotate(-26deg) translateY(-4px)}}
.mappy-act-congratulate .mappy-body{animation:mappy-hop .6s ease-in-out 4}
.mappy-act-congratulate .mappy-confetti rect{animation-iteration-count:2}
`
