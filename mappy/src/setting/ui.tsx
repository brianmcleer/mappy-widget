/*
  ui.tsx - small layout pieces shared by Mappy's settings panels, so every section lines up
  the same way in the narrow builder panel: muted hints, sub-headings, full-width buttons,
  two-button rows, status callouts and collapsible groups that look like section headers.
  Styling only; no esri imports.
*/
import { React } from 'jimu-core'
import { SettingRow } from 'jimu-ui/advanced/setting-components'
import { Button } from 'jimu-ui'

/** Scoped CSS for the whole settings panel. Rendered once by setting.tsx. */
export const SETTING_CSS = `
.widget-setting-mappy { padding-bottom: 24px; }
.widget-setting-mappy .ms-hint { font-size: 12px; line-height: 1.45; color: var(--sys-color-surface-paper-hint, var(--ref-palette-neutral-1000, #6a6a6a)); width: 100%; margin: 0; overflow-wrap: anywhere; }
.widget-setting-mappy .ms-sub { font-size: 13px; font-weight: 600; margin: 8px 0 0; width: 100%; }
.widget-setting-mappy .ms-full { width: 100%; }
.widget-setting-mappy .ms-full > .btn, .widget-setting-mappy .ms-full > button { width: 100%; justify-content: center; }
.widget-setting-mappy .ms-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
.widget-setting-mappy .ms-pair > .btn, .widget-setting-mappy .ms-pair > button { width: 100%; min-width: 0; white-space: normal; line-height: 1.2; }
.widget-setting-mappy .ms-note { width: 100%; font-size: 12px; line-height: 1.45; padding: 8px 10px; border-radius: 4px; border-left: 3px solid var(--sys-color-info-main, #007ac2); background: var(--sys-color-surface-background, #f4f4f4); overflow-wrap: anywhere; }
.widget-setting-mappy .ms-note.ok { border-left-color: var(--sys-color-success-main, #35ac46); }
.widget-setting-mappy .ms-note.bad { border-left-color: var(--sys-color-error-main, #d83020); }
.widget-setting-mappy .ms-note.warn { border-left-color: var(--sys-color-warning-main, #edd317); }
.widget-setting-mappy .ms-group { border-bottom: 1px solid var(--sys-color-divider-secondary, #d9d9d9); }
.widget-setting-mappy .ms-group > summary { list-style: none; display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; font-size: 14px; font-weight: 600; user-select: none; }
.widget-setting-mappy .ms-group > summary::-webkit-details-marker { display: none; }
.widget-setting-mappy .ms-group > summary::after { content: ''; width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); margin: -4px 4px 0 8px; transition: transform .15s; flex: none; }
.widget-setting-mappy .ms-group[open] > summary::after { transform: rotate(-135deg); margin-top: 4px; }
.widget-setting-mappy .ms-group > summary:focus-visible { outline: 2px solid var(--sys-color-primary-main, #007ac2); outline-offset: -2px; }
.widget-setting-mappy .ms-group-body { padding-bottom: 8px; }
.widget-setting-mappy .ms-group-body .jimu-widget-setting--section { border-bottom: 0; padding-top: 0; }
.widget-setting-mappy .ms-group-body > .jimu-widget-setting--section + .jimu-widget-setting--section { border-top: 1px solid var(--sys-color-divider-secondary, #d9d9d9); padding-top: 16px; }
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

/** A status line people should notice: connected, failed, updated. */
export function Note (props: { children: any, tone?: Tone }): any {
  if (!props.children) return null
  return <SettingRow><div className={`ms-note ${props.tone && props.tone !== 'info' ? props.tone : ''}`} role='status' aria-live='polite'>{props.children}</div></SettingRow>
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

/** A collapsible group whose header looks like a section title. */
export function Group (props: { title: string, children: any, open?: boolean }): any {
  return (
    <details className='ms-group' open={props.open}>
      <summary>{props.title}</summary>
      <div className='ms-group-body'>{props.children}</div>
    </details>
  )
}

/** Whether a status message reads as a failure, for its color. */
export function toneOf (msg: string): Tone {
  if (/could not|failed|error|refused|must|needs a sign-in|answered [45]\d\d|not reach|took too long/i.test(msg)) return 'bad'
  if (/^connected|updated|ready|done|saved|already have/i.test(msg)) return 'ok'
  return 'info'
}
