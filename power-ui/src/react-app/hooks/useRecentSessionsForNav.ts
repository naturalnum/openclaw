import { useCallback, useEffect, useState } from "react";

import type { GatewayWorkbenchAdapter } from "../../adapters/gateway-workbench-adapter";
import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter";

export type RecentSessionNavItem = {
  key: string;
  label: string;
  updatedAt: number | null;
};

/**
 * 侧栏「最近」：拉取会话列表，并在网关事件后轻量刷新。
 */
export function useRecentSessionsForNav(adapter: GatewayWorkbenchAdapter | null) {
  const [sessions, setSessions] = useState<RecentSessionNavItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!adapter) {
      setSessions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await adapter.request<{
        sessions?: Array<{ key?: string; label?: string; updatedAt?: number | null }>;
      }>("sessions.list", {
        includeGlobal: false,
        includeUnknown: true,
        limit: 40,
      });
      const rows = Array.isArray(res.sessions) ? res.sessions : [];
      const mapped: RecentSessionNavItem[] = rows
        .filter((r) => typeof r.key === "string" && r.key.trim())
        .map((r) => ({
          key: r.key!.trim(),
          label: (typeof r.label === "string" ? r.label : "").trim() || r.key!.trim(),
          updatedAt: typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : null,
        }))
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 24);
      setSessions(mapped);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!adapter) {
      return;
    }
    let t: number | null = null;
    const sub = adapter.subscribe((event: WorkbenchAdapterEvent) => {
      if (event.type === "chat" && (event.state === "final" || event.state === "error")) {
        if (t != null) {
          window.clearTimeout(t);
        }
        t = window.setTimeout(() => {
          t = null;
          void refetch();
        }, 400);
      }
    });
    return () => {
      sub();
      if (t != null) {
        window.clearTimeout(t);
      }
    };
  }, [adapter, refetch]);

  return { sessions, loading, refetch };
}
