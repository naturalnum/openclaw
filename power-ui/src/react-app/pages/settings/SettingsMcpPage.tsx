import {
  CloudServerOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { cloneConfigObject, serializeConfigForm } from "../../../compat/controllers";
import type { ConfigSnapshot } from "../../../compat/types";
import { PageHeader } from "../../components/ui/PageHeader";
import { useGatewayWorkbenchAdapter } from "../../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";

type McpServerRow = {
  key: string;
  summary: string;
  config: Record<string, unknown>;
};

type McpDraft = {
  originalKey: string | null;
  key: string;
  enabled: boolean;
  type: "stdio" | "http";
  url: string;
  command: string;
  argsJson: string;
  envJson: string;
  headersJson: string;
  extraJson: string;
};

function rowsFromServers(servers: Record<string, unknown>): McpServerRow[] {
  return Object.entries(servers).map(([key, value]) => ({
    key,
    summary:
      value && typeof value === "object" && !Array.isArray(value)
        ? mcpServerSummary(value as Record<string, unknown>)
        : "—",
    config:
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
  }));
}

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

function isMcpServerEnabled(cfg: Record<string, unknown>): boolean {
  return cfg.enabled !== false && cfg.disabled !== true;
}

function prettyJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2);
}

function emptyDraft(): McpDraft {
  return {
    originalKey: null,
    key: "",
    enabled: true,
    type: "stdio",
    url: "",
    command: "",
    argsJson: "[]",
    envJson: "{}",
    headersJson: "{}",
    extraJson: "{}",
  };
}

function draftFromRow(row: McpServerRow): McpDraft {
  const cfg = row.config;
  const type = cfg.type === "http" || typeof cfg.url === "string" ? "http" : "stdio";
  const { type: _type, enabled, disabled, url, command, args, env, headers, ...extra } = cfg;
  void _type;
  void enabled;
  void disabled;
  return {
    originalKey: row.key,
    key: row.key,
    enabled: isMcpServerEnabled(cfg),
    type,
    url: typeof url === "string" ? url : "",
    command: typeof command === "string" ? command : "",
    argsJson: prettyJson(Array.isArray(args) ? args : [], []),
    envJson: prettyJson(env && typeof env === "object" && !Array.isArray(env) ? env : {}, {}),
    headersJson: prettyJson(
      headers && typeof headers === "object" && !Array.isArray(headers) ? headers : {},
      {},
    ),
    extraJson: prettyJson(extra, {}),
  };
}

function parseJsonField(text: string, fallback: unknown, label: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`${label} 不是有效 JSON`);
  }
}

function extractMcpProbeText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    return (
      trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .find(Boolean) ?? trimmed
    );
  }
  return trimmed;
}

async function probeHttpMcpServer(config: Record<string, unknown>): Promise<void> {
  const url = typeof config.url === "string" ? config.url.trim() : "";
  if (!url) {
    throw new Error("HTTP MCP 缺少 URL");
  }
  const headers =
    config.headers && typeof config.headers === "object" && !Array.isArray(config.headers)
      ? (config.headers as Record<string, unknown>)
      : {};
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => {
          const [key, value] = entry;
          return key.trim().length > 0 && typeof value === "string";
        }),
      ),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "OpenClaw Power UI", version: "dev" },
      },
    }),
  });
  const text = extractMcpProbeText(await response.text().catch(() => ""));
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!text || (!text.includes("jsonrpc") && !text.includes("protocolVersion"))) {
    throw new Error("接口可访问，但响应不像 MCP initialize 结果");
  }
}

function isGatewayRestartCloseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("service restart") ||
    normalized.includes("gateway closed (1012)") ||
    normalized.includes("gateway not connected")
  );
}

function buildServerConfig(draft: McpDraft): Record<string, unknown> {
  const extra = parseJsonField(draft.extraJson, {}, "高级字段");
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) {
    throw new Error("高级字段必须是 JSON 对象");
  }

  const next: Record<string, unknown> = { ...(extra as Record<string, unknown>), type: draft.type };
  if (draft.enabled) {
    delete next.enabled;
    delete next.disabled;
  } else {
    next.enabled = false;
    delete next.disabled;
  }
  if (draft.type === "http") {
    if (!draft.url.trim()) {
      throw new Error("请填写 URL");
    }
    next.url = draft.url.trim();
    const headers = parseJsonField(draft.headersJson, {}, "Headers");
    if (
      headers &&
      typeof headers === "object" &&
      !Array.isArray(headers) &&
      Object.keys(headers).length > 0
    ) {
      next.headers = headers;
    } else {
      delete next.headers;
    }
    delete next.command;
    delete next.args;
    delete next.env;
  } else {
    if (!draft.command.trim()) {
      throw new Error("请填写 Command");
    }
    next.command = draft.command.trim();
    const args = parseJsonField(draft.argsJson, [], "Args");
    if (!Array.isArray(args)) {
      throw new Error("Args 必须是 JSON 数组");
    }
    if (args.length > 0) {
      next.args = args;
    } else {
      delete next.args;
    }
    const env = parseJsonField(draft.envJson, {}, "Env");
    if (env && typeof env === "object" && !Array.isArray(env) && Object.keys(env).length > 0) {
      next.env = env;
    } else {
      delete next.env;
    }
    delete next.url;
    delete next.headers;
  }
  return next;
}

