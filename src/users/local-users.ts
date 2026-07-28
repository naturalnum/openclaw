import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const AUTH_DIRNAME = "auth";
const AUTH_USERS_DIRNAME = "users";
const WORKSPACE_USERS_DIRNAME = "users";
const PROFILE_FILENAME = "profile.json";
const SESSIONS_FILENAME = "sessions.json";
const LEGACY_SESSIONS_FILENAME = "_sessions.json";
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const USER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const RESERVED_USER_IDS = new Set(["_sessions", "sessions", "admin.json"]);

type ScryptPasswordHash = `scrypt:v1:${number}:${number}:${number}:${string}:${string}`;
type ScryptParams = {
  cost: number;
  blockSize: number;
  parallelization: number;
};

export type LocalUserRole = "admin" | "user";
export type LocalUserStatus = "active" | "disabled";

export type LocalUserProfile = {
  id: string;
  displayName: string;
  role: LocalUserRole;
  status: LocalUserStatus;
  passwordHash: ScryptPasswordHash;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type PublicLocalUserProfile = Omit<LocalUserProfile, "passwordHash">;

export type CreateLocalUserInput = {
  id: string;
  password: string;
  displayName?: string;
  role?: LocalUserRole;
  stateDir?: string;
  now?: Date;
};

export type UpdateLocalUserInput = {
  id: string;
  displayName?: string;
  role?: LocalUserRole;
  status?: LocalUserStatus;
  password?: string;
  stateDir?: string;
  now?: Date;
};

export type AuthenticateLocalUserResult =
  | { ok: true; user: PublicLocalUserProfile }
  | { ok: false; error: "not-found" | "disabled" | "invalid-password" | "invalid-id" };

export type LocalUserSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

export type CreateLocalUserSessionResult = {
  token: string;
  session: Omit<LocalUserSession, "tokenHash">;
};

type LocalUserSessionsFile = {
  sessions: LocalUserSession[];
};

const localUserStateTails = new Map<string, Promise<void>>();

function resolveLocalUserStateLockKey(stateDir: string | undefined): string {
  return path.resolve(stateDir ?? resolveStateDir());
}

/**
 * Serializes filesystem operations that share a local-user state directory.
 * The queued tail is independent from the operation result so a rejected
 * mutation never poisons later work for the same state directory.
 */
async function withLocalUserStateLock<T>(
  stateDir: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const key = resolveLocalUserStateLockKey(stateDir);
  const previous = localUserStateTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  localUserStateTails.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localUserStateTails.get(key) === tail) {
      localUserStateTails.delete(key);
    }
  }
}

export function normalizeLocalUserId(id: string): string {
  return id.trim().toLowerCase();
}

export function validateLocalUserId(id: string): string {
  const normalized = normalizeLocalUserId(id);
  if (!USER_ID_PATTERN.test(normalized) || RESERVED_USER_IDS.has(normalized)) {
    throw new Error(
      "User ID must be 2-63 characters and use lowercase letters, numbers, underscores, or hyphens.",
    );
  }
  return normalized;
}

export function resolveLocalUsersDir(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, AUTH_DIRNAME, AUTH_USERS_DIRNAME);
}

export function resolveLocalUserDir(userId: string, stateDir: string = resolveStateDir()): string {
  return path.join(resolveLocalUsersDir(stateDir), validateLocalUserId(userId));
}

export function resolveLocalUserProfilePath(
  userId: string,
  stateDir: string = resolveStateDir(),
): string {
  return path.join(resolveLocalUserDir(userId, stateDir), PROFILE_FILENAME);
}

function resolveLocalUserSessionsPath(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, AUTH_DIRNAME, SESSIONS_FILENAME);
}

function resolveLegacyLocalUsersDir(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, WORKSPACE_USERS_DIRNAME);
}

function resolveLegacyLocalUserProfilePath(
  userId: string,
  stateDir: string = resolveStateDir(),
): string {
  return path.join(
    resolveLegacyLocalUsersDir(stateDir),
    validateLocalUserId(userId),
    PROFILE_FILENAME,
  );
}

function resolveLegacyLocalUserSessionsPath(stateDir: string = resolveStateDir()): string {
  return path.join(resolveLegacyLocalUsersDir(stateDir), LEGACY_SESSIONS_FILENAME);
}

