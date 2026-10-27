/*
  MappyMenu.tsx - the right-click menu, like the old desktop assistants had: Animate!,
  a tip, move him, pause animation, read aloud, tips on or off, hide.
  ARIA menu pattern: arrow keys, Home, End, Esc; focus goes to the first item and returns
  to whatever opened it. Opens with right-click, Shift+F10, the context-menu key, or the
  bubble's options button. Clamped inside the tab.
*/
import { React } from 'jimu-core'

export interface MenuItem {
  id: string
  label: string
  /** For on/off items. */
  checked?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface Props {
  x: number
  y: number
  label: string
  items: MenuItem[]
  onClose: (returnFocus: boolean) => void
}

export default function MappyMenu (props: Props): any {
  const ref = React.useRef<any>(null)
  const [pos, setPos] = React.useState<{ left: number, top: number }>({ left: props.x, top: props.y })

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const ownerWindow = el.ownerDocument.defaultView || window
    const vw = ownerWindow.innerWidth
    const vh = ownerWindow.innerHeight
    setPos({ left: Math.max(8, Math.min(props.x, vw - r.width - 8)), top: Math.max(8, Math.min(props.y, vh - r.height - 8)) })
    const first = el.querySelector('[role^="menuitem"]') as HTMLElement | null
    first?.focus()
  }, [props.x, props.y])

  React.useEffect(() => {
    const ownerWindow = ref.current?.ownerDocument.defaultView || window
    const onDown = (e: any) => { if (ref.current && !ref.current.contains(e.target)) props.onClose(false) }
    const onScroll = () => props.onClose(false)
    ownerWindow.addEventListener('pointerdown', onDown, true)
    ownerWindow.addEventListener('resize', onScroll)
    return () => { ownerWindow.removeEventListener('pointerdown', onDown, true); ownerWindow.removeEventListener('resize', onScroll) }
  }, [])

  const onKey = (e: any) => {
    const items = Array.from(ref.current?.querySelectorAll('[role^="menuitem"]') || []) as HTMLElement[]
    const i = items.indexOf(ref.current?.ownerDocument.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() } else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() } else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() } else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); props.onClose(true) }
  }

  return (
    <ul ref={ref} className='mappy-menu' role='menu' aria-label={props.label} style={{ left: pos.left, top: pos.top }} onKeyDown={onKey}>
      {props.items.map(it => (
        <React.Fragment key={it.id}>
          {it.separatorBefore && <li role='separator' />}
          <li role='none'>
            <button
              type='button'
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked === undefined ? undefined : it.checked}
              tabIndex={-1}
              onClick={() => { it.onSelect(); props.onClose(true) }}
            >
              <span aria-hidden='true' style={{ width: '1em', display: 'inline-block' }}>{it.checked ? '✓' : ''}</span>
              {it.label}
            </button>
          </li>
        </React.Fragment>
      ))}
    </ul>
  )
}
