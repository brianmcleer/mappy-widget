/*
  ui.tsx - small layout pieces shared by Mappy's settings panels, so every section lines up
  the same way in the narrow builder panel: muted hints, sub-headings, full-width buttons,
  two-button rows, status callouts and collapsible groups that look like section headers.
  Status lines are jimu Alerts and groups are jimu CollapsablePanels, so the panel looks like
  the builder's own settings in light and dark themes. No esri imports.
*/
import { React } from 'jimu-core'
import { SettingRow } from 'jimu-ui/advanced/setting-components'
import { Button, Alert, CollapsablePanel } from 'jimu-ui'

/** Scoped CSS for the whole settings panel. Rendered once by setting.tsx. */
export const SETTING_CSS = `
.widget-setting-mappy { padding-bottom: 24px; }
.widget-setting-mappy .ms-hint { font-size: 12px; line-height: 1.45; color: var(--sys-color-surface-paper-hint, var(--ref-palette-neutral-1000, #6a6a6a)); width: 100%; margin: 0; overflow-wrap: anywhere; }
.widget-setting-mappy .ms-sub { font-size: 13px; font-weight: 600; margin: 8px 0 0; width: 100%; }
.widget-setting-mappy .ms-full { width: 100%; }
.widget-setting-mappy .ms-full > .btn, .widget-setting-mappy .ms-full > button { width: 100%; justify-content: center; }
.widget-setting-mappy .ms-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
.widget-setting-mappy .ms-pair > .btn, .widget-setting-mappy .ms-pair > button { width: 100%; min-width: 0; white-space: normal; line-height: 1.2; }
.widget-setting-mappy .ms-alert { width: 100%; }
.widget-setting-mappy .ms-alert .alert-panel, .widget-setting-mappy .ms-alert > div { width: 100%; }
.widget-setting-mappy .ms-collapse { padding: 0 16px; border-bottom: 1px solid var(--sys-color-divider-secondary, #d9d9d9); }
.widget-setting-mappy .ms-collapse .jimu-widget-setting--section { padding-left: 0; padding-right: 0; border-bottom: 0; }
.widget-setting-mappy .ms-collapse .jimu-widget-setting--section + .jimu-widget-setting--section { border-top: 1px solid var(--sys-color-divider-secondary, #d9d9d9); }
.widget-setting-mappy .ms-stage { display: flex; justify-content: center; width: 100%; padding: 8px 0; }
.widget-setting-mappy .ms-checks { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.widget-setting-mappy .ms-check { display: flex; align-items: flex-start; gap: 8px; margin: 0; cursor: pointer; font-size: 13px; line-height: 1.35; }
.widget-setting-mappy .ms-check > :first-child { margin-top: 2px; flex: none; }
.widget-setting-mappy .ms-tools { list-style: none; padding: 0; margin: 0; width: 100%; max-height: 320px; overflow-y: auto; border: 1px solid var(--sys-color-divider-secondary, #d9d9d9); border-radius: 4px; }
.widget-setting-mappy .ms-tool { padding: 8px 10px; border-bottom: 1px solid var(--sys-color-divider-secondary, #e6e6e6); }
.widget-setting-mappy .ms-tool:last-child { border-bottom: 0; }
.widget-setting-mappy .ms-tool-head { display: flex; align-items: center; gap: 8px; }
.widget-setting-mappy .ms-tool-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin: 0; cursor: pointer; }
.widget-setting-mappy .ms-tool-desc { font-size: 11px; line-height: 1.4; margin: 2px 0 0 24px; color: var(--sys-color-surface-paper-hint, #6a6a6a); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.widget-setting-mappy .ms-tool-ask { display: flex; align-items: center; gap: 4px; font-size: 11px; margin: 0; white-space: nowrap; cursor: pointer; flex: none; }
.widget-setting-mappy .ms-badge { display: inline-block; font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 8px; margin: 4px 0 0 24px; background: var(--sys-color-error-light, #fbe1de); color: var(--sys-color-error-dark, #a3170c); }
.widget-setting-mappy .ms-preview { width: 100%; font-size: 12px; line-height: 1.45; padding: 8px 10px; border-radius: 4px; background: var(--sys-color-surface-background, #f4f4f4); overflow-wrap: anywhere; }
.widget-setting-mappy .ms-inline { display: flex; gap: 6px; width: 100%; align-items: center; }
.widget-setting-mappy .ms-inline > :first-child { flex: 1; min-width: 0; }
.widget-setting-mappy .ms-card { width: 100%; border: 1px solid var(--sys-color-divider-secondary, #d9d9d9); border-radius: 4px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
`

