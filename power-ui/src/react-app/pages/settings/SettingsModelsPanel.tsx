import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
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
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type { ConfigSnapshot } from "../../../compat/types";
import type { ModelCatalogEntry } from "../../../compat/types";
import {
  createEmptyModelConfig,
  formatModelRef,
  listConfiguredModelRefs,
  persistGlobalModelConfig,
  readGlobalModelConfigs,
  resolvePrimaryModelFromConfig,
  type WorkbenchModelConfig,
} from "../../lib/global-model-config";

const { Text } = Typography;

type Props = {
  adapter: GatewayWorkbenchAdapter | null;
  canUseGateway: boolean;
};

function modelSelectLabel(
  ref: string,
  modelConfigs: WorkbenchModelConfig[],
  labelPool: ModelCatalogEntry[],
) {
  const row = modelConfigs.find((item) => formatModelRef(item.provider, item.model) === ref);
  const label =
    row?.name.trim() ||
    labelPool.find((item) => formatModelRef(item.provider, item.id) === ref)?.name ||
    ref;
  return (
    <span className="flex min-w-0 items-center">
      <span className="truncate text-sm font-medium text-slate-900">{label}</span>
    </span>
  );
}

export function SettingsModelsPanel({ adapter, canUseGateway }: Props) {
  const { message } = App.useApp();
  const [modelConfigs, setModelConfigs] = useState([createEmptyModelConfig()]);
  const [currentModelId, setCurrentModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [defaultEditorOpen, setDefaultEditorOpen] = useState(false);

  const load = useCallback(async () => {
    if (!adapter || !canUseGateway) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await adapter.request<ConfigSnapshot>("config.get", {});
      const cfg =
        snap.config && typeof snap.config === "object" && !Array.isArray(snap.config)
          ? snap.config
          : {};
      setModelConfigs(readGlobalModelConfigs(cfg));
      setCurrentModelId(resolvePrimaryModelFromConfig(cfg));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [adapter, canUseGateway]);

  useEffect(() => {
    void load();
  }, [load]);

  const configuredRefs = listConfiguredModelRefs(modelConfigs);
  const editingModel = useMemo(
    () => modelConfigs.find((row) => row.id === editingModelId) ?? null,
    [editingModelId, modelConfigs],
  );

  const labelPool: ModelCatalogEntry[] = modelConfigs
    .filter((r) => r.enabled && r.provider.trim() && r.model.trim())
    .map((r) => ({
      id: r.model.trim(),
      name: r.name.trim() || r.model.trim(),
      provider: r.provider.trim(),
    }));

  const updateRow = (id: string, patch: Partial<WorkbenchModelConfig>) => {
    setModelConfigs((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const row = createEmptyModelConfig();
    setModelConfigs((rows) => [...rows, row]);
    setEditingModelId(row.id);
  };

  const removeRow = (id: string) => {
    setModelConfigs((rows) => {
      const next = rows.filter((r) => r.id !== id);
      if (next.length === 0) {
        return [createEmptyModelConfig()];
      }
      const removed = rows.find((r) => r.id === id);
      if (removed && currentModelId === formatModelRef(removed.provider, removed.model)) {
        const fb = next.find((r) => r.enabled && r.provider.trim() && r.model.trim());
        setCurrentModelId(fb ? formatModelRef(fb.provider, fb.model) : "");
      }
      return next;
    });
    setEditingModelId((cur) => (cur === id ? null : cur));
  };

  const save = async () => {
    if (!adapter) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await persistGlobalModelConfig({
        adapter,
        modelConfigs,
        currentModelId,
      });
      message.success("模型配置已保存到网关");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!canUseGateway) {
    return null;
  }

  const cardSurface = "border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]";

  return (
    <div className="w-full space-y-4">
      {error ? <Alert type="error" showIcon message={error} className="text-sm" /> : null}

      <Card
        size="small"
        className={`${cardSurface} overflow-hidden rounded-xl`}
        styles={{ body: { padding: "16px 20px" } }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <Text className="text-sm font-semibold text-slate-900">默认主模型</Text>
            <Text type="secondary" className="block truncate text-xs">
              {currentModelId
                ? modelSelectLabel(currentModelId, modelConfigs, labelPool)
                : "未选择默认模型"}
            </Text>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={() => setDefaultEditorOpen((v) => !v)}>
              {defaultEditorOpen ? "收起" : "设置默认模型"}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
        </div>
        {defaultEditorOpen ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <Form layout="vertical" size="small">
              <Form.Item label="默认主模型" className="!mb-0">
                <Select
                  className="[&_.ant-select-selector]:!rounded-xl"
                  size="large"
                  popupClassName="power-model-select-dropdown"
                  placeholder="选择默认模型"
                  value={currentModelId || undefined}
                  onChange={(v) => setCurrentModelId(v)}
                  options={configuredRefs.map((ref) => ({
                    label: modelSelectLabel(ref, modelConfigs, labelPool),
                    value: ref,
                  }))}
                  allowClear
                />
              </Form.Item>
            </Form>
          </div>
        ) : null}
      </Card>

      <Spin spinning={loading}>
        <Space direction="vertical" size="small" className="w-full">
          {modelConfigs.map((row, index) => (
            <Card
              key={row.id}
              size="small"
              className={`${cardSurface} overflow-hidden rounded-xl`}
              styles={{ body: { padding: "12px 14px" } }}
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">条目 {index + 1}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        row.enabled ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {row.enabled ? "启用" : "停用"}
                    </span>
                  </div>
                  <Text type="secondary" className="mt-0.5 block truncate text-xs">
                    {row.provider && row.model
                      ? formatModelRef(row.provider, row.model)
                      : "未配置 provider/model"}
                  </Text>
                </div>
                <Space size={4}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setEditingModelId(row.id)}
                  >
                    编辑
                  </Button>
                  <Button
                    danger
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => removeRow(row.id)}
                  >
                    删除
                  </Button>
                </Space>
              </div>
            </Card>
          ))}
        </Space>
      </Spin>

      <Button type="dashed" block icon={<PlusOutlined />} onClick={addRow}>
        添加模型配置
      </Button>

      {editingModel ? (
        <Card
          size="small"
          className={`${cardSurface} overflow-hidden rounded-xl`}
          title={<span className="text-sm">编辑模型配置</span>}
          extra={
            <Button type="link" size="small" onClick={() => setEditingModelId(null)}>
              关闭
            </Button>
          }
          styles={{ body: { padding: "14px 16px" } }}
        >
          <Form layout="vertical" size="small">
            <div className="grid gap-x-3 gap-y-1 md:grid-cols-2">
              <Form.Item label="提供商 ID" className="!mb-3">
                <Input
                  value={editingModel.provider}
                  onChange={(e) => updateRow(editingModel.id, { provider: e.target.value })}
                  placeholder="openai"
                />
              </Form.Item>
              <Form.Item label="显示名称" className="!mb-3">
                <Input
                  value={editingModel.name}
                  onChange={(e) => updateRow(editingModel.id, { name: e.target.value })}
                  placeholder="可选"
                />
              </Form.Item>
              <Form.Item label="API Base URL" className="!mb-3 md:col-span-2">
                <Input
                  value={editingModel.baseUrl}
                  onChange={(e) => updateRow(editingModel.id, { baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </Form.Item>
              <Form.Item label="API Key（留空保留原值）" className="!mb-3 md:col-span-2">
                <Input.Password
                  value={editingModel.apiKey}
                  onChange={(e) => updateRow(editingModel.id, { apiKey: e.target.value })}
                  placeholder="留空表示不修改已保存的密钥"
                />
              </Form.Item>
              <Form.Item label="模型 ID" className="!mb-3 md:col-span-2">
                <Input
                  value={editingModel.model}
                  onChange={(e) => updateRow(editingModel.id, { model: e.target.value })}
                  placeholder="gpt-4o、claude-sonnet-4-5 等"
                />
              </Form.Item>
              <Form.Item label="启用" className="!mb-0">
                <Switch
                  checked={editingModel.enabled}
                  onChange={(v) => updateRow(editingModel.id, { enabled: v })}
                />
              </Form.Item>
            </div>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}
