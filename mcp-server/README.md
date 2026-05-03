# Perseverance Writer Agent — MCP Server

AI-powered documentation improver. Developers trigger it from their IDE via MCP. Lensy scans → Claude rewrites → GitHub PR created.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
# Fill in: LENSY_API_URL, GITHUB_TOKEN, AWS_REGION, AWS credentials
```

## IDE Configuration

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "perseverance-writer": {
      "command": "node",
      "args": ["<absolute-path-to>/mcp-server/dist/index.js"],
      "env": {
        "LENSY_API_URL": "https://api.perseveranceai.com",
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "<your-key>",
        "AWS_SECRET_ACCESS_KEY": "<your-secret>"
      }
    }
  }
}
```

### Cline (`~/.cline/mcp_settings.json`)

```json
{
  "mcpServers": {
    "perseverance-writer": {
      "command": "node",
      "args": ["<absolute-path-to>/mcp-server/dist/index.js"],
      "env": {
        "LENSY_API_URL": "https://api.perseveranceai.com",
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "<your-key>",
        "AWS_SECRET_ACCESS_KEY": "<your-secret>"
      }
    }
  }
}
```

### Windsurf / VS Code (`.vscode/mcp.json` in project root)

```json
{
  "servers": {
    "perseverance-writer": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute-path-to>/mcp-server/dist/index.js"],
      "env": {
        "LENSY_API_URL": "https://api.perseveranceai.com",
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "<your-key>",
        "AWS_SECRET_ACCESS_KEY": "<your-secret>"
      }
    }
  }
}
```

### Kiro (`.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "perseverance-writer": {
      "command": "node",
      "args": ["<absolute-path-to>/mcp-server/dist/index.js"],
      "env": {
        "LENSY_API_URL": "https://api.perseveranceai.com",
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
        "AWS_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "<your-key>",
        "AWS_SECRET_ACCESS_KEY": "<your-secret>"
      }
    }
  }
}
```

## Tools

| Tool | What it does | Calls |
|------|-------------|-------|
| `analyze_doc` | Scan a doc page for AI-readiness issues | Lensy HTTP API |
| `improve_doc` | Rewrite a local .md file to fix gaps | Claude Sonnet via Bedrock |
| `create_pr` | Create a GitHub PR with improved content | GitHub API (Octokit) |

## Testing

```bash
# Test with MCP Inspector (no IDE needed)
npx @modelcontextprotocol/inspector node dist/index.js
```

## Demo Flow

1. Open IDE with a docs repo
2. Ask coding agent: "Analyze the SDK guide at https://directus.io/docs/guides/connect/sdk and create a PR with AI-readiness improvements"
3. Agent calls `analyze_doc` → Lensy scans (30-90s)
4. Agent calls `improve_doc` → Claude rewrites
5. Agent calls `create_pr` → PR on GitHub
6. Review the diff

## Architecture

```
IDE ←→ stdio ←→ MCP Server (this package)
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   Lensy HTTP    Bedrock Claude   GitHub API
   (scan)        (rewrite)        (PR)
```

Zero imports from `backend/`. Lensy communication is HTTP only.
