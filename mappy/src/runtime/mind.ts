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
import { parseAnalysis, analysisFollowup, resultCountFollowup, resultTableFollowup, tablePhrase } from '../brain/analysis'
import { reviseTask, taskSummary } from '../brain/task'
import type { TaskOperation, TaskSummary } from '../brain/task'
import type { AnalysisRequest } from '../brain/analysis'
import { dataIdeas } from '../brain/ideas'
import { withTimeout } from './live'
import { analyzeLayer } from './analysis'
import type { TableRequest, TableResult } from './tableWidget'
import { Fun, type Place } from '../brain/fun'
import { definitionAsk, lookupTerm, codeGuess, outOfScope, CODE_SHAPE } from '../brain/glossary'
import { V, pick } from '../brain/voice'
import { rand } from '../brain/random'
import { flat, clip, tokenize, stripTags } from '../brain/text'
import type { LiveMap, LayerEntry, ToggleResult } from './live'
import type { LayerInfo } from '../brain/layers'
import { completeText, addressFragment, withAddress, addressQuestions } from '../brain/complete'
import type { CompleteSource } from '../brain/complete'
import { suggestAddresses } from './geocoder'
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
  /** Where the person is (the device's location), when they allow it. */
  myLocation?: () => Promise<[number, number] | null>
  /** Jokes, riddles and games. Undefined means on. */
  fun?: boolean
  /** Who runs the app and where it is: org ("the City"), place name, website, local facts. */
  place?: Place
  /** This widget's id, named as the source when records go to the Table widget. */
  widgetId?: string
  /** What the knowledge feed gave him ("feed 2026.10.29: language pack ..., 18 answers"), for diagnostics. */
  feedInfo?: string
  /** Puts records in the app's Table widget; absent when the app has none (or in tests). */
  openInTable?: (entry: LayerEntry, req: TableRequest) => Promise<TableResult>
}

const STATUS_GLYPH: { [s: string]: string } = { on: '●', off: '○', hidden: '◐', scale: '◑' }
const STATUS_SR: { [s: string]: string } = { on: 'on', off: 'off', hidden: 'on, but its group is off', scale: 'on, not drawing at this scale' }

class LayerChoice extends Error {
  constructor (public query: string, public entries: LayerEntry[]) { super('Choose a layer') }
}

/** Requests about the conversation itself: "try again" never re-runs these. */
const META = new Set(['tryAgain', 'mapSummary', 'copyAnswer', 'exportChat', 'tourNext', 'tourStop', 'changes', 'repeat', 'speak', 'help', 'diagnostics', 'greet', 'thanks', 'ack', 'cancel', 'undo', 'forget', 'clicked', 'tip', 'joke', 'whoami', 'about', 'sleep', 'resize', 'moveCorner', 'pause'])

export class Mind {
  ctx: MindContext
  private lastLayer = ''
  private lastReply: Reply | null = null
  /** The last thing the user typed that was not a chip or control word, for "try again". */
  private lastInput = ''
  /** Guided tour: the widget docs still to visit, and the one being shown. */
  private tour: { stops: Doc[], at: number } | null = null
  private lastResults: any[] = []
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
  private mcpDraft: { tool: McpTool, args: { [k: string]: any }, missing: string[], place?: PlaceQuestion } | null = null
  private placeConversation: PlaceQuestion | null = null

