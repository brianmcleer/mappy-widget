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
import PlaceSection from './PlaceSection'
import PreviewSection from './PreviewSection'
import McpSection from './McpSection'
import { SETTING_CSS, Hint, Note, Sub, FullButton, ButtonPair, Group, toneOf } from './ui'
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

  return (
    <div className='widget-setting-mappy'>
      <style>{SETTING_CSS}</style>
      <SettingSection title={__t('map')}>
        <SettingRow>
          <MapWidgetSelector onSelect={(ids: string[]) => props.onSettingChange({ id: props.id, useMapWidgetIds: ids })} useMapWidgetIds={props.useMapWidgetIds} />
        </SettingRow>
        <Hint>{__t('mapHint')}</Hint>
      </SettingSection>

      <SettingSection title={__t('brain')}>
        <Note tone={brain ? 'ok' : 'warn'}>
          {brain ? __t('brainBuilt', { when, layers: (stats.layer || 0) + (stats.table || 0), docs: brain.docs.length + (stats._app || 0), kb }) : __t('brainEmpty')}
        </Note>
        <Hint>Setup runs automatically the first time. After changing your app, refresh everything with one button.</Hint>
        <ButtonPair>
          <Button type='primary' disabled={scanning || !appConfig} onClick={runScan}>{scanning ? 'Learning your app...' : 'Refresh app knowledge'}</Button>
          {scanning && <Button type='secondary' onClick={() => { cancelRef.current = true }}>Stop</Button>}
        </ButtonPair>
        <Note tone={scanning ? 'info' : toneOf(progress)}>{progress}</Note>
      </SettingSection>

      <Group title='Advanced knowledge options'>
      <SettingSection>
        <Sub>Sources to read</Sub>
        <SettingRow>
          <div className='ms-checks'>
            {(['webMaps', 'services', 'items', 'manifests', 'esriDocs', 'guides'] as const).map(k => (
              <Label key={k} className='ms-check'>
                <Checkbox checked={opts[k]} onChange={(e: any) => setOpts({ ...opts, [k]: e.target.checked })} />
                {__t('scan' + k.charAt(0).toUpperCase() + k.slice(1))}
              </Label>
            ))}
          </div>
        </SettingRow>
        <SettingRow label={__t('maxLayers')}>
          <NumericInput size='sm' style={{ width: 90 }} min={10} max={2000} value={opts.maxLayers} onChange={(v: number) => setOpts({ ...opts, maxLayers: Number(v) || 400 })} />
        </SettingRow>

        <Sub>{__t('folderTitle')}</Sub>
        <Hint>{__t('folderHint')}</Hint>
        <SettingRow tag='label' label={__t('folderOnlyUsed')}>
          <Switch checked={onlyUsed} onChange={(e: any) => setOnlyUsed(e.target.checked)} />
        </SettingRow>
        <FullButton type='secondary' disabled={scanning} onClick={runFolder}>{__t('scanFolder')}</FullButton>

        <Sub>{__t('helpFilesTitle')}</Sub>
        <Hint>{__t('helpFilesHint')}</Hint>
        <FullButton type='secondary' disabled={scanning || !folderPickerSupported()} onClick={runHelpFolder}>{__t('scanHelpFiles')}</FullButton>

        <Sub>{__t('docsTitle')}</Sub>
        <Hint>{__t('docsHint', { read: ESRI_DOCS_READ })}</Hint>
        <ButtonPair>
          <Button type='secondary' disabled={scanning || !appConfig} onClick={runDocs}>{__t('pullDocs')}</Button>
          {brain && <Button type='tertiary' disabled={scanning} onClick={() => { set('brain', null); setLog([]); setProgress('') }}>{__t('clearBrain')}</Button>}
        </ButtonPair>
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
      </SettingSection>
      </Group>

      <SettingSection title={__t('tryIt')}>
        <Hint>{__t('tryHint')}</Hint>
        <SettingRow>
          <div className='ms-inline'>
            <TextInput size='sm' value={q} placeholder={__t('tryPlaceholder')} onChange={(e: any) => setQ(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter') runTry() }} aria-label={__t('tryIt')} />
            <Button size='sm' onClick={runTry}>{__t('tryIt')}</Button>
          </div>
        </SettingRow>
        {preview && (
          <SettingRow>
            <div className='ms-preview' role='status' aria-live='polite'>
              {preview.readAs && <div style={{ opacity: 0.8, marginBottom: 4 }}>{`Read as “${preview.readAs}”`}</div>}
              <div>{String(preview.text).replace(/\*\*/g, '')}</div>
              {preview.actions?.length > 0 && <div style={{ marginTop: 4, opacity: 0.8 }}>{'→ '}{preview.actions.map((a: any) => a.label).join(' · ')}</div>}
              {preview.list?.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{preview.list.map((it: any, i: number) => <li key={i}>{it.label}</li>)}</ul>}
            </div>
          </SettingRow>
        )}
      </SettingSection>

      <PlaceSection orgName={config.orgName || ''} placeName={config.placeName || ''} placeRegion={config.placeRegion || ''} website={config.website || ''} localFacts={config.localFacts || ''} set={set} />

      <PreviewSection />

      <LanguageSection stored={config.languagePack} onChange={(pack: any) => set('languagePack', pack)} />

      <McpSection value={config.mcp} onChange={(v: any) => set('mcp', v)} />

      <Group title='Custom answers and notes'>
      <SettingSection>
        <Hint>{__t('knowledgeHint')}</Hint>
        {faq.map((f, i) => (
          <SettingRow key={i}>
            <div className='ms-card'>
              <TextInput size='sm' value={f.q} placeholder={__t('question')} aria-label={__t('question')} onChange={(e: any) => updateFaq(i, { q: e.target.value })} />
              <TextArea height={60} value={f.a} placeholder={__t('answer')} aria-label={__t('answer')} onChange={(e: any) => updateFaq(i, { a: e.target.value })} />
              <TextInput size='sm' value={f.url || ''} placeholder={__t('link')} aria-label={__t('link')} onChange={(e: any) => updateFaq(i, { url: e.target.value })} />
              <Button size='sm' type='tertiary' onClick={() => setFaq(faq.filter((x, j) => j !== i))}>{__t('remove')}</Button>
            </div>
          </SettingRow>
        ))}
        <FullButton type='secondary' size='sm' onClick={() => setFaq([...faq, { q: '', a: '' }])}>{__t('addFaq')}</FullButton>
        <SettingRow flow='wrap' label={__t('notes')}>
          <TextArea height={110} style={row} value={config.notes || ''} aria-label={__t('notes')} onChange={(e: any) => set('notes', e.target.value)} />
        </SettingRow>
        <Hint>{__t('notesHint')}</Hint>
      </SettingSection>
      </Group>

      <Group title='Appearance and behavior'>
      <SettingSection title={__t('character')}>
        <SettingRow flow='wrap' label={__t('name')}>
          <TextInput size='sm' style={row} value={config.assistantName || ''} placeholder='Mappy' onChange={(e: any) => set('assistantName', e.target.value)} aria-label={__t('name')} />
        </SettingRow>
        <SettingRow flow='wrap' label={__t('greeting')}>
          <TextArea height={60} style={row} value={config.greeting || ''} onChange={(e: any) => set('greeting', e.target.value)} aria-label={__t('greeting')} />
        </SettingRow>
        <Hint>{__t('greetingHint')}</Hint>
        <SettingRow flow='wrap' label={__t('display')}>
          <Select size='sm' style={row} value={config.displayMode || 'floating'} onChange={(e: any) => set('displayMode', e.target.value)} aria-label={__t('display')}>
            <Option value='floating'>{__t('floating')}</Option>
            <Option value='inline'>{__t('inline')}</Option>
          </Select>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('corner')}>
          <Select size='sm' style={row} value={config.corner || 'bottom-right'} onChange={(e: any) => set('corner', e.target.value)} aria-label={__t('corner')}>
            <Option value='bottom-right'>{__t('bottomRight')}</Option>
            <Option value='bottom-left'>{__t('bottomLeft')}</Option>
          </Select>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('size')}>
          <Select size='sm' style={row} value={config.size || 'medium'} onChange={(e: any) => set('size', e.target.value)} aria-label={__t('size')}>
            <Option value='small'>{__t('small')}</Option>
            <Option value='medium'>{__t('medium')}</Option>
            <Option value='large'>{__t('large')}</Option>
          </Select>
        </SettingRow>
        <SettingRow flow='wrap' label={__t('bubble')}>
          <Select size='sm' style={row} value={config.bubbleStyle || 'classic'} onChange={(e: any) => set('bubbleStyle', e.target.value)} aria-label={__t('bubble')}>
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
        <Hint>{__t('showInLayerListHint')}</Hint>
        <SettingRow flow='wrap' label={__t('tipStyle')}>
          <Select size='sm' style={row} value={config.tipStyle || 'bulb'} onChange={(e: any) => set('tipStyle', e.target.value)} aria-label={__t('tipStyle')}>
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
        <Hint>Turn off when most people use the app in a language other than English.</Hint>
        <SettingRow tag='label' label='Jokes, games and holiday hats'>
          <Switch checked={config.fun !== false} onChange={(e: any) => set('fun', e.target.checked)} />
        </SettingRow>
        <Hint>Map jokes, riddles, little games and an outfit for the time of year (nothing religious or political). Turn off for a strictly formal app; he still waves and blinks.</Hint>
        <SettingRow tag='label' label='Sound effects'>
          <Switch checked={config.sounds === true} onChange={(e: any) => set('sounds', e.target.checked)} />
        </SettingRow>
        <Hint>Tiny synthesized sounds, the way the old Office Assistant had them: a pop when he arrives, a knock for a tip, a ta-da for good news, a wobble for an alert. Quiet, no files, and silent under reduced motion or "Pause animation".</Hint>
        <SettingRow tag='label' label={__t('featureSearch')}>
          <Switch checked={config.featureSearch !== false} onChange={(e: any) => set('featureSearch', e.target.checked)} />
        </SettingRow>
        <SettingRow label={__t('maxResults')}>
          <NumericInput size='sm' style={{ width: 90 }} min={1} max={25} value={config.maxResults || 8} onChange={(v: number) => set('maxResults', Number(v) || 8)} />
        </SettingRow>
        <SettingRow flow='wrap' label={__t('chips')}>
          <TextInput
            size='sm'
            style={row}
            defaultValue={(plain<string[]>(config.suggestions) || []).join(', ')}
            onAcceptValue={(v: string) => set('suggestions', Immutable(String(v || '').split(',').map(s => s.trim()).filter(Boolean)))}
            aria-label={__t('chips')}
          />
        </SettingRow>
        <Hint>{__t('chipsHint')}</Hint>
        <SettingRow tag='label' label={__t('telemetry')}>
          <Switch checked={config.telemetry === true} onChange={(e: any) => set('telemetry', e.target.checked)} />
        </SettingRow>
        <Hint>{__t('telemetryHint')}</Hint>
      </SettingSection>
      </Group>
    </div>
  )
}
