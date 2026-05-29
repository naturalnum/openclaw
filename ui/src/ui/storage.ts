const SETTINGS_KEY_PREFIX = "openclaw.control.settings.v1:";
const LEGACY_SETTINGS_KEY = "openclaw.control.settings.v1";
const LEGACY_TOKEN_SESSION_KEY = "openclaw.control.token.v1";
const TOKEN_SESSION_KEY_PREFIX = "openclaw.control.token.v1:";
const MAX_SCOPED_SESSION_ENTRIES = 10;
const DEFAULT_VITE_DEV_GATEWAY_PORT = "19001";
const ALT_VITE_DEV_GATEWAY_PORT = "18789";

function readConfiguredViteDevGatewayPort(): string | null {
  if (typeof import.meta === "undefined") {
    return null;
  }
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const raw = env?.VITE_OPENCLAW_GATEWAY_PORT?.trim();
  return raw || null;
}

function resolveViteDevGatewayPorts(): { primary: string; legacy: string } {
  const configured = readConfiguredViteDevGatewayPort();
  const primary = configured ?? DEFAULT_VITE_DEV_GATEWAY_PORT;
  const legacy =
    primary === DEFAULT_VITE_DEV_GATEWAY_PORT
      ? ALT_VITE_DEV_GATEWAY_PORT
      : DEFAULT_VITE_DEV_GATEWAY_PORT;
  return { primary, legacy };
}

function settingsKeyForGateway(gatewayUrl: string): string {
  return `${SETTINGS_KEY_PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

type ScopedSessionSelection = {
  sessionKey: string;
  lastActiveSessionKey: string;
};

type PersistedUiSettings = Omit<UiSettings, "token" | "sessionKey" | "lastActiveSessionKey"> & {
  token?: never;
  sessionKey?: string;
  lastActiveSessionKey?: string;
  sessionsByGateway?: Record<string, ScopedSessionSelection>;
};

import { isSupportedLocale } from "../i18n/index.ts";
import { resolveNavigatorLocale } from "../i18n/lib/registry.ts";
import { getSafeLocalStorage, getSafeSessionStorage } from "../local-storage.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "./navigation.ts";
import { normalizeOptionalString } from "./string-coerce.ts";
import { parseThemeSelection, type ThemeMode, type ThemeName } from "./theme.ts";

export const BORDER_RADIUS_STOPS = [0, 25, 50, 75, 100] as const;
export type BorderRadiusStop = (typeof BORDER_RADIUS_STOPS)[number];

function snapBorderRadius(value: number): BorderRadiusStop {
  let best: BorderRadiusStop = BORDER_RADIUS_STOPS[0];
  let bestDist = Math.abs(value - best);
  for (const stop of BORDER_RADIUS_STOPS) {
    const dist = Math.abs(value - stop);
    if (dist < bestDist) {
      best = stop;
      bestDist = dist;
    }
  }
  return best;
}

export type UiSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
  lastActiveSessionKey: string;
  theme: ThemeName;
  themeMode: ThemeMode;
  chatFocusMode: boolean;
  chatShowThinking: boolean;
  chatShowToolCalls: boolean;
  splitRatio: number; // Sidebar split ratio (0.4 to 0.7, default 0.6)
  navCollapsed: boolean; // Collapsible sidebar state
  navWidth: number; // Sidebar width when expanded
  navGroupsCollapsed: Record<string, boolean>; // Which nav groups are collapsed
  showCodeNav?: boolean; // Whether to show the Code entry in the main navigation
  borderRadius: number; // Corner roundness (0–100, default 50)
  locale?: string;
  /** Power UI React：对话首选模型 ref（如 `openai/gpt-5.4`），空则用网关目录首项 */
  chatPreferredModelRef?: string;
};

function isViteDevPage(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector('script[src*="/@vite/client"]'));
}

function formatHostWithPort(hostname: string, port: string): string {
  const normalizedHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${normalizedHost}:${port}`;
}

