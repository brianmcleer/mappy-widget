/*
  McpSection.tsx - "MCP server" in settings: the second way Mappy can help. Connect a Model
  Context Protocol server (Streamable HTTP), see its tools, and choose which ones people may
  use and which ask first. Tools that could change data start off and always ask first.
*/
import { React, SessionManager } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Button, TextInput, Select, Option, Switch, Checkbox } from 'jimu-ui'
import { McpClient, safeServerUrl } from '../runtime/mcp'
import type { McpSettings } from '../runtime/mcp'
import { changesData, toolLabel } from '../brain/mcpTools'
import type { McpTool, McpToolPref } from '../brain/mcpTools'
import { clip } from '../brain/text'
import { Hint, Note, FullButton, Sub, toneOf } from './ui'

interface Props {
  value: any
  onChange: (v: McpSettings & { enabled?: boolean } | null) => void
}

/** Esri's hosted MCP server for ArcGIS Location Services (beta, Streamable HTTP, Bearer API key). */
const ESRI_LOCATION_MCP = 'https://location-services-mcp.arcgis.com/beta/mcp'

function plainOf (v: any): any { return v && typeof v.asMutable === 'function' ? v.asMutable({ deep: true }) : v }

export default function McpSection (props: Props): any {
  const cfg: any = plainOf(props.value) || {}
  const [url, setUrl] = React.useState<string>(cfg.url || '')
  const [tools, setTools] = React.useState<McpTool[] | null>(null)
  const [status, setStatus] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const save = (patch: any) => props.onChange({ ...cfg, ...patch })
  const prefs: McpToolPref[] = cfg.tools || []
  const full: any = { width: '100%' }

  const connect = async () => {
    if (!safeServerUrl(url)) { setStatus('The address must start with https:// (http:// only for localhost).'); return }
    setBusy(true); setStatus('Connecting...')
    try {
      const client = new McpClient({ ...cfg, url }, () => { try { return SessionManager.getInstance().getMainSession()?.token || null } catch (e) { return null } })
      const list = await client.listTools(true)
      setTools(list)
      // Keep earlier choices; new tools start on only when they cannot change data.
      const next: McpToolPref[] = list.map(t => prefs.find(p => p.name === t.name) || { name: t.name, enabled: !changesData(t), confirm: changesData(t) })
      save({ url, label: cfg.label || client.serverName || '', tools: next })
      setStatus(`Connected to ${client.serverName || 'the server'}: ${list.length} tools, ${next.filter(p => p.enabled).length} turned on.`)
    } catch (e) {
      setStatus(e?.message || String(e))
    } finally { setBusy(false) }
  }

  const useEsri = () => {
    setUrl(ESRI_LOCATION_MCP)
    save({ url: ESRI_LOCATION_MCP, label: cfg.label || 'ArcGIS Location Services', auth: 'header', headerName: 'Authorization', headerValue: cfg.headerValue || '' })
    setStatus('Filled in ArcGIS Location Services (beta). Put "Bearer " and an API key from ArcGIS Location Platform in Header value (privileges: beta access, geocoding, routing, elevation, static maps), then connect.')
  }

  const setPref = (name: string, patch: Partial<McpToolPref>) => save({ tools: prefs.map(p => p.name === name ? { ...p, ...patch } : p) })
  const shown: McpTool[] = tools || prefs.map(p => ({ name: p.name }))
  const onCount = prefs.filter(p => p.enabled).length
  const connected = !!tools || prefs.length > 0

  return (
    <SettingSection title='MCP server'>
      <Hint>Optional. Connect a Model Context Protocol server and Mappy can answer with its tools: your own gis-mcp server (closest feature, what's at an address, owners, zoning), ArcGIS Location Services (addresses, directions, elevation) or another server. Read-only tools run on their own; anything that could change data asks first.</Hint>

      <SettingRow tag='label' label='Use an MCP server'>
        <Switch checked={!!cfg.url && cfg.enabled !== false} onChange={(e: any) => cfg.url ? save({ enabled: e.target.checked }) : null} disabled={!cfg.url} aria-label='Use an MCP server' />
      </SettingRow>

      <SettingRow label='Server address' flow='wrap'>
        <TextInput size='sm' style={full} value={url} placeholder='https://server/gis-mcp/mcp' aria-label='Server address'
          onChange={(e: any) => setUrl(e.target.value.trim())} onAcceptValue={(v: string) => { if (safeServerUrl(v)) save({ url: v.trim() }) }} />
      </SettingRow>
      <SettingRow>
        <Button type='tertiary' size='sm' style={{ padding: 0, height: 'auto' }} onClick={useEsri}>Fill in ArcGIS Location Services (beta)</Button>
      </SettingRow>

      <SettingRow label='Name in the chat' flow='wrap'>
        <TextInput size='sm' style={full} key={'label' + (cfg.label || '')} defaultValue={cfg.label || ''} placeholder='City GIS' aria-label='Name in the chat'
          onAcceptValue={(v: string) => save({ label: v.trim() })} />
      </SettingRow>

      <SettingRow label='Sign in with' flow='wrap'>
        <Select size='sm' style={full} value={cfg.auth || 'none'} onChange={(e: any) => save({ auth: e.target.value })} aria-label='Sign in with'>
          <Option value='arcgis'>The signed-in ArcGIS user</Option>
          <Option value='none'>Nothing (public server)</Option>
          <Option value='header'>A key in a header</Option>
        </Select>
      </SettingRow>
      {cfg.auth === 'header' && <React.Fragment>
        <SettingRow label='Header name' flow='wrap'>
          <TextInput size='sm' style={full} key={'hn' + (cfg.headerName || '')} defaultValue={cfg.headerName || ''} placeholder='Authorization' aria-label='Header name'
            onAcceptValue={(v: string) => save({ headerName: v.trim() })} />
        </SettingRow>
        <SettingRow label='Header value' flow='wrap'>
          <TextInput size='sm' type='password' style={full} key={'hv' + (cfg.headerValue ? 'set' : '')} defaultValue={cfg.headerValue || ''} placeholder='Bearer YOUR_API_KEY' aria-label='Header value'
            onAcceptValue={(v: string) => save({ headerValue: v.trim() })} />
        </SettingRow>
        <Note tone='warn'>Saved in the app and visible to anyone who opens it. Use only a key restricted to this app's address and the services it needs.</Note>
      </React.Fragment>}

      <FullButton disabled={busy || !url} onClick={connect}>{busy ? 'Connecting...' : connected ? 'Reconnect and refresh tools' : 'Connect and list tools'}</FullButton>
      <Note tone={busy ? 'info' : toneOf(status)}>{status}</Note>

      {shown.length > 0 && <React.Fragment>
        <Sub>{`Tools (${onCount} of ${shown.length} on)`}</Sub>
        <Hint>Checked tools can be used. "Ask first" shows a Run button before the tool runs.</Hint>
        <SettingRow flow='wrap'>
          <ul className='ms-tools'>
            {shown.map(t => {
              const p = prefs.find(x => x.name === t.name) || { name: t.name, enabled: false }
              const risky = tools ? changesData(t) : !!p.confirm
              const id = 'mcp-tool-' + t.name.replace(/[^\w-]/g, '_')
              return (
                <li key={t.name} className='ms-tool'>
                  <div className='ms-tool-head'>
                    <Checkbox id={id} checked={p.enabled} onChange={(e: any) => setPref(t.name, { enabled: e.target.checked })} />
                    <label className='ms-tool-name' htmlFor={id} title={t.name}>{toolLabel(t)}</label>
                    <label className='ms-tool-ask' title={risky ? 'Tools that could change data always ask first' : 'Show a Run button first'}>
                      <Checkbox checked={risky || !!p.confirm} disabled={risky || !p.enabled} onChange={(e: any) => setPref(t.name, { confirm: e.target.checked })} />
                      Ask first
                    </label>
                  </div>
                  {t.description && <div className='ms-tool-desc' title={t.description}>{clip(t.description, 200)}</div>}
                  {risky && <span className='ms-badge'>Can change data</span>}
                </li>
              )
            })}
          </ul>
        </SettingRow>
      </React.Fragment>}

      <SettingRow tag='label' label='Answer from the server when Mappy is stuck'>
        <Switch checked={cfg.fallback !== false} onChange={(e: any) => save({ fallback: e.target.checked })} aria-label='Answer from the server when Mappy is stuck' />
      </SettingRow>
      <Hint>Plain questions about places ("closest sewer line to my address") go to the server; other questions only when Mappy cannot answer them himself.</Hint>

      {cfg.url && <FullButton type='tertiary' size='sm' onClick={() => { props.onChange(null); setUrl(''); setTools(null); setStatus('') }}>Remove server</FullButton>}
    </SettingSection>
  )
}
