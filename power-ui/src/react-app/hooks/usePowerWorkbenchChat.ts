import { useCallback, useEffect, useRef, useState } from "react";
import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { WorkbenchSnapshot } from "../../adapters/mock-workbench-adapter";
import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter";
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
  buildSessionLabelFromPrompt,
  buildUniqueSessionLabel,
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

function filterVisibleChatMessages(messages: unknown[]): unknown[] {
  return messages.filter(
    (message) =>
      message != null &&
      typeof message === "object" &&
      !shouldHideChatMessage(message, { showToolCalls: false }),
  );
}
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";
import type { ChatAttachment } from "../../../../ui/src/ui/ui-types";

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

const CHAT_RUN_STALE_MS = 90_000;

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
) {
  const [, bump] = useState(0);
  const bumpRuntime = useCallback(() => {
    bump((n) => n + 1);
  }, []);

  const clientRef = useRef<GatewayBrowserClient | null>(null);
  const runtimesRef = useRef(new Map<string, SessionRuntimeState>());
  const snapshotRef = useRef<WorkbenchSnapshot | null>(null);
  const snapshotErrorRef = useRef<string | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  const selectedSessionKeyRef = useRef("");
  const refreshSnapshotSeqRef = useRef(0);

  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState("");

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
        });
        if (requestSeq !== refreshSnapshotSeqRef.current) {
          return;
        }
        snapshotRef.current = snap;
        setSnapshot(snap);
        setSelectedProjectId(snap.currentProjectId);
        selectedProjectIdRef.current = snap.currentProjectId;
        const key = snap.currentSessionKey?.trim() || requestedSessionKey || "";
        setSelectedSessionKey(key);
        selectedSessionKeyRef.current = key;
        if (key) {
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
    [adapter, bumpRuntime, getOrCreateRuntime, patchSettings],
  );

  const refreshSnapshotRef = useRef(refreshSnapshot);
  refreshSnapshotRef.current = refreshSnapshot;

  useEffect(() => {
    if (!adapter) {
      return;
    }
    const scoped = loadSettings();
    const preferred = scoped.lastActiveSessionKey.trim() || scoped.sessionKey.trim() || null;
    void refreshSnapshotRef.current({ projectId: null, sessionKey: preferred });
  }, [adapter]);

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
              void refreshSnapshotRef.current({
                projectId: selectedProjectIdRef.current,
                sessionKey: preferred,
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
    async (sessionKey: string, projectId: string | null) => {
      if (!adapter) {
        return;
      }
      const key = sessionKey.trim();
      if (!key) {
        return;
      }
      patchSettings({ sessionKey: key, lastActiveSessionKey: key });
      setSelectedSessionKey(key);
      setSelectedProjectId(projectId);
      selectedSessionKeyRef.current = key;
      selectedProjectIdRef.current = projectId;
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
      rt.chatLoading = false;
      bumpRuntime();
      await refreshSnapshot(
        { projectId, sessionKey: key },
        {
          reloadChatHistory: rt.chatMessages.length === 0,
          forceReplaceChatHistory: true,
        },
      );
      const snap = snapshotRef.current;
      if (snap) {
        const pool = resolveChatModelPool(snap, projectId, key);
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
    [adapter, connected, bumpRuntime, getOrCreateRuntime, patchSettings, refreshSnapshot],
  );

  const sendUserMessage = useCallback(
    async (text: string, attachments?: ChatAttachment[]): Promise<boolean> => {
      if (!adapter || !clientRef.current) {
        return false;
      }
      const trimmed = text.trim();
      const hasAttachments = Boolean(attachments && attachments.length > 0);
      if (!trimmed && !hasAttachments) {
        return false;
      }
      const projectId =
        selectedProjectIdRef.current ??
        snapshotRef.current?.currentProjectId ??
        snapshotRef.current?.agentsList?.defaultId ??
        snapshotRef.current?.agentsList?.agents?.[0]?.id ??
        null;
      if (!projectId) {
        return false;
      }
      const modelId = resolveModelIdForSend(
        snapshotRef.current,
        adapter.getDefaultModelId(),
        selectedSessionKeyRef.current,
        selectedProjectIdRef.current,
      );
      let sessionKey = selectedSessionKeyRef.current.trim();

      if (!sessionKey) {
        const labels = snapshotRef.current?.sessionsResult?.sessions?.map((s) => s.label) ?? [];
        const label = buildUniqueSessionLabel(buildSessionLabelFromPrompt(trimmed), labels);
        const { sessionKey: newKey } = await adapter.startTask(projectId, trimmed, modelId, {
          label,
        });
        sessionKey = newKey.trim();
        setSelectedSessionKey(sessionKey);
        setSelectedProjectId(projectId);
        selectedSessionKeyRef.current = sessionKey;
        selectedProjectIdRef.current = projectId;
        patchSettings({ sessionKey, lastActiveSessionKey: sessionKey });
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
      // sendChatMessage mutates the runtime before the request resolves; render that local
      // user bubble and first-token loading immediately instead of waiting on the network.
      bumpRuntime();
      await sendPromise;
      bumpRuntime();
      void refreshSnapshot({ projectId, sessionKey }, { reloadChatHistory: false });
      return true;
    },
    [adapter, bumpRuntime, connected, getOrCreateRuntime, patchSettings, refreshSnapshot],
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
    });
  }, [bumpRuntime, getOrCreateRuntime, refreshSnapshot]);

  const setActiveAgent = useCallback(
    (projectId: string | null) => {
      setSelectedProjectId(projectId);
      setSelectedSessionKey("");
      selectedProjectIdRef.current = projectId;
      selectedSessionKeyRef.current = "";
      void refreshSnapshot({ projectId, sessionKey: null });
    },
    [refreshSnapshot],
  );

  const startNewConversation = useCallback(
    (nextProjectId?: string | null, options?: { preferQuickChat?: boolean }) => {
      if (options?.preferQuickChat) {
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
      if (nextProjectId !== undefined && nextProjectId !== null) {
        setSelectedProjectId(nextProjectId);
        selectedProjectIdRef.current = nextProjectId;
      }
      selectedSessionKeyRef.current = "";
      setSelectedSessionKey("");
      patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
      void refreshSnapshot({ projectId, sessionKey: null });
    },
    [patchSettings, refreshSnapshot],
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
      void refreshSnapshot({
        projectId: selectedProjectIdRef.current,
        sessionKey: key,
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
