import { useCallback, useEffect, useRef, useState } from "react";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";
import type { ChatAttachment } from "../../../../ui/src/ui/ui-types";
import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { WorkbenchSnapshot } from "../../adapters/mock-workbench-adapter";
import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter";
import { extractText } from "../../compat/chat";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatState,
} from "../../compat/controllers";
import type { GatewayBrowserClient } from "../../compat/gateway";
import type { UiSettings } from "../../compat/ui-core";
import {
  flushToolStreamSync,
  handleAgentEvent,
  loadSettings,
  resetToolStream,
  type ToolStreamEntry,
} from "../../compat/ui-core";
import {
  buildPowerQuickSessionKey,
  buildPowerSessionKey,
  buildSessionLabelFromPrompt,
  buildUniqueSessionLabel,
  isPowerQuickSessionKey,
} from "../../integrations/openclaw/session-keys";
import { shouldHideChatMessage } from "../lib/chat-message-visibility";
import {
  trimCommittedPrefixFromChatMessage,
  trimCommittedPrefixFromText,
} from "../lib/chat-stream-prefix";
import {
  buildChatToolSteps,
  finalizeChatToolStepsForRunEnd,
  mergeStableChatToolSteps,
  type ChatToolStep,
} from "../lib/chat-tool-status";
import { resolveChatModelPool, resolveEffectiveChatModelRef } from "../lib/configured-chat-models";

const DEFAULT_ATTACHMENT_PROMPT = "请阅读以下附件并回答。";

const CHAT_ATTACHMENT_CONTEXT_PATTERNS = [
  /\s*本轮对话附件：[\s\S]*?(?:请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。|$)/g,
  /\s*已上传到当前工作区的附件：[\s\S]*?(?:请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。|$)/g,
];

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

