import { describe, expect, it } from "vitest";
import {
  isWorkspaceProtectedPath,
  patchTouchesReadonlyPath,
  resolveReadonlyPaths,
  resolveShellMutationReason,
  resolveToolPathReason,
  resolveWorkspaceDir,
  workspaceGuardConfigSchema,
} from "./index.ts";

describe("workspace-guard-plugin", () => {
  const workspaceDir = "/tmp/workspace";

  it("accepts readonlyPaths plugin config", () => {
    expect(workspaceGuardConfigSchema.validate(undefined)).toEqual({ ok: true, value: undefined });
    expect(
      workspaceGuardConfigSchema.validate({
        readonlyPaths: ["skills", "/opt/shared/extensions"],
      }),
    ).toEqual({
      ok: true,
      value: {
        readonlyPaths: ["skills", "/opt/shared/extensions"],
      },
    });
  });

  it("resolves configured readonly paths relative to the workspace and as absolute paths", () => {
    expect(
      resolveReadonlyPaths(workspaceDir, {
        readonlyPaths: ["skills", "/opt/shared/extensions"],
      }),
    ).toEqual(["/tmp/workspace/skills", "/opt/shared/extensions"]);
  });

  it("blocks writes outside workspace and to the workspace root", () => {
    expect(resolveToolPathReason({ workspaceDir, targetPath: "/tmp/workspace" })).toContain(
      "workspace root",
    );
    expect(resolveToolPathReason({ workspaceDir, targetPath: "/etc/passwd" })).toContain(
      "outside workspace",
    );
    expect(resolveToolPathReason({ workspaceDir, targetPath: "../outside.txt" })).toContain(
      "outside workspace",
    );
    expect(resolveToolPathReason({ workspaceDir, targetPath: "notes/todo.txt" })).toBeNull();
  });

  it("keeps configured relative and absolute paths read-only", () => {
    const config = {
      readonlyPaths: ["skills", "/opt/shared/extensions"],
    };
    expect(isWorkspaceProtectedPath(workspaceDir, "skills/demo", config)).toBe(true);
    expect(isWorkspaceProtectedPath(workspaceDir, "/opt/shared/extensions/demo", config)).toBe(
      true,
    );
    expect(
      resolveToolPathReason({ workspaceDir, targetPath: "skills/demo/file.txt", config }),
    ).toContain("protected workspace path");
    expect(
      resolveToolPathReason({
        workspaceDir,
        targetPath: "/opt/shared/extensions/demo/index.ts",
        config,
      }),
    ).toContain("protected workspace path");
  });

  it("blocks mutating shell commands outside workspace, at the workspace root, or in protected dirs", () => {
    const config = {
      readonlyPaths: ["extensions", "/opt/shared/extensions"],
    };
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: "rm -rf /tmp/workspace",
        config,
      }),
    ).toContain("workspace root");
    expect(resolveShellMutationReason({ workspaceDir, command: "rm -rf /etc", config })).toContain(
      "outside workspace",
    );
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: "rm -rf /tmp/workspace/extensions/demo",
        config,
      }),
    ).toContain("protected workspace path");
    expect(
      resolveShellMutationReason({
        workspaceDir,
        command: "rm -rf /opt/shared/extensions/demo",
        config,
      }),
    ).toContain("protected workspace path");
    expect(
      resolveShellMutationReason({ workspaceDir, command: "touch ./docs/readme.md", config }),
    ).toBe(null);
  });

  it("blocks apply_patch touching configured readonly paths", () => {
    const config = {
      readonlyPaths: ["skills", "/opt/shared/extensions"],
    };
    expect(
      patchTouchesReadonlyPath("*** Update File: /etc/passwd\n", workspaceDir, config),
    ).toContain("outside workspace");
    expect(
      patchTouchesReadonlyPath("*** Add File: skills/demo/SKILL.md\n", workspaceDir, config),
    ).toContain("protected workspace path");
    expect(
      patchTouchesReadonlyPath(
        "*** Add File: /opt/shared/extensions/demo/index.ts\n",
        workspaceDir,
        config,
      ),
    ).toContain("protected workspace path");
    expect(patchTouchesReadonlyPath("*** Update File: src/app.ts\n", workspaceDir, config)).toBe(
      null,
    );
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
