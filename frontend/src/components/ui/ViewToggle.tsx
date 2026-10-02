import { LayoutGrid, List } from 'lucide-react'

export type ViewMode = 'grid' | 'list'

interface ViewToggleProps {
  value: ViewMode
  onChange: (value: ViewMode) => void
  /** Accessible names: the group and each button. */
  labels: { label: string; grid: string; list: string }
  className?: string
}

const options = [
  { value: 'grid', Icon: LayoutGrid },
  { value: 'list', Icon: List },
] as const

/** Grid / List switch: two icon buttons with aria-pressed. */
export function ViewToggle({ value, onChange, labels, className = '' }: ViewToggleProps) {
  return (
    <div role="group" aria-label={labels.label} className={`inline-flex rounded-lg border border-beige bg-white p-0.5 ${className}`}>
      {options.map(({ value: option, Icon }) => {
        const pressed = value === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={pressed}
            aria-label={labels[option]}
            onClick={() => onChange(option)}
            className={`inline-flex size-9 items-center justify-center rounded-md transition-colors ${
              pressed ? 'bg-maroon/[0.07] text-maroon' : 'text-text-gray hover:bg-beige hover:text-maroon'
            }`}
          >
            <Icon aria-hidden="true" className="size-[1.125rem]" strokeWidth={1.75} />
          </button>
        )
      })}
    </div>
  )
}
