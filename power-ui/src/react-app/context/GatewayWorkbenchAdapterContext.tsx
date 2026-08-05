import { createContext, useContext, type ReactNode } from "react";
import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";

const GatewayWorkbenchAdapterContext = createContext<GatewayWorkbenchAdapter | null | undefined>(
  undefined,
);

export function GatewayWorkbenchAdapterProvider({
  adapter,
  children,
}: {
  adapter: GatewayWorkbenchAdapter | null;
  children: ReactNode;
}) {
  return (
    <GatewayWorkbenchAdapterContext.Provider value={adapter}>
      {children}
    </GatewayWorkbenchAdapterContext.Provider>
  );
}

export function useSharedGatewayWorkbenchAdapter(): GatewayWorkbenchAdapter | null {
  const adapter = useContext(GatewayWorkbenchAdapterContext);
  if (adapter === undefined) {
    throw new Error(
      "useSharedGatewayWorkbenchAdapter must be used within GatewayWorkbenchAdapterProvider",
    );
  }
  return adapter;
}
