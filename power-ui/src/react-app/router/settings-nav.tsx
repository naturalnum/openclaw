import {
  ApiOutlined,
  CloudServerOutlined,
  LinkOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import { ROUTES } from "./paths";

export type SettingsNavItem = {
  path: string;
  title: string;
  description: string;
  icon: ReactNode;
};

/** 侧栏悬停菜单与设置子页共用 */
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    path: ROUTES.settingsConnection,
    title: "连接",
    description: "Gateway 地址与访问令牌",
    icon: <ApiOutlined />,
  },
  {
    path: ROUTES.settingsModels,
    title: "模型",
    description: "提供商与默认主模型",
    icon: <RobotOutlined />,
  },
  {
    path: ROUTES.settingsConnectors,
    title: "连接器",
    description: "数据库等连接实例",
    icon: <LinkOutlined />,
  },
  {
    path: ROUTES.settingsMcp,
    title: "MCP",
    description: "全局 MCP 服务器摘要",
    icon: <CloudServerOutlined />,
  },
];
