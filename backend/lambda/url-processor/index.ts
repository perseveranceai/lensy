import { Handler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

interface URLProcessorEvent {
    url: string;
    selectedModel: string;
    sessionId: string;
    analysisStartTime: number;
}

interface URLProcessorResponse {
    success: boolean;
    sessionId: string;
    message: string;
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

export const handler: Handler<URLProcessorEvent, URLProcessorResponse> = async (event) => {
    console.log('Processing URL:', event.url);

    try {
        // Fetch HTML content
        const response = await fetch(event.url, {
            headers: {
                'User-Agent': 'Lensy Documentation Quality Auditor/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const htmlContent = await response.text();
        console.log(`Fetched ${htmlContent.length} characters of HTML content`);

        // Parse HTML with JSDOM
        const dom = new JSDOM(htmlContent, { url: event.url });
        const document = dom.window.document;

        console.log(`Original HTML size: ${htmlContent.length} chars`);

        // AGGRESSIVE NOISE REDUCTION: Remove noise elements before processing
        const removedCount = removeNoiseElements(document);
        console.log(`Removed ${removedCount} noise elements`);

        // Extract main content area with better content detection
        const mainContent = extractMainContent(document);
        const cleanHtml = mainContent.innerHTML;
        console.log(`After content extraction: ${cleanHtml.length} chars`);
        console.log(`Total reduction: ${Math.round((1 - cleanHtml.length / htmlContent.length) * 100)}%`);

        // Extract minimal data for analysis from cleaned content
        const mediaElements = extractMediaElements(document, event.url);
        const codeSnippets = extractCodeSnippets(document);
        const linkAnalysis = analyzeLinkStructure(document, event.url);

        // Convert to Markdown with aggressive noise removal
        const turndownService = configureTurndownService();
        const markdownContent = turndownService.turndown(cleanHtml);
        console.log(`Final markdown size: ${markdownContent.length} chars`);
        console.log(`Converted to ${markdownContent.length} characters of clean Markdown`);

        const contentType = detectContentType(document, markdownContent);

        // Create processed content object
        const processedContent = {
            url: event.url,
            htmlContent: cleanHtml, // Store cleaned HTML, not raw
            markdownContent: markdownContent, // Clean markdown
            mediaElements: mediaElements.slice(0, 10), // Limit media elements
            codeSnippets: codeSnippets.slice(0, 15), // Limit code snippets
            contentType,
            linkAnalysis,
            processedAt: new Date().toISOString(),
            noiseReduction: {
                originalSize: htmlContent.length,
                cleanedSize: cleanHtml.length,
                reductionPercent: Math.round((1 - cleanHtml.length / htmlContent.length) * 100)
            }
        };

        // Store processed content in S3
        const s3Key = `sessions/${event.sessionId}/processed-content.json`;
        const bucketName = process.env.ANALYSIS_BUCKET;

        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }

        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
            Body: JSON.stringify(processedContent),
            ContentType: 'application/json'
        }));

        console.log(`Stored processed content in S3: ${s3Key}`);

        // Store session metadata (including model selection)
        const metadataKey = `sessions/${event.sessionId}/metadata.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: metadataKey,
            Body: JSON.stringify({
                url: event.url,
                selectedModel: event.selectedModel,
                sessionId: event.sessionId,
                startTime: event.analysisStartTime
            }),
            ContentType: 'application/json'
        }));

        console.log(`Stored session metadata in S3: ${metadataKey}`);

        // Return ONLY success status - no data at all
        return {
            success: true,
            sessionId: event.sessionId,
            message: 'Content processed and stored in S3'
        };

    } catch (error) {
        console.error('URL processing failed:', error);
        return {
            success: false,
            sessionId: event.sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

function extractMediaElements(document: Document, baseUrl: string) {
    const mediaElements: any[] = [];

    // Extract images
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        mediaElements.push({
            type: 'image',
            src: img.src,
            alt: img.alt || undefined,
            caption: img.title || undefined,
            analysisNote: img.alt ? 'Has alt text' : 'Missing alt text - accessibility concern'
        });
    });

    // Extract videos
    const videos = document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]');
    videos.forEach(video => {
        const src = video.getAttribute('src') || '';
        mediaElements.push({
            type: 'video',
            src,
            analysisNote: 'Video content - consider accessibility and loading impact'
        });
    });

    // Extract interactive elements
    const interactives = document.querySelectorAll('form, button[onclick], [data-interactive]');
    interactives.forEach(() => {
        mediaElements.push({
            type: 'interactive',
            src: '',
            analysisNote: 'Interactive element - may affect documentation usability'
        });
    });

    return mediaElements;
}

function extractCodeSnippets(document: Document) {
    const codeSnippets: any[] = [];

    const codeBlocks = document.querySelectorAll('pre code, code');
    codeBlocks.forEach((codeElement, index) => {
        const code = codeElement.textContent || '';
        if (code.trim().length < 10) return; // Skip very short snippets

        const language = detectLanguageFromClass(codeElement.className) ||
            detectLanguageFromContent(code);

        codeSnippets.push({
            language,
            code: code.trim().slice(0, 1000), // Limit code snippet size
            lineNumber: index + 1,
            hasVersionInfo: checkForVersionInfo(code)
        });
    });

    return codeSnippets;
}

function analyzeLinkStructure(document: Document, baseUrl: string) {
    const links = document.querySelectorAll('a[href]');
    const baseUrlObj = new URL(baseUrl);

    let totalLinks = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    const subPagesIdentified: string[] = [];

    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

        totalLinks++;

        try {
            const linkUrl = new URL(href, baseUrl);

            if (linkUrl.hostname === baseUrlObj.hostname) {
                internalLinks++;

                if (linkUrl.pathname !== baseUrlObj.pathname) {
                    const linkText = link.textContent?.trim() || '';
                    if (linkText && !subPagesIdentified.includes(linkText)) {
                        subPagesIdentified.push(linkText);
                    }
                }
            } else {
                externalLinks++;
            }
        } catch {
            externalLinks++;
        }
    });

    return {
        totalLinks,
        internalLinks,
        externalLinks,
        subPagesIdentified: subPagesIdentified.slice(0, 10),
        linkContext: subPagesIdentified.length > 0 ? 'multi-page-referenced' as const : 'single-page' as const,
        analysisScope: 'current-page-only' as const
    };
}

function detectContentType(document: Document, markdownContent: string): string {
    const title = document.title.toLowerCase();
    const content = markdownContent.toLowerCase();

    if (title.includes('api') || content.includes('endpoint')) {
        return 'api-docs';
    }

    if (title.includes('tutorial') || title.includes('guide')) {
        return 'tutorial';
    }

    if (title.includes('reference') || title.includes('documentation')) {
        return 'reference';
    }

    return 'mixed';
}

function detectLanguageFromClass(className: string): string {
    const langMatch = className.match(/(?:lang-|language-)([a-zA-Z0-9]+)/);
    if (langMatch) {
        return langMatch[1].toLowerCase();
    }

    if (className.includes('php')) return 'php';
    if (className.includes('js') || className.includes('javascript')) return 'javascript';
    if (className.includes('css')) return 'css';
    if (className.includes('html')) return 'html';

    return '';
}

function detectLanguageFromContent(code: string): string {
    if (code.includes('<?php') || code.includes('->')) {
        return 'php';
    }

    if (code.includes('function') || code.includes('const ') || code.includes('=>')) {
        return 'javascript';
    }

    if (code.includes('{') && code.includes(':') && code.includes(';')) {
        return 'css';
    }

    if (code.includes('<') && code.includes('>')) {
        return 'html';
    }

    return 'text';
}

function checkForVersionInfo(code: string): boolean {
    const versionPatterns = [
        /since\s+wordpress\s+\d+\.\d+/i,
        /wp\s+\d+\.\d+/i,
        /version\s+\d+\.\d+/i,
        /@since\s+\d+\.\d+/i
    ];

    return versionPatterns.some(pattern => pattern.test(code));
}

/**
 * Remove noise elements from document before conversion
 * Enhanced removal focusing on CSS/JS noise
 */
function removeNoiseElements(document: Document): number {
    const noiseSelectors = [
        // Scripts and styles (CRITICAL for removing CSS/JS noise!)
        'script', 'style', 'noscript', 'link[rel="stylesheet"]',

        // Navigation and UI chrome
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',

        // WordPress.org specific noise
        '.site-header', '.site-footer', '.site-navigation',
        '#secondary', '.navigation', '.breadcrumb', '.breadcrumbs',
        '.edit-link', '.post-navigation', '.comments-area',
        '#wporg-header', '#wporg-footer', '#wporg-sidebar',
        '.wp-block-wporg-sidebar-container',
        '.wp-block-social-links', '.wp-block-navigation',

        // Common noise patterns
        '.advertisement', '.ad', '.ads', '.sidebar', '.comments',
        '.cookie-notice', '.gdpr-notice', '.privacy-notice',
        '.social-share', '.share-buttons', '.related-posts',
        '.author-bio', '.post-meta', '.entry-meta',

        // Form elements (usually not documentation content)
        'form', 'input', 'button[type="submit"]', 'textarea',

        // Hidden elements
        '[style*="display:none"]', '[style*="visibility:hidden"]',
        '.hidden', '.sr-only', '.screen-reader-text',

        // Embeds and widgets
        'iframe', 'embed', 'object', 'video', 'audio',
        '.widget', '.wp-widget', '.sidebar-widget',

        // Skip links and accessibility helpers (not content)
        '.skip-link', '.skip-to-content',

        // WordPress admin and edit links
        '.edit-post-link', '.admin-bar', '#wpadminbar'
    ];

    let removedCount = 0;
    noiseSelectors.forEach(selector => {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.remove();
                removedCount++;
            });
        } catch (e) {
            console.log(`Error with selector ${selector}:`, e instanceof Error ? e.message : String(e));
        }
    });

    return removedCount;
}

/**
 * Extract main content with better content detection
 */
function extractMainContent(document: Document): Element {
    // Strategy 1: WordPress.org specific content containers
    const wpSelectors = [
        '.entry-content',
        '.post-content',
        'main .entry-content',
        'article .entry-content',
        '.content-area main'
    ];

    for (const selector of wpSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim().length > 500) {
            console.log(`Found main content using: ${selector}`);
            return element;
        }
    }

    // Strategy 2: Generic content containers
    const genericSelectors = ['main', 'article', '[role="main"]', '#content'];

    for (const selector of genericSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent && element.textContent.trim().length > 500) {
            console.log(`Found main content using: ${selector}`);
            return element;
        }
    }

    console.log('Fallback to document body');
    return document.body;
}

/**
 * Configure Turndown service with aggressive noise removal using built-in methods
 */
function configureTurndownService(): TurndownService {
    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
    });

    // Add GitHub Flavored Markdown support (tables, strikethrough, etc.)
    turndown.use(gfm);

    // AGGRESSIVE noise removal using Turndown's built-in remove() method
    turndown.remove([
        // Scripts and styles (CRITICAL!)
        'script', 'style', 'noscript', 'link',

        // Navigation and chrome
        'nav', 'footer', 'header', 'aside',

        // Forms and inputs
        'form', 'input', 'button', 'textarea', 'select', 'option',

        // Media and embeds
        'iframe', 'embed', 'object', 'video', 'audio',

        // Meta and hidden content
        'meta', 'title', 'base'
    ]);

    // Custom rule for WordPress callouts/notices
    turndown.addRule('callout', {
        filter: (node: any) => {
            return node.nodeName === 'DIV' &&
                /notice|warning|info|tip|alert/.test(node.className || '');
        },
        replacement: (content: string, node: any) => {
            const className = node.className || '';
            let type = 'Note';
            if (/warning|caution/.test(className)) type = 'Warning';
            if (/info|note/.test(className)) type = 'Note';
            if (/tip|hint/.test(className)) type = 'Tip';
            if (/error|danger/.test(className)) type = 'Error';
            return `\n> **${type}:** ${content.trim()}\n`;
        }
    });

    // Enhanced code block handling with language detection
    turndown.addRule('codeBlock', {
        filter: (node: any) => {
            return node.nodeName === 'PRE' && node.querySelector('code');
        },
        replacement: (content: string, node: any) => {
            const code = node.querySelector('code');
            const className = code?.className || '';

            // Detect language from class
            let lang = '';
            const langMatch = className.match(/language-(\w+)|lang-(\w+)/);
            if (langMatch) {
                lang = langMatch[1] || langMatch[2];
            } else if (className.includes('php')) {
                lang = 'php';
            } else if (className.includes('js') || className.includes('javascript')) {
                lang = 'javascript';
            } else if (className.includes('css')) {
                lang = 'css';
            } else if (className.includes('html')) {
                lang = 'html';
            } else if (className.includes('bash') || className.includes('shell')) {
                lang = 'bash';
            }

            const text = code?.textContent || '';
            return `\n\`\`\`${lang}\n${text}\n\`\`\`\n`;
        }
    });

    return turndown;
}