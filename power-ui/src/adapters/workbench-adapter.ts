import type { AgentEventPayload } from "../../../ui/src/ui/app-tool-stream.ts";
import type { WorkbenchSnapshot } from "../mock/adapter.ts";

export type WorkbenchSelection = {
  projectId: string | null;
  sessionKey: string | null;
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

export type WorkbenchFileDownloadResult = {
  agentId: string;
  workspace: string;
  file: {
    name: string;
    path: string;
    size: number;
    updatedAtMs: number;
    contentBase64: string;
  };
};

export type WorkbenchUploadedFile = {
  name: string;
  contentBase64: string;
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
  downloadProjectFile(agentId: string, path: string): Promise<WorkbenchFileDownloadResult>;
  deleteProjectEntry(agentId: string, path: string): Promise<void>;
  createProject(name: string, workspace: string): Promise<string | null>;
  startTask(projectId: string, text: string, modelId: string): Promise<WorkbenchSendResult>;
  addUserMessage(sessionKey: string, text: string, modelId: string): Promise<WorkbenchSendResult>;
  abortRun(sessionKey: string, runId: string | null): Promise<void>;
  setSkillEnabled(skillKey: string, enabled: boolean): Promise<void>;
  saveSkillKey(skillKey: string, value: string): Promise<WorkbenchSkillMessage>;
  installSkill(skillKey: string): Promise<WorkbenchSkillMessage>;
  dispose?(): void;
}
