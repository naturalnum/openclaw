import { describe, expect, it } from "vitest";
import {
  filterUserVisibleWorkspaceEntries,
  isOpenClawDefaultWorkspaceEntry,
} from "./workspace-default-entries";

describe("workspace-default-entries", () => {
  it("hides bootstrap markdown files", () => {
    expect(isOpenClawDefaultWorkspaceEntry({ name: "IDENTITY.md", kind: "file" })).toBe(true);
    expect(isOpenClawDefaultWorkspaceEntry({ name: "agents.md", kind: "file" })).toBe(true);
  });

  it("keeps user-generated artifacts", () => {
    expect(isOpenClawDefaultWorkspaceEntry({ name: "sun_wukong_report.pdf", kind: "file" })).toBe(
      false,
    );
    expect(isOpenClawDefaultWorkspaceEntry({ name: "gen_pdf.py", kind: "file" })).toBe(false);
  });

  it("keeps user artifacts when the absolute workspace path is under .openclaw", () => {
    expect(
      isOpenClawDefaultWorkspaceEntry({
        name: "接口文档_整理.md",
        path: "/Users/test/.openclaw/workspace/test/接口文档_整理.md",
        kind: "file",
      }),
    ).toBe(false);
  });

  it("hides .openclaw state directory", () => {
    expect(isOpenClawDefaultWorkspaceEntry({ name: ".openclaw", kind: "directory" })).toBe(true);
  });

  it("hides chat upload attachment directory", () => {
    expect(isOpenClawDefaultWorkspaceEntry({ name: ".chat-uploads", kind: "directory" })).toBe(
      true,
    );
  });

  it("hides files nested under chat upload attachment directory", () => {
    expect(
      isOpenClawDefaultWorkspaceEntry({
        name: "interface.txt",
        path: ".chat-uploads/agent-main-quick-1/interface.txt",
        kind: "file",
      }),
    ).toBe(true);
  });

  it("filters a mixed listing", () => {
    const visible = filterUserVisibleWorkspaceEntries([
      { name: "IDENTITY.md", kind: "file" },
      { name: "report.pdf", kind: "file" },
      { name: ".openclaw", kind: "directory" },
      { name: ".chat-uploads", kind: "directory" },
      { name: "interface.txt", path: ".chat-uploads/session/interface.txt", kind: "file" },
    ]);
    expect(visible).toEqual([{ name: "report.pdf", kind: "file" }]);
  });
});
