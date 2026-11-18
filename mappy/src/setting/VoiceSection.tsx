/*
  VoiceSection.tsx - "Voice" in settings: how Mappy sounds when he reads answers aloud, with the
  browser's own voices. "Hear it" plays a sentence with the choice as it stands.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Select, Option, Switch } from 'jimu-ui'
import { Hint, FullButton } from './ui'
import { voiceScore } from '../brain/speech'
import { Speaker, browserVoices } from '../runtime/speech'

interface Props {
  voice: any
  set: (key: string, value: any) => void
}

export default function VoiceSection (props: Props): any {
  const v = props.voice || {}
  const full: any = { width: '100%' }
  const [voices, setVoices] = React.useState<Array<{ name: string, lang: string, localService?: boolean }>>([])
  const save = (patch: any): void => {
    const next = { ...v, ...patch }
    for (const k of Object.keys(next)) if (next[k] === '' || next[k] == null) delete next[k]
    delete next.source; delete next.serverVoice
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
  const speaker = React.useMemo(() => new Speaker(() => ({ voice: props.voice || null })), [props.voice])
  React.useEffect(() => () => speaker.stop(), [speaker])

  const online = v.online === true
  const shown = online ? voices : voices.filter(x => x.localService !== false)
  const hasOnline = voices.some(x => x.localService === false)
  return (
    <SettingSection title='Voice'>
      <Hint>How he sounds when someone turns on "Read answers aloud".</Hint>
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
      <Hint>Off: only voices that speak on the person's own computer, so nothing leaves it. On: he may use the browser's online voices (Microsoft Edge's "Natural" voices, Chrome's Google voices). They sound much better, but the browser sends each answer's words to Microsoft or Google to be spoken.{hasOnline ? '' : ' Your browser has none.'}</Hint>
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
