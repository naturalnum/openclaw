import { useEffect, useState } from "react";

import { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { UiSettings } from "../../compat/ui-core";

/**
 * One gateway adapter per gateway URL + token pair; disposes on change or unmount.
 */
export function useGatewayWorkbenchAdapter(settings: Pick<UiSettings, "gatewayUrl" | "token">) {
  const [adapter, setAdapter] = useState<GatewayWorkbenchAdapter | null>(null);

  useEffect(() => {
    const next = new GatewayWorkbenchAdapter({
      getSettings: () => ({
        gatewayUrl: settings.gatewayUrl.trim(),
        token: settings.token.trim(),
      }),
    });
    setAdapter(next);
    return () => {
      next.dispose();
    };
  }, [settings.gatewayUrl, settings.token]);

  return adapter;
}
