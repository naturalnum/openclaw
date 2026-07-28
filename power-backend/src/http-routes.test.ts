import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PowerFsService } from "./fs-service.js";

const readConfigFileSnapshotMock = vi.hoisted(() =>
  vi.fn(async () => ({
    config: {
      gateway: {
        controlUi: {
          allowedOrigins: ["http://192.168.20.10:5174"],
        },
      },
    },
  })),
);

vi.mock("../../src/config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/config/config.js")>(
    "../../src/config/config.js",
  );
  return {
    ...actual,
    readConfigFileSnapshot: readConfigFileSnapshotMock,
  };
});

const { createPowerFsHttpHandler, POWER_FS_UPLOAD_HTTP_PATH } = await import("./http-routes.js");

let server: ReturnType<typeof createServer>;
let baseUrl = "";

beforeAll(async () => {
  const handler = createPowerFsHttpHandler({
    auth: { mode: "token", token: "gateway-test-token", allowTailscale: false },
    fsService: {} as PowerFsService,
  });
  server = createServer((req, res) => {
    void handler(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  readConfigFileSnapshotMock.mockClear();
});

describe("Power FS upload CORS", () => {
  it("allows an explicitly configured remote Power UI origin", async () => {
    const response = await fetch(`${baseUrl}${POWER_FS_UPLOAD_HTTP_PATH}`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://192.168.20.10:5174",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://192.168.20.10:5174");
    expect(response.headers.get("access-control-allow-headers")).toContain("authorization");
  });

  it("does not grant CORS to an unconfigured remote origin", async () => {
    const response = await fetch(`${baseUrl}${POWER_FS_UPLOAD_HTTP_PATH}`, {
      method: "OPTIONS",
      headers: { Origin: "http://192.168.20.11:5174" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});
