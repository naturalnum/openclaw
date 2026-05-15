import { ApiOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Form, Input, Space } from "antd";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { GatewayWorkbenchAdapter } from "../../../adapters/gateway-workbench-adapter";
import { PageHeader } from "../../components/ui/PageHeader";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";
import { ROUTES } from "../../router/paths";

type SettingsFormValues = {
  gatewayUrl: string;
  token: string;
};

export function SettingsConnectionPage() {
  const { message } = App.useApp();
  const { settings, patchSettings } = usePowerUiSettings();
  const [form] = Form.useForm<SettingsFormValues>();
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    form.setFieldsValue({
      gatewayUrl: settings.gatewayUrl,
      token: settings.token,
    });
  }, [form, settings.gatewayUrl, settings.token]);

  const handleTestConnection = async () => {
    const values = form.getFieldsValue();
    const gatewayUrl = values.gatewayUrl?.trim() ?? "";
    const token = values.token?.trim() ?? "";
    if (!gatewayUrl) {
      form.setFields([{ name: "gatewayUrl", errors: ["请填写服务地址"] }]);
      return;
    }
    setTesting(true);
    setTestError(null);
    const testAdapter = new GatewayWorkbenchAdapter({
      getSettings: () => ({
        gatewayUrl,
        token,
      }),
    });
    try {
      const agents = await testAdapter.request<{ agents?: unknown[] }>("agents.list", {});
      const count = Array.isArray(agents.agents) ? agents.agents.length : 0;
      message.success(`连接成功${count > 0 ? ` · 已发现 ${count} 个助手` : ""}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setTestError(reason);
      message.error("连接失败");
    } finally {
      testAdapter.dispose();
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        compact
        title="连接与令牌"
        description="WebSocket 地址与可选令牌；保存后各页立即生效。"
      />
      <Card
        className="max-w-2xl rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
        styles={{ body: { padding: "16px 18px" } }}
      >
        <Space direction="vertical" size="middle" className="w-full">
          <Form<SettingsFormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            size="small"
            onFinish={(values) => {
              patchSettings({
                gatewayUrl: values.gatewayUrl.trim(),
                token: values.token.trim(),
              });
              message.success("已保存");
            }}
          >
            <Form.Item
              label={<span className="text-sm font-medium text-slate-800">Gateway URL</span>}
              name="gatewayUrl"
              rules={[{ required: true, message: "请填写服务地址" }]}
            >
              <Input placeholder="例如：ws://127.0.0.1:19001" autoComplete="url" />
            </Form.Item>
            <Form.Item label={<span className="text-sm font-medium text-slate-800">访问令牌（可选）</span>} name="token">
              <Input.Password placeholder="没有可留空" autoComplete="off" />
            </Form.Item>
            <Form.Item className="!mb-0">
              <Space size="small" wrap>
                <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
                  保存
                </Button>
                <Button icon={<ApiOutlined />} loading={testing} onClick={() => void handleTestConnection()}>
                  测试连接
                </Button>
              </Space>
            </Form.Item>
          </Form>
          {testError ? (
            <Alert
              type="error"
              showIcon
              message="连接测试失败"
              description={testError}
              closable
              onClose={() => setTestError(null)}
            />
          ) : null}
          <Link to={ROUTES.root} className="text-sm text-[#0d6b52] hover:underline">
            ← 返回对话
          </Link>
        </Space>
      </Card>
    </div>
  );
}
