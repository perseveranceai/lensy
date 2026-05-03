/**
 * Writer Agent — dual-mode LangGraph StateGraph.
 *
 * Mode is decided by Lensy's findings:
 *   - REWRITE mode: Lensy says "expand-thin-content" or wordCount < 500
 *     → full file in, full file out
 *   - PATCH mode: everything else
 *     → send headings + findings, get back JSON patches, apply programmatically
 *
 * Graph: analyzeFindings → rewriteContent → validateOutput → END
 * (same 3 nodes, but rewriteContent dispatches to the right mode)
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import type { LensyReport } from './lensy-client.js';

// ── Types ───────────────────────────────────────────────────────────────

type WriterMode = 'rewrite' | 'patch';

interface Patch {
    operation: 'append-after-heading' | 'append-to-end' | 'prepend-after-frontmatter' | 'replace-section';
    /** Heading text to target (for append-after-heading / replace-section) */
    targetHeading?: string;
    /** New markdown content to insert */
    content: string;
    /** What this patch addresses */
    rationale: string;
}

// ── State definition ────────────────────────────────────────────────────

const lastValue = <T>() => ({
    value: (_prev: T, next: T) => next,
});

const WriterState = Annotation.Root({
    url: Annotation<string>,
    currentMarkdown: Annotation<string>,
    lensyReport: Annotation<LensyReport>,

    mode: Annotation<WriterMode>({
        ...lastValue<WriterMode>(),
        default: () => 'patch' as WriterMode,
    }),
    improvedMarkdown: Annotation<string>({
        ...lastValue<string>(),
        default: () => '',
    }),
    changesSummary: Annotation<string[]>({
        ...lastValue<string[]>(),
        default: () => [],
    }),
    beforeMetrics: Annotation<{ wordCount: number; codeBlocks: number }>({
        ...lastValue<{ wordCount: number; codeBlocks: number }>(),
        default: () => ({ wordCount: 0, codeBlocks: 0 }),
    }),
    afterMetrics: Annotation<{ wordCount: number; codeBlocks: number }>({
        ...lastValue<{ wordCount: number; codeBlocks: number }>(),
        default: () => ({ wordCount: 0, codeBlocks: 0 }),
    }),
    validationPassed: Annotation<boolean>({
        ...lastValue<boolean>(),
        default: () => false,
    }),
    validationIssues: Annotation<string[]>({
        ...lastValue<string[]>(),
        default: () => [],
    }),
});

type WriterStateType = typeof WriterState.State;

// ── Node 1: Analyze findings, decide mode ───────────────────────────────

async function analyzeFindings(state: WriterStateType) {
    const beforeMetrics = computeMetrics(state.currentMarkdown);

    const sorted = [...state.lensyReport.recommendations].sort((a, b) => {
        const order: Record<string, number> = { high: 0, medium: 1, low: 2, 'best-practice': 3 };
        return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
    });

    // Decide mode based on Lensy findings
    const needsExpansion = sorted.some(r =>
        r.issue.toLowerCase().includes('short page') ||
        r.issue.toLowerCase().includes('very short page') ||
        r.issue.toLowerCase().includes('thin') ||
        r.issue.toLowerCase().includes('expand')
    ) || beforeMetrics.wordCount < 500;

    const mode: WriterMode = needsExpansion ? 'rewrite' : 'patch';

    console.error(`[writer-agent] Mode: ${mode.toUpperCase()}`);
    console.error(`[writer-agent] Analyzed: ${sorted.length} findings, ${beforeMetrics.wordCount} words, ${beforeMetrics.codeBlocks} code blocks`);

    return {
        mode,
        beforeMetrics,
        lensyReport: { ...state.lensyReport, recommendations: sorted },
    };
}

// ── Node 2: Rewrite or Patch ────────────────────────────────────────────

async function rewriteContent(state: WriterStateType) {
    const llm = new ChatBedrockConverse({
        model: 'us.anthropic.claude-sonnet-4-6',
        region: process.env.AWS_REGION || 'us-east-1',
        temperature: 0.3,
        maxTokens: 16384,
    });

    if (state.mode === 'rewrite') {
        return await doFullRewrite(state, llm);
    } else {
        return await doPatchMode(state, llm);
    }
}

