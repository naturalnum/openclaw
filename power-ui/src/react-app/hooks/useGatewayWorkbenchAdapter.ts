import { useEffect, useState } from "react";
import { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { UiSettings } from "../../compat/ui-core";

/**
 * One gateway adapter per gateway URL + token + local-user scope pair; disposes on change or unmount.
 */
export function useGatewayWorkbenchAdapter(
  settings: Pick<UiSettings, "gatewayUrl" | "token">,
  userScope = "",
) {
  const [adapter, setAdapter] = useState<GatewayWorkbenchAdapter | null>(null);

  useEffect(() => {
    const next = new GatewayWorkbenchAdapter({
      getSettings: () => ({
        gatewayUrl: settings.gatewayUrl.trim(),
        token: settings.token.trim(),
      }),
      getUserScope: () => userScope.trim(),
    });
    setAdapter(next);
    return () => {
      next.dispose();
    };
  }, [settings.gatewayUrl, settings.token, userScope]);

  return adapter;
}
