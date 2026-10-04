import { createLocalStore, useLocalStore, type LocalStore } from "@redbamboo/utility"
import type { ComposerAutoFocusMode } from "./composer-focus"

export const COMPOSER_FOCUS_SETTINGS_STORAGE_KEY = "redbamboo_composer_focus_settings"
export const DEFAULT_COMPOSER_AUTO_FOCUS_MODE: ComposerAutoFocusMode = "desktop-only"

export interface ComposerFocusSettings extends Record<string, unknown> {
  autoFocusMode: ComposerAutoFocusMode
}

function isComposerAutoFocusMode(value: unknown): value is ComposerAutoFocusMode {
  return value === "desktop-only" || value === "always" || value === "never"
}

const baseStore = createLocalStore<ComposerFocusSettings>(COMPOSER_FOCUS_SETTINGS_STORAGE_KEY, {
  autoFocusMode: DEFAULT_COMPOSER_AUTO_FOCUS_MODE,
})

export const composerFocusSettingsStore: LocalStore<ComposerFocusSettings> = {
  get: baseStore.get,
  getSnapshot: baseStore.getSnapshot,
  set(partial) {
    if (partial.autoFocusMode !== undefined && !isComposerAutoFocusMode(partial.autoFocusMode)) return
    baseStore.set(partial)
  },
  subscribe: baseStore.subscribe,
}

export function useComposerFocusSettings(): ComposerFocusSettings {
  return useLocalStore(composerFocusSettingsStore)
}