/** A muted explanation under a setting. */
export function Hint (props: { children: any, live?: boolean }): any {
  return <SettingRow><p className='ms-hint' {...(props.live ? { role: 'status', 'aria-live': 'polite' } : {})}>{props.children}</p></SettingRow>
}

/** A bold sub-heading inside a section. */
export function Sub (props: { children: any }): any {
  return <SettingRow><div className='ms-sub' role='heading' aria-level={4}>{props.children}</div></SettingRow>
}

export type Tone = 'info' | 'ok' | 'bad' | 'warn'

/** A status line people should notice: connected, failed, updated. A jimu Alert. */
export function Note (props: { children: any, tone?: Tone }): any {
  if (!props.children) return null
  const type = props.tone === 'ok' ? 'success' : props.tone === 'bad' ? 'error' : props.tone === 'warn' ? 'warning' : 'info'
  const text = typeof props.children === 'string' ? props.children : undefined
  return (
    <SettingRow>
      <div className='ms-alert' role='status' aria-live='polite'>
        <Alert form='basic' type={type} withIcon fullWidth open closable={false} text={text}>{text ? undefined : props.children}</Alert>
      </div>
    </SettingRow>
  )
}

/** One full-width button. */
export function FullButton (props: { children: any, onClick: () => any, type?: string, disabled?: boolean, size?: string, title?: string }): any {
  return <SettingRow><div className='ms-full'><Button type={(props.type || 'primary') as any} size={props.size as any} disabled={props.disabled} onClick={props.onClick} title={props.title}>{props.children}</Button></div></SettingRow>
}

/** Two buttons side by side, equal width; one alone takes the whole row. */
export function ButtonPair (props: { children: any }): any {
  const kids = React.Children.toArray(props.children).filter(Boolean)
  if (!kids.length) return null
  return <SettingRow><div className={kids.length > 1 ? 'ms-pair' : 'ms-full'}>{kids}</div></SettingRow>
}

/** A collapsible group of sections: jimu's CollapsablePanel, closed until opened. */
export function Group (props: { title: string, children: any, open?: boolean }): any {
  return (
    <div className='ms-collapse'>
      <CollapsablePanel label={props.title} level={1} type='default' defaultIsOpen={!!props.open} wrapLabel aria-label={props.title}>
        {props.children}
      </CollapsablePanel>
    </div>
  )
}

/** A link styled the jimu way, opened in a new tab. */
export function LinkButton (props: { href: string, children: any }): any {
  return <SettingRow><Button type='link' size='sm' style={{ padding: 0, height: 'auto', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => { try { if (/^claude:/i.test(props.href)) window.location.href = props.href; else window.open(props.href, '_blank', 'noopener,noreferrer') } catch (e) { } }}>{props.children}</Button></SettingRow>
}

/** Whether a status message reads as a failure, for its color. */
export function toneOf (msg: string): Tone {
  if (/could not|failed|error|refused|must|needs a sign-in|answered [45]\d\d|not reach|took too long/i.test(msg)) return 'bad'
  if (/^(?:connected|updated|ready|done|saved|already have)/i.test(msg)) return 'ok'
  return 'info'
}