// ── REWRITE mode: full file in, full file out ───────────────────────────

async function doFullRewrite(state: WriterStateType, llm: ChatBedrockConverse) {
    const prompt = buildRewritePrompt(state.currentMarkdown, state.lensyReport, state.url);

    console.error(`[writer-agent] REWRITE mode — calling Claude for full rewrite...`);
    const responseText = await callLlm(llm, prompt);
    const improvedMarkdown = extractMarkdown(responseText);
    const afterMetrics = computeMetrics(improvedMarkdown);
    const changesSummary = summarizeChanges(state.lensyReport, state.beforeMetrics, afterMetrics);

    console.error(`[writer-agent] Rewrite complete. Words: ${state.beforeMetrics.wordCount} → ${afterMetrics.wordCount}`);

    return { improvedMarkdown, afterMetrics, changesSummary };
}

// ── PATCH mode: generate patches, apply programmatically ────────────────

async function doPatchMode(state: WriterStateType, llm: ChatBedrockConverse) {
    const headings = extractHeadings(state.currentMarkdown);
    const prompt = buildPatchPrompt(headings, state.lensyReport, state.url, state.beforeMetrics);

    console.error(`[writer-agent] PATCH mode — calling Claude for discrete patches...`);
    const responseText = await callLlm(llm, prompt);

    // Parse the JSON patches from the LLM response
    let patches: Patch[];
    try {
        const cleaned = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        patches = JSON.parse(cleaned);
        if (!Array.isArray(patches)) {
            throw new Error('Response is not an array');
        }
    } catch (err) {
        console.error(`[writer-agent] Failed to parse patches JSON, falling back to single append`);
        console.error(`[writer-agent] Raw response (first 500 chars): ${responseText.substring(0, 500)}`);
        // Fallback: treat the entire response as a single append-to-end patch
        patches = [{
            operation: 'append-to-end',
            content: extractMarkdown(responseText),
            rationale: 'Fallback: could not parse structured patches',
        }];
    }

    console.error(`[writer-agent] Got ${patches.length} patches`);

    // Apply patches to the original markdown
    let improvedMarkdown = state.currentMarkdown;
    const appliedChanges: string[] = [];

    for (const patch of patches) {
        const before = improvedMarkdown;
        improvedMarkdown = applyPatch(improvedMarkdown, patch);
        if (improvedMarkdown !== before) {
            appliedChanges.push(`${patch.operation}: ${patch.rationale}`);
            console.error(`[writer-agent]   Applied: ${patch.operation} — ${patch.rationale}`);
        } else {
            console.error(`[writer-agent]   Skipped (no change): ${patch.operation} — ${patch.rationale}`);
        }
    }

    const afterMetrics = computeMetrics(improvedMarkdown);
    const changesSummary = appliedChanges.length > 0 ? appliedChanges : ['No patches applied'];

    console.error(`[writer-agent] Patch complete. Words: ${state.beforeMetrics.wordCount} → ${afterMetrics.wordCount}, ${appliedChanges.length} patches applied`);

    return { improvedMarkdown, afterMetrics, changesSummary };
}

// ── Patch application ───────────────────────────────────────────────────

