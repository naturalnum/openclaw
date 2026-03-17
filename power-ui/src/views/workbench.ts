import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseAgentSessionKey } from "../../../src/routing/session-key.ts";
import { extractText } from "../../../ui/src/ui/chat/message-extract.ts";
import { icons } from "../../../ui/src/ui/icons.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  CronJob,
  ModelCatalogEntry,
  SessionsListResult,
  SkillStatusEntry,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../../../ui/src/ui/types.ts";
import {
  normalizeAgentLabel,
  resolveAgentAvatarUrl,
  resolveToolSections,
  type AgentToolEntry,
} from "../../../ui/src/ui/views/agents-utils.ts";

export type WorkbenchSection = "newTask" | "automations" | "skills";
export type WorkbenchToolsCategory = "builtIn" | "mcp" | "connectors";
export type WorkbenchSettingsTab = "settings" | "models";

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
  lastError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  skillsReport: SkillStatusReport | null;
  skillsLoading: boolean;
  skillsError: string | null;
  skillsFilter: string;
  skillsBusyKey: string | null;
  skillMessages: Record<string, { kind: "success" | "error"; message: string }>;
  skillEdits: Record<string, string>;
  cronJobs: CronJob[];
  cronLoading: boolean;
  cronError: string | null;
  modelCatalog: ModelCatalogEntry[];
  modelsLoading: boolean;
  themeResolved: string;
  settings: {
    gatewayUrl: string;
    theme: string;
    themeMode: string;
    locale?: string;
  };
  section: WorkbenchSection;
  toolsOpen: boolean;
  toolQuery: string;
  toolsCategory: WorkbenchToolsCategory;
  settingsOpen: boolean;
  settingsTab: WorkbenchSettingsTab;
  onNavigateLegacy: () => void;
  onSectionChange: (section: WorkbenchSection) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionKey: string) => void;
  onSelectNewTaskProject: (projectId: string) => void;
  onToggleNewTaskProjectMenu: () => void;
  onStartTask: (projectId: string) => void;
  onOpenAttachment: () => void;
  onComposerChange: (value: string) => void;
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
  onToggleSidebar: () => void;
  onToggleProjects: () => void;
  onToggleRightRail: () => void;
  onToggleProject: (projectId: string) => void;
  onRefreshContext: () => void;
  onRefreshSkills: () => void;
  onSkillsFilterChange: (value: string) => void;
  onToggleSkill: (skillKey: string, enabled: boolean) => void;
  onEditSkillKey: (skillKey: string, value: string) => void;
  onSaveSkillKey: (skillKey: string) => void;
  onInstallSkill: (skillKey: string, name: string, installId: string) => void;
};

