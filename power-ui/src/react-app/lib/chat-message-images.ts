export type ChatMessageImage = {
  url?: string;
  alt?: string;
  omitted?: boolean;
  bytes?: number;
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function extractChatMessageImages(message: unknown): ChatMessageImage[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }

  const images: ChatMessageImage[] = [];
  for (const rawBlock of content) {
    if (!rawBlock || typeof rawBlock !== "object") {
      continue;
    }
    const block = rawBlock as Record<string, unknown>;
    const alt = nonEmptyString(block.alt) ?? nonEmptyString(block.fileName) ?? undefined;
    if (block.type === "image") {
      const directData = nonEmptyString(block.data);
      if (directData) {
        const mediaType =
          nonEmptyString(block.mimeType) ?? nonEmptyString(block.mime_type) ?? "image/png";
        images.push({
          url: directData.startsWith("data:")
            ? directData
            : `data:${mediaType};base64,${directData}`,
          alt,
        });
        continue;
      }
      const source =
        block.source && typeof block.source === "object"
          ? (block.source as Record<string, unknown>)
          : null;
      if (source?.type === "base64") {
        const data = nonEmptyString(source.data);
        if (data) {
          const mediaType =
            nonEmptyString(source.media_type) ?? nonEmptyString(source.mediaType) ?? "image/png";
          images.push({
            url: data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`,
            alt,
          });
          continue;
        }
      }
      const url = nonEmptyString(block.url);
      if (url) {
        images.push({ url, alt });
      } else if (block.omitted === true) {
        images.push({
          omitted: true,
          bytes:
            typeof block.bytes === "number" && Number.isFinite(block.bytes)
              ? block.bytes
              : undefined,
          alt,
        });
      }
      continue;
    }
    if (block.type === "image_url") {
      const imageUrl =
        block.image_url && typeof block.image_url === "object"
          ? nonEmptyString((block.image_url as Record<string, unknown>).url)
          : nonEmptyString(block.image_url);
      if (imageUrl) {
        images.push({ url: imageUrl, alt });
      }
    }
  }
  return images;
}

/** Replaces local display text without discarding image blocks already added for preview. */
export function replaceChatMessageDisplayText(
  message: Record<string, unknown>,
  displayText: string,
): Record<string, unknown> {
  if (!Array.isArray(message.content)) {
    return { ...message, content: displayText };
  }
  const nonTextBlocks = message.content.filter(
    (block) =>
      !block || typeof block !== "object" || (block as Record<string, unknown>).type !== "text",
  );
  return {
    ...message,
    content: displayText ? [{ type: "text", text: displayText }, ...nonTextBlocks] : nonTextBlocks,
  };
}

function messageRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role.toLowerCase() : "";
}

function imageBlocks(message: unknown): Array<Record<string, unknown>> {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (block): block is Record<string, unknown> =>
      Boolean(block) &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "image",
  );
}

function hasImagePreviewData(block: Record<string, unknown>): boolean {
  if (nonEmptyString(block.data)) {
    return true;
  }
  if (!block.source || typeof block.source !== "object") {
    return false;
  }
  return Boolean(nonEmptyString((block.source as Record<string, unknown>).data));
}

/** Restores in-memory image previews after sanitized Gateway history refreshes. */
export function mergeChatMessageImagePreviews(
  historyMessages: unknown[],
  localMessages: unknown[],
): unknown[] {
  const localUserMessages = localMessages.filter((message) => messageRole(message) === "user");
  let userIndex = localUserMessages.length - 1;
  let changed = false;
  const merged = [...historyMessages];

  for (let historyIndex = merged.length - 1; historyIndex >= 0; historyIndex -= 1) {
    const message = merged[historyIndex];
    if (messageRole(message) !== "user") {
      continue;
    }
    const localMessage = localUserMessages[userIndex];
    userIndex -= 1;
    if (!message || typeof message !== "object" || !localMessage) {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    const localImages = imageBlocks(localMessage).filter(hasImagePreviewData);
    if (localImages.length === 0) {
      continue;
    }
    let imageIndex = 0;
    let messageChanged = false;
    const nextContent = content.map((block) => {
      if (
        !block ||
        typeof block !== "object" ||
        (block as Record<string, unknown>).type !== "image"
      ) {
        return block;
      }
      const localImage = localImages[imageIndex];
      imageIndex += 1;
      if (!(block as Record<string, unknown>).omitted || !localImage) {
        return block;
      }
      messageChanged = true;
      return localImage;
    });
    if (!messageChanged) {
      continue;
    }
    changed = true;
    merged[historyIndex] = { ...(message as Record<string, unknown>), content: nextContent };
  }

  return changed ? merged : historyMessages;
}
