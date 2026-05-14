export function PendingQuestionLine() {
  return (
    <div data-slot="pending-question-line" className="flex items-center gap-2.5 text-teal-400 text-sm py-1">
      <i className="fa-solid fa-circle-question text-xs animate-pulse" />
      <span>Waiting for your answer...</span>
    </div>
  )
}
