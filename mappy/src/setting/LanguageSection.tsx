/*
  LanguageSection.tsx - "Language" in settings: which language pack Mappy reads with, a
  button to pull the newest one the project's GitHub Action built, and a way to report a
  phrase he missed so the next build learns it. Only the builder ever touches the network;
  the pack is stored with the app, so end users download nothing.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Button, TextInput } from 'jimu-ui'
import { Hint, Note, Sub, FullButton, ButtonPair, toneOf } from './ui'
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

  const full: any = { width: '100%' }
  return (
    <SettingSection title='Language'>
      <Hint live>
        {`Reading with language pack ${p.version}${using ? ' (downloaded)' : ' (built in)'}: ${(p.known?.n || (p.words ? p.words.split(' ').filter(Boolean).length : 0)).toLocaleString()} English words, ${p.synonyms.length} synonym groups, ${p.rewrites.length} phrasings, ${Object.keys(p.fixes).length} known misspellings${p.stats?.typoRobustness ? `. Reads through ${p.stats.typoRobustness}% of test typos` : ''}.`}
      </Hint>
      <Hint>A GitHub Action improves the pack every week. Get the newest one here; it is saved with this app, so people using the app download nothing.</Hint>
      <ButtonPair>
        <Button type='primary' disabled={busy} onClick={update}>{busy ? 'Checking...' : 'Get language updates'}</Button>
        {using && <Button type='secondary' disabled={busy} onClick={useBundled}>Use built-in pack</Button>}
      </ButtonPair>
      <Note tone={busy ? 'info' : toneOf(status)}>{status}</Note>

      <Sub>Teach Mappy a phrase</Sub>
      <Hint>Did he miss something? Type what was asked and a request he already understands. This opens a short GitHub report; the next weekly build tests it and learns it.</Hint>
      <SettingRow label='What was typed' flow='wrap'>
        <TextInput size='sm' style={full} value={typed} placeholder='make parcels visable' aria-label='What was typed' onChange={(e: any) => setTyped(e.target.value)} />
      </SettingRow>
      <SettingRow label='What it means' flow='wrap'>
        <TextInput size='sm' style={full} value={meant} placeholder='turn on parcels' aria-label='What it means' onChange={(e: any) => setMeant(e.target.value)} />
      </SettingRow>
      <FullButton type='secondary' disabled={!typed.trim() || !meant.trim()} onClick={() => window.open(reportUrl, '_blank', 'noopener')}>Report on GitHub</FullButton>
    </SettingSection>
  )
}
