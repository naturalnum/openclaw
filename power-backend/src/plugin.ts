import type { GatewayRequestHandlerOptions, OpenClawPluginApi } from "openclaw/plugin-sdk";
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

  api.logger.info(
    `[power-backend] registered power.fs methods with ${fsService.listRoots().roots.length} allowed roots`,
  );
}
