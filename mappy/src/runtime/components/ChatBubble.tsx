/*
  ChatBubble.tsx - the speech bubble: conversation, action buttons, result lists, suggestion
  chips and the question box. Fixed-position, placed by placement.ts so it always stays in
  the browser tab.

  Accessibility (WCAG 2.2 AA):
  - Non-modal dialog labelled by its heading (4.1.2); Esc closes and focus returns to Mappy (2.1.2).
  - New answers are announced once, in full, through a polite status region (4.1.3), while
    the visible text types itself out (skipped under reduced motion or with a click/key).
  - Status glyphs in layer lists are decorative; each row carries words for screen readers (1.1.1, 1.4.1).
  - Every control is a real button or input with a name, at least 28 px (2.5.8).
*/
import { React } from 'jimu-core'
import type { TaskSummary } from '../../brain/task'
import type { Reply } from '../../brain/answer'
import type { MappyAction } from '../../brain/types'
import type { Placement } from '../placement'
import { __t } from '../i18n-t'
import { tableCsv } from '../../brain/export'

export interface ChatMsg {
  id: number
  from: 'mappy' | 'user'
  text: string
  reply?: Reply
  /** Not saved for the next reload (the "welcome back" line). */
  ephemeral?: boolean
}

interface Props {
  id: string
  name: string
  task?: TaskSummary | null
  messages: ChatMsg[]
  busy: boolean
  chips: string[]
  vars: { [k: string]: string }
  placement: Placement | null
  bubbleRef: any
  typewriter: boolean
  onSend: (text: string) => void
  onAction: (a: MappyAction) => void
  onResult: (r: any) => void
  onClose: () => void
  onReset: () => void
  onMenu: (anchor: HTMLElement) => void
  onTyping: (typing: boolean) => void
  /** Typeahead: requests that continue what has been typed so far (may look addresses up, so it can be async). */
  complete?: (prefix: string, signal?: AbortSignal) => string[] | Promise<string[]>
  inputRef: any
  /** Dragging the title bar moves Mappy, and the chat with him. */
  onHeadDrag?: (e: any) => void
  /** The size the user dragged it to; null is automatic. */
  size?: { w: number, h: number } | null
  /** Resize (while dragging, done=false; when let go, done=true). null goes back to automatic. */
  onResize?: (size: { w: number, h: number } | null, done: boolean) => void
  /** In its own desktop window: fills the window, shows a small Mappy, and × returns to the app. */
  docked?: { avatar?: any, subtitle?: string, onReturn: () => void }
}

