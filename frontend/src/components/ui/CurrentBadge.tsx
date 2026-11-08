/** The "Current" pill beside a GVP version's number or name. */
export function CurrentBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-maroon/20 bg-maroon/[0.06] px-2.5 py-0.5 text-xs font-medium text-maroon">{label}</span>
  )
}
