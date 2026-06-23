import { App, Button, Form, Input, Spin } from "antd";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePowerUiSettings } from "../hooks/usePowerUiSettings";
import {
  localUsersRequest,
  type LocalUserAuthResult,
  type LocalUserProfile,
  type LocalUsersStatus,
} from "../lib/local-users-client";

const LOCAL_USER_SESSION_STORAGE_KEY = "openclaw.power.localUserSession";
const LOCAL_USER_AUTH_NOTICE_KEY = "local-user-auth-notice";

type LocalUsersContextValue = {
  enabled: boolean;
  initialized: boolean;
  statusError: string;
  sessionToken: string;
  user: LocalUserProfile | null;
  refreshMe: () => Promise<void>;
  logout: () => void;
};

const LocalUsersContext = createContext<LocalUsersContextValue | null>(null);

type CredentialsForm = {
  id: string;
  password: string;
  displayName?: string;
};

function loadStoredSessionToken(): string {
  try {
    return localStorage.getItem(LOCAL_USER_SESSION_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeSessionToken(token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(LOCAL_USER_SESSION_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(LOCAL_USER_SESSION_STORAGE_KEY);
    }
  } catch {
    // Best-effort local session persistence.
  }
}

function LocalUserAuthShell({
  initialized,
  loading,
  onSubmit,
}: {
  initialized: boolean;
  loading: boolean;
  onSubmit: (values: CredentialsForm) => Promise<void>;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-slate-900">
            {initialized ? "登录小龙虾" : "创建管理员"}
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            {initialized
              ? "请输入本盒子的本地账号。"
              : "首次使用需要创建一个本地管理员，用于后续添加和管理用户。"}
          </p>
        </div>
        <Form<CredentialsForm> layout="vertical" requiredMark={false} onFinish={onSubmit}>
          <Form.Item
            label="用户 ID"
            name="id"
            rules={[{ required: true, message: "请输入用户 ID" }]}
          >
            <Input autoComplete="username" placeholder="例如 owner" />
          </Form.Item>
          {!initialized ? (
            <Form.Item label="显示名称" name="displayName">
              <Input placeholder="可选" />
            </Form.Item>
          ) : null}
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password autoComplete={initialized ? "current-password" : "new-password"} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            {initialized ? "登录" : "创建管理员"}
          </Button>
        </Form>
      </div>
    </div>
  );
}

export function LocalUsersProvider({ children }: { children: ReactNode }) {
  const { message } = App.useApp();
  const { settings } = usePowerUiSettings();
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [sessionToken, setSessionToken] = useState(loadStoredSessionToken);
  const [user, setUser] = useState<LocalUserProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requestSettings = useMemo(
    () => ({ gatewayUrl: settings.gatewayUrl, token: settings.token }),
    [settings.gatewayUrl, settings.token],
  );

  const setActiveSession = useCallback((token: string, nextUser: LocalUserProfile | null) => {
    const normalized = token.trim();
    setSessionToken(normalized);
    storeSessionToken(normalized);
    setUser(nextUser);
  }, []);

  const refreshMe = useCallback(async () => {
    const token = loadStoredSessionToken() || sessionToken;
    if (!token) {
      setUser(null);
      return;
    }
    const result = await localUsersRequest<{ ok: true; user: LocalUserProfile }>(
      requestSettings,
      "/local-users/me",
      { sessionToken: token },
    );
    setActiveSession(token, result.user);
  }, [requestSettings, sessionToken, setActiveSession]);

  const logout = useCallback(() => {
    setActiveSession("", null);
  }, [setActiveSession]);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    void localUsersRequest<LocalUsersStatus>(requestSettings, "/local-users/status")
      .then(async (status) => {
        if (cancelled) {
          return;
        }
        setEnabled(true);
        setInitialized(status.initialized);
        setStatusError("");
        if (status.initialized) {
          try {
            await refreshMe();
          } catch {
            if (!cancelled) {
              setActiveSession("", null);
            }
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEnabled(false);
          setInitialized(false);
          setStatusError(err instanceof Error ? err.message : "无法连接本地用户接口");
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshMe, requestSettings, setActiveSession]);

  const submitCredentials = useCallback(
    async (values: CredentialsForm) => {
      if (submitting) {
        return;
      }
      setSubmitting(true);
      try {
        const result = await localUsersRequest<LocalUserAuthResult>(
          requestSettings,
          initialized ? "/local-users/login" : "/local-users/init-admin",
          {
            method: "POST",
            body: {
              id: values.id,
              password: values.password,
              ...(values.displayName?.trim() ? { displayName: values.displayName.trim() } : {}),
            },
          },
        );
        setInitialized(true);
        setActiveSession(result.token, result.user);
        message.success(initialized ? "已登录" : "管理员已创建");
      } catch (err) {
        const errText = err instanceof Error ? err.message : "操作失败";
        message.open({
          key: LOCAL_USER_AUTH_NOTICE_KEY,
          type: "error",
          content: errText === "Invalid credentials." ? "账号或密码不正确。" : errText,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [initialized, message, requestSettings, setActiveSession, submitting],
  );

  const value = useMemo<LocalUsersContextValue>(
    () => ({
      enabled,
      initialized,
      statusError,
      sessionToken,
      user,
      refreshMe,
      logout,
    }),
    [enabled, initialized, logout, refreshMe, sessionToken, statusError, user],
  );

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5] text-slate-500">
        <Spin />
      </div>
    );
  }

  if (enabled && (!initialized || !user)) {
    return (
      <LocalUserAuthShell
        initialized={initialized}
        loading={submitting}
        onSubmit={submitCredentials}
      />
    );
  }

  return <LocalUsersContext.Provider value={value}>{children}</LocalUsersContext.Provider>;
}

export function useLocalUsers() {
  const value = useContext(LocalUsersContext);
  if (!value) {
    return {
      enabled: false,
      initialized: false,
      statusError: "",
      sessionToken: "",
      user: null,
      refreshMe: async () => undefined,
      logout: () => undefined,
    } satisfies LocalUsersContextValue;
  }
  return value;
}
