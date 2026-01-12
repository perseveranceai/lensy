
import * as https from 'https';

function extractCodeSnippetsFromPage(html: string): Array<{ code: string; language?: string }> {
    const snippets: Array<{ code: string; language?: string }> = [];

    // Match <pre><code> blocks
    const preCodeRegex = /<pre[^>]*><code[^>]*class=['"]?language-(\w+)['"]?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
    let match;

    while ((match = preCodeRegex.exec(html)) !== null) {
        let lang = match[1];
        let code = match[2]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"');
        snippets.push({ code, language: lang });
    }

    // 2. Comprehensive: Match any <code> blocks that look like code (long or contains symbols)
    const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
    while ((match = codeRegex.exec(html)) !== null) {
        let code = match[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/<[^>]+>/g, ''); // Remove any nested tags

        const trimmedCode = code.trim();

        // Logic to distinguish real code snippets from small inline words
        const isLikelySnippet = trimmedCode.length > 40 ||
            trimmedCode.includes('{') ||
            trimmedCode.includes('=>') ||
            trimmedCode.includes(';') ||
            trimmedCode.includes('import ') ||
            trimmedCode.includes('const ');

        if (isLikelySnippet) {
            // Avoid duplicates with pre/code blocks
            if (!snippets.some(s => s.code === trimmedCode)) {
                snippets.push({ code: trimmedCode });
            }
        }
    }

    return snippets;
}

async function testExtraction() {
    // Try the batch function page
    const url = 'https://docs.knock.app/designing-workflows/batch-function';
    console.log(`Fetching ${url}...`);

    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log(`Fetched ${data.length} bytes.`);

            // DEBUG: Show first two <pre> tags
            const preTags = data.match(/<pre[\s\S]*?<\/pre>/gi);
            if (preTags) {
                console.log(`Found ${preTags.length} <pre> tags.`);
                preTags.slice(0, 2).forEach((tag, i) => {
                    console.log(`--- RAW PRE TAG ${i + 1} ---`);
                    console.log(tag.substring(0, 300));
                });
            } else {
                console.log("No <pre> tags found at all!");
                const nextDataIndex = data.indexOf('__NEXT_DATA__');
                if (nextDataIndex !== -1) {
                    console.log(`Found __NEXT_DATA__ at index ${nextDataIndex}. Context:`);
                    console.log(data.substring(nextDataIndex, nextDataIndex + 1000));
                } else {
                    console.log("__NEXT_DATA__ not found.");
                }
            }

            const snippets = extractCodeSnippetsFromPage(data);
            console.log(`Extracted ${snippets.length} snippets.`);
            snippets.forEach((s, i) => {
                console.log(`--- Snippet ${i + 1} (${s.language || 'unknown'}) ---`);
                console.log(s.code.substring(0, 100) + (s.code.length > 100 ? '...' : ''));
            });
            process.exit(0);
        });
    }).on('error', (err) => {
        console.error('Error fetching page:', err);
    });
}

testExtraction();