function deriveDefaultGatewayUrl(): {
  pageUrl: string;
  effectiveUrl: string;
  legacyEffectiveUrl?: string;
} {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const configured =
    typeof window !== "undefined" &&
    normalizeOptionalString(window.__OPENCLAW_CONTROL_UI_BASE_PATH__);
  const basePath = configured
    ? normalizeBasePath(configured)
    : inferBasePathFromPathname(location.pathname);
  const pageUrl = `${proto}://${location.host}${basePath}`;
  if (!isViteDevPage()) {
    return { pageUrl, effectiveUrl: pageUrl };
  }
  const { primary, legacy } = resolveViteDevGatewayPorts();
  const effectiveUrl = `${proto}://${formatHostWithPort(location.hostname, primary)}`;
  const legacyEffectiveUrl = `${proto}://${formatHostWithPort(location.hostname, legacy)}`;
  return { pageUrl, effectiveUrl, legacyEffectiveUrl };
}

function getSessionStorage(): Storage | null {
  return getSafeSessionStorage();
}

function normalizeGatewayTokenScope(gatewayUrl: string): string {
  const trimmed = normalizeOptionalString(gatewayUrl) ?? "";
  if (!trimmed) {
    return "default";
  }
  try {
    const base =
      typeof location !== "undefined"
        ? `${location.protocol}//${location.host}${location.pathname || "/"}`
        : undefined;
    const parsed = base ? new URL(trimmed, base) : new URL(trimmed);
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "") || parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return trimmed;
  }
}

function tokenSessionKeyForGateway(gatewayUrl: string): string {
  return `${TOKEN_SESSION_KEY_PREFIX}${normalizeGatewayTokenScope(gatewayUrl)}`;
}

function resolveScopedSessionSelection(
  gatewayUrl: string,
  parsed: PersistedUiSettings,
  defaults: UiSettings,
): ScopedSessionSelection {
  const scope = normalizeGatewayTokenScope(gatewayUrl);
  const scoped = parsed.sessionsByGateway?.[scope];
  const scopedSessionKey = normalizeOptionalString(scoped?.sessionKey);
  const scopedLastActiveSessionKey = normalizeOptionalString(scoped?.lastActiveSessionKey);
  if (scopedSessionKey && scopedLastActiveSessionKey) {
    return {
      sessionKey: scopedSessionKey,
      lastActiveSessionKey: scopedLastActiveSessionKey,
    };
  }

  const legacySessionKey = normalizeOptionalString(parsed.sessionKey) ?? defaults.sessionKey;
  const legacyLastActiveSessionKey =
    normalizeOptionalString(parsed.lastActiveSessionKey) ??
    legacySessionKey ??
    defaults.lastActiveSessionKey;

  return {
    sessionKey: legacySessionKey,
    lastActiveSessionKey: legacyLastActiveSessionKey,
  };
}

function loadSessionToken(gatewayUrl: string): string {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return "";
    }
    storage.removeItem(LEGACY_TOKEN_SESSION_KEY);
    const token = storage.getItem(tokenSessionKeyForGateway(gatewayUrl));
    return normalizeOptionalString(token) ?? "";
  } catch {
    return "";
  }
}

/** Reuse token scoped to a legacy dev gateway URL (e.g. 19001 → 18789 migration). */
function resolveSessionToken(
  gatewayUrl: string,
  legacyGatewayUrls: Array<string | undefined>,
): string {
  const primary = loadSessionToken(gatewayUrl);
  if (primary) {
    return primary;
  }
  for (const legacyUrl of legacyGatewayUrls) {
    const normalized = normalizeOptionalString(legacyUrl);
    if (!normalized || normalized === gatewayUrl) {
      continue;
    }
    const legacyToken = loadSessionToken(normalized);
    if (legacyToken) {
      persistSessionToken(gatewayUrl, legacyToken);
      return legacyToken;
    }
  }
  try {
    const storage = getSessionStorage();
    const legacy = normalizeOptionalString(storage?.getItem(LEGACY_TOKEN_SESSION_KEY));
    if (legacy) {
      persistSessionToken(gatewayUrl, legacy);
      return legacy;
    }
  } catch {
    // best-effort
  }
  return "";
}

