/**
 * Removes machine-facing envelopes that travel with a user turn but must never
 * appear as authored prose in the chat timeline.
 */
export function stripHiddenMessageEnvelopes(content: string): string {
  return content
    .replace(/<nova-context[\s\S]*?<\/nova-context>\s*/g, "")
    .replace(/<nova-prior-messages?[\s\S]*?<\/nova-prior-messages?>\s*/g, "")
}
