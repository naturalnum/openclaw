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
            colorPrimary: "#2563eb",
            colorLink: "#2563eb",
            colorSuccess: "#2563eb",
            borderRadiusLG: 10,
            controlOutline: "rgba(37, 99, 235, 0.22)",
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