function applyPatch(markdown: string, patch: Patch): string {
    switch (patch.operation) {
        case 'append-to-end':
            return markdown.trimEnd() + '\n\n' + patch.content.trim() + '\n';

        case 'prepend-after-frontmatter': {
            const fmEnd = markdown.indexOf('---', 3);
            if (fmEnd === -1) {
                // No frontmatter — prepend to start
                return patch.content.trim() + '\n\n' + markdown;
            }
            const insertPos = markdown.indexOf('\n', fmEnd) + 1;
            return markdown.slice(0, insertPos) + '\n' + patch.content.trim() + '\n\n' + markdown.slice(insertPos);
        }

        case 'append-after-heading': {
            if (!patch.targetHeading) return markdown;
            const headingPattern = new RegExp(
                `^(#{1,6})\\s+${escapeRegex(patch.targetHeading)}\\s*$`,
                'm'
            );
            const match = headingPattern.exec(markdown);
            if (!match) {
                console.error(`[writer-agent]   Heading not found: "${patch.targetHeading}" — appending to end`);
                return markdown.trimEnd() + '\n\n' + patch.content.trim() + '\n';
            }
            // Find the end of the section (next heading of same or higher level, or EOF)
            const headingLevel = match[1].length;
            const afterHeading = match.index! + match[0].length;
            const nextHeadingPattern = new RegExp(`^#{1,${headingLevel}}\\s`, 'm');
            const rest = markdown.slice(afterHeading);
            const nextMatch = nextHeadingPattern.exec(rest);
            const insertPos = nextMatch
                ? afterHeading + nextMatch.index!
                : markdown.length;
            return markdown.slice(0, insertPos).trimEnd() + '\n\n' + patch.content.trim() + '\n\n' + markdown.slice(insertPos);
        }

        case 'replace-section': {
            if (!patch.targetHeading) return markdown;
            const headingPattern = new RegExp(
                `^(#{1,6})\\s+${escapeRegex(patch.targetHeading)}\\s*$`,
                'm'
            );
            const match = headingPattern.exec(markdown);
            if (!match) {
                console.error(`[writer-agent]   Heading not found for replace: "${patch.targetHeading}" — appending to end`);
                return markdown.trimEnd() + '\n\n' + patch.content.trim() + '\n';
            }
            const headingLevel = match[1].length;
            const sectionStart = match.index!;
            const afterHeading = sectionStart + match[0].length;
            const nextHeadingPattern = new RegExp(`^#{1,${headingLevel}}\\s`, 'm');
            const rest = markdown.slice(afterHeading);
            const nextMatch = nextHeadingPattern.exec(rest);
            const sectionEnd = nextMatch
                ? afterHeading + nextMatch.index!
                : markdown.length;
            return markdown.slice(0, sectionStart) + patch.content.trim() + '\n\n' + markdown.slice(sectionEnd);
        }

        default:
            console.error(`[writer-agent]   Unknown operation: ${patch.operation}`);
            return markdown;
    }
}

// ── Node 3: Validate ────────────────────────────────────────────────────

async function validateOutput(state: WriterStateType) {
    const issues: string[] = [];

    if (state.mode === 'rewrite') {
        // Rewrite-specific checks
        if (state.afterMetrics.wordCount < state.beforeMetrics.wordCount * 0.8) {
            issues.push(`Content shrank: ${state.beforeMetrics.wordCount} → ${state.afterMetrics.wordCount} words`);
        }
        if (state.currentMarkdown.startsWith('---') && !state.improvedMarkdown.startsWith('---')) {
            issues.push('Frontmatter YAML was stripped');
        }
        if (state.beforeMetrics.wordCount < 500 && state.afterMetrics.wordCount < 500) {
            issues.push(`Still thin: ${state.afterMetrics.wordCount} words (target: 500+)`);
        }
    } else {
        // Patch-specific checks
        if (state.improvedMarkdown === state.currentMarkdown) {
            issues.push('No patches were applied — output is identical to input');
        }
        if (state.currentMarkdown.startsWith('---') && !state.improvedMarkdown.startsWith('---')) {
            issues.push('Frontmatter was corrupted by patch application');
        }
    }

    // Common checks
    if (state.improvedMarkdown.trim().length < 100) {
        issues.push('Output is suspiciously short (< 100 chars)');
    }

    const passed = issues.length === 0;
    console.error(`[writer-agent] Validation (${state.mode}): ${passed ? 'PASSED' : `FAILED (${issues.length} issues)`}`);
    if (!passed) issues.forEach(i => console.error(`  - ${i}`));

    return { validationPassed: passed, validationIssues: issues };
}

// ── Graph ───────────────────────────────────────────────────────────────

export function createWriterGraph() {
    const graph = new StateGraph(WriterState)
        .addNode('analyzeFindings', analyzeFindings)
        .addNode('rewriteContent', rewriteContent)
        .addNode('validateOutput', validateOutput)
        .addEdge(START, 'analyzeFindings')
        .addEdge('analyzeFindings', 'rewriteContent')
        .addEdge('rewriteContent', 'validateOutput')
        .addEdge('validateOutput', END);

    return graph.compile();
}

// ── Public API ──────────────────────────────────────────────────────────

