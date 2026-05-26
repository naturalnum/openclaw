import { saveSettings, type UiSettings } from "../../compat/ui-core";

/**
 * Apply one-shot gateway/token bootstrap from the page URL (?gatewayUrl=&token=).
 * HashRouter owns the fragment route (#/…), so query params must live in search.
 */
export function bootstrapSettingsFromUrl(settings: UiSettings): UiSettings {
  if (typeof window === "undefined") {
    return settings;
  }
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const gatewayUrl = params.get("gatewayUrl")?.trim() ?? "";
  const token = params.get("token")?.trim() ?? "";
  if (!gatewayUrl && !token) {
    return settings;
  }

  let next = settings;
  if (gatewayUrl) {
    next = { ...next, gatewayUrl };
  }
  if (token) {
    next = { ...next, token };
  }
  saveSettings(next);

  if (params.has("gatewayUrl") || params.has("token")) {
    params.delete("gatewayUrl");
    params.delete("token");
    url.search = params.toString();
    window.history.replaceState({}, "", url.toString());
  }

  return next;
}
