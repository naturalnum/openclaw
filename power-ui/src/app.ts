import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { parseAgentSessionKey } from "../../src/routing/session-key.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "../../ui/src/ui/navigation.ts";
import { loadSettings, saveSettings, type UiSettings } from "../../ui/src/ui/storage.ts";
import { resolveTheme } from "../../ui/src/ui/theme.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  CronJob,
  ModelCatalogEntry,
  SessionsListResult,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../../ui/src/ui/types.ts";
import { generateUUID } from "../../ui/src/ui/uuid.ts";
import { MockWorkbenchAdapter, type WorkbenchSnapshot } from "./adapters/mock-workbench-adapter.ts";
import type { WorkbenchAdapter } from "./adapters/workbench-adapter.ts";
import {
  renderWorkbench,
  type WorkbenchSection,
  type WorkbenchSettingsTab,
  type WorkbenchToolsCategory,
} from "./views/workbench.ts";

declare global {
  interface Window {
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
  }
}

function resolveBasePath() {
  const configured =
    typeof window !== "undefined" &&
    typeof window.__OPENCLAW_CONTROL_UI_BASE_PATH__ === "string" &&
    window.__OPENCLAW_CONTROL_UI_BASE_PATH__.trim();
  return configured
    ? normalizeBasePath(configured)
    : inferBasePathFromPathname(window.location.pathname);
}

function applyTheme(settings: UiSettings) {
  const resolved = resolveTheme(settings.theme, settings.themeMode);
  const mode = resolved.includes("light") ? "light" : "dark";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  return resolved;
}

@customElement("openclaw-power-app")
export class OpenClawPowerApp extends LitElement {
  private adapter: WorkbenchAdapter = new MockWorkbenchAdapter();
  private runTimer: number | null = null;
  private readonly handleDocumentPointerDown = (event: PointerEvent) => {
    if (!this.newTaskProjectMenuOpen) {
      return;
    }
    const path = event.composedPath();
    const clickedInsidePicker = path.some(
      (node) =>
        node instanceof HTMLElement && node.closest(".workbench-new-thread__project-picker"),
    );
    if (!clickedInsidePicker) {
      this.newTaskProjectMenuOpen = false;
    }
  };
  basePath = resolveBasePath();

  createRenderRoot() {
    return this;
  }

  @state() ready = false;
  @state() settings: UiSettings = loadSettings();
  @state() themeResolved = applyTheme(this.settings);
  @state() assistantName = "Power UI Prototype";
  @state() currentModelId = this.adapter.getDefaultModelId();
  @state() lastError: string | null = null;

  @state() workbenchSection: WorkbenchSection = "newTask";
  @state() sidebarCollapsed = false;
  @state() projectsCollapsed = false;
  @state() rightRailCollapsed = false;
  @state() newTaskProjectMenuOpen = false;
  @state() expandedProjectIds: string[] = [];
  @state() workbenchSelectedProjectId: string | null = null;
  @state() workbenchSelectedSessionKey: string | null = null;
  @state() workbenchToolsOpen = false;
  @state() workbenchToolQuery = "";
  @state() workbenchToolsCategory: WorkbenchToolsCategory = "builtIn";
  @state() workbenchSettingsOpen = false;
  @state() workbenchSettingsTab: WorkbenchSettingsTab = "settings";

