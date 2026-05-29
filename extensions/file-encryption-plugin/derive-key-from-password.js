#!/usr/bin/env node

/**
 * Password to Encryption Key Deriver
 *
 * This tool derives a secure 32-byte encryption key from a memorable password
 * using PBKDF2 with high iteration count.
 *
 * Usage:
 *   node derive-key.js
 *   node derive-key.js "your-memorable-password"
 */

const crypto = require("crypto");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function deriveKeyFromPassword(password, salt = "openclaw-file-encryption") {
  // PBKDF2 with 100,000 iterations
  const key = crypto.pbkdf2Sync(
    password,
    salt,
    100000,
    32, // 32 bytes = 256 bits
    "sha256",
  );

  return key.toString("base64");
}

function _generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║                                                       ║");
  console.log("║   Password to Encryption Key Deriver                 ║");
  console.log("║                                                       ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log("");
  console.log("This tool converts a memorable password into a secure");
  console.log("32-byte encryption key using PBKDF2 (100,000 iterations).");
  console.log("");

  // Get password
  let password = process.argv[2];

  if (!password) {
    password = await new Promise((resolve) => {
      rl.question("Enter your memorable password: ", (answer) => {
        resolve(answer);
      });
    });
  }

  if (!password || password.length < 8) {
    console.log("");
    console.log("✗ Password too short! Minimum 8 characters.");
    console.log("");
    console.log("Suggestions for memorable strong passwords:");
    console.log("  - correct-horse-battery-staple-elephant");
    console.log("  - quantum-dancing-purple-galaxy-thunder");
    console.log("  - crystal-mountain-whispering-ocean-breeze");
    console.log("");
    rl.close();
    return;
  }

  // Derive key
  const derivedKey = deriveKeyFromPassword(password);

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Your Derived Encryption Key:");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");
  console.log(`  ${derivedKey}`);
  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");

  // Show how to use it
  console.log("How to use this key:");
  console.log("");
  console.log("Option 1: Set as environment variable");
  console.log("───────────────────────────────────────────────────────");
  console.log(`  export OPENCLAW_FILE_ENCRYPTION_KEY="${derivedKey}"`);
  console.log("");
  console.log("  Add to ~/.zshrc or ~/.bashrc for persistence");
  console.log("");
  console.log("");
  console.log("Option 2: Use in config file");
  console.log("───────────────────────────────────────────────────────");
  console.log("  {");
  console.log('    "plugins": {');
  console.log('      "entries": {');
  console.log('        "file-encryption-plugin": {');
  console.log('          "enabled": true,');
  console.log('          "config": {');
  console.log(`            "encryptionKey": "${derivedKey}"`);
  console.log("          }");
  console.log("        }");
  console.log("      }");
  console.log("    }");
  console.log("  }");
  console.log("");
  console.log("");

  // Security info
  console.log("Security Information:");
  console.log("───────────────────────────────────────────────────────");
  console.log("  Algorithm:    PBKDF2-HMAC-SHA256");
  console.log("  Iterations:   100,000");
  console.log("  Key length:   32 bytes (256 bits)");
  console.log('  Salt:         Default ("openclaw-file-encryption")');
  console.log("");
  console.log("  ⚠️  Remember: You need the SAME password to derive");
  console.log("     the SAME key. If you forget the password,");
  console.log("     you cannot recover encrypted data!");
  console.log("");

  // Save option
  console.log("Save this information securely:");
  console.log("  1. Password manager (recommended)");
  console.log("  2. Printed and stored in safe");
  console.log("  3. Encrypted USB drive");
  console.log("");

  // Test the key
  console.log("Testing derived key...");
  const keyBuffer = Buffer.from(derivedKey, "base64");

  if (keyBuffer.length === 32) {
    console.log("✓ Key length is correct (32 bytes)");

    // Test encryption/decryption
    const testPlaintext = "test message";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);
    let encrypted = cipher.update(testPlaintext, "utf8", "base64");
    encrypted += cipher.final("base64");
    const authTag = cipher.getAuthTag();

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");

    if (decrypted === testPlaintext) {
      console.log("✓ Encryption/decryption test passed");
      console.log("");
      console.log("✓ Key is ready to use!");
    } else {
      console.log("✗ Encryption/decryption test failed");
    }
  } else {
    console.log(`✗ Key length incorrect: ${keyBuffer.length} bytes (expected 32)`);
  }

  console.log("");
  rl.close();
}

main().catch(console.error);
