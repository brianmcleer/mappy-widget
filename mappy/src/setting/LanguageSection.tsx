/*
  LanguageSection.tsx - "Language" in settings: which language pack Mappy reads with, a
  button to pull the newest one the project's GitHub Action built, and a way to report a
  phrase he missed so the next build learns it. Only the builder ever touches the network;
  the pack is stored with the app, so end users download nothing.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Button, TextInput, Label } from 'jimu-ui'
import BUNDLED from '../brain/languagePack'
import { LANGUAGE_REPO, LANGUAGE_URL, applyLanguagePack, bundledVersion, cleanPack, compareVersions, languagePack } from '../brain/language'

interface Props {
  stored: any
  onChange: (pack: any) => void
}

export default function LanguageSection (props: Props): any {
  const [status, setStatus] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [typed, setTyped] = React.useState('')
  const [meant, setMeant] = React.useState('')
  const stored = props.stored && typeof props.stored.asMutable === 'function' ? props.stored.asMutable({ deep: true }) : props.stored
  React.useEffect(() => { if (stored) applyLanguagePack(stored) }, [stored?.version])
  const using = (stored?.version && compareVersions(stored.version, bundledVersion()) > 0) ? stored : null
  const p = languagePack()
  const hint: any = { fontSize: 12, opacity: 0.8, lineHeight: 1.4 }

  const update = async () => {
    setBusy(true); setStatus('Checking for a newer language pack...')
    try {
      const r = await fetch(LANGUAGE_URL, { cache: 'no-store' })
      if (!r.ok) throw new Error(`the server answered ${r.status}`)
      const pack = cleanPack(await r.json())
      if (!pack) throw new Error('the download is not a language pack')
      const current = using?.version || bundledVersion()
      if (compareVersions(pack.version, current) <= 0) { setStatus(`You already have the newest language pack (${current}).`); return }
      applyLanguagePack(pack, true)
      props.onChange(pack)
      setStatus(`Updated to language pack ${pack.version}: ${pack.stats?.understood ?? '?'} of ${pack.stats?.phrases ?? '?'} test phrases understood. Saved with this app.`)
    } catch (e) {
      setStatus(`Could not get the language pack: ${e?.message || e}. Mappy keeps the one he has.`)
    } finally { setBusy(false) }
  }

  const useBundled = () => {
    applyLanguagePack(BUNDLED, true)
    props.onChange(null)
    setStatus(`Back to the built-in language pack (${bundledVersion()}).`)
  }

  const reportUrl = `https://github.com/${LANGUAGE_REPO}/issues/new?template=mappy-missed.yml&labels=language` +
    `&title=${encodeURIComponent('Mappy missed: ' + typed.slice(0, 60))}&typed=${encodeURIComponent(typed)}&meant=${encodeURIComponent(meant)}`

  return (
    <SettingSection title='Language'>
      <SettingRow>
        <div style={hint} role='status' aria-live='polite'>
          {`Reading with language pack ${p.version}${using ? ' (downloaded)' : ' (built in)'}: ${p.known?.n || (p.words ? p.words.split(' ').filter(Boolean).length : 0)} known English words, ${p.synonyms.length} synonym groups, ${p.rewrites.length} phrasings, ${Object.keys(p.fixes).length} known misspellings${p.stats?.typoRobustness ? `; reads through ${p.stats.typoRobustness}% of test typos` : ''}. Mappy forgives typos either way.`}
        </div>
      </SettingRow>
      <SettingRow>
        <div style={hint}>A GitHub Action improves the language pack every week from open word data and from phrases people report. Pull the newest one here; it is stored with this app, so people using the app download nothing.</div>
      </SettingRow>
      <SettingRow>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
          <Button type='primary' disabled={busy} onClick={update}>Get language updates</Button>
          {using && <Button type='tertiary' disabled={busy} onClick={useBundled}>Use built-in pack</Button>}
        </div>
      </SettingRow>
      {status && <SettingRow><div style={hint} role='status' aria-live='polite'>{status}</div></SettingRow>}
      <SettingRow><Label style={{ fontWeight: 600, marginTop: 8 }}>Teach Mappy a phrase</Label></SettingRow>
      <SettingRow><div style={hint}>Did he miss something? Type what was asked and what it should mean (a request he already understands). This opens a short report on GitHub; the next weekly build tests it and learns it.</div></SettingRow>
      <SettingRow label='What was typed'>
        <TextInput size='sm' style={{ width: '100%' }} value={typed} placeholder='make parcels visable' onChange={(e: any) => setTyped(e.target.value)} />
      </SettingRow>
      <SettingRow label='What it means'>
        <TextInput size='sm' style={{ width: '100%' }} value={meant} placeholder='turn on parcels' onChange={(e: any) => setMeant(e.target.value)} />
      </SettingRow>
      <SettingRow>
        <Button size='sm' disabled={!typed.trim() || !meant.trim()} onClick={() => window.open(reportUrl, '_blank', 'noopener')}>Report on GitHub</Button>
      </SettingRow>
    </SettingSection>
  )
}
