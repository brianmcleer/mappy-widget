/*
  PlaceSection.tsx - "Your place" in settings: who runs the app and where it is, so Mappy's
  wording fits any city, county, district or utility, plus a library of local fun facts the
  builder can type or start from open sources (Wikipedia, CC BY-SA) with one button. Nothing
  in the widget is tied to one town: every local line comes from here.
*/
import { React, ReactRedux } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { TextInput, TextArea } from 'jimu-ui'
import { Hint, Note, FullButton, ButtonPair } from './ui'
import { buildLocalFacts, factLine } from './localFacts'

interface Props {
  orgName: string
  placeName: string
  placeRegion: string
  website: string
  localFacts: string
  set: (key: string, value: any) => void
}

export default function PlaceSection (props: Props): any {
  const portalSelf = ReactRedux.useSelector((s: any) => s.portalSelf)
  const portalOrg = portalSelf?.name ? String(portalSelf.name) : ''
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [tone, setTone] = React.useState<'ok' | 'warn' | 'bad' | undefined>(undefined)
  const abort = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => abort.current?.abort(), [])

  const build = async () => {
    const place = (props.placeName || '').trim()
    if (!place) { setStatus('Type the place name first, with its state or country: "Springfield, Illinois" or "Lyon, France".'); setTone('warn'); return }
    abort.current?.abort()
    abort.current = new AbortController()
    setBusy(true); setTone(undefined); setStatus(`Looking up ${place}...`)
    try {
      const r = await buildLocalFacts(place, props.placeRegion || '', { signal: abort.current.signal, progress: setStatus })
      if (!r.facts.length) { setStatus(r.note); setTone('warn'); return }
      const have = new Set(String(props.localFacts || '').split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean))
      const fresh = r.facts.map(factLine).filter(l => !have.has(l.toLowerCase()))
      const merged = [String(props.localFacts || '').trim(), ...fresh].filter(Boolean).join('\n')
      props.set('localFacts', merged)
      setStatus(`${r.note}${fresh.length < r.facts.length ? ` ${r.facts.length - fresh.length} were already in the list.` : ''}`)
      setTone('ok')
    } catch (e) {
      setStatus(`Could not reach Wikipedia: ${e?.message || e}. The builder's browser needs internet access for this; you can still type facts by hand.`)
      setTone('bad')
    } finally { setBusy(false) }
  }

  const count = String(props.localFacts || '').split(/\r?\n/).filter(l => l.trim()).length
  const full: any = { width: '100%' }
  return (
    <SettingSection title='Your place'>
      <Hint>Who runs this app and where it is. Mappy uses these in his wording ("on the County's website"), his seasonal lines and his fun facts, so nothing in him is tied to one town.</Hint>
      <SettingRow flow='wrap' label='Organization'>
        <TextInput size='sm' style={full} value={props.orgName || ''} placeholder={portalOrg ? `${portalOrg} (from your portal)` : 'the City'} aria-label='Organization' onChange={(e: any) => props.set('orgName', e.target.value)} />
      </SettingRow>
      <Hint>As it should read in a sentence: "the City", "the County", "the Water District". Empty uses your portal's organization name{portalOrg ? ` (${portalOrg})` : ''}.</Hint>
      <SettingRow flow='wrap' label='Place name'>
        <TextInput size='sm' style={full} value={props.placeName || ''} placeholder='Springfield' aria-label='Place name' onChange={(e: any) => props.set('placeName', e.target.value)} />
      </SettingRow>
      <SettingRow flow='wrap' label='State, province or country'>
        <TextInput size='sm' style={full} value={props.placeRegion || ''} placeholder='Illinois, or France' aria-label='State, province or country' onChange={(e: any) => props.set('placeRegion', e.target.value)} />
      </SettingRow>
      <Hint>Together these find the right page for the facts below: "Springfield" + "Illinois", "Lyon" + "France", "Calgary" + "Alberta". The place name alone is what he says in his lines.</Hint>
      <SettingRow flow='wrap' label='Website'>
        <TextInput size='sm' style={full} value={props.website || ''} placeholder='https://' aria-label='Website' onChange={(e: any) => props.set('website', e.target.value)} />
      </SettingRow>
      <Hint>Offered as a link when he points people off the map (office hours, bills, meetings, the zoning code).</Hint>
      <SettingRow flow='wrap' label={`Local fun facts (${count})`}>
        <TextArea height={130} style={full} value={props.localFacts || ''} placeholder={'One fact per line. "Fun fact" mixes these in with his map facts.'} aria-label='Local fun facts' onChange={(e: any) => props.set('localFacts', e.target.value)} />
      </SettingRow>
      <ButtonPair>
        <FullButton type='primary' onClick={build} disabled={busy}>{busy ? 'Building...' : 'Build facts from Wikipedia'}</FullButton>
        {busy && <FullButton onClick={() => abort.current?.abort()}>Stop</FullButton>}
      </ButtonPair>
      <Hint>Reads the place's Wikipedia page (found by name and state or country, or by Wikipedia search when the exact title differs) and a few pages for parks, landmarks and rivers nearby (text under CC BY-SA, each line says which page it came from). It adds to the list above; read them over and delete any you do not want before you save. Only your browser calls Wikipedia; people using the app never do.</Hint>
      {status && <Note tone={tone}>{status}</Note>}
    </SettingSection>
  )
}
