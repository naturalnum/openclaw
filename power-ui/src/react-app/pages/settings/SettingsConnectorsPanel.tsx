import { EditOutlined, PlusOutlined, SaveOutlined, ThunderboltOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type {
  ConnectorCatalogListResult,
  ConnectorFieldDefinition,
  ConnectorInstance,
  ConnectorProviderDefinition,
} from "../../../compat/types";

const { Text } = Typography;

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

function connectorFieldClass(field: ConnectorFieldDefinition, total: number): string {
  if (total === 1 || field.kind === "textarea" || field.kind === "boolean") {
    return "md:col-span-2";
  }
  return "";
}

function draftFromInstance(instance: ConnectorInstance): DraftState {
  return {
    providerId: instance.providerId,
    displayName: instance.displayName,
    description: instance.description,
    enabled: instance.enabled,
    policyMode: instance.policy.mode,
    config: Object.fromEntries(
      Object.entries(instance.config ?? {}).map(([key, value]) => [
        key,
        stringifyDraftValue(value),
      ]),
    ),
    secretInputs: Object.fromEntries(
      Object.entries(instance.secretInputs ?? {}).map(([key, value]) => [
        key,
        stringifyDraftValue(value),
      ]),
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
  const [editorOpen, setEditorOpen] = useState(false);

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
      setEditorOpen(true);
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
    setEditorOpen(true);
  };

  const setMeta = (
    key: keyof Pick<DraftState, "displayName" | "description" | "enabled">,
    value: string | boolean,
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const setConfigField = (key: string, value: string) => {
    setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } }));
  };

  const setSecretField = (key: string, value: string) => {
    setDraft((d) => ({ ...d, secretInputs: { ...d.secretInputs, [key]: value } }));
  };

  const renderField = (field: ConnectorFieldDefinition, section: "config" | "secret") => {
    const value =
      section === "config"
        ? (draft.config[field.key] ?? "")
        : (draft.secretInputs[field.key] ?? "");
    const onChange =
      section === "config"
        ? (v: string) => setConfigField(field.key, v)
        : (v: string) => setSecretField(field.key, v);
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
          onChange={(n) => onChange(n != null && Number.isFinite(n) ? String(n) : "")}
        />
      );
    }
    if (field.kind === "boolean") {
      return (
        <Switch
          size="small"
          checked={value === "true"}
          onChange={(v) => onChange(v ? "true" : "false")}
        />
      );
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
      setEditorOpen(false);
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
      const result = await adapter.request<{ ok?: boolean; message?: string }>(
        "connectors.instances.test",
        {
          id: editingInstanceId,
        },
      );
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
      { title: "提供商", dataIndex: "providerId", key: "providerId", width: 118, ellipsis: true },
      {
        title: "启用",
        dataIndex: "enabled",
        key: "enabled",
        width: 58,
        render: (v: boolean) => (v ? "是" : "否"),
      },
      { title: "状态", dataIndex: "status", key: "status", width: 72, ellipsis: true },
      {
        title: "操作",
        key: "action",
        width: 72,
        render: (_, record) => (
          <Button size="small" icon={<EditOutlined />} onClick={() => selectInstance(record.id)}>
            编辑
          </Button>
        ),
      },
    ],
    [instances],
  );

  if (!canUseGateway) {
    return <Alert type="warning" showIcon message="请先填写并保存 Gateway 地址" />;
  }

  return (
    <div className="space-y-4">
      {error ? <Alert type="error" showIcon message={error} className="text-sm" /> : null}
      {testHint ? <Alert type="info" showIcon message={testHint} className="text-sm" /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setOnlyDatabase(true)}
            className={`h-7 w-20 rounded-md text-xs font-medium transition ${
              onlyDatabase
                ? "bg-[#30343a] text-white shadow-sm shadow-slate-300/35"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            仅数据库
          </button>
          <button
            type="button"
            onClick={() => setOnlyDatabase(false)}
            className={`h-7 w-20 rounded-md text-xs font-medium transition ${
              !onlyDatabase
                ? "bg-[#30343a] text-white shadow-sm shadow-slate-300/35"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            全部类型
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card
          size="small"
          className="min-w-0 border-slate-200/90 shadow-sm"
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
                        ? "border-[#d8d6d2] bg-[#fff] shadow-sm ring-1 ring-[#e7e5e4]"
                        : "border-[#e7e5e4] bg-[#fff]/70 hover:border-[#d8d6d2] hover:bg-[#fff]"
                    }`}
                  >
                    <span className="font-medium leading-tight text-slate-900">
                      {p.displayName}
                    </span>
                    <span className="mt-0.5 font-mono text-[11px] text-slate-500">{p.id}</span>
                    <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      {p.category}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Spin>
        </Card>

        <div className="min-w-0 space-y-3">
          <Card
            size="small"
            className="min-w-0 overflow-hidden border-slate-200/90 shadow-sm"
            styles={{ body: { padding: "12px 14px" } }}
            title={<span className="text-sm">已有实例</span>}
            extra={
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => selectInstance(null)}
              >
                新建
              </Button>
            }
          >
            <Table<ConnectorInstance>
              size="small"
              rowKey={(r) => r.id}
              columns={columns}
              dataSource={instances}
              tableLayout="fixed"
              pagination={{ pageSize: 8, size: "small" }}
              onRow={(record) => ({
                onClick: () => selectInstance(record.id),
                className: editingInstanceId === record.id ? "bg-slate-50" : "cursor-pointer",
              })}
            />
          </Card>
        </div>
      </div>

      {editorOpen ? (
        <Card
          size="small"
          className="border-slate-200/90 shadow-sm"
          title={
            <span className="text-sm">
              {editingInstanceId ? "编辑连接" : "新建连接"}
              {selectedProvider ? (
                <Text type="secondary" className="ml-1.5 text-xs font-normal">
                  · {selectedProvider.displayName}
                </Text>
              ) : null}
            </span>
          }
          extra={
            <Space size={4}>
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={testing}
                onClick={() => void testConnection()}
              >
                测试
              </Button>
              <Button size="small" onClick={() => setEditorOpen(false)}>
                关闭
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={() => void save()}
              >
                {editingInstanceId ? "保存" : "创建"}
              </Button>
            </Space>
          }
          styles={{ body: { padding: "14px 16px" } }}
        >
          {!selectedProvider ? (
            <Text type="secondary" className="text-sm">
              请选择提供商
            </Text>
          ) : (
            <Form layout="vertical" size="small">
              <div className="grid gap-x-3 md:grid-cols-2">
                <Form.Item label="显示名称" required className="!mb-2">
                  <Input
                    value={draft.displayName}
                    onChange={(e) => setMeta("displayName", e.target.value)}
                  />
                </Form.Item>
                <Form.Item label="描述" className="!mb-2">
                  <Input
                    value={draft.description}
                    onChange={(e) => setMeta("description", e.target.value)}
                    placeholder="可选"
                  />
                </Form.Item>
                <Form.Item label="启用" className="!mb-2">
                  <Switch
                    size="small"
                    checked={draft.enabled}
                    onChange={(v) => setMeta("enabled", v)}
                  />
                </Form.Item>
                <Form.Item label="策略模式" className="!mb-2">
                  <Select
                    value={draft.policyMode}
                    onChange={(v) => setDraft((d) => ({ ...d, policyMode: v }))}
                    options={[
                      { value: "read-only", label: "只读 read-only" },
                      { value: "limited-write", label: "受限写 limited-write" },
                      { value: "full", label: "完全 full" },
                    ]}
                  />
                </Form.Item>
              </div>

              {selectedProvider.configFields.length > 0 ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Text className="mb-2 block text-xs font-semibold text-slate-700">连接参数</Text>
                  <div className="grid gap-x-3 md:grid-cols-2">
                    {selectedProvider.configFields.map((field) => (
                      <Form.Item
                        key={`c-${field.key}`}
                        className={`!mb-2 ${connectorFieldClass(field, selectedProvider.configFields.length)}`}
                        label={
                          <span className="text-xs">
                            {field.label}
                            {field.required ? <span className="text-red-500"> *</span> : null}
                          </span>
                        }
                        extra={
                          field.description ? (
                            <Text type="secondary" className="text-[11px]">
                              {field.description}
                            </Text>
                          ) : undefined
                        }
                      >
                        {renderField(field, "config")}
                      </Form.Item>
                    ))}
                  </div>
                </div>
              ) : null}

              {selectedProvider.secretFields.length > 0 ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Text className="mb-2 block text-xs font-semibold text-slate-700">密钥字段</Text>
                  <div className="grid gap-x-3 md:grid-cols-2">
                    {selectedProvider.secretFields.map((field) => (
                      <Form.Item
                        key={`s-${field.key}`}
                        className={`!mb-2 ${connectorFieldClass(field, selectedProvider.secretFields.length)}`}
                        label={
                          <span className="text-xs">
                            {field.label}
                            {field.required ? <span className="text-red-500"> *</span> : null}
                          </span>
                        }
                        extra={
                          field.description ? (
                            <Text type="secondary" className="text-[11px]">
                              {field.description}
                            </Text>
                          ) : undefined
                        }
                      >
                        {renderField(field, "secret")}
                      </Form.Item>
                    ))}
                  </div>
                </div>
              ) : null}
            </Form>
          )}
        </Card>
      ) : null}
    </div>
  );
}
