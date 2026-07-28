import { describe, expect, it } from "vitest";
import {
  extractChatMessageImages,
  mergeChatMessageImagePreviews,
  replaceChatMessageDisplayText,
} from "./chat-message-images";

describe("extractChatMessageImages", () => {
  it("builds a data URL from canonical OpenClaw image blocks", () => {
    expect(
      extractChatMessageImages({
        content: [{ type: "image", data: "QUJD", mimeType: "image/jpeg" }],
      }),
    ).toEqual([{ url: "data:image/jpeg;base64,QUJD", alt: undefined }]);
  });

  it("builds a data URL from persisted base64 image blocks", () => {
    expect(
      extractChatMessageImages({
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
          },
        ],
      }),
    ).toEqual([{ url: "data:image/jpeg;base64,QUJD", alt: undefined }]);
  });

  it("keeps local preview data URLs and OpenAI image URLs", () => {
    expect(
      extractChatMessageImages({
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "data:image/png;base64,QQ==",
            },
          },
          { type: "image_url", image_url: { url: "https://example.test/image.png" } },
        ],
      }).map((image) => image.url),
    ).toEqual(["data:image/png;base64,QQ==", "https://example.test/image.png"]);
  });

  it("keeps an explicit placeholder for images omitted from chat history", () => {
    expect(
      extractChatMessageImages({
        content: [{ type: "image", omitted: true, bytes: 169_096 }],
      }),
    ).toEqual([{ omitted: true, bytes: 169_096, alt: undefined }]);
  });
});

describe("replaceChatMessageDisplayText", () => {
  it("preserves image blocks while replacing local user-facing text", () => {
    const imageBlock = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "data:image/png;base64,QQ==" },
    };
    const result = replaceChatMessageDisplayText(
      { role: "user", content: [{ type: "text", text: "raw" }, imageBlock] },
      "已上传图片",
    );
    expect(result.content).toEqual([{ type: "text", text: "已上传图片" }, imageBlock]);
  });
});

describe("mergeChatMessageImagePreviews", () => {
  it("restores a local preview after Gateway history omits its base64 data", () => {
    const localImage = {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "data:image/jpeg;base64,QUJD" },
    };
    const history = [
      {
        role: "user",
        content: [
          { type: "text", text: "识别图片" },
          { type: "image", mimeType: "image/jpeg", omitted: true, bytes: 4 },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "图片中的文字" }] },
    ];

    expect(
      mergeChatMessageImagePreviews(history, [
        {
          role: "user",
          content: [{ type: "text", text: "识别图片" }, localImage],
        },
      ]),
    ).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "识别图片" }, localImage],
      },
      { role: "assistant", content: [{ type: "text", text: "图片中的文字" }] },
    ]);
  });
});
