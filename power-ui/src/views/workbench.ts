import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseAgentSessionKey } from "../../../ui/src/ui/session-key.ts";
import type { WorkbenchFileEntry } from "../adapters/workbench-adapter.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  ConnectorActionDefinition,
  ConnectorFieldDefinition,
  ConnectorInstance,
  ConnectorProviderDefinition,
  ConfigSnapshot,
  AgentsListResult,
  ModelCatalogEntry,
  SessionsListResult,
} from "../compat/types.ts";
import { icons, normalizeAgentLabel, resolveAgentAvatarUrl } from "../compat/ui-core.ts";
import {
  renderCron,
  renderDreaming,
  renderLogs,
  type CronProps,
  type DreamingProps,
  type LogsProps,
} from "../compat/views.ts";
import { renderPowerChatThread } from "../integrations/openclaw/chat/thread.ts";
import {
  isGeneratedUntitledSessionLabel,
  isProtectedMainSessionKey,
  isSystemGeneratedSessionLabel,
  looksLikeOpaqueSessionId,
} from "../integrations/openclaw/session-keys.ts";
import { renderSkills, type SkillsProps } from "./skills.ts";

declare const __OPENCLAW_VERSION__: string;
declare const __POWER_UI_VERSION__: string;

export type WorkbenchSection = "newTask" | "skills" | "files" | "automations" | "logs";
export type WorkbenchSettingsTab =
  | "general"
  | "connectors"
  | "models"
  | "dreaming"
  | "statistics"
  | "automations"
  | "logs";

export type WorkbenchModelConfig = {
  id: string;
  provider: string;
  enabled: boolean;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type WorkbenchStatisticsRange = 1 | 7 | 30;
export type WorkbenchFileSortKey = "name" | "updatedAt" | "size" | "kind";

const AGENT_MANAGED_PROJECT_FILE_NAMES = new Set([
  ".git",
  ".openclaw",
  "AGENTS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "memory",
  "SOUL.md",
  "skills",
  "TOOLS.md",
  "USER.md",
]);

const SETTINGS_VERSION_LABEL = `v${__OPENCLAW_VERSION__}-${__POWER_UI_VERSION__}`;

type WorkbenchDirectoryEntry = {
  name: string;
  path: string;
};

type WorkbenchDirectoryTreeNode = WorkbenchDirectoryEntry & {
  depth: number;
  expanded: boolean;
  loading: boolean;
  hasToggle: boolean;
  selected: boolean;
};

type WorkbenchSession = {
  key: string;
  label: string;
  title: string;
  updatedAt: number | null;
  tokens: number;
};

type WorkbenchProject = {
  id: string;
  label: string;
  owner: string | null;
  avatarUrl: string | null;
  workspace: string | null;
  updatedAt: number | null;
  sessions: WorkbenchSession[];
};

type PendingChatFileView = {
  id: string;
  name: string;
  size: number;
  status: "pending" | "uploading" | "uploaded" | "failed";
  progress: number | null;
  error: string | null;
};

export type WorkbenchProps = {
  basePath: string;
  assistantName: string;
  sidebarWidthPx: number;
  sidebarResizeActive: boolean;
  currentProjectId: string | null;
  filesPageProjectId: string | null;
  currentSessionKey: string;
  showToolCalls: boolean;
  treeMenuOpenKey: string | null;
  currentModelId: string;
  newTaskProjectId: string | null;
  newTaskProjectMenuOpen: boolean;
  sidebarCollapsed: boolean;
  sidebarNarrowScrollable: boolean;
  projectsCollapsed: boolean;
  rightRailCollapsed: boolean;
  rightRailNarrowScrollable: boolean;
  expandedProjectIds: string[];
  expandedProjectSessionIds: string[];
  priorityProjectIds: string[];
  agentsList: AgentsListResult | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentFilesList: AgentsFilesListResult | null;
  projectFilesLoading: boolean;
  projectFilesError: string | null;
  projectFilesAgentId: string | null;
  projectFilesWorkspace: string | null;
  projectFilesEntries: WorkbenchFileEntry[];
  selectedProjectEntryPath: string | null;
  filePreviewOpen: boolean;
  filePreviewClosing: boolean;
  filePreviewLoading: boolean;
  filePreviewError: string | null;
  filePreviewAgentId: string | null;
  filePreviewName: string;
  filePreviewPath: string | null;
  filePreviewMode: "text" | "image" | "pdf" | null;
  filePreviewTextContent: string;
  filePreviewObjectUrl: string | null;
  sessionsResult: SessionsListResult | null;
  chatMessages: unknown[];
  chatMessage: string;
  pendingChatFiles: PendingChatFileView[];
  chatSending: boolean;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  lastError: string | null;
  skillsPage: SkillsProps;
  automationsPage: CronProps;
  logsPage: LogsProps;
  modelCatalog: ModelCatalogEntry[];
  modelsLoading: boolean;
  themeResolved: string;
  settings: {
    gatewayUrl: string;
    theme: string;
    themeMode: string;
    locale?: string;
  };
  configSnapshot: ConfigSnapshot | null;
  dreamingPage: {
    active: boolean;
    loading: boolean;
    refreshLoading: boolean;
    view: DreamingProps;
    onRefresh: () => void;
    onToggleEnabled: () => void;
  };
  settingsView: {
    localeOptions: Array<{ value: string; label: string }>;
    modelConfigs: WorkbenchModelConfig[];
    expandedModelConfigId: string | null;
    statistics: {
      loading: boolean;
      error: string | null;
      selectedRangeDays: WorkbenchStatisticsRange;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      cacheTokens: number;
      sessionCount: number;
      updatedAt: number | null;
      onRangeChange: (value: WorkbenchStatisticsRange) => void;
      onRefresh: () => void;
    };
    connectors: {
      loading: boolean;
      saving: boolean;
      testing: boolean;
      error: string | null;
      selectedProviderId: string | null;
      editingInstanceId: string | null;
      providers: ConnectorProviderDefinition[];
      instances: ConnectorInstance[];
      draft: {
        providerId: string | null;
        displayName: string;
        description: string;
        enabled: boolean;
        policyMode: "read-only" | "limited-write" | "full";
        config: Record<string, string>;
        secretInputs: Record<string, string>;
      };
      testResult: string | null;
      onRefresh: () => void;
      onSelectProvider: (providerId: string) => void;
      onSelectInstance: (instanceId: string | null) => void;
      onCreateNew: () => void;
      onDraftChange: (
        section: "meta" | "config" | "secret",
        key: string,
        value: string | boolean,
      ) => void;
      onDraftPolicyModeChange: (value: "read-only" | "limited-write" | "full") => void;
      onSave: () => void;
      onDelete: (instanceId: string) => void;
      onToggleEnabled: (instanceId: string, enabled: boolean) => void;
      onTest: () => void;
    };
    onLocaleChange: (value: string) => void;
    onThemeChange: (value: string) => void;
    onThemeModeChange: (value: string) => void;
    onToggleModelConfigEnabled: (id: string, enabled: boolean) => void;
    onToggleModelConfigExpanded: (id: string) => void;
    onModelConfigChange: (
      id: string,
      field: "name" | "baseUrl" | "apiKey" | "model",
      value: string,
    ) => void;
    onAddModelConfig: () => void;
    onRemoveModelConfig: (id: string) => void;
  };
  section: WorkbenchSection;
  settingsOpen: boolean;
  settingsClosing: boolean;
  settingsTab: WorkbenchSettingsTab;
  runningSessionKeys: Record<string, boolean>;
  unreadSessionKeys: Record<string, boolean>;
  projectDirectoryOpen: boolean;
  projectDirectoryClosing: boolean;
  projectDirectoryLoading: boolean;
  projectDirectoryError: string | null;
  projectDirectoryRoots: WorkbenchDirectoryEntry[];
  projectDirectoryTreeChildrenByPath: Record<string, WorkbenchDirectoryEntry[]>;
  projectDirectoryExpandedPaths: string[];
  projectDirectoryLoadingPaths: string[];
  projectDirectoryCurrentPath: string | null;
  projectDirectoryCurrentName: string | null;
  projectDirectoryParentPath: string | null;
  projectDirectoryEntries: WorkbenchDirectoryEntry[];
  projectDirectorySelectedPath: string | null;
  projectDirectorySelectedName: string | null;
  projectDirectoryCreateFolderOpen: boolean;
  projectDirectoryCreateFolderName: string;
  projectDirectoryCreateFolderBusy: boolean;
  fileManagerLoading: boolean;
  fileManagerError: string | null;
  fileManagerAgentId: string | null;
  fileManagerWorkspace: string | null;
  fileManagerCurrentPath: string | null;
  fileManagerCurrentName: string | null;
  fileManagerParentPath: string | null;
  fileManagerEntries: WorkbenchFileEntry[];
  fileManagerBusyPath: string | null;
  fileSortKey: WorkbenchFileSortKey;
  fileSortMenuOpen: boolean;
  showAgentFiles: boolean;
  fileVisibilityMenuOpen: boolean;
  fileSearchQuery: string;
  fileManagerCreateFolderOpen: boolean;
  fileManagerNewFolderName: string;
  horizontalScrollbarVisible: boolean;
  horizontalScrollbarContentWidth: number;
  onNavigateLegacy: () => void;
  onSectionChange: (section: WorkbenchSection) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionKey: string) => void;
  onToggleProjectMenu: (projectId: string) => void;
  onToggleSessionMenu: (sessionKey: string) => void;
  onRenameProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameSession: (sessionKey: string) => void;
  onDeleteSession: (sessionKey: string) => void;
  onSelectNewTaskProject: (projectId: string) => void;
  onToggleNewTaskProjectMenu: () => void;
  onStartTask: (projectId: string) => void;
  onOpenAttachment: () => void;
  onRemovePendingChatFile: (id: string) => void;
  onComposerChange: (value: string) => void;
  onComposerKeyDown: (event: KeyboardEvent) => void;
  onComposerCompositionEnd: (event: CompositionEvent) => void;
  onChatScroll: (event: Event) => void;
  onRequestUpdate: () => void;
  onToggleToolCalls: () => void;
  onSend: () => void;
  onAbort: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSettingsTabChange: (value: WorkbenchSettingsTab) => void;
  onWorkbenchShellScroll: (event: Event) => void;
  onWorkbenchScrollbarScroll: (event: Event) => void;
  onModelChange: (value: string) => void;
  onCreateProject: () => void;
  onCloseProjectDirectory: () => void;
  onSelectProjectDirectory: (path: string | null, name: string | null) => void;
  onBrowseProjectDirectory: (path: string | null) => void;
  onToggleProjectDirectoryCreateFolder: () => void;
  onProjectDirectoryFolderNameChange: (value: string) => void;
  onCancelProjectDirectoryCreateFolder: () => void;
  onCreateProjectDirectoryFolder: () => void;
  onCreateProjectFromDirectory: (path: string | null) => void;
  onNavigateFileManager: (path: string | null) => void;
  onRefreshFileManager: () => void;
  onFileSortChange: (value: WorkbenchFileSortKey) => void;
  onToggleFileSortMenu: () => void;
  onToggleAgentFilesVisibility: () => void;
  onToggleFileVisibilityMenu: () => void;
  onFileSearchChange: (value: string) => void;
  onOpenProjectFilePicker: (agentId: string, path: string | null) => void;
  onDownloadProjectFile: (agentId: string, path: string) => void;
  onPreviewProjectFile: (agentId: string, entry: WorkbenchFileEntry) => void;
  onSelectProjectEntry: (path: string | null) => void;
  onClearProjectEntrySelection: () => void;
  onCloseFilePreview: () => void;
  onDeleteProjectEntry: (agentId: string, path: string) => void;
  onToggleCreateFolder: () => void;
  onFileManagerFolderNameChange: (value: string) => void;
  onCreateFileManagerFolder: () => void;
  onToggleSidebar: () => void;
  onSidebarResizeStart: (event: MouseEvent) => void;
  onToggleProjects: () => void;
  onToggleRightRail: () => void;
  onToggleProject: (projectId: string) => void;
  onToggleProjectSessionsVisibility: (projectId: string) => void;
  onRefreshContext: () => void;
};

const PROJECT_SESSION_PREVIEW_LIMIT = 6;

function isZhLocale(locale?: string): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh");
}

function tLocale(locale: string | undefined, en: string, zh: string): string {
  return isZhLocale(locale) ? zh : en;
}

