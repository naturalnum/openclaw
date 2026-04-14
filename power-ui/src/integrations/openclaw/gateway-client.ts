import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter.ts";
import { extractText } from "../../compat/chat.ts";
import {
  GatewayBrowserClient,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "../../compat/gateway.ts";
import type { AgentEventPayload } from "../../compat/ui-core.ts";

export type PowerGatewaySettings = {
  gatewayUrl: string;
  token?: string;
};

type Listener = (event: WorkbenchAdapterEvent) => void;

function buildHttpRouteUrl(
  gatewayUrlRaw: string,
  routePath: string,
  query?: Record<string, string | null | undefined>,
): string {
  const gatewayUrl = new URL(gatewayUrlRaw);
  gatewayUrl.protocol = gatewayUrl.protocol === "wss:" ? "https:" : "http:";
  const basePath =
    gatewayUrl.pathname === "/"
      ? ""
      : gatewayUrl.pathname.endsWith("/")
        ? gatewayUrl.pathname.slice(0, -1)
        : gatewayUrl.pathname;
  gatewayUrl.pathname = `${basePath}${routePath}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) {
      search.set(key, trimmed);
    }
  }
  gatewayUrl.search = search.toString();
  return gatewayUrl.toString();
}

function formatGatewayCloseError(params: {
  code: number;
  reason: string;
  error?: { message?: string } | undefined;
}) {
  const rawMessage = params.error?.message?.trim() || params.reason.trim();
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes("gateway token mismatch") || normalized.includes("auth_token_mismatch")) {
    return "gateway token mismatch";
  }
  if (normalized.includes("gateway token missing") || normalized.includes("auth_token_missing")) {
    return "gateway token missing";
  }
  if (normalized.includes("pairing required")) {
    return "gateway pairing required";
  }
  if (normalized.includes("origin not allowed")) {
    return "origin not allowed";
  }
  if (normalized.includes("device identity required")) {
    return "device identity required";
  }
  if (normalized.includes("auth failed") || normalized.includes("unauthorized")) {
    return "gateway auth failed";
  }
  if (rawMessage) {
    return rawMessage;
  }
  return `gateway closed (${params.code})`;
}

export class PowerGatewayClient {
  private client: GatewayBrowserClient | null = null;
  private connectionKey = "";
  private readyPromise: Promise<GatewayBrowserClient> | null = null;
  private hello: GatewayHelloOk | null = null;
  private listeners = new Set<Listener>();

  constructor(private readonly getSettings: () => PowerGatewaySettings) {}

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose() {
    this.readyPromise = null;
    this.hello = null;
    this.client?.stop();
    this.client = null;
    this.connectionKey = "";
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    const client = await this.ensureConnected();
    return await client.request<T>(method, params);
  }

  async uploadHttpFile<T = unknown>(params: {
    routePath: string;
    query?: Record<string, string | null | undefined>;
    file: File;
    onProgress?: (progress: { loaded: number; total: number | null }) => void;
  }): Promise<T | null> {
    await this.ensureConnected();
    const settings = this.getSettings();
    const token = settings.token?.trim() || "";
    const query: Record<string, string | null | undefined> = { ...params.query };
    if (!("token" in query) && token) {
      query.token = token;
    }
    const url = buildHttpRouteUrl(settings.gatewayUrl, params.routePath, query);
    return await new Promise<T | null>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      if (params.file.type) {
        xhr.setRequestHeader("Content-Type", params.file.type);
      }
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }
      xhr.upload.addEventListener("progress", (event) => {
        params.onProgress?.({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : null,
        });
      });
      xhr.addEventListener("error", () => reject(new Error("upload failed")));
      xhr.addEventListener("abort", () => reject(new Error("upload aborted")));
      xhr.addEventListener("load", () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(xhr.responseText?.trim() || `HTTP ${xhr.status}`));
          return;
        }
        const text = xhr.responseText?.trim();
        if (!text) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(text) as T);
        } catch {
          resolve(null);
        }
      });
      xhr.send(params.file);
    });
  }

  async submitHttpDownload(params: {
    routePath: string;
    fields: Record<string, string | null | undefined>;
  }): Promise<void> {
    await this.ensureConnected();
    const settings = this.getSettings();
    const token = settings.token?.trim() || "";
    const query: Record<string, string | null | undefined> = { ...params.fields };
    if (!("token" in query) && token) {
      query.token = token;
    }
    const url = buildHttpRouteUrl(settings.gatewayUrl, params.routePath, query);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
    }, 1000);
  }

  async fetchHttpBlob(params: {
    routePath: string;
    fields: Record<string, string | null | undefined>;
  }): Promise<Blob> {
    await this.ensureConnected();
    const settings = this.getSettings();
    const token = settings.token?.trim() || "";
    const query: Record<string, string | null | undefined> = { ...params.fields };
    if (!("token" in query) && token) {
      query.token = token;
    }
    const url = buildHttpRouteUrl(settings.gatewayUrl, params.routePath, query);
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
    });
    if (!response.ok) {
      const message = (await response.text().catch(() => "")).trim();
      throw new Error(message || `HTTP ${response.status}`);
    }
    return await response.blob();
  }

  async ensureConnected(): Promise<GatewayBrowserClient> {
    const settings = this.getSettings();
    const key = `${settings.gatewayUrl.trim()}::${settings.token?.trim() ?? ""}`;
    if (this.client && this.readyPromise && this.connectionKey === key) {
      return await this.readyPromise;
    }

    this.dispose();
    this.connectionKey = key;
    this.readyPromise = new Promise<GatewayBrowserClient>((resolve, reject) => {
      let settled = false;
      const client = new GatewayBrowserClient({
        url: settings.gatewayUrl,
        token: settings.token?.trim() || undefined,
        onHello: (hello) => {
          this.hello = hello;
          if (!settled) {
            settled = true;
            this.emit({ type: "connection", connected: true, error: null });
            resolve(client);
          }
        },
        onEvent: (event) => {
          this.handleEvent(event);
        },
        onClose: ({ code, reason, error }) => {
          this.emit({
            type: "connection",
            connected: false,
            error: formatGatewayCloseError({ code, reason, error }),
          });
          if (!settled) {
            settled = true;
            reject(new Error(formatGatewayCloseError({ code, reason, error })));
          }
        },
      });
      this.client = client;
      client.start();
    });

    return await this.readyPromise;
  }

  private emit(event: WorkbenchAdapterEvent) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private handleEvent(event: GatewayEventFrame) {
    if (event.event === "agent") {
      const payload = event.payload as AgentEventPayload | undefined;
      if (!payload) {
        return;
      }
      this.emit({
        type: "agent",
        payload,
      });
      return;
    }

    if (event.event !== "chat") {
      return;
    }
    const payload = event.payload as
      | {
          sessionKey?: unknown;
          runId?: unknown;
          state?: unknown;
          message?: unknown;
          errorMessage?: unknown;
        }
      | undefined;
    const sessionKey =
      payload && typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
    const state =
      payload && typeof payload.state === "string" ? payload.state.trim().toLowerCase() : "";
    if (!sessionKey || !state) {
      return;
    }
    if (state !== "delta" && state !== "final" && state !== "aborted" && state !== "error") {
      return;
    }
    const message = payload?.message;
    const text = typeof message !== "undefined" && message !== null ? extractText(message) : null;
    this.emit({
      type: "chat",
      sessionKey,
      runId:
        payload && typeof payload.runId === "string" && payload.runId.trim()
          ? payload.runId.trim()
          : null,
      state,
      message,
      text,
      errorMessage:
        payload && typeof payload.errorMessage === "string" ? payload.errorMessage : null,
    });
  }
}
