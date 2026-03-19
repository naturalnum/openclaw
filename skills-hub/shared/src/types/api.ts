import type { ReviewStatus } from "./enums.js";

// Auth
export interface AuthPayload {
  isAuthenticated: boolean;
  user: { id: number; username: string; role: string } | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  ok: boolean;
  auth: AuthPayload;
}

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface RegisterResponse {
  ok: boolean;
  auth: AuthPayload;
}

export interface SearchResultItem {
  slug: string;
  displayName: string;
  summary: string | null;
  version: string;
  score: number;
  updatedAt: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
}

export interface SkillDetailResponse {
  skill: {
    slug: string;
    displayName: string;
    summary: string | null;
    tags: string[];
    stats: { downloads: number };
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion: { version: string; createdAt: number; changelog: string } | null;
  owner: null;
}

export interface VersionListItem {
  version: string;
  createdAt: number;
  changelog: string;
  changelogSource: string;
}

export interface VersionListResponse {
  items: VersionListItem[];
  nextCursor: string | null;
}

export interface VersionDetailResponse {
  version: {
    version: string;
    createdAt: number;
    changelog: string;
    changelogSource: string;
    downloadUrl: string;
    files: { path: string; size: number }[];
  } | null;
  skill: { slug: string; displayName: string } | null;
}

export interface ResolveResponse {
  match: { version: string } | null;
  latestVersion: { version: string } | null;
}

// Admin data
export interface AdminSkillVersion {
  version: string;
  createdAt: number;
  changelog: string;
  file?: string;
  fingerprint?: string | null;
  size: number;
  downloads: number;
  reviewStatus: string;
  downloadUrl: string;
}

export interface AdminSkillItem {
  slug: string;
  displayName: string;
  summary: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  stats: { downloads: number };
  latestVersion: (AdminSkillVersion & { downloadUrl: string }) | null;
}

export interface AdminSkillsPageResponse {
  ok: boolean;
  total: number;
  page: number;
  pageSize: number;
  items: AdminSkillItem[];
}

// Upload
export interface UploadResponse {
  ok: boolean;
  error?: string;
  slug: string | null;
  version: string;
  file?: string | null;
  fingerprint?: string;
  size?: number;
  reviewStatus: ReviewStatus;
  skillName?: string;
  skillDescription?: string;
  checkResults?: unknown;
}

// Reviews
export interface PendingReviewItem {
  id: number;
  skillId: number;
  slug: string;
  displayName: string;
  version: string;
  changelog: string;
  file: string;
  fingerprint: string | null;
  size: number;
  reviewStatus: string;
  uploadedBy: number | null;
  createdAt: number;
}

export interface ReviewDetailResponse {
  ok: boolean;
  version: PendingReviewItem;
  reviews: {
    id: number;
    action: string;
    reason: string;
    reviewerName: string;
    checkResults: unknown;
    createdAt: number;
  }[];
}

// Users
export interface UserListItem {
  id: number;
  username: string;
  role: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserListResponse {
  ok: boolean;
  users: UserListItem[];
}
