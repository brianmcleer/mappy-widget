/*
  FeedSection.tsx - "Knowledge feed" in settings: where Mappy fetches newer words, answers,
  terms, facts and tips from, once a day, so he improves without an app update. Check now
  reads the feed and says what is in it. Nothing from the feed is saved with the app; each
  browser keeps its own day-old copy.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { Switch, TextInput } from 'jimu-ui'
import { Hint, Note, FullButton } from './ui'
import { DEFAULT_FEED_URL, describeFeed } from '../brain/feed'
import { loadFeed, forgetFeed } from '../runtime/feed'

interface Props {
  enabled: boolean
  url: string
  set: (key: string, value: any) => void
}

export default function FeedSection (props: Props): any {
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [tone, setTone] = React.useState<'ok' | 'warn' | 'bad' | undefined>(undefined)
  const url = (props.url || '').trim() || DEFAULT_FEED_URL

  const check = async () => {
    setBusy(true); setTone(undefined); setStatus(`Reading ${url}...`)
    try {
      forgetFeed(url)
      const r = await loadFeed(url, { force: true })
      if (!r.feed) { setStatus(r.error || 'Nothing came back.'); setTone('bad'); return }
      setStatus(`OK: ${describeFeed(r.feed)}${r.feed.about ? '. ' + r.feed.about : ''}${r.error ? ' (' + r.error + ')' : ''}`)
      setTone(r.error ? 'warn' : 'ok')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The feed could not be read.'); setTone('bad')
    } finally { setBusy(false) }
  }

  return (
    <SettingSection title='Knowledge feed'>
      <Hint>Once a day each browser fetches one JSON file with newer words and phrasings, answers, glossary terms, facts and tips, so he keeps improving without an app update. The project's feed is rebuilt weekly on GitHub. Point at your own copy for apps that cannot reach GitHub, or turn it off.</Hint>
      <SettingRow tag='label' label='Use the knowledge feed'>
        <Switch checked={props.enabled} onChange={(e: any) => props.set('feed', e.target.checked)} />
      </SettingRow>
      <SettingRow flow='wrap' label='Feed address (https)'>
        <TextInput size='sm' style={{ width: '100%' }} defaultValue={props.url || ''} placeholder={DEFAULT_FEED_URL} onAcceptValue={(v: string) => props.set('feedUrl', String(v || '').trim())} aria-label='Feed address' disabled={!props.enabled} />
      </SettingRow>
      <FullButton onClick={check} disabled={busy || !props.enabled}>{busy ? 'Checking...' : 'Check now'}</FullButton>
      {status && <Note tone={tone}>{status}</Note>}
      <Hint>Only https, only JSON under 2 MB, and only a file in the feed format (format 1 with a version) is used; anything else is ignored and the bundled knowledge stays. Your own questions and answers always outrank the feed's. The feed format is described in the repo's knowledge/README.md.</Hint>
    </SettingSection>
  )
}
