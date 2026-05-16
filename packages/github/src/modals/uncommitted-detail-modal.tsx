import { ModalBase, ModalHeader, ModalSection, CardContent, Badge } from "@redbamboo/ui"
import type { RepoWorkingState } from "../types"
import { GhostHash } from "../components/ghost-hash"

interface Props {
  open: boolean
  repo: RepoWorkingState | null
  onClose: () => void
}

export function UncommittedDetailModal({ open, repo, onClose }: Props) {
  if (!open || !repo) return null

  return (
    <ModalBase
      onClose={onClose}
      dataModal="uncommitted-detail"
      ariaLabel={`Uncommitted changes in ${repo.name}`}
      size="md"
    >
      <ModalHeader
        icon={<i className="fa-solid fa-code-commit text-base text-text-disabled" />}
        title={
          <code className="text-sm font-mono bg-overlay-8 px-1.5 py-0.5 rounded text-text-disabled">
            <GhostHash />
          </code>
        }
        badges={
          <>
            <Badge variant="outline" className="text-[10px]">{repo.name}</Badge>
            <Badge variant="outline" className="text-[10px] text-accent-gold border-accent-gold/40">
              uncommitted
            </Badge>
          </>
        }
        subtitle={
          <>
            <span className="text-text-muted">on</span>{" "}
            <span className="text-contrast">{repo.branch}</span>
            <span className="mx-1">&middot;</span>
            <span>{repo.uncommitted_count} file{repo.uncommitted_count !== 1 ? "s" : ""}</span>
          </>
        }
        onClose={onClose}
        closeLabel="Close uncommitted detail"
      />

      <CardContent className="space-y-6">
        <ModalSection section="files" heading="Changed Files">
          <div className="rounded-lg border border-overlay-10 overflow-hidden">
            {repo.uncommitted_files.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-overlay-6 last:border-b-0"
              >
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1 py-0 shrink-0 uppercase ${
                    f.status === "M" || f.status === "modified"
                      ? "text-accent-gold border-accent-gold/30"
                      : f.status === "A" || f.status === "added" || f.status === "?"  || f.status === "untracked"
                        ? "text-emerald-400 border-emerald-500/30"
                        : f.status === "D" || f.status === "deleted"
                          ? "text-red-400 border-red-500/30"
                          : "text-text-muted border-overlay-10"
                  }`}
                >
                  {f.status.charAt(0).toUpperCase()}
                </Badge>
                <span className="font-mono text-text-muted truncate">{f.path}</span>
              </div>
            ))}
            {repo.uncommitted_files.length === 0 && (
              <div className="px-3 py-4 text-xs text-text-muted text-center">
                No file details available
              </div>
            )}
          </div>
        </ModalSection>
      </CardContent>
    </ModalBase>
  )
}
