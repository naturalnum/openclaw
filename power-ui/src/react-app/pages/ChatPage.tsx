import { ArrowUpOutlined } from "@ant-design/icons";
import { App } from "antd";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../../../../ui/src/ui/chat/attachment-support";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";
import type { ChatAttachment } from "../../../../ui/src/ui/ui-types";
import type { WorkbenchUploadedFile } from "../../adapters/workbench-adapter";
import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter";
import { extractText } from "../../compat/chat";
import { isPowerQuickSessionKey } from "../../integrations/openclaw/session-keys";
import { ChatMarkdownBody } from "../components/chat/ChatMarkdownBody";
import { ChatModelPicker } from "../components/chat/ChatModelPicker";
import { ChatToolStepsList, type ChatToolStepsPhase } from "../components/chat/ChatToolStepsList";
import { ChatWorkspaceFilesPanel } from "../components/chat/ChatWorkspaceFilesPanel";
import { useWorkbenchChat } from "../context/WorkbenchChatContext";
import { useWorkspaceRail } from "../context/WorkspaceRailContext";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import { shouldHideChatMessage } from "../lib/chat-message-visibility";
import { dedupeCumulativeStreamSegments, streamTextAfterPrefix } from "../lib/chat-stream-segments";
import { resolveChatModelPool, resolveEffectiveChatModelRef } from "../lib/configured-chat-models";
import { formatCatalogModelRef } from "../lib/model-catalog";

/** 主色仅用于关键操作；大面积 UI 用中性灰白 */
const BRAND = {
  primary: "border border-[#30343a] bg-[#30343a] hover:bg-[#24272d] active:bg-[#17191d]",
  primaryText: "text-white",
} as const;

const DEFAULT_ATTACHMENT_PROMPT = "请阅读以下附件并回答。";
const CHAT_ATTACHMENT_CONTEXT_PATTERNS = [
  /\s*本轮对话附件：[\s\S]*?(?:请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。|$)/g,
  /\s*已上传到当前工作区的附件：[\s\S]*?(?:请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。|$)/g,
];

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isRenderableChatMessage(msg: unknown): msg is Record<string, unknown> {
  return msg != null && typeof msg === "object";
}

function messageHasVisibleText(msg: unknown): boolean {
  if (!isRenderableChatMessage(msg) || shouldHideChatMessage(msg, { showToolCalls: false })) {
    return false;
  }
  const raw = extractDisplayText(msg);
  return typeof raw === "string" && raw.trim().length > 0;
}

function messageRole(msg: unknown): string {
  if (!isRenderableChatMessage(msg)) {
    return "";
  }
  return typeof msg.role === "string" ? msg.role.toLowerCase() : "";
}

function findLastUserMessageIndex(messages: unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messageRole(messages[i]) === "user" && messageHasVisibleText(messages[i])) {
      return i;
    }
  }
  return -1;
}

function sanitizeUserChatDisplayText(text: string): string {
  const attachmentNames = text
    .split("\n")
    .map(
      (line) =>
        line
          .trim()
          .match(/^-\s*([^:]+):\s*\S+/)?.[1]
          ?.trim() ?? "",
    )
    .filter(Boolean);
  const cleaned = CHAT_ATTACHMENT_CONTEXT_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, ""),
    text,
  ).trim();
  const attachmentSummary = formatAttachmentFileSummary(attachmentNames);
  if (cleaned === DEFAULT_ATTACHMENT_PROMPT || !cleaned) {
    return attachmentNames.length > 0 ? attachmentSummary : cleaned;
  }
  return attachmentNames.length > 0 ? `${cleaned}\n\n附件：${attachmentNames.join("、")}` : cleaned;
}

function extractDisplayText(msg: unknown): string {
  const rawText = extractText(msg);
  const text = typeof rawText === "string" ? rawText.trim() : "";
  return messageRole(msg) === "user" ? sanitizeUserChatDisplayText(text) : text;
}

/** 有工具步骤时，把本轮助手总结挪到步骤条之后展示。 */
function splitMessagesForTurnLayout(messages: unknown[], pinToolStepsBeforeAssistant: boolean) {
  if (!pinToolStepsBeforeAssistant) {
    return { leadMessages: messages, tailAssistantMessages: [] as unknown[] };
  }
  const lastUserIdx = findLastUserMessageIndex(messages);
  if (lastUserIdx < 0) {
    return { leadMessages: messages, tailAssistantMessages: [] as unknown[] };
  }
  const tailAssistantMessages = messages
    .slice(lastUserIdx + 1)
    .filter((msg) => messageRole(msg) === "assistant" && messageHasVisibleText(msg));
  if (tailAssistantMessages.length === 0) {
    return { leadMessages: messages, tailAssistantMessages: [] as unknown[] };
  }
  return {
    leadMessages: messages.slice(0, lastUserIdx + 1),
    tailAssistantMessages,
  };
}

function shouldShowToolStepsList(
  steps: Array<{ label: string; detail: string }>,
  options?: { active?: boolean },
): boolean {
  if (steps.length === 0) {
    return false;
  }
  if (options?.active) {
    return true;
  }
  // Completed tool logs are useful while waiting, but noisy once the answer is visible.
  // Keep the transcript focused on user intent and assistant output.
  return false;
}

