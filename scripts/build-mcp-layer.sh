#!/bin/bash
set -euo pipefail

# Build GitHub MCP Server Lambda Layer
# Downloads the official Go binary from GitHub releases and packages it
# for use as an AWS Lambda Layer.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LAYER_DIR="${PROJECT_ROOT}/backend/layers/github-mcp-layer"
BIN_DIR="${LAYER_DIR}/bin"

# Architecture: x86_64 for Lambda (change to arm64 for Graviton)
ARCH="${1:-x86_64}"
OS="Linux"

echo "=== Building GitHub MCP Server Lambda Layer ==="
echo "Architecture: ${OS}/${ARCH}"

# Clean and create
rm -rf "${BIN_DIR}"
mkdir -p "${BIN_DIR}"

# Find latest release
echo "Fetching latest release info..."
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/github/github-mcp-server/releases/latest | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
for asset in data.get('assets', []):
    name = asset['name']
    if '${OS}' in name and '${ARCH}' in name and name.endswith('.tar.gz'):
        print(asset['browser_download_url'])
        break
")

if [ -z "$DOWNLOAD_URL" ]; then
  echo "ERROR: Could not find download URL for ${OS}/${ARCH}"
  exit 1
fi

VERSION=$(curl -s https://api.github.com/repos/github/github-mcp-server/releases/latest | python3 -c "import sys, json; print(json.load(sys.stdin)['tag_name'])")
echo "Latest version: ${VERSION}"
echo "Downloading from: ${DOWNLOAD_URL}"

# Download and extract
curl -sL "${DOWNLOAD_URL}" -o /tmp/github-mcp-server.tar.gz
tar -xzf /tmp/github-mcp-server.tar.gz -C "${BIN_DIR}"
rm -f /tmp/github-mcp-server.tar.gz

# Ensure the binary is executable
chmod +x "${BIN_DIR}/github-mcp-server"

# Verify
BINARY_SIZE=$(du -sh "${BIN_DIR}/github-mcp-server" | cut -f1)
echo ""
echo "=== Layer Ready ==="
echo "Binary: ${BIN_DIR}/github-mcp-server"
echo "Size: ${BINARY_SIZE}"
echo "Version: ${VERSION}"
echo "Layer path: ${LAYER_DIR}"
echo ""
echo "The binary will be available at /opt/bin/github-mcp-server in Lambda."
