/**
 * Test script to compare current HTML-to-Markdown conversion vs Turndown with noise reduction
 * 
 * Run with: node test-turndown-comparison.js
 */

const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const { JSDOM } = require('jsdom');
const fs = require('fs');

// Test URL
const TEST_URL = 'https://developer.wordpress.org/plugins/intro/';

async function fetchAndCompare() {
    console.log('🔍 Fetching WordPress documentation...\n');

    const response = await fetch(TEST_URL, {
        headers: {
            'User-Agent': 'Lensy Documentation Quality Auditor/1.0'
        }
    });

    const html = await response.text();
    console.log(`✅ Fetched ${html.length} characters of HTML\n`);

    // ========================================
    // METHOD 1: Current approach (basic Turndown)
    // ========================================
    console.log('📝 METHOD 1: Current Basic Turndown');
    console.log('='.repeat(50));

    const basicTurndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });

    const basicMarkdown = basicTurndown.turndown(html);
    console.log(`Size: ${basicMarkdown.length} characters`);
    console.log(`Lines: ${basicMarkdown.split('\n').length}`);

    // Count noise indicators
    const basicCssCount = (basicMarkdown.match(/\{[^}]*:[^}]*\}/g) || []).length;
    const basicScriptCount = (basicMarkdown.match(/function\s*\(/g) || []).length;
    console.log(`CSS blocks: ${basicCssCount}`);
    console.log(`Script functions: ${basicScriptCount}`);

    fs.writeFileSync('output-basic-turndown.md', basicMarkdown);
    console.log('✅ Saved to: output-basic-turndown.md\n');

    // ========================================
    // METHOD 2: Turndown with noise reduction
    // ========================================
    console.log('🧹 METHOD 2: Turndown with Noise Reduction');
    console.log('='.repeat(50));

    // Parse HTML with JSDOM
    const dom = new JSDOM(html, { url: TEST_URL });
    const document = dom.window.document;

    // Remove noise elements BEFORE conversion
    const noiseSelectors = [
        'script', 'style', 'noscript', 'iframe',
        'nav', 'header', 'footer', 'aside',
        '.site-header', '.site-footer',
        '#secondary', '.navigation', '.breadcrumb',
        '.edit-link', '.post-navigation',
        '#wporg-header', '#wporg-footer',
        '.wp-block-wporg-sidebar-container',
        '.wp-block-social-links',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
    ];

    noiseSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Get main content area
    const mainContent = document.querySelector('main, article, .entry-content, #content') || document.body;
    const cleanHtml = mainContent.innerHTML;

    console.log(`Cleaned HTML: ${cleanHtml.length} characters (${Math.round((1 - cleanHtml.length / html.length) * 100)}% reduction)`);

    // Configure Turndown with GFM plugin
    const cleanTurndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
    });

    // Add GFM support (tables, strikethrough, etc.)
    cleanTurndown.use(gfm);

    // Remove additional noise elements
    cleanTurndown.remove(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe']);

    // Custom rule for callouts/admonitions
    cleanTurndown.addRule('callout', {
        filter: (node) => {
            return node.nodeName === 'DIV' &&
                /notice|warning|info|tip|alert/.test(node.className);
        },
        replacement: (content, node) => {
            const className = node.className || '';
            let type = 'Note';
            if (/warning|caution/.test(className)) type = 'Warning';
            if (/info|note/.test(className)) type = 'Note';
            if (/tip|hint/.test(className)) type = 'Tip';
            return `\n> **${type}:** ${content.trim()}\n`;
        }
    });

    // Enhanced code block handling
    cleanTurndown.addRule('codeBlock', {
        filter: (node) => {
            return node.nodeName === 'PRE' && node.querySelector('code');
        },
        replacement: (content, node) => {
            const code = node.querySelector('code');
            const className = code.className || '';

            // Detect language from class
            let lang = '';
            const langMatch = className.match(/language-(\w+)|lang-(\w+)/);
            if (langMatch) {
                lang = langMatch[1] || langMatch[2];
            } else if (className.includes('php')) {
                lang = 'php';
            } else if (className.includes('js') || className.includes('javascript')) {
                lang = 'javascript';
            }

            const text = code.textContent;
            return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
        }
    });

    const cleanMarkdown = cleanTurndown.turndown(cleanHtml);
    console.log(`Size: ${cleanMarkdown.length} characters`);
    console.log(`Lines: ${cleanMarkdown.split('\n').length}`);

    // Count noise indicators
    const cleanCssCount = (cleanMarkdown.match(/\{[^}]*:[^}]*\}/g) || []).length;
    const cleanScriptCount = (cleanMarkdown.match(/function\s*\(/g) || []).length;
    console.log(`CSS blocks: ${cleanCssCount}`);
    console.log(`Script functions: ${cleanScriptCount}`);

    fs.writeFileSync('output-clean-turndown.md', cleanMarkdown);
    console.log('✅ Saved to: output-clean-turndown.md\n');

    // ========================================
    // COMPARISON SUMMARY
    // ========================================
    console.log('📊 COMPARISON SUMMARY');
    console.log('='.repeat(50));
    console.log(`Basic Turndown:  ${basicMarkdown.length} chars, ${basicCssCount} CSS blocks, ${basicScriptCount} scripts`);
    console.log(`Clean Turndown:  ${cleanMarkdown.length} chars, ${cleanCssCount} CSS blocks, ${cleanScriptCount} scripts`);
    console.log(`\nSize reduction:  ${Math.round((1 - cleanMarkdown.length / basicMarkdown.length) * 100)}%`);
    console.log(`Noise reduction: ${Math.round((1 - (cleanCssCount + cleanScriptCount) / (basicCssCount + basicScriptCount)) * 100)}%`);

    // Show first 500 chars of each
    console.log('\n📄 PREVIEW - Basic Turndown (first 500 chars):');
    console.log('-'.repeat(50));
    console.log(basicMarkdown.substring(0, 500));

    console.log('\n📄 PREVIEW - Clean Turndown (first 500 chars):');
    console.log('-'.repeat(50));
    console.log(cleanMarkdown.substring(0, 500));

    console.log('\n✅ Done! Check output-basic-turndown.md and output-clean-turndown.md for full comparison');
}

fetchAndCompare().catch(console.error);
