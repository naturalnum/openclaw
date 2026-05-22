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
            colorPrimary: "#30343a",
            colorLink: "#30343a",
            colorSuccess: "#30343a",
            colorText: "#24272d",
            colorTextHeading: "#17191d",
            colorBgMask: "rgba(15, 23, 42, 0.12)",
            borderRadiusLG: 10,
            controlOutline: "rgba(48, 52, 58, 0.14)",
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
