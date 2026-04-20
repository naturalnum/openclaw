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

export type PowerTerminalConfig = {
  enabled: boolean;
  shell: string;
  defaultCwd: string | null;
  claudeCommand: string | null;
  env: Record<string, string>;
  idleTimeoutMs: number;
  historyMaxChars: number;
};

export type PowerTerminalInfo = {
  terminalId: string;
  title: string;
  cwd: string;
  status: "running" | "exited";
  createdAt: number;
  lastActiveAt: number;
  exitCode: number | null;
};

export type PowerTerminalReadResult = {
  terminal: PowerTerminalInfo;
  data: string;
  nextCursor: number;
  reset: boolean;
};
