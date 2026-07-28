import type { AgentEventPayload } from "../compat/ui-core.ts";
import type { WorkbenchSnapshot } from "../mock/adapter.ts";

export type WorkbenchSelection = {
  projectId: string | null;
  sessionKey: string | null;
  /**
   * When true, do not fall back to the default/first agent when `projectId` is null.
   * Used for「新增对话」等需要明确停留在无项目（全局）上下文的场景。
   */
  skipProjectDefault?: boolean;
  /**
   * When true, do not infer a project from `sessionKey`.
   * Used for recent/temporary chats that should not expose project workspace files.
   */
  skipSessionProject?: boolean;
};

export type WorkbenchChatState = "delta" | "final" | "aborted" | "error";

export type WorkbenchSendResult = {
  sessionKey: string;
  runId: string | null;
};

export type WorkbenchDirectoryEntry = {
  name: string;
  path: string;
};

export type WorkbenchFileEntry = {
  name: string;
  path: string;
  /** Optional extracted text companion for binary documents used as chat context. */
  readablePath?: string;
  /** Non-fatal warning when a file was saved but its content could not be prepared for the model. */
  processingWarning?: string;
  kind: "file" | "directory";
  size?: number;
  updatedAtMs?: number;
};

export type WorkbenchDirectoryRootsResult = {
  roots: WorkbenchDirectoryEntry[];
};

export type WorkbenchDirectoryListResult = {
  path: string;
  name: string;
  parentPath: string | null;
  entries: WorkbenchDirectoryEntry[];
};

export type WorkbenchFileListResult = {
  agentId: string;
  workspace: string;
  path: string;
  name: string;
  parentPath: string | null;
  entries: WorkbenchFileEntry[];
};

export type WorkbenchUploadedFile = {
  name: string;
  file: File;
  onProgress?: (progress: { loaded: number; total: number | null }) => void;
};

export type WorkbenchFilePreviewMode = "text" | "image" | "pdf" | "word";

export type WorkbenchFilePreviewResult =
  | {
      mode: "text";
      content: string;
    }
  | {
      mode: "word";
      html: string;
    }
  | {
      mode: "image" | "pdf";
      blob: Blob;
    };

export type WorkbenchWorkspaceValidationResult = {
  ok: boolean;
  path: string;
  name: string;
};

export type WorkbenchDirectoryCreateResult = {
  ok: boolean;
  entry: WorkbenchDirectoryEntry;
};

export type WorkbenchSkillMessage = {
  ok: boolean;
  message: string;
};

export type WorkbenchCodeTerminal = {
  terminalId: string;
  title: string;
  cwd: string;
  status: "running" | "exited";
  createdAt: number;
  lastActiveAt: number;
  exitCode: number | null;
};

export type WorkbenchCodeTerminalReadResult = {
  terminal: WorkbenchCodeTerminal;
  data: string;
  nextCursor: number;
  reset: boolean;
};

export type WorkbenchApprovalRequestPayload = {
  command: string;
  cwd?: string | null;
  host?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
};

export type WorkbenchApprovalRequest = {
  id: string;
  kind: "exec" | "plugin";
  request: WorkbenchApprovalRequestPayload;
  pluginTitle?: string;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

export type WorkbenchApprovalDecision = "allow-once" | "allow-always" | "deny";

export type WorkbenchAdapterEvent =
  | {
      type: "chat";
      sessionKey: string;
      runId: string | null;
      state: WorkbenchChatState;
      text?: string | null;
      message?: unknown;
      errorMessage?: string | null;
    }
  | {
      type: "agent";
      payload: AgentEventPayload;
    }
  | {
      type: "connection";
      connected: boolean;
      error?: string | null;
    }
  | {
      type: "approval";
      state: "requested";
      request: WorkbenchApprovalRequest;
    }
  | {
      type: "approval";
      state: "resolved";
      id: string;
    };

export interface WorkbenchAdapter {
  readonly kind: "mock" | "gateway";
  getDefaultModelId(): string;
  getDefaultSelection(): WorkbenchSelection;
  subscribe(listener: (event: WorkbenchAdapterEvent) => void): () => void;
  request<T>(method: string, params?: unknown): Promise<T>;
  snapshot(args: WorkbenchSelection): Promise<WorkbenchSnapshot>;
  listProjectRoots(): Promise<WorkbenchDirectoryRootsResult>;
  listProjectDirectories(path?: string | null): Promise<WorkbenchDirectoryListResult>;
  createProjectDirectory(path: string, name: string): Promise<WorkbenchDirectoryCreateResult>;
  validateProjectWorkspace(path: string): Promise<WorkbenchWorkspaceValidationResult>;
  listProjectFiles(agentId: string, path?: string | null): Promise<WorkbenchFileListResult>;
  createProjectFolder(
    agentId: string,
    path: string | null,
    name: string,
  ): Promise<WorkbenchFileEntry>;
  uploadProjectFiles(
    agentId: string,
    path: string | null,
    files: WorkbenchUploadedFile[],
  ): Promise<WorkbenchFileEntry[]>;
  previewProjectFile(
    agentId: string,
    path: string,
    mode: WorkbenchFilePreviewMode,
  ): Promise<WorkbenchFilePreviewResult>;
  downloadProjectFile(agentId: string, path: string): Promise<void>;
  deleteProjectEntry(agentId: string, path: string): Promise<void>;
  listCodeTerminals(): Promise<WorkbenchCodeTerminal[]>;
  createCodeTerminal(options?: {
    agentId?: string | null;
    cwd?: string | null;
    followTerminalId?: string | null;
    title?: string | null;
    cols?: number;
    rows?: number;
  }): Promise<WorkbenchCodeTerminal>;
  readCodeTerminal(
    terminalId: string,
    cursor?: number | null,
  ): Promise<WorkbenchCodeTerminalReadResult>;
  sendCodeTerminalInput(terminalId: string, data: string): Promise<void>;
  resizeCodeTerminal(
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<WorkbenchCodeTerminal>;
  closeCodeTerminal(terminalId: string): Promise<void>;
  renameProject(projectId: string, name: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  createProject(name: string, workspace: string): Promise<string | null>;
  startTask(
    projectId: string,
    text: string,
    modelId: string,
    options?: { label?: string | null; quickChat?: boolean; sessionKey?: string | null },
  ): Promise<WorkbenchSendResult>;
  renameSession(sessionKey: string, label: string): Promise<void>;
  deleteSession(sessionKey: string): Promise<void>;
  addUserMessage(sessionKey: string, text: string, modelId: string): Promise<WorkbenchSendResult>;
  abortRun(sessionKey: string, runId: string | null): Promise<void>;
  setSkillEnabled(skillKey: string, enabled: boolean): Promise<void>;
  saveSkillKey(skillKey: string, value: string): Promise<WorkbenchSkillMessage>;
  installSkill(skillKey: string): Promise<WorkbenchSkillMessage>;
  dispose?(): void;
}
