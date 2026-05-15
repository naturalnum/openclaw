import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.resolve(here, "../package.json"), "utf8"),
) as { version?: string };
const powerUiPackageJson = JSON.parse(
  fs.readFileSync(path.resolve(here, "./package.json"), "utf8"),
) as { version?: string };

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export default defineConfig(() => {
  const envBase = process.env.OPENCLAW_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
    define: {
      __OPENCLAW_VERSION__: JSON.stringify(rootPackageJson.version ?? "0.0.0"),
      __POWER_UI_VERSION__: JSON.stringify(powerUiPackageJson.version ?? "0.0"),
    },
    build: {
      outDir: path.resolve(here, "../dist/power-ui"),
      emptyOutDir: true,
      sourcemap: true,
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        input: {
          main: path.resolve(here, "index.html"),
          react: path.resolve(here, "react.html"),
        },
      },
    },
    server: {
      host: true,
      port: 5174,
      strictPort: true,
      // Lit imports live under ../ui; allow the repo root so dev never serves
      // unexpected fallbacks that confuse the browser module graph.
      fs: {
        allow: [here, path.resolve(here, "..")],
      },
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
    optimizeDeps: {
      entries: [path.resolve(here, "index.html"), path.resolve(here, "react.html")],
      include: [
        "lit/directives/repeat.js",
        "react",
        "react/jsx-runtime",
        "react-dom",
        "react-dom/client",
        "antd",
        "@ant-design/icons",
        "@ant-design/cssinjs",
        "dayjs",
      ],
    },
    plugins: [
      react({ include: /\.(tsx|jsx)$/ }),
      {
        name: "power-ui-dev-stubs",
        configureServer(server) {
          server.middlewares.use("/__openclaw/control-ui-config.json", (_req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                basePath: "/",
                assistantName: "OpenClaw",
                assistantAvatar: "",
                assistantAgentId: "",
              }),
            );
          });
        },
      },
    ],
  };
});