function dialogStateClass(isOpen: boolean, isClosing: boolean): string {
  return isClosing && !isOpen ? "is-closing" : isOpen ? "is-open" : "";
}

function compareFileEntries(
  a: WorkbenchFileEntry,
  b: WorkbenchFileEntry,
  sortKey: WorkbenchFileSortKey,
) {
  if (sortKey !== "kind" && a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  if (sortKey === "updatedAt") {
    const aTime = typeof a.updatedAtMs === "number" ? a.updatedAtMs : -1;
    const bTime = typeof b.updatedAtMs === "number" ? b.updatedAtMs : -1;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
  } else if (sortKey === "size") {
    const aSize = typeof a.size === "number" ? a.size : -1;
    const bSize = typeof b.size === "number" ? b.size : -1;
    if (aSize !== bSize) {
      return bSize - aSize;
    }
  } else if (sortKey === "kind") {
    if (a.kind !== b.kind) {
      return a.kind.localeCompare(b.kind);
    }
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
}

function isAgentManagedProjectFile(entry: WorkbenchFileEntry) {
  return AGENT_MANAGED_PROJECT_FILE_NAMES.has(entry.name.trim());
}

function isTreeMenuOpen(props: WorkbenchProps, key: string): boolean {
  return props.treeMenuOpenKey === key;
}

export function renderWorkbench(props: WorkbenchProps) {
  const locale = props.settings.locale;
  const projects = resolveProjects(props);
  const currentProject =
    projects.find((project) => project.id === (props.newTaskProjectId ?? props.currentProjectId)) ??
    projects[0] ??
    null;
  const filesPageProject =
    projects.find((project) => project.id === props.filesPageProjectId) ?? null;
  const listedActiveSession =
    projects
      .flatMap((project) => project.sessions)
      .find((session) => session.key === props.currentSessionKey) ?? null;
  const currentSessionProjectId = parseAgentSessionKey(props.currentSessionKey)?.agentId ?? null;
  const activeSession =
    listedActiveSession ??
    (props.currentSessionKey
      ? {
          key: props.currentSessionKey,
          label: tLocale(locale, "New conversation", "新会话"),
          title: tLocale(locale, "New conversation", "新会话"),
          updatedAt: null,
          tokens: 0,
        }
      : null);
  const activeProject =
    (activeSession
      ? (projects.find(
          (project) =>
            project.id === currentSessionProjectId ||
            project.sessions.some((session) => session.key === activeSession.key),
        ) ?? null)
      : null) ?? currentProject;
  const showContextBar =
    props.section === "newTask" && Boolean(activeProject) && Boolean(activeSession);
  const showRightRail = showContextBar && !props.rightRailCollapsed;
  const newTaskNavActive = props.section === "newTask" && !activeSession;

  return html`
    <div class="workbench-shell" data-workbench-shell @scroll=${props.onWorkbenchShellScroll}>
      <div
        class="workbench ${props.themeResolved.includes("light")
          ? "workbench--light"
          : ""} ${props.sidebarCollapsed
          ? "workbench--sidebar-collapsed"
          : ""} ${props.sidebarNarrowScrollable
          ? "workbench--sidebar-narrow-scrollable"
          : ""} ${props.sidebarResizeActive ? "workbench--sidebar-resizing" : ""}"
        style=${`--wb-sidebar-width: ${props.sidebarWidthPx}px;`}
      >
        <aside class="workbench-sidebar">
          <div class="workbench-brand">
            <div class="workbench-brand__expanded" aria-hidden=${props.sidebarCollapsed}>
              <div class="workbench-brand__left">
                <div class="workbench-brand__mark">${icons.lobster}</div>
                <div class="workbench-brand__title workbench-brand__title--compact">OpenClaw</div>
              </div>
              <button
                type="button"
                class="workbench-icon-button"
                title="收起侧栏"
                aria-label="收起侧栏"
                @click=${props.onToggleSidebar}
              >
                ${icons.panelLeftClose}
              </button>
            </div>

            <div class="workbench-brand__collapsed" aria-hidden=${!props.sidebarCollapsed}>
              <button
                type="button"
                class="workbench-icon-button workbench-brand__collapsed-toggle"
                title="展开侧栏"
                aria-label="展开侧栏"
                @click=${props.onToggleSidebar}
              >
                <span
                  class="workbench-brand__collapsed-state workbench-brand__collapsed-state--logo"
                >
                  ${icons.lobster}
                </span>
                <span
                  class="workbench-brand__collapsed-state workbench-brand__collapsed-state--toggle"
                >
                  ${icons.panelLeftOpen}
                </span>
              </button>
            </div>
          </div>

          <nav class="workbench-nav">
            ${renderNavButton(
              "newTask",
              tLocale(locale, "New task", "新任务"),
              icons.edit,
              newTaskNavActive,
              props.sidebarCollapsed,
              () => props.onSectionChange("newTask"),
            )}
            ${renderNavButton(
              "skills",
              tLocale(locale, "Skills", "技能"),
              icons.puzzle,
              props.section === "skills",
              props.sidebarCollapsed,
              () => props.onSectionChange("skills"),
            )}
            ${renderNavButton(
              "files",
              tLocale(locale, "Files", "文件"),
              icons.folder,
              props.section === "files",
              props.sidebarCollapsed,
              () => props.onSectionChange("files"),
            )}
          </nav>

          ${props.sidebarCollapsed
            ? nothing
            : html`
                <section class="workbench-projects">
                  <div class="workbench-tree-header">
                    <button
                      type="button"
                      class="workbench-tree-header__toggle"
                      @click=${props.onToggleProjects}
                    >
                      <span>${tLocale(locale, "Projects", "项目")}</span>
                      ${props.projectsCollapsed ? icons.chevronRight : icons.chevronDown}
                    </button>
                    <button
                      type="button"
                      class="workbench-icon-button"
                      title=${tLocale(locale, "Choose project folder", "选择项目目录")}
                      @click=${props.onCreateProject}
                    >
                      ${icons.plus}
                    </button>
                  </div>

                  <div class="workbench-projects__scroll">
                    ${props.projectsCollapsed
                      ? nothing
                      : html`
                          <div class="workbench-project-tree">
                            ${repeat(
                              projects,
                              (project) => project.id,
                              (project) => renderProjectTreeRow(project, props),
                            )}
                          </div>
                        `}
                  </div>
                </section>
              `}

          <div class="workbench-sidebar__footer">
            <button
              type="button"
              class="workbench-settings-entry"
              title=${tLocale(locale, "Settings", "设置")}
              aria-label=${tLocale(locale, "Settings", "设置")}
              @click=${props.onOpenSettings}
            >
              <span class="workbench-settings-entry__icon">${icons.settings}</span>
              <span class="workbench-settings-entry__label">
                <span>${tLocale(locale, "Settings", "设置")}</span>
                <span class="workbench-settings-entry__version">${SETTINGS_VERSION_LABEL}</span>
              </span>
            </button>
          </div>
        </aside>

        ${props.sidebarCollapsed
          ? nothing
          : html`
              <button
                type="button"
                class="workbench-sidebar-resizer"
                aria-label=${tLocale(locale, "Resize navigation", "调整导航宽度")}
                title=${tLocale(locale, "Resize navigation", "调整导航宽度")}
                @mousedown=${props.onSidebarResizeStart}
              ></button>
            `}

        <div class="workbench-main">
          ${showContextBar && activeProject && activeSession
            ? renderContextBar(props, activeProject, activeSession)
            : nothing}
          <div
            class="workbench-content ${showRightRail
              ? "workbench-content--rail"
              : ""} ${showRightRail && props.rightRailNarrowScrollable
              ? "workbench-content--rail-scrollable"
              : ""} ${props.section === "newTask" && !showRightRail
              ? "workbench-content--session-centered"
              : ""}"
          >
            <section class="workbench-center">
              ${props.section === "files"
                ? renderFilesPage(props, filesPageProject)
                : props.section === "skills"
                  ? renderSkillsPage(props)
                  : activeSession
                    ? renderSessionView(props, activeProject, activeSession)
                    : renderNewTaskView(props, currentProject, projects)}
            </section>

            ${showRightRail && activeProject && activeSession
              ? renderRightRail(props, activeProject)
              : nothing}
          </div>
        </div>
      </div>
      ${props.settingsOpen || props.settingsClosing ? renderSettingsDialog(props) : nothing}
      ${props.projectDirectoryOpen || props.projectDirectoryClosing
        ? renderProjectDirectoryDialog(props)
        : nothing}
      ${props.filePreviewOpen || props.filePreviewClosing
        ? renderFilePreviewDialog(props)
        : nothing}
    </div>
    ${props.horizontalScrollbarVisible
      ? html`
          <div
            class="workbench-horizontal-scrollbar"
            data-workbench-scrollbar
            @scroll=${props.onWorkbenchScrollbarScroll}
          >
            <div
              class="workbench-horizontal-scrollbar__spacer"
              style=${`width: ${props.horizontalScrollbarContentWidth}px;`}
            ></div>
          </div>
        `
      : nothing}
  `;
}

function renderFilePreviewDialog(props: WorkbenchProps) {
  const locale = props.settings.locale;
  const stateClass = dialogStateClass(props.filePreviewOpen, props.filePreviewClosing);
  return html`
    <div class="workbench-overlay ${stateClass}" aria-hidden=${String(!props.filePreviewOpen)}>
      <button
        type="button"
        class="workbench-overlay__backdrop"
        aria-label=${tLocale(locale, "Close preview", "关闭预览")}
        @click=${props.onCloseFilePreview}
      ></button>
      <div class="workbench-dialog workbench-dialog--preview ${stateClass}">
        <div class="workbench-dialog__topbar">
          <div class="workbench-preview-dialog__header">
            <div class="workbench-preview-dialog__title-row">
              <div class="workbench-preview-dialog__title-wrap">
                <h3>${props.filePreviewName || tLocale(locale, "File Preview", "文件预览")}</h3>
              </div>
              <div class="workbench-preview-dialog__actions">
                ${props.filePreviewAgentId && props.filePreviewPath
                  ? html`
                      <button
                        type="button"
                        class="workbench-icon-button"
                        title=${tLocale(locale, "Download file", "下载文件")}
                        aria-label=${tLocale(locale, "Download file", "下载文件")}
                        @click=${() =>
                          props.onDownloadProjectFile(
                            props.filePreviewAgentId!,
                            props.filePreviewPath!,
                          )}
                      >
                        ${icons.download}
                      </button>
                    `
                  : nothing}
                <button
                  type="button"
                  class="workbench-icon-button"
                  title=${tLocale(locale, "Close", "关闭")}
                  aria-label=${tLocale(locale, "Close", "关闭")}
                  @click=${props.onCloseFilePreview}
                >
                  ${icons.x}
                </button>
              </div>
            </div>
            ${props.filePreviewPath
              ? html`
                  <span class="workbench-preview-dialog__path" title=${props.filePreviewPath}
                    >${props.filePreviewPath}</span
                  >
                `
              : nothing}
          </div>
        </div>
        <div class="workbench-dialog__body workbench-preview-dialog__body">
          ${props.filePreviewLoading
            ? html`<div class="workbench-skeleton">
                ${tLocale(locale, "Loading preview...", "正在加载预览...")}
              </div>`
            : props.filePreviewError
              ? html`<div class="workbench-callout workbench-callout--danger">
                  ${props.filePreviewError}
                </div>`
              : props.filePreviewMode === "text"
                ? html`
                    <pre
                      class="workbench-preview-dialog__text"
                    ><code>${props.filePreviewTextContent}</code></pre>
                  `
                : props.filePreviewMode === "image" && props.filePreviewObjectUrl
                  ? html`
                      <div class="workbench-preview-dialog__media-shell">
                        <img
                          class="workbench-preview-dialog__image"
                          src=${props.filePreviewObjectUrl}
                          alt=${props.filePreviewName}
                        />
                      </div>
                    `
                  : props.filePreviewMode === "pdf" && props.filePreviewObjectUrl
                    ? html`
                        <iframe
                          class="workbench-preview-dialog__pdf"
                          src=${props.filePreviewObjectUrl}
                          title=${props.filePreviewName}
                        ></iframe>
                      `
                    : html`
                        <div class="workbench-empty workbench-empty--tiny">
                          ${tLocale(locale, "Preview unavailable.", "当前文件暂不支持预览。")}
                        </div>
                      `}
        </div>
      </div>
    </div>
  `;
}

function renderContextBar(
  props: WorkbenchProps,
  project: WorkbenchProject,
  session: WorkbenchSession,
) {
  const toolCallsIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
      ></path>
      ${props.showToolCalls ? nothing : html`<path d="M4 4l16 16"></path>`}
    </svg>
  `;
  return html`
    <header class="workbench-context-bar">
      <div class="workbench-context-bar__identity">
        <strong>${session.label}</strong>
        <span>${project.label}</span>
      </div>
      <div class="workbench-context-bar__actions">
        <button
          type="button"
          class="workbench-icon-button workbench-context-bar__tool-toggle ${props.showToolCalls
            ? "is-active"
            : "is-inactive"}"
          title=${props.showToolCalls ? "隐藏工具调用" : "显示工具调用"}
          aria-label=${props.showToolCalls ? "隐藏工具调用" : "显示工具调用"}
          aria-pressed=${props.showToolCalls}
          @click=${props.onToggleToolCalls}
        >
          ${toolCallsIcon}
        </button>
        <button
          type="button"
          class="workbench-icon-button workbench-context-bar__toggle ${props.rightRailCollapsed
            ? "is-collapsed"
            : ""}"
          title=${props.rightRailCollapsed ? "展开卡片区" : "折叠卡片区"}
          aria-label=${props.rightRailCollapsed ? "展开卡片区" : "折叠卡片区"}
          @click=${props.onToggleRightRail}
        >
          ${props.rightRailCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}
        </button>
      </div>
    </header>
  `;
}

function renderNewTaskView(
  props: WorkbenchProps,
  currentProject: WorkbenchProject | null,
  projects: WorkbenchProject[],
) {
  const locale = props.settings.locale;
  const canSend = Boolean(props.chatMessage.trim() || props.pendingChatFiles.length > 0);
  return html`
    <section class="workbench-session-shell workbench-session-shell--centered">
      <section class="workbench-chat-surface">
        <div class="workbench-new-thread">
          <div class="workbench-new-thread__hero">
            <div class="workbench-new-thread__icon">${icons.spark}</div>
            <h2>${tLocale(locale, "Start building", "开始创建")}</h2>
            <div class="workbench-new-thread__project-picker">
              <button
                type="button"
                class="workbench-new-thread__project-button"
                @click=${props.onToggleNewTaskProjectMenu}
              >
                <span
                  >${currentProject?.label ?? tLocale(locale, "Select project", "选择项目")}</span
                >
                <span class="workbench-new-thread__project-chevron">
                  ${props.newTaskProjectMenuOpen ? icons.chevronUp : icons.chevronDown}
                </span>
              </button>

              ${props.newTaskProjectMenuOpen
                ? html`
                    <div class="workbench-new-thread__project-menu">
                      <div class="workbench-new-thread__project-menu-title">
                        ${tLocale(locale, "Choose project", "选择项目")}
                      </div>
                      ${repeat(
                        projects,
                        (project) => project.id,
                        (project) => html`
                          <button
                            type="button"
                            class="workbench-new-thread__project-item ${currentProject?.id ===
                            project.id
                              ? "is-active"
                              : ""}"
                            @click=${() => props.onSelectNewTaskProject(project.id)}
                          >
                            <span class="workbench-new-thread__project-item-icon"
                              >${icons.folder}</span
                            >
                            <span>${project.label}</span>
                            ${currentProject?.id === project.id
                              ? html`<span class="workbench-new-thread__project-item-check"
                                  >${icons.check}</span
                                >`
                              : nothing}
                          </button>
                        `,
                      )}
                      <div class="workbench-new-thread__project-divider"></div>
                      <button
                        type="button"
                        class="workbench-new-thread__project-item workbench-new-thread__project-item--create"
                        @click=${props.onCreateProject}
                      >
                        <span class="workbench-new-thread__project-item-icon">${icons.plus}</span>
                        <span>${tLocale(locale, "New project", "新建项目")}</span>
                      </button>
                    </div>
                  `
                : nothing}
            </div>
          </div>
        </div>

        <div class="workbench-chat-composer workbench-chat-composer--floating">
          ${renderPendingChatFiles(props)}
          <textarea
            class="workbench-composer workbench-composer--session"
            .value=${props.chatMessage}
            placeholder=${tLocale(
              locale,
              "Ask anything about the selected project...",
              "围绕当前项目输入你的问题...",
            )}
            @input=${(event: Event) =>
              props.onComposerChange((event.target as HTMLTextAreaElement).value)}
            @keydown=${props.onComposerKeyDown}
            @compositionend=${props.onComposerCompositionEnd}
          ></textarea>
          <div class="workbench-chat-composer__footer">
            <div class="workbench-chat-composer__controls">
              <button
                type="button"
                class="workbench-circle-button"
                title=${tLocale(locale, "Upload files", "上传文件")}
                aria-label=${tLocale(locale, "Upload files", "上传文件")}
                @click=${props.onOpenAttachment}
              >
                ${icons.plus}
              </button>
              <label
                class="workbench-model-select"
                aria-label=${tLocale(locale, "Choose model", "选择模型")}
              >
                <select
                  .value=${props.currentModelId}
                  @change=${(event: Event) =>
                    props.onModelChange((event.target as HTMLSelectElement).value)}
                >
                  ${repeat(
                    props.modelCatalog,
                    (model) => `${model.provider}/${model.id}`,
                    (model) =>
                      html`<option value=${`${model.provider}/${model.id}`}>${model.id}</option>`,
                  )}
                </select>
                <span class="workbench-model-select__chevron">${icons.chevronDown}</span>
              </label>
            </div>
            <button
              type="button"
              class="workbench-send-button"
              title="Send"
              aria-label="Send"
              ?disabled=${props.chatSending || !canSend || !currentProject}
              @click=${props.onSend}
            >
              ${icons.arrowUp}
            </button>
          </div>
        </div>
      </section>
    </section>
  `;
}

function renderProjectDirectoryDialog(props: WorkbenchProps) {
  const selectedPath = props.projectDirectorySelectedPath;
  const locale = props.settings.locale;
  const stateClass = dialogStateClass(props.projectDirectoryOpen, props.projectDirectoryClosing);
  const expanded = new Set(props.projectDirectoryExpandedPaths);
  const loading = new Set(props.projectDirectoryLoadingPaths);
  const childrenByPath = props.projectDirectoryTreeChildrenByPath;
  const buildTree = (
    entries: WorkbenchDirectoryEntry[],
    depth: number,
  ): WorkbenchDirectoryTreeNode[] => {
    const rows: WorkbenchDirectoryTreeNode[] = [];
    for (const entry of entries) {
      const childEntries = childrenByPath[entry.path];
      const isExpanded = expanded.has(entry.path);
      const isLoading = loading.has(entry.path);
      const hasToggle = childEntries === undefined || childEntries.length > 0;
      rows.push({
        ...entry,
        depth,
        expanded: isExpanded,
        loading: isLoading,
        hasToggle,
        selected: entry.path === selectedPath,
      });
      if (isExpanded && childEntries?.length) {
        rows.push(...buildTree(childEntries, depth + 1));
      }
    }
    return rows;
  };
  const treeRows = buildTree(props.projectDirectoryRoots, 0);
  return html`
    <div class="workbench-overlay ${stateClass}">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseProjectDirectory}></div>
      <div class="workbench-dialog workbench-dialog--directory ${stateClass}">
        <div class="workbench-dialog__topbar">
          <div class="workbench-directory-dialog__header">
            <div class="workbench-directory-dialog__title-row">
              <span class="workbench-directory-dialog__title-icon">${icons.folder}</span>
              <h3>${tLocale(locale, "Choose Workspace Directory", "选择工作目录")}</h3>
            </div>
          </div>
          <button
            type="button"
            class="workbench-icon-button"
            @click=${props.onCloseProjectDirectory}
          >
            ${icons.x}
          </button>
        </div>

        <div class="workbench-dialog__body">
          <div class="workbench-directory-section workbench-directory-section--path">
            <div class="workbench-directory-pathbar">
              <span class="workbench-directory-pathbar__label"
                >${tLocale(locale, "Path:", "路径:")}</span
              >
              <span class="workbench-directory-pathbar__value">
                ${selectedPath ??
                props.projectDirectoryRoots[0]?.path ??
                tLocale(locale, "Allowed roots", "允许访问的根目录")}
              </span>
            </div>
          </div>

          ${props.projectDirectoryError
            ? html`
                <div class="workbench-directory-section workbench-directory-section--error">
                  <div class="workbench-callout workbench-callout--danger">
                    ${props.projectDirectoryError}
                  </div>
                </div>
              `
            : nothing}

          <div class="workbench-directory-section workbench-directory-section--tree">
            <div class="workbench-directory-browser">
              ${props.projectDirectoryLoading
                ? html`
                    <div class="workbench-empty workbench-empty--small">
                      ${tLocale(locale, "Loading directories…", "正在加载目录…")}
                    </div>
                  `
                : treeRows.length === 0
                  ? html`
                      <div class="workbench-empty workbench-empty--small">
                        ${tLocale(locale, "No directories available.", "没有可用目录。")}
                      </div>
                    `
                  : html`
                      <div class="workbench-directory-list workbench-directory-list--modal">
                        ${repeat(
                          treeRows,
                          (entry) => entry.path,
                          (entry) => html`
                            <div
                              class="workbench-directory-entry ${entry.selected
                                ? "is-selected"
                                : ""}"
                              style=${`--tree-depth: ${entry.depth};`}
                            >
                              <button
                                type="button"
                                class="workbench-directory-entry__main"
                                @click=${() => props.onBrowseProjectDirectory(entry.path)}
                              >
                                ${entry.hasToggle
                                  ? html`
                                      <span class="workbench-directory-entry__toggle-icon">
                                        ${entry.expanded ? icons.chevronDown : icons.chevronRight}
                                      </span>
                                    `
                                  : html`
                                      <span class="workbench-directory-entry__toggle-spacer"></span>
                                    `}
                                <span class="workbench-directory-entry__icon">
                                  ${entry.expanded ? icons.folderOpen : icons.folder}
                                </span>
                                <span class="workbench-directory-entry__name">${entry.name}</span>
                                ${entry.loading
                                  ? html`
                                      <span class="workbench-directory-entry__loading"
                                        >${tLocale(locale, "Loading…", "加载中…")}</span
                                      >
                                    `
                                  : nothing}
                              </button>
                            </div>
                          `,
                        )}
                      </div>
                    `}
            </div>
          </div>

          ${props.projectDirectoryCreateFolderOpen
            ? html`
                <div class="workbench-directory-section workbench-directory-section--create">
                  <div class="workbench-directory-create">
                    <span class="workbench-directory-create__icon">${icons.folderPlus}</span>
                    <input
                      class="workbench-directory-create__input"
                      data-project-directory-folder-input
                      .value=${props.projectDirectoryCreateFolderName}
                      placeholder=${tLocale(locale, "Enter folder name...", "输入文件夹名称...")}
                      @input=${(event: Event) =>
                        props.onProjectDirectoryFolderNameChange(
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                      @keydown=${(event: KeyboardEvent) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          props.onCreateProjectDirectoryFolder();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          props.onCancelProjectDirectoryCreateFolder();
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="workbench-directory-create__confirm"
                      ?disabled=${props.projectDirectoryCreateFolderBusy}
                      @click=${props.onCreateProjectDirectoryFolder}
                    >
                      ${icons.check}
                    </button>
                    <button
                      type="button"
                      class="workbench-directory-create__cancel"
                      ?disabled=${props.projectDirectoryCreateFolderBusy}
                      @click=${props.onCancelProjectDirectoryCreateFolder}
                    >
                      ${icons.x}
                    </button>
                  </div>
                </div>
              `
            : nothing}

          <div class="workbench-directory-actions">
            <button
              type="button"
              class="workbench-directory-new-folder"
              ?disabled=${!selectedPath || props.projectDirectoryCreateFolderBusy}
              @click=${props.onToggleProjectDirectoryCreateFolder}
            >
              ${icons.folderPlus}
              <span>${tLocale(locale, "New Folder", "新建文件夹")}</span>
            </button>
            <div class="workbench-directory-actions__right">
              <button
                type="button"
                class="workbench-secondary-button"
                ?disabled=${props.projectDirectoryLoading}
                @click=${props.onCloseProjectDirectory}
              >
                ${tLocale(locale, "Cancel", "取消")}
              </button>
              <button
                type="button"
                class="workbench-primary-button"
                ?disabled=${props.projectDirectoryLoading || !selectedPath}
                @click=${() => props.onCreateProjectFromDirectory(selectedPath)}
              >
                ${tLocale(locale, "Confirm Selection", "确认选择")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderNavButton(
  key: string,
  label: string,
  icon: unknown,
  active: boolean,
  collapsed: boolean,
  onClick: () => void,
) {
  return html`
    <button
      type="button"
      class="workbench-nav__item ${active ? "is-active" : ""}"
      data-key=${key}
      title=${collapsed ? label : ""}
      aria-label=${label}
      @click=${onClick}
    >
      <span class="workbench-nav__icon">${icon}</span>
      <span class="workbench-nav__label">${label}</span>
    </button>
  `;
}

function renderProjectTreeRow(project: WorkbenchProject, props: WorkbenchProps) {
  const locale = props.settings.locale;
  const selected = props.currentProjectId === project.id;
  const expanded = props.expandedProjectIds.includes(project.id);
  const sessionsExpanded = props.expandedProjectSessionIds.includes(project.id);
  const visibleSessions = sessionsExpanded
    ? project.sessions
    : project.sessions.slice(0, PROJECT_SESSION_PREVIEW_LIMIT);
  const hasHiddenSessions = project.sessions.length > PROJECT_SESSION_PREVIEW_LIMIT;
  const projectMenuKey = `project:${project.id}`;
  const projectMenuOpen = isTreeMenuOpen(props, projectMenuKey);
  return html`
    <div class="workbench-tree-node ${selected ? "is-active" : ""}">
      <div class="workbench-tree-node__row">
        <button
          type="button"
          class="workbench-tree-node__icon-toggle"
          title=${tLocale(
            locale,
            expanded ? "Collapse project" : "Expand project",
            expanded ? "收起项目" : "展开项目",
          )}
          aria-label=${tLocale(
            locale,
            expanded ? "Collapse project" : "Expand project",
            expanded ? "收起项目" : "展开项目",
          )}
          @click=${() => props.onToggleProject(project.id)}
        >
          ${expanded ? icons.folderOpen : icons.folder}
        </button>
        <button
          type="button"
          class="workbench-tree-node__main"
          title=${tLocale(
            locale,
            expanded ? "Collapse project sessions" : "Expand project sessions",
            expanded ? "收起项目会话" : "展开项目会话",
          )}
          aria-label=${tLocale(
            locale,
            expanded ? "Collapse project sessions" : "Expand project sessions",
            expanded ? "收起项目会话" : "展开项目会话",
          )}
          @click=${() => props.onToggleProject(project.id)}
        >
          <span class="workbench-tree-node__label">${project.label}</span>
        </button>
        <div class="workbench-tree-node__menu-anchor">
          <button
            type="button"
            class="workbench-tree-node__more ${projectMenuOpen ? "is-open" : ""}"
            aria-label=${tLocale(locale, "Project actions", "项目操作")}
            aria-haspopup="menu"
            aria-expanded=${projectMenuOpen}
            @click=${(event: Event) => {
              event.stopPropagation();
              props.onToggleProjectMenu(project.id);
            }}
          >
            ${icons.moreHorizontal}
          </button>
          ${projectMenuOpen
            ? html`
                <div class="workbench-tree-menu" role="menu">
                  <button
                    type="button"
                    class="workbench-tree-menu__item"
                    role="menuitem"
                    @click=${() => props.onRenameProject(project.id)}
                  >
                    ${tLocale(locale, "Rename", "重命名")}
                  </button>
                  <button
                    type="button"
                    class="workbench-tree-menu__item workbench-tree-menu__item--danger"
                    role="menuitem"
                    @click=${() => props.onDeleteProject(project.id)}
                  >
                    ${tLocale(locale, "Delete", "删除")}
                  </button>
                </div>
              `
            : nothing}
        </div>
      </div>

      ${html`
        <div class="workbench-tree-node__children ${expanded ? "is-expanded" : ""}">
          <div class="workbench-tree-node__children-inner">
            ${!expanded
              ? nothing
              : project.sessions.length === 0
                ? html`
                    <div class="workbench-empty workbench-empty--tiny">
                      ${tLocale(locale, "No sessions yet.", "还没有会话。")}
                    </div>
                  `
                : html`
                    ${repeat(
                      visibleSessions,
                      (session) => session.key,
                      (session) => {
                        const sessionMenuKey = `session:${session.key}`;
                        const sessionMenuOpen = isTreeMenuOpen(props, sessionMenuKey);
                        const sessionDeleteDisabled = isProtectedMainSessionKey(session.key);
                        return html`
                          <div
                            class="workbench-tree-session ${props.currentSessionKey === session.key
                              ? "is-active"
                              : ""}"
                          >
                            <button
                              type="button"
                              class="workbench-tree-session__main"
                              @click=${() => props.onSelectSession(session.key)}
                            >
                              <span
                                class="workbench-tree-session__icon ${props.runningSessionKeys[
                                  session.key
                                ]
                                  ? "is-running"
                                  : ""}"
                              >
                                ${props.runningSessionKeys[session.key]
                                  ? html` <span class="workbench-tree-session__spinner"></span> `
                                  : icons.messageSquare}
                              </span>
                              <span class="workbench-tree-session__label">${session.label}</span>
                              ${props.unreadSessionKeys[session.key]
                                ? html` <span class="workbench-tree-session__unread-dot"></span> `
                                : nothing}
                            </button>
                            <div class="workbench-tree-session__menu-anchor">
                              <button
                                type="button"
                                class="workbench-tree-session__more ${sessionMenuOpen
                                  ? "is-open"
                                  : ""}"
                                aria-label=${tLocale(locale, "Session actions", "会话操作")}
                                aria-haspopup="menu"
                                aria-expanded=${sessionMenuOpen}
                                @click=${(event: Event) => {
                                  event.stopPropagation();
                                  props.onToggleSessionMenu(session.key);
                                }}
                              >
                                ${icons.moreHorizontal}
                              </button>
                              ${sessionMenuOpen
                                ? html`
                                    <div class="workbench-tree-menu" role="menu">
                                      <button
                                        type="button"
                                        class="workbench-tree-menu__item"
                                        role="menuitem"
                                        @click=${() => props.onRenameSession(session.key)}
                                      >
                                        ${tLocale(locale, "Rename", "重命名")}
                                      </button>
                                      <button
                                        type="button"
                                        class="workbench-tree-menu__item workbench-tree-menu__item--danger ${sessionDeleteDisabled
                                          ? "is-disabled"
                                          : ""}"
                                        role="menuitem"
                                        ?disabled=${sessionDeleteDisabled}
                                        title=${sessionDeleteDisabled
                                          ? tLocale(
                                              locale,
                                              "The default main session cannot be deleted",
                                              "默认主会话不可删除",
                                            )
                                          : ""}
                                        @click=${() => props.onDeleteSession(session.key)}
                                      >
                                        ${sessionDeleteDisabled
                                          ? tLocale(
                                              locale,
                                              "Default session cannot be deleted",
                                              "默认会话不可删除",
                                            )
                                          : tLocale(locale, "Delete", "删除")}
                                      </button>
                                    </div>
                                  `
                                : nothing}
                            </div>
                          </div>
                        `;
                      },
                    )}
                    ${hasHiddenSessions
                      ? html`
                          <button
                            type="button"
                            class="workbench-tree-session-toggle"
                            @click=${() => props.onToggleProjectSessionsVisibility(project.id)}
                          >
                            ${tLocale(
                              locale,
                              sessionsExpanded ? "Show less" : "Show all",
                              sessionsExpanded ? "收起显示" : "展开显示",
                            )}
                          </button>
                        `
                      : nothing}
                  `}
          </div>
        </div>
      `}
    </div>
  `;
}

