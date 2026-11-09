import type { Ref } from 'react'
import { CircleAlert } from 'lucide-react'

/** Reasons a change was refused (announced, and focused so keyboard users land on it). */
export function RefusedBox({ title, messages, ref }: { title: string; messages: string[]; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mt-4 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg focus:outline-none"
    >
      <p className="flex items-start gap-2 font-semibold">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        {title}
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-11">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  )
}
