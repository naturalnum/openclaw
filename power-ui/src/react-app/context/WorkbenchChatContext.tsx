import { createContext, useContext, type ReactNode } from "react";
import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { UiSettings } from "../../compat/ui-core";
import { usePowerWorkbenchChat } from "../hooks/usePowerWorkbenchChat";

export type WorkbenchChatContextValue = ReturnType<typeof usePowerWorkbenchChat>;

const WorkbenchChatContext = createContext<WorkbenchChatContextValue | null>(null);

type ProviderProps = {
  adapter: GatewayWorkbenchAdapter | null;
  patchSettings: (patch: Partial<UiSettings>) => void;
  userScope?: string;
  children: ReactNode;
};

export function WorkbenchChatProvider({
  adapter,
  patchSettings,
  userScope = "",
  children,
}: ProviderProps) {
  const value = usePowerWorkbenchChat(adapter, patchSettings, userScope);
  return <WorkbenchChatContext.Provider value={value}>{children}</WorkbenchChatContext.Provider>;
}

export function useWorkbenchChat(): WorkbenchChatContextValue {
  const ctx = useContext(WorkbenchChatContext);
  if (!ctx) {
    throw new Error("useWorkbenchChat must be used within WorkbenchChatProvider");
  }
  return ctx;
}
