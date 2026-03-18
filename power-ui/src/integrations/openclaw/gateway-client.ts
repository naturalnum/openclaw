import type { AgentEventPayload } from "../../../../ui/src/ui/app-tool-stream.ts";
import { extractText } from "../../../../ui/src/ui/chat/message-extract.ts";
import {
  GatewayBrowserClient,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "../../../../ui/src/ui/gateway.ts";
import type { WorkbenchAdapterEvent } from "../../adapters/workbench-adapter.ts";

export type PowerGatewaySettings = {
  gatewayUrl: string;
  token?: string;
};

type Listener = (event: WorkbenchAdapterEvent) => void;

function formatGatewayCloseError(params: {
  code: number;
  reason: string;
  error?: { message?: string } | undefined;
}) {
  if (params.error?.message) {
    return params.error.message;
  }
  if (params.reason.trim()) {
    return `gateway closed (${params.code}): ${params.reason}`;
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