export interface WriterAgentResult {
    mode: WriterMode;
    improvedMarkdown: string;
    changesSummary: string[];
    beforeMetrics: { wordCount: number; codeBlocks: number };
    afterMetrics: { wordCount: number; codeBlocks: number };
    validationPassed: boolean;
    validationIssues: string[];
}

export async function runWriterAgent(
    url: string,
    currentMarkdown: string,
    lensyReport: LensyReport,
): Promise<WriterAgentResult> {
    const graph = createWriterGraph();
    const result = await graph.invoke({ url, currentMarkdown, lensyReport });

    return {
        mode: result.mode,
        improvedMarkdown: result.improvedMarkdown,
        changesSummary: result.changesSummary,
        beforeMetrics: result.beforeMetrics,
        afterMetrics: result.afterMetrics,
        validationPassed: result.validationPassed,
        validationIssues: result.validationIssues,
    };
}


// ── Prompts ─────────────────────────────────────────────────────────────

function buildRewritePrompt(markdown: string, report: LensyReport, url: string): string {
    const instructions = buildInstructions(report, computeMetrics(markdown));

    return `You are a senior technical writer improving documentation for AI-readiness.
You are rewriting a page from ${url}.

Lensy scored this page ${report.overallScore}/100 (${report.letterGrade}).

Issues to fix:

${instructions.join('\n')}

RULES:
1. Return the COMPLETE file from start to finish — do NOT truncate or summarize
2. Keep the existing frontmatter YAML exactly as-is (the --- block at the top). CRITICAL.
3. Keep ALL existing content — you are EXPANDING, not replacing
4. Add H3 subheadings to break up long sections
5. Every code block must have a language hint
6. Aim for 800-1500 words total
7. Be technically precise — no marketing fluff
8. Do NOT invent API endpoints that don't exist
9. Add a "## Common Issues" or "## Troubleshooting" section at the end if missing
10. Strip Nuxt directives (::tabs, ::div{class="..."}) and convert to standard markdown

<current_markdown>
${markdown}
</current_markdown>

Return ONLY the improved markdown — the COMPLETE file. Start with the frontmatter (---) block.`;
}

function buildPatchPrompt(
    headings: string[],
    report: LensyReport,
    url: string,
    metrics: { wordCount: number; codeBlocks: number },
): string {
    const instructions = buildInstructions(report, metrics);

    return `You are a senior technical writer. A documentation page at ${url} was scanned by Lensy and scored ${report.overallScore}/100 (${report.letterGrade}).

The page has ${metrics.wordCount} words and ${metrics.codeBlocks} code blocks. Its heading structure is:

${headings.map(h => `  ${h}`).join('\n')}

Issues found by Lensy:

${instructions.join('\n')}

Your job: generate a JSON array of discrete patches to improve this page. Each patch is an object with:
- "operation": one of "append-after-heading", "append-to-end", "prepend-after-frontmatter"
- "targetHeading": (for append-after-heading) the exact heading text to insert after
- "content": the new markdown content to insert (complete, ready to paste)
- "rationale": one sentence explaining what this patch fixes

RULES:
1. Do NOT reproduce existing content — only generate NEW content to add
2. Each patch should be self-contained (a new section, a troubleshooting block, etc.)
3. Code blocks must have language hints (\`\`\`javascript, \`\`\`bash, etc.)
4. Be technically precise — do NOT invent API endpoints
5. Strip any Nuxt directives if referenced
6. For "append-after-heading", use the EXACT heading text from the list above
7. Return ONLY valid JSON — no explanations before or after

Example response format:
[
  {
    "operation": "append-to-end",
    "content": "## Common Issues\\n\\n### Authentication Errors\\n\\nIf you get a 401...",
    "rationale": "Add troubleshooting section for common developer issues"
  },
  {
    "operation": "append-after-heading",
    "targetHeading": "Create a Client",
    "content": "### Quick Start Example\\n\\n\`\`\`javascript\\nconst client = ...\`\`\`",
    "rationale": "Add a complete runnable example after the client creation section"
  }
]`;
}

