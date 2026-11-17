/*
  HelperSection.tsx - "Where he gets help" in settings: one choice for what Mappy turns to
  beyond the app itself. This app only, the MCP server (set up in the section below), or an
  AI assistant in its own tab (Claude by default). The widget follows this one setting; there
  are no extra buttons in the chat. For an assistant the builder sets its name, the address
  that opens it with a question, and a prefix (a skill or plugin name) written in front.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Select, Option, Switch, TextInput } from 'jimu-ui'
import { Hint, Note, Sub } from './ui'
import { helperMode, assistantPort, handoffPrompt, handoffUrl, safeAssistantUrl, DEFAULT_ASSISTANT_LABEL, DEFAULT_ASSISTANT_URL } from '../brain/handoff'
import type { HelperMode } from '../brain/handoff'

interface Props {
  helper: any
  assistant: any
  mcp: any
  appTitle: string
  set: (key: string, value: any) => void
}

function plainOf (v: any): any { return v && typeof v.asMutable === 'function' ? v.asMutable({ deep: true }) : v }

const SAMPLE = 'Which neighborhoods have the most parcels over an acre?'

export default function HelperSection (props: Props): any {
  const mcp: any = plainOf(props.mcp) || null
  const a: any = plainOf(props.assistant) || {}
  const mode: HelperMode = helperMode(props.helper, mcp)
  const save = (patch: any) => props.set('assistant', { ...a, ...patch })
  const full: any = { width: '100%' }
  const port = assistantPort(a)
  const badUrl = !!String(a.url || '').trim() && !safeAssistantUrl(String(a.url).trim())
  const context = { app: props.appTitle, place: '250 N 5th St', center: [39.0672, -108.5645] as [number, number], layersOn: ['Parcels', 'Zoning'] }
  const preview = port ? handoffPrompt(port, SAMPLE, context) : ''
  const link = port ? handoffUrl(port, SAMPLE, context) : null
  const serverName = mcp?.label || mcp?.url || ''

  return (
    <SettingSection title='Where he gets help'>
      <Hint>One choice for what he turns to when the app itself is not enough. The chat follows it; nothing else to switch.</Hint>
      <SettingRow label='Help beyond the app' flow='wrap'>
        <Select size='sm' style={full} value={mode} onChange={(e: any) => props.set('helper', e.target.value)} aria-label='Help beyond the app'>
          <Option value='local'>This app only</Option>
          <Option value='mcp'>My GIS server (MCP)</Option>
          <Option value='assistant'>An AI assistant (Claude)</Option>
        </Select>
      </SettingRow>

      {mode === 'local' && <Note tone='ok'>He answers from the app's own layers, tools, locator and your answers. Nothing is sent anywhere else.</Note>}

      {mode === 'mcp' && <Note tone={mcp?.url ? 'ok' : 'warn'}>
        {mcp?.url
          ? `Place and data questions go to ${serverName}. Its tools are chosen in MCP server, below.`
          : 'No server is connected yet. Add one in MCP server, below; until then he answers from this app only.'}
      </Note>}

      {mode === 'assistant' && <React.Fragment>
        <Note tone={badUrl ? 'bad' : 'ok'}>
          {badUrl
            ? 'The address must start with https://. Until it is fixed he answers from this app only.'
            : `He still answers map questions himself. When he is stuck, or someone says "ask ${port?.label || DEFAULT_ASSISTANT_LABEL}", his answer carries one link that opens ${port?.label || DEFAULT_ASSISTANT_LABEL} in a new tab with the question written. Nothing is sent until the person clicks, and it runs under their own account there. The MCP server is not used.`}
        </Note>
        <SettingRow label='Name in the chat' flow='wrap'>
          <TextInput size='sm' style={full} key={'al' + (a.label || '')} defaultValue={a.label || ''} placeholder={DEFAULT_ASSISTANT_LABEL} aria-label='Assistant name in the chat'
            onAcceptValue={(v: string) => save({ label: String(v || '').trim() })} />
        </SettingRow>
        <SettingRow label='Written in front of every question' flow='wrap'>
          <TextInput size='sm' style={full} key={'ap' + (a.prefix || '')} defaultValue={a.prefix || ''} placeholder='/my-gis-skill' aria-label='Written in front of every question'
            onAcceptValue={(v: string) => save({ prefix: String(v || '').trim() })} />
        </SettingRow>
        <Hint>Optional. A skill or plugin to use ("/my-gis-skill"), or a short instruction ("Use our GIS skill."). Leave empty to send the question as typed.</Hint>
        <SettingRow label='Address that opens it' flow='wrap'>
          <TextInput size='sm' style={full} key={'au' + (a.url || '')} defaultValue={a.url || ''} placeholder={DEFAULT_ASSISTANT_URL} aria-label='Address that opens the assistant'
            onAcceptValue={(v: string) => save({ url: String(v || '').trim() })} />
        </SettingRow>
        <Hint>{'Leave empty for Claude. For another assistant, use its address with {q} where the question goes.'}</Hint>
        <SettingRow tag='label' label='Send where the map is'>
          <Switch checked={a.context !== false} onChange={(e: any) => save({ context: e.target.checked })} aria-label='Send where the map is' />
        </SettingRow>
        <Hint>Adds one line to the question: the address being looked at, the map center and the layers that are on. No feature data is sent.</Hint>
        <SettingRow tag='label' label='Only for signed-in people'>
          <Switch checked={a.signedInOnly !== false} onChange={(e: any) => save({ signedInOnly: e.target.checked })} aria-label='Only for signed-in people' />
        </SettingRow>
        <Hint>On: people who are not signed in to the portal (a public app) never see the assistant; he answers from this app only for them.</Hint>
        {preview && <React.Fragment>
          <Sub>What gets written</Sub>
          <SettingRow><div className='ms-preview' style={{ whiteSpace: 'pre-wrap' }}>{preview}</div></SettingRow>
          {link && <SettingRow><a href={link} target='_blank' rel='noopener noreferrer' style={{ fontSize: 12 }}>{`Try it: open this sample in ${port?.label}`}</a></SettingRow>}
        </React.Fragment>}
      </React.Fragment>}
    </SettingSection>
  )
}
