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
import { React, ReactRedux, ReactDOM, SessionManager } from 'jimu-core'
import type { AllWidgetProps } from 'jimu-core'
import { JimuMapViewComponent } from 'jimu-arcgis'
import type { JimuMapView } from 'jimu-arcgis'
import type { IMConfig } from '../config'
import type { Brain, Doc, LayerHint, MappyAction } from '../brain/types'
import type { Reply } from '../brain/answer'
import { MappyIndex } from '../brain/engine'
import { applyLanguagePack, languagePack } from '../brain/language'
import { DEFAULT_FEED_URL, feedDocs, describeFeed } from '../brain/feed'
import type { KnowledgeFeed } from '../brain/feed'
import { cachedFeed, loadFeed } from './feed'
import { addTerms } from '../brain/glossary'
import { warmProjection, needsProjection } from './project'
import { extractApp } from '../brain/extract'
import { adminDocs } from '../brain/admin'
import type { FaqEntry } from '../brain/admin'
import { parseIntent } from '../brain/intents'
import { V, pick } from '../brain/voice'
import { season, dayFeel } from '../brain/fun'
import { cleanLabel } from '../brain/text'
import { widgetName } from '../brain/builtin'
import { loadMissingManifests } from '../brain/manifests'
import type { ManifestMap } from '../brain/manifests'
import { LiveMap } from './live'
import { Mind } from './mind'
import { openInTable, tableWidgetIds } from './tableWidget'
import { McpClient } from './mcp'
import type { McpPort } from '../brain/mcpTools'
import { configuredGeocoders } from '../brain/addresses'
import { useDesktopWindow } from './desktop'
import MappyCharacter from './components/MappyCharacter'
import type { Mood, PointDir } from './components/MappyCharacter'
import ChatBubble from './components/ChatBubble'
import type { ChatMsg } from './components/ChatBubble'
import MappyMenu from './components/MappyMenu'
import type { MenuItem } from './components/MappyMenu'
import { injectStyles, CLASSIC, themeColors } from './styles'
import { play, soundFor } from './sounds'
import { placeBubble, clampCharacter, viewport } from './placement'
import type { Placement } from './placement'
import { useTokens } from './theme'
import { __setIntl, __t } from './i18n-t'
import { beacon } from '../shared/beacon'
import type { BeaconHandle } from '../shared/beacon'

type Props = AllWidgetProps<IMConfig> & { id: string, useMapWidgetIds?: any, intl?: any }

