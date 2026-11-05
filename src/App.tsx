import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quaternion } from 'three'
import AxisGizmo, { type AxisGizmoHandle } from './AxisGizmo'
import Bibliography, { linkClass } from './Bibliography'
import CardboardScene from './CardboardScene'
import { CAPTIONS } from './print/sankeyPrint'
import SiteHeader from './SiteHeader'

const YEAR = new Date().getFullYear()
const BASE_TITLE = 'Corrugated Metabolism'
// Hide the hint once the user starts interacting: pointerdown = drag/pan or touch pinch, wheel = zoom
const DISMISS_EVENTS = ['pointerdown', 'wheel'] as const

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

function App() {
  const showBibliography = useHash() === '#bibliography'
  const [showHint, setShowHint] = useState(true)
  const [flat, setFlat] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const gizmo = useRef<AxisGizmoHandle>(null)
  const updateGizmo = useCallback((q: Quaternion) => gizmo.current?.update(q), [])
  // The 2D view centres the net between the title block and the captions
  const header = useRef<HTMLElement>(null)
  const captions = useRef<HTMLDivElement>(null)
  const textBand = useCallback(() => {
    if (!header.current || !captions.current) return null
    return { top: header.current.getBoundingClientRect().bottom, bottom: captions.current.getBoundingClientRect().top }
  }, [])

  // Only listen for the first interaction while the diagram is on screen, so reading the
  // bibliography first doesn't silently dismiss the hint.
  useEffect(() => {
    if (showBibliography || !showHint) return
    const dismiss = () => setShowHint(false)
    DISMISS_EVENTS.forEach((e) => window.addEventListener(e, dismiss, { once: true, passive: true }))
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
      <SiteHeader
        ref={header}
        className="pointer-events-none absolute left-0 top-0 z-10 text-outline-cream"
      />

      {/* View controls: bottom-right on mobile (above the bibliography link and copyright,
          clear of the title), top-right from sm up. Axis gizmo sits to the left of the 3D/2D switch. */}
      <div className="absolute bottom-[calc(5rem+env(safe-area-inset-bottom))] right-6 z-20 flex items-center gap-3 sm:bottom-auto sm:right-10 sm:top-8">
        {/* Axis gizmo: follows the box as it turns; click to fly back to the starting angle and zoom.
            In 2D it shows only the net's x/y axes and recenters the flat view. */}
        <button
          type="button"
          onClick={() => setResetKey((k) => k + 1)}
          title={flat ? 'Recenter view' : 'Reset view'}
          aria-label={flat ? 'Recenter view' : 'Reset view'}
          className="group flex h-11 w-11 items-center justify-center rounded-full bg-cream-light text-bark shadow-sm ring-1 ring-bark/15 transition duration-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bark active:scale-95"
        >
          <AxisGizmo ref={gizmo} flat={flat} />
        </button>

        <div
          role="group"
          aria-label="View mode"
          className="relative flex h-11 rounded-full bg-cream-light p-1 text-sm font-medium shadow-sm ring-1 ring-bark/15"
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
          <span className="block">Scroll or pinch to zoom</span>
          <span className="block">Right-drag or two-finger drag to pan</span>
        </p>
      </div>

      <footer className="pointer-events-none absolute bottom-0 left-0 z-10 flex w-full items-end justify-between gap-6 px-6 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm text-bark-muted text-outline-cream sm:px-10">
        {/* What the two halves of the Sankey printed on the box show */}
        {/* One line per caption; phones are too narrow for that, so there they wrap */}
        <div ref={captions} className="max-w-[55%] min-w-0 space-y-0.5 text-left text-[11px] leading-snug sm:max-w-none sm:whitespace-nowrap sm:text-xs">
          {CAPTIONS.map((c) => (
            <p key={c}>{c}</p>
          ))}
        </div>
        <div className="shrink-0 text-right">
          <p>
            <a href="#bibliography" className={`pointer-events-auto ${linkClass}`}>
              Bibliography
            </a>
          </p>
          <p className="mt-1">© {YEAR} Corrugated Metabolism</p>
        </div>
      </footer>
    </div>
  )
}

export default App
