import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptContent,
  decryptContent,
  isEncryptedContent,
  matchesEncryptedPath,
  normalizeConfig,
  resolveEncryptionKey,
} from "./index.ts";

describe("file-encryption-plugin", () => {
  let encryptionKey: Buffer;

  beforeEach(() => {
    // Generate a valid 32-byte key for testing
    encryptionKey = Buffer.alloc(32, "test-key-for-encryption-plugin-32b");
  });

  describe("encryptContent / decryptContent", () => {
    it("should encrypt and decrypt content successfully", () => {
      const plaintext = "This is sensitive data that should be encrypted";

      const encrypted = encryptContent(plaintext, encryptionKey);
      const decrypted = decryptContent(encrypted, encryptionKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext (due to random IV)", () => {
      const plaintext = "same content";

      const encrypted1 = encryptContent(plaintext, encryptionKey);
      const encrypted2 = encryptContent(plaintext, encryptionKey);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same plaintext
      expect(decryptContent(encrypted1, encryptionKey)).toBe(plaintext);
      expect(decryptContent(encrypted2, encryptionKey)).toBe(plaintext);
    });

    it("should handle empty string", () => {
      const plaintext = "";

      const encrypted = encryptContent(plaintext, encryptionKey);
      const decrypted = decryptContent(encrypted, encryptionKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle unicode content", () => {
      const plaintext = "中文测试 🚀 🔐 加密解密";

      const encrypted = encryptContent(plaintext, encryptionKey);
      const decrypted = decryptContent(encrypted, encryptionKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should fail decryption with wrong key", () => {
      const plaintext = "sensitive data";
      const encrypted = encryptContent(plaintext, encryptionKey);

      const wrongKey = Buffer.alloc(32, "wrong-key-for-testing-32-bytes!!");

      expect(() => decryptContent(encrypted, wrongKey)).toThrow();
    });

    it("should fail decryption with corrupted data", () => {
      const plaintext = "sensitive data";
      const encrypted = encryptContent(plaintext, encryptionKey);

      // Corrupt the encrypted data
      const corrupted = encrypted.slice(0, -5) + "XXXXX";

      expect(() => decryptContent(corrupted, encryptionKey)).toThrow();
    });

    it("should fail decryption with invalid format", () => {
      expect(() => decryptContent("invalid-data", encryptionKey)).toThrow(
        "Invalid encrypted data format",
      );
    });
  });

  describe("isEncryptedContent", () => {
    it("should return true for valid encrypted content", () => {
      const plaintext = "test data";
      const encrypted = encryptContent(plaintext, encryptionKey);

      expect(isEncryptedContent(encrypted)).toBe(true);
    });

    it("should return false for plaintext", () => {
      expect(isEncryptedContent("This is plain text")).toBe(false);
    });

    it("should return false for incomplete encrypted content", () => {
      expect(isEncryptedContent("part1:part2")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isEncryptedContent("")).toBe(false);
    });

    it("should return false for JSON content", () => {
      expect(isEncryptedContent('{"key": "value"}')).toBe(false);
    });
  });

  describe("matchesEncryptedPath", () => {
    it("should match memory directory pattern", () => {
      const patterns = ["**/memory/**"];

      expect(matchesEncryptedPath("/home/user/workspace/memory/file.md", patterns)).toBe(true);
      expect(matchesEncryptedPath("/home/user/memory/notes.md", patterns)).toBe(true);
    });

    it("should match config file pattern", () => {
      const patterns = ["**/.openclaw/config.*"];

      expect(matchesEncryptedPath("/home/user/.openclaw/config.json", patterns)).toBe(true);
      expect(matchesEncryptedPath("/home/user/.openclaw/config.yaml", patterns)).toBe(true);
    });

    it("should match wildcard patterns", () => {
      const patterns = ["**/*.secret.*"];

      expect(matchesEncryptedPath("/home/user/credentials.secret.json", patterns)).toBe(true);
      expect(matchesEncryptedPath("/home/user/api.secret.key", patterns)).toBe(true);
    });

    it("should not match non-matching paths", () => {
      const patterns = ["**/memory/**"];

      expect(matchesEncryptedPath("/home/user/documents/file.md", patterns)).toBe(false);
      expect(matchesEncryptedPath("/home/user/memory", patterns)).toBe(false);
    });

    it("should handle absolute paths", () => {
      const patterns = ["/specific/path/**"];

      expect(matchesEncryptedPath("/specific/path/file.txt", patterns)).toBe(true);
      expect(matchesEncryptedPath("/other/path/file.txt", patterns)).toBe(false);
    });

    it("should match multiple patterns", () => {
      const patterns = ["**/memory/**", "**/config.*"];

      expect(matchesEncryptedPath("/home/memory/file.md", patterns)).toBe(true);
      expect(matchesEncryptedPath("/home/config.json", patterns)).toBe(true);
      expect(matchesEncryptedPath("/home/other.txt", patterns)).toBe(false);
    });
  });

  describe("normalizeConfig", () => {
    it("should use default values when config is empty", () => {
      const config = normalizeConfig({});

      expect(config.encryptionKey).toBe("");
      expect(config.mode).toBe("both");
      expect(config.encryptedPaths).toEqual([
        "**/memory/**",
        "**/.openclaw/config.*",
        "**/sessions/**",
        "**/*.secret.*",
      ]);
    });

    it("should use custom encryptedPaths", () => {
      const config = normalizeConfig({
        encryptedPaths: ["**/custom/**"],
      });

      expect(config.encryptedPaths).toEqual(["**/custom/**"]);
    });

    it("should use custom mode", () => {
      const configEncrypt = normalizeConfig({ mode: "encrypt" });
      const configDecrypt = normalizeConfig({ mode: "decrypt" });

      expect(configEncrypt.mode).toBe("encrypt");
      expect(configDecrypt.mode).toBe("decrypt");
    });

    it("should filter invalid path entries", () => {
      const config = normalizeConfig({
        encryptedPaths: ["**/valid/**", "", "  ", 123, null],
      });

      expect(config.encryptedPaths).toEqual(["**/valid/**"]);
    });

    it("should handle undefined config", () => {
      const config = normalizeConfig(undefined);

      expect(config.mode).toBe("both");
      expect(config.encryptedPaths.length).toBeGreaterThan(0);
    });
  });

  describe("resolveEncryptionKey", () => {
    it("should resolve key from environment variable", () => {
      const testKey = Buffer.alloc(32, "env-var-test-key-32-bytes-long!!").toString("base64");
      process.env.OPENCLAW_FILE_ENCRYPTION_KEY = testKey;

      try {
        const key = resolveEncryptionKey("");
        expect(key).toEqual(Buffer.from(testKey, "base64"));
      } finally {
        delete process.env.OPENCLAW_FILE_ENCRYPTION_KEY;
      }
    });

    it("should resolve key from config when env var is not set", () => {
      delete process.env.OPENCLAW_FILE_ENCRYPTION_KEY;

      const testKey = Buffer.alloc(32, "config-test-key-32-bytes-long!").toString("base64");
      const key = resolveEncryptionKey(testKey);

      expect(key).toEqual(Buffer.from(testKey, "base64"));
    });

    it("should prefer environment variable over config", () => {
      const envKey = Buffer.alloc(32, "env-priority-key-32-bytes-long!!").toString("base64");
      const configKey = Buffer.alloc(32, "config-key-should-be-ignored-32b!!").toString("base64");

      process.env.OPENCLAW_FILE_ENCRYPTION_KEY = envKey;

      try {
        const key = resolveEncryptionKey(configKey);
        expect(key).toEqual(Buffer.from(envKey, "base64"));
      } finally {
        delete process.env.OPENCLAW_FILE_ENCRYPTION_KEY;
      }
    });

    it("should throw error when no key is provided", () => {
      delete process.env.OPENCLAW_FILE_ENCRYPTION_KEY;

      expect(() => resolveEncryptionKey("")).toThrow("No encryption key provided");
    });

    it("should throw error for invalid key length", () => {
      const shortKey = Buffer.alloc(16, "too-short").toString("base64");

      expect(() => resolveEncryptionKey(shortKey)).toThrow("Invalid key length");
    });

    it("should throw error for invalid base64", () => {
      expect(() => resolveEncryptionKey("not-valid-base64!!!")).toThrow("Invalid base64");
    });
  });

  describe("config schema validation", async () => {
    const { validate } = await import("./index.ts").then((m) => ({
      validate: m.fileEncryptionConfigSchema.validate,
    }));

    it("should accept valid config", () => {
      const result = validate({
        encryptionKey: "valid-key",
        encryptedPaths: ["**/memory/**"],
        mode: "both",
      });

      expect(result.ok).toBe(true);
    });

    it("should reject unknown keys", () => {
      const result = validate({
        unknownKey: "value",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("unknown config key: unknownKey");
      }
    });

    it("should reject invalid mode", () => {
      const result = validate({
        mode: "invalid",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain('mode must be "encrypt", "decrypt", or "both"');
      }
    });

    it("should reject non-array encryptedPaths", () => {
      const result = validate({
        encryptedPaths: "not-an-array",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("encryptedPaths must be an array of strings");
      }
    });

    it("should reject non-string encryptionKey", () => {
      const result = validate({
        encryptionKey: 123,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain("encryptionKey must be a string");
      }
    });

    it("should accept undefined config", () => {
      const result = validate(undefined);

      expect(result.ok).toBe(true);
    });
  });
});
