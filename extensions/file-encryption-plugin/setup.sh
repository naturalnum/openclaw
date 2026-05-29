#!/bin/bash

# File Encryption Plugin - Setup Script
# This script helps you properly configure the encryption plugin

set -e

echo "╔═══════════════════════════════════════════════════════╗"
echo "║                                                       ║"
echo "║   File Encryption Plugin - Setup Wizard              ║"
echo "║                                                       ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# Check if already configured
if [ -n "$OPENCLAW_FILE_ENCRYPTION_KEY" ]; then
  echo "✓ Environment variable OPENCLAW_FILE_ENCRYPTION_KEY is already set"
  echo "  Key (first 20 chars): ${OPENCLAW_FILE_ENCRYPTION_KEY:0:20}..."
  echo ""
  read -p "Do you want to regenerate the key? (y/N): " REGEN
  if [[ ! "$REGEN" =~ ^[Yy]$ ]]; then
    echo "✓ Keeping existing key"
    echo ""
    echo "Next steps:"
    echo "  1. Ensure plugin is enabled in your OpenClaw config"
    echo "  2. Restart OpenClaw gateway"
    echo "  3. Check logs: openclaw logs | grep file-encryption-plugin"
    exit 0
  fi
fi

# Step 1: Generate key
echo "Step 1: Generating encryption key..."
NEW_KEY=$(openssl rand -base64 32)
echo "✓ Generated 32-byte AES-256 key"
echo ""
echo "═══════════════════════════════════════════════════════"
echo "  YOUR ENCRYPTION KEY (SAVE THIS SECURELY!):"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  $NEW_KEY"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""

# Step 2: Choose setup method
echo "Step 2: Choose setup method:"
echo "  1) Set as environment variable (recommended)"
echo "  2) Add to OpenClaw config file"
echo "  3) Just show me the commands, I'll do it manually"
echo ""
read -p "Choose option (1/2/3): " OPTION

