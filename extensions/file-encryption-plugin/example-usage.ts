#!/usr/bin/env node

/**
 * File Encryption Plugin - Example Usage
 *
 * This script demonstrates how to use the file encryption plugin
 * to encrypt and decrypt sensitive files.
 */

import { encryptContent, decryptContent, isEncryptedContent } from "./index.js";

// Generate a test key (in production, use: openssl rand -base64 32)
const TEST_KEY = Buffer.alloc(32, "example-key-for-demo-purposes-32b");

function example1_BasicEncryption() {
  console.log("\n=== Example 1: Basic Encryption ===\n");

  const plaintext = "This is sensitive data that needs protection";
  console.log("Original:", plaintext);

  // Encrypt
  const encrypted = encryptContent(plaintext, TEST_KEY);
  console.log("Encrypted:", encrypted);

  // Verify it's encrypted
  console.log("Is encrypted?", isEncryptedContent(encrypted));

  // Decrypt
  const decrypted = decryptContent(encrypted, TEST_KEY);
  console.log("Decrypted:", decrypted);

  console.log("Match:", plaintext === decrypted ? "✓" : "✗");
}

function example2_ConfigFileEncryption() {
  console.log("\n=== Example 2: Config File Encryption ===\n");

  const configData = JSON.stringify(
    {
      apiKey: "sk-secret-api-key-12345",
      databaseUrl: "postgresql://user:pass@localhost/db",
      secrets: {
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      },
    },
    null,
    2,
  );

  console.log("Original Config:");
  console.log(configData);

  // Encrypt
  const encrypted = encryptContent(configData, TEST_KEY);
  console.log("\nEncrypted Config (first 100 chars):", encrypted.substring(0, 100) + "...");

  // Decrypt
  const decrypted = decryptContent(encrypted, TEST_KEY);
  console.log("\nDecrypted Config:");
  console.log(decrypted);

  console.log("\nMatch:", configData === decrypted ? "✓" : "✗");
}

function example3_MemoryFileEncryption() {
  console.log("\n=== Example 3: Memory File Encryption ===\n");

  const memoryContent = `# Session: 2024-01-15 10:30:00 UTC

## User Preferences
- Favorite color: Blue
- Programming language: TypeScript
- Framework: React

## Recent Conversations
### Topic: API Design
User asked about REST API best practices. Discussed:
- Resource naming conventions
- Pagination strategies
- Error handling patterns

### Topic: Database Schema
Designed a schema for user management:
\`\`\`sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255)
);
\`\`\`
`;

  console.log("Original Memory (first 100 chars):", memoryContent.substring(0, 100) + "...");

  // Encrypt
  const encrypted = encryptContent(memoryContent, TEST_KEY);
  console.log("Encrypted Memory (first 100 chars):", encrypted.substring(0, 100) + "...");

  // Decrypt
  const decrypted = decryptContent(encrypted, TEST_KEY);
  console.log("Decrypted Memory (first 100 chars):", decrypted.substring(0, 100) + "...");

  console.log("Match:", memoryContent === decrypted ? "✓" : "✗");
}

function example4_EncryptedFormatBreakdown() {
  console.log("\n=== Example 4: Encrypted Format Breakdown ===\n");

  const plaintext = "test data";
  const encrypted = encryptContent(plaintext, TEST_KEY);

  const [iv, authTag, content] = encrypted.split(":");

  console.log("Encrypted format: iv:authTag:content\n");
  console.log("IV (base64):", iv);
  console.log("IV length (bytes):", Buffer.from(iv, "base64").length);
  console.log("\nAuth Tag (base64):", authTag?.substring(0, 50) + "...");
  console.log("Auth Tag length (bytes):", Buffer.from(authTag, "base64").length);
  console.log("\nContent (base64, first 50 chars):", content?.substring(0, 50) + "...");
  console.log("Content length (bytes):", Buffer.from(content, "base64").length);
}

function example5_ErrorHandling() {
  console.log("\n=== Example 5: Error Handling ===\n");

  // Try to decrypt invalid data
  try {
    decryptContent("not-encrypted-data", TEST_KEY);
    console.log("✗ Should have thrown error");
  } catch (error: unknown) {
    console.log(
      "✓ Caught error for invalid data:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // Try to decrypt with wrong key
  const plaintext = "secret message";
  const encrypted = encryptContent(plaintext, TEST_KEY);
  const wrongKey = Buffer.alloc(32, "wrong-key-for-testing-purposes-32b!!");

  try {
    decryptContent(encrypted, wrongKey);
    console.log("✗ Should have thrown error");
  } catch (error: unknown) {
    console.log(
      "✓ Caught error for wrong key:",
      error instanceof Error ? error.message : String(error),
    );
  }

  // Check if plaintext is encrypted
  console.log("Is 'hello world' encrypted?", isEncryptedContent("hello world") ? "Yes" : "No");
}

// Run all examples
console.log("File Encryption Plugin - Examples\n");
console.log("================================\n");

example1_BasicEncryption();
example2_ConfigFileEncryption();
example3_MemoryFileEncryption();
example4_EncryptedFormatBreakdown();
example5_ErrorHandling();

console.log("\n================================\n");
console.log("All examples completed successfully! ✓\n");