function renderSessionView(
  props: WorkbenchProps,
  _project: WorkbenchProject | null,
  _session: WorkbenchSession,
) {
  const assistantAvatar = resolveAgentAvatarUrl({
    identity: {
      avatar: null,
      avatarUrl: null,
    },
  });
  const hasLiveMessages =
    props.chatMessages.length > 0 ||
    props.chatToolMessages.length > 0 ||
    props.chatStreamSegments.length > 0 ||
    Boolean(props.chatStream?.trim());
  const canSend = Boolean(props.chatMessage.trim() || props.pendingChatFiles.length > 0);
  return html`
    <section
      class="workbench-session-shell ${props.rightRailCollapsed
        ? "workbench-session-shell--centered"
        : ""}"
    >
      <section class="workbench-chat-surface">
        ${renderPowerChatThread({
          messages: props.chatMessages,
          toolMessages: props.chatToolMessages,
          streamSegments: props.chatStreamSegments,
          stream: props.chatStream,
          streamStartedAt: props.chatStreamStartedAt,
          sessionKey: props.currentSessionKey,
          showToolCalls: props.showToolCalls,
          assistantName: props.assistantName,
          assistantAvatar,
          basePath: props.basePath,
          onRequestUpdate: props.onRequestUpdate,
          onScroll: props.onChatScroll,
          emptyState: hasLiveMessages
            ? nothing
            : html`
                <div class="workbench-empty workbench-empty--chat">
                  <h4>No conversation yet</h4>
                  <p>Use the composer below to send the first message into this session.</p>
                </div>
              `,
        })}

        <div class="workbench-chat-composer workbench-chat-composer--floating">
          ${renderPendingChatFiles(props)}
          <textarea
            class="workbench-composer workbench-composer--session"
            .value=${props.chatMessage}
            placeholder="Reply in this session..."
            @input=${(event: Event) =>
              props.onComposerChange((event.target as HTMLTextAreaElement).value)}
            @keydown=${props.onComposerKeyDown}
            @compositionend=${props.onComposerCompositionEnd}
          ></textarea>
          <div class="workbench-chat-composer__footer">
            <div class="workbench-chat-composer__controls">
              <button
                type="button"
                class="workbench-circle-button"
                title="Upload files"
                aria-label="Upload files"
                @click=${props.onOpenAttachment}
              >
                ${icons.plus}
              </button>
              <label class="workbench-model-select" aria-label="Choose model">
                <select
                  .value=${props.currentModelId}
                  @change=${(event: Event) =>
                    props.onModelChange((event.target as HTMLSelectElement).value)}
                >
                  ${repeat(
                    props.modelCatalog,
                    (model) => `${model.provider}/${model.id}`,
                    (model) =>
                      html`<option value=${`${model.provider}/${model.id}`}>${model.id}</option>`,
                  )}
                </select>
                <span class="workbench-model-select__chevron">${icons.chevronDown}</span>
              </label>
            </div>
            ${props.chatRunId
              ? html`
                  <button
                    type="button"
                    class="workbench-send-button"
                    title="Stop"
                    aria-label="Stop"
                    @click=${props.onAbort}
                  >
                    ${icons.x}
                  </button>
                `
              : html`
                  <button
                    type="button"
                    class="workbench-send-button"
                    title="Send"
                    aria-label="Send"
                    ?disabled=${props.chatSending || !canSend}
                    @click=${props.onSend}
                  >
                    ${icons.arrowUp}
                  </button>
                `}
          </div>
        </div>
      </section>
    </section>
  `;
}

