/*
  McpSection.tsx - "MCP server" in settings: the second way Mappy can help. Connect a Model
  Context Protocol server (Streamable HTTP), see its tools, and choose which ones people may
  use and which ask first. Tools that could change data start off and always ask first.
*/
import { React, SessionManager } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Button, TextInput, Select, Option, Switch, Checkbox, Label } from 'jimu-ui'
import { McpClient, safeServerUrl } from '../runtime/mcp'
import type { McpSettings } from '../runtime/mcp'
import { changesData, toolLabel } from '../brain/mcpTools'
import type { McpTool, McpToolPref } from '../brain/mcpTools'
import { clip } from '../brain/text'

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
  const hint: any = { fontSize: 12, opacity: 0.8, lineHeight: 1.4 }
  const save = (patch: any) => props.onChange({ ...cfg, ...patch })
  const prefs: McpToolPref[] = cfg.tools || []

  const connect = async () => {
    if (!safeServerUrl(url)) { setStatus('Use an https:// address (http:// only for localhost).'); return }
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

  const setPref = (name: string, patch: Partial<McpToolPref>) => save({ tools: prefs.map(p => p.name === name ? { ...p, ...patch } : p) })
  const shown: McpTool[] = tools || prefs.map(p => ({ name: p.name }))

  return (
    <SettingSection title='MCP server'>
      <SettingRow>
        <div style={hint}>Optional. Connect a Model Context Protocol server and Mappy can use its tools: ArcGIS Location Platform's MCP (find addresses, directions, elevation, map pictures), a portal MCP server (content search, feature queries) or your own. He picks the tool, fills it in from what was typed, and asks first before anything that could change data. What people type is sent to this server when a tool runs.</div>
      </SettingRow>
      <SettingRow>
        <Button size='sm' type='secondary' onClick={() => { setUrl(ESRI_LOCATION_MCP); save({ url: ESRI_LOCATION_MCP, label: cfg.label || 'ArcGIS Location Services', auth: 'header', headerName: 'Authorization', headerValue: cfg.headerValue || '' }); setStatus('Filled in ArcGIS Location Services (beta). Paste "Bearer " and an API key from ArcGIS Location Platform into Header value (privileges: beta access, geocoding, routing, elevation, static maps), then Connect.') }}>Use ArcGIS Location Services (beta)</Button>
      </SettingRow>
      <SettingRow tag='label' label='Use an MCP server'>
        <Switch checked={!!cfg.url && cfg.enabled !== false} onChange={(e: any) => cfg.url ? save({ enabled: e.target.checked }) : null} disabled={!cfg.url} />
      </SettingRow>
      <SettingRow label='Server address' flow='wrap'>
        <TextInput size='sm' style={{ width: '100%' }} value={url} placeholder='https://example.com/mcp' onChange={(e: any) => setUrl(e.target.value.trim())} onAcceptValue={(v: string) => { if (safeServerUrl(v)) save({ url: v.trim() }) }} />
      </SettingRow>
      <SettingRow label='Name in the chat' flow='wrap'>
        <TextInput size='sm' style={{ width: '100%' }} key={'label' + (cfg.label || '')} defaultValue={cfg.label || ''} placeholder='ArcGIS Location Services' onAcceptValue={(v: string) => save({ label: v.trim() })} />
      </SettingRow>
      <SettingRow label='Sign in with' flow='wrap'>
        <Select size='sm' value={cfg.auth || 'none'} onChange={(e: any) => save({ auth: e.target.value })}>
          <Option value='none'>Nothing (public server)</Option>
          <Option value='arcgis'>The signed-in ArcGIS user</Option>
          <Option value='header'>A key in a header</Option>
        </Select>
      </SettingRow>
      {cfg.auth === 'header' && <React.Fragment>
        <SettingRow label='Header name' flow='wrap'>
          <TextInput size='sm' style={{ width: '100%' }} key={'hn' + (cfg.headerName || '')} defaultValue={cfg.headerName || ''} placeholder='Authorization' onAcceptValue={(v: string) => save({ headerName: v.trim() })} />
        </SettingRow>
        <SettingRow label='Header value' flow='wrap'>
          <TextInput size='sm' type='password' style={{ width: '100%' }} key={'hv' + (cfg.headerValue ? 'set' : '')} defaultValue={cfg.headerValue || ''} placeholder='Bearer YOUR_API_KEY' onAcceptValue={(v: string) => save({ headerValue: v.trim() })} />
        </SettingRow>
        <SettingRow><div style={{ ...hint, color: 'var(--sys-color-error-main, #b40000)', opacity: 1 }}>Anything here is saved in the app and visible to anyone who opens it. Use only a key restricted to this app's address and to the services it needs.</div></SettingRow>
      </React.Fragment>}
      <SettingRow>
        <Button type='primary' disabled={busy || !url} onClick={connect}>{tools ? 'Reconnect' : 'Connect and list tools'}</Button>
      </SettingRow>
      {status && <SettingRow><div style={hint} role='status' aria-live='polite'>{status}</div></SettingRow>}
      {shown.length > 0 && <SettingRow flow='wrap'>
        <div style={{ width: '100%' }}>
          <div style={{ ...hint, marginBottom: 4 }}>Tools people may use. “Ask first” shows a Run button before the tool runs.</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 260, overflowY: 'auto' }}>
            {shown.map(t => {
              const p = prefs.find(x => x.name === t.name) || { name: t.name, enabled: false }
              const risky = tools ? changesData(t) : !!p.confirm
              return (
                <li key={t.name} style={{ padding: '4px 0', borderBottom: '1px solid var(--sys-color-divider-secondary, #ddd)' }}>
                  <Label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', margin: 0 }}>
                    <Checkbox checked={p.enabled} onChange={(e: any) => setPref(t.name, { enabled: e.target.checked })} />
                    <span>{toolLabel(t)}{risky && <em style={{ fontSize: 11, marginLeft: 4 }}>(can change data)</em>}</span>
                  </Label>
                  {t.description && <div style={{ ...hint, marginLeft: 24 }}>{clip(t.description, 140)}</div>}
                  <Label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 24, fontSize: 12, cursor: risky ? 'default' : 'pointer' }}>
                    <Checkbox checked={risky || !!p.confirm} disabled={risky} onChange={(e: any) => setPref(t.name, { confirm: e.target.checked })} />
                    Ask first
                  </Label>
                </li>
              )
            })}
          </ul>
        </div>
      </SettingRow>}
      <SettingRow tag='label' label='Offer the server when Mappy is stuck'>
        <Switch checked={cfg.fallback !== false} onChange={(e: any) => save({ fallback: e.target.checked })} />
      </SettingRow>
      {cfg.url && <SettingRow><Button type='tertiary' size='sm' onClick={() => { props.onChange(null); setUrl(''); setTools(null); setStatus('') }}>Remove server</Button></SettingRow>}
    </SettingSection>
  )
}
