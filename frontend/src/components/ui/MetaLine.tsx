import type { ReactNode } from 'react'

/**
 * A " · "-separated line from a content template, like the SOP detail page's subtitle: each
 * `{key}` is replaced by its value (text or an element such as <time>), and screen readers hear a
 * comma instead of each "·".
 */
export function MetaLine({ template, values, className = 'text-sm text-text-gray' }: { template: string; values: Record<string, ReactNode>; className?: string }) {
  const keys = Object.keys(values).map((key) => `\\{${key}\\}`).join('|')
  const parts = template.split(new RegExp(`(${keys ? `${keys}|` : ''} · )`)).filter(Boolean)
  return (
    <p className={className}>
      {parts.map((part, index) => {
        if (part === ' · ') return <span key={index}><span aria-hidden="true"> · </span><span className="sr-only">, </span></span>
        const key = part.match(/^\{(\w+)\}$/)?.[1]
        return <span key={index}>{key && key in values ? values[key] : part}</span>
      })}
    </p>
  )
}
