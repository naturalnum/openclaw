import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type { WorkbenchFileEntry } from "../../../adapters/workbench-adapter";
import { ROUTES } from "../../router/paths";

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
};

export function ChatWorkspaceFilesPanel({ adapter, agentId }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<WorkbenchFileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [adapter, agentId, path]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await adapter.uploadProjectFiles(agentId.trim(), path, payload);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/80">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white px-3 py-2 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-500">当前目录</p>
          <p className="truncate text-sm text-slate-900">{breadcrumb}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={parentPath === null || loading}
            onClick={() => setPath(parentPath)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            上级
          </button>
          <button
            type="button"
            disabled={uploading || loading}
            onClick={() => uploadRef.current?.click()}
            className="rounded-lg bg-[#0d6b52] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#0a5844] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "上传中…" : "上传到工作区"}
          </button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => void onUploadChange(e)}
          />
          <Link
            to={ROUTES.workbench}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            工作台
          </Link>
        </div>
      </div>

      <div className="power-chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6">
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
          <ul className="mx-auto max-w-3xl divide-y divide-slate-200/90 rounded-xl border border-slate-200/90 bg-white shadow-sm">
            {entries.map((entry) => (
              <li
                key={`${entry.kind}:${entry.path}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={entry.kind !== "directory"}
                    onClick={() => entry.kind === "directory" && setPath(entry.path)}
                    className={cn(
                      "truncate text-left font-medium",
                      entry.kind === "directory"
                        ? "text-[#0d6b52] hover:underline"
                        : "cursor-default text-slate-900",
                    )}
                  >
                    {entry.kind === "directory" ? `${entry.name}` : `${entry.name}`}
                  </button>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {entry.kind === "file" ? formatBytes(entry.size) : "文件夹 · 点击进入"}
                  </div>
                </div>
                {entry.kind === "file" ? (
                  <button
                    type="button"
                    onClick={() => void onDownload(entry)}
                    className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    下载
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-slate-400">进入</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mx-auto mt-4 max-w-3xl text-center text-[11px] leading-relaxed text-slate-500">
          以上为当前项目<strong className="font-medium text-slate-600">工作区磁盘</strong>中的文件，与助手工具读写的目录一致。
          对话输入栏里附带的图片<strong className="font-medium text-slate-600">只走消息</strong>，不会自动出现在本列表；需要落盘请在此上传，或在未打开对话页时从侧栏项目行右侧文件夹进入本面板。
        </p>
      </div>
    </div>
  );
}