export function renderWorkbench(props: WorkbenchProps) {
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
          ${
            props.sidebarCollapsed
              ? html`
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
              `
              : html`
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
              `
          }
        </div>

        <nav class="workbench-nav">
          ${renderNavButton(
            "newTask",
            "New task",
            icons.edit,
            props.section === "newTask",
            props.sidebarCollapsed,
            () => props.onSectionChange("newTask"),
          )}
          ${renderNavButton(
            "automations",
            "Automations",
            icons.loader,
            props.section === "automations",
            props.sidebarCollapsed,
            () => props.onSectionChange("automations"),
          )}
          ${renderNavButton(
            "skills",
            "Skills",
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
                    <span>Projects</span>
                    ${props.projectsCollapsed ? icons.chevronRight : icons.chevronDown}
                  </button>
                  <button
                    type="button"
                    class="workbench-icon-button"
                    title="New project"
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
            title="Settings"
            aria-label="Settings"
            @click=${props.onOpenSettings}
          >
            <span class="workbench-settings-entry__icon">${icons.settings}</span>
            ${
              props.sidebarCollapsed
                ? nothing
                : html`
                    <span>Settings</span>
                  `
            }
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
              ? renderRightRail(props, activeProject, activeSession)
              : nothing
          }
        </div>
      </div>
      ${props.toolsOpen ? renderToolsDialog(props) : nothing}
      ${props.settingsOpen ? renderSettingsDialog(props) : nothing}
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
  return html`
    <section class="workbench-session-shell workbench-session-shell--centered">
      <section class="workbench-chat-surface">
        <div class="workbench-new-thread">
          <div class="workbench-new-thread__hero">
            <div class="workbench-new-thread__icon">${icons.spark}</div>
            <h2>Start building</h2>
            <div class="workbench-new-thread__project-picker">
              <button
                type="button"
                class="workbench-new-thread__project-button"
                @click=${props.onToggleNewTaskProjectMenu}
              >
                <span>${currentProject?.label ?? "Select project"}</span>
                <span class="workbench-new-thread__project-chevron">
                  ${props.newTaskProjectMenuOpen ? icons.chevronUp : icons.chevronDown}
                </span>
              </button>

              ${
                props.newTaskProjectMenuOpen
                  ? html`
                    <div class="workbench-new-thread__project-menu">
                      <div class="workbench-new-thread__project-menu-title">Choose project</div>
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
                        <span>New project</span>
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
            placeholder="Ask anything about the selected project..."
            @input=${(event: Event) =>
              props.onComposerChange((event.target as HTMLTextAreaElement).value)}
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
      ${collapsed ? nothing : html`<span>${label}</span>`}
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

      ${
        expanded
          ? html`
            <div class="workbench-tree-node__children">
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
          `
          : nothing
      }
    </div>
  `;
}

function renderSessionView(
  props: WorkbenchProps,
  _project: WorkbenchProject | null,
  _session: WorkbenchSession,
) {
  const stream = props.chatStream?.trim();
  return html`
    <section class="workbench-session-shell ${props.rightRailCollapsed ? "workbench-session-shell--centered" : ""}">
      <section class="workbench-chat-surface">
        <div class="workbench-chat-scroll">
          ${
            props.chatMessages.length === 0 && !stream
              ? html`
                  <div class="workbench-empty workbench-empty--chat">
                    <h4>No conversation yet</h4>
                    <p>Use the composer below to send the first message into this session.</p>
                  </div>
                `
              : nothing
          }

          ${repeat(
            props.chatMessages,
            (_message, index) => `${props.currentSessionKey}:${index}`,
            (message) => renderChatMessage(message),
          )}

          ${
            stream
              ? html`
                <article class="workbench-message workbench-message--assistant">
                  <div class="workbench-message__role">assistant</div>
                  <div class="workbench-message__bubble">
                    <div class="workbench-streaming-dot"></div>
                    <p>${stream}</p>
                  </div>
                </article>
              `
              : nothing
          }
        </div>

        <div class="workbench-chat-composer workbench-chat-composer--floating">
          <textarea
            class="workbench-composer workbench-composer--session"
            .value=${props.chatMessage}
            placeholder="Reply in this session..."
            @input=${(event: Event) =>
              props.onComposerChange((event.target as HTMLTextAreaElement).value)}
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

function renderChatMessage(message: unknown) {
  const text = extractText(message)?.trim();
  if (!text) {
    return nothing;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "assistant";
  const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : null;
  const bubbleRole =
    role === "assistant" || role === "system" || role === "tool" ? "assistant" : "user";
  return html`
    <article class="workbench-message workbench-message--${bubbleRole}">
      <div class="workbench-message__role">${role}</div>
      <div class="workbench-message__bubble">
        <p>${text}</p>
        ${timestamp ? html`<time>${formatTime(timestamp)}</time>` : nothing}
      </div>
    </article>
  `;
}

function renderAutomationsPage(props: WorkbenchProps, currentProject: WorkbenchProject | null) {
  const relevantJobs = props.cronJobs.filter((job) => {
    if (!currentProject) {
      return true;
    }
    const agentId = typeof job.agentId === "string" ? job.agentId.trim() : "";
    return !agentId || agentId === currentProject.id;
  });
  return html`
    <section class="workbench-grid workbench-grid--overview">
      <article class="workbench-card workbench-card--metric">
        <div class="workbench-card__topline">
          <span class="workbench-card__eyebrow">Automation center</span>
          <span>${currentProject?.label ?? "All projects"}</span>
        </div>
        <h4>${relevantJobs.length} scheduled entries</h4>
        <p>Automations stay visible here before the dedicated recurring-task creation flow is wired.</p>
        <div class="workbench-stats-grid">
          ${renderStatTile("Enabled", String(relevantJobs.filter((job) => job.enabled).length))}
          ${renderStatTile("Paused", String(relevantJobs.filter((job) => !job.enabled).length))}
          ${renderStatTile("Errors", String(relevantJobs.filter((job) => job.state?.lastStatus === "error").length))}
          ${renderStatTile("Scope", currentProject ? "Project" : "Global")}
        </div>
      </article>

      <article class="workbench-card">
        <div class="workbench-card__topline">
          <span class="workbench-card__eyebrow">Planned flow</span>
          <span>Prototype</span>
        </div>
        <h4>What this page will become</h4>
        <p>
          It will evolve into the project-scoped recurring task center, backed by existing cron APIs
          and later surfaced with create, edit, run, and history actions.
        </p>
      </article>
    </section>

    <section class="workbench-panel">
      <div class="workbench-panel__header">
        <div>
          <h3>Automation runs</h3>
          <p>Project-scoped cron jobs and recurring task entry points.</p>
        </div>
        <div class="workbench-status-cluster">
          ${
            props.cronLoading
              ? html`
                  <span class="workbench-status-pill is-live">Refreshing</span>
                `
              : nothing
          }
          ${props.cronError ? html`<span class="workbench-status-pill is-danger">${props.cronError}</span>` : nothing}
        </div>
      </div>

      <div class="workbench-grid workbench-grid--cards">
        ${
          relevantJobs.length === 0
            ? html`
                <div class="workbench-empty workbench-empty--small">
                  No automations found for the current project yet.
                </div>
              `
            : repeat(
                relevantJobs.slice(0, 8),
                (job) => job.id,
                (job) => html`
                <article class="workbench-card">
                  <div class="workbench-card__topline">
                    <span class="workbench-card__eyebrow">${job.enabled ? "Enabled" : "Paused"}</span>
                    <span>${formatRelativeTime(job.updatedAtMs ?? null)}</span>
                  </div>
                  <h4>${job.name || job.id}</h4>
                  <p>${job.description || "Recurring task entry point"}</p>
                  <div class="workbench-card__footer">
                    <span>${describeCronJob(job)}</span>
                    <span>${job.state?.lastStatus ?? "idle"}</span>
                  </div>
                </article>
              `,
              )
        }
      </div>
    </section>
  `;
}

function renderSkillsPage(props: WorkbenchProps) {
  const skills = props.skillsReport?.skills ?? [];
  const filter = props.skillsFilter.trim().toLowerCase();
  const installed = skills.filter(
    (skill) => skill.install.length === 0 || skill.missing.bins.length === 0,
  ).length;
  const enabled = skills.filter((skill) => !skill.disabled).length;
  const filtered = filter
    ? skills.filter((skill) =>
        [skill.name, skill.description, skill.source].join(" ").toLowerCase().includes(filter),
      )
    : skills;

  return html`
    <section class="workbench-panel">
      <div class="workbench-panel__header">
        <div>
          <h3>Skills</h3>
          <p>Prepackaged and repeatable capabilities, now surfaced as a dedicated page.</p>
        </div>
        <button type="button" class="workbench-primary-button" @click=${props.onRefreshSkills}>
          ${props.skillsLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div class="workbench-toolbar">
        <label class="workbench-search-field">
          ${icons.search}
          <input
            .value=${props.skillsFilter}
            placeholder="Search skills"
            @input=${(event: Event) =>
              props.onSkillsFilterChange((event.target as HTMLInputElement).value)}
          />
        </label>
        <div class="workbench-toolbar__meta">
          <span class="workbench-inline-badge">Official</span>
          <span class="workbench-inline-badge">${enabled} enabled</span>
          <span class="workbench-inline-badge">${installed} installed</span>
          <span class="workbench-inline-badge">${filtered.length} shown</span>
        </div>
      </div>

      ${
        props.skillsError
          ? html`<div class="workbench-callout workbench-callout--danger">${props.skillsError}</div>`
          : nothing
      }

      <div class="workbench-grid workbench-grid--skills">
        <article class="workbench-skill-hero">
          <div class="workbench-skill-hero__icon">${icons.puzzle}</div>
          <div>
            <h4>Add custom skills</h4>
            <p>Add a skill to unlock new capabilities for yourself or your team.</p>
            <div class="workbench-badge-row">
              <span class="workbench-inline-badge">Workspace skill packs</span>
              <span class="workbench-inline-badge">Official catalog</span>
            </div>
          </div>
          <button type="button" class="workbench-primary-button" @click=${props.onOpenTools}>
            Add
          </button>
        </article>

        ${
          filtered.length === 0
            ? html`
                <div class="workbench-empty workbench-empty--small">No skills match this filter.</div>
              `
            : repeat(
                filtered,
                (skill) => skill.skillKey,
                (skill) => renderSkillCard(skill, props),
              )
        }
      </div>
    </section>
  `;
}

function renderSkillCard(skill: SkillStatusEntry, props: WorkbenchProps) {
  const busy = props.skillsBusyKey === skill.skillKey;
  const message = props.skillMessages[skill.skillKey] ?? null;
  const hasInstall = skill.install.length > 0 && skill.missing.bins.length > 0;
  const envValue = props.skillEdits[skill.skillKey] ?? "";
  return html`
    <article class="workbench-skill-card">
      <div class="workbench-skill-card__header">
        <div>
          <h4>${skill.name}</h4>
          <p>${clampText(skill.description, 120)}</p>
        </div>
        <label class="workbench-switch">
          <input
            type="checkbox"
            .checked=${!skill.disabled}
            ?disabled=${busy}
            @change=${() => props.onToggleSkill(skill.skillKey, skill.disabled)}
          />
          <span></span>
        </label>
      </div>
      <div class="workbench-skill-card__meta">
        <span>${skill.source}</span>
        <span>${skill.disabled ? "Disabled" : "Enabled"}</span>
      </div>
      ${
        message
          ? html`
            <div class="workbench-callout ${message.kind === "error" ? "workbench-callout--danger" : ""}">
              ${message.message}
            </div>
          `
          : nothing
      }
      ${
        skill.primaryEnv
          ? html`
            <label class="workbench-inline-field">
              <span>API key</span>
              <input
                type="password"
                .value=${envValue}
                placeholder="Paste key"
                @input=${(event: Event) =>
                  props.onEditSkillKey(skill.skillKey, (event.target as HTMLInputElement).value)}
              />
            </label>
          `
          : nothing
      }
      <div class="workbench-skill-card__actions">
        ${
          skill.primaryEnv
            ? html`
              <button
                type="button"
                class="workbench-secondary-button"
                ?disabled=${busy}
                @click=${() => props.onSaveSkillKey(skill.skillKey)}
              >
                Save key
              </button>
            `
            : nothing
        }
        ${
          hasInstall
            ? html`
              <button
                type="button"
                class="workbench-primary-button"
                ?disabled=${busy}
                @click=${() =>
                  props.onInstallSkill(skill.skillKey, skill.name, skill.install[0].id)}
              >
                ${busy ? "Installing..." : skill.install[0].label}
              </button>
            `
            : nothing
        }
      </div>
    </article>
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
    <div class="workbench-overlay">
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
  return html`
    <div class="workbench-overlay">
      <div class="workbench-overlay__backdrop" @click=${props.onCloseSettings}></div>
      <div class="workbench-dialog workbench-dialog--settings">
        <div class="workbench-dialog__topbar">
          <div>
            <h3>Settings</h3>
            <p>Prototype settings shell for later config and model wiring.</p>
          </div>
          <button type="button" class="workbench-icon-button" @click=${props.onCloseSettings}>
            ${icons.x}
          </button>
        </div>

        <div class="workbench-settings-layout">
          <aside class="workbench-settings-nav">
            <button
              type="button"
              class="${props.settingsTab === "settings" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("settings")}
            >
              Settings
            </button>
            <button
              type="button"
              class="${props.settingsTab === "models" ? "is-active" : ""}"
              @click=${() => props.onSettingsTabChange("models")}
            >
              Models
            </button>
          </aside>

          <section class="workbench-settings-panel">
            ${
              props.settingsTab === "settings"
                ? html`
                  <article class="workbench-setting-card">
                    <h4>Gateway</h4>
                    <div class="workbench-kv-grid">
                      <div><span>Gateway URL</span><strong>${props.settings.gatewayUrl || "Inherited"}</strong></div>
                      <div><span>Theme</span><strong>${props.settings.theme}</strong></div>
                      <div><span>Theme mode</span><strong>${props.settings.themeMode}</strong></div>
                      <div><span>Locale</span><strong>${props.settings.locale ?? "default"}</strong></div>
                    </div>
                  </article>
                  <article class="workbench-setting-card">
                    <h4>Planned integrations</h4>
                    <p>Next steps for backend wiring in this branch:</p>
                    <ul class="workbench-inline-list">
                      <li>project file upload/list APIs</li>
                      <li>session transcript search plugin</li>
                      <li>project metadata persistence</li>
                    </ul>
                  </article>
                  <article class="workbench-setting-card">
                    <h4>Environment notes</h4>
                    <p>
                      This prototype intentionally lives in a parallel <code>power-ui/</code> package
                      so upstream <code>ui/</code> can keep syncing with minimal merge pressure.
                    </p>
                  </article>
                `
                : html`
                  <article class="workbench-setting-card">
                    <h4>Available models</h4>
                    ${
                      props.modelsLoading
                        ? html`
                            <div class="workbench-skeleton">Loading model catalog…</div>
                          `
                        : props.modelCatalog.length === 0
                          ? html`
                              <div class="workbench-empty workbench-empty--tiny">No models loaded.</div>
                            `
                          : repeat(
                              props.modelCatalog,
                              (model) => model.id,
                              (model) => html`
                              <div class="workbench-model-row">
                                <div>
                                  <div class="workbench-model-row__title">${model.name || model.id}</div>
                                  <div class="workbench-model-row__sub">${model.provider}</div>
                                </div>
                                <div class="workbench-model-row__meta">
                                  ${model.contextWindow ? `${Math.round(model.contextWindow / 1000)}k ctx` : "catalog"}
                                </div>
                              </div>
                            `,
                            )
                    }
                  </article>
                  <article class="workbench-setting-card">
                    <h4>Model strategy</h4>
                    <p>
                      Default model selection will stay in settings, while project- and
                      session-specific overrides will be layered on top through the workbench shell.
                    </p>
                  </article>
                `
            }
          </section>
        </div>
      </div>
    </div>
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

  return agents
    .map((agent) => {
      const identity = props.agentIdentityById[agent.id];
      const sessions = (sessionsByAgent.get(agent.id) ?? []).toSorted(
        (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
      );
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
    .toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
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

function formatRelativeTime(value: number | null) {
  if (!value) {
    return "just now";
  }
  const diffMs = value - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
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

function renderStatTile(label: string, value: string) {
  return html`
    <div class="workbench-stat-tile">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function describeCronJob(job: CronJob) {
  if (job.schedule.kind === "every") {
    const everyMinutes = Math.max(1, Math.round(job.schedule.everyMs / 60000));
    return `Every ${everyMinutes} min`;
  }
  if (job.schedule.kind === "at") {
    return job.schedule.at;
  }
  return job.schedule.expr;
}
