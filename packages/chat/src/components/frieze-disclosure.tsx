import { friezeSummaryText } from "../lib/frieze-presentation"
import { PART_COLOR } from "../lib/part-colors"

export function FriezeDisclosure({ count, eventOnly, failed, workingColor, expanded, onToggle }: {
  count: number
  eventOnly: boolean
  failed: number
  workingColor?: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      data-slot="frieze-disclosure"
      aria-expanded={expanded}
      onClick={onToggle}
      className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-disabled hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-ring"
    >
      {workingColor
        ? <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px] square-jiggle" style={{ backgroundColor: workingColor }} />
        : <i aria-hidden="true" className={expanded ? "ph-bold ph-caret-down text-[9px]" : "ph-bold ph-caret-right text-[9px]"} />}
      <span>{friezeSummaryText(count, eventOnly, !!workingColor)}</span>
      {failed > 0 && <span style={{ color: PART_COLOR.error }}>· {failed} failed</span>}
    </button>
  )
}
