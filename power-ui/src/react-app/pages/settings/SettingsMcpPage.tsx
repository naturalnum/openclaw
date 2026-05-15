import { CloudServerOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Spin, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import type { ConfigSnapshot } from "../../../compat/types";
import { PageHeader } from "../../components/ui/PageHeader";
import { useGatewayWorkbenchAdapter } from "../../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";
import { ROUTES } from "../../router/paths";

const { Paragraph } = Typography;

function mcpServerSummary(cfg: Record<string, unknown>): string {
  const t = typeof cfg.type === "string" ? cfg.type : "";
  if (typeof cfg.url === "string" && cfg.url.trim()) {
    return `${t || "http"} · ${cfg.url.trim()}`;
  }
  if (typeof cfg.command === "string" && cfg.command.trim()) {
    return `${t || "stdio"} · ${cfg.command.trim()}`;
  }
  return t || "—";
}

export function SettingsMcpPage() {
  const { settings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const canUseGateway = Boolean(settings.gatewayUrl.trim());

  const [mcpRows, setMcpRows] = useState<Array<{ key: string; summary: string }>>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  const loadMcp = useCallback(async () => {
    if (!adapter || !canUseGateway) {
      setMcpRows([]);
      return;
    }
    setMcpLoading(true);
    setMcpError(null);
    try {
      const snap = await adapter.request<ConfigSnapshot>("config.get", {});
      const cfg = snap.config;
      const mcp =
        cfg && typeof cfg === "object" && "mcp" in cfg && cfg.mcp && typeof cfg.mcp === "object"
          ? (cfg.mcp as Record<string, unknown>)
          : null;
      const servers =
        mcp && "servers" in mcp && mcp.servers && typeof mcp.servers === "object" && !Array.isArray(mcp.servers)
          ? (mcp.servers as Record<string, Record<string, unknown>>)
          : null;
      if (!servers) {
        setMcpRows([]);
        return;
      }
      setMcpRows(
        Object.entries(servers).map(([key, value]) => ({
          key,
          summary: value && typeof value === "object" ? mcpServerSummary(value) : "—",
        })),
      );
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : String(e));
      setMcpRows([]);
    } finally {
      setMcpLoading(false);
    }
  }, [adapter, canUseGateway]);

  const mcpColumns: ColumnsType<{ key: string; summary: string }> = [
    { title: "服务器名（配置键）", dataIndex: "key", key: "key", ellipsis: true },
    { title: "概要", dataIndex: "summary", key: "summary", ellipsis: true },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        compact
        title="MCP"
        description="查看全局 mcp.servers 摘要；修改请用配置文件或 CLI。"
      />
      <Card className="rounded-xl border-slate-200/90 shadow-sm" styles={{ body: { padding: "16px 18px" } }}>
        <div className="space-y-3">
          {!canUseGateway ? (
            <Alert type="warning" showIcon message="请先填写并保存 Gateway 地址" className="text-sm" />
          ) : null}
          <Paragraph className="!mb-0 max-w-2xl text-xs leading-relaxed text-slate-600">
            读取 <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">config.get</code> 中的{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">mcp.servers</code>。更多见{" "}
            <Link to={ROUTES.workbench} className="text-[#0d6b52] hover:underline">
              工作台
            </Link>
            。
          </Paragraph>
          <Button type="primary" size="small" icon={<CloudServerOutlined />} disabled={!canUseGateway} loading={mcpLoading} onClick={() => void loadMcp()}>
            读取 MCP 配置
          </Button>
          {mcpError ? <Alert type="error" showIcon message={mcpError} className="text-sm" /> : null}
          <Spin spinning={mcpLoading}>
            {mcpRows.length === 0 && !mcpLoading && canUseGateway ? (
              <Paragraph type="secondary" className="!mb-0 text-sm">
                暂无条目，或尚未点击「读取」。
              </Paragraph>
            ) : (
              <Table<{ key: string; summary: string }>
                size="small"
                rowKey={(r) => r.key}
                columns={mcpColumns}
                dataSource={mcpRows}
                pagination={false}
              />
            )}
          </Spin>
        </div>
      </Card>
    </div>
  );
}
