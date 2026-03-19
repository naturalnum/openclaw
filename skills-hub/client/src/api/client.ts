import type {
  AuthPayload,
  LoginRequest,
  LoginResponse,
  RegisterResponse,
  SearchResponse,
  SkillDetailResponse,
  VersionListResponse,
  VersionDetailResponse,
  ResolveResponse,
  AdminSkillsPageResponse,
  UploadResponse,
  ReviewDetailResponse,
  UserListResponse,
  PendingReviewItem,
} from "@shared/types/api";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function del<T>(url: string): Promise<T> {
  return request<T>(url, { method: "DELETE" });
}

// ---- Auth ----
export const authApi = {
  session: () => request<AuthPayload>("/auth/session"),
  login: (data: LoginRequest) => post<LoginResponse>("/auth/login", data),
  register: (data: LoginRequest) => post<RegisterResponse>("/auth/register", data),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
};

// ---- Skills ----
export const skillsApi = {
  list: (params: { page?: number; pageSize?: number; sort?: string; q?: string } = {}) => {
    const sp = new URLSearchParams();
    if (params.page) {
      sp.set("page", String(params.page));
    }
    if (params.pageSize) {
      sp.set("pageSize", String(params.pageSize));
    }
    if (params.sort) {
      sp.set("sort", params.sort);
    }
    if (params.q) {
      sp.set("q", params.q);
    }
    return request<AdminSkillsPageResponse>(`/api/v1/skills?${sp}`);
  },
  search: (q: string) => request<SearchResponse>(`/api/v1/search?q=${encodeURIComponent(q)}`),
  detail: (slug: string) =>
    request<SkillDetailResponse>(`/api/v1/skills/${encodeURIComponent(slug)}`),
  versions: (slug: string) =>
    request<VersionListResponse>(`/api/v1/skills/${encodeURIComponent(slug)}/versions`),
  versionDetail: (slug: string, version: string) =>
    request<VersionDetailResponse>(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
    ),
  resolve: (slug: string, hash?: string) => {
    const sp = new URLSearchParams({ slug });
    if (hash) sp.set("hash", hash);
    return request<ResolveResponse>(`/api/v1/resolve?${sp}`);
  },
  upload: (file: File, version: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("version", version);
    return request<UploadResponse>("/api/v1/skills/upload", {
      method: "POST",
      body: fd,
    });
  },
  deleteVersion: (slug: string, version: string) =>
    request<{ ok: boolean; slug: string; version: string }>(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
      { method: "DELETE" },
    ),
};

// ---- Reviews ----
export const reviewsApi = {
  listPending: () =>
    request<{ ok: boolean; reviews: PendingReviewItem[] }>("/api/v1/admin/reviews"),
  detail: (versionId: number) =>
    request<ReviewDetailResponse>(`/api/v1/admin/reviews/${versionId}`),
  check: (versionId: number) =>
    post<{ ok: boolean; checkResults: unknown }>(`/api/v1/admin/reviews/${versionId}/check`),
  approve: (versionId: number, reason?: string) =>
    post<{ ok: boolean }>(`/api/v1/admin/reviews/${versionId}/approve`, { reason }),
  reject: (versionId: number, reason: string) =>
    post<{ ok: boolean }>(`/api/v1/admin/reviews/${versionId}/reject`, { reason }),
};

// ---- Users ----
export const usersApi = {
  list: () => request<UserListResponse>("/api/v1/admin/users"),
  disable: (id: number) => post<{ ok: boolean }>(`/api/v1/admin/users/${id}/disable`),
  enable: (id: number) => post<{ ok: boolean }>(`/api/v1/admin/users/${id}/enable`),
  remove: (id: number) => del<{ ok: boolean }>(`/api/v1/admin/users/${id}`),
};
