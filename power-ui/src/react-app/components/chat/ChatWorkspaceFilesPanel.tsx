import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  MinusOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  PlusOutlined,
  PicRightOutlined,
  RedoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type {
  WorkbenchFileEntry,
  WorkbenchFilePreviewResult,
  WorkbenchFilePreviewMode,
} from "../../../adapters/workbench-adapter";
import { filterUserVisibleWorkspaceEntries } from "../../lib/workspace-default-entries";
import { ROUTES } from "../../router/paths";
import { ChatMarkdownBody } from "./ChatMarkdownBody";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) {
    return "—";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  adapter: GatewayWorkbenchAdapter;
  agentId: string;
  showToolbar?: boolean;
  onPreviewActiveChange?: (active: boolean) => void;
  reloadToken?: number;
  canFullscreen?: boolean;
  previewFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCollapseRail?: () => void;
};

function RailIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/75 bg-white/86 text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
    >
      {children}
    </button>
  );
}

type PreviewState =
  | {
      status: "idle";
      entry: null;
      result: null;
      error: null;
    }
  | {
      status: "loading";
      entry: WorkbenchFileEntry;
      result: null;
      error: null;
    }
  | {
      status: "ready";
      entry: WorkbenchFileEntry;
      result: WorkbenchFilePreviewResult;
      error: null;
    }
  | {
      status: "error";
      entry: WorkbenchFileEntry;
      result: null;
      error: string;
    };

type PaneMode = "split" | "files" | "preview";

