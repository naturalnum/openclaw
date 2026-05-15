import { UnorderedListOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ModelCatalogEntry } from "../../../compat/types";
import { PageHeader } from "../../components/ui/PageHeader";
import { useGatewayWorkbenchAdapter } from "../../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";
import { SettingsModelsPanel } from "./SettingsModelsPanel";

const { Text } = Typography;

function formatModelInputs(entry: ModelCatalogEntry): string {
  const parts = entry.input ?? [];
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function SettingsModelsPage() {
  const { settings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const canUseGateway = Boolean(settings.gatewayUrl.trim());

  const [catalogModels, setCatalogModels] = useState<ModelCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadCatalogModels = useCallback(async () => {
    if (!adapter || !canUseGateway) {
      setCatalogModels([]);
      return;
    }
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await adapter.request<{ models?: ModelCatalogEntry[] }>("models.list", {});
      setCatalogModels(Array.isArray(res.models) ? res.models : []);
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : String(e));
      setCatalogModels([]);
    } finally {
      setCatalogLoading(false);
    }
  }, [adapter, canUseGateway]);

  useEffect(() => {
    void loadCatalogModels();
  }, [loadCatalogModels]);

  const modelColumns: ColumnsType<ModelCatalogEntry> = useMemo(
    () => [
      { title: "提供商", dataIndex: "provider", key: "provider", width: 120, ellipsis: true },
      { title: "模型 ID", dataIndex: "id", key: "id", ellipsis: true },
      { title: "名称", dataIndex: "name", key: "name", ellipsis: true },
      {
        title: "上下文",
        dataIndex: "contextWindow",
        key: "contextWindow",
        width: 100,
        render: (v: number | undefined) => (typeof v === "number" && v > 0 ? `${(v / 1000).toFixed(0)}k` : "—"),
      },
      {
        title: "输入",
        key: "input",
        width: 140,
        render: (_, row) => <Text type="secondary">{formatModelInputs(row)}</Text>,
      },
      {
        title: "推理",
        key: "reasoning",
        width: 72,
        render: (_, row) => (row.reasoning ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
      },
    ],
    [],
  );

  const gatewayHint = !canUseGateway ? (
    <Alert type="warning" showIcon message="请先填写并保存 Gateway 地址" className="rounded-xl" />
  ) : null;

  return (
    <div className="space-y-5">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeader
          compact
          title="模型"
          description="维护 models.providers 与默认主模型；下方折叠为网关 models.list 只读对照。密钥占位时留空保存可保留原值。"
        />
        {gatewayHint}
        <SettingsModelsPanel adapter={adapter} canUseGateway={canUseGateway} />
      </div>
      <Collapse
        bordered={false}
        size="small"
        className="mt-1 rounded-lg border border-slate-200/80 bg-slate-50/30 [&_.ant-collapse-header]:py-2 [&_.ant-collapse-header]:text-sm [&_.ant-collapse-header]:font-medium"
        items={[
          {
            key: "catalog",
            label: (
              <span className="flex items-center gap-2 text-sm">
                <UnorderedListOutlined />
                网关模型目录（只读）
              </span>
            ),
            children: (
              <div className="space-y-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="small" disabled={!canUseGateway} loading={catalogLoading} onClick={() => void loadCatalogModels()}>
                    刷新目录
                  </Button>
                  <Text type="secondary" className="text-xs">
                    来自 models.list，与上方提供商合并后决定可用模型。
                  </Text>
                </div>
                {catalogError ? <Alert type="error" showIcon message={catalogError} className="text-sm" /> : null}
                <Spin spinning={catalogLoading}>
                  <Table<ModelCatalogEntry>
                    size="small"
                    rowKey={(r) => `${r.provider}:${r.id}`}
                    columns={modelColumns}
                    dataSource={catalogModels}
                    pagination={{ pageSize: 8, size: "small", showSizeChanger: true }}
                    scroll={{ x: 760 }}
                  />
                </Spin>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
