import type { GuidelineVersion } from '../../data/mock/types'
import { useGuidelineVersionValues } from './guidelineVersionValues'

/**
 * A GVP version's details: title, version, issued by SFDA, added to Hawkim (and by whom), source,
 * file and number of requirements. "—" for what isn't known.
 */
export function GuidelineVersionDetails({ version, className = '' }: { version: GuidelineVersion; className?: string }) {
  const values = useGuidelineVersionValues()
  return (
    <dl className={`grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3 ${className}`}>
      {values(version).map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-text-gray">{item.label}</dt>
          <dd className="mt-0.5 font-medium text-maroon">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
