import { Search, FolderTree, Globe } from "lucide-react"
import { JsonHighlight } from "@redbamboo/ui"

interface Props {
  toolName: string
  toolInput: string
}

export function ToolInputView({ toolName, toolInput }: Props) {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(toolInput)
  } catch {
    return <JsonHighlight json={toolInput} />
  }

  switch (toolName) {
    case "Read":
      return <ReadView p={parsed} />
    case "Edit":
      return <EditView p={parsed} />
    case "Write":
      return <WriteView p={parsed} />
    case "Bash":
    case "PowerShell":
      return <ShellView toolName={toolName} p={parsed} />
    case "Grep":
      return <GrepView p={parsed} />
    case "Glob":
      return <GlobView p={parsed} />
    case "Agent":
      return <AgentView p={parsed} />
    case "WebSearch":
      return <WebSearchView p={parsed} />
    case "WebFetch":
      return <WebFetchView p={parsed} />
    default:
      return <JsonHighlight json={toolInput} />
  }
}

function FilePath({ path }: { path: string }) {
  return <span className="font-mono text-xs text-amber-300/90">{path}</span>
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-text-muted">
      {children}
    </span>
  )
}

function ReadView({ p }: { p: Record<string, unknown> }) {
  const path = p.file_path as string | undefined
  const offset = p.offset as number | undefined
  const limit = p.limit as number | undefined
  return (
    <div className="space-y-1.5">
      {path && <FilePath path={path} />}
      {(offset != null || limit != null) && (
        <div className="flex gap-2">
          {offset != null && <Tag>offset {offset}</Tag>}
          {limit != null && <Tag>limit {limit}</Tag>}
        </div>
      )}
    </div>
  )
}

function EditView({ p }: { p: Record<string, unknown> }) {
  const path = p.file_path as string | undefined
  const oldStr = p.old_string as string | undefined
  const newStr = p.new_string as string | undefined
  return (
    <div className="space-y-2">
      {path && <FilePath path={path} />}
      {(oldStr != null || newStr != null) && (
        <div className="rounded-md overflow-hidden border border-border-subtle text-xs font-mono">
          {oldStr != null && (
            <div className="bg-red-500/[0.08] px-3 py-1.5 whitespace-pre-wrap break-all">
              {oldStr.split("\n").map((line, i) => (
                <div key={i}>
                  <span className="text-red-400/60 select-none mr-2">-</span>
                  <span className="text-red-300/80">{line}</span>
                </div>
              ))}
            </div>
          )}
          {newStr != null && (
            <div className="bg-green-500/[0.08] px-3 py-1.5 whitespace-pre-wrap break-all">
              {newStr.split("\n").map((line, i) => (
                <div key={i}>
                  <span className="text-green-400/60 select-none mr-2">+</span>
                  <span className="text-green-300/80">{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!!p.replace_all && <Tag>replace all</Tag>}
    </div>
  )
}

function WriteView({ p }: { p: Record<string, unknown> }) {
  const path = p.file_path as string | undefined
  const content = p.content as string | undefined
  return (
    <div className="space-y-2">
      {path && <FilePath path={path} />}
      {content && (
        <pre className="text-xs font-mono whitespace-pre-wrap break-all text-text-muted max-h-48 overflow-y-auto rounded-md bg-white/[0.03] px-3 py-2">
          {content.length > 2000 ? content.slice(0, 2000) + "\n..." : content}
        </pre>
      )}
    </div>
  )
}

function ShellView({ toolName, p }: { toolName: string; p: Record<string, unknown> }) {
  const command = p.command as string | undefined
  const desc = p.description as string | undefined
  const prompt = toolName === "PowerShell" ? "PS>" : "$"
  return (
    <div className="space-y-2">
      {desc && <p className="text-xs text-text-muted italic">{desc}</p>}
      {command && (
        <div className="rounded-md bg-black/40 px-3 py-2 font-mono text-xs">
          <span className="text-text-disabled select-none mr-2">{prompt}</span>
          <span className="text-green-300/90 whitespace-pre-wrap break-all">{command}</span>
        </div>
      )}
      {!!(p.timeout || p.run_in_background) && (
        <div className="flex gap-2 flex-wrap">
          {!!p.timeout && <Tag>timeout {String(p.timeout)}ms</Tag>}
          {!!p.run_in_background && <Tag>background</Tag>}
        </div>
      )}
    </div>
  )
}

function GrepView({ p }: { p: Record<string, unknown> }) {
  const pattern = p.pattern as string | undefined
  const path = p.path as string | undefined
  return (
    <div className="space-y-2">
      {pattern && (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 font-mono text-xs">
          <Search size={10} className="text-text-disabled" />
          <span className="text-amber-300/90">{pattern}</span>
        </div>
      )}
      {path && <div><FilePath path={path} /></div>}
      {!!(p.glob || p.type || p.output_mode || p["-i"] || p.multiline) && (
        <div className="flex gap-2 flex-wrap">
          {!!p.glob && <Tag>glob: {String(p.glob)}</Tag>}
          {!!p.type && <Tag>type: {String(p.type)}</Tag>}
          {!!p.output_mode && <Tag>{String(p.output_mode)}</Tag>}
          {!!p["-i"] && <Tag>case-insensitive</Tag>}
          {!!p.multiline && <Tag>multiline</Tag>}
        </div>
      )}
    </div>
  )
}

function GlobView({ p }: { p: Record<string, unknown> }) {
  const pattern = p.pattern as string | undefined
  const path = p.path as string | undefined
  return (
    <div className="space-y-2">
      {pattern && (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 font-mono text-xs">
          <FolderTree size={10} className="text-text-disabled" />
          <span className="text-amber-300/90">{pattern}</span>
        </div>
      )}
      {path && <div><FilePath path={path} /></div>}
    </div>
  )
}

function AgentView({ p }: { p: Record<string, unknown> }) {
  const desc = p.description as string | undefined
  const agentType = p.subagent_type as string | undefined
  const agentPrompt = p.prompt as string | undefined
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {agentType && <Tag>{agentType}</Tag>}
        {desc && <span className="text-xs font-medium">{desc}</span>}
      </div>
      {agentPrompt && (
        <pre className="text-xs font-mono whitespace-pre-wrap break-all text-text-muted max-h-48 overflow-y-auto rounded-md bg-white/[0.03] px-3 py-2">
          {agentPrompt.length > 2000 ? agentPrompt.slice(0, 2000) + "\n..." : agentPrompt}
        </pre>
      )}
      {!!(p.model || p.run_in_background) && (
        <div className="flex gap-2 flex-wrap">
          {!!p.model && <Tag>model: {String(p.model)}</Tag>}
          {!!p.run_in_background && <Tag>background</Tag>}
        </div>
      )}
    </div>
  )
}

function WebSearchView({ p }: { p: Record<string, unknown> }) {
  const query = p.query as string | undefined
  return query ? (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 font-mono text-xs">
      <Globe size={10} className="text-text-disabled" />
      <span>{query}</span>
    </div>
  ) : <JsonHighlight json={JSON.stringify(p, null, 2)} />
}

function WebFetchView({ p }: { p: Record<string, unknown> }) {
  const url = p.url as string | undefined
  return url ? (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2.5 py-1 font-mono text-xs">
      <Globe size={10} className="text-text-disabled" />
      <span className="text-blue-300/80">{url}</span>
    </div>
  ) : <JsonHighlight json={JSON.stringify(p, null, 2)} />
}
