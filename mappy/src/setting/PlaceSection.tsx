/*
  PlaceSection.tsx - "Your place" in settings: who runs the app and where it is, so Mappy's
  wording fits any city, county, district or utility, plus a library of local fun facts the
  builder can type or start from open sources with one button: Wikipedia, Wikidata, Open-Meteo
  climate, OpenStreetMap, Wikivoyage, DBpedia, and in the United States USGS elevation and the
  Census. Each line names its source and license. Nothing in the widget is tied to one town:
  every local line comes from here or from the app's own map layers.
*/
import { React, ReactRedux } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { TextInput, TextArea, Checkbox, Label, Switch } from 'jimu-ui'
import { Hint, Note, FullButton, ButtonPair } from './ui'
import { buildLocalFacts, factLine } from './localFacts'
import { SOURCES } from './factSources'
import type { SourceId } from './factSources'

interface Props {
  orgName: string
  placeName: string
  placeRegion: string
  website: string
  localFacts: string
  factSources: string[] | null
  censusKey: string
  mapFacts: boolean
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
      const r = await buildLocalFacts(place, props.placeRegion || '', { signal: abort.current.signal, progress: setStatus, sources: chosen, censusKey: (props.censusKey || '').trim() })
      if (!r.facts.length) { setStatus(r.note); setTone('warn'); return }
      const have = new Set(String(props.localFacts || '').split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean))
      const fresh = r.facts.map(factLine).filter(l => !have.has(l.toLowerCase()))
      const merged = [String(props.localFacts || '').trim(), ...fresh].filter(Boolean).join('\n')
      props.set('localFacts', merged)
      setStatus(`${r.note}${fresh.length < r.facts.length ? ` ${r.facts.length - fresh.length} were already in the list.` : ''}`)
      setTone('ok')
    } catch (e) {
      setStatus(`Could not reach the fact sources: ${e?.message || e}. The builder's browser needs internet access for this; you can still type facts by hand.`)
      setTone('bad')
    } finally { setBusy(false) }
  }

  const count = String(props.localFacts || '').split(/\r?\n/).filter(l => l.trim()).length
  const chosen: SourceId[] = (props.factSources || SOURCES.map(x => x.id)) as SourceId[]
  const toggle = (id: SourceId, on: boolean) => props.set('factSources', on ? Array.from(new Set([...chosen, id])) : chosen.filter(x => x !== id))
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
      <SettingRow flow='wrap' label='Read these too (Wikipedia always)'>
        <div role='group' aria-label='Fact sources' style={{ width: '100%' }}>
          {SOURCES.map(src => (
            <div key={src.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, margin: '3px 0' }}>
              <Checkbox id={'mf-' + src.id} checked={chosen.includes(src.id)} onChange={(e: any, c: boolean) => toggle(src.id, c)} />
              <Label for={'mf-' + src.id} style={{ margin: 0, fontSize: 12, lineHeight: 1.3 }}>
                <b>{src.name}</b> ({src.license}{src.us ? ', US only' : ''}){'. '}{src.note}
              </Label>
            </div>
          ))}
        </div>
      </SettingRow>
      {chosen.includes('census') && <SettingRow flow='wrap' label='US Census API key'>
        <TextInput size='sm' type='password' style={full} defaultValue={props.censusKey || ''} placeholder='Free from api.census.gov/data/key_signup.html' aria-label='US Census API key' onAcceptValue={(v: string) => props.set('censusKey', String(v || '').trim())} />
      </SettingRow>}
      <ButtonPair>
        <FullButton type='primary' onClick={build} disabled={busy}>{busy ? 'Building...' : 'Build facts from open sources'}</FullButton>
        {busy && <FullButton onClick={() => abort.current?.abort()}>Stop</FullButton>}
      </ButtonPair>
      <Hint>Finds the place's Wikipedia page by name and state or country, then reads the sources checked above. Each line names where it came from and its license; read them over and delete any you do not want before saving. Only your browser calls these sources, and only when you press the button.</Hint>
      {status && <Note tone={tone}>{status}</Note>}
      <SettingRow tag='label' label='Facts from this map too'>
        <Switch checked={props.mapFacts} onChange={(e: any) => props.set('mapFacts', e.target.checked)} />
      </SettingRow>
      <Hint>He also works out facts from the app's own layers while it runs: how many hydrants there are, how many miles of sewer main, the largest park, the oldest pipe. Always current, nothing to save.</Hint>
    </SettingSection>
  )
}
