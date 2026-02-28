"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDocsContextTool = void 0;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const { findMcpTool } = require("../shared/mcp-client");

/**
 * Tool: Fetch Docs Context
 * Uses MCP get_file_contents and list_directory to fetch documentation from a GitHub repo.
 * Replaces: github-issues-analyzer fetchDocsContext() (lines 335-450) +
 *           discoverDocsRepos() (lines 728-855) + fetchDocsFromGitHubRepo() (lines 857-904)
 */
exports.fetchDocsContextTool = (0, tools_1.tool)(async (input) => {
    console.log(`[fetch_docs_context] Fetching docs from ${input.owner}/${input.repo}${input.docsUrl ? ` + ${input.docsUrl}` : ''}`);

    const docs = [];
    const docsFound = [];

    try {
        const getFileTool = await findMcpTool('get_file_contents');

        // 1. Fetch README.md
        try {
            const readmeResult = await getFileTool.invoke({
                owner: input.owner,
                repo: input.repo,
                path: 'README.md'
            });
            const readme = typeof readmeResult === 'string' ? readmeResult : JSON.stringify(readmeResult);
            if (readme && readme.length > 100) {
                docs.push({ path: 'README.md', content: readme.substring(0, 20000) });
                docsFound.push('README.md');
                console.log(`  README.md: ${readme.length} chars`);
            }
        } catch { console.log('  No README.md found'); }

        // 2. Check for docs/ directory
        try {
            const listDirTool = await findMcpTool('list_directory');
            const dirResult = await listDirTool.invoke({
                owner: input.owner,
                repo: input.repo,
                path: 'docs'
            });
            const dirItems = typeof dirResult === 'string' ? JSON.parse(dirResult) : dirResult;
            const mdFiles = (Array.isArray(dirItems) ? dirItems : dirItems?.entries || [])
                .filter(item => {
                    const name = item.name || item.path || '';
                    return name.endsWith('.md') || name.endsWith('.mdx');
                })
                .slice(0, 15);

            if (mdFiles.length > 0) {
                docsFound.push('docs/');
                for (const file of mdFiles) {
                    try {
                        const filePath = file.path || `docs/${file.name}`;
                        const content = await getFileTool.invoke({
                            owner: input.owner,
                            repo: input.repo,
                            path: filePath
                        });
                        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                        if (contentStr && contentStr.length > 50) {
                            docs.push({ path: filePath, content: contentStr.substring(0, 15000) });
                            console.log(`  ${filePath}: ${contentStr.length} chars`);
                        }
                    } catch { /* skip individual file errors */ }
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        } catch { console.log('  No docs/ directory'); }

        // 3. Fetch CONTRIBUTING.md, CHANGELOG.md
        for (const filename of ['CONTRIBUTING.md', 'CHANGELOG.md']) {
            try {
                const content = await getFileTool.invoke({
                    owner: input.owner,
                    repo: input.repo,
                    path: filename
                });
                const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                if (contentStr && contentStr.length > 100) {
                    docs.push({ path: filename, content: contentStr.substring(0, 10000) });
                    docsFound.push(filename);
                    console.log(`  ${filename}: ${contentStr.length} chars`);
                }
            } catch { /* skip */ }
        }

        // 4. If a separate docs repo URL was provided, fetch from it too
        if (input.docsUrl) {
            const docsMatch = input.docsUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (docsMatch) {
                const [, docsOwner, docsRepo] = docsMatch;
                console.log(`  Fetching from docs repo: ${docsOwner}/${docsRepo}`);
                await fetchFromDocsRepo(getFileTool, docsOwner, docsRepo, docs);
            }
        }

        // 5. Auto-discover docs repos under same owner
        let suggestedDocsRepos = [];
        if (!input.docsUrl) {
            suggestedDocsRepos = await discoverDocsRepos(input.owner, input.repo);
        }

        const hasSubstantialDocs = docsFound.length > 0 && docsFound.some(d => d !== 'README.md' || docsFound.length > 1);

        const result = {
            success: true,
            docs,
            docsFound,
            hasSubstantialDocs,
            totalFiles: docs.length,
            totalChars: docs.reduce((sum, d) => sum + d.content.length, 0),
            suggestedDocsRepos
        };

        console.log(`[fetch_docs_context] ${docs.length} files, ${result.totalChars} chars`);
        return JSON.stringify(result);

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[fetch_docs_context] Error: ${msg}`);
        return JSON.stringify({ success: false, error: msg, docs: [], docsFound: [] });
    }
}, {
    name: 'fetch_docs_context',
    description: 'Fetches documentation files (README, docs/, CONTRIBUTING, CHANGELOG) from a GitHub repo using MCP. Optionally fetches from a separate docs repo URL. Also discovers related docs repos under the same owner.',
    schema: zod_1.z.object({
        owner: zod_1.z.string().describe('GitHub repository owner'),
        repo: zod_1.z.string().describe('GitHub repository name'),
        docsUrl: zod_1.z.string().optional().describe('Optional URL to a separate docs GitHub repo (e.g., "https://github.com/owner/docs-repo")'),
        sessionId: zod_1.z.string().describe('The analysis session ID')
    })
});

/**
 * Fetch markdown files from a separate docs repo.
 * Ported from: fetchDocsFromGitHubRepo() (lines 857-904)
 */
async function fetchFromDocsRepo(getFileTool, owner, repo, docs) {
    try {
        const listDirTool = await findMcpTool('list_directory');

        // Root-level MD files
        const rootResult = await listDirTool.invoke({ owner, repo, path: '' });
        const rootItems = typeof rootResult === 'string' ? JSON.parse(rootResult) : rootResult;
        const entries = Array.isArray(rootItems) ? rootItems : rootItems?.entries || [];

        const mdFiles = entries.filter(item => {
            const name = item.name || item.path || '';
            return name.endsWith('.md') || name.endsWith('.mdx');
        }).slice(0, 15);

        for (const file of mdFiles) {
            try {
                const filePath = file.path || file.name;
                const content = await getFileTool.invoke({ owner, repo, path: filePath });
                const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                if (contentStr && contentStr.length > 50) {
                    docs.push({ path: `${owner}/${repo}/${filePath}`, content: contentStr.substring(0, 20000) });
                }
            } catch { /* skip */ }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Check subdirectories
        const subDirs = entries.filter(item => {
            const name = (item.name || item.path || '').toLowerCase();
            return item.type === 'dir' && ['docs', 'content', 'pages', 'src'].includes(name);
        });

        for (const dir of subDirs) {
            try {
                const dirPath = dir.path || dir.name;
                const dirResult = await listDirTool.invoke({ owner, repo, path: dirPath });
                const dirItems = typeof dirResult === 'string' ? JSON.parse(dirResult) : dirResult;
                const dirEntries = Array.isArray(dirItems) ? dirItems : dirItems?.entries || [];

                const subMdFiles = dirEntries.filter(item => {
                    const name = item.name || item.path || '';
                    return name.endsWith('.md') || name.endsWith('.mdx');
                }).slice(0, 10);

                for (const file of subMdFiles) {
                    try {
                        const filePath = file.path || `${dirPath}/${file.name}`;
                        const content = await getFileTool.invoke({ owner, repo, path: filePath });
                        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                        if (contentStr && contentStr.length > 50) {
                            docs.push({ path: `${owner}/${repo}/${filePath}`, content: contentStr.substring(0, 15000) });
                        }
                    } catch { /* skip */ }
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            } catch { /* skip directory */ }
        }

        console.log(`  Docs repo ${owner}/${repo}: ${docs.length} files total`);
    } catch (err) {
        console.log(`  Error fetching from docs repo ${owner}/${repo}: ${err}`);
    }
}

/**
 * Discover documentation repos under the same GitHub owner.
 * Ported from: discoverDocsRepos() (lines 728-855)
 * Uses MCP search_repositories to find candidates.
 */
async function discoverDocsRepos(owner, currentRepo) {
    try {
        const searchTool = await findMcpTool('search_repositories');
        const query = `user:${owner} docs OR documentation OR devsite OR wiki in:name,description`;

        const result = await searchTool.invoke({ query });
        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        const repos = parsed.items || parsed || [];

        const namePatterns = [
            /\bdocs\b/i, /\bdocumentation\b/i, /\bdoc[-_]site\b/i,
            /dev[-_]?site\b/i, /dev[-_]?portal\b/i, /\bguide\b/i, /\bwiki\b/i,
        ];

        const candidates = (Array.isArray(repos) ? repos : [])
            .filter(r => {
                if (r.name === currentRepo) return false;
                const name = r.name || '';
                return namePatterns.some(re => re.test(name));
            })
            .slice(0, 5)
            .map(r => ({
                name: r.name,
                fullName: r.full_name,
                description: r.description || '',
                hasDocsContent: true, // Simplified — full verification happens in analyze phase
                contentFileCount: -1,
                codeFileCount: -1,
                hasLlmsTxt: false
            }));

        console.log(`  Discovered ${candidates.length} potential docs repos for ${owner}`);
        return candidates;
    } catch (err) {
        console.log(`  Could not discover docs repos for ${owner}: ${err}`);
        return [];
    }
}
