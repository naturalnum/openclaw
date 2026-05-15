import { PlusOutlined, SaveOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, InputNumber, Radio, Select, Space, Spin, Switch, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type {
  ConnectorCatalogListResult,
  ConnectorFieldDefinition,
  ConnectorInstance,
  ConnectorProviderDefinition,
} from "../../../compat/types";

const { Text, Paragraph } = Typography;

type DraftState = {
  providerId: string | null;
  displayName: string;
  description: string;
  enabled: boolean;
  policyMode: "read-only" | "limited-write" | "full";
  config: Record<string, string>;
  secretInputs: Record<string, string>;
};

function stringifyDraftValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function emptyDraft(providerId: string | null): DraftState {
  return {
    providerId,
    displayName: "",
    description: "",
    enabled: true,
    policyMode: "read-only",
    config: {},
    secretInputs: {},
  };
}

function draftFromInstance(instance: ConnectorInstance): DraftState {
  return {
    providerId: instance.providerId,
    displayName: instance.displayName,
    description: instance.description,
    enabled: instance.enabled,
    policyMode: instance.policy.mode,
    config: Object.fromEntries(
      Object.entries(instance.config ?? {}).map(([key, value]) => [key, stringifyDraftValue(value)]),
    ),
    secretInputs: Object.fromEntries(
      Object.entries(instance.secretInputs ?? {}).map(([key, value]) => [key, stringifyDraftValue(value)]),
    ),
  };
}

type Props = {
  adapter: GatewayWorkbenchAdapter | null;
  canUseGateway: boolean;
};

export function SettingsConnectorsPanel({ adapter, canUseGateway }: Props) {
  const { message } = App.useApp();
  const [providers, setProviders] = useState<ConnectorProviderDefinition[]>([]);
  const [instances, setInstances] = useState<ConnectorInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [onlyDatabase, setOnlyDatabase] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(() => emptyDraft(null));

  const filteredProviders = useMemo(() => {
    if (!onlyDatabase) {
      return providers;
    }
    return providers.filter((p) => p.category === "database");
  }, [onlyDatabase, providers]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const load = useCallback(
    async (opts?: { resetForm?: boolean }) => {
      if (!adapter || !canUseGateway) {
        return;
      }
      setLoading(true);
      setError(null);
      setTestHint(null);
      try {
        const [cat, inst] = await Promise.all([
          adapter.request<ConnectorCatalogListResult>("connectors.catalog.list", {}),
          adapter.request<{ instances?: ConnectorInstance[] }>("connectors.instances.list", {}),
        ]);
        const plist = Array.isArray(cat.providers) ? cat.providers : [];
        const ilist = Array.isArray(inst.instances) ? inst.instances : [];
        setProviders(plist);
        setInstances(ilist);
        const preferred = onlyDatabase ? plist.filter((p) => p.category === "database") : plist;
        setSelectedProviderId((prev) => {
          if (prev && preferred.some((p) => p.id === prev)) {
            return prev;
          }
          return preferred[0]?.id ?? plist[0]?.id ?? null;
        });
        if (opts?.resetForm) {
          setEditingInstanceId(null);
          const pid = preferred[0]?.id ?? plist[0]?.id ?? null;
          setDraft(emptyDraft(pid));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [adapter, canUseGateway, onlyDatabase],
  );

  useEffect(() => {
    void load({ resetForm: true });
  }, [load]);

  const selectProvider = (pid: string) => {
    setSelectedProviderId(pid);
    setEditingInstanceId(null);
    setDraft(emptyDraft(pid));
    setTestHint(null);
  };

  useEffect(() => {
    if (editingInstanceId !== null) {
      return;
    }
    if (!selectedProviderId) {
      return;
    }
    setDraft((d) => (d.providerId === selectedProviderId ? d : emptyDraft(selectedProviderId)));
  }, [selectedProviderId, editingInstanceId, providers.length]);

  const selectInstance = (id: string | null) => {
    if (!id) {
      setEditingInstanceId(null);
      setDraft(emptyDraft(selectedProviderId));
      setTestHint(null);
      return;
    }
    const row = instances.find((i) => i.id === id);
    if (!row) {
      return;
    }
    setEditingInstanceId(id);
    setSelectedProviderId(row.providerId);
    setDraft(draftFromInstance(row));
    setTestHint(null);
  };

  const setMeta = (key: keyof Pick<DraftState, "displayName" | "description" | "enabled">, value: string | boolean) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const setConfigField = (key: string, value: string) => {
    setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } }));
  };

  const setSecretField = (key: string, value: string) => {
    setDraft((d) => ({ ...d, secretInputs: { ...d.secretInputs, [key]: value } }));
  };

  const renderField = (field: ConnectorFieldDefinition, section: "config" | "secret") => {
    const value = section === "config" ? (draft.config[field.key] ?? "") : (draft.secretInputs[field.key] ?? "");
    const onChange = section === "config" ? (v: string) => setConfigField(field.key, v) : (v: string) => setSecretField(field.key, v);
    const common = {
      placeholder: field.placeholder,
    };
    if (field.kind === "textarea") {
      return (
        <Input.TextArea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...common}
        />
      );
    }
    if (field.kind === "number") {
      return (
        <InputNumber
          className="w-full"
          value={value ? Number(value) : undefined}
          onChange={(n) => onChange(n != null && Number.isFinite(Number(n)) ? String(n) : "")}
        />
      );
    }
    if (field.kind === "boolean") {
      return <Switch size="small" checked={value === "true"} onChange={(v) => onChange(v ? "true" : "false")} />;
    }
    if (section === "secret") {
      return (
        <Input.Password value={value} onChange={(e) => onChange(e.target.value)} {...common} />
      );
    }
    return <Input value={value} onChange={(e) => onChange(e.target.value)} {...common} />;
  };

  const save = async () => {
    if (!adapter) {
      return;
    }
    const providerId = draft.providerId ?? selectedProviderId;
    if (!providerId) {
      setError("请选择连接器类型（提供商）");
      return;
    }
    if (!draft.displayName.trim()) {
      setError("请填写显示名称");
      return;
    }
    setSaving(true);
    setError(null);
    setTestHint(null);
    const payload = {
      providerId,
      displayName: draft.displayName.trim(),
      description: draft.description.trim(),
      enabled: draft.enabled,
      config: draft.config,
      secretInputs: draft.secretInputs,
      policy: {
        mode: draft.policyMode,
        allowedActions: [] as string[],
        deniedActions: [] as string[],
        requireApprovalActions: [] as string[],
      },
    };
    try {
      if (editingInstanceId) {
        await adapter.request("connectors.instances.update", { id: editingInstanceId, ...payload });
        message.success("连接器已更新");
      } else {
        await adapter.request("connectors.instances.create", payload);
        message.success("连接器已创建");
      }
      setEditingInstanceId(null);
      setDraft(emptyDraft(providerId));
      await load({ resetForm: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!adapter || !editingInstanceId) {
      setTestHint("请先保存连接器，再使用连接测试（与旧版工作台一致）。");
      return;
    }
    setTesting(true);
    setTestHint(null);
    setError(null);
    try {
      const result = await adapter.request<{ ok?: boolean; message?: string }>("connectors.instances.test", {
        id: editingInstanceId,
      });
      setTestHint(result.message?.trim() || "连接测试已完成。");
      await load({ resetForm: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const columns: ColumnsType<ConnectorInstance> = useMemo(
    () => [
      { title: "显示名", dataIndex: "displayName", key: "displayName", ellipsis: true },
      { title: "提供商", dataIndex: "providerId", key: "providerId", width: 140 },
      { title: "启用", dataIndex: "enabled", key: "enabled", width: 72, render: (v: boolean) => (v ? "是" : "否") },
      { title: "状态", dataIndex: "status", key: "status", width: 96 },
    ],
    [],
  );

  if (!canUseGateway) {
    return <Alert type="warning" showIcon message="请先填写并保存 Gateway 地址" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <Text className="text-sm font-medium text-slate-900">连接器（含数据库）</Text>
        <Paragraph className="!mb-0 mt-1 max-w-3xl text-xs leading-snug text-slate-600">
          通过网关 <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">connectors.instances.*</code>{" "}
          创建/更新。默认仅数据库类提供商；可切换全部。需具备权限的 token。
        </Paragraph>
      </div>

      {error ? <Alert type="error" showIcon message={error} className="text-sm" /> : null}
      {testHint ? <Alert type="info" showIcon message={testHint} className="text-sm" /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="small" onClick={() => void load({ resetForm: true })} loading={loading}>
          刷新列表
        </Button>
        <Radio.Group
          value={onlyDatabase}
          onChange={(e) => setOnlyDatabase(e.target.value)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value={true}>仅数据库</Radio.Button>
          <Radio.Button value={false}>全部类型</Radio.Button>
        </Radio.Group>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Card
          size="small"
          className="border-slate-200/90 shadow-sm"
          styles={{ body: { padding: "12px 14px" } }}
          title={<span className="text-sm">提供商类型</span>}
        >
          <Spin spinning={loading}>
            <div className="max-h-[min(52vh,360px)] space-y-1 overflow-y-auto pr-1">
              {filteredProviders.length === 0 ? (
                <Text type="secondary" className="text-xs">
                  无可用提供商
                </Text>
              ) : (
                filteredProviders.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProvider(p.id)}
                    className={`flex w-full flex-col rounded-lg border px-2.5 py-2 text-left text-sm transition ${
                      selectedProviderId === p.id
                        ? "border-[#0d6b52] bg-[#0d6b52]/8 ring-1 ring-[#0d6b52]/25"
                        : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-medium leading-tight text-slate-900">{p.displayName}</span>
                    <span className="mt-0.5 font-mono text-[11px] text-slate-500">{p.id}</span>
                    <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{p.category}</span>
                  </button>
                ))
              )}
            </div>
          </Spin>
        </Card>

        <div className="space-y-3">
          <Card size="small" className="border-slate-200/90 shadow-sm" styles={{ body: { padding: "12px 14px" } }} title={<span className="text-sm">已有实例</span>}>
            <Table<ConnectorInstance>
              size="small"
              rowKey={(r) => r.id}
              columns={columns}
              dataSource={instances}
              pagination={{ pageSize: 8, size: "small" }}
              onRow={(record) => ({
                onClick: () => selectInstance(record.id),
                className: editingInstanceId === record.id ? "bg-[#0d6b52]/5" : "cursor-pointer",
              })}
            />
            <Button type="link" size="small" className="mt-1 px-0" icon={<PlusOutlined />} onClick={() => selectInstance(null)}>
              新建（当前提供商）
            </Button>
          </Card>

          <Card
            size="small"
            className="border-slate-200/90 shadow-sm"
            styles={{ body: { padding: "14px 16px" } }}
            title={
              <span className="text-sm font-semibold">
                {editingInstanceId ? "编辑连接" : "新建连接"}
                {selectedProvider ? (
                  <Text type="secondary" className="ml-1.5 text-xs font-normal">
                    · {selectedProvider.displayName}
                  </Text>
                ) : null}
              </span>
            }
            extra={
              <Space size="small">
                <Button size="small" icon={<ThunderboltOutlined />} loading={testing} onClick={() => void testConnection()}>
                  测试
                </Button>
                <Button type="primary" size="small" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
                  {editingInstanceId ? "保存" : "创建"}
                </Button>
              </Space>
            }
          >
            {!selectedProvider ? (
              <Text type="secondary" className="text-sm">
                请选择左侧提供商
              </Text>
            ) : (
              <Form layout="vertical" size="small" className="max-w-3xl">
                <Form.Item label="显示名称" required className="!mb-2">
                  <Input value={draft.displayName} onChange={(e) => setMeta("displayName", e.target.value)} />
                </Form.Item>
                <Form.Item label="描述" className="!mb-2">
                  <Input.TextArea
                    rows={2}
                    value={draft.description}
                    onChange={(e) => setMeta("description", e.target.value)}
                    placeholder="可选"
                  />
                </Form.Item>
                <Form.Item label="启用" className="!mb-2">
                  <Switch size="small" checked={draft.enabled} onChange={(v) => setMeta("enabled", v)} />
                </Form.Item>
                <Form.Item label="策略模式" className="!mb-2">
                  <Select
                    className="max-w-md"
                    value={draft.policyMode}
                    onChange={(v) => setDraft((d) => ({ ...d, policyMode: v }))}
                    options={[
                      { value: "read-only", label: "只读 read-only" },
                      { value: "limited-write", label: "受限写 limited-write" },
                      { value: "full", label: "完全 full" },
                    ]}
                  />
                </Form.Item>

                {selectedProvider.configFields.length > 0 ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <Text className="mb-2 block text-xs font-semibold text-slate-700">连接参数</Text>
                    {selectedProvider.configFields.map((field) => (
                      <Form.Item
                        key={`c-${field.key}`}
                        className="!mb-2"
                        label={
                          <span className="text-xs">
                            {field.label}
                            {field.required ? <span className="text-red-500"> *</span> : null}
                          </span>
                        }
                        extra={field.description ? <Text type="secondary" className="text-[11px]">{field.description}</Text> : undefined}
                      >
                        {renderField(field, "config")}
                      </Form.Item>
                    ))}
                  </div>
                ) : null}

                {selectedProvider.secretFields.length > 0 ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <Text className="mb-2 block text-xs font-semibold text-slate-700">密钥字段</Text>
                    {selectedProvider.secretFields.map((field) => (
                      <Form.Item
                        key={`s-${field.key}`}
                        className="!mb-2"
                        label={
                          <span className="text-xs">
                            {field.label}
                            {field.required ? <span className="text-red-500"> *</span> : null}
                          </span>
                        }
                        extra={field.description ? <Text type="secondary" className="text-[11px]">{field.description}</Text> : undefined}
                      >
                        {renderField(field, "secret")}
                      </Form.Item>
                    ))}
                  </div>
                ) : null}
              </Form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
