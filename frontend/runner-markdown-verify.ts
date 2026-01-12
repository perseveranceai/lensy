
export { };

// Simulation of logic from App.tsx exportValidationReport
function exportValidationReport(validationResults: any, companyDomain: string) {
    const analysisDate = new Date().toLocaleDateString();

    let markdown = `# DOCUMENTATION QUALITY VALIDATION REPORT\n\n`;
    markdown += `**Company Domain:** ${companyDomain}\n`;
    markdown += `**Analyzed:** ${analysisDate}\n`;

    // Executive Summary
    markdown += `## EXECUTIVE SUMMARY\n\n`;

    // Logic to detect proactive audits vs stack overflow
    const isProactive = validationResults.validationResults.some((r: any) => r.issueTitle.startsWith('Audit:'));
    const sourceDescription = isProactive
        ? "proactive audit items based on industry best practices"
        : `real developer issue${validationResults.summary.totalIssues === 1 ? '' : 's'} found on Stack Overflow`;

    markdown += `This report analyzes ${validationResults.summary.totalIssues} ${sourceDescription}. Each issue was validated against existing documentation to identify gaps and improvement opportunities.\n\n`;

    // Summary Statistics
    markdown += `### Summary Statistics\n\n`;
    markdown += `- **✅ Resolved Issues:** ${validationResults.summary.resolved} (${((validationResults.summary.resolved / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
    markdown += `- **🔍 Confirmed Gaps:** ${validationResults.summary.confirmed || 0} (${((validationResults.summary.confirmed / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
    markdown += `- **⚠️ Potential Gaps:** ${validationResults.summary.potentialGaps} (${((validationResults.summary.potentialGaps / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n`;
    markdown += `- **❌ Critical Gaps:** ${validationResults.summary.criticalGaps} (${((validationResults.summary.criticalGaps / validationResults.summary.totalIssues) * 100).toFixed(1)}%)\n\n`;

    // Detailed Issue Analysis
    markdown += `## DETAILED ISSUE ANALYSIS\n\n`;

    validationResults.validationResults.forEach((result: any, index: number) => {
        const statusEmoji = result.status === 'resolved' ? '✅' :
            result.status === 'confirmed' ? '🔍' :
                result.status === 'potential-gap' ? '⚠️' :
                    result.status === 'critical-gap' ? '❌' : '❓';

        markdown += `### ${index + 1}. ${statusEmoji} ${result.issueTitle}\n\n`;

        // AI Recommendations
        if (result.recommendations && result.recommendations.length > 0) {
            markdown += `**💡 AI-Generated Recommendations:**\n\n`;
            result.recommendations.forEach((rec: string, idx: number) => {
                // THE FIXED LOGIC: Preserve the full markdown formatting including code blocks
                markdown += `${idx + 1}. ${rec}\n\n`;
            });
        }
        markdown += `---\n\n`;
    });

    // Priority Recommendations
    markdown += `## PRIORITY RECOMMENDATIONS\n\n`;
    const confirmedIssues = validationResults.validationResults.filter((r: any) => r.status === 'confirmed');

    if (confirmedIssues.length > 0) {
        markdown += `### 🔍 High Priority (${confirmedIssues.length} confirmed gaps)\n\n`;
        confirmedIssues.forEach((issue: any, idx: number) => {
            markdown += `${idx + 1}. **Fix incomplete documentation for:** ${issue.issueTitle}\n`;
            markdown += `   - Developer Impact: High (docs exist but miss key info)\n`;
            markdown += `   - Confidence: ${issue.confidence}%\n\n`;
        });
    }

    return markdown;
}

// Mock data with "Audit:" title to trigger Proactive logic
const mockResults = {
    summary: {
        totalIssues: 2,
        resolved: 0,
        confirmed: 1,
        potentialGaps: 1,
        criticalGaps: 0
    },
    validationResults: [
        {
            issueTitle: "Test Issue",
            status: "potential-gap",
            recommendations: [
                "Fix it"
            ]
        },
        {
            issueTitle: "Audit: Confirmed Issue", // Title indicates Proactive Audit
            status: "confirmed",
            confidence: 85,
            recommendations: [
                "Fix it now"
            ]
        }
    ]
};

const output = exportValidationReport(mockResults, "test.com");
console.log("--- GENERATED MARKDOWN START ---");
console.log(output);
console.log("--- GENERATED MARKDOWN END ---");

if (output.includes("proactive audit items based on industry best practices")) {
    console.log("\n✅ SUCCESS: Executive Summary correctly identifies proactive audits.");
} else {
    console.log("\n❌ FAIL: Executive Summary missing proactive audit source.");
    process.exit(1);
}