function renderPendingChatFiles(props: WorkbenchProps) {
  if (props.pendingChatFiles.length === 0) {
    return nothing;
  }
  return html`
    <div class="workbench-chat-files">
      ${repeat(
        props.pendingChatFiles,
        (entry) => entry.id,
        (entry) => html`
          <div class="workbench-chat-file-chip">
            <span class="workbench-chat-file-chip__icon">${icons.fileText}</span>
            <span class="workbench-chat-file-chip__body">
              <span class="workbench-chat-file-chip__name" title=${entry.name}>${entry.name}</span>
              <span class="workbench-chat-file-chip__meta"
                >${formatBytes(entry.size)} ·
                ${entry.status === "uploading"
                  ? entry.progress != null
                    ? `${entry.progress}%`
                    : "Uploading"
                  : entry.status === "uploaded"
                    ? "Uploaded"
                    : entry.status === "failed"
                      ? entry.error || "Upload failed"
                      : "Pending"}</span
              >
              ${entry.status === "uploading" || entry.status === "failed"
                ? html`
                    <span
                      class="workbench-chat-file-chip__progress ${entry.status === "failed"
                        ? "is-failed"
                        : entry.progress == null
                          ? "is-indeterminate"
                          : ""}"
                      aria-hidden="true"
                    >
                      <span
                        class="workbench-chat-file-chip__progress-bar"
                        style=${`width: ${
                          entry.status === "uploading" ? (entry.progress ?? 100) : 100
                        }%`}
                      ></span>
                    </span>
                  `
                : nothing}
            </span>
            <button
              type="button"
              class="workbench-chat-file-chip__remove"
              aria-label="Remove file"
              title="Remove file"
              @click=${() => props.onRemovePendingChatFile(entry.id)}
            >
              ${icons.x}
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

function renderFilesPage(props: WorkbenchProps, project: WorkbenchProject | null) {
  const locale = props.settings.locale;
  if (!project) {
    return html`
      <section class="workbench-page-shell workbench-page-shell--scroll">
        <div class="workbench-page-shell__body">
          <div class="workbench-empty workbench-empty--chat">
            <h4>${tLocale(locale, "No default workspace available", "默认工作目录不可用")}</h4>
            <p>
              ${tLocale(
                locale,
                "Configure or enable a default agent first, then open Files again.",
                "请先配置并启用默认 agent，然后再打开文件页面。",
              )}
            </p>
          </div>
        </div>
      </section>
    `;
  }
  return html`
    <section class="workbench-page-shell workbench-page-shell--scroll">
      <div class="workbench-page-shell__body workbench-page-shell__body--files-page">
        <div class="workbench-sidecard__header">
          <div>
            <h4>${tLocale(locale, "Workspace", "工作目录")}</h4>
            <div class="workbench-mini-row__meta">
              ${project.label}
              ${project.workspace
                ? html`<span class="workbench-sidecard__path" title=${project.workspace}
                    >${project.workspace}</span
                  >`
                : nothing}
            </div>
          </div>
        </div>
        ${renderProjectFilesBrowser(props, project, { fullPage: true })}
      </div>
    </section>
  `;
}

function renderSkillsPage(props: WorkbenchProps) {
  return html`
    <section class="workbench-page-shell workbench-page-shell--scroll">
      <div class="workbench-page-shell__body">${renderSkills(props.skillsPage)}</div>
    </section>
  `;
}

function formatWorkspaceRelativePath(workspacePath: string | null, currentPath: string | null) {
  const workspace = workspacePath?.trim() || "";
  const current = currentPath?.trim() || "";
  if (!workspace || !current) {
    return "/";
  }
  if (!current.startsWith(workspace)) {
    return current;
  }
  const relative = current.slice(workspace.length).replace(/^\/+/, "");
  return relative ? `/${relative}` : "/";
}

function renderRightRail(props: WorkbenchProps, project: WorkbenchProject) {
  return html`<aside class="workbench-rail">${renderProjectFilesBrowser(props, project)}</aside>`;
}

function renderProjectFilesBrowser(
  props: WorkbenchProps,
  project: WorkbenchProject,
  options: { fullPage?: boolean } = {},
) {
  const locale = props.settings.locale;
  const isActiveBrowser = props.fileManagerAgentId === project.id;
  const browserAgentId = isActiveBrowser
    ? props.fileManagerAgentId
    : (props.projectFilesAgentId ?? project.id);
  const workspacePath =
    (isActiveBrowser ? props.fileManagerWorkspace : props.projectFilesWorkspace) ??
    project.workspace;
  const currentPath = isActiveBrowser ? props.fileManagerCurrentPath : workspacePath;
  const parentPath = isActiveBrowser ? props.fileManagerParentPath : null;
  const entries = isActiveBrowser ? props.fileManagerEntries : props.projectFilesEntries;
  const sortedEntries = [...entries].toSorted((a, b) =>
    compareFileEntries(a, b, props.fileSortKey),
  );
  const filteredEntries = props.showAgentFiles
    ? sortedEntries
    : sortedEntries.filter((entry) => !isAgentManagedProjectFile(entry));
  const hiddenAgentFileCount = sortedEntries.length - filteredEntries.length;
  const searchQuery = props.fileSearchQuery.trim().toLowerCase();
  const visibleEntries = searchQuery
    ? filteredEntries.filter((entry) => entry.name.toLowerCase().includes(searchQuery))
    : filteredEntries;
  const loading = isActiveBrowser ? props.fileManagerLoading : props.projectFilesLoading;
  const error = isActiveBrowser ? props.fileManagerError : props.projectFilesError;
  const busyPath = props.fileManagerBusyPath;
  const folderCount = visibleEntries.filter((entry) => entry.kind === "directory").length;
  const fileCount = visibleEntries.filter((entry) => entry.kind === "file").length;
  const canCreate = Boolean(currentPath && !loading);
  const pathLabel = formatWorkspaceRelativePath(workspacePath, currentPath);
  const cardClass = options.fullPage
    ? "workbench-sidecard workbench-sidecard--files workbench-sidecard--files-page"
    : "workbench-sidecard workbench-sidecard--files";
  const sortOptions: Array<{ key: WorkbenchFileSortKey; label: string }> = [
    { key: "name", label: tLocale(locale, "Name", "名称") },
    { key: "size", label: tLocale(locale, "Size", "大小") },
    { key: "updatedAt", label: tLocale(locale, "Time", "时间") },
    { key: "kind", label: tLocale(locale, "Type", "类型") },
  ];

  return html`
    <section
      class=${cardClass}
      @click=${(event: Event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (!target.closest(".workbench-mini-row--file")) {
          props.onClearProjectEntrySelection();
        }
      }}
    >
      <div class="workbench-sidecard__header">
        <h4>${tLocale(locale, "Project Files", "项目文件")}</h4>
        <div class="workbench-sidecard__actions">
          ${options.fullPage
            ? html`
                <label
                  class="workbench-search-field workbench-sidecard__search-field"
                  aria-label=${tLocale(locale, "Search files", "搜索文件")}
                >
                  ${icons.search}
                  <input
                    type="text"
                    .value=${props.fileSearchQuery}
                    placeholder=${tLocale(locale, "Search by file name...", "按文件名搜索...")}
                    @input=${(event: Event) =>
                      props.onFileSearchChange((event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <label
                  class="workbench-sidecard__sort-select"
                  aria-label=${tLocale(locale, "Sort files", "文件排序")}
                >
                  <select
                    .value=${props.fileSortKey}
                    @change=${(event: Event) =>
                      props.onFileSortChange(
                        (event.currentTarget as HTMLSelectElement).value as WorkbenchFileSortKey,
                      )}
                  >
                    <option value="name">${tLocale(locale, "Name", "名称")}</option>
                    <option value="updatedAt">${tLocale(locale, "Modified", "修改时间")}</option>
                    <option value="size">${tLocale(locale, "Size", "大小")}</option>
                    <option value="kind">${tLocale(locale, "Kind", "种类")}</option>
                  </select>
                  <span class="workbench-sidecard__sort-select-chevron">${icons.chevronDown}</span>
                </label>
                <div class="workbench-sidecard__visibility-switch">
                  <span>${tLocale(locale, "Show agent files", "显示智能体文件")}</span>
                  <label class="workbench-switch">
                    <input
                      type="checkbox"
                      .checked=${props.showAgentFiles}
                      @change=${() => props.onToggleAgentFilesVisibility()}
                    />
                    <span></span>
                  </label>
                </div>
              `
            : html`
                <div class="workbench-sidecard__sort-menu-anchor">
                  <button
                    type="button"
                    class="workbench-icon-button workbench-sidecard__toolbar-icon"
                    title=${tLocale(locale, "File visibility", "显示设置")}
                    aria-label=${tLocale(locale, "File visibility", "显示设置")}
                    aria-expanded=${String(props.fileVisibilityMenuOpen)}
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      props.onToggleFileVisibilityMenu();
                    }}
                  >
                    ${props.showAgentFiles ? icons.eye : icons.eyeOff}
                  </button>
                  ${props.fileVisibilityMenuOpen
                    ? html`
                        <div class="workbench-sidecard__sort-menu" role="menu">
                          <div class="workbench-sidecard__sort-menu-title">
                            ${tLocale(locale, "Visibility", "显示内容")}
                          </div>
                          <button
                            type="button"
                            class="workbench-sidecard__sort-menu-item ${props.showAgentFiles
                              ? "is-active"
                              : ""}"
                            role="menuitemcheckbox"
                            aria-checked=${String(props.showAgentFiles)}
                            @click=${(event: Event) => {
                              event.stopPropagation();
                              props.onToggleAgentFilesVisibility();
                            }}
                          >
                            <span>${tLocale(locale, "Agent files", "智能体文件")}</span>
                            ${props.showAgentFiles
                              ? html` <span class="workbench-sidecard__sort-menu-check">✓</span> `
                              : nothing}
                          </button>
                        </div>
                      `
                    : nothing}
                </div>
                <div class="workbench-sidecard__sort-menu-anchor">
                  <button
                    type="button"
                    class="workbench-icon-button workbench-sidecard__toolbar-icon"
                    title=${tLocale(locale, "Sort files", "文件排序")}
                    aria-label=${tLocale(locale, "Sort files", "文件排序")}
                    aria-expanded=${String(props.fileSortMenuOpen)}
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      props.onToggleFileSortMenu();
                    }}
                  >
                    ${icons.arrowUpDown}
                  </button>
                  ${props.fileSortMenuOpen
                    ? html`
                        <div class="workbench-sidecard__sort-menu" role="menu">
                          <div class="workbench-sidecard__sort-menu-title">
                            ${tLocale(locale, "Sort by", "排序条件")}
                          </div>
                          ${sortOptions.map(
                            (option) => html`
                              <button
                                type="button"
                                class="workbench-sidecard__sort-menu-item ${props.fileSortKey ===
                                option.key
                                  ? "is-active"
                                  : ""}"
                                role="menuitemradio"
                                aria-checked=${String(props.fileSortKey === option.key)}
                                @click=${(event: Event) => {
                                  event.stopPropagation();
                                  props.onFileSortChange(option.key);
                                }}
                              >
                                <span>${option.label}</span>
                                ${props.fileSortKey === option.key
                                  ? html`
                                      <span class="workbench-sidecard__sort-menu-check">✓</span>
                                    `
                                  : nothing}
                              </button>
                            `,
                          )}
                        </div>
                      `
                    : nothing}
                </div>
              `}
          <button
            type="button"
            class="workbench-icon-button workbench-sidecard__toolbar-icon"
            title=${tLocale(locale, "Upload files", "上传文件")}
            aria-label=${tLocale(locale, "Upload files", "上传文件")}
            ?disabled=${!currentPath || loading}
            @click=${() => {
              if (!browserAgentId) {
                return;
              }
              props.onOpenProjectFilePicker(browserAgentId, currentPath);
            }}
          >
            ${icons.plus}
          </button>
          <button
            type="button"
            class="workbench-icon-button workbench-sidecard__toolbar-icon"
            title=${tLocale(locale, "Create folder", "新建文件夹")}
            aria-label=${tLocale(locale, "Create folder", "新建文件夹")}
            ?disabled=${!canCreate}
            @click=${props.onToggleCreateFolder}
          >
            ${icons.folderPlus}
          </button>
          <button
            type="button"
            class="workbench-icon-button workbench-sidecard__toolbar-icon"
            title=${tLocale(locale, "Refresh", "刷新")}
            aria-label=${tLocale(locale, "Refresh", "刷新")}
            ?disabled=${!workspacePath || loading}
            @click=${props.onRefreshFileManager}
          >
            ${icons.rotateCw}
          </button>
        </div>
      </div>

      ${currentPath && parentPath
        ? html`
            <div class="workbench-sidecard__toolbar">
              <button
                type="button"
                class="workbench-sidecard__back-button"
                ?disabled=${loading}
                @click=${() => props.onNavigateFileManager(parentPath)}
              >
                ${icons.chevronLeft}
                <span>${tLocale(locale, "Back", "返回")}</span>
              </button>
              <span class="workbench-sidecard__path" title=${currentPath ?? pathLabel}
                >${pathLabel}</span
              >
            </div>
          `
        : nothing}
      ${props.fileManagerCreateFolderOpen
        ? html`
            <div class="workbench-sidecard__create-row">
              <input
                type="text"
                class="workbench-sidecard__create-input"
                data-file-manager-folder-input
                .value=${props.fileManagerNewFolderName}
                placeholder=${tLocale(locale, "Enter folder name...", "输入文件夹名称...")}
                @input=${(event: Event) =>
                  props.onFileManagerFolderNameChange(
                    (event.currentTarget as HTMLInputElement).value,
                  )}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    props.onCreateFileManagerFolder();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    props.onToggleCreateFolder();
                  }
                }}
              />
              <button
                type="button"
                class="workbench-sidecard__create-confirm"
                ?disabled=${loading || !props.fileManagerNewFolderName.trim()}
                @click=${props.onCreateFileManagerFolder}
              >
                ${icons.check}
              </button>
              <button
                type="button"
                class="workbench-sidecard__create-cancel"
                ?disabled=${loading}
                @click=${props.onToggleCreateFolder}
              >
                ${icons.x}
              </button>
            </div>
          `
        : nothing}

      <div
        class=${options.fullPage
          ? "workbench-sidecard__body workbench-sidecard__body--scroll workbench-sidecard__body--fill"
          : "workbench-sidecard__body workbench-sidecard__body--scroll"}
      >
        ${error
          ? html`<div class="workbench-callout workbench-callout--danger">${error}</div>`
          : nothing}
        ${loading
          ? html`
              <div class="workbench-skeleton">
                ${tLocale(locale, "Loading files...", "正在加载文件...")}
              </div>
            `
          : visibleEntries.length === 0
            ? html`
                <div class="workbench-empty workbench-empty--tiny">
                  ${searchQuery
                    ? tLocale(locale, "No matching files found.", "没有找到匹配的文件。")
                    : tLocale(locale, "This folder is empty.", "当前目录为空。")}
                </div>
              `
            : repeat(
                visibleEntries,
                (entry) => entry.path,
                (entry) => html`
                  <div
                    class="workbench-mini-row workbench-mini-row--file workbench-mini-row--hoverable ${props.selectedProjectEntryPath ===
                    entry.path
                      ? "is-selected"
                      : ""}"
                    @click=${() => props.onSelectProjectEntry(entry.path)}
                  >
                    <span class="workbench-mini-row__icon">
                      ${entry.kind === "directory" ? icons.folder : icons.fileText}
                    </span>
                    <button
                      type="button"
                      class="workbench-mini-row__content ${entry.kind === "directory"
                        ? "is-directory"
                        : ""}"
                      title=${entry.name}
                      @click=${() => props.onSelectProjectEntry(entry.path)}
                      @dblclick=${() => {
                        if (entry.kind === "directory") {
                          props.onNavigateFileManager(entry.path);
                          return;
                        }
                        if (!browserAgentId) {
                          return;
                        }
                        props.onPreviewProjectFile(browserAgentId, entry);
                      }}
                    >
                      <span class="workbench-mini-row__name">${entry.name}</span>
                      <div class="workbench-mini-row__meta">
                        ${entry.kind === "directory"
                          ? tLocale(locale, "Folder", "文件夹")
                          : `${formatBytes(entry.size ?? 0)}${entry.updatedAtMs ? ` · ${formatTimestamp(entry.updatedAtMs)}` : ""}`}
                      </div>
                    </button>
                    <div class="workbench-mini-row__actions workbench-mini-row__actions--hover">
                      ${entry.kind === "file"
                        ? html`
                            <button
                              type="button"
                              class="workbench-icon-button"
                              title=${tLocale(locale, "Download file", "下载文件")}
                              aria-label=${tLocale(locale, "Download file", "下载文件")}
                              ?disabled=${busyPath === entry.path}
                              @click=${(event: Event) => {
                                event.stopPropagation();
                                if (!browserAgentId) {
                                  return;
                                }
                                props.onDownloadProjectFile(browserAgentId, entry.path);
                              }}
                            >
                              ${icons.download}
                            </button>
                          `
                        : nothing}
                      <button
                        type="button"
                        class="workbench-icon-button"
                        title=${entry.kind === "directory"
                          ? tLocale(locale, "Delete folder", "删除文件夹")
                          : tLocale(locale, "Delete file", "删除文件")}
                        aria-label=${entry.kind === "directory"
                          ? tLocale(locale, "Delete folder", "删除文件夹")
                          : tLocale(locale, "Delete file", "删除文件")}
                        ?disabled=${busyPath === entry.path}
                        @click=${(event: Event) => {
                          event.stopPropagation();
                          if (!browserAgentId) {
                            return;
                          }
                          props.onDeleteProjectEntry(browserAgentId, entry.path);
                        }}
                      >
                        ${icons.trash}
                      </button>
                    </div>
                  </div>
                `,
              )}
      </div>
      <div class="workbench-sidecard__footer">
        ${folderCount} ${tLocale(locale, "folders", "个文件夹")} · ${fileCount}
        ${tLocale(locale, "files", "个文件")}
        ${!props.showAgentFiles && hiddenAgentFileCount > 0
          ? html`
              · ${tLocale(locale, "Hidden", "已隐藏")} ${hiddenAgentFileCount}
              ${tLocale(locale, "agent files", "个智能体文件")}
            `
          : nothing}
      </div>
    </section>
  `;
}

