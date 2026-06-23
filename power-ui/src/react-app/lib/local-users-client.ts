export type LocalUserRole = "admin" | "user";
export type LocalUserStatus = "active" | "disabled";

export type LocalUserProfile = {
  id: string;
  displayName: string;
  role: LocalUserRole;
  status: LocalUserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type LocalUserSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

export type LocalUserAuthResult = {
  ok: true;
  token: string;
  session: LocalUserSession;
  user: LocalUserProfile;
};

export type LocalUsersStatus = {
  ok: true;
  initialized: boolean;
};

export type LocalUsersListResult = {
  ok: true;
  users: LocalUserProfile[];
};

type LocalUsersClientSettings = {
  gatewayUrl: string;
  token?: string;
};

type LocalUsersRequestOptions = {
  method?: string;
  body?: unknown;
  sessionToken?: string | null;
};

export function buildLocalUsersHttpUrl(gatewayUrlRaw: string, pathname: string): string {
  const gatewayUrl = new URL(gatewayUrlRaw);
  gatewayUrl.protocol = gatewayUrl.protocol === "wss:" ? "https:" : "http:";
  const basePath =
    gatewayUrl.pathname === "/"
      ? ""
      : gatewayUrl.pathname.endsWith("/")
        ? gatewayUrl.pathname.slice(0, -1)
        : gatewayUrl.pathname;
  gatewayUrl.pathname = `${basePath}${pathname}`;
  gatewayUrl.search = "";
  return gatewayUrl.toString();
}

async function readLocalUsersJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : ({} as T);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function localUsersRequest<T>(
  settings: LocalUsersClientSettings,
  pathname: string,
  options: LocalUsersRequestOptions = {},
): Promise<T> {
  const token = settings.token?.trim() ?? "";
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.sessionToken?.trim()
      ? { "x-openclaw-user-session": options.sessionToken.trim() }
      : {}),
  };
  const response = await fetch(buildLocalUsersHttpUrl(settings.gatewayUrl, pathname), {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  return await readLocalUsersJson<T>(response);
}
