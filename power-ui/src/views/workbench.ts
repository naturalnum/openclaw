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

function isZhLocale(locale?: string): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh");
}

function tLocale(locale: string | undefined, en: string, zh: string): string {
  return isZhLocale(locale) ? zh : en;
}

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
  agentFilesLoading: boolean;
  agentFilesError: string | null;
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
  projectDirectoryCurrentPath: string | null;
  projectDirectoryCurrentName: string | null;
  projectDirectoryParentPath: string | null;
  projectDirectoryEntries: WorkbenchDirectoryEntry[];
  projectCreateName: string;
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
  onBrowseProjectDirectory: (path: string | null) => void;
  onCreateProjectFromDirectory: (path: string | null) => void;
  onProjectCreateNameChange: (value: string) => void;
  onCreateProjectFromName: (name: string) => void;
  onToggleSidebar: () => void;
  onToggleProjects: () => void;
  onToggleRightRail: () => void;
  onToggleProject: (projectId: string) => void;
  onRefreshContext: () => void;
};

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
            <span class="workbench-settings-entry__label">${tLocale(locale, "Settings", "设置")}</span>
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
            props.section === "newTask"
              ? "workbench-content--session-centered"
              : props.section === "automations" || props.section === "skills"
                ? "workbench-content--page"
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
              ? renderRightRail(props, activeProject, activeSession)
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
                  ${icons.chevronDown}
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
              <label class="workbench-model-select" aria-label=${tLocale(locale, "Choose model", "选择模型")}>
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
                <span
                  class="workbench-model-select__chevron"
                  role="button"
                  tabindex="0"
                  @click=${(event: Event) => {
                    const root = (event.currentTarget as HTMLElement).closest(
                      ".workbench-model-select",
                    );
                    const select = root?.querySelector("select") as HTMLSelectElement | null;
                    if (!select) {
                      return;
                    }
                    // Prefer native picker if supported (better than click+focus).
                    select.showPicker?.();
                    // Fallback for browsers without showPicker().
                    select.focus();
                    select.click();
                  }}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }
                    event.preventDefault();
                    (event.currentTarget as HTMLElement).click();
                  }}
                >
                  ${icons.chevronDown}
                </span>
              </label>
            </div>
            <button
              type="button"
              class="workbench-send-button"
              title=${tLocale(locale, "Send", "发送")}
              aria-label=${tLocale(locale, "Send", "发送")}
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
  const locale = props.settings.locale;
  return html`
    <div class="workbench-overlay ${props.projectDirectoryClosing ? "is-closing" : ""}">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseProjectDirectory}></div>
      <div class="workbench-dialog workbench-dialog--directory">
        <div class="workbench-dialog__topbar">
          <div>
            <h3>${tLocale(locale, "Create Project", "创建项目")}</h3>
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
          ${
            props.projectDirectoryError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.projectDirectoryError}</div>`
              : nothing
          }

          <section class="workbench-create-project">
            <label class="workbench-settings-field workbench-create-project__field">
              <span>${tLocale(locale, "Project Name", "项目名称")}</span>
              <input
                type="text"
                .value=${props.projectCreateName}
                placeholder=${tLocale(locale, "e.g. my-project", "例如：my-project")}
                @input=${(event: Event) =>
                  props.onProjectCreateNameChange((event.target as HTMLInputElement).value)}
              />
            </label>

            <div class="workbench-create-project__actions">
              <button
                type="button"
                class="workbench-secondary-button"
                @click=${props.onCloseProjectDirectory}
              >
                ${tLocale(locale, "Cancel", "取消")}
              </button>
              <button
                type="button"
                class="workbench-secondary-button"
                ?disabled=${props.projectDirectoryLoading || !props.projectCreateName.trim()}
                @click=${() => props.onCreateProjectFromName(props.projectCreateName)}
              >
                ${tLocale(locale, "Create", "创建")}
              </button>
            </div>
          </section>
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
  _collapsed: boolean,
  onClick: () => void,
) {
  return html`
    <button
      type="button"
      class="workbench-nav__item ${active ? "is-active" : ""}"
      data-key=${key}
      title=${label}
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
    <div class="workbench-tree-node ${selected ? "is-active" : ""} ${expanded ? "is-expanded" : ""}">
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

      <div
        class="workbench-tree-node__children ${expanded ? "is-expanded" : ""}"
        aria-hidden=${!expanded}
      >
        <div class="workbench-tree-node__children-inner">
          ${
            project.sessions.length === 0
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
    </div>
  `;
}