function stripInternalAttachmentContext(text: string) {
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

function cleanChatMessageForDisplay(message: unknown): unknown {
  if (!message || typeof message !== "object") {
    return message;
  }
  const role =
    typeof (message as { role?: unknown }).role === "string"
      ? (message as { role: string }).role.toLowerCase()
      : "";
  if (role !== "user") {
    return message;
  }
  const record = message as Record<string, unknown>;
  if (typeof record.content === "string") {
    const cleaned = stripInternalAttachmentContext(record.content);
    return cleaned === record.content ? message : { ...record, content: cleaned };
  }
  if (typeof record.text === "string") {
    const cleaned = stripInternalAttachmentContext(record.text);
    return cleaned === record.text ? message : { ...record, text: cleaned };
  }
  return message;
}

function isApprovalCommandLeak(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const role =
    typeof (message as { role?: unknown }).role === "string"
      ? (message as { role: string }).role.toLowerCase()
      : "";
  if (role !== "assistant") {
    return false;
  }
  const text = extractText(message)?.trim() ?? "";
  if (!text || !text.includes("/approve ")) {
    return false;
  }
  return /^these are .*requests?[\s\S]*\n\s*(?:\/approve\s+[a-z0-9-]+\s+allow-once\s*)+$/i.test(
    text,
  );
}

function filterVisibleChatMessages(messages: unknown[]): unknown[] {
  return messages
    .filter(
      (message) =>
        message != null &&
        typeof message === "object" &&
        !isApprovalCommandLeak(message) &&
        !shouldHideChatMessage(message, { showToolCalls: false }),
    )
    .map(cleanChatMessageForDisplay);
}

type SessionRuntimeState = ChatState & {
  toolStreamSyncTimer: number | null;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  /** 保留上一轮工具步骤供 UI 展示（避免 resetToolStream 后瞬间消失） */
  displayToolSteps: ChatToolStep[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatCommittedToolPrefix: string;
};

function syncDisplayToolSteps(rt: SessionRuntimeState) {
  const live = buildChatToolSteps(rt.chatToolMessages);
  if (live.length > 0) {
    rt.displayToolSteps = mergeStableChatToolSteps(rt.displayToolSteps, live);
  }
}

function finalizeDisplayToolSteps(rt: SessionRuntimeState) {
  if (rt.displayToolSteps.length === 0) {
    return;
  }
  rt.displayToolSteps = finalizeChatToolStepsForRunEnd(rt.displayToolSteps);
}

function createControllerClient(adapter: GatewayWorkbenchAdapter): GatewayBrowserClient {
  return {
    request: async <T>(method: string, params?: unknown) => adapter.request<T>(method, params),
  } as GatewayBrowserClient;
}

function createRuntime(
  sessionKey: string,
  client: GatewayBrowserClient | null,
): SessionRuntimeState {
  return {
    client,
    connected: false,
    sessionKey,
    chatLoading: false,
    chatMessages: [],
    chatThinkingLevel: null,
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    lastError: null,
    toolStreamSyncTimer: null,
    toolStreamById: new Map(),
    toolStreamOrder: [],
    chatToolMessages: [],
    displayToolSteps: [],
    chatStreamSegments: [],
    chatCommittedToolPrefix: "",
  };
}

function pickModelId(snapshot: WorkbenchSnapshot | null, fallback: string): string {
  const models = snapshot?.modelCatalog ?? [];
  const first = models.find((m) => typeof m.id === "string" && m.id.trim());
  return first?.id.trim() || fallback;
}

// Keep long-running MCP/tool calls visible; backend timeouts still own actual cancellation.
const CHAT_RUN_STALE_MS = 20 * 60 * 1000;

function finalizeChatRun(rt: SessionRuntimeState) {
  rt.chatRunId = null;
  rt.chatSending = false;
  rt.chatStream = null;
  rt.chatStreamStartedAt = null;
}

function resolveModelIdForSend(
  snapshot: WorkbenchSnapshot | null,
  fallback: string,
  sessionKey: string,
  projectId: string | null,
): string {
  const pool = resolveChatModelPool(snapshot, projectId, sessionKey);
  const ref = resolveEffectiveChatModelRef({
    snapshot,
    sessionKey,
    chatPreferredModelRef: loadSettings().chatPreferredModelRef,
    configuredModels: pool,
  });
  return ref.trim() || pickModelId(snapshot, fallback);
}

export function usePowerWorkbenchChat(
  adapter: GatewayWorkbenchAdapter | null,
  patchSettings: (patch: Partial<UiSettings>) => void,
  userScope = "",
) {
  const [, bump] = useState(0);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const bumpRuntime = useCallback(() => {
    bump((n) => n + 1);
  }, []);
  const bumpSessionsVersion = useCallback(() => {
    setSessionsVersion((n) => n + 1);
  }, []);

  const clientRef = useRef<GatewayBrowserClient | null>(null);
  const runtimesRef = useRef(new Map<string, SessionRuntimeState>());
  const snapshotRef = useRef<WorkbenchSnapshot | null>(null);
  const snapshotErrorRef = useRef<string | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const selectedSessionKeyRef = useRef("");
  const quickChatDraftRef = useRef(false);
  const sessionProjectDetachedRef = useRef(false);
  const detachedSessionKeysRef = useRef(new Set<string>());
  const refreshSnapshotSeqRef = useRef(0);
  const selectSessionSeqRef = useRef(0);
  const emptyHistoryReloadAttemptsRef = useRef(new Map<string, number>());

  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState("");
  const [sessionProjectDetached, setSessionProjectDetached] = useState(false);

  const setDetachedSessionProject = useCallback((detached: boolean) => {
    sessionProjectDetachedRef.current = detached;
    setSessionProjectDetached(detached);
  }, []);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
    selectedSessionKeyRef.current = selectedSessionKey;
  }, [selectedProjectId, selectedSessionKey]);

  useEffect(() => {
    if (!adapter) {
      clientRef.current = null;
      return;
    }
    clientRef.current = createControllerClient(adapter);
  }, [adapter]);

  const getOrCreateRuntime = useCallback(
    (sessionKey: string): SessionRuntimeState => {
      const trimmed = sessionKey.trim();
      const map = runtimesRef.current;
      let row = map.get(trimmed);
      if (!row) {
        row = createRuntime(trimmed, clientRef.current);
        map.set(trimmed, row);
      }
      row.client = clientRef.current;
      row.connected = connected;
      row.sessionKey = trimmed;
      return row;
    },
    [connected],
  );

  const refreshSnapshot = useCallback(
    async (
      selection?: {
        projectId: string | null;
        sessionKey: string | null;
        skipProjectDefault?: boolean;
        skipSessionProject?: boolean;
      },
      options?: { reloadChatHistory?: boolean; forceReplaceChatHistory?: boolean },
    ) => {
      if (!adapter) {
        return;
      }
      const projectId =
        selection && "projectId" in selection ? selection.projectId : selectedProjectIdRef.current;
      const sessionKey =
        selection && "sessionKey" in selection
          ? selection.sessionKey
          : selectedSessionKeyRef.current;
      const skipProjectDefault = selection?.skipProjectDefault === true;
      const skipSessionProject = selection?.skipSessionProject === true;

      const reloadChatHistory = options?.reloadChatHistory !== false;
      const forceReplaceChatHistory = options?.forceReplaceChatHistory === true;
      const requestedSessionKey =
        selection && "sessionKey" in selection ? (selection.sessionKey?.trim() ?? "") : "";
      const requestSeq = ++refreshSnapshotSeqRef.current;

      setSnapshotLoading(true);
      setSnapshotError(null);
      snapshotErrorRef.current = null;
      try {
        const snap = await adapter.snapshot({
          projectId,
          sessionKey,
          skipProjectDefault,
          skipSessionProject,
        });
        if (requestSeq !== refreshSnapshotSeqRef.current) {
          return;
        }
        snapshotRef.current = snap;
        setSnapshot(snap);
        const requestedSessionVisible = requestedSessionKey
          ? (snap.sessionsResult?.sessions ?? []).some(
              (session) => session.key === requestedSessionKey,
            )
          : false;
        const key =
          snap.currentSessionKey?.trim() || (requestedSessionVisible ? requestedSessionKey : "");
        const detachedSelection =
          skipProjectDefault ||
          skipSessionProject ||
          (key ? isPowerQuickSessionKey(key) || detachedSessionKeysRef.current.has(key) : false);
        const nextProjectId = detachedSelection ? null : snap.currentProjectId;
        setSelectedProjectId(nextProjectId);
        selectedProjectIdRef.current = nextProjectId;
        setSelectedSessionKey(key);
        selectedSessionKeyRef.current = key;
        if (key) {
          if (detachedSelection) {
            detachedSessionKeysRef.current.add(key);
          } else {
            detachedSessionKeysRef.current.delete(key);
          }
          setDetachedSessionProject(detachedSelection || !nextProjectId);
          patchSettings({ sessionKey: key, lastActiveSessionKey: key });
          const rt = getOrCreateRuntime(key);
          rt.sessionKey = key;
          const snapshotMessages = filterVisibleChatMessages(
            Array.isArray(snap.chatMessages) ? snap.chatMessages : [],
          );
          const runtimeUserCount = rt.chatMessages.filter(
            (message) =>
              message != null &&
              typeof message === "object" &&
              typeof (message as { role?: unknown }).role === "string" &&
              (message as { role: string }).role.toLowerCase() === "user",
          ).length;
          const snapshotUserCount = snapshotMessages.filter(
            (message) =>
              message != null &&
              typeof message === "object" &&
              typeof (message as { role?: unknown }).role === "string" &&
              (message as { role: string }).role.toLowerCase() === "user",
          ).length;
          const shouldPreserveLocalChatState =
            !forceReplaceChatHistory &&
            reloadChatHistory &&
            (snapshotMessages.length === 0 ||
              (runtimeUserCount > snapshotUserCount && rt.chatMessages.length > 0)) &&
            (rt.chatMessages.length > 0 ||
              rt.chatSending ||
              Boolean(rt.chatRunId) ||
              Boolean(rt.chatStream?.trim()));
          const hasActiveLocalRun =
            rt.chatSending || Boolean(rt.chatRunId) || Boolean(rt.chatStream?.trim());
          if (reloadChatHistory && !shouldPreserveLocalChatState) {
            if (snapshotMessages.length > 0) {
              rt.chatMessages = snapshotMessages;
            } else {
              await loadChatHistory(rt);
            }
            finalizeChatRun(rt);
          } else if (!reloadChatHistory && snapshotMessages.length > 0 && !hasActiveLocalRun) {
            rt.chatMessages = snapshotMessages;
            finalizeChatRun(rt);
          }
          rt.chatLoading = false;
        } else {
          patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
        }
        bumpSessionsVersion();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        snapshotErrorRef.current = message;
        setSnapshotError(message);
        const failedKey = (
          selection && "sessionKey" in selection
            ? selection.sessionKey
            : selectedSessionKeyRef.current
        )?.trim();
        if (failedKey) {
          const rt = runtimesRef.current.get(failedKey);
          if (rt) {
            rt.chatLoading = false;
          }
        }
      } finally {
        if (requestSeq === refreshSnapshotSeqRef.current) {
          setSnapshotLoading(false);
          bumpRuntime();
        }
      }
    },
    [
      adapter,
      bumpRuntime,
      bumpSessionsVersion,
      getOrCreateRuntime,
      patchSettings,
      setDetachedSessionProject,
    ],
  );

  const refreshSnapshotRef = useRef(refreshSnapshot);
  refreshSnapshotRef.current = refreshSnapshot;

  useEffect(() => {
    if (!adapter) {
      return;
    }
    const scoped = loadSettings();
    const preferred = scoped.lastActiveSessionKey.trim() || scoped.sessionKey.trim() || null;
    if (preferred) {
      detachedSessionKeysRef.current.add(preferred);
    }
    setDetachedSessionProject(Boolean(preferred));
    void refreshSnapshotRef.current({
      projectId: null,
      sessionKey: preferred,
      skipProjectDefault: Boolean(preferred),
      skipSessionProject: Boolean(preferred),
    });
  }, [adapter, setDetachedSessionProject]);

  useEffect(() => {
    if (!adapter) {
      return undefined;
    }
    return adapter.subscribe((event: WorkbenchAdapterEvent) => {
      try {
        if (event.type === "connection") {
          setConnected(event.connected);
          for (const rt of runtimesRef.current.values()) {
            rt.connected = event.connected;
          }
          bumpRuntime();
          if (event.connected) {
            const key = selectedSessionKeyRef.current.trim();
            if (!snapshotRef.current || snapshotErrorRef.current) {
              const scoped = loadSettings();
              const preferred =
                key || scoped.lastActiveSessionKey.trim() || scoped.sessionKey.trim() || null;
              const detached =
                Boolean(preferred) &&
                (!selectedProjectIdRef.current ||
                  sessionProjectDetachedRef.current ||
                  isPowerQuickSessionKey(preferred) ||
                  detachedSessionKeysRef.current.has(preferred));
              void refreshSnapshotRef.current({
                projectId: detached ? null : selectedProjectIdRef.current,
                sessionKey: preferred,
                skipProjectDefault: detached,
                skipSessionProject: detached,
              });
            }
            if (key) {
              void loadChatHistory(getOrCreateRuntime(key));
            }
          }
          return;
        }

        if (event.type === "agent") {
          const sessionKey =
            typeof event.payload.sessionKey === "string" ? event.payload.sessionKey.trim() : "";
          if (sessionKey) {
            const rt = getOrCreateRuntime(sessionKey);
            handleAgentEvent(rt as Parameters<typeof handleAgentEvent>[0], event.payload);
            rt.chatCommittedToolPrefix = rt.chatStreamSegments.map((entry) => entry.text).join("");
            syncDisplayToolSteps(rt);
            bumpRuntime();
          } else {
            for (const rt of runtimesRef.current.values()) {
              handleAgentEvent(rt as Parameters<typeof handleAgentEvent>[0], event.payload);
              rt.chatCommittedToolPrefix = rt.chatStreamSegments
                .map((entry) => entry.text)
                .join("");
              syncDisplayToolSteps(rt);
            }
            bumpRuntime();
          }
          return;
        }

        if (event.type !== "chat") {
          return;
        }

        const rt = getOrCreateRuntime(event.sessionKey);
        const projectId =
          parseAgentSessionKey(event.sessionKey)?.agentId ?? selectedProjectIdRef.current;
        const hadToolEventsBeforeChatEvent = rt.toolStreamOrder.length > 0;
        const payloadMessage = trimCommittedPrefixFromChatMessage(
          event.message,
          rt.chatCommittedToolPrefix,
          event.state,
        );
        const previousMessageCount = rt.chatMessages.length;
        const nextState = handleChatEvent(rt, {
          runId: event.runId ?? "",
          sessionKey: event.sessionKey,
          state: event.state,
          message: payloadMessage,
          errorMessage: event.errorMessage ?? undefined,
        });
        if (event.state === "delta" && rt.chatStream) {
          rt.chatStream = trimCommittedPrefixFromText(rt.chatStream, rt.chatCommittedToolPrefix);
        }
        if (
          event.state === "final" &&
          hadToolEventsBeforeChatEvent &&
          rt.chatMessages.length > previousMessageCount
        ) {
          rt.chatMessages = rt.chatMessages.slice(0, previousMessageCount);
        }
        bumpRuntime();

        const isTerminalState =
          nextState === "final" || nextState === "aborted" || nextState === "error";
        if (!isTerminalState) {
          return;
        }

        finalizeChatRun(rt);

        const toolHost = rt as Parameters<typeof resetToolStream>[0];
        const hadToolEvents = toolHost.toolStreamOrder.length > 0;
        flushToolStreamSync(toolHost);
        syncDisplayToolSteps(rt);
        if (hadToolEvents) {
          finalizeDisplayToolSteps(rt);
        }
        const refreshPromise =
          nextState === "final"
            ? refreshSnapshotRef.current({
                projectId,
                sessionKey: event.sessionKey,
              })
            : Promise.resolve();

        if (nextState === "final" && hadToolEvents) {
          void refreshPromise.finally(() => {
            resetToolStream(toolHost);
            rt.chatCommittedToolPrefix = "";
            bumpRuntime();
          });
          return;
        }

        resetToolStream(toolHost);
        rt.chatCommittedToolPrefix = "";
        bumpRuntime();
        void refreshPromise;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const key = selectedSessionKeyRef.current.trim();
        if (key) {
          const rt = runtimesRef.current.get(key);
          if (rt) {
            finalizeChatRun(rt);
            rt.lastError = message;
            bumpRuntime();
          }
        }
      }
    });
  }, [adapter, bumpRuntime, getOrCreateRuntime]);

  const activeRuntime =
    selectedSessionKey.trim().length > 0 ? getOrCreateRuntime(selectedSessionKey.trim()) : null;

  useEffect(() => {
    const key = selectedSessionKey.trim();
    if (!key || !connected) {
      return;
    }
    const rt = runtimesRef.current.get(key);
    if (!rt) {
      return;
    }
    const hasLocalActivity =
      rt.chatLoading ||
      rt.chatSending ||
      Boolean(rt.chatRunId) ||
      Boolean(rt.chatStream?.trim()) ||
      rt.chatMessages.length > 0;
    if (rt.chatMessages.length > 0) {
      emptyHistoryReloadAttemptsRef.current.delete(key);
    }
    if (hasLocalActivity) {
      return;
    }
    const attempts = emptyHistoryReloadAttemptsRef.current.get(key) ?? 0;
    if (attempts >= 1) {
      return;
    }
    emptyHistoryReloadAttemptsRef.current.set(key, attempts + 1);
    void loadChatHistory(rt).finally(() => {
      bumpRuntime();
    });
  }, [
    selectedSessionKey,
    connected,
    activeRuntime?.chatLoading,
    activeRuntime?.chatSending,
    activeRuntime?.chatRunId,
    activeRuntime?.chatStream,
    activeRuntime?.chatMessages.length,
    bumpRuntime,
  ]);

  useEffect(() => {
    const key = selectedSessionKey.trim();
    if (!key) {
      return undefined;
    }
    const rt = runtimesRef.current.get(key);
    if (!rt?.chatRunId) {
      return undefined;
    }
    const startedAt = rt.chatStreamStartedAt ?? Date.now();
    const delay = Math.max(0, CHAT_RUN_STALE_MS - (Date.now() - startedAt));
    const timer = window.setTimeout(() => {
      const current = runtimesRef.current.get(key);
      if (!current?.chatRunId) {
        return;
      }
      finalizeChatRun(current);
      current.lastError = current.lastError ?? "回复超时，请重试或点击停止。";
      bumpRuntime();
      void loadChatHistory(current).then(() => {
        finalizeChatRun(current);
        bumpRuntime();
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [selectedSessionKey, activeRuntime?.chatRunId, bumpRuntime]);

  const selectSession = useCallback(
    async (
      sessionKey: string,
      projectId: string | null,
      options?: { skipSessionProject?: boolean },
    ) => {
      if (!adapter) {
        return;
      }
      const key = sessionKey.trim();
      if (!key) {
        return;
      }
      const selectSeq = ++selectSessionSeqRef.current;
      quickChatDraftRef.current = false;
      const skipSessionProject = options?.skipSessionProject === true;
      const projectIdForSelection =
        isPowerQuickSessionKey(key) || skipSessionProject ? null : projectId;
      const detachedSelection = isPowerQuickSessionKey(key) || skipSessionProject;
      if (detachedSelection) {
        detachedSessionKeysRef.current.add(key);
      } else {
        detachedSessionKeysRef.current.delete(key);
      }
      setDetachedSessionProject(detachedSelection);
      patchSettings({ sessionKey: key, lastActiveSessionKey: key });
      setSelectedSessionKey(key);
      setSelectedProjectId(projectIdForSelection);
      selectedSessionKeyRef.current = key;
      selectedProjectIdRef.current = projectIdForSelection;
      const rt = getOrCreateRuntime(key);
      rt.sessionKey = key;
      rt.client = clientRef.current;
      rt.connected = connected;
      rt.chatLoading = true;
      bumpRuntime();
      if (clientRef.current && connected) {
        try {
          await loadChatHistory(rt);
          finalizeChatRun(rt);
          bumpRuntime();
        } catch {
          // full snapshot refresh may still recover history
        }
      }
      if (selectSeq !== selectSessionSeqRef.current || selectedSessionKeyRef.current !== key) {
        rt.chatLoading = false;
        bumpRuntime();
        return;
      }
      rt.chatLoading = false;
      bumpRuntime();
      await refreshSnapshot(
        {
          projectId: projectIdForSelection,
          sessionKey: key,
          skipProjectDefault: isPowerQuickSessionKey(key) || skipSessionProject,
          skipSessionProject,
        },
        {
          reloadChatHistory: rt.chatMessages.length === 0,
          forceReplaceChatHistory: true,
        },
      );
      if (selectSeq !== selectSessionSeqRef.current || selectedSessionKeyRef.current !== key) {
        return;
      }
      const snap = snapshotRef.current;
      if (snap) {
        const pool = resolveChatModelPool(snap, projectIdForSelection, key);
        const effective = resolveEffectiveChatModelRef({
          snapshot: snap,
          sessionKey: key,
          chatPreferredModelRef: loadSettings().chatPreferredModelRef,
          configuredModels: pool,
        });
        if (effective) {
          patchSettings({ chatPreferredModelRef: effective });
        }
      }
    },
    [
      adapter,
      connected,
      bumpRuntime,
      getOrCreateRuntime,
      patchSettings,
      refreshSnapshot,
      setDetachedSessionProject,
    ],
  );

  const sendUserMessage = useCallback(
    async (
      text: string,
      attachments?: ChatAttachment[],
      options?: { displayText?: string },
    ): Promise<boolean> => {
      if (!adapter || !clientRef.current) {
        return false;
      }
      const trimmed = text.trim();
      const displayText = options?.displayText?.trim() ?? trimmed;
      const hasAttachments = Boolean(attachments && attachments.length > 0);
      if (!trimmed && !hasAttachments) {
        return false;
      }
      const quickChatDraft = quickChatDraftRef.current && !selectedSessionKeyRef.current.trim();
      const selectedSessionDetached =
        Boolean(selectedSessionKeyRef.current.trim()) && sessionProjectDetachedRef.current;
      const fallbackProjectId =
        snapshotRef.current?.agentsList?.defaultId ??
        snapshotRef.current?.agentsList?.agents?.[0]?.id ??
        null;
      const projectId = quickChatDraft
        ? fallbackProjectId
        : (selectedProjectIdRef.current ??
          snapshotRef.current?.currentProjectId ??
          fallbackProjectId ??
          null);
      if (!projectId) {
        return false;
      }
      const modelId = resolveModelIdForSend(
        snapshotRef.current,
        adapter.getDefaultModelId(),
        selectedSessionKeyRef.current,
        quickChatDraft ? null : selectedProjectIdRef.current,
      );
      let sessionKey = selectedSessionKeyRef.current.trim();

      if (!sessionKey) {
        const labels = snapshotRef.current?.sessionsResult?.sessions?.map((s) => s.label) ?? [];
        const labelSeed =
          displayText || (hasAttachments ? "图片附件" : trimmed ? trimmed : "文件附件");
        const label = buildUniqueSessionLabel(buildSessionLabelFromPrompt(labelSeed), labels);
        sessionKey = quickChatDraft
          ? buildPowerQuickSessionKey(projectId, userScope)
          : buildPowerSessionKey(projectId, userScope);
        setSelectedSessionKey(sessionKey);
        setSelectedProjectId(quickChatDraft ? null : projectId);
        selectedSessionKeyRef.current = sessionKey;
        selectedProjectIdRef.current = quickChatDraft ? null : projectId;
        setDetachedSessionProject(quickChatDraft);
        quickChatDraftRef.current = false;
        patchSettings({ sessionKey, lastActiveSessionKey: sessionKey });
        const draftRuntime = getOrCreateRuntime(sessionKey);
        draftRuntime.sessionKey = sessionKey;
        draftRuntime.client = clientRef.current;
        draftRuntime.connected = connected;
        draftRuntime.chatLoading = false;
        bumpRuntime();
        const { sessionKey: newKey } = await adapter.startTask(projectId, trimmed, modelId, {
          label,
          quickChat: quickChatDraft,
          sessionKey,
        });
        if (newKey.trim() && newKey.trim() !== sessionKey) {
          runtimesRef.current.delete(sessionKey);
          setSelectedSessionKey(newKey.trim());
          selectedSessionKeyRef.current = newKey.trim();
          patchSettings({ sessionKey: newKey.trim(), lastActiveSessionKey: newKey.trim() });
        }
        sessionKey = newKey.trim();
        bumpSessionsVersion();
      }

      const rt = getOrCreateRuntime(sessionKey);
      rt.sessionKey = sessionKey;
      rt.client = clientRef.current;
      rt.connected = connected;
      rt.displayToolSteps = [];
      if (modelId.trim()) {
        await adapter.request("sessions.patch", { key: sessionKey, model: modelId.trim() });
      }
      const sendPromise = sendChatMessage(rt, trimmed, hasAttachments ? attachments : undefined);
      if (displayText !== trimmed) {
        for (let index = rt.chatMessages.length - 1; index >= 0; index -= 1) {
          const message = rt.chatMessages[index];
          if (
            message &&
            typeof message === "object" &&
            typeof (message as { role?: unknown }).role === "string" &&
            (message as { role: string }).role.toLowerCase() === "user"
          ) {
            rt.chatMessages[index] = {
              ...(message as Record<string, unknown>),
              content: displayText,
            };
            break;
          }
        }
      }
      // sendChatMessage mutates the runtime before the request resolves; render that local
      // user bubble and first-token loading immediately instead of waiting on the network.
      bumpRuntime();
      await sendPromise;
      bumpRuntime();
      const refreshAsDetached =
        isPowerQuickSessionKey(sessionKey) ||
        selectedSessionDetached ||
        sessionProjectDetachedRef.current ||
        detachedSessionKeysRef.current.has(sessionKey);
      if (refreshAsDetached) {
        detachedSessionKeysRef.current.add(sessionKey);
      }
      void refreshSnapshot(
        {
          projectId: refreshAsDetached ? null : projectId,
          sessionKey,
          skipProjectDefault: refreshAsDetached,
          skipSessionProject: refreshAsDetached,
        },
        { reloadChatHistory: false },
      );
      return true;
    },
    [
      adapter,
      bumpRuntime,
      bumpSessionsVersion,
      connected,
      getOrCreateRuntime,
      patchSettings,
      refreshSnapshot,
      setDetachedSessionProject,
    ],
  );

  const stopGeneration = useCallback(async () => {
    const key = selectedSessionKeyRef.current.trim();
    if (!key) {
      return;
    }
    const rt = getOrCreateRuntime(key);
    await abortChatRun(rt);
    bumpRuntime();
    void refreshSnapshot({
      projectId: selectedProjectIdRef.current,
      sessionKey: key,
      skipProjectDefault:
        isPowerQuickSessionKey(key) ||
        sessionProjectDetachedRef.current ||
        detachedSessionKeysRef.current.has(key),
      skipSessionProject:
        isPowerQuickSessionKey(key) ||
        sessionProjectDetachedRef.current ||
        detachedSessionKeysRef.current.has(key),
    });
  }, [bumpRuntime, getOrCreateRuntime, refreshSnapshot]);

  const setActiveAgent = useCallback(
    (projectId: string | null) => {
      quickChatDraftRef.current = false;
      setDetachedSessionProject(false);
      setSelectedProjectId(projectId);
      setSelectedSessionKey("");
      selectedProjectIdRef.current = projectId;
      selectedSessionKeyRef.current = "";
      patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
      void refreshSnapshot({ projectId, sessionKey: null });
    },
    [patchSettings, refreshSnapshot, setDetachedSessionProject],
  );

  const startNewConversation = useCallback(
    (nextProjectId?: string | null, options?: { preferQuickChat?: boolean }) => {
      if (options?.preferQuickChat) {
        quickChatDraftRef.current = true;
        setDetachedSessionProject(true);
        selectedProjectIdRef.current = null;
        setSelectedProjectId(null);
        selectedSessionKeyRef.current = "";
        setSelectedSessionKey("");
        patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
        void refreshSnapshot({
          projectId: null,
          sessionKey: null,
          skipProjectDefault: true,
        });
        return;
      }
      const projectId =
        nextProjectId !== undefined && nextProjectId !== null
          ? nextProjectId
          : (selectedProjectIdRef.current ??
            snapshotRef.current?.currentProjectId ??
            snapshotRef.current?.agentsList?.defaultId ??
            null);
      quickChatDraftRef.current = false;
      setDetachedSessionProject(false);
      if (nextProjectId !== undefined && nextProjectId !== null) {
        setSelectedProjectId(nextProjectId);
        selectedProjectIdRef.current = nextProjectId;
      }
      selectedSessionKeyRef.current = "";
      setSelectedSessionKey("");
      patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
      void refreshSnapshot({ projectId, sessionKey: null });
    },
    [patchSettings, refreshSnapshot, setDetachedSessionProject],
  );

  const reloadActiveChat = useCallback(async () => {
    const key = selectedSessionKeyRef.current.trim();
    if (!key) {
      return;
    }
    await loadChatHistory(getOrCreateRuntime(key));
    bumpRuntime();
  }, [bumpRuntime, getOrCreateRuntime]);

  const deleteCurrentSession = useCallback(async () => {
    if (!adapter) {
      return;
    }
    const key = selectedSessionKeyRef.current.trim();
    if (!key) {
      return;
    }
    await adapter.deleteSession(key);
    runtimesRef.current.delete(key);
    selectedSessionKeyRef.current = "";
    setSelectedSessionKey("");
    patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
    void refreshSnapshot({
      projectId: selectedProjectIdRef.current,
      sessionKey: null,
    });
  }, [adapter, patchSettings, refreshSnapshot]);

  const renameCurrentSession = useCallback(
    async (label: string) => {
      if (!adapter) {
        return;
      }
      const key = selectedSessionKeyRef.current.trim();
      const next = label.trim();
      if (!key || !next) {
        return;
      }
      await adapter.renameSession(key, next);
      const detached =
        isPowerQuickSessionKey(key) ||
        sessionProjectDetachedRef.current ||
        detachedSessionKeysRef.current.has(key);
      void refreshSnapshot({
        projectId: detached ? null : selectedProjectIdRef.current,
        sessionKey: key,
        skipProjectDefault: detached,
        skipSessionProject: detached,
      });
    },
    [adapter, refreshSnapshot],
  );

  return {
    snapshot,
    snapshotLoading,
    snapshotError,
    connected,
    selectedProjectId,
    selectedSessionKey,
    sessionProjectDetached,
    sessionsVersion,
    activeRuntime,
    refreshSnapshot,
    selectSession,
    sendUserMessage,
    stopGeneration,
    setActiveAgent,
    startNewConversation,
    reloadActiveChat,
    deleteCurrentSession,
    renameCurrentSession,
  };
}
