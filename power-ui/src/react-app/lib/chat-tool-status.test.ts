import { describe, expect, it } from "vitest";
import { dedupeCumulativeStreamSegments, streamTextAfterPrefix } from "./chat-stream-segments";
import {
  buildChatToolSteps,
  collapseDuplicateToolSteps,
  mergeStableChatToolSteps,
} from "./chat-tool-status";

describe("chat-tool-status", () => {
  it("labels exec steps from command text", () => {
    const steps = buildChatToolSteps([
      {
        role: "assistant",
        content: [
          {
            type: "toolcall",
            name: "exec",
            arguments: { command: "python3 gen_sun_wukong_pdf.py" },
          },
        ],
      },
    ]);
    expect(steps[0]?.label).toBe("运行 gen_sun_wukong_pdf.py");
  });

  it("shortens cd exec steps without exposing full paths", () => {
    const steps = buildChatToolSteps([
      {
        role: "assistant",
        toolCallId: "call-1",
        content: [
          {
            type: "toolcall",
            name: "exec",
            arguments: { command: "cd /Users/me/.openclaw/workspace-dev/hello" },
          },
        ],
      },
    ]);
    expect(steps[0]?.label).toBe("切换工作目录");
    expect(steps[0]?.detail).toBe("");
  });

  it("keeps step labels stable across refreshes", () => {
    const first = buildChatToolSteps([
      {
        role: "assistant",
        toolCallId: "call-2",
        content: [{ type: "toolcall", name: "exec", arguments: { command: "python3 gen.py" } }],
      },
    ]);
    const second = buildChatToolSteps([
      {
        role: "assistant",
        toolCallId: "call-2",
        content: [
          { type: "toolcall", name: "exec", arguments: { command: "python3 gen.py" } },
          { type: "toolresult", name: "exec", text: "long tool output that should not appear" },
        ],
      },
    ]);
    const merged = mergeStableChatToolSteps(first, second);
    expect(merged[0]?.label).toBe(first[0]?.label);
    expect(merged[0]?.complete).toBe(true);
    expect(merged[0]?.detail).toBe("");
  });

  it("collapses consecutive duplicate step titles", () => {
    const merged = collapseDuplicateToolSteps([
      { key: "a", label: "运行命令", detail: "", complete: true },
      { key: "b", label: "运行命令", detail: "", complete: true },
      { key: "c", label: "写入文件", detail: "", complete: false },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.label).toBe("运行命令（×2）");
    expect(merged[1]?.label).toBe("写入文件");
  });
});

describe("chat-stream-segments", () => {
  it("drops cumulative prefix segments", () => {
    const kept = dedupeCumulativeStreamSegments([
      { ts: 1, text: "先做对比" },
      { ts: 2, text: "先做对比，再找库" },
      { ts: 3, text: "先做对比，再找库，再写脚本" },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.text).toContain("写脚本");
  });

  it("returns only new stream suffix after prefix", () => {
    expect(streamTextAfterPrefix("abc 新内容", "abc")).toBe("新内容");
  });
});
