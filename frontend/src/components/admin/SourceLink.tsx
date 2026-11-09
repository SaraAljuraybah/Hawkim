import { ExternalLink } from 'lucide-react'
import { adminEn } from '../../content/admin.en'

/** A guideline's Source link, opening in a new tab (said for screen readers), or '—'. */
export function SourceLink({ source }: { source: string | undefined }) {
  const text = adminEn.regulations
  if (!source) return <>{text.none}</>
  return (
    <a
      href={source}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-start gap-1 rounded-sm break-all text-maroon underline underline-offset-2 hover:text-maroon-secondary"
    >
      {source}
      <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
      <span className="sr-only"> {text.newTab}</span>
    </a>
  )
}
