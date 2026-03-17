export type PowerProjectCreateInput = {
  name: string;
  workspace: string;
  emoji?: string;
  avatar?: string;
};

export type PowerProjectCreateResult = {
  agentId: string;
  name: string;
  workspace: string;
};

export type PowerSessionDraft = {
  projectId: string;
  sessionKey: string;
  label: string;
};

export type PowerChatSendInput = {
  sessionKey: string;
  message: string;
  model?: string;
};
