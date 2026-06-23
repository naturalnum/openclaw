import { describe, expect, it } from "vitest";
import {
  buildLocalUserScope,
  isProjectInLocalUserScope,
  isSessionInLocalUserScope,
  stripScopedProjectName,
} from "../power-ui/src/integrations/openclaw/local-user-scope.js";
import {
  buildPowerQuickSessionKey,
  buildPowerSessionKey,
} from "../power-ui/src/integrations/openclaw/session-keys.js";
import { resolveTemporaryChatWorkspacePath } from "../power-ui/src/react-app/lib/global-model-config.js";

describe("Power UI local user scope", () => {
  it("keeps projects and sessions isolated by local user scope", () => {
    const adminScope = buildLocalUserScope({ id: "admin" });
    const xixiScope = buildLocalUserScope({ id: "xixi" });

    expect(adminScope).toBe("u-admin");
    expect(xixiScope).toBe("u-xixi");
    expect(isProjectInLocalUserScope("u-admin-62c345fdbca4", adminScope)).toBe(true);
    expect(isProjectInLocalUserScope("u-xixi-27cec1455786", adminScope)).toBe(false);
    expect(isProjectInLocalUserScope("u-admin-62c345fdbca4", xixiScope)).toBe(false);
    expect(stripScopedProjectName("u-admin-漫剧", adminScope)).toBe("漫剧");

    const adminProjectSession = buildPowerSessionKey("u-admin-62c345fdbca4", adminScope);
    const adminQuickSession = buildPowerQuickSessionKey("main", adminScope);
    const xixiQuickSession = buildPowerQuickSessionKey("main", xixiScope);

    expect(isSessionInLocalUserScope(adminProjectSession, adminScope)).toBe(true);
    expect(isSessionInLocalUserScope(adminQuickSession, adminScope)).toBe(true);
    expect(isSessionInLocalUserScope(xixiQuickSession, adminScope)).toBe(false);
    expect(isSessionInLocalUserScope(adminQuickSession, xixiScope)).toBe(false);
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
});