function renderSettingsDialog(props: WorkbenchProps) {
  const locale = props.settings.locale;
  const stateClass = dialogStateClass(props.settingsOpen, props.settingsClosing);
  return html`
    <div class="workbench-overlay ${stateClass}">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseSettings}></div>
      <div class="workbench-dialog workbench-dialog--settings ${stateClass}">
        <div class="workbench-settings-layout">
          <aside class="workbench-settings-nav">
            <div class="workbench-settings-nav__header">
              <h3>${tLocale(locale, "Settings", "设置")}</h3>
            </div>
            <button
              type="button"
              class="${props.settingsTab === "general" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("general")}
            >
              <span class="workbench-settings-nav__icon">${icons.wrench}</span>
              ${tLocale(locale, "General", "通用")}
            </button>
            <button
              type="button"
              class="${props.settingsTab === "connectors" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("connectors")}
            >
              <span class="workbench-settings-nav__icon">${icons.plug}</span>
              ${tLocale(locale, "Connectors", "连接器")}
            </button>
            <button
              type="button"
              class="${props.settingsTab === "models" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("models")}
            >
              <span class="workbench-settings-nav__icon">${icons.spark}</span>
              ${tLocale(locale, "Models", "模型")}
            </button>
            <button
              type="button"
              class="${props.settingsTab === "dreaming" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("dreaming")}
            >
              <span class="workbench-settings-nav__icon">${icons.moon}</span>
              ${tLocale(locale, "Dreaming", "梦境")}
            </button>
            <button
              type="button"
              class="${props.settingsTab === "statistics" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("statistics")}
            >
              <span class="workbench-settings-nav__icon">${icons.barChart}</span>
              ${tLocale(locale, "Statistics", "统计")}
            </button>
            <button
              type="button"
              class="${props.settingsTab === "automations" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("automations")}
            >
              <span class="workbench-settings-nav__icon">${icons.loader}</span>
              ${tLocale(locale, "Scheduled Jobs", "定时任务")}
            </button>
            <button
              type="button"
              class="${props.settingsTab === "logs" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("logs")}
            >
              <span class="workbench-settings-nav__icon">${icons.terminal}</span>
              ${tLocale(locale, "Logs", "日志")}
            </button>
          </aside>

          <section
            class="workbench-settings-panel ${props.settingsTab === "models" ||
            props.settingsTab === "connectors" ||
            props.settingsTab === "dreaming" ||
            props.settingsTab === "automations" ||
            props.settingsTab === "logs"
              ? "workbench-settings-panel--models"
              : ""}"
          >
            <div class="workbench-settings-panel__header">
              <div>
                <h4>
                  ${props.settingsTab === "general"
                    ? tLocale(locale, "General", "通用")
                    : props.settingsTab === "connectors"
                      ? tLocale(locale, "Connectors", "连接器")
                      : props.settingsTab === "models"
                        ? tLocale(locale, "Model Settings", "模型设置")
                        : props.settingsTab === "dreaming"
                          ? tLocale(locale, "Dreaming", "梦境")
                          : props.settingsTab === "statistics"
                            ? tLocale(locale, "Statistics", "统计")
                            : props.settingsTab === "automations"
                              ? tLocale(locale, "Scheduled Jobs", "定时任务")
                              : tLocale(locale, "Logs", "日志")}
                </h4>
                ${props.settingsTab === "general"
                  ? html`
                      <p>
                        ${tLocale(
                          locale,
                          "Control language and interface appearance.",
                          "控制语言和界面外观。",
                        )}
                      </p>
                    `
                  : props.settingsTab === "connectors"
                    ? html`
                        <p>
                          ${tLocale(
                            locale,
                            "Manage external systems and expose governed tools to agents.",
                            "管理外部系统连接，并向 agent 暴露受控工具。",
                          )}
                        </p>
                      `
                    : props.settingsTab === "models"
                      ? html`
                          <p>
                            ${tLocale(
                              locale,
                              "Manage model providers, endpoints, and default selections.",
                              "管理模型提供方、接口地址和默认选择。",
                            )}
                          </p>
                        `
                      : props.settingsTab === "dreaming"
                        ? html`
                            <p>
                              ${tLocale(
                                locale,
                                "Inspect and manage memory dreaming using the upstream experience.",
                                "使用原生梦境页面检查和管理记忆梦境。",
                              )}
                            </p>
                          `
                        : props.settingsTab === "statistics"
                          ? html`
                              <p>
                                ${tLocale(
                                  locale,
                                  "Check the recent token footprint.",
                                  "查看最近的 token 消耗概况。",
                                )}
                              </p>
                            `
                          : props.settingsTab === "automations"
                            ? html`
                                <p>
                                  ${tLocale(
                                    locale,
                                    "Manage recurring jobs and delivery settings.",
                                    "管理周期任务和投递设置。",
                                  )}
                                </p>
                              `
                            : props.settingsTab === "logs"
                              ? html`
                                  <p>
                                    ${tLocale(
                                      locale,
                                      "Inspect gateway logs with filtering and export.",
                                      "查看网关日志并进行筛选和导出。",
                                    )}
                                  </p>
                                `
                              : nothing}
              </div>
              <button
                type="button"
                class="workbench-icon-button workbench-settings-close"
                aria-label="Close settings"
                @click=${props.onCloseSettings}
              >
                ${icons.x}
              </button>
            </div>
            ${props.settingsTab === "general"
              ? html`
                  <article class="workbench-setting-card">
                    <div class="workbench-settings-section">
                      <div class="workbench-settings-section__header">
                        <span>Language</span>
                      </div>
                      <label class="workbench-settings-field">
                        <span>Display language</span>
                        <div class="workbench-settings-select">
                          <select
                            .value=${props.settings.locale ?? ""}
                            @change=${(event: Event) =>
                              props.settingsView.onLocaleChange(
                                (event.target as HTMLSelectElement).value,
                              )}
                          >
                            ${props.settingsView.localeOptions.map(
                              (option) =>
                                html`<option value=${option.value}>${option.label}</option>`,
                            )}
                          </select>
                          <span class="workbench-settings-select__chevron">
                            ${icons.chevronDown}
                          </span>
                        </div>
                      </label>
                    </div>

                    <div class="workbench-settings-section">
                      <div class="workbench-settings-section__header">
                        <span>Theme</span>
                      </div>
                      <div class="workbench-settings-cards">
                        ${renderThemeCard(
                          "claw",
                          "Claw",
                          "OpenClaw default palette",
                          props.settings.theme === "claw",
                          () => props.settingsView.onThemeChange("claw"),
                        )}
                        ${renderThemeCard(
                          "knot",
                          "Knot",
                          "Teal editorial palette",
                          props.settings.theme === "knot",
                          () => props.settingsView.onThemeChange("knot"),
                        )}
                        ${renderThemeCard(
                          "dash",
                          "Dash",
                          "Blue product palette",
                          props.settings.theme === "dash",
                          () => props.settingsView.onThemeChange("dash"),
                        )}
                      </div>
                    </div>

                    <div class="workbench-settings-section">
                      <div class="workbench-settings-section__header">
                        <span>Mode</span>
                      </div>
                      <div class="workbench-settings-cards">
                        ${renderAppearanceCard(
                          "light",
                          "Light",
                          props.settings.themeMode === "light",
                          () => props.settingsView.onThemeModeChange("light"),
                        )}
                        ${renderAppearanceCard(
                          "dark",
                          "Dark",
                          props.settings.themeMode === "dark",
                          () => props.settingsView.onThemeModeChange("dark"),
                        )}
                        ${renderAppearanceCard(
                          "system",
                          "Follow System",
                          props.settings.themeMode === "system",
                          () => props.settingsView.onThemeModeChange("system"),
                        )}
                      </div>
                    </div>
                  </article>
                `
              : props.settingsTab === "models"
                ? html`
                    <article class="workbench-setting-card workbench-setting-card--models">
                      <div class="workbench-settings-model-shell">
                        <div class="workbench-settings-model-shell__head"></div>
                        <div class="workbench-settings-model-shell__list">
                          <div class="workbench-settings-models">
                            ${repeat(
                              props.settingsView.modelConfigs,
                              (config) => config.id,
                              (config) => renderModelCard(props, config, locale),
                            )}
                            <button
                              type="button"
                              class="workbench-settings-model-add"
                              @click=${props.settingsView.onAddModelConfig}
                            >
                              <span class="workbench-settings-model-add__icon">${icons.plus}</span>
                              ${tLocale(locale, "Add model", "添加模型")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  `
                : props.settingsTab === "connectors"
                  ? html`
                      <article class="workbench-setting-card workbench-setting-card--models">
                        ${renderConnectorsPanel(props)}
                      </article>
                    `
                  : props.settingsTab === "dreaming"
                    ? html`
                        <article class="workbench-setting-card workbench-setting-card--models">
                          <div class="workbench-settings-model-shell">
                            <div class="workbench-settings-model-shell__head">
                              <div class="dreaming-header-controls">
                                <button
                                  type="button"
                                  class="btn btn--subtle btn--sm"
                                  ?disabled=${props.dreamingPage.loading}
                                  @click=${props.dreamingPage.onRefresh}
                                >
                                  ${props.dreamingPage.refreshLoading
                                    ? tLocale(locale, "Refreshing", "刷新中")
                                    : tLocale(locale, "Refresh", "刷新")}
                                </button>
                                <button
                                  type="button"
                                  class="dreams__phase-toggle ${props.dreamingPage.active
                                    ? "dreams__phase-toggle--on"
                                    : ""}"
                                  ?disabled=${props.dreamingPage.loading}
                                  @click=${props.dreamingPage.onToggleEnabled}
                                >
                                  <span class="dreams__phase-toggle-dot"></span>
                                  <span class="dreams__phase-toggle-label">
                                    ${props.dreamingPage.active
                                      ? tLocale(locale, "DREAMING 已开启", "DREAMING 已开启")
                                      : tLocale(locale, "DREAMING 已关闭", "DREAMING 已关闭")}
                                  </span>
                                </button>
                              </div>
                            </div>
                            <div class="workbench-settings-model-shell__list">
                              ${renderDreaming(props.dreamingPage.view)}
                            </div>
                          </div>
                        </article>
                      `
                    : props.settingsTab === "automations"
                      ? html`
                          <article class="workbench-setting-card workbench-setting-card--models">
                            <div class="workbench-settings-model-shell">
                              <div class="workbench-settings-model-shell__head"></div>
                              <div class="workbench-settings-model-shell__list">
                                ${renderCron(props.automationsPage)}
                              </div>
                            </div>
                          </article>
                        `
                      : props.settingsTab === "logs"
                        ? html`
                            <article class="workbench-setting-card workbench-setting-card--models">
                              <div class="workbench-settings-model-shell">
                                <div class="workbench-settings-model-shell__head"></div>
                                <div class="workbench-settings-model-shell__list">
                                  ${renderLogs(props.logsPage)}
                                </div>
                              </div>
                            </article>
                          `
                        : html`
                            <article class="workbench-setting-card">
                              ${renderStatisticsPanel(props)}
                            </article>
                          `}
          </section>
        </div>
      </div>
    </div>
  `;
}