export function resolveLocalUserWorkspaceRoot(
  userId: string,
  stateDir: string = resolveStateDir(),
): string {
  return path.join(stateDir, WORKSPACE_USERS_DIRNAME, validateLocalUserId(userId));
}

export function resolveLocalUserDefaultWorkspace(
  userId: string,
  stateDir: string = resolveStateDir(),
): string {
  return path.join(resolveLocalUserWorkspaceRoot(userId, stateDir), "default");
}

export function resolveLocalUserDefaultAgentId(userId: string): string {
  const id = validateLocalUserId(userId);
  const digest = createHash("sha1").update(`local-user-default\n${id}`).digest("hex").slice(0, 12);
  return `agent-${digest}`;
}

export function resolveLocalUserProjectsDir(
  userId: string,
  stateDir: string = resolveStateDir(),
): string {
  return path.join(resolveLocalUserWorkspaceRoot(userId, stateDir), "projects");
}

export function resolveLocalUserSkillsDir(
  userId: string,
  stateDir: string = resolveStateDir(),
): string {
  return path.join(resolveLocalUserWorkspaceRoot(userId, stateDir), "skills");
}

export async function ensureLocalUserWorkspaces(
  userId: string,
  stateDir: string = resolveStateDir(),
): Promise<void> {
  await Promise.all([
    fs.mkdir(resolveLocalUserDefaultWorkspace(userId, stateDir), { recursive: true }),
    fs.mkdir(resolveLocalUserProjectsDir(userId, stateDir), { recursive: true }),
    fs.mkdir(resolveLocalUserSkillsDir(userId, stateDir), { recursive: true }),
  ]);
}

function publicLocalUserProfile(profile: LocalUserProfile): PublicLocalUserProfile {
  const { passwordHash: _passwordHash, ...publicProfile } = profile;
  return publicProfile;
}

function assertUsablePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
}