case $OPTION in
  1)
    echo ""
    echo "Step 3: Setting environment variable..."
    
    # Detect shell
    if [[ "$SHELL" == *"zsh" ]]; then
      SHELL_CONFIG="$HOME/.zshrc"
      echo "  Detected zsh, using $SHELL_CONFIG"
    elif [[ "$SHELL" == *"bash" ]]; then
      SHELL_CONFIG="$HOME/.bashrc"
      echo "  Detected bash, using $SHELL_CONFIG"
    else
      SHELL_CONFIG="$HOME/.profile"
      echo "  Using $SHELL_CONFIG"
    fi
    
    # Add to shell config
    echo "" >> "$SHELL_CONFIG"
    echo "# File Encryption Plugin - AES-256 Key" >> "$SHELL_CONFIG"
    echo "export OPENCLAW_FILE_ENCRYPTION_KEY=\"$NEW_KEY\"" >> "$SHELL_CONFIG"
    
    echo "✓ Added to $SHELL_CONFIG"
    echo ""
    
    # Set for current session
    export OPENCLAW_FILE_ENCRYPTION_KEY="$NEW_KEY"
    echo "✓ Set for current session"
    echo ""
    
    echo "═══════════════════════════════════════════════════════"
    echo "  IMPORTANT: Save this key in a password manager!"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    echo "  $NEW_KEY"
    echo ""
    ;;
    
  2)
    echo ""
    echo "Step 3: Adding to OpenClaw config..."
    
    CONFIG_FILE="$HOME/.openclaw/config.json"
    
    # Check if config exists
    if [ ! -f "$CONFIG_FILE" ]; then
      echo "✗ Config file not found at $CONFIG_FILE"
      echo "  Please create it first or use option 1"
      exit 1
    fi
    
    # Create backup
    cp "$CONFIG_FILE" "${CONFIG_FILE}.backup"
    echo "✓ Created backup: ${CONFIG_FILE}.backup"
    
    # Add encryption key to config using node (safe JSON manipulation)
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
      
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.entries) config.plugins.entries = {};
      if (!config.plugins.entries['file-encryption-plugin']) {
        config.plugins.entries['file-encryption-plugin'] = { enabled: true, config: {} };
      }
      if (!config.plugins.entries['file-encryption-plugin'].config) {
        config.plugins.entries['file-encryption-plugin'].config = {};
      }
      
      config.plugins.entries['file-encryption-plugin'].config.encryptionKey = '$NEW_KEY';
      config.plugins.entries['file-encryption-plugin'].config.mode = 'both';
      config.plugins.entries['file-encryption-plugin'].config.encryptedPaths = [
        '**/memory/**',
        '**/.openclaw/config.*',
        '**/sessions/**'
      ];
      config.plugins.entries['file-encryption-plugin'].enabled = true;
      
      fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
    "
    
    echo "✓ Added encryption key to $CONFIG_FILE"
    echo ""
    echo "⚠️  Security warning:"
    echo "  - Your encryption key is now in the config file"
    echo "  - Set file permissions: chmod 600 $CONFIG_FILE"
    echo "  - Do NOT commit this file to Git"
    echo ""
    
    # Set secure permissions
    chmod 600 "$CONFIG_FILE"
    echo "✓ Set secure permissions (600) on config file"
    echo ""
    ;;
    
  3)
    echo ""
    echo "═══════════════════════════════════════════════════════"
    echo "  Manual Setup Instructions"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    echo "Option A: Environment Variable (Recommended)"
    echo "───────────────────────────────────────────────────────"
    echo ""
    echo "  # Add to your shell config (~/.zshrc or ~/.bashrc):"
    echo "  export OPENCLAW_FILE_ENCRYPTION_KEY=\"$NEW_KEY\""
    echo ""
    echo "  # Then reload:"
    echo "  source ~/.zshrc  # or source ~/.bashrc"
    echo ""
    echo ""
    echo "Option B: Config File"
    echo "───────────────────────────────────────────────────────"
    echo ""
    echo "  Add to ~/.openclaw/config.json:"
    echo ""
    echo '  {'
    echo '    "plugins": {'
    echo '      "entries": {'
    echo '        "file-encryption-plugin": {'
    echo '          "enabled": true,'
    echo '          "config": {'
    echo "            \"encryptionKey\": \"$NEW_KEY\","
    echo '            "mode": "both",'
    echo '            "encryptedPaths": ['
    echo '              "**/memory/**",'
    echo '              "**/.openclaw/config.*",'
    echo '              "**/sessions/**"'
    echo '            ]'
    echo '          }'
    echo '        }'
    echo '      }'
    echo '    }'
    echo '  }'
    echo ""
    ;;
    
  *)
    echo "✗ Invalid option"
    exit 1
    ;;
esac

# Step 4: Verify setup
echo "═══════════════════════════════════════════════════════"
echo "  Step 4: Verification"
echo "═══════════════════════════════════════════════════════"
echo ""

# Test encryption/decryption
node -e "
const crypto = require('crypto');
const key = Buffer.from('$NEW_KEY', 'base64');
const plaintext = 'test message';

const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(plaintext, 'utf8', 'base64');
encrypted += cipher.final('base64');
const authTag = cipher.getAuthTag();

const parts = [iv.toString('base64'), authTag.toString('base64'), encrypted];
const encryptedData = parts.join(':');

const [iv2, authTag2, content] = encryptedData.split(':');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv2, 'base64'));
decipher.setAuthTag(Buffer.from(authTag2, 'base64'));
let decrypted = decipher.update(content, 'base64', 'utf8');
decrypted += decipher.final('utf8');

if (plaintext === decrypted) {
  console.log('✓ Encryption/decryption test PASSED');
  process.exit(0);
} else {
  console.log('✗ Encryption/decryption test FAILED');
  process.exit(1);
}
"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. ✓ Encryption key generated and configured"
echo "  2. Restart OpenClaw gateway:"
echo "     pkill -9 -f openclaw-gateway || true"
echo "     openclaw gateway run --bind loopback --port 18789"
echo ""
echo "  3. Verify plugin loaded:"
echo "     openclaw logs | grep file-encryption-plugin"
echo ""
echo "  4. Expected output:"
echo "     [file-encryption-plugin] Initialized with mode=both, encryptedPaths=[...]"
echo ""
echo "📚 Documentation:"
echo "   - Quick reference: extensions/file-encryption-plugin/README.md"
echo "   - Full guide: extensions/file-encryption-plugin/INTEGRATION-GUIDE.md"
echo ""
