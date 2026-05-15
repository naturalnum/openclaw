import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Select, Space, Spin, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

import type { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import type { ConfigSnapshot } from "../../../compat/types";
import { modelOptionLabel } from "../../lib/configured-chat-models";
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

export function SettingsModelsPanel({ adapter, canUseGateway }: Props) {
  const { message } = App.useApp();
  const [modelConfigs, setModelConfigs] = useState<WorkbenchModelConfig[]>([createEmptyModelConfig()]);
  const [currentModelId, setCurrentModelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!adapter || !canUseGateway) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const snap = await adapter.request<ConfigSnapshot>("config.get", {});
      const cfg = snap.config && typeof snap.config === "object" && !Array.isArray(snap.config) ? snap.config : {};
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

  const cardSurface =
    "border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]";

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap justify-end gap-2 border-b border-slate-100 pb-3">
        <Button onClick={() => void load()} disabled={loading}>
          重新加载
        </Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
          保存到网关
        </Button>
      </div>

      {error ? <Alert type="error" showIcon message={error} className="text-sm" /> : null}

      <Alert
        type="info"
        showIcon
        className="text-sm"
        message="模型配置分三层"
        description={
          <ul className="m-0 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-600">
            <li>
              <strong>下方条目</strong>：写入{" "}
              <code className="rounded bg-slate-100 px-1">models.providers</code>
              ，决定 API、密钥与可选模型 ID（对话顶栏下拉列表来源）。
            </li>
            <li>
              <strong>默认主模型</strong>：写入{" "}
              <code className="rounded bg-slate-100 px-1">agents.defaults.model.primary</code>
              ，新会话或未单独绑定时的默认值。
            </li>
            <li>
              <strong>对话顶栏切换</strong>：对已选会话调用{" "}
              <code className="rounded bg-slate-100 px-1">sessions.patch</code>
              ，绑定到该会话后<strong>运行时以此为准</strong>（优先于本地偏好显示）。
            </li>
          </ul>
        }
      />

      <Card
        size="small"
        className={`${cardSurface} overflow-hidden rounded-xl`}
        styles={{ body: { padding: "16px 20px" } }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="min-w-0 shrink lg:max-w-md">
            <Text className="text-sm font-semibold text-slate-900">默认主模型</Text>
            <Text type="secondary" className="mt-0.5 block text-xs leading-snug">
              仅已启用且含模型 ID 的条目；写回{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">agents.defaults.model.primary</code>
            </Text>
          </div>
          <div className="w-full min-w-0 flex-1 lg:max-w-xl">
            <Select
              className="w-full"
              size="large"
              placeholder="选择 provider/model"
              value={currentModelId || undefined}
              onChange={(v) => setCurrentModelId(v)}
              options={configuredRefs.map((ref) => ({
                label: modelOptionLabel(ref, modelConfigs, labelPool),
                value: ref,
              }))}
              allowClear
            />
          </div>
        </div>
      </Card>

      <Spin spinning={loading}>
        <Space direction="vertical" size="middle" className="w-full">
          {modelConfigs.map((row, index) => (
            <Card
              key={row.id}
              size="small"
              className={`${cardSurface} overflow-hidden rounded-xl border-l-[3px] border-l-[#0d6b52]/45`}
              styles={{ body: { padding: "16px 20px" } }}
              title={
                <span className="text-sm font-semibold text-slate-900">
                  条目 {index + 1}
                  {row.provider && row.model ? (
                    <Text type="secondary" className="ml-1.5 text-xs font-normal">
                      ({formatModelRef(row.provider, row.model)})
                    </Text>
                  ) : null}
                </span>
              }
              extra={
                <Space size={4}>
                  <span className="text-xs text-slate-600">启用</span>
                  <Switch checked={row.enabled} onChange={(v) => updateRow(row.id, { enabled: v })} />
                  <Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeRow(row.id)}>
                    删除
                  </Button>
                </Space>
              }
            >
              <Form layout="vertical" className="w-full">
                <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                  <Form.Item label="提供商 ID" className="!mb-3">
                    <Input
                      size="large"
                      value={row.provider}
                      onChange={(e) => updateRow(row.id, { provider: e.target.value })}
                      placeholder="openai"
                    />
                  </Form.Item>
                  <Form.Item label="显示名称" className="!mb-3">
                    <Input
                      size="large"
                      value={row.name}
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                      placeholder="可选"
                    />
                  </Form.Item>
                  <Form.Item label="API Base URL" className="!mb-3 md:col-span-2">
                    <Input
                      size="large"
                      value={row.baseUrl}
                      onChange={(e) => updateRow(row.id, { baseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </Form.Item>
                  <Form.Item label="API Key（留空保留原值）" className="!mb-3 md:col-span-2">
                    <Input.Password
                      size="large"
                      value={row.apiKey}
                      onChange={(e) => updateRow(row.id, { apiKey: e.target.value })}
                      placeholder="留空表示不修改已保存的密钥"
                    />
                  </Form.Item>
                  <Form.Item label="模型 ID" className="!mb-0 md:col-span-2">
                    <Input
                      size="large"
                      value={row.model}
                      onChange={(e) => updateRow(row.id, { model: e.target.value })}
                      placeholder="gpt-4o、claude-sonnet-4-5 等"
                    />
                  </Form.Item>
                </div>
              </Form>
            </Card>
          ))}
        </Space>
      </Spin>

      <Button type="dashed" block icon={<PlusOutlined />} onClick={addRow}>
        添加模型配置
      </Button>
    </div>
  );
}
