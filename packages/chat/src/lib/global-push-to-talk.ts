export const GLOBAL_PUSH_TO_TALK_EVENT = "redbamboo:global-push-to-talk"

export interface GlobalPushToTalkDetail {
  key: string
  pressed: boolean
}

export function parseGlobalPushToTalkDetail(
  value: unknown,
): GlobalPushToTalkDetail | null {
  if (!value || typeof value !== "object") return null
  const detail = value as Partial<GlobalPushToTalkDetail>
  return typeof detail.key === "string" && typeof detail.pressed === "boolean"
    ? { key: detail.key, pressed: detail.pressed }
    : null
}

export function dispatchGlobalPushToTalk(
  target: Document,
  detail: GlobalPushToTalkDetail,
): void {
  const event = target.createEvent("CustomEvent")
  event.initCustomEvent(GLOBAL_PUSH_TO_TALK_EVENT, false, false, detail)
  target.dispatchEvent(event)
}