function buildInstructions(report: LensyReport, metrics: { wordCount: number; codeBlocks: number }): string[] {
    const instructions: string[] = [];

    if (metrics.wordCount < 500) {
        instructions.push(
            `CRITICAL: Only ${metrics.wordCount} words. AI considers < 500 words too thin to cite. Expand with explanations, examples, gotchas.`,
        );
    }

    if (metrics.codeBlocks < 2) {
        instructions.push(
            `Only ${metrics.codeBlocks} code block(s). Add complete, runnable code examples.`,
        );
    }

    for (const rec of report.recommendations) {
        if (rec.priority === 'high' || rec.priority === 'medium') {
            instructions.push(`[${rec.category}] ${rec.issue}`);
            instructions.push(`  Fix: ${rec.fix}`);
            if (rec.codeSnippet) {
                instructions.push(`  Example: ${rec.codeSnippet}`);
            }
        }
    }

    if (report.detection) {
        if (report.detection.page.llmsTxtMapping === 'not_verified') {
            instructions.push(`[Discoverability] Page NOT listed in llms.txt.`);
        }
        if (report.detection.page.markdown === 'not_verified') {
            instructions.push(`[Discoverability] No per-page markdown endpoint.`);
        }
    }

    if (report.aiDiscoverability) {
        instructions.push(
            `[AI Citations] Rate: ${report.aiDiscoverability.citationRate} (${report.aiDiscoverability.citedCount}/${report.aiDiscoverability.totalQueries} queries).`,
        );
    }

    // Include low-priority and best-practice recommendations too
    for (const rec of report.recommendations) {
        if (rec.priority === 'low' || rec.priority === 'best-practice') {
            instructions.push(`[${rec.category}] (${rec.priority}) ${rec.issue}`);
            instructions.push(`  Fix: ${rec.fix}`);
        }
    }

    return instructions;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function callLlm(llm: ChatBedrockConverse, prompt: string): Promise<string> {
    const response = await llm.invoke(prompt);
    if (typeof response.content === 'string') return response.content;
    if (Array.isArray(response.content)) {
        return response.content
            .filter((b): b is { type: 'text'; text: string } =>
                typeof b === 'object' && 'type' in b && b.type === 'text')
            .map(b => b.text)
            .join('');
    }
    return '';
}

function extractMarkdown(response: string): string {
    // Only strip wrapping fences if the ENTIRE response is wrapped in ```markdown ... ```
    // Do NOT use 'm' flag — ^ and $ must match start/end of entire string, not line boundaries
    // This prevents matching code fences INSIDE the content
    const trimmed = response.trim();
    const fullWrap = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*)\n```$/);
    if (fullWrap) return fullWrap[1];
    return response;
}

function extractHeadings(markdown: string): string[] {
    const lines = markdown.split('\n');
    const headings: string[] = [];
    let inCodeBlock = false;
    for (const line of lines) {
        if (line.startsWith('```')) inCodeBlock = !inCodeBlock;
        if (!inCodeBlock && /^#{1,6}\s/.test(line)) {
            headings.push(line.trim());
        }
    }
    return headings;
}

function computeMetrics(markdown: string): { wordCount: number; codeBlocks: number } {
    // Strip code blocks
    let text = markdown.replace(/```[\s\S]*?```/g, '');
    // Strip HTML blocks (JSON-LD, script tags, etc.) — these aren't prose
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    // Strip HTML comments
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    // Strip frontmatter
    text = text.replace(/^---[\s\S]*?---\n?/, '');
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const codeBlockMatches = markdown.match(/```/g) || [];
    const codeBlocks = Math.floor(codeBlockMatches.length / 2);
    return { wordCount, codeBlocks };
}

function summarizeChanges(
    report: LensyReport,
    before: { wordCount: number; codeBlocks: number },
    after: { wordCount: number; codeBlocks: number },
): string[] {
    const changes: string[] = [];
    if (after.wordCount > before.wordCount) {
        changes.push(`Expanded: ${before.wordCount} → ${after.wordCount} words (+${after.wordCount - before.wordCount})`);
    }
    if (after.codeBlocks > before.codeBlocks) {
        changes.push(`Added ${after.codeBlocks - before.codeBlocks} code example(s)`);
    }
    for (const rec of report.recommendations.filter(r => r.priority === 'high')) {
        changes.push(`Addressed: ${rec.issue}`);
    }
    if (changes.length === 0) changes.push('Minor improvements applied');
    return changes;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