function renderConnectorsPanel(props: WorkbenchProps) {
  const locale = props.settings.locale;
  const connectors = props.settingsView.connectors;
  const selectedProvider =
    connectors.providers.find((provider) => provider.id === connectors.selectedProviderId) ?? null;
  const editingInstance =
    connectors.instances.find((instance) => instance.id === connectors.editingInstanceId) ?? null;
  return html`
    <div class="workbench-settings-model-shell">
      <div class="workbench-settings-model-shell__head">
        <div class="dreaming-header-controls">
          <button type="button" class="btn btn--subtle btn--sm" @click=${connectors.onRefresh}>
            ${tLocale(locale, "Refresh", "刷新")}
          </button>
          <button type="button" class="btn btn--primary btn--sm" @click=${connectors.onCreateNew}>
            ${tLocale(locale, "New Connection", "新建连接")}
          </button>
        </div>
      </div>
      <div class="workbench-settings-model-shell__list">
        ${connectors.error ? html`<p class="skills-empty">${connectors.error}</p>` : nothing}
        <div class="workbench-settings-section">
          <div class="workbench-settings-section__header">
            <span>${tLocale(locale, "Providers", "连接器类型")}</span>
          </div>
          <div class="workbench-settings-cards">
            ${repeat(
              connectors.providers,
              (provider) => provider.id,
              (provider) => html`
                <button
                  type="button"
                  class="workbench-theme-card ${provider.id === connectors.selectedProviderId
                    ? "is-active"
                    : ""}"
                  @click=${() => connectors.onSelectProvider(provider.id)}
                >
                  <strong>${provider.displayName}</strong>
                  <span>${provider.description}</span>
                </button>
              `,
            )}
          </div>
        </div>

        <div class="workbench-settings-section">
          <div class="workbench-settings-section__header">
            <span>${tLocale(locale, "Configured Instances", "已配置实例")}</span>
          </div>
          <div class="workbench-settings-models">
            ${connectors.instances.length === 0
              ? html`<p class="skills-empty">
                  ${tLocale(locale, "No connectors yet.", "还没有连接器。")}
                </p>`
              : repeat(
                  connectors.instances,
                  (instance) => instance.id,
                  (instance) => renderConnectorInstanceCard(connectors, instance, locale),
                )}
          </div>
        </div>

        ${selectedProvider
          ? html`
              <div class="workbench-settings-section">
                <div class="workbench-settings-section__header">
                  <span>
                    ${editingInstance
                      ? tLocale(locale, "Edit Connection", "编辑连接")
                      : tLocale(locale, "Create Connection", "新建连接")}
                  </span>
                </div>
                <div class="workbench-settings-models">
                  ${renderConnectorEditor(connectors, selectedProvider, locale)}
                </div>
              </div>
            `
          : nothing}
      </div>
    </div>
  `;
}

