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
  REDACTED_SENTINEL,
  resolvePrimaryModelFromConfig,
  type WorkbenchModelConfig,
} from "../../lib/global-model-config";

const { Text } = Typography;

type Props = {
  adapter: GatewayWorkbenchAdapter | null;
  canUseGateway: boolean;
  onSaved?: () => void;
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

function validateModelConfig(config: WorkbenchModelConfig): string | null {
  if (!config.provider.trim()) {
    return "请填写模型服务商";
  }
  if (!config.model.trim()) {
    return "请填写模型 ID";
  }
  if (!config.baseUrl.trim()) {
    return "请填写 API Base URL";
  }
  return null;
}

async function testTextModelConfig(
  adapter: GatewayWorkbenchAdapter,
  config: WorkbenchModelConfig,
): Promise<string> {
  const model = config.model.trim();
  if (!model) {
    throw new Error("请填写模型 ID");
  }
  const result = await adapter.request<{ content?: string }>("power.models.testText", {
    provider: config.provider.trim(),
    model,
  });
  return result.content?.trim() || "ok";
}

export function SettingsModelsPanel({ adapter, canUseGateway, onSaved }: Props) {
  const { message } = App.useApp();
  const [modelConfigs, setModelConfigs] = useState([createEmptyModelConfig()]);
  const [currentModelId, setCurrentModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);

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
    setModelConfigs((rows) =>
      rows.length === 1 && !rows[0]?.provider.trim() && !rows[0]?.model.trim()
        ? [row]
        : [...rows, row],
    );
    setEditingModelId(row.id);
  };

  const removeRow = (id: string) => {
    const removed = modelConfigs.find((r) => r.id === id);
    const filtered = modelConfigs.filter((r) => r.id !== id);
    const next = filtered.length > 0 ? filtered : [createEmptyModelConfig()];
    const removedWasDefault =
      removed && currentModelId === formatModelRef(removed.provider, removed.model);
    const nextCurrentModelId = removedWasDefault
      ? (() => {
          const fb = next.find((r) => r.enabled && r.provider.trim() && r.model.trim());
          return fb ? formatModelRef(fb.provider, fb.model) : "";
        })()
      : currentModelId;
    setModelConfigs(next);
    if (removedWasDefault) {
      setCurrentModelId(nextCurrentModelId);
    }
    setEditingModelId((cur) => (cur === id ? null : cur));
    void save({
      modelConfigs: next,
      currentModelId: nextCurrentModelId,
      successMessage: "模型配置已删除",
    });
  };

  const save = async (overrides?: {
    modelConfigs?: WorkbenchModelConfig[];
    currentModelId?: string;
    closeEditor?: boolean;
    successMessage?: string;
  }) => {
    if (!adapter) {
      return;
    }
    const nextModelConfigs = overrides?.modelConfigs ?? modelConfigs;
    const nextCurrentModelId = overrides?.currentModelId ?? currentModelId;
    setSaving(true);
    setError(null);
    try {
      await persistGlobalModelConfig({
        adapter,
        modelConfigs: nextModelConfigs,
        currentModelId: nextCurrentModelId,
      });
      message.success(overrides?.successMessage ?? "模型配置已保存到网关");
      if (overrides?.modelConfigs) {
        setModelConfigs(overrides.modelConfigs);
      }
      if (overrides?.currentModelId !== undefined) {
        setCurrentModelId(overrides.currentModelId);
      }
      if (overrides?.closeEditor) {
        setEditingModelId(null);
      }
      await load();
      onSaved?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveDefaultModel = (ref: string) => {
    setCurrentModelId(ref);
    void save({ currentModelId: ref, successMessage: "默认模型已保存" });
  };

  const toggleModelEnabled = (id: string, enabled: boolean) => {
    const target = modelConfigs.find((row) => row.id === id);
    if (enabled && target) {
      const validationError = validateModelConfig(target);
      if (validationError) {
        setError(validationError);
        message.error(validationError);
        setEditingModelId(id);
        return;
      }
    }
    const next = modelConfigs.map((row) => (row.id === id ? { ...row, enabled } : row));
    const currentStillEnabled = next.some(
      (row) => row.enabled && formatModelRef(row.provider, row.model) === currentModelId,
    );
    const fallback = next.find((row) => row.enabled && row.provider.trim() && row.model.trim());
    const nextCurrentModelId = currentStillEnabled
      ? currentModelId
      : fallback
        ? formatModelRef(fallback.provider, fallback.model)
        : "";
    setModelConfigs(next);
    setCurrentModelId(nextCurrentModelId);
    void save({
      modelConfigs: next,
      currentModelId: nextCurrentModelId,
      successMessage: enabled ? "模型配置已启用" : "模型配置已停用",
    });
  };

  const saveEditingModel = () => {
    if (!editingModel) {
      return;
    }
    const validationError = validateModelConfig(editingModel);
    if (validationError) {
      setError(validationError);
      message.error(validationError);
      return;
    }
    const nextModelConfigs = modelConfigs.map((row) =>
      row.id === editingModel.id ? { ...row, enabled: true } : row,
    );
    const ref = formatModelRef(editingModel.provider, editingModel.model);
    const nextCurrentModelId = currentModelId.trim() || ref;
    void save({
      modelConfigs: nextModelConfigs,
      currentModelId: nextCurrentModelId,
      closeEditor: true,
      successMessage: "模型配置已保存",
    });
  };

  const testEditingModel = async () => {
    if (!editingModel) {
      return;
    }
    setTesting(true);
    setError(null);
    try {
      if (!adapter) {
        throw new Error("网关尚未连接");
      }
      const content = await testTextModelConfig(adapter, editingModel);
      message.success(`文本测试通过：${content}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      message.error(`文本测试失败：${msg}`);
    } finally {
      setTesting(false);
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
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,24rem)] md:items-center">
          <div className="min-w-0 space-y-1">
            <Text className="text-sm font-semibold text-slate-900">默认主模型</Text>
            <Text type="secondary" className="block truncate text-xs">
              选择后立即保存，并同步到聊天窗口模型列表。
            </Text>
          </div>
          <Select
            className="[&_.ant-select-selector]:!rounded-xl"
            classNames={{ popup: { root: "power-model-select-dropdown" } }}
            placeholder="选择默认模型"
            value={currentModelId || undefined}
            onChange={(v) => saveDefaultModel(v ?? "")}
            options={configuredRefs.map((ref) => ({
              label: modelSelectLabel(ref, modelConfigs, labelPool),
              value: ref,
            }))}
            loading={saving}
            allowClear
          />
        </div>
      </Card>

      <Spin spinning={loading}>
        <Space direction="vertical" size="small" className="w-full">
          {modelConfigs.map((row) => {
            const providerLabel = row.provider.trim() || "未配置模型服务商";
            const modelLabel = row.model.trim() || "未配置模型";
            return (
              <Card
                key={row.id}
                size="small"
                className={`${cardSurface} overflow-hidden rounded-xl`}
                styles={{ body: { padding: "12px 14px" } }}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{providerLabel}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          row.enabled
                            ? "bg-slate-100 text-slate-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.enabled ? "启用" : "停用"}
                      </span>
                    </div>
                    <Text type="secondary" className="mt-0.5 block truncate text-xs">
                      {row.provider && row.model
                        ? formatModelRef(row.provider, row.model)
                        : modelLabel}
                    </Text>
                  </div>
                  <Space size={8}>
                    <Switch
                      size="small"
                      checked={row.enabled}
                      loading={saving}
                      onChange={(checked) => toggleModelEnabled(row.id, checked)}
                      className="mr-1"
                    />
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
            );
          })}
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
            <Space size={6}>
              <Button size="small" loading={testing} disabled={saving} onClick={testEditingModel}>
                测试文本对话
              </Button>
              <Button type="link" size="small" onClick={() => setEditingModelId(null)}>
                关闭
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<SaveOutlined />}
                loading={saving}
                onClick={saveEditingModel}
              >
                保存
              </Button>
            </Space>
          }
          styles={{ body: { padding: "14px 16px" } }}
        >
          <Form layout="vertical" size="small">
            <div className="grid gap-x-3 gap-y-1 md:grid-cols-2">
              <Form.Item label="模型服务商" required className="!mb-3">
                <Input
                  value={editingModel.provider}
                  onChange={(e) => updateRow(editingModel.id, { provider: e.target.value })}
                  placeholder="deepseek、openai、minimax"
                />
              </Form.Item>
              <Form.Item label="模型 ID" required className="!mb-3">
                <Input
                  value={editingModel.model}
                  onChange={(e) => updateRow(editingModel.id, { model: e.target.value })}
                  placeholder="gpt-4o、claude-sonnet-4-5 等"
                />
              </Form.Item>
              <Form.Item label="API Base URL" required className="!mb-3 md:col-span-2">
                <Input
                  value={editingModel.baseUrl}
                  onChange={(e) => updateRow(editingModel.id, { baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </Form.Item>
              <Form.Item
                label="输入能力"
                extra="仅在模型及其 API 确实支持图片输入时启用。"
                className="!mb-3 md:col-span-2"
              >
                <Space size={10}>
                  <Switch checked disabled size="small" />
                  <Text>文本</Text>
                  <Switch
                    size="small"
                    checked={editingModel.input?.includes("image") ?? false}
                    onChange={(checked) =>
                      updateRow(editingModel.id, {
                        input: checked ? ["text", "image"] : ["text"],
                      })
                    }
                  />
                  <Text>图片</Text>
                </Space>
              </Form.Item>
              <Form.Item
                label="API Key（留空保留原值）"
                extra={
                  editingModel.apiKey.trim() === REDACTED_SENTINEL
                    ? "出于安全原因，已保存的 Key 不会显示。留空保存会继续使用原 Key；需要测试时请重新输入一次。"
                    : null
                }
                className="!mb-3 md:col-span-2"
              >
                <Input.Password
                  value={
                    editingModel.apiKey.trim() === REDACTED_SENTINEL ? "" : editingModel.apiKey
                  }
                  onChange={(e) => updateRow(editingModel.id, { apiKey: e.target.value })}
                  placeholder={
                    editingModel.apiKey.trim() === REDACTED_SENTINEL
                      ? "已保存 Key 不会显示，留空保留原值"
                      : "留空表示不修改已保存的密钥"
                  }
                />
              </Form.Item>
            </div>
          </Form>
        </Card>
      ) : null}
    </div>
  );
}
