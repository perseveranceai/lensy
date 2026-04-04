/**
 * GitHub Issues → Docs Gap Analyzer Prototype
 *
 * Flow:
 * 1. Takes a GitHub repo URL (e.g., resend/react-email)
 * 2. Fetches open issues via GitHub API
 * 3. Fetches repo docs context (README, SKILL.md, /docs folder)
 * 4. For each issue, analyzes whether it reveals a documentation gap
 * 5. Outputs: issue → docs gap → suggested fix
 *
 * Usage: npx ts-node fetch-github-issues.ts resend/react-email
 */

import https from 'https';
import { URL } from 'url';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitHubIssue {
    number: number;
    title: string;
    body: string;
    html_url: string;
    labels: Array<{ name: string }>;
    created_at: string;
    comments: number;
    reactions: { total_count: number };
    state: string;
}

interface RepoDoc {
    path: string;
    content: string;
    source: 'github' | 'docs-site';
}

interface DocsGapAnalysis {
    issue: GitHubIssue;
    isDocsGap: boolean;
    confidence: number; // 0-100
    gapType: 'missing-content' | 'inaccurate-content' | 'unclear-content' | 'outdated-content' | 'not-a-docs-gap';
    affectedDocs: string[]; // which doc files are affected
    summary: string;
    suggestedFix: string;
}

// ─── GitHub API Helpers ──────────────────────────────────────────────────────

function makeRequest(url: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Lensy-GitHub-Issues-Analyzer/1.0',
                'Accept': 'application/vnd.github.v3+json',
                ...headers
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.end();
    });
}

