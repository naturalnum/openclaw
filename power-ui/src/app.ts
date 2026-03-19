import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { parseAgentSessionKey } from "../../src/routing/session-key.ts";
import {
  i18n,
  I18nController,
  SUPPORTED_LOCALES,
  t,
  type Locale,
} from "../../ui/src/i18n/index.ts";
import { resolveNavigatorLocale } from "../../ui/src/i18n/lib/registry.ts";
import { DEFAULT_CRON_FORM } from "../../ui/src/ui/app-defaults.ts";
import {
  handleChatScroll,
  resetChatScroll,
  scheduleChatScroll,
} from "../../ui/src/ui/app-scroll.ts";
import {
  flushToolStreamSync,
  handleAgentEvent,
  resetToolStream,
  type ToolStreamEntry,
} from "../../ui/src/ui/app-tool-stream.ts";
import { loadChannels } from "../../ui/src/ui/controllers/channels.ts";
import type { ChannelsState } from "../../ui/src/ui/controllers/channels.types.ts";
import {
  abortChatRun,
  handleChatEvent,
  sendChatMessage,
} from "../../ui/src/ui/controllers/chat.ts";
import {
  addCronJob,
  cancelCronEdit,
  getVisibleCronJobs,
  hasCronFormErrors,
  loadCronJobs,
  loadCronModelSuggestions,
  loadCronRuns,
  loadCronStatus,
  loadMoreCronJobs,
  loadMoreCronRuns,
  normalizeCronFormState,
  reloadCronJobs,
  removeCronJob,
  runCronJob,
  startCronClone,
  startCronEdit,
  toggleCronJob,
  updateCronJobsFilter,
  updateCronRunsFilter,
  validateCronForm,
  type CronModelSuggestionsState,
  type CronState,
} from "../../ui/src/ui/controllers/cron.ts";
import {
  installSkill,
  loadSkills,
  saveSkillApiKey,
  updateSkillEdit,
  updateSkillEnabled,
  type SkillsState,
} from "../../ui/src/ui/controllers/skills.ts";
import type { GatewayBrowserClient } from "../../ui/src/ui/gateway.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "../../ui/src/ui/navigation.ts";
import { loadSettings, saveSettings, type UiSettings } from "../../ui/src/ui/storage.ts";
import { resolveTheme, type ThemeMode, type ThemeName } from "../../ui/src/ui/theme.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
  SessionsListResult,
  ToolsCatalogResult,
} from "../../ui/src/ui/types.ts";
import type { ChatAttachment } from "../../ui/src/ui/ui-types.ts";
import {
  resolveConfiguredCronModelSuggestions,
  sortLocaleStrings,
} from "../../ui/src/ui/views/agents-utils.ts";
import { GatewayWorkbenchAdapter } from "./adapters/gateway-workbench-adapter.ts";
import type { WorkbenchSnapshot } from "./adapters/mock-workbench-adapter.ts";
import type { WorkbenchAdapter, WorkbenchAdapterEvent } from "./adapters/workbench-adapter.ts";
import {
  renderWorkbench,
  type WorkbenchModelConfig,
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

const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

const POWER_MODEL_CONFIGS_KEY = "openclaw.power-ui.models.v1";

function createWorkbenchId(): string {
  // Prefer Web Crypto UUID when available; Vite may treat bare `crypto` differently.
  const c = globalThis.crypto;
  const randomUUID = (c as unknown as { randomUUID?: () => string }).randomUUID;
  if (typeof randomUUID === "function") {
    return randomUUID();
  }

  const getRandomValues = (c as unknown as { getRandomValues?: (arr: Uint8Array) => void })
    .getRandomValues;
  if (typeof getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);
    // RFC4122 version 4 UUID
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Final fallback when neither randomUUID nor getRandomValues exist.
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createEmptyModelConfig(): WorkbenchModelConfig {
  return {
    id: createWorkbenchId(),
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
  };
}

function loadModelConfigs(): WorkbenchModelConfig[] {
  try {
    const raw = localStorage.getItem(POWER_MODEL_CONFIGS_KEY);
    if (!raw) {
      return [createEmptyModelConfig()];
    }
    const parsed = JSON.parse(raw) as WorkbenchModelConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createEmptyModelConfig()];
    }
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id : createWorkbenchId(),
        name: typeof entry.name === "string" ? entry.name : "",
        baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : "",
        apiKey: typeof entry.apiKey === "string" ? entry.apiKey : "",
        model: typeof entry.model === "string" ? entry.model : "",
      }));
  } catch {
    return [createEmptyModelConfig()];
  }
}

