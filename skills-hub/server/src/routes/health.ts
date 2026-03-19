import { Hono } from "hono";
import { PUBLIC_BASE_URL } from "../config/env.js";

const healthRoutes = new Hono();

healthRoutes.get("/healthz", (c) => {
  return c.json({ ok: true });
});

healthRoutes.get("/.well-known/clawhub.json", (c) => {
  return c.json({
    apiBase: PUBLIC_BASE_URL,
    authBase: PUBLIC_BASE_URL,
    minCliVersion: "0.0.5",
  });
});

healthRoutes.get("/.well-known/clawdhub.json", (c) => {
  return c.json({
    registry: PUBLIC_BASE_URL,
    authBase: PUBLIC_BASE_URL,
    minCliVersion: "0.0.5",
  });
});

healthRoutes.get("/api/v1/whoami", (c) => {
  return c.json({
    user: {
      handle: "private-registry",
      displayName: "Private Registry",
      image: null,
    },
  });
});

export default healthRoutes;
