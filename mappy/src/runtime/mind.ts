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
import { parseIntent } from '../brain/intents'
import { addressPrompt, addressPlace, resultNumber } from '../brain/addresses'
import type { GeocoderSource } from '../brain/addresses'
import { geocodeAddress } from './geocoder'
import type { AddressResult } from './geocoder'
import { contextualCommand, normalizeCommand, splitCommands } from '../brain/conversation'
import { lexiconFor, readRequest, didYouMean } from '../brain/language'
import { matchTool, fillArgs, usableTools, needsConfirm, toolLabel, describeArgs, viewResult } from '../brain/mcpTools'
import type { McpPort, McpTool, MapContext } from '../brain/mcpTools'
import { parseAnalysis, analysisFollowup } from '../brain/analysis'
import type { AnalysisRequest } from '../brain/analysis'
import { dataIdeas } from '../brain/ideas'
import { withTimeout } from './live'
import { analyzeLayer } from './analysis'
import { V, pick } from '../brain/voice'
import { flat, clip, tokenize } from '../brain/text'
import type { LiveMap, LayerEntry, ToggleResult } from './live'
import { openWidget, openWidgetHelp, closeWidget, goPage, goDialog, goView, openUrl, widgetEl, bestWidgetId } from './navigate'
import { isShown, waitForBridge } from './layerList'

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
}

const STATUS_GLYPH: { [s: string]: string } = { on: '●', off: '○', hidden: '◐', scale: '◑' }
const STATUS_SR: { [s: string]: string } = { on: 'on', off: 'off', hidden: 'on, but its group is off', scale: 'on, not drawing at this scale' }

class LayerChoice extends Error {
  constructor (public query: string, public entries: LayerEntry[]) { super('Choose a layer') }
}

