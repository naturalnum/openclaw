import { describe, expect, it } from "vitest";
import {
  isAgentInLocalUserScope,
  isProjectInLocalUserScope,
  resolveLocalUserDefaultAgentId,
} from "./local-user-scope";

describe("isAgentInLocalUserScope", () => {
  it("keeps the default agent available to its owner", () => {
    expect(isAgentInLocalUserScope("/opt/agent/data/users/admin/default", "u-admin")).toBe(true);
  });

  it("keeps projects available to their owner", () => {
    expect(isAgentInLocalUserScope("/opt/agent/data/users/admin/projects/demo", "u-admin")).toBe(
      true,
    );
  });
});

describe("isProjectInLocalUserScope", () => {
  it("does not expose the default agent as a project", () => {
    expect(isProjectInLocalUserScope("/opt/agent/data/users/admin/default", "u-admin")).toBe(false);
  });

  it("does not expose another user's default workspace", () => {
    expect(isProjectInLocalUserScope("/opt/agent/data/users/admin/default", "u-member")).toBe(
      false,
    );
  });

  it("uses the project workspace instead of an agent id prefix", () => {
    expect(
      isProjectInLocalUserScope("/opt/agent/data/users/member/projects/demo", "u-member"),
    ).toBe(true);
    expect(isProjectInLocalUserScope("/opt/agent/data/users/other/projects/demo", "u-member")).toBe(
      false,
    );
  });
});

describe("resolveLocalUserDefaultAgentId", () => {
  it("selects the user's default workspace agent instead of a stale project", () => {
    expect(
      resolveLocalUserDefaultAgentId(
        [
          { id: "u-admin-test", workspace: "/opt/agent/data/users/admin/projects/test" },
          { id: "agent-default", workspace: "/opt/agent/data/users/admin/default" },
        ],
        "u-admin",
      ),
    ).toBe("agent-default");
  });

  it("does not fall back to an unrelated agent for a scoped user", () => {
    expect(
      resolveLocalUserDefaultAgentId(
        [{ id: "main", workspace: "/opt/agent/data/users/other/default" }],
        "u-admin",
      ),
    ).toBeNull();
  });
});