function renderConnectorInstanceCard(
  connectors: WorkbenchProps["settingsView"]["connectors"],
  instance: ConnectorInstance,
  locale: string | undefined,
) {
  return html`
    <section class="workbench-model-card ${instance.enabled ? "" : "is-disabled"}">
      <div class="workbench-model-card__header">
        <div class="workbench-model-card__title-group">
          <strong>${instance.displayName}</strong>
          <span>${instance.providerId}</span>
        </div>
        <div class="workbench-model-card__actions">
          <label class="dreams__phase-toggle ${instance.enabled ? "dreams__phase-toggle--on" : ""}">
            <input
              type="checkbox"
              .checked=${instance.enabled}
              @change=${(event: Event) =>
                connectors.onToggleEnabled(instance.id, (event.target as HTMLInputElement).checked)}
            />
            <span class="dreams__phase-toggle-label">
              ${instance.enabled
                ? tLocale(locale, "Enabled", "已启用")
                : tLocale(locale, "Disabled", "已停用")}
            </span>
          </label>
          <button
            type="button"
            class="workbench-icon-button"
            aria-label="Edit connector"
            @click=${() => connectors.onSelectInstance(instance.id)}
          >
            ${icons.edit}
          </button>
          <button
            type="button"
            class="workbench-icon-button"
            aria-label="Delete connector"
            @click=${() => connectors.onDelete(instance.id)}
          >
            ${icons.x}
          </button>
        </div>
      </div>
      <div class="workbench-model-card__summary">
        <span>${instance.description || tLocale(locale, "No description", "暂无描述")}</span>
        <span>${instance.health.status}</span>
      </div>
    </section>
  `;
}

function renderConnectorEditor(
  connectors: WorkbenchProps["settingsView"]["connectors"],
  provider: ConnectorProviderDefinition,
  locale: string | undefined,
) {
  return html`
    <section class="workbench-model-card">
      <div class="workbench-model-card__header">
        <div class="workbench-model-card__title-group">
          <strong>${provider.displayName}</strong>
          <span>${provider.category}</span>
        </div>
      </div>
      <div class="workbench-model-card__form">
        ${renderConnectorMetaField(
          locale,
          tLocale(locale, "Name", "名称"),
          connectors.draft.displayName,
          (value) => connectors.onDraftChange("meta", "displayName", value),
        )}
        ${renderConnectorTextareaField(
          locale,
          tLocale(locale, "Description", "描述"),
          connectors.draft.description,
          (value) => connectors.onDraftChange("meta", "description", value),
        )}
        <label class="workbench-settings-field">
          <span>${tLocale(locale, "Enabled", "启用")}</span>
          <input
            type="checkbox"
            .checked=${connectors.draft.enabled}
            @change=${(event: Event) =>
              connectors.onDraftChange(
                "meta",
                "enabled",
                (event.target as HTMLInputElement).checked,
              )}
          />
        </label>
        <label class="workbench-settings-field">
          <span>${tLocale(locale, "Policy", "权限模式")}</span>
          <div class="workbench-settings-select">
            <select
              .value=${connectors.draft.policyMode}
              @change=${(event: Event) =>
                connectors.onDraftPolicyModeChange(
                  (event.target as HTMLSelectElement).value as
                    | "read-only"
                    | "limited-write"
                    | "full",
                )}
            >
              <option value="read-only">${tLocale(locale, "Read only", "只读")}</option>
              <option value="limited-write">${tLocale(locale, "Limited write", "受限写")}</option>
              <option value="full">${tLocale(locale, "Full", "全量")}</option>
            </select>
            <span class="workbench-settings-select__chevron">${icons.chevronDown}</span>
          </div>
        </label>

        ${provider.configFields.map((field) =>
          renderConnectorField(connectors, field, "config", locale),
        )}
        ${provider.secretFields.map((field) =>
          renderConnectorField(connectors, field, "secret", locale),
        )}

        <div class="workbench-model-card__summary">
          ${repeat(
            provider.actions,
            (action) => action.name,
            (action) => renderConnectorActionChip(action),
          )}
        </div>

        ${connectors.testResult
          ? html`<p class="skills-empty">${connectors.testResult}</p>`
          : nothing}

        <div class="dreaming-header-controls">
          <button
            type="button"
            class="btn btn--subtle btn--sm"
            ?disabled=${connectors.testing || connectors.saving}
            @click=${connectors.onTest}
          >
            ${connectors.testing
              ? tLocale(locale, "Testing", "测试中")
              : tLocale(locale, "Test Connection", "测试连接")}
          </button>
          <button
            type="button"
            class="btn btn--primary btn--sm"
            ?disabled=${connectors.saving}
            @click=${connectors.onSave}
          >
            ${connectors.saving
              ? tLocale(locale, "Saving", "保存中")
              : tLocale(locale, "Save", "保存")}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderConnectorField(
  connectors: WorkbenchProps["settingsView"]["connectors"],
  field: ConnectorFieldDefinition,
  section: "config" | "secret",
  locale: string | undefined,
) {
  const values = section === "config" ? connectors.draft.config : connectors.draft.secretInputs;
  const value = values[field.key] ?? "";
  if (field.kind === "boolean") {
    return html`
      <label class="workbench-settings-field">
        <span>${field.label}</span>
        <input
          type="checkbox"
          .checked=${value === "true"}
          @change=${(event: Event) =>
            connectors.onDraftChange(
              section,
              field.key,
              (event.target as HTMLInputElement).checked,
            )}
        />
      </label>
    `;
  }
  if (field.kind === "textarea") {
    return renderConnectorTextareaField(locale, field.label, value, (next) =>
      connectors.onDraftChange(section, field.key, next),
    );
  }
  return renderConnectorMetaField(locale, field.label, value, (next) =>
    connectors.onDraftChange(section, field.key, next),
  );
}

function renderConnectorMetaField(
  locale: string | undefined,
  label: string,
  value: string,
  onInput: (value: string) => void,
) {
  return html`
    <label class="workbench-settings-field">
      <span>${label}</span>
      <input
        .value=${value}
        @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function renderConnectorTextareaField(
  locale: string | undefined,
  label: string,
  value: string,
  onInput: (value: string) => void,
) {
  return html`
    <label class="workbench-settings-field">
      <span>${label}</span>
      <textarea
        rows="3"
        .value=${value}
        @input=${(event: Event) => onInput((event.target as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
  `;
}

function renderConnectorActionChip(action: ConnectorActionDefinition) {
  return html`
    <span class="skill-card__tag"
      >${action.displayName} · ${action.access} · ${action.riskLevel}</span
    >
  `;
}

function renderStatisticsPanel(props: WorkbenchProps) {
  const locale = props.settings.locale;
  const statistics = props.settingsView.statistics;
  const lastUpdated =
    statistics.updatedAt != null
      ? new Intl.DateTimeFormat(locale ?? undefined, {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(statistics.updatedAt))
      : null;
  const rangeOptions: Array<{ value: WorkbenchStatisticsRange; en: string; zh: string }> = [
    { value: 1, en: "Today", zh: "今天" },
    { value: 7, en: "Last 7 days", zh: "最近 7 天" },
    { value: 30, en: "Last 30 days", zh: "最近 30 天" },
  ];

  return html`
    <section class="workbench-settings-section workbench-settings-section--statistics">
      <div class="workbench-settings-section__header">
        <span>${tLocale(locale, "Time Range", "时间范围")}</span>
      </div>
      <div class="workbench-statistics-toolbar">
        <div class="workbench-statistics-range">
          ${rangeOptions.map(
            (option) => html`
              <button
                type="button"
                class="${statistics.selectedRangeDays === option.value ? "is-active" : ""}"
                @click=${() => statistics.onRangeChange(option.value)}
              >
                ${tLocale(locale, option.en, option.zh)}
              </button>
            `,
          )}
        </div>
        <button
          type="button"
          class="workbench-icon-button"
          ?disabled=${statistics.loading}
          @click=${statistics.onRefresh}
        >
          ${icons.refresh}
        </button>
      </div>
      ${lastUpdated
        ? html`
            <div class="workbench-statistics-meta">
              ${tLocale(locale, "Updated", "更新于")} ${lastUpdated}
            </div>
          `
        : nothing}
    </section>

    ${statistics.error
      ? html`
          <section class="workbench-settings-section workbench-settings-section--statistics">
            <div class="workbench-statistics-error">${statistics.error}</div>
          </section>
        `
      : nothing}

    <section class="workbench-settings-section workbench-settings-section--statistics">
      <div class="workbench-statistics-grid">
        ${renderStatisticsMetricCard(
          tLocale(locale, "Total Tokens", "总 token"),
          formatCompactStatNumber(statistics.totalTokens, locale),
          statistics.loading,
        )}
        ${renderStatisticsMetricCard(
          tLocale(locale, "Input", "输入"),
          formatCompactStatNumber(statistics.inputTokens, locale),
          statistics.loading,
        )}
        ${renderStatisticsMetricCard(
          tLocale(locale, "Output", "输出"),
          formatCompactStatNumber(statistics.outputTokens, locale),
          statistics.loading,
        )}
        ${renderStatisticsMetricCard(
          tLocale(locale, "Cache", "缓存"),
          formatCompactStatNumber(statistics.cacheTokens, locale),
          statistics.loading,
          tLocale(locale, "Read + Write", "命中 + 写入"),
        )}
        ${renderStatisticsMetricCard(
          tLocale(locale, "Sessions", "会话数"),
          formatCompactStatNumber(statistics.sessionCount, locale),
          statistics.loading,
        )}
      </div>
    </section>
  `;
}

function renderStatisticsMetricCard(label: string, value: string, loading: boolean, hint?: string) {
  return html`
    <article class="workbench-statistics-card">
      <div class="workbench-statistics-card__label">${label}</div>
      <div class="workbench-statistics-card__value">${loading ? "..." : value}</div>
      ${hint ? html`<div class="workbench-statistics-card__hint">${hint}</div>` : nothing}
    </article>
  `;
}

function formatCompactStatNumber(value: number, locale?: string): string {
  const abs = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000_000, suffix: "T" },
    { threshold: 1_000_000_000, suffix: "G" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ] as const;
  for (const unit of units) {
    if (abs < unit.threshold) {
      continue;
    }
    const normalized = value / unit.threshold;
    const decimals = Math.abs(normalized) >= 10 ? 0 : 1;
    const formatted = new Intl.NumberFormat(locale ?? undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    }).format(normalized);
    return `${formatted}${unit.suffix}`;
  }
  return new Intl.NumberFormat(locale ?? undefined, {
    maximumFractionDigits: 0,
  }).format(value);
}

