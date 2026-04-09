import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { parseAgentSessionKey } from "../../src/routing/session-key.ts";
import { GatewayWorkbenchAdapter } from "./adapters/gateway-workbench-adapter.ts";
import type { WorkbenchSnapshot } from "./adapters/mock-workbench-adapter.ts";
import type {
  WorkbenchAdapter,
  WorkbenchAdapterEvent,
  WorkbenchDirectoryEntry,
  WorkbenchFileEntry,
  WorkbenchFilePreviewMode,
  WorkbenchUploadedFile,
} from "./adapters/workbench-adapter.ts";
import {
  abortChatRun,
  addCronJob,
  cancelCronEdit,
  cloneConfigObject,
  DEFAULT_SKILLS_INSTALL_FILTER,
  DEFAULT_SKILLS_REGISTRY_PAGINATION,
  DEFAULT_SKILLS_SORT_BY,
  getVisibleCronJobs,
  handleChatEvent,
  hasCronFormErrors,
  importRegistrySkillArchive,
  loadChannels,
  loadCronJobs,
  loadCronModelSuggestions,
  loadLogs,
  loadCronRuns,
  loadCronStatus,
  loadMoreCronJobs,
  loadMoreCronRuns,
  loadSkills,
  normalizeCronFormState,
  reloadCronJobs,
  removeCronJob,
  runCronJob,
  sendChatMessage,
  serializeConfigForm,
  setSkillsCategory,
  setSkillsFilter,
  setSkillsInstallFilter,
  setSkillsPage,
  setSkillsSortBy,
  startCronClone,
  startCronEdit,
  toggleRegistrySkillInstall,
  toggleCronJob,
  updateCronJobsFilter,
  updateCronRunsFilter,
  validateCronForm,
  type ChannelsState,
  type ChatState,
  type CronModelSuggestionsState,
  type CronState,
  type LogsState,
  type SkillsState,
} from "./compat/controllers.ts";
import type { GatewayBrowserClient } from "./compat/gateway.ts";
import { i18n, I18nController, type Locale } from "./compat/i18n.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ConfigSnapshot,
  LogLevel,
  ModelCatalogEntry,
  SessionsUsageResult,
  SessionsListResult,
} from "./compat/types.ts";
import {
  DEFAULT_CRON_FORM,
  flushToolStreamSync,
  handleAgentEvent,
  handleChatScroll,
  inferBasePathFromPathname,
  loadSettings,
  normalizeBasePath,
  resetChatScroll,
  resetToolStream,
  resolveConfiguredCronModelSuggestions,
  resolveTheme,
  saveSettings,
  scheduleChatScroll,
  sortLocaleStrings,
  type ThemeMode,
  type ThemeName,
  type ToolStreamEntry,
  type UiSettings,
} from "./compat/ui-core.ts";
import {
  renderWorkbench,
  type WorkbenchFileSortKey,
  type WorkbenchModelConfig,
  type WorkbenchSection,
  type WorkbenchStatisticsRange,
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
const DEFAULT_LOG_LEVEL_FILTERS: Record<LogLevel, boolean> = {
  trace: true,
  debug: true,
  info: true,
  warn: true,
  error: true,
  fatal: true,
};
const DEFAULT_STATISTICS_RANGE_DAYS: WorkbenchStatisticsRange = 7;
const STATISTICS_RANGE_OPTIONS: readonly WorkbenchStatisticsRange[] = new Set([1, 7, 30]);

function formatUtcOffsetForLocalTimezone(): string {
  const offsetFromUtcMinutes = -new Date().getTimezoneOffset();
  const sign = offsetFromUtcMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetFromUtcMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
}

function formatLocalDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveStatisticsDateRange(days: WorkbenchStatisticsRange): {
  startDate: string;
  endDate: string;
  mode: "specific";
  utcOffset: string;
} {
  const normalizedDays = STATISTICS_RANGE_OPTIONS.has(days) ? days : DEFAULT_STATISTICS_RANGE_DAYS;
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (normalizedDays - 1));
  return {
    startDate: formatLocalDateValue(start),
    endDate: formatLocalDateValue(end),
    mode: "specific",
    utcOffset: formatUtcOffsetForLocalTimezone(),
  };
}

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
  status: "pending" | "uploading" | "uploaded" | "failed";
  progress: number | null;
  error: string | null;
  uploadedEntry: WorkbenchFileEntry | null;
};

type ChatDraftState = {
  message: string;
  files: PendingChatFile[];
};

type StatisticsState = {
  loading: boolean;
  error: string | null;
  rangeDays: WorkbenchStatisticsRange;
  result: SessionsUsageResult | null;
  lastLoadedRangeDays: WorkbenchStatisticsRange | null;
};

type FilePreviewState = {
  loading: boolean;
  error: string | null;
  agentId: string | null;
  path: string | null;
  name: string;
  mode: WorkbenchFilePreviewMode | null;
  textContent: string;
  objectUrl: string | null;
};

