import { ArrowUpOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { App } from "antd";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../../../../ui/src/ui/chat/attachment-support";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";
import type { ChatAttachment } from "../../../../ui/src/ui/ui-types";
import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter";
import { extractText } from "../../compat/chat";
import { isProtectedMainSessionKey } from "../../integrations/openclaw/session-keys";
import { ChatMarkdownBody } from "../components/chat/ChatMarkdownBody";
import { ChatModelPicker } from "../components/chat/ChatModelPicker";
import { ChatWorkspaceFilesPanel } from "../components/chat/ChatWorkspaceFilesPanel";
import { useWorkbenchChat } from "../context/WorkbenchChatContext";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import { shouldHideChatMessage } from "../lib/chat-message-visibility";
import { resolveChatModelPool, resolveEffectiveChatModelRef } from "../lib/configured-chat-models";
import { formatCatalogModelRef } from "../lib/model-catalog";

/** 主色仅用于关键操作；大面积 UI 用中性灰白 */
const BRAND = {
  primary: "bg-blue-600 hover:bg-blue-500 active:bg-blue-700",
  primaryText: "text-white",
} as const;

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
  const raw = extractText(msg);
  return typeof raw === "string" && raw.trim().length > 0;
}

const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_COUNT = 6;
/** 距底部小于此值视为「在底部」，新消息/流式输出会自动跟随 */
const SCROLL_BOTTOM_THRESHOLD_PX = 80;

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

