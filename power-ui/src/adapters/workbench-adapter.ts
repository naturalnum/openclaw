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
  createProjectFromFolder(files: File[]): Promise<string | null>;
  startTask(projectId: string, text: string, modelId: string): Promise<WorkbenchSendResult>;
  addUserMessage(sessionKey: string, text: string, modelId: string): Promise<WorkbenchSendResult>;
  abortRun(sessionKey: string, runId: string | null): Promise<void>;
  setSkillEnabled(skillKey: string, enabled: boolean): Promise<void>;
  saveSkillKey(skillKey: string, value: string): Promise<WorkbenchSkillMessage>;
  installSkill(skillKey: string): Promise<WorkbenchSkillMessage>;
  dispose?(): void;
}
