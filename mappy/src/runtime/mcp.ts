/*
  mcp.ts - a small Model Context Protocol client for the browser (Streamable HTTP transport,
  protocol 2025-06-18). Talks JSON-RPC to one MCP server: initialize, tools/list, tools/call.
  Answers may come back as JSON or as a short event stream; both are read.

  The server must allow this app's origin (CORS) and expose the Mcp-Session-Id header. A
  server that only runs on stdio (most desktop MCP servers) needs a bridge such as mcp-proxy;
  see docs/mcp.md. No esri imports; the ArcGIS sign-in token comes in through getToken.
*/
import type { McpTool } from '../brain/mcpTools'

export type McpAuth = 'none' | 'arcgis' | 'header'

export interface McpSettings {
  /** Streamable HTTP endpoint, https (http only for localhost). */
  url: string
  /** What people call it in the chat ("ArcGIS Location Services"). */
  label?: string
  auth?: McpAuth
  /** For 'header': the header name and value (an API key restricted to this app's address). */
  headerName?: string
  headerValue?: string
  /** Offer the server when Mappy cannot answer from the app himself. Undefined means on. */
  fallback?: boolean
  /**
   * For 'arcgis': when the server refuses the sign-in in a header, send it as ?token= in the
   * address, the way ArcGIS web addresses carry it. Off unless the builder turns it on: an
   * address can end up in server and proxy logs.
   */
  tokenInAddress?: boolean
  tools?: Array<{ name: string, enabled: boolean, confirm?: boolean }>
}

const PROTOCOL = '2025-06-18'
/** Versions this client can speak; the server picks one in its initialize answer. */
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const TIMEOUT = 30000

export function safeServerUrl (url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))
  } catch (e) { return false }
}

/** The JSON-RPC message with this id inside an event stream body. */
function fromStream (body: string, id: number): any {
  let found: any = null
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
    if (!data) continue
    try {
      const msg = JSON.parse(data)
      const list = Array.isArray(msg) ? msg : [msg]
      const hit = list.find(m => m && m.id === id)
      if (hit) found = hit
    } catch (e) { }
  }
  return found
}

export class McpClient {
  private session = ''
  private ready: Promise<any> | null = null
  private seq = 0
  private toolCache: McpTool[] | null = null
  /** The protocol version the server chose (sent on every request after initialize). */
  private version = PROTOCOL
  serverName = ''
  /** How the ArcGIS sign-in is sent: a Bearer header, ArcGIS's own header, or (only if allowed) in the address. The first one the server accepts is kept. */
  private tokenStyle: 'bearer' | 'esri' | 'query' = 'bearer'
  private token = ''

  constructor (private cfg: McpSettings, private getToken?: () => Promise<string | null> | string | null, private fetcher: typeof fetch = (...a) => fetch(...a)) {
    if (!safeServerUrl(cfg.url)) throw new Error('The MCP server address must start with https:// (http:// only for localhost).')
  }

  get label (): string { return this.cfg.label || this.serverName || 'the MCP server' }

  private async headers (): Promise<{ [k: string]: string }> {
    const h: { [k: string]: string } = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (this.session) h['mcp-session-id'] = this.session
    if (this.ready) h['mcp-protocol-version'] = this.version
    if (this.cfg.auth === 'arcgis' && this.getToken) {
      const token = await this.getToken()
      this.token = token || ''
      if (token && this.tokenStyle === 'bearer') h.authorization = 'Bearer ' + token
      else if (token && this.tokenStyle === 'esri') h['x-esri-authorization'] = 'Bearer ' + token
    }
    if (this.cfg.auth === 'header' && this.cfg.headerName && this.cfg.headerValue && /^[A-Za-z0-9-]+$/.test(this.cfg.headerName)) h[this.cfg.headerName.toLowerCase()] = this.cfg.headerValue
    return h
  }

  private async post (method: string, params: any, notify = false, retried = false, timeout = TIMEOUT): Promise<any> {
    const id = notify ? undefined : ++this.seq
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    // One timer covers the whole exchange, body included: a server may keep the stream open.
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null
    try {
      return await this.exchange(method, params, id, notify, retried, ctrl)
    } catch (e) {
      if (e?.name === 'AbortError') throw new Error(`${this.label} took too long to answer.`)
      throw e
    } finally { if (timer) clearTimeout(timer) }
  }

