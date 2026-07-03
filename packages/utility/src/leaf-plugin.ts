import type { ComponentType } from "react"
import type { Command } from "./types"

/**
 * Context handed to plugin-contributed command actions. Plugins are mounted
 * inside the Leaf shell's router, but their command actions may fire from
 * anywhere in the app — navigation must go through the shell.
 */
export interface LeafPluginCommandContext {
  /** SPA navigation within the Leaf shell (react-router navigate). */
  navigate: (to: string) => void
}

/**
 * A command a Leaf plugin contributes to the shell command palette.
 * Same shape as {@link Command}, except the action receives shell context.
 * The shell namespaces the id with the plugin id (`{pluginId}:{id}`).
 */
export interface LeafPluginCommand extends Omit<Command, "action"> {
  action: (ctx: LeafPluginCommandContext) => void | Promise<void>
}

/**
 * The frontend contract a Leaf plugin's web package exports (as `plugin`).
 * The shell lazy-imports the package, mounts `Page` under /apps/{id}, and
 * aggregates `commands` into the command palette.
 */
export interface LeafAppPlugin {
  /** Plugin id — matches plugin.json `id` and the plugin entity slug. */
  id: string
  /** Root page component, mounted under /apps/{id}. */
  Page: ComponentType
  /** Commands contributed to the shell command palette. */
  commands?: LeafPluginCommand[]
}
