import type { ChatMaintenanceStatus } from "../types"
import { maintenanceNotice } from "../lib/maintenance-status"

export function MaintenanceNotice({ status, hasServerSession, unavailable }: {
  status?: ChatMaintenanceStatus | null; hasServerSession: boolean; unavailable?: boolean
}) {
  const notice = maintenanceNotice(status, hasServerSession, unavailable)
  if (!notice) return null
  return <div data-slot="maintenance-notice" role="status" aria-live="polite"
    className="shrink-0 px-4 pb-2 text-xs text-text-muted">
    <span className="font-medium text-contrast">{notice.title}. </span>{notice.detail}
  </div>
}
