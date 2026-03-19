import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
});

export const registerSchema = z.object({
  username: z.string().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
});

export const deleteVersionSchema = z.object({
  slug: z.string().min(1, "slug is required"),
  version: z.string().min(1, "version is required"),
});

export const rejectReviewSchema = z.object({
  reason: z.string().min(1, "reason is required for rejection"),
});

export const approveReviewSchema = z.object({
  reason: z.string().optional().default(""),
});
