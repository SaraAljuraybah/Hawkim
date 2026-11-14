import type { ReactNode } from 'react'

/**
 * A titled group of form fields in a bordered box: a <fieldset> whose <legend> names it, styled like the
 * Address group (EitherFieldGroup). The fields keep their own labels, hints and errors.
 */
export function FieldGroup({ legend, children, className = '' }: { legend: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`min-w-0 rounded-lg border border-beige p-4 ${className}`}>
      <legend className="px-1 text-sm font-bold text-maroon">{legend}</legend>
      <div className="space-y-5">{children}</div>
    </fieldset>
  )
}
