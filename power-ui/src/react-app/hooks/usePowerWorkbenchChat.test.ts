import { describe, expect, it } from "vitest";
import { isApprovalCommandLeak, isInternalExecFollowupMessage } from "./usePowerWorkbenchChat";

describe("isApprovalCommandLeak", () => {
  it("hides Chinese approval command helper messages", () => {
    expect(
      isApprovalCommandLeak({
        role: "assistant",
        text: "请先批准：\n/approve 7ce081e5 allow-once\n这只是检查库是否可用，确认后我马上开始生成。",
      }),
    ).toBe(true);
  });

  it("keeps ordinary user messages that mention approval commands", () => {
    expect(
      isApprovalCommandLeak({
        role: "user",
        text: "/approve 7ce081e5 allow-once",
      }),
    ).toBe(false);
  });
});

describe("isInternalExecFollowupMessage", () => {
  it("hides async exec completion messages meant for the agent", () => {
    expect(
      isInternalExecFollowupMessage({
        role: "assistant",
        text: [
          "An async command the user already approved has completed.",
          "Do not run the command again.",
          "",
          "Exact completion details:",
          "Exec finished (gateway id=d25721b5, session=faint-shoal, code 1)",
        ].join("\n"),
      }),
    ).toBe(true);
  });

  it("keeps ordinary user messages with similar wording", () => {
    expect(
      isInternalExecFollowupMessage({
        role: "user",
        text: "An async command the user already approved has completed.",
      }),
    ).toBe(false);
  });
});
