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
  isAgentInLocalUserScope,
  isSessionInLocalUserScope,
} from "../integrations/openclaw/local-user-scope.ts";
import {
  buildPowerQuickSessionKey,
  buildPowerSessionKey,
  buildSessionLabelFromPrompt,
  isPowerQuickSessionKey,
} from "../integrations/openclaw/session-keys.ts";
import { resolveChatWorkspaceFileKind } from "../react-app/lib/chat-file-support.ts";
import {
  readAgentWorkspace,
  readDefaultAgentWorkspace,
  resolveTemporaryChatWorkspacePath,
} from "../react-app/lib/global-model-config.ts";
import { buildReadableChatFileSidecars } from "./chat-file-sidecars.ts";
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
  getUserScope?: () => string;
};

type ModelsListResult = {
  models?: ModelCatalogEntry[];
};

type PreparedMediaFileResult = {
  prepared?: boolean;
  readablePath?: string;
  warning?: string;
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
  _sessionsResult: SessionsListResult | null,
) {
  const rawSessionKey = args.sessionKey?.trim() ?? "";
  // Honor explicit session selection even if sessions.list is stale or truncated.
  const sessionKey = rawSessionKey;
  const sessionProjectId =
    sessionKey && !args.skipSessionProject && !isPowerQuickSessionKey(sessionKey)
      ? (parseAgentSessionKey(sessionKey)?.agentId ?? null)
      : null;
  const mergedProjectId = args.projectId ?? sessionProjectId ?? null;
  if (args.skipProjectDefault) {
    return {
      projectId: mergedProjectId,
      sessionKey,
    };
  }
  return {
    projectId: resolveProjectId(mergedProjectId, agentsList),
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

function mimeTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".doc")) {
    return "application/msword";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".md")) {
    return "text/plain;charset=utf-8";
  }
  if (lower.endsWith(".json")) {
    return "application/json;charset=utf-8";
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "text/javascript;charset=utf-8";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return "text/plain;charset=utf-8";
  }
  if (lower.endsWith(".py")) {
    return "text/x-python;charset=utf-8";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html;charset=utf-8";
  }
  if (lower.endsWith(".css")) {
    return "text/css;charset=utf-8";
  }
  return "application/octet-stream";
}

async function convertWordBlobToHtml(blob: Blob): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value?.trim();
  if (!html) {
    throw new Error("Word 文档内容为空，无法预览");
  }
  return html;
}

/** WebSocket upload is more reliable from the Vite dev UI than raw HTTP POST. */
const WS_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read file failed")));
    reader.readAsDataURL(file);
  });
}

function workspaceRelativePath(workspace: string, target: string): string | null {
  const normalizedWorkspace = workspace.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedTarget = target.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalizedWorkspace || !normalizedTarget) {
    return null;
  }
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedWorkspace);
  const workspaceForCompare = caseInsensitive
    ? normalizedWorkspace.toLowerCase()
    : normalizedWorkspace;
  const targetForCompare = caseInsensitive ? normalizedTarget.toLowerCase() : normalizedTarget;
  const prefix = `${workspaceForCompare}/`;
  if (!targetForCompare.startsWith(prefix)) {
    return null;
  }
  return normalizedTarget.slice(normalizedWorkspace.length + 1);
}

export class GatewayWorkbenchAdapter implements WorkbenchAdapter {
  readonly kind = "gateway" as const;
  private readonly gateway: PowerGatewayClient;
  private listeners = new Set<(event: WorkbenchAdapterEvent) => void>();
  private readonly workspaceRootByAgentId = new Map<string, string>();
  private visibleAgentIds: Set<string> | null = null;
  private readonly getUserScope: () => string;
  private configSnapshot: Record<string, unknown> | null = null;

  constructor(options: GatewayAdapterOptions) {
    this.gateway = new PowerGatewayClient(options.getSettings);
    this.getUserScope = options.getUserScope ?? (() => "");
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
    return "";
  }

  getDefaultSelection() {
    return {
      projectId: null,
      sessionKey: null,
    };
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    const result = await this.gateway.request<T>(method, params);
    if (method === "agents.list") {
      return this.filterAgentsList(result as AgentsListResult) as T;
    }
    if (method === "sessions.list") {
      return this.filterSessionsList(result as SessionsListResult) as T;
    }
    return result;
  }