function looksLikeFileGenerationRequest(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) {
    return false;
  }
  return /(pdf|docx|xlsx|pptx|文件|文档|报告|导出|生成.*(pdf|文件|报告))/.test(q);
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
      const agentId = parseAgentSessionKey(rawSession)?.agentId ?? pid ?? null;
      void selectSession(rawSession, agentId);
      next.delete("sessionKey");
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
  const [workspacePreviewActive, setWorkspacePreviewActive] = useState(false);
  const [workspaceFilesReloadToken, setWorkspaceFilesReloadToken] = useState(0);
  const [workspaceSidebarOpen, setWorkspaceSidebarOpen] = useState(true);

  const workspaceFilesEligible = useMemo(() => {
    const list = snapshot?.agentsList?.agents ?? [];
    const def = snapshot?.agentsList?.defaultId ?? list[0]?.id ?? null;
    const cur = snapshot?.currentProjectId ?? null;
    const sessionAgentId = selectedSessionKey.trim()
      ? (parseAgentSessionKey(selectedSessionKey)?.agentId ?? null)
      : null;
    if (!cur || (def && cur === def)) {
      return false;
    }
    if (selectedSessionKey.trim() && isProtectedMainSessionKey(selectedSessionKey)) {
      return false;
    }
    if (sessionAgentId && sessionAgentId !== cur) {
      return false;
    }
    return true;
  }, [
    selectedSessionKey,
    snapshot?.agentsList?.agents,
    snapshot?.agentsList?.defaultId,
    snapshot?.currentProjectId,
  ]);

  const workspaceAgentId = workspaceFilesEligible ? (snapshot?.currentProjectId ?? "").trim() : "";

  useEffect(() => {
    if (!workspaceFilesEligible) {
      setWorkspacePreviewActive(false);
      setWorkspaceSidebarOpen(true);
    }
  }, [workspaceFilesEligible]);

  const workspaceRailEligible = Boolean(workspaceFilesEligible && adapter && workspaceAgentId);
  const workspaceRailOpen = workspaceRailEligible && workspaceSidebarOpen;

  useEffect(() => {
    if (!adapter || !workspaceAgentId) {
      return undefined;
    }
    let timer: number | null = null;
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
        if (agentId === workspaceAgentId && (event.state === "final" || event.state === "error")) {
          scheduleReload();
        }
        return;
      }
      if (event.type === "agent") {
        const sessionKey =
          typeof event.payload.sessionKey === "string" ? event.payload.sessionKey : "";
        const agentId = parseAgentSessionKey(sessionKey)?.agentId ?? "";
        if (agentId === workspaceAgentId) {
          scheduleReload();
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

  const showStream = Boolean(activeRuntime?.chatStream?.trim());
  const runActive = Boolean(activeRuntime?.chatRunId);
  const busy = sending || runActive || Boolean(activeRuntime?.chatSending) || showStream;
  /** 已发起请求但尚未收到可见文本（首 token 等待） */
  const awaitingFirstToken =
    runActive && !activeRuntime?.chatStream?.trim() && !activeRuntime?.lastError;
  const showAssistantOutput = awaitingFirstToken || showStream;
  const errorText = snapshotError ?? activeRuntime?.lastError ?? null;
  const likelyGeneratingFile = useMemo(() => {
    if (optimisticUserBubble && looksLikeFileGenerationRequest(optimisticUserBubble.text)) {
      return true;
    }
    const recentUser = [...(activeRuntime?.chatMessages ?? [])].toReversed().find((m) => {
      if (!isRenderableChatMessage(m)) {
        return false;
      }
      const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
      return role === "user";
    });
    const text = recentUser ? (extractText(recentUser) ?? "") : "";
    return looksLikeFileGenerationRequest(text);
  }, [activeRuntime?.chatMessages, optimisticUserBubble]);

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
      const txt = (extractText(m) ?? "").trim();
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
    return (row?.label ?? "").trim() || selectedSessionKey;
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
    activeRuntime?.chatToolMessages?.length,
    activeRuntime?.chatStreamSegments?.length,
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
    activeRuntime?.chatToolMessages?.length,
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

  const addFilesFromList = useCallback(async (files: FileList | File[] | null | undefined) => {
    if (!files?.length) {
      return;
    }
    const list = Array.from(files);
    const picked: ChatAttachment[] = [];
    for (const file of list) {
      const att = await fileToChatAttachment(file);
      if (att) {
        picked.push(att);
      }
    }
    if (!picked.length) {
      return;
    }
    setPendingAttachments((prev) => {
      const room = MAX_CHAT_ATTACHMENT_COUNT - prev.length;
      if (room <= 0) {
        return prev;
      }
      return [...prev, ...picked.slice(0, room)];
    });
  }, []);

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void addFilesFromList(e.target.files);
    e.target.value = "";
  };

  const canSend = Boolean(draft.trim()) || pendingAttachments.length > 0;

  const handleSend = async () => {
    if (!canSend || sending) {
      return;
    }
    setSending(true);
    setOptimisticUserBubble({
      text: draft.trim(),
      attachmentCount: pendingAttachments.length,
      ts: Date.now(),
    });
    try {
      const sent = await sendUserMessage(
        draft,
        pendingAttachments.length > 0 ? pendingAttachments : undefined,
      );
      if (!sent) {
        message.warning("网关或项目还没准备好，请稍后再试。");
        setOptimisticUserBubble(null);
        return;
      }
      setDraft("");
      setPendingAttachments([]);
      requestAnimationFrame(() => {
        resetComposerHeight();
        textareaRef.current?.focus();
        followBottomRef.current = true;
        scrollViewportToBottom("smooth");
      });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "发送失败，请稍后再试。");
      setOptimisticUserBubble(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <main className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] bg-white">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/70 bg-white px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1 pt-0.5">
            {currentSessionLabel ? (
              <p className="truncate text-sm font-semibold tracking-[-0.01em] text-slate-900 sm:text-base">
                {currentSessionLabel}
              </p>
            ) : (
              <p className="truncate text-sm text-slate-500">新建或选择会话以开始</p>
            )}
          </div>
          {workspaceFilesEligible && adapter && workspaceAgentId ? (
            <button
              type="button"
              title={workspaceSidebarOpen ? "收起最近修改" : "展开最近修改"}
              aria-label={workspaceSidebarOpen ? "收起最近修改" : "展开最近修改"}
              aria-expanded={workspaceSidebarOpen}
              onClick={() => setWorkspaceSidebarOpen((open) => !open)}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/90 text-slate-600 transition-[colors,transform] duration-200 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200/60 active:scale-95"
            >
              {workspaceSidebarOpen ? (
                <MenuFoldOutlined
                  className="text-[15px] transition-opacity duration-200"
                  aria-hidden
                />
              ) : (
                <MenuUnfoldOutlined
                  className="text-[15px] transition-opacity duration-200"
                  aria-hidden
                />
              )}
            </button>
          ) : null}
        </header>

        <div className="flex min-h-0 min-w-0 bg-white">
          <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)_auto] bg-white transition-[flex] duration-300 ease-out">
            <div className="relative min-h-0 min-w-0 overflow-hidden">
              <div
                ref={scrollRef}
                onScroll={onScrollViewport}
                className="power-chat-scroll h-full max-h-full min-h-0 overflow-y-auto overscroll-y-contain bg-white px-3 pb-4 pt-4 sm:px-7"
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
                    className="mx-auto flex w-full max-w-3xl flex-col gap-3.5"
                  >
                    {(activeRuntime?.chatMessages ?? []).map((msg, i) => {
                      if (!isRenderableChatMessage(msg) || !messageHasVisibleText(msg)) {
                        return null;
                      }
                      const raw = msg;
                      const role =
                        typeof raw.role === "string" ? raw.role.toLowerCase() : "unknown";
                      const rawText = extractText(msg);
                      const text = (typeof rawText === "string" ? rawText : "").trim();
                      const isUser = role === "user";
                      const isAssistant = role === "assistant";
                      return (
                        <div
                          key={`${i}-${typeof raw.timestamp === "number" ? raw.timestamp : i}`}
                          className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                        >
                          <div
                            aria-label={isUser ? "用户消息" : "助手消息"}
                            className={cn(
                              "max-w-[min(100%,32rem)] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm transition-shadow",
                              isUser
                                ? "rounded-br-md border border-slate-200 bg-slate-50 text-slate-900 shadow-slate-200/35"
                                : "rounded-bl-md border border-slate-200/80 bg-white/95 text-slate-800 shadow-slate-200/40",
                            )}
                          >
                            {isAssistant ? (
                              <ChatMarkdownBody source={text} />
                            ) : (
                              <span className="whitespace-pre-wrap break-words">{text}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                        <div className="max-w-[min(100%,32rem)] rounded-2xl rounded-br-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-[15px] leading-relaxed text-slate-900 shadow-sm shadow-slate-200/35">
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
                    {(activeRuntime?.chatStreamSegments ?? [])
                      .filter((seg) => seg.text.trim().length > 0)
                      .map((seg, i) => (
                        <div key={`seg-${seg.ts}-${i}`} className="flex w-full justify-start">
                          <div className="max-w-[min(100%,32rem)] rounded-2xl rounded-bl-md border border-slate-200/80 bg-white/90 px-3.5 py-2.5 text-sm italic text-slate-600 shadow-sm shadow-slate-200/40">
                            <ChatMarkdownBody
                              className="chat-markdown break-words text-sm italic leading-relaxed text-slate-600 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                              source={seg.text}
                            />
                          </div>
                        </div>
                      ))}
                    {(activeRuntime?.chatToolMessages ?? []).map((tm, i) => {
                      if (
                        !isRenderableChatMessage(tm) ||
                        shouldHideChatMessage(tm, { showToolCalls: false })
                      ) {
                        return null;
                      }
                      const preview = extractText(tm) || JSON.stringify(tm).slice(0, 400);
                      const content = tm.content;
                      let title = "工具";
                      if (Array.isArray(content) && content[0] && typeof content[0] === "object") {
                        const first = content[0] as Record<string, unknown>;
                        if (typeof first.name === "string") {
                          title = first.name;
                        }
                      }
                      return (
                        <details
                          key={`tool-${i}`}
                          className="max-w-[min(100%,32rem)] rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-sm text-slate-900 shadow-sm shadow-slate-200/35"
                        >
                          <summary className="cursor-pointer select-none font-medium text-slate-800 outline-none hover:text-slate-900">
                            {title}
                          </summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
                            {preview}
                          </pre>
                        </details>
                      );
                    })}
                    {showAssistantOutput ? (
                      <div className="flex w-full justify-start scroll-mt-4">
                        <div className="max-w-[min(100%,32rem)] rounded-2xl rounded-bl-md bg-white/95 px-4 py-2.5 text-[15px] text-slate-800 shadow-sm shadow-slate-200/40 ring-1 ring-slate-200/80">
                          {awaitingFirstToken ? (
                            <div
                              className="flex items-center gap-1.5 py-1 text-sm text-slate-500"
                              aria-live="polite"
                              aria-busy="true"
                            >
                              <TypingDots />
                              <span>
                                {likelyGeneratingFile
                                  ? "正在处理，可能在生成文件..."
                                  : "正在处理..."}
                              </span>
                            </div>
                          ) : (
                            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                              <span
                                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-slate-900/70"
                                aria-hidden
                              />
                              输出中
                            </div>
                          )}
                          {showStream ? (
                            <>
                              <ChatMarkdownBody
                                className="chat-markdown break-words text-[15px] leading-relaxed text-slate-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                                source={activeRuntime?.chatStream ?? ""}
                              />
                              <span
                                className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-slate-500 align-middle opacity-70"
                                aria-hidden
                              />
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              {selectedSessionKey && activeRuntime?.chatLoading !== true && showJumpToBottom ? (
                <button
                  type="button"
                  className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-lg shadow-slate-300/35 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60 sm:right-6"
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

            <div className="relative shrink-0 bg-white px-3 py-3 shadow-[0_-16px_36px_rgba(255,255,255,0.9)] sm:px-6 sm:py-4">
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept={CHAT_ATTACHMENT_ACCEPT}
                multiple
                aria-hidden
                tabIndex={-1}
                onChange={onFileInputChange}
              />
              <div className="mx-auto w-full max-w-3xl">
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
                <div
                  className={cn(
                    "power-surface flex items-end gap-2 rounded-2xl border px-2 py-2 transition-[box-shadow,border-color,transform] sm:gap-3 sm:px-3 sm:py-2.5",
                    "focus-within:border-blue-200 focus-within:shadow-lg focus-within:shadow-blue-100/45 focus-within:ring-2 focus-within:ring-blue-100 focus-within:ring-offset-0",
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
                    title={`仅随本条消息发送（${CHAT_ATTACHMENT_ACCEPT}，最多 ${MAX_CHAT_ATTACHMENT_COUNT} 张）；不会写入工作区文件`}
                    disabled={
                      pendingAttachments.length >= MAX_CHAT_ATTACHMENT_COUNT || sending || busy
                    }
                    onClick={() => fileInputRef.current?.click()}
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200/60 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-35"
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
                    className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent py-2.5 text-[15px] text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:outline-none focus-visible:outline-none disabled:opacity-50"
                  />
                  <div className="mb-1 hidden shrink-0 items-center sm:flex">
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
                      "mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold shadow-sm transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
                      busy
                        ? "border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 focus-visible:ring-rose-300/50 enabled:active:scale-95"
                        : cn(
                            "enabled:active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500",
                            "focus-visible:ring-blue-300/60",
                            BRAND.primary,
                            BRAND.primaryText,
                          ),
                    )}
                  >
                    {busy ? (
                      <span className="h-3.5 w-3.5 rounded-[3px] bg-current" aria-hidden />
                    ) : sending ? (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-current opacity-80"
                        aria-hidden
                      />
                    ) : (
                      <ArrowUpOutlined className="text-[15px]" aria-hidden />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {workspaceRailEligible ? (
            <aside
              className={cn(
                "power-workspace-rail hidden min-h-0 shrink-0 overflow-hidden border-l border-slate-200/70 bg-white xl:block",
                workspacePreviewActive
                  ? "power-workspace-rail--preview"
                  : "power-workspace-rail--list",
                workspaceRailOpen ? "power-workspace-rail--open" : "power-workspace-rail--closed",
              )}
              aria-hidden={!workspaceRailOpen}
            >
              <div className="power-workspace-rail__inner">
                <ChatWorkspaceFilesPanel
                  adapter={adapter!}
                  agentId={workspaceAgentId}
                  showToolbar={false}
                  onPreviewActiveChange={setWorkspacePreviewActive}
                  reloadToken={workspaceFilesReloadToken}
                />
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