function persistSessionToken(gatewayUrl: string, token: string) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    storage.removeItem(LEGACY_TOKEN_SESSION_KEY);
    const key = tokenSessionKeyForGateway(gatewayUrl);
    const normalized = normalizeOptionalString(token) ?? "";
    if (normalized) {
      storage.setItem(key, normalized);
      return;
    }
    storage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function loadSettings(): UiSettings {
  const {
    pageUrl: pageDerivedUrl,
    effectiveUrl: defaultUrl,
    legacyEffectiveUrl,
  } = deriveDefaultGatewayUrl();
  const storage = getSafeLocalStorage();
  const defaultLocale = resolveNavigatorLocale(
    typeof globalThis.navigator?.language === "string" ? globalThis.navigator.language : "",
  );

  const defaults: UiSettings = {
    gatewayUrl: defaultUrl,
    token: resolveSessionToken(defaultUrl, [legacyEffectiveUrl, pageDerivedUrl]),
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "claw",
    themeMode: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 312,
    navGroupsCollapsed: {},
    showCodeNav: true,
    borderRadius: 50,
    locale: defaultLocale,
    chatPreferredModelRef: "",
  };

  try {
    // First check for legacy key (no scope), then check for scoped key
    const scopedKey = settingsKeyForGateway(defaults.gatewayUrl);
    const raw =
      storage?.getItem(scopedKey) ??
      storage?.getItem(SETTINGS_KEY_PREFIX + "default") ??
      storage?.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as PersistedUiSettings;
    const parsedGatewayUrl = normalizeOptionalString(parsed.gatewayUrl) ?? defaults.gatewayUrl;
    let gatewayUrl =
      parsedGatewayUrl === pageDerivedUrl || parsedGatewayUrl === legacyEffectiveUrl
        ? defaultUrl
        : parsedGatewayUrl;
    if (
      isViteDevPage() &&
      readConfiguredViteDevGatewayPort() === ALT_VITE_DEV_GATEWAY_PORT &&
      legacyEffectiveUrl
    ) {
      try {
        const parsedUrl = new URL(parsedGatewayUrl);
        const legacyUrl = new URL(legacyEffectiveUrl);
        if (parsedUrl.hostname === legacyUrl.hostname && parsedUrl.port === legacyUrl.port) {
          gatewayUrl = defaultUrl;
        }
      } catch {
        // keep parsed gatewayUrl
      }
    }
    const scopedSessionSelection = resolveScopedSessionSelection(gatewayUrl, parsed, defaults);
    const { theme, mode } = parseThemeSelection(
      (parsed as { theme?: unknown }).theme,
      (parsed as { themeMode?: unknown }).themeMode,
    );
    const settings = {
      gatewayUrl,
      // Gateway auth is intentionally in-memory only; scrub any legacy persisted token on load.
      token: resolveSessionToken(gatewayUrl, [
        legacyEffectiveUrl,
        pageDerivedUrl,
        parsedGatewayUrl,
      ]),
      sessionKey: scopedSessionSelection.sessionKey,
      lastActiveSessionKey: scopedSessionSelection.lastActiveSessionKey,
      theme,
      themeMode: mode,
      chatFocusMode:
        typeof parsed.chatFocusMode === "boolean" ? parsed.chatFocusMode : defaults.chatFocusMode,
      chatShowThinking:
        typeof parsed.chatShowThinking === "boolean"
          ? parsed.chatShowThinking
          : defaults.chatShowThinking,
      chatShowToolCalls:
        typeof parsed.chatShowToolCalls === "boolean"
          ? parsed.chatShowToolCalls
          : defaults.chatShowToolCalls,
      splitRatio:
        typeof parsed.splitRatio === "number" &&
        parsed.splitRatio >= 0.4 &&
        parsed.splitRatio <= 0.7
          ? parsed.splitRatio
          : defaults.splitRatio,
      navCollapsed:
        typeof parsed.navCollapsed === "boolean" ? parsed.navCollapsed : defaults.navCollapsed,
      navWidth:
        typeof parsed.navWidth === "number" && parsed.navWidth >= 160 && parsed.navWidth <= 960
          ? parsed.navWidth
          : defaults.navWidth,
      navGroupsCollapsed:
        typeof parsed.navGroupsCollapsed === "object" && parsed.navGroupsCollapsed !== null
          ? parsed.navGroupsCollapsed
          : defaults.navGroupsCollapsed,
      showCodeNav:
        typeof (parsed as { showCodeNav?: unknown }).showCodeNav === "boolean"
          ? Boolean((parsed as { showCodeNav?: unknown }).showCodeNav)
          : defaults.showCodeNav,
      borderRadius:
        typeof parsed.borderRadius === "number" &&
        parsed.borderRadius >= 0 &&
        parsed.borderRadius <= 100
          ? snapBorderRadius(parsed.borderRadius)
          : defaults.borderRadius,
      locale: isSupportedLocale(parsed.locale) ? parsed.locale : defaults.locale,
      chatPreferredModelRef:
        typeof (parsed as { chatPreferredModelRef?: unknown }).chatPreferredModelRef === "string"
          ? ((parsed as { chatPreferredModelRef: string }).chatPreferredModelRef ?? "").trim()
          : (defaults.chatPreferredModelRef ?? ""),
    };
    if ("token" in parsed) {
      persistSettings(settings);
    }
    return settings;
  } catch {
    return defaults;
  }
}

