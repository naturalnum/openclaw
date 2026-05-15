import { useCallback, useEffect, useState } from "react";

import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { SkillStatusReport } from "../../compat/types";

type UseSkillsStatusResult = {
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  setSkillEnabled: (skillKey: string, enabled: boolean) => Promise<void>;
  busyKey: string | null;
};

/**
 * Loads `skills.status` via the workbench adapter and exposes toggle wiring.
 */
export function useSkillsStatus(adapter: GatewayWorkbenchAdapter | null): UseSkillsStatusResult {
  const [report, setReport] = useState<SkillStatusReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!adapter) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adapter.request<SkillStatusReport | undefined>("skills.status", {});
      setReport(res ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setSkillEnabled = useCallback(
    async (skillKey: string, enabled: boolean) => {
      if (!adapter) {
        return;
      }
      setBusyKey(skillKey);
      setError(null);
      try {
        await adapter.setSkillEnabled(skillKey, enabled);
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setBusyKey(null);
      }
    },
    [adapter, refetch],
  );

  return { report, loading, error, refetch, setSkillEnabled, busyKey };
}
