import { describe, expect, it } from "vitest";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentFile,
  isSupportedChatAttachmentMimeType,
  resolveSupportedChatAttachmentMimeType,
} from "./attachment-support.js";

describe("chat image attachment support", () => {
  it.each(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"])(
    "accepts %s",
    (mimeType) => {
      expect(isSupportedChatAttachmentMimeType(mimeType)).toBe(true);
    },
  );

  it("does not accept arbitrary image MIME types that the gateway cannot normalize", () => {
    expect(isSupportedChatAttachmentMimeType("image/svg+xml")).toBe(false);
    expect(isSupportedChatAttachmentMimeType("image/tiff")).toBe(false);
  });

  it("infers a supported MIME type from an extension when the browser leaves type empty", () => {
    expect(resolveSupportedChatAttachmentMimeType({ name: "PHOTO.JPG", type: "" })).toBe(
      "image/jpeg",
    );
    expect(isSupportedChatAttachmentFile({ name: "photo.heic", type: "" })).toBe(true);
  });

  it("keeps the native picker accept list aligned", () => {
    expect(CHAT_ATTACHMENT_ACCEPT).toContain("image/png");
    expect(CHAT_ATTACHMENT_ACCEPT).toContain(".heic");
    expect(CHAT_ATTACHMENT_ACCEPT).not.toContain("image/*");
  });
});