  /** Reads an event stream until the answer with this id arrives, then stops listening. */
  private async readStream (res: Response, id: number): Promise<any> {
    const reader = (res as any).body?.getReader?.()
    if (!reader) return fromStream(await res.text(), id)
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (value) buffer += decoder.decode(value, { stream: true })
        const separators = Array.from(buffer.matchAll(/\r?\n\r?\n/g))
        const last = separators[separators.length - 1]
        const cut = last ? last.index! + last[0].length : -1
        if (cut >= 0) {
          const hit = fromStream(buffer.slice(0, cut), id)
          if (hit) return hit
        }
        if (done) return fromStream(buffer + '\n\n', id)
        if (buffer.length > 5000000) throw new Error(`${this.label} sent too much.`)
      }
    } finally { try { reader.cancel() } catch (e) { } }
  }

  private async exchange (method: string, params: any, id: number | undefined, notify: boolean, retried: boolean, ctrl: AbortController | null): Promise<any> {
    let res: Response
    try {
      const headers = await this.headers()
      const address = this.tokenStyle === 'query' && this.token ? `${this.cfg.url}${this.cfg.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}` : this.cfg.url
      res = await this.fetcher(address, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notify ? {} : { id }) }), signal: ctrl?.signal, credentials: 'omit' } as any)
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      throw new Error(`Could not reach ${this.label}. It may be offline, or it does not allow this app's address (CORS).`)
    }
    const sid = res.headers.get('mcp-session-id')
    if (sid && res.status !== 401 && res.status !== 403) this.session = sid
    if (res.status === 404 && this.session && !retried && method !== 'initialize') {
      // The server forgot the session: start a new one and try once more.
      this.session = ''; this.ready = null; await this.connect()
      return this.post(method, params, notify, true)
    }
    if (res.status === 401 && this.cfg.auth === 'arcgis' && this.token && method === 'initialize') {
      // At the handshake: the server may take the same sign-in another way.
      const next = this.tokenStyle === 'bearer' ? 'esri' : this.tokenStyle === 'esri' && this.cfg.tokenInAddress ? 'query' : null
      if (next) { this.tokenStyle = next; return this.exchange(method, params, id, notify, retried, ctrl) }
      this.tokenStyle = 'bearer'
    }
    if (res.status === 401 || res.status === 403) {
      // Say what to change: a server that wants the ArcGIS sign-in, or a key.
      const challenge = res.headers.get('www-authenticate') || ''
      const hint = this.cfg.auth === 'arcgis'
        ? (res.status === 403 ? ' Your account cannot use it.' : ' Sign in to ArcGIS with an account it accepts.')
        : /bearer/i.test(challenge) ? ' In Mappy\'s settings, set "Sign in with" to the signed-in ArcGIS user, or a key in a header.' : ''
      throw new Error(`${this.label} needs a sign-in or key that this app does not have (${res.status}).${hint}`)
    }
    if (res.status === 429) throw new Error(`${this.label} is busy right now. Try again in a minute.`)
    if (!res.ok && res.status !== 202) throw new Error(`${this.label} answered ${res.status}.`)
    if (notify) return null
    const type = res.headers.get('content-type') || ''
    let msg: any = null
    if (type.includes('text/event-stream')) msg = await this.readStream(res, id as number)
    else { try { const j = JSON.parse(await res.text()); msg = Array.isArray(j) ? j.find(m => m.id === id) : j } catch (e) { } }
    if (!msg) throw new Error(`${this.label} sent an answer I could not read.`)
    if (msg.error) throw new Error(`${this.label}: ${msg.error.message || 'error ' + msg.error.code}`)
    return msg.result
  }

  /** Opens the session once; later calls wait on the same handshake. */
  connect (): Promise<any> {
    if (!this.ready) {
      const p = this.post('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'mappy', title: 'Mappy (ArcGIS Experience Builder)', version: '1.11.0' } })
        .then(async r => {
          const v = String(r?.protocolVersion || PROTOCOL)
          if (!SUPPORTED.includes(v)) throw new Error(`${this.label} speaks MCP ${v}; Mappy speaks ${SUPPORTED.join(' or ')}.`)
          this.version = v
          this.serverName = r?.serverInfo?.title || r?.serverInfo?.name || ''
          await this.post('notifications/initialized', {}, true).catch(() => {})
          return r
        })
      this.ready = p
      p.catch(() => { if (this.ready === p) this.ready = null })
    }
    return this.ready
  }

  async listTools (fresh = false): Promise<McpTool[]> {
    if (this.toolCache && !fresh) return this.toolCache
    await this.connect()
    const out: McpTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const r = await this.post('tools/list', cursor ? { cursor } : {})
      out.push(...(r?.tools || []).filter((t: any) => t && typeof t.name === 'string'))
      cursor = r?.nextCursor
      if (!cursor) break
    }
    this.toolCache = out
    return out
  }

  /** A tool call; `timeout` (ms) is longer for tools that think in steps, such as ask_assistant. */
  async callTool (name: string, args: { [k: string]: any }, timeout = TIMEOUT): Promise<any> {
    await this.connect()
    return this.post('tools/call', { name, arguments: args }, false, false, Math.max(5000, Math.min(180000, timeout)))
  }

  /** Ends the session politely (optional for the server). */
  async close (): Promise<void> {
    if (!this.session) return
    try { await this.fetcher(this.cfg.url, { method: 'DELETE', headers: await this.headers() } as any) } catch (e) { }
    this.session = ''; this.ready = null
  }
}
