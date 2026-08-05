import { describe, expect, it } from "vitest";
import { hasEnabledEmbeddedPiMcpServers, loadEmbeddedPiMcpConfig } from "./embedded-pi-mcp.js";

describe("embedded Pi MCP config", () => {
  it("has no runtime MCP servers when none are configured", () => {
    expect(
      hasEnabledEmbeddedPiMcpServers({
        workspaceDir: "/tmp/openclaw-no-mcp",
        cfg: {},
      }),
    ).toBe(false);
  });

  it("omits disabled MCP servers from the runtime snapshot", () => {
    const loaded = loadEmbeddedPiMcpConfig({
      workspaceDir: "/tmp/openclaw-disabled-mcp",
      cfg: {
        mcp: {
          servers: {
            disabledByEnabledFlag: {
              command: "node",
              enabled: false,
            },
            disabledByDisabledFlag: {
              command: "node",
              disabled: true,
            },
          },
        },
      },
    });

    expect(loaded.mcpServers).toEqual({});
    expect(
      hasEnabledEmbeddedPiMcpServers({
        workspaceDir: "/tmp/openclaw-disabled-mcp",
        cfg: {
          mcp: {
            servers: {
              disabled: {
                command: "node",
                enabled: false,
              },
            },
          },
        },
      }),
    ).toBe(false);
  });

  it("keeps enabled MCP servers in the runtime snapshot", () => {
    const loaded = loadEmbeddedPiMcpConfig({
      workspaceDir: "/tmp/openclaw-enabled-mcp",
      cfg: {
        mcp: {
          servers: {
            enabled: {
              command: "node",
              args: ["server.mjs"],
            },
          },
        },
      },
    });

    expect(loaded.mcpServers).toEqual({
      enabled: {
        command: "node",
        args: ["server.mjs"],
      },
    });
  });
});
