import { Alert } from "antd";
import { PageHeader } from "../../components/ui/PageHeader";
import { useGatewayWorkbenchAdapter } from "../../hooks/useGatewayWorkbenchAdapter";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";
import { SettingsModelsPanel } from "./SettingsModelsPanel";

export function SettingsModelsPage() {
  const { settings } = usePowerUiSettings();
  const adapter = useGatewayWorkbenchAdapter(settings);
  const canUseGateway = Boolean(settings.gatewayUrl.trim());

  const gatewayHint = !canUseGateway ? (
    <Alert type="warning" showIcon message="请先填写并保存 Gateway 地址" className="rounded-xl" />
  ) : null;

  return (
    <div className="space-y-5">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <PageHeader
          compact
          title="模型"
          description="维护可选模型与默认主模型。密钥占位时留空保存可保留原值。"
        />
        {gatewayHint}
        <SettingsModelsPanel adapter={adapter} canUseGateway={canUseGateway} />
      </div>
    </div>
  );
}
