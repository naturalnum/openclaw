import {
  AppstoreOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoreOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Drawer } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { AgentsListResult } from "../../compat/types";
import type { UiSettings } from "../../compat/ui-core";
import { isProtectedMainSessionKey } from "../../integrations/openclaw/session-keys";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import type { RecentSessionNavItem } from "../hooks/useRecentSessionsForNav";
import { useRecentSessionsForNav } from "../hooks/useRecentSessionsForNav";
import { ChatWorkspaceFilesPanel } from "../components/chat/ChatWorkspaceFilesPanel";
import { PowerBrandMark } from "../components/ui/PowerBrandMark";
import { resolveProjectWorkspacePath } from "../lib/global-model-config";
import { ROUTES } from "../router/paths";
import { SETTINGS_NAV_ITEMS } from "../router/settings-nav";

const SIDEBAR_EXPANDED = 260;
const SIDEBAR_COLLAPSED = 72;

const NAV = [
  { key: "chat", path: ROUTES.root, end: true, label: "对话", icon: <MessageOutlined /> },
  { key: "workbench", path: ROUTES.workbench, label: "工作台", icon: <AppstoreOutlined /> },
  { key: "skills", path: ROUTES.skills, label: "技能", icon: <ThunderboltOutlined /> },
] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pathTitle(pathname: string): string {
  if (pathname === ROUTES.root || pathname === "") {
    return "对话";
  }
  if (pathname === ROUTES.workbench) {
    return "工作台";
  }
  if (pathname === ROUTES.skills) {
    return "技能";
  }
  if (pathname === ROUTES.settingsConnection) {
    return "设置 · 连接";
  }
  if (pathname === ROUTES.settingsModels) {
    return "设置 · 模型";
  }
  if (pathname === ROUTES.settingsConnectors) {
    return "设置 · 连接器";
  }
  if (pathname === ROUTES.settingsMcp) {
    return "设置 · MCP";
  }
  if (pathname === ROUTES.settings || pathname.startsWith(`${ROUTES.settings}/`)) {
    return "设置";
  }
  return "小龙虾助手";
}

type NavProject = { id: string; name: string };

type SidebarNavProps = {
  collapsed: boolean;
  /** 桌面侧栏折叠/展开；移动端抽屉不传，避免无意义的收起按钮 */
  onToggleCollapsed?: () => void;
  onPick?: () => void;
  adapter: GatewayWorkbenchAdapter | null;
  settings: UiSettings;
  patchSettings: (patch: Partial<UiSettings>) => void;
  recentSessions: RecentSessionNavItem[];
  recentLoading: boolean;
  onRecentSessionsChange: () => void;
  projects: NavProject[];
  projectsLoading: boolean;
  onProjectsReload: () => void;
};

