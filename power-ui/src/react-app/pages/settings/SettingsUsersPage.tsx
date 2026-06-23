import { LogoutOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, App, Button, Form, Input, Select, Space, Switch, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { useLocalUsers } from "../../context/LocalUsersContext";
import { usePowerUiSettings } from "../../hooks/usePowerUiSettings";
import {
  localUsersRequest,
  type LocalUserProfile,
  type LocalUserRole,
  type LocalUserStatus,
  type LocalUsersListResult,
} from "../../lib/local-users-client";

type UserDraft = {
  id: string;
  displayName: string;
  password: string;
  role: LocalUserRole;
};

function formatDate(value?: string): string {
  if (!value) {
    return "从未";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function SettingsUsersPage() {
  const { message } = App.useApp();
  const { settings } = usePowerUiSettings();
  const localUsers = useLocalUsers();
  const [users, setUsers] = useState<LocalUserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>({
    id: "",
    displayName: "",
    password: "",
    role: "user",
  });
  const canManage = localUsers.enabled && localUsers.user?.role === "admin";
  const requestSettings = useMemo(
    () => ({ gatewayUrl: settings.gatewayUrl, token: settings.token }),
    [settings.gatewayUrl, settings.token],
  );

  const loadUsers = useCallback(async () => {
    if (!canManage || !localUsers.sessionToken) {
      return;
    }
    setLoading(true);
    try {
      const result = await localUsersRequest<LocalUsersListResult>(
        requestSettings,
        "/local-users",
        { sessionToken: localUsers.sessionToken },
      );
      setUsers(result.users);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用户失败");
    } finally {
      setLoading(false);
    }
  }, [canManage, localUsers.sessionToken, message, requestSettings]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const createUser = async () => {
    if (!draft.id.trim() || !draft.password.trim()) {
      message.warning("请填写用户 ID 和初始密码");
      return;
    }
    setSavingId("__new__");
    try {
      await localUsersRequest(requestSettings, "/local-users", {
        method: "POST",
        sessionToken: localUsers.sessionToken,
        body: {
          id: draft.id.trim(),
          password: draft.password,
          role: draft.role,
          ...(draft.displayName.trim() ? { displayName: draft.displayName.trim() } : {}),
        },
      });
      message.success("用户已添加");
      setDraft({ id: "", displayName: "", password: "", role: "user" });
      await loadUsers();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "添加用户失败");
    } finally {
      setSavingId(null);
    }
  };

  const patchUser = async (
    user: LocalUserProfile,
    patch: {
      displayName?: string;
      password?: string;
      role?: LocalUserRole;
      status?: LocalUserStatus;
    },
  ) => {
    setSavingId(user.id);
    try {
      await localUsersRequest(requestSettings, `/local-users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        sessionToken: localUsers.sessionToken,
        body: patch,
      });
      await loadUsers();
      message.success("用户已更新");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新用户失败");
    } finally {
      setSavingId(null);
    }
  };

  const resetPassword = async (user: LocalUserProfile) => {
    const next = window.prompt(`请输入 ${user.id} 的新密码`);
    if (!next) {
      return;
    }
    await patchUser(user, { password: next });
  };

  if (!localUsers.enabled) {
    return (
      <div className="space-y-4">
        <PageHeader compact title="用户" description="管理本盒子的本地用户。" />
        <Alert
          type="info"
          showIcon
          message="暂时无法连接本地用户接口"
          description={
            <span>
              当前连接：{settings.gatewayUrl || "未配置"}。
              {localUsers.statusError
                ? ` 错误：${localUsers.statusError}`
                : "如果你正在连接旧版网关，用户管理会自动隐藏，不影响现有对话功能。"}
            </span>
          }
        />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-4">
        <PageHeader compact title="用户" description="管理本盒子的本地用户。" />
        <Alert
          type="warning"
          showIcon
          message="需要管理员权限"
          description="当前账号不是管理员，无法查看或维护用户列表。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        compact
        title="用户"
        description="管理员可添加、禁用本盒子的本地用户。"
        actions={
          <Space size="small">
            <span className="text-xs text-slate-500">当前：{localUsers.user?.displayName}</span>
            <Button size="small" icon={<LogoutOutlined />} onClick={localUsers.logout}>
              退出登录
            </Button>
          </Space>
        }
      />

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">新增用户</span>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            loading={savingId === "__new__"}
            onClick={() => void createUser()}
          >
            添加
          </Button>
        </div>
        <Form
          layout="vertical"
          requiredMark={false}
          className="grid gap-3 px-3 py-3 sm:grid-cols-2"
        >
          <Form.Item label="用户 ID" className="!mb-0">
            <Input
              value={draft.id}
              placeholder="例如 alice"
              onChange={(event) => setDraft((cur) => ({ ...cur, id: event.target.value }))}
            />
          </Form.Item>
          <Form.Item label="显示名称" className="!mb-0">
            <Input
              value={draft.displayName}
              placeholder="可选"
              onChange={(event) => setDraft((cur) => ({ ...cur, displayName: event.target.value }))}
            />
          </Form.Item>
          <Form.Item label="初始密码" className="!mb-0">
            <Input.Password
              value={draft.password}
              autoComplete="new-password"
              onChange={(event) => setDraft((cur) => ({ ...cur, password: event.target.value }))}
            />
          </Form.Item>
          <Form.Item label="角色" className="!mb-0">
            <Select
              value={draft.role}
              onChange={(role) => setDraft((cur) => ({ ...cur, role }))}
              options={[
                { value: "user", label: "普通用户" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </Form.Item>
        </Form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">用户列表</span>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void loadUsers()}
          >
            刷新
          </Button>
        </div>
        <div className="divide-y divide-slate-100">
          {users.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-slate-500">暂无用户</div>
          ) : (
            users.map((user) => (
              <div
                key={user.id}
                className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {user.displayName || user.id}
                    </span>
                    <Tag color={user.role === "admin" ? "geekblue" : "default"}>
                      {user.role === "admin" ? "管理员" : "用户"}
                    </Tag>
                    <Tag color={user.status === "active" ? "green" : "red"}>
                      {user.status === "active" ? "启用" : "禁用"}
                    </Tag>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {user.id} · 最近登录：{formatDate(user.lastLoginAt)}
                  </div>
                </div>
                <Space size="small" wrap>
                  <Select<LocalUserRole>
                    size="small"
                    value={user.role}
                    className="w-[92px]"
                    disabled={savingId === user.id}
                    onChange={(role) => void patchUser(user, { role })}
                    options={[
                      { value: "user", label: "用户" },
                      { value: "admin", label: "管理员" },
                    ]}
                  />
                  <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                    启用
                    <Switch
                      size="small"
                      checked={user.status === "active"}
                      loading={savingId === user.id}
                      onChange={(checked) =>
                        void patchUser(user, { status: checked ? "active" : "disabled" })
                      }
                    />
                  </span>
                  <Button
                    size="small"
                    icon={<SaveOutlined />}
                    loading={savingId === user.id}
                    onClick={() => void resetPassword(user)}
                  >
                    重置密码
                  </Button>
                </Space>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
