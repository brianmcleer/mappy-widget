/*
  ContactSection.tsx - "A person to ask" in settings: the real person or team behind the app.
  When someone says "talk to a person", or Mappy is stuck twice in a row, he offers these ways
  to reach them. The email button writes the question in; nothing is sent until the person
  sends it from their own mail program.
*/
import { React } from 'jimu-core'
import { SettingSection, SettingRow } from 'jimu-ui/advanced/setting-components'
import { TextInput } from 'jimu-ui'
import { Hint, Note } from './ui'
import { cleanContact } from '../brain/care'

interface Props {
  contact: any
  set: (key: string, value: any) => void
}

export default function ContactSection (props: Props): any {
  const c = props.contact || {}
  const full: any = { width: '100%' }
  const put = (key: string, value: string): void => {
    const next = { ...c, [key]: value }
    const empty = !['name', 'email', 'phone', 'url', 'hours'].some(k => String(next[k] || '').trim())
    props.set('contact', empty ? undefined : next)
  }
  const typed = ['email', 'phone', 'url'].some(k => String(c[k] || '').trim())
  const ok = cleanContact(c)
  const bad: string[] = []
  if (String(c.email || '').trim() && !ok?.email) bad.push('the email address')
  if (String(c.phone || '').trim() && !ok?.phone) bad.push('the phone number')
  if (String(c.url || '').trim() && !ok?.url) bad.push('the help page (it must start with https://)')
  return (
    <SettingSection title='A person to ask'>
      <Hint>Who people can turn to when Mappy cannot help. He offers this when someone says "talk to a person" or "report a problem", and after two questions in a row he could not answer.</Hint>
      <SettingRow flow='wrap' label='Who'>
        <TextInput size='sm' style={full} value={c.name || ''} placeholder='the GIS team' aria-label='Who' onChange={(e: any) => put('name', e.target.value)} />
      </SettingRow>
      <SettingRow flow='wrap' label='Email'>
        <TextInput size='sm' style={full} value={c.email || ''} placeholder='gis@example.org' aria-label='Email' onChange={(e: any) => put('email', e.target.value)} />
      </SettingRow>
      <SettingRow flow='wrap' label='Phone'>
        <TextInput size='sm' style={full} value={c.phone || ''} placeholder='555-555-0100' aria-label='Phone' onChange={(e: any) => put('phone', e.target.value)} />
      </SettingRow>
      <SettingRow flow='wrap' label='Help page'>
        <TextInput size='sm' style={full} value={c.url || ''} placeholder='https://' aria-label='Help page' onChange={(e: any) => put('url', e.target.value)} />
      </SettingRow>
      <SettingRow flow='wrap' label='When they answer'>
        <TextInput size='sm' style={full} value={c.hours || ''} placeholder='weekdays, 8 to 5' aria-label='When they answer' onChange={(e: any) => put('hours', e.target.value)} />
      </SettingRow>
      {bad.length > 0 && <Note tone='warn'>Check {bad.join(' and ')}. He leaves out anything he cannot use.</Note>}
      {ok && bad.length === 0 && <Note tone='ok'>He will offer {[ok.email && 'email', ok.phone && 'phone', ok.url && 'the help page'].filter(Boolean).join(', ')} for {ok.name}.</Note>}
      {!typed && <Hint>Empty: he says plainly that he is not a person and points to your website, when one is set under Your place.</Hint>}
      <Hint>One way to reach someone is enough. The email button opens the person's own mail program with their question, his answer and where the map was already written. "What did you miss" in the chat lists questions he could not answer in that browser, with a button to email them here.</Hint>
    </SettingSection>
  )
}