export class Mind {
  ctx: MindContext
  private lastLayer = ''
  private lastReply: Reply | null = null
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
  private mcpSequence = 0
  private mcpPending: { sequence: number, tool: McpTool, args: { [k: string]: any } } | null = null
  private mcpFailedAt = 0
  constructor (ctx: MindContext) { this.ctx = ctx }

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
        for (const f of ((e.sublayer || e.layer)?.fields || []) as any[]) names.push(f.name, f.alias || '')
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
    let read = { text: input, changed: false, swaps: [] as Array<[string, string]> }
    if (this.ctx.typoFix !== false && !this.lastAddress && !this.addressChoices && !/^__/.test(input)) {
      try { read = readRequest(input, lexiconFor(this.appNames(), this.ctx.index)) } catch (e) { }
    }
    // The reading is the request with typos fixed, polite words dropped, numbers in words as
    // digits ("fifty percent" to 50%) and other phrasings made plain; it equals the input otherwise.
    const text = read.text || input
    let reply = await this.mcpCommand(text)
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
    if (!read.swaps.length || reply.mood === 'sleep') return reply
    return { ...reply, text: `${reply.text}\n\n(I read that as “${read.text.replace(/[*_`]/g, '')}”.)` }
  }

  // ------------------------------------------------------------ MCP server

  private async serverTools (): Promise<McpTool[]> {
    const port = this.ctx.mcp
    if (!port) return []
    this.mcpTools = usableTools(await port.tools(), port.prefs)
    return this.mcpTools
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
      return { text: e instanceof Error ? e.message : `${port.label} did not answer.`, mood: 'confused' }
    }
    return null
  }

  private async askServer (q: string): Promise<Reply> {
    const port = this.ctx.mcp!
    const tools = await this.serverTools()
    const hit = matchTool(q, tools)
    if (!hit) {
      return { text: `I couldn't tell which of ${port.label}'s tools fits “${clip(q, 80)}”. Say “list server tools” to see them.`, mood: 'confused', suggest: ['List server tools'] }
    }
    return this.prepareTool(hit.tool, q)
  }

  private async prepareTool (tool: McpTool, text: string): Promise<Reply> {
    const port = this.ctx.mcp!
    const { args, missing } = fillArgs(tool, text, this.mapContext())
    const name = toolLabel(tool)
    if (missing.length) {
      const props = tool.inputSchema?.properties || {}
      return {
        text: `**${name}** needs ${missing.map(k => `${k}${props[k]?.description ? ` (${clip(props[k].description!, 60)})` : ''}`).join(', ')}. Try: “use ${tool.name} with ${missing.map(k => `${k}=...`).join(', ')}”.`,
        mood: 'think'
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
    return this.runTool(tool, args)
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

  private async runTool (tool: McpTool, args: { [k: string]: any }): Promise<Reply> {
    const port = this.ctx.mcp!
    this.track('mcp:' + tool.name)
    const view = viewResult(await port.call(tool.name, args), port.label)
    const actions: MappyAction[] = []
    if (view.point) actions.push({ type: 'ask', q: `zoom to ${view.point[0]}, ${view.point[1]}`, label: 'Zoom there' })
    const reply: Reply = { text: view.text, mood: view.error ? 'confused' : 'pleased', actions, sources: [{ title: port.label, detail: `${toolLabel(tool)} (${describeArgs(args)})` }] }
    if (view.table) reply.table = view.table
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
      return { ...reply, actions: [{ type: 'ask' as const, q: '__mcp:ask:' + text, label: `Ask ${port.label}` }, ...(reply.actions || [])].slice(0, 4) }
    } catch (e) { return reply }
  }

  private async respondRead (input: string): Promise<Reply> {
    if (this.contextView !== this.ctx.live.view) { this.lastLayer = ''; this.lastResults = []; this.lastReply = null; this.lastReadIntent = ''; this.lastReadScope = ''; this.lastAddress = ''; this.lastAnalysis = null; this.addressChoices = null; this.tablePage = null; this.contextView = this.ctx.live.view }
    input = normalizeCommand(input)
    if (input.length > 2000) return { text: 'Please keep each request under 2,000 characters.', mood: 'confused' }
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
    if (this.lastAnalysis?.kind === 'quality' && /^(?:(?:how many|count)(?: of)? (?:those|them|matches)|(?:show|put) (?:those|them|the results|the matches) in (?:a |the )?table)[?!]*$/i.test(input)) return { text: 'The quality report counts nulls separately for each field; one record can be missing several fields. Choose a “Missing” action for a specific field, or “Browse checked records” to inspect the full checked dataset.', mood: 'talk' }
    if (this.lastAnalysis?.limit && /^(?:how many|count)(?: of)? (?:those|them|matches)[?!]*$/i.test(input)) {
      const reply: Reply = { text: `I showed ${this.lastAnalysisRows} ranked ${this.lastAnalysisRows === 1 ? 'row' : 'rows'}. That is the displayed subset, not the full layer count.`, mood: 'talk' }
      this.lastReply = reply
      return reply
    }
    input = analysisFollowup(input, this.lastAnalysis) || input
    if (follow && this.lastReadIntent) input = `${this.lastReadIntent} ${follow[1]}${this.lastReadScope}`
    if (!['thanks', 'greet'].includes(parseIntent(input).name)) { this.addressChoices = null; this.lastAddress = '' }
    if (input.length > 2000) return { text: 'Please keep each request under 2,000 characters.', mood: 'confused' }
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
    const raw = input.trim()
    if (raw.startsWith('__doc:')) return this.aboutDoc(raw.slice(6))
    const it = parseIntent(raw)
    this.track(it.name)
    try {
      const address = addressPrompt(raw)
      // An explicitly named layer always keeps its feature-search semantics.
      if (address && !(it.name === 'find' && it.scope && this.ctx.live.find(it.scope))) return await this.locateAddress(address)
      const analysis = parseAnalysis(raw)
      if (analysis) {
        this.lastAnalysis = null
        this.lastReadIntent = ''; this.lastReadScope = ''
        this.lastResults = []; this.tablePage = null
        if (!this.ctx.featureSearch) return { text: 'Data queries are disabled by the app author.', mood: 'confused' }
        const e = this.resolveLayer(analysis.layer)
        if (!e) return { text: `I cannot identify "${analysis.layer}". Use its full layer name.`, mood: 'confused', suggest: ['List layers'] }
        if (!this.ctx.live.canSee(e)) return this.offReply(e)
        this.lastLayer = e.path
        try {
          const reply = await analyzeLayer(this.ctx.live, e, analysis, this.ctx.maxResults)
          this.lastAnalysis = { ...analysis, layer: e.key }
          this.lastAnalysisRows = reply.table?.rows.length || reply.results?.length || 0
          if (!analysis.limit && ['filter', 'browse', 'countWhere'].includes(analysis.kind)) reply.suggest = analysis.kind === 'countWhere'
            ? ['Show them in a table']
            : ['How many of those?', ...(analysis.kind === 'filter' ? ['Show them in a table'] : [])]
          if (reply.page && !analysis.inView && !analysis.limit) this.tablePage = { key: e.key, condition: analysis.condition, field: analysis.field, order: analysis.order, ...reply.page }
          else this.tablePage = null
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
        case 'undo': return { text: this.ctx.live.undo(), mood: 'acknowledge' }
        case 'forget': this.lastLayer = ''; this.lastResults = []; this.lastReply = null; this.lastReadIntent = ''; this.tablePage = null; return { text: 'Conversation context cleared. What would you like to explore?', mood: 'wave' }
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
        case 'thanks': return { text: V.thanks(), mood: 'pleased' }
        case 'whoami': return { text: V.whoami(this.ctx.name), mood: 'wave' }
        case 'help': return this.help()
        case 'joke': return { text: V.joke(), mood: 'celebrate' }
        case 'sleep': return { text: V.sleep(), mood: 'sleep' }
        case 'tip': return this.tip() || { text: "I'm all out of tips. Ask me anything!", mood: 'happy' }
        case 'about': return this.about()
        case 'clear': this.ctx.live.clear(); this.lastResults = []; this.tablePage = null; return { text: 'Cleared.', mood: 'acknowledge' }
        case 'home': return this.needMap(async () => { await this.ctx.live.goHome(); return { text: 'Back to the starting view.', mood: 'acknowledge' } })
        case 'zoom': return this.needMap(async () => { await this.ctx.live.zoom(it.value === 'out' ? 'out' : 'in'); return { text: it.value === 'out' ? 'Zoomed out.' : 'Zoomed in.', mood: 'acknowledge' } })
        case 'whereami': return this.needMap(async () => ({ text: this.ctx.live.whereAmI() || V.noMap(), mood: 'talk' }))
        case 'listLayers': return this.listLayers(it.value === 'visible')
        case 'layerDiagnosis': return this.diagnoseLayer(it.target!)
        case 'listTables': {
          const tables = this.ctx.live.entries().filter(e => e.isTable)
          return { text: tables.length ? 'Tables connected to this map:' : 'No standalone tables are connected. You can still browse a feature layer with "show table" followed by its name.', mood: 'talk', list: tables.map(e => ({ label: e.title, action: { type: 'ask', q: `show table ${e.key}`, label: `Open ${e.title}` } })), suggest: ['What can you do?'] }
        }
        case 'listWidgets': return this.listKind(['widget'], 'Here are the tools in this app:')
        case 'listPages': return this.listKind(['page', 'view', 'dialog'], 'Here are the pages, views and windows:')
        case 'listBookmarks': return this.listKind(['bookmark'], 'Saved places on the map:')
        case 'listLinks': return this.listKind(['link'], 'Links in this app:')
        case 'listPresets': return this.listPresets()
        case 'preset': return this.applyPreset(it.target!)
        case 'favorites': return this.favorites()
        case 'openLayerList': return this.openLayerList()
        case 'allOff': return this.needMap(async () => this.allOff())
        case 'allOn': return this.needMap(async () => this.allOn(it.value === 'force'))
        case 'solo': return this.needMap(async () => this.solo(it.target!))
        case 'reveal': return this.needMap(async () => this.revealByName(it.target!))
        case 'layerOn': case 'layerOff': return this.toggle(it.target!, it.name === 'layerOn', raw)
        case 'opacity': return this.opacity(it.target!, Number(it.value))
        case 'fields': return this.fields(it.target!, raw)
        case 'count': return this.count(it.target!, it.scope === 'view', raw)
        case 'find': return await this.find(it.target!, it.scope, raw)
        case 'close': return await this.close(it.target!, raw)
        case 'goto': return await this.goto(it.target!, raw)
        case 'open': return await this.open(it.target!, raw)
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
    if (shown) choice.selected = index
    const reply: Reply = { text: shown ? `Showing **${result.label}**. Locator match score: ${result.score}.` : 'I found the address but could not move the map. Try the search again.', mood: shown ? 'pleased' : 'confused', sources: [{ title: result.source, detail: 'Live ArcGIS address candidate' }] }
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
        { label: 'Explore the app', detail: 'List tools · open print · list pages · list bookmarks', action: { type: 'ask', q: 'List tools' } },
        { label: 'Control layers', detail: 'Turn on parcels · only show zoning · set parcels opacity to 50%', action: { type: 'ask', q: 'List layers' } },
        { label: 'Find and count', detail: 'Find Smith in parcels · count parcels in view' },
        { label: 'Analyze fields', detail: 'Summarize acres in parcels · count parcels by zoning' },
        { label: 'Browse table rows', detail: 'List tables · show table parcels · next page', action: { type: 'ask', q: 'List tables' } },
        { label: 'Search by condition', detail: 'Select parcels where acres > 5 · count parcels where zoning equals R-1' },
        { label: 'Navigate precisely', detail: 'Zoom to 39.0639, -108.5506 · scale 1:5000' },
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
    return ['What can you do?', 'Explore data', ...(entries.length ? ['List layers'] : ['What tools are there?']), ...(table ? [`Show table ${table.title}`] : []), ...(layer ? [`Count ${layer.title} in view`] : ['What is this app?'])].slice(0, 5)
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
    return { text: `Local assistant ready. ${this.ctx.live.ready ? 'Map connected.' : 'No active map connected.'} ${entries.filter(e => !e.isGroup).length} layers and tables; ${entries.filter(e => !e.isGroup && this.ctx.live.isVisible(e)).length} enabled. ${this.ctx.featureSearch ? 'Data queries enabled.' : 'Data queries disabled.'} No LLM is used. Map services and imported help may still require network access.`, mood: 'talk', table: { columns: ['Knowledge source', 'Documents'], rows: Array.from(sources, ([source, count]) => [source, count.toLocaleString()]) }, suggest: ['What can you do?', 'List layers', 'List tools'] }
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

  aboutDoc (id: string): Reply {
    const d = this.ctx.index.getById(id)
    if (!d) return { text: V.notFound(id), mood: 'confused' }
    return { text: describeDoc(d), actions: d.actions, mood: 'talk' }
  }

  private featureReply (raw: string, results: any[]): Reply {
    this.ctx.beacon?.action('feature-search')
    if (results.length) this.lastLayer = results[0].entry.path
    return { text: V.found(results.length, raw) + ' Choose a result to zoom to it.', mood: 'celebrate', results }
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
    const names = info.fields.length ? info.fields.map(f => f.alias || f.name) : (hint?.fields || []).map(f => f[1])
    const useful = names.filter(n => !/^(objectid|globalid|shape|shape[._].*|fid)$/i.test(n))
    const d = this.ctx.index.getById((e.isTable ? 'table:' : 'layer:') + e.key)
    const desc = d && d.text ? clip(d.text.split(' Fields:')[0], 260) : ''
    return {
      text: `**${e.title}**${e.depth ? ` (in ${e.path.split(' > ').slice(0, -1).join(' > ')})` : ''} ${desc ? '- ' + desc + ' ' : ''}${useful.length ? `It has ${useful.length} fields: ${clip(useful.join(', '), 600)}.` : "I couldn't read its fields."}`,
      mood: 'talk',
      actions: [{ type: 'ask', q: `show table ${e.key}`, label: 'Browse rows' }, ...(!e.isTable ? [{ type: 'zoomLayer' as const, id: e.key, label: 'Zoom to it' }] : []), { type: 'reveal', id: e.key, label: 'Show in the layer list' }]
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
