import { createLocalStore, useLocalStore, type LocalStore } from "@redbamboo/utility"
import { DEFAULT_PUSH_TO_TALK_KEY, normalizePushToTalkKey } from "./push-to-talk-key"

export const PUSH_TO_TALK_SETTINGS_STORAGE_KEY = "redbamboo_push_to_talk_settings"
const LEGACY_CODERED_SETTINGS_STORAGE_KEY = "codered_hf_settings"

export interface PushToTalkSettings extends Record<string, unknown> {
  key: string
}

export { DEFAULT_PUSH_TO_TALK_KEY, normalizePushToTalkKey } from "./push-to-talk-key"

const baseStore = createLocalStore<PushToTalkSettings>(PUSH_TO_TALK_SETTINGS_STORAGE_KEY, {
  key: DEFAULT_PUSH_TO_TALK_KEY,
})
let migrationChecked = false

function migrateLegacyCodeRedSetting(): void {
  if (migrationChecked || typeof localStorage === "undefined") return
  migrationChecked = true
  if (localStorage.getItem(PUSH_TO_TALK_SETTINGS_STORAGE_KEY)) return
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_CODERED_SETTINGS_STORAGE_KEY) ?? "null") as { pushToTalkKey?: unknown } | null
    if (typeof legacy?.pushToTalkKey !== "string") return
    const key = normalizePushToTalkKey(legacy.pushToTalkKey)
    if (key) baseStore.set({ key })
  } catch {
    // Invalid legacy settings fall back to the shared default.
  }
}

export const pushToTalkSettingsStore: LocalStore<PushToTalkSettings> = {
  get() {
    migrateLegacyCodeRedSetting()
    return baseStore.get()
  },
  getSnapshot() {
    migrateLegacyCodeRedSetting()
    return baseStore.getSnapshot()
  },
  set(partial) {
    const key = partial.key === undefined ? undefined : normalizePushToTalkKey(partial.key)
    if (partial.key !== undefined && !key) return
    baseStore.set(key ? { ...partial, key } : partial)
  },
  subscribe(callback) {
    migrateLegacyCodeRedSetting()
    return baseStore.subscribe(callback)
  },
}

export function usePushToTalkSettings(): PushToTalkSettings {
  return useLocalStore(pushToTalkSettingsStore)
}