function persistModelConfigs(configs: WorkbenchModelConfig[]) {
  localStorage.setItem(POWER_MODEL_CONFIGS_KEY, JSON.stringify(configs));
}

@customElement("openclaw-power-app")
export class OpenClawPowerApp extends LitElement {
  private i18nController = new I18nController(this);
  private adapter: WorkbenchAdapter = new GatewayWorkbenchAdapter({
    getSettings: () => ({
      gatewayUrl: this.settings.gatewayUrl,
      token: this.settings.token,
    }),
  });
  private adapterUnsubscribe: (() => void) | null = null;
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
  private readonly controllerClient = {
    request: async <T>(method: string, params?: unknown) =>
      await this.adapter.request<T>(method, params),
  } as GatewayBrowserClient;
  readonly client: GatewayBrowserClient | null = this.controllerClient;
  private readonly skillsState: SkillsState = {
    client: this.controllerClient,
    connected: false,
    skillsLoading: false,
    skillsReport: null,
    skillsError: null,
    skillsBusyKey: null,
    skillEdits: {},
    skillMessages: {},
  };
  private readonly channelsState: ChannelsState = {
    client: this.controllerClient,
    connected: false,
    channelsLoading: false,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    whatsappLoginMessage: null,
    whatsappLoginQrDataUrl: null,
    whatsappLoginConnected: null,
    whatsappBusy: false,
  };
  private readonly cronState: CronState & CronModelSuggestionsState = {
    client: this.controllerClient,
    connected: false,
    cronLoading: false,
    cronJobsLoadingMore: false,
    cronJobs: [],
    cronJobsTotal: 0,
    cronJobsHasMore: false,
    cronJobsNextOffset: null,
    cronJobsLimit: 100,
    cronJobsQuery: "",
    cronJobsEnabledFilter: "all",
    cronJobsScheduleKindFilter: "all",
    cronJobsLastStatusFilter: "all",
    cronJobsSortBy: "nextRunAtMs",
    cronJobsSortDir: "asc",
    cronStatus: null,
    cronError: null,
    cronForm: { ...DEFAULT_CRON_FORM },
    cronFieldErrors: validateCronForm(DEFAULT_CRON_FORM),
    cronEditingJobId: null,
    cronRunsJobId: null,
    cronRunsLoadingMore: false,
    cronRuns: [],
    cronRunsTotal: 0,
    cronRunsHasMore: false,
    cronRunsNextOffset: null,
    cronRunsLimit: 100,
    cronRunsScope: "all",
    cronRunsStatuses: [],
    cronRunsDeliveryStatuses: [],
    cronRunsStatusFilter: "all",
    cronRunsQuery: "",
    cronRunsSortDir: "desc",
    cronBusy: false,
    cronModelSuggestions: [],
  };

  createRenderRoot() {
    return this;
  }

  @state() ready = false;
  @state() connected = false;
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
  @state() workbenchSettingsTab: WorkbenchSettingsTab = "general";
  @state() modelConfigs: WorkbenchModelConfig[] = loadModelConfigs();

  @state() agentsList: AgentsListResult | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() chatLoading = false;
  @state() chatThinkingLevel: string | null = null;
  @state() chatMessages: unknown[] = [];
  @state() chatMessage = "";
  @state() chatAttachments: ChatAttachment[] = [];
  @state() chatSending = false;
  @state() chatRunId: string | null = null;
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatToolMessages: unknown[] = [];
  @state() chatStreamSegments: Array<{ text: string; ts: number }> = [];
  @state() toolsCatalogResult: ToolsCatalogResult | null = null;
  @state() chatModelCatalog: ModelCatalogEntry[] = [];

