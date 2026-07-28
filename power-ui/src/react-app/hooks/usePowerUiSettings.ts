import { useCallback, useState } from "react";
import { loadSettings, saveSettings, type UiSettings } from "../../compat/ui-core";
import { bootstrapSettingsFromUrl } from "../lib/bootstrap-settings-from-url";

/**
 * Local mirror of persisted Control UI settings (same keys as Lit workbench).
 */
export function usePowerUiSettings() {
  const [settings, setSettings] = useState<UiSettings>(() =>
    bootstrapSettingsFromUrl(loadSettings()),
  );

  const refresh = useCallback(() => {
    setSettings(loadSettings());
  }, []);

  const replaceSettings = useCallback((next: UiSettings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  const patchSettings = useCallback((patch: Partial<UiSettings>) => {
    const current = loadSettings();
    const changed = (Object.keys(patch) as Array<keyof UiSettings>).some(
      (key) => !Object.is(current[key], patch[key]),
    );
    if (!changed) {
      return;
    }
    const next = { ...current, ...patch };
    saveSettings(next);
    setSettings(next);
  }, []);

  return { settings, refresh, replaceSettings, patchSettings };
}