function renderSessionView(
  props: WorkbenchProps,
  _project: WorkbenchProject | null,
  _session: WorkbenchSession,
) {
  const locale = props.settings.locale;
  const assistantAvatar = resolveAgentAvatarUrl({
    identity: {
      avatar: undefined,
      avatarUrl: undefined,
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
            ? null
            : html`
                <div class="workbench-empty workbench-empty--chat">
                  <h4>${tLocale(locale, "No conversation yet", "暂无对话")}</h4>
                  <p>
                    ${tLocale(
                      locale,
                      "Use the composer below to send the first message into this session.",
                      "使用下方输入框向该会话发送第一条消息。",
                    )}
                  </p>
                </div>
              `,
        })}

        <div class="workbench-chat-composer workbench-chat-composer--floating">
          <textarea
            class="workbench-composer workbench-composer--session"
            .value=${props.chatMessage}
            placeholder=${tLocale(locale, "Reply in this session...", "在当前会话中回复...")}
            @input=${(event: Event) =>
              props.onComposerChange((event.target as HTMLTextAreaElement).value)}
            @keydown=${props.onComposerKeyDown}
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
              <label class="workbench-model-select" aria-label=${tLocale(locale, "Choose model", "选择模型")}>
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
                <span
                  class="workbench-model-select__chevron"
                  role="button"
                  tabindex="0"
                  @click=${(event: Event) => {
                    const root = (event.currentTarget as HTMLElement).closest(
                      ".workbench-model-select",
                    );
                    const select = root?.querySelector("select") as HTMLSelectElement | null;
                    if (!select) {
                      return;
                    }
                    // Prefer native picker if supported (better than click+focus).
                    select.showPicker?.();
                    // Fallback for browsers without showPicker().
                    select.focus();
                    select.click();
                  }}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }
                    event.preventDefault();
                    (event.currentTarget as HTMLElement).click();
                  }}
                >
                  ${icons.chevronDown}
                </span>
              </label>
            </div>
            ${
              props.chatRunId
                ? html`
                  <button
                    type="button"
                    class="workbench-send-button"
                    title=${tLocale(locale, "Stop", "停止")}
                    aria-label=${tLocale(locale, "Stop", "停止")}
                    @click=${props.onAbort}
                  >
                    ${icons.x}
                  </button>
                `
                : html`
                  <button
                    type="button"
                    class="workbench-send-button"
                    title=${tLocale(locale, "Send", "发送")}
                    aria-label=${tLocale(locale, "Send", "发送")}
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

function renderRightRail(
  props: WorkbenchProps,
  project: WorkbenchProject,
  activeSession: WorkbenchSession,
) {
  const files = props.agentFilesList?.agentId === project.id ? props.agentFilesList.files : [];
  const toolEntries = resolveToolSections(props.toolsCatalogResult)
    .flatMap((section) => section.tools)
    .slice(0, 8);

  return html`
    <aside class="workbench-rail">
      <section class="workbench-sidecard">
        <div class="workbench-sidecard__header">
          <h4>Current task</h4>
          <span>${props.chatRunId ? "Live" : "Idle"}</span>
        </div>
        <div class="workbench-sidecard__body">
          <div class="workbench-progress-row">
            <span>Status</span>
            <strong>${props.chatRunId ? "Running" : activeSession ? "Ready" : "Waiting"}</strong>
          </div>
          <div class="workbench-progress-row">
            <span>Project</span>
            <strong>${project.label}</strong>
          </div>
          <div class="workbench-progress-row">
            <span>Session</span>
            <strong>${activeSession?.label ?? "Not selected"}</strong>
          </div>
          <div class="workbench-progress-row">
            <span>Assistant</span>
            <strong>${props.assistantName}</strong>
          </div>
          ${
            props.lastError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.lastError}</div>`
              : nothing
          }
        </div>
      </section>

      <section class="workbench-sidecard">
        <div class="workbench-sidecard__header">
          <h4>Project files</h4>
          <button type="button" class="workbench-link-button" @click=${props.onRefreshContext}>
            Manage
          </button>
        </div>
        <div class="workbench-sidecard__body">
          ${
            props.agentFilesError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.agentFilesError}</div>`
              : nothing
          }
          ${
            props.agentFilesLoading
              ? html`
                  <div class="workbench-skeleton">Loading files…</div>
                `
              : files.length === 0
                ? html`
                    <div class="workbench-empty workbench-empty--tiny">
                      Generic upload/list APIs are pending. Showing workspace bootstrap files when available.
                    </div>
                  `
                : repeat(
                    files.slice(0, 6),
                    (file) => file.path,
                    (file) => html`
                    <div class="workbench-mini-row">
                      <span class="workbench-mini-row__icon">${icons.fileText}</span>
                      <div>
                        <div>${file.name}</div>
                        <div class="workbench-mini-row__meta">${formatBytes(file.size ?? 0)}</div>
                      </div>
                    </div>
                  `,
                  )
          }
        </div>
      </section>

      <section class="workbench-sidecard">
        <div class="workbench-sidecard__header">
          <h4>Project tools</h4>
          <button type="button" class="workbench-link-button" @click=${props.onOpenTools}>
            Open
          </button>
        </div>
        <div class="workbench-sidecard__body">
          ${
            props.toolsCatalogError
              ? html`<div class="workbench-callout workbench-callout--danger">${props.toolsCatalogError}</div>`
              : nothing
          }
          ${
            props.toolsCatalogLoading
              ? html`
                  <div class="workbench-skeleton">Loading tools…</div>
                `
              : toolEntries.length === 0
                ? html`
                    <div class="workbench-empty workbench-empty--tiny">No tools loaded yet.</div>
                  `
                : repeat(
                    toolEntries,
                    (tool) => tool.id,
                    (tool) => html`
                    <div class="workbench-mini-row">
                      <span class="workbench-mini-row__icon">${icons.wrench}</span>
                      <div>
                        <div>${tool.label}</div>
                        <div class="workbench-mini-row__meta">${tool.description}</div>
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
  return html`
    <div class="workbench-overlay ${props.toolsClosing ? "is-closing" : ""}">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseTools}></div>
      <div class="workbench-dialog workbench-dialog--tools">
        <div class="workbench-dialog__topbar">
          <div>
            <h3>Tools</h3>
            <p>Configure the runtime catalog your current project can access.</p>
          </div>
          <button type="button" class="workbench-icon-button" @click=${props.onCloseTools}>
            ${icons.x}
          </button>
        </div>

        <div class="workbench-dialog__tabs">
          ${renderTabChip("builtIn", "Built-in", props.toolsCategory, props.onToolsCategoryChange)}
          ${renderTabChip("mcp", "MCP", props.toolsCategory, props.onToolsCategoryChange)}
          ${renderTabChip(
            "connectors",
            "Connectors",
            props.toolsCategory,
            props.onToolsCategoryChange,
          )}
          <label class="workbench-search-field">
            ${icons.search}
            <input
              .value=${props.toolQuery}
              placeholder="Search tools"
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
                  <div class="workbench-empty workbench-empty--small">No tools in this category.</div>
                `
              : html`
                <section class="workbench-tool-section">
                  <div class="workbench-tool-section__header">
                    <div>
                      <h4>Recommended</h4>
                      <p>High-signal tools surfaced first for project setup.</p>
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
                            <h4>Catalog</h4>
                            <p>The rest of the runtime-accessible tools for this category.</p>
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
  return html`
    <div class="workbench-overlay ${props.settingsClosing ? "is-closing" : ""}">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseSettings}></div>
      <div class="workbench-dialog workbench-dialog--settings">
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
                          "管理语言与界面显示。",
                        )
                      : tLocale(
                          locale,
                          "Manage provider endpoints and model presets.",
                          "管理模型服务地址与预设。",
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
                        <span>${tLocale(locale, "Language", "语言")}</span>
                      </div>
                      <label class="workbench-settings-field">
                        <span>${tLocale(locale, "Display language", "显示语言")}</span>
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
                        <span>${tLocale(locale, "Mode", "模式")}</span>
                      </div>
                      <div class="workbench-settings-cards">
                        ${renderAppearanceCard(
                          "light",
                          tLocale(locale, "Light", "浅色"),
                          props.settings.themeMode === "light",
                          () => props.settingsView.onThemeModeChange("light"),
                        )}
                        ${renderAppearanceCard(
                          "dark",
                          tLocale(locale, "Dark", "深色"),
                          props.settings.themeMode === "dark",
                          () => props.settingsView.onThemeModeChange("dark"),
                        )}
                        ${renderAppearanceCard(
                          "system",
                          tLocale(locale, "Follow System", "跟随系统"),
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
                      <span>${tLocale(locale, "Models", "模型")}</span>
                      <button
                        type="button"
                        class="workbench-secondary-button workbench-settings-add-button"
                        @click=${props.settingsView.onAddModelConfig}
                      >
                        <span class="workbench-settings-add-button__icon">${icons.plus}</span>
                        ${tLocale(locale, "Add model", "新增模型")}
                      </button>
                    </div>
                    <div class="workbench-settings-models">
                      ${
                        props.settingsView.modelConfigs.length === 0
                          ? html`
                              <div class="workbench-empty workbench-empty--tiny">
                                ${tLocale(locale, "No model presets yet.", "暂无模型预设。")}
                              </div>
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
      const sessions = (sessionsByAgent.get(agent.id) ?? [])
        .slice()
        .toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
      const updatedAt = sessions[0]?.updatedAt ?? null;
      const workspace =
        props.agentFilesList?.agentId === agent.id ? props.agentFilesList.workspace : null;
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
    .slice()
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
