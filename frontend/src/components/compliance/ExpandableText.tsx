import { useId, useState } from 'react'
import { FindingText } from './FindingText'
import { excerpt } from './reportTables'

/**
 * A long text as an excerpt with "Show more" / "Show less" (the report's Procedures text and Requirements
 * summary); a short one in full, with no button. Printed, it is always in full and the button is hidden.
 * The text takes its parent's colour (`className` to set one).
 */
export function ExpandableText({
  text,
  showMore,
  showLess,
  toggleLabel,
  className = '',
}: {
  text: string
  showMore: string
  showLess: string
  /** Added to the button's accessible name for screen readers, e.g. "procedure 2". */
  toggleLabel: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const short = excerpt(text)
  if (!short.cut) return <FindingText text={text} className={className} />
  return (
    <div>
      <div id={id}>
        {open ? (
          <FindingText text={text} className={className} />
        ) : (
          <>
            <p className={`${className} print:hidden`.trim()}>{short.text}</p>
            {/* Printed in full */}
            <FindingText text={text} className={`hidden ${className} print:block`.replace('  ', ' ')} />
          </>
        )}
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className="mt-1 rounded-sm text-sm font-medium text-maroon underline underline-offset-2 hover:text-maroon-secondary print:hidden"
      >
        {open ? showLess : showMore}
        <span className="sr-only"> {toggleLabel}</span>
      </button>
    </div>
  )
}
