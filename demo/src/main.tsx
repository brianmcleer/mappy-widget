/*
  main.tsx - the Mappy playground: the widget's real brain, character and chat, living on a
  made-up town instead of an ArcGIS map. Everything Mappy does here is the same code that runs
  in Experience Builder; only the map underneath (fakemap.ts), the framework (jimu-core.ts) and
  the AI helper (pretend-claude.ts, a simulation) are stand-ins. Nothing leaves the page.
*/
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { buildTown } from './town'
import { FakeView, FakeLayer, Graphic, toXY } from './fakemap'
import { setPlaces } from './jimu-core'
import { pretendClaude, DEMO_NOTE } from './pretend-claude'
import { LiveMap } from '../../mappy/src/runtime/live'
import { Mind } from '../../mappy/src/runtime/mind'
import { MappyIndex } from '../../mappy/src/brain/engine'
import { adminDocs } from '../../mappy/src/brain/admin'
import { V } from '../../mappy/src/brain/voice'
import MappyCharacter from '../../mappy/src/runtime/components/MappyCharacter'
import ChatBubble from '../../mappy/src/runtime/components/ChatBubble'
import { injectStyles, CLASSIC } from '../../mappy/src/runtime/styles'
import { placeBubble } from '../../mappy/src/runtime/placement'

const town = buildTown()
setPlaces(town.places)
const view = new FakeView(town.layers, town.start)
const live = new LiveMap()
live.bind({ view } as any)

const FAQ = [
  { q: 'How do I print the map', a: 'This playground has no Print tool. In a real app, say "print the map" and I open it for you.' },
  { q: 'Is this a real place', a: 'No. Mapleton is made up for this demo: every street, owner and hydrant is invented.' },
  { q: 'Who made you', a: 'I am an open-source widget for ArcGIS Experience Builder. My code is at github.com/brianmcleer/mappy-widget.' }
]
const memory: { [k: string]: string } = {}
const store = {
  get: (k: string): string | null => { try { return window.localStorage.getItem('mappy-demo:' + k) } catch (e) { return memory[k] ?? null } },
  set: (k: string, v: string | null): void => { try { if (v === null) window.localStorage.removeItem('mappy-demo:' + k); else window.localStorage.setItem('mappy-demo:' + k, v) } catch (e) { if (v === null) delete memory[k]; else memory[k] = v } }
}
const port = pretendClaude(town.layers, town.places)
const ALONE = /[?&]helper=local\b/.test(window.location.search)
let waitingNote: (note: string) => void = () => {}
const mind = new Mind({
  index: new MappyIndex([...live.docs(), ...adminDocs(FAQ as any, 'Mapleton is a made-up town of twelve blocks.\n\nTown Hall is open weekdays 8 to 5.')]),
  model: {} as any,
  live,
  hints: new Map(),
  name: 'Mappy',
  appTitle: 'the Mapleton map',
  featureSearch: true,
  maxResults: 8,
  showInLayerList: false,
  layerListIds: [],
  layerListLabel: '',
  geocoders: [{ url: 'https://demo.invalid/GeocodeServer', name: 'Mapleton addresses', singleLineFieldName: 'SingleLine' } as any],
  typoFix: true,
  fun: true,
  // ?helper=local shows him on his own, with no server and no AI helper.
  mcp: ALONE ? null : port as any,
  serverAssistant: ALONE ? null : { label: 'Claude (demo)', shareSelection: true, note: DEMO_NOTE },
  waiting: (note: string) => waitingNote(note),
  contact: { name: 'the Mapleton map desk', email: 'mapdesk@mapleton.example', hours: 'weekdays, 8 to 5 (a made-up desk for this demo)' },
  place: { org: 'the Town', name: 'Mapleton', website: '', facts: ['Mapleton has twelve blocks, three parks and one very proud paper map.', 'Every street in Mapleton is named for a tree, and every avenue for a number.'] },
  store
} as any)

const MOOD_MS: { [m: string]: number } = { talk: 1600, wave: 2600, happy: 1800, pleased: 1600, acknowledge: 1200, celebrate: 1600, confused: 1800, attention: 2300, point: 2800, love: 2800, excited: 2300, dance: 3600, roll: 1300, dizzy: 2600, party: 5200, sleep: 0, think: 0, search: 0, processing: 0, calling: 0, camera: 0, goodbye: 1800 }
const TRY: Array<[string, string[]]> = [
  ['The map', ['turn on zoning', 'zoom to 250 Oak St', 'who owns 250 Oak St', 'turn on fire hydrants', 'closest fire hydrant to City Hall', 'only show parcels over 7 acres on the map', 'clear the filter']],
  ['The data', ['how many parcels', 'count parcels by zoning', 'chart parcels by land use', 'average acres in parcels', 'parcels sold since 2025', 'oldest hydrant']],
  ['Ask Claude (simulated)', ['ask Claude which zoning district has the most parcels', 'ask Claude how many hydrants were installed before 1990', 'ask Claude who owns the most land', '¿cuántos parques hay en la ciudad?']],
  ['Just Mappy', ['how are you', 'call me Sam', 'hug', 'juggle', 'find treasure', 'be a boat', 'tell me a joke', 'show me around']]
]