function SidebarNav({
  collapsed,
  onToggleCollapsed,
  onPick,
  adapter,
  settings,
  patchSettings,
  recentSessions,
  recentLoading,
  onRecentSessionsChange,
  projects,
  projectsLoading,
  onProjectsReload,
}: SidebarNavProps) {
  const navigate = useNavigate();

  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [projectFilesAgentId, setProjectFilesAgentId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const createProjectDialogRef = useRef<HTMLDialogElement>(null);
  const [renameKey, setRenameKey] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [createProjectBusy, setCreateProjectBusy] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const location = useLocation();
  const [settingsFlyoutOpen, setSettingsFlyoutOpen] = useState(false);
  const settingsFlyoutRef = useRef<HTMLDivElement | null>(null);

  const isSettingsSection = location.pathname.startsWith(ROUTES.settings);

  useEffect(() => {
    if (!openMenuKey) {
      return;
    }
    const onDoc = (ev: MouseEvent) => {
      const el = menuRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) {
        setOpenMenuKey(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenuKey]);

  useEffect(() => {
    if (!settingsFlyoutOpen || !collapsed) {
      return;
    }
    const onDoc = (ev: MouseEvent) => {
      const el = settingsFlyoutRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) {
        setSettingsFlyoutOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [settingsFlyoutOpen, collapsed]);

  useEffect(() => {
    if (!collapsed) {
      setSettingsFlyoutOpen(false);
    }
  }, [collapsed]);

  const closeMenu = useCallback(() => setOpenMenuKey(null), []);

  const handleDeleteSession = useCallback(
    async (sessionKey: string) => {
      if (!adapter) {
        return;
      }
      if (isProtectedMainSessionKey(sessionKey)) {
        window.alert("主会话受保护，无法删除。");
        return;
      }
      if (!window.confirm("确定删除此会话？不可恢复。")) {
        return;
      }
      try {
        await adapter.deleteSession(sessionKey);
        const cur = settings.sessionKey.trim();
        if (cur === sessionKey.trim()) {
          patchSettings({ sessionKey: "", lastActiveSessionKey: "" });
        }
        closeMenu();
        onRecentSessionsChange();
      } catch {
        // ignore
      }
    },
    [adapter, closeMenu, onRecentSessionsChange, patchSettings, settings.sessionKey],
  );

  const openRename = useCallback((s: RecentSessionNavItem) => {
    setRenameKey(s.key);
    setRenameDraft(s.label);
    closeMenu();
    renameDialogRef.current?.showModal();
  }, [closeMenu]);

  const openCreateProject = useCallback(() => {
    setNewProjectName("");
    setCreateProjectError(null);
    createProjectDialogRef.current?.showModal();
  }, []);

  const submitCreateProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!adapter || !name) {
      return;
    }
    setCreateProjectBusy(true);
    setCreateProjectError(null);
    try {
      const snap = await adapter.request<{ config?: Record<string, unknown> | null }>("config.get", {});
      const workspace = resolveProjectWorkspacePath(snap.config ?? null, name);
      const projectId = await adapter.createProject(name, workspace);
      if (!projectId) {
        throw new Error("创建失败，请检查项目名称与工作区路径。");
      }
      createProjectDialogRef.current?.close();
      onProjectsReload();
      onPick?.();
      navigate({ pathname: ROUTES.root, search: `?projectId=${encodeURIComponent(projectId)}` });
    } catch (err) {
      setCreateProjectError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateProjectBusy(false);
    }
  }, [adapter, navigate, newProjectName, onPick, onProjectsReload]);

  const submitRename = useCallback(async () => {
    const key = renameKey.trim();
    const label = renameDraft.trim();
    if (!adapter || !key || !label) {
      return;
    }
    try {
      await adapter.renameSession(key, label);
      renameDialogRef.current?.close();
      onRecentSessionsChange();
    } catch {
      // ignore
    }
  }, [adapter, onRecentSessionsChange, renameDraft, renameKey]);

  const projectFilesDrawerTitle = useMemo(() => {
    if (!projectFilesAgentId) {
      return "工作区文件";
    }
    const row = projects.find((p) => p.id === projectFilesAgentId);
    return row ? `${row.name} · 工作区文件` : "工作区文件";
  }, [projectFilesAgentId, projects]);

  const navItemShell =
    "flex items-center rounded-xl text-[14px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#0d6b52]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f3f4f3]";
  const navItemExpanded = "gap-3 px-3 py-2.5";
  /** 收起时收窄选中底，避免贴满侧栏宽度 */
  const navItemCollapsed = "mx-auto h-10 w-10 shrink-0 justify-center gap-0 p-0";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {collapsed ? (
        <div className="flex w-full shrink-0 justify-center px-2 pb-2 pt-3">
          <div className="group relative inline-flex items-center justify-center rounded-xl bg-white/60 p-1.5 shadow-sm ring-1 ring-slate-200/60">
            <PowerBrandMark compact showSubtitle={false} />
            {onToggleCollapsed ? (
              <button
                type="button"
                aria-label="展开侧栏"
                onClick={onToggleCollapsed}
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded-[10px]",
                  "bg-white/95 text-slate-700 ring-1 ring-slate-200/80",
                  "opacity-0 transition-opacity duration-150",
                  "pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                  "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d6b52]/25",
                )}
              >
                <MenuUnfoldOutlined className="text-lg leading-none" />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
          <div className="flex w-full min-w-0 items-center gap-2 rounded-xl bg-white/60 px-2 py-1.5 shadow-sm ring-1 ring-slate-200/60">
            <div className="min-w-0 flex-1">
              <PowerBrandMark />
            </div>
            {onToggleCollapsed ? (
              <button
                type="button"
                aria-label="收起侧栏"
                onClick={onToggleCollapsed}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-white/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d6b52]/25"
              >
                <MenuFoldOutlined className="text-lg leading-none" />
              </button>
            ) : null}
          </div>
        </div>
      )}

      <nav className={cn("flex shrink-0 flex-col gap-0.5", collapsed ? "px-2" : "px-2")} aria-label="主导航">
        {NAV.map((item) => (
          <NavLink
            key={item.key}
            to={"search" in item ? { pathname: item.path, search: item.search } : item.path}
            end={item.key === "chat"}
            title={collapsed ? item.label : undefined}
            onClick={() => onPick?.()}
            className={({ isActive }) =>
              cn(
                navItemShell,
                collapsed ? navItemCollapsed : navItemExpanded,
                isActive
                  ? "bg-white font-medium text-[#0d6b52] shadow-sm ring-1 ring-slate-200/70"
                  : "text-slate-600 hover:bg-white/50 hover:text-slate-900",
              )
            }
          >
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center text-base", collapsed && "text-lg")}>
              {item.icon}
            </span>
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>

      {!collapsed ? (
        <>
          <div className="mt-1 shrink-0 border-t border-slate-200/70 px-2 pt-2">
            <button
              type="button"
              aria-expanded={projectsOpen}
              onClick={() => setProjectsOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-slate-600 transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50"
            >
              <span
                className={cn(
                  "inline-flex w-4 shrink-0 justify-center text-slate-400 transition-transform duration-150",
                  projectsOpen ? "rotate-90" : "",
                )}
                aria-hidden
              >
                ▸
              </span>
              <span className="min-w-0 flex-1 truncate">项目</span>
              {projectsLoading ? (
                <span className="shrink-0 text-[10px] text-slate-400">…</span>
              ) : (
                <span className="shrink-0 tabular-nums text-[10px] font-normal text-slate-400">{projects.length}</span>
              )}
            </button>
            {projectsOpen ? (
              <div className="mt-1 space-y-0.5 px-0.5 pb-2">
                <button
                  type="button"
                  onClick={openCreateProject}
                  disabled={!adapter || createProjectBusy}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-[#0d6b52] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FolderAddOutlined className="text-sm" />
                  <span>新建项目</span>
                </button>
                {projects.map((p) => (
                  <div key={p.id} className="group flex items-stretch gap-0.5 rounded-lg hover:bg-white/60">
                    <Link
                      to={{ pathname: ROUTES.root, search: `?projectId=${encodeURIComponent(p.id)}` }}
                      title={p.name}
                      onClick={() => onPick?.()}
                      className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-[12px] text-slate-800 transition hover:bg-white/70"
                    >
                      {p.name}
                    </Link>
                    <button
                      type="button"
                      aria-label={`${p.name} 工作区文件`}
                      title="工作区文件"
                      disabled={!adapter}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setProjectFilesAgentId(p.id);
                      }}
                      className="flex shrink-0 items-center justify-center rounded-lg px-1.5 text-slate-500 transition hover:bg-white/90 hover:text-[#0d6b52] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <FolderOpenOutlined className="text-base" />
                    </button>
                  </div>
                ))}
                {!projectsLoading && projects.length === 0 ? (
                  <p className="px-1.5 py-1 text-[11px] text-slate-500">暂无项目，可在工作台创建</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200/70 px-2 pt-2">
            <button
              type="button"
              aria-expanded={recentOpen}
              onClick={() => setRecentOpen((o) => !o)}
              className="flex w-full shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-slate-600 transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/50"
            >
              <span
                className={cn(
                  "inline-flex w-4 shrink-0 justify-center text-slate-400 transition-transform duration-150",
                  recentOpen ? "rotate-90" : "",
                )}
                aria-hidden
              >
                ▸
              </span>
              <span className="min-w-0 flex-1 truncate">最近</span>
              {recentLoading ? (
                <span className="shrink-0 text-[10px] font-normal text-slate-400">…</span>
              ) : (
                <span className="shrink-0 tabular-nums text-[10px] font-normal text-slate-400">{recentSessions.length}</span>
              )}
            </button>
            {recentOpen ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-2 pt-0.5">
                {!recentLoading && recentSessions.length === 0 ? (
                  <p className="px-1.5 py-2 text-center text-[11px] leading-snug text-slate-500">暂无会话</p>
                ) : null}
                <div className="space-y-0.5">
                  {recentSessions.map((s) => (
                    <div key={s.key} className="group relative flex items-stretch gap-0.5 rounded-lg hover:bg-white/60">
                      <Link
                        to={{ pathname: ROUTES.root, search: `?sessionKey=${encodeURIComponent(s.key)}` }}
                        title={s.label}
                        onClick={() => onPick?.()}
                        className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12px] font-medium leading-snug text-slate-800 transition"
                      >
                        {s.label}
                      </Link>
                      <div className="relative flex shrink-0 items-center pr-0.5">
                        <button
                          type="button"
                          aria-label="会话操作"
                          aria-expanded={openMenuKey === s.key}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenMenuKey((k) => (k === s.key ? null : s.key));
                          }}
                          className="rounded-md p-1 text-slate-500 transition hover:bg-white hover:text-slate-800"
                        >
                          <MoreOutlined className="text-base" />
                        </button>
                        {openMenuKey === s.key ? (
                          <div
                            ref={menuRef}
                            className="absolute right-0 top-full z-30 mt-0.5 min-w-[7.5rem] rounded-lg border border-slate-200/90 bg-white py-1 shadow-lg"
                            role="menu"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-800 hover:bg-slate-50"
                              onClick={() => openRename(s)}
                            >
                              重命名
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50"
                              onClick={() => void handleDeleteSession(s.key)}
                            >
                              删除
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div className={cn("mt-auto shrink-0 border-t border-slate-200/70", collapsed ? "px-2 py-3" : "px-2 py-3")}>
        <div
          ref={settingsFlyoutRef}
          className={cn("relative", !collapsed && "group/settings")}
        >
          {collapsed ? (
            <button
              type="button"
              title="设置"
              aria-expanded={settingsFlyoutOpen}
              aria-haspopup="menu"
              onClick={() => setSettingsFlyoutOpen((v) => !v)}
              className={cn(
                navItemShell,
                navItemCollapsed,
                isSettingsSection
                  ? "bg-white font-medium text-[#0d6b52] shadow-sm ring-1 ring-slate-200/70"
                  : "text-slate-600 hover:bg-white/50 hover:text-slate-900",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center text-base",
                  "text-lg",
                )}
              >
                <SettingOutlined />
              </span>
            </button>
          ) : (
            <NavLink
              to={ROUTES.settingsConnection}
              title="设置"
              onClick={() => onPick?.()}
              className={cn(
                navItemShell,
                navItemExpanded,
                isSettingsSection
                  ? "bg-white font-medium text-[#0d6b52] shadow-sm ring-1 ring-slate-200/70"
                  : "text-slate-600 hover:bg-white/50 hover:text-slate-900",
              )}
            >
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center text-base")}>
                <SettingOutlined />
              </span>
              <span className="truncate">设置</span>
            </NavLink>
          )}

          <div
            className={cn(
              "absolute bottom-0 left-[calc(100%-1px)] z-[60] min-w-[14rem] rounded-xl border border-slate-200/90 bg-white py-2 shadow-xl transition-[opacity,visibility] duration-150",
              collapsed
                ? settingsFlyoutOpen
                  ? "visible opacity-100"
                  : "invisible pointer-events-none opacity-0"
                : "invisible pointer-events-none opacity-0 group-hover/settings:visible group-hover/settings:pointer-events-auto group-hover/settings:opacity-100",
            )}
            role="menu"
            aria-label="设置分区"
          >
            {SETTINGS_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.path}
                role="menuitem"
                to={item.path}
                title={item.description}
                onClick={() => {
                  onPick?.();
                  setSettingsFlyoutOpen(false);
                }}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 px-3 py-2 text-left text-[13px] transition",
                    isActive
                      ? "bg-[#0d6b52]/10 font-medium text-[#0d6b52]"
                      : "text-slate-700 hover:bg-slate-50",
                  )
                }
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[13px] text-slate-600">
                  {item.icon}
                </span>
                <span className="min-w-0 truncate font-medium">{item.title}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      <Drawer
        title={projectFilesDrawerTitle}
        placement="right"
        width={480}
        open={projectFilesAgentId !== null}
        onClose={() => setProjectFilesAgentId(null)}
        destroyOnClose
        styles={{ body: { padding: 0, height: "100%" } }}
      >
        {adapter && projectFilesAgentId ? (
          <div className="h-[calc(100dvh-108px)] min-h-[320px]">
            <ChatWorkspaceFilesPanel adapter={adapter} agentId={projectFilesAgentId} />
          </div>
        ) : null}
      </Drawer>

      <dialog
        ref={createProjectDialogRef}
        className="w-[min(100vw-2rem,22rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/25"
        onClose={() => {
          setNewProjectName("");
          setCreateProjectError(null);
        }}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreateProject();
          }}
        >
          <h2 className="text-sm font-semibold text-slate-900">新建项目</h2>
          <p className="text-xs leading-snug text-slate-500">
            输入项目名称；工作区目录将创建在默认 workspace 下。
          </p>
          <input
            type="text"
            value={newProjectName}
            onChange={(ev) => setNewProjectName(ev.target.value)}
            placeholder="项目名称"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-300/35"
            autoFocus
          />
          {createProjectError ? (
            <p className="text-xs text-red-600" role="alert">
              {createProjectError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => createProjectDialogRef.current?.close()}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!newProjectName.trim() || createProjectBusy}
              className="rounded-lg bg-[#0d6b52] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0a5844] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createProjectBusy ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={renameDialogRef}
        className="w-[min(100vw-2rem,22rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/25"
        onClose={() => setRenameDraft("")}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitRename();
          }}
        >
          <h2 className="text-sm font-semibold text-slate-900">重命名会话</h2>
          <input
            type="text"
            value={renameDraft}
            onChange={(ev) => setRenameDraft(ev.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-300/35"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => renameDialogRef.current?.close()}
            >
              取消
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[#0d6b52] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#0a5844]"
            >
              保存
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

/**
 * ChatGPT 式应用壳：左侧主导航 + 可折叠侧栏；主区交给子路由。
 */
export function PowerShellLayout() {
  const location = useLocation();
  const { settings, patchSettings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const { sessions: recentSessions, loading: recentLoading, refetch: refetchRecent } =
    useRecentSessionsForNav(adapter);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navProjects, setNavProjects] = useState<NavProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsReloadToken, setProjectsReloadToken] = useState(0);

  const reloadProjects = useCallback(() => {
    setProjectsReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!adapter) {
      setNavProjects([]);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    void (async () => {
      try {
        const res = await adapter.request<AgentsListResult>("agents.list", {});
        const rows = (res.agents ?? []).map((a) => ({
          id: a.id,
          name: (a.identity?.name ?? a.name ?? a.id).trim() || a.id,
        }));
        if (!cancelled) {
          setNavProjects(rows);
        }
      } catch {
        if (!cancelled) {
          setNavProjects([]);
        }
      } finally {
        if (!cancelled) {
          setProjectsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adapter, projectsReloadToken]);

  const mobileTitle = useMemo(() => pathTitle(location.pathname), [location.pathname]);

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const navProps = {
    adapter,
    settings,
    patchSettings,
    recentSessions,
    recentLoading,
    onRecentSessionsChange: () => void refetchRecent(),
    projects: navProjects,
    projectsLoading,
    onProjectsReload: reloadProjects,
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white px-3 shadow-sm md:hidden">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 active:scale-95"
          aria-label="打开菜单"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <MenuOutlined className="text-lg" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{mobileTitle}</span>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        <aside
          className="hidden min-h-0 shrink-0 flex-col border-r border-slate-200/80 bg-[#f3f4f3] md:flex"
          style={{ width: sidebarWidth }}
        >
          <div className="flex min-h-0 flex-1 flex-col pt-1">
            <SidebarNav
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((c) => !c)}
              {...navProps}
            />
          </div>
        </aside>

        {mobileNavOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[1px] md:hidden"
              aria-label="关闭菜单"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 flex w-[min(100vw,280px)] max-w-[88vw] flex-col border-r border-slate-200/80 bg-[#f3f4f3] shadow-2xl md:hidden">
              <div className="flex items-center justify-between border-b border-slate-200/80 px-3 py-2.5">
                <span className="text-sm font-semibold text-slate-900">菜单</span>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-sm text-slate-600 transition hover:bg-white/70 active:scale-95"
                  onClick={() => setMobileNavOpen(false)}
                >
                  完成
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 pb-2 pt-1">
                <SidebarNav collapsed={false} onPick={() => setMobileNavOpen(false)} {...navProps} />
              </div>
            </aside>
          </>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
