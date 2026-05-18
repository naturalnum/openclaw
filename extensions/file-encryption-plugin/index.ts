import crypto from "node:crypto";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type FileEncryptionConfig = {
  encryptionKey: string;
  encryptedPaths: string[];
  mode: "encrypt" | "decrypt" | "both";
};

const DEFAULT_ENCRYPTED_PATHS = [
  "**/memory/**",
  "**/.openclaw/config.*",
  "**/sessions/**",
  "**/*.secret.*",
];

const _FILE_TOOLS_READ = new Set(["read", "cat", "file_read"]);
const FILE_TOOLS_WRITE = new Set(["write", "edit", "apply_patch", "file_write"]);

// =========================================================================
// Crypto Utilities
// =========================================================================

function generateIV(): Buffer {
  return crypto.randomBytes(16);
}

function encryptContent(plaintext: string, key: Buffer): string {
  const iv = generateIV();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted_content (all base64)
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

function decryptContent(encryptedData: string, key: Buffer): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivBase64, authTagBase64, encrypted] = parts;
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

function isEncryptedContent(data: string): boolean {
  // Check if data matches the encrypted format: iv:authTag:content
  const parts = data.split(":");
  if (parts.length !== 3) {
    return false;
  }

  try {
    // Try to decode base64 parts
    Buffer.from(parts[0], "base64");
    Buffer.from(parts[1], "base64");
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// Path Matching
// =========================================================================

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function globToRegex(glob: string): RegExp {
  // Convert glob pattern to regex
  const escaped = glob.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function matchesEncryptedPath(filePath: string, patterns: string[]): boolean {
  const normalized = normalizePath(filePath);

  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(normalized)) {
      return true;
    }
    // Also check if the path contains the pattern segment
    if (normalized.includes(pattern.replace("**/", "").replace("/**", ""))) {
      return true;
    }
  }

  return false;
}

// =========================================================================
// Config Normalization
// =========================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveEncryptionKey(configKey?: string): Buffer {
  // Priority: env var > config key
  const envKey = process.env.OPENCLAW_FILE_ENCRYPTION_KEY;
  const keySource = envKey || configKey;

  if (!keySource) {
    throw new Error(
      "No encryption key provided. Set OPENCLAW_FILE_ENCRYPTION_KEY env var or configure encryptionKey in plugin config.",
    );
  }

  try {
    const keyBuffer = Buffer.from(keySource, "base64");
    if (keyBuffer.length !== 32) {
      throw new Error(
        `Invalid key length: expected 32 bytes (256 bits), got ${keyBuffer.length} bytes. Generate with: openssl rand -base64 32`,
      );
    }
    return keyBuffer;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid key length")) {
      throw err;
    }
    throw new Error(
      `Invalid base64 encryption key: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function normalizeConfig(value: unknown): FileEncryptionConfig {
  const raw = isRecord(value) ? value : {};

  const encryptionKey = typeof raw.encryptionKey === "string" ? raw.encryptionKey : "";
  const encryptedPaths = Array.isArray(raw.encryptedPaths)
    ? raw.encryptedPaths
        .filter((entry): entry is string => typeof entry === "string")
        .map((e) => e.trim())
        .filter(Boolean)
    : [];
  const mode = raw.mode === "encrypt" || raw.mode === "decrypt" ? raw.mode : "both";

  return {
    encryptionKey,
    encryptedPaths: encryptedPaths.length > 0 ? encryptedPaths : DEFAULT_ENCRYPTED_PATHS,
    mode,
  };
}

export const fileEncryptionConfigSchema = {
  validate(value: unknown) {
    if (value === undefined) {
      return { ok: true as const, value: undefined };
    }
    if (!isRecord(value)) {
      return { ok: false as const, errors: ["expected config object"] };
    }

    const allowedKeys = new Set(["encryptionKey", "encryptedPaths", "mode"]);
    const errors: string[] = [];

    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) {
        errors.push(`unknown config key: ${key}`);
      }
    }

    if (value.encryptionKey !== undefined && typeof value.encryptionKey !== "string") {
      errors.push("encryptionKey must be a string");
    }

    if (value.encryptedPaths !== undefined) {
      if (
        !Array.isArray(value.encryptedPaths) ||
        value.encryptedPaths.some((entry) => typeof entry !== "string")
      ) {
        errors.push("encryptedPaths must be an array of strings");
      }
    }

    if (
      value.mode !== undefined &&
      value.mode !== null &&
      typeof value.mode === "string" &&
      !["encrypt", "decrypt", "both"].includes(value.mode)
    ) {
      errors.push('mode must be "encrypt", "decrypt", or "both"');
    }

    return errors.length > 0 ? { ok: false as const, errors } : { ok: true as const, value };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      encryptionKey: {
        type: "string",
        description: "AES-256 encryption key (base64 encoded, 32 bytes).",
      },
      encryptedPaths: {
        type: "array",
        items: { type: "string" },
        description: "File path patterns to encrypt (supports * wildcard).",
      },
      mode: {
        type: "string",
        enum: ["encrypt", "decrypt", "both"],
        description: "Operation mode: encrypt, decrypt, or both.",
      },
    },
  },
};

// =========================================================================
// Plugin Implementation
// =========================================================================

const plugin = {
  id: "file-encryption-plugin",
  name: "File Encryption Plugin",
  description: "Transparent encryption/decryption for config and memory files.",
  configSchema: fileEncryptionConfigSchema,
  register(api: OpenClawPluginApi) {
    const config = normalizeConfig(api.pluginConfig);

    let encryptionKey: Buffer;
    try {
      encryptionKey = resolveEncryptionKey(config.encryptionKey);
    } catch (err) {
      api.logger.error(
        `[file-encryption-plugin] Failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    api.logger.info(
      `[file-encryption-plugin] Initialized with mode=${config.mode}, encryptedPaths=${JSON.stringify(config.encryptedPaths)}`,
    );

    // Intercept file write operations to encrypt content before writing
    api.on("before_tool_call", (event): { params: Record<string, unknown> } | void => {
      if (config.mode === "decrypt") {
        return; // Don't encrypt in decrypt-only mode
      }

      if (!FILE_TOOLS_WRITE.has(event.toolName)) {
        return;
      }

      const filePath = extractFilePath(event.params);
      if (!filePath || !matchesEncryptedPath(filePath, config.encryptedPaths)) {
        return;
      }

      // Encrypt the content before writing
      const content = extractWriteContent(event.params);
      if (!content || isEncryptedContent(content)) {
        return;
      }

      try {
        const encrypted = encryptContent(content, encryptionKey);
        api.logger?.debug?.(`[file-encryption-plugin] Encrypted file: ${filePath}`);

        // Return modified params with encrypted content
        const modifiedParams = { ...event.params };

        // Determine which key holds the content based on tool name
        if (event.toolName === "write" || event.toolName === "file_write") {
          modifiedParams.content = encrypted;
        } else if (event.toolName === "edit") {
          modifiedParams.input = encrypted;
        } else if (event.toolName === "apply_patch") {
          modifiedParams.input = encrypted;
        }

        return { params: modifiedParams };
      } catch (err) {
        api.logger.error(
          `[file-encryption-plugin] Failed to encrypt ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    });
  },
};

// =========================================================================
// Helper Functions
// =========================================================================

function extractFilePath(params: Record<string, unknown>): string | null {
  const pathKeys = ["path", "file", "targetPath", "filePath"];
  for (const key of pathKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractWriteContent(params: Record<string, unknown>): string | null {
  // For write/edit tools
  const contentKeys = ["content", "text", "input"];
  for (const key of contentKeys) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  // For apply_patch
  if (typeof params.input === "string") {
    return params.input;
  }

  return null;
}

export {
  encryptContent,
  decryptContent,
  isEncryptedContent,
  matchesEncryptedPath,
  normalizeConfig,
  resolveEncryptionKey,
};

export default plugin;
