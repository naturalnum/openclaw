#!/bin/bash

# File Encryption Plugin - Quick Start Script
# This script helps you set up and test the file encryption plugin

set -e

echo "======================================"
echo "File Encryption Plugin - Quick Start"
echo "======================================"
echo ""

# Step 1: Generate encryption key
echo "Step 1: Generating encryption key..."
ENCRYPTION_KEY=$(openssl rand -base64 32)
echo "✓ Generated 32-byte AES-256 key"
echo ""
echo "Your encryption key (save this securely!):"
echo "$ENCRYPTION_KEY"
echo ""

# Step 2: Create test config
echo "Step 2: Creating test configuration..."
cat > /tmp/test-encryption-config.json << EOF
{
  "plugins": {
    "entries": {
      "file-encryption-plugin": {
        "enabled": true,
        "config": {
          "mode": "both",
          "encryptedPaths": [
            "**/memory/**",
            "**/.openclaw/config.*",
            "**/sessions/**"
          ]
        }
      }
    }
  }
}
EOF
echo "✓ Created test config at /tmp/test-encryption-config.json"
echo ""

# Step 3: Show example usage
echo "Step 3: Example environment setup..."
echo ""
echo "Add this to your .env or shell profile:"
echo "  export OPENCLAW_FILE_ENCRYPTION_KEY=\"$ENCRYPTION_KEY\""
echo ""

# Step 4: Test encryption/decryption
echo "Step 4: Testing encryption/decryption..."
TEST_FILE="/tmp/test-encryption-verify.txt"
echo "This is a test message with sensitive data" > "$TEST_FILE"

# Use Node.js to test encryption
node -e "
const crypto = require('crypto');

const key = Buffer.from('$ENCRYPTION_KEY', 'base64');
const plaintext = '$(cat $TEST_FILE)';

// Encrypt
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(plaintext, 'utf8', 'base64');
encrypted += cipher.final('base64');
const authTag = cipher.getAuthTag();

const encryptedData = iv.toString('base64') + ':' + authTag.toString('base64') + ':' + encrypted;

// Decrypt
const parts = encryptedData.split(':');
const iv2 = Buffer.from(parts[0], 'base64');
const authTag2 = Buffer.from(parts[1], 'base64');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv2);
decipher.setAuthTag(authTag2);
let decrypted = decipher.update(parts[2], 'base64', 'utf8');
decrypted += decipher.final('utf8');

console.log('Original:  ' + plaintext.trim());
console.log('Decrypted: ' + decrypted.trim());
console.log('Match: ' + (plaintext.trim() === decrypted.trim() ? '✓ YES' : '✗ NO'));
"

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Save your encryption key securely"
echo "2. Add the plugin config to your OpenClaw config"
echo "3. Set OPENCLAW_FILE_ENCRYPTION_KEY environment variable"
echo "4. Restart OpenClaw gateway"
echo ""
echo "Documentation: extensions/file-encryption-plugin/file-encryption-plugin.md"
echo ""

# Cleanup
rm -f "$TEST_FILE"