async function fetchGitHubIssues(owner: string, repo: string, options: {
    maxIssues?: number;
    labels?: string;
    state?: 'open' | 'closed' | 'all';
    sort?: 'created' | 'updated' | 'comments';
} = {}): Promise<GitHubIssue[]> {
    const { maxIssues = 30, state = 'open', sort = 'updated' } = options;

    const perPage = Math.min(maxIssues, 100);
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&sort=${sort}&direction=desc&per_page=${perPage}`;

    console.log(`📋 Fetching issues from ${owner}/${repo}...`);
    const response = await makeRequest(url);
    const issues: GitHubIssue[] = JSON.parse(response);

    // Filter out pull requests (GitHub API returns PRs as issues too)
    const realIssues = issues.filter(issue => !('pull_request' in issue));

    console.log(`   Found ${realIssues.length} open issues (filtered ${issues.length - realIssues.length} PRs)`);
    return realIssues;
}

async function fetchRepoFile(owner: string, repo: string, path: string): Promise<string | null> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const response = await makeRequest(url);
        const data = JSON.parse(response);

        if (data.content && data.encoding === 'base64') {
            return Buffer.from(data.content, 'base64').toString('utf-8');
        }
        return null;
    } catch (error) {
        return null; // File doesn't exist
    }
}

async function fetchRepoTree(owner: string, repo: string, path: string = ''): Promise<Array<{ path: string; type: string }>> {
    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const response = await makeRequest(url);
        const items = JSON.parse(response);

        if (Array.isArray(items)) {
            return items.map((item: any) => ({ path: item.path, type: item.type }));
        }
        return [];
    } catch {
        return [];
    }
}

// ─── Docs Context Fetcher ────────────────────────────────────────────────────

async function fetchRepoDocsContext(owner: string, repo: string): Promise<RepoDoc[]> {
    const docs: RepoDoc[] = [];

    console.log(`📚 Fetching documentation context from ${owner}/${repo}...`);

    // 1. README
    const readme = await fetchRepoFile(owner, repo, 'README.md');
    if (readme) {
        docs.push({ path: 'README.md', content: readme, source: 'github' });
        console.log(`   ✓ README.md (${readme.length} chars)`);
    }

    // 2. Check for common docs locations
    const docPaths = [
        'SKILL.md',
        'docs',
        'skills',
        'documentation',
        'CONTRIBUTING.md',
        'CHANGELOG.md'
    ];

    for (const docPath of docPaths) {
        const tree = await fetchRepoTree(owner, repo, docPath);
        if (tree.length > 0) {
            // It's a directory — fetch markdown files inside
            for (const item of tree) {
                if (item.type === 'file' && (item.path.endsWith('.md') || item.path.endsWith('.mdx'))) {
                    const content = await fetchRepoFile(owner, repo, item.path);
                    if (content) {
                        docs.push({ path: item.path, content, source: 'github' });
                        console.log(`   ✓ ${item.path} (${content.length} chars)`);
                    }
                }
                // Check subdirectories one level deep
                if (item.type === 'dir') {
                    const subTree = await fetchRepoTree(owner, repo, item.path);
                    for (const subItem of subTree) {
                        if (subItem.type === 'file' && (subItem.path.endsWith('.md') || subItem.path.endsWith('.mdx'))) {
                            const content = await fetchRepoFile(owner, repo, subItem.path);
                            if (content) {
                                docs.push({ path: subItem.path, content, source: 'github' });
                                console.log(`   ✓ ${subItem.path} (${content.length} chars)`);
                            }
                        }
                    }
                }
            }
        } else {
            // Maybe it's a file, not a directory
            const content = await fetchRepoFile(owner, repo, docPath);
            if (content) {
                docs.push({ path: docPath, content, source: 'github' });
                console.log(`   ✓ ${docPath} (${content.length} chars)`);
            }
        }
    }

    // 3. Check package.json for docs site URL
    const packageJson = await fetchRepoFile(owner, repo, 'package.json');
    if (packageJson) {
        try {
            const pkg = JSON.parse(packageJson);
            if (pkg.homepage) {
                console.log(`   📎 Found docs site: ${pkg.homepage}`);
            }
        } catch {}
    }

    console.log(`   📚 Total docs fetched: ${docs.length} files, ${docs.reduce((sum, d) => sum + d.content.length, 0)} chars`);
    return docs;
}

// ─── Issue Analysis (Local — no LLM needed for basic classification) ─────────

function classifyIssueLocally(issue: GitHubIssue, docs: RepoDoc[]): {
    likelyDocsRelated: boolean;
    relevantDocs: string[];
    keywords: string[];
} {
    const titleLower = issue.title.toLowerCase();
    const bodyLower = (issue.body || '').toLowerCase();
    const combined = `${titleLower} ${bodyLower}`;

    // Docs-related signal words
    const docsSignals = [
        'documentation', 'docs', 'readme', 'guide', 'tutorial', 'example',
        'unclear', 'confusing', 'misleading', 'incorrect', 'wrong', 'inaccurate',
        'outdated', 'missing', 'how to', 'how do i', 'skill.md', 'skill',
        'not documented', 'undocumented', 'typo', 'broken link'
    ];

    const matchedSignals = docsSignals.filter(signal => combined.includes(signal));

    // Check labels
    const docsLabels = ['documentation', 'docs', 'bug', 'type: bug', 'good first issue'];
    const hasDocsLabel = issue.labels.some(l => docsLabels.includes(l.name.toLowerCase()));

    // Find which docs files might be related
    const relevantDocs = docs
        .filter(doc => {
            const docLower = doc.content.toLowerCase();
            // Check if any significant words from the issue appear in the doc
            const issueWords = combined.split(/\s+/).filter(w => w.length > 4);
            const matchCount = issueWords.filter(w => docLower.includes(w)).length;
            return matchCount > 3;
        })
        .map(d => d.path);

    return {
        likelyDocsRelated: matchedSignals.length > 0 || hasDocsLabel || relevantDocs.length > 0,
        relevantDocs,
        keywords: matchedSignals
    };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const repoArg = process.argv[2];

    if (!repoArg) {
        console.log('Usage: npx ts-node fetch-github-issues.ts owner/repo [--issue=NUMBER]');
        console.log('Example: npx ts-node fetch-github-issues.ts resend/react-email');
        console.log('Example: npx ts-node fetch-github-issues.ts resend/react-email --issue=2958');
        process.exit(1);
    }

    const [owner, repo] = repoArg.split('/');
    if (!owner || !repo) {
        console.error('Invalid repo format. Use: owner/repo');
        process.exit(1);
    }

    // Check for specific issue flag
    const issueFlag = process.argv.find(a => a.startsWith('--issue='));
    const specificIssue = issueFlag ? parseInt(issueFlag.split('=')[1]) : null;

    console.log(`\n🔍 Lensy GitHub Issues Analyzer`);
    console.log(`   Repository: ${owner}/${repo}`);
    console.log(`   ${specificIssue ? `Specific issue: #${specificIssue}` : 'Scanning all open issues'}`);
    console.log(`${'─'.repeat(60)}\n`);

    // Step 1: Fetch issues
    let issues: GitHubIssue[];
    if (specificIssue) {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${specificIssue}`;
        const response = await makeRequest(url);
        issues = [JSON.parse(response)];
    } else {
        issues = await fetchGitHubIssues(owner, repo, { maxIssues: 30 });
    }

    // Step 2: Fetch docs context
    const docs = await fetchRepoDocsContext(owner, repo);

    // Step 3: Analyze each issue
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📊 Analyzing ${issues.length} issues against ${docs.length} doc files...\n`);

    const results: Array<{
        issue: GitHubIssue;
        classification: ReturnType<typeof classifyIssueLocally>;
    }> = [];

    for (const issue of issues) {
        const classification = classifyIssueLocally(issue, docs);
        results.push({ issue, classification });
    }

    // Sort: docs-related first, then by reactions/comments
    results.sort((a, b) => {
        if (a.classification.likelyDocsRelated !== b.classification.likelyDocsRelated) {
            return a.classification.likelyDocsRelated ? -1 : 1;
        }
        return (b.issue.reactions?.total_count || 0) - (a.issue.reactions?.total_count || 0);
    });

    // Output results
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`RESULTS: ${results.filter(r => r.classification.likelyDocsRelated).length} docs-related issues found`);
    console.log(`${'═'.repeat(60)}\n`);

    for (const { issue, classification } of results) {
        const icon = classification.likelyDocsRelated ? '🔴' : '⚪';
        console.log(`${icon} #${issue.number}: ${issue.title}`);
        console.log(`   URL: ${issue.html_url}`);
        console.log(`   Labels: ${issue.labels.map(l => l.name).join(', ') || 'none'}`);
        console.log(`   Reactions: ${issue.reactions?.total_count || 0} | Comments: ${issue.comments}`);

        if (classification.likelyDocsRelated) {
            console.log(`   📝 Docs signals: ${classification.keywords.join(', ')}`);
            console.log(`   📄 Related docs: ${classification.relevantDocs.join(', ') || 'needs LLM analysis'}`);
        }

        // Print issue body preview (first 200 chars)
        if (issue.body) {
            const preview = issue.body.substring(0, 200).replace(/\n/g, ' ');
            console.log(`   Preview: ${preview}...`);
        }
        console.log('');
    }

    // Output docs context summary for LLM step
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`DOCS CONTEXT AVAILABLE`);
    console.log(`${'═'.repeat(60)}\n`);

    for (const doc of docs) {
        console.log(`📄 ${doc.path} (${doc.content.length} chars) [${doc.source}]`);
    }

    // Return structured data for next step (LLM analysis)
    return {
        issues: results.filter(r => r.classification.likelyDocsRelated),
        allIssues: results,
        docs,
        repo: `${owner}/${repo}`
    };
}

main().catch(console.error);
