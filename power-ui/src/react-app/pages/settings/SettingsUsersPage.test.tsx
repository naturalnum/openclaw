/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsUsersPage } from "./SettingsUsersPage";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const localUsersState = {
  enabled: true,
  initialized: true,
  statusError: "",
  sessionToken: "admin-session",
  user: {
    id: "admin",
    displayName: "管理员",
    role: "admin",
    status: "active",
    createdAt: "2026-06-24T00:00:00.000Z",
    updatedAt: "2026-06-24T00:00:00.000Z",
  },
  refreshMe: vi.fn(),
  logout: vi.fn(),
};

const localUsersRequest = vi.fn(async () => ({
  ok: true,
  users: [
    {
      id: "admin",
      displayName: "管理员",
      role: "admin",
      status: "active",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      lastLoginAt: "2026-06-24T00:00:00.000Z",
    },
    {
      id: "xixi",
      displayName: "阿里西西",
      role: "user",
      status: "active",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      lastLoginAt: "2026-06-24T00:00:00.000Z",
    },
  ],
}));

const appMessage = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@ant-design/icons", () => ({
  LogoutOutlined: () => React.createElement("span", { "data-icon": "logout" }),
  PlusOutlined: () => React.createElement("span", { "data-icon": "plus" }),
  ReloadOutlined: () => React.createElement("span", { "data-icon": "reload" }),
  SaveOutlined: () => React.createElement("span", { "data-icon": "save" }),
}));

vi.mock("antd", () => {
  const Field = ({
    children,
    className,
    label,
  }: {
    children?: React.ReactNode;
    className?: string;
    label?: React.ReactNode;
  }) =>
    React.createElement(
      "label",
      { className },
      label ? React.createElement("span", null, label) : null,
      children,
    );
  const Form = ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("form", { className }, children);
  Form.Item = Field;
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    React.createElement("input", props);
  Input.Password = Input;
  return {
    Alert: ({
      description,
      message,
    }: {
      description?: React.ReactNode;
      message?: React.ReactNode;
    }) => React.createElement("div", null, message, description),
    App: {
      useApp: () => ({
        message: appMessage,
      }),
    },
    Button: ({
      children,
      className,
      disabled,
      onClick,
    }: {
      children?: React.ReactNode;
      className?: string;
      disabled?: boolean;
      onClick?: () => void;
    }) => React.createElement("button", { className, disabled, onClick }, children),
    Form,
    Input,
    Select: ({ className, disabled }: { className?: string; disabled?: boolean }) =>
      React.createElement("span", {
        className: [className, disabled ? "ant-select-disabled" : ""].filter(Boolean).join(" "),
      }),
    Space: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
    Switch: ({ disabled }: { disabled?: boolean }) =>
      React.createElement("button", {
        className: disabled ? "ant-switch-disabled" : "",
      }),
    Tag: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("span", null, children),
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("../../context/LocalUsersContext", () => ({
  useLocalUsers: () => localUsersState,
}));

vi.mock("../../hooks/usePowerUiSettings", () => ({
  usePowerUiSettings: () => ({
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "token",
    },
  }),
}));

vi.mock("../../lib/local-users-client", () => ({
  localUsersRequest: (...args: unknown[]) => localUsersRequest(...args),
}));

function renderUsersPage() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(SettingsUsersPage));
  });
  return { container, root };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function rowContaining(container: HTMLElement, text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll("span")).find(
    (node) => node.textContent?.trim() === text,
  );
  const row = match?.closest(".sm\\:flex-row");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`missing row for ${text}`);
  }
  return row;
}

describe("Power UI settings users page", () => {
  let mounted: { container: HTMLElement; root: Root } | null = null;

  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
    document.body.innerHTML = "";
    localUsersRequest.mockClear();
  });

  it("disables current user's role and enabled controls while leaving other users editable", async () => {
    mounted = renderUsersPage();
    await settle();

    expect(localUsersRequest).toHaveBeenCalledWith(
      { gatewayUrl: "ws://127.0.0.1:18789", token: "token" },
      "/local-users",
      { sessionToken: "admin-session" },
    );

    const adminRow = rowContaining(mounted.container, "管理员");
    const xixiRow = rowContaining(mounted.container, "阿里西西");

    expect(adminRow.querySelector(".ant-select-disabled")).not.toBeNull();
    expect(adminRow.querySelector(".ant-switch-disabled")).not.toBeNull();
    expect(xixiRow.querySelector(".ant-select-disabled")).toBeNull();
    expect(xixiRow.querySelector(".ant-switch-disabled")).toBeNull();
  });
});
