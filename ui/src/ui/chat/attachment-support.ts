const CHAT_IMAGE_MIME_BY_EXTENSION = {
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

const CHAT_IMAGE_MIME_TYPES = new Set<string>(Object.values(CHAT_IMAGE_MIME_BY_EXTENSION));

export const CHAT_ATTACHMENT_ACCEPT = [
  ...CHAT_IMAGE_MIME_TYPES,
  ...Object.keys(CHAT_IMAGE_MIME_BY_EXTENSION).map((extension) => `.${extension}`),
].join(",");

export function isSupportedChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && CHAT_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function resolveSupportedChatAttachmentMimeType(
  file: Pick<File, "name" | "type">,
): string | null {
  const declaredMime = file.type.trim().toLowerCase();
  if (isSupportedChatAttachmentMimeType(declaredMime)) {
    return declaredMime;
  }
  const extension = file.name
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/)?.[1];
  return extension
    ? (CHAT_IMAGE_MIME_BY_EXTENSION[extension as keyof typeof CHAT_IMAGE_MIME_BY_EXTENSION] ?? null)
    : null;
}

export function isSupportedChatAttachmentFile(file: Pick<File, "name" | "type">): boolean {
  return resolveSupportedChatAttachmentMimeType(file) !== null;
}
