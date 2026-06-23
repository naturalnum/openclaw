import { useCallback, useEffect, useState } from "react";
import { loadSettings, saveSettings, type UiSettings } from "../../compat/ui-core";
import { bootstrapSettingsFromUrl } from "../lib/bootstrap-settings-from-url";

function isViteDevPage(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector('script[src*="/@vite/client"]'));
}

/**
 * Local mirror of persisted Control UI settings (same keys as Lit workbench).
 */
export function usePowerUiSettings() {
  const [settings, setSettings] = useState<UiSettings>(() =>
    bootstrapSettingsFromUrl(loadSettings()),
  );

  useEffect(() => {
    if (!isViteDevPage()) {
      return undefined;
    }
    let cancelled = false;
    void fetch("/__openclaw/dev-gateway.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { gatewayUrl?: string; token?: string } | null) => {
        if (cancelled) {
          return;
        }
        const token = payload?.token?.trim() ?? "";
        const gatewayUrl = payload?.gatewayUrl?.trim() ?? "";
        if (!token && !gatewayUrl) {
          return;
        }
        const current = loadSettings();
        const next: UiSettings = {
          ...current,
          gatewayUrl: gatewayUrl || current.gatewayUrl,
          token: token || current.token,
        };
        if (next.gatewayUrl === current.gatewayUrl && next.token === current.token) {
          return;
        }
        saveSettings(next);
        setSettings(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings.gatewayUrl, settings.token]);

  const refresh = useCallback(() => {
    setSettings(loadSettings());
  }, []);

  const replaceSettings = useCallback((next: UiSettings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  const patchSettings = useCallback((patch: Partial<UiSettings>) => {
    const next = { ...loadSettings(), ...patch };
    saveSettings(next);
    setSettings(next);
  }, []);

  return { settings, refresh, replaceSettings, patchSettings };
}
