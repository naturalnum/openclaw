import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { parseAgentSessionKey } from "../../src/routing/session-key.ts";
import { i18n, I18nController, type Locale } from "../../ui/src/i18n/index.ts";
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
  type ChatState,
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
import {
  resolveConfiguredCronModelSuggestions,
  sortLocaleStrings,
} from "../../ui/src/ui/views/agents-utils.ts";
import { GatewayWorkbenchAdapter } from "./adapters/gateway-workbench-adapter.ts";
import type { WorkbenchSnapshot } from "./adapters/mock-workbench-adapter.ts";
import type {
  WorkbenchAdapter,
  WorkbenchAdapterEvent,
  WorkbenchDirectoryEntry,
} from "./adapters/workbench-adapter.ts";
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

function resolveInitialSettings(settings: UiSettings): {
  settings: UiSettings;
  urlSessionKey: string | null;
} {
  if (typeof window === "undefined") {
    return { settings, urlSessionKey: null };
  }
  if (!window.location.search && !window.location.hash) {
    return { settings, urlSessionKey: null };
  }
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  let nextSettings = settings;
  let urlSessionKey: string | null = null;
  let shouldCleanUrl = false;

  if (params.has("token")) {
    const token = params.get("token")?.trim() ?? "";
    if (token && token !== nextSettings.token) {
      nextSettings = { ...nextSettings, token };
    }
    params.delete("token");
    shouldCleanUrl = true;
  }

  if (hashParams.has("token")) {
    const token = hashParams.get("token")?.trim() ?? "";
    if (token && token !== nextSettings.token) {
      nextSettings = { ...nextSettings, token };
    }
    hashParams.delete("token");
    shouldCleanUrl = true;
  }

  const sessionRaw = params.get("session") ?? hashParams.get("session");
  if (sessionRaw != null) {
    const sessionKey = sessionRaw.trim();
    if (sessionKey) {
      urlSessionKey = sessionKey;
      nextSettings = {
        ...nextSettings,
        sessionKey,
        lastActiveSessionKey: sessionKey,
      };
    }
    params.delete("session");
    hashParams.delete("session");
    shouldCleanUrl = true;
  }

  if (params.has("gatewayUrl")) {
    const gatewayUrl = params.get("gatewayUrl")?.trim() ?? "";
    if (gatewayUrl) {
      nextSettings = { ...nextSettings, gatewayUrl };
    }
    params.delete("gatewayUrl");
    shouldCleanUrl = true;
  }

  if (hashParams.has("gatewayUrl")) {
    const gatewayUrl = hashParams.get("gatewayUrl")?.trim() ?? "";
    if (gatewayUrl) {
      nextSettings = { ...nextSettings, gatewayUrl };
    }
    hashParams.delete("gatewayUrl");
    shouldCleanUrl = true;
  }

  if (shouldCleanUrl) {
    url.search = params.toString();
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
    window.history.replaceState({}, "", url.toString());
  }

  return { settings: nextSettings, urlSessionKey };
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
const SETTINGS_LOCALE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
] as const;

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
const INITIAL_SETTINGS = resolveInitialSettings(loadSettings());

