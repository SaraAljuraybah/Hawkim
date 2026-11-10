import type { GuidelineVersion } from '../../data/mock/types'
import { useGuidelineVersionValues, type GuidelineVersionActions } from './guidelineVersionValues'

/**
 * A GVP version's details: title, version and source; issued by SFDA, added to Hawkim and by whom;
 * then file and number of requirements. "—" for what isn't known. `actions` (a version's own page) makes
 * the requirements count a disclosure and can leave out the file (shown in its own card).
 */
export function GuidelineVersionDetails({ version, actions, className = '' }: { version: GuidelineVersion; actions?: GuidelineVersionActions; className?: string }) {
  const values = useGuidelineVersionValues(actions)
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