  private syncMcp (): void {
    const port = this.ctx.mcp
    const prefs = JSON.stringify(port?.prefs || [])
    if (port !== this.mcpPort || prefs !== this.mcpPrefs) {
      this.mcpResults = null
      this.mcpPort = port; this.mcpPrefs = prefs
      this.mcpTools = []; this.mcpPending = null; this.mcpDraft = null; this.mcpFailedAt = 0
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
    this.awaitingPlace = null; this.placeConversation = null; this.lastPlace = null; this.lastToolData = null; this.mcpDraft = null; this.mcpPending = null; this.placeNames.clear()
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
    if (!this.ctx.live.canSee(entry)) return this.offReply(entry)
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
    const reply = await this.respondInner(input)
    if (!control && !/^__/.test(input) && !META.has(parseIntent(input).name)) this.lastInput = input
    if (this.locationNote) { this.locationNote = false; reply.text = `I could not get your location (it may be turned off for this site), so this is for the middle of the map.\n\n${reply.text}` }
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
      places: !!((this.ctx.geocoders?.length && live.view) || this.ctx.mcp)
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
    const continued = this.placeConversation && followPlaceQuestion(plain, this.placeConversation)
    if (continued) input = continued
    let read = { text: input, changed: false, swaps: [] as Array<[string, string]> }
    if (this.ctx.typoFix !== false && !this.lastAddress && !this.addressChoices && !this.awaitingPlace && !parsePlaceQuestion(normalizeCommand(input)) && !outOfScope(normalizeCommand(input), this.org()) && !DISTANCE_Q.test(normalizeCommand(input)) && !OWNED_Q.test(normalizeCommand(input)) && !/^__/.test(input)) {
      try { read = readRequest(input, lexiconFor(this.appNames(), this.ctx.index)) } catch (e) { }
    }
    // The reading is the request with typos fixed, polite words dropped, numbers in words as
    // digits ("fifty percent" to 50%) and other phrasings made plain; it equals the input otherwise.
    const text = read.text || input
    let reply = await this.mcpCommand(text)
    if (!reply) reply = await this.placeQuestion(text, input)
    if (reply) this.lastReply = reply
    else reply = await this.offerServer(text, await this.respondRead(text))
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
    // Only mention real fixes, not "whats" to "what's".
    const fixed = read.swaps.filter(([a, b]) => a.replace(/['’]/g, '').toLowerCase() !== b.replace(/['’]/g, '').toLowerCase())
    if (!fixed.length || reply.mood === 'sleep') return reply
    return { ...reply, text: `${reply.text}\n\n(I read that as “${read.text.replace(/[*_`]/g, '')}”.)` }
  }

  // ------------------------------------------------------------ MCP server

  private async serverTools (): Promise<McpTool[]> {
    const port = this.ctx.mcp
    if (!port) return []
    const prefs = JSON.stringify(port.prefs || [])
    const tools = await port.tools()
    if (port !== this.ctx.mcp || prefs !== JSON.stringify(port.prefs || [])) throw new Error('The server settings changed. Please ask again.')
    this.mcpTools = usableTools(tools, port.prefs)
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
    const thisPlace = q.match(THIS_PLACE)
    if (thisPlace && parsePlaceQuestion(q.replace(THIS_PLACE, ' 1 Main St'))) {
      const spot = this.recentPlace()
      if (spot) {
        q = q.replace(THIS_PLACE, ` ${spot.lat.toFixed(6)}, ${spot.lon.toFixed(6)}`)
        spotLabel = spot.label
        fromPopup = !!spot.popup
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
              const found = niceAddress(String(this.lastToolData?.address || reply.text.match(/address:?\s*([^.\n]+)/i)?.[1] || '').split(',')[0].trim())
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
    if (!serverOn) { if (this.awaitingPlace) this.awaitingPlace = null; return null }
    if (Date.now() - this.mcpFailedAt < 60000) return null
    let tools: McpTool[] = []
    try { tools = await this.serverTools() } catch (e) { this.mcpFailedAt = Date.now(); return null }
    const fits = rankTools(q, tools).filter(r => placeToolFits(r.tool, pq))
    if (!fits.length) return null
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
      return { text: e instanceof Error ? e.message : `${port.label} did not answer.`, mood: 'alert' }
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
    else if (pq.yesNo) reply.text = `**Yes.** ${where} is in ${layer}${named ? ` (${named.value})` : ''}.`
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
          const raw = await port.call(tool.name, { [placeKeys(tool).address!]: w })
          const c = raw?.structuredContent?.candidates?.[0] || raw?.structuredContent?.results?.[0]
          const lat = Number(c?.latitude ?? c?.location?.y); const lon = Number(c?.longitude ?? c?.location?.x)
          if (Number.isFinite(lat) && Number.isFinite(lon) && (c?.score == null || c.score >= 75)) return { label: niceAddress(String(c.address || w).split(',')[0]), at: [lat, lon] }
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
    const m = t.match(/^(?:(?:get |give me |show me )?(?:driving |walking |biking |cycling )?directions\s+(?:to|for)\s+|how (?:do|can|would) i (?:get|drive|walk|bike|go|travel) to\s+|(?:route|drive|walk)\s+(?:me\s+)?to\s+|(?:what(?:'s| is) the )?(?:best |fastest |quickest )?(?:way|route) to\s+)(.+?)(?:\s+from\s+(.+))?$/i)
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
        if (tool) {
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
      mood: 'pleased',
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
    else if (pq.yesNo) reply.text = `**Yes.** ${spot.label} is in ${entry.title}${named ? ` (${named})` : ''}.`
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
    const next = followUps({ ...pq, place: pq.place || spot.label }, q, this.layerTest())
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
  private toLatLon (p: any): [number, number] | null {
    if (!p) return null
    if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) return [p.latitude, p.longitude]
    const sr = p.spatialReference
    const x = Number(p.x); const y = Number(p.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (!sr || sr.isWGS84 || sr.wkid === 4326) return Math.abs(y) <= 90 && Math.abs(x) <= 180 ? [y, x] : null
    if (sr.isWebMercator || [102100, 3857, 102113].includes(sr.wkid)) {
      return [(Math.PI / 2 - 2 * Math.atan(Math.exp(-y / 6378137))) * 180 / Math.PI, x / 6378137 * 180 / Math.PI]
    }
    return null
  }

  /** The map right now, in longitude and latitude, for tool inputs the request leaves out. */
  private mapContext (): MapContext | undefined {
    const view: any = this.ctx.live.view
    if (!view) return undefined
    const toLL = (x: number, y: number): [number, number] | null => {
      const sr = view.spatialReference
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      if (sr?.isWGS84 || sr?.wkid === 4326) return [y, x]
      if (sr?.isWebMercator || [102100, 3857, 102113].includes(sr?.wkid)) {
        const lon = x / 6378137 * 180 / Math.PI
        const lat = (Math.PI / 2 - 2 * Math.atan(Math.exp(-y / 6378137))) * 180 / Math.PI
        return [lat, lon]
      }
      return null
    }
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
    const raw = await port.call(tool.name, args)
    if (map !== this.ctx.live.view || port !== this.ctx.mcp || prefs !== JSON.stringify(port.prefs || [])) { this.lastToolData = null; return { text: 'The map or server settings changed while I was working. Please ask again.', mood: 'confused' } }
    this.lastToolData = raw && !raw.isError ? raw.structuredContent ?? null : null
    const view = viewResult(raw, port.label)
    const actions: MappyAction[] = []
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

  /** When Mappy is stuck, offer the server's best-fitting tool as a button (nothing is sent until it is pressed). */
  private async offerServer (text: string, reply: Reply): Promise<Reply> {
    const port = this.ctx.mcp
    if (!port || port.fallback === false || reply.mood !== 'confused' || /^__/.test(text)) return reply
    try {
      if (Date.now() - this.mcpFailedAt < 60000) return reply
      let tools: McpTool[] = []
      try { tools = await this.serverTools() } catch (e) { this.mcpFailedAt = Date.now(); return reply }
      const hit = matchTool(text, tools)
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
          : /^(?:remove|clear|drop) (?:my |the )?filter$/.test(said) ? 'unfilter'
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
    const tableFollow = resultTableFollowup(input)
    if (this.lastAnalysis?.kind === 'quality' && (countFollow || tableFollow)) return { text: 'The quality report counts nulls separately for each field; one record can be missing several fields. Choose a “Missing” action for a specific field, or “Browse checked records” to inspect the full checked dataset.', mood: 'talk' }
    if (this.lastAnalysis?.limit && countFollow) {
      const reply: Reply = { text: `I showed ${this.lastAnalysisRows} ranked ${this.lastAnalysisRows === 1 ? 'row' : 'rows'}. That is the displayed subset, not the full layer count.`, mood: 'talk' }
      this.lastReply = reply
      return reply
    }
    if (this.lastAnalysis && (this.lastAnalysis.limit || ['stats', 'group'].includes(this.lastAnalysis.kind)) && tableFollow) {
      return { text: 'That was a ranked or summarized result, so there is no single set of rows to open. Ask for the layer itself, for example “show table” and its name.', mood: 'talk' }
    }
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
    // Easter eggs: jokes, riddles, dances, games. Only exact little phrases, never a real question.
    if (this.ctx.fun !== false) this.fun.setPlace(this.ctx.place)
    const fun = this.ctx.fun === false ? null : this.fun.reply(raw)
    if (fun) {
      if (fun.effect === 'nullIsland' && this.ctx.live.view) { try { await this.ctx.live.view.goTo({ center: [0, 0], zoom: 5 }) } catch (e) { } }
      return { text: fun.text, mood: fun.mood as any, ...(fun.suggest ? { suggest: fun.suggest } : {}) }
    }
    // "What is a parcel", "what does RM-8 mean": meanings, from the map's own code lists or the glossary.
    const it = parseIntent(raw)
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
      const analysis = parseAnalysis(inChat ? raw.replace(/\s+in (?:the )?chat$/i, '') : raw)
      if (analysis) {
        this.lastAnalysis = null
        this.lastReadIntent = ''; this.lastReadScope = ''
        this.lastResults = []; this.tablePage = null
        if (!this.ctx.featureSearch) return { text: 'Data queries are disabled by the app author.', mood: 'confused' }
        const e = this.resolveLayer(analysis.layer)
        if (!e) return { text: `I cannot identify "${analysis.layer}". Use its full layer name.`, mood: 'confused', suggest: ['List layers'] }
        if (!this.ctx.live.canSee(e)) return this.offReply(e)
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
          return { text: this.ctx.live.undo(), mood: 'acknowledge' }
        }
        case 'forget': this.lastLayer = ''; this.lastResults = []; this.lastReply = null; this.lastReadIntent = ''; this.tablePage = null; this.lastAnalysis = null; this.dataTask = null; this.layerPick = null; return { text: 'Conversation context cleared. What would you like to explore?', mood: 'wave' }
        case 'diagnostics': return this.diagnostics()
        case 'coordinates': return this.needMap(async () => {
          const latitude = Number(it.target); const longitude = Number(it.value)
          if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { text: 'Use latitude, longitude: latitude -90 to 90 and longitude -180 to 180.', mood: 'confused' }
          await this.ctx.live.view.goTo({ center: [longitude, latitude], zoom: 16 })
          return { text: `Centered at ${latitude}, ${longitude} (latitude, longitude).`, mood: 'acknowledge' }
        })
        case 'scale': return this.needMap(async () => {
          const scale = Number(it.value)
          if (!Number.isFinite(scale) || scale < 100 || scale > 1000000000) return { text: 'Use a scale between 1:100 and 1:1,000,000,000.', mood: 'confused' }
          await this.ctx.live.view.goTo({ scale })
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
        case 'zoom': return this.needMap(async () => { await this.ctx.live.zoom(it.value === 'out' ? 'out' : 'in'); return { text: it.value === 'out' ? 'Zoomed out.' : 'Zoomed in.', mood: 'acknowledge' } })
        case 'whereami': return this.needMap(async () => ({ text: this.ctx.live.whereAmI() || V.noMap(), mood: 'talk' }))
        case 'listLayers': return this.listLayers(it.value === 'visible')
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
        case 'exportChat': return { text: 'Saving this conversation as a text file.', mood: 'save', effect: 'export' }
        case 'repeat': return this.lastReply ? { ...this.lastReply, pointAt: undefined } : { text: 'I have not said anything yet. Ask me something!', mood: 'think' }
        case 'speak': { const last = this.lastReply; return last ? { ...last, text: `Reading that aloud: ${last.text.replace(/\*\*/g, '')}`, mood: 'talk', effect: 'speak', pointAt: undefined } : { text: 'Nothing to read yet.', mood: 'think' } }
        case 'resize': return { text: it.value === 'smaller' ? 'Shrinking!' : 'Growing!', mood: 'excited', effect: it.value === 'smaller' ? 'smaller' : 'bigger' }
        case 'moveCorner': return { text: 'Scooting over.', mood: 'acknowledge', effect: it.value === 'left' ? 'left' : it.value === 'right' ? 'right' : 'otherCorner' }
        case 'pause': return it.value === 'on' ? { text: 'Holding still. Say "animate again" when you want me moving.', mood: 'acknowledge', effect: 'pause' } : { text: 'Wheee, I can move again!', mood: 'excited', effect: 'resume' }
        case 'open': return withAct(await this.open(it.target!, raw), it.target === 'print' ? 'print' : it.target === 'share' ? 'mail' : null)
        case 'howto': return this.ask(it.target!, raw)
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
      return { text: `I found ${found.results.length} possible address matches. Choose one, or say “show the first result”. Locator scores describe match quality, not guaranteed accuracy.`, mood: 'talk',
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
      const ll = this.toLatLon(result.location)
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
      text: `I use ${this.ctx.appTitle}'s tools, help and map metadata to answer locally. No AI account or model needed. Use exact layer and field names for analysis. Join up to five commands with "then"; follow up with "zoom to it" or "how many in view". Say "undo" to reverse my layer visibility and opacity changes.`,
      mood: 'wave',
      list: [
        { label: 'Get questions for my data', detail: 'Choose a layer and get questions based on its actual fields.', action: { type: 'ask', q: 'Explore data' } },
        { label: 'Take the tour', detail: 'Show me around · next · stop tour', action: { type: 'ask', q: 'Show me around' } },
        { label: 'Explore the app', detail: 'List tools · open print · list pages · list bookmarks', action: { type: 'ask', q: 'List tools' } },
        { label: 'Control layers', detail: 'Turn on parcels · only show zoning · set parcels opacity to 50%', action: { type: 'ask', q: 'List layers' } },
        { label: 'Find and count', detail: 'Find Smith in parcels · count parcels in view' },
        { label: 'Analyze fields', detail: 'Summarize acres in parcels · count parcels by zoning' },
        { label: 'Browse table rows', detail: 'List tables · show table parcels · next page', action: { type: 'ask', q: 'List tables' } },
        ...(this.ctx.fun === false ? [] : [{ label: 'Have some fun', detail: 'Jokes · riddles · fun facts · get wizardy · paper airplane · what are you wearing · what tricks can you do', action: { type: 'ask' as const, q: 'What tricks can you do?' } }]),
        { label: 'Search by condition', detail: 'Parcels bigger than 5 acres · parcels edited in the last 7 days · what percent of parcels are over 5 acres · average acres by zoning in parcels' },
        { label: 'Ask what things mean', detail: 'What is an easement · what does R-4 mean · what zoning types are there', action: { type: 'ask', q: 'What is a parcel?' } },
        { label: 'Move around', detail: 'Zoom to 39.0639, -108.5506 · scale 1:5000 · go back · satellite view · directions to City Hall' },
        ...(this.ctx.mcp || this.ctx.live.parcelLayers().length ? [{ label: 'Ask about a place', detail: 'Who owns 250 N 5th St · what zone is it in · when is trash pickup · closest hydrant · how far is it from City Hall', action: { type: 'ask' as const, q: 'Tell me about my address' } }] : []),
        { label: 'Look back', detail: "What's on the map · what did I change · undo · try again · what did I click (with a popup open) · copy that · export chat", action: { type: 'ask', q: 'What did I change' } },
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
    if (!live.canSee(e)) return this.offReply(e)
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
    return { text: `Local assistant ready. ${this.ctx.live.ready ? 'Map connected.' : 'No active map connected.'} ${entries.filter(e => !e.isGroup).length} layers and tables; ${entries.filter(e => !e.isGroup && this.ctx.live.isVisible(e)).length} enabled. ${this.ctx.featureSearch ? 'Data queries enabled.' : 'Data queries disabled.'} No LLM is used. Map services and imported help may still require network access.${this.ctx.feedInfo ? ' Knowledge ' + this.ctx.feedInfo + '.' : ''}`, mood: 'talk', table: { columns: ['Knowledge source', 'Documents'], rows: Array.from(sources, ([source, count]) => [source, count.toLocaleString()]) }, suggest: ['What can you do?', 'List layers', 'List tools'] }
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
    return { text: `${V.tipLead()} ${describeDoc(d)}`, actions: d.actions?.slice(0, 2), mood: 'wave' }
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
    if (!live.canSee(e)) return this.offReply(e)
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
    if (!live.canSee(e)) return this.offReply(e)
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
    if (!this.ctx.live.canSee(e)) return this.offReply(e)
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
