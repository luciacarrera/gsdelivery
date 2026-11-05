type SiteHeaderProps = {
  title?: string
  /** Render the title as a link back to the diagram (used on secondary views). */
  linkHome?: boolean
  className?: string
}

/** Title, moss rule, and author line shared by every view. */
export default function SiteHeader({
  title = 'Corrugated Metabolism',
  linkHome = false,
  className = '',
}: SiteHeaderProps) {
  return (
    <header className={`px-6 pt-8 text-left sm:px-10 ${className}`}>
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
      <div className="mt-3 h-px w-16 bg-moss" />
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-bark-muted sm:text-base">
        Lucía Carrera, Marc Dunand, James Musasizi, and Rick Yoon
      </p>
    </header>
  )
}