export function saveSettings(next: UiSettings) {
  persistSettings(next);
}

function persistSettings(next: UiSettings) {
  persistSessionToken(next.gatewayUrl, next.token);
  const storage = getSafeLocalStorage();
  const scope = normalizeGatewayTokenScope(next.gatewayUrl);
  const scopedKey = settingsKeyForGateway(next.gatewayUrl);
  let existingSessionsByGateway: Record<string, ScopedSessionSelection> = {};
  try {
    // Try to migrate from legacy key or other scopes
    const raw =
      storage?.getItem(scopedKey) ??
      storage?.getItem(SETTINGS_KEY_PREFIX + "default") ??
      storage?.getItem("openclaw.control.settings.v1");
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedUiSettings;
      if (parsed.sessionsByGateway && typeof parsed.sessionsByGateway === "object") {
        existingSessionsByGateway = parsed.sessionsByGateway;
      }
    }
  } catch {
    // best-effort
  }
  const sessionsByGateway = Object.fromEntries(
    [
      ...Object.entries(existingSessionsByGateway).filter(([key]) => key !== scope),
      [
        scope,
        {
          sessionKey: next.sessionKey,
          lastActiveSessionKey: next.lastActiveSessionKey,
        },
      ],
    ].slice(-MAX_SCOPED_SESSION_ENTRIES),
  );
  const persisted: PersistedUiSettings = {
    gatewayUrl: next.gatewayUrl,
    theme: next.theme,
    themeMode: next.themeMode,
    chatFocusMode: next.chatFocusMode,
    chatShowThinking: next.chatShowThinking,
    chatShowToolCalls: next.chatShowToolCalls,
    splitRatio: next.splitRatio,
    navCollapsed: next.navCollapsed,
    navWidth: next.navWidth,
    navGroupsCollapsed: next.navGroupsCollapsed,
    showCodeNav: next.showCodeNav,
    borderRadius: next.borderRadius,
    sessionsByGateway,
    chatPreferredModelRef: next.chatPreferredModelRef?.trim() ?? "",
    ...(next.locale ? { locale: next.locale } : {}),
  };
  const serialized = JSON.stringify(persisted);
  try {
    storage?.setItem(scopedKey, serialized);
    storage?.setItem(LEGACY_SETTINGS_KEY, serialized);
  } catch {
    // best-effort — quota exceeded or security restrictions should not
    // prevent in-memory settings and visual updates from being applied
  }
}