function formatUpdatedAt(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return "最近修改时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function previewModeForEntry(entry: WorkbenchFileEntry): WorkbenchFilePreviewMode | null {
  const lower = entry.name.toLowerCase();
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"] as const;
  if (imageExts.some((ext) => lower.endsWith(ext))) {
    return "image";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (lower.endsWith(".docx")) {
    return "word";
  }
  const codeTextExts = [
    ".txt",
    ".md",
    ".json",
    ".log",
    ".csv",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".html",
    ".htm",
    ".py",
    ".java",
    ".kt",
    ".swift",
    ".go",
    ".rs",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
    ".sh",
    ".bash",
    ".zsh",
    ".sql",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".ini",
    ".conf",
    ".env",
  ] as const;
  if (codeTextExts.some((ext) => lower.endsWith(ext))) {
    return "text";
  }
  return null;
}

function isHtmlEntry(entry: WorkbenchFileEntry): boolean {
  const lower = entry.name.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

function isMarkdownEntry(entry: WorkbenchFileEntry): boolean {
  return entry.name.toLowerCase().endsWith(".md");
}

function languageLabelForEntry(entry: WorkbenchFileEntry): string {
  const lower = entry.name.toLowerCase();
  const labels: Array<[string, string]> = [
    [".tsx", "TypeScript React"],
    [".ts", "TypeScript"],
    [".jsx", "JavaScript React"],
    [".js", "JavaScript"],
    [".py", "Python"],
    [".java", "Java"],
    [".kt", "Kotlin"],
    [".swift", "Swift"],
    [".go", "Go"],
    [".rs", "Rust"],
    [".cpp", "C++"],
    [".cc", "C++"],
    [".c", "C"],
    [".hpp", "C/C++ Header"],
    [".h", "Header"],
    [".sh", "Shell"],
    [".bash", "Bash"],
    [".zsh", "Zsh"],
    [".sql", "SQL"],
    [".yaml", "YAML"],
    [".yml", "YAML"],
    [".toml", "TOML"],
    [".xml", "XML"],
    [".json", "JSON"],
    [".md", "Markdown"],
    [".css", "CSS"],
    [".html", "HTML"],
    [".htm", "HTML"],
    [".txt", "Text"],
    [".log", "Log"],
    [".csv", "CSV"],
    [".env", "ENV"],
  ];
  const matched = labels.find(([ext]) => lower.endsWith(ext));
  return matched?.[1] ?? "Text";
}

function syntaxLangForEntry(entry: WorkbenchFileEntry): string {
  const lower = entry.name.toLowerCase();
  const langMap: Array<[string, string]> = [
    [".tsx", "tsx"],
    [".ts", "typescript"],
    [".jsx", "jsx"],
    [".js", "javascript"],
    [".py", "python"],
    [".java", "java"],
    [".kt", "kotlin"],
    [".swift", "swift"],
    [".go", "go"],
    [".rs", "rust"],
    [".cpp", "cpp"],
    [".cc", "cpp"],
    [".c", "c"],
    [".hpp", "cpp"],
    [".h", "cpp"],
    [".sh", "bash"],
    [".bash", "bash"],
    [".zsh", "bash"],
    [".sql", "sql"],
    [".yaml", "yaml"],
    [".yml", "yaml"],
    [".toml", "toml"],
    [".xml", "xml"],
    [".json", "json"],
    [".md", "markdown"],
    [".css", "css"],
    [".html", "markup"],
    [".htm", "markup"],
    [".log", "text"],
    [".txt", "text"],
    [".csv", "csv"],
    [".env", "bash"],
  ];
  const matched = langMap.find(([ext]) => lower.endsWith(ext));
  return matched?.[1] ?? "text";
}

export function ChatWorkspaceFilesPanel({
  adapter,
  agentId,
  showToolbar = true,
  onPreviewActiveChange,
  reloadToken = 0,
  canFullscreen = false,
  previewFullscreen = false,
  onToggleFullscreen,
  onCollapseRail,
}: Props) {
  const { modal, message } = App.useApp();
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorkbenchFileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({
    status: "idle",
    entry: null,
    result: null,
    error: null,
  });
  const [paneMode, setPaneMode] = useState<PaneMode>("split");
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "ok" | "fail">("idle");
  const [imageZoom, setImageZoom] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [isImageDragging, setIsImageDragging] = useState(false);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const entriesCountRef = useRef(0);

  useEffect(() => {
    entriesCountRef.current = entries.length;
  }, [entries.length]);

  useEffect(() => {
    setPath(null);
    setEntries([]);
    setParentPath(null);
    setBreadcrumb("");
    setError(null);
    setPreview({ status: "idle", entry: null, result: null, error: null });
    setPaneMode("split");
    setShowAllFiles(false);
  }, [agentId]);

  const load = useCallback(async () => {
    const id = agentId.trim();
    if (!id) {
      return;
    }
    const showInitialLoading = entriesCountRef.current === 0;
    if (showInitialLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const listing = await adapter.listProjectFiles(id, path);
      setEntries(listing.entries);
      setParentPath(listing.parentPath);
      const label = listing.name?.trim() || (path ? path : "根目录");
      setBreadcrumb(label);
      setPreview({ status: "idle", entry: null, result: null, error: null });
      setShowAllFiles(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (showInitialLoading) {
        setEntries([]);
      }
    } finally {
      if (showInitialLoading) {
        setLoading(false);
      }
    }
  }, [adapter, agentId, path]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const onUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) {
      return;
    }
    const id = agentId.trim();
    if (!id) {
      message.error("请先选择项目后再上传");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const payload = files.map((file) => ({ name: file.name, file }));
      const uploaded = await adapter.uploadProjectFiles(id, path, payload);
      if (uploaded.length > 0) {
        message.success(
          uploaded.length === 1
            ? `已上传「${uploaded[0]?.name ?? "文件"}」`
            : `已上传 ${uploaded.length} 个文件`,
        );
        setShowAllFiles(true);
        setEntries((current) => {
          const uploadedPaths = new Set(uploaded.map((entry) => entry.path));
          const merged = [
            ...uploaded,
            ...current.filter((entry) => !uploadedPaths.has(entry.path)),
          ];
          return merged;
        });
        await load();
      } else {
        message.warning("未收到上传结果，请刷新后重试");
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setError(text);
      message.error(text);
    } finally {
      setUploading(false);
    }
  };

  const openPreview = async (entry: WorkbenchFileEntry) => {
    if (entry.kind === "directory") {
      setPath(entry.path);
      return;
    }
    const mode = previewModeForEntry(entry);
    if (!mode) {
      await onDownload(entry);
      return;
    }
    setPreview({ status: "loading", entry, result: null, error: null });
    setPaneMode("preview");
    try {
      const result = await adapter.previewProjectFile(agentId.trim(), entry.path, mode);
      setPreview({ status: "ready", entry, result, error: null });
    } catch (e) {
      setPreview({
        status: "error",
        entry,
        result: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const onDownload = async (entry: WorkbenchFileEntry) => {
    if (entry.kind !== "file") {
      return;
    }
    try {
      await adapter.downloadProjectFile(agentId.trim(), entry.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = (entry: WorkbenchFileEntry) => {
    if (entry.kind !== "file") {
      return;
    }
    modal.confirm({
      title: "删除文件",
      content: `确定删除「${entry.name}」？此操作不可恢复，本地工作区中的文件将一并删除。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setError(null);
        try {
          await adapter.deleteProjectEntry(agentId.trim(), entry.path);
          setEntries((current) => current.filter((item) => item.path !== entry.path));
          if (preview.entry?.path === entry.path) {
            setPreview({ status: "idle", entry: null, result: null, error: null });
            setPaneMode("split");
          }
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      },
    });
  };

  const sortedFiles = useMemo(
    () =>
      filterUserVisibleWorkspaceEntries(entries)
        .filter((entry) => entry.kind === "file")
        .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0)),
    [entries],
  );
  const recentFiles = sortedFiles.slice(0, 6);
  const visibleFiles = showAllFiles ? sortedFiles : recentFiles;
  const hasMoreFiles = sortedFiles.length > recentFiles.length;

  const previewBlobUrl = useMemo(() => {
    if (
      preview.status !== "ready" ||
      !preview.result ||
      (preview.result.mode !== "image" && preview.result.mode !== "pdf")
    ) {
      return "";
    }
    return URL.createObjectURL(preview.result.blob);
  }, [preview]);

  const pdfPreviewSrc = useMemo(() => {
    if (!previewBlobUrl) {
      return "";
    }
    return `${previewBlobUrl}#zoom=100`;
  }, [previewBlobUrl]);

  const wordPreviewSrcDoc = useMemo(() => {
    if (preview.status !== "ready" || preview.result.mode !== "word") {
      return "";
    }
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #1f2937; font: 14px/1.7 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif; }
      body { padding: 20px 24px; }
      img, table { max-width: 100%; }
      table { border-collapse: collapse; }
      td, th { border: 1px solid #e5e7eb; padding: 4px 8px; vertical-align: top; }
      p { margin: 0 0 0.75em; }
    </style>
  </head>
  <body>${preview.result.html}</body>
</html>`;
  }, [preview]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  const showPreviewPane = preview.entry !== null;
  const filesPaneHidden = paneMode === "preview" && showPreviewPane;
  const previewPaneHidden = paneMode === "files" || !showPreviewPane;
  const previewLines =
    preview.status === "ready" && preview.result.mode === "text"
      ? preview.result.content.split("\n")
      : [];

  useEffect(() => {
    setCopyFeedback("idle");
  }, [preview.entry?.path]);

  useEffect(() => {
    if (preview.status !== "ready" || preview.result.mode !== "image") {
      setImageZoom(1);
      setImageOffset({ x: 0, y: 0 });
    }
  }, [preview]);

  const applyImageZoom = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const clamped = Math.min(4, Math.max(0.25, next));
      setImageOffset((current) => {
        if (!anchor || imageZoom <= 0) {
          return current;
        }
        const ratio = clamped / imageZoom;
        return {
          x: anchor.x * (1 - ratio) + current.x * ratio,
          y: anchor.y * (1 - ratio) + current.y * ratio,
        };
      });
      setImageZoom(clamped);
    },
    [imageZoom],
  );

  const onImageWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (preview.status !== "ready" || preview.result.mode !== "image") {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      const next = event.deltaY < 0 ? imageZoom * 1.1 : imageZoom * 0.9;
      applyImageZoom(next, anchor);
    },
    [applyImageZoom, imageZoom, preview],
  );

  const onImageMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (preview.status !== "ready" || preview.result.mode !== "image") {
        return;
      }
      dragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: imageOffset.x,
        originY: imageOffset.y,
      };
      setIsImageDragging(true);
    },
    [imageOffset.x, imageOffset.y, preview],
  );

  const onImageMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) {
      return;
    }
    const { startX, startY, originX, originY } = dragStateRef.current;
    setImageOffset({
      x: originX + (event.clientX - startX),
      y: originY + (event.clientY - startY),
    });
  }, []);

  const stopImageDrag = useCallback(() => {
    dragStateRef.current = null;
    setIsImageDragging(false);
  }, []);

  const onCopyPreview = useCallback(async () => {
    if (preview.status !== "ready" || preview.result.mode !== "text") {
      return;
    }
    try {
      await navigator.clipboard.writeText(preview.result.content);
      setCopyFeedback("ok");
    } catch {
      setCopyFeedback("fail");
    }
    window.setTimeout(() => setCopyFeedback("idle"), 1400);
  }, [preview]);

  useEffect(() => {
    onPreviewActiveChange?.(showPreviewPane);
  }, [onPreviewActiveChange, showPreviewPane]);

  const uploadFileTrigger = (label: string, className: string, iconClassName = "text-[11px]") => (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center gap-1",
        className,
        uploading && "pointer-events-none cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="file"
        multiple
        className="absolute inset-0 z-[1] h-full w-full cursor-pointer opacity-0"
        onChange={(e) => void onUploadChange(e)}
        disabled={uploading}
        aria-label={label}
      />
      <span className="pointer-events-none inline-flex items-center gap-1">
        <UploadOutlined className={iconClassName} />
        {uploading ? "上传中…" : label}
      </span>
    </label>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-transparent",
        showToolbar || showPreviewPane ? "h-full" : "max-h-[26rem]",
      )}
    >
      {showToolbar ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-500">当前目录</p>
            <p className="truncate text-sm text-slate-900">{breadcrumb}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={parentPath === null || loading}
              onClick={() => setPath(parentPath)}
              className="power-soft-button rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              上级
            </button>
            {uploadFileTrigger(
              "上传到工作区",
              "inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950",
              "text-[12px]",
            )}
            <Link
              to={ROUTES.workbench}
              className="power-soft-button rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              工作台
            </Link>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 gap-0 overflow-hidden",
          showPreviewPane && paneMode === "split"
            ? "grid grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)]"
            : "grid grid-cols-1",
        )}
      >
        <section
          className={cn(
            "power-chat-scroll min-h-0 overflow-y-auto bg-transparent",
            showToolbar ? "px-4 py-5" : "p-3",
            filesPaneHidden && "hidden",
          )}
        >
          {error ? (
            <div
              role="alert"
              className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
            >
              {error}
            </div>
          ) : null}
          <div className={cn("mx-auto", showToolbar ? "max-w-[19.5rem]" : "w-full")}>
            <div
              className={
                showToolbar
                  ? "power-workspace-files-card rounded-2xl border border-stone-200/85 bg-[#fbfbfa] p-2.5 shadow-sm shadow-neutral-900/[0.03]"
                  : "p-1"
              }
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
                <span className="text-[13px] font-semibold text-slate-800">项目文件</span>
                <div className="flex items-center gap-1.5">
                  {uploadFileTrigger(
                    "上传文件",
                    "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-stone-200/90 bg-white px-2 text-[11px] font-medium text-neutral-700 transition hover:border-stone-300 hover:bg-stone-50",
                  )}
                  {!showToolbar && onCollapseRail ? (
                    <button
                      type="button"
                      title="关闭项目文件"
                      aria-label="关闭项目文件"
                      onClick={onCollapseRail}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-stone-100 hover:text-slate-700"
                    >
                      <CloseOutlined className="text-[12px]" />
                    </button>
                  ) : null}
                </div>
              </div>
              {loading ? (
                <div className="py-6 text-center text-xs text-slate-500">加载中…</div>
              ) : recentFiles.length > 0 ? (
                <div className="space-y-1.5">
                  {visibleFiles.map((entry) => (
                    <FileCard
                      key={`${entry.kind}:${entry.path}`}
                      entry={entry}
                      active={preview.entry?.path === entry.path}
                      onOpen={() => void openPreview(entry)}
                      onDownload={() => void onDownload(entry)}
                      onDelete={() => onDelete(entry)}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-0.5 py-2 text-center text-xs text-slate-500">
                  {entries.length > 0
                    ? "暂无用户文件，上传后将显示在这里"
                    : "此目录暂无文件，可先上传"}
                </p>
              )}
              {!loading && hasMoreFiles ? (
                <button
                  type="button"
                  onClick={() => setShowAllFiles((v) => !v)}
                  className="mt-3 flex w-full items-center justify-center rounded-xl border border-[rgba(226,232,240,0.55)] bg-[#f5f5f4] px-3 py-2 text-xs font-medium text-neutral-600 transition hover:border-[rgba(226,232,240,0.72)] hover:bg-white hover:text-neutral-900"
                >
                  {showAllFiles ? "收起" : `更多，查看全部 ${sortedFiles.length} 个文件`}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section
          className={cn(
            "min-h-0 min-w-0 flex-col bg-white/92",
            previewPaneHidden ? "hidden" : "flex",
          )}
        >
          {preview.entry ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/60 bg-white/92 px-4 py-3 backdrop-blur">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {preview.entry.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatBytes(preview.entry.size)} · {formatUpdatedAt(preview.entry.updatedAtMs)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {canFullscreen ? (
                    <RailIconButton
                      title={previewFullscreen ? "退出全屏" : "全屏预览"}
                      onClick={() => onToggleFullscreen?.()}
                    >
                      {previewFullscreen ? (
                        <FullscreenExitOutlined className="text-[14px]" />
                      ) : (
                        <FullscreenOutlined className="text-[14px]" />
                      )}
                    </RailIconButton>
                  ) : null}
                  {onCollapseRail ? (
                    <RailIconButton title="收起面板" onClick={() => onCollapseRail()}>
                      <PicRightOutlined className="text-[14px]" />
                    </RailIconButton>
                  ) : null}
                  {preview.status === "ready" && preview.result.mode === "text" ? (
                    <button
                      type="button"
                      onClick={() => void onCopyPreview()}
                      className="power-soft-button rounded-xl border border-slate-200 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50"
                    >
                      {copyFeedback === "ok"
                        ? "已复制"
                        : copyFeedback === "fail"
                          ? "复制失败"
                          : "复制代码"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void onDownload(preview.entry)}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#30343a] px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[#24272d]"
                  >
                    <DownloadOutlined className="text-[12px]" />
                    下载
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreview({ status: "idle", entry: null, result: null, error: null });
                      setPaneMode("split");
                    }}
                    className="power-soft-button rounded-xl border border-slate-200 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50"
                  >
                    关闭
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {preview.status === "loading" ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    读取中…
                  </div>
                ) : preview.status === "error" ? (
                  <div className="m-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                    {preview.error}
                  </div>
                ) : preview.status === "ready" && preview.result.mode === "text" ? (
                  isHtmlEntry(preview.entry) ? (
                    <iframe
                      title={preview.entry.name}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                      srcDoc={preview.result.content}
                      className="h-full w-full border-0 bg-white"
                    />
                  ) : isMarkdownEntry(preview.entry) ? (
                    <article className="power-chat-scroll h-full overflow-auto bg-white px-6 py-5">
                      <ChatMarkdownBody
                        className={cn(
                          "chat-markdown mx-auto break-words text-[15px] leading-relaxed text-slate-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                          previewFullscreen ? "max-w-5xl" : "max-w-3xl",
                        )}
                        source={preview.result.content}
                      />
                    </article>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col bg-slate-950">
                      <div className="shrink-0 border-b border-slate-800/90 px-4 py-2 text-[11px] text-slate-300">
                        {languageLabelForEntry(preview.entry)} · {previewLines.length} 行
                      </div>
                      <div className="power-chat-scroll h-full overflow-auto">
                        <SyntaxHighlighter
                          language={syntaxLangForEntry(preview.entry)}
                          style={oneDark}
                          showLineNumbers
                          wrapLongLines
                          customStyle={{
                            margin: 0,
                            padding: "0.875rem 1rem",
                            background: "transparent",
                            fontSize: "12px",
                            minHeight: "100%",
                          }}
                          lineNumberStyle={{
                            color: "#64748b",
                            minWidth: "2.5em",
                            paddingRight: "1em",
                            marginRight: "1em",
                            borderRight: "1px solid rgba(51,65,85,0.7)",
                            textAlign: "right",
                            userSelect: "none",
                          }}
                          codeTagProps={{
                            style: {
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                            },
                          }}
                        >
                          {preview.result.content}
                        </SyntaxHighlighter>
                      </div>
                    </div>
                  )
                ) : preview.status === "ready" && preview.result.mode === "pdf" ? (
                  <iframe
                    title={preview.entry.name}
                    src={pdfPreviewSrc}
                    className="h-full w-full border-0 bg-white"
                  />
                ) : preview.status === "ready" && preview.result.mode === "image" ? (
                  <div className="flex h-full min-h-0 flex-col bg-[#f8fafc]">
                    <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/90 px-3 py-2 text-xs text-slate-600">
                      <span>缩放：{Math.round(imageZoom * 100)}%</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                          onClick={() => applyImageZoom(imageZoom - 0.1)}
                          title="缩小"
                          aria-label="缩小"
                        >
                          <MinusOutlined className="text-[12px]" />
                        </button>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                          onClick={() => {
                            setImageZoom(1);
                            setImageOffset({ x: 0, y: 0 });
                          }}
                          title="重置"
                          aria-label="重置"
                        >
                          <RedoOutlined className="text-[12px]" />
                        </button>
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                          onClick={() => applyImageZoom(imageZoom + 0.1)}
                          title="放大"
                          aria-label="放大"
                        >
                          <PlusOutlined className="text-[12px]" />
                        </button>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "power-chat-scroll flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4",
                        isImageDragging ? "cursor-grabbing" : "cursor-grab",
                      )}
                      onWheel={onImageWheel}
                      onMouseDown={onImageMouseDown}
                      onMouseMove={onImageMouseMove}
                      onMouseUp={stopImageDrag}
                      onMouseLeave={stopImageDrag}
                    >
                      <img
                        src={previewBlobUrl}
                        alt={preview.entry.name}
                        className="max-h-full max-w-full rounded-lg border border-slate-200/70 bg-white object-contain shadow-sm transition-transform duration-100"
                        style={{
                          transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageZoom})`,
                          transformOrigin: "center center",
                        }}
                        draggable={false}
                      />
                    </div>
                  </div>
                ) : preview.status === "ready" && preview.result.mode === "word" ? (
                  <iframe
                    title={preview.entry.name}
                    sandbox="allow-same-origin"
                    srcDoc={wordPreviewSrcDoc}
                    className="h-full w-full border-0 bg-white"
                  />
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function FileCard({
  entry,
  active,
  onOpen,
  onDownload,
  onDelete,
}: {
  entry: WorkbenchFileEntry;
  active: boolean;
  onOpen: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      title={entry.name}
      className={cn(
        "group flex items-center gap-2 rounded-xl border px-2 py-2 transition-[background-color,border-color,box-shadow,transform]",
        active
          ? "border-neutral-300/85 bg-white shadow-sm shadow-neutral-900/[0.045]"
          : "border-transparent bg-neutral-100/75 hover:border-neutral-300/70 hover:bg-white hover:shadow-sm hover:shadow-neutral-900/[0.035]",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
            entry.kind === "directory"
              ? "bg-neutral-200/70 text-neutral-600"
              : "bg-white text-neutral-500 ring-1 ring-neutral-300/80",
          )}
          aria-hidden
        >
          {entry.kind === "directory" ? (
            <FolderOpenOutlined className="text-[15px]" />
          ) : (
            <FileTextOutlined className="text-[15px]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[13px] font-semibold text-slate-900"
            title={entry.name}
          >
            {entry.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
            {entry.kind === "directory"
              ? "文件夹 · 点击进入"
              : `${formatBytes(entry.size)} · ${formatUpdatedAt(entry.updatedAtMs)}`}
          </span>
        </span>
      </button>
      {entry.kind === "file" ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="下载"
            aria-label={`下载 ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-300/80 bg-white text-neutral-500 transition hover:border-neutral-400/70 hover:bg-neutral-100 hover:text-neutral-800"
          >
            <DownloadOutlined className="text-[14px]" />
          </button>
          <button
            type="button"
            title="删除"
            aria-label={`删除 ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(226,232,240,0.65)] bg-white text-red-500 transition hover:border-red-200/80 hover:bg-red-50/90 hover:text-red-600"
          >
            <DeleteOutlined className="text-[14px]" />
          </button>
        </div>
      ) : (
        <span className="shrink-0 text-xs text-slate-400">进入</span>
      )}
    </div>
  );
}
