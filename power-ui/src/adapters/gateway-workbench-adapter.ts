import { parseAgentSessionKey } from "../../../src/routing/session-key.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
  SessionsListResult,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../../../ui/src/ui/types.ts";
import { PowerGatewayClient } from "../integrations/openclaw/gateway-client.ts";
import {
  buildPowerSessionKey,
  buildSessionLabelFromPrompt,
} from "../integrations/openclaw/session-keys.ts";
import type { WorkbenchSnapshot } from "./mock-workbench-adapter.ts";
import type {
  WorkbenchDirectoryCreateResult,
  WorkbenchAdapter,
  WorkbenchAdapterEvent,
  WorkbenchDirectoryListResult,
  WorkbenchDirectoryRootsResult,
  WorkbenchFileDownloadResult,
  WorkbenchFileEntry,
  WorkbenchFileListResult,
  WorkbenchSelection,
  WorkbenchSendResult,
  WorkbenchSkillMessage,
  WorkbenchUploadedFile,
  WorkbenchWorkspaceValidationResult,
} from "./workbench-adapter.ts";

type GatewayAdapterOptions = {
  getSettings: () => { gatewayUrl: string; token: string };
};

type ModelsListResult = {
  models?: ModelCatalogEntry[];
};

const EMPTY_SKILLS_REPORT: SkillStatusReport = {
  workspaceDir: "",
  managedSkillsDir: "",
  skills: [],
};

const OPTIONAL_REQUEST_TIMEOUT_MS = 2500;

function buildIdentityMap(
  agentsList: AgentsListResult | null,
): Record<string, AgentIdentityResult> {
  const result: Record<string, AgentIdentityResult> = {};
  for (const agent of agentsList?.agents ?? []) {
    result[agent.id] = {
      agentId: agent.id,
      name: agent.identity?.name?.trim() || agent.name?.trim() || agent.id,
      avatar: agent.identity?.avatarUrl?.trim() || agent.identity?.avatar?.trim() || "",
      emoji: agent.identity?.emoji?.trim() || undefined,
    };
  }
  return result;
}

function isKnownProjectId(projectId: string | null, agentsList: AgentsListResult | null) {
  if (!projectId) {
    return false;
  }
  return (agentsList?.agents ?? []).some((agent) => agent.id === projectId);
}

function resolveProjectId(projectId: string | null, agentsList: AgentsListResult | null) {
  if (isKnownProjectId(projectId, agentsList)) {
    return projectId;
  }
  const defaultId = agentsList?.defaultId ?? null;
  if (isKnownProjectId(defaultId, agentsList)) {
    return defaultId;
  }
  return agentsList?.agents[0]?.id ?? null;
}

function resolveSelection(
  args: WorkbenchSelection,
  agentsList: AgentsListResult | null,
  sessionsResult: SessionsListResult | null,
) {
  const rawSessionKey = args.sessionKey?.trim() ?? "";
  const sessionKey = (sessionsResult?.sessions ?? []).some((row) => row.key === rawSessionKey)
    ? rawSessionKey
    : "";
  const sessionProjectId = sessionKey ? (parseAgentSessionKey(sessionKey)?.agentId ?? null) : null;
  return {
    projectId: resolveProjectId(args.projectId ?? sessionProjectId ?? null, agentsList),
    sessionKey,
  };
}

