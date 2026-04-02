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
  cloneConfigObject,
  serializeConfigForm,
} from "../../ui/src/ui/controllers/config/form-utils.ts";
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
  ConfigSnapshot,
  ModelCatalogEntry,
  SessionsListResult,
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
  WorkbenchFileEntry,
  WorkbenchUploadedFile,
} from "./adapters/workbench-adapter.ts";
import {
  renderWorkbench,
  type WorkbenchModelConfig,
  type WorkbenchSection,
  type WorkbenchSettingsTab,
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

const INITIAL_SETTINGS = resolveInitialSettings(loadSettings());
const SESSION_LABEL_MAX_LENGTH = 64;
const DEFAULT_PROVIDER_PREFIX = "provider";

function createLocalId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `power-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSessionLabelInput(value: string): string {
  return value.trim().slice(0, SESSION_LABEL_MAX_LENGTH);
}

async function readBrowserFileAsBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function triggerBrowserDownload(params: { name: string; contentBase64: string }) {
  const binary = atob(params.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = params.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function createEmptyModelConfig(): WorkbenchModelConfig {
  return {
    id: createLocalId(),
    provider: "",
    enabled: true,
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
  };
}

function formatModelRef(provider: string, model: string): string {
  const normalizedProvider = provider.trim();
  const normalizedModel = model.trim();
  return normalizedProvider && normalizedModel
    ? `${normalizedProvider}/${normalizedModel}`
    : normalizedModel;
}

function sanitizeProviderId(raw: string, fallbackSeed: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized) {
    return normalized;
  }
  const fallback = fallbackSeed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fallback || `${DEFAULT_PROVIDER_PREFIX}-${createLocalId().slice(0, 8)}`;
}

function resolvePrimaryModelFromConfig(config: Record<string, unknown> | null | undefined): string {
  const modelConfig = (config as { agents?: { defaults?: { model?: unknown } } } | null)?.agents
    ?.defaults?.model;
  if (typeof modelConfig === "string") {
    return modelConfig.trim();
  }
  if (
    modelConfig &&
    typeof modelConfig === "object" &&
    typeof (modelConfig as { primary?: unknown }).primary === "string"
  ) {
    return ((modelConfig as { primary?: string }).primary ?? "").trim();
  }
  return "";
}

function readGlobalModelConfigs(
  config: Record<string, unknown> | null | undefined,
): WorkbenchModelConfig[] {
  const providers = (
    config as {
      models?: {
        providers?: Record<
          string,
          {
            baseUrl?: unknown;
            apiKey?: unknown;
            models?: Array<{ id?: unknown; name?: unknown }>;
          }
        >;
      };
    }
  )?.models?.providers;
  if (!providers || typeof providers !== "object") {
    return [createEmptyModelConfig()];
  }

  const entries: WorkbenchModelConfig[] = [];

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const baseUrl = typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : "";
    const apiKey = typeof providerConfig?.apiKey === "string" ? providerConfig.apiKey : "";
    const models =
      Array.isArray(providerConfig?.models) && providerConfig.models.length > 0
        ? providerConfig.models
        : [{ id: "", name: "" }];

    for (const [index, modelConfig] of models.entries()) {
      const modelId = typeof modelConfig?.id === "string" ? modelConfig.id.trim() : "";
      entries.push({
        id: `${providerId}::${modelId || "model"}::${index}`,
        provider: providerId,
        enabled: true,
        name:
          typeof modelConfig?.name === "string" && modelConfig.name.trim()
            ? modelConfig.name.trim()
            : providerId,
        baseUrl,
        apiKey,
        model: modelId,
      });
    }
  }

  return entries.length > 0 ? entries : [createEmptyModelConfig()];
}

function buildNextGlobalModelConfig(params: {
  config: Record<string, unknown> | null | undefined;
  modelConfigs: WorkbenchModelConfig[];
  currentModelId: string;
}): Record<string, unknown> {
  const next = cloneConfigObject(params.config ?? {});
  const existingModels =
    typeof next.models === "object" && next.models !== null
      ? (next.models as Record<string, unknown>)
      : {};
  const existingAgents =
    typeof next.agents === "object" && next.agents !== null
      ? (next.agents as Record<string, unknown>)
      : {};
  const existingDefaults =
    typeof existingAgents.defaults === "object" && existingAgents.defaults !== null
      ? (existingAgents.defaults as Record<string, unknown>)
      : {};
  const existingProviders =
    typeof existingModels.providers === "object" && existingModels.providers !== null
      ? (existingModels.providers as Record<string, Record<string, unknown>>)
      : {};
  const nextProviders: Record<string, Record<string, unknown>> = {};

  for (const [index, modelConfig] of params.modelConfigs.entries()) {
    if (!modelConfig.enabled) {
      continue;
    }
    const modelId = modelConfig.model.trim();
    const providerId = sanitizeProviderId(
      modelConfig.provider,
      modelConfig.name || modelId || `${DEFAULT_PROVIDER_PREFIX}-${index + 1}`,
    );
    const existingProvider =
      existingProviders[providerId] &&
      typeof existingProviders[providerId] === "object" &&
      existingProviders[providerId] !== null
        ? existingProviders[providerId]
        : {};
    const providerEntry =
      nextProviders[providerId] ??
      ({
        ...existingProvider,
        baseUrl: "",
        apiKey: "",
        api:
          typeof existingProvider.api === "string" && existingProvider.api.trim()
            ? existingProvider.api
            : "openai-completions",
        models: [],
      } as Record<string, unknown> & { models: Array<{ id: string; name: string }> });

    providerEntry.baseUrl = modelConfig.baseUrl.trim();
    providerEntry.apiKey = modelConfig.apiKey;
    if (modelId) {
      providerEntry.models.push({
        id: modelId,
        name: modelConfig.name.trim() || modelId,
      });
    }
    nextProviders[providerId] = providerEntry;
  }

  const configuredRefs = Object.entries(nextProviders).flatMap(([providerId, providerConfig]) =>
    Array.isArray(providerConfig.models)
      ? providerConfig.models
          .filter((model): model is { id: string; name: string } =>
            Boolean(model && typeof model.id === "string" && model.id.trim()),
          )
          .map((model) => formatModelRef(providerId, model.id))
      : [],
  );
  const normalizedCurrentModelId = params.currentModelId.trim();
  const nextPrimaryModel =
    configuredRefs.find((ref) => ref === normalizedCurrentModelId) ?? configuredRefs[0] ?? "";

  next.models = {
    ...existingModels,
    mode: "merge",
    providers: nextProviders,
  };
  next.agents = {
    ...existingAgents,
    defaults: {
      ...existingDefaults,
      model:
        nextPrimaryModel &&
        typeof existingDefaults.model === "object" &&
        existingDefaults.model !== null
          ? {
              ...(existingDefaults.model as Record<string, unknown>),
              primary: nextPrimaryModel,
            }
          : nextPrimaryModel
            ? { primary: nextPrimaryModel }
            : existingDefaults.model,
    },
  };
  return next;
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

type PendingChatFile = {
  id: string;
  file: File;
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
    if (!this.newTaskProjectMenuOpen && !this.treeMenuOpenKey) {
      return;
    }
    const path = event.composedPath();
    const clickedInsidePicker = path.some(
      (node) =>
        node instanceof HTMLElement && node.closest(".workbench-new-thread__project-picker"),
    );
    const clickedInsideTreeMenu = path.some(
      (node) => node instanceof HTMLElement && node.closest(".workbench-tree-node__menu-anchor"),
    );
    const clickedInsideSessionMenu = path.some(
      (node) => node instanceof HTMLElement && node.closest(".workbench-tree-session__menu-anchor"),
    );
    if (!clickedInsidePicker) {
      this.newTaskProjectMenuOpen = false;
    }
    if (!clickedInsideTreeMenu && !clickedInsideSessionMenu) {
      this.treeMenuOpenKey = null;
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
  @state() treeMenuOpenKey: string | null = null;
  @state() expandedProjectIds: string[] = [];
  @state() priorityProjectIds: string[] = [];
  @state() workbenchSelectedProjectId: string | null = null;
  @state() workbenchSelectedSessionKey: string | null = null;
  @state() workbenchSettingsOpen = false;
  @state() workbenchSettingsClosing = false;
  @state() workbenchSettingsTab: WorkbenchSettingsTab = "general";
  @state() modelConfigs: WorkbenchModelConfig[] = [createEmptyModelConfig()];
  @state() expandedModelConfigId: string | null = null;
  @state() projectDirectoryDialogOpen = false;
  @state() projectDirectoryDialogClosing = false;
  @state() projectDirectoryLoading = false;
  @state() projectDirectoryError: string | null = null;
  @state() projectDirectoryRoots: WorkbenchDirectoryEntry[] = [];
  @state() projectDirectoryTreeChildrenByPath: Record<string, WorkbenchDirectoryEntry[]> = {};
  @state() projectDirectoryExpandedPaths: string[] = [];
  @state() projectDirectoryLoadingPaths: string[] = [];
  @state() projectDirectoryCurrentPath: string | null = null;
  @state() projectDirectoryCurrentName: string | null = null;
  @state() projectDirectoryParentPath: string | null = null;
  @state() projectDirectoryEntries: WorkbenchDirectoryEntry[] = [];
  @state() projectDirectorySelectedPath: string | null = null;
  @state() projectDirectorySelectedName: string | null = null;
  @state() projectDirectoryCreateFolderOpen = false;
  @state() projectDirectoryCreateFolderName = "";
  @state() projectDirectoryCreateFolderBusy = false;
  @state() fileManagerLoading = false;
  @state() fileManagerError: string | null = null;
  @state() fileManagerAgentId: string | null = null;
  @state() fileManagerWorkspace: string | null = null;
  @state() fileManagerCurrentPath: string | null = null;
  @state() fileManagerCurrentName: string | null = null;
  @state() fileManagerParentPath: string | null = null;
  @state() fileManagerEntries: WorkbenchFileEntry[] = [];
  @state() fileManagerBusyPath: string | null = null;
  @state() fileManagerCreateFolderOpen = false;
  @state() fileManagerNewFolderName = "";
  @state() projectFilesLoading = false;
  @state() projectFilesError: string | null = null;
  @state() projectFilesAgentId: string | null = null;
  @state() projectFilesWorkspace: string | null = null;
  @state() projectFilesEntries: WorkbenchFileEntry[] = [];

  @state() agentsList: AgentsListResult | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() chatMessage = "";
  @state() pendingChatFiles: PendingChatFile[] = [];
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
  private pendingProjectFileUploadAgentId: string | null = null;
  private pendingProjectFileUploadPath: string | null = null;
  private modalCloseTimers = new Map<"settings" | "projectDirectory", number>();
  private modelConfigPersistTimer: number | null = null;
  private modelConfigPersistInFlight = false;
  private modelConfigPersistQueued = false;

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
    if (this.modelConfigPersistTimer != null) {
      window.clearTimeout(this.modelConfigPersistTimer);
      this.modelConfigPersistTimer = null;
    }
    for (const timer of this.modalCloseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.modalCloseTimers.clear();
    super.disconnectedCallback();
  }

  private setModalClosingState(key: "settings" | "projectDirectory", value: boolean) {
    if (key === "settings") {
      this.workbenchSettingsClosing = value;
      return;
    }
    this.projectDirectoryDialogClosing = value;
  }

  private openModal(key: "settings" | "projectDirectory") {
    const existing = this.modalCloseTimers.get(key);
    if (typeof existing === "number") {
      window.clearTimeout(existing);
      this.modalCloseTimers.delete(key);
    }
    this.setModalClosingState(key, false);
    if (key === "settings") {
      this.workbenchSettingsOpen = true;
      return;
    }
    this.projectDirectoryDialogOpen = true;
  }

  private closeModal(key: "settings" | "projectDirectory", onClosed?: () => void) {
    const existing = this.modalCloseTimers.get(key);
    if (typeof existing === "number") {
      window.clearTimeout(existing);
    }
    if (key === "settings") {
      this.workbenchSettingsOpen = false;
    } else {
      this.projectDirectoryDialogOpen = false;
    }
    this.setModalClosingState(key, true);
    const timer = window.setTimeout(() => {
      this.modalCloseTimers.delete(key);
      this.setModalClosingState(key, false);
      onClosed?.();
    }, 180);
    this.modalCloseTimers.set(key, timer);
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

  private get activeChatAgentId() {
    return (
      this.workbenchSelectedProjectId ??
      parseAgentSessionKey(this.workbenchSelectedSessionKey ?? "")?.agentId ??
      this.agentsList?.defaultId ??
      null
    );
  }

  private clearPendingChatFiles() {
    this.pendingChatFiles = [];
  }

  private buildPendingChatFileId(file: File) {
    return `${createLocalId()}:${file.name}:${file.size}:${file.lastModified}`;
  }

  private formatChatMessageWithFileContext(message: string, relativePaths: string[]) {
    const locale = this.settings.locale ?? "zh-CN";
    const header = locale.toLowerCase().startsWith("zh")
      ? "已上传以下文件到当前工作区，请将它们作为这次对话的上下文，并在需要时直接读取这些文件："
      : "The following files were uploaded into the current workspace. Use them as context for this conversation and read them directly when needed:";
    const filesList = relativePaths.map((entry) => `- ${entry}`).join("\n");
    const prompt = message.trim();
    if (!prompt) {
      return `${header}\n${filesList}`;
    }
    return `${prompt}\n\n${header}\n${filesList}`;
  }

  private toWorkspaceRelativePath(filePath: string, workspace: string | null) {
    const normalizedPath = filePath.trim();
    const normalizedWorkspace = workspace?.trim() ?? "";
    if (!normalizedPath) {
      return "";
    }
    if (!normalizedWorkspace || !normalizedPath.startsWith(normalizedWorkspace)) {
      return normalizedPath;
    }
    const suffix = normalizedPath.slice(normalizedWorkspace.length).replace(/^\/+/, "");
    return suffix ? `./${suffix}` : ".";
  }

  private async uploadPendingChatFiles(agentId: string) {
    if (this.pendingChatFiles.length === 0) {
      return [];
    }
    const files = this.pendingChatFiles.map((entry) => entry.file);
    const payloads: WorkbenchUploadedFile[] = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        contentBase64: await readBrowserFileAsBase64(file),
      })),
    );
    return await this.adapter.uploadProjectFiles(agentId, null, payloads);
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
      const [snapshot, configSnapshot] = await Promise.all([
        this.adapter.snapshot(selection),
        this.loadGlobalModelSettings(),
      ]);
      this.applyGlobalModelSettings(configSnapshot);
      this.applySnapshot(snapshot);
      await this.refreshProjectFiles(selection.projectId);
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
    this.currentModelId = this.resolveAvailableModelRef(this.currentModelId, snapshot.modelCatalog);
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
    const sessionKeys = new Set(
      (snapshot.sessionsResult?.sessions ?? []).map((session) => session.key),
    );
    if (
      this.treeMenuOpenKey?.startsWith("project:") &&
      !(snapshot.agentsList?.agents ?? []).some(
        (agent) => `project:${agent.id}` === this.treeMenuOpenKey,
      )
    ) {
      this.treeMenuOpenKey = null;
    }
    if (
      this.treeMenuOpenKey?.startsWith("session:") &&
      !sessionKeys.has(this.treeMenuOpenKey.slice("session:".length))
    ) {
      this.treeMenuOpenKey = null;
    }
    this.bumpChatRuntime();
    this.scheduleActiveChatScroll(false, false);
  }

  private resolveAvailableModelRef(requested: string, catalog = this.chatModelCatalog) {
    const visibleRefs = new Set(catalog.map((entry) => formatModelRef(entry.provider, entry.id)));
    const normalizedRequested = requested.trim();
    if (normalizedRequested && visibleRefs.has(normalizedRequested)) {
      return normalizedRequested;
    }
    if (normalizedRequested) {
      const matchingModel = catalog.find((entry) => entry.id === normalizedRequested);
      if (matchingModel) {
        return formatModelRef(matchingModel.provider, matchingModel.id);
      }
      if (catalog.length === 0) {
        return normalizedRequested;
      }
    }
    const configuredModel = this.modelConfigs.find(
      (entry) => entry.enabled && entry.provider.trim() && entry.model.trim(),
    );
    if (configuredModel) {
      return formatModelRef(configuredModel.provider, configuredModel.model);
    }
    const first = catalog[0];
    return first ? formatModelRef(first.provider, first.id) : normalizedRequested;
  }

  private async loadGlobalModelSettings() {
    return await this.adapter.request<ConfigSnapshot>("config.get", {});
  }

  private applyGlobalModelSettings(snapshot: ConfigSnapshot) {
    const config = snapshot.config ?? {};
    this.modelConfigs = readGlobalModelConfigs(config);
    this.expandedModelConfigId = this.modelConfigs[0]?.id ?? null;
    const primary = resolvePrimaryModelFromConfig(config);
    this.currentModelId = this.resolveAvailableModelRef(primary);
  }

  private scheduleGlobalModelConfigPersist() {
    if (this.modelConfigPersistTimer != null) {
      window.clearTimeout(this.modelConfigPersistTimer);
    }
    this.modelConfigPersistTimer = window.setTimeout(() => {
      this.modelConfigPersistTimer = null;
      void this.persistGlobalModelConfig();
    }, 400);
  }

  private async persistGlobalModelConfig() {
    if (this.modelConfigPersistInFlight) {
      this.modelConfigPersistQueued = true;
      return;
    }
    this.modelConfigPersistInFlight = true;
    try {
      const snapshot = await this.loadGlobalModelSettings();
      const baseHash = snapshot.hash?.trim();
      if (!baseHash) {
        throw new Error("Config hash missing; reload and retry.");
      }
      const nextConfig = buildNextGlobalModelConfig({
        config: snapshot.config,
        modelConfigs: this.modelConfigs,
        currentModelId: this.currentModelId,
      });
      await this.adapter.request("config.set", {
        raw: serializeConfigForm(nextConfig),
        baseHash,
      });
      await this.refreshSnapshot(this.workbenchSelectedSessionKey, this.workbenchSelectedProjectId);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.modelConfigPersistInFlight = false;
      if (this.modelConfigPersistQueued) {
        this.modelConfigPersistQueued = false;
        void this.persistGlobalModelConfig();
      }
    }
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
      await this.refreshProjectFiles(projectId);
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
    let nextCurrentModelId = this.currentModelId;
    this.modelConfigs = this.modelConfigs.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      const previousRef = formatModelRef(entry.provider, entry.model);
      const nextEntry = { ...entry, [field]: value };
      const nextRef = formatModelRef(nextEntry.provider, nextEntry.model);
      if (field === "model" && this.currentModelId === previousRef) {
        nextCurrentModelId = nextRef;
      }
      return nextEntry;
    });
    if (nextCurrentModelId !== this.currentModelId) {
      this.currentModelId = nextCurrentModelId;
    }
    this.scheduleGlobalModelConfigPersist();
  }

  private toggleModelConfigEnabled(id: string, enabled: boolean) {
    this.modelConfigs = this.modelConfigs.map((entry) =>
      entry.id === id ? { ...entry, enabled } : entry,
    );
    this.scheduleGlobalModelConfigPersist();
  }

  private toggleModelConfigExpanded(id: string) {
    this.expandedModelConfigId = this.expandedModelConfigId === id ? null : id;
  }

  private addModelConfig() {
    const nextConfig = createEmptyModelConfig();
    this.modelConfigs = [...this.modelConfigs, nextConfig];
    this.expandedModelConfigId = nextConfig.id;
    this.scheduleGlobalModelConfigPersist();
  }

  private removeModelConfig(id: string) {
    const removedConfig = this.modelConfigs.find((entry) => entry.id === id) ?? null;
    const nextConfigs = this.modelConfigs.filter((entry) => entry.id !== id);
    this.modelConfigs = nextConfigs.length > 0 ? nextConfigs : [createEmptyModelConfig()];
    if (this.expandedModelConfigId === id) {
      this.expandedModelConfigId = this.modelConfigs[0]?.id ?? null;
    }
    if (
      removedConfig &&
      this.currentModelId === formatModelRef(removedConfig.provider, removedConfig.model)
    ) {
      const fallbackConfig = this.modelConfigs.find(
        (entry) => entry.enabled && entry.provider.trim() && entry.model.trim(),
      );
      this.currentModelId = fallbackConfig
        ? formatModelRef(fallbackConfig.provider, fallbackConfig.model)
        : this.currentModelId;
    }
    this.scheduleGlobalModelConfigPersist();
  }

  private async enterNewTask() {
    this.workbenchSection = "newTask";
    this.workbenchSelectedSessionKey = null;
    this.newTaskProjectMenuOpen = false;
    this.treeMenuOpenKey = null;
    this.clearPendingChatFiles();
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
    this.treeMenuOpenKey = null;
    this.clearPendingChatFiles();
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
    this.treeMenuOpenKey = null;
    this.clearPendingChatFiles();
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

  private openProjectFilePicker(agentId: string, path: string | null) {
    this.pendingProjectFileUploadAgentId = agentId;
    this.pendingProjectFileUploadPath = path;
    const input = this.querySelector<HTMLInputElement>("[data-project-file-input]");
    input?.click();
  }

  private clearFileManagerState() {
    this.fileManagerLoading = false;
    this.fileManagerError = null;
    this.fileManagerAgentId = null;
    this.fileManagerWorkspace = null;
    this.fileManagerCurrentPath = null;
    this.fileManagerCurrentName = null;
    this.fileManagerParentPath = null;
    this.fileManagerEntries = [];
    this.fileManagerBusyPath = null;
    this.fileManagerCreateFolderOpen = false;
    this.fileManagerNewFolderName = "";
  }

  private clearProjectFilesState() {
    this.projectFilesLoading = false;
    this.projectFilesError = null;
    this.projectFilesAgentId = null;
    this.projectFilesWorkspace = null;
    this.projectFilesEntries = [];
  }

  private async refreshProjectFiles(agentId = this.workbenchSelectedProjectId) {
    const targetAgentId = agentId?.trim() ?? "";
    if (!targetAgentId) {
      this.clearProjectFilesState();
      this.clearFileManagerState();
      return;
    }
    this.projectFilesLoading = true;
    this.projectFilesError = null;
    const requestedPath =
      this.fileManagerAgentId === targetAgentId ? this.fileManagerCurrentPath : null;
    try {
      const listing = await this.adapter.listProjectFiles(targetAgentId, requestedPath);
      if ((this.workbenchSelectedProjectId ?? "") !== targetAgentId) {
        return;
      }
      this.projectFilesAgentId = listing.agentId;
      this.projectFilesWorkspace = listing.workspace;
      this.projectFilesEntries = listing.entries;
      this.fileManagerAgentId = listing.agentId;
      this.fileManagerWorkspace = listing.workspace;
      this.fileManagerCurrentPath = listing.path;
      this.fileManagerCurrentName = listing.name;
      this.fileManagerParentPath = listing.parentPath;
      this.fileManagerEntries = listing.entries;
      this.lastError = null;
    } catch (error) {
      if ((this.workbenchSelectedProjectId ?? "") !== targetAgentId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.projectFilesError = message;
      this.lastError = message;
      this.projectFilesAgentId = targetAgentId;
      this.projectFilesWorkspace = null;
      this.projectFilesEntries = [];
      this.fileManagerError = message;
      this.fileManagerAgentId = targetAgentId;
      this.fileManagerWorkspace = null;
      this.fileManagerCurrentPath = null;
      this.fileManagerCurrentName = null;
      this.fileManagerParentPath = null;
      this.fileManagerEntries = [];
    } finally {
      if ((this.workbenchSelectedProjectId ?? "") === targetAgentId) {
        this.projectFilesLoading = false;
        this.fileManagerLoading = false;
      }
    }
  }

  private async loadFileManagerPath(agentId: string, path: string | null) {
    const listing = await this.adapter.listProjectFiles(agentId, path);
    this.fileManagerAgentId = listing.agentId;
    this.fileManagerWorkspace = listing.workspace;
    this.fileManagerCurrentPath = listing.path;
    this.fileManagerCurrentName = listing.name;
    this.fileManagerParentPath = listing.parentPath;
    this.fileManagerEntries = listing.entries;
    this.fileManagerCreateFolderOpen = false;
    this.fileManagerNewFolderName = "";
  }

  private async navigateFileManagerTo(path: string | null) {
    if (!this.fileManagerAgentId) {
      return;
    }
    try {
      this.fileManagerLoading = true;
      this.fileManagerError = null;
      await this.loadFileManagerPath(this.fileManagerAgentId, path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fileManagerError = message;
      this.lastError = message;
    } finally {
      this.fileManagerLoading = false;
    }
  }

  private async refreshFileManager() {
    const agentId = this.fileManagerAgentId ?? this.workbenchSelectedProjectId;
    if (!agentId) {
      return;
    }
    try {
      this.fileManagerLoading = true;
      this.fileManagerError = null;
      const targetPath = this.fileManagerAgentId === agentId ? this.fileManagerCurrentPath : null;
      await this.loadFileManagerPath(agentId, targetPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fileManagerError = message;
      this.lastError = message;
    } finally {
      this.fileManagerLoading = false;
    }
  }

  private async createFileManagerFolder() {
    const agentId = this.fileManagerAgentId;
    const name = this.fileManagerNewFolderName.trim();
    if (!agentId || !name) {
      return;
    }
    try {
      this.fileManagerLoading = true;
      this.fileManagerError = null;
      await this.adapter.createProjectFolder(agentId, this.fileManagerCurrentPath, name);
      await this.loadFileManagerPath(agentId, this.fileManagerCurrentPath);
      await this.refreshProjectFiles(agentId);
      await this.refreshSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fileManagerError = message;
      this.lastError = message;
    } finally {
      this.fileManagerLoading = false;
    }
  }

  private async deleteProjectEntry(agentId: string, path: string) {
    const confirmed = window.confirm("Delete this item? This action cannot be undone.");
    if (!confirmed) {
      return;
    }
    try {
      this.fileManagerBusyPath = path;
      await this.adapter.deleteProjectEntry(agentId, path);
      await this.refreshProjectFiles(agentId);
      await this.refreshSnapshot();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.fileManagerError = this.lastError;
    } finally {
      this.fileManagerBusyPath = null;
    }
  }

  private toggleTreeMenu(key: string) {
    this.treeMenuOpenKey = this.treeMenuOpenKey === key ? null : key;
  }

  private async renameProject(projectId: string) {
    const currentName =
      this.agentsList?.agents.find((agent) => agent.id === projectId)?.name?.trim() || "";
    const nextName = window.prompt("Rename project", currentName)?.trim();
    this.treeMenuOpenKey = null;
    if (!nextName || nextName === currentName) {
      return;
    }
    try {
      await this.adapter.renameProject(projectId, nextName);
      await this.refreshSnapshot(this.workbenchSelectedSessionKey, this.workbenchSelectedProjectId);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async deleteProject(projectId: string) {
    const projectName =
      this.agentsList?.agents.find((agent) => agent.id === projectId)?.name?.trim() || projectId;
    const confirmed = window.confirm(
      `Delete project "${projectName}"? This will remove the project and its sessions.`,
    );
    this.treeMenuOpenKey = null;
    if (!confirmed) {
      return;
    }
    try {
      const activeSessionProjectId = this.workbenchSelectedSessionKey
        ? (parseAgentSessionKey(this.workbenchSelectedSessionKey)?.agentId ?? null)
        : null;
      const deletingCurrentProject =
        this.workbenchSelectedProjectId === projectId || activeSessionProjectId === projectId;
      await this.adapter.deleteProject(projectId);
      if (deletingCurrentProject) {
        this.workbenchSection = "newTask";
        this.workbenchSelectedProjectId = null;
        this.workbenchSelectedSessionKey = null;
        this.rightRailCollapsed = false;
        this.persistSettings({
          sessionKey: "",
          lastActiveSessionKey: "",
        });
        this.clearPendingChatFiles();
      }
      this.expandedProjectIds = this.expandedProjectIds.filter((id) => id !== projectId);
      this.priorityProjectIds = this.priorityProjectIds.filter((id) => id !== projectId);
      await this.refreshSnapshot(
        deletingCurrentProject ? null : this.workbenchSelectedSessionKey,
        deletingCurrentProject ? null : this.workbenchSelectedProjectId,
      );
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async renameSession(sessionKey: string) {
    const currentLabel =
      this.sessionsResult?.sessions.find((session) => session.key === sessionKey)?.label?.trim() ||
      "";
    const rawLabel = window.prompt("Rename session", currentLabel);
    this.treeMenuOpenKey = null;
    if (rawLabel == null) {
      return;
    }
    const nextLabel = normalizeSessionLabelInput(rawLabel);
    if (!nextLabel || nextLabel === currentLabel) {
      return;
    }
    try {
      await this.adapter.renameSession(sessionKey, nextLabel);
      await this.refreshSnapshot(this.workbenchSelectedSessionKey, this.workbenchSelectedProjectId);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async deleteSession(sessionKey: string) {
    const sessionLabel =
      this.sessionsResult?.sessions.find((session) => session.key === sessionKey)?.label?.trim() ||
      sessionKey;
    const confirmed = window.confirm(`Delete session "${sessionLabel}"?`);
    this.treeMenuOpenKey = null;
    if (!confirmed) {
      return;
    }
    try {
      const deletingCurrentSession = this.workbenchSelectedSessionKey === sessionKey;
      const projectId =
        parseAgentSessionKey(sessionKey)?.agentId ?? this.workbenchSelectedProjectId ?? null;
      await this.adapter.deleteSession(sessionKey);
      if (deletingCurrentSession) {
        this.workbenchSelectedSessionKey = null;
        this.persistSettings({
          sessionKey: "",
          lastActiveSessionKey: "",
        });
        this.clearPendingChatFiles();
      }
      await this.refreshSnapshot(
        deletingCurrentSession ? null : this.workbenchSelectedSessionKey,
        projectId,
      );
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async downloadProjectFile(agentId: string, path: string) {
    try {
      this.fileManagerBusyPath = path;
      const result = await this.adapter.downloadProjectFile(agentId, path);
      triggerBrowserDownload({
        name: result.file.name,
        contentBase64: result.file.contentBase64,
      });
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.fileManagerError = this.lastError;
    } finally {
      this.fileManagerBusyPath = null;
    }
  }

  private async uploadProjectFiles(
    agentId: string,
    path: string | null,
    files: File[],
    options?: { refreshManager?: boolean },
  ) {
    if (files.length === 0) {
      return;
    }
    try {
      this.fileManagerLoading = true;
      this.fileManagerError = null;
      const payloads: WorkbenchUploadedFile[] = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          contentBase64: await readBrowserFileAsBase64(file),
        })),
      );
      await this.adapter.uploadProjectFiles(agentId, path, payloads);
      await this.refreshProjectFiles(agentId);
      await this.refreshSnapshot();
      if (
        options?.refreshManager &&
        this.fileManagerDialogOpen &&
        this.fileManagerAgentId === agentId
      ) {
        await this.refreshFileManager();
      }
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.fileManagerError = message;
      this.lastError = message;
    } finally {
      this.fileManagerLoading = false;
    }
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
    this.projectDirectoryTreeChildrenByPath = {};
    this.projectDirectoryExpandedPaths = [];
    this.projectDirectoryLoadingPaths = [];
    this.projectDirectoryCurrentPath = null;
    this.projectDirectoryCurrentName = null;
    this.projectDirectoryParentPath = null;
    this.projectDirectoryEntries = [];
    this.projectDirectorySelectedPath = null;
    this.projectDirectorySelectedName = null;
    this.projectDirectoryCreateFolderOpen = false;
    this.projectDirectoryCreateFolderName = "";
    this.projectDirectoryCreateFolderBusy = false;
  }

  private projectDirectoryHasLoaded(path: string) {
    return Object.prototype.hasOwnProperty.call(this.projectDirectoryTreeChildrenByPath, path);
  }

  private setProjectDirectoryPathLoading(path: string, loading: boolean) {
    const next = new Set(this.projectDirectoryLoadingPaths);
    if (loading) {
      next.add(path);
    } else {
      next.delete(path);
    }
    this.projectDirectoryLoadingPaths = [...next];
  }

  private async loadProjectDirectoryChildren(path: string, force = false) {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return [];
    }
    if (!force && this.projectDirectoryHasLoaded(normalizedPath)) {
      return this.projectDirectoryTreeChildrenByPath[normalizedPath] ?? [];
    }
    this.setProjectDirectoryPathLoading(normalizedPath, true);
    try {
      const listing = await this.adapter.listProjectDirectories(normalizedPath);
      this.projectDirectoryTreeChildrenByPath = {
        ...this.projectDirectoryTreeChildrenByPath,
        [listing.path]: listing.entries,
      };
      this.projectDirectoryCurrentPath = listing.path;
      this.projectDirectoryCurrentName = listing.name;
      this.projectDirectoryParentPath = listing.parentPath;
      this.projectDirectoryEntries = listing.entries;
      return listing.entries;
    } finally {
      this.setProjectDirectoryPathLoading(normalizedPath, false);
    }
  }

  private selectProjectDirectory(path: string | null, name: string | null) {
    this.projectDirectorySelectedPath = path?.trim() || null;
    this.projectDirectorySelectedName = name?.trim() || null;
  }

  private async openProjectDirectoryDialog() {
    try {
      this.openModal("projectDirectory");
      this.projectDirectoryLoading = true;
      this.projectDirectoryError = null;
      await this.loadProjectDirectoryRoots();
      const initialRoot = this.projectDirectoryRoots[0] ?? null;
      if (initialRoot) {
        this.projectDirectorySelectedPath = initialRoot.path;
        this.projectDirectorySelectedName = initialRoot.name;
        await this.loadProjectDirectoryChildren(initialRoot.path);
        this.projectDirectoryExpandedPaths = [initialRoot.path];
      }
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    } finally {
      this.projectDirectoryLoading = false;
    }
  }

  private closeProjectDirectoryDialog() {
    this.closeModal("projectDirectory", () => {
      this.projectDirectoryLoading = false;
      this.projectDirectoryError = null;
      this.projectDirectoryCurrentPath = null;
      this.projectDirectoryCurrentName = null;
      this.projectDirectoryParentPath = null;
      this.projectDirectoryEntries = [];
      this.projectDirectoryTreeChildrenByPath = {};
      this.projectDirectoryExpandedPaths = [];
      this.projectDirectoryLoadingPaths = [];
      this.projectDirectorySelectedPath = null;
      this.projectDirectorySelectedName = null;
      this.projectDirectoryCreateFolderOpen = false;
      this.projectDirectoryCreateFolderName = "";
      this.projectDirectoryCreateFolderBusy = false;
    });
  }

  private toggleProjectDirectoryExpanded(path: string, expanded: boolean) {
    const normalizedPath = path.trim();
    const next = new Set(this.projectDirectoryExpandedPaths);
    if (expanded) {
      next.add(normalizedPath);
    } else {
      for (const entry of Array.from(next)) {
        if (entry === normalizedPath || entry.startsWith(`${normalizedPath}/`)) {
          next.delete(entry);
        }
      }
    }
    this.projectDirectoryExpandedPaths = [...next];
  }

  private async handleProjectDirectoryNavigate(path: string | null) {
    const normalizedPath = path?.trim() || "";
    if (!normalizedPath) {
      return;
    }
    try {
      this.projectDirectoryError = null;
      this.projectDirectorySelectedPath = normalizedPath;
      this.projectDirectorySelectedName =
        normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath;
      const isExpanded = this.projectDirectoryExpandedPaths.includes(normalizedPath);
      if (isExpanded) {
        this.toggleProjectDirectoryExpanded(normalizedPath, false);
        return;
      }
      const entries = await this.loadProjectDirectoryChildren(normalizedPath);
      if (entries.length > 0) {
        this.toggleProjectDirectoryExpanded(normalizedPath, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    }
  }

  private toggleProjectDirectoryCreateFolder(open: boolean) {
    this.projectDirectoryCreateFolderOpen = open;
    if (!open) {
      this.projectDirectoryCreateFolderName = "";
      this.projectDirectoryCreateFolderBusy = false;
    }
  }

  private async createProjectDirectoryFolder() {
    const basePath = this.projectDirectorySelectedPath?.trim() || "";
    const folderName = this.projectDirectoryCreateFolderName.trim();
    if (!basePath || !folderName) {
      return;
    }
    try {
      this.projectDirectoryCreateFolderBusy = true;
      this.projectDirectoryError = null;
      const result = await this.adapter.createProjectDirectory(basePath, folderName);
      await this.loadProjectDirectoryChildren(basePath, true);
      this.toggleProjectDirectoryExpanded(basePath, true);
      this.projectDirectorySelectedPath = result.entry.path;
      this.projectDirectorySelectedName = result.entry.name;
      this.projectDirectoryCreateFolderOpen = false;
      this.projectDirectoryCreateFolderName = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.projectDirectoryError = message;
      this.lastError = message;
    } finally {
      this.projectDirectoryCreateFolderBusy = false;
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
      this.closeProjectDirectoryDialog();
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
      const seen = new Set(this.pendingChatFiles.map((entry) => entry.id));
      const additions: PendingChatFile[] = [];
      for (const file of files) {
        const id = this.buildPendingChatFileId(file);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        additions.push({ id, file });
      }
      if (additions.length > 0) {
        this.pendingChatFiles = [...this.pendingChatFiles, ...additions];
      }
      this.lastError = null;
    }
    input.value = "";
  }

  private handleProjectFileSelection(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const agentId = this.pendingProjectFileUploadAgentId;
    const path = this.pendingProjectFileUploadPath;
    this.pendingProjectFileUploadAgentId = null;
    this.pendingProjectFileUploadPath = null;
    input.value = "";
    if (!agentId || files.length === 0) {
      return;
    }
    void this.uploadProjectFiles(agentId, path, files, { refreshManager: true });
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
    const agentId = this.activeChatAgentId;
    if ((!prompt && this.pendingChatFiles.length === 0) || !runtime || !agentId) {
      return;
    }
    let outboundPrompt = prompt;
    try {
      if (this.pendingChatFiles.length > 0) {
        const uploadedEntries = await this.uploadPendingChatFiles(agentId);
        const relativePaths = uploadedEntries
          .map((entry) => this.toWorkspaceRelativePath(entry.path, this.projectFilesWorkspace))
          .filter(Boolean);
        if (relativePaths.length > 0) {
          outboundPrompt = this.formatChatMessageWithFileContext(prompt, relativePaths);
        }
        await this.refreshProjectFiles(agentId);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.bumpChatRuntime();
      return;
    }
    const runId = await sendChatMessage(runtime, outboundPrompt);
    if (!runId) {
      this.lastError = runtime.lastError;
      this.bumpChatRuntime();
      return;
    }
    this.chatMessage = "";
    this.clearPendingChatFiles();
    this.persistSettings({
      sessionKey: this.workbenchSelectedSessionKey ?? "",
      lastActiveSessionKey: this.workbenchSelectedSessionKey ?? "",
    });
    this.bumpChatRuntime();
    this.scheduleActiveChatScroll(true, false);
  }

  private async startTask(projectId: string) {
    const prompt = this.chatMessage.trim();
    if (!prompt && this.pendingChatFiles.length === 0) {
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
    if (!prompt && this.pendingChatFiles.length === 0) {
      return;
    }
    const projectId = this.activeChatAgentId;
    if (!projectId) {
      return;
    }
    if (!this.workbenchSelectedSessionKey) {
      await this.startTask(projectId);
      return;
    }
    this.lastError = null;
    try {
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
      treeMenuOpenKey: this.treeMenuOpenKey,
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
      projectFilesLoading: this.projectFilesLoading,
      projectFilesError: this.projectFilesError,
      projectFilesAgentId: this.projectFilesAgentId,
      projectFilesWorkspace: this.projectFilesWorkspace,
      projectFilesEntries: this.projectFilesEntries,
      sessionsResult: this.sessionsResult,
      chatMessages: activeRuntime?.chatMessages ?? [],
      chatMessage: this.chatMessage,
      pendingChatFiles: this.pendingChatFiles.map((entry) => ({
        id: entry.id,
        name: entry.file.name,
        size: entry.file.size,
      })),
      chatSending: activeRuntime?.chatSending ?? false,
      chatRunId: activeRuntime?.chatRunId ?? null,
      chatStream: activeRuntime?.chatStream ?? null,
      chatStreamStartedAt: activeRuntime?.chatStreamStartedAt ?? null,
      chatToolMessages: activeRuntime?.chatToolMessages ?? [],
      chatStreamSegments: activeRuntime?.chatStreamSegments ?? [],
      lastError: this.lastError,
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
        expandedModelConfigId: this.expandedModelConfigId,
        onLocaleChange: (value) => {
          void this.setLocale(value);
        },
        onThemeChange: (value) => {
          this.setThemeName(value);
        },
        onThemeModeChange: (value) => {
          this.setThemeMode(value);
        },
        onToggleModelConfigEnabled: (id, enabled) => {
          this.toggleModelConfigEnabled(id, enabled);
        },
        onToggleModelConfigExpanded: (id) => {
          this.toggleModelConfigExpanded(id);
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
          this.treeMenuOpenKey = null;
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
      onToggleProjectMenu: (projectId) => {
        this.toggleTreeMenu(`project:${projectId}`);
      },
      onToggleSessionMenu: (sessionKey) => {
        this.toggleTreeMenu(`session:${sessionKey}`);
      },
      onRenameProject: (projectId) => {
        void this.renameProject(projectId);
      },
      onDeleteProject: (projectId) => {
        void this.deleteProject(projectId);
      },
      onRenameSession: (sessionKey) => {
        void this.renameSession(sessionKey);
      },
      onDeleteSession: (sessionKey) => {
        void this.deleteSession(sessionKey);
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
      onRemovePendingChatFile: (id) => {
        this.pendingChatFiles = this.pendingChatFiles.filter((entry) => entry.id !== id);
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
      onOpenSettings: () => {
        this.openModal("settings");
      },
      onCloseSettings: () => {
        this.closeModal("settings");
      },
      onSettingsTabChange: (value) => {
        this.workbenchSettingsTab = value;
      },
      onModelChange: (value) => {
        this.currentModelId = this.resolveAvailableModelRef(value);
        this.scheduleGlobalModelConfigPersist();
      },
      onCreateProject: () => {
        this.newTaskProjectMenuOpen = false;
        this.treeMenuOpenKey = null;
        void this.openProjectDirectoryDialog();
      },
      projectDirectoryOpen: this.projectDirectoryDialogOpen,
      projectDirectoryClosing: this.projectDirectoryDialogClosing,
      projectDirectoryLoading: this.projectDirectoryLoading,
      projectDirectoryError: this.projectDirectoryError,
      projectDirectoryRoots: this.projectDirectoryRoots,
      projectDirectoryTreeChildrenByPath: this.projectDirectoryTreeChildrenByPath,
      projectDirectoryExpandedPaths: this.projectDirectoryExpandedPaths,
      projectDirectoryLoadingPaths: this.projectDirectoryLoadingPaths,
      projectDirectoryCurrentPath: this.projectDirectoryCurrentPath,
      projectDirectoryCurrentName: this.projectDirectoryCurrentName,
      projectDirectoryParentPath: this.projectDirectoryParentPath,
      projectDirectoryEntries: this.projectDirectoryEntries,
      projectDirectorySelectedPath: this.projectDirectorySelectedPath,
      projectDirectorySelectedName: this.projectDirectorySelectedName,
      projectDirectoryCreateFolderOpen: this.projectDirectoryCreateFolderOpen,
      projectDirectoryCreateFolderName: this.projectDirectoryCreateFolderName,
      projectDirectoryCreateFolderBusy: this.projectDirectoryCreateFolderBusy,
      fileManagerLoading: this.fileManagerLoading,
      fileManagerError: this.fileManagerError,
      fileManagerAgentId: this.fileManagerAgentId,
      fileManagerWorkspace: this.fileManagerWorkspace,
      fileManagerCurrentPath: this.fileManagerCurrentPath,
      fileManagerCurrentName: this.fileManagerCurrentName,
      fileManagerParentPath: this.fileManagerParentPath,
      fileManagerEntries: this.fileManagerEntries,
      fileManagerBusyPath: this.fileManagerBusyPath,
      fileManagerCreateFolderOpen: this.fileManagerCreateFolderOpen,
      fileManagerNewFolderName: this.fileManagerNewFolderName,
      onCloseProjectDirectory: () => {
        this.closeProjectDirectoryDialog();
      },
      onSelectProjectDirectory: (path, name) => {
        this.selectProjectDirectory(path, name);
      },
      onBrowseProjectDirectory: (path) => {
        void this.handleProjectDirectoryNavigate(path);
      },
      onToggleProjectDirectoryCreateFolder: () => {
        this.toggleProjectDirectoryCreateFolder(!this.projectDirectoryCreateFolderOpen);
      },
      onProjectDirectoryFolderNameChange: (value) => {
        this.projectDirectoryCreateFolderName = value;
      },
      onCancelProjectDirectoryCreateFolder: () => {
        this.toggleProjectDirectoryCreateFolder(false);
      },
      onCreateProjectDirectoryFolder: () => {
        void this.createProjectDirectoryFolder();
      },
      onCreateProjectFromDirectory: (path) => {
        void this.handleCreateProjectFromDirectory(path);
      },
      onNavigateFileManager: (path) => {
        void this.navigateFileManagerTo(path);
      },
      onRefreshFileManager: () => {
        void this.refreshFileManager();
      },
      onOpenProjectFilePicker: (agentId, path) => {
        this.openProjectFilePicker(agentId, path);
      },
      onDownloadProjectFile: (agentId, path) => {
        void this.downloadProjectFile(agentId, path);
      },
      onDeleteProjectEntry: (agentId, path) => {
        void this.deleteProjectEntry(agentId, path);
      },
      onToggleCreateFolder: () => {
        if (!this.fileManagerAgentId && this.workbenchSelectedProjectId) {
          void (async () => {
            await this.refreshProjectFiles(this.workbenchSelectedProjectId);
            this.fileManagerCreateFolderOpen = !this.fileManagerCreateFolderOpen;
            this.fileManagerNewFolderName = "";
          })();
          return;
        }
        this.fileManagerCreateFolderOpen = !this.fileManagerCreateFolderOpen;
        this.fileManagerNewFolderName = "";
      },
      onFileManagerFolderNameChange: (value) => {
        this.fileManagerNewFolderName = value;
      },
      onCreateFileManagerFolder: () => {
        void this.createFileManagerFolder();
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
      <input
        hidden
        data-project-file-input
        type="file"
        multiple
        @change=${(event: Event) => this.handleProjectFileSelection(event)}
      />
    `;
  }
}
