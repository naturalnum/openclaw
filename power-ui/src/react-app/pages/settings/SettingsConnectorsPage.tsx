import { Alert } from "antd";
import { PageHeader } from "../../components/ui/PageHeader";
import { useSharedGatewayWorkbenchAdapter } from "../../context/GatewayWorkbenchAdapterContext";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";
import { SettingsConnectorsPanel } from "./SettingsConnectorsPanel";

export function SettingsConnectorsPage() {
  const { settings } = usePowerUiSettings();
  const adapter = useSharedGatewayWorkbenchAdapter();
  const canUseGateway = Boolean(settings.gatewayUrl.trim());

  return (
    <div className="space-y-4">
      <PageHeader
        compact
        title="连接器"
        description="管理数据库等连接实例；保存/测试需具备权限的令牌。"
      />
      {!canUseGateway ? (
        <Alert type="warning" showIcon message="请先填写并保存 Gateway 地址" />
      ) : (
        <SettingsConnectorsPanel adapter={adapter} canUseGateway={canUseGateway} />
      )}
    </div>
  );
}
