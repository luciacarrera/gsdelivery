import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quaternion } from 'three'
import AxisGizmo, { type AxisGizmoHandle } from './AxisGizmo'
import CardboardScene from './CardboardScene'

const YEAR = new Date().getFullYear()
// Hide the hint once the user starts interacting: pointerdown = drag/pan or touch pinch, wheel = zoom
const DISMISS_EVENTS = ['pointerdown', 'wheel'] as const

function App() {
  const [showHint, setShowHint] = useState(true)
  const [flat, setFlat] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const gizmo = useRef<AxisGizmoHandle>(null)
  const updateGizmo = useCallback((q: Quaternion) => gizmo.current?.update(q), [])

  useEffect(() => {
    const dismiss = () => setShowHint(false)
    DISMISS_EVENTS.forEach((e) => window.addEventListener(e, dismiss, { once: true, passive: true }))
    return () => DISMISS_EVENTS.forEach((e) => window.removeEventListener(e, dismiss))
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col bg-cream font-sans text-bark">
      <header className="pointer-events-none absolute left-0 top-0 z-10 px-6 pt-8 text-left sm:px-10">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-4xl">
          Corrugated Metabolism
        </h1>
        <div className="mt-3 h-px w-16 bg-moss" />
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-bark-muted sm:text-base">
          Lucía Carrera, Marc Dunand, James Musasizi, and Rick Yoon
        </p>
      </header>

      {/* View controls: bottom-right on mobile (above the copyright, clear of the title),
          top-right from sm up. Axis gizmo sits to the left of the 3D/2D switch. */}
      <div className="absolute bottom-[calc(3.5rem+env(safe-area-inset-bottom))] right-6 z-20 flex items-center gap-3 sm:bottom-auto sm:right-10 sm:top-8">
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
          <CardboardScene flat={flat} resetKey={resetKey} onCameraFrame={updateGizmo} />
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

      <footer className="pointer-events-none absolute bottom-0 left-0 z-10 w-full px-6 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm text-bark-muted sm:px-10">
        <p className="text-right">© {YEAR} Corrugated Metabolism</p>
      </footer>
    </div>
  )
}

export default App
