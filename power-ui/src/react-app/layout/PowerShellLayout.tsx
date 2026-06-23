import {
  CaretRightOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { parseAgentSessionKey } from "../../../../ui/src/ui/session-key";
import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import { extractText } from "../../compat/chat";
import type { AgentsListResult } from "../../compat/types";
import type { UiSettings } from "../../compat/ui-core";
import {
  buildLocalUserScope,
  isProjectInLocalUserScope,
  stripScopedProjectName,
} from "../../integrations/openclaw/local-user-scope";
import {
  isPowerQuickSessionKey,
  isProtectedMainSessionKey,
} from "../../integrations/openclaw/session-keys";
import { PowerBrandMark } from "../components/ui/PowerBrandMark";
import { useLocalUsers } from "../context/LocalUsersContext";
import { useWorkbenchChat, WorkbenchChatProvider } from "../context/WorkbenchChatContext";
import { WorkspaceRailProvider } from "../context/WorkspaceRailContext";
import { useGatewayWorkbenchAdapter } from "../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import type { RecentSessionNavItem } from "../hooks/useRecentSessionsForNav";
import { useRecentSessionsForNav } from "../hooks/useRecentSessionsForNav";
import { resolveProjectWorkspacePath } from "../lib/global-model-config";
import { ROUTES } from "../router/paths";
import { SETTINGS_NAV_ITEMS } from "../router/settings-nav";

const SIDEBAR_EXPANDED = 260;
const SIDEBAR_COLLAPSED = 72;

const NAV = [
  {
    key: "chat",
    path: ROUTES.root,
    end: true,
    label: "新增对话",
    icon: <MessageOutlined />,
    search: "?new=1",
  },
  { key: "skills", path: ROUTES.skills, label: "技能", icon: <ThunderboltOutlined /> },
] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function ProjectCreateIcon() {
  return (
    <span className="relative inline-flex h-4 w-4 items-center justify-center" aria-hidden>
      <FolderOutlined className="text-[15px] leading-none [&_svg]:block" />
      <span className="absolute -right-1 -top-1 grid h-2.5 w-2.5 place-items-center rounded-full bg-white text-[7px] leading-none text-current">
        <PlusOutlined className="[&_svg]:block" />
      </span>
    </span>
  );
}

const DEFAULT_ATTACHMENT_PROMPT = "请阅读以下附件并回答。";
const CHAT_ATTACHMENT_LABEL_PATTERNS = [
  /\s*本轮对话附件：[\s\S]*?(?:请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。|$)/g,
  /\s*已上传到当前工作区的附件：[\s\S]*?(?:请把这些文件作为本轮对话上下文；需要内容时请直接读取对应路径。|$)/g,
];

function sessionDisplayLabel(label: string): string {
  const cleaned = CHAT_ATTACHMENT_LABEL_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, ""),
    label,
  ).trim();
  return cleaned === DEFAULT_ATTACHMENT_PROMPT ? "已上传文件" : cleaned || label;
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
  if (pathname === ROUTES.settingsAccount) {
    return "设置 · 账号";
  }
  if (pathname === ROUTES.settingsUsers) {
    return "设置 · 用户";
  }
  if (pathname === ROUTES.settings || pathname.startsWith(`${ROUTES.settings}/`)) {
    return "设置";
  }
  return "龙虾试验版";
}

type NavProject = { id: string; name: string; workspace: string | null };

function recentLabelFromMessages(messages: unknown[]): string {
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const row = message as { role?: unknown; content?: unknown };
    if (typeof row.role === "string" && row.role.toLowerCase() !== "user") {
      continue;
    }
    const text = extractText(message);
    if (text?.trim()) {
      return sessionDisplayLabel(text);
    }
  }
  return "新对话";
}

type SidebarNavProps = {
  collapsed: boolean;
  /** 桌面侧栏折叠/展开；移动端抽屉不传，避免无意义的收起按钮 */
  onToggleCollapsed?: () => void;
  onPick?: () => void;
  onSelectSession?: (
    sessionKey: string,
    projectId: string | null,
    options?: { skipSessionProject?: boolean },
  ) => void;
  onSelectProject?: (projectId: string) => void;
  adapter: GatewayWorkbenchAdapter | null;
  settings: UiSettings;
  patchSettings: (patch: Partial<UiSettings>) => void;
  recentSessions: RecentSessionNavItem[];
  recentLoading: boolean;
  onRecentSessionsChange: () => void;
  projects: NavProject[];
  projectsLoading: boolean;
  onProjectsReload: () => void;
  userFolder: string;
  localUsersEnabled: boolean;
  canManageUsers: boolean;
};