/** Set by the build for the hosted page, where files cannot be saved. */
declare const DEMO_HOSTED: boolean
const HOSTED = typeof DEMO_HOSTED !== 'undefined' && DEMO_HOSTED

interface Msg { id: number, from: 'user' | 'mappy', text: string, reply?: any }
let seq = 1

function MapSvg (props: { tick: number, onPick: (g: Graphic | null) => void }): any {
  const ref = React.useRef<SVGSVGElement>(null)
  const drag = React.useRef<{ x: number, y: number, moved: boolean } | null>(null)
  React.useEffect(() => {
    const el = ref.current!
    const size = () => { const r = el.getBoundingClientRect(); view.width = Math.max(200, r.width); view.height = Math.max(200, r.height); view.onRender() }
    size()
    // The ideas panel covers the left side on a wide screen: start with the town in the open part.
    if (view.width > 760) void view.goTo({ center: { x: -100.010 - 170 * view.mpp / 85394, y: 40.006 }, scale: view.width > 1100 ? 7200 : 9000 }, { animate: false })
    else void view.goTo({ center: { x: -100.010, y: 40.0045 }, scale: 14000 }, { animate: false })
    window.addEventListener('resize', size)
    ;(view as any).container = el
    return () => window.removeEventListener('resize', size)
  }, [])
  const [vx, vy, vw, vh] = view.viewBox()
  const mpp = view.mpp
  const order = ['parcels', 'parks', 'zoning', 'streets', 'hydrants']
  const layers = order.map(id => town.layers.find(l => l.id === id)!).filter(l => l.visible)
  const path = (coords: number[][], close: boolean): string => coords.map((c, i) => { const [x, y] = toXY(c[0], c[1]); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}` }).join(' ') + (close ? ' Z' : '')
  const label = (text: string, lon: number, lat: number, size = 11, weight = 500, fill = '#5b4a2a'): any => { const [x, y] = toXY(lon, lat); return <text x={x} y={y} fontSize={size * mpp} fontWeight={weight} fill={fill} textAnchor='middle' dominantBaseline='middle' style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: '#fffdf3', strokeWidth: 3 * mpp, strokeLinejoin: 'round' } as any}>{text}</text> }
  const pick = (e: any) => {
    if (drag.current?.moved) return
    const r = ref.current!.getBoundingClientRect()
    const p = view.toMap({ x: e.clientX - r.left, y: e.clientY - r.top })
    for (const l of [...layers].reverse()) {
      const hit = l.drawn().find(f => {
        const g: any = f.geometry
        if (g.type === 'point') return Math.hypot((g.x - p.x) * 85394, (g.y - p.y) * 111000) < 9 * mpp
        if (g.type === 'polygon') return g.extent.contains(p)
        return false
      })
      if (hit) { props.onPick(hit); return }
    }
    props.onPick(null)
  }
  return (
    <svg ref={ref} className='demo-map' viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio='none' role='img' aria-label='Map of Mapleton, a made-up town'
      onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; (e.target as any).setPointerCapture?.(e.pointerId) }}
      onPointerMove={e => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x; const dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.moved) { view.panBy(dx, dy); d.x = e.clientX; d.y = e.clientY } }}
      onPointerUp={e => { const d = drag.current; if (d?.moved) view.fire('drag', { action: 'end' }); else pick(e); setTimeout(() => { drag.current = null }, 0) }}
      onWheel={e => { view.zoomBy(e.deltaY > 0 ? 1.25 : 0.8); view.fire('mouse-wheel', {}) }}>
      <rect x={vx} y={vy} width={vw} height={vh} fill='#f3ecd6' />
      {/* Mill Creek, for scenery */}
      <path d={path([[-100.0215, 40.0128], [-100.0188, 40.0112], [-100.0192, 40.0086], [-100.0206, 40.006], [-100.0196, 40.003], [-100.021, 40.0002]], false)} fill='none' stroke='#a9d3ee' strokeWidth={15} strokeLinecap='round' strokeLinejoin='round' />
      {label('Mill Creek', -100.0206, 40.0046, 10, 500, '#3f7fa8')}
      {layers.map(l => (
        <g key={l.id} opacity={l.opacity}>
          {l.drawn().map(f => {
            const g: any = f.geometry
            const id = f.attributes.OBJECTID
            const hot = l.highlighted.has(id)
            if (g.type === 'polygon') return <path key={id} d={path(g.rings[0], true)} fill={l.style.by ? (l.style.colors?.[f.attributes[l.style.by]] || '#ddd') : l.style.fill} fillOpacity={l.id === 'zoning' ? 0.55 : 1} stroke={hot ? '#00b7eb' : l.style.stroke} strokeWidth={hot ? 3.5 : 1.2} vectorEffect='non-scaling-stroke' />
            if (g.type === 'polyline') return <g key={id}><path d={path(g.paths[0], false)} fill='none' stroke='#c9b98f' strokeWidth={Math.max(12, 9 * mpp)} strokeLinecap='round' /><path d={path(g.paths[0], false)} fill='none' stroke={hot ? '#00b7eb' : '#fffdf6'} strokeWidth={Math.max(9, 6.5 * mpp)} strokeLinecap='round' /></g>
            const [x, y] = toXY(g.x, g.y)
            return <g key={id}>{hot && <circle cx={x} cy={y} r={11 * mpp} fill='none' stroke='#00b7eb' strokeWidth={3 * mpp} />}<circle cx={x} cy={y} r={5.5 * mpp} fill={f.attributes.STATUS === 'Out of service' ? '#9aa3ad' : l.style.fill} stroke={l.style.stroke} strokeWidth={1.4 * mpp} /></g>
          })}
        </g>
      ))}
      {/* labels */}
      {layers.some(l => l.id === 'streets') && town.layers.find(l => l.id === 'streets')!.features.map(f => { const p: any = (f.geometry as any).paths[0]; const horizontal = p[0][1] === p[1][1]; return <g key={'sl' + f.attributes.OBJECTID}>{horizontal ? label(f.attributes.NAME, p[0][0] + 0.0021, p[0][1], 9.5, 600, '#7a6a48') : label(f.attributes.NAME, p[0][0], p[0][1] + 0.00045, 9.5, 600, '#7a6a48')}</g> })}
      {layers.some(l => l.id === 'parks') && town.layers.find(l => l.id === 'parks')!.drawn().map(f => <g key={'pl' + f.attributes.OBJECTID}>{label(f.attributes.NAME, (f.geometry as any).centroid.x, (f.geometry as any).centroid.y, 11, 600, '#3f6b2c')}</g>)}
      {layers.some(l => l.id === 'zoning') && town.layers.find(l => l.id === 'zoning')!.drawn().map(f => <g key={'zl' + f.attributes.OBJECTID}>{label(f.attributes.ZONE, (f.geometry as any).extent.center.x, (f.geometry as any).extent.center.y + 0.0009, 12, 700, '#4a2f7a')}</g>)}
      {view.scale < 4200 && layers.some(l => l.id === 'parcels') && town.layers.find(l => l.id === 'parcels')!.drawn().map(f => <g key={'al' + f.attributes.OBJECTID}>{label(f.attributes.ADDRESS, (f.geometry as any).centroid.x, (f.geometry as any).centroid.y, 9, 500)}</g>)}
      {town.places.filter(p => /City Hall|Library/.test(p.label)).map(p => <g key={p.label}>{label('★ ' + p.label, p.lon, p.lat + 0.00028, 10.5, 700, '#8f2a1d')}</g>)}
      {/* what Mappy draws: pins, outlines, rings */}
      {view.graphics.items.map((g, i) => {
        const geo: any = g.geometry
        if (!geo) return null
        if (geo.type === 'polygon') return <path key={i} d={path(geo.rings[0], true)} fill='#00b7eb' fillOpacity={0.14} stroke='#00b7eb' strokeWidth={3} vectorEffect='non-scaling-stroke' />
        if (geo.type === 'polyline') return <path key={i} d={path(geo.paths[0], false)} fill='none' stroke='#00b7eb' strokeWidth={3.5} strokeDasharray='8 6' vectorEffect='non-scaling-stroke' />
        const [x, y] = toXY(geo.x, geo.y)
        const ring = g.symbol?.style === 'circle' && Array.isArray(g.symbol?.color) && g.symbol.color[3] === 0
        if (ring) return <circle key={i} cx={x} cy={y} r={11 * mpp} fill='none' stroke='#00b7eb' strokeWidth={3 * mpp} />
        const s = mpp
        return <g key={i} transform={`translate(${x} ${y}) scale(${s})`} className='demo-pin'><path d='M0 0 L-9 -15 C-14 -24 -8 -33 0 -33 C8 -33 14 -24 9 -15 Z' fill='#00b7eb' stroke='#fff' strokeWidth='2' /><circle cy='-21' r='4.5' fill='#fff' /></g>
      })}
    </svg>
  )
}

function App (): any {
  const [tick, setTick] = React.useState(0)
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [mood, setMoodState] = React.useState<any>('wave')
  const [waitNote, setWaitNote] = React.useState('')
  const [picked, setPicked] = React.useState<Graphic | null>(null)
  const [vp, setVp] = React.useState({ w: window.innerWidth, h: window.innerHeight })
  const [panel, setPanel] = React.useState(window.innerWidth > 760)
  const busyRef = React.useRef(false)
  const moodTimer = React.useRef<any>(null)
  const charRef = React.useRef<any>(null)
  const bubbleRef = React.useRef<any>(null)
  const inputRef = React.useRef<any>(null)
  const confused = React.useRef(0)
  const greeted = React.useRef(false)

  React.useEffect(() => {
    injectStyles()
    let raf = 0
    view.onRender = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setTick(t => t + 1) }) }
    waitingNote = setWaitNote
    const onSize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onSize)
    const t = setTimeout(() => setMoodState('idle'), 2600)
    return () => { window.removeEventListener('resize', onSize); clearTimeout(t) }
  }, [])

  const setMood = (m: any) => {
    setMoodState(m)
    clearTimeout(moodTimer.current)
    const ms = MOOD_MS[m] ?? 3200
    if (ms) moodTimer.current = setTimeout(() => setMoodState('idle'), ms)
  }
  const say = (text: string, reply?: any) => setMessages(list => [...list.slice(-60), { id: seq++, from: 'mappy', text, reply }])

  const openChat = () => {
    setOpen(true)
    if (!greeted.current) {
      greeted.current = true
      const back = mind.welcome()
      const text = `${back ? back + ' ' : ''}${back ? 'Welcome back to Mapleton.' : V.greet('Mappy', 'Mapleton')}\n\nMapleton is a made-up town for trying me out. Ask me anything, or pick something from the list.`
      say(text, { text, suggest: ['Show me around', 'turn on zoning', 'who owns 250 Oak St'] })
    }
    setTimeout(() => { try { inputRef.current?.focus() } catch (e) { } }, 80)
  }

  const ask = async (text: string, shown?: string) => {
    if (busyRef.current || !text.trim()) return
    if (!open) openChat()
    busyRef.current = true
    setMessages(list => [...list.slice(-60), { id: seq++, from: 'user', text: shown || text }])
    setBusy(true)
    setMood('think')
    const before = live.snapshot()
    try {
      const reply: any = await mind.respond(text)
      say(reply.text, reply)
      confused.current = reply.mood === 'confused' ? confused.current + 1 : 0
      setMood(reply.chart && !['confused', 'alert', 'attention'].includes(reply.mood || '') ? 'chart' : confused.current >= 2 ? 'sorry' : reply.mood || 'talk')
      if (reply.mood === 'sleep' || reply.mood === 'goodbye') setTimeout(() => setOpen(false), 1500)
    } catch (e) {
      console.error(e)
      say('Oops, I tripped over a fold. Try that again?')
      setMood('alert')
    } finally {
      try { live.remember(before, text) } catch (e) { }
      busyRef.current = false
      setBusy(false)
      setWaitNote('')
    }
  }

  const onAction = async (a: any) => {
    if (a.type === 'ask') { void ask(a.q || '', a.label); return }
    if (a.type === 'url') { if (a.url) { const link = document.createElement('a'); link.href = a.url; link.target = '_blank'; link.rel = 'noopener'; link.click() } return }
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      setMood('acknowledge')
      const r = await mind.act(a)
      if (r === false) { say("I couldn't do that one."); setMood('confused') } else if (a.type === 'layerOn') say('Turned on the layer.', { text: 'x', suggest: ["What's in it?", 'How many in view?'] })
      else if (a.type === 'layerOff') say('Layer turned off.')
    } catch (e) { say("I couldn't complete that action. Try again."); setMood('confused') } finally { busyRef.current = false; setBusy(false) }
  }

  const pickFeature = (g: Graphic | null) => { setPicked(g); if (g) view.popup.open({ features: [g] }); else view.popup.close() }

  // Where the chat sits: beside Mappy, kept inside the window.
  const size = vp.w < 520 ? 92 : 120
  const anchor = { left: vp.w - size - 24, top: vp.h - size * 1.1 - 22, right: vp.w - 24, bottom: vp.h - 22, width: size, height: size * 1.1 }
  const placement = open ? placeBubble(anchor as any, 520, vp.w, vp.h, { maxWidth: 390, maxHeight: Math.min(640, vp.h - size * 1.1 - 60) }) : null
  const visibleMood = busy ? (waitNote ? (/looking at the map/.test(waitNote) ? 'camera' : 'calling') : 'think') : mood

  return (
    <div className='demo-root'>
      <MapSvg tick={tick} onPick={pickFeature} />
      <header className='demo-title'>
        <div><strong>Mapleton</strong><span> a made-up town for trying Mappy</span></div>
        <button type='button' className='demo-toggle' onClick={() => setPanel(p => !p)} aria-expanded={panel}>{panel ? 'Hide ideas' : 'Things to try'}</button>
      </header>
      {panel && <aside className='demo-panel' aria-label='Things to try'>
        <p className='demo-lede'>This is the real Mappy: the same code that runs in ArcGIS Experience Builder, on a pretend map. Click him, type anything, or try these.</p>
        {TRY.map(([group, items]) => <section key={group}><h2>{group}</h2><div className='demo-chips'>{items.map(q => <button type='button' key={q} disabled={busy} onClick={() => { void ask(q) }}>{q}</button>)}</div></section>)}
        <section><h2>Layers</h2><ul className='demo-layers'>{town.layers.slice().reverse().map((l: FakeLayer) => <li key={l.id}><label><input type='checkbox' checked={l.visible} onChange={e => { l.visible = e.target.checked }} /> {l.title}{l.definitionExpression ? <em> (filtered)</em> : null}</label></li>)}</ul></section>
        <p className='demo-fine'>Nothing here is real data, and nothing leaves this page. The "Claude" answers are simulated in your browser to show how an AI helper looks; in a real app they come from your own GIS server. Pet Mappy with the pointer.</p>
      </aside>}
      {picked && <div className='demo-popup' role='dialog' aria-label='Feature details'>
        <button type='button' className='demo-x' aria-label='Close' onClick={() => pickFeature(null)}>×</button>
        <strong>{(picked.layer as FakeLayer).title}</strong>
        <dl>{(picked.layer as FakeLayer).fields.filter(f => f.name !== 'OBJECTID').map(f => { const v = picked.attributes[f.name]; return <React.Fragment key={f.name}><dt>{f.alias}</dt><dd>{/Date/.test(f.type) ? new Date(v).toLocaleDateString() : typeof v === 'number' && f.name !== 'YEAR_BUILT' && f.name !== 'INSTALL_YEAR' && f.name !== 'OPENED' ? v.toLocaleString() : String(v)}</dd></React.Fragment> })}</dl>
        <button type='button' className='demo-ask' onClick={() => { void ask('what did I click') }}>Ask Mappy about this</button>
      </div>}
      <div className='demo-mappy' style={{ width: size, height: size * 1.1 }}>
        <MappyCharacter id='mappy-demo' mood={visibleMood} px={size} label={open ? 'Mappy. Close the chat' : 'Mappy. Open the chat'} expanded={open} controls='mappy-demo-chat' still={false} phase='shown' hat={undefined} lookAt={null} pointDir={null} buttonRef={charRef} onActivate={() => { if (open) setOpen(false); else openChat() }} />
      </div>
      {open && placement && <ChatBubble id='mappy-demo-chat' name='Mappy' messages={messages as any} busy={busy} waitNote={busy ? waitNote : ''} chips={messages.length < 2 ? ['What can you do?', 'List layers', 'Tell me a joke'] : []} vars={CLASSIC as any} placement={placement} bubbleRef={bubbleRef} typewriter
        onSend={(t: string) => { void ask(t) }} onAction={onAction} onResult={(r: any) => { setMood('pleased'); void live.show(r) }} onClose={() => { setOpen(false); setTimeout(() => { try { document.getElementById('mappy-demo')?.focus() } catch (e) { } }, 30) }}
        onReset={() => { if (!busyRef.current) { setMessages([]); void mind.respond('forget context'); greeted.current = false; openChat() } }} onMenu={() => {}} onTyping={(typing: boolean) => { if (!busyRef.current) setMoodState(typing ? 'listen' : 'idle') }}
        complete={(p: string, signal?: AbortSignal) => mind.completeAsync(p, signal)} noDownloads={HOSTED} inputRef={inputRef} size={null} onResize={() => {}} />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
// For the end-to-end test and for the curious: the live pieces, from the browser console.
;(window as any).mappyDemo = { mind, live, view, town }
