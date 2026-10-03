import { Check, RotateCcw } from 'lucide-react'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { returnedFrom } from '../../lib/workflow'

interface StatusTrackerProps {
  sop: Sop
  content: SopWorkflowContent['tracker']
}

const STEPS = ['draft', 'in-review', 'in-approval', 'approved', 'published'] as const

type StepState = 'done' | 'current' | 'returned' | 'upcoming'

/**
 * Draft → In Review → In Approval → Approved → Published (PBI 22).
 * An ordered list: completed steps are checked, the current step has
 * aria-current="step", and a returned SOP shows "Returned" on the step it was
 * returned from. Every state is also given as text (never colour alone).
 * Horizontal from sm, vertical on phones.
 */
export function StatusTracker({ sop, content }: StatusTrackerProps) {
  const returnedStep = sop.status === 'returned' ? (returnedFrom(sop) ?? 'in-review') : undefined
  const currentIndex = STEPS.indexOf((returnedStep ?? sop.status) as (typeof STEPS)[number])
  const published = sop.status === 'published'

  function stateOf(index: number): StepState {
    if (index < currentIndex || (published && index === currentIndex)) return 'done'
    if (index === currentIndex) return returnedStep ? 'returned' : 'current'
    return 'upcoming'
  }

  return (
    <ol aria-label={content.label} className="flex flex-col gap-3 sm:flex-row sm:gap-0">
      {STEPS.map((step, index) => {
        const state = stateOf(index)
        const isCurrent = index === currentIndex
        return (
          <li
            key={step}
            aria-current={isCurrent ? 'step' : undefined}
            className="relative flex items-center gap-3 sm:flex-1 sm:flex-col sm:gap-2 sm:text-center"
          >
            {/* Connector to the previous step (from sm) */}
            {index > 0 && (
              <span
                aria-hidden="true"
                className={`absolute top-4 right-1/2 hidden h-0.5 w-full sm:block ${
                  index <= currentIndex ? 'bg-maroon' : 'bg-beige'
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                state === 'done'
                  ? 'bg-maroon text-offwhite'
                  : state === 'current'
                    ? 'border-2 border-maroon bg-white text-maroon'
                    : state === 'returned'
                      ? 'border-2 border-status-rejected-fg bg-status-rejected-bg text-status-rejected-fg'
                      : 'border-2 border-beige bg-white text-text-gray'
              }`}
            >
              {state === 'done' ? (
                <Check className="size-4" strokeWidth={2.5} />
              ) : state === 'returned' ? (
                <RotateCcw className="size-4" strokeWidth={2.25} />
              ) : (
                index + 1
              )}
            </span>
            <span className="flex flex-col sm:items-center">
              <span
                className={`text-sm ${state === 'upcoming' ? 'text-text-gray' : 'font-medium text-maroon'} ${
                  isCurrent ? 'font-semibold' : ''
                }`}
              >
                {content.steps[step]}
              </span>
              {state === 'returned' && (
                <span className="mt-1 inline-flex w-fit rounded-full bg-status-rejected-bg px-2 py-0.5 text-xs font-medium text-status-rejected-fg">
                  {content.returned}
                </span>
              )}
              <span className="sr-only">
                {state === 'done' && ` (${content.srCompleted})`}
                {state === 'current' && ` (${content.srCurrent})`}
                {state === 'returned' && ` (${content.srReturned})`}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