function renderChatMessageBubble(msg: unknown, key: string) {
  if (!isRenderableChatMessage(msg) || !messageHasVisibleText(msg)) {
    return null;
  }
  const role = messageRole(msg);
  const text = extractDisplayText(msg);
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const displayText = isAssistant ? sanitizeChatDisplayText(text) : text;
  return (
    <div key={key} className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        aria-label={isUser ? "用户消息" : "助手消息"}
        className={cn(
          "max-w-[min(100%,42rem)] rounded-2xl px-3 py-2 text-sm leading-snug",
          isUser
            ? "rounded-br-md bg-[#fbfbfa] text-slate-900 ring-1 ring-slate-200/60"
            : "rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200/50",
        )}
      >
        {isAssistant ? (
          <ChatMarkdownBody source={displayText} />
        ) : (
          <span className="whitespace-pre-wrap break-words">{displayText}</span>
        )}
      </div>
    </div>
  );
}

const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_COUNT = 6;
const MAX_CHAT_WORKSPACE_FILE_BYTES = 100 * 1024 * 1024;
const MAX_CHAT_WORKSPACE_FILE_COUNT = 8;
const CHAT_UPLOADS_ROOT = ".chat-uploads";
const CHAT_WORKSPACE_FILE_ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".ppt",
  ".pptx",
  ".txt",
  ".md",
  ".json",
  ".jsonl",
  ".html",
  ".htm",
  ".xml",
  ".yaml",
  ".yml",
  ".mp3",
  ".m4a",
  ".wav",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
].join(",");
const CHAT_FILE_ACCEPT = `${CHAT_ATTACHMENT_ACCEPT},${CHAT_WORKSPACE_FILE_ACCEPT}`;
/** 距底部小于此值视为「在底部」，新消息/流式输出会自动跟随 */
const SCROLL_BOTTOM_THRESHOLD_PX = 80;

type PendingWorkspaceChatFile = {
  id: string;
  file: File;
  name: string;
  size: number;
};

