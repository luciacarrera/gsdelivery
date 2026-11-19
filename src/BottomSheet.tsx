import { useEffect, useRef, useState, type ReactNode } from 'react'

// How far the handle must be pulled down before letting go closes the sheet
const CLOSE_DRAG_PX = 80

type BottomSheetProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * Phone sheet that slides up from the bottom over the diagram. A native modal <dialog>, so it
 * gets focus trapping, Escape to close and the top layer for free. Closes on ×, a tap on the
 * backdrop, Escape, or dragging the handle down.
 */
export default function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [dragY, setDragY] = useState<number | null>(null)
  const dragStart = useRef(0)

  useEffect(() => {
    const d = dialog.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const endDrag = () => {
    if (dragY !== null && dragY > CLOSE_DRAG_PX) onClose()
    setDragY(null)
  }

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      // Escape (and any other native close) goes through the parent's state
      onClose={onClose}
      // A click whose target is the dialog itself landed on the backdrop, outside the panel
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={dragY !== null ? { transform: `translateY(${Math.max(0, dragY)}px)`, transition: 'none' } : undefined}
      className="fixed inset-x-0 top-auto bottom-0 m-0 flex max-h-[85dvh] w-full max-w-none flex-col rounded-t-3xl bg-cream-light p-0 font-sans text-bark shadow-lg ring-1 ring-bark/15 transition-[translate,transform] duration-300 ease-out not-open:hidden starting:open:translate-y-full backdrop:bg-bark/35"
    >
      {/* Drag handle */}
      <div
        className="flex shrink-0 cursor-grab touch-none justify-center pt-3 pb-2"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragStart.current = e.clientY
          setDragY(0)
        }}
        onPointerMove={(e) => dragY !== null && setDragY(e.clientY - dragStart.current)}
        onPointerUp={endDrag}
        onPointerCancel={() => setDragY(null)}
      >
        <span aria-hidden className="h-1 w-10 rounded-full bg-bark/20" />
      </div>

      <div className="flex shrink-0 items-center justify-between px-6 pb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-bark-muted transition-colors hover:text-bark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bark"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto overscroll-contain px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </dialog>
  )
}
