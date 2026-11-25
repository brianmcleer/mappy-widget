/*
  mind.ts - Mappy's conversation loop: intent -> plan -> act -> reply.

  Knowledge comes from the index (app config, deep scan, ArcGIS docs pack, the author's FAQ,
  and the layers that are drawing); hands come from LiveMap (map) and navigate.ts (app).
  Layer work goes through the layer list: Mappy opens it, makes the change, and flashes the
  row, so the user sees the change where they would have made it themselves.
*/
import type { Doc, LayerHint, MappyAction } from '../brain/types'
import type { MappyIndex } from '../brain/engine'
import type { AppModel } from '../brain/appModel'
import type { Reply, ListRow } from '../brain/answer'
import { answerQuestion, describeDoc } from '../brain/answer'
import { followPlaceQuestion } from '../brain/placeFollowup'
import { parseIntent } from '../brain/intents'
import { addressPrompt, addressPlace, resultNumber } from '../brain/addresses'
import type { GeocoderSource } from '../brain/addresses'
import { geocodeAddress } from './geocoder'
import type { AddressResult } from './geocoder'
import { contextualCommand, normalizeCommand, splitCommands } from '../brain/conversation'
import { lexiconFor, readRequest, didYouMean } from '../brain/language'
import { matchTool, rankTools, fillArgs, toolAnswer, toolValueError, usableTools, needsConfirm, toolLabel, describeArgs, viewResult, parsePlaceQuestion, placeToolFits, placeKeys, looksLikePlace, closestChoice } from '../brain/mcpTools'
import type { McpPort, McpTool, MapContext, PlaceQuestion } from '../brain/mcpTools'
import { parseRoute, esriHelperTool, esriCatalog, toolData, toolError, readCandidates, geocodeArgs, readReverse, routeArgs, readRoute, parseContentSearch, searchArgs, readItems, queryable, describeLayerArgs, describeItemArgs, pickLayer, readLayerSchema, readMapImage, readJob, askedThing, layerRef, type EsriCatalog, type PortalItem } from '../brain/esriMcp'
import { RemoteLayer, type RemoteSchema } from './esriMcp'
import { splitSpatial, distanceSwap, relationSaid, NEAR_FEET, type SpatialRead } from '../brain/spatial'
import { scopeAsIds, rebase, anchorFromLayer, areaAt, pointAnchor, buildScope, countPerArea, anchorRings, anchorPoint, noticeList, MAX_ANCHORS, MAX_IDS, type Anchor, type Scope } from './spatial'
import { handoffUrl, parseHandoff, assistantJob, contextLine, usageQuestion, usageNote } from '../brain/handoff'

/** A card number or a US Social Security number typed into a question. */
function looksPrivate (text: string): boolean {
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true
  for (const m of text.match(/\b(?:\d[ -]?){13,19}\b/g) || []) {
    const digits = m.replace(/\D/g, '')
    if (digits.length < 13 || digits.length > 19) continue
    // The Luhn check that every payment card number passes.
    let sum = 0
    for (let i = 0; i < digits.length; i++) { let d = Number(digits[digits.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9 } sum += d }
    if (sum % 10 === 0) return true
  }
  return false
}

/** Moods that are feelings, not answers: "try again" never re-runs what led to them. */
const EMOTIONS = ['sorry', 'sad', 'shy', 'proud', 'surprised', 'laugh', 'hug', 'grateful', 'cheer', 'sleepy', 'curious']

/** Questions about what is on screen right now, where a picture of the map helps. */
const ABOUT_THE_SCREEN = /\b(?:on (?:the|this|my) (?:map|screen)|(?:this|the) (?:map|view|picture|area|screen)\b|what am i (?:looking at|seeing)|what do you see|can you see|look at (?:this|the map|these)|in view|shown here|these|those)\b/i

/** The GIS server's tool that hands a question to Claude on the server (gis_mcp.py ask_assistant). */
const ASK_TOOL = 'ask_assistant'
const FEEDBACK_TOOL = 'assistant_feedback'
const USAGE_TOOL = 'assistant_usage'
import type { AssistantPort, HandoffContext } from '../brain/handoff'
import { feel, readBond, bumpBond, milestone, welcomeBack, emptyBond } from '../brain/feelings'
import type { Bond } from '../brain/feelings'
import { parseAnalysis, analysisFollowup, resultCountFollowup, resultTableFollowup, tablePhrase, resolveField, compileConditions } from '../brain/analysis'
import { reviseTask, taskSummary } from '../brain/task'
import type { TaskOperation, TaskSummary } from '../brain/task'
import type { AnalysisRequest } from '../brain/analysis'
import { dataIdeas } from '../brain/ideas'
import { withTimeout } from './live'
import { analyzeLayer } from './analysis'
import type { TableRequest, TableResult } from './tableWidget'
import { Fun, todayLine, type Place } from '../brain/fun'
import { definitionAsk, lookupTerm, codeGuess, outOfScope, CODE_SHAPE } from '../brain/glossary'
import { V, pick } from '../brain/voice'
import { rand } from '../brain/random'
import { flat, clip, tokenize, stripTags } from '../brain/text'
import type { LiveMap, LayerEntry, ToggleResult } from './live'
import { SCALE } from './live'
import type { LayerInfo } from '../brain/layers'
import { completeText, addressFragment, withAddress, addressQuestions } from '../brain/complete'
import type { CompleteSource } from '../brain/complete'
import { suggestAddresses } from './geocoder'
import { toLatLon as projectToLatLon, warmProjection, needsProjection } from './project'
import { readKeepsakes, emptyKeepsakes, remember, stampLine, keepsake, keepsakeHello, keepsakeSummary, usual } from '../brain/keepsakes'
import type { Keepsakes, Moment } from '../brain/keepsakes'
import { readAsk, mentionedLayer, askWhere, askSaid, namedFeature, fieldFor } from '../brain/ask'
import type { AskLayer } from '../brain/ask'
import type { QueryField } from '../brain/analysis'
import type { Ask } from '../brain/ask'
import { numericField } from '../brain/analysis'
import { lineLength, rankLines, schemaOf, loadValues, runAsk, probeText } from './ask'
import { parseCare, contactActions, contactText, stuckLine, readMisses, addMiss, missesText, missesMail, missesCsv, maskNumbers, worthKeeping, privacyText } from '../brain/care'
import type { Contact, Miss } from '../brain/care'
import { readSend, sendChip } from '../brain/sendPlace'
import type { PlaceTarget } from '../brain/sendPlace'
import { openWidget, openWidgetHelp, closeWidget, goPage, goDialog, goView, openUrl, widgetEl, bestWidgetId, pulse } from './navigate'
import { isShown, waitForBridge } from './layerList'
import { fieldLabel, keyLabel } from '../brain/fields'

export interface MindContext {
  index: MappyIndex
  model: AppModel
  live: LiveMap
  hints: Map<string, LayerHint>
  name: string
  appTitle: string
  /** The portal this app is signed in to (https://host/portal), for links to item pages. */
  portalUrl?: string
  /** How often a running geoprocessing job is checked, in milliseconds (tests shorten it). */
  jobPollMs?: number
  featureSearch: boolean
  maxResults: number
  geocoders?: GeocoderSource[]
  /** Open the layer list and flash the row after a layer change. */
  showInLayerList: boolean
  /** Layer list widgets in the app (Map Layers, Map Layers Custom...), all copies. */
  layerListIds: string[]
  layerListLabel: string
  beacon?: { action: (n: string, d?: string) => void, error: (e: unknown, d?: string) => void } | null
  /** Fix typos before reading (settings, Behavior). Undefined means on. */
  typoFix?: boolean
  /** An MCP server the builder connected in settings (the second way Mappy can help). */
  mcp?: McpPort | null
  /** An AI assistant in its own tab (Claude), when the builder chose it as the helper: stuck answers carry one link that opens it with the question written. */
  assistant?: AssistantPort | null
  /** A real person or team to hand off to, from settings: offered on request and when he is stuck twice in a row. */
  contact?: Contact | null
  /** Anonymous usage counts are on (settings), so the privacy answer can say so. */
  telemetry?: boolean
  /** Send each question he could not answer (long numbers masked) to the usage table. Builder opt-in, on top of telemetry. */
  shareMisses?: boolean
  /** "Owners within 300 ft of ..." answers with the owners and a spreadsheet. Builder opt-in: owner mailing lists are not for every app. */
  notifyLists?: boolean
  /** Claude answering inside the chat through the GIS server's ask_assistant tool, when the builder chose it as the helper. */
  serverAssistant?: { label: string, shareSelection?: boolean, sharePicture?: boolean, note?: string } | null
  /** Says what a long wait is for, beside the typing dots ("Claude is checking the GIS data..."). */
  waiting?: (note: string) => void
  /** Where the person is (the device's location), when they allow it. */
  myLocation?: () => Promise<[number, number] | null>
  /** Jokes, riddles and games. Undefined means on. */
  fun?: boolean
  /** Who runs the app and where it is: org ("the City"), place name, website, local facts. */
  place?: Place
  /** This widget's id, named as the source when records go to the Table widget. */
  widgetId?: string
  /** Widgets the builder wired to Mappy's location message (a report tool, a lookup): people can ask for them by name with a place. */
  placeTargets?: PlaceTarget[]
  /** Opens one of those widgets and publishes the place to the app. */
  sendPlace?: (target: PlaceTarget, at: { lat: number, lon: number, label: string }) => Promise<boolean>
  /** What the knowledge feed gave him ("feed 2026.10.29: language pack ..., 18 answers"), for diagnostics. */
  feedInfo?: string
  /** Small things kept for the person in this browser (saved views). Absent in tests. */
  store?: { get: (key: string) => string | null, set: (key: string, value: string | null) => void }
  /** Puts records in the app's Table widget; absent when the app has none (or in tests). */
  openInTable?: (entry: LayerEntry, req: TableRequest) => Promise<TableResult>
}

const STATUS_GLYPH: { [s: string]: string } = { on: '●', off: '○', hidden: '◐', scale: '◑' }
const STATUS_SR: { [s: string]: string } = { on: 'on', off: 'off', hidden: 'on, but its group is off', scale: 'on, not drawing at this scale' }

class LayerChoice extends Error {
  constructor (public query: string, public entries: LayerEntry[]) { super('Choose a layer') }
}

/** Intents whose words ("there", "this") look like a place but are about the app or the conversation. */
const NOT_PLACE = new Set(['help', 'about', 'mapBlank', 'hasLayer', 'today', 'download', 'listLayers', 'listFeatures', 'listWidgets', 'listPages', 'listBookmarks', 'tour', 'tourNext', 'tourStop', 'changes', 'tryAgain', 'mapSummary', 'whoami', 'diagnostics'])

/** The service url of a layer, when it has one. */
function live_url (live: LiveMap, e: LayerEntry): string { try { return String(live.target(e)?.url || '') } catch (err) { return '' } }

/** Requests about the conversation itself: "try again" never re-runs these. */
const META = new Set(['tryAgain', 'mapSummary', 'copyAnswer', 'exportChat', 'tourNext', 'tourStop', 'changes', 'repeat', 'speak', 'help', 'diagnostics', 'greet', 'thanks', 'ack', 'cancel', 'undo', 'forget', 'clicked', 'tip', 'joke', 'whoami', 'about', 'sleep', 'resize', 'moveCorner', 'pause'])

export class Mind {
  ctx: MindContext
  private lastLayer = ''
  private lastReply: Reply | null = null
  /** How the last request was read (typos fixed), for "why did you do that". */
  private lastReading: { input: string, read: string, swaps: Array<[string, string]> } | null = null
  /** The last undo, so "redo" can put it back. */
  private redoLabel: { label: string, commands: string } | null = null
  /** The last thing the user typed that was not a chip or control word, for "try again". */
  private lastInput = ''
  /** Real questions in a row he could not answer; at two he offers a person. */
  private stuckRun = 0
  private missMemory: Miss[] = []
  private keepMemory: Keepsakes = emptyKeepsakes()
  /** The last data question he read against the layers, for "show them" and "only show them on the map". */
  private lastAsk: { ask: Ask, key: string, scope?: Scope } | null = null
  /** The cross-layer question last answered, so "what about 500 ft" can ask it again. */
  private lastSpatial: { read: SpatialRead, at: number } | null = null
  /** The reply that answered it: follow-ups ("who owns it", "which ones are over 5 acres") apply while it is the latest thing said. */
  private lastAskReply: Reply | null = null
  private lastAskAt = 0
  /** This turn was keepsake talk (the passport, our story): it earns nothing itself. */
  private keepsakeTurn = false
  /** Guided tour: the widget docs still to visit, and the one being shown. */
  private tour: { stops: Doc[], at: number } | null = null
  private resultStore: any[] = []
  /** When the results on hand were found, so "it" only means them while they are fresh. */
  private lastResultsAt = 0
  private get lastResults (): any[] { return this.resultStore }
  private set lastResults (v: any[]) { this.resultStore = v || []; this.lastResultsAt = this.resultStore.length ? Date.now() : 0 }
  private lastReadIntent = ''
  private lastReadScope = ''
  private addressSequence = 0
  private lastAddress = ''
  private lastAnalysis: AnalysisRequest | null = null
  private lastAnalysisRows = 0
  private choiceSequence = 0
  private layerChoices: { sequence: number, view: any, query: string, command: string, entries: LayerEntry[] } | null = null
  private chosenLayer: { query: string, entry: LayerEntry } | null = null
  private addressChoices: { sequence: number, view: any, results: AddressResult[], selected?: number } | null = null
  private tablePage: { key: string, offset: number, size: number, hasNext: boolean, condition?: string, field?: string, order?: 'asc' | 'desc' } | null = null
  private contextView: any = null
  private mcpTools: McpTool[] = []
  /** "Open in Table" buttons waiting to be pressed: what each one would show. */
  private tableJobs = new Map<string, { entry: LayerEntry, req: TableRequest }>()
  private tableJobSeq = 0
  private fun = new Fun()
  /** The basemap before the last switch, for "put it back". */
  private undoBasemap: any = null
  /** The device's location was asked for and not given: say the answer is for the map instead. */
  private locationNote = false
  /** Layer names the server can search, read once per server for specific suggestions. */
  private serverLayerNames: { port: any, names: string[] } | null = null
  private mcpSequence = 0
  private mcpPending: { sequence: number, tool: McpTool, args: { [k: string]: any } } | null = null
  private mcpResults: { sequence: number, view: any, source: string, rows: Array<{ label: string, point?: [number, number] }> } | null = null
  private resultSequence = 0
  private mcpFailedAt = 0
  private mcpPort: McpPort | null | undefined
  private mcpPrefs = ''
  /** The server's ask_assistant tool (Claude on the server), kept apart from the ordinary tools. */
  private askTool: McpTool | null = null
  /** Recent questions Claude answered here, sent along so follow-ups make sense. */
  private claudeTurns: Array<{ q: string, a: string }> = []
  /** The server takes ratings (assistant_feedback), and the answers that can still be rated. */
  private rateTool = false
  /** The server counts questions per person and can say how many are left (assistant_usage). */
  private usageTool = false
  /** Esri's MCP for ArcGIS Enterprise tools on the connected server, when it has them. */
  private esri: EsriCatalog | null = null
  /** The portal layer last asked about, so the next question can stay on it. */
  private lastRemote: { layer: RemoteLayer, item: PortalItem, at: number, ask?: Ask } | null = null
  /** Portal items last listed, for "ask the second one". */
  private portalItems: { items: PortalItem[], thing: string, question: string, at: number } | null = null
  private remoteLayers = new Map<string, RemoteLayer>()
  private rated = new Map<number, { q: string, a: string, done?: boolean }>()
  private rateSeq = 0
  /** When Claude last answered, and the follow-ups it suggested: the conversation stays with Claude for a few minutes. */
  private claudeAt = 0
  /** What he remembers about the two of you when the browser cannot keep it (tests, private windows). */
  private bondMemory: Bond = emptyBond()
  private claudeFollowups: string[] = []
  private mcpDraft: { tool: McpTool, args: { [k: string]: any }, missing: string[], place?: PlaceQuestion } | null = null
  private placeConversation: PlaceQuestion | null = null

  private syncMcp (): void {
    const port = this.ctx.mcp
    const prefs = JSON.stringify(port?.prefs || [])
    if (port !== this.mcpPort || prefs !== this.mcpPrefs) {
      this.mcpResults = null
      this.mcpPort = port; this.mcpPrefs = prefs
      this.mcpTools = []; this.askTool = null; this.mcpPending = null; this.mcpDraft = null; this.mcpFailedAt = 0
      this.awaitingPlace = null; this.placeConversation = null; this.lastToolData = null
    }
  }
  /** The address "my address" means (kept in this browser). */
  private myAddress = ''
  /** A place question waiting for its place ("Closest to where?", "What's your address?"). */
  private awaitingPlace: { question: string, mine: boolean } | null = null
  /** Names for places asked about by coordinates ("39.0639, -108.5506" is "250 N 5th St"). */
  private placeNames = new Map<string, string>()
  /** The last server answer as data, for putting it on the map. */
  private lastToolData: any = null
  /** The last place shown (an address found, a place answered about), for "who owns it". */
  private lastPlace: { label: string, lat: number, lon: number, at: number } | null = null
  /** The last data query that succeeded, shown as an editable "Data task" card above the chat. */
  private dataTask: { sequence: number, view: any, request: AnalysisRequest, layer: string, completed: string } | null = null
  private taskSequence = 0
  /** A layer command that is still missing its layer ("turn on a layer"): waiting for the person to pick one. */
  private layerPick: { sequence: number, view: any, verb: 'on' | 'off' | 'table', all: LayerEntry[], shown: LayerEntry[] } | null = null
  /** Set when an incomplete command was filled with the only layer that is on; the reply says which one. */
  private pendingPickNote = ''
  private pendingRewrite = ''
  private pickSequence = 0
  constructor (ctx: MindContext) { this.ctx = ctx }

  /** Forget per-map memory when the active map changes (layer, results, tasks, pending choices). */
  private syncContext (): void {
    if (this.contextView === this.ctx.live.view) return
    this.mcpResults = null
    this.lastLayer = ''; this.lastResults = []; this.lastReply = null; this.lastReadIntent = ''; this.lastReadScope = ''
    this.lastAddress = ''; this.lastAnalysis = null; this.addressChoices = null; this.tablePage = null
    this.dataTask = null; this.layerPick = null
    this.awaitingPlace = null; this.placeConversation = null; this.lastPlace = null; this.lastToolData = null; this.mcpDraft = null; this.mcpPending = null; this.placeNames.clear(); this.claudeTurns = []; this.claudeAt = 0; this.claudeFollowups = []
    this.contextView = this.ctx.live.view
  }

  /** The current data task for the bubble's task card, or null when there is none on this map. */
  task (): TaskSummary | null {
    const t = this.dataTask
    if (!t || t.view !== this.ctx.live.view) return null
    const entry = this.ctx.live.ready ? this.ctx.live.find(t.request.layer) : null
    if (!entry) return null
    return taskSummary(t.request, t.layer, t.sequence, t.completed)
  }

  private rememberTask (request: AnalysisRequest, entry: LayerEntry): void {
    this.dataTask = { sequence: ++this.taskSequence, view: this.ctx.live.view, request: { ...request, layer: entry.key, offset: undefined }, layer: entry.title, completed: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) }
  }

  /** Runs a task control (a card button, or "use whole layer" / "use current view"). The task changes only when the query succeeds. */
  private async runTask (sequence: number, operation: TaskOperation): Promise<Reply> {
    const t = this.dataTask
    const stale: Reply = { text: 'That data task changed or is no longer available. Use the current task card, or ask again.', mood: 'confused' }
    if (!t || t.sequence !== sequence || t.view !== this.ctx.live.view) return stale
    if (!this.ctx.featureSearch) return { text: 'Data queries are disabled by the app author.', mood: 'confused' }
    const entry = this.ctx.live.find(t.request.layer)
    if (!entry) { this.dataTask = null; return stale }
    if (!this.ctx.live.canAsk(entry)) return this.offReply(entry)
    let request: AnalysisRequest
    try { request = operation === 'refresh' ? { ...t.request } : reviseTask(t.request, operation) } catch (error) {
      return { text: error instanceof Error ? error.message : 'That change does not apply to this task.', mood: 'confused' }
    }
    try {
      const reply = await analyzeLayer(this.ctx.live, entry, request, this.ctx.maxResults)
      if (t.view !== this.ctx.live.view) return stale
      this.lastLayer = entry.path
      this.lastAnalysis = { ...request, layer: entry.key }
      this.lastAnalysisRows = reply.table?.rows.length || reply.results?.length || 0
      this.tablePage = reply.page && !request.inView && !request.limit ? { key: entry.key, condition: request.condition, field: request.field, order: request.order, ...reply.page } : null
      this.rememberTask(request, entry)
      return reply
    } catch (error) {
      return { text: error instanceof Error ? error.message : 'The layer query failed. The task was not changed.', mood: 'confused' }
    }
  }

  // ------------------------------------------------------------ layer commands without a layer

  /** "turn on a layer", "select a layer", "show table": ask which layer, then act. */
  private incompleteLayerCommand (input: string): Reply | null {
    const q = input.trim().replace(/[.!?]+$/, '')
    let verb: 'on' | 'off' | 'table' | null = null
    if (/^(?:turn|switch)\s+on\s+(?:a|one|some|the)\s+layer$|^(?:show|select|enable|add)\s+(?:a|one)\s+layer$|^turn\s+(?:a|one)\s+layer\s+on$/i.test(q)) verb = 'on'
    else if (/^(?:turn|switch)\s+off\s+(?:a|one|some|the)\s+layer$|^(?:hide|disable|remove)\s+(?:a|one)\s+layer$|^turn\s+(?:a|one)\s+layer\s+off$/i.test(q)) verb = 'off'
    else if (/^(?:show|open|browse)\s+(?:a\s+|the\s+)?(?:table|attribute table)$/i.test(q)) verb = 'table'
    if (!verb) return null
    if (!this.ctx.live.ready) return { text: V.noMap(), mood: 'confused' }
    const live = this.ctx.live
    const all = live.entries().filter(e => verb === 'table' ? !e.isGroup : !e.isTable && !e.isGroup)
    if (!all.length) return { text: 'There are no layers on this map to choose from.', mood: 'confused' }
    // The layers that are on come first; when only one is on and that is what the table or "turn off" is about, no need to ask.
    const on = all.filter(e => !e.isTable && live.isVisible(e))
    if (verb !== 'on' && on.length === 1) {
      this.lastLayer = on[0].path
      this.pendingPickNote = on[0].title
      this.pendingRewrite = verb === 'table' ? `show table ${on[0].key}` : `turn off ${on[0].title}`
      return null
    }
    const ordered = verb === 'on' ? all : [...on, ...all.filter(e => !on.includes(e))]
    return this.offerPick(verb, all, ordered, verb === 'on' ? undefined : `Which layer should I ${verb === 'off' ? 'turn off' : 'open as a table'}? The ones that are on come first. Choose one, say its name or “the first one”, or say “cancel”.`)
  }

  private offerPick (verb: 'on' | 'off' | 'table', all: LayerEntry[], matches: LayerEntry[], lead?: string): Reply {
    const shown = matches.slice(0, 8)
    const sequence = ++this.pickSequence
    this.layerPick = { sequence, view: this.ctx.live.view, verb, all, shown }
    const doing = verb === 'on' ? 'turn on' : verb === 'off' ? 'turn off' : 'open as a table'
    return {
      text: lead || `Which layer should I ${doing}? Choose one, say its name or “the first one”, or say “cancel”.${matches.length > 8 ? ` Showing ${shown.length} of ${matches.length}; say part of a name to narrow the list.` : ''}`,
      mood: 'think',
      list: shown.map((entry, index) => ({ label: entry.path, action: { type: 'ask' as const, label: entry.title, q: `__layerpick:${sequence}:${index}` } }))
    }
  }

  private async finishPick (entry: LayerEntry, verb: 'on' | 'off' | 'table'): Promise<Reply> {
    this.layerPick = null
    const current = this.ctx.live.entries().find(e => e.key === entry.key && this.ctx.live.target(e) === this.ctx.live.target(entry))
    if (!current) return { text: 'That layer is no longer in the map. Ask again using the current layers.', mood: 'confused' }
    const name = current.title
    const command = verb === 'table' ? `show table ${current.key}` : `turn ${verb} ${name}`
    this.chosenLayer = { query: verb === 'table' ? current.key : name, entry: current }
    try { return await this.respondRead(command) } finally { this.chosenLayer = null }
  }

  /** An answer while a layer pick is waiting: a button, a number, a name, part of a name, or cancel. Null when it is something else. */
  private async answerPick (input: string): Promise<Reply | null> {
    const pick = this.layerPick
    if (!pick) return null
    const button = input.match(/^__layerpick:(\d+):(\d+)$/)
    if (button) {
      const entry = pick.shown[Number(button[2])]
      if (Number(button[1]) !== pick.sequence || pick.view !== this.ctx.live.view || !entry) return { text: 'That layer choice is no longer available. Ask again.', mood: 'confused' }
      return this.finishPick(entry, pick.verb)
    }
    if (/^(?:cancel|never mind|nevermind|forget it|stop)[!.?]*$/i.test(input)) { this.layerPick = null; return { text: 'Cancelled. Nothing was changed.', mood: 'talk' } }
    const n = resultNumber(input)
    if (n !== null && pick.shown[n - 1]) return this.finishPick(pick.shown[n - 1], pick.verb)
    const words = flat(input.replace(/^(?:choose|pick|use|select|open|the|that)\s+/i, '').replace(/^(?:the\s+)/i, '').replace(/\s+(?:one|layer|please)$/i, '')).split(' ').filter(w => w.length > 1)
    if (!words.length) return null
    const full = pick.all.filter(e => flat(e.title) === words.join(' ') || flat(e.path) === words.join(' '))
    if (full.length === 1) return this.finishPick(full[0], pick.verb)
    // Narrow within what is on offer now (a narrowed list stays narrowed), then the whole map.
    const within = (list: LayerEntry[]) => list.filter(e => words.every(w => flat(e.path).includes(w)))
    let hits = within(pick.shown.length < pick.all.length && pick.shown.length <= 8 && pick !== null ? pick.shown : pick.all)
    if (!hits.length) hits = within(pick.all)
    if (hits.length === 1) return this.finishPick(hits[0], pick.verb)
    if (hits.length > 1) return this.offerPick(pick.verb, pick.all, hits, `${hits.length} layers match “${words.join(' ')}”. Which one?`)
    // Only treat it as a failed answer when it looks like an answer; otherwise it is a new request.
    if (/^(?:choose|pick|use|select|the)\b/i.test(input.trim()) || words.length <= 2 && parseIntent(input).name === 'ask') {
      const again = this.offerPick(pick.verb, pick.all, pick.shown)
      return { ...again, text: `I could not match “${words.join(' ')}” to a layer. Choose one of these, or say “cancel”.` }
    }
    this.layerPick = null
    return null
  }

  private track (n: string): void { try { this.ctx.beacon?.action('ask', n) } catch (e) { } }

  /** Name for the layer list in sentences. */
  get listName (): string {
    return this.ctx.live.bridge?.label || this.ctx.layerListLabel || 'the layer list'
  }

  /** Names in this app (tools, pages, layers, fields), so typos snap to what is really here. */
  private appNames (): string[] {
    const names: string[] = []
    for (const d of this.ctx.index.docs) { if (d.title) names.push(d.title) }
    for (const tool of this.mcpTools) names.push(tool.name, toolLabel(tool))
    try {
      for (const e of this.ctx.live.entries()) {
        names.push(e.title)
        for (const f of ((e.sublayer || e.layer)?.fields || []) as any[]) names.push(f.name, f.alias || '', fieldLabel(f))
      }
    } catch (e) { }
    return names
  }

  /** Builds the typo reader ahead of the first question (about a tenth of a second), while the page is idle. */
  warm (): void {
    try { if (needsProjection(this.ctx.live.view?.spatialReference)) warmProjection().catch(() => {}) } catch (e) { }
    if (this.ctx.typoFix === false) return
    try { readRequest('hello', lexiconFor(this.appNames(), this.ctx.index)) } catch (e) { }
  }

  /**
   * Reads past typos first ("trun on parcles"), like a person would, then answers. When a word
   * was fixed he says how he read it, so a wrong guess is easy to spot and retype.
   */
  async respond (input: string): Promise<Reply> {
    this.locationNote = false
    const control = /^__|^(?:try (?:that |it )?again|retry(?: that)?|do (?:that|it) again|once more|again|next|next (?:stop|one|tool|page)|undo|repeat(?: that)?|cancel|stop|never ?mind|yes|no|ok|okay)[!.?]*$/i.test(input.trim())
    this.keepsakeTurn = false
    const startedAt = Date.now(); const layerBefore = this.lastLayer; let filtersBefore = 0
    try { filtersBefore = this.ctx.live.filtered().length } catch (e) { }
    const reply = await this.respondInner(input)
    const handoffLabel = this.ctx.assistant?.label || this.ctx.serverAssistant?.label
    const real = !control && !/^__/.test(input) && !META.has(parseIntent(input).name) && !parseCare(input) && !(handoffLabel && parseHandoff(input, handoffLabel))
    if (real && !(EMOTIONS as readonly string[]).includes(reply.mood || '')) this.lastInput = input
    // One more question together; round numbers get a line of their own.
    if (real) {
      try {
        const bond = bumpBond(this.bond())
        this.keepBond(bond)
        const line = this.ctx.fun === false ? '' : milestone(bond.chats)
        if (line && !['confused', 'alert', 'sad', 'sorry'].includes(reply.mood || '')) reply.text = `${reply.text}\n\n${line}`
      } catch (e) { }
    }
    try { this.offerSend(reply, startedAt) } catch (e) { }
    // Keepsakes: stamps for things done together, and what this person asks most.
    if (this.ctx.fun !== false && !/^__/.test(input) && !parseCare(input) && !this.keepsakeTurn) {
      try {
        const intent = parseIntent(input).name
        const good = !['confused', 'alert', 'sorry'].includes(reply.mood || '')
        const felt = (EMOTIONS as readonly string[]).includes(reply.mood || '')
        const m: Moment = {}
        if (real && good && !felt) { m.input = input; m.intent = intent }
        if (good && intent === 'tour') m.intent = 'tour'
        if (real && good && this.lastLayer && (this.lastLayer !== layerBefore || parseIntent(input).target)) m.layer = this.ctx.live.entries().find(e => e.path === this.lastLayer)?.title
        if (real && good) { m.chart = !!reply.chart; m.table = !!reply.table; m.place = !!(this.lastPlace && this.lastPlace.at >= startedAt) }
        try { m.filtered = this.ctx.live.filtered().length > filtersBefore } catch (e) { }
        m.undo = /^undo\b/i.test(input.trim()) && good
        m.thanks = intent === 'thanks'
        m.fun = good && (intent === 'joke' || felt || /^(?:fun fact|tell me a (?:joke|riddle|fact)|riddle)/i.test(input.trim()))
        m.helper = !!(this.ctx.serverAssistant && reply.sources?.[0]?.title === this.ctx.serverAssistant.label)
        m.down = felt && ['hug', 'sad'].includes(reply.mood || '') && /\b(?:rough|bad|hard|long|terrible|awful|worst|sad|down|tired|exhausted|stressed|lonely|upset|crying)\b/i.test(input)
        const { keep, earned, levelUp } = remember(this.keepsakes(), m, this.bond())
        this.keepKeepsakes(keep)
        const line = stampLine(earned, Object.keys(keep.stamps).length)
        // One aside per answer at most; the answer comes first.
        // One aside per answer at most, after the answer. A new level is only said after a real answer, never mid-joke.
        const data = !!(reply.table || reply.chart || reply.results?.length || reply.sources?.length || reply.actions?.length)
        const aside = !good || /\n\n(?:That was our|Question \d+|\d+ questions|One hundred|One thousand)/.test(reply.text) ? '' : (line || (data && !m.fun ? levelUp : ''))
        if (aside) reply.text = `${reply.text}\n\n${aside}`
      } catch (e) { }
    }
    // Stuck: keep the question for the people who run the app, and after two in a row offer a person.
    if (real) {
      const stuck = reply.mood === 'confused'
      this.stuckRun = stuck ? this.stuckRun + 1 : 0
      if (stuck) {
        this.keepMisses(addMiss(this.misses(), input))
        // Only when the builder turned it on: the question (long numbers masked) goes to the usage table, so the people who run the app see what is asked across everyone.
        if (this.ctx.shareMisses && worthKeeping(input)) { try { this.ctx.beacon?.action('miss', maskNumbers(input)) } catch (e) { } }
        const c = this.ctx.contact
        if (c && this.stuckRun >= 2 && !(reply.actions || []).some(a => a.type === 'url' && /^(?:mailto|tel):/i.test(a.url || ''))) {
          reply.text = `${reply.text}\n\n${stuckLine(c)}`
          reply.actions = [...(reply.actions || []).slice(0, 2), ...contactActions(c, { app: this.ctx.appTitle, question: input, said: reply.text.split('\n')[0], where: this.whereLine() }).slice(0, 2)]
        }
      }
    }
    if (this.locationNote) { this.locationNote = false; reply.text = `I could not get your location (it may be turned off for this site), so this is for the middle of the map.\n\n${reply.text}` }
    // His own data answers (a table or a chart) offer Claude for the "why" and "what does this mean".
    const sa = this.ctx.serverAssistant
    if (sa && !control && (reply.table || reply.chart) && reply.sources?.[0]?.title !== sa.label && reply.mood !== 'confused' && !(reply.suggest || []).some(x => new RegExp(`^ask ${sa.label}`, 'i').test(x))) {
      reply.suggest = [...(reply.suggest || []).slice(0, 4), `Ask ${sa.label} about this`]
    }
    // An answer from a layer that is turned off still stands; one click shows the layer.
    if (!control && (reply.table || reply.chart || reply.results?.length) && this.lastLayer && reply.mood !== 'confused') {
      try {
        const e = this.ctx.live.entries().find(x => x.path === this.lastLayer)
        if (e && !e.isGroup && !e.isTable && !this.ctx.live.isVisible(e) && !(reply.actions || []).some(a => a.type === 'layerOn')) reply.actions = [...(reply.actions || []).slice(0, 3), { type: 'layerOn', id: e.key, label: `Turn on ${e.title}` }]
      } catch (e) { }
    }
    // A server hiccup: one chip runs the same request again.
    if (reply.mood === 'alert' && this.lastInput && !control && !(reply.suggest || []).some(x => /try again/i.test(x))) reply.suggest = ['Try again', ...(reply.suggest || [])].slice(0, 5)
    return reply
  }

  /** What the app has, for predictive text: layers, tools, bookmarks, a layer's fields and code lists. */
  private completeSource (): CompleteSource {
    const live = this.ctx.live
    const layers: string[] = []
    try { for (const e of live.entries()) if (e.title && !e.isTable) layers.push(e.title) } catch (e) { }
    const docs = this.ctx.index.docs
    const info = (layer: string): LayerInfo | null => { try { const e = live.find(layer); return e ? live.info(e) : null } catch (e) { return null } }
    return {
      layers,
      widgets: docs.filter(d => d.kind === 'widget').map(d => d.title),
      bookmarks: docs.filter(d => d.kind === 'bookmark').map(d => d.title),
      fieldsOf: layer => (info(layer)?.fields || []).filter(f => !/^(?:objectid|fid|oid|globalid|shape)/i.test(f.name) && !/shape[._]|globalid/i.test(f.name)).map(f => fieldLabel(f as any)),
      valuesOf: (layer, field) => {
        const f = (info(layer)?.fields || []).find(x => fieldLabel(x as any).toLowerCase() === field.toLowerCase() || x.name.toLowerCase() === field.toLowerCase())
        return (f?.codes || []).map(([, name]) => String(name))
      },
      places: !!((this.ctx.geocoders?.length && live.view) || this.ctx.mcp),
      starters: this.ctx.assistant || this.ctx.serverAssistant ? [`ask ${(this.ctx.assistant || this.ctx.serverAssistant)!.label} `] : undefined
    }
  }

  /**
   * Typeahead for the chat box: starters and app names that continue what was typed so far.
   * Pure lookup, no network, at most five, shortest first.
   */
  complete (prefix: string): string[] { return completeText(prefix, this.completeSource()) }

  /**
   * The same, plus address suggestions from the app's locator when an address is being typed
   * ("who owns 250 n 5" -> "who owns 250 N 5th St"); a bare address offers the questions to ask about it.
   */
  async completeAsync (prefix: string, signal?: AbortSignal): Promise<string[]> {
    const src = this.completeSource()
    const local = completeText(prefix, src)
    const frag = addressFragment(prefix)
    if (!frag || !this.ctx.geocoders?.length || !this.ctx.live.view) return local
    let suggestions: string[] = []
    try { suggestions = await suggestAddresses(frag, this.ctx.geocoders, this.ctx.live.view, undefined, signal) } catch (e) { suggestions = [] }
    if (signal?.aborted || !suggestions.length) return local
    const bare = prefix.trim().toLowerCase() === frag.toLowerCase()
    const out: string[] = []
    if (bare) {
      // "250 N 5th St" alone: the top match, as the questions people ask about it.
      for (const s of suggestions.slice(0, 2)) for (const q of addressQuestions(s, src.places)) out.push(q)
    } else {
      for (const s of suggestions) out.push(withAddress(prefix, frag, s))
    }
    return Array.from(new Set([...out, ...local])).slice(0, 5)
  }

  private async respondInner (input: string): Promise<Reply> {
    this.syncContext(); this.syncMcp()
    if (input.length > 2000) return { text: 'Please keep each request under 2,000 characters.', mood: 'confused' }
    const plain = normalizeCommand(input)
    const selectedResult = plain.match(/^__mcpresult:(\d+):(\d+)$/)
    if (selectedResult) return this.chooseMcpResult(Number(selectedResult[1]), Number(selectedResult[2]))
    const ordinal = resultNumber(plain)
    if (this.mcpResults && ordinal !== null && !this.layerPick && !this.layerChoices && !this.addressChoices && !this.mcpDraft && !this.awaitingPlace) return this.chooseMcpResult(this.mcpResults.sequence, ordinal - 1)
    if (!['thanks', 'greet'].includes(parseIntent(plain).name) && !/^(?:repeat(?: that)?|say that again)[.!?]*$/i.test(plain)) this.mcpResults = null
    if (/^(?:forget context|start over|new conversation)[!.?]*$/i.test(plain)) {
      this.mcpDraft = null; this.mcpPending = null; this.awaitingPlace = null; this.placeConversation = null; this.lastPlace = null
    }
    if (/^(?:cancel|never mind|nevermind|stop)[!.?]*$/i.test(plain) && (this.mcpDraft || this.mcpPending || this.awaitingPlace)) {
      this.mcpDraft = null; this.mcpPending = null; this.awaitingPlace = null
      return { text: 'Cancelled. Nothing further was sent to the server.', mood: 'acknowledge' }
    }
    if (this.mcpDraft) {
      const fresh = /^__|^(?:use|run|call|ask|list|show|find|search|where|how|what|why|forget|start over|new conversation)\b/i.test(plain) || parseIntent(plain).name !== 'ask'
      if (fresh) this.mcpDraft = null
      else {
        const draft = this.mcpDraft
        const key = draft.missing[0]
        const answer = toolAnswer(draft.tool.inputSchema?.properties?.[key] || {}, input)
        if (answer.error) return { text: `${answer.error} I still need **${key}** for **${toolLabel(draft.tool)}**.`, mood: 'think', suggest: ['Cancel'] }
        this.mcpDraft = null
        try { const reply = await this.prepareToolArgs(draft.tool, { ...draft.args, [key]: answer.value }, draft.missing.filter(k => k !== key), draft.place); this.lastReply = reply; return reply }
        catch (e) { return { text: e instanceof Error ? e.message : 'The server did not answer.', mood: 'alert' } }
      }
    }
    // The small things people say to a friend ("how are you", "rough day", "call me Sam").
    if (!/^__/.test(input) && !this.awaitingPlace && !this.layerPick && !this.layerChoices && !this.addressChoices) {
      const kept = this.keepsakeSay(input)
      if (kept) return kept
      const felt = this.feelings(input)
      if (felt) return felt
    }
    const continued = this.placeConversation && followPlaceQuestion(plain, this.placeConversation)
    if (continued) input = continued
    let read = { text: input, changed: false, swaps: [] as Array<[string, string]> }
    if (this.ctx.typoFix !== false && !this.lastAddress && !this.addressChoices && !this.awaitingPlace && !parsePlaceQuestion(normalizeCommand(input)) && !outOfScope(normalizeCommand(input), this.org()) && !DISTANCE_Q.test(normalizeCommand(input)) && !OWNED_Q.test(normalizeCommand(input)) && !/^__/.test(input) && !((this.ctx.assistant || this.ctx.serverAssistant) && parseHandoff(input, (this.ctx.assistant || this.ctx.serverAssistant)!.label))) {
      try { read = readRequest(input, lexiconFor(this.appNames(), this.ctx.index)) } catch (e) { }
    }
    // The reading is the request with typos fixed, polite words dropped, numbers in words as
    // digits ("fifty percent" to 50%) and other phrasings made plain; it equals the input otherwise.
    const text = read.text || input
    const fb = input.match(/^__claudefb:(up|down):(\d+)$/)
    if (fb) return this.rateClaude(fb[1] === 'up', Number(fb[2]))
    if (this.ctx.serverAssistant && usageQuestion(input, this.ctx.serverAssistant.label)) { this.keepsakeTurn = true; const mine = await this.claudeUsage(); this.lastReply = mine; return mine }
    const cared = this.care(input)
    if (cared) { this.lastReply = cared; return cared }
    const followed = await this.followAsk(input)
    if (followed) { this.lastReply = followed; return followed }
    let reply = (await this.serverClaudeCommand(input)) || (await this.claudeFollowUp(input)) || this.assistantCommand(input) || await this.mcpCommand(text) || await this.portalCommand(text)
    if (!reply) reply = await this.sendPlaceQuestion(input)
    if (!reply) reply = await this.spatialQuestion(text)
    if (!reply) reply = await this.placeQuestion(text, input)
    if (reply) this.lastReply = reply
    else {
      let first = await this.respondRead(text)
      // Stuck, and the sentence may be about place after all ("hydrants in the floodplain", "parcels outside the city limits").
      // Also when all he had was a page from the app's own help ("Parcels (layer)...") for a question about where things are.
      if ((['confused', 'think'].includes(first.mood || '') || first.lookedUp) && !/^__/.test(input)) { const across = await this.spatialQuestion(text, true); if (across) { first = across; this.lastReply = across } }
      reply = this.ctx.serverAssistant ? await this.askServerClaudeWhenStuck(input, first) : await this.offerServer(text, first)
    }
    // Stuck on a question about one address ("when did 250 Oak St sell", "land use of 250 Oak St"): look the field up on its parcel.
    if (['confused', 'think'].includes(reply.mood || '') && !/^__/.test(input)) { const a = await this.addressAttr(text); if (a) { reply = a; this.lastReply = a } }
    // Stuck: offer the closest requests he can do, the way Clippy asked "It looks like you're...".
    if (reply.mood === 'confused' && this.ctx.typoFix !== false && !/^__/.test(input) && input.length < 120) {
      try {
        const guesses = didYouMean(input, lexiconFor(this.appNames(), this.ctx.index)).filter(g => g.toLowerCase() !== text.toLowerCase())
        if (guesses.length) {
          reply = {
            ...reply,
            text: `${reply.text}\n\nDid you mean ${guesses.map(g => `“${g}”`).join(' or ')}?`,
            actions: [...guesses.map(g => ({ type: 'ask' as const, q: g, label: clip(g, 40) })), ...(reply.actions || [])].slice(0, 4)
          }
        }
      } catch (e) { }
    }
    reply = this.offerAssistant(input, reply)
    // Only mention real fixes, not "whats" to "what's".
    const fixed = read.swaps.filter(([a, b]) => a.replace(/['’]/g, '').toLowerCase() !== b.replace(/['’]/g, '').toLowerCase())
    this.lastReading = { input, read: read.text || input, swaps: fixed }
    // An answer from Claude was to the words as typed (any language), so there is no reading to report.
    if (!fixed.length || reply.mood === 'sleep' || (this.ctx.serverAssistant && reply.sources?.[0]?.title === this.ctx.serverAssistant.label)) return reply
    return { ...reply, text: `${reply.text}\n\n(I read that as “${read.text.replace(/[*_`]/g, '')}”.)` }
  }

  // ------------------------------------------------------------ the two of you

  /** What he remembers about this person, from the browser (or from memory when it cannot be kept). */
  bond (): Bond {
    const store = this.ctx.store
    if (!store) return this.bondMemory
    try { return readBond(store.get('mappy-bond')) } catch (e) { return this.bondMemory }
  }

  private keepBond (bond: Bond): void {
    this.bondMemory = bond
    try { this.ctx.store?.set('mappy-bond', JSON.stringify(bond)) } catch (e) { }
  }

  /** A line for the start of a visit, for someone he has met ("Good morning, Sam! Day 3 in a row."). */
  welcome (now = new Date()): string {
    if (this.ctx.fun === false) return ''
    try {
      const hello = keepsakeHello(this.keepsakes(), this.bond(), now)
      if (hello.keep) this.keepKeepsakes(hello.keep)
      const back = welcomeBack(this.bond(), now)
      return [back, hello.line].filter(Boolean).join(' ')
    } catch (e) { return '' }
  }

  // ------------------------------------------------------------ data questions, read against the layers

  /**
   * A question about the data, read against what the layers really hold (names, fields, values):
   * "how many parcels are zoned R-4", "most expensive parcel", "average acres by zoning". Null
   * when it is not one, so the other readings get their turn.
   */
  private async dataQuestion (raw: string, intent: string, only?: Array<Ask['kind']>): Promise<Reply | null> {
    const live = this.ctx.live
    if (!this.ctx.featureSearch || !live.ready || /^__/.test(raw)) return null
    if (['layerOff', 'allOff', 'allOn', 'pan', 'close', 'basemap', 'opacity', 'opacityStep', 'mapFilter', 'mapUnfilter', 'mapFilters', 'saveView', 'listViews', 'deleteView', 'undo', 'redo', 'help', 'tour', 'listLayers', 'listWidgets', 'mapSummary', 'diagnostics', 'compareLayers', 'difference', 'density', 'fields', 'dataInfo', 'dataIdeas', 'layerDiagnosis', 'whichLayer', 'hasLayer', 'styleAsk', 'labels', 'download', 'pin', 'locateMe', 'whereami', 'scale', 'scaleInfo', 'rotate', 'threeD', 'home', 'goBack', 'preset', 'listPresets', 'favorites', 'reveal', 'solo'].includes(intent)) return null
    if (/\b(?:in chat|table)\b/i.test(raw)) return null
    const entries = live.entries().filter(e => !e.isGroup && typeof live.target(e)?.queryFeatures === 'function')
    if (!entries.length) return null
    let schemas = entries.map(e => schemaOf(live, e))
    // The older, exact syntax keeps its own reading: "where", a raw field name, "summarize", "check data quality".
    const fieldNames = new Set(schemas.flatMap(x => x.fields.map(f => f.name)).filter(n => /^[A-Z][A-Z0-9_]{2,}$/.test(n)))
    if (/\bwhere\b|^(?:summari[sz]e|check|filter|describe)\b/i.test(raw) || raw.split(/[^A-Za-z0-9_]+/).some(w => fieldNames.has(w))) return null
    // "How long is Maple St": a named line in a layer with no length field is measured on the map.
    const lengthOf = only ? null : raw.trim().match(/^(?:how long is|(?:what is |what's |whats )?the length of|length of)\s+(?:the\s+)?(.{3,60}?)[?.!]*$/i)
    if (lengthOf) {
      const SHORT: { [w: string]: string } = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd', lane: 'ln', court: 'ct', place: 'pl', highway: 'hwy', parkway: 'pkwy', trail: 'trl', circle: 'cir' }
      const name = lengthOf[1].trim()
      const short = name.replace(/\b([a-z]+)$/i, w => SHORT[w.toLowerCase()] || w)
      for (const e of entries.filter(x => /line/i.test(String(live.target(x)?.geometryType || ''))).slice(0, 4)) {
        if (schemaOf(live, e).fields.some(f => numericField(f) && /length|\blen\b|miles/i.test(`${f.name} ${f.alias || ''}`) && !/^shape/i.test(f.name))) continue
        try {
          const clause = await probeText(live, e, name, '') || (short !== name ? await probeText(live, e, short, '') : null)
          const measured = clause ? await lineLength(live, e, { layer: e.key, kind: 'list', clauses: [clause], unknown: [] } as any) : null
          if (!clause || !measured) continue
          const miles = measured.feet / 5280
          const size = miles >= 0.2 ? `**${miles >= 10 ? Math.round(miles).toLocaleString() : miles.toFixed(1)} mi** (${Math.round(measured.feet).toLocaleString()} ft)` : `**${Math.round(measured.feet).toLocaleString()} ft**`
          this.lastLayer = e.path
          return { text: `**${name.replace(/\b[a-z]/g, c => c.toUpperCase())}** is about ${size} long${measured.pieces > 1 ? `, adding up ${measured.pieces.toLocaleString()} pieces in ${e.title}` : ''}.${measured.capped ? ' There may be more pieces than I could read, so the real length may be longer.' : ''} Measured along the line on the map, so treat it as an estimate.`, mood: 'pleased', sources: [{ title: e.title, detail: 'measured from the line shapes' }] }
        } catch (err) { }
      }
    }
    const last = entries.find(e => e.path === this.lastLayer)
    const why: { ungrounded?: boolean } = {}
    const read = (): Ask | null => { try { return readAsk(raw, schemas, { fallback: last?.key, why }) } catch (e) { return null } }
    // "Zoom to Maple St", "show me Compass Park": a thing on the map called by its own name.
    let ask = read()
    if ((!ask || (ask.unknown.length > 0 && !ask.clauses.length)) && !only && ['zoom', 'goto', 'layerOn', 'showLayer', 'open', 'find', 'ask'].includes(intent)) {
      const phrase = raw.replace(/^(?:please\s+)?(?:zoom(?: in)?(?: to| on)?|go to|take me to|show me|show|find|where(?:'s| is| are)|locate|fly to|center on|pan to|jump to|bring up|pull up|highlight)\s+/i, '').replace(/[?.!]+$/, '').replace(/\s+on (?:the )?map$/i, '').trim()
      if (phrase && phrase !== raw.trim() && phrase.split(/\s+/).length <= 6 && !entries.some(e => { const a = e.title.toLowerCase().replace(/[^a-z0-9]+/g, ''); const b = phrase.toLowerCase().replace(/[^a-z0-9]+/g, ''); return a === b || a === b + 's' || a + 's' === b })) {
        let hit = namedFeature(phrase, schemas)
        if (!hit) { try { await Promise.all(entries.filter(e => live.isVisible(e)).slice(0, 6).map(e => loadValues(live, e))) } catch (e) { } schemas = entries.map(e => schemaOf(live, e)); hit = namedFeature(phrase, schemas) }
        const e = hit ? entries.find(x => x.key === hit!.layer.key) : null
        if (hit && e) {
          const reply = await this.answerAsk({ layer: e.key, kind: 'list', clauses: [{ field: hit.field, sql: `${hit.field.name} = '${hit.value.replace(/'/g, "''")}'`, said: `${fieldLabel(hit.field)} ${hit.value}` }], unknown: [] }, e)
          if (reply.results?.length) { try { await live.show(reply.results[0]) } catch (err) { } reply.text = `Here is **${hit.value}**, in ${e.title}.`; reply.mood = 'pleased'; reply.actions = (reply.actions || []).filter(a => a.type === 'layerOn'); return reply }
        }
      }
    }
    if (['zoom', 'goto'].includes(intent)) return null
    // First with what is already known; the layer's values are read (once) only when the words need them.
    const named = mentionedLayer(raw, schemas)
    const asking = /^(?:how (?:many|much|big|long|old|tall|wide)|which|what|who|whose|list|show|find|get|give|count|number|average|avg|mean|total|sum|top|biggest|largest|smallest|oldest|newest|most|least|cheapest|highest|lowest|longest|shortest|tallest|chart|graph|pie|break)\b/i.test(raw) && raw.trim().split(/\s+/).length >= 2
    const unread = (a: Ask): boolean => { const e = entries.find(x => x.key === a.layer); return !!e && !schemaOf(live, e).values }
    if (ask ? (ask.unknown.length > 0 || (!!ask.loose && unread(ask))) : (asking && !!why.ungrounded)) {
      const mine = ask ? entries.filter(e => e.key === ask!.layer) : []
      const need = named ? entries.filter(e => e.key === named.layer.key) : [...mine, ...(last ? [last] : []), ...entries.filter(e => live.isVisible(e) && e !== last)].slice(0, 5)
      try { await Promise.all(need.map(e => loadValues(live, e))) } catch (e) { }
      schemas = entries.map(e => schemaOf(live, e))
      ask = read()
    }
    // "Longest street", "shortest trail": a line layer with no length field is measured on the map.
    if (!ask && !only && named && /\b(longest|shortest)\b/i.test(raw) && raw.trim().split(/\s+/).length <= 8) {
      const e = entries.find(x => x.key === named.layer.key)
      const order = /shortest/i.test(raw) ? 'asc' : 'desc'
      let rows: Awaited<ReturnType<typeof rankLines>> = null
      try { rows = e ? await rankLines(live, e, order) : null } catch (err) { }
      if (e && rows) {
        const far = (feet: number): string => feet >= 1056 ? `${(feet / 5280).toFixed(1)} mi` : `${Math.round(feet).toLocaleString()} ft`
        this.lastLayer = e.path
        return {
          text: `The ${order === 'asc' ? 'shortest' : 'longest'} in **${e.title}** is **${rows[0].label}**: about ${far(rows[0].feet)}.${rows.length > 1 ? ` Next: ${rows.slice(1, 3).map(r => `${r.label} (${far(r.feet)})`).join(', ')}.` : ''} Measured along the lines on the map, adding up pieces with the same name, so treat it as an estimate.`,
          mood: 'pleased', sources: [{ title: e.title, detail: 'measured from the line shapes' }],
          table: { columns: [e.title, 'Length'], rows: rows.slice(0, 8).map(r => [r.label, far(r.feet)]) }
        }
      }
    }
    if (!ask || (only && !only.includes(ask.kind))) return null
    const entry = entries.find(e => e.key === ask!.layer)
    if (!entry) return null
    // A command that also reads as a plain layer ("show parcels") stays a command; a filter in it makes it a question.
    if (['layerOn', 'showLayer', 'open'].includes(intent) && ((!ask.clauses.length && ask.kind === 'list') || ask.unknown.length)) return null
    if (ask.unknown.length) {
      // Words that are not a field or a known value: a name, an owner, a street? Look for them as text.
      let found: Awaited<ReturnType<typeof probeText>> = null
      try { found = await probeText(live, entry, ask.unknown.join(' '), askWhere(ask)) } catch (e) { }
      if (found) { ask.clauses.push(found); ask.unknown = []; if (ask.kind === 'attr' && !ask.field) ask.kind = 'list' } else {
        // Not grounded. A plain "show ..." or "what ..." goes to the other readings; a count or a ranking must not ignore words.
        if ((ask.kind === 'list' || ask.kind === 'attr') && !ask.clauses.length) return null
        if (parseAnalysis(raw)) return null
        const fields = schemas.find(x => x.key === entry.key)!.fields.filter(f => !/oid|geometry|global/i.test(f.type || '') && !/^shape|objectid|globalid/i.test(f.name)).slice(0, 10).map(f => fieldLabel(f))
        this.lastLayer = entry.path
        return { text: `I looked in **${entry.title}** but could not match “${ask.unknown.join(' ')}” to anything there, so I did not guess. It has: ${fields.join(', ')}.`, mood: 'confused', suggest: [`What fields does ${entry.title} have?`, `How many ${entry.title}?`] }
      }
    }
    // A field asked about with nothing to narrow it ("what are the land uses") is its list of values; anything vaguer is not a data question.
    if (ask.kind === 'attr' && !ask.clauses.length) { if (!/^(?:what|which)\b/i.test(raw)) return null; ask.kind = 'distinct' }
    return await this.answerAsk(ask, entry)
  }

  private async answerAsk (ask: Ask, entry: LayerEntry, scope?: Scope): Promise<Reply> {
    const live = this.ctx.live
    try {
      // A scope limits the layer to a place ("within 300 ft of ..."); follow-ups keep it.
      const reply = await runAsk(scope ? scope.live : live, entry, ask, this.ctx.maxResults, scope ? { said: scope.said, narrowed: scope.narrowed } : undefined)
      this.lastLayer = entry.path
      this.lastAsk = { ask, key: entry.key, scope }
      this.lastAskReply = reply
      this.lastAskAt = Date.now()
      this.lastAnalysis = null; this.dataTask = null; this.tablePage = null
      this.lastResults = reply.results || []
      const some = reply.mood !== 'think'
      const actions: MappyAction[] = [...(reply.actions || [])]
      const limitedTo = ask.clauses.length > 0 || !!scope
      if (some && limitedTo && (ask.kind === 'count' || ask.kind === 'stat')) actions.push({ type: 'ask', q: '__ask:list', label: 'Show them' })
      if (some && limitedTo && ['count', 'list', 'stat', 'attr'].includes(ask.kind) && !entry.isTable) actions.push({ type: 'ask', q: '__ask:map', label: 'Only show them on the map' })
      if (some && ask.kind === 'list' && limitedTo) reply.suggest = ['How many of those?', 'Show them in a table']
      // The layer is off: the answer still stands, and one click shows it.
      if (!entry.isTable && !live.isVisible(entry)) actions.push({ type: 'layerOn', id: entry.key, label: `Turn on ${entry.title}` })
      if (actions.length) reply.actions = actions.slice(0, 4)
      return reply
    } catch (error) {
      return { text: error instanceof Error ? error.message : `**${entry.title}** did not answer. Try again in a moment.`, mood: 'confused' }
    }
  }

  /**
   * A follow-up to the data answer just given, said with a pronoun: "who owns it", "when was it
   * installed", "which ones are over 5 acres", "how many acres is that", "zoom to it", "only show
   * them on the map". It keeps the earlier filter (or the one record a ranking found) and adds to it.
   */
  private async followAsk (input: string): Promise<Reply | null> {
    // "What about 150 ft" after a question about a distance is that question again, not a new filter.
    if (this.lastSpatial && Date.now() - this.lastSpatial.at < 10 * 60000 && distanceSwap(input)) return null
    // Still the thing being talked about: asked within ten minutes, and no other data answer or place since.
    if (!this.lastAsk || this.lastAnalysis || /^__/.test(input) || Date.now() - this.lastAskAt > 600000 || (this.lastPlace && this.lastPlace.at > this.lastAskAt)) return null
    const live = this.ctx.live
    const entry = live.entries().find(e => e.key === this.lastAsk!.key)
    if (!entry || !live.ready) return null
    const t = input.trim().toLowerCase().replace(/[’`]/g, "'").replace(/[?.!]+$/, '').replace(/\s+/g, ' ')
    if (/^(?:only )?(?:show|display|see|put|filter)(?: me)?(?: only)? (?:them|those|these|that)(?: only)? (?:on|in) (?:the )?map$|^map (?:them|those|these)$|^filter (?:the map )?to (?:them|those|these)$/.test(t)) return await this.askAgain('map')
    const one = this.lastResults.length === 1 ? this.lastResults[0] : null
    if (one && /^(?:zoom|go|fly|pan|take me|jump|center)(?: in)?(?: to| on)? (?:it|that|that one|this one|there)$|^(?:where is (?:it|that)|show (?:me )?(?:it|that)(?: on the map)?)$/.test(t)) {
      try { await live.show(one) } catch (e) { }
      return { text: `Here is **${one.label}**.`, mood: 'acknowledge', results: [one] }
    }
    // "what about R-8", "and commercial", "how about the smallest": the same question with one thing swapped.
    const swap = t.match(/^(?:and |or |now )?(?:(?:what|how) about|and|or|same for|now)\s+(?:just |only )?(?:the ones? |those |in |for |with )?(.{2,60})$/)
    if (swap && !/\b(?:it|that|them|those|these|they)\b/.test(swap[1])) {
      const others = live.entries().filter(e => !e.isGroup && typeof live.target(e)?.queryFeatures === 'function').map(e => schemaOf(live, e))
      if (mentionedLayer(swap[1], others)) return null
      try { await loadValues(live, entry) } catch (e) { }
      const mine = schemaOf(live, entry)
      let next: Ask | null = null
      try { next = readAsk(`${swap[1]} ${entry.title}`, [mine], { fallback: entry.key }) } catch (e) { next = null }
      if (!next || next.unknown.length || (!next.clauses.length && next.kind !== 'top')) return null
      const prior = this.lastAsk.ask
      const kept = prior.clauses.filter(c => (c.field as any).type !== 'oid' && !next!.clauses.some(n => n.field.name === c.field.name))
      const ask: Ask = next.kind === 'top' ? { ...next, clauses: [...kept, ...next.clauses] } : { ...prior, clauses: [...kept, ...next.clauses] }
      return await this.answerAsk(ask, entry, this.lastAsk.scope)
    }
    if (!/\b(?:it|its|it's|that|that one|this one|them|those|these|they|their|theirs|ones?)\b/.test(t)) return null
    if (resultCountFollowup(input) || resultTableFollowup(input) || /^(?:show|list) (?:them|those|these)(?: all)?$/.test(t)) return null
    if (['layerOn', 'layerOff', 'zoom', 'goto', 'open', 'close', 'opacity', 'opacityStep', 'undo', 'redo', 'reveal', 'solo', 'pin', 'thanks', 'ack', 'repeat', 'copyAnswer', 'speak', 'explainLast', 'tryAgain', 'mapFilter', 'mapUnfilter', 'saveView', 'forget'].includes(parseIntent(input).name)) return null
    const schemas = live.entries().filter(e => !e.isGroup && typeof live.target(e)?.queryFeatures === 'function').map(e => schemaOf(live, e))
    if (mentionedLayer(t, schemas)) return null
    try { await loadValues(live, entry) } catch (e) { }
    const mine = schemaOf(live, entry)
    const words = t.replace(/\b(?:it's|its|it|that one|this one|that|them|those|these|they|their|theirs|ones?)\b/g, ' ').replace(/\b(?:of|about|for|on|in)\s*$/, ' ').replace(/\s+/g, ' ').trim()
    let ask: Ask | null = null
    try { ask = readAsk(`${words} ${entry.title}`, [mine], { fallback: entry.key }) } catch (e) { return null }
    if (!ask || ask.unknown.length) return null
    // What the earlier answer was about: its filter, or the single record it found.
    const prior = this.lastAsk.ask
    const target = live.target(entry)
    const id = one?.graphic?.attributes?.[target?.objectIdField]
    const carried = one && (prior.kind === 'top' || this.lastResults.length === 1) && Number.isFinite(Number(id)) && target?.objectIdField
      ? [{ field: { name: target.objectIdField, type: 'oid' } as any, sql: `${target.objectIdField} = ${Number(id)}`, said: one.label }]
      : prior.clauses.filter(c => !ask!.clauses.some(n => n.field.name === c.field.name))
    if (!carried.length && !ask.clauses.length && ask.kind !== 'attr') return null
    ask.clauses = [...carried, ...ask.clauses]
    if (ask.kind === 'distinct' && ask.clauses.length) ask.kind = 'attr'
    return await this.answerAsk(ask, entry, one ? undefined : this.lastAsk.scope)
  }

  /** One field of the parcel at an address, for the fields the place answers do not cover (sale date, value, land use, any field by its name). */
  private async addressAttr (input: string): Promise<Reply | null> {
    const live = this.ctx.live
    if (!this.ctx.featureSearch || !live.ready) return null
    const m = input.match(/\b(\d{1,6}\s+(?:[nsew]\.?\s+)?[a-z0-9.' ]{2,40}?\s(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pl|place|hwy|highway|pkwy|parkway|cir|circle|ter|terrace|trl|trail))\b\.?/i)
    if (!m) return null
    const entry = live.parcelLayers()[0]
    if (!entry || typeof live.target(entry)?.queryFeatures !== 'function') return null
    const schema = schemaOf(live, entry)
    const addr = fieldFor('address', schema.fields, 'text')
    if (!addr || !/^[a-z_][a-z0-9_.]*$/i.test(addr.name)) return null
    const rest = input.replace(m[0], ' ').replace(/\b(?:of|at|for|on|is|was|did|does|the)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    let ask: Ask | null = null
    try { ask = readAsk(`${rest} ${entry.title}`, [schema], { fallback: entry.key }) } catch (e) { return null }
    if (!ask || ask.kind !== 'attr' || !ask.field || ask.unknown.length || ask.clauses.length) return null
    const street = m[1].replace(/\s+/g, ' ').trim().replace(/[%_']/g, ' ')
    ask.clauses = [{ field: addr, sql: `UPPER(${addr.name}) LIKE '%${street.toUpperCase()}%'`, said: street }]
    const reply = await this.answerAsk(ask, entry)
    return reply.mood === 'think' || reply.mood === 'confused' ? null : reply
  }

  /** The buttons under a data answer: the same question as a list, a count, or a filter on the map. */
  private async askAgain (what: string): Promise<Reply> {
    const live = this.ctx.live
    const entry = this.lastAsk ? live.entries().find(e => e.key === this.lastAsk!.key) : null
    if (!this.lastAsk || !entry) return { text: 'That question is no longer in front of me. Ask it again and I will pick it up.', mood: 'confused' }
    const ask = this.lastAsk.ask
    const scope = this.lastAsk.scope
    if (what === 'list') return await this.answerAsk({ ...ask, kind: 'list', field: undefined, stat: undefined, group: undefined, limit: undefined, superlative: undefined }, entry, scope)
    if (what === 'count') return await this.answerAsk({ ...ask, kind: 'count', field: undefined, stat: undefined, group: undefined, limit: undefined, superlative: undefined }, entry, scope)
    if (what === 'map') {
      let where = askWhere(ask); let said = askSaid(ask)
      if (scope) {
        // A place cannot be written as a layer filter, so the map shows the exact features by their ids.
        const t = live.target(entry)
        if (!t?.objectIdField || typeof t.queryObjectIds !== 'function') return { text: 'That one is by place, and this layer cannot be filtered that way on the map. The list in the chat still zooms to each one.', mood: 'think' }
        let ids: number[] = scope.ids || []
        if (where || !scope.ids) { try { const q: any = scope.live.target(entry).createQuery(); q.where = `(${q.where || '1=1'}) AND (${where})`; ids = (await t.queryObjectIds(q)).map(Number) } catch (e) { return { text: `**${entry.title}** could not list those for the map.`, mood: 'confused' } } }
        if (ids.length > 1000) return { text: `That is ${ids.length.toLocaleString()} ${entry.title.toLowerCase()}, too many to pick out one by one on the map. Narrow it and try again.`, mood: 'think' }
        where = ids.length ? `${t.objectIdField} IN (${ids.join(', ')})` : '1=0'
        said = [said, scope.said].filter(Boolean).join(', ')
      }
      if (!where) return { text: 'There is no filter in that question to show on the map.', mood: 'think' }
      if (!live.setFilter(entry, where, said)) return { text: `**${entry.title}** cannot be filtered on this map.`, mood: 'confused' }
      if (!live.isVisible(entry)) live.setVisible(entry, true)
      let count: number | null = null
      try { count = await live.count(entry, false) } catch (err) { count = null }
      this.lastLayer = entry.path
      return { text: `**${entry.title}** now shows only the ones that match (${said})${count !== null ? `: ${count.toLocaleString()}` : ''}. The rest are hidden on the map until you clear the filter.`, mood: 'pleased', actions: [{ type: 'ask', q: `clear the filter on ${entry.title}`, label: 'Clear filter' }, { type: 'ask', q: `zoom to ${entry.title}`, label: 'Zoom to them' }] }
    }
    return { text: 'I do not know that button.', mood: 'confused' }
  }

  // ------------------------------------------------------------ keepsakes: stamps, the usual, a birthday

  keepsakes (): Keepsakes {
    const store = this.ctx.store
    if (!store) return this.keepMemory
    try { return readKeepsakes(store.get('mappy-keepsakes')) } catch (e) { return this.keepMemory }
  }

  private keepKeepsakes (k: Keepsakes): void {
    this.keepMemory = k
    try { this.ctx.store?.set('mappy-keepsakes', JSON.stringify(k)) } catch (e) { }
  }

  /** What this person asks most, for chips under the greeting. */
  usual (max = 3): string[] {
    if (this.ctx.fun === false) return []
    try { return usual(this.keepsakes(), max) } catch (e) { return [] }
  }

  private keepsakeSay (input: string): Reply | null {
    if (this.ctx.fun === false) return null
    let said: ReturnType<typeof keepsake> = null
    try { said = keepsake(input, this.keepsakes(), this.bond(), this.ctx.name, new Date(), this.ctx.place?.name || this.ctx.appTitle) } catch (e) { return null }
    if (!said) return null
    if (said.keep) this.keepKeepsakes(said.keep)
    this.keepsakeTurn = true
    const reply: Reply = { text: said.text, mood: said.mood as Reply['mood'] }
    if (said.suggest?.length) reply.suggest = said.suggest
    if (said.list?.length) reply.list = said.list.map(r => ({ label: r.label, detail: r.detail, glyph: r.glyph, sr: r.label === '???' ? 'Not earned yet' : 'Earned' }))
    if (said.card) reply.keepsake = said.card
    if (said.asks?.length) reply.actions = said.asks.slice(0, 4).map(q => ({ type: 'ask' as const, q, label: clip(q, 40) }))
    this.lastReply = reply
    return reply
  }

  // ------------------------------------------------------------ a person, privacy, what he missed

  misses (): Miss[] {
    const store = this.ctx.store
    if (!store) return this.missMemory
    try { return readMisses(store.get('mappy-missed')) } catch (e) { return this.missMemory }
  }

  private keepMisses (list: Miss[]): void {
    this.missMemory = list
    try { this.ctx.store?.set('mappy-missed', list.length ? JSON.stringify(list) : null) } catch (e) { }
  }

  /** One line about where the map is, for an email to a person (the app, a place, the layers on). */
  private whereLine (): string {
    try { return contextLine(this.handoffContext()) } catch (e) { return this.ctx.appTitle || '' }
  }

  private helperKind (): string { return this.ctx.serverAssistant ? 'claude' : this.ctx.assistant ? 'assistant' : this.ctx.mcp ? 'mcp' : 'local' }

  /** "Talk to a person", "what do you know about me", "forget everything", "what did you miss". */
  private care (input: string): Reply | null {
    const ask = parseCare(input)
    if (!ask) return null
    const c = this.ctx.contact || null
    if (ask === 'person') {
      const question = this.lastInput && !parseCare(this.lastInput) ? this.lastInput : ''
      if (c) return { text: contactText(c, question), mood: 'explain', actions: contactActions(c, { app: this.ctx.appTitle, question, said: question && this.lastReply ? this.lastReply.text.split('\n')[0] : '', where: this.whereLine() }), suggest: ['What can you do?'] }
      const site = this.ctx.place?.website
      const org = this.ctx.place?.org || 'the organization'
      return { text: `I am a map helper, not a person, and this app has no contact set up for me to hand you to.${site ? ` ${org.charAt(0).toUpperCase() + org.slice(1)}'s website is the best place to find one.` : ` The people at ${org} who run this app are the ones to ask.`}`, mood: 'sorry', actions: site && /^https:\/\//i.test(site) ? [{ type: 'url', url: site, label: 'Open the website' }] : undefined, suggest: ['What can you do?'] }
    }
    if (ask === 'privacy') {
      const bond = this.bond()
      return {
        text: privacyText({ name: this.ctx.name, helper: this.helperKind(), helperLabel: this.ctx.serverAssistant?.label || this.ctx.assistant?.label, serverLabel: this.ctx.mcp?.label, knowsName: bond.name, chats: bond.chats, misses: this.misses().length, sharesMisses: !!this.ctx.shareMisses, extras: keepsakeSummary(this.keepsakes()), savedViews: Object.keys(this.views()).length, telemetry: !!this.ctx.telemetry, locator: !!this.ctx.geocoders?.length, sharePicture: !!this.ctx.serverAssistant?.sharePicture }),
        mood: 'explain', suggest: ['Forget everything', ...(c ? ['Talk to a person'] : [])]
      }
    }
    if (ask === 'forgetAll') {
      this.bondMemory = emptyBond(); try { this.ctx.store?.set('mappy-bond', null) } catch (e) { }
      this.keepMisses([]); this.saveViews({}); this.keepMemory = emptyKeepsakes(); try { this.ctx.store?.set('mappy-keepsakes', null) } catch (e) { }
      this.lastLayer = ''; this.lastResults = []; this.lastReply = null; this.lastReadIntent = ''; this.tablePage = null; this.lastAnalysis = null; this.dataTask = null; this.layerPick = null
      this.lastInput = ''; this.stuckRun = 0; this.claudeTurns = []; this.claudeAt = 0; this.claudeFollowups = []; this.lastPlace = null; this.placeConversation = null
      return { text: 'Done. I erased everything I kept in this browser: this conversation, your name, our question count, your stamps and usual requests, saved views and the questions I missed. The map itself is unchanged.', mood: 'acknowledge', effect: 'forgetAll' }
    }
    const list = this.misses()
    if (ask === 'clearMissed') { this.keepMisses([]); return { text: list.length ? 'Done. The list of questions I missed is empty.' : 'That list was already empty.', mood: 'acknowledge' } }
    if (!list.length) return { text: 'Nothing on my list. I have answered everything asked in this browser so far.', mood: 'proud' }
    const mail = c ? missesMail(c, list, this.ctx.appTitle) : ''
    const save = { name: `missed-questions-${new Date().toISOString().slice(0, 10)}.csv`, text: missesCsv(list), type: 'text/csv;charset=utf-8', label: 'Save as a spreadsheet file' }
    if (ask === 'saveMissed') return { text: `${list.length === 1 ? 'The one question' : `All ${list.length} questions`} I could not answer in this browser, ready to save.`, mood: 'save', save, suggest: ['Clear missed questions'] }
    return {
      save,
      text: `Here ${list.length === 1 ? 'is the question' : `are the last ${Math.min(list.length, 10)} questions`} I could not answer in this browser. ${c ? `Sending them to ${c.name} helps the app builder teach me.` : 'The app builder can teach me these in my settings, under Questions and answers.'}`,
      mood: 'think',
      list: list.slice(0, 10).map(m => ({ label: m.q, detail: `${new Date(m.at).toISOString().slice(0, 10)}${m.n > 1 ? `, asked ${m.n} times` : ''}`, action: { type: 'ask' as const, q: m.q } })),
      actions: mail ? [{ type: 'url', url: mail, label: `Email these to ${c!.name}`.slice(0, 40) }] : undefined,
      suggest: ['Clear missed questions']
    }
  }

  private feelings (input: string): Reply | null {
    if (this.ctx.fun === false) return null
    let felt: ReturnType<typeof feel> = null
    try { felt = feel(input, this.bond(), this.keepsakes().nick || this.ctx.name) } catch (e) { return null }
    if (!felt) return null
    if (felt.name !== undefined) { const b = { ...this.bond() }; if (felt.name) b.name = felt.name; else delete b.name; this.keepBond(b) }
    const reply: Reply = { text: felt.text, mood: felt.mood as Reply['mood'] }
    if (felt.suggest?.length) reply.suggest = felt.suggest
    this.lastReply = reply
    return reply
  }

  // ------------------------------------------------------------ AI assistant handoff

  /** Where the map is, for the line that goes along with a handed-over question. */
  private handoffContext (): HandoffContext {
    const live = this.ctx.live
    const out: HandoffContext = { app: this.ctx.appTitle }
    try {
      const map = this.mapContext()
      if (map?.center) out.center = map.center
      if (this.lastPlace && Date.now() - this.lastPlace.at < 30 * 60000) out.place = this.lastPlace.label
      out.layersOn = live.entries().filter(e => !e.isGroup && live.isVisible(e)).map(e => e.title)
      const picked = live.selectedFeature()
      if (picked?.title) out.selected = picked.title
    } catch (e) { }
    return out
  }

  /** A thumbs up or down on one of Claude's answers goes to the server's feedback file. */
  private async rateClaude (helpful: boolean, id: number): Promise<Reply> {
    const sa = this.ctx.serverAssistant
    const port = this.ctx.mcp
    const turn = this.rated.get(id)
    if (!sa || !port || !turn) return { text: 'That answer is too far back to rate now, but thank you.', mood: 'acknowledge' }
    if (turn.done) return { text: 'Already noted. Thank you!', mood: 'pleased' }
    try {
      const raw = await port.call(FEEDBACK_TOOL, { question: turn.q, answer: turn.a, helpful })
      if (raw?.isError) return { text: String(raw?.content?.[0]?.text || 'The rating could not be saved.'), mood: 'confused' }
    } catch (e) { return { text: 'I could not reach the server to save that. Thank you anyway.', mood: 'alert' } }
    turn.done = true
    return helpful
      ? { text: pick(['Thank you! Noted for the GIS team.', 'Glad it helped. I passed that along.']), mood: 'grateful' }
      : { text: `Thank you for telling me. I noted it for the GIS team so ${sa.label} can do better. Want to ask it another way?`, mood: 'sorry' }
  }

  /** "ask Claude ..." when Claude answers inside the chat through the GIS server. */
  private async serverClaudeCommand (input: string): Promise<Reply | null> {
    const sa = this.ctx.serverAssistant
    if (!sa || /^__/.test(input)) return null
    const asked = parseHandoff(input, sa.label)
    if (!asked) return null
    const question = asked.question || this.lastInput
    if (!question) return { text: `Ask me anything after "ask ${sa.label}" and ${sa.label} will answer here, with the GIS data.`, mood: 'think' }
    // "ask Claude about this": what he just said goes along, so Claude knows what "this" is.
    let said = !asked.question && this.lastReply?.text ? `(The map helper had answered: "${clip(this.lastReply.text.replace(/\s+/g, ' '), 400)}")` : ''
    // His table goes along too (a few rows), so Claude can explain the numbers.
    const table = !asked.question ? this.lastReply?.table : undefined
    if (said && table?.rows?.length) said += ` (Its table, ${table.columns.join(' | ')}: ${clip(table.rows.slice(0, 8).map(r => r.join(' | ')).join('; '), 500)})`
    return this.askServerClaude(question, false, said)
  }

  /**
   * Right after a Claude answer, a follow-up goes back to Claude: one of the follow-ups it
   * suggested, or a question-shaped line that is not a request he knows ("what about the ones
   * on Main St", "why is that"). Map commands and place questions stay his.
   */
  private async claudeFollowUp (input: string): Promise<Reply | null> {
    // A distance change to the question about place just answered is his, not Claude's.
    if (this.lastSpatial && Date.now() - this.lastSpatial.at < 10 * 60000 && distanceSwap(input)) return null
    if (splitSpatial(input) && !/^__/.test(input)) { const across = await this.spatialQuestion(normalizeCommand(input)); if (across) return across }
    if (!this.ctx.serverAssistant || !this.claudeAt || Date.now() - this.claudeAt > 5 * 60000 || /^__/.test(input)) return null
    const plain = normalizeCommand(input).trim()
    const suggested = this.claudeFollowups.some(f => f.toLowerCase() === plain.toLowerCase())
    if (!suggested) {
      if (plain.split(/\s+/).length < 3 || parseIntent(plain).name !== 'ask' || parsePlaceQuestion(plain)) return null
      if (!/^(?:and|but|so|ok(?:ay)?,?|what about|how about|why|which|what|who|whose|how|when|where|is|are|was|were|does|do|did|can|could|would|should|tell me|explain|compare|also|only|just|break)\b/i.test(plain) && !/\?\s*$/.test(plain)) return null
      // A question he can answer himself from the layers stays his: it is quicker, and it does not use up the person's Claude questions.
      try {
        const own = await this.dataQuestion(input, 'ask')
        if (own && !['confused', 'think', 'alert', 'sorry'].includes(own.mood || '')) return own
      } catch (e) { }
    }
    return this.askServerClaude(input, true)
  }

  /** A long question that only got a word search back ("Found 1 match for <the whole question>") is not an answer. */
  private weakAnswer (input: string, reply: Reply): boolean {
    const words = input.trim().split(/\s+/).length
    return !!reply.results?.length && words >= 6 && /^(?:why|which|what|who|whose|how|when|where|is|are|does|do|did|can|could|should|tell me|explain|compare|list|show me)\b/i.test(input.trim()) &&
      reply.text.includes(`"${input.trim()}"`)
  }

  /** Stuck on a real question (a few words, nothing he can offer to fix himself): Claude answers it here. */
  private async askServerClaudeWhenStuck (input: string, reply: Reply): Promise<Reply> {
    if (this.weakAnswer(input, reply) && !/^__/.test(input) && Date.now() - this.mcpFailedAt >= 60000) return (await this.askServerClaude(input, true)) || reply
    if (reply.mood !== 'confused' || /^__/.test(input) || input.trim().split(/\s+/).length < 3 || (reply.actions || []).some(a => a.type !== 'ask')) return reply
    if (Date.now() - this.mcpFailedAt < 60000) return reply
    const answered = await this.askServerClaude(input, true)
    return answered || reply
  }

  /** "How many Claude questions do I have left": the server's own count for this person. */
  private async claudeUsage (): Promise<Reply> {
    const sa = this.ctx.serverAssistant
    const port = this.ctx.mcp
    if (!sa || !port) return { text: 'There is no AI assistant set up for this app, so there is nothing to count.', mood: 'explain' }
    try {
      if (!this.askTool) await this.serverTools()
      if (!this.usageTool) return { text: `${port.label} does not keep a count per person for ${sa.label}. The people who run this app can tell you about limits.`, mood: 'explain' }
      const raw: any = await port.call(USAGE_TOOL, {})
      const said = Array.isArray(raw?.content) ? raw.content.filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join(' ').trim() : ''
      return { text: clip(said, 400) || `${sa.label} did not say.`, mood: raw?.isError ? 'confused' : 'explain', sources: raw?.isError ? undefined : [{ title: port.label, detail: `counted for your sign-in, not for this browser` }] }
    } catch (e) {
      return { text: `I could not reach ${port.label} to check.`, mood: 'alert' }
    }
  }

  /** Claude on the GIS server answers with the server's own read-only tools. Null (quiet) when it cannot and `quiet` is set. */
  private async askServerClaude (question: string, quiet = false, extra = ''): Promise<Reply | null> {
    const sa = this.ctx.serverAssistant
    const port = this.ctx.mcp
    if (!sa || !port) return null
    try {
      if (!this.askTool) await this.serverTools()
    } catch (e) { this.mcpFailedAt = Date.now(); return quiet ? null : { text: `I could not reach ${port.label}, so ${sa.label} cannot answer right now.`, mood: 'alert' } }
    const tool = this.askTool
    if (!tool) return quiet ? null : { text: `${sa.label} is not turned on for ${port.label} yet. The GIS team can turn it on on the server.`, mood: 'confused' }
    // Something that looks like a card or Social Security number never leaves the browser.
    if (looksPrivate(question)) return { text: `That looks like it has a private number in it (a card or Social Security number), so I did not send it to ${sa.label}. Ask again without it.`, mood: 'alert' }
    const ctx = clip([this.handoffContextLine(), sa.shareSelection === false ? '' : this.selectedLine(), extra, this.helpFor(question)].filter(Boolean).join(' '), 2400)
    this.track('claude')
    // A question about what is on screen ("what am I looking at", "which of these is biggest")
    // takes a small picture of the map along, when the builder turned that on.
    let image = ''
    if (sa.sharePicture && ABOUT_THE_SCREEN.test(question)) { try { image = await this.ctx.live.screenshot() } catch (e) { image = '' } }
    try { this.ctx.waiting?.(image ? `${sa.label} is looking at the map...` : `${sa.label} is checking the GIS data...`) } catch (e) { }
    let raw: any
    try {
      raw = await port.call(tool.name, { question: clip(question, 1500), ...(ctx ? { context: ctx } : {}), ...(image ? { image } : {}), ...(this.claudeTurns.length ? { history: this.claudeTurns.slice(-3) } : {}) }, 110000)
    } catch (e) {
      this.ctx.beacon?.error(e, 'claude')
      return quiet ? null : { text: e instanceof Error ? e.message : `${sa.label} did not answer.`, mood: 'alert' }
    }
    const said = Array.isArray(raw?.content) ? raw.content.filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join('\n').trim() : ''
    // A limit or a sign-in problem is said out loud even when Claude was only a quiet second try.
    if (raw?.isError) return quiet && !/sign in|a lot of questions|today|this month|you have used|certain groups|busy/i.test(said) ? null : { text: said || `${sa.label} could not answer that one.`, mood: 'confused' }
    const answer = String(raw?.structuredContent?.answer || said || '').trim()
    if (!answer) return quiet ? null : { text: `${sa.label} did not come back with an answer.`, mood: 'confused' }
    this.claudeTurns.push({ q: clip(question, 600), a: clip(answer, 1500) })
    if (this.claudeTurns.length > 3) this.claudeTurns.shift()
    const data: any = raw?.structuredContent || {}
    const used: string[] = Array.isArray(data.tools_used) ? data.tools_used.map(String) : []
    // Buttons Claude asked for: zoom to a place it found, turn on a layer that shows the answer.
    const actions: MappyAction[] = []
    for (const m of (Array.isArray(data.map) ? data.map : []).slice(0, 3)) {
      if (m?.type === 'place' && Number.isFinite(m.latitude) && Number.isFinite(m.longitude) && Math.abs(m.latitude) <= 90 && Math.abs(m.longitude) <= 180) {
        const label = clip(String(m.label || 'that spot').replace(/[*_`\[\]]/g, ''), 40)
        this.placeNames.set(placeKey(m.latitude, m.longitude), label)
        actions.push({ type: 'ask', q: `zoom to ${m.latitude}, ${m.longitude}`, label: `Zoom to ${label}` })
      } else if (m?.type === 'layer' && typeof m.layer === 'string' && m.layer.trim()) {
        const name = clip(m.layer.replace(/[*_`\[\]]/g, '').trim(), 40)
        if (!/^__/.test(name)) actions.push({ type: 'ask', q: `turn on ${name}`, label: `Turn on ${name}` })
      } else if (m?.type === 'command' && typeof m.command === 'string') {
        // Only requests he understands himself become buttons; nothing runs until it is clicked.
        const command = m.command.replace(/\s+/g, ' ').trim()
        let known = false
        try { known = command.length > 2 && command.length <= 160 && !/^_/.test(command) && parseIntent(normalizeCommand(command)).name !== 'ask' } catch (e) { }
        if (known) actions.push({ type: 'ask', q: command, label: clip(String(m.label || command).replace(/[*_`\[\]]/g, '').trim() || command, 40) })
      }
    }
    const followups: string[] = (Array.isArray(data.followups) ? data.followups : []).filter((f: any) => typeof f === 'string' && !/^\s*__/.test(f)).map((f: any) => clip(String(f || '').replace(/[*_`]/g, '').trim(), 70)).filter((f: string) => f.length > 3 && !/^__/.test(f)).slice(0, 3)
    this.claudeAt = Date.now()
    this.claudeFollowups = followups
    const reply: Reply = {
      text: answer,
      mood: 'explain',
      sources: [{ title: sa.label, detail: (used.length ? `using ${port.label}: ${Array.from(new Set(used)).map(n => n.replace(/_/g, ' ')).join(', ')}` : `through ${port.label}`) + (data.saw_map ? ', with a picture of the map' : '') }]
    }
    if (actions.length) reply.actions = actions
    if (followups.length) reply.suggest = followups
    // Say plainly that this one came from an AI.
    if (sa.note) reply.note = clip(sa.note, 200)
    // Close to this person's limit: say how many are left, before they hit it.
    const left = usageNote(data.limits, sa.label)
    if (left) reply.note = reply.note ? `${reply.note} ${left}` : left
    // Thumbs under the answer, when the server keeps ratings.
    if (this.rateTool) {
      const id = ++this.rateSeq
      this.rated.set(id, { q: clip(question, 400), a: clip(answer, 800) })
      if (this.rated.size > 12) this.rated.delete(Array.from(this.rated.keys())[0])
      reply.rate = { up: `__claudefb:up:${id}`, down: `__claudefb:down:${id}` }
    }
    // A chart or a small table Claude built from what it looked up.
    const chartRows = (Array.isArray(data.chart?.rows) ? data.chart.rows : []).filter((r: any) => r && typeof r.label === 'string' && Number.isFinite(r.value)).slice(0, 12)
      .map((r: any) => ({ label: clip(r.label, 40), value: Number(r.value) }))
    if (chartRows.length >= 2) reply.chart = { title: clip(String(data.chart.title || ''), 60) || undefined, rows: chartRows, unit: clip(String(data.chart.unit || ''), 20) || undefined }
    const cols: string[] = (Array.isArray(data.table?.columns) ? data.table.columns : []).slice(0, 6).map((c: any) => clip(String(c ?? ''), 30))
    const rows: string[][] = (Array.isArray(data.table?.rows) ? data.table.rows : []).filter((r: any) => Array.isArray(r)).slice(0, 15)
      .map((r: any[]) => cols.map((_, i) => clip(String(r[i] ?? ''), 80)))
    if (cols.length && rows.length) reply.table = { columns: cols, rows }
    this.lastReply = reply
    return reply
  }

  /** The feature under the open popup, in a line: its layer and a few of its values, so "this parcel" means something. */
  private selectedLine (): string {
    try {
      const f = this.ctx.live.selectedFeature()
      if (!f?.title) return ''
      const pairs: string[] = []
      for (const [k, v] of Object.entries(f.attributes || {})) {
        if (v == null || String(v).trim() === '' || /^(?:objectid|fid|oid|globalid|shape)|shape[._]|globalid|created_|last_edited|^gdb_/i.test(k)) continue
        const field = f.fields.find(x => x.name === k)
        pairs.push(`${clip(String(field?.alias || k), 30)}: ${clip(String(v).replace(/\s+/g, ' '), 60)}`)
        if (pairs.length >= 6) break
      }
      return pairs.length ? `(Selected ${clip(f.title, 40)} feature: ${pairs.join('; ')}.)` : ''
    } catch (e) { return '' }
  }

  /**
   * What the app's own help says about a question: the closest things Mappy knows (the builder's
   * answers and notes, tool help, the glossary), so Claude can answer "how do I print to PDF here"
   * from this app's words instead of guessing. Layer and field records are left out; Claude has
   * the GIS tools for those.
   */
  private helpFor (question: string): string {
    try {
      const hits = this.ctx.index.search(question, { limit: 6 } as any).filter(h => !['layer', 'table', 'field', 'bookmark'].includes(h.doc.kind as string) && h.doc.text).slice(0, 3)
      if (!hits.length) return ''
      return `(From this app's own help: ${hits.map(h => `${clip(h.doc.title, 60)}: ${clip(h.doc.text.replace(/\s+/g, ' '), 260)}`).join(' | ')})`
    } catch (e) { return '' }
  }

  /** The line about the map for a question going to Claude, and the app's own tools, so it can point at them. */
  private handoffContextLine (): string {
    try {
      const tools = Array.from(new Set(this.ctx.index.docs.filter(d => d.kind === 'widget').map(d => d.title.trim()).filter(Boolean))).slice(0, 14)
      const live = this.ctx.live
      const layers = Array.from(new Set(live.entries().filter(e => !e.isGroup).map(e => e.title.trim()).filter(Boolean))).slice(0, 24)
      return [contextLine(this.handoffContext()), tools.length ? `(Tools in this app: ${tools.map(t => clip(t, 30)).join(', ')}.)` : '', layers.length ? `(Layers in this map: ${layers.map(t => clip(t, 34)).join(', ')}.)` : ''].filter(Boolean).join(' ')
    } catch (e) { return '' }
  }

  /** "ask Claude ...", "send that to Claude": one link that opens the assistant with the question written. */
  private assistantCommand (input: string): Reply | null {
    const port = this.ctx.assistant
    if (!port || /^__/.test(input)) return null
    const asked = parseHandoff(input, port.label)
    if (!asked) return null
    const question = asked.question || this.lastInput
    if (!question) return { text: `Say "ask ${port.label}" and then your question, and I will open it there for you.`, mood: 'think', suggest: [`Ask ${port.label} what this map shows`] }
    const url = handoffUrl(port, question, this.handoffContext())
    if (!url) return { text: `I could not build a link to ${port.label}. The app builder can check its address in my settings.`, mood: 'confused' }
    this.track('assistant')
    return {
      text: `One click and **${port.label}** opens in a new tab with this written for you:\n\n“${clip(question, 160)}”${port.context ? '\n\nWhere the map is goes along with it.' : ''}`,
      mood: 'mail',
      actions: [{ type: 'url', url, label: `Ask ${port.label}` }]
    }
  }

  /** Stuck, and the builder chose an assistant as the helper: the answer carries one link to it. */
  private offerAssistant (input: string, reply: Reply): Reply {
    const port = this.ctx.assistant
    if (!port || reply.mood !== 'confused' || /^__/.test(input)) return reply
    // A few words at least (not a stray key press), and nothing he already offers to fix himself
    // (a layer to turn on, a place to pick): "did you mean" guesses do not count.
    if (input.trim().split(/\s+/).length < 3 || (reply.actions || []).some(a => a.type !== 'ask')) return reply
    if ((reply.actions || []).some(a => a.type === 'url' && /^Ask /.test(a.label || ''))) return reply
    const url = handoffUrl(port, input, this.handoffContext())
    if (!url) return reply
    const job = assistantJob(input)
    return {
      ...reply,
      text: job ? `That is more than a map helper can do, but **${port.label}** can take it from here.` : `${reply.text}\n\n**${port.label}** may be able to answer that one.`,
      mood: 'think',
      actions: job ? [{ type: 'url', url, label: `Ask ${port.label}` }] : [{ type: 'url' as const, url, label: `Ask ${port.label}` }, ...(reply.actions || [])].slice(0, 4)
    }
  }

  // ------------------------------------------------------------ MCP server

  private async serverTools (): Promise<McpTool[]> {
    const port = this.ctx.mcp
    if (!port) return []
    const prefs = JSON.stringify(port.prefs || [])
    const tools = await port.tools()
    if (port !== this.ctx.mcp || prefs !== JSON.stringify(port.prefs || [])) throw new Error('The server settings changed. Please ask again.')
    const usable = usableTools(tools, port.prefs)
    this.askTool = usable.find(t => t.name === ASK_TOOL) || null
    this.rateTool = tools.some(t => t.name === FEEDBACK_TOOL)
    this.usageTool = tools.some(t => t.name === USAGE_TOOL)
    this.mcpTools = usable.filter(t => t.name !== ASK_TOOL && t.name !== FEEDBACK_TOOL && t.name !== USAGE_TOOL)
    // Esri's own catalog (MCP for ArcGIS Enterprise), directly or passed through another server: he knows these tools by name.
    this.esri = esriCatalog(this.mcpTools.filter(t => !needsConfirm(t, port.prefs)))
    this.loadServerLayers(port)
    return this.mcpTools
  }

  /** Reads the server's layer names once, in the background; suggestions only offer what exists. */
  private loadServerLayers (port: any): void {
    if (this.serverLayerNames?.port === port) return
    this.serverLayerNames = { port, names: [] }
    const tool = this.mcpTools.find(t => /^list_?layers$/i.test(t.name) && !needsConfirm(t, port.prefs))
    if (!tool) return
    Promise.resolve(port.call(tool.name, {})).then((raw: any) => {
      const rows = raw?.structuredContent?.layers
      if (Array.isArray(rows) && this.serverLayerNames?.port === port) this.serverLayerNames.names = rows.map((r: any) => `${r.path || ''} ${r.name || ''}`)
    }).catch(() => {})
  }

  /** Whether the app's map or the server has a layer like this; null when nothing is known yet. */
  private layerTest (): ((re: RegExp) => boolean) | null {
    let local: string[] = []
    try { local = this.ctx.live.entries().map(e => `${e.path || ''} ${e.title}`) } catch (e) { }
    const all = [...local, ...(this.serverLayerNames?.names || [])]
    return all.length ? (re: RegExp) => all.some(n => re.test(n)) : null
  }

  /** Server commands: list its tools, "ask the server ...", "use <tool> with ...", and the Run and Cancel buttons. */
  private async mcpCommand (text: string): Promise<Reply | null> {
    const port = this.ctx.mcp
    const t = text.trim()
    const listAsk = /^(?:(?:list|show)(?: me)?(?: the)? (?:server|mcp|remote) tools|what can (?:the )?(?:mcp |remote )?server do|(?:server|mcp) tools)[?.!]*$/i.test(t)
    const askServer = t.match(/^(?:ask|use|try|search)\s+(?:the\s+)?(?:mcp\s+)?server\s+(?:to\s+|for\s+|about\s+)?(.+)$/i)
    if (!port) return listAsk || askServer || /^__mcp:/.test(t) ? { text: 'No MCP server is connected. The app builder can add one in Mappy\'s settings, under MCP server.', mood: 'confused' } : null
    try {
      const run = t.match(/^__mcp:run:(\d+)$/)
      if (run) {
        const p = this.mcpPending
        this.mcpPending = null
        if (!p || p.sequence !== Number(run[1])) return { text: 'That request is no longer waiting. Ask again and I will set it up fresh.', mood: 'confused' }
        return this.runTool(p.tool, p.args)
      }
      if (/^__mcp:cancel$/.test(t)) { this.mcpPending = null; return { text: `Cancelled. Nothing was sent to ${port.label}.`, mood: 'acknowledge' } }
      const asked = t.match(/^__mcp:ask:([\s\S]+)$/)
      if (asked) return this.askServer(asked[1])
      if (listAsk) {
        const tools = await this.serverTools()
        if (!tools.length) return { text: `${port.label} has no tools turned on for this app.`, mood: 'confused' }
        return {
          text: `${port.label} has ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'} I can use. Pick one, or just ask and I will choose.`,
          mood: 'talk',
          list: tools.slice(0, 30).map(tool => ({ label: toolLabel(tool), detail: clip(tool.description || '', 140), action: { type: 'ask' as const, q: `use ${tool.name}`, label: toolLabel(tool) } }))
        }
      }
      if (askServer) return this.askServer(askServer[1])
      const labelWords = flat(port.label).split(' ').filter(Boolean)
      if (labelWords.length) {
        const named = t.match(new RegExp('^ask\\W+(?:the\\W+)?' + labelWords.map(w => w.replace(/[^a-z0-9]/g, '')).join('\\W+') + '\\W*\\s+([\\s\\S]+)$', 'i'))
        if (named) return this.askServer(named[1].trim())
      }
      const use = t.match(/^(?:use|run|call)\s+(?:the\s+)?(?:tool\s+)?([A-Za-z][\w.-]*)\b\s*([\s\S]*)$/i)
      if (use) {
        // "use the measure tool" is usually about the app; only a server tool's exact name goes to the server.
        let tools = this.mcpTools
        if (!tools.length && Date.now() - this.mcpFailedAt > 60000) {
          try { tools = await this.serverTools() } catch (e) { this.mcpFailedAt = Date.now(); return null }
        }
        const tool = tools.find(x => x.name.toLowerCase() === use[1].toLowerCase() || flat(x.name) === flat(use[1]))
        if (tool) return this.prepareTool(tool, use[2])
      }
    } catch (e) {
      this.ctx.beacon?.error(e, 'mcp')
      return { text: e instanceof Error ? e.message : `${port.label} did not answer.`, mood: 'alert' }
    }
    return null
  }

  // ------------------------------------------------------------ plain questions about places

  /**
   * Questions about places, answered by the GIS server the way a person would ask them:
   * "what is the closest sewer line to my address", "hydrants within 500 ft of here",
   * "who owns 123 Main St", "count sewer mains by material". Remembers "my address", and asks
   * for a missing place instead of guessing.
   */
  private async placeQuestion (text: string, raw: string): Promise<Reply | null> {
    // "What else is there", "what's the name of this map": about the app, not a place.
    if (NOT_PLACE.has(parseIntent(text).name)) return null
    const t = text.trim().replace(/\s+/g, ' ')
    // The address typed as-is, not as the typo reader saw it.
    const said = raw.trim().replace(/\s+/g, ' ')
    const mine = said.match(/^(?:my (?:home |house |street )?address is|i live at|my house is at|(?:remember|save|set) my address(?: is| as| to)?|use my address)\s+(.+?)[.!]*$/i)
    if (mine) {
      this.myAddress = saveMyAddress(mine[1])
      const waiting = this.awaitingPlace
      this.awaitingPlace = null
      if (waiting) return this.placeQuestion(placeInto(waiting.question, this.myAddress), placeInto(waiting.question, this.myAddress))
      return { text: `Got it. When you say “my address” I will use **${this.myAddress}**.`, mood: 'pleased', suggest: ['Closest sewer line to my address', "What's at my address?"] }
    }
    if (/^(?:forget|clear|remove|delete) my address[.!]*$/i.test(t)) { this.myAddress = saveMyAddress(''); return { text: 'Done. I no longer have an address for you.', mood: 'acknowledge' } }
    if (/^what(?:'s|s| is) my address\??$/i.test(t)) return { text: this.myAddress ? `Your address is **${this.myAddress}**. Say “my address is ...” to change it.` : 'I do not have your address yet. Say “my address is 250 N 5th St”.', mood: 'talk' }
    const port = this.ctx.mcp
    if (/^__/.test(t)) { this.awaitingPlace = null; return null }
    // Without a server, questions about what is at a place still work from the app's own layers.
    const serverOn = !!port && port.fallback !== false

    // The answer to "Closest to where?" or "What's your address?".
    if (this.awaitingPlace) {
      const waiting = this.awaitingPlace
      this.awaitingPlace = null
      const answer = said.replace(/^(?:it(?:'s| is)|at|to|from|use)\s+/i, '').replace(/[.!]+$/, '')
      if (/^(?:cancel|never ?mind|forget it|stop)$/i.test(answer)) return { text: 'OK, never mind.', mood: 'talk' }
      if (/^(?:here|the map|map|map center|me|my location|this spot|use the map(?: center)?)$/i.test(answer)) return this.placeQuestion(placeInto(waiting.question, 'here'), '')
      if (/^my address$/i.test(answer)) {
        if (this.myAddress) return this.placeQuestion(placeInto(waiting.question, this.myAddress), '')
        this.awaitingPlace = { question: waiting.question, mine: true }
        return { text: 'What is your address? I will remember it while this page is open.', mood: 'think' }
      }
      if (looksLikePlace(answer) || /,/.test(answer)) {
        if (waiting.mine) this.myAddress = saveMyAddress(answer)
        const reply = await this.placeQuestion(placeInto(waiting.question, answer), '')
        if (reply && waiting.mine) reply.text += `\n\n(I will remember ${this.myAddress} as your address.)`
        return reply
      }
      // Not an address: a new request.
    }

    let q = t
    // Two questions in one: "who owns 1718 White Ave and what zone is it".
    const both = q.match(/^(.+?)\s+(?:and|&|also|plus)\s+((?:what|which|who|whats|what's|is|are|when|how|does)\b.+)$/i)
    if (both && parsePlaceQuestion(both[1]) && !/\b(?:and|&)\b/.test(both[2])) {
      const first = await this.placeQuestion(both[1], both[1])
      if (first && !['confused', 'think'].includes(first.mood || '')) {
        const second = await this.placeQuestion(both[2], '')
        if (second) return { ...second, text: `${first.text}\n\n${second.text}`, sources: [...(first.sources || []), ...(second.sources || [])], actions: [...(first.actions || []), ...(second.actions || [])].slice(0, 4) }
        return first
      }
    }
    // "When is my trash day", "who is my council rep": about my address.
    if (/\bmy\b/i.test(q) && !MY_PLACE.test(q) && !parsePlaceQuestion(q)) {
      const mine = q.replace(/\bmy\s+/i, 'the ').replace(/[?.!]+$/, '') + ' for my address'
      if (parsePlaceQuestion(mine.replace(MY_PLACE, '1 Main St'))) q = mine
    }
    // "When is trash day", "what zone am I in", "who is my council rep" with no place at all: ask for one.
    if (!parsePlaceQuestion(q) && /^(?:when(?:'s| is) (?:the )?(?:trash|garbage|recycling|recycle|yard waste|pickup|collection)(?: (?:day|pickup|collected|collection))?|what(?:'s| is) (?:the )?(?:zoning|zone|flood zone|council district|district|school|ward|precinct)(?: here)?|who(?:'s| is) (?:the |my )?(?:council (?:rep|member|representative)|representative|councilman|councilwoman|councilor))[?.!]*$/i.test(q)) {
      const question = q.replace(/[?.!]+$/, '').replace(/\s+here$/i, '') + ' at 1 Main St'
      if (parsePlaceQuestion(question)) {
        this.awaitingPlace = { question, mine: false }
        return { text: 'For which address? Give me one, say "my address", or choose the middle of the map.', mood: 'think', actions: [{ type: 'ask', q: 'here', label: 'Middle of the map' }, ...(this.myAddress ? [{ type: 'ask' as const, q: 'my address', label: 'My address' }] : [])] }
      }
    }
    // "How far is 1718 White Ave from City Hall", "what does Jane Doe own".
    const distance = await this.distanceQuestion(q)
    if (distance) return distance
    // "Directions to City Hall from 1718 White Ave", "how do I get to the library".
    const directions = await this.directionsQuestion(q)
    if (directions) return directions
    // "What are the coordinates of 1718 White Ave".
    const coords = await this.coordinatesQuestion(q)
    if (coords) return coords
    // "Compare 1718 White Ave and 250 N 5th St", "which is bigger, A or B".
    const compared = serverOn ? await this.compareQuestion(q) : null
    if (compared) return compared
    const owned = serverOn ? await this.ownedBy(q) : null
    if (owned) return owned
    // "Who owns 2945-144-01-014", "tell me about parcel 2945-144-01-014": a parcel by its number.
    const byNumber = serverOn ? await this.parcelByNumber(q) : null
    if (byNumber) return byNumber
    // "who owns it", "what zone is this", "who owns that parcel": the place just shown.
    let spotLabel = ''
    let fromPopup = false
    if (/^(?:who owns|who is the owner|who's the owner|owner)\??$/i.test(q)) q = 'who owns it'
    // "closest hydrant to me", "parks near me", "what zone am I in": where the person is (the
    // device's location, when they allow it), not the middle of the map.
    const amI = q.match(/^(what|which)\s+(.+?)\s+am\s+i\s+in[?.!]*$/i)
    const meWords = /\b(to|near|around|by|of|from)\s+(?:me|my\s+(?:current\s+)?location|where\s+i\s+am)\b/i
    const placeLike = amI || (meWords.test(q) && parsePlaceQuestion(q.replace(meWords, (m, prep) => `${prep} 39.0, -108.5`)))
    if (placeLike && this.ctx.myLocation) {
      const at = await this.ctx.myLocation()
      if (!at) this.locationNote = true
      if (at) {
        const coords = `${at[0].toFixed(6)}, ${at[1].toFixed(6)}`
        q = amI ? `${amI[1]} ${amI[2]} is ${coords} in` : q.replace(meWords, (m, prep) => `${prep} ${coords}`)
        spotLabel = 'your location'
        this.placeNames.set(placeKey(at[0], at[1]), 'your location')
      }
    }
    // "Whose property is this", "whose house is that": who owns it.
    q = q.replace(/^whose\s+(?:property|parcel|land|house|lot|building|home)\s+is\s+(this|that|it|here)[?.!]*$/i, 'who owns $1')
    const thisPlace = q.match(THIS_PLACE)
    if (thisPlace && parsePlaceQuestion(q.replace(THIS_PLACE, ' 1 Main St'))) {
      const spot = this.recentPlace()
      if (spot) {
        q = q.replace(THIS_PLACE, ` ${spot.lat.toFixed(6)}, ${spot.lon.toFixed(6)}`)
        spotLabel = spot.label
        fromPopup = !!spot.popup
        // Follow-up chips and later "it" keep the place's name, never its coordinates.
        this.placeNames.set(placeKey(spot.lat, spot.lon), spot.label)
        if (!spot.popup) this.lastPlace = { label: spot.label, lat: spot.lat, lon: spot.lon, at: Date.now() }
      } else {
        this.awaitingPlace = { question: q, mine: false }
        return { text: 'Which place do you mean? Give me an address, or choose the middle of the map.', mood: 'think', actions: [{ type: 'ask', q: 'here', label: 'Middle of the map' }] }
      }
    }
    const usesMine = MY_PLACE.test(q)
    if (usesMine) {
      if (!parsePlaceQuestion(placeInto(q, '1 Main St'))) return null
      if (!this.myAddress) {
        this.awaitingPlace = { question: q, mine: true }
        return { text: 'What is your address? I will remember it while this page is open.', mood: 'think', actions: [{ type: 'ask', q: 'here', label: 'Use the map center' }] }
      }
      q = placeInto(q, this.myAddress)
    }
    const pq = parsePlaceQuestion(q)
    // A place carried over as coordinates keeps the name it had ("it" was 250 N 5th St).
    const coordsKey = pq?.place?.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
    if (coordsKey) {
      const key = placeKey(Number(coordsKey[1]), Number(coordsKey[2]))
      if (spotLabel) this.placeNames.set(key, spotLabel)
      else spotLabel = this.placeNames.get(key) || ''
    }
    if (!pq) return null
    // "What address is at 39.06, -108.55", "what is the address here": the closest address to a point.
    if (pq.kind === 'at' && /^(?:the )?(?:nearest |closest )?(?:street )?address$/i.test(pq.thing || '') && serverOn && (coordsKey || pq.here)) {
      const at: [number, number] | null = coordsKey ? [Number(coordsKey[1]), Number(coordsKey[2])] : this.mapContext()?.center || null
      if (at) {
        try {
          const port = this.ctx.mcp!
          const tool = (await this.serverTools()).find(t => /reverse/i.test(t.name) && placeKeys(t).lat && !needsConfirm(t, port.prefs))
          if (tool) {
            const keys = placeKeys(tool)
            const reply = await this.runTool(tool, { [keys.lat!]: Number(at[0].toFixed(6)), [keys.lon!]: Number(at[1].toFixed(6)) })
            if (!['confused', 'attention'].includes(reply.mood || '')) {
              const found = niceAddress(String(readReverse(this.lastToolData) || reply.text.match(/address:?\s*([^.\n]+)/i)?.[1] || '').split(',')[0].trim())
              if (found) { this.placeNames.set(placeKey(at[0], at[1]), found); this.lastPlace = { label: found, lat: at[0], lon: at[1], at: Date.now() }; reply.text = `The closest address to that spot is **${found}**.` }
              await this.ctx.live.showPlaces(at, [], {})
              reply.suggest = [`Who owns ${found || 'it'}?`, `What's at ${found || 'that spot'}?`]
              return reply
            }
          }
        } catch (e) { }
      }
    }
    if (pq.kind === 'at') {
      const local = await this.answerAtFromMap(pq, spotLabel, !serverOn, fromPopup, q)
      if (local) { if (!['confused', 'think'].includes(local.mood || '')) this.rememberPlaceQuestion(pq); return local }
    }
    // "Closest hydrant to ...", "hydrants within 500 ft of ...": from the app's own layers when
    // there is no server, or the server has no tool for it (Esri's Location Services, say).
    const nearLocal = async (): Promise<Reply | null> => {
      if (!['nearest', 'within'].includes(pq.kind) || !pq.thing) return null
      const r = await this.answerNearFromMap(pq, spotLabel, q)
      if (r && !['confused', 'think'].includes(r.mood || '')) this.rememberPlaceQuestion(pq)
      return r
    }
    if (!serverOn) { const r = await nearLocal(); if (r) return r; if (this.awaitingPlace) this.awaitingPlace = null; return null }
    if (Date.now() - this.mcpFailedAt < 60000) return (await nearLocal()) || null
    let tools: McpTool[] = []
    try { tools = await this.serverTools() } catch (e) { this.mcpFailedAt = Date.now(); return (await nearLocal()) || null }
    const fits = rankTools(q, tools).filter(r => placeToolFits(r.tool, pq))
    if (!fits.length) return (await nearLocal()) || null
    const tool = fits[0].tool
    const map = this.mapContext()
    const { missing } = fillArgs(tool, q, map)
    const keys = placeKeys(tool)
    const needsPlace = missing.some(k => k === keys.address || k === keys.lat || k === keys.lon)
    if (needsPlace) {
      if (pq.here && !map?.center) return { text: 'I cannot read where the map is right now. Give me an address instead.', mood: 'confused' }
      this.awaitingPlace = { question: q, mine: false }
      const where = pq.kind === 'nearest' ? `Closest to where? Give me an address${this.myAddress ? ', or use yours' : ''}, or I can use the middle of the map.` : 'Where? Give me an address, or I can use the middle of the map.'
      const actions: MappyAction[] = [{ type: 'ask', q: 'here', label: 'Middle of the map' }]
      if (this.myAddress) actions.unshift({ type: 'ask', q: 'my address', label: clip(this.myAddress, 30) })
      return { text: where, mood: 'think', actions }
    }
    if (missing.length) return null
    try {
      const reply = await this.prepareTool(tool, q)
      if (spotLabel) reply.text = reply.text.replace(/\bthat spot\b/g, spotLabel).replace(/^That spot\b/, spotLabel)
      if (!['confused', 'think', 'attention'].includes(reply.mood || '')) {
        this.rememberPlaceQuestion(pq, map)
        // "Who owns ...": say the owner, not the whole parcel record.
        // Answer the question asked, in one line; the full record goes under Details.
        if (pq.kind === 'at') { this.focusAnswer(pq, q, reply, spotLabel); if (!reply.mood || reply.mood === 'talk' || reply.mood === 'pleased') reply.mood = 'checking' }
        await this.showOnMap(pq, reply)
        const same = (a: string) => a.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
        reply.suggest = followUps(pq, q, this.layerTest()).filter(f => same(f) !== same(q)).concat(reply.suggest || []).slice(0, 3)
          .map(f => this.nameCoordinates(f))
      }
      return reply
    } catch (e) {
      this.ctx.beacon?.error(e, 'mcp')
      // The server failed: the app's own layers may still answer a nearest or within question.
      const local = await nearLocal()
      if (local) return local
      return { text: e instanceof Error ? e.message : `${port.label} did not answer.`, mood: 'alert' }
    }
  }

  /**
   * "Closest hydrant to 1138 White Ave", "hydrants within 500 ft of here", from the app's own
   * layers: the address through the locator, then the layer queried by distance, nearest first,
   * with pins and rings on the map. Null when the map has no layer like that.
   */
  private async answerNearFromMap (pq: PlaceQuestion, spotLabel: string, q: string): Promise<Reply | null> {
    const live = this.ctx.live
    if (!live.view || !pq.thing) return null
    const e = live.matchTitle(pq.thing) || this.resolveLayer(pq.thing, true)
    if (!e || e.isGroup || e.isTable) return null
    if (!live.canAsk(e)) return this.offReply(e)
    if (!pq.place && !pq.here) {
      this.awaitingPlace = { question: q, mine: false }
      const actions: MappyAction[] = [{ type: 'ask', q: 'here', label: 'Middle of the map' }]
      if (this.myAddress) actions.unshift({ type: 'ask', q: 'my address', label: clip(this.myAddress, 30) })
      return { text: `Closest to where? Give me an address${this.myAddress ? ', or use yours' : ''}, or I can use the middle of the map.`, mood: 'think', actions }
    }
    const spot = await this.pointFor(pq, spotLabel)
    if (!spot) return pq.place ? { text: `I could not find "${pq.place}" with the app's locator. Try the address with its street type, or a nearby cross street.`, mood: 'confused' } : { text: 'I cannot read where the map is right now. Give me an address instead.', mood: 'confused' }
    const origin: [number, number] | null = Array.isArray(spot.at) ? [Number(spot.at[0]), Number(spot.at[1])] : this.toLatLon(spot.at)
    if (!origin) return null
    const within = pq.kind === 'within'
    const limit = pq.limit || (within ? Math.max(10, this.ctx.maxResults) : 3)
    let rows: Array<{ graphic: any, feet: number, latLon: [number, number] }> = []
    try {
      if (within) rows = await live.near(e, origin, pq.feet || 500, limit)
      else for (const feet of [500, 2000, 8000, 26400]) { rows = await live.near(e, origin, feet, limit); if (rows.length >= limit || feet === 26400) break }
    } catch (err) { return { text: `**${e.title}** could not be searched by distance (${err instanceof Error ? err.message : 'query failed'}).`, mood: 'alert' } }
    const info = live.info(e)
    const name = (g: any): string => {
      const a = g.attributes || {}
      const display = (live.target(e)?.displayField && a[live.target(e).displayField]) || a.NAME || a.Name || a.FACILITYID || a.FacilityID || a.ASSETID || a.ADDRESS || a.SITUS || a[Object.keys(a).find(k => (/name/i.test(k) || /id$/i.test(k)) && a[k] != null && !/objectid|globalid/i.test(k)) || '']
      return display != null && display !== '' ? String(display) : `${e.title.replace(/s$/i, '')} ${a[live.target(e)?.objectIdField] ?? ''}`.trim()
    }
    const ft = (n: number): string => n < 1 ? 'right there' : n < 5280 ? `${Math.round(n).toLocaleString()} ft` : `${(n / 5280).toFixed(1)} mi`
    const where = spot.label || (pq.here ? 'the middle of the map' : niceAddress(pq.place || ''))
    if (!rows.length) {
      return { text: within ? `No **${e.title}** within ${ft(pq.feet || 500)} of ${where}.` : `No **${e.title}** within 5 miles of ${where}.`, mood: 'talk', suggest: within ? [q.replace(/\d[\d,]*\s*(?:feet|ft|foot|miles?|mi)/i, m => /mi/i.test(m) ? '5 miles' : `${Math.min(26400, (pq.feet || 500) * 4).toLocaleString()} ft`)] : [] }
    }
    const results = rows.map(r => ({ entry: e, graphic: r.graphic, label: name(r.graphic), detail: ft(r.feet) + ' away' }))
    this.lastResults = results
    try { await live.showPlaces(origin, rows.map(r => r.latLon), { line: !within && rows.length > 0 }) } catch (err) { }
    const first = rows[0]
    const text = within
      ? `**${rows.length}${rows.length >= limit ? '+' : ''} ${e.title}** within ${ft(pq.feet || 500)} of ${where}, nearest first.`
      : `The closest **${e.title.replace(/s$/i, '')}** to ${where} is **${name(first.graphic)}**, ${first.feet < 1 ? 'right there' : ft(first.feet) + ' away'}${rows.length > 1 ? `; then ${rows.slice(1, 3).map(r => `${name(r.graphic)} (${ft(r.feet)})`).join(', ')}` : ''}.`
    this.lastLayer = e.path
    return {
      text, mood: 'checking', results, sources: [{ title: e.title, detail: `Live layer query by distance from ${where}` }],
      suggest: [within ? `Closest ${pq.thing} to ${pq.place || 'here'}` : `${pq.thing} within 1000 ft of ${pq.place || 'here'}`, `How many ${e.title} in view`, 'Zoom to it'].slice(0, 3)
    }
  }

  /**
   * A server's "what is at" answer, focused: "Who owns ..." gets the owner, "what zone ..." the
   * zone, "is it in city limits" a yes or no, each in one sentence. The whole record moves into
   * the Details fold instead of a table.
   */
  private focusAnswer (pq: PlaceQuestion, q: string, reply: Reply, spotLabel: string): void {
    const data = this.lastToolData
    const hits: any[] | null = Array.isArray(data?.results) ? data.results : null
    if (!hits) return
    const where = spotLabel || (pq.place && !/^-?\d+\.\d+\s*,/.test(pq.place) ? niceAddress(pq.place) : '') || (pq.here ? 'the middle of the map' : 'that spot')
    const port = this.ctx.mcp
    const pairsOf = (h: any) => String(h?.summary || '').split(/;\s*/).map(p => { const i = p.indexOf(':'); return i > 0 ? { label: p.slice(0, i).trim(), value: p.slice(i + 1).trim() } : null }).filter(Boolean) as Array<{ label: string, value: string }>
    const hit = hits[0]
    const layer = hit ? String(hit.layer || pq.thing || '') : ''
    const pairs = pairsOf(hit)
    const ownerAsked = /^(?:who owns|who is the owner|owner of|who's the owner)/i.test(q)
    // Every record found goes in the Details fold, one field per line.
    const details = hits.length ? hits.slice(0, 12).map(h => ({ title: (h.layer_path || h.layer) + (port ? ` (${port.label})` : ''), detail: pairsOf(h).map(p => `${p.label}: ${p.value}`).join('\n') || String(h.summary || '') })) : (reply.sources || [])
    delete reply.table
    if (!hits.length) {
      reply.text = pq.yesNo ? `**No.** ${where} is not in ${pq.thing || 'that'}.` : ownerAsked || pq.field ? `I could not find a parcel at ${where}.` : `I found no ${pq.thing || 'features'} at ${where}.`
      return
    }
    reply.sources = details
    if (pq.field) { reply.text = fieldSentence(pq.field, pairs, where) || `I found the parcel at ${where}, but it has no ${pq.field} field.`; return }
    if (ownerAsked) { reply.text = ownerSentence(pairs, where) || `I found the parcel at ${where}, but it has no owner field.`; return }
    // "What's at 1718 White Ave": a short property summary, one line per layer.
    if (!pq.thing) {
      const lines = hits.slice(0, 10).map(h => {
        const ps = pairsOf(h)
        const own = ps.find(p => /^(owner|owner name|owners?)$/i.test(p.label))
        if (own) return `- **Owner:** ${own.value}${(ps.find(p => /^parcel (number|num|no|id)$/i.test(p.label)) || { value: '' }).value ? ` (Parcel ${ps.find(p => /^parcel (number|num|no|id)$/i.test(p.label))!.value})` : ''}`
        const best = pickAnswer(ps, String(h.layer || ''))
        return `- **${shortLayer(String(h.layer || ''))}:** ${best ? best.value : 'yes'}`
      })
      reply.text = `**${where}**\n${lines.join('\n')}`
      return
    }
    // Several layers fit equally ("which school": elementary, middle and high): one line each.
    const sameKind = hits.filter(h => h.layer && pq.thing && words(String(h.layer)).some(w => words(pq.thing!).includes(w)))
    if (sameKind.length > 1 && !pq.yesNo) {
      reply.text = `${where}:\n${sameKind.slice(0, 6).map(h => { const b = pickAnswer(pairsOf(h), pq.thing || ''); return `- **${shortLayer(String(h.layer))}:** ${b ? b.value : 'yes'}` }).join('\n')}`
      return
    }
    const best = pickAnswer(pairs, pq.thing || '')
    const named = best && flat(best.value) !== flat(layer) ? best : null
    const flood = pq.yesNo && /flood|sfha|floodplain|floodway/i.test(`${pq.thing} ${layer}`) ? floodVerdict(pairs, where) : ''
    if (flood) reply.text = flood
    else if (pq.yesNo) reply.text = this.inAreaVerdict(where, pq.thing || '', layer, named ? named.value : '')
    else reply.text = named ? placeFact(where, pq.thing || '', layer, named.label, named.value, q) : `${where} is in ${layer}.`
  }

  /**
   * Puts a place answer on the map the way a person would want it: turns on the layer the
   * answer came from (when the app has it), pins the place asked about, rings what was found,
   * draws a line to the closest one and zooms to fit. "undo" turns the layer back off.
   */
  private async showOnMap (pq: NonNullable<ReturnType<typeof parsePlaceQuestion>>, reply: Reply): Promise<void> {
    const data = this.lastToolData
    const live = this.ctx.live
    if (!data || !live.view) return
    const ll = (o: any): [number, number] | null => o && Number.isFinite(Number(o.latitude)) && Number.isFinite(Number(o.longitude)) ? [Number(o.latitude), Number(o.longitude)] : null
    const origin = ll(data.from) || ll(data)
    if (origin && (data.from?.place || data.place) && !/^that spot$/i.test(String(data.from?.place || data.place))) this.placeNames.set(placeKey(origin[0], origin[1]), niceAddress(String(data.from?.place || data.place)))
    if (origin) this.lastPlace = { label: String(data.from?.place || data.place || this.lastPlace?.label || '').replace(/^that spot$/, this.lastPlace?.label || 'that spot'), lat: origin[0], lon: origin[1], at: Date.now() }
    const rings = pq.kind === 'at' && Array.isArray(data.results) && data.results.length === 1 ? data.results[0].geometry?.rings : null
    const spots = (Array.isArray(data.features) ? data.features : []).map(ll).filter(Boolean) as Array<[number, number]>
    const notes: string[] = []
    // The layer: what the server searched, or for "what zone is ..." the one layer asked about.
    let layerName: string = typeof data.layer === 'string' ? data.layer : ''
    if (!layerName && pq.kind === 'at' && Array.isArray(data.results) && data.results.length === 1) layerName = String(data.results[0].layer || '')
    try {
      const entry = layerName ? live.matchTitle(layerName, typeof data.layer_path === 'string' ? data.layer_path : (Array.isArray(data.results) && data.results[0]?.layer_path) || '') : null
      // The same features can go to the Table: those within the distance searched.
      const dists = (Array.isArray(data.features) ? data.features : []).map((f: any) => Number(f.distance_feet)).filter((n: number) => Number.isFinite(n))
      if (entry && origin && this.ctx.openInTable && (pq.kind === 'within' || dists.length)) {
        const feet = pq.kind === 'within' ? (pq.feet || Math.max(500, ...dists)) : Math.max(...dists) + 3
        reply.actions = [...(reply.actions || []), this.tableAction(entry, { near: { lat: origin[0], lon: origin[1], feet }, label: `${entry.title} near ${clip(String(data.from?.place || data.place || 'here'), 30)}` })]
      }
      if (entry && !live.isVisible(entry)) {
        const before = live.snapshot()
        live.setVisible(entry, true)
        if (live.remember(before, `turn on ${entry.title}`)) this.lastLayer = entry.title
        notes.push(`turned on **${entry.title}**`)
      } else if (entry) this.lastLayer = entry.title
    } catch (e) { }
    if (origin || spots.length) {
      const shown = await live.showPlaces(origin, pq.kind === 'within' ? spots : spots.slice(0, 1), { line: pq.kind === 'nearest', rings: Array.isArray(rings) ? rings : undefined })
      if (shown) notes.push(pq.kind === 'within' ? 'marked them on the map' : rings ? 'outlined it' : 'zoomed to it')
    }
    if (notes.length) {
      reply.text += `\n\nI ${notes.join(' and ')}.`
      reply.actions = (reply.actions || []).filter(a => a.label !== 'Zoom there')
      if (notes[0].startsWith('turned on')) reply.actions.push({ type: 'ask', q: 'undo', label: 'Undo' })
    }
  }

  // ------------------------------------------------------------ distance and ownership searches

  /** A place said in words as a point: an address (server or app locator), "here", "it", "my house". */
  private async locate (words: string): Promise<{ label: string, at: [number, number] } | null> {
    const w = words.trim().replace(/[?.!]+$/, '').replace(/^the\s+/i, '')
    if (/^(?:here|me|the map|the middle of the map|where i am)$/i.test(w)) { const c = this.mapContext()?.center; return c ? { label: 'the middle of the map', at: c } : null }
    if (/^(?:it|this|that|there|this (?:place|spot|address|parcel|property)|that (?:place|address))$/i.test(w)) { const r = this.recentPlace(); return r ? { label: r.label, at: [r.lat, r.lon] } : null }
    if (MY_PLACE.test(w)) { if (!this.myAddress) return null; return this.locate(this.myAddress) }
    const coords = w.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
    if (coords) return { label: this.placeNames.get(placeKey(Number(coords[1]), Number(coords[2]))) || w, at: [Number(coords[1]), Number(coords[2])] }
    const port = this.ctx.mcp
    if (port && port.fallback !== false) {
      try {
        const tool = (await this.serverTools()).find(t => /geocode|find_?address|address_?candidates/i.test(t.name) && !/reverse/i.test(t.name) && placeKeys(t).address && !needsConfirm(t, port.prefs))
        if (tool) {
          const esriOwn = this.esri?.geocode === tool
          const raw = await port.call(tool.name, esriOwn ? geocodeArgs(tool, w) : { [placeKeys(tool).address!]: w })
          const c = readCandidates(toolData(raw))[0]
          if (c && c.score >= 75) return { label: niceAddress(String(c.address || w).split(',')[0]), at: [c.lat, c.lon] }
        }
      } catch (e) { }
    }
    if (this.ctx.geocoders?.length && this.ctx.live.view) {
      try {
        const best = (await geocodeAddress(w, this.ctx.geocoders, this.ctx.live.view)).results[0]
        const ll = best && best.score >= 80 ? this.toLatLon(best.location) : null
        if (ll) return { label: niceAddress(String(best.label || w).split(',')[0]), at: ll }
      } catch (e) { }
    }
    return null
  }

  /** "How far is 1718 White Ave from City Hall": straight-line distance, both pinned and joined on the map. */
  private async distanceQuestion (q: string): Promise<Reply | null> {
    const m = q.match(DISTANCE_Q)
    if (!m || /^(?:the\s+)?(?:closest|nearest)\b/i.test(m[1])) return null
    const [a, b] = await Promise.all([this.locate(m[1]), this.locate(m[2])])
    if (!a || !b) {
      const missing = !a ? m[1] : m[2]
      if (MY_PLACE.test(missing) && !this.myAddress) return { text: 'What is your address? Say “my address is ...”, then ask again.', mood: 'think' }
      return { text: `I could not find “${clip(missing, 60)}” as a place. Try a street address.`, mood: 'confused' }
    }
    const feet = groundFeet(a.at, b.at)
    const said = feet < 1000 ? `**${Math.round(feet / 10) * 10} ft**` : `**${(feet / 5280).toFixed(feet < 52800 ? 1 : 0)} mi**`
    const shown = await this.ctx.live.showPlaces(a.at, [b.at], { line: true })
    this.lastPlace = { label: b.label, lat: b.at[0], lon: b.at[1], at: Date.now() }
    this.placeNames.set(placeKey(a.at[0], a.at[1]), a.label); this.placeNames.set(placeKey(b.at[0], b.at[1]), b.label)
    return {
      text: `${a.label} is ${said} from ${b.label} in a straight line${feet >= 1000 ? ` (about ${Math.round(feet).toLocaleString()} ft)` : ''}. Driving distance is longer.${shown ? '\n\nBoth are pinned on the map.' : ''}`,
      mood: 'pleased', suggest: [`Who owns ${b.label}?`, `What zoning is ${b.label} in?`]
    }
  }

  /** Whether an address can be turned into a point at all (a server geocoder or the app's own). */
  private canLocate (): boolean {
    return !!((this.ctx.mcp && this.ctx.mcp.fallback !== false) || (this.ctx.geocoders?.length && this.ctx.live.view))
  }

  /** "What are the coordinates of X", "lat long of X", "where exactly is X": the point, pinned. */
  private async coordinatesQuestion (q: string): Promise<Reply | null> {
    const m = q.replace(/[?.!]+$/, '').match(/^(?:what(?:'s| is| are)\s+(?:the\s+)?(?:coordinates|coords|lat(?:itude)?(?: and|\/| )long(?:itude)?|lat\/?lon|location|gps(?: coordinates)?|x and y|xy)\s+(?:of|for|at)\s+|(?:coordinates|coords|lat long|lat\/long|gps)\s+(?:of|for|at)\s+)(.+)$/i)
    if (!m) return null
    const where = m[1].trim()
    if (/^(?:here|the map|the map center|this|it)$/i.test(where)) { const c = this.mapContext()?.center; if (!c) return null; return { text: `The middle of the map is at **${c[0].toFixed(5)}, ${c[1].toFixed(5)}** (latitude, longitude).`, mood: 'talk' } }
    if (this.ctx.index.resolve(where, ['widget', 'page', 'view', 'dialog', 'bookmark'], 2)) return null
    const spot = await this.locate(where)
    if (!spot) return this.canLocate() ? { text: `I could not find "${clip(where, 60)}" as a place. Try a street address.`, mood: 'confused' } : null
    await this.ctx.live.showPlaces(spot.at, [], {})
    this.lastPlace = { label: spot.label, lat: spot.at[0], lon: spot.at[1], at: Date.now() }
    this.placeNames.set(placeKey(spot.at[0], spot.at[1]), spot.label)
    return { text: `**${spot.label}** is at **${spot.at[0].toFixed(6)}, ${spot.at[1].toFixed(6)}** (latitude, longitude). I pinned it.`, mood: 'pleased', suggest: [`Who owns ${spot.label}?`, `What's at ${spot.label}?`] }
  }

  /**
   * "Directions to City Hall", "how do I get to the library from 1718 White Ave": the server's
   * route tool when it has one, else both places pinned with the straight-line distance and a
   * link that opens turn-by-turn directions in a maps app.
   */
  private async directionsQuestion (q: string): Promise<Reply | null> {
    const t = q.replace(/[?.!]+$/, '').trim()
    const m = t.match(/^(?:(?:get |give me |show me )?(?:driving |walking |biking |cycling )?directions\s+(?:to|for)\s+|how (?:do|can|would) i (?:get|drive|walk|bike|go|travel) to\s+|(?:route|drive|walk)\s+(?:me\s+)?to\s+|(?:what(?:'s| is) the )?(?:best |fastest |quickest )?(?:way|route) to\s+)(.+?)(?:\s+from\s+(.+))?$/i) || (() => { const r = parseRoute(t); return r ? [t, r.to, r.from] as any : null })()
    if (!m) return null
    // "How do I get to the legend": a tool or page, not a place.
    if (this.ctx.index.resolve(m[1].trim(), ['widget', 'page', 'view', 'dialog', 'bookmark'], 2)) return null
    if (!this.canLocate()) return null
    const mode = /walk/i.test(t) ? 'walking' : /bik|cycl/i.test(t) ? 'bicycling' : 'driving'
    const toWords = m[1].trim(); const fromWords = (m[2] || '').trim()
    const to = await this.locate(toWords)
    if (!to) return /\d/.test(toWords) || /\b(?:st|ave|rd|dr|blvd|hall|park|school|library)\b/i.test(toWords) ? { text: `I could not find "${clip(toWords, 60)}" as a place. Try a street address or a place on the map.`, mood: 'confused' } : null
    let from = fromWords ? await this.locate(fromWords) : null
    if (fromWords && !from) {
      if (MY_PLACE.test(fromWords) && !this.myAddress) return { text: 'What is your address? Say "my address is ...", then ask again.', mood: 'think' }
      return { text: `I could not find "${clip(fromWords, 60)}" as a starting place.`, mood: 'confused' }
    }
    if (!from && this.ctx.myLocation) { const at = await this.ctx.myLocation(); if (at) from = { label: 'your location', at } }
    if (!from && this.myAddress) from = await this.locate(this.myAddress)
    if (!from) { const c = this.mapContext()?.center; if (c) from = { label: 'the middle of the map', at: c } }
    if (!from) return null
    // The server's own route tool, when it has one.
    const port = this.ctx.mcp
    if (port && port.fallback !== false) {
      try {
        const tool = (await this.serverTools()).find(x => /route|directions/i.test(x.name) && !needsConfirm(x, port.prefs))
        if (tool && this.esri?.route === tool && mode !== 'bicycling') {
          // Esri's solve_route: points as objects, the road it follows drawn on the map, steps listed.
          this.track('mcp:' + tool.name)
          const raw = await port.call(tool.name, routeArgs(tool, from, to, mode === 'walking' ? 'walking' : 'driving', /\bshortest\b/i.test(t)), 45000)
          const route = raw?.isError ? null : readRoute(toolData(raw))
          if (route) {
            const drawn = await this.ctx.live.showPlaces(from.at, [to.at], route.path.length > 1 ? { path: route.path } : { line: true })
            this.lastPlace = { label: to.label, lat: to.at[0], lon: to.at[1], at: Date.now() }
            this.placeNames.set(placeKey(from.at[0], from.at[1]), from.label); this.placeNames.set(placeKey(to.at[0], to.at[1]), to.label)
            const size = [route.distance, route.time].filter(Boolean).join(', about ')
            const reply: Reply = {
              text: `${mode === 'walking' ? 'Walking' : 'Driving'} from ${from.label} to **${to.label}**${size ? `: **${size}**` : ''}.${drawn && route.path.length > 1 ? ' The route is drawn on the map.' : ''}${route.steps.length ? '\n\n' + route.steps.slice(0, 12).map((s, i) => `${i + 1}. ${s}`).join('\n') + (route.steps.length > 12 ? `\n… and ${route.steps.length - 12} more steps.` : '') : ''}`,
              mood: 'route', sources: [{ title: port.label, detail: `${toolLabel(tool)} · roads and travel times from your organization's route service` }],
              suggest: [`What's at ${to.label}?`, mode === 'walking' ? `Driving directions to ${to.label}` : `Walking directions to ${to.label}`]
            }
            return reply
          }
          if (raw?.isError) return { text: `${port.label} could not plan that route: ${clip(toolError(raw), 200)}`, mood: 'confused' }
        } else if (tool) {
          const keys = Object.keys(tool.inputSchema?.properties || {})
          const fromKey = keys.find(k => /^(from|origin|start|stops)$/i.test(k)); const toKey = keys.find(k => /^(to|destination|end)$/i.test(k))
          if (fromKey && toKey) {
            const r = await this.runTool(tool, { [fromKey]: `${from.at[0]},${from.at[1]}`, [toKey]: `${to.at[0]},${to.at[1]}` })
            if (!['confused', 'attention'].includes(r.mood || '')) { await this.ctx.live.showPlaces(from.at, [to.at], { line: true }); return r }
          }
        }
      } catch (e) { }
    }
    const feet = groundFeet(from.at, to.at)
    const said = feet < 1000 ? `${Math.round(feet / 10) * 10} ft` : `${(feet / 5280).toFixed(feet < 52800 ? 1 : 0)} mi`
    const shown = await this.ctx.live.showPlaces(from.at, [to.at], { line: true })
    this.lastPlace = { label: to.label, lat: to.at[0], lon: to.at[1], at: Date.now() }
    this.placeNames.set(placeKey(from.at[0], from.at[1]), from.label); this.placeNames.set(placeKey(to.at[0], to.at[1]), to.label)
    const url = `https://www.google.com/maps/dir/?api=1&origin=${from.at[0].toFixed(6)},${from.at[1].toFixed(6)}&destination=${to.at[0].toFixed(6)},${to.at[1].toFixed(6)}&travelmode=${mode}`
    return {
      text: `**${to.label}** is about **${said}** from ${from.label} in a straight line.${shown ? ' Both are pinned on the map.' : ''} I cannot plan a route myself, but a maps app can take it from here.`,
      mood: 'route',
      actions: [{ type: 'url', url, label: `Turn-by-turn directions (${mode})` }],
      suggest: [`What's at ${to.label}?`, `Closest parking to ${to.label}`]
    }
  }

  /** The server's parcel record at a point, as label/value pairs (empty when none). */
  private async parcelPairs (at: [number, number]): Promise<Array<{ label: string, value: string }>> {
    const port = this.ctx.mcp
    if (!port || port.fallback === false) return []
    try {
      const tool = (await this.serverTools()).find(t => placeToolFits(t, { kind: 'at' }) && placeKeys(t).lat && !needsConfirm(t, port.prefs))
      if (!tool) return []
      const keys = placeKeys(tool)
      const layerKey = Object.keys(tool.inputSchema?.properties || {}).find(k => /^layer/i.test(k))
      const raw = await port.call(tool.name, { [keys.lat!]: Number(at[0].toFixed(6)), [keys.lon!]: Number(at[1].toFixed(6)), ...(layerKey ? { [layerKey]: 'parcel' } : {}) })
      const hit = !raw?.isError && Array.isArray(raw?.structuredContent?.results) ? raw.structuredContent.results[0] : null
      if (!hit) return []
      return String(hit.summary || '').split(/;\s*/).map(p => { const i = p.indexOf(':'); return i > 0 ? { label: p.slice(0, i).trim(), value: p.slice(i + 1).trim() } : null }).filter(Boolean) as Array<{ label: string, value: string }>
    } catch (e) { return [] }
  }

  /** "Compare 1718 White Ave and 250 N 5th St": the two parcel records side by side, with the answer first. */
  private async compareQuestion (q: string): Promise<Reply | null> {
    const t = q.replace(/[?.!]+$/, '').trim()
    const m = t.match(/^(?:compare\s+(.+?)\s+(?:and|with|to|vs\.?|versus)\s+(.+)|(?:which|what)\s+(?:is|one is|'s)\s+(bigger|larger|smaller|older|newer|more valuable|worth more)[,:]?\s+(.+?)\s+(?:or|vs\.?|versus)\s+(.+)|is\s+(.+?)\s+(bigger|larger|smaller|older|newer)\s+than\s+(.+))$/i)
    if (!m) return null
    const aWords = (m[1] || m[4] || m[6] || '').trim(); const bWords = (m[2] || m[5] || m[8] || '').trim()
    const ask = (m[3] || m[7] || '').toLowerCase()
    if (!aWords || !bWords || !/\d/.test(aWords + bWords) && !/^(?:my |city hall)/i.test(aWords + ' ' + bWords)) return null
    const [a, b] = await Promise.all([this.locate(aWords), this.locate(bWords)])
    if (!a || !b) return { text: `I could not find “${clip(!a ? aWords : bWords, 60)}” as a place. Try two street addresses.`, mood: 'confused' }
    const [pa, pb] = await Promise.all([this.parcelPairs(a.at), this.parcelPairs(b.at)])
    if (!pa.length || !pb.length) return { text: `I could not get a parcel record for ${!pa.length ? a.label : b.label}.`, mood: 'confused' }
    const get = (pairs: typeof pa, re: RegExp) => pairs.find(p => re.test(p.label))?.value || ''
    const num = (v: string) => Number(String(v).replace(/[^\d.-]/g, ''))
    const rows: Array<[string, RegExp]> = [['Owner', /^owner(?: name)?$/i], ['Acres', /^acres$|acreage/i], ['Year built', /year built/i], ['Zoning', /zon/i], ['Parcel number', /parcel (?:number|num|no|id)/i], ['Address', /^(?:location|situs|address)/i]]
    const table = { columns: ['', a.label, b.label], rows: rows.map(([lab, re]) => [lab, get(pa, re), get(pb, re)]).filter(r => r[1] || r[2]) }
    let lead = ''
    const acresA = num(get(pa, /^acres$|acreage/i)); const acresB = num(get(pb, /^acres$|acreage/i))
    const yearA = num(get(pa, /year built/i)); const yearB = num(get(pb, /year built/i))
    if (/bigger|larger|smaller/.test(ask) || !ask) {
      if (Number.isFinite(acresA) && Number.isFinite(acresB) && acresA && acresB) {
        const bigger = acresA >= acresB ? a : b; const small = acresA >= acresB ? b : a
        lead = ask === 'smaller' ? `**${small.label}** is smaller (${Math.min(acresA, acresB).toFixed(2)} vs ${Math.max(acresA, acresB).toFixed(2)} acres).` : `**${bigger.label}** is bigger: ${Math.max(acresA, acresB).toFixed(2)} acres vs ${Math.min(acresA, acresB).toFixed(2)}${acresA === acresB ? ' (the same)' : ''}.`
      }
    } else if (/older|newer/.test(ask) && yearA && yearB) {
      const older = yearA <= yearB ? a : b; const newer = yearA <= yearB ? b : a
      lead = ask === 'older' ? `**${older.label}** is older (built ${Math.min(yearA, yearB)} vs ${Math.max(yearA, yearB)}).` : `**${newer.label}** is newer (built ${Math.max(yearA, yearB)} vs ${Math.min(yearA, yearB)}).`
    }
    if (!lead && ask) lead = `I could not compare ${ask.replace(/er$/, '')} for those two; the records do not both say.`
    await this.ctx.live.showPlaces(a.at, [b.at], { line: false })
    this.placeNames.set(placeKey(a.at[0], a.at[1]), a.label); this.placeNames.set(placeKey(b.at[0], b.at[1]), b.label)
    this.lastPlace = { label: b.label, lat: b.at[0], lon: b.at[1], at: Date.now() }
    return { text: lead || `**${a.label}** and **${b.label}**, side by side:`, mood: 'pleased', table, suggest: [`Who owns ${a.label}?`, `Who owns ${b.label}?`] }
  }

  /** A parcel looked up by its number, through the server's parcel search. */
  private async parcelByNumber (q: string): Promise<Reply | null> {
    const m = q.replace(/[?.!]+$/, '').match(/^(?:(who owns|who is the owner of|who'?s the owner of|owner of|what is the owner of)|tell me about|what is|what'?s|show me|find|look up|where is)\s+(?:the\s+)?(?:parcel|parcel number|apn|pin|account|schedule)?\s*#?\s*(\d{3,}[-\d]{5,}|\d{8,})$/i)
    if (!m) return null
    const wantsOwner = !!m[1]
    const number = m[2]
    const port = this.ctx.mcp!
    const tool = (await this.serverTools()).find(t => /find|search/i.test(t.name) && !/content|address/i.test(t.name) && Object.keys(t.inputSchema?.properties || {}).some(k => /^layer/i.test(k)) && !needsConfirm(t, port.prefs))
    if (!tool) return null
    const props = tool.inputSchema?.properties || {}
    const layerKey = Object.keys(props).find(k => /^layer/i.test(k))!
    const textKey = Object.keys(props).find(k => /^(text|query|search|q|words)$/i.test(k))
    if (!textKey) return null
    const layer = Array.isArray(props[layerKey].enum) ? closestChoice('parcel', props[layerKey].enum) : 'parcel'
    if (!layer) return null
    const reply = await this.runTool(tool, { [layerKey]: layer, [textKey]: number, ...(props.max_results ? { max_results: 5 } : {}) })
    const rows: any[] = Array.isArray(this.lastToolData?.features) ? this.lastToolData.features : []
    const hit = rows.find(r => Object.values(r).some(v => String(v).replace(/\s/g, '') === number)) || rows[0]
    if (!hit) return { text: `I could not find a parcel numbered ${number}.`, mood: 'confused', suggest: ['Find an address instead'] }
    const pairs = Object.keys(hit).filter(k => hit[k] != null && String(hit[k]).trim() !== '' && !/^(latitude|longitude|distance_feet|layer|layer_path)$/i.test(k)).map(k => ({ label: keyLabel(k), value: String(hit[k]) }))
    const where = `parcel ${number}`
    if (wantsOwner) reply.text = ownerSentence(pairs, where) || `I found parcel ${number}, but its record has no owner field.`
    else {
      const owner = ownerSentence(pairs, where)
      const rest = pairs.filter(p => !/owner/i.test(p.label)).slice(0, 5).map(p => `${p.label}: ${p.value}`).join('; ')
      reply.text = `${owner ? owner + ' ' : ''}${rest ? rest + '.' : ''}`.trim() || reply.text
    }
    reply.sources = [{ title: String(hit.layer || 'Parcels'), detail: pairs.map(p => `${p.label}: ${p.value}`).join('\n') }]
    delete reply.table
    const ll = Number.isFinite(Number(hit.latitude)) && Number.isFinite(Number(hit.longitude)) ? [Number(hit.latitude), Number(hit.longitude)] as [number, number] : null
    if (ll) { await this.ctx.live.showPlaces(ll, [], {}); this.lastPlace = { label: where, lat: ll[0], lon: ll[1], at: Date.now() }; this.placeNames.set(placeKey(ll[0], ll[1]), where) }
    reply.suggest = [`What zoning is ${where} in?`, `What's at ${where}?`]
    return reply
  }

  /** "What does Jane Doe own", "properties owned by Jane Doe": the server's parcel search by owner. */
  private async ownedBy (q: string): Promise<Reply | null> {
    const m = q.replace(/[?.!]+$/, '').match(OWNED_Q)
    const name = m && (m[1] || m[2] || m[3] || m[4] || '').trim().replace(/[?.!]+$/, '')
    if (!name || name.length < 3 || /^(?:it|this|that|you|i|we|the city)$/i.test(name)) return null
    const port = this.ctx.mcp!
    const tool = (await this.serverTools()).find(t => /find|search/i.test(t.name) && !/content|address/i.test(t.name) && Object.keys(t.inputSchema?.properties || {}).some(k => /^layer/i.test(k)) && !needsConfirm(t, port.prefs))
    if (!tool) return null
    const props = tool.inputSchema?.properties || {}
    const layerKey = Object.keys(props).find(k => /^layer/i.test(k))!
    const textKey = Object.keys(props).find(k => /^(text|query|search|q|words)$/i.test(k))
    if (!textKey) return null
    const layer = Array.isArray(props[layerKey].enum) ? closestChoice('parcel', props[layerKey].enum) : 'parcel'
    if (!layer) return null
    const reply = await this.runTool(tool, { [layerKey]: layer, [textKey]: name.toUpperCase(), ...(props.max_results ? { max_results: 25 } : {}) })
    if (reply.mood !== 'confused') reply.text = `Parcels matching owner “${name}”: ${reply.text.replace(/^Found /, '')}`
    return reply
  }

  // ------------------------------------------------------------ parcels and places on the app's own map

  /** Owner, parcel number, address and acres from a parcel's attributes, whatever the fields are called. */
  private parcelFacts (g: any, entry: LayerEntry): { owner: string, number: string, address: string, acres: string, label: string } {
    const a = g?.attributes || {}
    const t: any = this.ctx.live.target(entry)
    const fields: any[] = (t?.fields?.toArray ? t.fields.toArray() : t?.fields) || Object.keys(a).map(name => ({ name }))
    const pick = (re: RegExp, not?: RegExp) => {
      const f = fields.find(x => re.test(`${x.name} ${x.alias || ''}`) && !(not && not.test(`${x.name} ${x.alias || ''}`)) && a[x.name] != null && String(a[x.name]).trim() !== '')
      return f ? String(a[f.name]).trim() : ''
    }
    const owner = pick(/own/i, /joint|jt_?own|jtowner|mail|addr|type|code|date/i)
    const number = pick(/parcel_?(num|no|id)|^pin\b|\bapn\b|parcel ?number|^parcel$/i)
    const address = pick(/situs|location|site_?addr|full_?addr|address/i, /mail|owner/i)
    const acres = pick(/^acres?$|acreage|gis_?acres|calc_?acres/i)
    return { owner, number, address, acres, label: address || number || entry.title }
  }

  /**
   * The field that answers the question, scored rather than hard-coded: "what city" wants a
   * city or name field, "what zone" a zone or district code, "what school" a school name.
   * Names and the layer's display field beat addresses, phone numbers, links, ids and dates;
   * coded values come back as their names. Empty when nothing fits.
   */
  private answerField (entry: LayerEntry, g: any, thing: string): { value: string, field: string } {
    const a = g?.attributes || {}
    const t: any = this.ctx.live.target(entry)
    const fields: any[] = (t?.fields?.toArray ? t.fields.toArray() : t?.fields) || Object.keys(a).map(name => ({ name }))
    const asked = flat(thing).split(' ').filter(w => w.length > 2 && !/^(what|which|the|this|that|area|layer|limits?|boundary|boundaries)$/.test(w))
    // Words a field about the asked thing tends to use.
    const KIN: { [k: string]: string[] } = {
      city: ['city', 'municipal', 'jurisdiction', 'juris', 'town', 'place', 'name'],
      town: ['city', 'town', 'municipal', 'name'],
      zone: ['zone', 'zoning', 'class', 'district', 'code'],
      zoning: ['zone', 'zoning', 'class', 'code'],
      district: ['district', 'dist', 'ward', 'name', 'rep'],
      council: ['district', 'rep', 'member', 'name'],
      school: ['school', 'name'],
      flood: ['zone', 'fld', 'flood', 'sfha'],
      day: ['day', 'pickup', 'route', 'weekday'],
      trash: ['day', 'pickup', 'route'],
      park: ['park', 'name'],
      subdivision: ['subdiv', 'name', 'plat'],
      county: ['county', 'name'],
      precinct: ['precinct', 'name', 'number']
    }
    const kin = new Set(asked.flatMap(w => [w, ...(KIN[w] || KIN[w.replace(/s$/, '')] || [])]))
    const wantsAddress = asked.some(w => /addr|street|location/.test(w))
    let best = { value: '', field: '', score: -99 }
    for (const f of fields) {
      const name = String(f.name || '')
      if (/^(objectid|fid|oid|shape|globalid|created|last_?edited|st_area|st_length|shape_)/i.test(name)) continue
      let v = a[name]
      if (v === null || v === undefined || String(v).trim() === '') continue
      const coded = f.domain?.codedValues?.find?.((c: any) => c.code === v)
      if (coded) v = coded.name
      if (typeof v === 'number' && /date/i.test(String(f.type || ''))) continue
      const text = String(v).trim()
      const label = `${name} ${f.alias || ''}`.toLowerCase().replace(/[_.]/g, ' ')
      const words = label.split(/\s+/)
      let s = 0
      if (Array.from(kin).some(k => words.some(w => w === k || w.startsWith(k)))) s += 5
      if (asked.some(k => label.includes(k))) s += 2
      if (name === t?.displayField) s += 2
      if (/(^| )(name|label|title|desc|description)( |$)|name$/.test(label)) s += 2
      if (!wantsAddress && /addr|situs|street|mail|zip|postal/.test(label)) s -= 5
      if (/phone|fax|email|url|http|link|web|site|photo|image|doc/.test(label)) s -= 6
      if (/(^| )(id|guid|pin|apn|num|number|no|oid|key|fk|pk)( |$)|id$/.test(label) && !kin.has('number')) s -= 3
      if (/date|time|year|created|edited|updated/.test(label)) s -= 4
      if (!wantsAddress && /^\d+\s+[a-z]/i.test(text)) s -= 4
      if (/^https?:/i.test(text)) s -= 6
      if (/^-?\d+(\.\d+)?$/.test(text)) s -= 2
      if (text.length > 80) s -= 2
      if (s > best.score) best = { value: text, field: fieldLabel(f), score: s }
    }
    return best.score > -3 ? { value: best.value, field: best.field } : { value: '', field: '' }
  }

  /** The point a place question is about: coordinates, the map center, or an address found with the app's locator. */
  private async pointFor (pq: PlaceQuestion, spotLabel: string): Promise<{ at: any, label: string, location?: any } | null> {
    const coords = pq.place && pq.place.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
    if (coords) return { at: [Number(coords[1]), Number(coords[2])], label: spotLabel || 'that spot' }
    if (pq.here) {
      const c = this.mapContext()?.center
      return c ? { at: c, label: 'the middle of the map' } : null
    }
    if (!pq.place || !this.ctx.geocoders?.length || !this.ctx.live.view) return null
    try {
      const found = await geocodeAddress(pq.place, this.ctx.geocoders, this.ctx.live.view)
      const best = found.results[0]
      if (!best || best.score < 80) return null
      return { at: best.location, label: niceAddress(String(best.label || pq.place).split(',')[0]), location: best.location }
    } catch (e) { return null }
  }

  /**
   * "Who owns 250 N 5th St", "who owns it", "what zone is this in", "is 1138 White Ave in city
   * limits": answered from the app's own layers when the map has one that fits, so it works
   * with or without a server, and the answer is on the map: the parcel (or zone) highlighted
   * with its popup open and a pin on the address. Null when the map has no fitting layer.
   */
  private async answerAtFromMap (pq: PlaceQuestion, spotLabel: string, only: boolean, fromPopup = false, q = ''): Promise<Reply | null> {
    const live = this.ctx.live
    if (!live.view) return null
    const thing = pq.thing || ''
    const parcelish = !thing || /parcel|owner|property|lot\b|tax/i.test(thing)
    let entries: LayerEntry[] = []
    if (parcelish) entries = live.parcelLayers()
    else {
      const e = live.matchTitle(thing)
      if (e && !e.isGroup) entries = [e]
    }
    // "Who owns this" with a parcel's popup open: answer from that feature, no lookup needed.
    let entry: LayerEntry | null = null; let g: any = null
    if (fromPopup) {
      const pf = this.popupFeature()
      if (pf && (parcelish ? /parcel|tax lot|property/i.test(pf.entry.title) && !/annotation|line/i.test(pf.entry.title) : entries.includes(pf.entry))) {
        entry = pf.entry; g = pf.graphic
        if (!entries.includes(entry)) entries = [entry, ...entries]
      }
    }
    // A general "what's at" goes to the server's full report when there is one.
    // "Is 310 Oak St in MU": no layer is called that, but an area on the map is. Check against the layer that has it.
    if (!entries.length && thing && pq.yesNo && !parcelish) {
      const areas = live.entries().filter(e => !e.isGroup && !e.isTable && live.canAsk(e) && /polygon/i.test(String(live.target(e)?.geometryType || '')) && typeof live.target(e)?.queryFeatures === 'function').slice(0, 12)
      for (const e of areas) { try { await loadValues(live, e) } catch (err) { } }
      const hit = namedFeature(thing.replace(/\s+(?:zoning district|zone|district|area|boundary|limits|neighbou?rhood)s?$/i, ''), areas.map(e => schemaOf(live, e)), 2)
      const e = hit && areas.find(x => x.key === hit.layer.key)
      if (e) entries = [e]
    }
    // A named kind of layer the map does not have ("what zoning is this in" on a utilities map): say so rather than guess.
    if (!entries.length && thing && !parcelish && only) {
      return { text: `This map has no **${thing}** layer, so I cannot answer that here. ${this.ctx.place?.website ? `The ${this.org()} website may have it.` : ''}`.trim(), mood: 'think', suggest: ['What layers are on?', 'List layers'] }
    }
    if (!entries.length || (!thing && !only && !g)) return null
    const spot = g ? { at: (() => { const ll = this.recentPlace(); return ll ? [ll.lat, ll.lon] as [number, number] : this.mapContext()?.center })(), label: spotLabel || 'this feature', location: undefined } : await this.pointFor(pq, spotLabel)
    if (!spot || !spot.at) return null
    let failed = false
    for (const e of g ? [] : entries.slice(0, 3)) {
      try { g = await live.featureAt(e, spot.at, true) } catch (e) { failed = true; continue }
      if (g) { entry = e; break }
    }
    if (!g && failed) {
      if (!only) return null
      return { text: `I could not verify ${spot.label} because a layer lookup failed. Please try again when the service is available.`, mood: 'confused' }
    }
    const ll = Array.isArray(spot.at) ? spot.at as [number, number] : this.toLatLon(spot.at)
    if (ll) this.lastPlace = { label: spot.label, lat: ll[0], lon: ll[1], at: Date.now() }
    const reply: Reply = { text: '', mood: 'pleased', actions: [], sources: [{ title: (entry || entries[0]).title, detail: 'Layer in this app' }] }
    if (!g || !entry) {
      if (pq.yesNo) { reply.text = `**No.** ${spot.label} is not in ${entries[0].title}.`; return reply }
      if (!parcelish || !only) return null
      return { text: `I could not find a parcel at ${spot.label} in ${entries[0].title}.`, mood: 'confused' }
    }
    if (!live.isVisible(entry)) {
      const before = live.snapshot()
      live.setVisible(entry, true)
      if (live.remember(before, `turn on ${entry.title}`)) reply.actions!.push({ type: 'ask', q: 'undo', label: 'Undo' })
    }
    this.lastLayer = entry.title
    const facts = this.parcelFacts(g, entry)
    await live.show({ entry, graphic: g, label: facts.label, detail: '' })
    if (spot.location || !Array.isArray(spot.at)) await live.pin(spot.location || spot.at)
    const extra = [facts.number && `Parcel ${facts.number}`, facts.acres && `${facts.acres} acres`, facts.address && facts.address.toUpperCase() !== spot.label.toUpperCase() && facts.address].filter(Boolean).join(' · ')
    const answer = parcelish ? { value: '', field: '' } : this.answerField(entry, g, thing)
    const named = answer.value && flat(answer.value) !== flat(entry.title) ? answer.value : ''
    const floodPairs = pq.yesNo && /flood|sfha|floodplain|floodway/i.test(`${thing} ${entry.title}`)
      ? Object.keys(g.attributes || {}).map(k => ({ label: fieldLabel(((live.target(entry)?.fields?.toArray ? live.target(entry).fields.toArray() : live.target(entry)?.fields) || []).find((f: any) => f.name === k) || { name: k }), value: String(g.attributes[k] ?? '') }))
      : null
    const flood = floodPairs ? floodVerdict(floodPairs, spot.label) : ''
    if (flood) reply.text = flood
    else if (pq.yesNo) reply.text = this.inAreaVerdict(spot.label, thing, entry.title, named)
    else if (parcelish && pq.field) {
      const t: any = live.target(entry)
      const fields: any[] = (t?.fields?.toArray ? t.fields.toArray() : t?.fields) || Object.keys(g.attributes || {}).map(name => ({ name }))
      const pairs = fields.filter(f => g.attributes?.[f.name] != null && String(g.attributes[f.name]).trim() !== '').map(f => ({ label: fieldLabel(f), value: String(g.attributes[f.name]) }))
      reply.text = fieldSentence(pq.field, pairs, spot.label) || `The parcel at ${spot.label} has no ${pq.field} field.`
    }
    else if (parcelish && facts.owner) reply.text = `**${facts.owner}** owns ${spot.label}.${extra ? `\n\n${extra}` : ''}`
    else if (parcelish) reply.text = `Here is the parcel at ${spot.label}.${extra ? `\n\n${extra}` : ''}`
    else if (named) reply.text = placeFact(spot.label, thing || pq.thing || '', entry.title, answer.field || '', named, q)
    else reply.text = `${spot.label} is in ${entry.title}.`
    reply.text += '\n\nThe details are open on the map.'
    // Offer what was not just asked, about the same place.
    // The place by its name ("1138 White Ave"), never its coordinates, so a chip reads well and works.
    const placeName = /^-?\d{1,2}\.\d+\s*,/.test(pq.place || '') || !pq.place ? spot.label : pq.place
    const next = followUps({ ...pq, place: placeName }, q.replace(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g, placeName), this.layerTest()).map(f => this.nameCoordinates(f))
    reply.suggest = (next.length ? next : parcelish ? ['What zoning is this in?', 'Is it in city limits?', 'Closest hydrant to it'] : ['Who owns it?']).slice(0, 3)
    return reply
  }

  /** After an address is shown: the parcel under it, highlighted, with its owner. */
  private async parcelUnder (location: any, label: string): Promise<string> {
    const live = this.ctx.live
    for (const e of live.parcelLayers().slice(0, 3)) {
      const g = await live.featureAt(e, location)
      if (!g) continue
      if (!live.isVisible(e)) { const before = live.snapshot(); live.setVisible(e, true); live.remember(before, `turn on ${e.title}`) }
      const facts = this.parcelFacts(g, e)
      await live.show({ entry: e, graphic: g, label: facts.label, detail: '' })
      await live.pin(location)
      return [facts.owner && `Owner: **${facts.owner}**`, facts.number && `Parcel ${facts.number}`, facts.acres && `${facts.acres} acres`].filter(Boolean).join(' · ') || `Parcel shown from ${e.title}.`
    }
    // No parcel layer in this map: ask the server for the parcel there and outline it.
    return this.parcelFromServer(location)
  }

  private async parcelFromServer (location: any): Promise<string> {
    const port = this.ctx.mcp
    const ll = this.toLatLon(location)
    if (!port || port.fallback === false || !ll || Date.now() - this.mcpFailedAt < 60000) return ''
    try {
      const tools = await this.serverTools()
      const tool = tools.find(t => placeToolFits(t, { kind: 'at' }) && placeKeys(t).lat && !needsConfirm(t, port.prefs))
      if (!tool) return ''
      const keys = placeKeys(tool)
      const layerKey = Object.keys(tool.inputSchema?.properties || {}).find(k => /^layer/i.test(k))
      const raw = await port.call(tool.name, { [keys.lat!]: Number(ll[0].toFixed(6)), [keys.lon!]: Number(ll[1].toFixed(6)), ...(layerKey ? { [layerKey]: 'parcel' } : {}) })
      const hit = !raw?.isError && Array.isArray(raw?.structuredContent?.results) ? raw.structuredContent.results[0] : null
      if (!hit) return ''
      if (Array.isArray(hit.geometry?.rings)) await this.ctx.live.showPlaces(ll, [], { rings: hit.geometry.rings })
      const summary = String(hit.summary || '')
      const owner = summary.match(/(?:^|;\s*)(?:Owner|Owner Name|Owners?)\s*:\s*([^;]+)/i)?.[1]?.trim()
      const number = summary.match(/(?:^|;\s*)Parcel (?:Number|Num|No|ID)\s*:\s*([^;]+)/i)?.[1]?.trim()
      const acres = summary.match(/(?:^|;\s*)Acres\s*:\s*([^;]+)/i)?.[1]?.trim()
      return [owner && `Owner: **${owner}**`, number && `Parcel ${number}`, acres && `${acres} acres`].filter(Boolean).join(' · ') || `Parcel: ${clip(summary, 200)}`
    } catch (e) { this.mcpFailedAt = Date.now(); return '' }
  }

  /** Coordinates in a suggestion shown as the place's name when Mappy knows it, else "it". */
  private nameCoordinates (text: string): string {
    return text.replace(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g, (m, a, b) => this.placeNames.get(placeKey(Number(a), Number(b))) || 'it')
  }

  private rememberPlaceQuestion (pq: PlaceQuestion, map = this.mapContext()): void {
    this.placeConversation = pq.here && map?.center ? { ...pq, here: false, place: `${map.center[0]}, ${map.center[1]}` } : { ...pq }
  }

  private async askServer (q: string): Promise<Reply> {
    const port = this.ctx.mcp!
    const tools = await this.serverTools()
    const ranked = rankTools(q, tools)
    if (!ranked.length) {
      return { text: `I couldn't tell which of ${port.label}'s tools fits “${clip(q, 80)}”. Say “list server tools” to see them.`, mood: 'confused', suggest: ['List server tools'] }
    }
    // Among close candidates, prefer one whose inputs the request (or the map) can fill.
    const map = this.mapContext()
    const ready = ranked.find(r => r.score >= ranked[0].score * 0.6 && !fillArgs(r.tool, q, map).missing.length)
    return this.prepareTool((ready || ranked[0]).tool, q)
  }

  private async prepareTool (tool: McpTool, text: string): Promise<Reply> {
    const { args, missing } = fillArgs(tool, text, this.mapContext())
    return this.prepareToolArgs(tool, args, missing, parsePlaceQuestion(text) || undefined)
  }

  private async prepareToolArgs (tool: McpTool, args: { [k: string]: any }, required: string[] = [], place?: PlaceQuestion): Promise<Reply> {
    const port = this.ctx.mcp!
    const missing = Array.from(new Set([...required, ...(tool.inputSchema?.required || [])])).filter(k => args[k] === undefined || args[k] === '')
    // Some GIS schemas express address OR coordinates as optional properties.
    // Keep asking until that alternative is complete, even for an explicit tool call.
    const keys = placeKeys(tool)
    const spatial = ['nearest', 'within', 'at'].some(kind => placeToolFits(tool, { kind: kind as PlaceQuestion['kind'] }))
    if (spatial && (keys.address || keys.lat) && !(keys.address && args[keys.address]) && !(keys.lat && keys.lon && args[keys.lat] !== undefined && args[keys.lon] !== undefined)) {
      const key = keys.lat && args[keys.lat] !== undefined ? keys.lon : keys.lon && args[keys.lon] !== undefined ? keys.lat : keys.address || keys.lat
      if (key && !missing.includes(key)) missing.push(key)
    }
    const name = toolLabel(tool)
    for (const key of Object.keys(args)) {
      const error = toolValueError(tool.inputSchema?.properties?.[key] || {}, args[key])
      if (!error) continue
      const corrected = { ...args }; delete corrected[key]
      this.mcpPending = null; this.mcpDraft = { tool, args: corrected, missing: [key, ...missing.filter(k => k !== key)], place }
      return { text: `${error} What should I use for **${key}** in **${name}**? Your other inputs are kept.`, mood: 'think', suggest: ['Cancel'] }
    }
    if (missing.length) {
      this.mcpPending = null; this.mcpDraft = { tool, args, missing, place }
      const key = missing[0]; const prop = tool.inputSchema?.properties?.[key]
      return {
        text: `For **${name}**, what should I use for **${key}**?${prop?.description ? ` ${clip(prop.description, 140)}` : ''} Reply with the value, or say “cancel”.${Object.keys(args).length ? `\n\nAlready have: ${describeArgs(args)}.` : ''}`,
        mood: 'think', suggest: [...(prop?.enum || []).slice(0, 3).map(String), 'Cancel']
      }
    }
    if (needsConfirm(tool, port.prefs)) {
      const sequence = ++this.mcpSequence
      this.mcpPending = { sequence, tool, args }
      return {
        text: `Run **${name}** on ${port.label} with ${describeArgs(args)}? ${tool.annotations?.readOnlyHint === true ? '' : 'It may change data on the server.'}`.trim(),
        mood: 'attention',
        actions: [{ type: 'ask', q: `__mcp:run:${sequence}`, label: `Run ${name}` }, { type: 'ask', q: '__mcp:cancel', label: 'Cancel' }]
      }
    }
    const reply = await this.runTool(tool, args)
    if (place && !['confused', 'think', 'attention'].includes(reply.mood || '')) {
      const updated = { ...place }
      const location = placeKeys(tool)
      if (location.address && args[location.address]) { updated.place = args[location.address]; updated.here = false }
      else if (location.lat && location.lon && args[location.lat] !== undefined && args[location.lon] !== undefined) { updated.place = `${args[location.lat]}, ${args[location.lon]}`; updated.here = false }
      for (const key of Object.keys(args)) {
        if (/^(max_?results|limit|count|num)$/i.test(key)) updated.limit = args[key]
        if (/^(distance|radius|buffer)/i.test(key)) updated.feet = /mile/i.test(key) ? args[key] * 5280 : (/meter|metre/i.test(key) || /_m$/i.test(key)) ? args[key] * 3.28084 : args[key]
      }
      this.rememberPlaceQuestion(updated)
    }
    return reply
  }

  /**
   * The place "it" or "this" means: a feature or spot open in the map's popup (a search result,
   * a click), else the last address or answer Mappy showed while it is still on screen.
   */
  private recentPlace (): { label: string, lat: number, lon: number, popup?: boolean } | null {
    const view: any = this.ctx.live.view
    // What is open on the map right now wins: a search result or a clicked feature.
    try {
      const popup = view?.popup
      const g = popup?.selectedFeature?.geometry
      const at = popup?.visible ? (popup?.location || (g && (g.type === 'point' ? g : g.extent?.center))) : null
      const ll = at ? this.toLatLon(at) : null
      if (ll) return { label: stripTags(String(popup?.selectedFeature?.attributes?.Match_addr || popup?.title || '')).slice(0, 80) || 'that spot', lat: ll[0], lon: ll[1], popup: true }
    } catch (e) { }
    // A Search widget result: the marker it drops on the map (Esri's Search adds its result
    // graphic to the view, often without a popup). The newest one still on screen wins.
    try {
      const pins: any[] = []
      const take = (c: any) => { try { (c?.toArray ? c.toArray() : Array.isArray(c) ? c : []).forEach((g: any) => pins.push(g)) } catch (e) { } }
      take(view?.graphics)
      const layers: any[] = view?.map?.allLayers?.toArray ? view.map.allLayers.toArray() : []
      layers.filter(l => l?.type === 'graphics' && /search|result|locat|geocod/i.test(`${l.id || ''} ${l.title || ''}`)).forEach(l => take(l.graphics))
      const ext = this.mapContext()?.extent
      for (const g of pins.reverse()) {
        if (!g?.geometry || g.attributes?.__mappy || g.visible === false) continue
        const geo = g.geometry
        const at = geo.type === 'point' ? geo : null
        const ll = at ? this.toLatLon(at) : null
        if (!ll) continue
        if (ext && !(ll[1] >= ext[0] && ll[1] <= ext[2] && ll[0] >= ext[1] && ll[0] <= ext[3])) continue
        const a = g.attributes || {}
        const label = stripTags(String(a.Match_addr || a.LongLabel || a.ShortLabel || a.Address || a.name || a.Name || g.popupTemplate?.title || '')).split(',')[0].slice(0, 80)
        return { label: label ? niceAddress(label) : 'the search result', lat: ll[0], lon: ll[1] }
      }
    } catch (e) { }
    // Then the last place Mappy showed, while it is still on screen.
    const last = this.lastPlace
    if (last && Date.now() - last.at < 30 * 60000) {
      const ext = this.mapContext()?.extent
      const onScreen = !ext || (last.lon >= ext[0] && last.lon <= ext[2] && last.lat >= ext[1] && last.lat <= ext[3])
      if (onScreen) return last
    }
    return null
  }

  /** The feature open in the map's popup, with the app layer it came from. */
  private popupFeature (): { entry: LayerEntry, graphic: any } | null {
    try {
      const popup: any = this.ctx.live.view?.popup
      const g = popup?.visible ? popup.selectedFeature : null
      const layer = g?.sourceLayer || g?.layer
      if (!g?.attributes || !layer) return null
      const entry = this.ctx.live.entries().find(e => this.ctx.live.target(e) === layer || e.layer === layer)
      return entry ? { entry, graphic: g } : null
    } catch (e) { return null }
  }

  /** [latitude, longitude] of a map point in WGS84, Web Mercator or anything with latitude set. */
  private toLatLon (p: any): [number, number] | null { return projectToLatLon(p) }


  /** The map right now, in longitude and latitude, for tool inputs the request leaves out. */
  private mapContext (): MapContext | undefined {
    const view: any = this.ctx.live.view
    if (!view) return undefined
    const toLL = (x: number, y: number): [number, number] | null => projectToLatLon({ x, y, spatialReference: view.spatialReference })
    const c = view.center
    const center = c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude) ? [c.latitude, c.longitude] as [number, number] : (c ? toLL(c.x, c.y) : null)
    const e = view.extent
    const lo = e ? toLL(e.xmin, e.ymin) : null; const hi = e ? toLL(e.xmax, e.ymax) : null
    return {
      center: center || undefined,
      zoom: Number.isFinite(view.zoom) && view.zoom >= 0 ? view.zoom : undefined,
      extent: lo && hi ? [lo[1], lo[0], hi[1], hi[0]] : undefined
    }
  }

  private async chooseMcpResult (sequence: number, index: number): Promise<Reply> {
    const result = this.mcpResults
    const row = result?.rows[index]
    if (!result || result.sequence !== sequence || result.view !== this.ctx.live.view || !row) return { text: 'That server result is no longer available. Run the search again or choose a result from the latest answer.', mood: 'confused' }
    if (!row.point) return { text: `**${row.label}** has no usable map location. Choose another result.`, mood: 'talk' }
    const port = this.ctx.mcp
    const shown = await this.ctx.live.showPlaces(null, [row.point])
    if (this.mcpResults !== result || result.view !== this.ctx.live.view || port !== this.ctx.mcp) return { text: 'The map or results changed. Choose a result from the latest answer.', mood: 'confused' }
    if (!shown) return { text: 'I could not show that location on the map. Try again when the map is ready.', mood: 'confused' }
    try { this.ctx.live.view.popup?.close?.() } catch (e) { }
    this.lastPlace = { label: row.label, lat: row.point[0], lon: row.point[1], at: Date.now() }
    if (this.placeConversation) this.placeConversation = { ...this.placeConversation, place: `${row.point[0]}, ${row.point[1]}`, here: false }
    this.lastResults = []; this.addressChoices = null
    const reply: Reply = { text: `Showing **${row.label}**. You can now ask about this location.`, mood: 'pleased', suggest: ['Who owns it?', 'What zoning is this in?'], sources: [{ title: result.source, detail: `Selected result ${index + 1}` }] }
    this.lastReply = reply
    return reply
  }

  private async runTool (tool: McpTool, args: { [k: string]: any }): Promise<Reply> {
    const port = this.ctx.mcp!
    this.syncMcp()
    if (!usableTools([tool], port.prefs).length) return { text: 'That server tool is disabled. Choose an enabled tool.', mood: 'confused' }
    const map = this.ctx.live.view
    const prefs = this.mcpPrefs
    this.track('mcp:' + tool.name)
    let raw = await port.call(tool.name, args)
    // A geoprocessing tool that runs as a job: wait for it (up to a minute), asking the server how it is going.
    const status = this.esri?.gpStatus
    let job = status && !raw?.isError ? readJob(toolData(raw)) : null
    if (job && status && job.state === 'running') {
      const idKey = Object.keys(status.inputSchema?.properties || {}).find(k => /job/i.test(k)) || 'jobId'
      const extra: { [k: string]: any } = {}
      for (const k of Object.keys(status.inputSchema?.properties || {})) if (k !== idKey && args[k] !== undefined) extra[k] = args[k]
      const until = Date.now() + 60000
      while (job && job.state === 'running' && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, this.ctx.jobPollMs ?? 3000))
        const next = await port.call(status.name, { ...extra, [idKey]: job.id })
        if (next?.isError) break
        const seen = readJob(toolData(next))
        if (!seen) break
        job = seen; raw = next
      }
      if (job.state === 'running') return { text: `${toolLabel(tool)} is still running on ${port.label} (job ${clip(job.id, 40)}). Ask again in a minute: “use the server ${toolLabel(status).toLowerCase()} ${job.id}”.`, mood: 'think', sources: [{ title: port.label, detail: toolLabel(tool) }] }
      if (job.state === 'failed') return { text: `${toolLabel(tool)} did not finish on ${port.label}.${job.message ? ' ' + job.message : ''}`, mood: 'confused', sources: [{ title: port.label, detail: toolLabel(tool) }] }
    }
    if (map !== this.ctx.live.view || port !== this.ctx.mcp || prefs !== JSON.stringify(port.prefs || [])) { this.lastToolData = null; return { text: 'The map or server settings changed while I was working. Please ask again.', mood: 'confused' } }
    this.lastToolData = toolData(raw)
    const view = viewResult(raw, port.label)
    // A map picture comes back as a temporary address (get_map_image), not as image data.
    const picture = view.image ? null : readMapImage(this.lastToolData)
    // Shown in the chat only from the organization's own servers (the portal's site); from anywhere else it is a link to open.
    const site = (u: string): string => { try { return new URL(u).hostname.toLowerCase().split('.').slice(-2).join('.') } catch (e) { return '' } }
    const ours = !!picture && !!this.ctx.portalUrl && site(picture.src) !== '' && site(picture.src) === site(this.ctx.portalUrl)
    if (picture && ours) { view.image = { src: picture.src, alt: `Map image from ${port.label}` }; view.text = `Here is the map image from ${port.label}. The link is temporary.` }
    else if (picture) view.text = `${port.label} made a map image. The link is temporary.`
    const pictureLink: MappyAction[] = picture && !ours ? [{ type: 'url', url: picture.src, label: 'Open the map image' }] : []
    const actions: MappyAction[] = [...pictureLink]
    if (view.point) actions.push({ type: 'ask', q: `zoom to ${view.point[0]}, ${view.point[1]}`, label: 'Zoom there' })
    const reply: Reply = { text: view.text, mood: view.error ? 'confused' : 'pleased', actions, sources: [{ title: port.label, detail: `${toolLabel(tool)} (${describeArgs(args)})` }] }
    if (view.table) reply.table = view.table
    if (view.choices?.some(row => row.point)) {
      const sequence = ++this.resultSequence
      this.mcpResults = { sequence, view: map, source: port.label, rows: view.choices }
      this.lastResults = []; this.addressChoices = null
      const actions = view.choices.map((row, index) => row.point ? { type: 'ask' as const, q: `__mcpresult:${sequence}:${index}`, label: `Show result ${index + 1}: ${row.label}` } : undefined)
      if (reply.table) reply.table.rowActions = actions
      else reply.list = view.choices.map((row, index) => ({ label: `${index + 1}. ${row.label}`, action: actions[index] }))
      reply.text += '\n\nChoose a result to show it on the map, or say “show the second one”.'
    }
    if (view.image) reply.image = view.image
    return reply
  }

  // (namedValue is below the class.)

  /**
   * "Is 250 Oak St in the MU zone": yes only when the area found there is the one that was named.
   * A question that names no particular area ("in city limits", "in a flood zone") is yes for any.
   */
  private inAreaVerdict (where: string, thing: string, layer: string, found: string): string {
    const stem = (w: string): string => w.replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '')
    const generic = new Set([...layer.toLowerCase().split(/[^a-z0-9]+/), ...'the a an in of any some zone zoning zoned district area boundary limit city town county overlay region'.split(' ')].filter(Boolean).map(stem))
    const asked = thing.toLowerCase().split(/[^a-z0-9-]+/).filter(w => w && !generic.has(stem(w)))
    if (!asked.length || !found) return `**Yes.** ${where} is in ${layer}${found ? ` (${found})` : ''}.`
    const have = found.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
    const same = asked.every(w => have.includes(w)) || flat(found) === flat(asked.join(' '))
    return same ? `**Yes.** ${where} is in ${found} (${layer}).` : `**No.** ${where} is in **${found}**, not ${thing.replace(/^(?:the|a|an) /i, '')} (${layer}).`
  }

  // ------------------------------------------------------------ questions that cross layers

  /**
   * One thing asked about by where it is relative to another: "parcels within 300 ft of 250 N 5th
   * St", "hydrants in the floodplain", "R-4 parcels over 5 acres within a mile of a school", "how
   * many hydrants per council district", "parcels not within 500 ft of a hydrant", "owners within
   * 300 ft of this parcel". Each side is read against the layers' real fields; the layer service
   * does the geometry. Null when the sentence is not one of these, so other readers get it.
   */
  private async spatialQuestion (text: string, late = false): Promise<Reply | null> {
    const live = this.ctx.live
    if (!this.ctx.featureSearch || !live.ready || /^__/.test(text)) return null
    // "What about 500 ft": the question just answered, at another distance.
    const again = this.lastSpatial && Date.now() - this.lastSpatial.at < 10 * 60000 ? distanceSwap(text) : null
    let read: SpatialRead | null = again && (this.lastSpatial!.read.feet || this.lastSpatial!.read.notify) ? { ...this.lastSpatial!.read, feet: again.feet, distance: again.said, assumed: false } : splitSpatial(text)
    if (!read) return null
    // "In" and "outside" with no distance are ordinary words far more often than they are about
    // place ("parcels in R-4", "hydrants not in service"). Those are only read this way after
    // the ordinary readers had their turn and came up empty (late).
    // "Which of those are in Lincoln Park": the things just answered about, narrowed by place.
    const prior = this.lastAsk && Date.now() - this.lastAskAt < 10 * 60000 && !read.notify && !read.per && /\b(?:those|them|these|they)\b|^(?:which|how many) ones\b/i.test(read.target) ? this.lastAsk : null
    const explicit = read.relation === 'within' || read.relation === 'touch' || (read.relation === 'outside' && !!read.feet) || !!read.per || !!read.notify || !!read.strong || !!prior
    if (explicit === late && !again) return null
    const entries = live.entries().filter(e => !e.isGroup && live.canAsk(e) && typeof live.target(e)?.queryFeatures === 'function')
    if (!entries.length) return null
    const schemas = entries.map(e => schemaOf(live, e))
    const entryOf = (key: string): LayerEntry | undefined => entries.find(e => e.key === key)
    try {
      // Counting by an area the layer already records ("parcels per zoning" with a Zoning field) is a plain group: cheaper and exact.
      if (read.per && !read.rank) {
        const named = mentionedLayer(read.target, schemas)
        const e = named && entryOf(named.layer.key)
        if (e) {
          try { await loadValues(live, e) } catch (err) { }
          let plain: Ask | null = null
          try { plain = readAsk(`count ${read.target.replace(/^(?:how many|count|number of)\s+/i, '')} by ${read.anchor}`, [schemaOf(live, e)], { fallback: e.key }) } catch (err) { plain = null }
          if (plain && plain.kind === 'group' && plain.group && !plain.unknown.length) return await this.answerAsk(plain, e)
        }
      }

      // ---- the side asked about
      let entry: LayerEntry | undefined
      let ask: Ask | null = null
      const notify = !!read.notify && this.ctx.notifyLists === true
      if (read.notify) {
        // By key, not by object: the list of layers is rebuilt as the map changes.
        const lots = live.parcelLayers().map(e => e.key)
        entry = entries.filter(e => lots.includes(e.key)).sort((a, b) => lots.indexOf(a.key) - lots.indexOf(b.key))[0]
        if (!entry) return explicit ? { text: 'A list of owners near a place needs a parcel layer, and this map does not have one I can ask.', mood: 'confused' } : null
        ask = { layer: entry.key, kind: 'list', clauses: [], unknown: [] }
      } else if (prior) {
        entry = entryOf(prior.key)
        if (!entry) return null
        const want = /^(?:how many|count|number of)\b/i.test(read.target) ? 'count' : 'list'
        ask = { ...prior.ask, kind: want, field: undefined, stat: undefined, group: undefined, limit: undefined, superlative: undefined, order: undefined, clauses: prior.ask.clauses.filter(c => (c.field as any).type !== 'oid'), unknown: [] }
      } else {
        const named = mentionedLayer(read.target, schemas)
        if (!named) return null
        entry = entryOf(named.layer.key)
        if (!entry) return null
        const bare = !/^(?:how many|count|number of|list|show|which|what|find|total|sum|average|avg|mean|biggest|largest|smallest|oldest|newest|most|least|top)\b/i.test(read.target)
        const readTarget = (): Ask | null => { const mine = [schemaOf(live, entry!)]; try { return readAsk(bare ? `list ${read!.target}` : read!.target, mine, { fallback: entry!.key }) || readAsk(`list ${read!.target}`, mine, { fallback: entry!.key }) } catch (err) { return null } }
        ask = readTarget()
        // The layer's values are only read when the words need them ("R-4 parcels"); "parcels" alone does not, and on a big layer that reading is a dozen queries.
        if (!ask || ask.unknown.length || ask.loose) { try { await loadValues(live, entry) } catch (err) { } ; ask = readTarget() }
        const mine = [schemaOf(live, entry)]
        if (!ask) ask = flat(read.target.replace(/^(?:the|all|any) /i, '')) === flat(entry.title) || mentionedLayer(read.target, mine) ? { layer: entry.key, kind: /^(?:how many|count|number of)\b/i.test(read.target) ? 'count' : 'list', clauses: [], unknown: [] } : null
        if (!ask) return null
        if (ask.unknown.length) {
          // Words on the asked-about side that its fields do not explain: try them as text, as any data question would.
          let clause: any = null
          try { clause = await probeText(live, entry, ask.unknown.join(' '), askWhere(ask)) } catch (err) { clause = null }
          if (!clause) return explicit ? { text: `I could not match “${ask.unknown.join(' ')}” to anything in **${entry.title}**, so I did not guess. Say it another way, or ask “what fields does ${entry.title} have”.`, mood: 'confused' } : null
          ask = { ...ask, clauses: [...ask.clauses, clause], unknown: [] }
        }
      }

      // A notice list with no distance: ask, and take the next "300 ft" as the answer.
      if (read.notify && !read.feet) {
        this.lastSpatial = { read, at: Date.now() }
        return { text: `How far out from ${clip(read.anchor, 60)}? Say a distance, like “300 ft”.`, mood: 'think', suggest: ['300 ft', '500 ft', '1000 ft'] }
      }

      // ---- the other side
      const anchor = await this.spatialAnchor(read, entries, entry)
      if (anchor === null) return null
      if ('text' in anchor) return anchor
      // A plain list near a place ("hydrants within 500 ft of 250 Oak St") is the place reader's: it gives the distance to each one.
      if (!anchor.key && !read.notify && !prior && ask.kind === 'list' && !ask.clauses.length && read.relation === 'within' && !again && !/polygon/i.test(String(live.target(entry)?.geometryType || ''))) return null
      if (read.per && !anchor.area) return { text: `Counting per ${clip(read.anchor, 40)} needs a layer of areas (districts, zones, wards), and that is not one.`, mood: 'confused' }
      if (read.relation === 'in' && !anchor.area) return explicit ? { text: `“${clip(read.anchor, 50)}” is not an area on this map, so nothing can be in it. Try “within 500 ft of ${clip(read.anchor, 40)}”.`, mood: 'confused' } : null
      if (anchor.capped) {
        return { text: `That would compare against ${anchor.capped.toLocaleString()} ${clip(read.anchor, 40)}, and I stop at ${MAX_ANCHORS} so the map service is not flooded. Narrow that side (a type, a status, one area) and ask again.`, mood: 'think' }
      }
      if (!anchor.geoms.length) return { text: `Nothing on this map matches “${clip(read.anchor, 60)}”, so there is nothing to measure from.`, mood: 'think' }
      // A line is rarely wholly in an area: say what was counted.
      const lines = read.relation === 'in' && /line/i.test(String(live.target(entry)?.geometryType || ''))
      const said = lines ? `in or crossing ${anchor.label}` : relationSaid(read, anchor.label)
      const where = askWhere(ask)
      this.track(`spatial:${read.notify ? 'notify' : read.per ? 'per' : read.relation}`)
      this.lastSpatial = { read, at: Date.now() }
      this.dataTask = null; this.lastAnalysis = null; this.tablePage = null

      // ---- one answer per area
      if (read.per) {
        const rows = (await countPerArea(live, entry, anchor, where)).sort((a, b) => read!.rank === 'fewest' ? a.count - b.count : b.count - a.count)
        const noun = entry.title.toLowerCase()
        const filter = askSaid(ask)
        const top = rows[0]
        if (rows.every(r => r.count === 0)) return { text: `No ${noun}${filter ? ` (${filter})` : ''} ${rows.length === 1 ? 'is' : 'are'} in any of the ${rows.length} ${anchor.label.toLowerCase()}${rows.length === 1 ? '' : ' areas'}.`.replace(/(\d+) (\S+) areas\./, (m, n, w) => /s$/.test(w) ? `${n} ${w}.` : m), mood: 'think', sources: [{ title: entry.title, detail: `Counted inside each area · ${new Date().toLocaleTimeString()}` }] }
        const ties = rows.filter(r => r.count === top.count)
        const lead = ties.length > 1 && ties.length < rows.length
          ? `${ties.slice(0, 4).map(r => `**${r.label}**`).join(', ')}${ties.length > 4 ? ' and others' : ''} tie for the ${read.rank === 'fewest' ? 'fewest' : 'most'} ${noun}${filter ? ` (${filter})` : ''}: ${top.count.toLocaleString()} each.`
          : `**${top.label}** has the ${read.rank === 'fewest' ? 'fewest' : 'most'} ${noun}${filter ? ` (${filter})` : ''}: **${top.count.toLocaleString()}**.${rows.length > 1 ? ` Then ${rows.slice(1, 3).map(r => `${r.label} (${r.count.toLocaleString()})`).join(' and ')}.` : ''}`
        this.lastLayer = entry.path
        const shown = rows.slice(0, 25)
        return {
          text: `${lead} ${rows.length} ${rows.length === 1 ? 'area' : 'areas'} counted.`, mood: 'pleased',
          table: { columns: [anchor.label, entry.title], rows: shown.map(r => [r.label, r.count.toLocaleString()]) },
          chart: shown.length >= 2 && shown.length <= 12 ? { title: `${entry.title} by ${anchor.label}`, rows: shown.map(r => ({ label: r.label, value: r.count })) } : undefined,
          note: 'Counted by where each one is. One that sits on a line between two areas is counted in both.',
          sources: [{ title: entry.title, detail: `Counted inside each area${filter ? ` · ${filter}` : ''} · ${new Date().toLocaleTimeString()}` }]
        }
      }

      // On top of an earlier place ("hydrants within 500 ft of the park" then "which of those are in the park"), both must hold.
      const under = prior?.scope ? await scopeAsIds(prior.scope, entry) : null
      const built = await buildScope(under ? under.live : live, entry, read, anchor, under ? `${prior!.scope!.said}, ${said}` : said, where, notify)
      if (built.scope && under) built.scope.live = rebase(live, built.scope.live, entry.key)
      if (!built.scope) {
        // Too many to carry as a list: the count is still exact.
        return { text: `**${(built.count || 0).toLocaleString()}** ${entry.title.toLowerCase()} are ${said}. That is more than I can list or filter at once (${MAX_IDS.toLocaleString()}); narrow it and I can show them.`, mood: 'acknowledge', sources: [{ title: entry.title, detail: `Live layer query · ${said}` }] }
      }
      const scope = built.scope
      const drawFeet = read.relation === 'within' ? Number(read.feet) : 0
      const origin = anchorPoint(anchor)
      const shapes = anchorRings(anchor, drawFeet)
      const draw = async (): Promise<boolean> => { try { return await live.showPlaces(anchor.geoms.length === 1 && !anchor.area ? origin : null, [], { rings: shapes.own, around: shapes.around }) } catch (err) { return false } }

      // ---- the owners near a place, as a list to save
      if (notify) {
        const list = await noticeList(scope, entry, anchor.key === entry.key ? (anchor.ids || []) : [], live.view)
        const drawn = await draw()
        this.lastAsk = { ask, key: entry.key, scope }; this.lastAskAt = Date.now(); this.lastLayer = entry.path
        this.lastResults = list.features.slice(0, this.ctx.maxResults).map(g => ({ entry, graphic: g, label: String(g.attributes?.[live.target(entry).displayField] ?? 'Parcel') }))
        if (!list.parcels) return { text: `No parcels are ${said}.`, mood: 'think', sources: [{ title: entry.title, detail: said }] }
        const lot = anchor.area && anchor.key === entry.key ? ' The distance is measured from the lot line, and the subject property is in the list and marked.' : anchor.area ? '' : ' The distance is measured from that point, not from a lot line.'
        const reply: Reply = {
          text: `**${list.parcels.toLocaleString()}** ${list.parcels === 1 ? 'parcel is' : 'parcels are'} ${said}${list.ownerField ? `, with **${list.owners.toLocaleString()}** different ${list.owners === 1 ? 'owner' : 'owners'}` : ''}.${lot}${drawn ? (shapes.around.length ? ` The ${read.distance} line is drawn on the map.` : ' The area is drawn on the map.') : ''}${list.ownerField ? '' : ' This parcel layer has no owner field I can find, so the list has the parcels only.'}${list.ownerField && !list.hasMailing ? ' It has no mailing address fields, so the list has owners and property addresses.' : ''}${list.capped ? ' The list stops at 2,000 parcels.' : ''}`,
          mood: 'pleased',
          table: { columns: list.columns, rows: list.rows.slice(0, 25) },
          save: { name: `notice-list-${read.distance!.replace(/[^a-z0-9]+/gi, '')}-${new Date().toISOString().slice(0, 10)}.csv`, text: list.csv, type: 'text/csv;charset=utf-8', label: `Save all ${list.parcels.toLocaleString()} as a spreadsheet file` },
          note: 'From the parcel layer as it is today. Check it against the official notice requirements before mailing.',
          sources: [{ title: entry.title, detail: `Live layer query · ${said} · ${new Date().toLocaleTimeString()}` }],
          results: this.lastResults,
          suggest: ['What about 500 ft', 'Only show them on the map']
        }
        if (list.rows.length > 25) reply.text += ` The first 25 are shown here; the file has them all.`
        return reply
      }

      const reply = await this.answerAsk(ask, entry, scope)
      const drawn = reply.mood === 'confused' ? false : await draw()
      const notes: string[] = []
      if (read.assumed) notes.push(`“Near” taken as ${NEAR_FEET} ft. Say “what about 1000 ft” to change it.`)
      if (read.relation === 'touch') notes.push('Next to means within 3 ft, so lots across a street do not count.')
      if (read.relation === 'in' && anchor.area && !/polygon/i.test(String(live.target(entry)?.geometryType || ''))) { /* points and lines in an area need no caveat */ } else if (read.relation === 'in') notes.push('Counted when the inside of one overlaps the inside of the other, so sharing only an edge does not count.')
      if (read.relation === 'within' && anchor.area && anchor.key && anchor.geoms.length === 1) notes.push('Measured from its edge, not its middle.')
      if (read.notify && !notify) notes.push('This lists the parcels. Owner lists to save are turned on by whoever built this app.')
      if (drawn && anchor.geoms.length) notes.push(shapes.around.length ? 'The distance is drawn on the map as a dashed line.' : shapes.own.length ? 'The area is outlined on the map.' : '')
      if (notes.length) reply.note = notes.join(' ')
      // Another distance is the likeliest next question.
      if (read.feet && read.relation === 'within' && reply.mood !== 'confused') reply.suggest = [`What about ${read.feet >= 2640 ? 'a quarter mile' : read.feet >= 1000 ? '500 ft' : '1000 ft'}`, ...(ask.kind === 'list' ? ['How many of those?'] : [])]
      return reply
    } catch (error) {
      return { text: error instanceof Error ? error.message : 'The map service did not answer that. Try again in a moment.', mood: 'confused' }
    }
  }

  /**
   * The other side of a cross-layer question as shapes: the thing just shown ("it", "this parcel"),
   * the map ("here"), a named feature ("Compass Park", "Ward 3"), a layer with or without filters
   * ("a school", "out of service hydrants"), or a place or address. Null when it is none of these;
   * a Reply when it is one but something is missing.
   */
  private async spatialAnchor (read: SpatialRead, entries: LayerEntry[], target: LayerEntry): Promise<Anchor | Reply | null> {
    const live = this.ctx.live
    const words = read.anchor
    const w = words.toLowerCase()
    const lots = live.parcelLayers().map(e => e.key)
    const parcels = entries.filter(e => lots.includes(e.key)).sort((a, b) => lots.indexOf(a.key) - lots.indexOf(b.key))[0]
    const lotLine = read.notify || read.relation === 'touch' || (parcels && target.key === parcels.key)
    const fromPlace = async (at: [number, number], label: string): Promise<Anchor> => {
      // For parcels and notices, the place is its lot: the distance runs from the lot line.
      if (lotLine && parcels) { try { const lot = await areaAt(live, parcels, at, label); if (lot) return lot } catch (e) { } }
      return pointAnchor(at, label)
    }
    if (read.per) {
      const named = mentionedLayer(words, entries.map(e => schemaOf(live, e)))
      const e = named && entries.find(x => x.key === named.layer.key)
      if (!e) return null
      return anchorFromLayer(live, e, '', e.title)
    }
    if (/^(?:here|me|my location|where i am|this spot|this point|this place|the map|the map cent(?:er|re)|the middle of the map|this area)$/.test(w)) {
      const c = this.mapContext()?.center
      return c ? fromPlace(c, 'the middle of the map') : { text: 'I need the map for that, and it is not ready yet.', mood: 'confused' }
    }
    if (/^(?:it|this|that|there|this one|that one|this (?:parcel|property|lot|address|feature|site)|that (?:parcel|property|lot|address|feature|site)|the (?:parcel|property|lot|site|subject(?: property| parcel)?))$/.test(w)) {
      // One thing on hand is "it". After a list of several, "it" is the place that list was about.
      const hit = this.lastResults?.length === 1 ? this.lastResults[0] : null
      const g: any = hit?.graphic?.geometry
      // The thing last shown: its own shape when it has one.
      if (g && hit.entry && Date.now() - this.lastResultsAt < 15 * 60000 && (!this.lastPlace || this.lastPlace.at <= this.lastResultsAt)) {
        const t = live.target(hit.entry)
        const id = Number(hit.graphic.attributes?.[t?.objectIdField])
        if (t?.objectIdField && Number.isFinite(id)) return anchorFromLayer(live, hit.entry, `${t.objectIdField} = ${id}`, String(hit.label || 'that one'))
      }
      const r = this.recentPlace()
      if (r) return fromPlace([r.lat, r.lon], r.label)
      return { text: `Which place? Give me an address, or find it first and then ask “${clip(read.target, 40)} ${read.relation === 'within' ? `within ${read.distance} of it` : 'next to it'}”.`, mood: 'think' }
    }
    const addressLike = /^\d{1,6}[a-z]?\s+\S/.test(w) || MY_PLACE.test(w)
    if (!addressLike) {
      const schemas = entries.map(e => schemaOf(live, e))
      const layer = mentionedLayer(words, schemas)
      if (layer) {
        const e = entries.find(x => x.key === layer.layer.key)!
        try { await loadValues(live, e) } catch (err) { }
        const mine = [schemaOf(live, e)]
        // Its own name first: "Compass Park" is one park, not parks with "compass" somewhere in a field.
        const own = namedFeature(words, mine)
        if (own && /^[a-z_][a-z0-9_.]*$/i.test(own.field.name)) return anchorFromLayer(live, e, `${own.field.name} = '${own.value.replace(/'/g, "''")}'`, own.value)
        let a: Ask | null = null
        try { a = readAsk(`list ${words}`, mine, { fallback: e.key }) } catch (err) { a = null }
        if (a && a.unknown.length) { let clause: any = null; try { clause = await probeText(live, e, a.unknown.join(' '), askWhere(a)) } catch (err) { } ; a = clause ? { ...a, clauses: [...a.clauses, clause], unknown: [] } : null }
        // Only the layer's own words ("a hydrant" for Fire Hydrants): every feature of it.
        const stemOf = (x: string): string => x.toLowerCase().replace(/(?:ies)$/, 'y').replace(/(?:es|s)$/, '')
        const titleWords = e.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stemOf)
        const all = words.toLowerCase().split(/[^a-z0-9]+/).filter(x => x && !/^(?:the|a|an|any|all|of)$/.test(x)).every(x => titleWords.includes(stemOf(x)))
        if (a || all) {
          const saidFilter = a ? askSaid(a) : ''
          const one = /^(?:a|an|any|one)\s/i.test(read.anchor) || !/s$/i.test(words)
          const label = saidFilter ? `${e.title.toLowerCase()} (${saidFilter})` : one ? `${/^[aeiou]/i.test(e.title) ? 'an' : 'a'} ${e.title.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}` : e.title.toLowerCase()
          return anchorFromLayer(live, e, a ? askWhere(a) : '', label)
        }
      }
      // A feature called by its own name: "Compass Park", "Ward 3", "the floodplain".
      for (const e of entries.slice(0, 12)) { try { await loadValues(live, e) } catch (err) { } }
      // "The R-4 zone", "Ward 3 district": the name with or without the word for the kind of area.
      const short = words.replace(/\s+(?:zoning district|zone|district|area|boundary|limits|neighbou?rhood|subdivision|precinct)s?$/i, '').trim()
      const everything = entries.map(e => schemaOf(live, e))
      const areas = entries.filter(e => /polygon/i.test(String(live.target(e)?.geometryType || ''))).map(e => schemaOf(live, e))
      const named = namedFeature(words, everything) || namedFeature(short || words, areas, 2) || namedValue(short || words, areas)
      if (named) {
        const e = entries.find(x => x.key === named.layer.key)!
        if (/^[a-z_][a-z0-9_.]*$/i.test(named.field.name)) return anchorFromLayer(live, e, `${named.field.name} = '${named.value.replace(/'/g, "''")}'`, named.value)
      }
      // A layer whose whole name is the words ("the floodplain" for a layer named Floodplain).
      const whole = entries.find(e => flat(e.title) === flat(words) || flat(e.title.replace(/s$/i, '')) === flat(words.replace(/s$/i, '')))
      if (whole) return anchorFromLayer(live, whole, '', `the ${whole.title.toLowerCase()}`)
    }
    // An area cannot be a geocoded point, and "in <words>" with no layer behind it is not a place question.
    if (read.relation === 'in' || !this.canLocate()) return null
    const place = await this.locate(words)
    if (place) return fromPlace(place.at, place.label)
    return read.notify ? { text: `I could not find “${clip(words, 60)}” as a place or as something on this map.`, mood: 'confused' } : null
  }

  // ------------------------------------------------------------ a place handed to another widget

  /** "Property report for 250 Main St": finds the place and hands it to a widget the builder wired to Mappy's location message. */
  private async sendPlaceQuestion (input: string): Promise<Reply | null> {
    const targets = this.ctx.placeTargets || []
    if (!targets.length || !this.ctx.sendPlace || /^__/.test(input)) return null
    const read = readSend(input, targets)
    if (!read) return null
    const name = read.target.label
    let spot: { label: string, at: [number, number] } | null = null
    if (read.place === 'it') {
      // The one thing just found (a parcel, a park) is "it"; otherwise the place last talked about.
      const hit = this.lastResults?.length === 1 ? this.lastResults[0] : null
      const g: any = hit?.graphic?.geometry
      if (g && Date.now() - this.lastResultsAt < 15 * 60000 && (!this.lastPlace || this.lastPlace.at <= this.lastResultsAt)) {
        let ll: [number, number] | null = null
        try { ll = this.toLatLon(g.type === 'point' ? g : (g.extent?.center || g.centroid)) } catch (e) { ll = null }
        if (ll) spot = { label: String(hit.label || 'that one'), at: ll }
      }
      if (!spot) spot = await this.locate('it')
      if (!spot) return { text: `Which place? Give me an address, like “${name} for 250 Main St”, or find it first and then ask.`, mood: 'think' }
    } else {
      if (!this.canLocate() && !/^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(read.place)) return { text: `I need an address search in this app to find “${clip(read.place, 60)}”. Find the place on the map first, then ask for “${name} here”.`, mood: 'confused' }
      try { spot = await this.locate(read.place) } catch (e) { spot = null }
      if (!spot) return { text: `I could not find “${clip(read.place, 60)}”. Check the address and try again.`, mood: 'confused' }
    }
    const label = /^-?\d/.test(spot.label) && /,/.test(spot.label) && !/[a-z]/i.test(spot.label) ? 'that spot' : spot.label
    let ok = false
    try { ok = await this.ctx.sendPlace(read.target, { lat: spot.at[0], lon: spot.at[1], label }) } catch (e) { ok = false }
    if (!ok) return { text: `I found ${label === 'that spot' ? 'the spot' : `**${label}**`}, but I could not hand it to **${name}**.`, mood: 'confused' }
    try { await this.ctx.live.showPlaces(spot.at, [], {}) } catch (e) { }
    this.lastPlace = { label, lat: spot.at[0], lon: spot.at[1], at: Date.now() }
    return { text: label === 'that spot' ? `I sent that spot to **${name}**.` : `I sent **${label}** to **${name}**.`, mood: 'happy', sent: true }
  }

  /** After he finds a place: a chip for each widget that can take it. */
  private offerSend (reply: Reply, startedAt: number): void {
    const targets = this.ctx.placeTargets || []
    const p = this.lastPlace
    if (!targets.length || !this.ctx.sendPlace || !p || p.at < startedAt || reply.sent || ['confused', 'alert', 'sorry', 'think'].includes(reply.mood || '')) return
    if (!this.placeNames.has(placeKey(p.lat, p.lon)) && p.label) this.placeNames.set(placeKey(p.lat, p.lon), p.label)
    const have = new Set((reply.actions || []).map(a => a.label))
    const chips = targets.slice(0, 2).map(t => sendChip(t, p.lat, p.lon)).filter(c => !have.has(c.label))
    if (chips.length) reply.actions = [...(reply.actions || []), ...chips.map(c => ({ type: 'ask' as const, label: c.label, q: c.q }))]
  }

  // ------------------------------------------------------------ ArcGIS Enterprise MCP: portal content and portal layers

  /** The address of a portal item's page, when the app knows its portal. */
  private itemPage (id: string): string {
    const portal = String(this.ctx.portalUrl || '').replace(/\/+$/, '')
    return /^https:\/\//i.test(portal) && /^[0-9a-f]{32}$/i.test(id) ? `${portal}/home/item.html?id=${id}` : ''
  }

  /**
   * Requests that are about the portal, not this map: "find maps about zoning", "search the
   * portal for flood data", a choice from the list just shown, and the next question about a
   * portal layer already being talked about. Null when it is not one of those.
   */
  private async portalCommand (text: string): Promise<Reply | null> {
    const port = this.ctx.mcp
    if (!port || Date.now() - this.mcpFailedAt < 60000) return null
    const pick = text.match(/^__portal:(\d+)$/)
    if (!pick && /^__/.test(text)) return null
    if (!this.esri) { if (!pick && !parseContentSearch(text) && !/\bin (?:the |our )?portal\b/i.test(text)) return null; try { await this.serverTools() } catch (e) { this.mcpFailedAt = Date.now(); return null } }
    const cat = this.esri
    if (!cat) return null
    try {
      if (pick) {
        const hit = this.portalItems && Date.now() - this.portalItems.at < 15 * 60000 ? this.portalItems.items[Number(pick[1])] : null
        if (!hit) return { text: 'That list is no longer current. Search again.', mood: 'confused' }
        return await this.askPortalItem(hit, this.portalItems!.question || `how many ${hit.title}`, this.portalItems!.thing || hit.title)
      }
      // "... in the portal": a data question aimed there on purpose.
      const aimed = text.match(/^(.{6,160}?)\s+in (?:the |our )?(?:portal|organization|org)[?.!]*$/i)
      if (aimed && askedThing(aimed[1])) { const r = await this.portalData(aimed[1]); if (r) return r }
      const search = parseContentSearch(text)
      if (search && cat.search) return await this.portalSearch(search.q, search.type)
      // Still talking about the portal layer just asked about.
      const last = this.lastRemote
      if (last && Date.now() - last.at < 10 * 60000 && last.at >= this.lastAskAt && (!this.lastPlace || this.lastPlace.at < last.at)) {
        const follow = await this.remoteFollow(text)
        if (follow) return follow
      }
    } catch (e) {
      this.mcpFailedAt = Date.now()
      return { text: e instanceof Error ? e.message : `${port.label} did not answer.`, mood: 'confused' }
    }
    return null
  }

  private async portalSearch (q: string, type?: string): Promise<Reply> {
    const port = this.ctx.mcp!; const tool = this.esri!.search!
    this.track('mcp:' + tool.name)
    const raw = await port.call(tool.name, searchArgs(tool, q, type, 8))
    if (raw?.isError) return { text: `${port.label} could not search: ${clip(toolError(raw), 200)}`, mood: 'confused' }
    const items = readItems(toolData(raw))
    const what = `${type ? type.toLowerCase() + 's' : 'items'}${q ? ` about “${clip(q, 60)}”` : ''}`
    if (!items.length) {
      return { text: `I found no ${what} in the portal that you can open. Only items tagged **mcp** can be found this way, so one may exist without the tag.`, mood: 'think', sources: [{ title: port.label, detail: toolLabel(tool) }], suggest: q && type ? [`Search the portal for ${q}`] : undefined }
    }
    this.portalItems = { items, thing: q, question: '', at: Date.now() }
    const canAsk = !!(this.esri!.layer && this.esri!.query)
    const reply: Reply = {
      text: `I found ${items.length} ${items.length === 1 ? what.replace(/s\b/, '') : what} in the portal.${canAsk && items.some(queryable) ? ' Choose a layer to ask it questions.' : ''}`,
      mood: 'pleased',
      list: items.map((it, i) => ({
        label: `${i + 1}. ${it.title}${it.type ? ` (${it.type})` : ''}${it.snippet ? `: ${clip(it.snippet, 90)}` : ''}`,
        action: canAsk && queryable(it) ? { type: 'ask' as const, q: `__portal:${i}`, label: `Ask about ${it.title}` } : this.itemPage(it.id) ? { type: 'url' as const, url: this.itemPage(it.id), label: `Open ${it.title}` } : undefined
      })),
      sources: [{ title: port.label, detail: `${toolLabel(tool)}${q ? ` · ${clip(q, 60)}` : ''} · items tagged mcp that you can open` }]
    }
    return reply
  }

  /** A data question no layer on this map answers ("how many bus stops are there"): find the layer in the portal and ask it. */
  private async portalData (question: string): Promise<Reply | null> {
    const cat = this.esri; const port = this.ctx.mcp
    if (!cat?.search || !cat.layer || !cat.query || !port) return null
    const thing = askedThing(question)
    if (!thing) return null
    this.track('mcp:' + cat.search.name)
    const raw = await port.call(cat.search.name, searchArgs(cat.search, thing, 'Feature Service', 5))
    if (raw?.isError) return null
    const items = readItems(toolData(raw)).filter(queryable)
    if (!items.length) return null
    const flat = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/(?:es|s)\b/g, '')
    const exact = items.filter(it => flat(it.title) === flat(thing) || it.layers.some(l => flat(l.name) === flat(thing)))
    if (items.length === 1 || exact.length === 1) return this.askPortalItem(exact.length === 1 ? exact[0] : items[0], question, thing)
    this.portalItems = { items, thing, question, at: Date.now() }
    return {
      text: `This map has no layer for that, but the portal has ${items.length} that could fit “${clip(thing, 50)}”. Which one?`, mood: 'think',
      list: items.map((it, i) => ({ label: `${i + 1}. ${it.title}${it.snippet ? `: ${clip(it.snippet, 90)}` : ''}`, action: { type: 'ask' as const, q: `__portal:${i}`, label: `Ask ${it.title}` } })),
      sources: [{ title: port.label, detail: `${toolLabel(cat.search)} · ${clip(thing, 50)}` }]
    }
  }

  /** Opens one portal layer for questions: its fields from describe_layer, then the question itself. */
  private async remoteLayer (item: PortalItem, thing: string): Promise<RemoteLayer> {
    const cat = this.esri!; const port = this.ctx.mcp!
    let layers = item.layers
    const direct = /\/\d+$/.test(item.url)
    if (!direct && !layers.length && cat.item) {
      const raw = await port.call(cat.item.name, describeItemArgs(cat.item, item.id))
      layers = readItems(toolData(raw))[0]?.layers || []
    }
    const chosen = direct ? null : pickLayer(layers, thing)
    const ref = layerRef(item.url, chosen?.id)
    const url = `${ref.serviceUrl}/${ref.layerId}`
    const known = this.remoteLayers.get(url)
    if (known) return known
    this.track('mcp:' + cat.layer!.name)
    const raw = await port.call(cat.layer!.name, describeLayerArgs(cat.layer!, item.url, chosen?.id))
    if (raw?.isError) throw new Error(`${port.label} could not describe **${item.title}**: ${clip(toolError(raw), 200)}`)
    const schema = readLayerSchema(toolData(raw), `portal:${url}`, chosen?.name || item.title) as RemoteSchema | null
    if (!schema) throw new Error(`${port.label} did not say what fields **${item.title}** has, so I cannot ask it questions.`)
    const layer = new RemoteLayer(port, cat.query!, url, schema)
    if (this.remoteLayers.size > 20) this.remoteLayers.clear()
    this.remoteLayers.set(url, layer)
    return layer
  }

  private async askPortalItem (item: PortalItem, question: string, thing: string): Promise<Reply> {
    const layer = await this.remoteLayer(item, thing)
    return this.answerRemote(layer, item, question, thing)
  }

  /** Reads a question against a portal layer's fields and runs it with the same code that answers map layers. */
  private async answerRemote (layer: RemoteLayer, item: PortalItem, question: string, thing: string, prior?: Ask): Promise<Reply> {
    const port = this.ctx.mcp!
    const schema = layer.schema
    // The layer is named by what the person called it, so "how many bus stops" lands on it whatever its title.
    const named = [schema]
    let ask: Ask | null = null
    try { ask = readAsk(question, named, { fallback: schema.key }) || readAsk(`${question.replace(new RegExp(thing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), schema.title)}`, named, { fallback: schema.key }) } catch (e) { ask = null }
    if (!ask && prior) { ask = prior; prior = undefined }
    if (!ask) ask = { layer: schema.key, kind: 'count', clauses: [], unknown: [] }
    if (prior) ask = ask.kind === 'top' ? { ...ask, clauses: [...prior.clauses.filter(c => !ask!.clauses.some(n => n.field.name === c.field.name)), ...ask.clauses] } : { ...prior, ...(ask.kind !== 'count' || !ask.clauses.length ? { kind: ask.kind, field: ask.field, stat: ask.stat, group: ask.group, order: ask.order, limit: ask.limit } : {}), clauses: [...prior.clauses.filter(c => !ask!.clauses.some(n => n.field.name === c.field.name)), ...ask.clauses], unknown: ask.unknown }
    // Words the layer's fields and example values do not explain: said, never guessed at.
    const lost = ask.unknown.filter(w => !thing.toLowerCase().split(/\s+/).includes(w) && !schema.title.toLowerCase().split(/\s+/).includes(w))
    const entry: any = { key: schema.key, title: schema.title, path: [], isTable: true, isGroup: false }
    const shim: any = { target: () => layer, view: null, isVisible: () => false }
    const reply = await runAsk(shim, entry, { ...ask, unknown: [] }, this.ctx.maxResults)
    delete reply.results
    this.lastRemote = { layer, item, at: Date.now(), ask }
    this.lastAskAt = 0
    const page = this.itemPage(item.id)
    reply.actions = page ? [{ type: 'url', url: page, label: `Open ${item.title} in the portal` }] : []
    reply.sources = [{ title: `${item.title} (portal layer, not on this map)`, detail: `${port.label} · ${askSaid(ask) || 'all records'} · ${new Date().toLocaleTimeString()}` }]
    if (lost.length) reply.text += `\n\nI did not use “${lost.join(' ')}”: nothing in that layer's fields matched it.`
    reply.note = 'From a portal layer that is not on this map.'
    reply.suggest = ask.kind === 'count' ? [`List them`, `What fields does ${schema.title} have`] : undefined
    return reply
  }

  /** The next question about the portal layer just asked about: a pronoun, a swap, or a question its fields explain. */
  private async remoteFollow (text: string): Promise<Reply | null> {
    const last = this.lastRemote!
    const t = text.trim().toLowerCase().replace(/[?.!]+$/, '')
    const schema = last.layer.schema
    if (/^(?:what|which) fields (?:does|do) (?:it|that|they|.{2,60}) have$|^(?:its|their|the) fields$/.test(t)) {
      const shown = schema.fields.filter(f => !/^(?:shape|objectid|globalid)/i.test(f.name)).slice(0, 25)
      return { text: `**${schema.title}** has ${schema.fields.length} fields. ${shown.length < schema.fields.length ? 'Some of them:' : 'They are:'}`, mood: 'explain', table: { columns: ['Field', 'Type'], rows: shown.map(f => [f.alias || f.name, String(f.type || '').replace(/^esriFieldType/, '')]) }, sources: [{ title: `${schema.title} (portal layer)`, detail: this.ctx.mcp!.label }] }
    }
    const pronoun = /\b(?:it|its|that|them|those|these|they|their|ones?)\b/.test(t)
    const swap = t.match(/^(?:and |or |now )?(?:(?:what|how) about|and|or|same for|now)\s+(?:just |only )?(?:the ones? |those |in |for |with )?(.{2,60})$/)
    const lister = /^(?:list|show)(?: me)? (?:them|those|these)(?: all)?$/.test(t)
    if (lister) return this.answerRemote(last.layer, last.item, `list ${schema.title}`, schema.title, last.ask ? { ...last.ask, kind: 'list' } : undefined)
    const words = swap ? `${swap[1]} ${schema.title}` : pronoun ? t.replace(/\b(?:of |in )?(?:them|those|these|they|it|that)\b/g, ` ${schema.title} `).replace(/\b(?:which|what) ones?\b/, `which ${schema.title}`) : t
    let ask: Ask | null = null
    try { ask = readAsk(words, [schema], { fallback: schema.key }) } catch (e) { ask = null }
    // Not about this layer unless it leans on it (a pronoun, a swap) or names it, and its fields explain every word.
    const namesIt = mentionedLayer(t, [schema])
    if (!ask || ask.unknown.length || (!pronoun && !swap && !namesIt) || (!ask.clauses.length && ask.kind === 'count' && !namesIt && !pronoun)) return null
    return this.answerRemote(last.layer, last.item, words, schema.title, pronoun || swap ? last.ask : undefined)
  }

  /** When Mappy is stuck, offer the server's best-fitting tool as a button (nothing is sent until it is pressed). */
  private async offerServer (text: string, reply: Reply): Promise<Reply> {
    const port = this.ctx.mcp
    if (!port || port.fallback === false || reply.mood !== 'confused' || /^__/.test(text)) return reply
    try {
      if (Date.now() - this.mcpFailedAt < 60000) return reply
      let tools: McpTool[] = []
      try { tools = await this.serverTools() } catch (e) { this.mcpFailedAt = Date.now(); return reply }
      // No layer on this map answers it: the portal may have one (ArcGIS Enterprise MCP).
      if (this.esri?.query && askedThing(text)) { try { const far = await this.portalData(text); if (far) return far } catch (e) { } }
      // Esri's helper tools (describe an item, job status) are steps he takes himself, never an offer.
      const hit = matchTool(text, this.esri ? tools.filter(t => !esriHelperTool(t.name)) : tools)
      if (!hit) return reply
      // A plain question a read-only tool can answer as asked: just answer it, like a person would.
      const map = this.mapContext()
      if (/^(?:what|where|who|which|how|is|are|does|do|find|show|list|tell|look ?up|count)\b/i.test(text.trim()) && hit.score >= 2 &&
        !needsConfirm(hit.tool, port.prefs) && !fillArgs(hit.tool, text, map).missing.length) {
        try {
          const answered = await this.runTool(hit.tool, fillArgs(hit.tool, text, map).args)
          if (answered.mood !== 'confused') return answered
        } catch (e) { }
      }
      return { ...reply, actions: [{ type: 'ask' as const, q: '__mcp:ask:' + text, label: `Ask ${port.label}` }, ...(reply.actions || [])].slice(0, 4) }
    } catch (e) { return reply }
  }

  private async respondRead (input: string): Promise<Reply> {
    this.syncContext()
    input = normalizeCommand(input)
    if (input.length > 2000) return { text: 'Please keep each request under 2,000 characters.', mood: 'confused' }
    // Data task controls: card buttons, or the same changes said in words.
    const taskButton = input.match(/^__task:(\d+):(refresh|view|all|unfilter|rows|count)$/)
    if (taskButton) return this.runTask(Number(taskButton[1]), taskButton[2] as TaskOperation)
    if (this.dataTask) {
      const said = input.trim().replace(/[.!?]+$/, '').toLowerCase()
      const op: TaskOperation | null = /^(?:use|search|query) (?:the )?(?:whole|entire|full) layer$/.test(said) ? 'all'
        : /^(?:use|search|query) (?:the )?current (?:map )?view$|^(?:only )?in (?:the current )?view$/.test(said) ? 'view'
          // "Clear the filter" means the one on the map when there is one; the task's own filter otherwise.
          : /^(?:remove|clear|drop) (?:my |the )?filter$/.test(said) && !this.ctx.live.filtered().length ? 'unfilter'
            : /^(?:refresh|rerun|run it again|update) (?:the )?(?:task|results?)?$|^refresh$/.test(said) ? 'refresh' : null
      if (op) return this.runTask(this.dataTask.sequence, op)
    }
    // A layer command still waiting for its layer.
    const picked = await this.answerPick(input)
    if (picked) return picked
    if (/^__layerpick:/.test(input)) return { text: 'That layer choice is no longer available. Ask again.', mood: 'confused' }
    if (this.layerChoices && this.layerChoices.view !== this.ctx.live.view) this.layerChoices = null
    const layerChoice = input.match(/^__layerchoice:(\d+):(\d+)$/)
    if (layerChoice) return this.chooseLayer(Number(layerChoice[1]), Number(layerChoice[2]))
    if (this.layerChoices) {
      if (/^(?:cancel|never mind|nevermind|forget it)[!.?]*$/i.test(input)) {
        this.layerChoices = null
        return { text: 'Cancelled that layer choice. No additional action was taken.', mood: 'talk' }
      }
      const number = resultNumber(input)
      if (number !== null) return this.chooseLayer(this.layerChoices.sequence, number - 1)
      const name = input.replace(/^(?:use|choose|pick)\s+(?:the\s+)?/i, '').replace(/[?!]+$/, '')
      const matches = this.layerChoices.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => flat(entry.path) === flat(name) || entry.key === name)
      if (matches.length === 1) return this.chooseLayer(this.layerChoices.sequence, matches[0].index)
      if (!['thanks', 'greet'].includes(parseIntent(input).name) && !/^(?:repeat(?: that)?|say that again)[!.?]*$/i.test(input)) this.layerChoices = null
    }
    const correction = input.match(/^(?:no|actually|i meant)[,\s]+(.+)$/i)
    if (correction && addressPrompt(correction[1])) input = `geocode ${addressPrompt(correction[1])}`
    const place = this.lastAddress && addressPlace(input)
    if (place) {
      if (this.lastAddress.length + place.length + 2 > 2000) return { text: 'That combined address is too long. Please enter a shorter full address.', mood: 'confused' }
      this.addressChoices = null
      const reply = await this.locateAddress(`${this.lastAddress}, ${place}`, this.lastAddress)
      this.lastReply = reply
      return reply
    }
    const addressChoice = input.match(/^__address:(\d+):(\d+)$/)
    if (addressChoice) return this.chooseAddress(Number(addressChoice[1]), Number(addressChoice[2]))
    if (this.addressChoices && /^(?:zoom to|go to|show) (?:it|that address)[!.?]*$/i.test(input)) {
      return this.addressChoices.selected != null
        ? this.chooseAddress(this.addressChoices.sequence, this.addressChoices.selected)
        : { text: 'Choose an address match first, for example “show the first result”.', mood: 'think' }
    }
    if (this.tablePage && /^(?:show more|more rows|show (?:the )?next (?:page|rows))[.!?]*$/i.test(input)) input = 'next page'
    if (this.tablePage && /^(?:back a page|show (?:the )?previous (?:page|rows))[.!?]*$/i.test(input)) input = 'previous page'
    if (/^(?:next|previous|prev)(?: page| rows)[.!?]*$/i.test(input.trim())) {
      const page = this.tablePage
      if (!page || !this.ctx.featureSearch) return { text: 'Open a table first, for example: "show table parcels".', mood: 'confused' }
      const next = /^next/i.test(input.trim())
      if ((next && !page.hasNext) || (!next && page.offset === 0)) return { text: next ? 'There are no more rows in this result.' : 'You are on the first page.', mood: 'talk' }
      const entry = this.ctx.live.find(page.key)
      if (!entry || !this.ctx.live.canSee(entry)) return { text: 'That table or layer is no longer available. Open it again.', mood: 'confused' }
      try {
        const view = this.ctx.live.view
        const reply = await analyzeLayer(this.ctx.live, entry, { kind: 'browse', layer: entry.key, inView: false, condition: page.condition, field: page.field, order: page.order, offset: Math.max(0, page.offset + (next ? page.size : -page.size)) }, page.size)
        if (view !== this.ctx.live.view) return { text: 'The active map changed. Open the table again on this map.', mood: 'confused' }
        if (reply.page) this.tablePage = { key: entry.key, condition: page.condition, field: page.field, order: page.order, ...reply.page }
        this.lastReply = reply
        return reply
      } catch (error) { return { text: error instanceof Error ? error.message : 'Could not load table rows.', mood: 'confused' } }
    }
    if (/^(?:repeat(?: that)?|say that again|what did you (?:say|find))[.!?]*$/i.test(input.trim())) return this.lastReply || { text: 'Ask me about a layer or tool first.', mood: 'talk' }
    const number = resultNumber(input)
    if (number !== null && (this.addressChoices || this.lastResults.length || !/^\d+[.!?]*$/.test(input))) {
      if (this.addressChoices) return this.chooseAddress(this.addressChoices.sequence, number - 1)
      const result = this.lastResults[number - 1]
      if (!result) return { text: 'There is no result with that number in my last search. Run a search first, or choose a visible result.', mood: 'confused' }
      if (!result.graphic?.geometry) return { text: `**${result.label}** has no map geometry to zoom to.`, mood: 'talk' }
      await this.ctx.live.show(result)
      this.lastLayer = result.entry.path
      return { text: `Showing **${result.label}** from **${result.entry.title}**.`, mood: 'pleased', results: [result], suggest: ["What's in it?", 'How many in view?'] }
    }
    const follow = input.trim().match(/^(?:what about|how about|and)\s+(.+?)[?!]*$/i)
    const countFollow = resultCountFollowup(input)
    const tableFollow = resultTableFollowup(input) || /^(?:show|list) (?:them|those|these)(?: all)?[.!?]*$/i.test(input.trim())
    // The same follow-ups after a question read against the layers.
    if (this.lastAsk && !this.lastAnalysis && (countFollow || tableFollow)) {
      const a = this.lastAsk.ask
      const e = this.ctx.live.entries().find(x => x.key === this.lastAsk!.key)
      const summarized = ['top', 'group', 'distinct', 'stat'].includes(a.kind) && !(a.kind === 'stat' && a.clauses.length)
      let reply: Reply
      if (!e) reply = { text: 'That layer is no longer in the map. Ask again using the current layers.', mood: 'confused' }
      else if (countFollow && a.kind === 'top') reply = { text: `I showed ${this.lastResults.length} ranked ${this.lastResults.length === 1 ? 'row' : 'rows'}. That is the displayed subset, not the full layer count.`, mood: 'talk' }
      else if (countFollow) reply = await this.askAgain('count')
      else if (summarized) reply = { text: 'That was a ranked or summarized result, so there is no single set of rows to open. Ask for the layer itself, for example “show table” and its name.', mood: 'talk' }
      else {
        const request: AnalysisRequest = { kind: 'browse', layer: e.key, inView: false, where: askWhere(a) || undefined, said: askSaid(a) || undefined }
        const keep = this.lastAsk
        try { reply = await analyzeLayer(this.ctx.live, e, request, this.ctx.maxResults); this.lastLayer = e.path } catch (error) { reply = { text: error instanceof Error ? error.message : 'The layer query failed.', mood: 'confused' } }
        this.lastAsk = keep
      }
      this.lastReply = reply
      return reply
    }
    if (this.lastAnalysis?.kind === 'quality' && (countFollow || tableFollow)) return { text: 'The quality report counts nulls separately for each field; one record can be missing several fields. Choose a “Missing” action for a specific field, or “Browse checked records” to inspect the full checked dataset.', mood: 'talk' }
    if (this.lastAnalysis?.limit && countFollow) {
      const reply: Reply = { text: `I showed ${this.lastAnalysisRows} ranked ${this.lastAnalysisRows === 1 ? 'row' : 'rows'}. That is the displayed subset, not the full layer count.`, mood: 'talk' }
      this.lastReply = reply
      return reply
    }
    if (this.lastAnalysis && (this.lastAnalysis.limit || ['stats', 'group'].includes(this.lastAnalysis.kind)) && tableFollow) {
      return { text: 'That was a ranked or summarized result, so there is no single set of rows to open. Ask for the layer itself, for example “show table” and its name.', mood: 'talk' }
    }
    // "hydrants?", "hello?": one word with a question mark is the word.
    if (/^\S+[?!.]+$/.test(input.trim())) input = input.trim().replace(/[?!.]+$/, '')
    input = analysisFollowup(input, this.lastAnalysis) || input
    if (follow && this.lastReadIntent) input = `${this.lastReadIntent} ${follow[1]}${this.lastReadScope}`
    if (!['thanks', 'greet'].includes(parseIntent(input).name)) { this.addressChoices = null; this.lastAddress = '' }
    if (input.length > 2000) return { text: 'Please keep each request under 2,000 characters.', mood: 'confused' }
    // "Open table" right after "turn on annexations" means that layer's table: the layer we are working with fills in first.
    const incomplete = this.incompleteLayerCommand(contextualCommand(input, this.lastLayer))
    if (incomplete) { this.lastReply = incomplete; return incomplete }
    let note = ''
    if (this.pendingPickNote) { note = this.pendingPickNote; this.pendingPickNote = ''; input = this.pendingRewrite || contextualCommand(input, this.lastLayer); this.pendingRewrite = '' }
    const commands = splitCommands(normalizeCommand(input))
    if (commands.length > 5) return { text: 'I can run up to five steps at once. Split this into smaller requests.', mood: 'confused' }
    if (commands.length > 1 && commands.some(q => addressPrompt(q))) return { text: 'Search for the address on its own first so we can resolve any possible matches. Then ask for the next map action.', mood: 'think' }
    if (commands.length > 1 && commands.some(q => ['ask', 'howto', 'undo', 'forget', 'sleep'].includes(parseIntent(q).name) && !parseAnalysis(q))) {
      return { text: 'Use explicit map commands for each step, separated by "then". Ask questions and undo separately.', mood: 'confused' }
    }
    const before = this.ctx.live.snapshot()
    const replies: Reply[] = []
    for (const command of commands) {
      const r = await this.respondOne(contextualCommand(command, this.lastLayer))
      if (this.ctx.live.view !== before.view) return { text: 'The active map changed while I was working. I stopped the request; please ask again on this map.', mood: 'confused' }
      replies.push(r)
      if (r.mood === 'confused' || r.mood === 'think') break
    }
    const last = replies[replies.length - 1] || this.help()
    if (note && last.text && !/^__/.test(input)) last.text = `**${note}** is the only layer on, so I used it.\n\n${last.text}`
    const changed = commands.length && parseIntent(commands[0]).name !== 'undo' && this.ctx.live.remember(before, commands.join('; '))
    const reply = replies.length > 1 || commands.length > 1
      ? { ...last, text: replies.map((r, i) => `${i + 1}. ${r.text}`).join('\n\n') + (replies.length < commands.length ? '\n\nStopped here; the remaining steps were not run.' : '') }
      : last
    if (changed) reply.actions = [{ type: 'ask' as const, q: 'undo', label: 'Undo layer changes' }, ...(reply.actions || []).filter(a => a.label !== 'Undo')].slice(0, 4)
    this.lastReply = reply
    if (reply.results) this.lastResults = reply.results
    return reply
  }

  private async respondOne (input: string): Promise<Reply> {
    // "open hydrants in the table", "the parcels table": the same as "show table ...".
    const raw = tablePhrase(input.trim()) || input.trim()
    if (raw.startsWith('__doc:')) return this.aboutDoc(raw.slice(6))
    if (raw === '__zoomsel') return await this.zoomToSelected()
    if (raw.startsWith('__table:')) return this.runTableJob(raw.slice(8))
    if (raw.startsWith('__ask:')) return await this.askAgain(raw.slice(6))
    // Easter eggs: jokes, riddles, dances, games. Only exact little phrases, never a real question.
    if (this.ctx.fun !== false) this.fun.setPlace(this.ctx.place)
    const fun = this.ctx.fun === false ? null : this.fun.reply(raw)
    if (fun) {
      if (fun.effect === 'nullIsland' && this.ctx.live.view) { try { await this.ctx.live.go({ center: [0, 0], scale: SCALE.world }) } catch (e) { } }
      return { text: fun.text, mood: fun.mood as any, ...(fun.suggest ? { suggest: fun.suggest } : {}) }
    }
    // "What is a parcel", "what does RM-8 mean": meanings, from the map's own code lists or the glossary.
    const it = parseIntent(raw)
    // "What zoning types are there", "list the land uses": the values a field really holds, before the glossary.
    if (/\b(?:types|kinds|values|categories|options|districts|classes)\b|\bare there\b|^list\b/i.test(raw)) { const d = await this.dataQuestion(raw, it.name, ['distinct']); if (d) return d }
    const def = definitionAsk(raw)
    const ownAnswer = (words: string) => (this.ctx.index.search(words, { limit: 1, kinds: ['faq', 'note'] })[0]?.score || 0) >= 4
    if (def && (def.code || ['ask', 'howto'].includes(it.name)) && !ownAnswer(def.phrase)) { const r = this.define(def.phrase, def.code); if (r) return withAct(r, 'explain') }
    // Office hours, bills, the weather: not on a map, said kindly with where to look. Never a layer command.
    const aside = ['ask', 'howto'].includes(it.name) && !/\blayers?\b/i.test(raw) ? outOfScope(raw, this.org()) : null
    if (aside) { const r = this.asideReply(raw, aside); if (r) return r }
    this.track(it.name)
    try {
      const address = addressPrompt(raw)
      // An explicitly named layer always keeps its feature-search semantics.
      if (address && !(it.name === 'find' && it.scope && this.ctx.live.find(it.scope))) return await this.locateAddress(address)
      // "... in chat": rows in the conversation, not the Table widget.
      const inChat = /\s+in (?:the )?chat$/i.test(raw) && /^show table\b/i.test(raw)
      // Map filters, charts and saved views have their own readings; the data-question reading would take their words for a layer name.
      // "Find Smith in parcels" is a word search in a named layer; that reading keeps it.
      const asked = it.name === 'find' && it.scope ? null : await this.dataQuestion(raw, it.name)
      if (asked) return asked
      const analysis = ['mapFilter', 'mapUnfilter', 'mapFilters', 'chart', 'chartLast', 'saveView', 'listViews', 'deleteView', 'avgSize', 'density', 'compareLayers', 'difference'].includes(it.name) ? null : parseAnalysis(inChat ? raw.replace(/\s+in (?:the )?chat$/i, '') : raw)
      if (analysis) {
        this.lastAnalysis = null; this.lastAsk = null
        this.lastReadIntent = ''; this.lastReadScope = ''
        this.lastResults = []; this.tablePage = null
        if (!this.ctx.featureSearch) return { text: 'Data queries are disabled by the app author.', mood: 'confused' }
        if (analysis.layer === '*field*') {
          // "What zoning is most common": the layer that has such a field, the one being worked with first.
          const live = this.ctx.live
          const has = (e: LayerEntry) => { try { resolveField(live.info(e).fields as any, analysis.field || ''); return true } catch (err) { return false } }
          const cands = live.entries().filter(e => !e.isGroup && live.isVisible(e)).sort((a, b) => (a.path === this.lastLayer ? -1 : 0) - (b.path === this.lastLayer ? -1 : 0))
          const pick = cands.find(has)
          if (!pick) return { text: `None of the layers that are on has a field like "${analysis.field}". Name the layer: "what ${analysis.field} is most common in parcels".`, mood: 'confused', suggest: ['List layers'] }
          analysis.layer = pick.key
        }
        const e = this.resolveLayer(analysis.layer)
        if (!e) return { text: `I cannot identify "${analysis.layer}". Use its full layer name.`, mood: 'confused', suggest: ['List layers'] }
        if (!this.ctx.live.canAsk(e)) return this.offReply(e)
        this.lastLayer = e.path
        // "Show table parcels": open it in the app's own Table widget when there is one.
        if (analysis.kind === 'browse' && this.ctx.openInTable && !inChat && !analysis.limit && !analysis.field) {
          try {
            const t = await this.ctx.openInTable(e, { condition: analysis.condition, inView: analysis.inView })
            if (t.ok) {
              this.rememberTask(analysis, e)
              return {
                text: this.tableSaid(e, t, analysis.condition ? `where ${analysis.condition}` : analysis.inView ? 'in view' : ''),
                mood: 'pleased',
                actions: [{ type: 'ask', q: `show table ${e.key}${analysis.condition ? ` where ${analysis.condition}` : ''}${analysis.inView ? ' in view' : ''} in chat`, label: 'Show rows here instead' }],
                suggest: [`How many ${e.title}?`, `Summarize ${e.title}`]
              }
            }
          } catch (err) { this.ctx.beacon?.error(err, 'table') }
        }
        try {
          const reply = await analyzeLayer(this.ctx.live, e, analysis, this.ctx.maxResults)
          this.lastAnalysis = { ...analysis, layer: e.key }
          this.lastAnalysisRows = reply.table?.rows.length || reply.results?.length || 0
          this.rememberTask(analysis, e)
          if (!analysis.limit && ['filter', 'browse', 'countWhere'].includes(analysis.kind)) reply.suggest = analysis.kind === 'countWhere'
            ? ['Show them in a table']
            : ['How many of those?', ...(analysis.kind === 'filter' ? ['Show them in a table'] : [])]
          if (reply.page && !analysis.inView && !analysis.limit) this.tablePage = { key: e.key, condition: analysis.condition, field: analysis.field, order: analysis.order, ...reply.page }
          else this.tablePage = null
          // Matching records can go straight to the app's Table widget.
          if (this.ctx.openInTable && ['filter', 'countWhere', 'browse'].includes(analysis.kind) && !inChat) {
            reply.actions = [this.tableAction(e, { condition: analysis.condition, inView: analysis.inView }), ...(reply.actions || [])]
          }
          return reply
        } catch (error) {
          return { text: error instanceof Error ? error.message : 'The layer query failed. Try again or use the app table.', mood: 'confused' }
        }
      }
      if (!['thanks', 'greet'].includes(it.name)) this.lastAnalysis = null
      if (it.target && ['layerOn', 'layerOff', 'solo', 'opacity', 'fields', 'count', 'goto', 'reveal'].includes(it.name)) {
        const e = this.resolveLayer(it.target)
        if (e) this.lastLayer = e.path
      }
      if (it.name === 'count') { this.lastReadIntent = 'count'; this.lastReadScope = it.scope === 'view' ? ' in view' : '' }
      else if (it.name === 'fields') { this.lastReadIntent = 'fields in'; this.lastReadScope = '' }
      else if (!['thanks', 'greet'].includes(it.name)) this.lastReadIntent = ''
      switch (it.name) {
        case 'dataIdeas': return await this.exploreData(it.target)
        case 'undo': {
          if (/basemap|background/i.test(raw)) {
            if (!this.undoBasemap || !this.ctx.live.view?.map) return { text: 'The background has not been changed.', mood: 'think' }
            try { this.ctx.live.view.map.basemap = this.undoBasemap } catch (e) { }
            const t = this.undoBasemap?.title; this.undoBasemap = null
            return { text: `Background back to **${t || 'what it was'}**.`, mood: 'acknowledge' }
          }
          const done = this.ctx.live.changesSoFar()
          const label = done[done.length - 1]
          const text = this.ctx.live.undo()
          if (label && !/^There are no/.test(text)) this.redoLabel = { label, commands: label }
          return { text, mood: 'acknowledge', suggest: label ? ['Redo'] : [] }
        }
        case 'forget': this.lastLayer = ''; this.lastResults = []; this.lastReply = null; this.lastReadIntent = ''; this.tablePage = null; this.lastAnalysis = null; this.dataTask = null; this.layerPick = null; return { text: 'Conversation context cleared. What would you like to explore?', mood: 'wave' }
        case 'diagnostics': { const d = this.diagnostics(); const n = this.misses().length; return { ...d, text: `${d.text} ${this.ctx.contact ? `A person to ask: ${this.ctx.contact.name}.` : 'No person to ask is set.'} ${n ? `${n} question${n === 1 ? '' : 's'} missed in this browser (say "what did you miss").` : 'No missed questions in this browser.'}` } }
        case 'coordinates': return this.needMap(async () => {
          const latitude = Number(it.target); const longitude = Number(it.value)
          if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { text: 'Use latitude, longitude: latitude -90 to 90 and longitude -180 to 180.', mood: 'confused' }
          await this.ctx.live.go({ center: [longitude, latitude], scale: SCALE.coordinates })
          return { text: `Centered at ${latitude}, ${longitude} (latitude, longitude).`, mood: 'acknowledge' }
        })
        case 'scale': return this.needMap(async () => {
          const scale = Number(it.value)
          if (!Number.isFinite(scale) || scale < 100 || scale > 1000000000) return { text: 'Use a scale between 1:100 and 1:1,000,000,000.', mood: 'confused' }
          await this.ctx.live.go({ scale })
          return { text: `Map scale set to 1:${scale.toLocaleString()}.`, mood: 'acknowledge' }
        })
        case 'greet': return { text: V.hello(), mood: 'wave' }
        case 'thanks': return /(?:good|great|nice|awesome|amazing) (?:job|work|one)|well done|nailed it|you did it|bravo/i.test(it.raw || input) ? { text: pick(['🏆 Thank you! I\'d like to thank my layers, my projection and you.', '🏆 Aw, a trophy moment! Right back at you.', '🏆 We did it together. Mostly you typed, I folded.']), mood: 'congratulate' } : /love|best|bff|buddy|pal|amazing|awesome|cute|hug|high five|rock|good boy|smart/i.test(it.raw || input) ? { text: V.bff(), mood: 'love' } : { text: V.thanks(), mood: rand() < 0.5 ? 'love' : 'pleased' }
        case 'whoami': return { text: V.whoami(this.ctx.name), mood: 'wave' }
        case 'help': return withAct(this.help(), 'explain')
        case 'joke': return this.ctx.fun === false ? { text: 'Jokes are turned off in this app. I am all business today.', mood: 'talk' } : { text: V.joke(), mood: 'celebrate' }
        case 'sleep': return /^(?:bye|goodbye|bye bye|see ya|see you|later)\b/i.test(input.trim()) ? { text: pick(['Bye! 🚲 Ring the bell when you need me.', 'See you! I\'ll be right here, folded and ready.', 'Later! Happy mapping.']), mood: 'goodbye' } : { text: V.sleep(), mood: 'sleep' }
        case 'tip': return this.tip() || { text: "I'm all out of tips. Ask me anything!", mood: 'happy' }
        case 'about': return this.about()
        case 'clear': this.ctx.live.clear(); this.lastResults = []; this.tablePage = null; return { text: 'Cleared.', mood: 'acknowledge' }
        case 'home': return this.needMap(async () => { await this.ctx.live.goHome(); return { text: 'Back to the starting view.', mood: 'acknowledge' } })
        case 'zoom': return this.needMap(async () => { const steps = Number(it.target) || 1; await this.ctx.live.zoom(it.value === 'out' ? 'out' : 'in', steps); return { text: `Zoomed ${it.value === 'out' ? 'out' : 'in'}${steps > 1 ? ` ${steps} steps` : steps < 1 ? ' a little' : ''}.`, mood: 'acknowledge' } })
        case 'pan': return this.needMap(async () => {
          const dir = ({ up: 'north', down: 'south', left: 'west', right: 'east' } as any)[it.value!] || it.value
          const ok = await this.ctx.live.pan(dir)
          return ok ? { text: `Moved the map ${dir}.`, mood: 'acknowledge' } : { text: 'I could not move the map right now.', mood: 'confused' }
        })
        case 'rotate': return this.needMap(async () => {
          const ok = await this.ctx.live.rotate(it.value === 'north' ? 'north' : Number(it.value))
          return ok ? { text: it.value === 'north' ? 'North is up.' : `Turned the map ${Math.abs(Number(it.value))}° ${Number(it.value) < 0 ? 'counterclockwise' : 'clockwise'}.`, mood: 'acknowledge', suggest: it.value === 'north' ? [] : ['North up'] } : { text: 'This map cannot be rotated.', mood: 'confused' }
        })
        case 'threeD': return { text: 'This is a flat (2D) map, so there is no tilt or 3D view here. I can rotate it ("rotate the map", "north up") and zoom in close.', mood: 'explain', suggest: ['Zoom in', 'Rotate the map'] }
        case 'pin': return this.needMap(async () => {
          const c = this.ctx.live.view?.center
          if (!c) return { text: 'I cannot read the map center right now.', mood: 'confused' }
          await this.ctx.live.pin(c)
          return { text: 'Pinned the middle of the map. Say "clear the pins" to remove it.', mood: 'pindrop', suggest: ['What is here?', 'Clear the pins'] }
        })
        case 'locateMe': return this.needMap(async () => {
          const at = this.ctx.myLocation ? await this.ctx.myLocation() : null
          if (!at) return { text: 'I could not get your location (it may be turned off for this site). Give me an address instead.', mood: 'confused' }
          await this.ctx.live.showPlaces(at, [], {})
          await this.ctx.live.go({ center: [at[1], at[0]], scale: SCALE.address })
          this.lastPlace = { label: 'your location', lat: at[0], lon: at[1], at: Date.now() }
          return { text: 'There you are. I put a dot on your location.', mood: 'point', pointAt: this.ctx.live.mapElement(), suggest: ['What is here?', 'Closest hydrant to me'] }
        })
        case 'atCenter': return (await this.placeQuestion("what's here", "what's here")) || this.needMap(async () => ({ text: this.ctx.live.whereAmI() || V.noMap(), mood: 'talk' }))
        case 'undoMany': {
          const n = Math.min(99, Math.max(1, Number(it.value) || 1))
          const lines: string[] = []
          for (let i = 0; i < n; i++) { const t = this.ctx.live.undo(); if (/^There are no/.test(t)) { if (!lines.length) lines.push(t); break } lines.push(t) }
          return { text: lines.join(' '), mood: 'acknowledge' }
        }
        case 'redo': return this.redoLabel ? await this.respondRead(this.redoLabel.commands) : { text: 'Nothing to redo. "Undo" first, then "redo" puts it back.', mood: 'think' }
        case 'lastAction': {
          const done = this.ctx.live.changesSoFar()
          const last = done[done.length - 1]
          const said = this.lastReply?.text ? clip(this.lastReply.text.replace(/\*\*/g, ''), 140) : ''
          if (!last && !said) return { text: 'Nothing yet. Ask me something!', mood: 'talk' }
          return { text: `${last ? `The last map change was **${last}**.` : 'No layer changes yet.'}${said ? ` My last answer was: ${said}` : ''}`, mood: 'explain', suggest: last ? ['Undo', 'What did I change'] : [] }
        }
        case 'explainLast': {
          const r = this.lastReading
          const src = this.lastReply?.sources?.map(x => x.title).filter(Boolean).slice(0, 3)
          const parts: string[] = []
          if (r?.swaps.length) parts.push(`I read "${r.input}" as "${r.read}" (${r.swaps.map(([a, b]) => `${a} → ${b}`).join(', ')}).`)
          else if (r) parts.push(`I took "${r.input}" as written${parseIntent(r.read).name !== 'ask' ? `, as a request to ${parseIntent(r.read).name.replace(/([A-Z])/g, ' $1').toLowerCase()}` : ''}.`)
          if (src?.length) parts.push(`The answer came from ${src.join(', ')}.`)
          if (!parts.length) return { text: 'Nothing to explain yet. Ask me something and then ask why.', mood: 'talk' }
          return { text: parts.join(' ') + ' If I read it wrong, retype it with the exact layer or tool name.', mood: 'explain', suggest: ['Try again', 'Help'] }
        }
        case 'shorter': {
          const last = this.lastReply
          if (!last?.text) return { text: 'Nothing to shorten yet.', mood: 'talk' }
          const first = last.text.replace(/\*\*/g, '').split(/\n+/)[0].split(/(?<=[.!?])\s+/)[0]
          return { text: first, mood: 'talk', table: undefined, list: undefined }
        }
        case 'more': {
          const last = this.lastReply
          if (last?.table || last?.list || last?.sources?.length) {
            const detail = last.sources?.map(s => `**${s.title}**: ${s.detail}`).join('\n') || ''
            return { ...last, text: `${last.text}${detail ? '\n\n' + detail : ''}`, pointAt: undefined }
          }
          return this.aboutSelected()
        }
        case 'chart': return await this.chartBy(it.target!, it.value!)
        case 'chartLast': {
          const last = this.lastReply
          if (last?.chart) return { ...last, pointAt: undefined }
          const t = last?.table
          if (!t || t.rows.length < 2) return { text: 'Ask for something with groups first, like "count parcels by zoning", and I will chart it.', mood: 'think' }
          const num = t.columns.findIndex((c, i) => i > 0 && t.rows.every(r => Number.isFinite(Number(String(r[i]).replace(/[,%]/g, '')))))
          if (num < 0) return { text: 'That table has no numbers to chart.', mood: 'think' }
          return { ...last, chart: { title: `${t.columns[num]} by ${t.columns[0]}`, rows: t.rows.slice(0, 12).map(r => ({ label: r[0], value: Number(String(r[num]).replace(/[,%]/g, '')) })) }, pointAt: undefined }
        }
        case 'mapFilter': return await this.mapFilter(it.target!, it.value!, it.scope === 'inverse')
        case 'mapUnfilter': return this.mapUnfilter(it.target)
        case 'mapFilters': {
          const f = this.ctx.live.filtered()
          if (!f.length) return { text: 'No layer is filtered right now. Say "only show parcels over 5 acres" to filter one on the map.', mood: 'talk' }
          return { text: 'Filtered on the map:', mood: 'explain', list: f.map(x => ({ label: `${x.entry.title}: ${x.said}`, action: { type: 'ask' as const, q: `clear the filter on ${x.entry.title}`, label: 'Clear' } })), suggest: ['Clear all filters'] }
        }
        case 'avgSize': {
          const e = this.ctx.live.parcelLayers()[0]
          if (!e) return { text: 'This map has no parcel layer to measure.', mood: 'confused', suggest: ['List layers'] }
          if (!this.ctx.live.canAsk(e)) return this.offReply(e)
          try { const r = await analyzeLayer(this.ctx.live, e, { kind: 'stats', layer: e.key, field: '*size*', inView: false }, this.ctx.maxResults); this.lastLayer = e.path; return r } catch (err) { return { text: err instanceof Error ? err.message : 'The layer query failed.', mood: 'confused' } }
        }
        case 'density': return this.needMap(async () => {
          const e = this.resolveLayer(it.target!)
          if (!e) return { text: V.noLayer(it.target!), mood: 'confused' }
          if (!this.ctx.live.canAsk(e)) return this.offReply(e)
          const n = await this.ctx.live.count(e, true)
          const area = this.ctx.live.viewAreaSqMiles()
          if (n === null || !area) return { text: 'I could not count them in the current view.', mood: 'confused' }
          const perSqMi = n / area
          const unit = it.value || 'square mile'
          const per = /km|kilomet/i.test(unit) ? perSqMi / 2.58999 : /acre/i.test(unit) ? perSqMi / 640 : /hectare/i.test(unit) ? perSqMi / 258.999 : perSqMi
          const unitName = /km|kilomet/i.test(unit) ? 'square kilometer' : /acre/i.test(unit) ? 'acre' : /hectare/i.test(unit) ? 'hectare' : 'square mile'
          return { text: `About **${per >= 10 ? Math.round(per).toLocaleString() : per.toFixed(2)} ${e.title.toLowerCase()} per ${unitName}** in the current view: ${n.toLocaleString()} across ${area >= 10 ? Math.round(area).toLocaleString() : area.toFixed(2)} square miles on screen.`, mood: 'explain', suggest: ['Zoom out', `How many ${e.title}`] }
        })
        case 'compareLayers': {
          const a = this.resolveLayer(it.target!, true); const b = this.resolveLayer(it.value!, true)
          if (!a || !b) return this.ask(raw, raw)
          const live = this.ctx.live
          const row = async (e: LayerEntry): Promise<string[]> => {
            const t = live.target(e); const info = live.info(e)
            let n: number | null = null; try { n = live.canSee(e) ? await live.count(e, false) : null } catch (err) { n = null }
            return [e.title, String(t?.geometryType || (e.isTable ? 'table' : '?')).replace(/^esriGeometry/, '').toLowerCase(), n === null ? (live.canSee(e) ? '?' : 'off') : n.toLocaleString(), String((info.fields || []).length), live.isVisible(e) ? 'on' : 'off']
          }
          const rows = [await row(a), await row(b)]
          return { text: `**${a.title}** and **${b.title}**, side by side:`, mood: 'explain', table: { columns: ['Layer', 'Shape', 'Features', 'Fields', 'Now'], rows }, suggest: [`Fields in ${a.title}`, `Fields in ${b.title}`] }
        }
        case 'difference': {
          const ta = lookupTerm(it.target!); const tb = lookupTerm(it.value!)
          if (ta && tb) return { text: `**${ta.term}**: ${ta.text}\n\n**${tb.term}**: ${tb.text}`, mood: 'explain' }
          const a = this.resolveLayer(it.target!, true); const b = this.resolveLayer(it.value!, true)
          if (a && b) return await this.respondOne(`compare ${a.title} and ${b.title}`)
          if (ta || tb) { const t = (ta || tb)!; return { text: `**${t.term}**: ${t.text} I do not have a meaning for "${ta ? it.value : it.target}".`, mood: 'explain' } }
          return this.ask(raw, raw)
        }
        case 'saveView': return this.saveView(it.target!)
        case 'listViews': return this.listViews()
        case 'deleteView': return this.deleteView(it.target!)
        case 'whereami': return this.needMap(async () => ({ text: this.ctx.live.whereAmI() || V.noMap(), mood: 'talk' }))
        case 'listLayers': return withAct(await this.listLayers(it.value === 'visible'), 'layers')
        case 'layerDiagnosis': return this.needMap(async () => /^(?:it|that|this|the layer|layer|that layer|this layer|my layer)$/i.test(it.target || '') ? (this.lastLayer ? this.diagnoseLayer(this.lastLayer) : this.mapBlank()) : this.diagnoseLayer(it.target!))
        case 'listTables': {
          const tables = this.ctx.live.entries().filter(e => e.isTable)
          return { text: tables.length ? 'Tables connected to this map:' : 'No standalone tables are connected. You can still browse a feature layer with "show table" followed by its name.', mood: 'talk', list: tables.map(e => ({ label: e.title, action: { type: 'ask', q: `show table ${e.key}`, label: `Open ${e.title}` } })), suggest: ['What can you do?'] }
        }
        case 'listWidgets': return this.listKind(['widget'], 'Here are the tools in this app:')
        case 'listPages': return this.listKind(['page', 'view', 'dialog'], 'Here are the pages, views and windows:')
        case 'listBookmarks': return this.listKind(['bookmark'], 'Saved places on the map:')
        case 'listBasemaps': return this.needMap(async () => {
          const all = await this.ctx.live.listBasemaps()
          if (!all.length) return { text: 'I could not read the basemap list. The Basemap Gallery tool shows them, when the app has one.', mood: 'confused', actions: this.widgetActions('basemap gallery') }
          const now = this.ctx.live.view?.map?.basemap?.title
          return { text: `${all.length} basemaps${now ? `; **${now}** is on now` : ''}. Pick one:`, mood: 'talk', list: all.slice(0, 20).map(b => ({ label: b.title, glyph: b.title === now ? '●' : '○', sr: b.title === now ? 'current' : undefined, action: { type: 'ask', q: `switch basemap to ${b.title}`, label: `Switch to ${b.title}` } })) }
        })
        case 'basemap': return this.needMap(async () => {
          const before = this.ctx.live.view?.map?.basemap
          const hit = await this.ctx.live.setBasemap(it.target || '')
          // No such basemap, but a layer by that name (an "Imagery 2024" layer): turn it on instead.
          if (!hit) { let e: LayerEntry | null = null; try { e = this.resolveLayer(it.target || '', true) } catch (err) { e = null }; if (e && !e.isGroup) return this.toggle(e.title, true, raw) }
          if (!hit) return { text: `I could not find a basemap like "${it.target}". ${this.ctx.live.view?.map?.basemap?.title ? `The background is **${this.ctx.live.view.map.basemap.title}** now.` : ''}`, mood: 'confused', actions: [{ type: 'ask', q: 'what basemaps are there', label: 'List basemaps' }, ...this.widgetActions('basemap gallery')] }
          this.undoBasemap = before
          return { text: `Background changed to **${hit.title}**.`, mood: 'acknowledge', actions: [{ type: 'ask', q: 'undo basemap', label: 'Put it back' }] }
        })
        case 'scaleInfo': return this.needMap(async () => {
          const v = this.ctx.live.view
          const scale = Number(v?.scale)
          if (!Number.isFinite(scale)) return { text: 'I cannot read the map scale right now.', mood: 'confused' }
          const inchFeet = scale / 12
          return { text: `The map is at **1:${Math.round(scale).toLocaleString()}**: one inch on screen is about ${inchFeet >= 5280 ? (inchFeet / 5280).toFixed(1) + ' miles' : Math.round(inchFeet).toLocaleString() + ' feet'} on the ground${v.zoom != null ? ` (zoom level ${Math.round(v.zoom)})` : ''}.`, mood: 'talk', suggest: ['Zoom in', 'Zoom out', 'Set scale to 1:5000'] }
        })
        case 'goBack': return this.needMap(async () => (await this.ctx.live.goBack()) ? { text: 'Back to where the map was.', mood: 'acknowledge', actions: [{ type: 'ask', q: 'go back', label: 'Back again' }] } : { text: 'The map has not moved yet, so there is nowhere to go back to.', mood: 'think', suggest: ['Go to the starting view'] })
        case 'resetMap': return this.needMap(async () => {
          this.ctx.live.clear(); this.lastResults = []; this.tablePage = null
          try { this.ctx.live.view?.closePopup?.() } catch (e) { }
          await this.ctx.live.goHome()
          if (this.undoBasemap) { try { this.ctx.live.view.map.basemap = this.undoBasemap } catch (e) { } this.undoBasemap = null }
          return { text: 'Map reset: back to the starting view, highlights cleared. Layers are as they were; say "undo layers" or "turn everything off" to change them.', mood: 'trash' }
        })
        case 'values': return this.values(it.target!, raw)
        case 'listLinks': return this.listKind(['link'], 'Links in this app:')
        case 'listPresets': return this.listPresets()
        case 'preset': return this.applyPreset(it.target!)
        case 'favorites': return this.favorites()
        case 'openLayerList': return this.openLayerList()
        case 'allOff': return this.needMap(async () => this.allOff())
        case 'allOn': return this.needMap(async () => this.allOn(it.value === 'force'))
        case 'solo': return this.needMap(async () => this.solo(it.target!))
        case 'reveal': return this.needMap(async () => this.revealByName(it.target!))
        case 'layerOn': case 'layerOff': if (/^(?:the\s+)?labels?$/i.test(it.target || '')) return this.needMap(async () => this.labels(undefined, it.name === 'layerOn')); return this.toggle(it.target!, it.name === 'layerOn', raw)
        case 'opacity': return this.opacity(it.target!, Number(it.value))
        case 'opacityStep': {
          const e = this.resolveLayer(it.target!)
          if (!e) return { text: V.noLayer(it.target!), mood: 'confused' }
          const now = Math.round(Number(this.ctx.live.target(e)?.opacity ?? 1) * 100)
          const next = Math.max(10, Math.min(100, now + (it.value === 'lighter' ? -25 : 25)))
          if (next === now) return { text: `${e.title} is already as ${it.value === 'lighter' ? 'light' : 'solid'} as it goes (${now}%).`, mood: 'talk' }
          this.ctx.live.setOpacity(e, next)
          return { text: `${e.title} is ${it.value === 'lighter' ? 'lighter' : 'stronger'} now: ${next}% opacity.`, mood: 'acknowledge', suggest: [it.value === 'lighter' ? `Make ${e.title} lighter` : `Make ${e.title} darker`, `Set ${e.title} opacity to 100%`] }
        }
        case 'hasLayer': return this.hasLayer(it.target!, raw)
        case 'styleAsk': {
          const e = it.target ? this.resolveLayer(it.target, true) : null
          const name = e ? `**${e.title}**` : 'a layer'
          return { text: `Colors, sizes and symbols are set by whoever made the map, so I cannot change how ${name} draws. I can make it lighter or stronger, turn its labels on, show only that layer, or zoom to it.`, mood: 'explain', suggest: e ? [`Make ${e.title} lighter`, `Label ${e.title}`, `Show only ${e.title}`] : ['What layers are on?'] }
        }
        case 'whichLayer': {
          const sel = this.ctx.live.selectedFeature()
          if (sel?.title) { const e = this.ctx.live.find(sel.title); if (e) this.lastLayer = e.path; return { text: `That is from **${sel.title}**.`, mood: 'explain', suggest: ['What did I click', `Fields in ${sel.title}`, `Turn off ${sel.title}`] } }
          if (this.lastLayer) { const e = this.ctx.live.find(this.lastLayer); if (e) return { text: `We were just working with **${e.title}**. Click a feature on the map and ask again to know what a drawing belongs to.`, mood: 'talk', suggest: [`Fields in ${e.title}`, 'What layers are on?'] } }
          const r = this.listLayers(true); return { ...r, text: 'Click a feature on the map and ask again to know which layer it belongs to. Right now these layers are on:' }
        }
        case 'frustrated': return { text: `Sorry, that is no fun. Tell me what you are trying to do in your own words, like "find an address", "turn on a layer" or "print the map", and I will take it from there. "Show me around" walks through everything this app can do.`, mood: 'explain', suggest: ['Show me around', 'Help', 'What is on the map'] }
        case 'topOwners': return await this.topOwners(it.value === 'count')
        case 'today': return this.today()
        case 'placeStats': return this.placeStats(it.value || '', raw)
        case 'download': return this.download(it.target!)
        case 'fields': return this.fields(it.target!, raw)
        case 'count': return this.count(it.target!, it.scope === 'view', raw)
        case 'find': return await this.find(it.target!, it.scope, raw)
        case 'close': return await this.close(it.target!, raw)
        case 'goto': return await this.goto(it.target!, raw)
        case 'showLayer': { const r = await this.showLayer(it.target!); return r || this.find(it.target!, undefined, raw) }
        case 'listFeatures': { const r = await this.listFeatures(it.target!); return r || this.ask(raw, raw) }
        case 'mapBlank': return this.needMap(async () => this.mapBlank())
        case 'labels': return this.needMap(async () => this.labels(it.target, it.value === 'on'))
        case 'dataInfo': return this.dataInfo(it.target!)
        case 'cancel': {
          const had = !!(this.awaitingPlace || this.mcpDraft || this.mcpPending || this.layerPick || this.layerChoices || this.addressChoices)
          this.awaitingPlace = null; this.mcpDraft = null; this.mcpPending = null; this.layerPick = null; this.layerChoices = null; this.addressChoices = null
          return { text: had ? 'Okay, never mind that.' : pick(['Okay.', 'No problem.', 'Sure thing.']), mood: 'acknowledge' }
        }
        case 'ack': return { text: pick(['Okay!', 'Got it.', '👍', 'Right on.', 'Sure thing.']), mood: 'pleased', suggest: this.suggestions().slice(0, 3) }
        case 'tour': return this.startTour()
        case 'tourNext': return this.tour ? this.tourStep() : (this.lastReply ? { ...this.lastReply, pointAt: undefined } : { text: 'Say "show me around" and I will walk you through the app.', mood: 'talk', suggest: ['Show me around'] })
        case 'tourStop': { if (!this.tour) return { text: pick(['Okay.', 'Sure thing.']), mood: 'acknowledge' }; this.tour = null; return { text: 'Tour over. Ask me about any of those tools whenever you like.', mood: 'wave', pointAt: null } }
        case 'tryAgain': {
          if (!this.lastInput) return { text: 'Nothing to run again yet. Ask me something first.', mood: 'think' }
          const again = await this.respondInner(this.lastInput)
          return again.text.startsWith('(Again) ') ? again : { ...again, text: `(Again: ${clip(this.lastInput, 60)})\n\n${again.text}` }
        }
        case 'changes': {
          const done = this.ctx.live.changesSoFar()
          if (!done.length) return { text: 'I have not changed any layers on this map yet.', mood: 'talk', suggest: ['List layers'] }
          return { text: `What I changed on this map, oldest first (${done.length}):`, mood: 'explain', list: done.map((label, i) => ({ label: `${i + 1}. ${label}` })), suggest: ['Undo', 'Reset the map'] }
        }
        case 'clicked': return this.aboutSelected()
        case 'mapSummary': return this.mapSummary()
        case 'copyAnswer': return this.lastReply ? { text: 'Copied my last answer.', mood: 'acknowledge', effect: 'copy' } : { text: 'Nothing to copy yet.', mood: 'think' }
        case 'fewerTips': return { text: 'Okay, no more tips from me unless you ask. Say "tip" any time you want one, and I am here when you need me.', mood: 'acknowledge', effect: 'quietTips' }
        case 'exportChat': return { text: 'Saving this conversation as a text file.', mood: 'save', effect: 'export' }
        case 'repeat': return this.lastReply ? { ...this.lastReply, pointAt: undefined } : { text: 'I have not said anything yet. Ask me something!', mood: 'think' }
        case 'speak': { const last = this.lastReply; return last ? { ...last, text: `Reading that aloud: ${last.text.replace(/\*\*/g, '')}`, mood: 'talk', effect: 'speak', pointAt: undefined } : { text: 'Nothing to read yet.', mood: 'think' } }
        case 'resize': return { text: it.value === 'smaller' ? 'Shrinking!' : 'Growing!', mood: 'excited', effect: it.value === 'smaller' ? 'smaller' : 'bigger' }
        case 'moveCorner': return { text: 'Scooting over.', mood: 'acknowledge', effect: it.value === 'left' ? 'left' : it.value === 'right' ? 'right' : 'otherCorner' }
        case 'pause': return it.value === 'on' ? { text: 'Holding still. Say "animate again" when you want me moving.', mood: 'acknowledge', effect: 'pause' } : { text: 'Wheee, I can move again!', mood: 'excited', effect: 'resume' }
        case 'open': return withAct(await this.open(it.target!, raw), it.target === 'print' ? 'print' : it.target === 'share' ? 'mail' : /measure/i.test(it.target || '') ? 'measure' : null)
        case 'howto': {
          const t = it.target || ''
          if (/^(?:turn (?:on|off)|show|hide|toggle|enable|disable|add|remove)\s+(?:a|the|some|any)?\s*layers?(?: on| off)?$|^(?:use|work|see) (?:the )?layers?(?: list)?$/i.test(t)) {
            const on = this.ctx.live.ready ? this.ctx.live.entries().filter(e => !e.isGroup && !e.isTable).length : 0
            return { text: `Just tell me: "turn on parcels", "hide hydrants", "show only zoning", "turn on parcels and hydrants". Say "list layers" to see the ${on ? on + ' ' : ''}layers in this map, or open the layer list and use its check boxes.`, mood: 'explain', suggest: ['List layers', 'What layers are on?'], actions: this.layerListAction() }
          }
          return this.ask(t, raw)
        }
        default: return this.ask(raw, raw)
      }
    } catch (e) {
      if (e instanceof LayerChoice) {
        this.lastResults = []; this.addressChoices = null
        const entries = e.entries.slice(0, 8)
        const sequence = ++this.choiceSequence
        this.layerChoices = { sequence, view: this.ctx.live.view, query: e.query, command: raw, entries }
        return { text: `More than one layer matches "${e.query}". Choose a row, say “the second one”, or enter its full path. Say “cancel” to stop.${e.entries.length > 8 ? ' Showing the first eight matches; use a full layer path to narrow the request.' : ''}`, mood: 'think', list: entries.map((entry, index) => ({ label: `${index + 1}. ${entry.path}`, action: { type: 'ask', label: entry.path, q: `__layerchoice:${sequence}:${index}` } })) }
      }
      this.ctx.beacon?.error(e, it.name)
      return { text: 'Oops, I tripped over a fold. Try that again?', mood: 'confused' }
    }
  }

  private async needMap (fn: () => Promise<Reply>): Promise<Reply> {
    if (!this.ctx.live.ready) return { text: V.noMap(), mood: 'confused' }
    return fn()
  }

  private async chooseLayer (sequence: number, index: number): Promise<Reply> {
    const pending = this.layerChoices
    const selected = pending?.entries[index]
    if (!pending || pending.sequence !== sequence || pending.view !== this.ctx.live.view || !selected) return { text: 'That layer choice is unavailable. Choose a listed number or ask the original question again.', mood: 'confused' }
    const current = this.ctx.live.entries().find(e => e.key === selected.key && this.ctx.live.target(e) === this.ctx.live.target(selected))
    if (!current) { this.layerChoices = null; return { text: 'That layer is no longer in the map. Ask again using the current layers.', mood: 'confused' } }
    this.layerChoices = null
    this.chosenLayer = { query: pending.query, entry: current }
    try { return await this.respond(pending.command) } finally { this.chosenLayer = null }
  }

  async locateAddress (address: string, base = address): Promise<Reply> {
    if (!this.ctx.featureSearch) return { text: 'Data and address searches are disabled by the app author.', mood: 'confused' }
    const view = this.ctx.live.view
    if (!view) return { text: 'Connect a map before searching for an address.', mood: 'confused' }
    if (!this.ctx.geocoders?.length) return { text: 'No address locator is configured for this app. Add a locator to Search or the app utilities; I will use it automatically. You can still search address fields with “find 123 Main St in parcels”.', mood: 'confused' }
    this.lastAddress = base
    this.lastLayer = ''; this.lastResults = []; this.lastReadIntent = ''; this.lastAnalysis = null; this.tablePage = null
    try {
      const found = await geocodeAddress(address, this.ctx.geocoders, view)
      if (view !== this.ctx.live.view) return { text: 'The map changed during address lookup. Please search again on this map.', mood: 'confused' }
      if (!found.results.length) return { text: found.failed ? 'The configured address locators could not complete this search. Check their availability or sign-in and try again.' : `No address matched “${address}”. Try adding a city, state or postal code.`, mood: 'confused' }
      this.addressChoices = { sequence: ++this.addressSequence, view, results: found.results }
      if (found.results.length === 1 && found.results[0].score >= 95) return this.chooseAddress(this.addressSequence, 0)
      return { text: found.results.length === 1 ? 'I found one possible match, and it is not an exact one. Choose it if it looks right.' : `I found ${found.results.length} possible address matches. Choose one, or say “show the first result”. Locator scores describe match quality, not guaranteed accuracy.`, mood: 'talk',
        list: found.results.map((r, i) => ({ label: `${i + 1}. ${r.label}`, detail: `${r.source} · match score ${r.score}`, action: { type: 'ask', label: r.label, q: `__address:${this.addressSequence}:${i}` } })),
        sources: Array.from(new Set(found.results.map(r => r.source))).map(title => ({ title, detail: 'Live configured ArcGIS address locator' })) }
    } catch (e) { return { text: 'Address lookup is unavailable. Check the configured locator and your sign-in, then try again.', mood: 'confused' } }
  }

  private async chooseAddress (sequence: number, index: number): Promise<Reply> {
    const choice = this.addressChoices
    const result = choice?.results[index]
    if (!choice || choice.sequence !== sequence || choice.view !== this.ctx.live.view || !result || !this.ctx.featureSearch) return { text: 'That address result is no longer available. Search for the address again.', mood: 'confused' }
    const shown = await this.ctx.live.showAddress(result.location)
    if (shown) {
      choice.selected = index
      const ll = result.latLon || this.toLatLon(result.location)
      if (ll) this.lastPlace = { label: niceAddress(String(result.label || '').split(',')[0]), lat: ll[0], lon: ll[1], at: Date.now() }
    }
    const parcel = shown ? await this.parcelUnder(result.location, String(result.label || '').split(',')[0]) : ''
    const reply: Reply = { text: shown ? `Showing **${result.label}**.${parcel ? `\n\n${parcel}` : ''}\n\nLocator match score: ${result.score}.` : 'I found the address but could not move the map. Try the search again.', mood: shown ? 'pleased' : 'confused', sources: [{ title: result.source, detail: 'Live ArcGIS address candidate' }] }
    if (shown) reply.suggest = ['Who owns it?', 'What zoning is this in?', 'Is it in city limits?']
    this.lastReply = reply
    return reply
  }

  help (): Reply {
    const hasMap = this.ctx.live.ready
    return {
      text: `I use ${this.ctx.appTitle}'s tools, help and map metadata to answer locally.${this.ctx.serverAssistant ? ` When I am stuck, ${this.ctx.serverAssistant.label} answers here with the GIS data.` : ' No AI account or model needed.'} Ask about the data in plain words (“how many parcels are zoned R-4”, “most expensive parcel”, “who owns it”). Join up to five commands with "then"; follow up with "zoom to it" or "how many in view". Say "undo" to reverse my layer visibility and opacity changes.`,
      mood: 'wave',
      list: [
        ...(this.ctx.serverAssistant ? [{ label: `Ask ${this.ctx.serverAssistant.label}`, detail: `Harder questions go to ${this.ctx.serverAssistant.label}, who answers here with the GIS data · ask ${this.ctx.serverAssistant.label} which zones have the most parcels` }] : this.ctx.assistant ? [{ label: `Ask ${this.ctx.assistant.label}`, detail: `What I cannot answer opens in ${this.ctx.assistant.label} with your question written · ask ${this.ctx.assistant.label} ...` }] : []),
        { label: 'Get questions for my data', detail: 'Choose a layer and get questions based on its actual fields.', action: { type: 'ask', q: 'Explore data' } },
        { label: 'Take the tour', detail: 'Show me around · next · stop tour', action: { type: 'ask', q: 'Show me around' } },
        { label: 'Explore the app', detail: 'List tools · open print · list pages · list bookmarks', action: { type: 'ask', q: 'List tools' } },
        { label: 'Control layers', detail: 'Turn on parcels · only show zoning · set parcels opacity to 50%', action: { type: 'ask', q: 'List layers' } },
        { label: 'Ask about the data', detail: 'How many parcels are zoned R-4 · most expensive parcel · average acres by zoning · hydrants installed before 1990 · then: who owns it · which ones are over 5 acres · only show them on the map' },
        { label: 'Find and count', detail: 'Find Smith in parcels · count parcels in view' },
        { label: 'Analyze fields', detail: 'Summarize acres in parcels · count parcels by zoning' },
        { label: 'Browse table rows', detail: 'List tables · show table parcels · next page', action: { type: 'ask', q: 'List tables' } },
        ...(this.ctx.fun === false ? [] : [{ label: 'Have some fun', detail: 'Jokes · riddles · fun facts · get wizardy · paper airplane · what are you wearing · what tricks can you do', action: { type: 'ask' as const, q: 'What tricks can you do?' } }]),
        { label: 'Search by condition', detail: 'Parcels bigger than 5 acres · parcels edited in the last 7 days · what percent of parcels are over 5 acres · average acres by zoning in parcels' },
        { label: 'Ask what things mean', detail: 'What is an easement · what does R-4 mean · what zoning types are there', action: { type: 'ask', q: 'What is a parcel?' } },
        { label: 'Move around', detail: 'Zoom in twice · pan left · north up · save this view as home base · go back · satellite view · drop a pin here' },
        { label: 'Filter the map', detail: 'Only show parcels over 5 acres · hide hydrants installed before 1990 · clear the filter · chart parcels by zoning' },
        ...(this.ctx.mcp || this.ctx.live.parcelLayers().length ? [{ label: 'Ask about a place', detail: 'Who owns 250 N 5th St · what zone is it in · when is trash pickup · closest hydrant · how far is it from City Hall', action: { type: 'ask' as const, q: 'Tell me about my address' } }] : []),
        { label: 'Look back', detail: "What's on the map · what did I change · undo · try again · what did I click (with a popup open) · copy that · export chat", action: { type: 'ask', q: 'What did I change' } },
        ...(this.ctx.fun === false ? [] : [{ label: 'The two of us', detail: 'My stamps · write me a postcard · how close are we · the usual · our story · call me Sam · can I call you Pip · my birthday is March 3 · see you tomorrow', action: { type: 'ask' as const, q: 'My stamps' } }]),
        { label: 'People and privacy', detail: `${this.ctx.contact ? 'Talk to a person · ' : ''}what do you know about me · forget everything · what did you miss`, action: { type: 'ask', q: this.ctx.contact ? 'Talk to a person' : 'What do you know about me?' } },
        { label: 'Check what I know', detail: 'Live map connection and knowledge sources', action: { type: 'ask', q: 'diagnostics' } }
      ],
      suggest: [
        'What tools are there?',
        hasMap ? 'What layers are on?' : 'What pages are there?',
        hasMap ? 'Turn on parcels' : 'How do I print?',
        hasMap ? 'Find Main St' : 'Who do I contact?',
        'Tell me a joke'
      ]
    }
  }

  suggestions (): string[] {
    const entries = this.ctx.live.entries()
    const layer = entries.find(e => !e.isGroup && !e.isTable && this.ctx.live.isVisible(e))
    const table = entries.find(e => e.isTable) || layer
    // With a GIS server (or parcels in the map), lead with a place question: it is what people ask most.
    const place = this.ctx.mcp && this.ctx.mcp.fallback !== false ? [this.myAddress ? 'Tell me about my address' : 'Who owns this?'] : this.ctx.live.parcelLayers().length ? ['Who owns this?'] : []
    return [...place, 'What can you do?', 'Explore data', ...(entries.length ? ['List layers'] : ['What tools are there?']), ...(table ? [`Show table ${table.title}`] : []), ...(layer ? [`Count ${layer.title} in view`] : ['What is this app?'])].slice(0, 5)
  }

  async exploreData (target?: string): Promise<Reply> {
    const live = this.ctx.live
    if (!live.ready) return { text: 'Connect a map to explore its layers and tables.', mood: 'confused' }
    if (!target) {
      const entries = live.entries().filter(e => !e.isGroup && live.canSee(e))
      return { text: entries.length ? 'Pick a layer or table. I’ll suggest questions from its actual fields—without querying records until you choose one.' + (entries.length > 20 ? ` Showing 20 of ${entries.length}; you can also say “explore” followed by an exact layer name.` : '') : 'Turn on a layer first, then ask “explore data”.', mood: 'talk',
        list: entries.slice(0, 20).map(e => ({ label: e.path, detail: e.isTable ? 'Table' : 'Map layer', action: { type: 'ask', q: `explore ${e.key}`, label: e.title } })), suggest: ['List layers'] }
    }
    const e = this.resolveLayer(target)
    if (!e) return { text: `I cannot identify “${target}”. Choose a layer from Explore data.`, mood: 'confused', suggest: ['Explore data'] }
    if (e.isGroup) return this.fields(target, target)
    if (!live.canAsk(e)) return this.offReply(e)
    this.lastLayer = e.path
    if (!this.ctx.featureSearch) return { text: `Data queries are disabled by the app author. You can still inspect **${e.title}**’s fields.`, mood: 'talk', actions: [{ type: 'ask', q: `fields in ${e.key}`, label: 'Describe fields' }] }
    const view = live.view
    const layer = live.target(e)
    try { if (layer.load && !layer.loaded) await withTimeout(layer.load(), 8000) } catch (error) { return { text: 'I could not load this layer’s metadata. Try again when its service is available.', mood: 'confused' } }
    if (view !== live.view) return { text: 'The map changed. Choose a layer on the current map.', mood: 'confused' }
    if (typeof layer.queryFeatures !== 'function') return { text: 'This layer does not support record queries. Try a feature layer or table.', mood: 'confused', suggest: ['Explore data'] }
    const ideas = dataIdeas(e.key, Array.from(layer.fields || []), { table: e.isTable, statistics: layer.capabilities?.query?.supportsStatistics, order: layer.capabilities?.query?.supportsOrderBy })
    return { text: `Here are questions for **${e.title}**, built from its actual field names and coded values. Choose one to run it.`, mood: 'wave', list: ideas.map(idea => ({ label: idea.label, detail: idea.detail, action: { type: 'ask', q: idea.query, label: idea.label } })), sources: [{ title: e.path, detail: 'Layer field metadata and query capabilities; no records queried' }] }
  }

  diagnostics (): Reply {
    const entries = this.ctx.live.entries()
    const sources = new Map<string, number>()
    for (const doc of this.ctx.index.docs) sources.set(doc.src || 'live', (sources.get(doc.src || 'live') || 0) + 1)
    return { text: `Local assistant ready. ${this.ctx.live.ready ? 'Map connected.' : 'No active map connected.'} ${entries.filter(e => !e.isGroup).length} layers and tables; ${entries.filter(e => !e.isGroup && this.ctx.live.isVisible(e)).length} enabled. ${this.ctx.featureSearch ? 'Data queries enabled.' : 'Data queries disabled.'} ${this.ctx.serverAssistant ? `No LLM runs in this app; questions I cannot answer go to ${this.ctx.serverAssistant.label} on ${this.ctx.mcp?.label || 'the GIS server'}, which answers with the GIS data.` : this.ctx.assistant ? `No LLM runs in this app; questions I cannot answer can be opened in ${this.ctx.assistant.label} (a new tab, one click).` : this.ctx.mcp ? `No LLM is used; ${this.ctx.mcp.label} answers place questions.` : 'No LLM is used.'} Map services and imported help may still require network access.${this.ctx.feedInfo ? ' Knowledge ' + this.ctx.feedInfo + '.' : ''}`, mood: 'talk', table: { columns: ['Knowledge source', 'Documents'], rows: Array.from(sources, ([source, count]) => [source, count.toLocaleString()]) }, suggest: ['What can you do?', 'List layers', 'List tools'] }
  }

  diagnoseLayer (target: string): Reply {
    const e = this.resolveLayer(target)
    if (!e) return { text: `I cannot identify a layer called "${target}".`, mood: 'confused', suggest: ['List layers'] }
    this.lastLayer = e.path
    const live = this.ctx.live
    const layer = live.target(e)
    const reasons: string[] = []
    const actions: MappyAction[] = []
    if (!live.isOn(e)) reasons.push('The layer is turned off.')
    const parent = live.hiddenBy(e)
    if (parent) reasons.push(`Its parent group "${parent}" is turned off.`)
    if (!live.isVisible(e)) actions.push({ type: 'layerOn', id: e.key, label: 'Turn on and reveal' })
    if (live.outOfScale(e)) { reasons.push('The current scale is outside its display range.'); actions.push({ type: 'fitScale', id: e.key, label: 'Zoom to display scale' }) }
    if ([...e.ancestors, layer].some(item => item?.opacity === 0)) reasons.push('The layer or one of its parent groups has zero opacity.')
    if (layer?.loadStatus === 'failed' || layer?.loadError) reasons.push('The layer failed to load. Its service or sign-in may need attention.')
    if (e.isTable) reasons.push('This is a standalone table; it has records but no geometry to draw.')
    if (layer?.definitionExpression) reasons.push('An authored definition filter restricts which records are included.')
    if (!reasons.length) reasons.push('It is enabled and within its display scale. Its features may be outside the current extent, or its service may still be loading.')
    if (!e.isTable) actions.push({ type: 'zoomLayer', id: e.key, label: 'Zoom to layer extent' })
    actions.push({ type: 'ask', q: `show table ${e.key}`, label: 'Inspect records' })
    return { text: `**${e.title}**\n\n${reasons.join('\n')}`, mood: 'talk', actions: actions.slice(0, 4), sources: [{ title: e.path, detail: 'Current map visibility, scale, opacity and load state' }] }
  }

  /** "Is there a sewer layer", "do you have zoning": yes with its state and a button, or the closest names. */
  private hasLayer (target: string, raw: string): Reply {
    const live = this.ctx.live
    const t = target.replace(/\s+(?:layer|layers|data|map)$/i, '').trim()
    if (!t) return this.help()
    const e = this.resolveLayer(t, true)
    if (e) {
      const on = live.isVisible(e)
      this.lastLayer = e.path
      return {
        text: `Yes: **${e.title}** is in this map${e.isGroup ? ' (a group)' : ''}, and it is ${on ? 'on' : 'off'} right now.`,
        mood: 'pleased',
        actions: on ? [{ type: 'ask', q: `zoom to ${e.title}`, label: 'Zoom to it' }] : [{ type: 'ask', q: `turn on ${e.title}`, label: 'Turn it on' }],
        suggest: [`What's in ${e.title}?`, `How many ${e.title}?`]
      }
    }
    // A tool, page or bookmark by that name counts too.
    const doc = this.ctx.index.resolve(t, ['widget', 'page', 'view', 'dialog', 'bookmark'], 2)
    if (doc) return { text: `Yes: **${doc.title}** is ${doc.kind === 'widget' ? 'a tool' : doc.kind === 'bookmark' ? 'a saved place' : 'a ' + doc.kind} in this app.`, mood: 'pleased', actions: doc.actions?.slice(0, 2) }
    const near = live.entries().filter(e => !e.isGroup).map(e => e.title).filter(n => n.toLowerCase().split(/\W+/).some(w => w.length > 3 && t.toLowerCase().includes(w))).slice(0, 4)
    return { text: `No layer called "${t}" here.${near.length ? ` Close: ${near.map(n => `**${n}**`).join(', ')}.` : ''} Say "list layers" for the whole set.`, mood: 'think', suggest: ['List layers', ...near.slice(0, 2).map(n => `Turn on ${n}`)] }
  }

  /** "Who owns the most land": acres (or parcel count) by owner on the parcel layer. */
  private async topOwners (byCount: boolean): Promise<Reply> {
    const live = this.ctx.live
    const e = live.parcelLayers()[0]
    if (!e) return { text: 'This map has no parcel layer to add up owners from.', mood: 'confused', suggest: ['List layers'] }
    if (!live.canAsk(e)) return this.offReply(e)
    const owner = (live.info(e).fields || []).find(f => /owner|taxpayer/i.test(`${f.name} ${f.alias || ''}`) && !/addr|city|state|zip|type/i.test(`${f.name} ${f.alias || ''}`) && !/id$/i.test(`${f.name} ${f.alias || ''}`))
    if (!owner) return { text: `**${e.title}** has no owner field I can group by.`, mood: 'confused', suggest: [`Fields in ${e.title}`] }
    const request: AnalysisRequest = byCount ? { kind: 'group', layer: e.key, field: owner.name, inView: false, limit: 10, order: 'desc' } : { kind: 'group', layer: e.key, field: owner.name, inView: false, stat: 'sum', valueField: '*size*' }
    try {
      const reply = await analyzeLayer(live, e, request, this.ctx.maxResults)
      this.lastLayer = e.path
      if (reply.table) reply.table.rows = reply.table.rows.slice(0, 10)
      return reply
    } catch (error) { return { text: error instanceof Error ? error.message : 'The layer query failed.', mood: 'confused' } }
  }

  /**
   * "Census facts", "what's the population", "median home value", "how much snow do we get":
   * the place's numbers from the facts the builder saved (Census, Wikidata, Open-Meteo, USGS...).
   */
  private placeStats (topic: string, raw: string): Reply {
    const facts = (this.ctx.place?.facts || []).filter(Boolean)
    const name = this.ctx.place?.name || 'this place'
    const t = topic.toLowerCase()
    const want: Array<[RegExp, RegExp]> = [
      [/census|demographic|stats|numbers/, /\(US Census|population|median|households|commute/i],
      [/population|people live/, /population/i],
      [/median age|how old/, /median age|founded/i],
      [/home (?:value|price)/, /home value/i],
      [/household/, /households/i],
      [/commute/, /commute/i],
      [/elevation|how high/, /above sea level/i],
      [/climate|weather|hot|cold/, /\(Open-Meteo\)/i],
      [/rain/, /precipitation|rain/i],
      [/snow/, /snow/i],
      [/founded/, /founded/i],
      [/how big/, /square miles|covers/i]
    ]
    const rule = want.find(([k]) => k.test(t)) || want[0]
    // Census lines first when asked about the Census, otherwise any source that answers.
    let hits = facts.filter(f => rule[1].test(f))
    if (/census/.test(t)) hits = hits.filter(f => /Census/i.test(f)).concat(hits.filter(f => !/Census/i.test(f)))
    if (!hits.length) {
      const how = /census|population|median|household|commute|demographic/.test(t)
        ? 'The app builder can add them in Mappy\'s settings: Your place, check US Census, add a free Census API key, then Build facts from open sources.'
        : 'The app builder can add them in Mappy\'s settings: Your place, Build facts from open sources.'
      return { text: `I do not have numbers like that for ${name} yet. ${how}`, mood: 'think', suggest: ['Fun fact', 'What is on the map'] }
    }
    const shown = hits.slice(0, 6)
    return {
      text: shown.length === 1 ? `📍 ${shown[0]}` : `📍 ${name} in numbers:`,
      mood: 'explain',
      list: shown.length > 1 ? shown.map(f => ({ label: f })) : undefined,
      suggest: ['Population', 'Climate', 'Local fact'].filter(x => !new RegExp(x, 'i').test(raw)).slice(0, 3)
    }
  }

  /** "What day is it": the date, with the day's outfit when there is one. */
  private today (): Reply {
    const d = new Date()
    const text = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const day = this.ctx.fun === false ? '' : todayLine()
    return { text: `It is ${text}, ${time}.${day ? ' ' + day : ''}`, mood: 'talk' }
  }

  /** "Can I download parcels": the Table widget's export, or the layer's service page. */
  private download (target: string): Reply {
    const t = target.replace(/\s+(?:data|layer|map)$/i, '').trim()
    const e = t && !/^(?:this|the map|it|everything|data|the data)$/i.test(t) ? this.resolveLayer(t, true) : null
    const table = this.ctx.index.docs.find(d => d.kind === 'widget' && /^table$/i.test(d.title))
    const url = e ? live_url(this.ctx.live, e) : ''
    const lines: string[] = []
    if (e && table && this.ctx.openInTable) lines.push(`Open **${e.title}** in the Table and use its export (the menu in the table's corner) to save a CSV.`)
    else if (e && table) lines.push(`Open **${e.title}** in the **Table** tool; its menu can export rows to CSV.`)
    else if (e) lines.push(`This app has no table tool to export from.`)
    else lines.push('Say which layer, for example "download parcels".')
    if (url) lines.push(`The layer's service page is ${url}; a GIS user can also open that in ArcGIS Pro.`)
    const org = this.org()
    if (e) lines.push(`For a full download or a shapefile, ask ${org}'s GIS team${this.ctx.place?.website ? ` (${this.ctx.place.website})` : ''}.`)
    return { text: lines.join(' '), mood: 'explain', actions: e && this.ctx.openInTable ? [{ type: 'ask', q: `show table ${e.key}`, label: 'Open in the table' }] : undefined, suggest: e ? [] : ['List layers'] }
  }

  about (): Reply {
    const d = this.ctx.index.getById('app')
    const tools = this.ctx.index.docs.filter(x => x.kind === 'widget').map(x => x.title)
    return {
      text: `${d ? describeDoc(d).replace(/^\*\*(.+?)\*\* \(app\)\./, '**$1**.') : this.ctx.appTitle} It has ${tools.length} tool${tools.length === 1 ? '' : 's'}${tools.length ? ': ' + clip(tools.slice(0, 12).join(', '), 260) : ''}.`,
      mood: 'talk'
    }
  }

  tip (): Reply | null {
    const pool = this.ctx.index.docs.filter(d => (d.kind === 'widget' || d.kind === 'faq' || d.kind === 'guide' || d.kind === 'doc' || d.kind === 'layer') && d.text && d.text.length > 20)
    if (!pool.length) return null
    const d = pick(pool)
    return { text: `${V.tipLead()} ${describeDoc(d)}`, actions: d.actions?.slice(0, 2), mood: 'idea' }
  }

  /** "Show me around": the app's tools one at a time, pointing at each one that is on screen. */
  startTour (): Reply {
    const stops = this.ctx.index.docs.filter(d => d.kind === 'widget' && d.title && !/^mappy$/i.test(d.title))
    if (!stops.length) return { text: 'There are no other tools in this app to show you, so this is the whole tour: the map, and me.', mood: 'wave' }
    this.tour = { stops, at: -1 }
    const first = this.tourStep()
    return { ...first, text: `This app has ${stops.length} tool${stops.length === 1 ? '' : 's'}. I will point at each one; say "next" to move on or "stop tour" to end.\n\n${first.text}` }
  }

  private tourStep (): Reply {
    const t = this.tour
    if (!t) return { text: 'No tour running.', mood: 'talk' }
    t.at++
    if (t.at >= t.stops.length) {
      this.tour = null
      return { text: 'That is everything. Ask me how to use any of them, or say "list widgets" to see the whole set again.', mood: 'celebrate', pointAt: null, suggest: ['List widgets', 'Help'] }
    }
    const d = t.stops[t.at]
    const ids = d.actions?.[0]?.ids || []
    let el: HTMLElement | null = null
    try { el = ids.length ? widgetEl(bestWidgetId(ids, this.ctx.model)) : null; if (el) pulse(el) } catch (e) { }
    const sentence = clip(String(d.text || '').split(/(?<=[.!?])\s+/)[0] || '', 180)
    const where = d.where ? ` It lives ${d.where}.` : ''
    const last = t.at === t.stops.length - 1
    return {
      text: `**${d.title}** (${t.at + 1} of ${t.stops.length}).${sentence ? ' ' + sentence : ''}${where}`,
      mood: el ? 'point' : 'explain',
      pointAt: el,
      actions: d.actions?.slice(0, 1),
      suggest: last ? ['Finish tour', 'Stop tour'] : ['Next', 'Stop tour']
    }
  }

  /** "What's on the map": the layers drawing, the basemap, the scale and the center, in one answer. */
  private mapSummary (): Reply {
    const live = this.ctx.live
    if (!live.ready) return { text: V.noMap(), mood: 'confused' }
    const all = live.entries().filter(e => !e.isTable && !e.isGroup)
    const on = all.filter(e => live.isVisible(e))
    const off = all.length - on.length
    const names = on.slice(0, 12).map(e => `**${e.title}**`).join(', ') + (on.length > 12 ? ` and ${on.length - 12} more` : '')
    const base = live.basemapTitle()
    const sel = live.selectedFeature()
    const lines = [
      on.length ? `${on.length} of ${all.length} layers are drawing: ${names}.` : `None of the ${all.length} layers are turned on.`,
      base ? `Basemap: **${base}**.` : '',
      live.whereAmI(),
      sel ? `A **${sel.title}** popup is open (ask "what did I click").` : ''
    ].filter(Boolean)
    const changes = live.changesSoFar().length
    return {
      text: lines.join(' ') + (changes ? ` I have made ${changes} layer change${changes === 1 ? '' : 's'} this session.` : ''),
      mood: 'explain',
      suggest: [off ? 'List layers' : 'Show me around', changes ? 'What did I change' : 'Tip', 'What is the scale'].slice(0, 3)
    }
  }

  /** Zooms to the feature under the open popup (the "Zoom to it" button after "what did I click"). */
  async zoomToSelected (): Promise<Reply> {
    const ok = await this.ctx.live.zoomToSelected()
    return ok ? { text: 'There it is.', mood: 'point', pointAt: this.ctx.live.mapElement() } : { text: 'Nothing is selected to zoom to.', mood: 'think' }
  }

  // ------------------------------------------------------------ map filters, saved views, charts

  /** "Only show parcels over 5 acres": the layer's own filter on the map, undoable, with a count. */
  private async mapFilter (target: string, condition: string, inverse: boolean): Promise<Reply> {
    const live = this.ctx.live
    if (!live.ready) return { text: V.noMap(), mood: 'confused' }
    const e = this.resolveLayer(target)
    if (!e) return { text: V.noLayer(target), mood: 'confused', suggest: ['List layers'] }
    if (e.isGroup) return { text: `**${e.title}** is a group; filter one of its layers.`, mood: 'confused' }
    const fields = Array.from(live.target(e)?.fields || []) as any[]
    // "Over 5 acres", "older than 1990", "edited this week": the same reading as data questions, on this layer.
    let cond = condition.replace(/^(?:that|which|who)\s+(?:are|is|have|has|were|was)\s+/i, '').replace(/^(?:are|is|were|was)\s+/i, '')
    const parsed = parseAnalysis(`${e.title} ${cond}`) || parseAnalysis(`${e.title} where ${cond}`)
    if (parsed?.condition) cond = parsed.condition
    let where: string
    try { where = compileConditions(cond, fields) } catch (err) { return { text: `${err instanceof Error ? err.message : 'I could not read that condition.'} For **${e.title}** try a field with a value: "only show ${e.title} where ${fieldLabel(fields.find(f => !/objectid|shape/i.test(f.name)) || { name: 'field' })} is ...".`, mood: 'confused', suggest: [`Fields in ${e.title}`] } }
    if (inverse) where = `NOT (${where})`
    if (!live.setFilter(e, where, (inverse ? 'all but ' : '') + cond)) return { text: `**${e.title}** cannot be filtered on this map.`, mood: 'confused' }
    if (!live.isVisible(e)) live.setVisible(e, true)
    let count: number | null = null
    try { count = await live.count(e, false) } catch (err) { count = null }
    this.lastLayer = e.path
    return {
      text: `**${e.title}** now shows only ${inverse ? 'the ones that are not ' : ''}**${cond}**${count !== null ? ` (${count.toLocaleString()} feature${count === 1 ? '' : 's'})` : ''}. The rest are hidden on the map until you clear the filter.`,
      mood: 'pleased',
      actions: [{ type: 'ask', q: `clear the filter on ${e.title}`, label: 'Clear filter' }, { type: 'ask', q: `zoom to ${e.title}`, label: 'Zoom to them' }],
      suggest: [`How many ${e.title}`, `Show table ${e.title}`, 'What is filtered']
    }
  }

  private mapUnfilter (target?: string): Reply {
    const live = this.ctx.live
    const all = live.filtered()
    if (!all.length) return { text: 'Nothing is filtered on the map.', mood: 'talk' }
    const picked = target ? this.resolveLayer(target, true) : null
    const targets = picked ? all.filter(x => x.entry.key === picked.key) : all
    if (target && !targets.length) return { text: `**${picked?.title || target}** is not filtered. Filtered: ${all.map(x => x.entry.title).join(', ')}.`, mood: 'think' }
    for (const x of targets) live.clearFilter(x.entry)
    return { text: `${targets.map(x => `**${x.entry.title}**`).join(', ')} show${targets.length === 1 ? 's' : ''} everything again.`, mood: 'acknowledge' }
  }

  private viewsKey (): string { return 'mappy-views:' + (this.ctx.appTitle || 'app') }
  private views (): { [name: string]: any } { try { return JSON.parse(this.ctx.store?.get(this.viewsKey()) || '{}') || {} } catch (e) { return {} } }
  private saveViews (v: { [name: string]: any }): void { try { this.ctx.store?.set(this.viewsKey(), Object.keys(v).length ? JSON.stringify(v) : null) } catch (e) { } }

  /** "Save this view as home base": the viewpoint, kept in this browser for this app. */
  private saveView (name: string): Reply {
    const n = name.trim().replace(/^["']|["']$/g, '')
    if (!n || n.length > 60) return { text: 'Give the view a short name: "save this view as home base".', mood: 'think' }
    if (!this.ctx.store) return { text: 'Saved views are not available here.', mood: 'confused' }
    const vp = this.ctx.live.viewpoint()
    if (!vp) return { text: V.noMap(), mood: 'confused' }
    const v = this.views()
    v[n] = typeof vp.toJSON === 'function' ? vp.toJSON() : vp
    this.saveViews(v)
    return { text: `Saved this view as **${n}**. Say "go to ${n}" to come back to it (kept in this browser).`, mood: 'pleased', suggest: ['My saved views', `Go to ${n}`] }
  }

  private listViews (): Reply {
    const v = this.views()
    const names = Object.keys(v)
    if (!names.length) return { text: 'No saved views yet. Say "save this view as home base" to keep one.', mood: 'talk' }
    return { text: `Your saved views (${names.length}):`, mood: 'explain', list: names.map(n => ({ label: n, action: { type: 'ask' as const, q: `go to ${n}`, label: `Go to ${n}` } })), suggest: [`Delete the ${names[0]} view`] }
  }

  private deleteView (name: string): Reply {
    const v = this.views()
    const key = Object.keys(v).find(k => k.toLowerCase() === name.trim().toLowerCase())
    if (!key) return { text: `No saved view called "${name}".${Object.keys(v).length ? ` You have: ${Object.keys(v).join(', ')}.` : ''}`, mood: 'think' }
    delete v[key]; this.saveViews(v)
    return { text: `Forgot the **${key}** view.`, mood: 'acknowledge' }
  }

  /** "Go to home base": a saved view by name. False when there is none. */
  private async goSavedView (name: string): Promise<boolean> {
    const v = this.views()
    const key = Object.keys(v).find(k => k.toLowerCase() === name.trim().toLowerCase())
    if (!key) return false
    return this.ctx.live.goViewpoint(v[key])
  }

  /** "Chart parcels by zoning": grouped counts, as bars. */
  private async chartBy (layer: string, field: string): Promise<Reply> {
    const r = await this.respondOne(`count ${layer} by ${field}`)
    if (!r.table || r.table.rows.length < 1) return r
    const num = r.table.columns.findIndex((c, i) => i > 0 && r.table!.rows.every(row => Number.isFinite(Number(String(row[i]).replace(/[,%]/g, '')))))
    if (num < 0) return r
    return { ...r, chart: { title: `${r.table.columns[num]} by ${r.table.columns[0]}`, rows: r.table.rows.slice(0, 12).map(row => ({ label: row[0], value: Number(String(row[num]).replace(/[,%]/g, '')) })) } }
  }

  /** The feature whose popup is open, as a short table of its fields. */
  private aboutSelected (): Reply {
    const f = this.ctx.live.selectedFeature()
    if (!f) return { text: 'Nothing is selected. Click a feature on the map to open its popup, then ask me again.', mood: 'think' }
    const alias = new Map(f.fields.map(x => [x.name, x.alias || x.name]))
    const skip = /^(?:objectid|oid|fid|shape|shape_*[._ ]?(?:length|area|len|starea|stlength)|globalid|global_id|st_area\(.*|st_length\(.*)$/i
    const rows: string[][] = []
    for (const [k, v] of Object.entries(f.attributes)) {
      if (skip.test(k) || v === null || v === undefined || v === '') continue
      rows.push([String(alias.get(k) || k), clip(String(v), 80)])
      if (rows.length >= 12) break
    }
    const name = f.title || 'that layer'
    return {
      text: rows.length ? `That is a **${name}** feature. Here is what it says:` : `That is a **${name}** feature, but it has no fields I can show.`,
      mood: 'explain',
      table: rows.length ? { columns: ['Field', 'Value'], rows } : undefined,
      actions: [{ type: 'ask', q: '__zoomsel', label: 'Zoom to it' }],
      suggest: [`How many ${name} in view`, `Fields in ${name}`, `Explore ${name}`].slice(0, 3)
    }
  }

  aboutDoc (id: string): Reply {
    const d = this.ctx.index.getById(id)
    if (!d) return { text: V.notFound(id), mood: 'confused' }
    return { text: describeDoc(d), actions: d.actions, mood: 'talk' }
  }

  private featureReply (raw: string, results: any[]): Reply {
    this.ctx.beacon?.action('feature-search')
    if (results.length) this.lastLayer = results[0].entry.path
    const reply: Reply = { text: V.found(results.length, raw) + ' Choose a result to zoom to it.', mood: 'celebrate', results }
    // All from one layer: they can go to the Table together.
    const entry = results[0]?.entry
    if (this.ctx.openInTable && entry && results.every(r => r.entry === entry)) {
      const oid = this.ctx.live.target(entry)?.objectIdField || 'OBJECTID'
      const ids = results.map(r => r.graphic?.attributes?.[oid]).filter(v => v != null)
      if (ids.length === results.length) reply.actions = [this.tableAction(entry, { ids, label: `${entry.title}: ${clip(raw, 30)}` })]
    }
    return reply
  }

  /** What a code on the map means: from a layer's coded values first, then a plain reading. */
  private codeMeaning (code: string): { name: string, layer: string, field: string } | null {
    const want = code.toUpperCase()
    try {
      for (const e of this.ctx.live.entries()) {
        if (e.isGroup) continue
        for (const f of this.ctx.live.info(e).fields) {
          const hit = (f.codes || []).find(([c]) => String(c).toUpperCase() === want)
          if (hit && String(hit[1]).toUpperCase() !== want) return { name: String(hit[1]), layer: e.title, field: fieldLabel(f) }
        }
      }
    } catch (e) { }
    // The deep scan's code lists: "Possible Zone values in Zoning: Residential 4 (R-4), ...".
    for (const d of this.ctx.index.docs) {
      if (d.kind !== 'domain') continue
      const m = d.text.match(new RegExp('(?:^|, |: )([^,:()]{2,80}?) \\(' + want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)(?:,|\\.|$)', 'i'))
      if (m) { const t = d.title.match(/^(.+?) in (.+)$/); return { name: m[1].trim(), layer: t ? t[2] : d.title, field: t ? t[1] : '' } }
    }
    return null
  }

  /** "What is a parcel", "what does R-4 mean": a meaning, plus the matching layer or tool when the app has one. */
  private define (phrase: string, code: boolean): Reply | null {
    const live = this.ctx.live
    // A layer named with these words (whole words only: "park" is not "Parking Lots").
    const layerFor = (words: string): LayerEntry | null => {
      if (!live.ready) return null
      const want = flat(words).split(' ').filter(Boolean).map(w => w.replace(/s$/, ''))
      if (!want.length) return null
      const has = (title: string) => { const ws = flat(title).split(' ').map(w => w.replace(/s$/, '')); return want.every(w => ws.includes(w)) }
      const hits = live.entries().filter(e => !e.isGroup && !e.isTable && has(e.title)).sort((a, b) => a.title.length - b.title.length)
      return hits[0] || null
    }
    if (code) {
      const found = this.codeMeaning(phrase)
      const zoning = layerFor('zoning') || layerFor('flood zones')
      if (found) {
        return { text: `**${phrase.toUpperCase()}** is **${found.name}**${found.field ? ` (${found.field} in ${found.layer})` : ` (in ${found.layer})`}.`, mood: 'talk', sources: [{ title: found.layer, detail: 'Code list on the layer' }], actions: zoning && !live.isVisible(zoning) ? [{ type: 'layerOn', id: zoning.key, label: `Turn on ${zoning.title}` }] : undefined }
      }
      return { text: codeGuess(phrase), mood: 'think', actions: zoning ? [{ type: 'layerOn', id: zoning.key, label: `Show ${zoning.title}` }] : undefined, suggest: zoning ? [`What ${zoning.title.toLowerCase()} codes are there?`] : undefined }
    }
    const term = lookupTerm(phrase)
    if (!term) return null
    const layer = layerFor(phrase) || layerFor(term.term)
    const tool = this.ctx.index.search(term.term, { limit: 1, kinds: ['widget'] })[0]
    const extra: string[] = []
    const actions: MappyAction[] = []
    if (layer && !layer.isGroup) { extra.push(`This map has a **${layer.title}** layer.`); actions.push({ type: 'layerOn', id: layer.key, label: live.isVisible(layer) ? `Zoom to ${layer.title}` : `Turn on ${layer.title}` }) }
    if (tool && tool.score >= 3 && tool.doc.actions?.length) { extra.push(`The **${tool.doc.title}** tool is here too.`); actions.push(...tool.doc.actions.filter(a => a.type === 'openWidget').slice(0, 1)) }
    const see = (term.see || []).map(s => `What is ${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}?`)
    const Term = /^[a-z]/.test(term.term) ? term.term.charAt(0).toUpperCase() + term.term.slice(1) : term.term
    return { text: `**${Term}**: ${term.text}${extra.length ? '\n\n' + extra.join(' ') : ''}`, mood: 'talk', actions: actions.length ? actions : undefined, suggest: see.length ? see : undefined, sources: [{ title: 'Glossary', detail: 'Plain-language map words' }] }
  }

  /** A question the map cannot answer, with the app's own link for it when there is one. */
  /** The organization, for wording: "the City" unless the app says otherwise. */
  private org (): string { return (this.ctx.place?.org || '').trim() || 'the City' }

  private asideReply (raw: string, aside: { topic: string, text: string, suggest?: string[] }): Reply | null {
    // The app author's own answer or link wins over the stock reply.
    const hits = this.ctx.index.search(raw, { limit: 3 })
    const own = hits.find(h => ['faq', 'note'].includes(h.doc.kind) && h.score >= 4)
    if (own) return null
    const links = hits.filter(h => h.doc.kind === 'link' && h.score >= 3).slice(0, 2)
    const actions: MappyAction[] = links.flatMap(h => h.doc.actions || []).slice(0, 2)
    // A report-a-problem tool in the app is the right door for reports.
    if (aside.topic === 'report') actions.unshift(...this.widgetActions('report a concern problem'))
    // The organization's website, when the app gives one and the answer points there.
    const site = (this.ctx.place?.website || '').trim()
    if (site && /^https?:\/\//i.test(site) && /website/.test(aside.text) && !actions.some(a => (a as any).url === site)) actions.push({ type: 'url', url: site, label: `${this.org().replace(/^the /i, m => m[0].toUpperCase() + m.slice(1))} website` })
    return { text: aside.text, mood: 'talk', actions: actions.length ? actions.slice(0, 3) : undefined, suggest: aside.suggest }
  }

  /** A button that opens these records in the app's Table widget. */
  private tableAction (entry: LayerEntry, req: TableRequest, label = 'Open in Table'): MappyAction {
    const id = String(++this.tableJobSeq)
    this.tableJobs.set(id, { entry, req })
    if (this.tableJobs.size > 40) this.tableJobs.delete(this.tableJobs.keys().next().value as string)
    return { type: 'ask', q: `__table:${id}`, label }
  }

  /** "Opened Fire Hydrants in the Table: 12 records near 250 N 5th St." */
  private tableSaid (entry: LayerEntry, t: TableResult, scope: string): string {
    if (t.switched) return `Here's the **${entry.title}** tab in the Table${t.count ? ` (${t.count.toLocaleString()} records)` : ''}.`
    const n = `${t.count.toLocaleString()}${t.capped ? '+' : ''} record${t.count === 1 ? '' : 's'}`
    return `Opened **${entry.title}** in the Table: ${n}${scope ? ` ${scope}` : ''}.${t.capped ? ` The first ${t.count.toLocaleString()} are in the tab; narrow it with "where".` : ''}`
  }

  private async runTableJob (id: string): Promise<Reply> {
    const job = this.tableJobs.get(id)
    if (!job || !this.ctx.openInTable) return { text: 'That table button has expired. Ask again and I will open it.', mood: 'confused' }
    try {
      const t = await this.ctx.openInTable(job.entry, job.req)
      if (!t.ok) return { text: t.message || 'The Table did not open.', mood: 'confused' }
      const scope = job.req.near ? `within ${Math.round(job.req.near.feet).toLocaleString()} ft` : job.req.ids ? 'found' : job.req.condition ? `where ${job.req.condition}` : job.req.inView ? 'in view' : ''
      return { text: this.tableSaid(job.entry, t, scope), mood: 'writing' }
    } catch (e) {
      this.ctx.beacon?.error(e, 'table')
      return { text: 'The Table did not take those records. Try again in a moment.', mood: 'confused' }
    }
  }

  async ask (q: string, raw: string): Promise<Reply> {
    const live = this.ctx.live
    if (/\d{3,}|\d+[-/]\d+|[a-z]-\d+/i.test(raw) && raw.length <= 60 && this.ctx.featureSearch && live.ready) {
      const results = await live.search(raw, { hints: this.ctx.hints, max: this.ctx.maxResults })
      if (results.length) return this.featureReply(raw, results)
    }
    const r = answerQuestion(this.ctx.index, q)
    if (r.mood === 'talk') return r
    const looksLikeValue = raw.length <= 60 && (/\d/.test(raw) || raw.split(/\s+/).length <= 3) && !/\?$/.test(raw)
    if (looksLikeValue && this.ctx.featureSearch && live.ready) {
      const results = await live.search(raw, { hints: this.ctx.hints, max: this.ctx.maxResults })
      if (results.length) return this.featureReply(raw, results)
    }
    // Asked about an off layer: say so instead of guessing.
    const off = live.ready ? this.resolveLayer(q, true) : null
    if (off && !live.isVisible(off) && tokenize(q).length <= 4) return this.offReply(off)
    return r
  }

  listKind (kinds: Doc['kind'][], lead: string): Reply {
    const docs = this.ctx.index.docs.filter(d => kinds.includes(d.kind))
    if (!docs.length) return { text: "I don't see any here.", mood: 'confused' }
    return {
      text: lead,
      mood: 'talk',
      list: docs.slice(0, 40).map(d => ({ label: d.title + (d.kind !== kinds[0] ? ` (${d.kind === 'dialog' ? 'window' : d.kind})` : ''), action: d.actions?.[0] || { type: 'ask', q: '__doc:' + d.id } }))
    }
  }

  // ------------------------------------------------------------------ layers

  /** A layer row for lists: indented like the layer list, status glyph plus words for screen readers. */
  private row (e: LayerEntry): ListRow {
    const s = this.ctx.live.status(e)
    return {
      label: e.title + (e.isGroup ? ' (group)' : ''),
      glyph: STATUS_GLYPH[s],
      sr: STATUS_SR[s],
      indent: Math.min(e.depth, 6),
      detail: s === 'hidden' ? `group "${this.ctx.live.hiddenBy(e)}" is off` : s === 'scale' ? 'zoom in or out to see it' : undefined,
      action: { type: 'layerOn', id: e.key, label: 'Select and show ' + e.title }
    }
  }

  listLayers (visibleOnly: boolean): Reply {
    const live = this.ctx.live
    if (!live.ready) return this.listKind(['layer'], 'Layers I learned about in the scan:')
    const all = live.entries().filter(e => !e.isTable)
    const rows = visibleOnly ? all.filter(e => !e.isGroup && live.isVisible(e)) : all
    if (!rows.length) return { text: visibleOnly ? `Nothing is turned on in ${this.listName} right now.` : 'The map has no layers.', mood: 'confused', actions: this.layerListAction() }
    const drawing = all.filter(e => !e.isGroup && live.isVisible(e)).length
    return {
      text: visibleOnly
        ? `${rows.length} layer${rows.length === 1 ? ' is' : 's are'} enabled. Choose one to select and reveal it:`
        : `${this.listName} has ${all.filter(e => !e.isGroup).length} layers in ${all.filter(e => e.isGroup).length} groups; ${drawing} enabled. Choose a layer to select, expand and turn it on:`,
      mood: 'talk',
      list: rows.slice(0, 90).map(e => visibleOnly ? { ...this.row(e), indent: 0, label: e.path } : this.row(e)),
      actions: this.layerListAction()
    }
  }

  private layerListAction (): MappyAction[] | undefined {
    if (!this.ctx.layerListIds.length) return undefined
    return [{ type: 'openLayerList', label: `Open ${this.ctx.layerListLabel || 'the layer list'}` }]
  }

  /**
   * Layer by name the way the list shows it: exact name, "group > name" path, singular or
   * plural, then the brain's best match, then contains. Visible matches win ties.
   */
  resolveLayer (name: string, quiet = false): LayerEntry | null {
    if (this.chosenLayer?.query === name) return this.chosenLayer.entry
    const live = this.ctx.live
    if (!live.ready) return null
    const all = live.entries()
    const byKey = all.find(e => e.key === name)
    if (byKey) return byKey
    const fullPath = all.filter(e => flat(e.path) === flat(name) && e.depth > 0)
    if (fullPath.length === 1) return fullPath[0]
    const wantsGroup = /\b(group|folder|service)\b/i.test(name)
    const f = flat(name).replace(/\b(layer|layers|the|group|folder|service)\b/g, ' ').replace(/\s+/g, ' ').trim()
    if (!f) return null
    const sing = (s: string) => s.replace(/s$/, '')
    // A layer beats a group with the same name (a map service "Parcels" holding a "Parcels"
    // sublayer) unless the user said "group". Then: drawing first, then the deeper, more
    // specific row.
    const prefer = (list: LayerEntry[]) => {
      const specific = wantsGroup ? list.filter(e => e.isGroup) : list.filter(e => !e.isGroup)
      if (!quiet && specific.length > 1) throw new LayerChoice(name, specific)
      const pickedRaw = list.sort((a, b) =>
        (wantsGroup ? Number(!!b.isGroup) - Number(!!a.isGroup) : Number(!!a.isGroup) - Number(!!b.isGroup)) ||
        Number(live.isVisible(b)) - Number(live.isVisible(a)) ||
        b.depth - a.depth)[0]
      return wantsGroup ? pickedRaw : this.leafOf(pickedRaw, all)
    }
    const exact = all.filter(e => flat(e.title) === f || sing(flat(e.title)) === sing(f))
    if (exact.length) return prefer(exact)
    const byPath = all.filter(e => flat(e.path).endsWith(f) || flat(e.path.replace(/ > /g, ' ')) === f)
    if (byPath.length) return prefer(byPath)
    // "hydrants in water" -> path match on both words.
    const parts = f.split(/\s+(?:in|under|inside)\s+/)
    if (parts.length === 2) {
      const hit = all.filter(e => flat(e.title).includes(parts[0]) && flat(e.path).includes(parts[1]))
      if (hit.length) return prefer(hit)
    }
    const doc = this.ctx.index.resolve(name, ['layer', 'table'], 1.2)
    if (doc?.layer) {
      const byKey = all.find(e => e.key === doc.layer) || all.find(e => flat(e.title) === flat(doc.title))
      if (byKey) return byKey
    }
    const contains = all.filter(e => flat(e.title).includes(f) || (f.length >= 4 && sing(flat(e.title)).includes(sing(f))))
    if (contains.length) return prefer(contains.sort((a, b) => a.title.length - b.title.length))
    if (quiet) return null
    return null
  }

  /**
   * A group that is really a wrapper for one layer (a service with a single sublayer, or a
   * group holding a layer of the same name) stands for that layer.
   */
  private leafOf (e: LayerEntry, all: LayerEntry[]): LayerEntry {
    let cur = e
    for (let i = 0; i < 6 && cur.isGroup; i++) {
      const kids = this.ctx.live.children(cur, all)
      const same = kids.find(k => flat(k.title) === flat(cur.title))
      if (same) { cur = same; continue }
      if (kids.length === 1) { cur = kids[0]; continue }
      break
    }
    return cur
  }

  /** Opens the layer list (if needed) and flashes the row. Returns where Mappy should point. */
  private async prepareLayerList (): Promise<void> {
    if (!this.ctx.showInLayerList || !this.ctx.layerListIds.length) return
    const view = this.ctx.live.view
    const bridge = this.ctx.live.bridge
    if (!bridge || !isShown(bridge.element)) {
      await openWidget(this.ctx.layerListIds, this.ctx.layerListLabel, this.ctx.model, { pulse: false })
      if (view === this.ctx.live.view) await waitForBridge(view, 4000)
    }
  }

  async throughList (e: LayerEntry): Promise<HTMLElement | null> {
    if (!this.ctx.showInLayerList) return null
    const live = this.ctx.live
    let b = live.bridge
    if (!b || !isShown(b.element)) {
      if (this.ctx.layerListIds.length) {
        await openWidget(this.ctx.layerListIds, this.ctx.layerListLabel, this.ctx.model, { pulse: false })
        b = await waitForBridge(live.view, 4000)
      }
    }
    if (b && isShown(b.element)) {
      live.reveal(e)
      return b.element
    }
    // A layer list without the bridge (Esri's own): point at it at least.
    if (this.ctx.layerListIds.length) {
      const el = widgetEl(bestWidgetId(this.ctx.layerListIds, this.ctx.model))
      return el && isShown(el) ? el : null
    }
    return null
  }

  private toggleText (e: LayerEntry, on: boolean, res: ToggleResult, wasHiddenBy: string | null): string {
    const live = this.ctx.live
    if (!on) {
      if (wasHiddenBy) return `**${e.title}** was already hidden because its group "${wasHiddenBy}" is off. I unticked it too.`
      return V.layerOff(e.title)
    }
    let t = V.layerOn(e.title)
    if (res.parents.length) t += ` Its group${res.parents.length > 1 ? 's' : ''} ${res.parents.map(p => `"${p}"`).join(', ')} ${res.parents.length > 1 ? 'were' : 'was'} off, so I turned ${res.parents.length > 1 ? 'them' : 'it'} on too.`
    if (res.children.length) t += ` Nothing inside was on, so I turned on ${res.children.length === 1 ? `"${res.children[0]}"` : `${res.children.length} layers (${clip(res.children.join(', '), 120)})`}.`
    if (e.exclusive) t += ' Only one layer in this group shows at a time.'
    if (!e.isGroup && live.outOfScale(e)) t += ' It only draws at other zoom levels.'
    return t
  }

  async toggle (target: string, on: boolean, raw: string): Promise<Reply> {
    const live = this.ctx.live
    const view = live.view
    await this.prepareLayerList()
    if (view !== live.view) return { text: 'The active map changed. Please select the layer again.', mood: 'confused' }
    // "Turn on parcels and hydrants", "turn off parcels, zoning and parks": each one, when the whole is not a layer itself.
    if (/,|\band\b|&/i.test(target) && !this.resolveLayer(target, true)) {
      const parts = target.split(/\s*(?:,|\band\b|&)\s*/i).map(x => x.trim()).filter(Boolean)
      if (parts.length > 1 && parts.length <= 6 && parts.every(x => this.resolveLayer(x, true))) {
        const replies: Reply[] = []
        for (const part of parts) replies.push(await this.toggle(part, on, raw))
        const missed = replies.filter(r => r.mood === 'confused')
        return { text: replies.map(r => r.text.split('\n')[0]).join(' '), mood: missed.length ? 'think' : replies[replies.length - 1].mood, actions: replies.flatMap(r => r.actions || []).filter(a => a.label !== 'Undo').slice(0, 4), pointAt: replies[replies.length - 1].pointAt, suggest: on ? ['What layers are on?', 'Zoom to it'] : ['What layers are on?'] }
      }
    }
    const e = this.resolveLayer(target)
    if (!e) {
      if (!on) { const w = this.ctx.index.resolve(target, ['widget'], 1.5); if (w) return this.close(target, raw) }
      if (!live.ready) return { text: V.noMap(), mood: 'confused' }
      return { text: `I don't see a layer called "${target}" in ${this.listName}.`, mood: 'confused', suggest: ['List the layers'] }
    }
    const wasHiddenBy = on ? null : live.hiddenBy(e)
    const res = live.setVisible(e, on)
    const pointAt = await this.throughList(e)
    const text = this.toggleText(e, on, res, wasHiddenBy) + (pointAt ? ` See it in ${this.listName}.` : '')
    const actions: MappyAction[] = on
      ? [
          ...(!e.isGroup && live.outOfScale(e) ? [{ type: 'fitScale', id: e.key, label: 'Zoom so it draws' } as MappyAction] : [{ type: 'zoomLayer', id: e.key, label: 'Zoom to it' } as MappyAction]),
          ...(e.isGroup ? [] : [{ type: 'ask', q: `what's in ${e.title}`, label: "What's in it?" } as MappyAction]),
          { type: 'layerOff', id: e.key, label: 'Hide layer' }
        ]
      : [{ type: 'layerOn', id: e.key, label: 'Undo' }]
    this.lastLayer = e.path
    return { text, mood: on ? 'pleased' : 'acknowledge', actions, pointAt, suggest: on ? ["What's in it?", 'How many in view?', 'Zoom to it'] : ['What layers are on?'] }
  }

  async solo (target: string): Promise<Reply> {
    const e = this.resolveLayer(target)
    if (!e) return { text: `I don't see a layer called "${target}" in ${this.listName}.`, mood: 'confused' }
    const { off, result } = this.ctx.live.solo(e)
    const pointAt = await this.throughList(e)
    return { text: `Showing only **${e.title}**${off ? `; turned off ${off} other layer${off === 1 ? '' : 's'}` : ''}.${result.parents.length ? ` Turned on ${result.parents.map(p => `"${p}"`).join(', ')} so it draws.` : ''}`, mood: 'pleased', pointAt, actions: [{ type: 'zoomLayer', id: e.key, label: 'Zoom to it' }] }
  }

  async allOff (): Promise<Reply> {
    const n = this.ctx.live.allOff()
    return { text: n ? `Turned off ${n} layer${n === 1 ? '' : 's'}. The map is clear.` : 'Nothing was on.', mood: 'acknowledge', actions: this.layerListAction() }
  }

  /** "Turn everything on": asks first when that is a lot of layers, since every one adds drawing work. */
  async allOn (force: boolean): Promise<Reply> {
    const todo = this.ctx.live.allOnCandidates()
    if (!todo.length) return { text: 'Everything is already on.', mood: 'acknowledge', actions: this.layerListAction() }
    if (todo.length > 25 && !force) {
      return { text: `That would turn on ${todo.length} layers, which can slow the map down. Turn them all on?`, mood: 'attention', actions: [{ type: 'ask', q: 'turn on every layer anyway', label: `Turn on all ${todo.length}` }, { type: 'ask', q: 'list layers', label: 'Pick from the list' }] }
    }
    const n = this.ctx.live.allOn()
    return { text: `Turned on ${n} layer${n === 1 ? '' : 's'}. Pick-one groups were left as they were.`, mood: 'pleased', actions: this.layerListAction() }
  }

  async revealByName (target: string): Promise<Reply> {
    const e = this.resolveLayer(target)
    if (!e) return { text: `I don't see "${target}" in ${this.listName}.`, mood: 'confused', suggest: ['List the layers'] }
    const pointAt = await this.throughList({ ...e })
    const s = this.ctx.live.status(e)
    const where = e.depth ? `It's under ${e.path.split(' > ').slice(0, -1).map(p => `"${p}"`).join(' > ')}.` : "It's at the top level."
    return {
      text: `**${e.title}** ${e.isGroup ? 'group' : 'layer'}: ${STATUS_SR[s]}. ${where}${pointAt ? ' Flashing it now.' : ''}`,
      mood: 'point',
      pointAt,
      actions: s === 'on' || s === 'scale' ? [{ type: 'layerOff', id: e.key, label: 'Turn off' }] : [{ type: 'layerOn', id: e.key, label: 'Turn on' }]
    }
  }

  async openLayerList (): Promise<Reply> {
    if (!this.ctx.layerListIds.length) return { text: "This app doesn't have a layer list. I can still switch layers for you; ask \"list layers\".", mood: 'confused' }
    const r = await openWidget(this.ctx.layerListIds, this.ctx.layerListLabel, this.ctx.model)
    return { text: r.ok ? V.opened(this.ctx.layerListLabel) : V.cantOpen(this.ctx.layerListLabel, r.where), mood: r.ok ? 'point' : 'confused', pointAt: r.el }
  }

  listPresets (): Reply {
    const b = this.ctx.live.bridge
    const presets = b ? b.presets() : []
    if (!presets.length) return { text: `${this.listName} has no preset layer views.`, mood: 'confused' }
    return { text: `Preset layer views in ${this.listName}:`, mood: 'talk', list: presets.map(p => ({ label: p.name, action: { type: 'preset', id: p.id, label: p.name } as MappyAction })) }
  }

  async applyPreset (name: string): Promise<Reply> {
    const b = this.ctx.live.bridge
    const presets = b ? b.presets() : []
    const f = flat(name)
    const p = presets.find(x => flat(x.name) === f) || presets.find(x => flat(x.name).includes(f) || f.includes(flat(x.name)))
    if (!p || !b) {
      // "turn on the X view" may be an app view (tab).
      const v = this.ctx.index.resolve(name, ['view', 'page', 'dialog'], 2)
      if (v?.actions?.[0]) { await this.act(v.actions[0]); return { text: `Here's ${v.title}.`, mood: 'acknowledge' } }
      return { text: `I don't see a preset called "${name}".${presets.length ? '' : ` ${this.listName} has none.`}`, mood: 'confused', suggest: presets.length ? ['List presets'] : undefined }
    }
    b.applyPreset(p.id)
    return { text: `Applied the **${p.name}** preset.`, mood: 'pleased', pointAt: b.element }
  }

  favorites (): Reply {
    const b = this.ctx.live.bridge
    const favs = b ? b.favorites() : []
    if (!favs.length) return { text: `No starred layers yet. Star one from its menu in ${this.listName}.`, mood: 'talk' }
    return { text: 'Your starred layers:', mood: 'talk', list: favs.map(t => ({ label: t, action: { type: 'ask', q: `where is the ${t} layer`, label: t } as MappyAction })) }
  }

  /** "X is off, so I can't see it." */
  private offReply (e: LayerEntry): Reply {
    const hb = this.ctx.live.hiddenBy(e)
    const why = hb ? `its group "${hb}" is off` : `it's off in ${this.listName}`
    return {
      text: `**${e.title}** isn't drawing (${why}), so I can't look inside it. Turn it on and I'll take a look.`,
      mood: 'confused',
      actions: [{ type: 'layerOn', id: e.key, label: `Turn on ${e.title}` }]
    }
  }

  async opacity (target: string, pct: number): Promise<Reply> {
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { text: 'Use a percentage from 0 to 100.', mood: 'confused' }
    const e = this.resolveLayer(target)
    if (!e) return { text: V.noLayer(target), mood: 'confused' }
    this.ctx.live.setOpacity(e, isFinite(pct) ? pct : 50)
    return { text: `${e.title} is at ${Math.round(isFinite(pct) ? pct : 50)}% opacity.`, mood: 'acknowledge' }
  }

  async fields (target: string, raw: string): Promise<Reply> {
    const live = this.ctx.live
    const e = this.resolveLayer(target)
    if (!e) return this.ask(target, raw)
    if (e.isGroup) {
      const kids = live.children(e)
      return {
        text: `**${e.title}** is a group of ${kids.length} layer${kids.length === 1 ? '' : 's'}${live.isVisible(e) ? '' : ` (the group is ${live.isOn(e) ? 'hidden by a group above it' : 'off'})`}:`,
        mood: 'talk',
        list: kids.map(k => ({ ...this.row(k), indent: 0 })),
        actions: [{ type: 'reveal', id: e.key, label: 'Show in the layer list' }]
      }
    }
    if (!live.canAsk(e)) return this.offReply(e)
    const t = live.target(e)
    try { if (t.load && !t.loaded) await t.load() } catch (err) { }
    const info = live.info(e)
    const hint = this.ctx.hints.get(e.key)
    const names = info.fields.length ? info.fields.map(f => fieldLabel(f)) : (hint?.fields || []).map(f => f[1])
    const useful = names.filter(n => !/^(objectid|globalid|shape|shape[._].*|fid)$/i.test(n))
    const d = this.ctx.index.getById((e.isTable ? 'table:' : 'layer:') + e.key)
    const desc = d && d.text ? clip(d.text.split(' Fields:')[0], 260) : ''
    return {
      text: `**${e.title}**${e.depth ? ` (in ${e.path.split(' > ').slice(0, -1).join(' > ')})` : ''} ${desc ? '- ' + desc + ' ' : ''}${useful.length ? `It has ${useful.length} fields: ${clip(useful.join(', '), 600)}.` : "I couldn't read its fields."}`,
      mood: 'talk',
      actions: [this.ctx.openInTable ? this.tableAction(e, {}) : { type: 'ask', q: `show table ${e.key}`, label: 'Browse rows' }, ...(!e.isTable ? [{ type: 'zoomLayer' as const, id: e.key, label: 'Zoom to it' }] : []), { type: 'reveal', id: e.key, label: 'Show in the layer list' }]
    }
  }

  /** Buttons that open the app's widget for these words, when it has one. */
  private widgetActions (words: string): MappyAction[] {
    const hit = this.ctx.index.search(words, { limit: 1, kinds: ['widget'] })[0]
    return hit && hit.score >= 3 ? (hit.doc.actions || []).filter(a => a.type === 'openWidget').slice(0, 1) : []
  }

  /** "What zoning types are there", "what values can status have": a field's code list, from the live layers. */
  values (target: string, raw: string): Reply {
    const live = this.ctx.live
    const want = flat(target).split(' ').filter(w => w.length > 1).map(w => w.replace(/s$/, ''))
    const matches = (s: string) => { const ws = flat(s).split(' ').map(w => w.replace(/s$/, '')); return want.every(w => ws.includes(w)) || ws.some(w => want.includes(w)) }
    type Hit = { layer: LayerEntry, label: string, codes: Array<[any, string]>, score: number }
    const hits: Hit[] = []
    if (live.ready) {
      for (const e of live.entries()) {
        if (e.isGroup) continue
        let info: any
        try { info = live.info(e) } catch (err) { continue }
        for (const f of info.fields) {
          if (!f.codes || !f.codes.length) continue
          const label = fieldLabel(f)
          const fieldHit = matches(label) || matches(f.name)
          const layerHit = matches(e.title)
          if (!fieldHit && !layerHit) continue
          // A field named like the ask beats a layer named like it; a drawing layer beats one that is off.
          hits.push({ layer: e, label, codes: f.codes, score: (fieldHit ? 4 : 0) + (layerHit ? 2 : 0) + (live.isVisible(e) ? 1 : 0) + (/type|zone|class|status|category|kind|code/i.test(label) ? 1 : 0) })
        }
      }
    }
    hits.sort((a, b) => b.score - a.score)
    const best = hits[0]
    if (best) {
      const names = best.codes.map(([c, n]) => String(c) === String(n) ? String(n) : `${n} (${c})`)
      const shown = names.slice(0, 40)
      return {
        text: `**${best.label}** in **${best.layer.title}** can be ${best.codes.length} things:\n${shown.map(n => `- ${n}`).join('\n')}${names.length > shown.length ? `\n...and ${names.length - shown.length} more.` : ''}`,
        mood: 'talk',
        sources: [{ title: best.layer.title, detail: 'Code list on the layer' }],
        actions: [{ type: 'ask', q: `count ${best.layer.key} by ${best.label}`, label: 'How many of each?' }, ...(!live.isVisible(best.layer) ? [{ type: 'layerOn' as const, id: best.layer.key, label: `Turn on ${best.layer.title}` }] : [])],
        suggest: shown.length ? [`What does ${String(best.codes[0][0])} mean?`] : undefined
      }
    }
    // The deep scan may know the list even when the layer is not on the map.
    const doc = this.ctx.index.search(`${target} values types`, { limit: 1, kinds: ['domain'] })[0]
    if (doc && doc.score >= 2) return { text: doc.doc.text, mood: 'talk', sources: [{ title: doc.doc.title, detail: 'Saved deep scan' }] }
    return { text: `I could not find a list of ${target} values on this map. Ask "what fields does <layer> have" to see what a layer holds.`, mood: 'confused', suggest: ['List layers'] }
  }

  /** "Where are the parks", "show me all the hydrants": the layer, on and in view. Null when it is not a layer. */
  private async showLayer (target: string): Promise<Reply | null> {
    const live = this.ctx.live
    if (!live.ready) return null
    const words = target.replace(/\s+(?:are|is)$/i, '')
    let e: LayerEntry | null = null
    try { e = this.resolveLayer(words, true) } catch (err) { return null }
    if (!e || e.isTable) return null
    // Only a layer named like the words, not a loose match ("where is 1138 White Ave" is an address).
    if (/\d/.test(words)) return null
    const f = flat(words).replace(/\b(?:layer|layers|all|the)\b/g, ' ').trim()
    const title = flat(e.title)
    if (!(title === f || title === f.replace(/s$/, '') || title.replace(/s$/, '') === f.replace(/s$/, '') || title.split(' ').includes(f))) return null
    const before = live.snapshot()
    const result = live.setVisible(e, true)
    const turnedOn = live.remember(before, `turn on ${e.title}`)
    const zoomed = await live.zoomTo(e)
    this.lastLayer = e.path
    const pointAt = await this.throughList(e)
    return {
      text: `Here ${/s$/.test(e.title) ? 'are' : 'is'} **${e.title}**${turnedOn ? ', turned on' : ''}${zoomed ? ' and zoomed to fit' : ''}.${result.parents?.length ? ` Turned on ${result.parents.map((p: string) => `"${p}"`).join(', ')} too.` : ''}`,
      mood: 'pleased', pointAt,
      actions: [{ type: 'ask', q: `count ${e.key}`, label: 'How many?' }, { type: 'ask', q: `show table ${e.key}`, label: 'Open in Table' }, ...(turnedOn ? [{ type: 'ask' as const, q: 'undo', label: 'Undo' }] : [])],
      suggest: [`Closest ${e.title.toLowerCase()} to my address`, `What's in ${e.title}?`]
    }
  }

  /** "What parks are there", "list the schools": the first rows of a layer, by name. Null when it is not a layer. */
  private async listFeatures (target: string): Promise<Reply | null> {
    const live = this.ctx.live
    if (!live.ready || !this.ctx.featureSearch) return null
    let e: LayerEntry | null = null
    try { e = this.resolveLayer(target, true) } catch (err) { return null }
    if (!e || e.isGroup) return null
    const f = flat(target).replace(/\b(?:layer|layers|all|the)\b/g, ' ').trim()
    if (!(flat(e.title) === f || flat(e.title).replace(/s$/, '') === f.replace(/s$/, ''))) return null
    if (!live.canAsk(e)) return this.offReply(e)
    try {
      const reply = await analyzeLayer(live, e, { kind: 'browse', layer: e.key, inView: false, limit: Math.max(10, this.ctx.maxResults) }, Math.max(10, this.ctx.maxResults))
      const t = live.target(e)
      const nameField = t?.displayField || (Array.from(t?.fields || []) as any[]).find(x => /name|title|label/i.test(x.name))?.name
      const rows = reply.table?.rows || []
      const col = reply.table?.columns.findIndex(c => c && nameField && flat(c) === flat(fieldLabel({ name: nameField, alias: (Array.from(t?.fields || []) as any[]).find(x => x.name === nameField)?.alias }))) ?? -1
      const names = col >= 0 ? rows.map(r => r[col]).filter(Boolean) : []
      if (names.length) {
        return { text: `**${e.title}** (first ${names.length}):\n${names.map(n => `- ${n}`).join('\n')}${reply.page?.hasNext ? '\n...and more.' : ''}`, mood: 'talk', sources: reply.sources, actions: [{ type: 'ask', q: `count ${e.key}`, label: 'How many in all?' }, ...(this.ctx.openInTable ? [this.tableAction(e, {})] : [{ type: 'ask' as const, q: `show table ${e.key}`, label: 'Browse rows' }])] }
      }
      return reply
    } catch (err) { return null }
  }

  /** "Nothing is on the map": what is on, what is hidden by the scale, and what to do. */
  private mapBlank (): Reply {
    const live = this.ctx.live
    const all = live.entries().filter(e => !e.isGroup && !e.isTable)
    const on = all.filter(e => live.status(e) === 'on')
    const scale = all.filter(e => live.status(e) === 'scale')
    const hidden = all.filter(e => live.status(e) === 'hidden')
    if (!all.length) return { text: 'This map has no layers I can see. The basemap is all there is.', mood: 'confused' }
    if (!on.length && !scale.length) return { text: `No layers are on right now (${all.length} available). Turn some on, or say "turn on everything".`, mood: 'think', actions: [{ type: 'ask', q: 'List layers', label: 'List layers' }, ...(this.layerListAction() || [])], suggest: all.slice(0, 3).map(e => `Turn on ${e.title}`) }
    const parts: string[] = []
    if (on.length) parts.push(`${on.length} layer${on.length === 1 ? ' is' : 's are'} on and should be drawing: ${on.slice(0, 5).map(e => e.title).join(', ')}${on.length > 5 ? '...' : ''}.`)
    if (scale.length) parts.push(`${scale.length} ${scale.length === 1 ? 'is' : 'are'} on but only draw${scale.length === 1 ? 's' : ''} when you zoom in further: ${scale.slice(0, 5).map(e => e.title).join(', ')}.`)
    if (hidden.length) parts.push(`${hidden.length} ${hidden.length === 1 ? 'is' : 'are'} on but inside a group that is off.`)
    if (on.length) parts.push('If the map still looks empty, the data may be elsewhere: zoom to a layer, or go to the starting view.')
    return { text: parts.join(' '), mood: 'think', actions: [...(scale[0] ? [{ type: 'fitScale' as const, id: scale[0].key, label: `Zoom in for ${scale[0].title}` }] : []), ...(on[0] ? [{ type: 'zoomLayer' as const, id: on[0].key, label: `Zoom to ${on[0].title}` }] : []), { type: 'ask' as const, q: 'go home', label: 'Starting view' }].slice(0, 4) }
  }

  /** Labels on or off, for one layer or every layer that is drawing. */
  private labels (target: string | undefined, on: boolean): Reply {
    const live = this.ctx.live
    const list = target ? [this.resolveLayer(target)].filter(Boolean) as LayerEntry[] : live.entries().filter(e => !e.isGroup && !e.isTable && live.isVisible(e))
    if (target && !list.length) return { text: `I don't see a layer called "${target}".`, mood: 'confused', suggest: ['List layers'] }
    let changed = 0; const noLabels: string[] = []
    for (const e of list) {
      const t = live.target(e)
      if (!t || !('labelsVisible' in t)) { noLabels.push(e.title); continue }
      if (!Array.isArray(t.labelingInfo) || !t.labelingInfo.length) { noLabels.push(e.title); continue }
      try { t.labelsVisible = on; changed++ } catch (err) { noLabels.push(e.title) }
    }
    if (!changed) return { text: target ? `**${list[0].title}** has no labels set up, so there is nothing to ${on ? 'show' : 'hide'}. Labels are added by whoever made the map.` : 'None of the layers that are on have labels set up.', mood: 'think' }
    return { text: `Labels ${on ? 'on' : 'off'} for ${changed === 1 && list.length === 1 ? `**${list[0].title}**` : `${changed} layer${changed === 1 ? '' : 's'}`}.${noLabels.length && target ? '' : noLabels.length ? ` (${noLabels.slice(0, 3).join(', ')} ha${noLabels.length === 1 ? 's' : 've'} no labels set up.)` : ''}`, mood: 'acknowledge', actions: [{ type: 'ask', q: on ? `turn off labels${target ? ' for ' + target : ''}` : `turn on labels${target ? ' for ' + target : ''}`, label: on ? 'Labels off' : 'Labels on' }] }
  }

  /** "When was this data updated", "who maintains parcels", "is this map accurate": what the layer says about itself. */
  private dataInfo (target: string): Reply {
    const live = this.ctx.live
    const general = /^(?:this map|the map|this|it|the data|this data|data|the imagery|imagery|aerials?|the aerial photo|aerial photo|aerial photos)$/i.test(target)
    const note = 'This map is for general reference. Parcel lines and other features are drawn from records and imagery, not surveyed in the field, so they can be off by several feet; for legal boundaries, use a survey or the recorded plat.'
    let e: LayerEntry | null = null
    if (!general) { try { e = this.resolveLayer(target.replace(/\s+(?:data|layer|line|lines|boundar(?:y|ies))$/i, ''), true) } catch (err) { e = null } }
    if (!e && !general && this.lastLayer) { try { e = live.find(this.lastLayer) } catch (err) { e = null } }
    if (!e) {
      const bm = live.view?.map?.basemap
      const imagery = /imagery|aerial|photo/i.test(target) && bm ? ` The background is **${bm.title}**; the date of each photo is set by its provider and often shows when you click the map with the Imagery layer on.` : ''
      return { text: `${note}${imagery} For a specific layer, ask "when was parcels updated" or "who maintains hydrants".`, mood: 'talk', sources: [{ title: 'About this map', detail: 'General reference, not a survey' }] }
    }
    const t = live.target(e)
    const info = live.info(e)
    const facts: string[] = []
    const edited = t?.editingInfo?.lastEditDate || t?.layer?.editingInfo?.lastEditDate
    const modified = t?.portalItem?.modified || t?.layer?.portalItem?.modified
    const when = (v: any) => { const d = new Date(typeof v === 'number' ? v : String(v)); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '' }
    if (edited && when(edited)) facts.push(`last edited on **${when(edited)}**`)
    else if (modified && when(modified)) facts.push(`its map item was last updated on **${when(modified)}**`)
    if (info.copyright) facts.push(`source: ${clip(info.copyright, 160)}`)
    const desc = info.description ? clip(info.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 240) : ''
    return {
      text: `**${e.title}**${facts.length ? ': ' + facts.join('; ') + '.' : ': the service does not say when it was last updated or who keeps it.'}${desc ? `\n\n${desc}` : ''}\n\n${note}`,
      mood: 'talk', sources: [{ title: e.title, detail: info.url ? 'Layer service' : 'Layer in this app' }],
      actions: [{ type: 'ask', q: `what's in ${e.key}`, label: 'What it holds' }, ...(!live.isVisible(e) ? [{ type: 'layerOn' as const, id: e.key, label: `Turn on ${e.title}` }] : [])]
    }
  }

  async count (target: string, inView: boolean, raw: string): Promise<Reply> {
    const e = this.resolveLayer(target)
    if (!e) return this.ask(raw, raw)
    if (e.isTable && inView) return { text: 'Standalone tables have no map geometry. Count this table without "in view".', mood: 'confused' }
    if (e.isGroup) return this.fields(target, raw)
    if (!this.ctx.live.canAsk(e)) return this.offReply(e)
    const n = await this.ctx.live.count(e, inView)
    if (n == null) return { text: `I couldn't count ${e.title}; it doesn't answer queries.`, mood: 'confused' }
    return { text: V.count(n, e.title, inView ? 'view' : undefined), mood: 'acknowledge', actions: inView ? undefined : [{ type: 'ask', q: `how many ${e.title} in view`, label: 'Just in view' }] }
  }

  async find (term: string, scope: string | undefined, raw: string): Promise<Reply> {
    this.lastResults = []
    const live = this.ctx.live
    // "Where are the parks", "find hydrants": a layer by name, not a value inside one.
    if (!scope) { const asLayer = await this.showLayer(term); if (asLayer) return asLayer }
    const known = this.ctx.index.resolve(term, ['widget', 'page', 'view', 'dialog', 'link', 'guide', 'bookmark'], 2.2, false)
    if (known && !scope) return { text: describeDoc(known), actions: known.actions, mood: 'talk' }
    if (!this.ctx.featureSearch || !live.ready) return this.ask(term, raw)
    const scopeEntry = scope ? this.resolveLayer(scope) : null
    if (scope && !scopeEntry) return { text: `I don't see a layer called "${scope}" in ${this.listName}.`, mood: 'confused' }
    if (scopeEntry && !scopeEntry.isGroup && !live.canSee(scopeEntry)) return this.offReply(scopeEntry)
    const results = await live.search(term, { scope: scopeEntry, hints: this.ctx.hints, max: this.ctx.maxResults })
    if (results.length) return this.featureReply(term, results)
    const off = live.offMatches(term)
    if (off.length) return { ...this.offReply(off[0]), text: `No match in the layers that are on. **${off[0].title}** might have it, but it isn't drawing, so I can't look inside it.` }
    if (!scope && this.ctx.geocoders?.length && /^(?:find|locate|where|search|look up)\b/i.test(raw)) return this.locateAddress(term)
    const k = answerQuestion(this.ctx.index, term)
    if (k.mood === 'talk') return { ...k, text: `No features match "${term}" in the layers that are on. ${k.text}` }
    return { text: `Nothing in the layers that are on matches "${term}". Turn on the layer it's in and ask again.`, mood: 'confused', suggest: ['What layers are on?'], actions: this.layerListAction() }
  }

  async close (target: string, raw: string): Promise<Reply> {
    const d = this.ctx.index.resolve(target, ['widget', 'text', 'guide'], 1.5)
    const a = d?.actions?.find(x => x.type === 'openWidget')
    if (!d || !a?.ids) {
      const e = this.resolveLayer(target)
      if (e) return this.toggle(target, false, raw)
      return { text: `I don't see "${target}" to close.`, mood: 'confused' }
    }
    closeWidget(a.ids)
    return { text: `Closed ${d.title}.`, mood: 'acknowledge' }
  }

  async goto (target: string, raw: string): Promise<Reply> {
    const live = this.ctx.live
    // "Zoom to my address", "go to my house".
    if (MY_PLACE.test(target) || /^(?:my\s+)?(?:address|house|home|place)$/i.test(target)) {
      if (!this.myAddress) { this.awaitingPlace = { question: 'zoom to my address', mine: true }; return { text: 'What is your address? Tell me once and I will remember it.', mood: 'think' } }
      return this.locateAddress(this.myAddress)
    }
    // A view the person saved ("go to home base") comes first.
    if (await this.goSavedView(target)) return { text: `Back to **${target}**.`, mood: 'acknowledge', pointAt: live.mapElement() }
    const presets = live.bridge ? live.bridge.presets() : []
    if (presets.some(p => flat(p.name) === flat(target))) return this.applyPreset(target)
    const nav = this.ctx.index.resolve(target, ['page', 'view', 'dialog', 'bookmark'], 2)
    if (nav?.actions?.[0]) { await this.act(nav.actions[0]); return { text: `Here's ${nav.title}.`, mood: 'acknowledge' } }
    const e = this.resolveLayer(target)
    if (e) {
      const res = live.isVisible(e) ? { parents: [], children: [] } : live.setVisible(e, true)
      const ok = await live.zoomTo(e)
      const pointAt = res.parents.length || res.children.length ? await this.throughList(e) : null
      return { text: ok ? `Zoomed to ${e.title}.${res.parents.length ? ' Turned it on so it shows.' : ''}` : `I turned on ${e.title} but couldn't find its extent.`, mood: ok ? 'acknowledge' : 'confused', pointAt }
    }
    const w = this.ctx.index.resolve(target, ['widget'], 2)
    if (w) return this.open(target, raw)
    if (this.ctx.geocoders?.length) return this.locateAddress(target)
    return this.find(target, undefined, raw)
  }

  async open (target: string, raw: string): Promise<Reply> {
    const kinds: Doc['kind'][] = ['widget', 'page', 'view', 'dialog', 'guide', 'text', 'link', 'bookmark']
    let d = this.ctx.index.resolve(target, kinds, 1.5, false)
    if (!d) {
      const layer = this.resolveLayer(target)
      if (layer && flat(layer.title).replace(/s$/, '').includes(flat(target).replace(/\b(layer|the)\b/g, '').trim().replace(/s$/, ''))) return this.toggle(target, true, raw)
      d = this.ctx.index.resolve(target, kinds, 1.5)
    }
    if (d && d.actions?.length) {
      const first = d.actions[0]
      if (first.type === 'openWidget' && first.ids) {
        const r = await openWidget(first.ids, d.title, this.ctx.model)
        this.ctx.beacon?.action('open-widget')
        if (!r.ok) return { text: V.cantOpen(d.title, r.where), mood: 'confused' }
        return { text: V.opened(d.title) + (d.where ? ` It lives ${d.where}.` : ''), mood: 'point', pointAt: r.el }
      }
      await this.act(first)
      return { text: V.opened(d.title), mood: 'acknowledge' }
    }
    const layer = this.resolveLayer(target)
    if (layer) return this.toggle(target, true, raw)
    return this.find(target, undefined, raw)
  }

  /** Runs one action button. Returns false when it could not be done, or an element to point at. */
  async act (a: MappyAction): Promise<boolean | HTMLElement | void> {
    const live = this.ctx.live
    // A layer button counts as talking about that layer: "hide it" afterwards means it.
    this.syncContext()
    const entry = (): LayerEntry | null => a.id ? (live.find(a.id) || this.resolveLayer(a.label || '')) : null
    switch (a.type) {
      case 'openWidget': {
        if (!a.ids?.length) return false
        this.ctx.beacon?.action('open-widget')
        const r = await openWidget(a.ids, (a.label || '').replace(/^(Open|Show) /, '').replace(/^"|"$/g, ''), this.ctx.model)
        return r.ok ? (r.el || true) : false
      }
      case 'openLayerList': {
        if (!this.ctx.layerListIds.length) return false
        const r = await openWidget(this.ctx.layerListIds, this.ctx.layerListLabel, this.ctx.model)
        return r.ok ? (r.el || true) : false
      }
      case 'widgetHelp': {
        if (!a.ids?.length) return false
        return (await openWidgetHelp(a.ids, (a.label || '').replace(/^Open the | help guide$/g, ''), this.ctx.model)) || false
      }
      case 'closeWidget': if (a.ids) closeWidget(a.ids); return
      case 'page': if (a.id) await goPage(a.id); return
      case 'dialog': if (a.id) await goDialog(a.id); return
      case 'view': if (a.id && a.sectionId) await goView(a.sectionId, a.id, this.ctx.model); return
      case 'url': if (a.url) openUrl(a.url); return
      case 'bookmark': return live.goBookmark(Number(a.id))
      case 'preset': {
        const b = live.bridge
        if (!b || !a.id) return false
        return b.applyPreset(a.id) ? (b.element || true) : false
      }
      case 'reveal': {
        const e = entry()
        if (!e) return false
        return (await this.throughList(e)) || false
      }
      case 'solo': {
        const e = entry()
        if (!e) return false
        this.lastLayer = e.path
        live.solo(e)
        return (await this.throughList(e)) || true
      }
      case 'fitScale': {
        const e = entry()
        if (!e) return false
        await live.fitScale(e)
        return true
      }
      case 'layerOn': case 'layerOff': case 'zoomLayer': {
        const view = live.view
        await this.prepareLayerList()
        if (view !== live.view) return false
        const e = entry()
        if (!e) return false
        this.lastLayer = e.path
        if (a.type === 'layerOff') { live.setVisible(e, false); return (await this.throughList(e)) || true }
        if (!live.isVisible(e)) live.setVisible(e, true)
        if (a.type === 'zoomLayer') return live.zoomTo(e)
        return (await this.throughList(e)) || true
      }
    }
  }
}

/** "my address", "my house", "my home", "where I live". */
const MY_PLACE = /\b(?:my (?:home |house |street )?address|my (?:house|home|place)|where i live)\b/i

/** The question with its place filled in: "my address" swapped, or "to <place>" added. */
/** A reply with one of his acts (print, mail, explain...) when it went well; a confused answer keeps its face. */
function withAct (r: Reply | null, act: Reply['mood'] | null): Reply | null {
  if (!r || !act) return r
  if (!['confused', 'attention', 'alert', 'think'].includes(r.mood || '')) r.mood = act
  return r
}

function placeInto (question: string, place: string): string {
  if (MY_PLACE.test(question)) return question.replace(MY_PLACE, () => place)
  if (THIS_PLACE.test(question)) return question.replace(THIS_PLACE, () => ` ${place}`)
  // The question already names a place ("pipe near 1138 White Ave"): swap it, never append a second one.
  const had = parsePlaceQuestion(question)?.place
  if (had) {
    const at = question.toLowerCase().lastIndexOf(had.toLowerCase())
    if (at >= 0) return question.slice(0, at) + place + question.slice(at + had.length)
  }
  return `${question.replace(/[?.!]+$/, '')} to ${place}`
}

/**
 * "My address" is kept in memory for this page only (never written to browser storage): it is
 * a person's home address, and the one place it belongs is in their head. "Forget my address"
 * clears it early.
 */
function saveMyAddress (address: string): string {
  return clip(address.trim().replace(/[.!]+$/, ''), 200)
}

/** What people usually ask next. */
function followUps (pq: ReturnType<typeof parsePlaceQuestion>, q: string, has: ((re: RegExp) => boolean) | null = null): string[] {
  if (!pq) return []
  const place = pq.place ? pq.place : pq.here ? 'here' : ''
  const at = place === 'here' ? "What's here?" : place ? `What's at ${clip(place, 40)}?` : ''
  if (pq.kind === 'nearest' && pq.thing) return [place ? `${pq.thing} within 500 ft of ${clip(place, 40)}` : '', at].filter(Boolean)
  if (pq.kind === 'within' && pq.thing) return [place ? `Closest ${pq.thing} to ${clip(place, 40)}` : ''].filter(Boolean)
  if (pq.kind === 'at' && place) {
    // Offer what was not just asked, each worded so it can only mean one thing
    // ("zoning", not "zone": a zone could be zoning, a flood zone or a pressure zone),
    // and only for layers the map or the server actually has.
    const p = clip(place, 40)
    const asked = `${pq.thing || ''} ${pq.field || ''} ${q}`.toLowerCase()
    const menu: Array<[RegExp, RegExp, string]> = [
      [/owner|parcel|owns/, /parcel|tax lot/i, `Who owns ${p}?`],
      [/zoning|\bzoned?\b(?!.*flood)/, /zoning/i, `What is the zoning at ${p}?`],
      [/flood/, /flood/i, `Is ${p} in a flood zone?`],
      [/trash|pickup|recycl/, /trash|pickup|refuse|solid waste/i, `When is trash pickup at ${p}?`],
      [/city limit|inside the city|in the city/, /city limit|municipal boundar/i, `Is ${p} in city limits?`],
      [/council|district|representative/, /council/i, `Which council district is ${p} in?`],
      [/school/, /school/i, `Which schools serve ${p}?`]
    ]
    const offers = menu.filter(([a, layer]) => !a.test(asked) && (!has || has(layer))).map(m => m[2]).slice(0, 2)
    if (pq.thing || offers.length < 2) offers.push(`Tell me about ${p}`)
    return offers.slice(0, 3)
  }
  return []
}

/** "it", "this", "that address", "this parcel", "there" at the end of a place question. */
const THIS_PLACE = /\s+(?:it|this|that|there|(?:this|that|the) (?:address|place|property|parcel|lot|spot|location|house|building|point|result|one))(?=\s*(?:in)?\s*[?.!]*$)/i

/** "250 N 5TH ST" -> "250 N 5th St": street words in title case, directions in capitals. */
function niceAddress (s: string): string {
  if (!/[A-Z]{3}/.test(s) || /[a-z]/.test(s)) return s
  return s.split(/\s+/).map(w => /\d/.test(w) ? w.toLowerCase() : /^(N|S|E|W|NE|NW|SE|SW|PO|US|CR|HWY)$/i.test(w) ? w.toUpperCase() : w.charAt(0) + w.slice(1).toLowerCase()).join(' ')
}

/**
 * The field that answers a question about a place, from label and value pairs: words from the
 * question ("city", "zone", "school") and names beat addresses, phone numbers, links, ids and dates.
 */
function pickAnswer (pairs: Array<{ label: string, value: string, display?: boolean }>, thing: string): { label: string, value: string } | null {
  const asked = flat(thing).split(' ').filter(w => w.length > 2 && !/^(what|which|the|this|that|area|layer|limits?|boundary|boundaries)$/.test(w))
  const KIN: { [k: string]: string[] } = {
    city: ['city', 'municipal', 'municipality', 'jurisdiction', 'town', 'place', 'name', 'status'], zone: ['zone', 'zoning', 'class', 'district', 'code'],
    zoning: ['zone', 'zoning', 'class', 'code'], district: ['district', 'ward', 'name', 'rep', 'representative'], council: ['district', 'rep', 'representative', 'member', 'name'],
    school: ['school', 'name'], flood: ['zone', 'flood', 'sfha'], day: ['day', 'pickup', 'route'], trash: ['day', 'pickup', 'route'], recycling: ['day', 'pickup', 'route'],
    park: ['park', 'name'], subdivision: ['subdivision', 'name', 'plat'], county: ['county', 'name'], precinct: ['precinct', 'name', 'number'], water: ['district', 'name', 'provider'],
    sewer: ['district', 'name', 'provider'], irrigation: ['district', 'name'], electric: ['provider', 'utility', 'name'], gas: ['provider', 'utility', 'name']
  }
  const kin = new Set(asked.flatMap(w => [w, ...(KIN[w] || KIN[w.replace(/s$/, '')] || [])]))
  const wantsAddress = asked.some(w => /addr|street|location/.test(w))
  let best: { label: string, value: string, score: number } | null = null
  for (const p of pairs) {
    const text = String(p.value || '').trim()
    if (!text) continue
    const label = p.label.toLowerCase()
    const words = label.split(/[\s_]+/)
    let s = 0
    if (Array.from(kin).some(k => words.some(w => w === k || w.startsWith(k)))) s += 5
    if (asked.some(k => label.includes(k))) s += 2
    if (p.display) s += 2
    if (/(^| )(name|label|title|desc|description)( |$)/.test(label)) s += 2
    if (!wantsAddress && /addr|situs|street|mail|zip|postal|location/.test(label)) s -= 5
    if (/phone|fax|email|url|http|link|web|site|photo|image|doc/.test(label)) s -= 6
    if (/(^| )(id|guid|pin|apn|num|number|no|oid|key)( |$)/.test(label)) s -= 3
    if (/date|time|year|created|edited|updated/.test(label)) s -= 4
    if (!wantsAddress && /^\d+\s+[a-z]/i.test(text)) s -= 4
    if (/^https?:/i.test(text)) s -= 6
    if (/^-?\d+(\.\d+)?$/.test(text)) s -= 2
    if (text.length > 80) s -= 2
    if (!best || s > best.score) best = { label: p.label, value: text, score: s }
  }
  return best && best.score > -3 ? { label: best.label, value: best.value } : null
}

/** A key for a spot, to about a meter. */
function placeKey (lat: number, lon: number): string { return `${lat.toFixed(5)},${lon.toFixed(5)}` }

/** "Joint Owner: X; Owner: Y" -> "**Y** owns 1718 White Ave. (Parcel 2945-...)" */
function ownerSentence (pairs: Array<{ label: string, value: string }>, where: string): string {
  const owner = pairs.find(p => /^(owner|owner name|owners?|property owner)$/i.test(p.label)) || pairs.find(p => /owner/i.test(p.label) && !/joint|mail|address|city|state|zip/i.test(p.label))
  if (!owner) return ''
  const number = pairs.find(p => /^parcel (number|num|no|id)$/i.test(p.label))
  const joint = pairs.find(p => /^joint owner/i.test(p.label))
  return `**${owner.value}**${joint ? ` and ${joint.value}` : ''} own${joint ? '' : 's'} ${where}.${number ? ` (Parcel ${number.value})` : ''}`
}

/** One value of a parcel, said the way people ask for it: acres, year built, parcel number. */
function fieldSentence (field: string, pairs: Array<{ label: string, value: string }>, where: string): string {
  const f = field.toLowerCase()
  const find = (re: RegExp, not?: RegExp) => pairs.find(p => re.test(p.label) && !(not && not.test(p.label)) && p.value.trim() !== '' && p.value !== '0')
  if (/acre|size|area/.test(f)) {
    const p = find(/acre/i) || find(/^(area|lot size|land area)$/i)
    if (!p) return ''
    const n = Number(String(p.value).replace(/,/g, ''))
    const acres = Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString() : p.value
    const sqft = Number.isFinite(n) && /acre/i.test(p.label) ? ` (about ${Math.round(n * 43560).toLocaleString()} sq ft)` : ''
    return /acre/i.test(p.label) ? `${where} is **${acres} acres**${sqft}.` : `The ${p.label.toLowerCase()} of ${where} is **${p.value}**.`
  }
  if (/built|age|year/.test(f)) {
    const p = find(/year built|yr built|built/i, /effective/i) || find(/effective year built/i)
    if (!p) return ''
    const y = Number(p.value)
    const age = Number.isFinite(y) && y > 1700 && y <= new Date().getFullYear() ? ` (about ${new Date().getFullYear() - y} years old)` : ''
    return `${where} was built in **${p.value}**${age}.`
  }
  if (/represent|rep\b|member/.test(f)) {
    const p = find(/rep|representative|member|council ?person|commissioner/i, /phone|email|url|web|address/i)
    if (!p) return ''
    const district = find(/^(district|ward|council district)$/i)
    return `${where}${district ? ` is in District ${district.value}; the representative` : `'s representative`} is **${p.value}**.`
  }
  if (/parcel|number|account|pin/.test(f)) {
    const p = find(/^parcel (number|num|no|id)$|^(pin|apn|account)/i)
    return p ? `The parcel number for ${where} is **${p.value}**.` : ''
  }
  if (/legal/.test(f)) {
    const p = find(/legal/i)
    return p ? `Legal description for ${where}: **${p.value}**` : ''
  }
  const p = find(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  return p ? `The ${p.label.toLowerCase()} for ${where} is **${p.value}**.` : ''
}

/** "Property Information - Trash Pickup Day" -> "Trash Pickup Day"; "Elementary School Attendance Areas" -> "Elementary School". */
const WEEKDAY = /^(mon|tues|wednes|thurs|fri|satur|sun)day$/i
const AREA_WORDS = /zone|zoning|district|area|ward|precinct|boundar|limit|neighbou?rhood|subdivision|tract|basin|region|attendance|overlay|floodplain|corridor|plan\b|jurisdiction/i

/**
 * One plain sentence for a value found at a place, worded for what kind of value it is:
 * "Trash pickup at 250 N 5th St is on **Tuesday**.", "1138 White Ave is zoned **RM-8**.",
 * "1138 White Ave is in Council District **3**.", "The water district for X is **Ute Water**."
 */
function placeFact (where: string, thing: string, layer: string, label: string, value: string, q: string): string {
  const out = placeFactRaw(where, thing, layer, label, value, q)
  return out.charAt(0).toUpperCase() + out.slice(1)
}

function placeFactRaw (where: string, thing: string, layer: string, label: string, value: string, q: string): string {
  const v = String(value).trim()
  const topic = (thing || shortLayer(layer)).replace(/\s+(days?|schedule|info(rmation)?)$/i, '').trim() || shortLayer(layer)
  const Topic = topic.charAt(0).toUpperCase() + topic.slice(1)
  const timeish = WEEKDAY.test(v) || /^when\b/i.test(q) || /\b(day|date|time|schedule|week)\b/i.test(`${label} ${layer}`)
  if (timeish) return `${Topic} at ${where} is ${WEEKDAY.test(v) ? 'on ' : ''}**${v}**.`
  if (/zoning|^zones?$/i.test(topic) || /zoning/i.test(layer)) return `${where} is zoned **${v}**.`
  if (AREA_WORDS.test(`${topic} ${layer} ${label}`)) {
    const short = shortLayer(layer)
    const shares = words(v).some(w => words(short).includes(w))
    // A bare code reads better with its kind: "Council District **3**"; a name stands alone.
    const code = /^[A-Z0-9][A-Z0-9-]{0,4}$/i.test(v) && /\d|^[A-Z]{1,2}$/.test(v)
    return code && !shares ? `${where} is in ${short} **${v}**.` : `${where} is in **${v}**.`
  }
  return `The ${topic.toLowerCase()} for ${where} is **${v}**.`
}

function shortLayer (name: string): string {
  return name.split(' - ').pop()!.replace(/\s+(Attendance\s+)?Areas?$/i, '').replace(/\s+Districts$/i, ' District').trim()
}

function words (s: string): string[] { return flat(s).split(' ').filter(w => w.length > 2).map(w => w.replace(/s$/, '')) }

/** Straight-line distance in feet between two [latitude, longitude] points. */
function groundFeet (a: [number, number], b: [number, number]): number {
  const R = 20902231
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(b[0] - a[0]); const dLon = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** "How far is 1718 White Ave from City Hall": read as said (the language pack would rewrite "how far"). */
const DISTANCE_Q = /^(?:how far(?: away)?|what(?:'s|s| is) the distance|distance)\s+(?:is\s+)?(?:it\s+)?(?:from\s+|between\s+)?(.+?)\s+(?:from|to|and)\s+(.+?)[?.!]*$/i
/** "What properties does Jane Doe own", "parcels owned by Jane Doe". */
const OWNED_Q = /^(?:what|which)\s+(?:properties|property|parcels?|lots?|land)\s+does\s+(.+?)\s+own$|^(?:properties|parcels?|lots?|land)\s+owned\s+by\s+(.+)$|^what\s+does\s+(.+?)\s+own$|^(?:find|show|list)\s+(?:all\s+)?(?:properties|parcels?)\s+(?:owned by|for owner)\s+(.+)$/i

/**
 * A FEMA flood zone said plainly. Zones starting with A or V are the Special Flood Hazard
 * Area (the 1% annual chance, "100-year" floodplain); X, B, C and D are not. Empty when the
 * record has no zone to read.
 */
function floodVerdict (pairs: Array<{ label: string, value: string }>, where: string): string {
  const sfha = pairs.find(p => /sfha/i.test(p.label))
  const zone = (pairs.find(p => /^(fld|flood)[ _]?zone$|^zone$|flood zone|zone( code)?$/i.test(p.label) && p.value.trim()) || { value: '' }).value.trim()
  const sub = (pairs.find(p => /zone ?sub|zone_subty|subtype/i.test(p.label)) || { value: '' }).value.trim()
  if (!zone && !sfha) return ''
  const inside = sfha ? /^(t|true|y|yes|1|in)$/i.test(sfha.value.trim()) : /^(a|ae|ah|ao|ar|a99|v|ve|a\d+|v\d+)\b/i.test(zone)
  const floodway = /floodway/i.test(sub)
  const z = zone ? `Zone ${zone}` : 'that zone'
  if (inside) return `**Yes.** ${where} is in FEMA flood ${z}${floodway ? ' (regulatory floodway)' : ''}, the Special Flood Hazard Area (1% annual chance, "100-year" floodplain). Flood insurance is usually required for federally backed mortgages.`
  if (/0\.2|500|shaded|b\b/i.test(`${zone} ${sub}`)) return `**No, but close.** ${where} is in ${z} (0.2% annual chance, "500-year" floodplain), outside the Special Flood Hazard Area.`
  return `**No.** ${where} is in ${z}, outside the FEMA Special Flood Hazard Area (minimal flood risk).`
}

/**
 * An area called by a value in any of its layer's short-list fields, not only its name field:
 * "R-8" in a zoning layer whose title field is something else. Only when one layer has it.
 */
function namedValue (phrase: string, layers: AskLayer[]): { layer: AskLayer, field: QueryField, value: string } | null {
  const key = phrase.toLowerCase().replace(/^(?:the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '')
  if (key.length < 2) return null
  const hits: Array<{ layer: AskLayer, field: QueryField, value: string }> = []
  for (const l of layers) {
    for (const name of Object.keys(l.values || {})) {
      const f = l.fields.find(x => x.name === name)
      const v = f ? (l.values![name] || []).find(x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '') === key) : undefined
      if (f && v !== undefined) { hits.push({ layer: l, field: f, value: v }); break }
    }
  }
  return hits.length === 1 ? hits[0] : null
}
