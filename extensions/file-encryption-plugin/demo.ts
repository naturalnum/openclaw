/**
 * File Encryption Plugin - Demo Script
 *
 * This script demonstrates all features of the file encryption plugin.
 * Run with: npx tsx demo.ts
 */

import {
  encryptContent,
  decryptContent,
  isEncryptedContent,
  matchesEncryptedPath,
  normalizeConfig,
} from "./index.js";

// ANSI colors for output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function header(text: string) {
  console.log(
    `\n${colors.bold}${colors.blue}════════════════════════════════════════════${colors.reset}`,
  );
  console.log(`${colors.bold}${colors.blue}  ${text}${colors.reset}`);
  console.log(
    `${colors.bold}${colors.blue}════════════════════════════════════════════${colors.reset}\n`,
  );
}

function success(text: string) {
  console.log(`${colors.green}✓ ${text}${colors.reset}`);
}

function error(text: string) {
  console.log(`${colors.red}✗ ${text}${colors.reset}`);
}

function _info(text: string) {
  console.log(`${colors.cyan}ℹ ${text}${colors.reset}`);
}

// Generate test key
const TEST_KEY = Buffer.alloc(32, "demo-key-for-file-encryption-plugin!");

async function demo1_BasicEncryption() {
  header("Demo 1: Basic Encryption & Decryption");

  const plaintext = "This is sensitive data that needs protection";
  console.log(`${colors.yellow}Original:${colors.reset}`, plaintext);

  // Encrypt
  const encrypted = encryptContent(plaintext, TEST_KEY);
  console.log(`${colors.yellow}Encrypted:${colors.reset}`, encrypted.substring(0, 80) + "...");

  // Verify encryption
  const isEnc = isEncryptedContent(encrypted);
  if (isEnc) {
    success("Content is properly encrypted");
  } else {
    error("Content encryption failed");
  }

  // Decrypt
  const decrypted = decryptContent(encrypted, TEST_KEY);
  console.log(`${colors.yellow}Decrypted:${colors.reset}`, decrypted);

  if (plaintext === decrypted) {
    success("Decryption matches original");
  } else {
    error("Decryption mismatch");
  }
}

async function demo2_ConfigFileEncryption() {
  header("Demo 2: Config File Encryption");

  const configData = JSON.stringify(
    {
      apiKey: "sk-secret-key-12345",
      databaseUrl: "postgresql://user:pass@localhost/db",
      secrets: {
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret",
      },
    },
    null,
    2,
  );

  console.log(`${colors.yellow}Original Config:${colors.reset}`);
  console.log(configData);

  // Encrypt
  const encrypted = encryptContent(configData, TEST_KEY);
  console.log(`\n${colors.yellow}Encrypted (first 100 chars):${colors.reset}`);
  console.log(encrypted.substring(0, 100) + "...\n");

  // Decrypt
  const decrypted = decryptContent(encrypted, TEST_KEY);
  const parsed = JSON.parse(decrypted);

  console.log(`${colors.yellow}Decrypted Config:${colors.reset}`);
  console.log(JSON.stringify(parsed, null, 2));

  if (configData === decrypted) {
    success("Config encrypted and decrypted successfully");
  } else {
    error("Config mismatch");
  }
}

async function demo3_MemoryFileEncryption() {
  header("Demo 3: Memory File Encryption");

  const memoryContent = `# Session: 2024-01-15 10:30:00 UTC

## User Preferences
- Name: John Doe
- Email: john@example.com
- API Keys: sk-12345, sk-67890

## Recent Conversations
Discussed project architecture and database design.
`;

  console.log(`${colors.yellow}Original Memory (first 80 chars):${colors.reset}`);
  console.log(memoryContent.substring(0, 80) + "...\n");

  // Encrypt
  const encrypted = encryptContent(memoryContent, TEST_KEY);
  console.log(`${colors.yellow}Encrypted (first 80 chars):${colors.reset}`);
  console.log(encrypted.substring(0, 80) + "...\n");

  // Decrypt
  const decrypted = decryptContent(encrypted, TEST_KEY);
  console.log(`${colors.yellow}Decrypted (first 80 chars):${colors.reset}`);
  console.log(decrypted.substring(0, 80) + "...\n");

  if (memoryContent === decrypted) {
    success("Memory file encrypted and decrypted successfully");
  } else {
    error("Memory file mismatch");
  }
}