function createLocalId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `power-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyModelConfig(): WorkbenchModelConfig {
  return {
    id: createLocalId(),
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
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id : createLocalId(),
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

type SessionRuntimeState = ChatState & {
  toolStreamSyncTimer: number | null;
  toolStreamById: Map<string, ToolStreamEntry>;
  toolStreamOrder: string[];
  chatToolMessages: Record<string, unknown>[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatScrollFrame: number | null;
  chatScrollTimeout: number | null;
  chatHasAutoScrolled: boolean;
  chatUserNearBottom: boolean;
  chatNewMessagesBelow: boolean;
  logsScrollFrame: number | null;
  logsAtBottom: boolean;
  topbarObserver: ResizeObserver | null;
};

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
  @state() settings: UiSettings = INITIAL_SETTINGS.settings;
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
  @state() priorityProjectIds: string[] = [];
  @state() workbenchSelectedProjectId: string | null = null;
  @state() workbenchSelectedSessionKey: string | null = null;
  @state() workbenchToolsOpen = false;
  @state() workbenchToolsClosing = false;
  @state() workbenchToolQuery = "";
  @state() workbenchToolsCategory: WorkbenchToolsCategory = "builtIn";
  @state() workbenchSettingsOpen = false;
  @state() workbenchSettingsClosing = false;
  @state() workbenchSettingsTab: WorkbenchSettingsTab = "general";
  @state() modelConfigs: WorkbenchModelConfig[] = loadModelConfigs();
  @state() projectDirectoryDialogOpen = false;
  @state() projectDirectoryDialogClosing = false;
  @state() projectDirectoryLoading = false;
  @state() projectDirectoryError: string | null = null;
  @state() projectDirectoryRoots: WorkbenchDirectoryEntry[] = [];
  @state() projectDirectoryCurrentPath: string | null = null;
  @state() projectDirectoryCurrentName: string | null = null;
  @state() projectDirectoryParentPath: string | null = null;
  @state() projectDirectoryEntries: WorkbenchDirectoryEntry[] = [];
  @state() projectCreateName = "";

  @state() agentsList: AgentsListResult | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() chatMessage = "";
  @state() toolsCatalogResult: ToolsCatalogResult | null = null;
  @state() chatModelCatalog: ModelCatalogEntry[] = [];
  @state() chatRuntimeVersion = 0;

  constructor() {
    super();
    saveSettings(this.settings);
    if (this.settings.locale) {
      void i18n.setLocale(this.settings.locale as Locale);
    }
  }
  private readonly chatRuntimeBySessionKey = new Map<string, SessionRuntimeState>();
  private readonly initialSessionKeyFromUrl = INITIAL_SETTINGS.urlSessionKey;
  private modalCloseTimers = new Map<"tools" | "settings" | "projectDirectory", number>();

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

  private createSessionRuntime(sessionKey: string): SessionRuntimeState {
    return {
      client: this.controllerClient,
      connected: this.connected,
      sessionKey,
      chatLoading: false,
      chatMessages: [],
      chatThinkingLevel: null,
      chatSending: false,
      chatMessage: "",
      chatAttachments: [],
      chatRunId: null,
      chatStream: null,
      chatStreamStartedAt: null,
      lastError: null,
      toolStreamSyncTimer: null,
      toolStreamById: new Map<string, ToolStreamEntry>(),
      toolStreamOrder: [],
      chatToolMessages: [],
      chatStreamSegments: [],
      chatScrollFrame: null,
      chatScrollTimeout: null,
      chatHasAutoScrolled: false,
      chatUserNearBottom: true,
      chatNewMessagesBelow: false,
      logsScrollFrame: null,
      logsAtBottom: true,
      topbarObserver: null,
    };
  }

  private getOrCreateSessionRuntime(sessionKey: string | null): SessionRuntimeState | null {
    const key = sessionKey?.trim() ?? "";
    if (!key) {
      return null;
    }
    let runtime = this.chatRuntimeBySessionKey.get(key);
    if (!runtime) {
      runtime = this.createSessionRuntime(key);
      this.chatRuntimeBySessionKey.set(key, runtime);
    }
    runtime.client = this.controllerClient;
    runtime.connected = this.connected;
    runtime.sessionKey = key;
    return runtime;
  }

  private get activeSessionRuntime() {
    return this.getOrCreateSessionRuntime(this.workbenchSelectedSessionKey);
  }

  private bumpChatRuntime() {
    this.chatRuntimeVersion += 1;
  }

  private createActiveScrollHost(runtime: SessionRuntimeState) {
    return {
      updateComplete: this.updateComplete,
      querySelector: (selectors: string) => this.querySelector(selectors),
      style: this.style,
      get chatScrollFrame() {
        return runtime.chatScrollFrame;
      },
      set chatScrollFrame(value: number | null) {
        runtime.chatScrollFrame = value;
      },
      get chatScrollTimeout() {
        return runtime.chatScrollTimeout;
      },
      set chatScrollTimeout(value: number | null) {
        runtime.chatScrollTimeout = value;
      },
      get chatHasAutoScrolled() {
        return runtime.chatHasAutoScrolled;
      },
      set chatHasAutoScrolled(value: boolean) {
        runtime.chatHasAutoScrolled = value;
      },
      get chatUserNearBottom() {
        return runtime.chatUserNearBottom;
      },
      set chatUserNearBottom(value: boolean) {
        runtime.chatUserNearBottom = value;
      },
      get chatNewMessagesBelow() {
        return runtime.chatNewMessagesBelow;
      },
      set chatNewMessagesBelow(value: boolean) {
        runtime.chatNewMessagesBelow = value;
      },
      get logsScrollFrame() {
        return runtime.logsScrollFrame;
      },
      set logsScrollFrame(value: number | null) {
        runtime.logsScrollFrame = value;
      },
      get logsAtBottom() {
        return runtime.logsAtBottom;
      },
      set logsAtBottom(value: boolean) {
        runtime.logsAtBottom = value;
      },
      get topbarObserver() {
        return runtime.topbarObserver;
      },
      set topbarObserver(value: ResizeObserver | null) {
        runtime.topbarObserver = value;
      },
    };
  }

  private scheduleActiveChatScroll(force = false, smooth = false) {
    const runtime = this.activeSessionRuntime;
    if (!runtime) {
      return;
    }
    scheduleChatScroll(
      this.createActiveScrollHost(runtime) as unknown as Parameters<typeof scheduleChatScroll>[0],
      force,
      smooth,
    );
  }

  private resetSessionRuntimeViewState(sessionKey: string | null) {
    const runtime = this.getOrCreateSessionRuntime(sessionKey);
    if (!runtime) {
      return;
    }
    resetToolStream(runtime as unknown as Parameters<typeof resetToolStream>[0]);
    resetChatScroll(
      this.createActiveScrollHost(runtime) as unknown as Parameters<typeof resetChatScroll>[0],
    );
  }

  private async bootstrap() {
    try {
      const initialSessionKey = this.initialSessionKeyFromUrl?.trim() || null;
      const initialProjectId = initialSessionKey
        ? (parseAgentSessionKey(initialSessionKey)?.agentId ?? null)
        : null;
      const selection = initialSessionKey
        ? { projectId: initialProjectId, sessionKey: initialSessionKey }
        : this.adapter.getDefaultSelection();
      this.applySnapshot(await this.adapter.snapshot(selection));
      this.connected = true;
      for (const runtime of this.chatRuntimeBySessionKey.values()) {
        runtime.connected = true;
        runtime.client = this.controllerClient;
      }
      this.lastError = null;
    } catch (error) {
      this.connected = false;
      for (const runtime of this.chatRuntimeBySessionKey.values()) {
        runtime.connected = false;
      }
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    this.ready = true;
  }

  private applySnapshot(snapshot: WorkbenchSnapshot) {
    this.assistantName = snapshot.assistantName;
    this.workbenchSelectedProjectId = snapshot.currentProjectId;
    this.agentsList = snapshot.agentsList;
    this.agentIdentityById = snapshot.agentIdentityById;
    this.agentFilesList = snapshot.agentFilesList;
    this.sessionsResult = snapshot.sessionsResult;
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
    if (snapshot.currentSessionKey) {
      const runtime = this.getOrCreateSessionRuntime(snapshot.currentSessionKey);
      if (runtime) {
        runtime.chatMessages = snapshot.chatMessages;
        runtime.chatThinkingLevel = null;
        runtime.chatStream = null;
        runtime.chatStreamStartedAt = null;
        runtime.chatRunId = null;
        runtime.chatSending = false;
        runtime.lastError = null;
        resetToolStream(runtime as unknown as Parameters<typeof resetToolStream>[0]);
      }
    }
    if (snapshot.currentProjectId && !this.expandedProjectIds.includes(snapshot.currentProjectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, snapshot.currentProjectId];
    }
    this.priorityProjectIds = this.priorityProjectIds.filter((projectId) =>
      (snapshot.agentsList?.agents ?? []).some((agent) => agent.id === projectId),
    );
    this.bumpChatRuntime();
    this.scheduleActiveChatScroll(false, false);
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
    const locale = (next.trim() || "zh-CN") as Locale;
    await i18n.setLocale(locale);
    this.persistSettings({ locale });
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
    this.resetSessionRuntimeViewState(sessionKey);
    if (projectId && !this.expandedProjectIds.includes(projectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, projectId];
    }
    this.persistSettings({
      sessionKey,
      lastActiveSessionKey: sessionKey,
    });
    await this.refreshSnapshot(sessionKey, projectId);
  }

  private openChatFilePicker() {
    const input = this.querySelector<HTMLInputElement>("[data-chat-file-input]");
    input?.click();
  }

  private async createProjectFromWorkspace(workspace: string) {
    const validation = await this.adapter.validateProjectWorkspace(workspace);
    const normalizedName = validation.name.trim();
    const normalizedWorkspace = validation.path.trim();
    if (!normalizedName || !normalizedWorkspace) {
      return null;
    }
    return await this.adapter.createProject(normalizedName, normalizedWorkspace);
  }

  private async loadProjectDirectoryRoots() {
    const { roots } = await this.adapter.listProjectRoots();
    this.projectDirectoryRoots = roots;
    this.projectDirectoryCurrentPath = null;
    this.projectDirectoryCurrentName = null;
    this.projectDirectoryParentPath = null;
    this.projectDirectoryEntries = [];
  }

  private async browseProjectDirectory(path: string | null) {
    if (!path) {
      await this.loadProjectDirectoryRoots();
      return;
    }
    const listing = await this.adapter.listProjectDirectories(path);
    this.projectDirectoryCurrentPath = listing.path;
    this.projectDirectoryCurrentName = listing.name;
    this.projectDirectoryParentPath = listing.parentPath;
    this.projectDirectoryEntries = listing.entries;
  }

  private async openProjectDirectoryDialog() {
    try {
      this.projectDirectoryDialogOpen = true;
      this.projectDirectoryDialogClosing = false;
      this.projectDirectoryLoading = false;
      this.projectDirectoryError = null;
      this.projectCreateName = "";
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    }
  }

  private finalizeCloseProjectDirectoryDialog() {
    this.projectDirectoryDialogOpen = false;
    this.projectDirectoryDialogClosing = false;
    this.projectDirectoryLoading = false;
    this.projectDirectoryError = null;
    this.projectDirectoryCurrentPath = null;
    this.projectDirectoryCurrentName = null;
    this.projectDirectoryParentPath = null;
    this.projectDirectoryEntries = [];
    this.projectCreateName = "";
  }

  private beginCloseModal(kind: "tools" | "settings" | "projectDirectory") {
    const existing = this.modalCloseTimers.get(kind);
    if (existing) {
      window.clearTimeout(existing);
      this.modalCloseTimers.delete(kind);
    }

    const durationMs = 180;
    if (kind === "tools") {
      this.workbenchToolsClosing = true;
      const timer = window.setTimeout(() => {
        this.workbenchToolsOpen = false;
        this.workbenchToolsClosing = false;
        this.modalCloseTimers.delete(kind);
      }, durationMs);
      this.modalCloseTimers.set(kind, timer);
      return;
    }

    if (kind === "settings") {
      this.workbenchSettingsClosing = true;
      const timer = window.setTimeout(() => {
        this.workbenchSettingsOpen = false;
        this.workbenchSettingsClosing = false;
        this.modalCloseTimers.delete(kind);
      }, durationMs);
      this.modalCloseTimers.set(kind, timer);
      return;
    }

    this.projectDirectoryDialogClosing = true;
    const timer = window.setTimeout(() => {
      this.finalizeCloseProjectDirectoryDialog();
      this.modalCloseTimers.delete(kind);
    }, durationMs);
    this.modalCloseTimers.set(kind, timer);
  }

  private async handleProjectDirectoryNavigate(path: string | null) {
    try {
      this.projectDirectoryLoading = true;
      this.projectDirectoryError = null;
      await this.browseProjectDirectory(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    } finally {
      this.projectDirectoryLoading = false;
    }
  }

  private async handleCreateProjectFromDirectory(path: string | null) {
    if (!path) {
      return;
    }
    try {
      this.projectDirectoryLoading = true;
      this.projectDirectoryError = null;
      const projectId = await this.createProjectFromWorkspace(path);
      if (!projectId) {
        throw new Error("Failed to create project from selected directory.");
      }
      this.priorityProjectIds = [
        projectId,
        ...this.priorityProjectIds.filter((id) => id !== projectId),
      ];
      this.beginCloseModal("projectDirectory");
      await this.selectProject(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    } finally {
      this.projectDirectoryLoading = false;
    }
  }

  private async handleCreateProjectFromName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }

    // Prevent path traversal and accidental nested paths.
    const safeName = trimmed.replace(/[/\\]+/g, "-");
    const workspace = `/workspace/${safeName}`;

    try {
      this.projectDirectoryLoading = true;
      this.projectDirectoryError = null;

      const projectId = await this.createProjectFromWorkspace(workspace);
      if (!projectId) {
        throw new Error("Failed to create project.");
      }

      this.priorityProjectIds = [
        projectId,
        ...this.priorityProjectIds.filter((id) => id !== projectId),
      ];
      this.beginCloseModal("projectDirectory");
      await this.selectProject(projectId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    } finally {
      this.projectDirectoryLoading = false;
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
    const runtime = this.activeSessionRuntime;
    if (!runtime) {
      return;
    }
    handleChatScroll(
      this.createActiveScrollHost(runtime) as unknown as Parameters<typeof handleChatScroll>[0],
      event,
    );
  }

  private async sendViaChatController() {
    const prompt = this.chatMessage.trim();
    const runtime = this.activeSessionRuntime;
    if (!prompt || !runtime) {
      return;
    }
    const runId = await sendChatMessage(runtime, prompt);
    if (!runId) {
      this.lastError = runtime.lastError;
      this.bumpChatRuntime();
      return;
    }
    this.chatMessage = "";
    this.persistSettings({
      sessionKey: this.workbenchSelectedSessionKey ?? "",
      lastActiveSessionKey: this.workbenchSelectedSessionKey ?? "",
    });
    this.bumpChatRuntime();
    this.scheduleActiveChatScroll(true, false);
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
      this.resetSessionRuntimeViewState(sessionKey);
      this.persistSettings({
        sessionKey,
        lastActiveSessionKey: sessionKey,
      });
      await this.refreshSnapshot(sessionKey, projectId);
      await this.sendViaChatController();
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
      await this.sendViaChatController();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async abortCurrentRun() {
    const runtime = this.activeSessionRuntime;
    if (!runtime) {
      return;
    }
    try {
      await abortChatRun(runtime);
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
      for (const runtime of this.chatRuntimeBySessionKey.values()) {
        runtime.connected = event.connected;
        runtime.client = this.controllerClient;
      }
      if (!event.connected && event.error) {
        this.lastError = event.error;
      }
      this.requestUpdate();
      return;
    }

    if (event.type === "agent") {
      const sessionKey =
        typeof event.payload.sessionKey === "string" ? event.payload.sessionKey.trim() : "";
      if (sessionKey) {
        const runtime = this.getOrCreateSessionRuntime(sessionKey);
        if (runtime) {
          handleAgentEvent(
            runtime as unknown as Parameters<typeof handleAgentEvent>[0],
            event.payload,
          );
          if (this.workbenchSelectedSessionKey === sessionKey) {
            this.bumpChatRuntime();
          }
        }
      } else {
        for (const runtime of this.chatRuntimeBySessionKey.values()) {
          handleAgentEvent(
            runtime as unknown as Parameters<typeof handleAgentEvent>[0],
            event.payload,
          );
        }
        this.bumpChatRuntime();
      }
      return;
    }

    if (event.type !== "chat") {
      return;
    }

    const runtime = this.getOrCreateSessionRuntime(event.sessionKey);
    if (!runtime) {
      return;
    }
    const projectId =
      parseAgentSessionKey(event.sessionKey)?.agentId ?? this.workbenchSelectedProjectId ?? null;
    const nextState = handleChatEvent(runtime, {
      runId: event.runId ?? "",
      sessionKey: event.sessionKey,
      state: event.state,
      message: event.message,
      errorMessage: event.errorMessage ?? undefined,
    });
    if (this.workbenchSelectedSessionKey === event.sessionKey) {
      if (event.state === "final" || event.state === "aborted" || event.state === "error") {
        flushToolStreamSync(runtime as unknown as Parameters<typeof flushToolStreamSync>[0]);
      }
      this.bumpChatRuntime();
      this.scheduleActiveChatScroll(false, event.state === "delta");
    }
    if (nextState === "final" || nextState === "aborted" || nextState === "error") {
      if (this.workbenchSelectedSessionKey === event.sessionKey) {
        void this.refreshSnapshot(event.sessionKey, projectId);
      } else {
        void this.refreshSnapshot(
          this.workbenchSelectedSessionKey,
          this.workbenchSelectedProjectId,
        );
      }
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
    const activeRuntime = this.activeSessionRuntime;
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
      priorityProjectIds: this.priorityProjectIds,
      agentsList: this.agentsList,
      agentIdentityById: this.agentIdentityById,
      agentFilesList: this.agentFilesList,
      agentFilesLoading: false,
      agentFilesError: null,
      sessionsResult: this.sessionsResult,
      chatMessages: activeRuntime?.chatMessages ?? [],
      chatMessage: this.chatMessage,
      chatSending: activeRuntime?.chatSending ?? false,
      chatRunId: activeRuntime?.chatRunId ?? null,
      chatStream: activeRuntime?.chatStream ?? null,
      chatStreamStartedAt: activeRuntime?.chatStreamStartedAt ?? null,
      chatToolMessages: activeRuntime?.chatToolMessages ?? [],
      chatStreamSegments: activeRuntime?.chatStreamSegments ?? [],
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
        localeOptions: SETTINGS_LOCALE_OPTIONS.map((option) => ({ ...option })),
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
      toolsClosing: this.workbenchToolsClosing,
      toolQuery: this.workbenchToolQuery,
      toolsCategory: this.workbenchToolsCategory,
      settingsOpen: this.workbenchSettingsOpen,
      settingsClosing: this.workbenchSettingsClosing,
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
        this.workbenchToolsClosing = false;
      },
      onCloseTools: () => {
        this.beginCloseModal("tools");
      },
      onToolQueryChange: (value) => {
        this.workbenchToolQuery = value;
      },
      onToolsCategoryChange: (value) => {
        this.workbenchToolsCategory = value;
      },
      onOpenSettings: () => {
        this.workbenchSettingsOpen = true;
        this.workbenchSettingsClosing = false;
      },
      onCloseSettings: () => {
        this.beginCloseModal("settings");
      },
      onSettingsTabChange: (value) => {
        this.workbenchSettingsTab = value;
      },
      onModelChange: (value) => {
        this.currentModelId = value;
      },
      onCreateProject: () => {
        this.newTaskProjectMenuOpen = false;
        void this.openProjectDirectoryDialog();
      },
      projectDirectoryOpen: this.projectDirectoryDialogOpen,
      projectDirectoryClosing: this.projectDirectoryDialogClosing,
      projectDirectoryLoading: this.projectDirectoryLoading,
      projectDirectoryError: this.projectDirectoryError,
      projectDirectoryRoots: this.projectDirectoryRoots,
      projectDirectoryCurrentPath: this.projectDirectoryCurrentPath,
      projectDirectoryCurrentName: this.projectDirectoryCurrentName,
      projectDirectoryParentPath: this.projectDirectoryParentPath,
      projectDirectoryEntries: this.projectDirectoryEntries,
      projectCreateName: this.projectCreateName,
      onCloseProjectDirectory: () => {
        this.beginCloseModal("projectDirectory");
      },
      onBrowseProjectDirectory: (path) => {
        void this.handleProjectDirectoryNavigate(path);
      },
      onCreateProjectFromDirectory: (path) => {
        void this.handleCreateProjectFromDirectory(path);
      },
      onProjectCreateNameChange: (value) => {
        this.projectCreateName = value;
      },
      onCreateProjectFromName: (name) => {
        void this.handleCreateProjectFromName(name);
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
        data-chat-file-input
        type="file"
        multiple
        @change=${(event: Event) => this.handleChatFileSelection(event)}
      />
    `;
  }
}
