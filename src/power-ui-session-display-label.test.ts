import { describe, expect, it } from "vitest";
import {
  resolveSessionDisplayLabel,
  UNTITLED_SESSION_DISPLAY_LABEL,
} from "../power-ui/src/react-app/lib/session-display-label.js";

describe("Power UI session display label", () => {
  const sessionKey =
    "agent:agent-4d8ce6081727:user:u-xixi:power:df95e8c3-a0e9-41f3-9671-6fbfa18f488a";

  it("uses a stable placeholder while the session label is unavailable", () => {
    expect(resolveSessionDisplayLabel(undefined, sessionKey)).toBe(UNTITLED_SESSION_DISPLAY_LABEL);
  });

  it("does not expose a session key stored as the label", () => {
    expect(resolveSessionDisplayLabel(sessionKey, sessionKey)).toBe(UNTITLED_SESSION_DISPLAY_LABEL);
  });

  it("shows the generated conversation label when available", () => {
    expect(resolveSessionDisplayLabel("分析智能体响应性能", sessionKey)).toBe("分析智能体响应性能");
  });
});