  async snapshot(args: WorkbenchSelection): Promise<WorkbenchSnapshot> {
    const userScope = this.getUserScope().trim();
    const sanitizedArgs =
      userScope && args.sessionKey && !isSessionInLocalUserScope(args.sessionKey, userScope)
        ? { ...args, sessionKey: null, skipSessionProject: true, skipProjectDefault: true }
        : args;
    const rawAgentsList = await requiredRequest(
      this.gateway.request<AgentsListResult>("agents.list", {}),
      "agents.list",
    );
    const agentsList = this.filterAgentsList(rawAgentsList);
    const rawSessionsResult = await requiredRequest(
      this.gateway.request<SessionsListResult>("sessions.list", {
        includeGlobal: false,
        includeUnknown: true,
        limit: 200,
      }),
      "sessions.list",
    );
    const sessionsResult = this.filterSessionsList(rawSessionsResult);
    const selection = resolveSelection(sanitizedArgs, agentsList, sessionsResult);
    const requests: Array<Promise<unknown>> = [
      safeRequest(this.gateway.request<ModelsListResult>("models.list", {}), { models: [] }),
      safeRequest(
        this.gateway.request<{ config?: Record<string, unknown> }>("config.get", {}),
        null,
      ),
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

    const [modelsResult, configSnapshot, agentFilesList, toolsCatalogResult, chatHistory] =
      (await Promise.all(requests)) as [
        ModelsListResult,
        { config?: Record<string, unknown> } | null,
        AgentsFilesListResult | null,
        ToolsCatalogResult | null,
        { messages?: unknown[] },
      ];

    this.configSnapshot = configSnapshot?.config ?? null;
    for (const agent of agentsList.agents) {
      if (typeof agent.workspace === "string" && agent.workspace.trim()) {
        this.workspaceRootByAgentId.set(agent.id, agent.workspace);
      }
    }
    const defaultWorkspace = readDefaultAgentWorkspace(this.configSnapshot);
    if (defaultWorkspace && agentsList.defaultId) {
      this.workspaceRootByAgentId.set(agentsList.defaultId, defaultWorkspace);
    }
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
      chatMessages: Array.isArray(chatHistory.messages)
        ? chatHistory.messages.filter((message) => message != null && typeof message === "object")
        : [],
      skillsReport: EMPTY_SKILLS_REPORT,
      cronJobs: [],
      modelCatalog: Array.isArray(modelsResult.models) ? modelsResult.models : [],
      toolsCatalogResult,
      openclawConfig: configSnapshot?.config ?? null,
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
    const relativePath = this.toWorkspaceRelativePath(agentId, path);
    const wsCandidates = files.filter((file) => file.file.size <= WS_UPLOAD_MAX_BYTES);
    const httpCandidates = files.filter((file) => file.file.size > WS_UPLOAD_MAX_BYTES);
    const uploaded: WorkbenchFileEntry[] = [];

    if (wsCandidates.length > 0) {
      const payload = await Promise.all(
        wsCandidates.map(async (file) => {
          file.onProgress?.({ loaded: 0, total: file.file.size });
          const contentBase64 = await fileToBase64(file.file);
          file.onProgress?.({ loaded: file.file.size, total: file.file.size });
          return {
            name: file.name,
            contentBase64,
          };
        }),
      );
      const result = await requiredRequest<{ entries?: WorkbenchFileEntry[] }>(
        this.gateway.request("power.fs.uploadFiles", {
          agentId,
          path: relativePath,
          files: payload,
        }),
        "power.fs.uploadFiles",
      );
      uploaded.push(...(Array.isArray(result.entries) ? result.entries : []));
    }

    for (const file of httpCandidates) {
      const response = await requiredRequest(
        this.gateway.uploadHttpFile<{
          ok?: boolean;
          entry?: WorkbenchFileEntry;
          error?: string;
        }>({
          routePath: "/api/power/fs/upload",
          query: {
            agentId,
            path: relativePath || undefined,
            name: file.name,
          },
          file: file.file,
          onProgress: file.onProgress,
        }),
        "power.fs.upload",
      );
      const entry = response?.entry;
      if (!entry) {
        const detail = response?.error?.trim();
        throw new Error(detail ? detail : `Upload returned no file entry for ${file.name}`);
      }
      uploaded.push(entry);
    }

    if (uploaded.length === 0 && files.length > 0) {
      throw new Error("上传未写入任何文件，请检查网关与 power-backend 插件是否已加载");
    }
    return uploaded;
  }

  async uploadChatFiles(
    agentId: string,
    sessionKey: string,
    files: WorkbenchUploadedFile[],
    options?: { quickChat?: boolean },
  ): Promise<WorkbenchFileEntry[]> {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) {
      throw new Error("会话尚未创建，无法上传附件");
    }
    const prepared = await buildReadableChatFileSidecars(files);
    const sourceNames = new Set(files.map((entry) => entry.name));
    const decorateEntries = async (
      entries: WorkbenchFileEntry[],
      toPromptPath: (path: string) => string,
    ) => {
      const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
      const mediaPreparationByName = new Map<string, PreparedMediaFileResult>();
      await Promise.all(
        entries
          .filter((entry) => {
            if (!sourceNames.has(entry.name) || prepared.sidecarByFileName.has(entry.name)) {
              return false;
            }
            const kind = resolveChatWorkspaceFileKind(entry);
            return kind === "audio" || kind === "video";
          })
          .map(async (entry) => {
            try {
              const result = await this.gateway.request<PreparedMediaFileResult>(
                "power.media.prepareWorkspaceFile",
                { agentId, path: entry.path },
              );
              mediaPreparationByName.set(entry.name, result);
            } catch {
              const kind = resolveChatWorkspaceFileKind(entry);
              mediaPreparationByName.set(entry.name, {
                prepared: false,
                warning:
                  kind === "audio"
                    ? "音频已上传，但媒体转写服务暂不可用。"
                    : "视频已上传，但媒体理解服务暂不可用。",
              });
            }
          }),
      );
      return entries
        .filter((entry) => sourceNames.has(entry.name))
        .map((entry) => {
          const sidecarName = prepared.sidecarByFileName.get(entry.name);
          const sidecar = sidecarName ? entryByName.get(sidecarName) : undefined;
          const mediaPreparation = mediaPreparationByName.get(entry.name);
          const readablePath = sidecar?.path ?? mediaPreparation?.readablePath;
          const processingWarning =
            prepared.warningByFileName.get(entry.name) ?? mediaPreparation?.warning;
          return {
            ...entry,
            path: toPromptPath(entry.path),
            ...(readablePath ? { readablePath: toPromptPath(readablePath) } : {}),
            ...(processingWarning ? { processingWarning } : {}),
          };
        });
    };

    if (!options?.quickChat) {
      const config = this.configSnapshot ?? (await this.loadConfigSnapshot());
      const agentWorkspace = readAgentWorkspace(config, agentId);
      if (agentWorkspace) {
        this.workspaceRootByAgentId.set(agentId, agentWorkspace);
      }
      const uploadPath = `.chat-uploads/${normalizedSessionKey
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")}`;
      const folderName = uploadPath.slice(".chat-uploads/".length);
      await this.createProjectFolder(agentId, null, ".chat-uploads").catch(() => {});
      await this.createProjectFolder(agentId, ".chat-uploads", folderName).catch(() => {});
      const uploaded = await this.uploadProjectFiles(agentId, uploadPath, prepared.files);
      return await decorateEntries(uploaded, (path) => this.toWorkspaceRelativePath(agentId, path));
    }

    const userFolder = this.getUserScope().trim().replace(/^u-/, "") || null;
    const config = this.configSnapshot ?? (await this.loadConfigSnapshot());
    const agentWorkspace = readAgentWorkspace(config, agentId);
    if (!agentWorkspace) {
      throw new Error("无法定位当前用户的默认工作目录");
    }
    this.workspaceRootByAgentId.set(agentId, agentWorkspace);
    const sessionWorkspace = resolveTemporaryChatWorkspacePath(
      config,
      userFolder,
      normalizedSessionKey,
      agentId,
    );
    const relativeSessionWorkspace = workspaceRelativePath(agentWorkspace, sessionWorkspace);
    if (!relativeSessionWorkspace) {
      throw new Error("临时会话目录不在当前用户工作目录内，已阻止上传");
    }

    await this.gateway.request("sessions.patch", {
      key: normalizedSessionKey,
      workspaceDir: sessionWorkspace,
    });
    let parentPath: string | null = null;
    for (const segment of relativeSessionWorkspace.split("/").filter(Boolean)) {
      await this.createProjectFolder(agentId, parentPath, segment).catch(() => {});
      parentPath = parentPath ? `${parentPath}/${segment}` : segment;
    }
    await this.createProjectFolder(agentId, relativeSessionWorkspace, ".chat-uploads").catch(
      () => {},
    );
    const workspaceUploadPath = `${relativeSessionWorkspace}/.chat-uploads`;
    const uploaded = await this.uploadProjectFiles(agentId, workspaceUploadPath, prepared.files);
    const prefix = `${relativeSessionWorkspace}/`;
    return await decorateEntries(uploaded, (path) => {
      const relativePath = this.toWorkspaceRelativePath(agentId, path);
      return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath;
    });
  }