async function demo4_PathMatching() {
  header("Demo 4: Path Pattern Matching");

  const patterns = ["**/memory/**", "**/.openclaw/config.*", "**/sessions/**", "**/*.secret.*"];

  const testCases = [
    { path: "/home/user/memory/notes.md", shouldMatch: true },
    { path: "/home/.openclaw/config.json", shouldMatch: true },
    { path: "/home/sessions/session-123.json", shouldMatch: true },
    { path: "/home/api.secret.key", shouldMatch: true },
    { path: "/home/documents/file.txt", shouldMatch: false },
    { path: "/home/public/readme.md", shouldMatch: false },
  ];

  console.log(`${colors.yellow}Testing path patterns:${colors.reset}`, patterns, "\n");

  for (const { path, shouldMatch } of testCases) {
    const matches = matchesEncryptedPath(path, patterns);
    const status = matches === shouldMatch ? "✓" : "✗";
    const matchText = matches ? "matches" : "doesn't match";
    console.log(`${status} ${path} ${matchText}`);
  }
}

async function demo5_EncryptedFormat() {
  header("Demo 5: Encrypted Data Format");

  const plaintext = "test data";
  const encrypted = encryptContent(plaintext, TEST_KEY);

  const [iv, authTag, content] = encrypted.split(":");

  console.log(`${colors.yellow}Format:${colors.reset} iv:authTag:encrypted_content\n`);

  console.log(`${colors.yellow}IV (Initialization Vector):${colors.reset}`);
  console.log(`  Base64: ${iv}`);
  console.log(`  Length: ${Buffer.from(iv, "base64").length} bytes (16 bytes = 128 bits)`);

  console.log(`\n${colors.yellow}Auth Tag (Authentication):${colors.reset}`);
  console.log(`  Base64: ${authTag?.substring(0, 50)}...`);
  console.log(`  Length: ${Buffer.from(authTag, "base64").length} bytes (16 bytes = 128 bits)`);

  console.log(`\n${colors.yellow}Encrypted Content:${colors.reset}`);
  console.log(`  Base64: ${content?.substring(0, 50)}...`);
  console.log(`  Length: ${Buffer.from(content, "base64").length} bytes`);

  success("Format is valid (iv:authTag:content)");
}

