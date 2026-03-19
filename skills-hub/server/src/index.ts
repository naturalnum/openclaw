import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import path from "node:path";
import { createApp } from "./app.js";
import { PORT } from "./config/env.js";
import { ensureInitialAdmin } from "./services/auth.service.js";

async function main() {
  // Ensure initial admin user
  await ensureInitialAdmin();

  const app = createApp();

  // Serve Vue SPA static files in production
  // In dev mode, Vite dev server handles this via proxy
  const clientDist = path.resolve(import.meta.dirname ?? ".", "../../client/dist");

  app.use(
    "/assets/*",
    serveStatic({ root: clientDist }),
  );

  // SPA fallback: serve index.html for non-API routes
  app.get("*", serveStatic({ root: clientDist, path: "index.html" }));

  serve(
    { fetch: app.fetch, port: PORT },
    (info) => {
      console.log(`[skills-hub] server running on http://localhost:${info.port}`);
    },
  );
}

main().catch((err) => {
  console.error("[skills-hub] startup failed:", err);
  process.exit(1);
});
