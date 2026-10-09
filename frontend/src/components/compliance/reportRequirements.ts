import { createContext, useContext } from 'react'
import type { Requirement } from '../../data/mock/types'

/**
 * Looks up a requirement in the GVP version the shown report was checked against
 * (reports keep their version). Provided by the compliance report page.
 */
export const ReportRequirementsContext = createContext<(requirementId: string) => Requirement | undefined>(
  () => undefined,
)

/** The report's requirement lookup. */
export function useReportRequirement() {
  return useContext(ReportRequirementsContext)
}
