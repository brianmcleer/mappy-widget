/*
  VoiceSection.tsx - "Voice" in settings: how Mappy sounds when he reads answers aloud. Two
  choices: the most natural voice each person's browser has (Edge and Chrome ship neural ones),
  or one open-source voice from the GIS server (Kokoro, run by gis-mcp), the same for everyone.
  "Hear it" plays a sentence with the choice as it stands.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Select, Option, Switch } from 'jimu-ui'
import { Hint, Note, FullButton } from './ui'
import { speakUrl, voiceScore } from '../brain/speech'
import { Speaker, browserVoices } from '../runtime/speech'

interface Props {
  voice: any
  mcp: any
  set: (key: string, value: any) => void
}

const SERVER_VOICES: Array<[string, string]> = [
  ['af_heart', 'Heart (American, woman)'], ['af_bella', 'Bella (American, woman)'], ['af_nicole', 'Nicole (American, woman)'], ['af_sarah', 'Sarah (American, woman)'],
  ['am_michael', 'Michael (American, man)'], ['am_adam', 'Adam (American, man)'], ['am_puck', 'Puck (American, man)'], ['am_fenrir', 'Fenrir (American, man)'],
  ['bf_emma', 'Emma (British, woman)'], ['bf_isabella', 'Isabella (British, woman)'], ['bm_george', 'George (British, man)'], ['bm_fable', 'Fable (British, man)']
]

export default function VoiceSection (props: Props): any {
  const v = props.voice || {}
  const source: string = v.source === 'server' ? 'server' : 'browser'
  const url = speakUrl(props.mcp?.url)
  const full: any = { width: '100%' }
  const [voices, setVoices] = React.useState<Array<{ name: string, lang: string, localService?: boolean }>>([])
  const [serverNames, setServerNames] = React.useState<string[]>([])
  const [msg, setMsg] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const save = (patch: any): void => {
    const next = { ...v, ...patch }
    for (const k of Object.keys(next)) if (next[k] === '' || next[k] == null) delete next[k]
    if (next.source === 'browser') delete next.source
    props.set('voice', Object.keys(next).length ? next : undefined)
  }
  React.useEffect(() => {
    let live = true
    void browserVoices().then(list => {
      const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US'
      if (live) setVoices(list.filter(x => String(x.lang || '').toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0]).sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang)).slice(0, 40))
    })
    return () => { live = false }
  }, [])
  const speaker = React.useMemo(() => new Speaker(() => ({ voice: props.voice || null, mcpUrl: props.mcp?.url || '' })), [props.voice, props.mcp?.url])
  React.useEffect(() => () => speaker.stop(), [speaker])

  const check = async (): Promise<void> => {
    setBusy(true); setMsg('')
    try {
      const res = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, credentials: 'omit' })
      const info = await res.json()
      if (Array.isArray(info?.voices)) setServerNames(info.voices.map(String).slice(0, 80))
      setMsg(info?.status === 'ready' ? `OK: the server voice is ready${info.voice ? ` (${info.voice})` : ''}.` : info?.status === 'off' ? 'The server answered, but its voice is turned off. Turn on "voice" in the server\'s config.json (see docs/voice.md).' : `The server answered, but its voice is not set up yet: ${String(info?.status || 'no status')}.`)
    } catch (e) {
      setMsg('Could not reach the server\'s voice. It needs gis-mcp 1.14 or later, and this page\'s address in the server\'s allowed origins.')
    }
    setBusy(false)
  }

  const online = v.online === true
  const shown = online ? voices : voices.filter(x => x.localService !== false)
  const hasOnline = voices.some(x => x.localService === false)
  const known = new Set(SERVER_VOICES.map(x => x[0]))
  return (
    <SettingSection title='Voice'>
      <Hint>How he sounds when someone turns on "Read answers aloud".</Hint>
      <SettingRow flow='wrap' label='Voice'>
        <Select size='sm' style={full} value={source} onChange={(e: any) => { save({ source: e.target.value }); setMsg('') }} aria-label='Voice'>
          <Option value='browser'>The best voice in each person's browser</Option>
          <Option value='server'>One voice from my GIS server (open source)</Option>
        </Select>
      </SettingRow>
      {source === 'browser' && (
        <>
          <SettingRow flow='wrap' label='Prefer this voice'>
            <Select size='sm' style={full} value={v.name || ''} onChange={(e: any) => save({ name: e.target.value })} aria-label='Prefer this voice'>
              <Option value=''>Automatic (the most natural one)</Option>
              {shown.map(x => <Option key={x.name} value={x.name}>{x.name}{x.localService === false ? ' (online)' : ''}</Option>)}
              {v.name && !shown.some(x => x.name === v.name) && <Option value={v.name}>{v.name} (not available here)</Option>}
            </Select>
          </SettingRow>
          <Hint>Voices differ by browser and computer. He uses the one you prefer where a person has it, and the best one otherwise. This list is from your browser.</Hint>
          <SettingRow tag='label' label='Allow online voices'>
            <Switch checked={online} onChange={(e: any) => save({ online: e.target.checked ? true : undefined, name: !e.target.checked && voices.find(x => x.name === v.name)?.localService === false ? undefined : v.name })} />
          </SettingRow>
          <Hint>Off: only voices that speak on the person's own computer, so nothing leaves it. On: he may use the browser's online voices (Microsoft Edge's "Natural" voices, Chrome's Google voices). They sound much better, but the browser sends each answer's words to Microsoft or Google to be spoken.{hasOnline ? '' : ' Your browser has none.'} For a natural voice with nothing sent outside, use the server voice.</Hint>
        </>
      )}
      {source === 'server' && (
        <>
          {!url && <Note tone='warn'>Add your GIS server under MCP server first. The voice lives at the same address.</Note>}
          <SettingRow flow='wrap' label='Server voice'>
            <Select size='sm' style={full} value={v.serverVoice || ''} onChange={(e: any) => save({ serverVoice: e.target.value })} aria-label='Server voice'>
              <Option value=''>The server's own choice</Option>
              {SERVER_VOICES.map(([id, label]) => <Option key={id} value={id}>{label}</Option>)}
              {serverNames.filter(n => !known.has(n)).map(n => <Option key={n} value={n}>{n}</Option>)}
              {v.serverVoice && !known.has(v.serverVoice) && !serverNames.includes(v.serverVoice) && <Option value={v.serverVoice}>{v.serverVoice}</Option>}
            </Select>
          </SettingRow>
          <FullButton type='secondary' disabled={busy || !url} onClick={check}>{busy ? 'Checking...' : 'Check the server\'s voice'}</FullButton>
          {msg && <Note tone={/^OK/.test(msg) ? 'ok' : 'warn'}>{msg}</Note>}
          <Hint>The voice is Kokoro, an open-source model that runs on your own GIS server (gis-mcp 1.14 or later). The words are turned into sound there; nothing goes to an outside service, and there is nothing for people to download. If the server cannot answer, he falls back to the browser's voice. Setup: docs/voice.md.</Hint>
        </>
      )}
      <SettingRow flow='wrap' label='Speed'>
        <Select size='sm' style={full} value={String(v.rate || 1)} onChange={(e: any) => save({ rate: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })} aria-label='Speed'>
          <Option value='0.85'>Slower</Option>
          <Option value='1'>Normal</Option>
          <Option value='1.15'>A little faster</Option>
          <Option value='1.3'>Faster</Option>
        </Select>
      </SettingRow>
      <FullButton onClick={() => { void speaker.speak('Hello! I am Mappy. 8 parcels match. That is 22% of the 36 in the layer.') }}>Hear it</FullButton>
    </SettingSection>
  )
}
