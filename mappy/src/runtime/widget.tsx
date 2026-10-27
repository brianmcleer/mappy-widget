/*
  Mappy - a friendly assistant for any Experience Builder app.

  He reads the app he is dropped into (pages, views, windows, every widget, the text, links
  and help configured inside them), the layers that are drawing on the map, whatever the
  builder's deep scan learned (web maps, services, coded values, ArcGIS documentation for the
  out-of-the-box widgets, help guides, widget docs from the EB folder) and the author's own
  answers. He answers questions, opens tools, works through the layer list, and finds
  features. Everything runs in the browser: no model download, no outside AI service.

  Layout: the character, his bubble and his menu are portaled to <body> with fixed
  positions, so no transformed layout container can trap them, and placement.ts keeps all
  three inside the browser tab at any size, on resize, and while he is dragged.
*/
import { React, ReactRedux, ReactDOM } from 'jimu-core'
import type { AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent } from 'jimu-arcgis'
import type { JimuMapView } from 'jimu-arcgis'
import type { IMConfig } from '../config'
import type { Brain, Doc, LayerHint, MappyAction } from '../brain/types'
import type { Reply } from '../brain/answer'
import { MappyIndex } from '../brain/engine'
import { extractApp } from '../brain/extract'
import { adminDocs } from '../brain/admin'
import type { FaqEntry } from '../brain/admin'
import { parseIntent } from '../brain/intents'
import { V } from '../brain/voice'
import { cleanLabel } from '../brain/text'
import { widgetName } from '../brain/builtin'
import { loadMissingManifests } from '../brain/manifests'
import type { ManifestMap } from '../brain/manifests'
import { LiveMap } from './live'
import { Mind } from './mind'
import { configuredGeocoders } from '../brain/addresses'
import { useDesktopWindow } from './desktop'
import MappyCharacter from './components/MappyCharacter'
import type { Mood, PointDir } from './components/MappyCharacter'
import ChatBubble from './components/ChatBubble'
import type { ChatMsg } from './components/ChatBubble'
import MappyMenu from './components/MappyMenu'
import type { MenuItem } from './components/MappyMenu'
import { injectStyles, CLASSIC, themeColors } from './styles'
import { placeBubble, clampCharacter, viewport } from './placement'
import type { Placement } from './placement'
import { useTokens } from './theme'
import { __setIntl, __t } from './i18n-t'
import { beacon } from '../shared/beacon'
import type { BeaconHandle } from '../shared/beacon'

type Props = AllWidgetProps<IMConfig> & { id: string, useMapWidgetIds?: any, intl?: any }

const SIZES = { small: 72, medium: 96, large: 128 }
const MOOD_MS: { [m: string]: number } = { talk: 1600, wave: 2600, happy: 1500, pleased: 1500, acknowledge: 1200, celebrate: 1400, confused: 1400, attention: 2300, point: 2800 }
const LAYER_LIST = /(^|[-_])(map-?layers|layer-?list|layerlist|layers-?custom|toc)([-_]|$)/i

function plain<T> (v: any): T {
  if (!v) return v
  return typeof v.asMutable === 'function' ? v.asMutable({ deep: true }) : v
}

function store (key: string, value?: string | null, session = false): string | null {
  try {
    const s = session ? window.sessionStorage : window.localStorage
    if (value === undefined) return s.getItem(key)
    if (value === null) s.removeItem(key)
    else s.setItem(key, value)
  } catch (e) { }
  return null
}

function reducedMotion (): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false }
}

let msgSeq = 1

