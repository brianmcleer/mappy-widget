/*
  HelperSection.tsx - "Where he gets help" in settings: one choice for what Mappy turns to
  beyond the app itself, and the chat follows it:
    - This app only.
    - My GIS server (MCP), set up in the section below.
    - Claude, answering in the chat through the GIS server (the server's ask_assistant tool,
      with the organization's Anthropic key kept on the server).
    - Claude in its own app or tab: a link that opens the Claude desktop app or claude.ai with
      the question written, so it runs under the person's own Claude sign-in.
*/
import { React, SessionManager } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Select, Option, Switch, TextInput } from 'jimu-ui'
import { Hint, Note, Sub, LinkButton, FullButton, toneOf } from './ui'
import { helperMode, assistantPort, handoffPrompt, handoffUrl, safeAssistantUrl, DEFAULT_ASSISTANT_LABEL, CLAUDE_APP_URL } from '../brain/handoff'
import type { HelperMode } from '../brain/handoff'
import { McpClient } from '../runtime/mcp'

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
  const name = port?.label || DEFAULT_ASSISTANT_LABEL
  const custom = String(a.url || '').trim()
  const badUrl = !!custom && !safeAssistantUrl(custom)
  const openIn: 'app' | 'browser' | 'other' = custom ? 'other' : a.openIn === 'app' ? 'app' : 'browser'
  const context = { app: props.appTitle, place: '250 N 5th St', center: [39.0672, -108.5645] as [number, number], layersOn: ['Parcels', 'Zoning'] }
  const preview = port ? handoffPrompt(port, SAMPLE, context) : ''
  const link = port ? handoffUrl(port, SAMPLE, context) : null
  const serverName = mcp?.label || mcp?.url || ''
  const [check, setCheck] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // Claude on the server: does the connected server offer ask_assistant?
  const checkServer = async () => {
    if (!mcp?.url) { setCheck('Connect your GIS server in MCP server, below, first.'); return }
    setBusy(true); setCheck('Checking...')
    try {
      const client = new McpClient(mcp, () => { try { return SessionManager.getInstance().getMainSession()?.token || null } catch (e) { return null } })
      const tools = await client.listTools(true)
      setCheck(tools.some(t => t.name === 'ask_assistant')
        ? `Ready: ${client.serverName || serverName} has ${name} turned on.`
        : `Could not find ${name} on ${client.serverName || serverName}. On the server, set "assistant": {"enabled": true} in config.json and the ANTHROPIC_API_KEY environment variable, then restart it. Its /health page says what is missing.`)
    } catch (e) {
      setCheck(e?.message || String(e))
    } finally { setBusy(false) }
  }

  return (
    <SettingSection title='Where he gets help'>
      <Hint>One choice for what he turns to when the app itself is not enough. The chat follows it; nothing else to switch.</Hint>
      <SettingRow label='Help beyond the app' flow='wrap'>
        <Select size='sm' style={full} value={mode} onChange={(e: any) => { props.set('helper', e.target.value); setCheck('') }} aria-label='Help beyond the app'>
          <Option value='local'>This app only</Option>
          <Option value='mcp'>My GIS server (MCP)</Option>
          <Option value='claude'>Claude, answering in the chat (through my GIS server)</Option>
          <Option value='assistant'>Claude, opened in the person's own Claude</Option>
        </Select>
      </SettingRow>

      {mode === 'local' && <Note tone='ok'>He answers from the app's own layers, tools, locator and your answers. Nothing is sent anywhere else.</Note>}

      {mode === 'mcp' && <Note tone={mcp?.url ? 'ok' : 'warn'}>
        {mcp?.url
          ? `Place and data questions go to ${serverName}. Its tools are chosen in MCP server, below.`
          : 'No server is connected yet. Add one in MCP server, below; until then he answers from this app only.'}
      </Note>}

      {mode === 'claude' && <React.Fragment>
        <Note tone={mcp?.url ? 'ok' : 'warn'}>
          {mcp?.url
            ? `He answers map questions himself, uses ${serverName} for place questions, and when he is stuck (or someone says "ask ${name} ..."), ${name} answers right here in the chat with the GIS data. ${name} runs on the server with your organization's key; people need no Claude account, and nothing can change data.`
            : 'Connect your GIS server in MCP server, below. Claude runs there, with your organization\'s key kept on the server.'}
        </Note>
        <SettingRow label='Name in the chat' flow='wrap'>
          <TextInput size='sm' style={full} key={'al' + (a.label || '')} defaultValue={a.label || ''} placeholder={DEFAULT_ASSISTANT_LABEL} aria-label='Assistant name in the chat'
            onAcceptValue={(v: string) => save({ label: String(v || '').trim() })} />
        </SettingRow>
        <SettingRow tag='label' label='Send the clicked feature'>
          <Switch checked={a.shareSelection !== false} onChange={(e: any) => save({ shareSelection: e.target.checked })} aria-label='Send the clicked feature' />
        </SettingRow>
        <Hint>With a popup open, the feature's layer and up to six of its values go along, so "who owns this" works. Turn off to send only where the map is.</Hint>
        <SettingRow tag='label' label='Send a picture of the map'>
          <Switch checked={a.sharePicture === true} onChange={(e: any) => save({ sharePicture: e.target.checked })} aria-label='Send a picture of the map' />
        </SettingRow>
        <Hint>Off unless you turn it on. For questions about what is on screen ("what am I looking at", "which of these is biggest"), a small picture of the map goes to Claude with the question. Whatever is drawn on the map is in the picture, and a picture costs more than text.</Hint>
        <FullButton type='secondary' disabled={busy || !mcp?.url} onClick={checkServer}>{busy ? 'Checking...' : `Check that the server has ${name}`}</FullButton>
        {check && <Note tone={/^Ready/.test(check) ? 'ok' : busy ? 'info' : toneOf(check) === 'info' ? 'warn' : toneOf(check)}>{check}</Note>}
        <Hint>Each answer is a paid call to the Claude API from the server; the server limits questions per person per hour and per day. The question, a line about where the map is, a few values of the feature under an open popup and the data the tools look up go to Anthropic. The same question asked again within a few minutes is answered from the server's memory at no cost; the server's /health page shows today's questions and tokens.</Hint>
      </React.Fragment>}

      {mode === 'assistant' && <React.Fragment>
        <Note tone={badUrl ? 'bad' : 'ok'}>
          {badUrl
            ? 'The address must start with https://. Until it is fixed he answers from this app only.'
            : `He still answers map questions himself. When he is stuck, or someone says "ask ${name}", his answer carries one link that opens ${name} with the question written, signed in the way that person already uses ${name}. Nothing is sent until they click.`}
        </Note>
        <SettingRow label='Open in' flow='wrap'>
          <Select size='sm' style={full} value={openIn} onChange={(e: any) => save(e.target.value === 'other' ? { openIn: 'browser', url: custom || 'https://' } : { openIn: e.target.value, url: '' })} aria-label='Open in'>
            <Option value='app'>The Claude desktop app</Option>
            <Option value='browser'>Claude in the browser (claude.ai)</Option>
            <Option value='other'>Another assistant (an address)</Option>
          </Select>
        </SettingRow>
        <Hint>{openIn === 'app'
          ? `Uses the desktop app's own link (${CLAUDE_APP_URL.replace('{q}', '...')}). People need the Claude desktop app installed; it opens a new chat there with the question filled in for them to send.`
          : openIn === 'browser'
            ? 'Opens claude.ai in a new tab. People need to be signed in to Claude in that browser.'
            : 'An https address with {q} where the question goes.'}</Hint>
        {openIn === 'other' && <SettingRow label='Address that opens it' flow='wrap'>
          <TextInput size='sm' style={full} key={'au' + custom} defaultValue={custom} placeholder='https://assistant.example.org/new?q={q}' aria-label='Address that opens the assistant'
            onAcceptValue={(v: string) => save({ url: String(v || '').trim() })} />
        </SettingRow>}
        <SettingRow label='Name in the chat' flow='wrap'>
          <TextInput size='sm' style={full} key={'al' + (a.label || '')} defaultValue={a.label || ''} placeholder={DEFAULT_ASSISTANT_LABEL} aria-label='Assistant name in the chat'
            onAcceptValue={(v: string) => save({ label: String(v || '').trim() })} />
        </SettingRow>
        <SettingRow label='Written in front of every question' flow='wrap'>
          <TextInput size='sm' style={full} key={'ap' + (a.prefix || '')} defaultValue={a.prefix || ''} placeholder='/my-gis-skill' aria-label='Written in front of every question'
            onAcceptValue={(v: string) => save({ prefix: String(v || '').trim() })} />
        </SettingRow>
        <Hint>Optional. A skill or plugin to use ("/my-gis-skill"), or a short instruction ("Use our GIS skill."). Leave empty to send the question as typed.</Hint>
        <SettingRow tag='label' label='Send where the map is'>
          <Switch checked={a.context !== false} onChange={(e: any) => save({ context: e.target.checked })} aria-label='Send where the map is' />
        </SettingRow>
        <Hint>Adds one line to the question: the address being looked at, the map center and the layers that are on. No feature data is sent.</Hint>
        <SettingRow tag='label' label='Only for signed-in people'>
          <Switch checked={a.signedInOnly !== false} onChange={(e: any) => save({ signedInOnly: e.target.checked })} aria-label='Only for signed-in people' />
        </SettingRow>
        <Hint>On: people who are not signed in to the portal (a public app) never see the link; he answers from this app only for them.</Hint>
        {preview && <React.Fragment>
          <Sub>What gets written</Sub>
          <SettingRow><div className='ms-preview' style={{ whiteSpace: 'pre-wrap' }}>{preview}</div></SettingRow>
          {link && <LinkButton href={link}>{`Try it: open this sample in ${name}`}</LinkButton>}
        </React.Fragment>}
      </React.Fragment>}
    </SettingSection>
  )
}
