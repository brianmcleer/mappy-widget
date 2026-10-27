/*
  setting.tsx - Mappy's builder panel: map choice, the deep scan and folder scan that build
  his brain, a live "try it" box, the author's own answers, and character options.
  No static esri imports here (WIDGETHANDOFF 12.1); deepScan.ts loads esri/request on click.
*/
import { React, ReactRedux, Immutable } from 'jimu-core'
import { SettingSection, SettingRow, MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import { Switch, TextInput, TextArea, Select, Option, Button, NumericInput, Checkbox, Label } from 'jimu-ui'
import type { IMConfig } from '../config'
import type { Brain } from '../brain/types'
import type { FaqEntry } from '../brain/admin'
import { adminDocs } from '../brain/admin'
import { MappyIndex } from '../brain/engine'
import { extractApp } from '../brain/extract'
import { answerQuestion } from '../brain/answer'
import { deepScan, mergeFolderDocs, statsFor } from './deepScan'
import type { ScanOptions } from './deepScan'
import { scanHelpFolder, folderPickerSupported } from './folderScan'
import { scanBundledHelp } from './bundledHelp'
import { defaultMapIds } from './setup'
import { esriDocsForApp } from '../brain/docsPack'
import { ESRI_DOCS_READ } from '../brain/esriDocs'
import { __setIntl, __t } from './i18n-t'
import LanguageSection from './LanguageSection'
import McpSection from './McpSection'
import { lexiconFor, readRequest } from '../brain/language'

/** Local structural type: the shim declares jimu-for-builder shorthand (WIDGETHANDOFF 12.3). */
interface SettingProps {
  id: string
  config: IMConfig
  onSettingChange: (settings: any, ...rest: any[]) => void
  useMapWidgetIds?: any
  intl?: any
  [key: string]: any
}

function plain<T> (v: any): T {
  if (!v) return v
  return typeof v.asMutable === 'function' ? v.asMutable({ deep: true }) : v
}

export default function Setting (props: SettingProps): any {
  __setIntl(props.intl)
  const config: any = props.config
  const latest = React.useRef(props)
  latest.current = props
  const appConfig = ReactRedux.useSelector((s: any) => s.appStateInBuilder?.appConfig || s.appConfig)
  const brain: Brain | null = React.useMemo(() => plain<Brain>(config.brain) || null, [config.brain])
  React.useEffect(() => {
    const ids = defaultMapIds(appConfig, props.useMapWidgetIds)
    if (ids) latest.current.onSettingChange({ id: props.id, useMapWidgetIds: ids })
  }, [appConfig?.widgets, props.useMapWidgetIds])
  const faq: FaqEntry[] = React.useMemo(() => plain<FaqEntry[]>(config.faq) || [], [config.faq])

  const set = (key: string, value: any) => latest.current.onSettingChange({ id: props.id, config: latest.current.config.set(key as any, value) })

  // ------------------------------------------------------------ scan state
  const [opts, setOpts] = React.useState<ScanOptions>({ webMaps: true, services: true, items: true, manifests: true, esriDocs: true, guides: true, maxLayers: 400 })
  const [scanning, setScanning] = React.useState(false)
  const [progress, setProgress] = React.useState('')
  const [log, setLog] = React.useState<string[]>([])
  const [onlyUsed, setOnlyUsed] = React.useState(true)
  const cancelRef = React.useRef(false)
  const busyRef = React.useRef(false)
  const startedRef = React.useRef(false)
  const mountedRef = React.useRef(true)
  React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; cancelRef.current = true } }, [])

  const runScan = async () => {
    if (busyRef.current) return
    busyRef.current = true
    cancelRef.current = false
    setScanning(true)
    setLog([])
    setProgress(__t('scanning'))
    try {
      const fresh = await deepScan(appConfig, opts, p => {
        if (cancelRef.current || !mountedRef.current) return
        setProgress(p.total > 1 ? `${p.log} (${p.done}/${p.total})` : p.log)
        if (p.log && !/^Reading layers/.test(p.log)) setLog(l => [...l, p.log].slice(-30))
      }, () => cancelRef.current)
      if (cancelRef.current || !mountedRef.current) return
      const saved = plain<Brain>(latest.current.config.brain)
      let merged = saved ? mergeFolderDocs(fresh, saved.docs.filter(d => d.src === 'folder'), appConfig) : fresh
      try {
        const help = await scanBundledHelp(appConfig, onlyUsed, msg => setLog(l => [...l, msg].slice(-30)))
        merged = mergeFolderDocs(merged, [...(saved?.docs || []).filter(d => d.id.startsWith('hdoc:')), ...help.docs], appConfig)
      } catch (e: any) {
        merged.notes = [...(merged.notes || []), `Installed widget help: ${e?.message || String(e)}`]
      }
      if (cancelRef.current || !mountedRef.current) return
      latest.current.onSettingChange({ id: props.id, config: latest.current.config.set('brain', merged).set('setupVersion', 1) })
      setProgress('Ready. App knowledge, map metadata and available widget help are saved. Review details for any unavailable sources.')
    } catch (e: any) {
      if (mountedRef.current) setProgress(__t('scanFailed', { msg: e?.message || String(e) }))
    } finally {
      busyRef.current = false
      if (mountedRef.current) { setScanning(false); if (cancelRef.current) setProgress('Setup stopped. Your saved knowledge is unchanged.') }
    }
  }

  // One initial setup per saved widget; opening settings later never starts another crawl.
  React.useEffect(() => {
    if (!appConfig || startedRef.current || config.setupVersion === 1) return
    const timer = setTimeout(() => {
      if (startedRef.current || !mountedRef.current) return
      startedRef.current = true
      void runScan()
    }, 0)
    return () => clearTimeout(timer)
  }, [appConfig, config.setupVersion])

  const runFolder = async () => {
    setScanning(true)
    setProgress(__t('scanning'))
    try {
      const res = await scanBundledHelp(appConfig, onlyUsed, msg => setLog(l => [...l, msg].slice(-30)))
      if (!res) { setProgress(''); return }
      set('brain', mergeFolderDocs(brain, res.docs, appConfig))
      setProgress(__t('folderDone', { n: res.docs.length, w: res.widgetsRead.length }))
    } catch (e: any) {
      setProgress(__t('scanFailed', { msg: e?.message || String(e) }))
    } finally {
      setScanning(false)
    }
  }

  /** Adds the bundled ArcGIS documentation for the out-of-the-box widgets this app uses. No network. */
  const runDocs = () => {
    const pack = esriDocsForApp(appConfig)
    const base: Brain = brain || { v: 1, builtAt: Date.now(), appTitle: appConfig?.attributes?.title, stats: {}, docs: [], layers: [], manifests: {}, notes: [] }
    const next: Brain = { ...base, docs: [...base.docs.filter(d => !d.id.startsWith('esri:')), ...pack.docs], builtAt: Date.now() }
    next.stats = statsFor(next, appConfig)
    set('brain', next)
    const msg = pack.covered.length ? __t('docsDone', { n: pack.covered.length, list: pack.covered.join(', ') }) : __t('docsNone')
    setProgress(msg)
    setLog(l => [...l, msg].slice(-30))
  }

  const runHelpFolder = async () => {
    setScanning(true)
    setProgress(__t('scanning'))
    try {
      const res = await scanHelpFolder(msg => setLog(l => [...l, msg].slice(-30)))
      if (!res) { setProgress(''); return }
      const base: Brain = brain || { v: 1, builtAt: Date.now(), appTitle: appConfig?.attributes?.title, stats: {}, docs: [], layers: [], manifests: {}, notes: [] }
      const next: Brain = { ...base, docs: [...base.docs.filter(d => !d.id.startsWith('hdoc:')), ...res.docs], builtAt: Date.now() }
      next.stats = statsFor(next, appConfig)
      set('brain', next)
      setProgress(res.notes[0] || '')
    } catch (e: any) {
      setProgress(__t('scanFailed', { msg: e?.message || String(e) }))
    } finally {
      setScanning(false)
    }
  }

  // ------------------------------------------------------------ try it
  const index = React.useMemo(() => {
    const docs = []
    try { docs.push(...extractApp(appConfig, brain?.manifests).docs) } catch (e) { }
    if (brain?.docs) docs.push(...brain.docs)
    docs.push(...adminDocs(faq, config.notes))
    return new MappyIndex(docs)
  }, [appConfig, brain, faq, config.notes])
  const [q, setQ] = React.useState('')
  const [preview, setPreview] = React.useState<any>(null)
  const runTry = () => {
    if (!q.trim()) return
    const read = readRequest(q.trim(), lexiconFor(index.docs.map(d => d.title), index))
    setPreview({ ...answerQuestion(index, read.text), readAs: read.swaps.length ? read.text : '' })
  }

  // ------------------------------------------------------------ FAQ
  const setFaq = (list: FaqEntry[]) => set('faq', Immutable(list))
  const updateFaq = (i: number, patch: Partial<FaqEntry>) => setFaq(faq.map((f, j) => j === i ? { ...f, ...patch } : f))

  const when = brain ? new Date(brain.builtAt).toLocaleString() : ''
  const stats = brain?.stats || {}
  const kb = Math.round((stats._chars || 0) / 1024)
  const row: any = { width: '100%' }
  const hint: any = { fontSize: 12, opacity: 0.8, marginTop: 4, lineHeight: 1.4 }

  return (
    <div className='widget-setting-mappy' style={{ paddingBottom: 24 }}>
      <SettingSection title={__t('map')}>
        <SettingRow>
          <MapWidgetSelector onSelect={(ids: string[]) => props.onSettingChange({ id: props.id, useMapWidgetIds: ids })} useMapWidgetIds={props.useMapWidgetIds} />
        </SettingRow>
        <SettingRow><div style={hint}>{__t('mapHint')}</div></SettingRow>
      </SettingSection>

      <SettingSection title={__t('brain')}>
        <SettingRow>
          <div style={hint} role='status' aria-live='polite'>
            {brain ? __t('brainBuilt', { when, layers: (stats.layer || 0) + (stats.table || 0), docs: brain.docs.length + (stats._app || 0), kb }) : __t('brainEmpty')}
          </div>
        </SettingRow>
        <SettingRow><div style={hint}>Setup runs automatically the first time. After changing your app, refresh everything with one button.</div></SettingRow>
        <SettingRow><div style={{ ...row, display: 'flex', gap: 8 }}>
          <Button type='primary' disabled={scanning || !appConfig} onClick={runScan}>{scanning ? 'Learning your app…' : 'Refresh app knowledge'}</Button>
          {scanning && <Button onClick={() => { cancelRef.current = true }}>Stop</Button>}
        </div></SettingRow>
        {progress && <SettingRow><div style={hint} role='status' aria-live='polite'>{progress}</div></SettingRow>}
        <details style={{ padding: '8px 16px' }}><summary style={{ cursor: 'pointer' }}>Advanced knowledge options</summary>
        {(['webMaps', 'services', 'items', 'manifests', 'esriDocs', 'guides'] as const).map(k => (
          <SettingRow key={k}>
            <Label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Checkbox checked={opts[k]} onChange={(e: any) => setOpts({ ...opts, [k]: e.target.checked })} />
              {__t('scan' + k.charAt(0).toUpperCase() + k.slice(1))}
            </Label>
          </SettingRow>
        ))}
        <SettingRow label={__t('maxLayers')}>
          <NumericInput size='sm' style={{ width: 90 }} min={10} max={2000} value={opts.maxLayers} onChange={(v: number) => setOpts({ ...opts, maxLayers: Number(v) || 400 })} />
        </SettingRow>

        <SettingRow><Label style={{ fontWeight: 600, marginTop: 8 }}>{__t('folderTitle')}</Label></SettingRow>
        <SettingRow><div style={hint}>{__t('folderHint')}</div></SettingRow>
        <SettingRow tag='label' label={__t('folderOnlyUsed')}>
          <Switch checked={onlyUsed} onChange={(e: any) => setOnlyUsed(e.target.checked)} />
        </SettingRow>
        <SettingRow>
          <div style={{ ...row, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button disabled={scanning} onClick={runFolder}>{__t('scanFolder')}</Button>
          </div>
        </SettingRow>

        <SettingRow><Label style={{ fontWeight: 600, marginTop: 8 }}>{__t('helpFilesTitle')}</Label></SettingRow>
        <SettingRow><div style={hint}>{__t('helpFilesHint')}</div></SettingRow>
        <SettingRow>
          <Button disabled={scanning || !folderPickerSupported()} onClick={runHelpFolder}>{__t('scanHelpFiles')}</Button>
        </SettingRow>

        <SettingRow><Label style={{ fontWeight: 600, marginTop: 8 }}>{__t('docsTitle')}</Label></SettingRow>
        <SettingRow><div style={hint}>{__t('docsHint', { read: ESRI_DOCS_READ })}</div></SettingRow>
        <SettingRow>
          <div style={{ ...row, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button disabled={scanning || !appConfig} onClick={runDocs}>{__t('pullDocs')}</Button>
            {brain && <Button type='tertiary' disabled={scanning} onClick={() => { set('brain', null); setLog([]); setProgress('') }}>{__t('clearBrain')}</Button>}
          </div>
        </SettingRow>
        {(log.length > 0 || (brain?.notes?.length || 0) > 0) && (
          <SettingRow>
            <details style={row}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>{__t('log')}</summary>
              <ul style={{ fontSize: 11, paddingLeft: 16, margin: '6px 0', maxHeight: 180, overflowY: 'auto' }}>
                {(log.length ? log : brain?.notes || []).map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </details>
          </SettingRow>
        )}
        </details>
      </SettingSection>

      <SettingSection title={__t('tryIt')}>
        <SettingRow><div style={hint}>{__t('tryHint')}</div></SettingRow>
        <SettingRow>
          <div style={{ ...row, display: 'flex', gap: 6 }}>
            <TextInput size='sm' style={{ flex: 1 }} value={q} placeholder={__t('tryPlaceholder')} onChange={(e: any) => setQ(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter') runTry() }} aria-label={__t('tryIt')} />
            <Button size='sm' onClick={runTry}>{__t('tryIt')}</Button>
          </div>
        </SettingRow>
        {preview && (
          <SettingRow>
            <div style={{ ...row, fontSize: 12, lineHeight: 1.45, background: 'var(--sys-color-surface-background, #f7f7f7)', padding: 8, borderRadius: 6 }} role='status' aria-live='polite'>
              {preview.readAs && <div style={{ opacity: 0.8, marginBottom: 4 }}>{`Read as “${preview.readAs}”`}</div>}
              <div>{String(preview.text).replace(/\*\*/g, '')}</div>
              {preview.actions?.length > 0 && <div style={{ marginTop: 4, opacity: 0.8 }}>{'→ '}{preview.actions.map((a: any) => a.label).join(' · ')}</div>}
              {preview.list?.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{preview.list.map((it: any, i: number) => <li key={i}>{it.label}</li>)}</ul>}
            </div>
          </SettingRow>
        )}
      </SettingSection>

      <LanguageSection stored={config.languagePack} onChange={(pack: any) => set('languagePack', pack)} />

      <McpSection value={config.mcp} onChange={(v: any) => set('mcp', v)} />

      <details><summary style={{ padding: 16, cursor: 'pointer' }}>Custom answers and notes</summary>
      <SettingSection title={__t('knowledge')}>
        <SettingRow><div style={hint}>{__t('knowledgeHint')}</div></SettingRow>
        {faq.map((f, i) => (
          <SettingRow key={i}>
            <div style={{ ...row, border: '1px solid var(--sys-color-divider-secondary, #ddd)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <TextInput size='sm' value={f.q} placeholder={__t('question')} aria-label={__t('question')} onChange={(e: any) => updateFaq(i, { q: e.target.value })} />
              <TextArea height={60} value={f.a} placeholder={__t('answer')} aria-label={__t('answer')} onChange={(e: any) => updateFaq(i, { a: e.target.value })} />
              <TextInput size='sm' value={f.url || ''} placeholder={__t('link')} aria-label={__t('link')} onChange={(e: any) => updateFaq(i, { url: e.target.value })} />
              <Button size='sm' type='tertiary' onClick={() => setFaq(faq.filter((x, j) => j !== i))}>{__t('remove')}</Button>
            </div>
          </SettingRow>
        ))}
        <SettingRow>
          <Button size='sm' onClick={() => setFaq([...faq, { q: '', a: '' }])}>{__t('addFaq')}</Button>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('notes')}>
          <TextArea height={110} value={config.notes || ''} aria-label={__t('notes')} onChange={(e: any) => set('notes', e.target.value)} />
        </SettingRow>
        <SettingRow><div style={hint}>{__t('notesHint')}</div></SettingRow>
      </SettingSection>

      </details>
      <details><summary style={{ padding: 16, cursor: 'pointer' }}>Appearance and behavior</summary>
      <SettingSection title={__t('character')}>
        <SettingRow flow='wrap' label={__t('name')}>
          <TextInput size='sm' value={config.assistantName || ''} placeholder='Mappy' onChange={(e: any) => set('assistantName', e.target.value)} aria-label={__t('name')} />
        </SettingRow>
        <SettingRow flow='wrap' label={__t('greeting')}>
          <TextArea height={60} value={config.greeting || ''} onChange={(e: any) => set('greeting', e.target.value)} aria-label={__t('greeting')} />
        </SettingRow>
        <SettingRow><div style={hint}>{__t('greetingHint')}</div></SettingRow>
        <SettingRow flow='wrap' label={__t('display')}>
          <Select size='sm' value={config.displayMode || 'floating'} onChange={(e: any) => set('displayMode', e.target.value)} aria-label={__t('display')}>
            <Option value='floating'>{__t('floating')}</Option>
            <Option value='inline'>{__t('inline')}</Option>
          </Select>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('corner')}>
          <Select size='sm' value={config.corner || 'bottom-right'} onChange={(e: any) => set('corner', e.target.value)} aria-label={__t('corner')}>
            <Option value='bottom-right'>{__t('bottomRight')}</Option>
            <Option value='bottom-left'>{__t('bottomLeft')}</Option>
          </Select>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('size')}>
          <Select size='sm' value={config.size || 'medium'} onChange={(e: any) => set('size', e.target.value)} aria-label={__t('size')}>
            <Option value='small'>{__t('small')}</Option>
            <Option value='medium'>{__t('medium')}</Option>
            <Option value='large'>{__t('large')}</Option>
          </Select>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('bubble')}>
          <Select size='sm' value={config.bubbleStyle || 'classic'} onChange={(e: any) => set('bubbleStyle', e.target.value)} aria-label={__t('bubble')}>
            <Option value='classic'>{__t('classic')}</Option>
            <Option value='theme'>{__t('theme')}</Option>
          </Select>
        </SettingRow>
        <SettingRow tag='label' label={__t('draggable')}>
          <Switch checked={config.draggable !== false} onChange={(e: any) => set('draggable', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={__t('greetFirst')}>
          <Switch checked={config.greetOnFirstVisit !== false} onChange={(e: any) => set('greetOnFirstVisit', e.target.checked)} />
        </SettingRow>
      </SettingSection>

      <SettingSection title={__t('behavior')}>
        <SettingRow tag='label' label={__t('tips')}>
          <Switch checked={config.tipsEnabled !== false} onChange={(e: any) => set('tipsEnabled', e.target.checked)} />
        </SettingRow>
        {config.tipsEnabled !== false && (
          <SettingRow label={__t('tipInterval')}>
            <NumericInput size='sm' style={{ width: 90 }} min={30} max={3600} value={config.tipIntervalSec || 180} onChange={(v: number) => set('tipIntervalSec', Number(v) || 180)} />
          </SettingRow>
        )}
        <SettingRow tag='label' label={__t('showInLayerList')}>
          <Switch checked={config.showInLayerList !== false} onChange={(e: any) => set('showInLayerList', e.target.checked)} />
        </SettingRow>
        <SettingRow><div style={hint}>{__t('showInLayerListHint')}</div></SettingRow>
        <SettingRow flow='wrap' label={__t('tipStyle')}>
          <Select size='sm' value={config.tipStyle || 'bulb'} onChange={(e: any) => set('tipStyle', e.target.value)} aria-label={__t('tipStyle')}>
            <Option value='bulb'>{__t('tipBulb')}</Option>
            <Option value='pop'>{__t('tipPop')}</Option>
          </Select>
        </SettingRow>
        <SettingRow tag='label' label={__t('typewriter')}>
          <Switch checked={config.typewriter !== false} onChange={(e: any) => set('typewriter', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label={__t('allowReadAloud')}>
          <Switch checked={config.allowReadAloud !== false} onChange={(e: any) => set('allowReadAloud', e.target.checked)} />
        </SettingRow>
        <SettingRow tag='label' label='Fix typos ("trun on parcles")'>
          <Switch checked={config.typoFix !== false} onChange={(e: any) => set('typoFix', e.target.checked)} />
        </SettingRow>
        <SettingRow><div style={hint}>Turn off when most people use the app in a language other than English.</div></SettingRow>
        <SettingRow tag='label' label={__t('featureSearch')}>
          <Switch checked={config.featureSearch !== false} onChange={(e: any) => set('featureSearch', e.target.checked)} />
        </SettingRow>
        <SettingRow label={__t('maxResults')}>
          <NumericInput size='sm' style={{ width: 90 }} min={1} max={25} value={config.maxResults || 8} onChange={(v: number) => set('maxResults', Number(v) || 8)} />
        </SettingRow>
        <SettingRow flow='wrap' label={__t('chips')}>
          <TextInput
            size='sm'
            defaultValue={(plain<string[]>(config.suggestions) || []).join(', ')}
            onAcceptValue={(v: string) => set('suggestions', Immutable(String(v || '').split(',').map(s => s.trim()).filter(Boolean)))}
            aria-label={__t('chips')}
          />
        </SettingRow>
        <SettingRow><div style={hint}>{__t('chipsHint')}</div></SettingRow>
        <SettingRow tag='label' label={__t('telemetry')}>
          <Switch checked={config.telemetry === true} onChange={(e: any) => set('telemetry', e.target.checked)} />
        </SettingRow>
        <SettingRow><div style={hint}>{__t('telemetryHint')}</div></SettingRow>
      </SettingSection>
      </details>
    </div>
  )
}
