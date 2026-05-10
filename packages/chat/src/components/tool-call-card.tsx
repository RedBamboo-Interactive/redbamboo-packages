import { useState } from "react"
import { ChevronRight, Wrench } from "lucide-react"
import { ToolInputView } from "./tool-input-view"
import { ToolOutputView } from "./tool-output-view"

interface Props {
  toolName: string
  toolInput?: string
  toolResult?: string
}

export function ToolCallCard({ toolName, toolInput, toolResult }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden my-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
      >
        <ChevronRight size={10} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        <Wrench size={12} className="text-text-muted" />
        <span className="font-mono font-medium text-amber-300">{toolName}</span>
        {toolResult && !expanded && (
          <span className="ml-auto text-text-muted truncate max-w-[200px]">
            {toolResult.slice(0, 60)}{toolResult.length > 60 ? "..." : ""}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-border-subtle">
          {toolInput && (
            <div className="p-2 border-b border-border-subtle">
              <ToolInputView toolName={toolName} toolInput={toolInput} />
            </div>
          )}
          {toolResult && (
            <div className="p-2">
              <div className="text-[10px] uppercase text-text-muted mb-1 font-semibold">Result</div>
              <div className="max-h-60 overflow-y-auto">
                <ToolOutputView content={toolResult} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
