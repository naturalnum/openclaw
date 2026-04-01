import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseAgentSessionKey } from "../../../src/routing/session-key.ts";
import { icons } from "../../../ui/src/ui/icons.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
  SessionsListResult,
  ToolsCatalogResult,
} from "../../../ui/src/ui/types.ts";
import {
  normalizeAgentLabel,
  resolveAgentAvatarUrl,
  resolveToolSections,
  type AgentToolEntry,
} from "../../../ui/src/ui/views/agents-utils.ts";
import { renderCron, type CronProps } from "../../../ui/src/ui/views/cron.ts";
import { renderSkills, type SkillsProps } from "../../../ui/src/ui/views/skills.ts";
import type { WorkbenchFileEntry } from "../adapters/workbench-adapter.ts";
import { renderPowerChatThread } from "../integrations/openclaw/chat/thread.ts";

export type WorkbenchSection = "newTask" | "automations" | "skills";
export type WorkbenchToolsCategory = "builtIn" | "mcp" | "connectors";
export type WorkbenchSettingsTab = "general" | "models";

export type WorkbenchModelConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

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

export type WorkbenchProps = {
  basePath: string;
  assistantName: string;
  currentProjectId: string | null;
  currentSessionKey: string;
  currentModelId: string;
  newTaskProjectId: string | null;
  newTaskProjectMenuOpen: boolean;
  sidebarCollapsed: boolean;
  projectsCollapsed: boolean;
  rightRailCollapsed: boolean;
  expandedProjectIds: string[];
  priorityProjectIds: string[];
  agentsList: AgentsListResult | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentFilesList: AgentsFilesListResult | null;
  projectFilesLoading: boolean;
  projectFilesError: string | null;
  projectFilesAgentId: string | null;
  projectFilesWorkspace: string | null;
  projectFilesEntries: WorkbenchFileEntry[];
  sessionsResult: SessionsListResult | null;
  chatMessages: unknown[];
  chatMessage: string;
  chatSending: boolean;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  lastError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  skillsPage: SkillsProps;
  automationsPage: CronProps;
  modelCatalog: ModelCatalogEntry[];
  modelsLoading: boolean;
  themeResolved: string;
  settings: {
    gatewayUrl: string;
    theme: string;
    themeMode: string;
    locale?: string;
  };
  settingsView: {
    localeOptions: Array<{ value: string; label: string }>;
    modelConfigs: WorkbenchModelConfig[];
    onLocaleChange: (value: string) => void;
    onThemeChange: (value: string) => void;
    onThemeModeChange: (value: string) => void;
    onModelConfigChange: (
      id: string,
      field: "name" | "baseUrl" | "apiKey" | "model",
      value: string,
    ) => void;
    onAddModelConfig: () => void;
    onRemoveModelConfig: (id: string) => void;
  };
  section: WorkbenchSection;
  toolsOpen: boolean;
  toolsClosing: boolean;
  toolQuery: string;
  toolsCategory: WorkbenchToolsCategory;
  settingsOpen: boolean;
  settingsClosing: boolean;
  settingsTab: WorkbenchSettingsTab;
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
  fileManagerOpen: boolean;
  fileManagerLoading: boolean;
  fileManagerError: string | null;
  fileManagerAgentId: string | null;
  fileManagerWorkspace: string | null;
  fileManagerCurrentPath: string | null;
  fileManagerCurrentName: string | null;
  fileManagerParentPath: string | null;
  fileManagerEntries: WorkbenchFileEntry[];
  fileManagerBackCount: number;
  fileManagerForwardCount: number;
  fileManagerBusyPath: string | null;
  fileManagerCreateFolderOpen: boolean;
  fileManagerNewFolderName: string;
  onNavigateLegacy: () => void;
  onSectionChange: (section: WorkbenchSection) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionKey: string) => void;
  onSelectNewTaskProject: (projectId: string) => void;
  onToggleNewTaskProjectMenu: () => void;
  onStartTask: (projectId: string) => void;
  onOpenAttachment: () => void;
  onComposerChange: (value: string) => void;
  onComposerKeyDown: (event: KeyboardEvent) => void;
  onChatScroll: (event: Event) => void;
  onSend: () => void;
  onAbort: () => void;
  onOpenTools: () => void;
  onCloseTools: () => void;
  onToolQueryChange: (value: string) => void;
  onToolsCategoryChange: (value: WorkbenchToolsCategory) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSettingsTabChange: (value: WorkbenchSettingsTab) => void;
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
  onOpenFileManager: (agentId: string, path: string | null) => void;
  onOpenFileManagerForCreateFolder: (agentId: string, path: string | null) => void;
  onCloseFileManager: () => void;
  onNavigateFileManager: (path: string | null) => void;
  onNavigateFileManagerBack: () => void;
  onNavigateFileManagerForward: () => void;
  onRefreshFileManager: () => void;
  onOpenProjectFilePicker: (agentId: string, path: string | null) => void;
  onDownloadProjectFile: (agentId: string, path: string) => void;
  onDeleteProjectEntry: (agentId: string, path: string) => void;
  onToggleCreateFolder: () => void;
  onFileManagerFolderNameChange: (value: string) => void;
  onCreateFileManagerFolder: () => void;
  onToggleSidebar: () => void;
  onToggleProjects: () => void;
  onToggleRightRail: () => void;
  onToggleProject: (projectId: string) => void;
  onRefreshContext: () => void;
};

