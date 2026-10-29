/*
  PreviewSection.tsx - "Preview" in settings: see Mappy in any of his outfits or acts without
  waiting for the day. Picks only change the preview, never the saved config.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Select, Option, Button } from 'jimu-ui'
import { Hint } from './ui'
import { allOutfits, season } from '../brain/fun'
import { ACT_MOODS, IDLE_ACTS } from '../brain/acts'
import MappyCharacter from '../runtime/components/MappyCharacter'
import { injectStyles } from '../runtime/styles'

const MOODS = ['idle', 'wave', 'talk', 'think', 'search', 'happy', 'celebrate', 'confused', 'sleep', 'point', 'love', 'excited', 'dance', 'roll', 'dizzy', 'party']
const label = (s: string): string => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())

export default function PreviewSection (): any {
  const [hat, setHat] = React.useState<string>('today')
  const [act, setAct] = React.useState<string>('idle')
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => { try { injectStyles() } catch (e) { } }, [])
  const outfits = React.useMemo(() => allOutfits(), [])
  const today = season()
  const hatProp = hat === 'today' ? undefined : hat === 'none' ? null : hat
  const isIdleAct = (IDLE_ACTS as readonly string[]).includes(act)
  const mood: any = isIdleAct ? 'idle' : act
  return (
    <SettingSection title='Preview'>
      <Hint>See him in any outfit or act now, without waiting for the day. This changes nothing in the app.</Hint>
      <SettingRow label='Outfit'>
        <Select size='sm' value={hat} onChange={(e: any) => { setHat(e.target.value); setTick(t => t + 1) }} aria-label='Outfit to preview'>
          <Option value='today'>{today.name ? `Today: ${today.name}` : 'Today (plain)'}</Option>
          <Option value='none'>None</Option>
          {outfits.map(o => <Option key={o.hat} value={o.hat}>{o.name}</Option>)}
        </Select>
      </SettingRow>
      <SettingRow label='Act'>
        <Select size='sm' value={act} onChange={(e: any) => { setAct(e.target.value); setTick(t => t + 1) }} aria-label='Act to preview'>
          <Option value='idle'>Idle</Option>
          {MOODS.filter(m => m !== 'idle').map(m => <Option key={m} value={m}>{label(m)}</Option>)}
          {ACT_MOODS.map(m => <Option key={m} value={m}>{label(m)} (act)</Option>)}
          {IDLE_ACTS.map(m => <Option key={m} value={m}>{label(m)} (idle act)</Option>)}
        </Select>
      </SettingRow>
      <SettingRow>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ position: 'relative', width: 150, height: 150, overflow: 'visible' }}>
            <MappyCharacter
              key={tick}
              id={'mappy-preview-' + tick}
              mood={mood}
              skit={isIdleAct ? act : undefined}
              px={120}
              label='Mappy preview'
              expanded={false}
              controls=''
              still={false}
              phase='shown'
              hat={hatProp}
              lookAt={null}
              pointDir={null}
            />
          </div>
          <Button size='sm' onClick={() => setTick(t => t + 1)}>Play again</Button>
        </div>
      </SettingRow>
      <Hint>{`${outfits.length} outfits across the year. The day's outfit shows only when "Jokes, games and holiday hats" is on.`}</Hint>
    </SettingSection>
  )
}