  async installSkillArchive(file: File): Promise<void> {
    await this.gateway.uploadHttpFile({
      routePath: "/api/power/skills/import",
      query: {
        fileName: file.name,
      },
      file,
    });
  }

  async previewProjectFile(
    agentId: string,
    path: string,
    mode: WorkbenchFilePreviewMode,
  ): Promise<WorkbenchFilePreviewResult> {
    const blob = await this.downloadProjectFileBlob(agentId, path);
    if (mode === "text") {
      return {
        mode,
        content: await blob.text(),
      };
    }
    if (mode === "word") {
      return {
        mode,
        html: await convertWordBlobToHtml(blob),
      };
    }
    return {
      mode,
      blob,
    };
  }

  private async downloadProjectFileBlob(agentId: string, path: string): Promise<Blob> {
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
    return new Blob([bytes], { type: mimeTypeFromPath(path) });
  }

  async downloadProjectFile(agentId: string, path: string): Promise<void> {
    const blob = await this.downloadProjectFileBlob(agentId, path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = path.split("/").findLast((part) => part.length > 0) || "download";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async deleteProjectEntry(agentId: string, path: string): Promise<void> {
    await requiredRequest(
      this.gateway.request("power.fs.deleteEntry", {
        agentId,
        path: this.toWorkspaceRelativePath(agentId, path),
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

  private async loadConfigSnapshot(): Promise<Record<string, unknown> | null> {
    const result = await safeRequest(
      this.gateway.request<{ config?: Record<string, unknown> }>("config.get", {}),
      null,
    );
    this.configSnapshot = result?.config ?? null;
    return this.configSnapshot;
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
        deleteFiles: true,
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
    options?: { label?: string | null; quickChat?: boolean; sessionKey?: string | null },
  ): Promise<WorkbenchSendResult> {
    const userScope = this.getUserScope();
    const requestedSessionKey = options?.sessionKey?.trim() ?? "";
    const sessionKey =
      requestedSessionKey &&
      (!userScope || isSessionInLocalUserScope(requestedSessionKey, userScope))
        ? requestedSessionKey
        : options?.quickChat
          ? buildPowerQuickSessionKey(projectId, userScope)
          : buildPowerSessionKey(projectId, userScope);
    const label = options?.label?.trim() || buildSessionLabelFromPrompt(text);
    const model = modelId.trim();
    let workspaceDir: string | undefined;
    if (options?.quickChat) {
      const userFolder = userScope.trim().replace(/^u-/, "") || null;
      const config = this.configSnapshot ?? (await this.loadConfigSnapshot());
      workspaceDir = resolveTemporaryChatWorkspacePath(config, userFolder, sessionKey, projectId);
    }
    const created = await safeRequest(
      this.gateway.request<{ key?: string }>("sessions.create", {
        agentId: projectId,
        key: sessionKey,
        label,
        ...(model ? { model } : {}),
        ...(workspaceDir ? { workspaceDir } : {}),
      }),
      null,
    );
    const canonicalSessionKey = created?.key?.trim() || sessionKey;
    if (!created?.key) {
      await this.gateway.request("sessions.patch", {
        key: canonicalSessionKey,
        label,
        ...(model ? { model } : {}),
      });
    }
    for (const listener of this.listeners) {
      listener({
        type: "chat",
        sessionKey: canonicalSessionKey,
        runId: null,
        state: "delta",
        text: null,
      });
    }
    return { sessionKey: canonicalSessionKey, runId: null };
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

  private filterAgentsList(result: AgentsListResult): AgentsListResult {
    const scope = this.getUserScope().trim();
    if (!scope) {
      return result;
    }
    const agents = (result.agents ?? []).filter((agent) =>
      isAgentInLocalUserScope(agent.workspace, scope),
    );
    this.visibleAgentIds = new Set(agents.map((agent) => agent.id));
    return {
      ...result,
      defaultId: agents[0]?.id ?? "",
      agents,
    };
  }

  private filterSessionsList(result: SessionsListResult): SessionsListResult {
    const scope = this.getUserScope().trim();
    if (!scope) {
      return result;
    }
    return {
      ...result,
      sessions: (result.sessions ?? []).filter((session) => {
        if (typeof session.key !== "string" || !isSessionInLocalUserScope(session.key, scope)) {
          return false;
        }
        const agentId = parseAgentSessionKey(session.key)?.agentId;
        return Boolean(agentId && this.visibleAgentIds?.has(agentId));
      }),
    };
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