const SIZES = { small: 72, medium: 96, large: 128 }
const MOOD_MS: { [m: string]: number } = {
  talk: 1600, wave: 2600, happy: 1500, pleased: 1500, acknowledge: 1200, celebrate: 1400, confused: 1400, attention: 2300, point: 2800, love: 2800, excited: 2300, dance: 3600, roll: 1300, dizzy: 2600, party: 5200,
  // the Clippy pack: long enough for the act to finish (processing stays until the answer comes)
  writing: 3600, checking: 3000, alert: 2200, explain: 3600, knock: 2600, print: 2800, trash: 3400, mail: 2600, save: 2800, artsy: 3600, techy: 3400, wizardy: 3800, airplane: 4400, bike: 3800, congratulate: 3200, goodbye: 1800
}
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
  // His size: the app author's choice, or what the person asked for ("make yourself smaller"), remembered.
  const [sizeStep, setSizeStep] = React.useState<number>(() => { const v = Number(store('mappy-size-step')); return Number.isFinite(v) && v >= -2 && v <= 2 ? v : 0 })
  const baseSize: number = SIZES[cfg.size as keyof typeof SIZES] || SIZES.medium
  const size: number = Math.round(baseSize * Math.pow(1.3, sizeStep))
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

  // The knowledge feed: fetched once a day (cached in this browser), never waited for. He
  // starts with the bundled knowledge and takes the feed's newer words, answers, terms,
  // facts and tips when they arrive. Off, or your own copy, in settings.
  const feedUrl = (cfg.feedUrl || '').trim() || DEFAULT_FEED_URL
  const feedOn = cfg.feed !== false
  const [feed, setFeed] = React.useState<KnowledgeFeed | null>(() => (feedOn ? cachedFeed(feedUrl) : null))
  React.useEffect(() => {
    if (!feedOn) { setFeed(null); return }
    let alive = true
    const ctl = new AbortController()
    loadFeed(feedUrl, { signal: ctl.signal }).then(r => { if (alive && r.feed) setFeed(r.feed) }).catch(() => {})
    return () => { alive = false; ctl.abort() }
  }, [feedOn, feedUrl])
  React.useEffect(() => { if (feed?.glossary.length) { try { addTerms(feed.glossary) } catch (e) { } } }, [feed])

  // A language pack the builder pulled in settings (newer words, phrasings, misspellings),
  // and the feed's pack when that is newer still.
  const langVersion = React.useMemo(() => {
    if (cfg.languagePack) applyLanguagePack(plain<any>(cfg.languagePack))
    if (feed?.languagePack) { try { applyLanguagePack(feed.languagePack) } catch (e) { } }
    return languagePack().version
  }, [cfg.languagePack, feed])

  const index = React.useMemo(() => {
    const docs: Doc[] = []
    docs.push(...extracted.docs)
    if (brain?.docs) docs.push(...brain.docs.filter(d => !d.layer || !seen || seen.has(d.layer)))
    if (live.ready) docs.push(...live.docs())
    docs.push(...feedDocs(feed))
    docs.push(...adminDocs(faq, cfg.notes))
    return new MappyIndex(docs)
  }, [extracted, brain, faq, cfg.notes, liveVersion, seen, langVersion, feed])

  // The MCP server the builder connected (the second way Mappy can help). The signed-in
  // ArcGIS user's token is sent only when the builder chose "ArcGIS sign-in".
  const mcpConfig = React.useMemo(() => plain<any>(cfg.mcp) || null, [cfg.mcp])
  const mcp = React.useMemo<McpPort | null>(() => {
    if (!mcpConfig?.url || mcpConfig.enabled === false) return null
    try {
      const client = new McpClient(mcpConfig, () => { try { return SessionManager.getInstance().getMainSession()?.token || null } catch (e) { return null } })
      return { label: mcpConfig.label || 'the MCP server', fallback: mcpConfig.fallback !== false, prefs: mcpConfig.tools || [], tools: () => client.listTools(), call: (n: string, a: any) => client.callTool(n, a) }
    } catch (e) { return null }
  }, [mcpConfig])

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
    beacon: beaconRef.current,
    mcp,
    typoFix: cfg.typoFix !== false,
    fun: cfg.fun !== false,
    place: {
      org: (cfg.orgName || '').trim() || (portalSelf?.name ? String(portalSelf.name) : '') || 'the City',
      name: (cfg.placeName || '').trim(),
      website: (cfg.website || '').trim(),
      facts: String(cfg.localFacts || '').split(/\r?\n/).map(f => f.trim()).filter(Boolean).concat(feed?.facts || [])
    },
    feedInfo: feed ? describeFeed(feed) : undefined,
    widgetId: props.id,
    myLocation: () => new Promise<[number, number] | null>(resolve => {
      try {
        if (!navigator.geolocation) { resolve(null); return }
        navigator.geolocation.getCurrentPosition(p => resolve([p.coords.latitude, p.coords.longitude]), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
      } catch (e) { resolve(null) }
    }),
    openInTable: tableWidgetIds(extracted.model?.cfg).length ? (entry: any, req: any) => openInTable(live, extracted.model, entry, req, props.id) : undefined
    }
    if (!mindRef.current) mindRef.current = new Mind(context)
    else mindRef.current.ctx = context
    return mindRef.current
  }, [index, extracted, hints, name, appTitle, cfg.featureSearch, cfg.maxResults, cfg.showInLayerList, layerList, geocoders, mcp, cfg.typoFix, cfg.fun, cfg.orgName, cfg.placeName, cfg.website, cfg.localFacts, feed, portalSelf?.name, props.id])

  // ------------------------------------------------------------------ map
  const mapWidgetId: string | undefined = React.useMemo(() => {
    const chosen = props.useMapWidgetIds?.[0]
    if (chosen) return chosen
    const ws = appConfig?.widgets || {}
    return Object.keys(ws).find(id => /\/arcgis-map\/$/.test(ws[id]?.uri || '') && extracted.model.isPlaced(id))
  }, [props.useMapWidgetIds, appConfig, extracted])

  const nudgeRef = React.useRef<() => void>(null)
  const popupRef = React.useRef<(title: string) => void>(null)
  const onActiveViewChange = React.useCallback((jmv: JimuMapView) => {
    live.bind(jmv)
    live.onLayersChanged = () => setLiveVersion(v => v + 1)
    live.onBusy = () => nudgeRef.current?.()
    live.onPopup = (title) => popupRef.current?.(title)
    // Local coordinate systems (state plane): load the projection engine now, so places read right away.
    try { if (needsProjection(jmv?.view?.spatialReference)) warmProjection().catch(() => {}) } catch (e) { }
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
  // The conversation survives a reload of the page (this tab only): the last 40 messages, words and
  // buttons only; map results and tables are not kept.
  const chatKey = 'mappy-chat:' + appId
  const [messages, setMessages] = React.useState<ChatMsg[]>(() => {
    try {
      const saved = JSON.parse(store(chatKey, undefined, true) || '[]')
      if (!Array.isArray(saved) || !saved.length) return []
      const list: ChatMsg[] = saved.filter((m: any) => m && (m.from === 'user' || m.from === 'mappy') && typeof m.text === 'string').map((m: any) => ({ id: msgSeq++, from: m.from, text: String(m.text).slice(0, 4000), reply: m.reply ? { text: String(m.reply.text || m.text), suggest: Array.isArray(m.reply.suggest) ? m.reply.suggest.slice(0, 5).map(String) : undefined, actions: Array.isArray(m.reply.actions) ? m.reply.actions.filter((a: any) => a && ((a.type === 'ask' && typeof a.q === 'string') || (a.type === 'url' && typeof a.url === 'string' && /^https:\/\//.test(a.url))) && typeof a.label === 'string').slice(0, 4) : undefined } : undefined }))
      return list.length ? [...list, { id: msgSeq++, from: 'mappy', text: 'Welcome back! That was our chat before the page reloaded. What next?', ephemeral: true }] : []
    } catch (e) { return [] }
  })
  React.useEffect(() => {
    try {
      const keep = messages.filter(m => !m.ephemeral).slice(-40).map(m => ({ from: m.from, text: m.text, reply: m.reply ? { text: m.reply.text, suggest: m.reply.suggest, actions: (m.reply.actions || []).filter(a => a.type === 'ask' || a.type === 'url').map(a => ({ type: a.type, q: a.q, url: a.url, label: a.label })) } : undefined }))
      store(chatKey, keep.length ? JSON.stringify(keep) : null, true)
    } catch (e) { }
  }, [messages])
  const [phase, setPhase] = React.useState<'enter' | 'shown' | 'exit'>('enter')
  const [hidden, setHidden] = React.useState<boolean>(() => store('mappy-hidden:' + appId, undefined, true) === '1')
  const [paused, setPaused] = React.useState<boolean>(() => store('mappy-paused') === '1')
  const [readAloud, setReadAloud] = React.useState<boolean>(() => store('mappy-read-aloud') === '1')
  const [tipsOff, setTipsOff] = React.useState<boolean>(() => store('mappy-tips-off:' + appId) === '1')
  // The chat's size when the user resized it (drag the corner grip, or arrow keys on it); null is automatic.
  const [chatSize, setChatSize] = React.useState<{ w: number, h: number } | null>(() => {
    try { const v = JSON.parse(store('mappy-chat-size:' + appId) || 'null'); return v && v.w > 0 && v.h > 0 ? v : null } catch (e) { return null }
  })
  const resizeChat = React.useCallback((next: { w: number, h: number } | null, done: boolean) => {
    const v = viewport()
    const fit = next ? { w: Math.round(Math.max(280, Math.min(next.w, v.w - 16))), h: Math.round(Math.max(240, Math.min(next.h, v.h - 16))) } : null
    setChatSize(fit)
    if (done) store('mappy-chat-size:' + appId, fit ? JSON.stringify(fit) : null)
  }, [appId])
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
  const lastSeen = React.useRef<number>(Date.now())
  const still = paused || reducedMotion()
  const stillRef = React.useRef(still); stillRef.current = still

  const setMood = React.useCallback((m: Mood) => {
    setMoodState(m)
    // His little noises (settings: Sound effects), never while paused or under reduced motion.
    if (cfg.sounds && !stillRef.current) { const snd = soundFor(m); if (snd) play(snd) }
    clearTimeout(moodTimer.current)
    const ms = MOOD_MS[m]
    if (ms) moodTimer.current = setTimeout(() => setMoodState('idle'), ms)
  }, [cfg.sounds])

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

  const messagesRef = React.useRef<ChatMsg[]>([]); messagesRef.current = messages
  const copyText = (text: string) => {
    const plain = String(text || '').replace(/\*\*/g, '')
    try { navigator.clipboard?.writeText(plain) } catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = plain; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove() } catch (err) { }
    }
  }
  /** The conversation as a text file the browser saves ("export chat"). */
  const exportChat = () => {
    try {
      const stamp = new Date()
      const lines = [`${name} chat, ${appTitle}, ${stamp.toLocaleString()}`, ''].concat(messagesRef.current.map(m => `${m.from === 'user' ? 'You' : name}: ${String(m.text).replace(/\*\*/g, '')}`))
      const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${name.toLowerCase()}-chat-${stamp.toISOString().slice(0, 10)}.txt`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) { }
  }

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

  // The greeting, plus a line for the time of year (Halloween, GIS Day, Thanksgiving...).
  // Once per update, a line about what is new (returning people only; a first visit gets the plain greeting).
  const NEWS_KEY = '2026-10-29d'
  const NEWS = 'New since last time: say "show me around" for a tour of the app\'s tools, "what did I change" for everything I did to the map, "try again" after a hiccup, and "what did I click" when a popup is open. "What is on the map" sums up the view; "copy that" and "export chat" keep answers. Suggestions appear as you type (Tab takes the first). Plus an outfit for 80 days of the year and "what is an easement".'
  const greet = React.useCallback(() => {
    const extra = cfg.fun === false ? '' : [season().greeting, dayFeel().line].filter(Boolean).join(' ')
    let news = ''
    let first = false
    try {
      const greetedKey = 'mappy-greeted:' + appId
      if (!store(greetedKey)) { store(greetedKey, '1'); store('mappy-news', NEWS_KEY); first = true } else if (store('mappy-news') !== NEWS_KEY) { news = NEWS; store('mappy-news', NEWS_KEY) }
    } catch (e) { }
    // First visit: offer the tour, so nobody has to guess what to type.
    const text = (cfg.greeting || V.greet(name, appTitle)) + (extra ? '\n\n' + extra : '') + (news ? '\n\n' + news : '') + (first ? '\n\nNew here? Say "show me around" and I will walk you through the app.' : '')
    say(text, first ? { text, suggest: ['Show me around', 'What is on the map', 'Help'] } : undefined)
  }, [cfg.greeting, name, appTitle, say, appId])

  const toggleChat = React.useCallback(() => {
    lastInteraction.current = Date.now()
    if (open) { closeChat(); return }
    if (bulb) { say(bulb.text, bulb); setBulb(null) } else if (!messages.length) greet()
    // Back after a while: he is thrilled to see you.
    // The day's mood on the first hello (party on New Year, a dance on Dance Day), else a wave.
    const today = cfg.fun === false ? undefined : season().mood
    setMood(Date.now() - lastSeen.current > 600000 && messages.length ? 'excited' : messages.length ? 'talk' : today || 'wave')
    lastSeen.current = Date.now()
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
    // Taking a while (a server call, a big query): gears turn.
    const gears = setTimeout(() => setMood('processing'), 1400)
    try {
      const reply = await mind.respond(text)
      clearTimeout(gears)
      // "Copy that": the last answer before this one. "Export chat": the whole conversation as text.
      if (reply.effect === 'copy') { const prev = [...messagesRef.current].reverse().find(m => m.from === 'mappy'); if (prev) copyText(prev.text) }
      if (reply.effect === 'export') exportChat()
      say(reply.text, reply)
      setMood((reply.mood as Mood) || 'talk')
      handlePoint(reply.pointAt)
      if (reply.mood === 'sleep') setTimeout(() => closeChat(true), 1400)
      if (reply.mood === 'goodbye') setTimeout(() => closeChat(true), 1500)
      // Things he does to himself: hold still, speak, grow or shrink, change corner.
      if (reply.effect === 'pause' || reply.effect === 'resume') { const v = reply.effect === 'pause'; setPaused(v); store('mappy-paused', v ? '1' : null) }
      if (reply.effect === 'speak' && cfg.allowReadAloud !== false) { try { const synth = (window as any).speechSynthesis; if (synth) { synth.cancel(); const u = new (window as any).SpeechSynthesisUtterance(reply.text.replace(/^Reading that aloud: /, '').replace(/\*\*/g, '')); synth.speak(u) } } catch (e) { } }
      if (reply.effect === 'smaller' || reply.effect === 'bigger') setSizeStep(s => { const next = Math.max(-2, Math.min(2, s + (reply.effect === 'smaller' ? -1 : 1))); store('mappy-size-step', next ? String(next) : null); return next })
      if (reply.effect === 'left' || reply.effect === 'right' || reply.effect === 'otherCorner') { const cur = sideRef.current; const want = reply.effect === 'otherCorner' ? (cur === 'right' ? 'left' : 'right') : reply.effect; if (want !== cur) swapRef.current(false) }
    } catch (e) {
      beaconRef.current?.error(e, 'respond')
      say('Oops, I tripped over a fold. Try that again?', { text: 'Oops, I tripped over a fold. Try that again?', suggest: ['Try again'] })
      setMood('alert')
    } finally {
      clearTimeout(gears)
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
  const offerTip = React.useCallback((reply: Reply, m: Mood = 'knock') => {
    setMood(m)
    if (cfg.tipStyle === 'pop') { say(reply.text, reply); openChat(false) } else setBulb(reply)
  }, [cfg.tipStyle, say])

  nudgeRef.current = () => {
    if (!tipsEnabled || open || bulb) return
    offerTip({ text: V.busyMap(), mood: 'attention' })
  }

  // A popup opened on a feature: once in a while, a bulb with what he can do for that layer.
  const popupTipAt = React.useRef(0)
  popupRef.current = (title: string) => {
    if (!tipsEnabled || open || bulb || !title) return
    if (Date.now() - popupTipAt.current < 180000) return
    popupTipAt.current = Date.now()
    offerTip({
      text: `You opened a **${title}** feature. I can tell you what it says, count them in view, or list its fields.`,
      mood: 'knock',
      suggest: ['What did I click', `How many ${title} in view`, `Fields in ${title}`]
    })
  }

  // ------------------------------------------------------------------ position, drag, keyboard
  const side0: 'left' | 'right' = cfg.corner === 'bottom-left' ? 'left' : 'right'
  const posKey = 'mappy-pos:' + appId + ':' + props.id
  const [side, setSide] = React.useState<'left' | 'right'>(() => (store(posKey + ':side') as any) || side0)
  const sideRef = React.useRef(side); sideRef.current = side
  const swapRef = React.useRef<(tell?: boolean) => void>(() => {})
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
      window.removeEventListener('pointercancel', up)
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
    window.addEventListener('pointercancel', up)
  }

  const moveBy = (dx: number, dy: number) => {
    const p = clampCharacter({ x: shown.x + (side === 'right' ? -dx : dx), y: shown.y - dy }, size, vp.w, vp.h)
    setPos(p); savePos(p)
  }
  const swapCorner = (tell = true) => {
    const s = side === 'right' ? 'left' : 'right'
    setSide(s); setPos({ x: 20, y: 20 }); savePos({ x: 20, y: 20 }, s)
    if (tell) say(__t('movedTo', { corner: s === 'left' ? __t('cornerLeft') : __t('cornerRight') }))
  }
  swapRef.current = swapCorner
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

  // Click him lots in a row and he gets dizzy.
  const clicks = React.useRef<number[]>([])
  const activate = () => {
    if (justDragged.current) return
    const now = Date.now()
    clicks.current = [...clicks.current.filter(t => now - t < 2500), now]
    if (cfg.sounds && !stillRef.current && clicks.current.length >= 2 && clicks.current.length < 6) play('boing')
    if (clicks.current.length >= 6) { clicks.current = []; setMood('dizzy'); if (!open) openChat(false); say(pick(['Whoa, whoa... the room is spinning. Which way is north? 😵‍💫', 'Okay okay, I am dizzy! Everything looks like Web Mercator.', 'Too... many... clicks... I see three compasses. 😵'])); return }
    toggleChat()
  }

  // The Konami code (up up down down left right left right B A) anywhere in the app: party mode.
  React.useEffect(() => {
    const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
    if (isDesign) return
    let at = 0
    const onKey = (e: any) => {
      // Not while typing somewhere (the chat box uses the arrow keys for its history).
      const el: any = e.target
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName || ''))) { at = 0; return }
      const k = e.key && e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (k === code[at]) at++
      else if (k === 'ArrowUp' && at === 2) at = 2 // a third up arrow still counts as the start
      else at = k === code[0] ? 1 : 0
      if (at === code.length) {
        at = 0
        setMood('party')
        if (!open) openChat(false)
        say('🎮 You found the secret code! PARTY MODE! 🎉 +30 lives, +1 best friend.')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openChat, say, setMood, isDesign])
  const animate = () => {
    lastInteraction.current = Date.now()
    const moods: Mood[] = ['celebrate', 'wave', 'love', 'excited', 'confused', 'pleased', 'search', 'think', 'attention', 'listen', 'airplane', 'wizardy', 'artsy', 'techy', 'bike', 'trash', 'congratulate', 'processing', 'knock']
    setMood(pick(moods))
  }

  const hide = () => {
    closeChat(false)
    if (cfg.sounds && !stillRef.current) play('whoosh')
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
      void desktopWindow.open(`${name} · ${appTitle}`).then(() => { setHidden(false); openChat(false) }).catch(() => {
        say('Desktop floating is unavailable here. Open the app directly in a browser with Document Picture-in-Picture support, then choose Float on desktop again.')
        openChat(false)
      })
    } },
    { id: 'chat', label: __t('menuChat'), onSelect: () => { if (!open) toggleChat(); else focusInput() } },
    { id: 'animate', label: __t('menuAnimate'), onSelect: animate },
    { id: 'tip', label: __t('menuTip'), onSelect: () => { const t = mind.tip(); if (t) { say(t.text, t); openChat(false) } } },
    ...(floating ? [{ id: 'move', label: __t('menuMove'), separatorBefore: true, onSelect: () => swapCorner() }, { id: 'reset', label: __t('menuReset'), onSelect: resetPos }] : []),
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
  // Warm up the typo reader while the page is idle, so the first answer is not slower.
  React.useEffect(() => {
    const w: any = window
    const run = () => mind.warm()
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500)
    return () => { try { if (w.cancelIdleCallback) w.cancelIdleCallback(id); else clearTimeout(id) } catch (e) { } }
  }, [mind, index])

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
  React.useEffect(() => { if (typing && !busy) { clearTimeout(moodTimer.current); setMoodState('listen') } else if (!typing && mood === 'listen') setMoodState('idle') }, [typing])

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
    const next = placeBubble({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, chatSize ? chatSize.h : Math.min(natural, 560), v.w, v.h, { preferLeftAligned: r.left + r.width / 2 < v.w / 2, ...(chatSize ? { maxWidth: chatSize.w, maxHeight: chatSize.h } : {}) })
    setPlacement(prev => (prev && Math.abs(prev.left - next.left) < 1 && Math.abs(prev.top - next.top) < 1 && prev.maxHeight === next.maxHeight && prev.tail === next.tail && Math.abs(prev.tailOffset - next.tailOffset) < 1 && prev.width === next.width) ? prev : next)
  }, [chatSize])

  React.useLayoutEffect(() => { if (open) place(); else setPlacement(null) }, [open, messages.length, busy, shown.x, shown.y, side, vp.w, vp.h, size, phase, desktop, chatSize])

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

  // In its own window Mappy rides in the header, small and still: the window is the chat.
  const miniChar = desktop && !hidden && (
    <MappyCharacter
      id={uid + '-mini'}
      mood={busy ? (mood === 'search' ? 'search' : 'think') : mood}
      px={34}
      label={__t('characterLabel', { name })}
      expanded
      controls={uid + '-chat'}
      still={still}
      phase={phase}
      lookAt={null}
      pointDir={null}
      hat={cfg.fun === false ? null : undefined}
      onActivate={() => inputRef.current?.focus()}
      onDoubleClick={animate}
      onContextMenu={(e: any) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY, null) }}
    />
  )

  const bubble = (open || desktop) && (
    <ChatBubble
      id={uid + '-chat'}
      name={name}
      task={mind.task()}
      messages={messages}
      busy={busy}
      chips={chips}
      complete={(p: string, signal?: AbortSignal) => mind.completeAsync(p, signal)}
      vars={vars}
      placement={placement}
      size={chatSize}
      onHeadDrag={floating && !desktop && cfg.draggable !== false ? onPointerDown : undefined}
      onResize={resizeChat}
      bubbleRef={bubbleRef}
      typewriter={cfg.typewriter !== false && !still}
      onSend={(t) => ask(t)}
      onAction={onAction}
      onResult={onResult}
      onClose={() => closeChat(true)}
      onReset={() => { if (!busyRef.current) { setMessages([]); store(chatKey, null, true); void mind.respond('forget context'); greet() } }}
      onMenu={(el) => { const r = el.getBoundingClientRect(); openMenuAt(r.left, r.bottom + 4, el) }}
      onTyping={setTyping}
      inputRef={inputRef}
      docked={desktop ? { avatar: miniChar, subtitle: appTitle, onReturn: desktopWindow.close } : undefined}
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
        hat={cfg.fun === false ? null : undefined}
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
      {floating && !desktop && character && (
        <div className='mappy-char-wrap' style={{ bottom: shown.y, [side]: shown.x } as any}>{character}</div>
      )}
      {bubble}
      {menuEl}
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