function deriveScryptKey(
  password: string,
  salt: string,
  keyLength: number,
  params: ScryptParams,
): Promise<Buffer> {
  const scryptWithOptions = scryptCallback as unknown as (
    password: string,
    salt: string,
    keylen: number,
    options: { N: number; r: number; p: number },
    callback: (err: Error | null, derivedKey: Buffer) => void,
  ) => void;
  return new Promise((resolve, reject) => {
    scryptWithOptions(
      password,
      salt,
      keyLength,
      {
        N: params.cost,
        r: params.blockSize,
        p: params.parallelization,
      },
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashLocalUserPassword(password: string): Promise<ScryptPasswordHash> {
  assertUsablePassword(password);
  const salt = randomBytes(16).toString("base64url");
  const cost = 16_384;
  const blockSize = 8;
  const parallelization = 1;
  const key = await deriveScryptKey(password, salt, 32, {
    cost,
    blockSize,
    parallelization,
  });
  return `scrypt:v1:${cost}:${blockSize}:${parallelization}:${salt}:${key.toString("base64url")}`;
}

export async function verifyLocalUserPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== "v1") {
    return false;
  }
  const cost = Number(parts[2]);
  const blockSize = Number(parts[3]);
  const parallelization = Number(parts[4]);
  const salt = parts[5];
  const expected = Buffer.from(parts[6], "base64url");
  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    !salt ||
    expected.length === 0
  ) {
    return false;
  }
  const actual = await deriveScryptKey(password, salt, expected.length, {
    cost,
    blockSize,
    parallelization,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readLocalUserUnlocked(
  id: string,
  opts: { stateDir?: string } = {},
): Promise<LocalUserProfile | null> {
  const userId = validateLocalUserId(id);
  const canonicalPath = resolveLocalUserProfilePath(userId, opts.stateDir);
  const canonical = await readJsonFile<LocalUserProfile>(canonicalPath);
  if (canonical) {
    return canonical;
  }
  const legacy = await readJsonFile<LocalUserProfile>(
    resolveLegacyLocalUserProfilePath(userId, opts.stateDir),
  );
  if (legacy) {
    await writeJsonFile(canonicalPath, legacy);
  }
  return legacy;
}

export async function readLocalUser(
  id: string,
  opts: { stateDir?: string } = {},
): Promise<LocalUserProfile | null> {
  return await withLocalUserStateLock(opts.stateDir, async () => readLocalUserUnlocked(id, opts));
}

async function readDirectoryEntries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function listLocalUsersUnlocked(
  opts: { stateDir?: string } = {},
): Promise<PublicLocalUserProfile[]> {
  const entries = [
    ...new Set([
      ...(await readDirectoryEntries(resolveLocalUsersDir(opts.stateDir))),
      ...(await readDirectoryEntries(resolveLegacyLocalUsersDir(opts.stateDir))),
    ]),
  ];
  const profiles = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await readLocalUserUnlocked(entry, opts);
      } catch {
        return null;
      }
    }),
  );
  return profiles
    .filter((profile): profile is LocalUserProfile => profile !== null)
    .map(publicLocalUserProfile)
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

export async function listLocalUsers(
  opts: { stateDir?: string } = {},
): Promise<PublicLocalUserProfile[]> {
  return await withLocalUserStateLock(opts.stateDir, async () => listLocalUsersUnlocked(opts));
}

async function hasAnyLocalUsersUnlocked(opts: { stateDir?: string } = {}): Promise<boolean> {
  return (await listLocalUsersUnlocked(opts)).length > 0;
}

export async function hasAnyLocalUsers(opts: { stateDir?: string } = {}): Promise<boolean> {
  return await withLocalUserStateLock(opts.stateDir, async () => hasAnyLocalUsersUnlocked(opts));
}

async function createLocalUserUnlocked(
  input: CreateLocalUserInput,
): Promise<PublicLocalUserProfile> {
  const id = validateLocalUserId(input.id);
  const existing = await readLocalUserUnlocked(id, { stateDir: input.stateDir });
  if (existing) {
    throw new Error(`Local user already exists: ${id}`);
  }
  const now = (input.now ?? new Date()).toISOString();
  const profile: LocalUserProfile = {
    id,
    displayName: input.displayName?.trim() || id,
    role: input.role ?? "user",
    status: "active",
    passwordHash: await hashLocalUserPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonFile(resolveLocalUserProfilePath(id, input.stateDir), profile);
  await ensureLocalUserWorkspaces(id, input.stateDir);
  return publicLocalUserProfile(profile);
}

export async function createLocalUser(
  input: CreateLocalUserInput,
): Promise<PublicLocalUserProfile> {
  return await withLocalUserStateLock(input.stateDir, async () => createLocalUserUnlocked(input));
}

async function updateLocalUserUnlocked(
  input: UpdateLocalUserInput,
): Promise<PublicLocalUserProfile> {
  const id = validateLocalUserId(input.id);
  const existing = await readLocalUserUnlocked(id, { stateDir: input.stateDir });
  if (!existing) {
    throw new Error(`Local user not found: ${id}`);
  }
  const now = (input.now ?? new Date()).toISOString();
  const updated: LocalUserProfile = {
    ...existing,
    ...(input.displayName !== undefined ? { displayName: input.displayName.trim() || id } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.password !== undefined
      ? { passwordHash: await hashLocalUserPassword(input.password) }
      : {}),
    updatedAt: now,
  };
  await writeJsonFile(resolveLocalUserProfilePath(id, input.stateDir), updated);
  return publicLocalUserProfile(updated);
}

export async function updateLocalUser(
  input: UpdateLocalUserInput,
): Promise<PublicLocalUserProfile> {
  return await withLocalUserStateLock(input.stateDir, async () => updateLocalUserUnlocked(input));
}

export async function initializeLocalAdmin(
  input: Omit<CreateLocalUserInput, "role">,
): Promise<PublicLocalUserProfile> {
  return await withLocalUserStateLock(input.stateDir, async () => {
    if (await hasAnyLocalUsersUnlocked({ stateDir: input.stateDir })) {
      throw new Error("Local users already exist; admin initialization is only available once.");
    }
    return await createLocalUserUnlocked({ ...input, role: "admin" });
  });
}

export async function authenticateLocalUser(input: {
  id: string;
  password: string;
  stateDir?: string;
  now?: Date;
}): Promise<AuthenticateLocalUserResult> {
  return await withLocalUserStateLock(input.stateDir, async () => {
    let id: string;
    try {
      id = validateLocalUserId(input.id);
    } catch {
      return { ok: false, error: "invalid-id" };
    }
    const profile = await readLocalUserUnlocked(id, { stateDir: input.stateDir });
    if (!profile) {
      return { ok: false, error: "not-found" };
    }
    if (profile.status !== "active") {
      return { ok: false, error: "disabled" };
    }
    const ok = await verifyLocalUserPassword(input.password, profile.passwordHash);
    if (!ok) {
      return { ok: false, error: "invalid-password" };
    }
    const now = (input.now ?? new Date()).toISOString();
    const updated: LocalUserProfile = {
      ...profile,
      lastLoginAt: now,
      updatedAt: now,
    };
    await writeJsonFile(resolveLocalUserProfilePath(id, input.stateDir), updated);
    return { ok: true, user: publicLocalUserProfile(updated) };
  });
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

async function readLocalUserSessions(stateDir: string | undefined): Promise<LocalUserSessionsFile> {
  const canonicalPath = resolveLocalUserSessionsPath(stateDir);
  const canonical = await readJsonFile<LocalUserSessionsFile>(canonicalPath);
  if (canonical) {
    return canonical;
  }
  const legacy = await readJsonFile<LocalUserSessionsFile>(
    resolveLegacyLocalUserSessionsPath(stateDir),
  );
  if (legacy) {
    await writeJsonFile(canonicalPath, legacy);
    return legacy;
  }
  return { sessions: [] };
}

async function writeLocalUserSessions(
  stateDir: string | undefined,
  sessionsFile: LocalUserSessionsFile,
): Promise<void> {
  await writeJsonFile(resolveLocalUserSessionsPath(stateDir), sessionsFile);
}

export async function createLocalUserSession(input: {
  userId: string;
  stateDir?: string;
  now?: Date;
  ttlMs?: number;
}): Promise<CreateLocalUserSessionResult> {
  return await withLocalUserStateLock(input.stateDir, async () => {
    const userId = validateLocalUserId(input.userId);
    const user = await readLocalUserUnlocked(userId, { stateDir: input.stateDir });
    if (!user || user.status !== "active") {
      throw new Error(`Active local user not found: ${userId}`);
    }
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const session: LocalUserSession = {
      id: randomBytes(16).toString("base64url"),
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    const sessionsFile = await readLocalUserSessions(input.stateDir);
    const activeSessions = sessionsFile.sessions.filter(
      (existing) => new Date(existing.expiresAt).getTime() > now.getTime(),
    );
    activeSessions.push(session);
    await writeLocalUserSessions(input.stateDir, { sessions: activeSessions });
    const { tokenHash: _tokenHash, ...publicSession } = session;
    return { token, session: publicSession };
  });
}

export async function revokeLocalUserSession(input: {
  token: string;
  stateDir?: string;
}): Promise<boolean> {
  return await withLocalUserStateLock(input.stateDir, async () => {
    const tokenHash = hashSessionToken(input.token);
    const sessionsFile = await readLocalUserSessions(input.stateDir);
    const remaining = sessionsFile.sessions.filter((session) => session.tokenHash !== tokenHash);
    if (remaining.length === sessionsFile.sessions.length) {
      return false;
    }
    await writeLocalUserSessions(input.stateDir, { sessions: remaining });
    return true;
  });
}

export async function resolveLocalUserSession(input: {
  token: string;
  stateDir?: string;
  now?: Date;
}): Promise<{ session: Omit<LocalUserSession, "tokenHash">; user: PublicLocalUserProfile } | null> {
  return await withLocalUserStateLock(input.stateDir, async () => {
    const tokenHash = hashSessionToken(input.token);
    const now = input.now ?? new Date();
    const sessionsFile = await readLocalUserSessions(input.stateDir);
    const session = sessionsFile.sessions.find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        new Date(candidate.expiresAt).getTime() > now.getTime(),
    );
    if (!session) {
      return null;
    }
    const user = await readLocalUserUnlocked(session.userId, { stateDir: input.stateDir });
    if (!user || user.status !== "active") {
      return null;
    }
    const { tokenHash: _tokenHash, ...publicSession } = session;
    return { session: publicSession, user: publicLocalUserProfile(user) };
  });
}
