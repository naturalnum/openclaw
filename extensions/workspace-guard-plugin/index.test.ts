import { describe, expect, it } from "vitest";
import {
  isWorkspaceProtectedPath,
  patchTouchesReadonlyPath,
  resolveShellMutationReason,
  resolveToolPathReason,
  resolveWorkspaceDir,
} from "./index.ts";

describe("workspace-guard-plugin", () => {
  const workspaceDir = "/tmp/workspace";

  it("blocks writes outside workspace", () => {
    expect(resolveToolPathReason({ workspaceDir, targetPath: "/etc/passwd" })).toContain(
      "outside workspace",
    );
    expect(resolveToolPathReason({ workspaceDir, targetPath: "../outside.txt" })).toContain(
      "outside workspace",
    );
    expect(resolveToolPathReason({ workspaceDir, targetPath: "notes/todo.txt" })).toBeNull();
  });

  it("keeps workspace skills and extensions read-only", () => {
    expect(isWorkspaceProtectedPath(workspaceDir, "skills/demo")).toBe(true);
    expect(isWorkspaceProtectedPath(workspaceDir, "extensions/demo")).toBe(true);
    expect(isWorkspaceProtectedPath(workspaceDir, ".agents/skills/demo")).toBe(true);
    expect(isWorkspaceProtectedPath(workspaceDir, ".openclaw/extensions/demo")).toBe(true);
    expect(resolveToolPathReason({ workspaceDir, targetPath: "skills/demo/file.txt" })).toContain(
      "protected workspace path",
    );
    expect(
      resolveToolPathReason({ workspaceDir, targetPath: "extensions/demo/index.ts" }),
    ).toContain("protected workspace path");
  });

  it("blocks mutating shell commands outside workspace or in protected dirs", () => {
    expect(resolveShellMutationReason({ workspaceDir, command: "rm -rf /etc" })).toContain(
      "outside workspace",
    );
    expect(
      resolveShellMutationReason({ workspaceDir, command: "rm -rf /tmp/workspace/skills/demo" }),
    ).toContain("protected workspace path");
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: 'echo "hello" > "/tmp/outside.txt"',
      }),
    ).toContain("outside workspace");
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: 'echo "hello" > "extensions/demo/index.ts"',
      }),
    ).toContain("protected workspace path");
    expect(resolveShellMutationReason({ workspaceDir, command: "touch ./docs/readme.md" })).toBe(
      null,
    );
    expect(
      resolveShellMutationReason({ workspaceDir, command: "cd /tmp && touch local.txt" }),
    ).toContain("outside workspace");
    expect(
      resolveShellMutationReason({ workspaceDir, command: "rm -rf ./* && rm -rf .[!.]*" }),
    ).toContain("workspace contents");
    expect(resolveShellMutationReason({ workspaceDir, command: "rm -rf *" })).toContain(
      "workspace contents",
    );
    expect(resolveShellMutationReason({ workspaceDir, command: "find . -delete" })).toContain(
      "workspace contents",
    );
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: "shopt -s dotglob && rm -rf *",
      }),
    ).toContain("workspace contents");
    expect(resolveShellMutationReason({ workspaceDir, command: "git clean -fdx" })).toContain(
      "workspace contents",
    );
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: "rsync -a --delete empty/ ./",
      }),
    ).toContain("workspace contents");
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: "find . -mindepth 1 -exec rm -rf {} +",
      }),
    ).toContain("workspace contents");
  });

  it("blocks apply_patch touching readonly paths", () => {
    expect(patchTouchesReadonlyPath("*** Update File: /etc/passwd\n", workspaceDir)).toContain(
      "outside workspace",
    );
    expect(
      patchTouchesReadonlyPath("*** Add File: skills/demo/SKILL.md\n", workspaceDir),
    ).toContain("protected workspace path");
    expect(patchTouchesReadonlyPath("*** Update File: src/app.ts\n", workspaceDir)).toBeNull();
  });

  it("falls back to configured workspace when ctx.workspaceDir is empty", () => {
    const api = {
      config: {
        agents: {
          defaults: {
            workspace: "/tmp/default-workspace",
          },
          list: [
            {
              id: "dev",
              workspace: "/tmp/agent-workspace",
            },
          ],
        },
      },
    } as const;

    expect(resolveWorkspaceDir(api as never, { workspaceDir: "", agentId: "dev" })).toBe(
      "/tmp/agent-workspace",
    );
    expect(resolveWorkspaceDir(api as never, { workspaceDir: "" })).toBe("/tmp/default-workspace");
  });
});
