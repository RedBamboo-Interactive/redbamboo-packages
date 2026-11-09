import { ActivityNote, useActivityShapes } from "./activity-status-row"

/** The session is parked on the person: a question to answer, or an approval to give. */
export function PendingQuestionLine({ kind = "question" }: { kind?: "question" | "permission" } = {}) {
  const shapes = useActivityShapes()
  const permission = kind === "permission"
  return (
    <div
      data-slot="pending-question-line"
      data-kind={kind}
      className={`flex items-center gap-2.5 text-sm py-1 ${permission ? "text-amber-400" : "text-teal-400"}`}
    >
      <i className={`ph-bold ${permission ? "ph-shield-warning" : "ph-question"} text-xs animate-pulse`} />
      {shapes}
      <span className="shrink-0">{permission ? "Waiting for your approval..." : "Waiting for your answer..."}</span>
      <ActivityNote />
    </div>
  )
}
