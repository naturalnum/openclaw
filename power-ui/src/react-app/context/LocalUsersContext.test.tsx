/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalUsersProvider, useLocalUsers } from "./LocalUsersContext";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const localUsersRequestMock = vi.hoisted(() => vi.fn());
const settingsHarness = vi.hoisted(() => ({
  settings: {
    gatewayUrl: "ws://127.0.0.1:18789",
    token: "",
  },
  patchSettings: vi.fn(),
}));

vi.mock("../lib/local-users-client", () => ({
  localUsersRequest: (...args: unknown[]) => localUsersRequestMock(...args),
  LocalUsersHttpError: class LocalUsersHttpError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../hooks/usePowerUiSettings", () => ({
  usePowerUiSettings: () => settingsHarness,
}));

vi.mock("antd", () => {
  const Form = ({
    children,
    onFinish,
  }: {
    children?: React.ReactNode;
    onFinish?: (values: { id: string; password: string }) => void;
  }) =>
    React.createElement(
      "form",
      {
        onSubmit: (event: React.FormEvent) => {
          event.preventDefault();
          onFinish?.({ id: "owner", password: "owner secure password" });
        },
      },
      children,
    );
  Form.Item = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement("input", props);
  Input.Password = Input;
  return {
    App: {
      useApp: () => ({
        message: { open: vi.fn(), success: vi.fn() },
      }),
    },
    Button: ({
      children,
      htmlType,
      onClick,
    }: {
      children?: React.ReactNode;
      htmlType?: "button" | "submit";
      onClick?: () => void;
    }) => React.createElement("button", { type: htmlType ?? "button", onClick }, children),
    Form,
    Input,
    Spin: () => React.createElement("span", null, "loading"),
  };
});

function AuthenticatedContent() {
  const localUsers = useLocalUsers();
  return (
    <div>
      <span data-testid="user-id">{localUsers.user?.id ?? "none"}</span>
      <button type="button" onClick={localUsers.logout}>
        logout
      </button>
    </div>
  );
}

function renderProvider() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <LocalUsersProvider>
        <AuthenticatedContent />
      </LocalUsersProvider>,
    );
  });
  return { container, root };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("LocalUsersProvider Gateway auth bridge", () => {
  let mounted: { container: HTMLElement; root: Root } | null = null;

  beforeEach(() => {
    localStorage.clear();
    localUsersRequestMock.mockReset();
    settingsHarness.patchSettings.mockReset();
    settingsHarness.settings.gatewayUrl = "ws://127.0.0.1:18789";
    settingsHarness.settings.token = "";
  });

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
    document.body.innerHTML = "";
  });

  it("stores the bridged Gateway token after the first admin is created", async () => {
    localUsersRequestMock.mockImplementation(async (_settings: unknown, pathname: string) => {
      if (pathname === "/local-users/status") {
        return { ok: true, initialized: false };
      }
      if (pathname === "/local-users/init-admin") {
        return {
          ok: true,
          token: "local-user-session",
          session: {},
          user: { id: "owner" },
          gatewayAuth: { mode: "token", token: "gateway-session-token" },
        };
      }
      throw new Error(`unexpected path ${pathname}`);
    });

    mounted = renderProvider();
    await settle();
    const form = mounted.container.querySelector("form");
    expect(form).not.toBeNull();
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(settingsHarness.patchSettings).toHaveBeenCalledWith({
      token: "gateway-session-token",
    });
    expect(localStorage.getItem("openclaw.power.localUserSession")).toBe("local-user-session");
  });

  it("restores the bridged token and clears it on logout", async () => {
    localStorage.setItem("openclaw.power.localUserSession", "persisted-local-session");
    localUsersRequestMock.mockImplementation(async (_settings: unknown, pathname: string) => {
      if (pathname === "/local-users/status") {
        return { ok: true, initialized: true };
      }
      if (pathname === "/local-users/me") {
        return {
          ok: true,
          session: {},
          user: { id: "owner" },
          gatewayAuth: { mode: "token", token: "restored-gateway-token" },
        };
      }
      throw new Error(`unexpected path ${pathname}`);
    });

    mounted = renderProvider();
    await settle();
    expect(settingsHarness.patchSettings).toHaveBeenCalledWith({
      token: "restored-gateway-token",
    });

    const logout = Array.from(mounted.container.querySelectorAll("button")).find(
      (button) => button.textContent === "logout",
    );
    act(() => logout?.click());

    expect(localUsersRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      "/local-users/logout",
      expect.objectContaining({
        method: "POST",
        sessionToken: "persisted-local-session",
      }),
    );
    expect(settingsHarness.patchSettings).toHaveBeenLastCalledWith({ token: "" });
    expect(localStorage.getItem("openclaw.power.localUserSession")).toBeNull();
  });

  it("clears a stale Gateway token when the Gateway is not in token mode", async () => {
    settingsHarness.settings.token = "stale-gateway-token";
    localUsersRequestMock.mockImplementation(async (_settings: unknown, pathname: string) => {
      if (pathname === "/local-users/status") {
        return { ok: true, initialized: false };
      }
      if (pathname === "/local-users/init-admin") {
        return {
          ok: true,
          token: "local-user-session",
          session: {},
          user: { id: "owner" },
          gatewayAuth: { mode: "password" },
        };
      }
      throw new Error(`unexpected path ${pathname}`);
    });

    mounted = renderProvider();
    await settle();
    const form = mounted.container.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(settingsHarness.patchSettings).toHaveBeenCalledWith({ token: "" });
  });

  it("fails closed when the local-user status endpoint is unavailable", async () => {
    settingsHarness.settings.token = "stale-gateway-token";
    localStorage.setItem("openclaw.power.localUserSession", "stale-local-session");
    localUsersRequestMock.mockRejectedValue(new Error("network unavailable"));

    mounted = renderProvider();
    await settle();

    expect(mounted.container.textContent).toContain("服务暂时不可用");
    expect(mounted.container.querySelector('[data-testid="user-id"]')).toBeNull();
    expect(settingsHarness.patchSettings).toHaveBeenCalledWith({ token: "" });
    expect(localStorage.getItem("openclaw.power.localUserSession")).toBeNull();
  });
});