function renderThemeCard(
  theme: "claw" | "knot" | "dash",
  label: string,
  sublabel: string,
  active: boolean,
  onClick: () => void,
) {
  return html`
    <button
      type="button"
      class="workbench-theme-card ${active ? "is-active" : ""}"
      data-theme=${theme}
      @click=${onClick}
    >
      <span class="workbench-theme-card__preview"></span>
      <span class="workbench-theme-card__label">${label}</span>
      <span class="workbench-theme-card__sub">${sublabel}</span>
    </button>
  `;
}

function renderAppearanceCard(
  mode: "light" | "dark" | "system",
  label: string,
  active: boolean,
  onClick: () => void,
) {
  return html`
    <button
      type="button"
      class="workbench-appearance-card ${active ? "is-active" : ""}"
      data-mode=${mode}
      @click=${onClick}
    >
      <span class="workbench-appearance-card__preview">
        <span></span>
        <span></span>
        <span></span>
      </span>
      <span class="workbench-appearance-card__label">${label}</span>
    </button>
  `;
}

function renderModelCard(
  props: WorkbenchProps,
  config: WorkbenchModelConfig,
  locale: string | undefined,
) {
  const expanded = props.settingsView.expandedModelConfigId === config.id;
  const configured = Boolean(
    config.name.trim() && config.baseUrl.trim() && config.model.trim() && config.apiKey.trim(),
  );
  const title = config.name.trim() || tLocale(locale, "Untitled model", "未命名模型");
  const badge = config.model.trim() || tLocale(locale, "Pending", "待配置");
  return html`
    <section class="workbench-model-card ${config.enabled ? "" : "is-disabled"}">
      <div class="workbench-model-card__summary">
        <label
          class="workbench-model-card__switch"
          aria-label=${tLocale(locale, "Enable model", "启用模型")}
        >
          <input
            type="checkbox"
            .checked=${config.enabled}
            @change=${(event: Event) =>
              props.settingsView.onToggleModelConfigEnabled(
                config.id,
                (event.target as HTMLInputElement).checked,
              )}
          />
          <span></span>
        </label>
        <button
          type="button"
          class="workbench-model-card__title"
          @click=${() => props.settingsView.onToggleModelConfigExpanded(config.id)}
        >
          <span class="workbench-model-card__name">${title}</span>
          <span class="workbench-model-card__badge">${badge}</span>
          ${!configured
            ? html`
                <span class="workbench-model-card__status"
                  >${tLocale(locale, "Pending", "待配置")}</span
                >
              `
            : nothing}
        </button>
        <div class="workbench-model-card__actions">
          <button
            type="button"
            class="workbench-model-card__delete"
            aria-label=${tLocale(locale, "Delete model", "删除模型")}
            @click=${() => props.settingsView.onRemoveModelConfig(config.id)}
          >
            ${icons.trash}
          </button>
          <button
            type="button"
            class="workbench-model-card__chevron ${expanded ? "is-expanded" : ""}"
            aria-label=${expanded
              ? tLocale(locale, "Collapse model", "收起模型")
              : tLocale(locale, "Expand model", "展开模型")}
            @click=${() => props.settingsView.onToggleModelConfigExpanded(config.id)}
          >
            ${icons.chevronDown}
          </button>
        </div>
      </div>
      ${expanded
        ? html`
            <div class="workbench-model-card__fields">
              ${renderModelInputRow(
                locale,
                icons.tag,
                "Model name",
                "模型名称",
                config.name,
                "例如: GPT-4o",
                "例如: GPT-4o",
                (value) => props.settingsView.onModelConfigChange(config.id, "name", value),
              )}
              ${renderModelInputRow(
                locale,
                icons.globe,
                "API URL",
                "API URL",
                config.baseUrl,
                "https://api.openai.com/v1",
                "https://api.openai.com/v1",
                (value) => props.settingsView.onModelConfigChange(config.id, "baseUrl", value),
              )}
              ${renderModelInputRow(
                locale,
                icons.zap,
                "Model ID",
                "Model ID",
                config.model,
                "gpt-4o",
                "gpt-4o",
                (value) => props.settingsView.onModelConfigChange(config.id, "model", value),
              )}
              ${renderModelInputRow(
                locale,
                icons.keyRound,
                "API Key",
                "API Key",
                config.apiKey,
                "sk-...",
                "sk-...",
                (value) => props.settingsView.onModelConfigChange(config.id, "apiKey", value),
                "password",
              )}
            </div>
          `
        : nothing}
    </section>
  `;
}

function renderModelInputRow(
  locale: string | undefined,
  icon: unknown,
  labelEn: string,
  labelZh: string,
  value: string,
  placeholderEn: string,
  placeholderZh: string,
  onInput: (value: string) => void,
  type = "text",
) {
  return html`
    <label class="workbench-model-row">
      <span class="workbench-model-row__field">
        <span class="workbench-model-row__icon">${icon}</span>
        ${tLocale(locale, labelEn, labelZh)}
      </span>
      <input
        type=${type}
        .value=${value}
        placeholder=${tLocale(locale, placeholderEn, placeholderZh)}
        @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function resolveProjects(props: WorkbenchProps): WorkbenchProject[] {
  const locale = props.settings.locale;
  const agents = props.agentsList?.agents ?? [];
  const sessionsByAgent = new Map<string, WorkbenchSession[]>();
  for (const row of props.sessionsResult?.sessions ?? []) {
    const parsed = parseAgentSessionKey(row.key);
    if (!parsed?.agentId) {
      continue;
    }
    const list = sessionsByAgent.get(parsed.agentId) ?? [];
    const fallbackLabel = shortSessionLabel(row.key);
    const resolvedLabel =
      [row.label?.trim(), row.displayName?.trim(), row.subject?.trim()].find((value) =>
        Boolean(
          value && !isGeneratedUntitledSessionLabel(value) && !isSystemGeneratedSessionLabel(value),
        ),
      ) ||
      fallbackLabel ||
      formatUntitledSessionLabel(row.updatedAt ?? null, locale);
    list.push({
      key: row.key,
      label: resolvedLabel,
      title: resolvedLabel,
      updatedAt: row.updatedAt ?? null,
      tokens: row.totalTokens ?? 0,
    });
    sessionsByAgent.set(parsed.agentId, list);
  }

  const priorityOrder = new Map(
    props.priorityProjectIds.map((projectId, index) => [projectId, index] as const),
  );

  return agents
    .map((agent) => {
      const identity = props.agentIdentityById[agent.id];
      const sessions = (sessionsByAgent.get(agent.id) ?? []).toSorted(
        (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      );
      const updatedAt = sessions[0]?.updatedAt ?? null;
      const workspace =
        props.projectFilesAgentId === agent.id
          ? props.projectFilesWorkspace
          : props.agentFilesList?.agentId === agent.id
            ? props.agentFilesList.workspace
            : null;
      return {
        id: agent.id,
        label: normalizeAgentLabel(agent),
        owner: identity?.name?.trim() || "Workspace team",
        avatarUrl: resolveAgentAvatarUrl(agent, identity),
        workspace,
        updatedAt,
        sessions,
      };
    })
    .toSorted((left, right) => {
      const leftPriority = priorityOrder.get(left.id);
      const rightPriority = priorityOrder.get(right.id);
      if (leftPriority != null || rightPriority != null) {
        if (leftPriority == null) {
          return 1;
        }
        if (rightPriority == null) {
          return -1;
        }
        return leftPriority - rightPriority;
      }
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
}

function shortSessionLabel(sessionKey: string) {
  const parsed = parseAgentSessionKey(sessionKey);
  const last = parsed?.rest?.split(":").findLast(Boolean);
  const candidate = (last || sessionKey).trim();
  if (!candidate) {
    return "";
  }
  if (looksLikeOpaqueSessionId(candidate) || isGeneratedUntitledSessionLabel(candidate)) {
    return "";
  }
  return candidate;
}

function formatUntitledSessionLabel(updatedAt: number | null, locale?: string) {
  const base = tLocale(locale, "New conversation", "新会话");
  if (!updatedAt) {
    return base;
  }
  try {
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(updatedAt);
    return `${base} · ${time}`;
  } catch {
    return base;
  }
}

function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(timestamp);
  } catch {
    return "";
  }
}
