/**
 * MCP Tool: improve_doc
 *
 * Reads a local .md file, runs it through the Writer Agent (LangGraph),
 * and returns the improved markdown with a change summary.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { runWriterAgent, type WriterAgentResult } from '../writer-agent.js';
import type { LensyReport } from '../lensy-client.js';

export interface ImproveDocInput {
    url: string;
    findings: LensyReport;
    repoPath: string;
    filePath: string;
}

export interface ImproveDocResult {
    improvedMarkdown: string;
    changesSummary: string[];
    beforeMetrics: { wordCount: number; codeBlocks: number };
    afterMetrics: { wordCount: number; codeBlocks: number };
    validationPassed: boolean;
    validationIssues: string[];
}

export async function improveDoc(input: ImproveDocInput): Promise<ImproveDocResult> {
    const { url, findings, repoPath, filePath } = input;

    // Step 1: Read current markdown from local filesystem
    const fullPath = join(repoPath, filePath);
    let currentMarkdown: string;

    try {
        currentMarkdown = await readFile(fullPath, 'utf-8');
    } catch (err: any) {
        throw new Error(`Could not read file at ${fullPath}: ${err.message}`);
    }

    console.error(`[improve_doc] Read ${currentMarkdown.length} chars from ${fullPath}`);

    // Step 2: Run the Writer Agent graph
    const result = await runWriterAgent(url, currentMarkdown, findings);

    console.error(`[improve_doc] Agent complete.`);
    console.error(`  Validation: ${result.validationPassed ? 'PASSED' : 'FAILED'}`);
    console.error(`  Changes: ${result.changesSummary.length}`);

    return result;
}
