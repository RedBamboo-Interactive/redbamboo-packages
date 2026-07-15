import { ExpandableText, OutputFileLink, isImagePath, type OutputResolvers } from "./shared"

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|rs|go|java|rb|php|css|scss|html|ps1|sh|sql|json|ya?ml|toml|xml)$/i

function fileIcon(path: string): string {
  if (/[\\/]$/.test(path)) return "ph-bold ph-folder"
  if (isImagePath(path)) return "ph-bold ph-image"
  if (CODE_EXTENSIONS.test(path)) return "ph-bold ph-file-code"
  return "ph-bold ph-file-text"
}

/** Glob output: one linked row per file with a type icon. */
export function FileListOutputView({ content, resolvers }: {
  content: string
  resolvers: OutputResolvers
}) {
  const paths = content
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !/^\(no content\)$/i.test(l) && !l.startsWith("<system-reminder>"))

  if (paths.length === 0) {
    return <p className="text-xs text-text-disabled italic">No matches</p>
  }

  return (
    <ExpandableText content={paths.join("\n")}>
      {visible => (
        <div data-slot="tool-output-file-list" className="space-y-1">
          {visible.split("\n").map((path, i) => (
            <div key={i} className="flex items-center gap-2">
              <i className={`${fileIcon(path)} text-[10px] text-text-disabled w-3.5 text-center shrink-0`} />
              <OutputFileLink path={path} resolvers={resolvers} />
            </div>
          ))}
        </div>
      )}
    </ExpandableText>
  )
}