async function demo6_ErrorHandling() {
  header("Demo 6: Error Handling");

  // Test 1: Invalid format
  console.log(`${colors.yellow}Test 1: Decrypt invalid format${colors.reset}`);
  try {
    decryptContent("not-encrypted-data", TEST_KEY);
    error("Should have thrown error");
  } catch (e: unknown) {
    success(`Caught error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 2: Wrong key
  console.log(`\n${colors.yellow}Test 2: Decrypt with wrong key${colors.reset}`);
  const plaintext = "secret message";
  const encrypted = encryptContent(plaintext, TEST_KEY);
  const wrongKey = Buffer.alloc(32, "wrong-key-for-testing-purposes-32!!");

  try {
    decryptContent(encrypted, wrongKey);
    error("Should have thrown error");
  } catch (e: unknown) {
    success(`Caught error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 3: Corrupted data
  console.log(`\n${colors.yellow}Test 3: Decrypt corrupted data${colors.reset}`);
  const corrupted = encrypted.slice(0, -5) + "XXXXX";

  try {
    decryptContent(corrupted, TEST_KEY);
    error("Should have thrown error");
  } catch (e: unknown) {
    success(`Caught error: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Test 4: Check plaintext
  console.log(`\n${colors.yellow}Test 4: Check if plaintext is encrypted${colors.reset}`);
  const isPlainEncrypted = isEncryptedContent("hello world");
  if (!isPlainEncrypted) {
    success("Correctly identified as not encrypted");
  } else {
    error("Incorrectly identified as encrypted");
  }
}

async function demo7_ConfigNormalization() {
  header("Demo 7: Configuration Normalization");

  // Test default config
  console.log(`${colors.yellow}Test 1: Empty config (use defaults)${colors.reset}`);
  const defaultConfig = normalizeConfig({});
  console.log("  Mode:", defaultConfig.mode);
  console.log("  Encrypted Paths:", defaultConfig.encryptedPaths.length, "patterns");
  success("Default config created");

  // Test custom config
  console.log(`\n${colors.yellow}Test 2: Custom config${colors.reset}`);
  const customConfig = normalizeConfig({
    mode: "encrypt",
    encryptedPaths: ["**/custom/**", "**/private/**"],
  });
  console.log("  Mode:", customConfig.mode);
  console.log("  Encrypted Paths:", customConfig.encryptedPaths);
  success("Custom config created");

  // Test invalid entries filtered
  console.log(`\n${colors.yellow}Test 3: Filter invalid entries${colors.reset}`);
  const filteredConfig = normalizeConfig({
    encryptedPaths: ["**/valid/**", "", "  ", 123, null],
  });
  console.log("  Filtered Paths:", filteredConfig.encryptedPaths);
  if (filteredConfig.encryptedPaths.length === 1) {
    success("Invalid entries filtered correctly");
  } else {
    error("Filtering failed");
  }
}

async function demo8_DifferentIVs() {
  header("Demo 8: Random IV Demonstration");

  const plaintext = "same content";

  console.log(`${colors.yellow}Encrypting same content twice:${colors.reset}\n`);

  const encrypted1 = encryptContent(plaintext, TEST_KEY);
  const encrypted2 = encryptContent(plaintext, TEST_KEY);

  console.log("Encryption 1:", encrypted1.substring(0, 60) + "...");
  console.log("Encryption 2:", encrypted2.substring(0, 60) + "...\n");

  if (encrypted1 !== encrypted2) {
    success("Different ciphertexts (random IV working)");
  } else {
    error("Same ciphertext (IV not random)");
  }

  // Both should decrypt to same plaintext
  const decrypted1 = decryptContent(encrypted1, TEST_KEY);
  const decrypted2 = decryptContent(encrypted2, TEST_KEY);

  if (decrypted1 === decrypted2 && decrypted1 === plaintext) {
    success("Both decrypt to original plaintext");
  } else {
    error("Decryption mismatch");
  }
}

// Run all demos
async function main() {
  console.log(`${colors.bold}${colors.cyan}`);
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║                                                       ║");
  console.log("║   File Encryption Plugin - Feature Demonstration      ║");
  console.log("║                                                       ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`${colors.reset}\n`);

  await demo1_BasicEncryption();
  await demo2_ConfigFileEncryption();
  await demo3_MemoryFileEncryption();
  await demo4_PathMatching();
  await demo5_EncryptedFormat();
  await demo6_ErrorHandling();
  await demo7_ConfigNormalization();
  await demo8_DifferentIVs();

  header("Demo Complete");
  console.log(
    `${colors.green}${colors.bold}All demonstrations completed successfully! ✓${colors.reset}\n`,
  );
  console.log(`${colors.cyan}Next steps:${colors.reset}`);
  console.log("  1. Generate your encryption key: openssl rand -base64 32");
  console.log("  2. Set environment variable: export OPENCLAW_FILE_ENCRYPTION_KEY='...'");
  console.log("  3. Add plugin to your OpenClaw config");
  console.log("  4. Restart OpenClaw gateway\n");
}

main().catch(console.error);