export function SettingsMcpPage() {
  const location = useLocation();
  const { message } = App.useApp();
  const { settings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const canUseGateway = Boolean(settings.gatewayUrl.trim());

  const [mcpRows, setMcpRows] = useState<McpServerRow[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [draft, setDraft] = useState<McpDraft>(() => emptyDraft());

  const loadMcp = useCallback(async (): Promise<boolean> => {
    if (!adapter || !canUseGateway) {
      setMcpRows([]);
      return false;
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
        mcp &&
        "servers" in mcp &&
        mcp.servers &&
        typeof mcp.servers === "object" &&
        !Array.isArray(mcp.servers)
          ? (mcp.servers as Record<string, Record<string, unknown>>)
          : null;
      setMcpRows(servers ? rowsFromServers(servers) : []);
      return true;
    } catch (e) {
      if (isGatewayRestartCloseError(e)) {
        setMcpError(null);
        return false;
      }
      setMcpError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setMcpLoading(false);
    }
  }, [adapter, canUseGateway]);

  const persistMcp = useCallback(
    async (mutate: (servers: Record<string, unknown>) => void) => {
      if (!adapter) {
        return;
      }
      setMcpSaving(true);
      setMcpError(null);
      let optimisticServers: Record<string, unknown> | null = null;
      try {
        const snap = await adapter.request<{
          hash?: string | null;
          config?: Record<string, unknown> | null;
        }>("config.get", {});
        const baseHash = snap.hash?.trim();
        if (!baseHash) {
          throw new Error("无法保存：配置缺少 baseHash，请刷新后重试。");
        }
        const next = cloneConfigObject(snap.config ?? {});
        const mcp =
          typeof next.mcp === "object" && next.mcp !== null
            ? (next.mcp as Record<string, unknown>)
            : {};
        const servers =
          typeof mcp.servers === "object" && mcp.servers !== null && !Array.isArray(mcp.servers)
            ? { ...(mcp.servers as Record<string, unknown>) }
            : {};
        mutate(servers);
        optimisticServers = servers;
        mcp.servers = servers;
        next.mcp = mcp;
        await adapter.request("config.set", {
          raw: serializeConfigForm(next),
          baseHash,
        });
        const refreshed = await loadMcp();
        if (!refreshed) {
          setMcpRows(rowsFromServers(servers));
          window.setTimeout(() => {
            void loadMcp();
          }, 1200);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isGatewayRestartCloseError(e)) {
          setMcpError(null);
          if (optimisticServers) {
            setMcpRows(rowsFromServers(optimisticServers));
          }
          window.setTimeout(() => {
            void loadMcp();
          }, 1200);
          return;
        }
        setMcpError(msg);
        throw e;
      } finally {
        setMcpSaving(false);
      }
    },
    [adapter, loadMcp],
  );

  useEffect(() => {
    if (canUseGateway) {
      void loadMcp();
    }
  }, [canUseGateway, loadMcp, location.pathname, location.key]);

  const openNew = () => {
    setDraft(emptyDraft());
    setMcpError(null);
    setEditorVisible(true);
  };

  const openEdit = (row: McpServerRow) => {
    setDraft(draftFromRow(row));
    setMcpError(null);
    setEditorVisible(true);
  };

  const saveDraft = async () => {
    const key = draft.key.trim();
    if (!key) {
      setMcpError("请填写服务器名");
      return;
    }
    try {
      const server = buildServerConfig(draft);
      await persistMcp((servers) => {
        if (draft.originalKey && draft.originalKey !== key) {
          delete servers[draft.originalKey];
        }
        servers[key] = server;
      });
      setEditorVisible(false);
      setDraft(emptyDraft());
      message.success("MCP 配置已保存");
    } catch (e) {
      if (isGatewayRestartCloseError(e)) {
        message.success("MCP 配置已保存，等待网关重连后刷新");
        window.setTimeout(() => {
          void loadMcp();
        }, 1200);
      } else {
        message.error(e instanceof Error ? e.message : "保存失败");
      }
    }
  };

  const testDraft = async () => {
    setMcpTesting(true);
    setMcpError(null);
    try {
      const server = buildServerConfig(draft);
      if (server.type !== "http") {
        message.info("stdio MCP 需要保存后由运行时启动验证。");
        return;
      }
      await probeHttpMcpServer(server);
      message.success("MCP 接口可用");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMcpError(msg);
      message.error(`MCP 测试失败：${msg}`);
    } finally {
      setMcpTesting(false);
    }
  };

  const deleteRow = async (row: McpServerRow) => {
    if (!window.confirm(`确定删除 MCP 服务器「${row.key}」？`)) {
      return;
    }
    try {
      await persistMcp((servers) => {
        delete servers[row.key];
      });
      message.success("MCP 服务器已删除");
    } catch (e) {
      if (isGatewayRestartCloseError(e)) {
        message.success("MCP 服务器已删除，等待网关重连后刷新");
        window.setTimeout(() => {
          void loadMcp();
        }, 1200);
      } else {
        message.error("删除失败");
      }
    }
  };

  const setRowEnabled = useCallback(
    async (row: McpServerRow, enabled: boolean) => {
      try {
        await persistMcp((servers) => {
          const current =
            row.config && typeof row.config === "object" && !Array.isArray(row.config)
              ? { ...row.config }
              : {};
          if (enabled) {
            delete current.enabled;
            delete current.disabled;
          } else {
            current.enabled = false;
            delete current.disabled;
          }
          servers[row.key] = current;
        });
        message.success(enabled ? "MCP 服务器已启用" : "MCP 服务器已停用");
      } catch (e) {
        if (isGatewayRestartCloseError(e)) {
          message.success(
            enabled
              ? "MCP 服务器已启用，等待网关重连后刷新"
              : "MCP 服务器已停用，等待网关重连后刷新",
          );
          window.setTimeout(() => {
            void loadMcp();
          }, 1200);
        } else {
          message.error("更新 MCP 服务器状态失败");
        }
      }
    },
    [message, persistMcp],
  );

  const allMcpEnabled =
    mcpRows.length > 0 && mcpRows.every((row) => isMcpServerEnabled(row.config));

  const setAllEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await persistMcp((servers) => {
          for (const [key, value] of Object.entries(servers)) {
            const current =
              value && typeof value === "object" && !Array.isArray(value)
                ? { ...(value as Record<string, unknown>) }
                : {};
            if (enabled) {
              delete current.enabled;
              delete current.disabled;
            } else {
              current.enabled = false;
              delete current.disabled;
            }
            servers[key] = current;
          }
        });
        message.success(enabled ? "全部 MCP 服务器已启用" : "全部 MCP 服务器已停用");
      } catch (e) {
        if (isGatewayRestartCloseError(e)) {
          message.success(
            enabled
              ? "全部 MCP 服务器已启用，等待网关重连后刷新"
              : "全部 MCP 服务器已停用，等待网关重连后刷新",
          );
          window.setTimeout(() => {
            void loadMcp();
          }, 1200);
        } else {
          message.error("更新 MCP 总开关失败");
        }
      }
    },
    [message, persistMcp],
  );

  const mcpColumns: ColumnsType<McpServerRow> = useMemo(
    () => [
      { title: "服务器名", dataIndex: "key", key: "key", ellipsis: true },
      {
        title: "状态",
        key: "enabled",
        width: 120,
        render: (_, row) => {
          const enabled = isMcpServerEnabled(row.config);
          return (
            <Space size={6}>
              <Switch
                size="small"
                checked={enabled}
                disabled={mcpSaving}
                onChange={(checked) => void setRowEnabled(row, checked)}
              />
              <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag>
            </Space>
          );
        },
      },
      { title: "概要", dataIndex: "summary", key: "summary", ellipsis: true },
      {
        title: "操作",
        key: "actions",
        width: 150,
        render: (_, row) => (
          <Space size={4}>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>
              编辑
            </Button>
            <Button
              danger
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => void deleteRow(row)}
            >
              删除
            </Button>
          </Space>
        ),
      },
    ],
    [mcpSaving, setRowEnabled],
  );

  return (
    <div className="space-y-4">
      <PageHeader compact title="MCP" description="管理可被对话使用的 MCP 服务器。" />
      {!canUseGateway ? (
        <Alert
          type="warning"
          showIcon
          message="请先填写并保存 Gateway 地址"
          className="rounded-xl text-sm"
        />
      ) : null}
      <Card className="rounded-xl border-slate-200/90 shadow-sm" styles={{ body: { padding: 0 } }}>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">MCP 服务器</span>
            <span className="block text-xs text-slate-500">
              启用表示允许 agent 在对话中使用；实际调用由模型根据对话内容自动完成。
            </span>
          </div>
          <Space size="small" wrap className="shrink-0">
            <span className="inline-flex h-7 items-center gap-2 rounded-lg border border-slate-200/80 bg-white px-2.5 text-xs font-medium text-slate-600">
              <span>全部可用于对话</span>
              <Switch
                size="small"
                checked={allMcpEnabled}
                disabled={!canUseGateway || mcpRows.length === 0 || mcpSaving}
                onChange={(checked) => void setAllEnabled(checked)}
              />
            </span>
            <Button
              size="small"
              icon={<CloudServerOutlined />}
              disabled={!canUseGateway}
              loading={mcpLoading}
              onClick={() => void loadMcp()}
            >
              刷新
            </Button>
            <Button
              size="small"
              icon={<PlusOutlined />}
              disabled={!canUseGateway}
              onClick={openNew}
            >
              新增服务器
            </Button>
          </Space>
        </div>
        <div className="space-y-3 p-4">
          {mcpError ? <Alert type="error" showIcon message={mcpError} className="text-sm" /> : null}
          <Spin spinning={mcpLoading}>
            {mcpRows.length === 0 && !mcpLoading && canUseGateway ? (
              <p className="mb-0 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-4 text-center text-sm text-slate-500">
                暂无 MCP 服务器，可点击「新增服务器」添加。
              </p>
            ) : (
              <Table<McpServerRow>
                size="small"
                rowKey={(r) => r.key}
                columns={mcpColumns}
                dataSource={mcpRows}
                pagination={false}
              />
            )}
          </Spin>

          {editorVisible ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50/45 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-900">
                  {draft.originalKey ? "编辑 MCP 服务器" : "新增 MCP 服务器"}
                </span>
                <Space size="small">
                  <Button
                    size="small"
                    onClick={() => {
                      setEditorVisible(false);
                      setDraft(emptyDraft());
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    size="small"
                    icon={<CloudServerOutlined />}
                    loading={mcpTesting}
                    disabled={mcpSaving}
                    onClick={() => void testDraft()}
                  >
                    测试连接
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={mcpSaving}
                    onClick={() => void saveDraft()}
                  >
                    保存
                  </Button>
                </Space>
              </div>
              <Form layout="vertical" size="small">
                <div className="grid gap-x-4 md:grid-cols-2">
                  <Form.Item label="服务器名" required className="!mb-2">
                    <Input
                      value={draft.key}
                      onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value }))}
                    />
                  </Form.Item>
                  <Form.Item label="类型" className="!mb-2">
                    <Select
                      value={draft.type}
                      onChange={(v) => setDraft((d) => ({ ...d, type: v }))}
                      options={[
                        { value: "stdio", label: "stdio / command" },
                        { value: "http", label: "http / url" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="启用" className="!mb-2">
                    <Switch
                      checked={draft.enabled}
                      checkedChildren="启用"
                      unCheckedChildren="停用"
                      onChange={(checked) => setDraft((d) => ({ ...d, enabled: checked }))}
                    />
                  </Form.Item>
                </div>
                {draft.type === "http" ? (
                  <>
                    <Form.Item label="URL" required className="!mb-2">
                      <Input
                        value={draft.url}
                        onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="Headers JSON" className="!mb-2">
                      <Input.TextArea
                        rows={3}
                        value={draft.headersJson}
                        onChange={(e) => setDraft((d) => ({ ...d, headersJson: e.target.value }))}
                      />
                    </Form.Item>
                  </>
                ) : (
                  <>
                    <Form.Item label="Command" required className="!mb-2">
                      <Input
                        value={draft.command}
                        onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
                        placeholder="npx"
                      />
                    </Form.Item>
                    <div className="grid gap-x-4 md:grid-cols-2">
                      <Form.Item label="Args JSON" className="!mb-2">
                        <Input.TextArea
                          rows={3}
                          value={draft.argsJson}
                          onChange={(e) => setDraft((d) => ({ ...d, argsJson: e.target.value }))}
                          placeholder={'["-y", "@modelcontextprotocol/server-filesystem"]'}
                        />
                      </Form.Item>
                      <Form.Item label="Env JSON" className="!mb-2">
                        <Input.TextArea
                          rows={3}
                          value={draft.envJson}
                          onChange={(e) => setDraft((d) => ({ ...d, envJson: e.target.value }))}
                        />
                      </Form.Item>
                    </div>
                  </>
                )}
                <Form.Item label="高级字段 JSON" className="!mb-0">
                  <Input.TextArea
                    rows={4}
                    value={draft.extraJson}
                    onChange={(e) => setDraft((d) => ({ ...d, extraJson: e.target.value }))}
                  />
                </Form.Item>
              </Form>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
