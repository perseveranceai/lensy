/**
 * MCP Tool: analyze_doc
 *
 * Calls Lensy HTTP API to scan a documentation page for AI-readiness issues.
 * Pure API call — no LLM involved.
 */

import { scanWithLensy, type LensyReport } from '../lensy-client.js';

export async function analyzeDoc(url: string): Promise<LensyReport> {
    console.error(`[analyze_doc] Starting Lensy scan for: ${url}`);

    const report = await scanWithLensy(url);

    console.error(`[analyze_doc] Scan complete.`);
    console.error(`  Score: ${report.overallScore}/100 (${report.letterGrade})`);
    console.error(`  Findings: ${report.recommendations.length}`);
    console.error(`  High priority: ${report.recommendations.filter(r => r.priority === 'high').length}`);

    return report;
}