async function safeRequest<T>(
  request: Promise<T>,
  fallback: T,
  timeoutMs = OPTIONAL_REQUEST_TIMEOUT_MS,
): Promise<T> {
  try {
    return await Promise.race<T>([
      request,
      new Promise<T>((resolve) => {
        window.setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  }
}

async function requiredRequest<T>(request: Promise<T>, label: string): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`, { cause: error });
  }
}

export class GatewayWorkbenchAdapter implements WorkbenchAdapter {
  readonly kind = "gateway" as const;
  private readonly gateway: PowerGatewayClient;
  private listeners = new Set<(event: WorkbenchAdapterEvent) => void>();

  constructor(options: GatewayAdapterOptions) {
    this.gateway = new PowerGatewayClient(options.getSettings);
    this.gateway.subscribe((event) => {
      for (const listener of this.listeners) {
        listener(event);
      }
    });
  }

  dispose() {
    this.gateway.dispose();
  }

  subscribe(listener: (event: WorkbenchAdapterEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getDefaultModelId() {
    return "gpt-5.4";
  }

  getDefaultSelection() {
    return {
      projectId: null,
      sessionKey: null,
    };
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    return await this.gateway.request<T>(method, params);
  }

  async snapshot(args: WorkbenchSelection): Promise<WorkbenchSnapshot> {
    const agentsList = await requiredRequest(
      this.gateway.request<AgentsListResult>("agents.list", {}),
      "agents.list",
    );
    const sessionsResult = await requiredRequest(
      this.gateway.request<SessionsListResult>("sessions.list", {
        includeGlobal: false,
        includeUnknown: true,
        limit: 200,
      }),
      "sessions.list",
    );
    const selection = resolveSelection(args, agentsList, sessionsResult);
    const requests: Array<Promise<unknown>> = [
      safeRequest(this.gateway.request<ModelsListResult>("models.list", {}), { models: [] }),
    ];

    if (selection.projectId) {
      requests.push(
        safeRequest(
          this.gateway.request<AgentsFilesListResult>("agents.files.list", {
            agentId: selection.projectId,
          }),
          null,
        ),
      );
      requests.push(
        safeRequest(
          this.gateway.request<ToolsCatalogResult>("tools.catalog", {
            agentId: selection.projectId,
            includePlugins: true,
          }),
          null,
        ),
      );
    } else {
      requests.push(Promise.resolve(null), Promise.resolve(null));
    }

    if (selection.sessionKey) {
      requests.push(
        safeRequest(
          this.gateway.request<{ messages?: unknown[] }>("chat.history", {
            sessionKey: selection.sessionKey,
            limit: 200,
          }),
          { messages: [] },
        ),
      );
    } else {
      requests.push(Promise.resolve({ messages: [] }));
    }

    const [modelsResult, agentFilesList, toolsCatalogResult, chatHistory] = (await Promise.all(
      requests,
    )) as [
      ModelsListResult,
      AgentsFilesListResult | null,
      ToolsCatalogResult | null,
      { messages?: unknown[] },
    ];

    return {
      assistantName: "OpenClaw",
      currentProjectId: selection.projectId,
      currentSessionKey: selection.sessionKey,
      agentsList,
      agentIdentityById: buildIdentityMap(agentsList),
      agentFilesList,
      sessionsResult,
      chatMessages: Array.isArray(chatHistory.messages) ? chatHistory.messages : [],
      skillsReport: EMPTY_SKILLS_REPORT,
      cronJobs: [],
      modelCatalog: Array.isArray(modelsResult.models) ? modelsResult.models : [],
      toolsCatalogResult,
    };
  }

  async listProjectRoots(): Promise<WorkbenchDirectoryRootsResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchDirectoryRootsResult>("power.fs.roots", {}),
      "power.fs.roots",
    );
  }

  async listProjectDirectories(path?: string | null): Promise<WorkbenchDirectoryListResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchDirectoryListResult>("power.fs.listDirs", {
        path: path?.trim() || null,
      }),
      "power.fs.listDirs",
    );
  }

  async createProjectDirectory(
    path: string,
    name: string,
  ): Promise<WorkbenchDirectoryCreateResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchDirectoryCreateResult>("power.fs.createDir", {
        path: path.trim(),
        name: name.trim(),
      }),
      "power.fs.createDir",
    );
  }

  async validateProjectWorkspace(path: string): Promise<WorkbenchWorkspaceValidationResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchWorkspaceValidationResult>("power.fs.validateWorkspace", {
        path,
      }),
      "power.fs.validateWorkspace",
    );
  }

  async listProjectFiles(agentId: string, path?: string | null): Promise<WorkbenchFileListResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchFileListResult>("power.fs.listWorkspace", {
        agentId,
        path: path?.trim() || null,
      }),
      "power.fs.listWorkspace",
    );
  }

  async createProjectFolder(
    agentId: string,
    path: string | null,
    name: string,
  ): Promise<WorkbenchFileEntry> {
    const result = await requiredRequest<{ entry: WorkbenchFileEntry }>(
      this.gateway.request("power.fs.createFolder", {
        agentId,
        path: path?.trim() || null,
        name,
      }),
      "power.fs.createFolder",
    );
    return result.entry;
  }

  async uploadProjectFiles(
    agentId: string,
    path: string | null,
    files: WorkbenchUploadedFile[],
  ): Promise<WorkbenchFileEntry[]> {
    const result = await requiredRequest<{ entries: WorkbenchFileEntry[] }>(
      this.gateway.request("power.fs.uploadFiles", {
        agentId,
        path: path?.trim() || null,
        files,
      }),
      "power.fs.uploadFiles",
    );
    return Array.isArray(result.entries) ? result.entries : [];
  }

  async downloadProjectFile(agentId: string, path: string): Promise<WorkbenchFileDownloadResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchFileDownloadResult>("power.fs.downloadFile", {
        agentId,
        path,
      }),
      "power.fs.downloadFile",
    );
  }

  async deleteProjectEntry(agentId: string, path: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("power.fs.deleteEntry", {
        agentId,
        path,
      }),
      "power.fs.deleteEntry",
    );
  }

  async createProject(name: string, workspace: string) {
    const projectName = name.trim();
    const projectWorkspace = workspace.trim();
    if (!projectName || !projectWorkspace) {
      return null;
    }
    const created = await this.gateway.request<{ agentId: string }>("agents.create", {
      name: projectName,
      workspace: projectWorkspace,
    });
    return typeof created.agentId === "string" ? created.agentId : null;
  }

  async startTask(projectId: string, text: string, modelId: string): Promise<WorkbenchSendResult> {
    const sessionKey = buildPowerSessionKey(projectId);
    const label = buildSessionLabelFromPrompt(text);
    await this.gateway.request("sessions.patch", {
      key: sessionKey,
      label,
      model: modelId || null,
    });
    return { sessionKey, runId: null };
  }

  async addUserMessage(
    sessionKey: string,
    text: string,
    modelId: string,
  ): Promise<WorkbenchSendResult> {
    await this.gateway.request("sessions.patch", {
      key: sessionKey,
      model: modelId || null,
    });
    void text;
    return { sessionKey, runId: null };
  }

  async abortRun(sessionKey: string, runId: string | null): Promise<void> {
    await this.gateway.request("chat.abort", runId ? { sessionKey, runId } : { sessionKey });
  }

  async setSkillEnabled(skillKey: string, enabled: boolean) {
    await this.gateway.request("skills.update", { skillKey, enabled });
  }

  async saveSkillKey(_skillKey: string, _value: string): Promise<WorkbenchSkillMessage> {
    return {
      ok: false,
      message: "Saving skill secrets in power-ui is not wired yet.",
    };
  }

  async installSkill(_skillKey: string): Promise<WorkbenchSkillMessage> {
    return {
      ok: false,
      message: "Skill install wiring is deferred to the next phase.",
    };
  }
}