  constructor() {
    super();
    if (this.settings.locale) {
      void i18n.setLocale(this.settings.locale as Locale);
    }
  }
  private toolStreamSyncTimer: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  chatScrollFrame: number | null = null;
  chatScrollTimeout: number | null = null;
  chatHasAutoScrolled = false;
  chatUserNearBottom = true;
  chatNewMessagesBelow = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.adapterUnsubscribe = this.adapter.subscribe((event) => {
      this.handleAdapterEvent(event);
    });
    void this.bootstrap();
  }

  disconnectedCallback() {
    this.adapterUnsubscribe?.();
    this.adapterUnsubscribe = null;
    this.adapter.dispose?.();
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    super.disconnectedCallback();
  }

  private get sessionKey() {
    return this.workbenchSelectedSessionKey ?? "";
  }

  private async bootstrap() {
    try {
      const initialSessionKey =
        this.settings.sessionKey.trim() || this.settings.lastActiveSessionKey.trim() || null;
      const initialProjectId = initialSessionKey
        ? (parseAgentSessionKey(initialSessionKey)?.agentId ?? null)
        : null;
      const selection = initialSessionKey
        ? { projectId: initialProjectId, sessionKey: initialSessionKey }
        : this.adapter.getDefaultSelection();
      this.applySnapshot(await this.adapter.snapshot(selection));
      this.connected = true;
      this.lastError = null;
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.ready = true;
  }

  private applySnapshot(snapshot: WorkbenchSnapshot) {
    resetToolStream(this as unknown as Parameters<typeof resetToolStream>[0]);
    this.assistantName = snapshot.assistantName;
    this.workbenchSelectedProjectId = snapshot.currentProjectId;
    this.agentsList = snapshot.agentsList;
    this.agentIdentityById = snapshot.agentIdentityById;
    this.agentFilesList = snapshot.agentFilesList;
    this.sessionsResult = snapshot.sessionsResult;
    this.chatMessages = snapshot.chatMessages;
    this.skillsState.skillsReport = snapshot.skillsReport;
    this.cronState.cronJobs = snapshot.cronJobs;
    this.cronState.cronJobsTotal = snapshot.cronJobs.length;
    this.chatModelCatalog = snapshot.modelCatalog;
    this.toolsCatalogResult = snapshot.toolsCatalogResult;
    this.currentModelId =
      snapshot.modelCatalog.find((model) => model.id === this.currentModelId)?.id ??
      snapshot.modelCatalog[0]?.id ??
      this.currentModelId;
    this.skillsState.connected = true;
    this.channelsState.connected = true;
    this.cronState.connected = true;
    if (snapshot.currentProjectId && !this.expandedProjectIds.includes(snapshot.currentProjectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, snapshot.currentProjectId];
    }
    scheduleChatScroll(this as unknown as Parameters<typeof scheduleChatScroll>[0], false, false);
  }

  private async refreshSnapshot(
    sessionKey = this.workbenchSelectedSessionKey,
    projectId = this.workbenchSelectedProjectId,
  ) {
    try {
      const snapshot = await this.adapter.snapshot({
        projectId,
        sessionKey,
      });
      this.applySnapshot(snapshot);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async runControllerAction<T>(action: Promise<T>) {
    this.requestUpdate();
    try {
      return await action;
    } finally {
      this.requestUpdate();
    }
  }

  private getCronAgentSuggestions() {
    return sortLocaleStrings(
      new Set(
        [
          ...(this.agentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
          ...this.cronState.cronJobs
            .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
            .filter(Boolean),
        ].filter(Boolean),
      ),
    );
  }

  private getCronModelSuggestions() {
    return sortLocaleStrings(
      new Set(
        [
          ...this.cronState.cronModelSuggestions,
          ...resolveConfiguredCronModelSuggestions(null),
          ...this.cronState.cronJobs
            .map((job) => {
              if (job.payload.kind !== "agentTurn" || typeof job.payload.model !== "string") {
                return "";
              }
              return job.payload.model.trim();
            })
            .filter(Boolean),
        ].filter(Boolean),
      ),
    );
  }

  private getAccountSuggestions(selectedDeliveryChannel: string) {
    const accountToSuggestions = (
      selectedDeliveryChannel === "last"
        ? Object.values(this.channelsState.channelsSnapshot?.channelAccounts ?? {}).flat()
        : (this.channelsState.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
    )
      .flatMap((account) => [
        normalizeSuggestionValue(account.accountId),
        normalizeSuggestionValue(account.name),
      ])
      .filter(Boolean);
    return uniquePreserveOrder(accountToSuggestions);
  }

  private getDeliveryToSuggestions(accountSuggestions: string[]) {
    const jobToSuggestions = this.cronState.cronJobs
      .map((job) => normalizeSuggestionValue(job.delivery?.to))
      .filter(Boolean);
    const rawDeliveryToSuggestions = uniquePreserveOrder([
      ...jobToSuggestions,
      ...accountSuggestions,
    ]);
    return this.cronState.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;
  }

  private async loadSkillsPage(clearMessages = false) {
    await this.runControllerAction(loadSkills(this.skillsState, { clearMessages }));
  }

  private async loadAutomationsPage() {
    await this.runControllerAction(
      Promise.all([
        loadChannels(this.channelsState, false),
        loadCronStatus(this.cronState),
        loadCronJobs(this.cronState),
        loadCronModelSuggestions(this.cronState),
        loadCronRuns(
          this.cronState,
          this.cronState.cronRunsScope === "job" ? this.cronState.cronRunsJobId : null,
        ),
      ]),
    );
  }

  private persistSettings(patch: Partial<UiSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.themeResolved = applyTheme(this.settings);
  }

  private async setLocale(next: string) {
    const locale = next.trim();
    await i18n.setLocale((locale || resolveNavigatorLocale(navigator.language || "en")) as Locale);
    this.persistSettings({ locale: locale || undefined });
    this.requestUpdate();
  }

  private setThemeName(next: string) {
    this.persistSettings({ theme: next as ThemeName });
  }

  private setThemeMode(next: string) {
    this.persistSettings({ themeMode: next as ThemeMode });
  }

  private updateModelConfig(
    id: string,
    field: "name" | "baseUrl" | "apiKey" | "model",
    value: string,
  ) {
    this.modelConfigs = this.modelConfigs.map((entry) =>
      entry.id === id ? { ...entry, [field]: value } : entry,
    );
    persistModelConfigs(this.modelConfigs);
  }

  private addModelConfig() {
    this.modelConfigs = [...this.modelConfigs, createEmptyModelConfig()];
    persistModelConfigs(this.modelConfigs);
  }

  private removeModelConfig(id: string) {
    const next = this.modelConfigs.filter((entry) => entry.id !== id);
    this.modelConfigs = next.length > 0 ? next : [createEmptyModelConfig()];
    persistModelConfigs(this.modelConfigs);
  }

  private async enterNewTask() {
    this.workbenchSection = "newTask";
    this.workbenchSelectedSessionKey = null;
    this.newTaskProjectMenuOpen = false;
    resetToolStream(this as unknown as Parameters<typeof resetToolStream>[0]);
    resetChatScroll(this as unknown as Parameters<typeof resetChatScroll>[0]);
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
    resetToolStream(this as unknown as Parameters<typeof resetToolStream>[0]);
    resetChatScroll(this as unknown as Parameters<typeof resetChatScroll>[0]);
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
    resetToolStream(this as unknown as Parameters<typeof resetToolStream>[0]);
    resetChatScroll(this as unknown as Parameters<typeof resetChatScroll>[0]);
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
    let projectId: string | null = null;
    try {
      projectId = await this.adapter.createProjectFromFolder(files);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
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

  private handleComposerKeyDown(event: KeyboardEvent) {
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.sendCurrentMessage();
    }
  }

  private handleChatScrollEvent(event: Event) {
    handleChatScroll(this as unknown as Parameters<typeof handleChatScroll>[0], event);
  }

  private async sendViaChatController(projectId: string) {
    const prompt = this.chatMessage.trim();
    if (!prompt) {
      return;
    }
    const runId = await sendChatMessage(
      this as unknown as Parameters<typeof sendChatMessage>[0],
      prompt,
    );
    if (!runId) {
      return;
    }
    this.chatMessage = "";
    this.persistSettings({
      sessionKey: this.workbenchSelectedSessionKey ?? "",
      lastActiveSessionKey: this.workbenchSelectedSessionKey ?? "",
    });
    scheduleChatScroll(this as unknown as Parameters<typeof scheduleChatScroll>[0], true, false);
    void this.refreshSnapshot(this.workbenchSelectedSessionKey, projectId);
  }

  private async startTask(projectId: string) {
    const prompt = this.chatMessage.trim();
    if (!prompt) {
      return;
    }
    this.lastError = null;
    try {
      const { sessionKey } = await this.adapter.startTask(projectId, prompt, this.currentModelId);
      this.workbenchSelectedProjectId = projectId;
      this.workbenchSelectedSessionKey = sessionKey;
      this.rightRailCollapsed = false;
      resetToolStream(this as unknown as Parameters<typeof resetToolStream>[0]);
      resetChatScroll(this as unknown as Parameters<typeof resetChatScroll>[0]);
      this.persistSettings({
        sessionKey,
        lastActiveSessionKey: sessionKey,
      });
      await this.refreshSnapshot(sessionKey, projectId);
      await this.sendViaChatController(projectId);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
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
    this.lastError = null;
    try {
      await this.adapter.request("sessions.patch", {
        key: this.workbenchSelectedSessionKey,
        model: this.currentModelId || null,
      });
      await this.sendViaChatController(projectId);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async abortCurrentRun() {
    try {
      await abortChatRun(this as unknown as Parameters<typeof abortChatRun>[0]);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    void this.refreshSnapshot();
  }

  private handleAdapterEvent(event: WorkbenchAdapterEvent) {
    if (event.type === "connection") {
      this.connected = event.connected;
      this.skillsState.connected = event.connected;
      this.channelsState.connected = event.connected;
      this.cronState.connected = event.connected;
      if (!event.connected && event.error) {
        this.lastError = event.error;
      }
      this.requestUpdate();
      return;
    }

    if (event.type === "agent") {
      handleAgentEvent(this as unknown as Parameters<typeof handleAgentEvent>[0], event.payload);
      return;
    }

    if (event.type !== "chat") {
      return;
    }

    const projectId =
      parseAgentSessionKey(event.sessionKey)?.agentId ?? this.workbenchSelectedProjectId ?? null;
    const nextState = handleChatEvent(this as unknown as Parameters<typeof handleChatEvent>[0], {
      runId: event.runId ?? "",
      sessionKey: event.sessionKey,
      state: event.state,
      message: event.message,
      errorMessage: event.errorMessage ?? undefined,
    });
    if (this.workbenchSelectedSessionKey === event.sessionKey) {
      if (event.state === "final" || event.state === "aborted" || event.state === "error") {
        flushToolStreamSync(this as unknown as Parameters<typeof flushToolStreamSync>[0]);
      }
      scheduleChatScroll(
        this as unknown as Parameters<typeof scheduleChatScroll>[0],
        false,
        event.state === "delta",
      );
    }
    if (nextState === "final" || nextState === "aborted" || nextState === "error") {
      void this.refreshSnapshot(event.sessionKey, projectId);
    }
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
                  <p>Connecting to Gateway...</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      `;
    }

    const visibleCronJobs = getVisibleCronJobs(this.cronState);
    const selectedDeliveryChannel =
      this.cronState.cronForm.deliveryChannel && this.cronState.cronForm.deliveryChannel.trim()
        ? this.cronState.cronForm.deliveryChannel.trim()
        : "last";
    const accountSuggestions = this.getAccountSuggestions(selectedDeliveryChannel);
    const deliveryToSuggestions = this.getDeliveryToSuggestions(accountSuggestions);

    return renderWorkbench({
      basePath: this.basePath,
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
      chatStreamStartedAt: this.chatStreamStartedAt,
      chatToolMessages: this.chatToolMessages,
      chatStreamSegments: this.chatStreamSegments,
      lastError: this.lastError,
      toolsCatalogResult: this.toolsCatalogResult,
      toolsCatalogLoading: false,
      toolsCatalogError: null,
      skillsPage: {
        connected: this.skillsState.connected,
        loading: this.skillsState.skillsLoading,
        report: this.skillsState.skillsReport,
        error: this.skillsState.skillsError,
        filter: "",
        edits: this.skillsState.skillEdits,
        busyKey: this.skillsState.skillsBusyKey,
        messages: this.skillsState.skillMessages,
        onFilterChange: (next) => {
          this.requestUpdate();
          void next;
        },
        onRefresh: () => {
          void this.loadSkillsPage(true);
        },
        onToggle: (skillKey, enabled) => {
          void this.runControllerAction(updateSkillEnabled(this.skillsState, skillKey, enabled));
        },
        onEdit: (skillKey, value) => {
          updateSkillEdit(this.skillsState, skillKey, value);
          this.requestUpdate();
        },
        onSaveKey: (skillKey) => {
          void this.runControllerAction(saveSkillApiKey(this.skillsState, skillKey));
        },
        onInstall: (skillKey, name, installId) => {
          void this.runControllerAction(installSkill(this.skillsState, skillKey, name, installId));
        },
      },
      automationsPage: {
        basePath: this.basePath,
        loading: this.cronState.cronLoading,
        status: this.cronState.cronStatus,
        jobs: visibleCronJobs,
        jobsLoadingMore: this.cronState.cronJobsLoadingMore,
        jobsTotal: this.cronState.cronJobsTotal,
        jobsHasMore: this.cronState.cronJobsHasMore,
        jobsQuery: this.cronState.cronJobsQuery,
        jobsEnabledFilter: this.cronState.cronJobsEnabledFilter,
        jobsScheduleKindFilter: this.cronState.cronJobsScheduleKindFilter,
        jobsLastStatusFilter: this.cronState.cronJobsLastStatusFilter,
        jobsSortBy: this.cronState.cronJobsSortBy,
        jobsSortDir: this.cronState.cronJobsSortDir,
        error: this.cronState.cronError,
        busy: this.cronState.cronBusy,
        form: this.cronState.cronForm,
        fieldErrors: this.cronState.cronFieldErrors,
        canSubmit: !hasCronFormErrors(this.cronState.cronFieldErrors),
        editingJobId: this.cronState.cronEditingJobId,
        channels: this.channelsState.channelsSnapshot?.channelMeta?.length
          ? this.channelsState.channelsSnapshot.channelMeta.map((entry) => entry.id)
          : (this.channelsState.channelsSnapshot?.channelOrder ?? []),
        channelLabels: this.channelsState.channelsSnapshot?.channelLabels ?? {},
        channelMeta: this.channelsState.channelsSnapshot?.channelMeta ?? [],
        runsJobId: this.cronState.cronRunsJobId,
        runs: this.cronState.cronRuns,
        runsTotal: this.cronState.cronRunsTotal,
        runsHasMore: this.cronState.cronRunsHasMore,
        runsLoadingMore: this.cronState.cronRunsLoadingMore,
        runsScope: this.cronState.cronRunsScope,
        runsStatuses: this.cronState.cronRunsStatuses,
        runsDeliveryStatuses: this.cronState.cronRunsDeliveryStatuses,
        runsStatusFilter: this.cronState.cronRunsStatusFilter,
        runsQuery: this.cronState.cronRunsQuery,
        runsSortDir: this.cronState.cronRunsSortDir,
        agentSuggestions: this.getCronAgentSuggestions(),
        modelSuggestions: this.getCronModelSuggestions(),
        thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
        timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
        deliveryToSuggestions,
        accountSuggestions,
        onFormChange: (patch) => {
          this.cronState.cronForm = normalizeCronFormState({
            ...this.cronState.cronForm,
            ...patch,
          });
          this.cronState.cronFieldErrors = validateCronForm(this.cronState.cronForm);
          this.requestUpdate();
        },
        onRefresh: () => {
          void this.loadAutomationsPage();
        },
        onAdd: () => {
          void this.runControllerAction(addCronJob(this.cronState));
        },
        onEdit: (job) => {
          startCronEdit(this.cronState, job);
          this.requestUpdate();
        },
        onClone: (job) => {
          startCronClone(this.cronState, job);
          this.requestUpdate();
        },
        onCancelEdit: () => {
          cancelCronEdit(this.cronState);
          this.requestUpdate();
        },
        onToggle: (job, enabled) => {
          void this.runControllerAction(toggleCronJob(this.cronState, job, enabled));
        },
        onRun: (job, mode) => {
          void this.runControllerAction(runCronJob(this.cronState, job, mode ?? "force"));
        },
        onRemove: (job) => {
          void this.runControllerAction(removeCronJob(this.cronState, job));
        },
        onLoadRuns: (jobId) => {
          void this.runControllerAction(
            (async () => {
              updateCronRunsFilter(this.cronState, { cronRunsScope: "job" });
              await loadCronRuns(this.cronState, jobId);
            })(),
          );
        },
        onLoadMoreJobs: () => {
          void this.runControllerAction(loadMoreCronJobs(this.cronState));
        },
        onJobsFiltersChange: (patch) => {
          void this.runControllerAction(
            (async () => {
              updateCronJobsFilter(this.cronState, patch);
              const shouldReload =
                typeof patch.cronJobsQuery === "string" ||
                Boolean(patch.cronJobsEnabledFilter) ||
                Boolean(patch.cronJobsSortBy) ||
                Boolean(patch.cronJobsSortDir);
              if (shouldReload) {
                await reloadCronJobs(this.cronState);
              }
            })(),
          );
        },
        onJobsFiltersReset: () => {
          void this.runControllerAction(
            (async () => {
              updateCronJobsFilter(this.cronState, {
                cronJobsQuery: "",
                cronJobsEnabledFilter: "all",
                cronJobsScheduleKindFilter: "all",
                cronJobsLastStatusFilter: "all",
                cronJobsSortBy: "nextRunAtMs",
                cronJobsSortDir: "asc",
              });
              await reloadCronJobs(this.cronState);
            })(),
          );
        },
        onLoadMoreRuns: () => {
          void this.runControllerAction(loadMoreCronRuns(this.cronState));
        },
        onRunsFiltersChange: (patch) => {
          void this.runControllerAction(
            (async () => {
              updateCronRunsFilter(this.cronState, patch);
              if (this.cronState.cronRunsScope === "all") {
                await loadCronRuns(this.cronState, null);
                return;
              }
              await loadCronRuns(this.cronState, this.cronState.cronRunsJobId);
            })(),
          );
        },
      },
      modelCatalog: this.chatModelCatalog,
      modelsLoading: false,
      themeResolved: this.themeResolved,
      settings: {
        gatewayUrl: this.settings.gatewayUrl,
        theme: this.settings.theme,
        themeMode: this.settings.themeMode,
        locale: this.settings.locale,
      },
      settingsView: {
        localeOptions: [
          { value: "", label: "Auto" },
          ...SUPPORTED_LOCALES.map((locale) => ({
            value: locale,
            label:
              locale === "zh-CN"
                ? "简体中文"
                : locale === "zh-TW"
                  ? "繁體中文"
                  : t(
                      `languages.${locale === "pt-BR" ? "ptBR" : locale === "zh-CN" ? "zhCN" : locale === "zh-TW" ? "zhTW" : locale}`,
                    ),
          })),
        ],
        modelConfigs: this.modelConfigs,
        onLocaleChange: (value) => {
          void this.setLocale(value);
        },
        onThemeChange: (value) => {
          this.setThemeName(value);
        },
        onThemeModeChange: (value) => {
          this.setThemeMode(value);
        },
        onModelConfigChange: (id, field, value) => {
          this.updateModelConfig(id, field, value);
        },
        onAddModelConfig: () => {
          this.addModelConfig();
        },
        onRemoveModelConfig: (id) => {
          this.removeModelConfig(id);
        },
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
          if (section === "skills") {
            await this.loadSkillsPage(true);
            return;
          }
          if (section === "automations") {
            await this.loadAutomationsPage();
          }
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
      onComposerKeyDown: (event) => {
        this.handleComposerKeyDown(event);
      },
      onChatScroll: (event) => {
        this.handleChatScrollEvent(event);
      },
      onSend: () => {
        void this.sendCurrentMessage();
      },
      onAbort: () => {
        void this.abortCurrentRun();
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
