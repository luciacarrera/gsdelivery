import type { Ref } from 'react'

export const AUTHORS = 'Lucía Carrera, Marc Dunand, James Musasizi, and Rick Yoon'

type SiteHeaderProps = {
  title?: string
  /** Render the title as a link back to the diagram (used on secondary views). */
  linkHome?: boolean
  /** Hide the author line on phones (the diagram shows it in its About sheet instead). */
  compact?: boolean
  className?: string
  ref?: Ref<HTMLElement>
}

/** Title and author line shared by every view. */
export default function SiteHeader({
  title = 'Corrugated Metabolism',
  linkHome = false,
  compact = false,
  className = '',
  ref,
}: SiteHeaderProps) {
  return (
    <header ref={ref} className={`px-6 pt-8 text-left sm:px-10 ${className}`}>
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-4xl">
        {linkHome ? (
          <a
            href="#"
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bark"
          >
            {title}
          </a>
        ) : (
          title
        )}
      </h1>
      <p
        className={`mt-3 max-w-xl text-sm leading-relaxed text-bark-muted sm:text-base ${
          compact ? 'hidden wide:block' : ''
        }`}
      >
        {AUTHORS}
      </p>
    </header>
  )
}