function isZhLocale(locale?: string): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh");
}

function tLocale(locale: string | undefined, en: string, zh: string): string {
  return isZhLocale(locale) ? zh : en;
}

function dialogStateClass(isOpen: boolean, isClosing: boolean): string {
  return isClosing && !isOpen ? "is-closing" : isOpen ? "is-open" : "";
}

export function renderWorkbench(props: WorkbenchProps) {
  const locale = props.settings.locale;
  const projects = resolveProjects(props);
  const currentProject =
    projects.find((project) => project.id === (props.newTaskProjectId ?? props.currentProjectId)) ??
    projects[0] ??
    null;
  const activeSession =
    projects
      .flatMap((project) => project.sessions)
      .find((session) => session.key === props.currentSessionKey) ?? null;
  const activeProject =
    (activeSession
      ? (projects.find((project) =>
          project.sessions.some((session) => session.key === activeSession.key),
        ) ?? null)
      : null) ?? currentProject;
  const showContextBar =
    props.section === "newTask" && Boolean(activeProject) && Boolean(activeSession);
  const showRightRail = showContextBar && !props.rightRailCollapsed;

  return html`
    <div
      class="workbench ${props.themeResolved.includes("light") ? "workbench--light" : ""} ${
        props.sidebarCollapsed ? "workbench--sidebar-collapsed" : ""
      }"
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
              <span class="workbench-brand__collapsed-state workbench-brand__collapsed-state--logo">
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
            props.section === "newTask",
            props.sidebarCollapsed,
            () => props.onSectionChange("newTask"),
          )}
          ${renderNavButton(
            "automations",
            tLocale(locale, "Automations", "自动化"),
            icons.loader,
            props.section === "automations",
            props.sidebarCollapsed,
            () => props.onSectionChange("automations"),
          )}
          ${renderNavButton(
            "skills",
            tLocale(locale, "Skills", "技能"),
            icons.puzzle,
            props.section === "skills",
            props.sidebarCollapsed,
            () => props.onSectionChange("skills"),
          )}
        </nav>

        ${
          props.sidebarCollapsed
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
                  ${
                    props.projectsCollapsed
                      ? nothing
                      : html`
                        <div class="workbench-project-tree">
                          ${repeat(
                            projects,
                            (project) => project.id,
                            (project) => renderProjectTreeRow(project, props),
                          )}
                        </div>
                      `
                  }
                </div>
              </section>
            `
        }

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
              ${tLocale(locale, "Settings", "设置")}
            </span>
          </button>
        </div>
      </aside>

      <div class="workbench-main">
        ${
          showContextBar && activeProject && activeSession
            ? renderContextBar(props, activeProject, activeSession)
            : nothing
        }
        <div
          class="workbench-content ${showRightRail ? "workbench-content--rail" : ""} ${
            props.section === "newTask" && !showRightRail
              ? "workbench-content--session-centered"
              : ""
          }"
        >
          <section class="workbench-center">
            ${
              props.section === "skills"
                ? renderSkillsPage(props)
                : props.section === "automations"
                  ? renderAutomationsPage(props, activeProject)
                  : activeSession
                    ? renderSessionView(props, activeProject, activeSession)
                    : renderNewTaskView(props, currentProject, projects)
            }
          </section>

          ${
            showRightRail && activeProject && activeSession
              ? renderRightRail(props, activeProject)
              : nothing
          }
        </div>
      </div>
      ${props.toolsOpen || props.toolsClosing ? renderToolsDialog(props) : nothing}
      ${props.settingsOpen || props.settingsClosing ? renderSettingsDialog(props) : nothing}
      ${
        props.projectDirectoryOpen || props.projectDirectoryClosing
          ? renderProjectDirectoryDialog(props)
          : nothing
      }
      ${props.fileManagerOpen ? renderFileManagerDialog(props) : nothing}
    </div>
  `;
}

function renderContextBar(
  props: WorkbenchProps,
  project: WorkbenchProject,
  session: WorkbenchSession,
) {
  return html`
    <header class="workbench-context-bar">
      <div class="workbench-context-bar__identity">
        <strong>${session.label}</strong>
        <span>${project.label}</span>
      </div>
      <button
        type="button"
        class="workbench-icon-button workbench-context-bar__toggle ${
          props.rightRailCollapsed ? "is-collapsed" : ""
        }"
        title=${props.rightRailCollapsed ? "展开卡片区" : "折叠卡片区"}
        aria-label=${props.rightRailCollapsed ? "展开卡片区" : "折叠卡片区"}
        @click=${props.onToggleRightRail}
      >
        ${props.rightRailCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}
      </button>
    </header>
  `;
}

function renderNewTaskView(
  props: WorkbenchProps,
  currentProject: WorkbenchProject | null,
  projects: WorkbenchProject[],
) {
  const locale = props.settings.locale;
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
                <span>${currentProject?.label ?? tLocale(locale, "Select project", "选择项目")}</span>
                <span class="workbench-new-thread__project-chevron">
                  ${props.newTaskProjectMenuOpen ? icons.chevronUp : icons.chevronDown}
                </span>
              </button>

              ${
                props.newTaskProjectMenuOpen
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
                            class="workbench-new-thread__project-item ${
                              currentProject?.id === project.id ? "is-active" : ""
                            }"
                            @click=${() => props.onSelectNewTaskProject(project.id)}
                          >
                            <span class="workbench-new-thread__project-item-icon">${icons.folder}</span>
                            <span>${project.label}</span>
                            ${
                              currentProject?.id === project.id
                                ? html`<span class="workbench-new-thread__project-item-check">${icons.check}</span>`
                                : nothing
                            }
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
                  : nothing
              }
            </div>
          </div>
        </div>

        <div class="workbench-chat-composer workbench-chat-composer--floating">
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
                    (model) => model.id,
                    (model) => html`<option value=${model.id}>${model.id}</option>`,
                  )}
                </select>
                <span class="workbench-model-select__chevron">${icons.chevronDown}</span>
              </label>
              <button
                type="button"
                class="workbench-circle-button"
                title="Open tools"
                aria-label="Open tools"
                @click=${props.onOpenTools}
              >
                ${icons.wrench}
              </button>
            </div>
            <button
              type="button"
              class="workbench-send-button"
              title="Send"
              aria-label="Send"
              ?disabled=${props.chatSending || !props.chatMessage.trim() || !currentProject}
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
                ${
                  selectedPath ??
                  props.projectDirectoryRoots[0]?.path ??
                  tLocale(locale, "Allowed roots", "允许访问的根目录")
                }
              </span>
            </div>
          </div>

          ${
            props.projectDirectoryError
              ? html`
                  <div class="workbench-directory-section workbench-directory-section--error">
                    <div class="workbench-callout workbench-callout--danger">
                      ${props.projectDirectoryError}
                    </div>
                  </div>
                `
              : nothing
          }

          <div class="workbench-directory-section workbench-directory-section--tree">
            <div class="workbench-directory-browser">
            ${
              props.projectDirectoryLoading
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
                              class="workbench-directory-entry ${entry.selected ? "is-selected" : ""}"
                              style=${`--tree-depth: ${entry.depth};`}
                            >
                              <button
                                type="button"
                                class="workbench-directory-entry__main"
                                @click=${() => props.onBrowseProjectDirectory(entry.path)}
                              >
                                ${
                                  entry.hasToggle
                                    ? html`
                                        <span class="workbench-directory-entry__toggle-icon">
                                          ${entry.expanded ? icons.chevronDown : icons.chevronRight}
                                        </span>
                                      `
                                    : html`
                                        <span class="workbench-directory-entry__toggle-spacer"></span>
                                      `
                                }
                                <span class="workbench-directory-entry__icon">
                                  ${entry.expanded ? icons.folderOpen : icons.folder}
                                </span>
                                <span class="workbench-directory-entry__name">${entry.name}</span>
                                ${
                                  entry.loading
                                    ? html`
                                        <span class="workbench-directory-entry__loading"
                                          >${tLocale(locale, "Loading…", "加载中…")}</span
                                        >
                                      `
                                    : nothing
                                }
                              </button>
                            </div>
                          `,
                        )}
                      </div>
                    `
            }
          </div>
          </div>

          ${
            props.projectDirectoryCreateFolderOpen
              ? html`
                  <div class="workbench-directory-section workbench-directory-section--create">
                    <div class="workbench-directory-create">
                      <span class="workbench-directory-create__icon">${icons.folderPlus}</span>
                      <input
                        class="workbench-directory-create__input"
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
              : nothing
          }

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

