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
}

interface Props {
  id: string
  name: string
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
  inputRef: any
}

/** **bold** and bare links, nothing else: answers are plain text built by the brain. */
function rich (text: string): any[] {
  const out: any[] = []
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g)
  parts.forEach((p, i) => {
    if (!p) return
    if (p.startsWith('**') && p.endsWith('**')) out.push(<strong key={i}>{p.slice(2, -2)}</strong>)
    else if (/^https?:\/\//.test(p)) out.push(<a key={i} href={p} target='_blank' rel='noopener noreferrer'>{p.length > 48 ? p.slice(0, 45) + '...' : p}<span className='mappy-sr'> {__t('opensNewTab')}</span></a>)
    else out.push(<React.Fragment key={i}>{p}</React.Fragment>)
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

  React.useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
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

  const onKeyDown = (e: any) => {
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

  const onBubbleKey = (e: any) => {
    if (e.key === 'Escape') { e.stopPropagation(); props.onClose() } else if (typedLen !== Infinity) skipTyping()
  }

  const style: any = { ...props.vars }
  if (placement) {
    style.left = placement.left
    if (placement.bottom != null) style.bottom = placement.bottom
    else style.top = placement.top
    style.width = placement.width
    style.maxHeight = placement.maxHeight
  } else {
    style.left = -10000
    style.top = 0
    style.width = 340
    style.visibility = 'hidden'
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
    return rich(m.text)
  }
  const typingNow = (m: ChatMsg) => m.id === typedId && typedLen !== Infinity

  return (
    <div
      id={props.id}
      ref={props.bubbleRef}
      className='mappy-bubble'
      style={style}
      role='dialog'
      aria-modal='false'
      aria-labelledby={titleId}
      onKeyDown={onBubbleKey}
    >
      {placement && <span className={`mappy-tail mappy-tail-${placement.tail}`} style={tailStyle} aria-hidden='true' />}
      <div className='mappy-head'>
        <h2 id={titleId}>{props.name}</h2>
        <span className='mappy-local' title='Commands and answers run locally without an LLM'>Local</span>
        <button type='button' className='mappy-iconbtn' title={__t('options')} aria-label={__t('options')} aria-haspopup='menu' onClick={(e: any) => props.onMenu(e.currentTarget)}>{'⋯'}</button>
        <button type='button' className='mappy-iconbtn' title={__t('help')} aria-label={__t('help')} onClick={() => send(__t('helpQuestion'))}>?</button>
        <button type='button' className='mappy-iconbtn' title={__t('close')} aria-label={__t('close')} onClick={props.onClose}>{'×'}</button>
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
      <div className='mappy-sr' role='status' aria-live='polite' aria-atomic='true'>{announce}</div>
      <div className='mappy-log' ref={logRef} tabIndex={0} aria-label={__t('conversation')} onClick={skipTyping}>
        {messages.map(m => (
          <div key={m.id} className={'mappy-msg ' + (m.from === 'user' ? 'mappy-user' : 'mappy-bot')}>
            <p><span className='mappy-sr'>{m.from === 'user' ? __t('you') : props.name}: </span>{renderText(m)}</p>
            {!typingNow(m) && m.reply?.table && <div className='mappy-table-wrap' tabIndex={0} role='region' aria-label='Analysis results'>
              <table className='mappy-table'><caption className='mappy-sr'>Analysis results</caption><thead><tr>{m.reply.table.columns.map((c, i) => <th scope='col' key={i}>{c}</th>)}</tr></thead>
                <tbody>{m.reply.table.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
              </table>
              <button type='button' className='mappy-btn' onClick={() => download(tableCsv(m.reply!.table!.columns, m.reply!.table!.rows), 'mappy-table.csv', 'text/csv;charset=utf-8')}>Save these rows as CSV</button>
            </div>}
            {!typingNow(m) && m.reply?.image && /^(data:image\/(png|jpe?g|gif|webp);base64,|https:\/\/)/.test(m.reply.image.src) && <img className='mappy-img' src={m.reply.image.src} alt={m.reply.image.alt} style={{ display: 'block', maxWidth: '100%', height: 'auto', borderRadius: 6, margin: '6px 0' }} />}
            {!typingNow(m) && m.reply?.sources?.length > 0 && <details className='mappy-sources'><summary>Sources ({m.reply.sources.length})</summary>{m.reply.sources.map((s, i) => <div key={i}><strong>{s.title}</strong><br />{s.detail}</div>)}</details>}
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
        {busy && <div className='mappy-msg' role='status'><span className='mappy-typing' aria-hidden='true'><i /><i /><i /></span><span className='mappy-sr'>{__t('thinking')}</span></div>}
      </div>
      {chips.length > 0 && (
        <div className='mappy-chips' role='group' aria-label={__t('suggestions')}>
          {chips.slice(0, 5).map((c, i) => (
            <button key={i} type='button' className='mappy-chip' disabled={busy} onClick={() => send(c)}>{c}</button>
          ))}
        </div>
      )}
      <form className='mappy-form' onSubmit={(e: any) => { e.preventDefault(); send() }}>
        <label className='mappy-sr' htmlFor={props.id + '-q'}>{__t('askLabel', { name: props.name })}</label>
        <input
          id={props.id + '-q'}
          ref={props.inputRef}
          className='mappy-input'
          value={draft}
          placeholder={__t('placeholder')}
          autoComplete='off'
          maxLength={2000}
          enterKeyHint='send'
          onChange={(e: any) => { setDraft(e.target.value); props.onTyping(!!e.target.value) }}
          onBlur={() => props.onTyping(false)}
          onKeyDown={onKeyDown}
        />
        <button type='submit' className='mappy-btn' disabled={busy || !draft.trim()}>{__t('ask')}</button>
      </form>
    </div>
  )
}
