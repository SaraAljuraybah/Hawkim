import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { complianceEn } from '../../content/compliance.en'
import { requestGuidelineAdditionPath } from '../../lib/routes'
import type { GuidelineUnavailableState } from '../../lib/guidelineGate'

/**
 * Shown when an author presses Check Compliance and the organization has no current regulatory guideline.
 * No check is started. What it says depends on the database's answer:
 * - none, failed, unpublished, cancelled: Submit a Request opens Submit a Request with Regulatory Guideline
 *   Addition chosen and a title and description filled in (nothing is sent until the author submits), or Cancel;
 * - processing: only OK (the guideline is on its way, so no request is suggested);
 * - error: only OK (it couldn't be checked; try again).
 * `onClose` is called when it closes without going to the form.
 */
export function GuidelineUnavailableDialog({ state, sopId, onClose }: { state: GuidelineUnavailableState; sopId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const text = complianceEn.unavailable
  const informOnly = state === 'processing' || state === 'error'
  const message = state ? text[state] : undefined
  return (
    <ConfirmDialog
      open={!!state}
      title={message?.title ?? ''}
      description={message?.text ?? ''}
      cancelLabel={informOnly ? text.ok : text.cancel}
      confirmLabel={informOnly ? undefined : text.request}
      onConfirm={() => navigate(requestGuidelineAdditionPath(sopId))}
      onCancel={onClose}
    />
  )
}