/** A street address in an answer ("250 N 5th St"), so it can be a button that goes there. */
const ADDRESS_IN_TEXT = /\b\d{1,6}(?:[A-Z])?\s+(?:[NSEW]\.?\s+|North\s+|South\s+|East\s+|West\s+)?(?:[A-Z0-9][A-Za-z0-9'.-]*\s+){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ct|Court|Ln|Lane|Blvd|Boulevard|Way|Pl|Place|Cir|Circle|Hwy|Highway|Pkwy|Parkway|Ter|Terrace|Trl|Trail|Loop)\b\.?(?:\s+(?:[NSEW]\b|(?:Unit|Apt|Ste|#)\.?\s*[A-Za-z0-9-]+))?/g

/** **bold**, bare links and addresses (as buttons), nothing else: answers are plain text built by the brain. */
function rich (text: string, onAddress?: (a: string) => void): any[] {
  const out: any[] = []
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g)
  const withAddresses = (s: string, key: string): any[] => {
    if (!onAddress) return [s]
    const bits: any[] = []
    let last = 0; let n = 0
    for (const m of s.matchAll(ADDRESS_IN_TEXT)) {
      const i = m.index || 0
      if (i > last) bits.push(s.slice(last, i))
      const a = m[0].replace(/\.$/, '')
      bits.push(<button key={`${key}-${n++}`} type='button' className='mappy-addr' title={`Go to ${a}`} onClick={() => onAddress(a)}>{a}</button>)
      last = i + m[0].length
    }
    if (last < s.length) bits.push(s.slice(last))
    return bits
  }
  parts.forEach((p, i) => {
    if (!p) return
    if (p.startsWith('**') && p.endsWith('**')) out.push(<strong key={i}>{withAddresses(p.slice(2, -2), 'b' + i)}</strong>)
    else if (/^https?:\/\//.test(p)) out.push(<a key={i} href={p} target='_blank' rel='noopener noreferrer'>{p.length > 48 ? p.slice(0, 45) + '...' : p}<span className='mappy-sr'> {__t('opensNewTab')}</span></a>)
    else out.push(<React.Fragment key={i}>{withAddresses(p, 't' + i)}</React.Fragment>)
  })
  return out
}

const plain = (t: string): string => String(t || '').replace(/\*\*/g, '')

function download (text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function reducedMotion (): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (e) { return false }
}

export default function ChatBubble (props: Props): any {
  const { messages, busy, placement } = props
  // A slow lookup says so, so a long wait does not look like a freeze.
  const [slow, setSlow] = React.useState('')
  React.useEffect(() => {
    if (!busy) { setSlow(''); return }
    const a = setTimeout(() => setSlow('Still checking...'), 3000)
    const b = setTimeout(() => setSlow('Still checking. The map service is slow right now.'), 12000)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [busy])
  const [draft, setDraft] = React.useState('')
  const [history, setHistory] = React.useState<string[]>([])
  const [hIdx, setHIdx] = React.useState(-1)
  const [announce, setAnnounce] = React.useState('')
  const logRef = React.useRef<any>(null)
  const titleId = props.id + '-title'

  // Typewriter for the newest Mappy message.
  const lastBot = [...messages].reverse().find(m => m.from === 'mappy')
  const [typedId, setTypedId] = React.useState<number>(-1)
  const [typedLen, setTypedLen] = React.useState<number>(Infinity)
  React.useEffect(() => {
    if (!lastBot) return
    setAnnounce(plain(lastBot.text) + (lastBot.reply?.results?.length ? ' ' + __t('resultsAnnounce', { n: lastBot.reply.results.length }) : '') + (lastBot.reply?.list?.length ? ' ' + __t('listAnnounce', { n: lastBot.reply.list.length }) : ''))
    if (!props.typewriter || reducedMotion() || lastBot.id === typedId) { setTypedLen(Infinity); setTypedId(lastBot.id); return }
    setTypedId(lastBot.id)
    const words = plain(lastBot.text).split(/(\s+)/)
    let i = 0
    setTypedLen(0)
    const step = Math.max(12, Math.min(40, 1500 / Math.max(1, words.length)))
    const h = setInterval(() => {
      i += 2
      const len = words.slice(0, i).join('').length
      setTypedLen(len)
      if (i >= words.length) { clearInterval(h); setTypedLen(Infinity) }
    }, step)
    return () => clearInterval(h)
  }, [lastBot?.id])

  const skipTyping = () => setTypedLen(Infinity)

  // Follow new text, unless the person scrolled up to read something.
  const lastCount = React.useRef(0)
  React.useEffect(() => {
    const el = logRef.current
    if (!el) return
    const grew = messages.length !== lastCount.current
    lastCount.current = messages.length
    if (grew || el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [messages.length, busy, typedLen])

  const send = (text?: string) => {
    if (busy) return
    const t = (text ?? draft).trim()
    if (!t) return
    skipTyping()
    props.onSend(t)
    setHistory(h => [t, ...h.filter(x => x !== t)].slice(0, 20))
    setHIdx(-1)
    setDraft('')
    props.onTyping(false)
  }

  // Typeahead: up to five continuations under the box. Tab takes the first, Escape hides them.
  const [hints, setHints] = React.useState<string[]>([])
  const [hintsOff, setHintsOff] = React.useState(false)
  React.useEffect(() => {
    if (!props.complete || hintsOff || hIdx >= 0 || draft.trim().length < 2) { setHints([]); return }
    const ctl = new AbortController()
    const h = setTimeout(async () => {
      // What you asked before comes first, then what the app can complete.
      const p = draft.trim().toLowerCase()
      const past = history.filter(x => x.toLowerCase().startsWith(p) && x.toLowerCase() !== p).slice(0, 2)
      try {
        const got = await Promise.resolve(props.complete!(draft, ctl.signal))
        if (!ctl.signal.aborted) setHints(Array.from(new Set([...past, ...got])).slice(0, 5))
      } catch (e) { if (!ctl.signal.aborted) setHints(past) }
    }, 160)
    return () => { clearTimeout(h); ctl.abort() }
  }, [draft, hintsOff, hIdx, props.complete, history])
  const takeHint = (h: string) => { setDraft(h.endsWith(' ') ? h : h + ' '); setHints([]); props.inputRef?.current?.focus?.() }

  const onKeyDown = (e: any) => {
    if (e.key === 'Tab' && hints.length && !e.shiftKey) { e.preventDefault(); takeHint(hints[0]); return }
    if (e.key === 'Escape' && hints.length) { e.preventDefault(); e.stopPropagation(); setHints([]); setHintsOff(true); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); send() } else if (e.key === 'ArrowUp' && history.length && (!draft || hIdx >= 0)) {
      e.preventDefault()
      const i = Math.min(history.length - 1, hIdx + 1)
      setHIdx(i); setDraft(history[i])
    } else if (e.key === 'ArrowDown' && hIdx >= 0) {
      e.preventDefault()
      const i = hIdx - 1
      setHIdx(i); setDraft(i >= 0 ? history[i] : '')
    }
  }

  // Ask by voice (browsers with speech recognition: Chrome, Edge, Safari). Words appear as you
  // speak and send when you stop.
  const SR: any = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null
  const [listening, setListening] = React.useState(false)
  const recog = React.useRef<any>(null)
  const busyRef = React.useRef(busy)
  busyRef.current = busy
  React.useEffect(() => () => { const r = recog.current; if (r) { r.onend = null; r.onresult = null; try { r.abort() } catch (e) { } } }, [])
  const toggleVoice = () => {
    if (!SR) return
    if (listening) { try { recog.current?.stop() } catch (e) { } return }
    const r = new SR()
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    r.interimResults = true
    r.maxAlternatives = 1
    let said = ''
    r.onresult = (ev: any) => {
      let text = ''
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript
      said = text.trim()
      setDraft(said)
      props.onTyping(true)
    }
    r.onerror = (ev: any) => { setListening(false); if (ev?.error === 'not-allowed') setAnnounce('The microphone is blocked for this site.') }
    r.onend = () => { setListening(false); props.onTyping(false); if (said && !busyRef.current) send(said) }
    recog.current = r
    try { r.start(); setListening(true); setAnnounce('Listening...') } catch (e) { setListening(false) }
  }

  // Copy an answer (its words, and any table as tab-separated rows for a spreadsheet).
  const [copied, setCopied] = React.useState<number | null>(null)
  const copy = async (m: ChatMsg, btn?: HTMLElement) => {
    const parts = [plain(m.text)]
    if (m.reply?.table) parts.push([m.reply.table.columns, ...m.reply.table.rows].map(r => r.join('\t')).join('\n'))
    if (m.reply?.list?.length) parts.push(m.reply.list.map(it => `- ${it.label}${it.detail ? ` (${it.detail})` : ''}`).join('\n'))
    const text = parts.filter(Boolean).join('\n\n')
    // The window this button is in (the pop-out window has its own clipboard and document).
    const doc: Document = btn?.ownerDocument || document
    const win: any = doc.defaultView || window
    let ok = false
    try { await win.navigator.clipboard.writeText(text); ok = true } catch (e) {
      const ta = doc.createElement('textarea'); ta.value = text; doc.body.appendChild(ta); ta.select(); try { ok = doc.execCommand('copy') } catch (err) { } ta.remove()
    }
    setAnnounce('')
    if (!ok) { setTimeout(() => setAnnounce('Could not copy. Select the text and copy it instead.'), 30); return }
    setCopied(m.id); setTimeout(() => setAnnounce('Copied.'), 30)
    setTimeout(() => setCopied(c => c === m.id ? null : c), 1500)
  }

  const onBubbleKey = (e: any) => {
    // Docked, Esc would leave an empty window: it only stops the typing.
    if (e.key === 'Escape' && !props.docked) { e.stopPropagation(); props.onClose() } else if (typedLen !== Infinity) skipTyping()
  }

  const style: any = { ...props.vars }
  if (props.docked) {
    // Fills its window (CSS); no placement, no tail.
  } else if (placement) {
    style.left = placement.left
    if (placement.bottom != null) style.bottom = placement.bottom
    else style.top = placement.top
    style.width = placement.width
    style.maxHeight = placement.maxHeight
    if (props.size) style.height = Math.min(props.size.h, placement.maxHeight)
  } else {
    style.left = -10000
    style.top = 0
    style.width = 340
    style.visibility = 'hidden'
  }
  // Resize grip on the free corner: away from Mappy, on the edge that moves.
  const gripTop = placement?.tail === 'down'
  const gripRight = placement?.alignLeft !== false
  const resizeFrom = (e: any) => {
    if (!props.onResize || e.button > 0) return
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, w: box.width, h: box.height }
    const win: any = e.currentTarget.ownerDocument.defaultView || window
    e.preventDefault()
    let last = { w: start.w, h: start.h }
    const move = (ev: any) => {
      last = { w: start.w + (ev.clientX - start.x) * (gripRight ? 1 : -1), h: start.h + (ev.clientY - start.y) * (gripTop ? -1 : 1) }
      props.onResize!(last, false)
    }
    const up = () => { win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', up); props.onResize!(last, true) }
    win.addEventListener('pointermove', move)
    win.addEventListener('pointerup', up)
    win.addEventListener('pointercancel', up)
  }
  const resizeKey = (e: any) => {
    if (!props.onResize) return
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const step = e.shiftKey ? 80 : 20
    const d: { [k: string]: [number, number] } = { ArrowLeft: [gripRight ? -step : step, 0], ArrowRight: [gripRight ? step : -step, 0], ArrowUp: [0, gripTop ? step : -step], ArrowDown: [0, gripTop ? -step : step] }
    if (d[e.key]) { e.preventDefault(); e.stopPropagation(); props.onResize({ w: box.width + d[e.key][0], h: box.height + d[e.key][1] }, true) } else if (e.key === 'Home' || e.key === 'Delete') { e.preventDefault(); props.onResize(null, true) }
  }
  const tailStyle: any = {}
  if (placement) {
    if (placement.tail === 'down' || placement.tail === 'up') tailStyle.left = placement.tailOffset
    else tailStyle.top = placement.tailOffset
  }
  // Starter chips only at the start of a chat; later, only the ones an answer suggests.
  const chips = lastBot?.reply?.suggest?.length ? lastBot.reply.suggest : (messages.length <= 2 ? props.chips : [])

  const renderText = (m: ChatMsg) => {
    if (m.from === 'user') return m.text
    if (m.id === typedId && typedLen !== Infinity) return plain(m.text).slice(0, typedLen)
    return rich(m.text, m.from === 'mappy' ? (a: string) => send(`zoom to ${a}`) : undefined)
  }
  const typingNow = (m: ChatMsg) => m.id === typedId && typedLen !== Infinity

  return (
    <div
      id={props.id}
      ref={props.bubbleRef}
      className={props.docked ? 'mappy-bubble mappy-docked' : 'mappy-bubble'}
      style={style}
      role='dialog'
      aria-modal='false'
      aria-labelledby={titleId}
      onKeyDown={onBubbleKey}
    >
      {placement && !props.docked && <span className={`mappy-tail mappy-tail-${placement.tail}`} style={tailStyle} aria-hidden='true' />}
      {placement && !props.docked && props.onResize && <button
        type='button'
        className={`mappy-grip mappy-grip-${gripTop ? 't' : 'b'}${gripRight ? 'r' : 'l'}`}
        title='Drag to resize. Double-click for the automatic size.'
        aria-label='Resize the chat. Arrow keys change the size, Home resets it.'
        onPointerDown={resizeFrom}
        onDoubleClick={() => props.onResize!(null, true)}
        onKeyDown={resizeKey}
      />}
      <div className={props.onHeadDrag ? 'mappy-head mappy-head-drag' : 'mappy-head'} title={props.onHeadDrag ? 'Drag to move' : undefined}
        onPointerDown={(e: any) => { if (props.onHeadDrag && !e.target.closest('button, a, input, select, textarea')) props.onHeadDrag(e) }}>
        {props.docked?.avatar && <span className='mappy-avatar'>{props.docked.avatar}</span>}
        {props.docked
          ? <div className='mappy-titles'><h2 id={titleId}>{props.name}</h2>{props.docked.subtitle && <span className='mappy-sub'>{props.docked.subtitle}</span>}</div>
          : <h2 id={titleId}>{props.name}</h2>}
        <button type='button' className='mappy-iconbtn' title={__t('options')} aria-label={__t('options')} aria-haspopup='menu' onClick={(e: any) => props.onMenu(e.currentTarget)}>{'⋯'}</button>
        <button type='button' className='mappy-iconbtn' title={__t('help')} aria-label={__t('help')} onClick={() => send(__t('helpQuestion'))}>?</button>
        {props.docked
          ? <button type='button' className='mappy-iconbtn' title='Return to the app window' aria-label='Return to the app window' onClick={props.docked.onReturn} style={{ fontSize: '1.1rem' }}>{'↩'}</button>
          : <button type='button' className='mappy-iconbtn' title={__t('close')} aria-label={__t('close')} onClick={props.onClose}>{'×'}</button>}
      </div>
      <div className='mappy-toolbar' aria-label='Conversation tools'>
        <button type='button' className='mappy-chip' disabled={busy} onClick={() => send('What can you do?')}>Explore</button>
        <button type='button' className='mappy-chip' disabled={busy} onClick={() => send('undo')}>Undo layers</button>
        <button type='button' className='mappy-chip' disabled={busy} onClick={() => { props.onReset(); setHistory([]); setDraft(''); setHIdx(-1) }}>New chat</button>
        <button type='button' className='mappy-chip' disabled={!messages.length || busy} onClick={() => {
          const text = messages.map(m => `${m.from === 'user' ? 'You' : props.name}: ${m.text}${m.reply?.table ? '\n' + [m.reply.table.columns, ...m.reply.table.rows].map(row => row.join('\t')).join('\n') : ''}${m.reply?.list ? '\n' + m.reply.list.map(row => row.label + (row.detail ? ': ' + row.detail : '')).join('\n') : ''}${m.reply?.results ? '\n' + m.reply.results.map(r => r.label + ' — ' + r.entry.title).join('\n') : ''}${m.reply?.sources ? '\nSources: ' + m.reply.sources.map(s => s.title + ' (' + s.detail + ')').join('; ') : ''}`).join('\n\n')
          download(text, 'mappy-conversation.txt', 'text/plain;charset=utf-8')
        }}>Save chat</button>
      </div>
      {props.task && <details className='mappy-task'>
        <summary><span className='mappy-task-heading'>Data task</span> <strong>{props.task.layer}</strong><span className='mappy-task-meta'>{props.task.kind} · {props.task.scope}{props.task.filter !== 'No additional filter' ? ' · Filtered' : ''}</span></summary>
        <div className='mappy-task-body'>
          <dl><dt>Filter</dt><dd>{props.task.filter}</dd>{props.task.ordering && <><dt>Field / order</dt><dd>{props.task.ordering}</dd></>}<dt>Last successful run</dt><dd>{props.task.completed}</dd></dl>
          <p>Layer filters configured by the app still apply. Refresh after moving the map to update a view-based task.</p>
          <div className='mappy-task-actions'>{props.task.actions.map(action => <button key={action.command} type='button' className='mappy-chip' disabled={busy} onClick={() => props.onAction({ type: 'ask', q: action.command, label: action.label })}>{action.label}</button>)}</div>
        </div>
      </details>}
      <div className='mappy-sr' role='status' aria-live='polite' aria-atomic='true'>{announce}</div>
      <div className='mappy-log' ref={logRef} tabIndex={0} aria-label={__t('conversation')} onClick={skipTyping}>
        {messages.map(m => (
          <div key={m.id} className={'mappy-msg ' + (m.from === 'user' ? 'mappy-user' : 'mappy-bot')}>
            <p><span className='mappy-sr'>{m.from === 'user' ? __t('you') : props.name}: </span>{renderText(m)}</p>
            {m.from === 'mappy' && !typingNow(m) && m.text && <button type='button' className='mappy-copy' onClick={(e: any) => copy(m, e.currentTarget)} aria-label='Copy this answer' title='Copy'>{copied === m.id ? '✓' : '⧉'}</button>}
            {!typingNow(m) && m.reply?.table && <div className='mappy-table-wrap' tabIndex={0} role='region' aria-label='Analysis results'>
              <table className='mappy-table'><caption className='mappy-sr'>Analysis results</caption><thead><tr>{m.reply.table.columns.map((c, i) => <th scope='col' key={i}>{c}</th>)}{m.reply.table.rowActions?.some(Boolean) && <th scope='col'>Map</th>}</tr></thead>
                <tbody>{m.reply.table.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}{m.reply.table.rowActions?.some(Boolean) && <td>{m.reply.table.rowActions[i] ? <button type='button' className='mappy-chip' disabled={busy} aria-label={m.reply.table.rowActions[i].label} onClick={() => props.onAction(m.reply.table.rowActions[i])}>Show</button> : '—'}</td>}</tr>)}</tbody>
              </table>
              <button type='button' className='mappy-btn' onClick={() => download(tableCsv(m.reply!.table!.columns, m.reply!.table!.rows), 'mappy-table.csv', 'text/csv;charset=utf-8')}>Save these rows as CSV</button>
            </div>}
            {!typingNow(m) && m.reply?.image && /^(data:image\/(png|jpe?g|gif|webp);base64,|https:\/\/)/.test(m.reply.image.src) && <img className='mappy-img' src={m.reply.image.src} alt={m.reply.image.alt} style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 6, margin: '6px 0' }} />}
            {!typingNow(m) && m.reply?.sources?.length > 0 && <details className='mappy-sources'><summary>{m.reply.sources.some(s => /\n/.test(s.detail || '')) ? 'Details' : `Sources (${m.reply.sources.length})`}</summary>{m.reply.sources.map((s, i) => <div key={i} style={{ whiteSpace: 'pre-line' }}><strong>{s.title}</strong><br />{s.detail}</div>)}</details>}
            {!typingNow(m) && m.reply?.actions && m.reply.actions.length > 0 && (
              <div className='mappy-actions'>
                {m.reply.actions.slice(0, 4).map((a, i) => (
                  <button key={i} type='button' className='mappy-btn' disabled={busy} onClick={() => props.onAction(a)}>{a.label || a.type}</button>
                ))}
              </div>
            )}
            {!typingNow(m) && m.reply?.list && m.reply.list.length > 0 && (
              <ul className='mappy-list'>
                {m.reply.list.map((it, i) => (
                  <li key={i}>
                    <button
                      type='button'
                      disabled={busy || !it.action}
                      className='mappy-row'
                      style={it.indent ? { paddingLeft: 6 + it.indent * 14 } : undefined}
                      onClick={() => it.action && props.onAction(it.action)}
                      aria-label={it.action?.label ? `${it.label}${it.sr ? ', ' + it.sr : ''}. ${it.action.label}` : undefined}
                    >
                      {it.glyph && <span className='mappy-glyph' aria-hidden='true'>{it.glyph}</span>}
                      <span className='mappy-row-text'>
                        {it.label}
                        {it.sr && <span className='mappy-sr'>, {it.sr}</span>}
                        {it.detail && <small>{it.detail}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!typingNow(m) && m.reply?.results && m.reply.results.length > 0 && (
              <ul className='mappy-list' aria-label={__t('results')}>
                {m.reply.results.map((r: any, i: number) => (
                  <li key={i}>
                    <button type='button' className='mappy-row' disabled={busy} onClick={() => props.onResult(r)} aria-label={`${r.label}, ${r.entry?.title || ''}${r.detail ? ', ' + r.detail : ''}. ${__t('zoomToResult')}`}>
                      <span className='mappy-row-text'>
                        {r.label}
                        <small>{r.entry?.title}{r.detail ? ' · ' + r.detail : ''}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className='mappy-msg' role='status'><span className='mappy-typing' aria-hidden='true'><i /><i /><i /></span>{slow ? <span className='mappy-slow' style={{ marginLeft: 6, fontSize: '.8125rem', color: 'var(--mappy-muted)' }}>{slow}</span> : <span className='mappy-sr'>{__t('thinking')}</span>}</div>}
      </div>
      {chips.length > 0 && (
        <div className='mappy-chips' role='group' aria-label={__t('suggestions')}>
          {chips.slice(0, 5).map((c, i) => (
            <button key={i} type='button' className='mappy-chip' disabled={busy} onClick={() => send(c)}>{c}</button>
          ))}
        </div>
      )}
      {hints.length > 0 && !busy && (
        <div className='mappy-hints' id={props.id + '-hints'} role='group' aria-label='Suggestions, Tab takes the first'>
          {hints.map((h, i) => <button key={i} type='button' className='mappy-hint' tabIndex={-1} onMouseDown={(e: any) => e.preventDefault()} onClick={() => takeHint(h)}>{h}</button>)}
        </div>
      )}
      <form className='mappy-form' onSubmit={(e: any) => { e.preventDefault(); send() }}>
        <label className='mappy-sr' htmlFor={props.id + '-q'}>{__t('askLabel', { name: props.name })}</label>
        <input
          id={props.id + '-q'}
          ref={props.inputRef}
          className='mappy-input'
          value={draft}
          placeholder={__t('askPlaceholder', { name: props.name })}
          autoComplete='off'
          maxLength={2000}
          enterKeyHint='send'
          onChange={(e: any) => { setDraft(e.target.value); setHintsOff(false); props.onTyping(!!e.target.value) }}
          aria-describedby={hints.length ? props.id + '-hints' : undefined}
          onBlur={() => props.onTyping(false)}
          onKeyDown={onKeyDown}
        />
        {SR && <button type='button' className={'mappy-iconbtn mappy-mic' + (listening ? ' on' : '')} onClick={toggleVoice} aria-pressed={listening} aria-label='Ask by voice' title={listening ? 'Stop listening' : 'Ask by voice'} disabled={busy}>{'🎤'}</button>}
        <button type='submit' className='mappy-btn' disabled={busy || !draft.trim()}>{__t('ask')}</button>
      </form>
    </div>
  )
}
