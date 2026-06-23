import { LogoutOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Space, Tag } from "antd";
import { PageHeader } from "../../components/ui/PageHeader";
import { useLocalUsers } from "../../context/LocalUsersContext";

export function SettingsAccountPage() {
  const localUsers = useLocalUsers();
  const user = localUsers.user;

  if (!localUsers.enabled || !user) {
    return (
      <div className="space-y-4">
        <PageHeader compact title="账号" description="当前账号与退出登录。" />
        <Alert
          type="info"
          showIcon
          message="当前未启用本地用户登录"
          description="连接旧版网关时，不需要本地账号即可继续使用。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        compact
        title="账号"
        description="查看当前登录账号，或退出后切换其他用户。"
        actions={
          <Button size="small" icon={<LogoutOutlined />} onClick={localUsers.logout}>
            退出登录
          </Button>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <Descriptions
          size="small"
          column={1}
          labelStyle={{ width: 88, color: "#64748b" }}
          contentStyle={{ color: "#0f172a" }}
          items={[
            {
              key: "displayName",
              label: "显示名称",
              children: user.displayName || user.id,
            },
            {
              key: "id",
              label: "用户 ID",
              children: user.id,
            },
            {
              key: "role",
              label: "角色",
              children: (
                <Tag color={user.role === "admin" ? "geekblue" : "default"}>
                  {user.role === "admin" ? "管理员" : "普通用户"}
                </Tag>
              ),
            },
            {
              key: "status",
              label: "状态",
              children: (
                <Space size="small">
                  <Tag color={user.status === "active" ? "green" : "red"}>
                    {user.status === "active" ? "启用" : "禁用"}
                  </Tag>
                  {user.lastLoginAt ? (
                    <span className="text-xs text-slate-500">
                      最近登录：{new Date(user.lastLoginAt).toLocaleString()}
                    </span>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
