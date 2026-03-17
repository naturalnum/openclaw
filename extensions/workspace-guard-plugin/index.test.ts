import { describe, expect, it } from "vitest";
import {
  isProtectedWorkspacePath,
  shellCommandDeletesWorkspaceRoot,
  shellCommandMutatesProtectedPath,
} from "./index.ts";

describe("workspace-guard-plugin", () => {
  it("keeps protected plugin and skill directories read-only", () => {
    expect(isProtectedWorkspacePath("skills/foo.txt")).toBe(true);
    expect(isProtectedWorkspacePath(".agents/skills/foo.txt")).toBe(true);
    expect(isProtectedWorkspacePath(".openclaw/extensions/foo")).toBe(true);
    expect(isProtectedWorkspacePath("/workspace/skills/foo.txt")).toBe(true);
    expect(isProtectedWorkspacePath("/workspace/.agents/skills/foo.txt")).toBe(true);
    expect(isProtectedWorkspacePath("/workspace/.openclaw/extensions/foo")).toBe(true);
  });

  it("blocks mutating shell commands against protected directories", () => {
    expect(shellCommandMutatesProtectedPath("rm -rf /workspace/skills")).toBe(true);
    expect(shellCommandMutatesProtectedPath("touch .agents/skills/new-skill")).toBe(true);
    expect(shellCommandMutatesProtectedPath("mkdir -p /workspace/.openclaw/extensions/demo")).toBe(
      true,
    );
    expect(shellCommandMutatesProtectedPath("rm -rf /workspace/tmp")).toBe(false);
  });

  it("blocks deleting the workspace root itself", () => {
    expect(shellCommandDeletesWorkspaceRoot("rm -rf /workspace")).toBe(true);
    expect(shellCommandDeletesWorkspaceRoot("rm -rf /workspace/")).toBe(true);
    expect(shellCommandDeletesWorkspaceRoot("rm -rf workspace")).toBe(true);
    expect(shellCommandDeletesWorkspaceRoot("rm -rf /workspace/project")).toBe(false);
    expect(shellCommandDeletesWorkspaceRoot("mv /workspace /tmp/workspace-backup")).toBe(false);
  });
});
