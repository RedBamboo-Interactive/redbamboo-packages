export interface DelegationPlacement {
  /** `repository · branch`, or just the one that is present. */
  label: string
  /** The session runs in a linked worktree rather than the repository's checkout. */
  worktree: boolean
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Where a delegated session runs, from its marker metadata. Markers written before
 * branch support, and checkout sessions, carry no `branch` / `worktreePath`
 * and read as the bare repository.
 */
export function delegationPlacement(data: Record<string, unknown> | null | undefined): DelegationPlacement | undefined {
  const repository = text(data?.repository)
  const branch = text(data?.branch)
  if (!repository && !branch) return undefined
  return {
    label: [repository, branch].filter((part): part is string => !!part).join(" · "),
    worktree: text(data?.worktreePath) !== undefined,
  }
}
