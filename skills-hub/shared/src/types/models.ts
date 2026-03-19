import type { UserRole, UserStatus, ReviewStatus, Visibility, ReviewAction } from "./enums.js";

export interface User {
  id: number;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  userId: number;
  expiresAt: number;
  createdAt: number;
}

export interface Skill {
  id: number;
  slug: string;
  displayName: string;
  summary: string;
  tags: string[];
  ownerId: number | null;
  visibility: Visibility;
  downloads: number;
  createdAt: number;
  updatedAt: number;
}

export interface Version {
  id: number;
  skillId: number;
  version: string;
  changelog: string;
  file: string;
  fingerprint: string;
  size: number;
  downloads: number;
  reviewStatus: ReviewStatus;
  uploadedBy: number | null;
  createdAt: number;
}

export interface Review {
  id: number;
  versionId: number;
  reviewerId: number;
  action: ReviewAction;
  reason: string;
  checkResults: unknown;
  createdAt: number;
}