function buildFileManagerBreadcrumbs(props: WorkbenchProps) {
  const workspace = props.fileManagerWorkspace?.trim() || "";
  const currentPath = props.fileManagerCurrentPath?.trim() || "";
  if (!workspace || !currentPath || !currentPath.startsWith(workspace)) {
    return [];
  }
  const relative = currentPath.slice(workspace.length).replace(/^\/+/, "");
  if (!relative) {
    return [{ label: props.fileManagerCurrentName || "Workspace", path: workspace }];
  }
  const segments = relative.split("/").filter(Boolean);
  const breadcrumbs: Array<{ label: string; path: string }> = [
    {
      label:
        props.fileManagerCurrentName && segments.length === 0
          ? props.fileManagerCurrentName
          : "Workspace",
      path: workspace,
    },
  ];
  let cursor = workspace;
  for (const segment of segments) {
    cursor = `${cursor}/${segment}`.replace(/\/+/g, "/");
    breadcrumbs.push({ label: segment, path: cursor });
  }
  return breadcrumbs;
}

function renderFileManagerDialog(props: WorkbenchProps) {
  const breadcrumbs = buildFileManagerBreadcrumbs(props);
  const currentPath = props.fileManagerCurrentPath;
  return html`
    <div class="workbench-overlay">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseFileManager}></div>
      <div class="workbench-dialog workbench-dialog--files">
        <div class="workbench-dialog__topbar">
          <div>
            <h3>File Manager</h3>
            <p>Browse the current project workspace, upload files, create folders, and manage assets.</p>
          </div>
          <button type="button" class="workbench-icon-button" @click=${props.onCloseFileManager}>
            ${icons.x}
          </button>
        </div>

        <div class="workbench-dialog__body">
          <div class="workbench-file-toolbar">
            <div class="workbench-file-toolbar__nav">
              <button
                type="button"
                class="workbench-secondary-button workbench-file-toolbar__button"
                title="返回"
                aria-label="返回"
                ?disabled=${props.fileManagerLoading || props.fileManagerBackCount === 0}
                @click=${props.onNavigateFileManagerBack}
              >
                返回
              </button>
              <button
                type="button"
                class="workbench-secondary-button workbench-file-toolbar__button"
                ?disabled=${props.fileManagerLoading || !props.fileManagerParentPath}
                @click=${() => props.onNavigateFileManager(props.fileManagerParentPath)}
              >
                向上
              </button>
            </div>

            <div class="workbench-file-breadcrumbs">
              ${repeat(
                breadcrumbs,
                (item) => item.path,
                (item, index) => html`
                  <button
                    type="button"
                    class="workbench-file-breadcrumb ${index === breadcrumbs.length - 1 ? "is-active" : ""}"
                    ?disabled=${index === breadcrumbs.length - 1}
                    @click=${() => props.onNavigateFileManager(item.path)}
                  >
                    ${item.label}
                  </button>
                `,
              )}
            </div>

            <div class="workbench-file-toolbar__actions">
              <button
                type="button"
                class="workbench-secondary-button"
                ?disabled=${props.fileManagerLoading || !props.fileManagerAgentId}
                @click=${() =>
                  props.fileManagerAgentId &&
                  props.onOpenProjectFilePicker(props.fileManagerAgentId, currentPath)}
              >
                ${icons.plus}
                Upload
              </button>
              <button
                type="button"
                class="workbench-secondary-button"
                ?disabled=${props.fileManagerLoading || !props.fileManagerAgentId}
                @click=${props.onToggleCreateFolder}
              >
                ${icons.folder}
                New Folder
              </button>
              <button
                type="button"
                class="workbench-secondary-button"
                ?disabled=${props.fileManagerLoading || !props.fileManagerAgentId}
                @click=${props.onRefreshFileManager}
              >
                Refresh
              </button>
            </div>
          </div>

          ${
            props.fileManagerCreateFolderOpen
              ? html`
                  <div class="workbench-file-create">
                    <input
                      type="text"
                      .value=${props.fileManagerNewFolderName}
                      placeholder="Folder name"
                      @input=${(event: Event) =>
                        props.onFileManagerFolderNameChange(
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                    <button
                      type="button"
                      class="workbench-primary-button"
                      ?disabled=${props.fileManagerLoading || !props.fileManagerNewFolderName.trim()}
                      @click=${props.onCreateFileManagerFolder}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      class="workbench-secondary-button"
                      ?disabled=${props.fileManagerLoading}
                      @click=${props.onToggleCreateFolder}
                    >
                      Cancel
                    </button>
                  </div>
                `
              : nothing
          }

          ${
            props.fileManagerError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.fileManagerError}</div>`
              : nothing
          }

          ${
            props.fileManagerLoading
              ? html`
                  <div class="workbench-empty workbench-empty--small">Loading files…</div>
                `
              : props.fileManagerEntries.length === 0
                ? html`
                    <div class="workbench-empty workbench-empty--small">This folder is empty.</div>
                  `
                : html`
                    <div class="workbench-file-list">
                      ${repeat(
                        props.fileManagerEntries,
                        (entry) => entry.path,
                        (entry) => html`
                          <div class="workbench-file-row">
                            <button
                              type="button"
                              class="workbench-file-row__main ${entry.kind === "directory" ? "is-directory" : ""}"
                              @click=${() =>
                                entry.kind === "directory"
                                  ? props.onNavigateFileManager(entry.path)
                                  : props.onDownloadProjectFile(
                                      props.fileManagerAgentId ?? "",
                                      entry.path,
                                    )}
                            >
                              <span class="workbench-file-row__icon">
                                ${entry.kind === "directory" ? icons.folder : icons.fileText}
                              </span>
                              <span class="workbench-file-row__name">${entry.name}</span>
                              <span class="workbench-file-row__meta">
                                ${
                                  entry.kind === "directory"
                                    ? "Folder"
                                    : `${formatBytes(entry.size ?? 0)}${entry.updatedAtMs ? ` · ${formatTimestamp(entry.updatedAtMs)}` : ""}`
                                }
                              </span>
                            </button>
                            <div class="workbench-file-row__actions">
                              ${
                                entry.kind === "file"
                                  ? html`
                                      <button
                                        type="button"
                                        class="workbench-icon-button"
                                        title="Download file"
                                        aria-label="Download file"
                                        ?disabled=${props.fileManagerBusyPath === entry.path}
                                        @click=${() =>
                                          props.fileManagerAgentId &&
                                          props.onDownloadProjectFile(
                                            props.fileManagerAgentId,
                                            entry.path,
                                          )}
                                      >
                                        ${icons.download}
                                      </button>
                                    `
                                  : nothing
                              }
                              <button
                                type="button"
                                class="workbench-icon-button"
                                title="Delete item"
                                aria-label="Delete item"
                                ?disabled=${props.fileManagerBusyPath === entry.path}
                                @click=${() =>
                                  props.fileManagerAgentId &&
                                  props.onDeleteProjectEntry(props.fileManagerAgentId, entry.path)}
                              >
                                ${icons.trash}
                              </button>
                            </div>
                          </div>
                        `,
                      )}
                    </div>
                  `
          }
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
  const selected = props.currentProjectId === project.id;
  const expanded = props.expandedProjectIds.includes(project.id);
  return html`
    <div class="workbench-tree-node ${selected ? "is-active" : ""}">
      <div class="workbench-tree-node__row">
        <button
          type="button"
          class="workbench-tree-node__icon-toggle"
          title=${expanded ? "Collapse project" : "Expand project"}
          aria-label=${expanded ? "Collapse project" : "Expand project"}
          @click=${() => props.onToggleProject(project.id)}
        >
          <span class="workbench-tree-node__icon-state workbench-tree-node__icon-state--folder">
            ${icons.folder}
          </span>
          <span class="workbench-tree-node__icon-state workbench-tree-node__icon-state--chevron">
            ${expanded ? icons.chevronDown : icons.chevronRight}
          </span>
        </button>
        <button
          type="button"
          class="workbench-tree-node__main"
          title=${expanded ? "Collapse project sessions" : "Expand project sessions"}
          aria-label=${expanded ? "Collapse project sessions" : "Expand project sessions"}
          @click=${() => props.onToggleProject(project.id)}
        >
          <span class="workbench-tree-node__label">${project.label}</span>
        </button>
        <button type="button" class="workbench-tree-node__more">${icons.moreHorizontal}</button>
      </div>

      ${html`
          <div class="workbench-tree-node__children ${expanded ? "is-expanded" : ""}">
            <div class="workbench-tree-node__children-inner">
              ${
                !expanded
                  ? nothing
                  : project.sessions.length === 0
                    ? html`
                        <div class="workbench-empty workbench-empty--tiny">No sessions yet.</div>
                      `
                    : repeat(
                        project.sessions.slice(0, 6),
                        (session) => session.key,
                        (session) => html`
                          <button
                            type="button"
                            class="workbench-tree-session ${
                              props.currentSessionKey === session.key ? "is-active" : ""
                            }"
                            @click=${() => props.onSelectSession(session.key)}
                          >
                            <span class="workbench-tree-session__icon">${icons.messageSquare}</span>
                            <span class="workbench-tree-session__label">${session.label}</span>
                          </button>
                        `,
                      )
              }
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
  return html`
    <section class="workbench-session-shell ${props.rightRailCollapsed ? "workbench-session-shell--centered" : ""}">
      <section class="workbench-chat-surface">
        ${renderPowerChatThread({
          messages: props.chatMessages,
          toolMessages: props.chatToolMessages,
          streamSegments: props.chatStreamSegments,
          stream: props.chatStream,
          streamStartedAt: props.chatStreamStartedAt,
          sessionKey: props.currentSessionKey,
          assistantName: props.assistantName,
          assistantAvatar,
          basePath: props.basePath,
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
          <textarea
            class="workbench-composer workbench-composer--session"
            .value=${props.chatMessage}
            placeholder="Reply in this session..."
            @input=${(event: Event) =>
              props.onComposerChange((event.target as HTMLTextAreaElement).value)}
            @keydown=${props.onComposerKeyDown}
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
                    (model) => model.id,
                    (model) => html`<option value=${model.id}>${model.id}</option>`,
                  )}
                </select>
                <span class="workbench-model-select__chevron">${icons.chevronDown}</span>
              </label>
              <button
                type="button"
                class="workbench-circle-button"
                title="Open tools"
                aria-label="Open tools"
                @click=${props.onOpenTools}
              >
                ${icons.wrench}
              </button>
            </div>
            ${
              props.chatRunId
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
                    ?disabled=${props.chatSending || !props.chatMessage.trim()}
                    @click=${props.onSend}
                  >
                    ${icons.arrowUp}
                  </button>
                `
            }
          </div>
        </div>
      </section>
    </section>
  `;
}

function renderAutomationsPage(props: WorkbenchProps, _currentProject: WorkbenchProject | null) {
  return html`
    <section class="workbench-page-shell workbench-page-shell--scroll">
      <div class="workbench-page-shell__body">${renderCron(props.automationsPage)}</div>
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

function renderRightRail(props: WorkbenchProps, project: WorkbenchProject) {
  const entries = props.projectFilesAgentId === project.id ? props.projectFilesEntries : [];
  const workspacePath =
    props.projectFilesAgentId === project.id ? props.projectFilesWorkspace : project.workspace;

  return html`
    <aside class="workbench-rail">
      <section class="workbench-sidecard">
        <div class="workbench-sidecard__header">
          <h4>Project files</h4>
          <div class="workbench-sidecard__actions">
            <button
              type="button"
              class="workbench-icon-button"
              title="Create folder"
              aria-label="Create folder"
              ?disabled=${!workspacePath}
              @click=${() =>
                workspacePath && props.onOpenFileManagerForCreateFolder(project.id, workspacePath)}
            >
              ${icons.folder}
            </button>
            <button
              type="button"
              class="workbench-icon-button"
              title="Upload files"
              aria-label="Upload files"
              ?disabled=${!workspacePath}
              @click=${() => workspacePath && props.onOpenProjectFilePicker(project.id, workspacePath)}
            >
              ${icons.plus}
            </button>
            <button
              type="button"
              class="workbench-icon-button"
              title="Open file manager"
              aria-label="Open file manager"
              ?disabled=${!workspacePath}
              @click=${() => props.onOpenFileManager(project.id, workspacePath)}
            >
              ${icons.externalLink}
            </button>
          </div>
        </div>
        <div class="workbench-sidecard__body workbench-sidecard__body--scroll">
          ${
            props.projectFilesError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.projectFilesError}</div>`
              : nothing
          }
          ${
            props.projectFilesLoading
              ? html`
                  <div class="workbench-skeleton">Loading files…</div>
                `
              : entries.length === 0
                ? html`
                    <div class="workbench-empty workbench-empty--tiny">
                      No files yet. Upload from the plus button or open the manager to create folders.
                    </div>
                  `
                : repeat(
                    entries,
                    (entry) => entry.path,
                    (entry) => html`
                      <div class="workbench-mini-row workbench-mini-row--file">
                        <span class="workbench-mini-row__icon">
                          ${entry.kind === "directory" ? icons.folder : icons.fileText}
                        </span>
                        <button
                          type="button"
                          class="workbench-mini-row__content ${entry.kind === "directory" ? "is-directory" : ""}"
                          @dblclick=${() =>
                            entry.kind === "directory" &&
                            props.onOpenFileManager(project.id, entry.path)}
                        >
                          <span class="workbench-mini-row__name">${entry.name}</span>
                          <div class="workbench-mini-row__meta">
                            ${entry.kind === "directory" ? "Folder" : formatBytes(entry.size ?? 0)}
                          </div>
                        </button>
                        <div class="workbench-mini-row__actions">
                          ${
                            entry.kind === "file"
                              ? html`
                                  <button
                                    type="button"
                                    class="workbench-icon-button"
                                    title="Download file"
                                    aria-label="Download file"
                                    @click=${() => props.onDownloadProjectFile(project.id, entry.path)}
                                  >
                                    ${icons.download}
                                  </button>
                                `
                              : nothing
                          }
                          <button
                            type="button"
                            class="workbench-icon-button"
                            title=${entry.kind === "directory" ? "Delete folder" : "Delete file"}
                            aria-label=${entry.kind === "directory" ? "Delete folder" : "Delete file"}
                            @click=${() => props.onDeleteProjectEntry(project.id, entry.path)}
                          >
                            ${icons.trash}
                          </button>
                        </div>
                      </div>
                    `,
                  )
          }
        </div>
      </section>
    </aside>
  `;
}

function renderToolsDialog(props: WorkbenchProps) {
  const sections = resolveToolSections(props.toolsCatalogResult);
  const filteredTools = filterToolEntries(sections, props.toolQuery, props.toolsCategory);
  const featuredTools = filteredTools.slice(0, 4);
  const catalogTools = filteredTools.slice(4);
  const locale = props.settings.locale;
  const stateClass = dialogStateClass(props.toolsOpen, props.toolsClosing);
  return html`
    <div class="workbench-overlay ${stateClass}">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseTools}></div>
      <div class="workbench-dialog workbench-dialog--tools ${stateClass}">
        <div class="workbench-dialog__topbar">
          <div>
            <h3>${tLocale(locale, "Tools", "工具")}</h3>
            <p>
              ${tLocale(
                locale,
                "Configure the runtime catalog your current project can access.",
                "配置当前项目可访问的运行时工具目录。",
              )}
            </p>
          </div>
          <button type="button" class="workbench-icon-button" @click=${props.onCloseTools}>
            ${icons.x}
          </button>
        </div>

        <div class="workbench-dialog__tabs">
          ${renderTabChip(
            "builtIn",
            tLocale(locale, "Built-in", "内置"),
            props.toolsCategory,
            props.onToolsCategoryChange,
          )}
          ${renderTabChip("mcp", "MCP", props.toolsCategory, props.onToolsCategoryChange)}
          ${renderTabChip(
            "connectors",
            tLocale(locale, "Connectors", "连接器"),
            props.toolsCategory,
            props.onToolsCategoryChange,
          )}
          <label class="workbench-search-field">
            ${icons.search}
            <input
              .value=${props.toolQuery}
              placeholder=${tLocale(locale, "Search tools", "搜索工具")}
              @input=${(event: Event) =>
                props.onToolQueryChange((event.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="workbench-dialog__body">
          ${
            props.toolsCatalogError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.toolsCatalogError}</div>`
              : nothing
          }
          ${
            filteredTools.length === 0
              ? html`
                  <div class="workbench-empty workbench-empty--small">
                    ${tLocale(locale, "No tools in this category.", "这个分类下没有工具。")}
                  </div>
                `
              : html`
                <section class="workbench-tool-section">
                  <div class="workbench-tool-section__header">
                    <div>
                      <h4>${tLocale(locale, "Recommended", "推荐")}</h4>
                      <p>
                        ${tLocale(
                          locale,
                          "High-signal tools surfaced first for project setup.",
                          "优先展示更适合当前项目初始化的高价值工具。",
                        )}
                      </p>
                    </div>
                  </div>
                  <div class="workbench-grid workbench-grid--tools">
                    ${repeat(
                      featuredTools,
                      (tool) => `${tool.sectionId}:${tool.tool.id}`,
                      ({ tool, sectionLabel, source }) =>
                        renderToolCard(tool, sectionLabel, source),
                    )}
                  </div>
                </section>

                ${
                  catalogTools.length > 0
                    ? html`
                      <section class="workbench-tool-section">
                        <div class="workbench-tool-section__header">
                          <div>
                            <h4>${tLocale(locale, "Catalog", "目录")}</h4>
                            <p>
                              ${tLocale(
                                locale,
                                "The rest of the runtime-accessible tools for this category.",
                                "当前分类下其余可用的运行时工具。",
                              )}
                            </p>
                          </div>
                        </div>
                        <div class="workbench-grid workbench-grid--tools">
                          ${repeat(
                            catalogTools,
                            (tool) => `${tool.sectionId}:${tool.tool.id}`,
                            ({ tool, sectionLabel, source }) =>
                              renderToolCard(tool, sectionLabel, source),
                          )}
                        </div>
                      </section>
                    `
                    : nothing
                }
              `
          }
        </div>
      </div>
    </div>
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
              class="${props.settingsTab === "models" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("models")}
            >
              <span class="workbench-settings-nav__icon">${icons.spark}</span>
              ${tLocale(locale, "Models", "模型")}
            </button>
          </aside>

          <section class="workbench-settings-panel">
            <div class="workbench-settings-panel__header">
              <div>
                <h4>
                  ${
                    props.settingsTab === "general"
                      ? tLocale(locale, "General", "通用")
                      : tLocale(locale, "Model Settings", "模型设置")
                  }
                </h4>
                <p>
                  ${
                    props.settingsTab === "general"
                      ? tLocale(
                          locale,
                          "Control language and interface appearance.",
                          "控制语言和界面外观。",
                        )
                      : tLocale(
                          locale,
                          "Manage provider endpoints and model presets.",
                          "管理 provider 端点和模型预设。",
                        )
                  }
                </p>
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
            ${
              props.settingsTab === "general"
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
                : html`
                  <article class="workbench-setting-card">
                    <div class="workbench-settings-section__header">
                      <span>Models</span>
                      <button
                        type="button"
                        class="workbench-secondary-button workbench-settings-add-button"
                        @click=${props.settingsView.onAddModelConfig}
                      >
                        <span class="workbench-settings-add-button__icon">${icons.plus}</span>
                        Add model
                      </button>
                    </div>
                    <div class="workbench-settings-models">
                      ${
                        props.settingsView.modelConfigs.length === 0
                          ? html`
                              <div class="workbench-empty workbench-empty--tiny">No model presets yet.</div>
                            `
                          : repeat(
                              props.settingsView.modelConfigs,
                              (config) => config.id,
                              (config, index) => html`
                                <section class="workbench-model-config">
                                  <div class="workbench-model-config__header">
                                    <div>
                                      <h4>${config.name.trim() || `Model ${index + 1}`}</h4>
                                      <p>${config.model.trim() || "Configure provider details below."}</p>
                                    </div>
                                    <div class="workbench-model-config__actions">
                                      <button
                                        type="button"
                                        class="workbench-model-config__icon-button"
                                        aria-label="Focus model fields"
                                        @click=${(event: Event) => {
                                          const root = (event.currentTarget as HTMLElement).closest(
                                            ".workbench-model-config",
                                          );
                                          root?.querySelector("input")?.focus();
                                        }}
                                      >
                                        ${icons.edit}
                                      </button>
                                      <button
                                        type="button"
                                        class="workbench-model-config__icon-button workbench-model-config__icon-button--danger"
                                        aria-label="Remove model"
                                        @click=${() =>
                                          props.settingsView.onRemoveModelConfig(config.id)}
                                      >
                                        ${icons.trash}
                                      </button>
                                    </div>
                                  </div>
                                  <div class="workbench-model-config__grid">
                                    ${renderSettingsInput(
                                      "Model name",
                                      config.name,
                                      "GPT-4",
                                      (value) =>
                                        props.settingsView.onModelConfigChange(
                                          config.id,
                                          "name",
                                          value,
                                        ),
                                    )}
                                    ${renderSettingsInput(
                                      "API URL",
                                      config.baseUrl,
                                      "https://api.openai.com/v1",
                                      (value) =>
                                        props.settingsView.onModelConfigChange(
                                          config.id,
                                          "baseUrl",
                                          value,
                                        ),
                                    )}
                                    ${renderSettingsInput(
                                      "API Key",
                                      config.apiKey,
                                      "sk-...",
                                      (value) =>
                                        props.settingsView.onModelConfigChange(
                                          config.id,
                                          "apiKey",
                                          value,
                                        ),
                                      "password",
                                    )}
                                    ${renderSettingsInput(
                                      "Model ID",
                                      config.model,
                                      "gpt-4",
                                      (value) =>
                                        props.settingsView.onModelConfigChange(
                                          config.id,
                                          "model",
                                          value,
                                        ),
                                    )}
                                  </div>
                                </section>
                              `,
                            )
                      }
                    </div>
                  </article>
                `
            }
          </section>
        </div>
      </div>
    </div>
  `;
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

function renderSettingsInput(
  label: string,
  value: string,
  placeholder: string,
  onInput: (value: string) => void,
  type = "text",
) {
  return html`
    <label class="workbench-settings-field">
      <span>${label}</span>
      <input
        type=${type}
        .value=${value}
        placeholder=${placeholder}
        @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function renderToolCard(
  tool: AgentToolEntry,
  sectionLabel: string,
  source: "core" | "plugin" | undefined,
) {
  const actionLabel = source === "plugin" ? "Add" : "Configure";
  const statusLabel = source === "plugin" ? "Available" : "Enabled";
  return html`
    <article class="workbench-tool-card">
      <div class="workbench-tool-card__icon">${icons.wrench}</div>
      <div class="workbench-tool-card__body">
        <div class="workbench-tool-card__topline">
          <div class="workbench-tool-card__title">${tool.label}</div>
          <span class="workbench-inline-badge">${source === "plugin" ? "Plugin" : "Built-in"}</span>
        </div>
        <div class="workbench-tool-card__sub">${tool.description}</div>
        <div class="workbench-tool-card__meta">
          <span>${sectionLabel}</span>
          <span>${statusLabel}</span>
        </div>
      </div>
      <div class="workbench-tool-card__actions">
        <button type="button" class="workbench-secondary-button">${actionLabel}</button>
      </div>
    </article>
  `;
}

function renderTabChip(
  id: WorkbenchToolsCategory,
  label: string,
  active: WorkbenchToolsCategory,
  onChange: (value: WorkbenchToolsCategory) => void,
) {
  return html`
    <button
      type="button"
      class="workbench-tab-chip ${active === id ? "is-active" : ""}"
      @click=${() => onChange(id)}
    >
      ${label}
    </button>
  `;
}

function resolveProjects(props: WorkbenchProps): WorkbenchProject[] {
  const agents = props.agentsList?.agents ?? [];
  const sessionsByAgent = new Map<string, WorkbenchSession[]>();
  for (const row of props.sessionsResult?.sessions ?? []) {
    const parsed = parseAgentSessionKey(row.key);
    if (!parsed?.agentId) {
      continue;
    }
    const list = sessionsByAgent.get(parsed.agentId) ?? [];
    list.push({
      key: row.key,
      label:
        row.displayName?.trim() ||
        row.label?.trim() ||
        row.subject?.trim() ||
        shortSessionLabel(row.key),
      title: row.subject?.trim() || row.key,
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

function filterToolEntries(
  sections: Array<{
    id: string;
    label: string;
    tools: AgentToolEntry[];
    source?: "core" | "plugin";
    pluginId?: string;
  }>,
  query: string,
  category: WorkbenchToolsCategory,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return sections
    .flatMap((section) =>
      section.tools.map((tool) => ({
        sectionId: section.id,
        sectionLabel: section.label,
        source: tool.source ?? section.source,
        pluginId: tool.pluginId ?? section.pluginId ?? "",
        tool,
      })),
    )
    .filter((entry) => {
      const haystack = [entry.tool.id, entry.tool.label, entry.tool.description, entry.sectionLabel]
        .join(" ")
        .toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) {
        return false;
      }
      if (category === "builtIn") {
        return entry.source !== "plugin";
      }
      if (category === "mcp") {
        return entry.source === "plugin" && entry.pluginId.toLowerCase().includes("mcp");
      }
      return entry.source === "plugin" && !entry.pluginId.toLowerCase().includes("mcp");
    });
}

function shortSessionLabel(sessionKey: string) {
  const parsed = parseAgentSessionKey(sessionKey);
  const last = parsed?.rest?.split(":").filter(Boolean).pop();
  return last || sessionKey;
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
