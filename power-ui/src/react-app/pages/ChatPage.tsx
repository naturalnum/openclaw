import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { extractText } from "../../compat/chat";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import { usePowerWorkbenchChat } from "../hooks/usePowerWorkbenchChat";
import { ChatModelPicker } from "../components/chat/ChatModelPicker";
import { ChatMarkdownBody } from "../components/chat/ChatMarkdownBody";
import { ChatWorkspaceFilesPanel } from "../components/chat/ChatWorkspaceFilesPanel";
import { resolveChatModelPool } from "../lib/configured-chat-models";
import { formatCatalogModelRef } from "../lib/model-catalog";
import { CHAT_ATTACHMENT_ACCEPT, isSupportedChatAttachmentMimeType } from "../../../../ui/src/ui/chat/attachment-support";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";
import type { ChatAttachment } from "../../../../ui/src/ui/ui-types";

/** 主色仅用于关键操作；大面积 UI 用中性灰白 */
const BRAND = {
  primary: "bg-[#0d6b52] hover:bg-[#0a5844] active:bg-[#084a3a]",
  primaryText: "text-white",
} as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function messageHasVisibleText(msg: unknown): boolean {
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
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
  } = usePowerWorkbenchChat(adapter, patchSettings);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const pid = searchParams.get("projectId")?.trim();
    if (!pid) {
      return;
    }
    setActiveAgent(pid);
    const next = new URLSearchParams(searchParams);
    next.delete("projectId");
    setSearchParams(next, { replace: true });
  }, [searchParams, setActiveAgent, setSearchParams]);

  const configuredModels = useMemo(
    () => resolveChatModelPool(snapshot, selectedProjectId, selectedSessionKey),
    [snapshot, selectedProjectId, selectedSessionKey],
  );

  const effectiveModelRef = useMemo(() => {
    const pref = settings.chatPreferredModelRef?.trim() ?? "";
    if (pref && configuredModels.some((m) => formatCatalogModelRef(m) === pref || m.id === pref)) {
      const m = configuredModels.find((x) => formatCatalogModelRef(x) === pref || x.id === pref);
      return m ? formatCatalogModelRef(m) || pref : pref;
    }
    return configuredModels[0] ? formatCatalogModelRef(configuredModels[0]) : "";
  }, [configuredModels, settings.chatPreferredModelRef]);

  const handleModelChange = async (ref: string) => {
    patchSettings({ chatPreferredModelRef: ref });
    const sk = selectedSessionKey.trim();
    if (sk && adapter) {
      try {
        await adapter.request("sessions.patch", { key: sk, model: ref });
        await refreshSnapshot();
      } catch {
        // best-effort
      }
    }
  };

  useEffect(() => {
    const raw = searchParams.get("sessionKey")?.trim();
    if (!raw) {
      return;
    }
    const agentId = parseAgentSessionKey(raw)?.agentId ?? null;
    void selectSession(raw, agentId);
    const next = new URLSearchParams(searchParams);
    next.delete("sessionKey");
    setSearchParams(next, { replace: true });
  }, [searchParams, selectSession, setSearchParams]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesColumnRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agents = snapshot?.agentsList?.agents ?? [];
  const defaultAgentId = snapshot?.agentsList?.defaultId ?? null;

  const workspaceFilesEligible = useMemo(() => {
    const list = snapshot?.agentsList?.agents ?? [];
    const def = snapshot?.agentsList?.defaultId ?? list[0]?.id ?? null;
    const cur = snapshot?.currentProjectId ?? null;
    return Boolean(cur && def && cur !== def);
  }, [snapshot?.agentsList?.agents, snapshot?.agentsList?.defaultId, snapshot?.currentProjectId]);

  const workspaceAgentId = workspaceFilesEligible ? (snapshot?.currentProjectId ?? "").trim() : "";

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

  const [chatSubTab, setChatSubTab] = useState<"chat" | "files">("chat");

  useEffect(() => {
    setChatSubTab("chat");
  }, [workspaceFilesEligible, selectedSessionKey]);

  const showStream = Boolean(activeRuntime?.chatStream?.trim());
  const busy = Boolean(activeRuntime?.chatSending || showStream);
  /** 已发起请求但尚未收到可见文本（首 token 等待） */
  const awaitingFirstToken = Boolean(activeRuntime?.chatSending && !activeRuntime?.chatStream?.trim());
  const showAssistantOutput = Boolean(awaitingFirstToken || showStream);
  const errorText = snapshotError ?? activeRuntime?.lastError ?? null;

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
      return;
    }
    const ro = new ResizeObserver(() => {
      if (followBottomRef.current) {
        root.scrollTop = root.scrollHeight;
        syncScrollGap();
      }
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, [selectedSessionKey, activeRuntime?.chatLoading, activeRuntime?.chatMessages?.length, syncScrollGap]);

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

  useEffect(() => {
    if (searchParams.get("newChat") !== "1") {
      return;
    }
    if (!agents.length) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("newChat");
    setSearchParams(next, { replace: true });
    startNewConversation(undefined, { preferQuickChat: true });
    requestAnimationFrame(() => {
      resetComposerHeight();
      textareaRef.current?.focus();
    });
  }, [agents.length, searchParams, setSearchParams, startNewConversation]);

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
    try {
      await sendUserMessage(
        draft,
        pendingAttachments.length > 0 ? pendingAttachments : undefined,
      );
      setDraft("");
      setPendingAttachments([]);
      requestAnimationFrame(() => {
        resetComposerHeight();
        textareaRef.current?.focus();
        followBottomRef.current = true;
        scrollViewportToBottom("smooth");
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <main
        className={cn(
          "grid min-h-0 min-w-0 flex-1 bg-white",
          workspaceFilesEligible
            ? "grid-rows-[auto_auto_minmax(0,1fr)]"
            : "grid-rows-[auto_minmax(0,1fr)]",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-2 py-2 sm:px-4">
          <div className="min-w-0 flex-1 pr-2 pt-0.5">
            {currentSessionLabel ? (
              <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{currentSessionLabel}</p>
            ) : (
              <p className="truncate text-sm text-slate-500">新建或选择会话以开始</p>
            )}
            <p className="mt-1 text-[11px] leading-snug text-slate-500">
              {workspaceFilesEligible
                ? "当前为项目上下文：对话里上传的图片只随消息走，不会出现在下方「工作区文件」列表；落盘请在本页「工作区文件」标签上传，或在侧栏同名项目右侧点文件夹打开抽屉。"
                : "对话里上传的图片只随消息走，不会进入项目工作区文件列表；落盘可在侧栏「项目」列表右侧点文件夹打开工作区，或进入该项目对话后切换到「工作区文件」上传。"}
            </p>
          </div>
          <div className="shrink-0">
            <ChatModelPicker
              models={configuredModels}
              valueRef={effectiveModelRef}
              onChange={handleModelChange}
              disabled={!agents.length}
            />
          </div>
        </header>

        {workspaceFilesEligible ? (
          <div
            className="flex shrink-0 gap-1 border-b border-slate-200/80 bg-white px-2 pb-0 sm:px-4"
            role="tablist"
            aria-label="对话与工作区"
          >
            <button
              type="button"
              role="tab"
              aria-selected={chatSubTab === "chat"}
              onClick={() => setChatSubTab("chat")}
              className={cn(
                "rounded-t-md px-3 py-2 text-xs font-semibold transition sm:text-sm",
                chatSubTab === "chat"
                  ? "border border-b-0 border-slate-200/90 bg-white text-slate-900"
                  : "border border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              对话
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chatSubTab === "files"}
              onClick={() => setChatSubTab("files")}
              className={cn(
                "rounded-t-md px-3 py-2 text-xs font-semibold transition sm:text-sm",
                chatSubTab === "files"
                  ? "border border-b-0 border-slate-200/90 bg-white text-slate-900"
                  : "border border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              工作区文件
            </button>
          </div>
        ) : null}

        {workspaceFilesEligible && chatSubTab === "files" && adapter && workspaceAgentId ? (
          <div className="min-h-0 overflow-hidden">
            <ChatWorkspaceFilesPanel adapter={adapter} agentId={workspaceAgentId} />
          </div>
        ) : (
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
          <div className="relative min-h-0 min-w-0 overflow-hidden">
            <div
              ref={scrollRef}
              onScroll={onScrollViewport}
              className="power-chat-scroll h-full max-h-full min-h-0 overflow-y-auto overscroll-y-contain px-3 pb-4 pt-3 sm:px-6"
            >
              {errorText ? (
                <div
                  role="alert"
                  className="mx-auto mb-3 max-w-3xl rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                >
                  {errorText}
                </div>
              ) : null}

              {!selectedSessionKey ? null : activeRuntime?.chatLoading ? (
                <div className="mx-auto max-w-3xl space-y-3 py-8" aria-busy="true" aria-label="加载消息">
                  <div className="h-4 w-2/3 animate-pulse rounded-lg bg-slate-200/90" />
                  <div className="ml-auto h-4 w-1/2 max-w-xs animate-pulse rounded-lg bg-slate-200/90" />
                </div>
              ) : (
                <div ref={messagesColumnRef} className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                  {(activeRuntime?.chatMessages ?? []).map((msg, i) => {
                    if (!messageHasVisibleText(msg)) {
                      return null;
                    }
                    const raw = msg as Record<string, unknown>;
                    const role = typeof raw.role === "string" ? raw.role.toLowerCase() : "unknown";
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
                            "max-w-[min(100%,32rem)] rounded-2xl border border-slate-200/90 bg-white px-4 py-2.5 text-[15px] leading-relaxed text-slate-800 shadow-sm transition-shadow",
                            isUser ? "rounded-br-md" : "rounded-bl-md",
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
                  {(activeRuntime?.chatStreamSegments ?? [])
                    .filter((seg) => seg.text.trim().length > 0)
                    .map((seg, i) => (
                    <div key={`seg-${seg.ts}-${i}`} className="flex w-full justify-start">
                      <div className="max-w-[min(100%,32rem)] rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-sm italic text-slate-600 shadow-sm">
                        <ChatMarkdownBody
                          className="chat-markdown break-words text-sm italic leading-relaxed text-slate-600 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                          source={seg.text}
                        />
                      </div>
                    </div>
                  ))}
                  {(activeRuntime?.chatToolMessages ?? []).map((tm, i) => {
                    const preview = extractText(tm) || JSON.stringify(tm).slice(0, 400);
                    const content = (tm as Record<string, unknown>).content;
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
                        className="max-w-[min(100%,32rem)] rounded-xl border border-slate-200/90 bg-slate-50/80 px-3 py-2 text-sm text-slate-900 shadow-sm"
                      >
                        <summary className="cursor-pointer select-none font-medium text-slate-800 outline-none hover:text-slate-950">
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
                      <div className="max-w-[min(100%,32rem)] rounded-2xl rounded-bl-md border border-dashed border-slate-300/90 bg-slate-50/90 px-4 py-2.5 text-[15px] text-slate-800 shadow-sm">
                        {awaitingFirstToken ? (
                          <div
                            className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500"
                            aria-live="polite"
                            aria-busy="true"
                          >
                            <span
                              className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#0d6b52]/80"
                              aria-hidden
                            />
                            正在生成回复…
                          </div>
                        ) : (
                          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#0d6b52]/70" aria-hidden />
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
                className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-lg shadow-slate-300/35 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d6b52]/30 sm:right-6"
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

          <div className="shrink-0 bg-white px-3 py-3 sm:px-6 sm:py-4">
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
                    "flex items-end gap-2 rounded-2xl border border-slate-200/80 bg-white px-2 py-2 shadow-sm shadow-slate-200/30 transition-[box-shadow,border-color] sm:gap-3 sm:px-3 sm:py-2.5",
                    "focus-within:border-slate-300/90 focus-within:shadow-md focus-within:ring-2 focus-within:ring-slate-300/35 focus-within:ring-offset-0",
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
                    title={
                      workspaceFilesEligible
                        ? `添加仅随本条消息发送的图片（${CHAT_ATTACHMENT_ACCEPT}，最多 ${MAX_CHAT_ATTACHMENT_COUNT} 张，单张 ≤8MB）；不会出现在「工作区文件」列表。写入工作区请切到该标签上传。`
                        : `添加仅随消息发送的图片（${CHAT_ATTACHMENT_ACCEPT}，最多 ${MAX_CHAT_ATTACHMENT_COUNT} 张，单张 ≤8MB）；不会进入工作区文件列表。写入工作区可从侧栏项目旁文件夹打开，或进入项目后切「工作区文件」。`
                    }
                    disabled={
                      !agents.length ||
                      pendingAttachments.length >= MAX_CHAT_ATTACHMENT_COUNT ||
                      sending ||
                      busy
                    }
                    onClick={() => fileInputRef.current?.click()}
                    className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-35"
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
                    disabled={!agents.length || sending}
                    className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent py-2.5 text-[15px] text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:outline-none focus-visible:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    aria-label={busy ? "停止生成" : "发送"}
                    disabled={
                      busy
                        ? false
                        : !canSend || !agents.length || sending
                    }
                    onClick={() => (busy ? void stopGeneration() : void handleSend())}
                    className={cn(
                      "mb-0.5 flex h-10 min-w-[2.75rem] shrink-0 items-center justify-center rounded-xl px-3 text-sm font-semibold shadow-sm transition",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0",
                      busy
                        ? "border-2 border-amber-600/85 bg-white text-amber-900 hover:bg-amber-50 focus-visible:ring-amber-400/45 enabled:active:scale-95"
                        : cn(
                            "enabled:active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500",
                            "focus-visible:ring-[#0d6b52]/40",
                            BRAND.primary,
                            BRAND.primaryText,
                          ),
                    )}
                  >
                    {busy ? "停止" : sending ? "…" : "↑"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </main>

    </div>
  );
}
