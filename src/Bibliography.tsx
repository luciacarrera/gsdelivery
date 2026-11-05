import SiteHeader from './SiteHeader'

type Source = { citation: string; url: string }

// Chicago-style entries, verbatim from issue #30.
const SOURCES: Source[] = [
  {
    citation:
      'Global Market Insights Inc. “Corrugated Boxes Market Size, Forecasts Report 2026-2035.” Accessed November 4, 2026.',
    url: 'https://www.gminsights.com/industry-analysis/corrugated-boxes-market',
  },
  {
    citation:
      'IndustryARC. “North America Corrugated Cardboard Market.” IndustryARC. Accessed November 4, 2026.',
    url: 'https://www.industryarc.com/research/north-america-corrugated-cardboard-market-801013',
  },
  {
    citation:
      'Statista. “Largest Food and Beverage Companies in North America 2023.” Accessed November 4, 2026.',
    url: 'https://www.statista.com/statistics/459276/leading-food-and-beverage-processors-in-north-america/',
  },
  {
    citation: 'Statista. “Largest Online Retailers in the U.S. 2025.” Accessed November 4, 2026.',
    url: 'https://www.statista.com/statistics/274255/market-share-of-the-leading-retailers-in-us-e-commerce/',
  },
  {
    citation:
      'US EPA, OLEM. “Containers and Packaging: Product-Specific Data.” Data and Tools. September 7, 2017.',
    url: 'https://www.epa.gov/facts-and-figures-about-materials-waste-and-recycling/containers-and-packaging-product-specific',
  },
  {
    citation:
      'US EPA, OLEM. “Paper and Paperboard: Material-Specific Data.” Collections and Lists. September 7, 2017.',
    url: 'https://www.epa.gov/facts-and-figures-about-materials-waste-and-recycling/paper-and-paperboard-material-specific-data',
  },
]

/** Plain-hyperlink styling in the site palette (no default blue). */
export const linkClass =
  'text-bark-muted underline decoration-bark/30 underline-offset-4 transition-colors duration-300 hover:text-bark hover:decoration-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bark'

export default function Bibliography({ year }: { year: number }) {
  return (
    <div className="flex min-h-screen flex-col bg-cream font-sans text-bark">
      <SiteHeader title="Corrugated Bibliography" linkHome />

      <main className="flex-1 px-6 pt-10 pb-12 sm:px-10">
        <ul className="space-y-5 text-sm leading-relaxed sm:text-base">
          {SOURCES.map(({ citation, url }) => (
            <li key={url} className="pl-8 -indent-8">
              {citation}{' '}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`break-all ${linkClass}`}
              >
                {url}
              </a>
              .
            </li>
          ))}
        </ul>
      </main>

      <footer className="px-6 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm text-bark-muted sm:px-10">
        <p className="text-right">
          <a href="#" className={linkClass}>
            Diagram
          </a>
        </p>
        <p className="mt-1 text-right">© {year} Corrugated Metabolism</p>
      </footer>
    </div>
  )
}
