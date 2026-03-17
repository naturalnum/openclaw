import type { WorkbenchSnapshot } from "../mock/adapter.ts";

export type WorkbenchSelection = {
  projectId: string | null;
  sessionKey: string | null;
};

export type WorkbenchStartTaskResult = {
  sessionKey: string;
  replyText: string;
};

export type WorkbenchSkillMessage = {
  ok: boolean;
  message: string;
};

export interface WorkbenchAdapter {
  getDefaultModelId(): string;
  getDefaultSelection(): WorkbenchSelection;
  snapshot(args: WorkbenchSelection): Promise<WorkbenchSnapshot>;
  createProjectFromFolder(files: File[]): Promise<string | null>;
  startTask(projectId: string, text: string, modelId: string): Promise<WorkbenchStartTaskResult>;
  addUserMessage(
    sessionKey: string,
    text: string,
    modelId: string,
  ): Promise<WorkbenchStartTaskResult>;
  completeAssistantReply(sessionKey: string, replyText: string): Promise<void>;
  setSkillEnabled(skillKey: string, enabled: boolean): Promise<void>;
  saveSkillKey(skillKey: string, value: string): Promise<WorkbenchSkillMessage>;
  installSkill(skillKey: string): Promise<WorkbenchSkillMessage>;
}
