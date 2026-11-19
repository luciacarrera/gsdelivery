import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quaternion } from 'three'
import AxisGizmo, { type AxisGizmoHandle } from './AxisGizmo'
import Bibliography, { linkClass, SourceList } from './Bibliography'
import BottomSheet from './BottomSheet'
import CardboardScene from './CardboardScene'
import { CAPTION_NOTE, CAPTIONS, CAPTIONS_SHORT } from './print/sankeyPrint'
import SiteHeader, { AUTHORS } from './SiteHeader'

const YEAR = new Date().getFullYear()
const BASE_TITLE = 'Corrugated Metabolism'
// Hide the hint once the user starts interacting: pointerdown = drag/pan or touch pinch, wheel = zoom
const DISMISS_EVENTS = ['pointerdown', 'wheel'] as const
// Presses on the page's own controls and sheets aren't an interaction with the diagram
const UI_SELECTOR = 'button, a, dialog'

const roundButton =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream-light text-bark shadow-sm ring-1 ring-bark/15 transition duration-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bark active:scale-95'

type Sheet = 'about' | 'sources' | null

// Hash routing (#bibliography) so refreshes work on GitHub Pages without a 404 fallback.
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

/** Small box outline with one side shaded, marking which face a caption describes. */
function SideIcon({ side }: { side: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 12" className="mt-0.5 h-3 w-4 shrink-0 text-bark-muted" aria-hidden>
      <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x={side === 'left' ? 0.75 : 8} y="0.75" width="7.25" height="10.5" rx="1.5" fill="currentColor" />
    </svg>
  )
}

