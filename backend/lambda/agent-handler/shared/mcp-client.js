"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMcpTools = getMcpTools;
exports.closeMcpClient = closeMcpClient;

const { MultiServerMCPClient } = require("@langchain/mcp-adapters");

// Module-scope cache — persists across warm Lambda invocations
let cachedClient = null;
let cachedTools = null;

/**
 * Initialize the GitHub MCP client and return LangChain-compatible tools.
 * Uses stdio transport to communicate with the Go binary in the Lambda Layer.
 * Cached across warm invocations for fast reuse.
 */
async function getMcpTools() {
    if (cachedTools) {
        console.log('[MCP] Returning cached tools');
        return cachedTools;
    }

    console.log('[MCP] Initializing GitHub MCP client via stdio...');
    const startTime = Date.now();

    const client = new MultiServerMCPClient({
        mcpServers: {
            github: {
                transport: "stdio",
                command: "/opt/bin/github-mcp-server",
                args: ["stdio"],
                env: {
                    GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || '',
                    GITHUB_TOOLSETS: "issues,pull_requests,repos",
                },
            },
        },
    });

    const tools = await client.getTools();
    const elapsed = Date.now() - startTime;
    console.log(`[MCP] Initialized in ${elapsed}ms — ${tools.length} tools available`);
    console.log(`[MCP] Tool names: ${tools.map(t => t.name).join(', ')}`);

    cachedClient = client;
    cachedTools = tools;
    return tools;
}

/**
 * Find a specific MCP tool by name from the cached tools array.
 * Throws if tool not found (indicates misconfiguration).
 */
async function findMcpTool(toolName) {
    const tools = await getMcpTools();
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
        const available = tools.map(t => t.name).join(', ');
        throw new Error(`MCP tool "${toolName}" not found. Available: ${available}`);
    }
    return tool;
}
exports.findMcpTool = findMcpTool;

/**
 * Close the MCP client and clear cache.
 * Called on Lambda shutdown or when explicitly needed.
 */
async function closeMcpClient() {
    if (cachedClient) {
        try {
            await cachedClient.close();
            console.log('[MCP] Client closed');
        } catch (err) {
            console.warn('[MCP] Error closing client:', err);
        }
        cachedClient = null;
        cachedTools = null;
    }
}
