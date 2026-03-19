import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth.js";

// Route modules
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import skillRoutes from "./routes/skills.js";
import reviewRoutes from "./routes/reviews.js";
import userRoutes from "./routes/users.js";

export function createApp() {
  const app = new Hono();

  // Global middleware
  app.use("*", logger());
  app.use("*", cors({
    origin: (origin) => origin || "*",
    credentials: true,
  }));

  // Auth middleware — sets c.var.user on every request
  app.use("*", authMiddleware);

  // Global error handler
  app.onError((err, c) => {
    console.error("[server error]", err);
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json(
      { error: err.message || "Internal Server Error" },
      statusCode as 500,
    );
  });

  // Mount routes
  app.route("/", healthRoutes);
  app.route("/", authRoutes);
  app.route("/", skillRoutes);
  app.route("/", reviewRoutes);
  app.route("/", userRoutes);

  return app;
}
