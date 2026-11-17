/*
  Keepsake.tsx - the two keepsakes the chat can show: the passport (a page of ink stamps, the
  earned ones inked and dated, the rest faint with a hint) and a postcard he writes to you (an
  SVG picture, so it can be saved). Both are drawn here; the words and numbers come from
  brain/keepsakes.ts.
*/
import { React } from 'jimu-core'
import type { KeepsakeCard } from '../../brain/keepsakes'
import { postcardSvg } from '../../brain/keepsakes'

const INKS = ['#b5442e', '#2e5d8a', '#3d7a4a', '#7a4a8a', '#a8741a']
const TILTS = [-7, 4, -3, 6, -5, 2, 5, -4]

export default function Keepsake (props: { card: KeepsakeCard, noDownloads?: boolean, onSave?: (text: string, name: string, type: string) => void }): any {
  const card = props.card
  if (card.kind === 'passport') {
    const earned = card.stamps.filter(s => s.day).length
    return (
      <div className='mappy-passport' role='group' aria-label={`Passport: ${earned} of ${card.stamps.length} stamps`}>
        <div className='mappy-passport-head'><span>PASSPORT</span><span>{earned} / {card.stamps.length}</span></div>
        <ul className='mappy-stamps'>
          {card.stamps.map((s, i) => s.day
            ? (
              <li key={s.id} className='mappy-stamp' style={{ color: INKS[i % INKS.length], transform: `rotate(${TILTS[i % TILTS.length]}deg)` }} title={`${s.name}: stamped ${s.day}`}>
                <span className='mappy-stamp-glyph' aria-hidden='true'>{s.glyph}</span>
                <span className='mappy-stamp-name'>{s.name}</span>
                <span className='mappy-stamp-day'>{s.day}</span>
              </li>
              )
            : (
              <li key={s.id} className='mappy-stamp mappy-stamp-blank' title={s.how}>
                <span className='mappy-stamp-glyph' aria-hidden='true'>?</span>
                <span className='mappy-stamp-name'><span className='mappy-sr'>Not earned yet: </span>{s.how}</span>
              </li>
              ))}
        </ul>
      </div>
    )
  }
  const svg = postcardSvg(card)
  return (
    <div className='mappy-postcard'>
      <img alt={`A postcard from ${card.from} to ${card.to || 'you'}: ${card.lines.join(' ')}`} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} />
      {!props.noDownloads && props.onSave && <button type='button' className='mappy-btn' onClick={() => props.onSave!(svg, 'postcard-from-mappy.svg', 'image/svg+xml;charset=utf-8')}>Save the postcard</button>}
    </div>
  )
}
