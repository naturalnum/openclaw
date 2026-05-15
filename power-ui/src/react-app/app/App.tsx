import { App as AntApp, ConfigProvider, theme } from "antd";
import { HashRouter } from "react-router-dom";

import { AppRouter } from "../router/AppRouter";

/**
 * Root composition: Ant Design context + hash router + routed layout tree.
 */
export function App() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: "100vh",
      }}
    >
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: "#0d6b52",
            colorLink: "#0d6b52",
            colorSuccess: "#0d6b52",
            borderRadiusLG: 12,
            controlOutline: "rgba(13, 107, 82, 0.35)",
            controlOutlineWidth: 2,
          },
        }}
      >
        <AntApp style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <HashRouter>
            <AppRouter />
          </HashRouter>
        </AntApp>
      </ConfigProvider>
    </div>
  );
}
