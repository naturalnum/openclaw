import { describe, expect, it } from "vitest";
import {
  buildLocalUserScope,
  isProjectInLocalUserScope,
  isSessionInLocalUserScope,
} from "../power-ui/src/integrations/openclaw/local-user-scope.js";
import {
  buildPowerQuickSessionKey,
  buildPowerSessionKey,
} from "../power-ui/src/integrations/openclaw/session-keys.js";
import {
  resolveProjectWorkspacePath,
  resolveTemporaryChatWorkspacePath,
} from "../power-ui/src/react-app/lib/global-model-config.js";

describe("Power UI local user scope", () => {
  it("keeps projects and sessions isolated by local user scope", () => {
    const adminScope = buildLocalUserScope({ id: "admin" });
    const xixiScope = buildLocalUserScope({ id: "xixi" });

    expect(adminScope).toBe("u-admin");
    expect(xixiScope).toBe("u-xixi");
    expect(isProjectInLocalUserScope("/data/users/admin/projects/漫剧", adminScope)).toBe(true);
    expect(isProjectInLocalUserScope("/data/users/xixi/projects/漫剧", adminScope)).toBe(false);
    expect(isProjectInLocalUserScope("/data/users/admin/projects/漫剧", xixiScope)).toBe(false);

    const adminProjectSession = buildPowerSessionKey("u-admin-62c345fdbca4", adminScope);
    const adminQuickSession = buildPowerQuickSessionKey("main", adminScope);
    const xixiQuickSession = buildPowerQuickSessionKey("main", xixiScope);

    expect(isSessionInLocalUserScope(adminProjectSession, adminScope)).toBe(true);
    expect(isSessionInLocalUserScope(adminQuickSession, adminScope)).toBe(true);
    expect(isSessionInLocalUserScope(xixiQuickSession, adminScope)).toBe(false);
    expect(isSessionInLocalUserScope(adminQuickSession, xixiScope)).toBe(false);
    expect(isSessionInLocalUserScope("agent:main:quick:legacy", adminScope)).toBe(false);
  });

  it("places temporary chat workspaces under the local user temp folder", () => {
    const sessionKey = "agent:main:user:u-admin:quick:abc/def";
    expect(
      resolveTemporaryChatWorkspacePath(
        {
          agents: {
            defaults: {
              workspace: "/tmp/openclaw-workspace",
            },
          },
        },
        "admin",
        sessionKey,
      ),
    ).toBe(
      "/tmp/openclaw-workspace/users/admin/default/temp/agent-main-user-u-admin-quick-abc-def",
    );
  });

  it("places project workspaces under the owning local user projects folder", () => {
    expect(
      resolveProjectWorkspacePath(
        {
          agents: {
            defaults: {
              workspace: "/tmp/openclaw-workspace",
            },
          },
        },
        "漫剧",
        [],
        { userFolder: "xixi" },
      ),
    ).toBe("/tmp/openclaw-workspace/users/xixi/projects/漫剧");

    expect(
      resolveProjectWorkspacePath(
        {
          agents: {
            defaults: {
              workspace: "/tmp/openclaw-workspace",
            },
          },
        },
        "漫剧",
        ["/tmp/openclaw-workspace/users/xixi/projects/漫剧"],
        { userFolder: "xixi" },
      ),
    ).toBe("/tmp/openclaw-workspace/users/xixi/projects/漫剧-2");
  });

  it("derives the shared data root from a user-scoped default workspace", () => {
    const config = {
      agents: {
        defaults: {
          workspace: "/home/box/agent/data/users/owner/default",
        },
      },
    };
    expect(resolveProjectWorkspacePath(config, "报告", [], { userFolder: "alice" })).toBe(
      "/home/box/agent/data/users/alice/projects/报告",
    );
    expect(resolveTemporaryChatWorkspacePath(config, "alice", "agent:main:quick:1")).toBe(
      "/home/box/agent/data/users/alice/default/temp/agent-main-quick-1",
    );
  });
});
