/** Pure selection policy shared by the file picker/drop surface and tests. */
export function acceptedAttachmentFiles<T extends { type: string }>(
  files: readonly T[],
  enableImages: boolean,
  enableFiles: boolean,
): T[] {
  return files.filter(file => file.type.startsWith("image/") ? enableImages : enableFiles)
}