export default function Widget (props: Props): any {
  const desktopWindow = useDesktopWindow()
  const desktop = desktopWindow.desktop
  __setIntl(props.intl)
  const cfg: any = props.config || {}
  const name: string = cfg.assistantName || 'Mappy'
  const size: number = SIZES[cfg.size as keyof typeof SIZES] || SIZES.medium
  const tokens = useTokens()
  const uid = 'mappy-' + props.id

  const appConfig = ReactRedux.useSelector((s: any) => s.appConfig)
  const portalSelf = ReactRedux.useSelector((s: any) => s.portalSelf)
  const geocoders = React.useMemo(() => configuredGeocoders(appConfig, portalSelf), [appConfig, portalSelf])
  const appMode = ReactRedux.useSelector((s: any) => s.appRuntimeInfo?.appMode)
  const isDesign = appMode === 'DESIGN'
  const floating = cfg.displayMode !== 'inline' && !isDesign
  const appId: string = String(ReactRedux.useSelector((s: any) => s.appId) || appConfig?.attributes?.title || 'app')
  const appTitle: string = appConfig?.attributes?.title || 'this app'

  // ------------------------------------------------------------------ brain
  const brain = React.useMemo<Brain | null>(() => plain<Brain>(cfg.brain) || null, [cfg.brain])
  const faq = React.useMemo<FaqEntry[]>(() => plain<FaqEntry[]>(cfg.faq) || [], [cfg.faq])
  const live = React.useRef<LiveMap>(new LiveMap()).current
  const [liveVersion, setLiveVersion] = React.useState(0)

  const [fetchedManifests, setFetchedManifests] = React.useState<ManifestMap>({})
  const manifests = React.useMemo(() => ({ ...fetchedManifests, ...(brain?.manifests || {}) }), [fetchedManifests, brain])
  React.useEffect(() => {
    if (!appConfig) return
    let alive = true
    loadMissingManifests(appConfig, brain?.manifests || {}).then(m => { if (alive && Object.keys(m).length) setFetchedManifests(m) }).catch(() => {})
    return () => { alive = false }
  }, [appConfig, brain])

  const extracted = React.useMemo(() => extractApp(appConfig, manifests), [appConfig, manifests])

  // Layer list widgets in the app (Map Layers, Map Layers Custom, any "layer list").
  const layerList = React.useMemo(() => {
    const ws = appConfig?.widgets || {}
    const ids = Object.keys(ws).filter(id => LAYER_LIST.test(widgetName(ws[id]?.uri || '')) && extracted.model.isPlaced(id))
    const label = ids.length ? cleanLabel(ws[ids[0]].label || 'Map Layers') : ''
    return { ids, label }
  }, [appConfig, extracted])

  // What Mappy can see right now: only layers drawing in the layer list.
  const seen = React.useMemo(() => (live.ready ? live.seenKeys() : null), [liveVersion])
  const hints = React.useMemo(() => {
    const m = new Map<string, LayerHint>()
    for (const h of brain?.layers || []) if (!seen || seen.has(h.key)) m.set(h.key, h)
    return m
  }, [brain, seen])

  const index = React.useMemo(() => {
    const docs: Doc[] = []
    docs.push(...extracted.docs)
    if (brain?.docs) docs.push(...brain.docs.filter(d => !d.layer || !seen || seen.has(d.layer)))
    if (live.ready) docs.push(...live.docs())
    docs.push(...adminDocs(faq, cfg.notes))
    return new MappyIndex(docs)
  }, [extracted, brain, faq, cfg.notes, liveVersion, seen])

  const beaconRef = React.useRef<BeaconHandle | null>(null)
  const mindRef = React.useRef<Mind | null>(null)
  const mind = React.useMemo(() => {
    const context = {
    index,
    model: extracted.model,
    live,
    hints,
    name,
    appTitle,
    featureSearch: cfg.featureSearch !== false,
    geocoders,
    maxResults: Math.max(1, Math.min(25, Number(cfg.maxResults) || 8)),
    showInLayerList: cfg.showInLayerList !== false,
    layerListIds: layerList.ids,
    layerListLabel: layerList.label,
    beacon: beaconRef.current
    }
    if (!mindRef.current) mindRef.current = new Mind(context)
    else mindRef.current.ctx = context
    return mindRef.current
  }, [index, extracted, hints, name, appTitle, cfg.featureSearch, cfg.maxResults, cfg.showInLayerList, layerList, geocoders])

  // ------------------------------------------------------------------ map
  const mapWidgetId: string | undefined = React.useMemo(() => {
    const chosen = props.useMapWidgetIds?.[0]
    if (chosen) return chosen
    const ws = appConfig?.widgets || {}
    return Object.keys(ws).find(id => /\/arcgis-map\/$/.test(ws[id]?.uri || '') && extracted.model.isPlaced(id))
  }, [props.useMapWidgetIds, appConfig, extracted])

  const nudgeRef = React.useRef<() => void>(null)
  const onActiveViewChange = React.useCallback((jmv: JimuMapView) => {
    live.bind(jmv)
    live.onLayersChanged = () => setLiveVersion(v => v + 1)
    live.onBusy = () => nudgeRef.current?.()
    setLiveVersion(v => v + 1)
    if (jmv?.view) {
      Promise.resolve(jmv.view.when?.()).then(() => live.warmFields()).then(() => setLiveVersion(v => v + 1)).catch(() => {})
    }
  }, [])

  // ------------------------------------------------------------------ state
  const [open, setOpen] = React.useState(false)
  const [mood, setMoodState] = React.useState<Mood>('idle')
  const [busy, setBusy] = React.useState(false)
  const busyRef = React.useRef(false)
  const [messages, setMessages] = React.useState<ChatMsg[]>([])
  const [phase, setPhase] = React.useState<'enter' | 'shown' | 'exit'>('enter')
  const [hidden, setHidden] = React.useState<boolean>(() => store('mappy-hidden:' + appId, undefined, true) === '1')
  const [paused, setPaused] = React.useState<boolean>(() => store('mappy-paused') === '1')
  const [readAloud, setReadAloud] = React.useState<boolean>(() => store('mappy-read-aloud') === '1')
  const [tipsOff, setTipsOff] = React.useState<boolean>(() => store('mappy-tips-off:' + appId) === '1')
  const [bulb, setBulb] = React.useState<Reply | null>(null)
  const [menu, setMenu] = React.useState<{ x: number, y: number, returnTo: HTMLElement | null } | null>(null)
  const [lookAt, setLookAt] = React.useState<{ x: number, y: number } | null>(null)
  const [pointDir, setPointDir] = React.useState<PointDir | null>(null)
  const [typing, setTyping] = React.useState(false)
  const inputRef = React.useRef<any>(null)
  const charRef = React.useRef<any>(null)
  const bubbleRef = React.useRef<any>(null)
  const moodTimer = React.useRef<any>(null)
  const pointTimer = React.useRef<any>(null)
  const lastInteraction = React.useRef<number>(Date.now())
  const still = paused || reducedMotion()

  const setMood = React.useCallback((m: Mood) => {
    setMoodState(m)
    clearTimeout(moodTimer.current)
    const ms = MOOD_MS[m]
    if (ms) moodTimer.current = setTimeout(() => setMoodState('idle'), ms)
  }, [])

  /** Looks and points at an element (a widget he opened, the layer list, the map). */
  const pointAt = React.useCallback((el: HTMLElement | null | undefined) => {
    const me = charRef.current
    if (!el || !me || typeof el.getBoundingClientRect !== 'function') return
    const r = el.getBoundingClientRect()
    const c = me.getBoundingClientRect()
    const tx = r.left + r.width / 2
    const ty = r.top + r.height / 2
    const dx = tx - (c.left + c.width / 2)
    const dy = ty - (c.top + c.height / 2)
    setLookAt({ x: tx, y: ty })
    setPointDir(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'))
    setMood('point')
    clearTimeout(pointTimer.current)
    pointTimer.current = setTimeout(() => { setLookAt(null); setPointDir(null) }, 2800)
  }, [])

  const speak = React.useCallback((text: string) => {
    if (!readAloud || cfg.allowReadAloud === false) return
    try {
      const synth = (window as any).speechSynthesis
      if (!synth) return
      synth.cancel()
      const u = new (window as any).SpeechSynthesisUtterance(String(text).replace(/\*\*/g, '').replace(/https?:\/\/\S+/g, 'link'))
      u.rate = 1.05
      synth.speak(u)
    } catch (e) { }
  }, [readAloud, cfg.allowReadAloud])

  const say = React.useCallback((text: string, reply?: Reply) => {
    setMessages(list => [...list.slice(-60), { id: msgSeq++, from: 'mappy', text, reply }])
    speak(text)
  }, [speak])

  const focusInput = () => setTimeout(() => { try { inputRef.current?.focus() } catch (e) { } }, 60)

  const openChat = React.useCallback((focus = true) => {
    setOpen(true)
    setBulb(null)
    if (focus) focusInput()
  }, [])

  const closeChat = React.useCallback((returnFocus = true) => {
    setOpen(false)
    try { (window as any).speechSynthesis?.cancel() } catch (e) { }
    if (returnFocus) setTimeout(() => { try { charRef.current?.focus() } catch (e) { } }, 30)
  }, [])

  const greet = React.useCallback(() => say(cfg.greeting || V.greet(name, appTitle)), [cfg.greeting, name, appTitle, say])

  const toggleChat = React.useCallback(() => {
    lastInteraction.current = Date.now()
    if (open) { closeChat(); return }
    if (bulb) { say(bulb.text, bulb); setBulb(null) } else if (!messages.length) greet()
    setMood(messages.length ? 'talk' : 'wave')
    openChat()
  }, [open, messages.length, bulb, greet])

  const handlePoint = (r: any) => { if (r && typeof r === 'object' && typeof r.getBoundingClientRect === 'function') pointAt(r) }

  const ask = React.useCallback(async (text: string, shown?: string) => {
    if (busyRef.current) return
    busyRef.current = true
    lastInteraction.current = Date.now()
    setMessages(list => [...list.slice(-60), { id: msgSeq++, from: 'user', text: shown || text }])
    setBusy(true)
    const intent = parseIntent(text)
    setMood(intent.name === 'find' ? 'search' : 'think')
    try {
      const reply = await mind.respond(text)
      say(reply.text, reply)
      setMood((reply.mood as Mood) || 'talk')
      handlePoint(reply.pointAt)
      if (reply.mood === 'sleep') setTimeout(() => closeChat(true), 1400)
    } catch (e) {
      beaconRef.current?.error(e, 'respond')
      say('Oops, I tripped over a fold. Try that again?')
      setMood('confused')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [mind, say])

  const onAction = React.useCallback(async (a: MappyAction) => {
    lastInteraction.current = Date.now()
    if (a.type === 'ask') { ask(a.q || '', a.label); return }
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const before = live.snapshot()
    try {
    setMood('acknowledge')
    const r = await mind.act(a)
    if (r === false) {
      const where = a.ids?.length ? extracted.model.describePath(extracted.model.pathToWidget(a.ids[0])) : ''
      say(a.type === 'openWidget' || a.type === 'widgetHelp' ? V.cantOpen(a.label?.replace(/^(Open( the)?|Show) |help guide$/g, '').trim() || 'that', where) : "I couldn't do that one.")
      setMood('confused')
      return
    }
    handlePoint(r)
    if (a.type === 'layerOn') say('Selected and turned on the layer. Its row is revealed when a connected layer list is available.', { text: 'Selected and turned on the layer.', suggest: ["What's in it?", 'How many in view?', 'Zoom to it'], actions: [{ type: 'layerOff', id: a.id, label: 'Hide layer' }, { type: 'ask', q: 'undo', label: 'Undo' }] })
    else if (a.type === 'layerOff') say('Layer turned off.', { text: 'Layer turned off.', actions: [{ type: 'ask', q: 'undo', label: 'Undo' }] })
    } catch (e) {
      say("I couldn't complete that action. Try again.")
      setMood('confused')
    } finally {
      live.remember(before, a.label || a.type)
      busyRef.current = false
      setBusy(false)
    }
  }, [mind, extracted, ask, say])

  const onResult = React.useCallback((r: any) => {
    lastInteraction.current = Date.now()
    setMood('pleased')
    live.show(r)
    pointAt(live.mapElement())
  }, [])

  const setTips = (off: boolean) => {
    setTipsOff(off)
    store('mappy-tips-off:' + appId, off ? '1' : null)
    if (off) setBulb(null)
    say(off ? __t('tipsStopped') : __t('tipsStarted'))
  }

  const tipsEnabled = cfg.tipsEnabled !== false && !tipsOff && !isDesign && !hidden

  /** A tip waiting: a light bulb over his head (default), or the bubble opens (tip style "pop"). */
  const offerTip = React.useCallback((reply: Reply, m: Mood = 'attention') => {
    setMood(m)
    if (cfg.tipStyle === 'pop') { say(reply.text, reply); openChat(false) } else setBulb(reply)
  }, [cfg.tipStyle, say])

  nudgeRef.current = () => {
    if (!tipsEnabled || open || bulb) return
    offerTip({ text: V.busyMap(), mood: 'attention' })
  }

  // ------------------------------------------------------------------ position, drag, keyboard
  const side0: 'left' | 'right' = cfg.corner === 'bottom-left' ? 'left' : 'right'
  const posKey = 'mappy-pos:' + appId + ':' + props.id
  const [side, setSide] = React.useState<'left' | 'right'>(() => (store(posKey + ':side') as any) || side0)
  const [pos, setPos] = React.useState<{ x: number, y: number }>(() => {
    try { const p = JSON.parse(store(posKey) || ''); if (p && isFinite(p.x) && isFinite(p.y)) return p } catch (e) { }
    return { x: 20, y: 20 }
  })
  const [vp, setVp] = React.useState(viewport())

  React.useEffect(() => {
    const onResize = () => setVp(viewport())
    window.addEventListener('resize', onResize)
    const vv: any = (window as any).visualViewport
    vv?.addEventListener?.('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); vv?.removeEventListener?.('resize', onResize) }
  }, [])

  const shown = clampCharacter(pos, size, vp.w, vp.h)
  const savePos = (p: { x: number, y: number }, s = side) => { store(posKey, JSON.stringify(p)); store(posKey + ':side', s) }

  const drag = React.useRef<{ sx: number, sy: number, ox: number, oy: number, moved: boolean } | null>(null)
  const justDragged = React.useRef(false)
  const onPointerDown = (e: any) => {
    if (!floating || cfg.draggable === false || e.button > 0) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: shown.x, oy: shown.y, moved: false }
    const move = (ev: any) => {
      const d = drag.current
      if (!d) return
      const dx = ev.clientX - d.sx
      const dy = ev.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 5) return
      d.moved = true
      charRef.current?.classList.add('mappy-dragging')
      setPos(clampCharacter({ x: side === 'right' ? d.ox - dx : d.ox + dx, y: d.oy - dy }, size, vp.w, vp.h))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      charRef.current?.classList.remove('mappy-dragging')
      if (drag.current?.moved) {
        justDragged.current = true
        setTimeout(() => { justDragged.current = false }, 50)
        setPos(p => { savePos(p); return p })
      }
      drag.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const moveBy = (dx: number, dy: number) => {
    const p = clampCharacter({ x: shown.x + (side === 'right' ? -dx : dx), y: shown.y - dy }, size, vp.w, vp.h)
    setPos(p); savePos(p)
  }
  const swapCorner = () => {
    const s = side === 'right' ? 'left' : 'right'
    setSide(s); setPos({ x: 20, y: 20 }); savePos({ x: 20, y: 20 }, s)
    say(__t('movedTo', { corner: s === 'left' ? __t('cornerLeft') : __t('cornerRight') }))
  }
  const resetPos = () => { setSide(side0); setPos({ x: 20, y: 20 }); savePos({ x: 20, y: 20 }, side0) }

  const openMenuAt = (x: number, y: number, returnTo: HTMLElement | null) => setMenu({ x, y, returnTo })
  const openMenuFromChar = () => {
    const r = charRef.current?.getBoundingClientRect()
    if (r) openMenuAt(r.left, r.top - 8, charRef.current)
  }

  const onCharKey = (e: any) => {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); openMenuFromChar(); return }
    if (e.key === 'Escape' && open) { e.preventDefault(); closeChat(); return }
    if (!floating) return
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveBy(-step, 0) } else if (e.key === 'ArrowRight') { e.preventDefault(); moveBy(step, 0) } else if (e.key === 'ArrowUp') { e.preventDefault(); moveBy(0, -step) } else if (e.key === 'ArrowDown') { e.preventDefault(); moveBy(0, step) } else if (e.key === 'Home') { e.preventDefault(); resetPos() }
  }

  const activate = () => { if (justDragged.current) return; toggleChat() }
  const animate = () => {
    lastInteraction.current = Date.now()
    const moods: Mood[] = ['celebrate', 'wave', 'confused', 'pleased', 'search', 'think', 'attention', 'listen']
    setMood(moods[Math.floor(Math.random() * moods.length)])
  }

  const hide = () => {
    closeChat(false)
    setPhase('exit')
    setTimeout(() => { setHidden(true); store('mappy-hidden:' + appId, '1', true) }, 450)
  }
  const show = () => {
    setHidden(false)
    store('mappy-hidden:' + appId, null, true)
    setPhase('enter')
    setTimeout(() => setPhase('shown'), 800)
    setTimeout(() => { try { charRef.current?.focus() } catch (e) { } }, 60)
  }

  const menuItems: MenuItem[] = [
    { id: 'desktop', label: desktop ? 'Return to app' : 'Float on desktop', onSelect: () => {
      if (desktop) { desktopWindow.close(); return }
      void desktopWindow.open().then(() => { setHidden(false); openChat(false) }).catch(() => {
        say('Desktop floating is unavailable here. Open the app directly in a browser with Document Picture-in-Picture support, then choose Float on desktop again.')
        openChat(false)
      })
    } },
    { id: 'chat', label: __t('menuChat'), onSelect: () => { if (!open) toggleChat(); else focusInput() } },
    { id: 'animate', label: __t('menuAnimate'), onSelect: animate },
    { id: 'tip', label: __t('menuTip'), onSelect: () => { const t = mind.tip(); if (t) { say(t.text, t); openChat(false) } } },
    ...(floating ? [{ id: 'move', label: __t('menuMove'), separatorBefore: true, onSelect: swapCorner }, { id: 'reset', label: __t('menuReset'), onSelect: resetPos }] : []),
    { id: 'pause', label: __t('menuPause'), checked: paused, separatorBefore: true, onSelect: () => { const v = !paused; setPaused(v); store('mappy-paused', v ? '1' : null) } },
    ...(cfg.allowReadAloud !== false && typeof window !== 'undefined' && (window as any).speechSynthesis ? [{ id: 'read', label: __t('menuReadAloud'), checked: readAloud, onSelect: () => { const v = !readAloud; setReadAloud(v); store('mappy-read-aloud', v ? '1' : null); if (!v) { try { (window as any).speechSynthesis.cancel() } catch (e) { } } } }] : []),
    ...(cfg.tipsEnabled !== false ? [{ id: 'tips', label: __t('menuTips'), checked: !tipsOff, onSelect: () => setTips(!tipsOff) }] : []),
    { id: 'hide', label: __t('menuHide', { name }), separatorBefore: true, onSelect: hide }
  ]

  // ------------------------------------------------------------------ lifecycle
  React.useEffect(() => {
    injectStyles()
    try { if (cfg.telemetry === true) beaconRef.current = beacon.init(props as any) } catch (e) { }
    mind.ctx.beacon = beaconRef.current
    const t = setTimeout(() => setPhase('shown'), 800)
    return () => { clearTimeout(t); clearTimeout(moodTimer.current); clearTimeout(pointTimer.current); live.unbind(); try { (window as any).speechSynthesis?.cancel() } catch (e) { } }
  }, [])

  React.useEffect(() => { mind.ctx.beacon = beaconRef.current }, [mind])

  // Alt+Shift+M from anywhere: show him, open the chat, put the cursor in the question box.
  React.useEffect(() => {
    if (isDesign) return
    const onKey = (e: any) => {
      if (e.altKey && e.shiftKey && (e.key === 'M' || e.key === 'm' || e.code === 'KeyM')) {
        e.preventDefault()
        if (hidden) show()
        if (!open) toggleChat(); else focusInput()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hidden, open, toggleChat, isDesign])

  // Greeting on a first visit.
  React.useEffect(() => {
    if (isDesign || hidden) return
    const key = 'mappy-greeted:' + appId
    const t = setTimeout(() => {
      if (cfg.greetOnFirstVisit !== false && !store(key)) {
        store(key, '1')
        greet()
        setMood('wave')
        openChat(false)
      } else setMood('wave')
    }, 1400)
    return () => clearTimeout(t)
  }, [isDesign, appId])

  // Tips while the user is idle and the chat is closed.
  React.useEffect(() => {
    if (!tipsEnabled) return
    const every = Math.max(30, Number(cfg.tipIntervalSec) || 180) * 1000
    const h = setInterval(() => {
      if (open || bulb || document.visibilityState !== 'visible') return
      if (Date.now() - lastInteraction.current < 30000) return
      const tip = mind.tip()
      if (tip) offerTip(tip, 'wave')
    }, every)
    return () => clearInterval(h)
  }, [tipsEnabled, cfg.tipIntervalSec, open, bulb, mind])

  // Doze off after five idle minutes with the chat closed.
  React.useEffect(() => {
    const h = setInterval(() => {
      if (!open && mood === 'idle' && Date.now() - lastInteraction.current > 300000) setMoodState('sleep')
    }, 30000)
    return () => clearInterval(h)
  }, [open, mood])

  // Typing in the box: he leans in to listen.
  React.useEffect(() => { if (typing && !busy) setMoodState('listen'); else if (!typing && mood === 'listen') setMoodState('idle') }, [typing])

  // ------------------------------------------------------------------ bubble placement
  const [placement, setPlacement] = React.useState<Placement | null>(null)
  const place = React.useCallback(() => {
    const b = bubbleRef.current
    const c = charRef.current
    if (!b || !c) return
    const log = b.querySelector('.mappy-log') as HTMLElement | null
    const natural = b.offsetHeight - (log ? log.clientHeight - log.scrollHeight : 0)
    const r = c.getBoundingClientRect()
    const v = viewport()
    const next = placeBubble({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, Math.min(natural, 560), v.w, v.h, { preferLeftAligned: r.left + r.width / 2 < v.w / 2 })
    setPlacement(prev => (prev && Math.abs(prev.left - next.left) < 1 && Math.abs(prev.top - next.top) < 1 && prev.maxHeight === next.maxHeight && prev.tail === next.tail && Math.abs(prev.tailOffset - next.tailOffset) < 1 && prev.width === next.width) ? prev : next)
  }, [])

  React.useLayoutEffect(() => { if (open) place(); else setPlacement(null) }, [open, messages.length, busy, shown.x, shown.y, side, vp.w, vp.h, size, phase, desktop])

  React.useEffect(() => {
    if (!open) return
    const b = bubbleRef.current
    const RO = (window as any).ResizeObserver
    if (!b || !RO) return
    const ro = new RO(() => place())
    ro.observe(b)
    const log = b.querySelector('.mappy-log')
    if (log) ro.observe(log)
    window.addEventListener('scroll', place, true)
    return () => { ro.disconnect(); window.removeEventListener('scroll', place, true) }
  }, [open, place, desktop])

  // ------------------------------------------------------------------ render
  const vars = cfg.bubbleStyle === 'theme' ? themeColors(tokens) : CLASSIC
  const custom: string[] = plain<string[]>(cfg.suggestions) || []
  const chips = custom.length
    ? custom
    : mind.suggestions()

  const bubble = open && (
    <ChatBubble
      id={uid + '-chat'}
      name={name}
      messages={messages}
      busy={busy}
      chips={chips}
      vars={vars}
      placement={placement}
      bubbleRef={bubbleRef}
      typewriter={cfg.typewriter !== false && !still}
      onSend={(t) => ask(t)}
      onAction={onAction}
      onResult={onResult}
      onClose={() => closeChat(true)}
      onReset={() => { if (!busyRef.current) { setMessages([]); void mind.respond('forget context'); greet() } }}
      onMenu={(el) => { const r = el.getBoundingClientRect(); openMenuAt(r.left, r.bottom + 4, el) }}
      onTyping={setTyping}
      inputRef={inputRef}
    />
  )

  const hintId = uid + '-hint'
  const character = !hidden && (
    <div style={{ position: 'relative', width: size, height: size * 1.1 }}>
      <MappyCharacter
        id={uid + '-char'}
        mood={busy ? (mood === 'search' ? 'search' : 'think') : mood}
        px={size}
        label={__t('characterLabel', { name })}
        expanded={open}
        controls={uid + '-chat'}
        describedBy={hintId}
        still={still}
        phase={phase}
        lookAt={desktop ? null : lookAt}
        pointDir={desktop ? null : pointDir}
        onActivate={activate}
        onPointerDown={desktop ? undefined : onPointerDown}
        onDoubleClick={animate}
        onKeyDown={desktop ? undefined : onCharKey}
        onContextMenu={(e: any) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY, charRef.current) }}
        buttonRef={charRef}
      />
      <span id={hintId} className='mappy-sr'>{__t('characterHint', { name })}</span>
      {bulb && !open && (
        <button type='button' className='mappy-bulb' aria-label={__t('bulbLabel', { name })} title={__t('bulbLabel', { name })} onClick={toggleChat}>
          <span aria-hidden='true'>{'\u{1F4A1}'}</span>
        </button>
      )}
    </div>
  )

  const menuEl = menu && (
    <MappyMenu
      x={menu.x}
      y={menu.y}
      label={__t('menuLabel', { name })}
      items={menuItems}
      onClose={(ret) => { const to = menu.returnTo; setMenu(null); if (ret) setTimeout(() => { try { (to && document.contains(to) ? to : charRef.current)?.focus() } catch (e) { } }, 20) }}
    />
  )

  const mapBridge = mapWidgetId ? <JimuMapViewComponent useMapWidgetId={mapWidgetId} onActiveViewChange={onActiveViewChange} /> : null
  const note = (
    <div className='mappy-panel-note' style={{ color: tokens.textSecondary }}>
      {hidden
        ? <React.Fragment><span>{__t('hiddenNote', { name })}</span><button type='button' className='mappy-btn' style={{ ...CLASSIC as any }} onClick={show}>{__t('showMappy', { name })}</button></React.Fragment>
        : <span>{isDesign ? __t('designNote', { name }) : floating ? __t('floatingNote', { name }) : ''}</span>}
    </div>
  )

  const overlay = (
    <div className='mappy-layer' style={{ ['--mappy-focus' as any]: (vars as any)['--mappy-focus'] }}>
      {(floating || desktop) && character && (
        <div className='mappy-char-wrap' style={{ bottom: shown.y, [side]: shown.x } as any}>{character}</div>
      )}
      {bubble}
      {menuEl}
      {desktop && <div className='mappy-desktop-bar'><span>Move this window using its title bar.</span><button type='button' onClick={desktopWindow.close}>Return to app</button></div>}
    </div>
  )

  return (
    <div className='jimu-widget mappy-widget' style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      {mapBridge}
      {(!floating || hidden || isDesign) && note}
      {!floating && !desktop && character && <div className='mappy-inline'>{character}</div>}
      {typeof document !== 'undefined' && ReactDOM.createPortal(overlay, desktop?.document.body || document.body)}
    </div>
  )
}