  @state() agentsList: AgentsListResult | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() chatMessages: unknown[] = [];
  @state() chatMessage = "";
  @state() chatSending = false;
  @state() chatRunId: string | null = null;
  @state() chatStream: string | null = null;
  @state() toolsCatalogResult: ToolsCatalogResult | null = null;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsFilter = "";
  @state() skillsBusyKey: string | null = null;
  @state() skillEdits: Record<string, string> = {};
  @state() skillMessages: Record<string, { kind: "success" | "error"; message: string }> = {};
  @state() cronJobs: CronJob[] = [];
  @state() chatModelCatalog: ModelCatalogEntry[] = [];

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    void this.bootstrap();
  }

  disconnectedCallback() {
    this.clearRunTimer();
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    super.disconnectedCallback();
  }

  private async bootstrap() {
    const initialProjectId = parseAgentSessionKey(this.settings.sessionKey)?.agentId ?? null;
    const selection = initialProjectId
      ? { projectId: initialProjectId, sessionKey: null as string | null }
      : this.adapter.getDefaultSelection();
    this.applySnapshot(await this.adapter.snapshot(selection));
    this.ready = true;
  }

  private applySnapshot(snapshot: WorkbenchSnapshot) {
    this.assistantName = snapshot.assistantName;
    this.workbenchSelectedProjectId = snapshot.currentProjectId;
    this.agentsList = snapshot.agentsList;
    this.agentIdentityById = snapshot.agentIdentityById;
    this.agentFilesList = snapshot.agentFilesList;
    this.sessionsResult = snapshot.sessionsResult;
    this.chatMessages = snapshot.chatMessages;
    this.skillsReport = snapshot.skillsReport;
    this.cronJobs = snapshot.cronJobs;
    this.chatModelCatalog = snapshot.modelCatalog;
    this.toolsCatalogResult = snapshot.toolsCatalogResult;
    if (snapshot.currentProjectId && !this.expandedProjectIds.includes(snapshot.currentProjectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, snapshot.currentProjectId];
    }
  }

  private async refreshSnapshot(
    sessionKey = this.workbenchSelectedSessionKey,
    projectId = this.workbenchSelectedProjectId,
  ) {
    const snapshot = await this.adapter.snapshot({
      projectId,
      sessionKey,
    });
    this.applySnapshot(snapshot);
  }

  private persistSettings(patch: Partial<UiSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.themeResolved = applyTheme(this.settings);
  }

  private clearRunTimer() {
    if (this.runTimer !== null) {
      window.clearTimeout(this.runTimer);
      this.runTimer = null;
    }
  }

  private startPrototypeRun(sessionKey: string, projectId: string, replyText: string) {
    this.clearRunTimer();
    this.chatSending = true;
    this.chatRunId = generateUUID();
    this.chatStream = replyText;
    void this.refreshSnapshot(sessionKey, projectId);
    this.runTimer = window.setTimeout(() => {
      void (async () => {
        await this.adapter.completeAssistantReply(sessionKey, replyText);
        this.chatSending = false;
        this.chatRunId = null;
        this.chatStream = null;
        await this.refreshSnapshot(sessionKey, projectId);
        this.runTimer = null;
      })();
    }, 720);
  }

  private async enterNewTask() {
    this.workbenchSection = "newTask";
    this.workbenchSelectedSessionKey = null;
    this.newTaskProjectMenuOpen = false;
    const projectId = this.workbenchSelectedProjectId ?? this.agentsList?.defaultId ?? null;
    this.persistSettings({
      sessionKey: "",
      lastActiveSessionKey: "",
    });
    await this.refreshSnapshot(null, projectId);
  }

  private async selectProject(projectId: string) {
    this.workbenchSection = "newTask";
    this.workbenchSelectedProjectId = projectId;
    this.workbenchSelectedSessionKey = null;
    this.newTaskProjectMenuOpen = false;
    if (!this.expandedProjectIds.includes(projectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, projectId];
    }
    this.persistSettings({
      sessionKey: "",
      lastActiveSessionKey: "",
    });
    await this.refreshSnapshot(null, projectId);
  }

  private async selectSession(sessionKey: string) {
    const projectId =
      parseAgentSessionKey(sessionKey)?.agentId ?? this.workbenchSelectedProjectId ?? null;
    this.workbenchSection = "newTask";
    this.workbenchSelectedSessionKey = sessionKey;
    this.workbenchSelectedProjectId = projectId;
    this.rightRailCollapsed = false;
    this.newTaskProjectMenuOpen = false;
    if (projectId && !this.expandedProjectIds.includes(projectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, projectId];
    }
    this.persistSettings({
      sessionKey,
      lastActiveSessionKey: sessionKey,
    });
    await this.refreshSnapshot(sessionKey, projectId);
  }

  private openProjectFolderPicker() {
    const input = this.querySelector<HTMLInputElement>("[data-project-folder-input]");
    input?.click();
  }

  private openChatFilePicker() {
    const input = this.querySelector<HTMLInputElement>("[data-chat-file-input]");
    input?.click();
  }

  private async handleProjectFolderSelection(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const projectId = await this.adapter.createProjectFromFolder(files);
    input.value = "";
    if (projectId) {
      await this.selectProject(projectId);
    }
  }

  private handleChatFileSelection(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      // Prototype stage: open file picker now, upload wiring comes with API integration.
      this.lastError = null;
    }
    input.value = "";
  }

  private async startTask(projectId: string) {
    const prompt = this.chatMessage.trim();
    if (!prompt) {
      return;
    }
    const { sessionKey, replyText } = await this.adapter.startTask(
      projectId,
      prompt,
      this.currentModelId,
    );
    this.chatMessage = "";
    this.workbenchSelectedProjectId = projectId;
    this.workbenchSelectedSessionKey = sessionKey;
    this.rightRailCollapsed = false;
    this.persistSettings({
      sessionKey,
      lastActiveSessionKey: sessionKey,
    });
    this.startPrototypeRun(sessionKey, projectId, replyText);
  }

  private async sendCurrentMessage() {
    const prompt = this.chatMessage.trim();
    if (!prompt) {
      return;
    }
    const projectId =
      this.workbenchSelectedProjectId ??
      parseAgentSessionKey(this.workbenchSelectedSessionKey ?? "")?.agentId ??
      this.agentsList?.defaultId ??
      null;
    if (!projectId) {
      return;
    }
    if (!this.workbenchSelectedSessionKey) {
      await this.startTask(projectId);
      return;
    }
    const { sessionKey, replyText } = await this.adapter.addUserMessage(
      this.workbenchSelectedSessionKey,
      prompt,
      this.currentModelId,
    );
    this.chatMessage = "";
    this.workbenchSelectedSessionKey = sessionKey;
    this.persistSettings({
      sessionKey,
      lastActiveSessionKey: sessionKey,
    });
    this.startPrototypeRun(sessionKey, projectId, replyText);
  }

  private abortCurrentRun() {
    this.clearRunTimer();
    this.chatSending = false;
    this.chatRunId = null;
    this.chatStream = null;
    void this.refreshSnapshot();
  }

  private async saveSkillKey(skillKey: string) {
    this.skillsBusyKey = skillKey;
    const result = await this.adapter.saveSkillKey(skillKey, this.skillEdits[skillKey] ?? "");
    this.skillMessages = {
      ...this.skillMessages,
      [skillKey]: {
        kind: result.ok ? "success" : "error",
        message: result.message,
      },
    };
    await this.refreshSnapshot();
    this.skillsBusyKey = null;
  }

  private async installSkill(skillKey: string) {
    this.skillsBusyKey = skillKey;
    const result = await this.adapter.installSkill(skillKey);
    this.skillMessages = {
      ...this.skillMessages,
      [skillKey]: {
        kind: result.ok ? "success" : "error",
        message: result.message,
      },
    };
    await this.refreshSnapshot();
    this.skillsBusyKey = null;
  }

  private renderView() {
    if (!this.ready) {
      return html`
        <div class="workbench workbench--light">
          <div class="workbench-main">
            <section class="workbench-panel">
              <div class="workbench-panel__header">
                <div>
                  <h3>Power UI</h3>
                  <p>Booting mock workbench adapter...</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      `;
    }

    return renderWorkbench({
      assistantName: this.assistantName,
      currentProjectId: this.workbenchSelectedProjectId,
      currentSessionKey: this.workbenchSelectedSessionKey ?? "",
      currentModelId: this.currentModelId,
      newTaskProjectId: this.workbenchSelectedProjectId,
      newTaskProjectMenuOpen: this.newTaskProjectMenuOpen,
      sidebarCollapsed: this.sidebarCollapsed,
      projectsCollapsed: this.projectsCollapsed,
      rightRailCollapsed: this.rightRailCollapsed,
      expandedProjectIds: this.expandedProjectIds,
      agentsList: this.agentsList,
      agentIdentityById: this.agentIdentityById,
      agentFilesList: this.agentFilesList,
      agentFilesLoading: false,
      agentFilesError: null,
      sessionsResult: this.sessionsResult,
      chatMessages: this.chatMessages,
      chatMessage: this.chatMessage,
      chatSending: this.chatSending,
      chatRunId: this.chatRunId,
      chatStream: this.chatStream,
      lastError: this.lastError,
      toolsCatalogResult: this.toolsCatalogResult,
      toolsCatalogLoading: false,
      toolsCatalogError: null,
      skillsReport: this.skillsReport,
      skillsLoading: false,
      skillsError: null,
      skillsFilter: this.skillsFilter,
      skillsBusyKey: this.skillsBusyKey,
      skillMessages: this.skillMessages,
      skillEdits: this.skillEdits,
      cronJobs: this.cronJobs,
      cronLoading: false,
      cronError: null,
      modelCatalog: this.chatModelCatalog,
      modelsLoading: false,
      themeResolved: this.themeResolved,
      settings: {
        gatewayUrl: this.settings.gatewayUrl,
        theme: this.settings.theme,
        themeMode: this.settings.themeMode,
        locale: this.settings.locale,
      },
      section: this.workbenchSection,
      toolsOpen: this.workbenchToolsOpen,
      toolQuery: this.workbenchToolQuery,
      toolsCategory: this.workbenchToolsCategory,
      settingsOpen: this.workbenchSettingsOpen,
      settingsTab: this.workbenchSettingsTab,
      onNavigateLegacy: () => {
        const base = this.basePath || "";
        window.location.href = `${base}/overview`;
      },
      onSectionChange: (section) => {
        void (async () => {
          if (section === "newTask") {
            await this.enterNewTask();
            return;
          }
          this.workbenchSection = section;
          this.newTaskProjectMenuOpen = false;
        })();
      },
      onSelectProject: (projectId) => {
        void this.selectProject(projectId);
      },
      onSelectSession: (sessionKey) => {
        void this.selectSession(sessionKey);
      },
      onSelectNewTaskProject: (projectId) => {
        void this.selectProject(projectId);
      },
      onToggleNewTaskProjectMenu: () => {
        this.newTaskProjectMenuOpen = !this.newTaskProjectMenuOpen;
      },
      onStartTask: (projectId) => {
        void this.startTask(projectId);
      },
      onOpenAttachment: () => {
        this.openChatFilePicker();
      },
      onComposerChange: (value) => {
        this.chatMessage = value;
      },
      onSend: () => {
        void this.sendCurrentMessage();
      },
      onAbort: () => {
        this.abortCurrentRun();
      },
      onOpenTools: () => {
        this.workbenchToolsOpen = true;
      },
      onCloseTools: () => {
        this.workbenchToolsOpen = false;
      },
      onToolQueryChange: (value) => {
        this.workbenchToolQuery = value;
      },
      onToolsCategoryChange: (value) => {
        this.workbenchToolsCategory = value;
      },
      onOpenSettings: () => {
        this.workbenchSettingsOpen = true;
      },
      onCloseSettings: () => {
        this.workbenchSettingsOpen = false;
      },
      onSettingsTabChange: (value) => {
        this.workbenchSettingsTab = value;
      },
      onModelChange: (value) => {
        this.currentModelId = value;
      },
      onCreateProject: () => {
        this.newTaskProjectMenuOpen = false;
        this.openProjectFolderPicker();
      },
      onToggleSidebar: () => {
        this.sidebarCollapsed = !this.sidebarCollapsed;
      },
      onToggleProjects: () => {
        this.projectsCollapsed = !this.projectsCollapsed;
      },
      onToggleRightRail: () => {
        this.rightRailCollapsed = !this.rightRailCollapsed;
      },
      onToggleProject: (projectId) => {
        this.expandedProjectIds = this.expandedProjectIds.includes(projectId)
          ? this.expandedProjectIds.filter((id) => id !== projectId)
          : [...this.expandedProjectIds, projectId];
      },
      onRefreshContext: () => {
        void this.refreshSnapshot();
      },
      onRefreshSkills: () => {
        void this.refreshSnapshot();
      },
      onSkillsFilterChange: (value) => {
        this.skillsFilter = value;
      },
      onToggleSkill: (skillKey, enabled) => {
        void (async () => {
          await this.adapter.setSkillEnabled(skillKey, enabled);
          await this.refreshSnapshot();
        })();
      },
      onEditSkillKey: (skillKey, value) => {
        this.skillEdits = {
          ...this.skillEdits,
          [skillKey]: value,
        };
      },
      onSaveSkillKey: (skillKey) => {
        void this.saveSkillKey(skillKey);
      },
      onInstallSkill: (skillKey) => {
        void this.installSkill(skillKey);
      },
    });
  }

  protected override render() {
    const view = this.renderView();
    return html`
      ${view}
      <input
        hidden
        data-project-folder-input
        type="file"
        webkitdirectory
        multiple
        @change=${(event: Event) => this.handleProjectFolderSelection(event)}
      />
      <input
        hidden
        data-chat-file-input
        type="file"
        multiple
        @change=${(event: Event) => this.handleChatFileSelection(event)}
      />
    `;
  }
}
