import {
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type {
  WorkbenchFileEntry,
  WorkbenchFilePreviewResult,
  WorkbenchFilePreviewMode,
} from "../../../adapters/workbench-adapter";
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
};

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
  if (lower.endsWith(".pdf")) {
    return "pdf";
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
}: Props) {
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
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "ok" | "fail">("idle");
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const id = agentId.trim();
    if (!id) {
      return;
    }
    setLoading(true);
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
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [adapter, agentId, path]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const onUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files?.length) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const payload = Array.from(files).map((file) => ({ name: file.name, file }));
      const uploaded = await adapter.uploadProjectFiles(agentId.trim(), path, payload);
      if (uploaded.length > 0) {
        setEntries((current) => {
          const uploadedPaths = new Set(uploaded.map((entry) => entry.path));
          return [...uploaded, ...current.filter((entry) => !uploadedPaths.has(entry.path))];
        });
      }
      await load();
      window.setTimeout(() => {
        void load();
      }, 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    setPaneMode("split");
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

  const onDelete = async (entry: WorkbenchFileEntry) => {
    if (entry.kind !== "file") {
      return;
    }
    if (!window.confirm(`确定删除「${entry.name}」？此操作不可恢复。`)) {
      return;
    }
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
  };

  const sortedFiles = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === "file")
        .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0)),
    [entries],
  );
  const recentFiles = sortedFiles.slice(0, 6);
  const visibleFiles = showAllFiles ? sortedFiles : recentFiles;
  const hasMoreFiles = sortedFiles.length > recentFiles.length;

  const previewBlobUrl = useMemo(() => {
    if (preview.status !== "ready" || !preview.result || preview.result.mode === "text") {
      return "";
    }
    return URL.createObjectURL(preview.result.blob);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void onUploadChange(e)}
      />
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
            <button
              type="button"
              disabled={uploading || loading}
              onClick={() => uploadRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadOutlined className="text-[12px]" />
              {uploading ? "上传中…" : "上传到工作区"}
            </button>
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
            "power-chat-scroll min-h-0 overflow-y-auto bg-white px-3 py-4",
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
          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500">加载中…</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">此目录暂无文件</div>
          ) : (
            <div className="mx-auto max-w-xl">
              <div className="power-surface rounded-xl border p-2.5 backdrop-blur">
                <div className="flex items-start justify-between gap-3 px-2 pb-2 pt-1">
                  <button
                    type="button"
                    aria-expanded={!recentCollapsed}
                    onClick={() => setRecentCollapsed((v) => !v)}
                    className="flex min-w-0 flex-1 items-start gap-1.5 rounded-lg text-left transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200/60"
                  >
                    <DownOutlined
                      className={cn(
                        "mt-0.5 shrink-0 text-[10px] text-slate-400 transition-transform",
                        recentCollapsed ? "-rotate-90" : "",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-600">最近修改</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        默认展示最近修改的 6 个文件
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={uploading || loading}
                    onClick={() => uploadRef.current?.click()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UploadOutlined className="text-[12px]" />
                    {uploading ? "上传中…" : "上传文件"}
                  </button>
                </div>
                {!recentCollapsed ? (
                  <div className="space-y-1">
                    {recentFiles.length === 0 ? (
                      <p className="px-2 py-4 text-center text-xs text-slate-500">
                        当前目录暂无文件
                      </p>
                    ) : (
                      visibleFiles.map((entry) => (
                        <FileCard
                          key={`${entry.kind}:${entry.path}`}
                          entry={entry}
                          active={preview.entry?.path === entry.path}
                          onOpen={() => void openPreview(entry)}
                          onDownload={() => void onDownload(entry)}
                          onDelete={() => void onDelete(entry)}
                        />
                      ))
                    )}
                  </div>
                ) : null}
                {hasMoreFiles && !recentCollapsed ? (
                  <button
                    type="button"
                    onClick={() => setShowAllFiles((v) => !v)}
                    className="mt-2 flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white/86 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:bg-blue-50/45 hover:text-blue-700"
                  >
                    {showAllFiles ? "收起" : `更多，查看全部 ${sortedFiles.length} 个文件`}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <section
          className={cn(
            "min-h-0 min-w-0 flex-col bg-white/95",
            previewPaneHidden ? "hidden" : "flex",
          )}
        >
          {preview.entry ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/70 bg-white/95 px-4 py-3 backdrop-blur">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {preview.entry.name}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {formatBytes(preview.entry.size)} · {formatUpdatedAt(preview.entry.updatedAtMs)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
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
                    onClick={() => setPaneMode((m) => (m === "preview" ? "split" : "preview"))}
                    className="power-soft-button rounded-xl border border-slate-200 px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50"
                  >
                    预览全屏
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDownload(preview.entry)}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-blue-500"
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
                        className="chat-markdown mx-auto max-w-3xl break-words text-[15px] leading-relaxed text-slate-800 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
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
                    src={previewBlobUrl}
                    className="h-full w-full border-0"
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
  const canPreview = entry.kind === "directory" || previewModeForEntry(entry) !== null;
  return (
    <div
      className={cn(
        "group flex items-center gap-2.5 rounded-xl border px-2.5 py-2.5 transition-[background-color,border-color,box-shadow,transform]",
        active
          ? "border-blue-200 bg-blue-50/70 shadow-sm shadow-blue-100/70"
          : "border-transparent bg-slate-50/65 hover:border-blue-100 hover:bg-white hover:shadow-sm hover:shadow-slate-200/40",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            entry.kind === "directory"
              ? "bg-blue-50 text-blue-600"
              : "bg-white text-slate-500 ring-1 ring-slate-200/70",
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
          <span className="block truncate text-sm font-semibold text-slate-900">{entry.name}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
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
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 opacity-90 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
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
            className="hidden h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-white text-red-500 transition hover:bg-red-50 hover:text-red-700 group-hover:flex focus-visible:flex"
          >
            <DeleteOutlined className="text-[14px]" />
          </button>
        </div>
      ) : (
        <span className="shrink-0 text-xs text-slate-400">进入</span>
      )}
      {entry.kind === "file" && !canPreview ? (
        <span className="hidden text-[10px] text-slate-400 sm:inline">不可预览</span>
      ) : null}
    </div>
  );
}