const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "sh",
  "py",
  "java",
  "go",
  "rs",
  "sql",
  "log",
  "csv",
]);
const IMAGE_PREVIEW_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"]);

function resolveFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0
    ? name
        .slice(dotIndex + 1)
        .trim()
        .toLowerCase()
    : "";
}

function resolvePreviewMode(entry: WorkbenchFileEntry): WorkbenchFilePreviewMode | null {
  const extension = resolveFileExtension(entry.name);
  if (!extension) {
    return null;
  }
  if (extension === "pdf") {
    return "pdf";
  }
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return "text";
  }
  return null;
}

function resolvePreviewMimeType(mode: WorkbenchFilePreviewMode, fileName: string): string {
  const extension = resolveFileExtension(fileName);
  if (mode === "pdf") {
    return "application/pdf";
  }
  if (mode === "image") {
    if (extension === "svg") {
      return "image/svg+xml";
    }
    if (extension === "jpg" || extension === "jpeg") {
      return "image/jpeg";
    }
    if (extension === "gif") {
      return "image/gif";
    }
    if (extension === "webp") {
      return "image/webp";
    }
    if (extension === "bmp") {
      return "image/bmp";
    }
    return "image/png";
  }
  return "text/plain; charset=utf-8";
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
    skillsArchiveBusy: false,
    skillMessages: {},
    skillsNotice: null,
    skillsFilter: "",
    skillsCatalog: [],
    skillsCategories: [],
    skillsRegistryBaseUrl: null,
    skillsPagination: { ...DEFAULT_SKILLS_REGISTRY_PAGINATION },
    skillsCategory: null,
    skillsSortBy: DEFAULT_SKILLS_SORT_BY,
    skillsInstallFilter: DEFAULT_SKILLS_INSTALL_FILTER,
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
  private readonly logsState: LogsState = {
    client: this.controllerClient,
    connected: false,
    logsLoading: false,
    logsError: null,
    logsCursor: null,
    logsFile: null,
    logsEntries: [],
    logsTruncated: false,
    logsLastFetchAt: null,
    logsLimit: 500,
    logsMaxBytes: 250_000,
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
  @state() unreadSessionKeys: string[] = [];
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
  @state() fileSortKey: WorkbenchFileSortKey = "name";
  @state() fileSearchQuery = "";
  @state() selectedProjectEntryPath: string | null = null;
  @state() fileManagerBusyPath: string | null = null;
  @state() fileManagerCreateFolderOpen = false;
  @state() fileManagerNewFolderName = "";
  @state() projectFilesLoading = false;
  @state() projectFilesError: string | null = null;
  @state() projectFilesAgentId: string | null = null;
  @state() projectFilesWorkspace: string | null = null;
  @state() projectFilesEntries: WorkbenchFileEntry[] = [];
  @state() filePreviewOpen = false;
  @state() filePreviewClosing = false;
  @state() filePreviewState: FilePreviewState = {
    loading: false,
    error: null,
    agentId: null,
    path: null,
    name: "",
    mode: null,
    textContent: "",
    objectUrl: null,
  };
  @state() logsFilterText = "";
  @state() logsAutoFollow = true;
  @state() logsLevelFilters: Record<LogLevel, boolean> = { ...DEFAULT_LOG_LEVEL_FILTERS };
  @state() statisticsState: StatisticsState = {
    loading: false,
    error: null,
    rangeDays: DEFAULT_STATISTICS_RANGE_DAYS,
    result: null,
    lastLoadedRangeDays: null,
  };

  @state() agentsList: AgentsListResult | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() chatDrafts: Record<string, ChatDraftState> = {};
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
  private readonly chatUploadTasks = new Map<string, Promise<void>>();
  private readonly initialSessionKeyFromUrl = INITIAL_SETTINGS.urlSessionKey;
  private pendingProjectFileUploadAgentId: string | null = null;
  private pendingProjectFileUploadPath: string | null = null;
  private modalCloseTimers = new Map<"settings" | "projectDirectory" | "filePreview", number>();
  private modelConfigPersistTimer: number | null = null;
  private modelConfigPersistInFlight = false;
  private modelConfigPersistQueued = false;
  private logsRefreshTimer: number | null = null;

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
    this.resetFilePreviewState();
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    if (this.modelConfigPersistTimer != null) {
      window.clearTimeout(this.modelConfigPersistTimer);
      this.modelConfigPersistTimer = null;
    }
    if (this.logsRefreshTimer != null) {
      window.clearInterval(this.logsRefreshTimer);
      this.logsRefreshTimer = null;
    }
    for (const timer of this.modalCloseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.modalCloseTimers.clear();
    super.disconnectedCallback();
  }

  private setModalClosingState(
    key: "settings" | "projectDirectory" | "filePreview",
    value: boolean,
  ) {
    if (key === "settings") {
      this.workbenchSettingsClosing = value;
      return;
    }
    if (key === "projectDirectory") {
      this.projectDirectoryDialogClosing = value;
      return;
    }
    this.filePreviewClosing = value;
  }

  private openModal(key: "settings" | "projectDirectory" | "filePreview") {
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
    if (key === "projectDirectory") {
      this.projectDirectoryDialogOpen = true;
      return;
    }
    this.filePreviewOpen = true;
  }

  private closeModal(key: "settings" | "projectDirectory" | "filePreview", onClosed?: () => void) {
    const existing = this.modalCloseTimers.get(key);
    if (typeof existing === "number") {
      window.clearTimeout(existing);
    }
    if (key === "settings") {
      this.workbenchSettingsOpen = false;
    } else if (key === "projectDirectory") {
      this.projectDirectoryDialogOpen = false;
    } else {
      this.filePreviewOpen = false;
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

  private buildChatDraftKey(
    sessionKey = this.workbenchSelectedSessionKey,
    projectId?: string | null,
  ) {
    const normalizedSessionKey = sessionKey?.trim() || "";
    if (normalizedSessionKey) {
      return `session:${normalizedSessionKey}`;
    }
    const normalizedProjectId = projectId ?? this.activeChatAgentId;
    return normalizedProjectId ? `project:${normalizedProjectId}:new` : "project:global:new";
  }

  private getChatDraftState(draftKey = this.buildChatDraftKey()): ChatDraftState {
    return this.chatDrafts[draftKey] ?? { message: "", files: [] };
  }

  private patchChatDraftState(
    updater: (draft: ChatDraftState) => ChatDraftState,
    draftKey = this.buildChatDraftKey(),
  ) {
    const nextDraft = updater(this.getChatDraftState(draftKey));
    this.chatDrafts = {
      ...this.chatDrafts,
      [draftKey]: nextDraft,
    };
  }

  private clearChatDraftState(draftKey = this.buildChatDraftKey()) {
    const nextDrafts = { ...this.chatDrafts };
    delete nextDrafts[draftKey];
    this.chatDrafts = nextDrafts;
  }

  private get activeChatDraft() {
    return this.getChatDraftState();
  }

  private resolveWorkspaceForAgent(agentId: string | null): string | null {
    if (!agentId) {
      return null;
    }
    if (this.projectFilesAgentId === agentId && this.projectFilesWorkspace?.trim()) {
      return this.projectFilesWorkspace.trim();
    }
    const matching = this.agentsList?.agents.find((agent) => agent.id === agentId) as
      | ({ workspace?: string } & { id: string })
      | undefined;
    return typeof matching?.workspace === "string" && matching.workspace.trim()
      ? matching.workspace.trim()
      : null;
  }

  private markSessionUnread(sessionKey: string | null) {
    const key = sessionKey?.trim() ?? "";
    if (!key || this.workbenchSelectedSessionKey === key || this.unreadSessionKeys.includes(key)) {
      return;
    }
    this.unreadSessionKeys = [...this.unreadSessionKeys, key];
  }

  private clearSessionUnread(sessionKey: string | null) {
    const key = sessionKey?.trim() ?? "";
    if (!key || !this.unreadSessionKeys.includes(key)) {
      return;
    }
    this.unreadSessionKeys = this.unreadSessionKeys.filter((entry) => entry !== key);
  }

  private pruneUnreadSessions(validSessionKeys: string[]) {
    const allowed = new Set(validSessionKeys);
    const next = this.unreadSessionKeys.filter((key) => allowed.has(key));
    if (next.length !== this.unreadSessionKeys.length) {
      this.unreadSessionKeys = next;
    }
  }

  private clearPendingChatFiles(draftKey = this.buildChatDraftKey()) {
    this.patchChatDraftState((draft) => ({ ...draft, files: [] }), draftKey);
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

  private async uploadPendingChatFiles(agentId: string, draftKey = this.buildChatDraftKey()) {
    const draft = this.getChatDraftState(draftKey);
    if (draft.files.length === 0) {
      return [];
    }
    const uploaded: WorkbenchFileEntry[] = [];
    for (const pendingFile of draft.files) {
      if (pendingFile.status === "uploaded" && pendingFile.uploadedEntry) {
        uploaded.push(pendingFile.uploadedEntry);
        continue;
      }
      this.patchChatDraftState(
        (currentDraft) => ({
          ...currentDraft,
          files: currentDraft.files.map((entry) =>
            entry.id === pendingFile.id
              ? {
                  ...entry,
                  status: "uploading",
                  progress: null,
                  error: null,
                }
              : entry,
          ),
        }),
        draftKey,
      );
      try {
        const [entry] = await this.adapter.uploadProjectFiles(agentId, null, [
          {
            name: pendingFile.file.name,
            file: pendingFile.file,
            onProgress: ({ loaded, total }) => {
              const progress =
                total && total > 0
                  ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
                  : null;
              this.patchChatDraftState(
                (currentDraft) => ({
                  ...currentDraft,
                  files: currentDraft.files.map((currentFile) =>
                    currentFile.id === pendingFile.id
                      ? {
                          ...currentFile,
                          status: "uploading",
                          progress,
                        }
                      : currentFile,
                  ),
                }),
                draftKey,
              );
            },
          },
        ]);
        if (!entry) {
          throw new Error(`Upload returned no file entry for ${pendingFile.file.name}`);
        }
        uploaded.push(entry);
        this.patchChatDraftState(
          (currentDraft) => ({
            ...currentDraft,
            files: currentDraft.files.map((currentFile) =>
              currentFile.id === pendingFile.id
                ? {
                    ...currentFile,
                    status: "uploaded",
                    progress: 100,
                    error: null,
                    uploadedEntry: entry,
                  }
                : currentFile,
            ),
          }),
          draftKey,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.patchChatDraftState(
          (currentDraft) => ({
            ...currentDraft,
            files: currentDraft.files.map((currentFile) =>
              currentFile.id === pendingFile.id
                ? {
                    ...currentFile,
                    status: "failed",
                    progress: null,
                    error: message,
                  }
                : currentFile,
            ),
          }),
          draftKey,
        );
        throw error;
      }
    }
    return uploaded;
  }

  private async ensureChatDraftUploads(agentId: string, draftKey = this.buildChatDraftKey()) {
    const existingTask = this.chatUploadTasks.get(draftKey);
    if (existingTask) {
      await existingTask;
      if (this.getChatDraftState(draftKey).files.some((entry) => entry.status === "pending")) {
        await this.ensureChatDraftUploads(agentId, draftKey);
      }
      return;
    }
    const task = (async () => {
      await this.uploadPendingChatFiles(agentId, draftKey);
      await this.refreshProjectFiles(agentId);
    })()
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => {
        if (this.chatUploadTasks.get(draftKey) === task) {
          this.chatUploadTasks.delete(draftKey);
        }
      });
    this.chatUploadTasks.set(draftKey, task);
    await task;
    if (this.getChatDraftState(draftKey).files.some((entry) => entry.status === "pending")) {
      await this.ensureChatDraftUploads(agentId, draftKey);
    }
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
      this.logsState.connected = true;
      this.logsState.client = this.controllerClient;
      for (const runtime of this.chatRuntimeBySessionKey.values()) {
        runtime.connected = true;
        runtime.client = this.controllerClient;
      }
      this.lastError = null;
    } catch (error) {
      this.connected = false;
      this.logsState.connected = false;
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
    this.clearSessionUnread(snapshot.currentSessionKey);
    if (snapshot.currentProjectId && !this.expandedProjectIds.includes(snapshot.currentProjectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, snapshot.currentProjectId];
    }
    this.priorityProjectIds = this.priorityProjectIds.filter((projectId) =>
      (snapshot.agentsList?.agents ?? []).some((agent) => agent.id === projectId),
    );
    const sessionKeys = new Set(
      (snapshot.sessionsResult?.sessions ?? []).map((session) => session.key),
    );
    this.pruneUnreadSessions(Array.from(sessionKeys));
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

  private async loadLogsPage(reset = false, quiet = false) {
    this.logsState.client = this.controllerClient;
    this.logsState.connected = this.connected;
    await this.runControllerAction(loadLogs(this.logsState, { reset, quiet }));
  }

  private normalizeStatisticsRange(value: number): WorkbenchStatisticsRange {
    return STATISTICS_RANGE_OPTIONS.has(value as WorkbenchStatisticsRange)
      ? (value as WorkbenchStatisticsRange)
      : DEFAULT_STATISTICS_RANGE_DAYS;
  }

  private async loadStatistics(force = false) {
    const rangeDays = this.normalizeStatisticsRange(this.statisticsState.rangeDays);
    if (this.statisticsState.loading) {
      return;
    }
    if (!force && this.statisticsState.lastLoadedRangeDays === rangeDays) {
      return;
    }
    this.statisticsState = {
      ...this.statisticsState,
      loading: true,
      error: null,
      rangeDays,
    };
    try {
      const dateRange = resolveStatisticsDateRange(rangeDays);
      const result = await this.adapter.request<SessionsUsageResult>("sessions.usage", {
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        mode: dateRange.mode,
        utcOffset: dateRange.utcOffset,
      });
      this.statisticsState = {
        ...this.statisticsState,
        loading: false,
        error: null,
        result,
        rangeDays,
        lastLoadedRangeDays: rangeDays,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statisticsState = {
        ...this.statisticsState,
        loading: false,
        error: message,
        rangeDays,
      };
    }
  }

  private openSettingsDialog() {
    this.openModal("settings");
    if (this.workbenchSettingsTab === "statistics") {
      void this.loadStatistics();
    }
  }

  private changeSettingsTab(value: WorkbenchSettingsTab) {
    this.workbenchSettingsTab = value;
    if (value === "statistics" && this.workbenchSettingsOpen) {
      void this.loadStatistics();
    }
  }

  private setStatisticsRange(value: WorkbenchStatisticsRange) {
    const rangeDays = this.normalizeStatisticsRange(value);
    this.statisticsState = {
      ...this.statisticsState,
      rangeDays,
      error: null,
    };
    if (this.workbenchSettingsOpen && this.workbenchSettingsTab === "statistics") {
      void this.loadStatistics(true);
    }
  }

  private startLogsAutoRefresh() {
    if (this.logsRefreshTimer != null) {
      window.clearInterval(this.logsRefreshTimer);
      this.logsRefreshTimer = null;
    }
    this.logsRefreshTimer = window.setInterval(() => {
      if (this.workbenchSection !== "logs" || !this.logsAutoFollow || !this.connected) {
        return;
      }
      void this.loadLogsPage(false, true);
    }, 3000);
  }

  private stopLogsAutoRefresh() {
    if (this.logsRefreshTimer != null) {
      window.clearInterval(this.logsRefreshTimer);
      this.logsRefreshTimer = null;
    }
  }

  private handleLogsScroll(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    this.logsAutoFollow = distanceToBottom <= 24;
  }

  private exportLogs(lines: string[], label: string) {
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const suffix = label.trim() || "logs";
    anchor.href = url;
    anchor.download = `openclaw-${suffix}-${new Date().toISOString().replaceAll(":", "-")}.log`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    this.stopLogsAutoRefresh();
    this.workbenchSection = "newTask";
    this.workbenchSelectedSessionKey = null;
    this.newTaskProjectMenuOpen = false;
    this.treeMenuOpenKey = null;
    const projectId = this.workbenchSelectedProjectId ?? this.agentsList?.defaultId ?? null;
    this.persistSettings({
      sessionKey: "",
      lastActiveSessionKey: "",
    });
    await this.refreshSnapshot(null, projectId);
  }

  private async selectProject(projectId: string) {
    const preserveFilesView = this.workbenchSection === "files";
    this.stopLogsAutoRefresh();
    this.workbenchSection = preserveFilesView ? "files" : "newTask";
    this.workbenchSelectedProjectId = projectId;
    this.workbenchSelectedSessionKey = null;
    this.newTaskProjectMenuOpen = false;
    this.treeMenuOpenKey = null;
    if (!this.expandedProjectIds.includes(projectId)) {
      this.expandedProjectIds = [...this.expandedProjectIds, projectId];
    }
    this.persistSettings({
      sessionKey: "",
      lastActiveSessionKey: "",
    });
    await this.refreshSnapshot(null, projectId);
    if (preserveFilesView) {
      await this.refreshProjectFiles(projectId);
    }
  }

  private async selectSession(sessionKey: string) {
    const projectId =
      parseAgentSessionKey(sessionKey)?.agentId ?? this.workbenchSelectedProjectId ?? null;
    this.stopLogsAutoRefresh();
    this.workbenchSection = "newTask";
    this.workbenchSelectedSessionKey = sessionKey;
    this.clearSessionUnread(sessionKey);
    this.workbenchSelectedProjectId = projectId;
    this.rightRailCollapsed = false;
    this.newTaskProjectMenuOpen = false;
    this.treeMenuOpenKey = null;
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
    const input = this.renderRoot.querySelector<HTMLInputElement>("[data-chat-file-input]");
    if (!input) {
      return;
    }
    input.click();
  }

  private openProjectFilePicker(agentId: string, path: string | null) {
    this.pendingProjectFileUploadAgentId = agentId;
    this.pendingProjectFileUploadPath = path;
    const input = this.renderRoot.querySelector<HTMLInputElement>("[data-project-file-input]");
    if (!input) {
      return;
    }
    input.click();
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
    this.selectedProjectEntryPath = null;
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
    this.selectedProjectEntryPath = null;
  }

  private revokeFilePreviewUrl() {
    const objectUrl = this.filePreviewState.objectUrl;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private resetFilePreviewState() {
    this.revokeFilePreviewUrl();
    this.filePreviewState = {
      loading: false,
      error: null,
      agentId: null,
      path: null,
      name: "",
      mode: null,
      textContent: "",
      objectUrl: null,
    };
  }

  private setSelectedProjectEntry(path: string | null) {
    const next = path?.trim() || null;
    this.selectedProjectEntryPath = next;
  }

  private syncSelectedProjectEntry(entries: WorkbenchFileEntry[]) {
    const selected = this.selectedProjectEntryPath;
    if (!selected) {
      return;
    }
    if (!entries.some((entry) => entry.path === selected)) {
      this.selectedProjectEntryPath = null;
    }
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
      this.syncSelectedProjectEntry(listing.entries);
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
      this.selectedProjectEntryPath = null;
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
    this.selectedProjectEntryPath = null;
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
      if (this.selectedProjectEntryPath === path) {
        this.selectedProjectEntryPath = null;
      }
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
        this.clearChatDraftState();
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
      this.clearSessionUnread(sessionKey);
      if (deletingCurrentSession) {
        this.workbenchSelectedSessionKey = null;
        this.persistSettings({
          sessionKey: "",
          lastActiveSessionKey: "",
        });
        this.clearChatDraftState(this.buildChatDraftKey(sessionKey, projectId));
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
      await this.adapter.downloadProjectFile(agentId, path);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.fileManagerError = this.lastError;
    } finally {
      this.fileManagerBusyPath = null;
    }
  }

  private closeFilePreview() {
    this.closeModal("filePreview", () => {
      this.resetFilePreviewState();
    });
  }

  private async previewProjectFile(agentId: string, entry: WorkbenchFileEntry) {
    const mode = resolvePreviewMode(entry);
    if (!mode) {
      await this.downloadProjectFile(agentId, entry.path);
      return;
    }
    if (mode === "text" && typeof entry.size === "number" && entry.size > TEXT_PREVIEW_MAX_BYTES) {
      this.lastError = "文本文件超过 1MB，请下载后查看。";
      this.fileManagerError = this.lastError;
      return;
    }
    this.openModal("filePreview");
    this.revokeFilePreviewUrl();
    this.filePreviewState = {
      loading: true,
      error: null,
      agentId,
      path: entry.path,
      name: entry.name,
      mode,
      textContent: "",
      objectUrl: null,
    };
    try {
      const preview = await this.adapter.previewProjectFile(agentId, entry.path, mode);
      if (preview.mode === "text") {
        this.filePreviewState = {
          ...this.filePreviewState,
          loading: false,
          textContent: preview.content,
        };
      } else {
        const mimeType = resolvePreviewMimeType(preview.mode, entry.name);
        const blob = preview.blob.type
          ? preview.blob
          : new Blob([preview.blob], { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        this.filePreviewState = {
          ...this.filePreviewState,
          loading: false,
          objectUrl,
        };
      }
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.filePreviewState = {
        ...this.filePreviewState,
        loading: false,
        error: message,
      };
      this.lastError = message;
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
      const payloads: WorkbenchUploadedFile[] = files.map((file) => ({
        name: file.name,
        file,
      }));
      await this.adapter.uploadProjectFiles(agentId, path, payloads);
      await this.refreshProjectFiles(agentId);
      await this.refreshSnapshot();
      if (options?.refreshManager && this.fileManagerAgentId === agentId) {
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
      const draftKey = this.buildChatDraftKey();
      const agentId = this.activeChatAgentId;
      const draft = this.getChatDraftState(draftKey);
      const seen = new Set(draft.files.map((entry) => entry.id));
      const additions: PendingChatFile[] = [];
      for (const file of files) {
        const id = this.buildPendingChatFileId(file);
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        additions.push({
          id,
          file,
          status: "pending",
          progress: null,
          error: null,
          uploadedEntry: null,
        });
      }
      if (additions.length > 0) {
        this.patchChatDraftState(
          (currentDraft) => ({
            ...currentDraft,
            files: [...currentDraft.files, ...additions],
          }),
          draftKey,
        );
        if (agentId) {
          void this.ensureChatDraftUploads(agentId, draftKey);
        }
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
    const draftKey = this.buildChatDraftKey();
    const draft = this.getChatDraftState(draftKey);
    const prompt = draft.message.trim();
    const runtime = this.activeSessionRuntime;
    const agentId = this.activeChatAgentId;
    if ((!prompt && draft.files.length === 0) || !runtime || !agentId) {
      return;
    }
    let outboundPrompt = prompt;
    try {
      if (draft.files.length > 0) {
        await this.ensureChatDraftUploads(agentId, draftKey);
        const uploadedEntries = this.getChatDraftState(draftKey)
          .files.map((entry) => entry.uploadedEntry)
          .filter((entry): entry is WorkbenchFileEntry => Boolean(entry));
        const relativePaths = uploadedEntries
          .map((entry) =>
            this.toWorkspaceRelativePath(entry.path, this.resolveWorkspaceForAgent(agentId)),
          )
          .filter(Boolean);
        if (relativePaths.length > 0) {
          outboundPrompt = this.formatChatMessageWithFileContext(prompt, relativePaths);
        }
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
    this.clearChatDraftState(draftKey);
    this.persistSettings({
      sessionKey: this.workbenchSelectedSessionKey ?? "",
      lastActiveSessionKey: this.workbenchSelectedSessionKey ?? "",
    });
    this.bumpChatRuntime();
    this.scheduleActiveChatScroll(true, false);
  }

  private async startTask(projectId: string) {
    const previousDraftKey = this.buildChatDraftKey(null, projectId);
    const draft = this.activeChatDraft;
    const prompt = draft.message.trim();
    if (!prompt && draft.files.length === 0) {
      return;
    }
    this.lastError = null;
    try {
      const { sessionKey } = await this.adapter.startTask(projectId, prompt, this.currentModelId);
      const nextDraft = this.getChatDraftState(previousDraftKey);
      this.workbenchSelectedProjectId = projectId;
      this.workbenchSelectedSessionKey = sessionKey;
      this.patchChatDraftState(() => nextDraft, this.buildChatDraftKey(sessionKey, projectId));
      this.clearChatDraftState(previousDraftKey);
      this.clearSessionUnread(sessionKey);
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
    const draft = this.activeChatDraft;
    const prompt = draft.message.trim();
    if (!prompt && draft.files.length === 0) {
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
      this.logsState.connected = event.connected;
      this.logsState.client = this.controllerClient;
      this.skillsState.connected = event.connected;
      this.channelsState.connected = event.connected;
      this.cronState.connected = event.connected;
      if (!event.connected) {
        this.stopLogsAutoRefresh();
      } else if (this.workbenchSection === "logs") {
        this.startLogsAutoRefresh();
      }
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
    const isActiveSession = this.workbenchSelectedSessionKey === event.sessionKey;
    if (!isActiveSession && (event.state === "delta" || event.state === "final")) {
      this.markSessionUnread(event.sessionKey);
    }
    this.bumpChatRuntime();
    if (isActiveSession) {
      if (event.state === "final" || event.state === "aborted" || event.state === "error") {
        flushToolStreamSync(runtime as unknown as Parameters<typeof flushToolStreamSync>[0]);
      }
      this.scheduleActiveChatScroll(false, event.state === "delta");
    }
    if (nextState === "final" || nextState === "aborted" || nextState === "error") {
      if (isActiveSession) {
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
    const activeDraft = this.activeChatDraft;
    const runningSessionKeys = Object.fromEntries(
      Array.from(this.chatRuntimeBySessionKey.entries()).flatMap(([sessionKey, runtime]) =>
        runtime.chatSending || Boolean(runtime.chatRunId) ? [[sessionKey, true] as const] : [],
      ),
    );
    const unreadSessionKeys = Object.fromEntries(
      this.unreadSessionKeys.map((sessionKey) => [sessionKey, true] as const),
    );
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
      selectedProjectEntryPath: this.selectedProjectEntryPath,
      filePreviewOpen: this.filePreviewOpen,
      filePreviewClosing: this.filePreviewClosing,
      filePreviewLoading: this.filePreviewState.loading,
      filePreviewError: this.filePreviewState.error,
      filePreviewAgentId: this.filePreviewState.agentId,
      filePreviewName: this.filePreviewState.name,
      filePreviewPath: this.filePreviewState.path,
      filePreviewMode: this.filePreviewState.mode,
      filePreviewTextContent: this.filePreviewState.textContent,
      filePreviewObjectUrl: this.filePreviewState.objectUrl,
      sessionsResult: this.sessionsResult,
      chatMessages: activeRuntime?.chatMessages ?? [],
      chatMessage: activeDraft.message,
      pendingChatFiles: activeDraft.files.map((entry) => ({
        id: entry.id,
        name: entry.file.name,
        size: entry.file.size,
        status: entry.status,
        progress: entry.progress,
        error: entry.error,
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
        archiveBusy: this.skillsState.skillsArchiveBusy,
        items: this.skillsState.skillsCatalog,
        categories: this.skillsState.skillsCategories,
        pagination: this.skillsState.skillsPagination,
        error: this.skillsState.skillsError,
        notice: this.skillsState.skillsNotice,
        filter: this.skillsState.skillsFilter,
        selectedCategory: this.skillsState.skillsCategory,
        sortBy: this.skillsState.skillsSortBy,
        installFilter: this.skillsState.skillsInstallFilter,
        busyKey: this.skillsState.skillsBusyKey,
        messages: this.skillsState.skillMessages,
        registryBaseUrl: this.skillsState.skillsRegistryBaseUrl,
        onSearchChange: (next) => {
          setSkillsFilter(this.skillsState, next);
          this.requestUpdate();
        },
        onCategoryChange: (next) => {
          setSkillsCategory(this.skillsState, next);
          this.requestUpdate();
        },
        onSortChange: (next) => {
          setSkillsSortBy(this.skillsState, next);
          this.requestUpdate();
        },
        onInstallFilterChange: (next) => {
          setSkillsInstallFilter(this.skillsState, next);
          this.requestUpdate();
        },
        onRefresh: () => {
          void this.loadSkillsPage(true);
        },
        onPageChange: (next) => {
          setSkillsPage(this.skillsState, next);
          this.requestUpdate();
        },
        onToggleInstall: (item) => {
          void this.runControllerAction(toggleRegistrySkillInstall(this.skillsState, item));
        },
        onImportArchive: (file) => {
          void this.runControllerAction(importRegistrySkillArchive(this.skillsState, file));
        },
        onDismissNotice: () => {
          this.skillsState.skillsNotice = null;
          this.requestUpdate();
        },
        onDismissError: () => {
          this.skillsState.skillsError = null;
          this.requestUpdate();
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
      logsPage: {
        loading: this.logsState.logsLoading,
        error: this.logsState.logsError,
        file: this.logsState.logsFile,
        entries: this.logsState.logsEntries,
        filterText: this.logsFilterText,
        levelFilters: this.logsLevelFilters,
        autoFollow: this.logsAutoFollow,
        truncated: this.logsState.logsTruncated,
        onFilterTextChange: (next) => {
          this.logsFilterText = next;
        },
        onLevelToggle: (level, enabled) => {
          this.logsLevelFilters = { ...this.logsLevelFilters, [level]: enabled };
        },
        onToggleAutoFollow: (next) => {
          this.logsAutoFollow = next;
          if (next && this.workbenchSection === "logs") {
            this.startLogsAutoRefresh();
          }
        },
        onRefresh: () => {
          void this.loadLogsPage(true);
        },
        onExport: (lines, label) => {
          this.exportLogs(lines, label);
        },
        onScroll: (event) => {
          this.handleLogsScroll(event);
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
        statistics: {
          loading: this.statisticsState.loading,
          error: this.statisticsState.error,
          selectedRangeDays: this.statisticsState.rangeDays,
          totalTokens: this.statisticsState.result?.totals.totalTokens ?? 0,
          inputTokens: this.statisticsState.result?.totals.input ?? 0,
          outputTokens: this.statisticsState.result?.totals.output ?? 0,
          cacheTokens:
            (this.statisticsState.result?.totals.cacheRead ?? 0) +
            (this.statisticsState.result?.totals.cacheWrite ?? 0),
          sessionCount: this.statisticsState.result?.sessions.length ?? 0,
          updatedAt: this.statisticsState.result?.updatedAt ?? null,
          onRangeChange: (value) => {
            this.setStatisticsRange(value);
          },
          onRefresh: () => {
            void this.loadStatistics(true);
          },
        },
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
      runningSessionKeys,
      unreadSessionKeys,
      onNavigateLegacy: () => {
        const base = this.basePath || "";
        window.location.href = `${base}/overview`;
      },
      onSectionChange: (section) => {
        void (async () => {
          if (section === "newTask") {
            this.stopLogsAutoRefresh();
            await this.enterNewTask();
            return;
          }
          this.workbenchSection = section;
          this.newTaskProjectMenuOpen = false;
          this.treeMenuOpenKey = null;
          if (section === "files") {
            this.stopLogsAutoRefresh();
            const projectId =
              this.workbenchSelectedProjectId ??
              this.agentsList?.defaultId ??
              this.agentsList?.agents[0]?.id ??
              null;
            if (projectId) {
              this.workbenchSelectedProjectId = projectId;
              await this.refreshProjectFiles(projectId);
            }
            return;
          }
          if (section === "skills") {
            this.stopLogsAutoRefresh();
            await this.loadSkillsPage(true);
            return;
          }
          if (section === "automations") {
            this.stopLogsAutoRefresh();
            await this.loadAutomationsPage();
            return;
          }
          if (section === "logs") {
            await this.loadLogsPage(true);
            this.startLogsAutoRefresh();
            return;
          }
          this.stopLogsAutoRefresh();
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
        this.patchChatDraftState((draft) => ({
          ...draft,
          files: draft.files.filter((entry) => entry.id !== id),
        }));
      },
      onComposerChange: (value) => {
        this.patchChatDraftState((draft) => ({ ...draft, message: value }));
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
        this.openSettingsDialog();
      },
      onCloseSettings: () => {
        this.closeModal("settings");
      },
      onSettingsTabChange: (value) => {
        this.changeSettingsTab(value);
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
      fileSortKey: this.fileSortKey,
      fileSearchQuery: this.fileSearchQuery,
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
      onFileSortChange: (value) => {
        this.fileSortKey = value;
      },
      onFileSearchChange: (value) => {
        this.fileSearchQuery = value;
      },
      onOpenProjectFilePicker: (agentId, path) => {
        this.openProjectFilePicker(agentId, path);
      },
      onDownloadProjectFile: (agentId, path) => {
        void this.downloadProjectFile(agentId, path);
      },
      onPreviewProjectFile: (agentId, entry) => {
        void this.previewProjectFile(agentId, entry);
      },
      onSelectProjectEntry: (path) => {
        this.setSelectedProjectEntry(path);
      },
      onClearProjectEntrySelection: () => {
        this.setSelectedProjectEntry(null);
      },
      onCloseFilePreview: () => {
        this.closeFilePreview();
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
