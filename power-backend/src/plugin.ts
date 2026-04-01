import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveAgentWorkspaceDir } from "../../src/agents/agent-scope.js";
import { loadConfig } from "../../src/config/config.js";
import { PowerFsService } from "./fs-service.js";

type PowerBackendPluginConfig = {
  roots: string[];
};

function parsePluginConfig(api: OpenClawPluginApi): PowerBackendPluginConfig {
  const raw = api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {};

  const roots = Array.isArray(raw.roots)
    ? raw.roots
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => api.resolvePath(entry))
    : [];

  return { roots };
}

function sendError(respond: GatewayRequestHandlerOptions["respond"], error: unknown) {
  respond(false, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function resolveWorkspaceForAgent(agentIdRaw: unknown) {
  const agentId = typeof agentIdRaw === "string" ? agentIdRaw.trim() : "";
  if (!agentId) {
    throw new Error("agentId required");
  }
  const cfg = loadConfig();
  const workspace = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspace?.trim()) {
    throw new Error(`No workspace configured for agent: ${agentId}`);
  }
  return {
    agentId,
    workspace,
  };
}

export default function register(api: OpenClawPluginApi) {
  const config = parsePluginConfig(api);
  const fsService = new PowerFsService(config);

  api.registerGatewayMethod("power.fs.roots", async ({ respond }: GatewayRequestHandlerOptions) => {
    try {
      respond(true, fsService.listRoots());
    } catch (error) {
      sendError(respond, error);
    }
  });

  api.registerGatewayMethod(
    "power.fs.listDirs",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        respond(true, fsService.listDirs(requestedPath || null));
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.validateWorkspace",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!requestedPath) {
          respond(false, { error: "path required" });
          return;
        }
        respond(true, fsService.validateWorkspace(requestedPath));
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createDir",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        const name = typeof params?.name === "string" ? params.name.trim() : "";
        if (!requestedPath) {
          respond(false, { error: "path required" });
          return;
        }
        if (!name) {
          respond(false, { error: "name required" });
          return;
        }
        respond(true, {
          ok: true,
          entry: fsService.createDirectory(requestedPath, name),
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.listWorkspace",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const requestedPath = typeof params?.path === "string" ? params.path.trim() : "";
        respond(true, {
          agentId,
          workspace,
          ...fsService.listWorkspaceEntries(workspace, requestedPath || null),
        });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.createFolder",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const currentPath = typeof params?.path === "string" ? params.path.trim() : "";
        const name = typeof params?.name === "string" ? params.name.trim() : "";
        if (!name) {
          respond(false, { error: "name required" });
          return;
        }
        const entry = fsService.createWorkspaceDirectory(workspace, currentPath || null, name);
        respond(true, { ok: true, agentId, workspace, entry });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.uploadFiles",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const currentPath = typeof params?.path === "string" ? params.path.trim() : "";
        const files = Array.isArray(params?.files) ? params.files : [];
        if (files.length === 0) {
          respond(false, { error: "files required" });
          return;
        }
        const entries = files.map((file) => {
          const name = typeof file?.name === "string" ? file.name.trim() : "";
          const contentBase64 =
            typeof file?.contentBase64 === "string" ? file.contentBase64.trim() : "";
          if (!name || !contentBase64) {
            throw new Error("Each upload file requires name and contentBase64.");
          }
          return fsService.writeWorkspaceFile(workspace, currentPath || null, name, contentBase64);
        });
        respond(true, { ok: true, agentId, workspace, entries });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.downloadFile",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const filePath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!filePath) {
          respond(false, { error: "path required" });
          return;
        }
        const file = fsService.readWorkspaceFile(workspace, filePath);
        respond(true, { agentId, workspace, file });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.registerGatewayMethod(
    "power.fs.deleteEntry",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        const { agentId, workspace } = resolveWorkspaceForAgent(params?.agentId);
        const targetPath = typeof params?.path === "string" ? params.path.trim() : "";
        if (!targetPath) {
          respond(false, { error: "path required" });
          return;
        }
        const result = fsService.deleteWorkspaceEntry(workspace, targetPath);
        respond(true, { agentId, workspace, ...result });
      } catch (error) {
        sendError(respond, error);
      }
    },
  );

  api.logger.info(
    `[power-backend] registered power.fs methods with ${fsService.listRoots().roots.length} allowed roots`,
  );
}