function App() {
  const showBibliography = useHash() === '#bibliography'
  const [showHint, setShowHint] = useState(true)
  const [flat, setFlat] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [sheet, setSheet] = useState<Sheet>(null)
  const closeSheet = useCallback(() => setSheet(null), [])
  const gizmo = useRef<AxisGizmoHandle>(null)
  const updateGizmo = useCallback((q: Quaternion) => gizmo.current?.update(q), [])
  // The 2D view centres the net between the title block and the captions
  const header = useRef<HTMLElement>(null)
  const captions = useRef<HTMLDivElement>(null)
  const textBand = useCallback(() => {
    if (!header.current || !captions.current) return null
    return { top: header.current.getBoundingClientRect().bottom, bottom: captions.current.getBoundingClientRect().top }
  }, [])

  // Only listen for the first interaction with the diagram while it is on screen, so reading the
  // bibliography or tapping a control first doesn't silently dismiss the hint.
  useEffect(() => {
    if (showBibliography || !showHint) return
    const dismiss = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(UI_SELECTOR)) return
      setShowHint(false)
    }
    DISMISS_EVENTS.forEach((e) => window.addEventListener(e, dismiss, { passive: true }))
    return () => DISMISS_EVENTS.forEach((e) => window.removeEventListener(e, dismiss))
  }, [showBibliography, showHint])

  useEffect(() => {
    document.title = showBibliography ? 'Corrugated Bibliography' : BASE_TITLE
    window.scrollTo(0, 0)
  }, [showBibliography])

  // The WebGL scene unmounts while the bibliography is open; returning resets the camera.
  if (showBibliography) return <Bibliography year={YEAR} />

  return (
    <div className="relative flex min-h-screen flex-col bg-cream font-sans text-bark">
      {/* On phones the author line moves into the About sheet; held sideways, the title goes too */}
      <SiteHeader
        ref={header}
        compact
        className="pointer-events-none absolute left-0 top-0 z-10 text-outline-cream short:hidden"
      />

      {/* View controls. Phones: a bar along the bottom (reset, about and sources on the left, the
          3D/2D switch on the right), only the right-hand group when held sideways. Desktop: top-right,
          axis gizmo then the switch; about and sources are in the footer instead. */}
      <div className="absolute inset-x-5 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 short:left-auto short:right-6 wide:inset-x-auto wide:top-8 wide:right-10 wide:bottom-auto">
        <div className="flex items-center gap-2">
          {/* Axis gizmo: follows the box as it turns; click to fly back to the starting angle and zoom.
              In 2D it shows only the net's x/y axes and recenters the flat view. */}
          <button
            type="button"
            onClick={() => setResetKey((k) => k + 1)}
            title={flat ? 'Recenter view' : 'Reset view'}
            aria-label={flat ? 'Recenter view' : 'Reset view'}
            className={`group ${roundButton}`}
          >
            <AxisGizmo ref={gizmo} flat={flat} />
          </button>
          <button
            type="button"
            onClick={() => setSheet('about')}
            title="About"
            aria-label="About"
            aria-haspopup="dialog"
            className={`${roundButton} wide:hidden`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setSheet('sources')}
            title="Bibliography"
            aria-label="Bibliography"
            aria-haspopup="dialog"
            className={`${roundButton} wide:hidden`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" />
            </svg>
          </button>
        </div>

        <div
          role="group"
          aria-label="View mode"
          className="relative flex h-11 shrink-0 rounded-full bg-cream-light p-1 text-sm font-medium shadow-sm ring-1 ring-bark/15"
        >
          {/* Sliding highlight behind the active option */}
          <span
            aria-hidden
            className={`absolute inset-y-1 left-1 w-12 rounded-full bg-cream-dark ring-1 ring-bark/15 transition-transform duration-300 ease-out ${
              flat ? 'translate-x-full' : 'translate-x-0'
            }`}
          />
          {(['3D', '2D'] as const).map((label) => {
            const active = (label === '2D') === flat
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                onClick={() => setFlat(label === '2D')}
                className={`relative h-9 w-12 rounded-full transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bark ${
                  active ? 'text-bark' : 'text-bark-muted hover:text-bark'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <main className="relative min-h-[60vh] flex-1 cursor-grab active:cursor-grabbing">
        <div className="absolute inset-0">
          <CardboardScene flat={flat} resetKey={resetKey} onCameraFrame={updateGizmo} textBand={textBand} />
        </div>
      </main>

      <div
        aria-hidden={!showHint}
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-xl font-medium leading-snug text-white text-shadow-lg text-shadow-bark/60 sm:text-2xl transition-opacity duration-700 ${
          showHint ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <p className="max-w-xs space-y-1 sm:max-w-sm">
          <span className="block">Drag to rotate</span>
          <span className="block wide:hidden">Pinch to zoom</span>
          <span className="block wide:hidden">Two-finger drag to pan</span>
          <span className="hidden wide:block">Scroll or pinch to zoom</span>
          <span className="hidden wide:block">Right-drag or two-finger drag to pan</span>
        </p>
      </div>

      {/* What the two halves of the Sankey printed on the box show. Phones: a short headline and
          units per side, just above the control bar (beside it when held sideways). Desktop: the
          full captions, one line each, bottom-left of the footer. */}
      <div
        ref={captions}
        className="pointer-events-none absolute inset-x-5 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 border-t border-bark/10 pt-3 text-left text-bark-muted text-outline-cream short:right-[19rem] short:bottom-[calc(1rem+env(safe-area-inset-bottom))] short:border-t-0 short:pt-0 wide:right-auto wide:left-10 wide:bottom-[calc(1rem+env(safe-area-inset-bottom))] wide:border-t-0 wide:pt-0"
      >
        <div className="space-y-2 short:flex short:gap-6 short:space-y-0 wide:hidden">
          {CAPTIONS_SHORT.map((c) => (
            <div key={c.side} className="flex gap-2">
              <SideIcon side={c.side} />
              <p className="text-xs leading-snug">
                <span className="block text-[13px] font-medium text-bark">{c.title}</span>
                {c.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="hidden space-y-0.5 text-xs leading-snug whitespace-nowrap wide:block">
          {CAPTIONS.map((c) => (
            <p key={c}>{c}</p>
          ))}
        </div>
      </div>

      {/* Desktop footer; on phones these live in the About and Bibliography sheets */}
      <footer className="pointer-events-none absolute bottom-0 left-0 z-10 hidden w-full justify-end px-10 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))] text-right text-sm text-bark-muted text-outline-cream wide:flex">
        <div>
          <p>
            <a href="#bibliography" className={`pointer-events-auto ${linkClass}`}>
              Bibliography
            </a>
          </p>
          <p className="mt-1">© {YEAR} Corrugated Metabolism</p>
        </div>
      </footer>

      <BottomSheet open={sheet === 'about'} onClose={closeSheet} title="About">
        <div className="space-y-5 text-sm leading-relaxed">
          <p className="text-bark-muted">
            A systems diagram of the corrugated box, printed on the box itself. {CAPTION_NOTE}
          </p>
          <div>
            <p className="text-xs text-bark-muted">Authors</p>
            <p className="mt-1">{AUTHORS}</p>
          </div>
          <p className="pt-2 text-xs text-bark-muted">© {YEAR} Corrugated Metabolism</p>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'sources'} onClose={closeSheet} title="Bibliography">
        <SourceList className="text-sm" />
        <p className="mt-8 text-center text-xs text-bark-muted">© {YEAR} Corrugated Metabolism</p>
      </BottomSheet>
    </div>
  )
}

export default App
