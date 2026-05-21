import { describe, expect, it } from "vitest";
import { shouldHideChatMessage } from "./message-visibility.ts";

describe("shouldHideChatMessage", () => {
  it("hides raw tool error JSON in transcript", () => {
    const message = {
      role: "user",
      content: JSON.stringify({
        status: "error",
        tool: "session_status",
        error: "Cannot find module",
      }),
    };
    expect(shouldHideChatMessage(message)).toBe(true);
  });

  it("hides session date anchor lines", () => {
    expect(
      shouldHideChatMessage({
        role: "user",
        content: "2026-05-20 Wednesday 3",
      }),
    ).toBe(true);
  });

  it("hides web_fetch external boilerplate", () => {
    const message = {
      role: "user",
      content:
        '<<<EXTERNAL_UNTRUSTED_CONTENT id="abc">>>\nSECURITY NOTICE\nWeb fetch failed (403)\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="abc">>>',
    };
    expect(shouldHideChatMessage(message)).toBe(true);
  });

  it("keeps normal user messages", () => {
    expect(
      shouldHideChatMessage({
        role: "user",
        content: "你用的什么模型",
      }),
    ).toBe(false);
  });

  it("hides toolresult role when showToolCalls is false", () => {
    expect(
      shouldHideChatMessage(
        {
          role: "toolresult",
          content: [{ type: "text", text: "ok" }],
        },
        { showToolCalls: false },
      ),
    ).toBe(true);
  });

  it("keeps toolresult in history when showToolCalls option is omitted", () => {
    expect(
      shouldHideChatMessage({
        role: "toolresult",
        content: [{ type: "text", text: "ok" }],
      }),
    ).toBe(false);
  });
});
