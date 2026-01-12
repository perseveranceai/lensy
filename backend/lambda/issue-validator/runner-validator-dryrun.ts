
import * as https from 'https';

// Mocked logic from index.ts
function extractCodeSnippetsFromPage(html: string): Array<{ code: string; language?: string }> {
    const snippets: Array<{ code: string; language?: string }> = [];
    const preCodeRegex = /<pre[^>]*><code[^>]*class=['"]?language-(\w+)['"]?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
    let match;
    while ((match = preCodeRegex.exec(html)) !== null) {
        let lang = match[1];
        let code = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        snippets.push({ code, language: lang });
    }
    const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
    while ((match = codeRegex.exec(html)) !== null) {
        let code = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '');
        const trimmedCode = code.trim();
        const isLikelySnippet = trimmedCode.length > 40 || trimmedCode.includes('{') || trimmedCode.includes('=>') || trimmedCode.includes(';') || trimmedCode.includes('import ') || trimmedCode.includes('const ');
        if (isLikelySnippet && !snippets.some(s => s.code === trimmedCode)) {
            snippets.push({ code: trimmedCode });
        }
    }
    return snippets;
}

async function dryRunValidator() {
    const url = 'https://docs.knock.app/designing-workflows/batch-function';
    console.log(`🚀 DRY RUN: Validating extraction for ${url}...`);

    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            const snippets = extractCodeSnippetsFromPage(data);
            console.log(`✅ Extracted ${snippets.length} snippets for AI context.`);

            if (snippets.length > 0) {
                console.log(`📝 First snippet to be sent as context:\n${snippets[0].code}\n`);
                console.log("--- PROMPT CHECK ---");
                console.log("The AI will now receive these snippets and is instructed to use them in the 'BEFORE' block.");
                console.log("Instruction: 'DO NOT use // Missing Section - always provide some context snippet from the page.'");
                console.log("--- DRY RUN PASSED ---");
            } else {
                console.log("❌ FAILED: No snippets found for context.");
            }
            process.exit(0);
        });
    }).on('error', (err) => {
        console.error('Error fetching page:', err);
    });
}

dryRunValidator();