function buildChatUploadFolder(sessionKey: string) {
  const normalized = sessionKey.trim() || `draft-${crypto.randomUUID()}`;
  const safe = normalized.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${CHAT_UPLOADS_ROOT}/${safe || `draft-${crypto.randomUUID()}`}`;
}

const SUPPORTED_WORKSPACE_FILE_EXTENSIONS = new Set(
  CHAT_WORKSPACE_FILE_ACCEPT.split(",").map((ext) => ext.slice(1)),
);

const SUPPORTED_WORKSPACE_FILE_MIME_PREFIXES = [
  "audio/",
  "video/",
  "text/",
  "application/pdf",
  "application/json",
  "application/xml",
  "application/msword",
  "application/vnd.ms-",
  "application/vnd.openxmlformats-officedocument",
  "application/x-yaml",
  "application/yaml",
];

function fileExtension(name: string): string {
  const normalized = name.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index >= 0 ? normalized.slice(index + 1) : "";
}

function isSupportedWorkspaceChatFile(file: File): boolean {
  const mimeType = file.type.trim().toLowerCase();
  if (
    mimeType &&
    SUPPORTED_WORKSPACE_FILE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  ) {
    return true;
  }
  return SUPPORTED_WORKSPACE_FILE_EXTENSIONS.has(fileExtension(file.name));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function appendUploadedFilesToMessage(
  text: string,
  entries: Array<{ name: string; path: string }>,
) {
  if (entries.length === 0) {
    return text;
  }
  const body = text.trim();
  const fileList = entries.map((entry) => `- ${entry.name}: ${entry.path}`).join("\n");
  const prefix = body || "请阅读以下附件并回答。";
  return `${prefix}\n\n本轮对话附件：\n${fileList}\n\n请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。`;
}

function formatAttachmentFileSummary(fileNames: string[]) {
  const names = fileNames.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) {
    return "已上传文件";
  }
  if (names.length === 1) {
    return `已上传文件：${names[0]}`;
  }
  const visibleNames = names.slice(0, 3).join("、");
  return `已上传 ${names.length} 个文件：${visibleNames}${names.length > 3 ? " 等" : ""}`;
}

function buildVisibleUserMessage(text: string, input: { imageCount: number; fileNames: string[] }) {
  const body = text.trim();
  const fileCount = input.fileNames.length;
  if (body) {
    return fileCount > 0 ? `${body}\n\n附件：${input.fileNames.join("、")}` : body;
  }
  if (input.imageCount > 0 && fileCount > 0) {
    return `已上传图片和文件：${input.fileNames.join("、")}`;
  }
  if (input.imageCount > 0) {
    return "已上传图片";
  }
  if (fileCount > 0) {
    return formatAttachmentFileSummary(input.fileNames);
  }
  return "";
}

function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function mediaPathBasename(rawPath: string): string {
  const normalized = rawPath.replaceAll("\\", "/").trim();
  const parts = normalized.split("/").filter((part) => part.trim().length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] ?? "文件") : "文件";
}

function sanitizeChatDisplayText(text: string): string {
  const lines = text.split("\n");
  const mediaNames = new Set<string>();
  for (const line of lines) {
    const match = line.trim().match(/^MEDIA:(.+)$/);
    if (match?.[1]) {
      mediaNames.add(mediaPathBasename(match[1]));
    }
  }
  const bodyWithoutMediaLines = lines
    .filter((line) => {
      const match = line.trim().match(/^MEDIA:(.+)$/);
      if (!match?.[1]) {
        return true;
      }
      const filename = mediaPathBasename(match[1]);
      if (mediaNames.size === 0) {
        return true;
      }
      const mentionedElsewhere = lines.some((other) => {
        if (other === line) {
          return false;
        }
        return other.includes(filename);
      });
      return !mentionedElsewhere;
    })
    .join("\n");
  return bodyWithoutMediaLines.replace(/\n{3,}/g, "\n\n").trim();
}

function fileToChatAttachment(file: File): Promise<ChatAttachment | null> {
  return new Promise((resolve) => {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      resolve(null);
      return;
    }
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve({
        id: crypto.randomUUID(),
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
    });
    reader.addEventListener("error", () => resolve(null));
    reader.readAsDataURL(file);
  });
}

type AgentWorkbenchEventPayload = Extract<WorkbenchAdapterEvent, { type: "agent" }>["payload"];

function toolEventMayChangeWorkspaceFiles(payload: AgentWorkbenchEventPayload): boolean {
  if (payload.stream !== "tool") {
    return false;
  }
  const data = payload.data ?? {};
  const phase = typeof data.phase === "string" ? data.phase : "";
  if (phase && phase !== "start" && phase !== "result") {
    return false;
  }
  const name = typeof data.name === "string" ? data.name.toLowerCase() : "";
  if (/(write|edit|patch|create|delete|upload|apply_patch|fs)/i.test(name)) {
    return true;
  }
  const args = data.args;
  if (!args || typeof args !== "object") {
    return false;
  }
  const record = args as Record<string, unknown>;
  const command = typeof record.command === "string" ? record.command : "";
  if (/[>]|tee\s+|touch\s+|mkdir\s+|rm\s+|mv\s+|cp\s+|apply_patch/.test(command)) {
    return true;
  }
  return ["path", "filePath", "filename", "target"].some(
    (key) => typeof record[key] === "string" && record[key].trim().length > 0,
  );
}

function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function ClipIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.64 16.2a2 2 0 0 1-2.83-2.83l8.49-8.48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChatPage() {
  const { message } = App.useApp();
  const { settings, patchSettings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const {
    snapshot,
    snapshotError,
    selectedProjectId,
    selectedSessionKey,
    activeRuntime,
    selectSession,
    sendUserMessage,
    stopGeneration,
    setActiveAgent,
    startNewConversation,
    refreshSnapshot,
  } = useWorkbenchChat();

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const shouldStartNew = searchParams.get("new") === "1";
    if (!shouldStartNew) {
      return;
    }
    startNewConversation(null, { preferQuickChat: true });
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, startNewConversation]);

  useEffect(() => {
    const rawSession = searchParams.get("sessionKey")?.trim();
    const pid = searchParams.get("projectId")?.trim();
    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (rawSession) {
      const hasProjectParam = Boolean(pid);
      const skipSessionProject = isPowerQuickSessionKey(rawSession);
      const agentId = isPowerQuickSessionKey(rawSession)
        ? null
        : (parseAgentSessionKey(rawSession)?.agentId ?? pid ?? null);
      void selectSession(rawSession, hasProjectParam ? agentId : null, {
        skipSessionProject,
      });
      next.delete("sessionKey");
      next.delete("projectId");
      changed = true;
    } else if (pid) {
      setActiveAgent(pid);
      next.delete("projectId");
      changed = true;
    }

    if (changed) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectSession, setActiveAgent, setSearchParams]);

  const configuredModels = useMemo(
    () => resolveChatModelPool(snapshot, selectedProjectId, selectedSessionKey),
    [snapshot, selectedProjectId, selectedSessionKey],
  );

  const effectiveModelRef = useMemo(
    () =>
      resolveEffectiveChatModelRef({
        snapshot,
        sessionKey: selectedSessionKey,
        chatPreferredModelRef: settings.chatPreferredModelRef,
        configuredModels,
      }),
    [configuredModels, selectedSessionKey, settings.chatPreferredModelRef, snapshot],
  );

  const handleModelChange = async (ref: string) => {
    const nextRef = ref.trim();
    if (!nextRef) {
      return;
    }
    const sk = selectedSessionKey.trim();
    if (!sk || !adapter) {
      patchSettings({ chatPreferredModelRef: nextRef });
      return;
    }
    try {
      await adapter.request("sessions.patch", { key: sk, model: nextRef });
      patchSettings({ chatPreferredModelRef: nextRef });
      message.success("已切换当前会话模型");
      await refreshSnapshot();
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e);
      message.error(`切换模型失败：${errText}`);
    }
  };

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [pendingWorkspaceFiles, setPendingWorkspaceFiles] = useState<PendingWorkspaceChatFile[]>(
    [],
  );
  const [optimisticUserBubble, setOptimisticUserBubble] = useState<{
    text: string;
    attachmentCount: number;
    ts: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesColumnRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agents = snapshot?.agentsList?.agents ?? [];
  const defaultAgentId = snapshot?.agentsList?.defaultId ?? null;
  const [workspaceFilesReloadToken, setWorkspaceFilesReloadToken] = useState(0);
  const {
    previewActive: workspacePreviewActive,
    setPreviewActive: setWorkspacePreviewActive,
    fullscreen: workspacePreviewFullscreen,
    canFullscreen: workspaceCanFullscreen,
    toggleFullscreen: toggleWorkspacePreviewFullscreen,
  } = useWorkspaceRail();

  const workspaceAgentId = useMemo(() => {
    return selectedProjectId?.trim() || snapshot?.currentProjectId?.trim() || "";
  }, [selectedProjectId, snapshot?.currentProjectId]);

  const [workspaceRailRevealedByFileChange, setWorkspaceRailRevealedByFileChange] = useState(false);
  const workspaceRailEligible = Boolean(
    workspaceAgentId && (workspacePreviewActive || workspaceRailRevealedByFileChange),
  );
  const activeFileAccept = CHAT_FILE_ACCEPT;

  useEffect(() => {
    setWorkspacePreviewActive(false);
    setWorkspaceRailRevealedByFileChange(false);
  }, [setWorkspacePreviewActive, workspaceAgentId]);

  useEffect(() => {
    if (!adapter || !workspaceAgentId) {
      return undefined;
    }
    let timer: number | null = null;
    let sawWorkspaceFileMutation = false;
    const scheduleReload = () => {
      if (timer != null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        setWorkspaceFilesReloadToken((n) => n + 1);
      }, 650);
    };
    const unsubscribe = adapter.subscribe((event: WorkbenchAdapterEvent) => {
      if (event.type === "chat") {
        const agentId = parseAgentSessionKey(event.sessionKey)?.agentId ?? "";
        if (agentId === workspaceAgentId && event.state === "final" && sawWorkspaceFileMutation) {
          setWorkspaceRailRevealedByFileChange(true);
          scheduleReload();
          sawWorkspaceFileMutation = false;
        }
        if (event.state === "error" || event.state === "aborted") {
          sawWorkspaceFileMutation = false;
        }
        return;
      }
      if (event.type === "agent") {
        const sessionKey =
          typeof event.payload.sessionKey === "string" ? event.payload.sessionKey : "";
        const agentId = parseAgentSessionKey(sessionKey)?.agentId ?? "";
        if (agentId === workspaceAgentId) {
          sawWorkspaceFileMutation =
            sawWorkspaceFileMutation || toolEventMayChangeWorkspaceFiles(event.payload);
        }
      }
    });
    return () => {
      unsubscribe();
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [adapter, workspaceAgentId]);

  const catalogImageSupport = useMemo((): "yes" | "no" | "unknown" => {
    const ref = effectiveModelRef.trim();
    const catalog = snapshot?.modelCatalog ?? [];
    if (!ref || catalog.length === 0) {
      return "unknown";
    }
    const m = catalog.find((x) => formatCatalogModelRef(x) === ref || x.id === ref);
    if (!m) {
      return "unknown";
    }
    if (!m.input || m.input.length === 0) {
      return "unknown";
    }
    return m.input.includes("image") ? "yes" : "no";
  }, [effectiveModelRef, snapshot?.modelCatalog]);

  const chatToolSteps = activeRuntime?.displayToolSteps ?? [];
  const runActive = Boolean(activeRuntime?.chatRunId);
  const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
  const visibleToolSteps = useMemo(
    () =>
      shouldShowToolStepsList(chatToolSteps, { active: runActive || sending }) ? chatToolSteps : [],
    [chatToolSteps, runActive, sending],
  );
  const pinToolStepsBeforeAssistant = visibleToolSteps.length > 0;
  const { leadMessages, tailAssistantMessages } = useMemo(
    () =>
      splitMessagesForTurnLayout(activeRuntime?.chatMessages ?? [], pinToolStepsBeforeAssistant),
    [activeRuntime?.chatMessages, pinToolStepsBeforeAssistant],
  );
  const hideStreamSegments = pinToolStepsBeforeAssistant;

  const visibleStreamSegments = useMemo(() => {
    const segments = activeRuntime?.chatStreamSegments ?? [];
    if (hideStreamSegments) {
      return [];
    }
    return dedupeCumulativeStreamSegments(segments).filter((seg) => seg.text.trim().length > 0);
  }, [activeRuntime?.chatStreamSegments, hideStreamSegments]);

  const liveStreamText = useMemo(() => {
    const stream = activeRuntime?.chatStream ?? "";
    const prefix = activeRuntime?.chatCommittedToolPrefix ?? "";
    return streamTextAfterPrefix(stream, prefix);
  }, [activeRuntime?.chatCommittedToolPrefix, activeRuntime?.chatStream]);

  const tailAssistantText = useMemo(
    () =>
      tailAssistantMessages
        .map((msg) => extractText(msg))
        .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
        .join("\n\n")
        .trim(),
    [tailAssistantMessages],
  );
  const showLiveStream =
    Boolean(liveStreamText.trim()) && liveStreamText.trim() !== tailAssistantText;
  const showStream = showLiveStream;
  const busy = sending || runActive || Boolean(activeRuntime?.chatSending) || showStream;
  const activityStartedAt =
    activeRuntime?.chatStreamStartedAt ?? optimisticUserBubble?.ts ?? (busy ? activityNowMs : null);
  const elapsedLabel =
    busy && activityStartedAt ? formatElapsedDuration(activityNowMs - activityStartedAt) : null;
  /** 已发起请求但尚未收到可见文本（首 token 等待） */
  const awaitingFirstToken = runActive && !showLiveStream && !activeRuntime?.lastError;
  const showAssistantOutput = awaitingFirstToken || showStream;
  const toolStepsPhase = useMemo((): ChatToolStepsPhase => {
    if (visibleToolSteps.some((step) => !step.complete)) {
      return "running";
    }
    if (runActive || sending) {
      return "waiting_reply";
    }
    return "done";
  }, [visibleToolSteps, runActive, sending]);
  const showAssistantActivityCard = visibleToolSteps.length > 0 || showAssistantOutput;
  const runStatusHint = useMemo(() => {
    if (!runActive && !sending) {
      return null;
    }
    const suffix = elapsedLabel ? ` · 已用 ${elapsedLabel}` : "";
    if (visibleToolSteps.some((step) => !step.complete)) {
      return `正在执行任务…${suffix}`;
    }
    if (awaitingFirstToken) {
      return `正在等待回复…${suffix}`;
    }
    if (showStream) {
      return `正在生成回复…${suffix}`;
    }
    if (runActive) {
      return `正在整理结果…${suffix}`;
    }
    return `发送中…${suffix}`;
  }, [visibleToolSteps, runActive, sending, showStream, awaitingFirstToken, elapsedLabel]);
  const errorText = snapshotError ?? activeRuntime?.lastError ?? null;
  useEffect(() => {
    if (!busy) {
      setActivityNowMs(Date.now());
      return undefined;
    }
    setActivityNowMs(Date.now());
    const timer = window.setInterval(() => setActivityNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, selectedSessionKey, activeRuntime?.chatRunId, activeRuntime?.chatStreamStartedAt]);
  useEffect(() => {
    if (!optimisticUserBubble) {
      return;
    }
    const hasCommittedUser = (activeRuntime?.chatMessages ?? []).some((m) => {
      if (!isRenderableChatMessage(m)) {
        return false;
      }
      const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
      if (role !== "user") {
        return false;
      }
      const txt = extractDisplayText(m);
      return txt === optimisticUserBubble.text.trim();
    });
    if (hasCommittedUser || (!sending && !busy)) {
      setOptimisticUserBubble(null);
    }
  }, [activeRuntime?.chatMessages, busy, optimisticUserBubble, sending]);

  const currentSessionLabel = useMemo(() => {
    if (!selectedSessionKey.trim()) {
      return "";
    }
    const row = snapshot?.sessionsResult?.sessions?.find((s) => s.key === selectedSessionKey);
    const label = sanitizeUserChatDisplayText((row?.label ?? "").trim());
    return label || selectedSessionKey;
  }, [selectedSessionKey, snapshot?.sessionsResult?.sessions]);

  const followBottomRef = useRef(true);
  const [tailGapPx, setTailGapPx] = useState(0);

  const measureTailGap = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, []);

  const syncScrollGap = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const gap = measureTailGap(el);
    followBottomRef.current = gap <= SCROLL_BOTTOM_THRESHOLD_PX;
    setTailGapPx(gap);
  }, [measureTailGap]);

  const scrollViewportToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = scrollRef.current;
      if (!el) {
        return;
      }
      el.scrollTo({ top: el.scrollHeight, behavior });
      followBottomRef.current = true;
      requestAnimationFrame(() => syncScrollGap());
    },
    [syncScrollGap],
  );

  const onScrollViewport = useCallback(() => {
    syncScrollGap();
  }, [syncScrollGap]);

  /** 切换会话 / 历史加载完成后：默认滚到底并贴底跟随 */
  useLayoutEffect(() => {
    followBottomRef.current = true;
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    requestAnimationFrame(() => syncScrollGap());
  }, [selectedSessionKey, activeRuntime?.chatLoading, syncScrollGap]);

  /** 新消息、工具块等：仅在用户仍在底部时跟随 */
  useEffect(() => {
    if (!followBottomRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    requestAnimationFrame(() => syncScrollGap());
  }, [
    activeRuntime?.chatMessages?.length,
    activeRuntime?.displayToolSteps?.length,
    activeRuntime?.chatStreamSegments?.length,
    optimisticUserBubble?.ts,
    syncScrollGap,
  ]);

  /** 流式 token：贴底时用瞬时滚动，避免长文跟丢 */
  useEffect(() => {
    if (!followBottomRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
    syncScrollGap();
  }, [activeRuntime?.chatStream, syncScrollGap]);

  /** Markdown 排版高度变化（流式阶段常见）：贴底时保持视口在最新内容 */
  useEffect(() => {
    const root = scrollRef.current;
    const col = messagesColumnRef.current;
    if (!root || !col || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const ro = new ResizeObserver(() => {
      if (followBottomRef.current) {
        root.scrollTop = root.scrollHeight;
        syncScrollGap();
      }
    });
    ro.observe(col);
    return () => {
      ro.disconnect();
    };
  }, [
    selectedSessionKey,
    activeRuntime?.chatLoading,
    activeRuntime?.chatMessages?.length,
    syncScrollGap,
  ]);

  /** 内容高度变化时刷新「距底部」距离（上滑读历史时，流式增高会改变是否显示回到底部） */
  useEffect(() => {
    syncScrollGap();
  }, [
    activeRuntime?.chatStream,
    activeRuntime?.chatMessages?.length,
    activeRuntime?.displayToolSteps?.length,
    showAssistantOutput,
    syncScrollGap,
  ]);

  const showJumpToBottom = tailGapPx > SCROLL_BOTTOM_THRESHOLD_PX;

  const resetComposerHeight = () => {
    const t = textareaRef.current;
    if (!t) {
      return;
    }
    t.style.height = "auto";
    t.style.height = `${Math.min(Math.max(t.scrollHeight, 44), 200)}px`;
  };

  const addFilesFromList = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (!files?.length) {
        return;
      }
      const list = Array.from(files);
      const picked: ChatAttachment[] = [];
      const workspacePicked: PendingWorkspaceChatFile[] = [];
      let unsupported = 0;
      let oversizedImages = 0;
      let oversizedFiles = 0;
      for (const file of list) {
        if (!isSupportedChatAttachmentMimeType(file.type)) {
          if (!isSupportedWorkspaceChatFile(file)) {
            unsupported += 1;
            continue;
          }
          if (file.size > MAX_CHAT_WORKSPACE_FILE_BYTES) {
            oversizedFiles += 1;
            continue;
          }
          workspacePicked.push({
            id: crypto.randomUUID(),
            file,
            name: file.name || "attachment",
            size: file.size,
          });
          continue;
        }
        if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
          oversizedImages += 1;
          continue;
        }
        const att = await fileToChatAttachment(file);
        if (att) {
          picked.push(att);
        }
      }
      if (!picked.length && workspacePicked.length === 0) {
        if (unsupported > 0 || oversizedImages > 0 || oversizedFiles > 0) {
          message.warning(
            unsupported > 0
              ? "当前支持图片、文档、表格、演示、文本、音频和视频文件。"
              : oversizedImages > 0
                ? "图片附件不能超过 8 MB。"
                : "工作区文件不能超过 100 MB。",
          );
        }
        return;
      }
      if (picked.length > 0) {
        setPendingAttachments((prev) => {
          const room = MAX_CHAT_ATTACHMENT_COUNT - prev.length;
          if (room <= 0) {
            message.warning(`最多只能附带 ${MAX_CHAT_ATTACHMENT_COUNT} 张图片。`);
            return prev;
          }
          if (picked.length > room) {
            message.warning(`最多只能附带 ${MAX_CHAT_ATTACHMENT_COUNT} 张图片，已自动截取。`);
          }
          return [...prev, ...picked.slice(0, room)];
        });
      }
      if (workspacePicked.length > 0) {
        setPendingWorkspaceFiles((prev) => {
          const room = MAX_CHAT_WORKSPACE_FILE_COUNT - prev.length;
          if (room <= 0) {
            message.warning(`最多只能附带 ${MAX_CHAT_WORKSPACE_FILE_COUNT} 个工作区文件。`);
            return prev;
          }
          if (workspacePicked.length > room) {
            message.warning(
              `最多只能附带 ${MAX_CHAT_WORKSPACE_FILE_COUNT} 个工作区文件，已自动截取。`,
            );
          }
          return [...prev, ...workspacePicked.slice(0, room)];
        });
      }
      if (unsupported > 0 || oversizedImages > 0 || oversizedFiles > 0) {
        message.warning(
          unsupported > 0
            ? "已跳过暂不支持的文件格式。"
            : oversizedImages > 0
              ? "已跳过超过 8 MB 的图片。"
              : "已跳过超过 100 MB 的工作区文件。",
        );
      }
    },
    [message],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void addFilesFromList(e.target.files);
    e.target.value = "";
  };

  const onComposerPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      const itemFiles = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const uniqueFiles = [...files, ...itemFiles].filter(
        (file, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.name === file.name &&
              candidate.size === file.size &&
              candidate.type === file.type,
          ) === index,
      );
      if (uniqueFiles.length === 0) {
        return;
      }
      e.preventDefault();
      void addFilesFromList(uniqueFiles);
    },
    [addFilesFromList],
  );

  const canSend =
    Boolean(draft.trim()) || pendingAttachments.length > 0 || pendingWorkspaceFiles.length > 0;

  const handleSend = async () => {
    if (!canSend || sending) {
      return;
    }
    const outgoingDraft = draft;
    const outgoingAttachments = pendingAttachments;
    const outgoingWorkspaceFiles = pendingWorkspaceFiles;
    const displayText = buildVisibleUserMessage(outgoingDraft, {
      imageCount: outgoingAttachments.length,
      fileNames: outgoingWorkspaceFiles.map((file) => file.name),
    });
    setSending(true);
    setOptimisticUserBubble({
      text: displayText,
      attachmentCount: outgoingAttachments.length + outgoingWorkspaceFiles.length,
      ts: Date.now(),
    });
    setDraft("");
    setPendingAttachments([]);
    setPendingWorkspaceFiles([]);
    requestAnimationFrame(() => {
      resetComposerHeight();
      textareaRef.current?.focus();
      followBottomRef.current = true;
      scrollViewportToBottom("smooth");
    });
    try {
      const uploadAgentId =
        workspaceAgentId ||
        (selectedSessionKey.trim()
          ? (parseAgentSessionKey(selectedSessionKey)?.agentId ?? "")
          : "") ||
        defaultAgentId ||
        agents[0]?.id ||
        "";
      let messageText = outgoingDraft;
      if (outgoingWorkspaceFiles.length > 0) {
        if (!adapter || !uploadAgentId) {
          throw new Error("请先选择或配置项目后再上传文件。");
        }
        const chatUploadPath = buildChatUploadFolder(selectedSessionKey);
        const chatUploadFolderName = chatUploadPath.slice(`${CHAT_UPLOADS_ROOT}/`.length);
        await adapter.createProjectFolder(uploadAgentId, null, CHAT_UPLOADS_ROOT).catch(() => {});
        await adapter
          .createProjectFolder(uploadAgentId, CHAT_UPLOADS_ROOT, chatUploadFolderName)
          .catch(() => {});
        const uploaded = await adapter.uploadProjectFiles(
          uploadAgentId,
          chatUploadPath,
          outgoingWorkspaceFiles.map(
            (entry): WorkbenchUploadedFile => ({
              name: entry.name,
              file: entry.file,
            }),
          ),
        );
        messageText = appendUploadedFilesToMessage(messageText, uploaded);
        setWorkspaceFilesReloadToken((n) => n + 1);
      }
      const sent = await sendUserMessage(
        messageText,
        outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
        { displayText },
      );
      if (!sent) {
        message.warning("网关或项目还没准备好，请稍后再试。");
        setDraft(outgoingDraft);
        setPendingAttachments(outgoingAttachments);
        setPendingWorkspaceFiles(outgoingWorkspaceFiles);
        setOptimisticUserBubble(null);
        return;
      }
      requestAnimationFrame(() => {
        resetComposerHeight();
        textareaRef.current?.focus();
        followBottomRef.current = true;
        scrollViewportToBottom("smooth");
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "发送失败，请稍后再试。");
      setDraft(outgoingDraft);
      setPendingAttachments(outgoingAttachments);
      setPendingWorkspaceFiles(outgoingWorkspaceFiles);
      setOptimisticUserBubble(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <main className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] bg-white">
        <header className="power-chat-page-header flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/35 bg-white/95 px-5 backdrop-blur">
          <div className="min-w-0 flex-1 pt-0.5">
            {currentSessionLabel ? (
              <>
                <p className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900 sm:text-base">
                  {currentSessionLabel}
                </p>
                {runStatusHint ? (
                  <p className="truncate text-xs text-slate-500" aria-live="polite">
                    {runStatusHint}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="truncate text-sm text-slate-500">新建或选择会话以开始</p>
            )}
          </div>
        </header>

        <div className="relative flex min-h-0 min-w-0 bg-white">
          <div className="power-chat-stage grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] transition-[flex] duration-300 ease-out">
            <div className="relative min-h-0 min-w-0 overflow-hidden">
              <div
                ref={scrollRef}
                onScroll={onScrollViewport}
                className="power-chat-scroll h-full max-h-full min-h-0 overflow-y-auto overscroll-y-contain bg-transparent px-3 pb-4 pt-5 sm:px-7"
              >
                {errorText ? (
                  <div
                    role="alert"
                    className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                  >
                    {errorText}
                    {runActive ? (
                      <span className="mt-1 block text-xs text-red-800/90">
                        生成已中断，可修改问题后重新发送。
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {selectedSessionKey && activeRuntime?.chatLoading ? (
                  <div
                    className="mx-auto max-w-3xl space-y-3 py-8"
                    aria-busy="true"
                    aria-label="加载消息"
                  >
                    <div className="h-4 w-2/3 animate-pulse rounded-lg bg-slate-200/90" />
                    <div className="ml-auto h-4 w-1/2 max-w-xs animate-pulse rounded-lg bg-slate-200/90" />
                  </div>
                ) : (
                  <div
                    ref={messagesColumnRef}
                    className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-2 py-4 sm:px-3"
                  >
                    {leadMessages.map((msg, i) =>
                      renderChatMessageBubble(
                        msg,
                        `lead-${i}-${isRenderableChatMessage(msg) && typeof msg.timestamp === "number" ? msg.timestamp : i}`,
                      ),
                    )}
                    {optimisticUserBubble &&
                    !(activeRuntime?.chatMessages ?? []).some((m) => {
                      if (!isRenderableChatMessage(m)) {
                        return false;
                      }
                      const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
                      if (role !== "user") {
                        return false;
                      }
                      return (extractText(m) ?? "").trim() === optimisticUserBubble.text.trim();
                    }) ? (
                      <div className="flex w-full justify-end">
                        <div className="max-w-[min(100%,42rem)] rounded-2xl rounded-br-md bg-[#fbfbfa] px-3 py-2 text-sm leading-snug text-slate-900 ring-1 ring-slate-200/60">
                          <span className="whitespace-pre-wrap break-words">
                            {optimisticUserBubble.text || "（仅附件消息）"}
                          </span>
                          {optimisticUserBubble.attachmentCount > 0 ? (
                            <span className="mt-1 block text-[11px] text-slate-500">
                              已附带 {optimisticUserBubble.attachmentCount} 个文件
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {visibleStreamSegments.map((seg, i) => (
                      <div key={`seg-${seg.ts}-${i}`} className="flex w-full justify-start">
                        <div className="max-w-[min(100%,42rem)] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200/50">
                          <ChatMarkdownBody
                            className="chat-markdown break-words text-sm leading-snug text-slate-700 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                            source={sanitizeChatDisplayText(seg.text)}
                          />
                        </div>
                      </div>
                    ))}
                    {showAssistantActivityCard ? (
                      <ChatToolStepsList
                        steps={visibleToolSteps}
                        phase={toolStepsPhase}
                        fitContent={
                          visibleToolSteps.length === 0 && awaitingFirstToken && !showStream
                        }
                      >
                        {awaitingFirstToken && visibleToolSteps.length === 0 ? (
                          <div
                            className="flex items-center gap-2 py-1"
                            aria-live="polite"
                            aria-busy="true"
                          >
                            <span className="text-sm text-slate-600">正在等待回复</span>
                            <TypingDots />
                          </div>
                        ) : null}
                        {showStream ? (
                          <>
                            <ChatMarkdownBody
                              className="chat-markdown break-words text-sm leading-snug text-slate-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                              source={sanitizeChatDisplayText(liveStreamText)}
                            />
                            <span
                              className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-middle opacity-70"
                              aria-hidden
                            />
                          </>
                        ) : null}
                      </ChatToolStepsList>
                    ) : null}
                    {tailAssistantMessages.map((msg, i) =>
                      renderChatMessageBubble(
                        msg,
                        `tail-${i}-${isRenderableChatMessage(msg) && typeof msg.timestamp === "number" ? msg.timestamp : i}`,
                      ),
                    )}
                  </div>
                )}
              </div>
              {selectedSessionKey && activeRuntime?.chatLoading !== true && showJumpToBottom ? (
                <button
                  type="button"
                  className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-md shadow-slate-300/25 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60 sm:right-6"
                  aria-label="回到底部查看最新内容"
                  onClick={() => scrollViewportToBottom("smooth")}
                >
                  <span className="text-sm leading-none text-slate-500" aria-hidden>
                    ↓
                  </span>
                  回到底部
                </button>
              ) : null}
            </div>

            <div className="power-composer-fade relative shrink-0 px-3 pb-6 pt-9 sm:px-6 sm:pb-8 sm:pt-10">
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept={activeFileAccept}
                multiple
                aria-hidden
                tabIndex={-1}
                onChange={onFileInputChange}
              />
              <div className="mx-auto w-full max-w-[760px]">
                {catalogImageSupport === "no" && pendingAttachments.length > 0 ? (
                  <div
                    role="status"
                    className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-950"
                  >
                    当前模型在网关中标记为<strong className="font-semibold">不支持图片输入</strong>
                    ，附件可能被丢弃。请改用目录中带「image」能力的模型后再发图。
                  </div>
                ) : null}
                {catalogImageSupport === "unknown" && pendingAttachments.length > 0 ? (
                  <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-snug text-slate-700">
                    无法从模型目录确认是否支持图片。若助手仍称未收到图，请换用已知支持视觉的模型或升级网关。
                  </div>
                ) : null}
                {pendingAttachments.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm"
                      >
                        <img src={att.dataUrl} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label="移除图片"
                          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded bg-slate-900/70 text-xs text-white opacity-0 transition-opacity hover:bg-slate-900 group-hover:opacity-100"
                          onClick={() =>
                            setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {pendingWorkspaceFiles.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingWorkspaceFiles.map((file) => (
                      <div
                        key={file.id}
                        className="group flex max-w-[220px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700 shadow-sm"
                        title={`${file.name} · ${formatBytes(file.size)}`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-[11px] font-semibold uppercase text-slate-500 ring-1 ring-slate-200">
                          {fileExtension(file.name).slice(0, 4) || "file"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-slate-800">
                            {file.name}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {formatBytes(file.size)} · 发送前作为对话附件上传
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-label={`移除 ${file.name}`}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-800"
                          onClick={() =>
                            setPendingWorkspaceFiles((prev) =>
                              prev.filter((entry) => entry.id !== file.id),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "power-surface flex items-end gap-2 rounded-[26px] border px-2.5 py-2 transition-[box-shadow,border-color,transform] sm:gap-2.5 sm:px-3 sm:py-2.5",
                    "focus-within:border-slate-400/45 focus-within:shadow-xl focus-within:shadow-slate-300/25 focus-within:ring-1 focus-within:ring-slate-300/60 focus-within:ring-offset-0",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void addFilesFromList(e.dataTransfer?.files);
                  }}
                >
                  <button
                    type="button"
                    title={`支持图片直发；文档、表格、演示、文本、音频、视频会作为本次对话附件上传到隐藏目录，不显示在右侧最近修改。图片最多 ${MAX_CHAT_ATTACHMENT_COUNT} 张，其他文件最多 ${MAX_CHAT_WORKSPACE_FILE_COUNT} 个。`}
                    disabled={
                      (pendingAttachments.length >= MAX_CHAT_ATTACHMENT_COUNT &&
                        pendingWorkspaceFiles.length >= MAX_CHAT_WORKSPACE_FILE_COUNT) ||
                      sending ||
                      busy
                    }
                    onClick={() => fileInputRef.current?.click()}
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ClipIcon className="h-5 w-5" />
                  </button>
                  <textarea
                    ref={textareaRef}
                    id="chat-composer"
                    rows={1}
                    placeholder={
                      defaultAgentId || agents[0] ? "有问题，尽管问…" : "请先在设置里配置网关与助手"
                    }
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      requestAnimationFrame(resetComposerHeight);
                    }}
                    onInput={(e) => {
                      const t = e.target as HTMLTextAreaElement;
                      t.style.height = "auto";
                      t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
                    }}
                    onPaste={onComposerPaste}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (busy) {
                          return;
                        }
                        void handleSend();
                      }
                    }}
                    disabled={sending}
                    className="max-h-[200px] min-h-[40px] w-full resize-none bg-transparent py-2.5 text-[15px] text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:outline-none focus-visible:outline-none disabled:opacity-50"
                  />
                  <div className="mb-0.5 hidden shrink-0 items-center sm:flex">
                    <ChatModelPicker
                      models={configuredModels}
                      valueRef={effectiveModelRef}
                      onChange={handleModelChange}
                      disabled={sending || !configuredModels.length}
                      placement="top"
                      compact
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={busy ? "停止生成" : "发送"}
                    disabled={busy ? false : !canSend || sending}
                    onClick={() => (busy ? void stopGeneration() : void handleSend())}
                    className={cn(
                      "mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
                      busy
                        ? "border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 focus-visible:ring-rose-300/50 enabled:active:scale-95"
                        : canSend && !sending
                          ? cn(
                              "shadow-sm shadow-slate-300/35 enabled:active:scale-95",
                              "focus-visible:ring-slate-300/60",
                              BRAND.primary,
                              BRAND.primaryText,
                            )
                          : "power-composer-send--idle disabled:cursor-not-allowed",
                    )}
                  >
                    {busy ? (
                      <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
                    ) : sending ? (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
                        aria-hidden
                      />
                    ) : (
                      <ArrowUpOutlined className="text-[13px]" aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {workspaceRailEligible ? (
            <aside
              className={cn(
                "power-workspace-rail block min-h-0 shrink-0 overflow-hidden border-l border-slate-200/45 bg-white",
                workspacePreviewActive
                  ? "power-workspace-rail--preview"
                  : "power-workspace-rail--list",
                "power-workspace-rail--open",
                workspacePreviewFullscreen && "power-workspace-rail--fullscreen",
              )}
              aria-hidden={false}
            >
              <div className="power-workspace-rail__inner">
                {adapter ? (
                  <ChatWorkspaceFilesPanel
                    adapter={adapter}
                    agentId={workspaceAgentId}
                    showToolbar={false}
                    onPreviewActiveChange={setWorkspacePreviewActive}
                    reloadToken={workspaceFilesReloadToken}
                    canFullscreen={workspaceCanFullscreen}
                    previewFullscreen={workspacePreviewFullscreen}
                    onToggleFullscreen={toggleWorkspacePreviewFullscreen}
                  />
                ) : (
                  <div className="flex h-full flex-col bg-[#fafafa] px-4 py-5 text-sm text-slate-500">
                    <div className="mb-2 text-[13px] font-semibold text-slate-800">最近修改</div>
                    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-xs leading-relaxed">
                      正在连接工作区文件服务…
                    </div>
                  </div>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
