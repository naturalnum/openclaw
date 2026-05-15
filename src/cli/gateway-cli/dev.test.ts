import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDevWorkspaceDir } from "./dev.js";

describe("resolveDevWorkspaceDir", () => {
  it("uses ~/.openclaw/workspace even when OPENCLAW_PROFILE=dev", () => {
    const home = "/home/test";
    const dir = resolveDevWorkspaceDir({
      HOME: home,
      OPENCLAW_PROFILE: "dev",
    });
    expect(dir).toBe(path.join(home, ".openclaw", "workspace"));
  });

  it("does not append a -dev suffix under the default profile", () => {
    const home = os.homedir();
    const dir = resolveDevWorkspaceDir({ HOME: home });
    expect(dir).toBe(path.join(home, ".openclaw", "workspace"));
    expect(dir.endsWith(`${path.sep}workspace-dev`)).toBe(false);
  });
});
