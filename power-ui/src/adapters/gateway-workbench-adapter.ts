import { parseAgentSessionKey } from "../../../ui/src/ui/session-key.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
  SessionsListResult,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../compat/types.ts";
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
  WorkbenchCodeTerminal,
  WorkbenchCodeTerminalReadResult,
  WorkbenchFilePreviewMode,
  WorkbenchFilePreviewResult,
  WorkbenchDirectoryListResult,
  WorkbenchDirectoryRootsResult,
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
  private readonly workspaceRootByAgentId = new Map<string, string>();

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

    if (agentFilesList?.agentId && agentFilesList.workspace) {
      this.workspaceRootByAgentId.set(agentFilesList.agentId, agentFilesList.workspace);
    }

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
    const result = await requiredRequest(
      this.gateway.request<WorkbenchFileListResult>("power.fs.listWorkspace", {
        agentId,
        path: path?.trim() || null,
      }),
      "power.fs.listWorkspace",
    );
    if (result.workspace) {
      this.workspaceRootByAgentId.set(agentId, result.workspace);
    }
    return result;
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
    const uploaded: WorkbenchFileEntry[] = [];
    for (const file of files) {
      const result = await this.gateway.uploadHttpFile<{ entry?: WorkbenchFileEntry }>({
        routePath: "/api/power/fs/upload",
        query: {
          agentId,
          path: this.toWorkspaceRelativePath(agentId, path),
          name: file.name,
        },
        file: file.file,
        onProgress: file.onProgress,
      });
      const entry = result?.entry;
      if (entry) {
        uploaded.push(entry);
      }
    }
    return uploaded;
  }

  async previewProjectFile(
    agentId: string,
    path: string,
    mode: WorkbenchFilePreviewMode,
  ): Promise<WorkbenchFilePreviewResult> {
    const response = await requiredRequest<{
      file?: {
        contentBase64?: string;
      };
    }>(
      this.gateway.request("power.fs.downloadFile", {
        agentId,
        path: this.toWorkspaceRelativePath(agentId, path),
      }),
      "power.fs.downloadFile",
    );
    const contentBase64 = response.file?.contentBase64?.trim() ?? "";
    if (!contentBase64) {
      throw new Error("power.fs.downloadFile returned empty content");
    }
    const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes]);
    if (mode === "text") {
      return {
        mode,
        content: await blob.text(),
      };
    }
    return {
      mode,
      blob,
    };
  }

  async downloadProjectFile(agentId: string, path: string): Promise<void> {
    await this.gateway.submitHttpDownload({
      routePath: "/api/power/fs/download",
      fields: { agentId, path: this.toWorkspaceRelativePath(agentId, path) },
    });
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

  async listCodeTerminals(): Promise<WorkbenchCodeTerminal[]> {
    const result = await requiredRequest<{ terminals?: WorkbenchCodeTerminal[] }>(
      this.gateway.request("power.terminal.list", {}),
      "power.terminal.list",
    );
    return Array.isArray(result.terminals) ? result.terminals : [];
  }

  async createCodeTerminal(options?: {
    agentId?: string | null;
    cwd?: string | null;
    followTerminalId?: string | null;
    title?: string | null;
    cols?: number;
    rows?: number;
  }): Promise<WorkbenchCodeTerminal> {
    const result = await requiredRequest<{ terminal: WorkbenchCodeTerminal }>(
      this.gateway.request("power.terminal.create", {
        agentId: options?.agentId?.trim() || null,
        cwd: options?.cwd?.trim() || null,
        followTerminalId: options?.followTerminalId?.trim() || null,
        title: options?.title?.trim() || null,
        cols: options?.cols,
        rows: options?.rows,
      }),
      "power.terminal.create",
    );
    return result.terminal;
  }

  async readCodeTerminal(
    terminalId: string,
    cursor?: number | null,
  ): Promise<WorkbenchCodeTerminalReadResult> {
    return await requiredRequest(
      this.gateway.request<WorkbenchCodeTerminalReadResult>("power.terminal.read", {
        terminalId,
        cursor,
      }),
      "power.terminal.read",
    );
  }

  async sendCodeTerminalInput(terminalId: string, data: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("power.terminal.input", {
        terminalId,
        data,
      }),
      "power.terminal.input",
    );
  }

  async resizeCodeTerminal(
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<WorkbenchCodeTerminal> {
    const result = await requiredRequest<{ terminal: WorkbenchCodeTerminal }>(
      this.gateway.request("power.terminal.resize", {
        terminalId,
        cols,
        rows,
      }),
      "power.terminal.resize",
    );
    return result.terminal;
  }

  async closeCodeTerminal(terminalId: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("power.terminal.close", {
        terminalId,
      }),
      "power.terminal.close",
    );
  }

  private toWorkspaceRelativePath(agentId: string, targetPath: string | null | undefined) {
    const normalizedTarget = this.normalizePathForCompare(targetPath);
    if (!normalizedTarget) {
      return "";
    }
    const workspaceRoot = this.normalizePathForCompare(this.workspaceRootByAgentId.get(agentId));
    if (!workspaceRoot) {
      return normalizedTarget;
    }
    if (normalizedTarget === workspaceRoot) {
      return "";
    }
    const prefix = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
    if (!normalizedTarget.startsWith(prefix)) {
      return normalizedTarget;
    }
    return normalizedTarget.slice(prefix.length);
  }

  private normalizePathForCompare(value: string | null | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.replaceAll("\\", "/").replace(/\/+$/, "");
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("agents.update", {
        agentId: projectId,
        name,
      }),
      "agents.update",
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("agents.delete", {
        agentId: projectId,
        deleteFiles: false,
      }),
      "agents.delete",
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

  async startTask(
    projectId: string,
    text: string,
    modelId: string,
    options?: { label?: string | null },
  ): Promise<WorkbenchSendResult> {
    const sessionKey = buildPowerSessionKey(projectId);
    const label = options?.label?.trim() || buildSessionLabelFromPrompt(text);
    void modelId;
    await this.gateway.request("sessions.patch", {
      key: sessionKey,
      label,
    });
    return { sessionKey, runId: null };
  }

  async addUserMessage(
    sessionKey: string,
    text: string,
    modelId: string,
  ): Promise<WorkbenchSendResult> {
    void text;
    void modelId;
    return { sessionKey, runId: null };
  }

  async renameSession(sessionKey: string, label: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("sessions.patch", {
        key: sessionKey,
        label,
      }),
      "sessions.patch",
    );
  }

  async deleteSession(sessionKey: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("sessions.delete", {
        key: sessionKey,
      }),
      "sessions.delete",
    );
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