function SidebarNav({
  collapsed,
  onToggleCollapsed,
  onPick,
  onSelectSession,
  onSelectProject,
  adapter,
  settings,
  patchSettings,
  recentSessions,
  recentLoading,
  onRecentSessionsChange,
  projects,
  projectsLoading,
  onProjectsReload,
  userFolder,
  localUsersEnabled,
  canManageUsers,
}: SidebarNavProps) {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { selectedSessionKey, selectedProjectId } = useWorkbenchChat();

  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [openProjectMenuKey, setOpenProjectMenuKey] = useState<string | null>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedProjectSessionIds, setExpandedProjectSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const renameProjectDialogRef = useRef<HTMLDialogElement>(null);
  const createProjectDialogRef = useRef<HTMLDialogElement>(null);
  const [renameKey, setRenameKey] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [renameProjectId, setRenameProjectId] = useState("");
  const [renameProjectDraft, setRenameProjectDraft] = useState("");
  const [renameProjectError, setRenameProjectError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [createProjectBusy, setCreateProjectBusy] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [optimisticSessionKey, setOptimisticSessionKey] = useState("");
  const [projectContextOnlyId, setProjectContextOnlyId] = useState("");
  const location = useLocation();
  const [settingsFlyoutOpen, setSettingsFlyoutOpen] = useState(false);
  const settingsFlyoutRef = useRef<HTMLDivElement | null>(null);
  const visibleSettingsNavItems = useMemo(
    () =>
      SETTINGS_NAV_ITEMS.filter((item) => {
        if (item.path === ROUTES.settingsUsers) {
          return canManageUsers;
        }
        if (item.path === ROUTES.settingsAccount) {
          return localUsersEnabled && !canManageUsers;
        }
        return true;
      }),
    [canManageUsers, localUsersEnabled],
  );

  const isSettingsSection = location.pathname.startsWith(ROUTES.settings);
  const activeSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const urlSessionKey = activeSearchParams.get("sessionKey")?.trim() ?? "";
  const activeProjectFromSearch = activeSearchParams.get("projectId")?.trim() ?? "";
  const selectedProjectKey = selectedProjectId?.trim() ?? "";
  const activeSessionKey =
    selectedSessionKey.trim() ||
    urlSessionKey ||
    optimisticSessionKey ||
    (selectedProjectKey && projectContextOnlyId === selectedProjectKey
      ? ""
      : settings.sessionKey.trim());
  const activeProjectFromSession = activeSessionKey
    ? isPowerQuickSessionKey(activeSessionKey)
      ? ""
      : (parseAgentSessionKey(activeSessionKey)?.agentId ?? "")
    : "";
  const activeProjectId = selectedProjectKey || activeProjectFromSearch || activeProjectFromSession;

  const shellTreeRow = "power-shell-tree-row";
  const shellNavSelected = "power-shell-tree-row--selected font-semibold text-neutral-900";
  const shellNavIdle = "text-neutral-600";
  const shellNavHover =
    "hover:bg-stone-100/80 focus-visible:bg-stone-100/80 aria-[current=page]:bg-stone-100/90";

  const sessionNavItemClass = (selected: boolean) =>
    cn(
      shellTreeRow,
      shellNavHover,
      "group/session relative flex items-center gap-0.5 rounded-xl",
      selected ? shellNavSelected : shellNavIdle,
    );

  const sessionLinkClass = (selected: boolean) =>
    cn(
      "min-w-0 flex-1 truncate py-1 text-left text-[12.5px] leading-snug transition",
      selected ? "text-slate-900" : "font-medium text-slate-600 hover:text-slate-900",
    );

  useEffect(() => {
    if (!openMenuKey && !openProjectMenuKey) {
      return undefined;
    }
    const onDoc = (ev: MouseEvent) => {
      const el = menuRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) {
        setOpenMenuKey(null);
        setOpenProjectMenuKey(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenuKey, openProjectMenuKey]);

  useEffect(() => {
    if (!settingsFlyoutOpen) {
      return undefined;
    }
    const onDoc = (ev: MouseEvent) => {
      const el = settingsFlyoutRef.current;
      if (el && ev.target instanceof Node && !el.contains(ev.target)) {
        setSettingsFlyoutOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [settingsFlyoutOpen]);

  useEffect(() => {
    if (!collapsed) {
      setSettingsFlyoutOpen(false);
    }
  }, [collapsed]);

  useEffect(() => {
    if (selectedSessionKey.trim()) {
      setOptimisticSessionKey("");
    }
  }, [selectedSessionKey]);

  const closeMenu = useCallback(() => setOpenMenuKey(null), []);
  const closeProjectMenu = useCallback(() => setOpenProjectMenuKey(null), []);

  const sessionsByProject = useMemo(() => {
    const grouped = new Map<string, RecentSessionNavItem[]>();
    for (const session of recentSessions) {
      if (isProtectedMainSessionKey(session.key)) {
        continue;
      }
      if (isPowerQuickSessionKey(session.key)) {
        continue;
      }
      const agentId = parseAgentSessionKey(session.key)?.agentId ?? "";
      if (!agentId) {
        continue;
      }
      const list = grouped.get(agentId) ?? [];
      list.push(session);
      grouped.set(agentId, list);
    }
    return grouped;
  }, [recentSessions]);

  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const recentOnlySessions = useMemo(
    () =>
      recentSessions.filter((session) => {
        if (isProtectedMainSessionKey(session.key)) {
          return true;
        }
        if (isPowerQuickSessionKey(session.key)) {
          return true;
        }
        const agentId = parseAgentSessionKey(session.key)?.agentId ?? "";
        return !agentId || !projectIds.has(agentId);
      }),
    [projectIds, recentSessions],
  );

  const handleDeleteSession = useCallback(
    async (sessionKey: string) => {
      if (!adapter) {
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
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除会话失败");
      }
    },
    [adapter, closeMenu, message, onRecentSessionsChange, patchSettings, settings.sessionKey],
  );

  const openRename = useCallback(
    (s: RecentSessionNavItem) => {
      setRenameKey(s.key);
      setRenameDraft(s.label);
      closeMenu();
      renameDialogRef.current?.showModal();
    },
    [closeMenu],
  );

  const openProjectRename = useCallback(
    (project: NavProject) => {
      setRenameProjectId(project.id);
      setRenameProjectDraft(project.name);
      setRenameProjectError(null);
      closeProjectMenu();
      renameProjectDialogRef.current?.showModal();
    },
    [closeProjectMenu],
  );

  const openCreateProject = useCallback(() => {
    setNewProjectName("");
    setCreateProjectError(null);
    setCreateProjectDialogOpen(true);
    createProjectDialogRef.current?.showModal();
  }, []);

  const submitCreateProject = useCallback(async () => {
    const name = newProjectName.trim();
    if (!adapter || !name) {
      return;
    }
    if (projects.some((project) => project.name.trim() === name)) {
      setCreateProjectError("项目名称已存在，请换一个名称。");
      return;
    }
    setCreateProjectBusy(true);
    setCreateProjectError(null);
    try {
      const snap = await adapter.request<{ config?: Record<string, unknown> | null }>(
        "config.get",
        {},
      );
      const workspace = resolveProjectWorkspacePath(
        snap.config ?? null,
        name,
        projects
          .map((project) => project.workspace)
          .filter((workspace): workspace is string => Boolean(workspace?.trim())),
        { userFolder },
      );
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
  }, [adapter, navigate, newProjectName, onPick, onProjectsReload, projects, userFolder]);

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

  const submitProjectRename = useCallback(async () => {
    const id = renameProjectId.trim();
    const name = renameProjectDraft.trim();
    if (!adapter || !id || !name) {
      return;
    }
    if (projects.some((project) => project.id !== id && project.name.trim() === name)) {
      setRenameProjectError("项目名称已存在，请换一个名称。");
      return;
    }
    try {
      setRenameProjectError(null);
      await adapter.renameProject(id, name);
      renameProjectDialogRef.current?.close();
      onProjectsReload();
    } catch (err) {
      setRenameProjectError(err instanceof Error ? err.message : String(err));
    }
  }, [adapter, onProjectsReload, projects, renameProjectDraft, renameProjectId]);

  const deleteProject = useCallback(
    (project: NavProject) => {
      if (!adapter) {
        return;
      }
      modal.confirm({
        title: "删除项目",
        content: `确定删除项目「${project.name}」？不可恢复，项目工作区与会话文件将一并移入系统废纸篓。`,
        okText: "删除",
        okType: "danger",
        cancelText: "取消",
        onOk: async () => {
          try {
            await adapter.deleteProject(project.id);
            closeProjectMenu();
            onProjectsReload();
            navigate(ROUTES.root);
          } catch {
            // ignore
          }
        },
      });
    },
    [adapter, closeProjectMenu, modal, navigate, onProjectsReload],
  );

  const navItemShell =
    "flex items-center rounded-2xl text-[13px] transition-[background-color,color,box-shadow,transform] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#d7d7d2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f8f8f7] active:scale-[0.99]";
  const navItemExpanded = "w-full gap-2.5 px-3 py-2 text-left";
  /** 收起时仅包住图标，避免 2px 边框把点击区撑得过大 */
  const navItemCollapsed = "mx-auto h-9 w-9 shrink-0 justify-center gap-0 p-0";
  const sectionHeaderButtonClass =
    "flex items-center gap-1.5 text-left text-[12px] font-semibold text-slate-500 transition hover:text-slate-800 focus-visible:outline-none";
  const sectionHeaderRowClass =
    "flex h-9 w-full items-center rounded-xl px-2 transition hover:bg-[rgba(28,25,23,0.05)] focus-within:bg-[rgba(28,25,23,0.05)]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {collapsed ? (
        <div className="power-shell-brand-header flex shrink-0 items-center justify-center px-2">
          <div className="group/brand relative flex h-9 w-9 items-center justify-center">
            <PowerBrandMark compact showSubtitle={false} />
            {onToggleCollapsed ? (
              <button
                type="button"
                aria-label="展开侧栏"
                onClick={onToggleCollapsed}
                className={cn(
                  "absolute inset-0 flex items-center justify-center rounded-lg",
                  "bg-stone-100/95 text-slate-700",
                  "opacity-0 transition-[opacity,background-color,color] duration-150",
                  "pointer-events-none group-hover/brand:opacity-100 group-hover/brand:pointer-events-auto",
                  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                  "focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
                )}
              >
                <MenuUnfoldOutlined className="text-[15px] leading-none" />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="power-shell-brand-header flex h-14 shrink-0 items-center gap-2 bg-white/95 px-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <PowerBrandMark showSubtitle={false} />
          </div>
          {onToggleCollapsed ? (
            <button
              type="button"
              aria-label="收起侧栏"
              onClick={onToggleCollapsed}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-200/55 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60"
            >
              <MenuFoldOutlined className="text-lg leading-none" />
            </button>
          ) : null}
        </div>
      )}

      <nav
        className={cn("flex shrink-0 flex-col px-2", collapsed ? "gap-1.5 pt-2" : "gap-1.5 pt-1.5")}
        aria-label="主导航"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.key}
            to={"search" in item ? { pathname: item.path, search: item.search } : item.path}
            end={item.key === "chat"}
            title={collapsed ? item.label : undefined}
            onClick={() => onPick?.()}
            className={({ isActive }) =>
              cn(
                shellTreeRow,
                navItemShell,
                shellNavHover,
                collapsed ? navItemCollapsed : navItemExpanded,
                isActive ? shellNavSelected : shellNavIdle,
              )
            }
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center text-[15px]",
                collapsed && "text-lg",
              )}
            >
              {item.icon}
            </span>
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </NavLink>
        ))}
      </nav>

      {!collapsed ? (
        <>
          <div className="mt-3 flex min-h-0 max-h-[58%] shrink flex-col overflow-hidden border-t border-slate-200/70 px-2 pb-2 pt-3">
            <div
              className={cn(
                sectionHeaderRowClass,
                "group/project-header",
                createProjectDialogOpen && "bg-[rgba(28,25,23,0.05)]",
              )}
            >
              <button
                type="button"
                aria-expanded={projectsOpen}
                onClick={() => setProjectsOpen((o) => !o)}
                className={cn(sectionHeaderButtonClass, "min-w-0 flex-1")}
              >
                <CaretRightOutlined
                  className={cn(
                    "w-3.5 shrink-0 text-[9px] text-slate-400 transition-transform duration-150",
                    projectsOpen ? "rotate-90" : "",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 truncate">项目</span>
                {projectsLoading ? (
                  <span className="shrink-0 text-[10px] font-normal text-slate-400">…</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label="新建项目"
                title="新建项目"
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateProject();
                }}
                disabled={!adapter || createProjectBusy}
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 opacity-0 transition hover:bg-slate-100/70 hover:text-slate-800 focus:opacity-100 focus-visible:outline-none group-hover/project-header:opacity-100 group-focus-within/project-header:opacity-100",
                  (projectsOpen || createProjectDialogOpen) && "opacity-70",
                  createProjectDialogOpen && "bg-slate-100/70 text-slate-800 opacity-100",
                  (!adapter || createProjectBusy) && "cursor-not-allowed opacity-30",
                )}
              >
                <ProjectCreateIcon />
              </button>
            </div>
            {projectsOpen ? (
              <div className="power-sidebar-scroll mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pb-2 pl-1">
                {projects.map((p) => {
                  const projectCollapsed = collapsedProjectIds.has(p.id);
                  const projectSessions = sessionsByProject.get(p.id) ?? [];
                  const projectSessionsExpanded = expandedProjectSessionIds.has(p.id);
                  const projectSelected = activeProjectId === p.id && !activeSessionKey;
                  const visibleProjectSessions = projectSessionsExpanded
                    ? projectSessions
                    : projectSessions.slice(0, 6);
                  return (
                    <div key={p.id} className="flex flex-col gap-1">
                      <div
                        className={cn(
                          shellTreeRow,
                          shellNavHover,
                          "group relative flex items-center gap-0.5 rounded-2xl",
                          projectSelected ? shellNavSelected : shellNavIdle,
                        )}
                      >
                        <button
                          type="button"
                          aria-label={`${p.name} ${projectCollapsed ? "展开" : "收起"}会话`}
                          aria-expanded={!projectCollapsed}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCollapsedProjectIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.id)) {
                                next.delete(p.id);
                              } else {
                                next.add(p.id);
                              }
                              return next;
                            });
                          }}
                          className="group/folder relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-transparent hover:text-slate-800"
                        >
                          {projectCollapsed ? (
                            <>
                              <FolderOutlined
                                className="text-[16px] transition-opacity group-hover/folder:hidden"
                                aria-hidden
                              />
                              <FolderOpenOutlined
                                className="hidden text-[16px] group-hover/folder:block"
                                aria-hidden
                              />
                            </>
                          ) : (
                            <>
                              <FolderOpenOutlined
                                className="text-[16px] transition-opacity group-hover/folder:hidden"
                                aria-hidden
                              />
                              <FolderOutlined
                                className="hidden text-[16px] group-hover/folder:block"
                                aria-hidden
                              />
                            </>
                          )}
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-1/2 top-[calc(100%+4px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-[#30343a]/92 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover/folder:opacity-100"
                          >
                            {projectCollapsed ? "展开" : "收起"}
                          </span>
                        </button>
                        <Link
                          to={{
                            pathname: ROUTES.root,
                            search: `?projectId=${encodeURIComponent(p.id)}`,
                          }}
                          aria-label={p.name}
                          onClick={() => {
                            setOptimisticSessionKey("");
                            setProjectContextOnlyId(p.id);
                            onSelectProject?.(p.id);
                            onPick?.();
                          }}
                          className={cn(
                            "min-w-0 flex-1 truncate rounded-xl py-1.5 pr-2 text-left text-[13px] font-semibold transition",
                            projectSelected ? "text-slate-900" : "text-slate-800",
                          )}
                        >
                          {p.name}
                        </Link>
                        <button
                          type="button"
                          aria-label={`${p.name} 项目操作`}
                          title="项目更多操作"
                          aria-expanded={openProjectMenuKey === p.id}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenProjectMenuKey((k) => (k === p.id ? null : p.id));
                            setOpenMenuKey(null);
                          }}
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-[rgba(28,25,23,0.05)] hover:text-slate-700 focus:opacity-100",
                            openProjectMenuKey === p.id
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <MoreOutlined className="text-base" />
                        </button>
                        {openProjectMenuKey === p.id ? (
                          <div
                            ref={menuRef}
                            className="absolute bottom-full right-0 z-30 mb-0.5 min-w-[8rem] rounded-lg border border-slate-200/90 bg-white py-1 shadow-lg"
                            role="menu"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-800 hover:bg-slate-50"
                              onClick={() => openProjectRename(p)}
                            >
                              <EditOutlined className="text-[13px] text-slate-500" />
                              重命名
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full px-3 py-2 text-left text-[12px] text-red-600 hover:bg-red-50"
                              onClick={() => deleteProject(p)}
                            >
                              删除
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {!collapsedProjectIds.has(p.id) ? (
                        <div className="ml-8 flex flex-col gap-1">
                          {visibleProjectSessions.map((s) => {
                            const sessionSelected = activeSessionKey === s.key;
                            const label = sessionDisplayLabel(s.label);
                            return (
                              <div key={s.key} className={sessionNavItemClass(sessionSelected)}>
                                <Link
                                  to={{
                                    pathname: ROUTES.root,
                                    search: `?sessionKey=${encodeURIComponent(s.key)}&projectId=${encodeURIComponent(p.id)}`,
                                  }}
                                  aria-label={label}
                                  onClick={() => {
                                    setOptimisticSessionKey(s.key);
                                    setProjectContextOnlyId("");
                                    patchSettings({
                                      sessionKey: s.key,
                                      lastActiveSessionKey: s.key,
                                    });
                                    void onSelectSession?.(s.key, p.id);
                                    onPick?.();
                                  }}
                                  className={cn(sessionLinkClass(sessionSelected), "pl-2 pr-2.5")}
                                >
                                  {label}
                                </Link>
                                <button
                                  type="button"
                                  aria-label="会话操作"
                                  aria-expanded={openMenuKey === s.key}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setOpenMenuKey((k) => (k === s.key ? null : s.key));
                                    setOpenProjectMenuKey(null);
                                  }}
                                  className={cn(
                                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100/65 hover:text-slate-800 focus:opacity-100",
                                    openMenuKey === s.key
                                      ? "opacity-100"
                                      : "opacity-0 group-hover/session:opacity-100",
                                  )}
                                >
                                  <MoreOutlined className="text-[15px]" />
                                </button>
                                {openMenuKey === s.key ? (
                                  <div
                                    ref={menuRef}
                                    className="absolute bottom-full right-0 z-30 mb-0.5 min-w-[7.5rem] rounded-lg border border-slate-200/90 bg-white py-1 shadow-lg"
                                    role="menu"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-slate-800 hover:bg-slate-50"
                                      onClick={() => openRename(s)}
                                    >
                                      <MessageOutlined className="text-[13px] text-slate-500" />
                                      重命名
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      title="删除会话"
                                      className="block w-full px-3 py-1.5 text-left text-[12px] text-red-600 transition hover:bg-red-50"
                                      onClick={() => void handleDeleteSession(s.key)}
                                    >
                                      删除
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                      {!collapsedProjectIds.has(p.id) && projectSessions.length > 6 ? (
                        <button
                          type="button"
                          className="ml-8 mt-0.5 inline-flex h-6 items-center rounded-full border border-slate-200/70 bg-white/70 px-2.5 text-[11px] font-medium text-slate-500 shadow-sm shadow-slate-200/30 transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                          onClick={() =>
                            setExpandedProjectSessionIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.id)) {
                                next.delete(p.id);
                              } else {
                                next.add(p.id);
                              }
                              return next;
                            })
                          }
                        >
                          {projectSessionsExpanded
                            ? "收起会话"
                            : `展示全部 ${projectSessions.length} 个会话`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {!projectsLoading && projects.length === 0 ? (
                  <p className="px-1.5 py-1 text-[11px] text-slate-500">
                    暂无项目，点击上方 + 创建
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex min-h-[170px] flex-1 flex-col border-t border-slate-300/35 px-2 pt-2.5">
            <button
              type="button"
              aria-expanded={recentOpen}
              onClick={() => setRecentOpen((o) => !o)}
              className={cn(sectionHeaderRowClass, sectionHeaderButtonClass, "shrink-0")}
            >
              <CaretRightOutlined
                className={cn(
                  "w-3.5 shrink-0 text-[9px] text-slate-400 transition-transform duration-150",
                  recentOpen ? "rotate-90" : "",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">最近</span>
              {recentLoading ? (
                <span className="shrink-0 text-[10px] font-normal text-slate-400">…</span>
              ) : null}
            </button>
            {recentOpen ? (
              <div className="power-sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 pb-2 pt-1.5">
                {!recentLoading && recentOnlySessions.length === 0 ? (
                  <p className="px-1.5 py-2 text-center text-[11px] leading-snug text-slate-500">
                    暂无会话
                  </p>
                ) : null}
                <div className="flex flex-col gap-1">
                  {recentOnlySessions.map((s) => {
                    const sessionSelected = activeSessionKey === s.key;
                    const label = sessionDisplayLabel(s.label);
                    return (
                      <div key={s.key} className={cn(sessionNavItemClass(sessionSelected), "ml-1")}>
                        <Link
                          to={{
                            pathname: ROUTES.root,
                            search: `?sessionKey=${encodeURIComponent(s.key)}`,
                          }}
                          aria-label={label}
                          onClick={() => {
                            setOptimisticSessionKey(s.key);
                            setProjectContextOnlyId("");
                            patchSettings({ sessionKey: s.key, lastActiveSessionKey: s.key });
                            void onSelectSession?.(s.key, null, {
                              skipSessionProject: true,
                            });
                            onPick?.();
                          }}
                          className={cn(sessionLinkClass(sessionSelected), "pl-2 pr-2.5")}
                        >
                          {label}
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
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-[rgba(28,25,23,0.05)] hover:text-slate-800 focus:opacity-100",
                              openMenuKey === s.key
                                ? "opacity-100"
                                : "opacity-0 group-hover/session:opacity-100",
                            )}
                          >
                            <MoreOutlined className="text-base" />
                          </button>
                          {openMenuKey === s.key ? (
                            <div
                              ref={menuRef}
                              className="absolute bottom-full right-0 z-30 mb-0.5 min-w-[7.5rem] rounded-lg border border-slate-200/90 bg-white py-1 shadow-lg"
                              role="menu"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-slate-800 hover:bg-slate-50"
                                onClick={() => openRename(s)}
                              >
                                <MessageOutlined className="text-[13px] text-slate-500" />
                                重命名
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                title="删除会话"
                                className="block w-full px-3 py-1.5 text-left text-[12px] text-red-600 transition hover:bg-red-50"
                                onClick={() => void handleDeleteSession(s.key)}
                              >
                                删除
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <div
        className={cn(
          "mt-auto shrink-0 border-t border-slate-300/45",
          collapsed ? "px-2 pb-3 pt-2" : "px-2 py-3",
        )}
      >
        <div ref={settingsFlyoutRef} className={cn("relative", !collapsed && "group/settings")}>
          {collapsed ? (
            <button
              type="button"
              title="设置"
              aria-expanded={settingsFlyoutOpen}
              aria-haspopup="menu"
              onClick={() => setSettingsFlyoutOpen((v) => !v)}
              className={cn(
                shellTreeRow,
                navItemShell,
                shellNavHover,
                navItemCollapsed,
                isSettingsSection ? shellNavSelected : shellNavIdle,
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
            <button
              type="button"
              title="设置"
              aria-expanded={settingsFlyoutOpen}
              aria-haspopup="menu"
              onClick={() => setSettingsFlyoutOpen((v) => !v)}
              className={cn(
                shellTreeRow,
                navItemShell,
                shellNavHover,
                navItemExpanded,
                isSettingsSection ? shellNavSelected : shellNavIdle,
              )}
            >
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center text-base")}>
                <SettingOutlined />
              </span>
              <span className="truncate">设置</span>
            </button>
          )}

          <div
            role="menu"
            aria-label="设置分区"
            className={cn(
              "absolute bottom-0 left-[calc(100%-1px)] z-[60] min-w-[14rem] rounded-2xl border border-slate-200/80 bg-white/95 px-2 py-2 shadow-xl shadow-slate-900/6 backdrop-blur transition-[opacity,visibility,transform] duration-150",
              settingsFlyoutOpen
                ? "visible pointer-events-auto opacity-100"
                : collapsed
                  ? "invisible pointer-events-none opacity-0"
                  : "invisible pointer-events-none opacity-0 group-hover/settings:visible group-hover/settings:pointer-events-auto group-hover/settings:opacity-100",
            )}
          >
            {visibleSettingsNavItems.map((item) => (
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
                    "power-settings-menu-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
                    isActive && "power-settings-menu-item--active font-semibold",
                  )
                }
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[13px] text-slate-500">
                  {item.icon}
                </span>
                <span className="min-w-0 truncate font-medium">{item.title}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      <dialog
        ref={createProjectDialogRef}
        className="w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/10 backdrop:backdrop-blur-[1px]"
        onClose={() => {
          setNewProjectName("");
          setCreateProjectError(null);
          setCreateProjectDialogOpen(false);
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
            工作区目录会创建在默认 workspace
            下；若目录已存在会自动追加编号。重命名项目不会移动已有目录。
          </p>
          <input
            type="text"
            value={newProjectName}
            onChange={(ev) => setNewProjectName(ev.target.value)}
            placeholder="项目名称"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            autoFocus
            onFocus={(ev) => {
              const input = ev.currentTarget;
              requestAnimationFrame(() =>
                input.setSelectionRange(input.value.length, input.value.length),
              );
            }}
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
              className="rounded-lg bg-[#30343a] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#24272d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createProjectBusy ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={renameProjectDialogRef}
        className="w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/10 backdrop:backdrop-blur-[1px]"
        onClose={() => {
          setRenameProjectId("");
          setRenameProjectDraft("");
          setRenameProjectError(null);
        }}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitProjectRename();
          }}
        >
          <h2 className="text-sm font-semibold text-slate-900">重命名项目</h2>
          <input
            type="text"
            value={renameProjectDraft}
            onChange={(ev) => setRenameProjectDraft(ev.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            autoFocus
            onFocus={(ev) => {
              const input = ev.currentTarget;
              requestAnimationFrame(() =>
                input.setSelectionRange(input.value.length, input.value.length),
              );
            }}
          />
          {renameProjectError ? (
            <p className="text-xs text-red-600" role="alert">
              {renameProjectError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
              onClick={() => renameProjectDialogRef.current?.close()}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!renameProjectDraft.trim()}
              className="rounded-lg bg-[#30343a] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#24272d] disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={renameDialogRef}
        className="w-[min(100vw-2rem,22rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl backdrop:bg-slate-900/10 backdrop:backdrop-blur-[1px]"
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
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
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
              className="rounded-lg bg-[#30343a] px-3 py-1.5 text-sm font-medium text-white transition hover:bg-[#24272d]"
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
function PowerShellLayoutContent() {
  const location = useLocation();
  const { settings, patchSettings } = usePowerUiSettings();
  const localUsers = useLocalUsers();
  const userScope = buildLocalUserScope(localUsers.user);
  const canManageUsers = localUsers.enabled && localUsers.user?.role === "admin";
  const adapter = useGatewayWorkbenchAdapter(settings, userScope);
  const {
    selectSession,
    sessionsVersion,
    setActiveAgent,
    selectedSessionKey,
    sessionProjectDetached,
    activeRuntime,
  } = useWorkbenchChat();
  const {
    sessions: recentSessions,
    loading: recentLoading,
    refetch: refetchRecent,
  } = useRecentSessionsForNav(adapter);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navProjects, setNavProjects] = useState<NavProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsReloadToken, setProjectsReloadToken] = useState(0);
  const [optimisticRecentSessions, setOptimisticRecentSessions] = useState<RecentSessionNavItem[]>(
    [],
  );
  const projectsReloadTimersRef = useRef<number[]>([]);
  const recentReloadTimersRef = useRef<number[]>([]);

  const reloadProjects = useCallback(() => {
    setProjectsReloadToken((n) => n + 1);
    for (const timer of projectsReloadTimersRef.current) {
      window.clearTimeout(timer);
    }
    projectsReloadTimersRef.current = [300, 900].map((delay) =>
      window.setTimeout(() => {
        setProjectsReloadToken((n) => n + 1);
      }, delay),
    );
  }, []);

  useEffect(
    () => () => {
      for (const timer of projectsReloadTimersRef.current) {
        window.clearTimeout(timer);
      }
      projectsReloadTimersRef.current = [];
    },
    [],
  );

  useEffect(() => {
    void refetchRecent();
    for (const timer of recentReloadTimersRef.current) {
      window.clearTimeout(timer);
    }
    recentReloadTimersRef.current = [500, 1200].map((delay) =>
      window.setTimeout(() => {
        void refetchRecent();
      }, delay),
    );
    return () => {
      for (const timer of recentReloadTimersRef.current) {
        window.clearTimeout(timer);
      }
      recentReloadTimersRef.current = [];
    };
  }, [refetchRecent, sessionsVersion]);

  useEffect(() => {
    const key = selectedSessionKey.trim();
    if (!key || !sessionProjectDetached) {
      return;
    }
    const label = recentLabelFromMessages(activeRuntime?.chatMessages ?? []);
    setOptimisticRecentSessions((current) => [
      { key, label, updatedAt: Date.now() },
      ...current.filter((session) => session.key !== key),
    ]);
  }, [
    activeRuntime?.chatMessages,
    activeRuntime?.chatMessages.length,
    selectedSessionKey,
    sessionProjectDetached,
  ]);

  const displayRecentSessions = useMemo(() => {
    const serverKeys = new Set(recentSessions.map((session) => session.key));
    const optimistic = optimisticRecentSessions.filter((session) => !serverKeys.has(session.key));
    return [...optimistic, ...recentSessions].toSorted(
      (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    );
  }, [optimisticRecentSessions, recentSessions]);

  useEffect(() => {
    if (!adapter) {
      setNavProjects([]);
      return undefined;
    }
    let cancelled = false;
    setProjectsLoading(true);
    void (async () => {
      try {
        const res = await adapter.request<AgentsListResult>("agents.list", {});
        const rows = (res.agents ?? [])
          .filter((a) => isProjectInLocalUserScope(a.id, userScope))
          .map((a) => ({
            id: a.id,
            name:
              stripScopedProjectName((a.identity?.name ?? a.name ?? a.id).trim(), userScope) ||
              a.id,
            workspace: typeof a.workspace === "string" && a.workspace.trim() ? a.workspace : null,
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
  }, [adapter, projectsReloadToken, userScope]);

  const mobileTitle = useMemo(() => pathTitle(location.pathname), [location.pathname]);

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const navProps = {
    adapter,
    settings,
    patchSettings,
    onSelectSession: (
      sessionKey: string,
      projectId: string | null,
      options?: { skipSessionProject?: boolean },
    ) => {
      void selectSession(sessionKey, projectId, options);
    },
    onSelectProject: (projectId: string) => {
      setActiveAgent(projectId);
    },
    recentSessions: displayRecentSessions,
    recentLoading,
    onRecentSessionsChange: () => void refetchRecent(),
    projects: navProjects,
    projectsLoading,
    onProjectsReload: reloadProjects,
    userFolder: localUsers.user?.id ?? "",
    localUsersEnabled: localUsers.enabled,
    canManageUsers,
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#fafafa] text-slate-900">
      <header className="power-shell-mobile-header flex h-12 shrink-0 items-center gap-2 border-b border-slate-200/55 bg-white/82 px-3 shadow-sm shadow-slate-300/20 backdrop-blur md:hidden">
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
          className={cn(
            "power-sidebar hidden min-h-0 shrink-0 flex-col border-r border-slate-200/55 md:flex",
            collapsed && "power-sidebar--collapsed",
          )}
          style={{ width: sidebarWidth }}
        >
          <div className="flex min-h-0 flex-1 flex-col">
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
            <aside className="power-sidebar fixed inset-y-0 left-0 z-50 flex w-[min(100vw,280px)] max-w-[88vw] flex-col border-r border-slate-200/70 shadow-2xl md:hidden">
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
                <SidebarNav
                  collapsed={false}
                  onPick={() => setMobileNavOpen(false)}
                  {...navProps}
                />
              </div>
            </aside>
          </>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PowerShellLayout() {
  const { settings, patchSettings } = usePowerUiSettings();
  const localUsers = useLocalUsers();
  const userScope = buildLocalUserScope(localUsers.user);
  const adapter = useGatewayWorkbenchAdapter(settings, userScope);
  return (
    <WorkbenchChatProvider adapter={adapter} patchSettings={patchSettings} userScope={userScope}>
      <WorkspaceRailProvider>
        <PowerShellLayoutContent />
      </WorkspaceRailProvider>
    </WorkbenchChatProvider>
  );
}
