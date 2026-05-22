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

  it("hides .openclaw state directory", () => {
    expect(isOpenClawDefaultWorkspaceEntry({ name: ".openclaw", kind: "directory" })).toBe(true);
  });

  it("filters a mixed listing", () => {
    const visible = filterUserVisibleWorkspaceEntries([
      { name: "IDENTITY.md", kind: "file" },
      { name: "report.pdf", kind: "file" },
      { name: ".openclaw", kind: "directory" },
    ]);
    expect(visible).toEqual([{ name: "report.pdf", kind: "file" }]);
  });
});
