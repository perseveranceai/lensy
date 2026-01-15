"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_cloudfront_1 = require("@aws-sdk/client-cloudfront");
const marked_1 = require("marked");
const s3Client = new client_s3_1.S3Client({ region: 'us-east-1' });
const cfClient = new client_cloudfront_1.CloudFrontClient({ region: 'us-east-1' });
const handler = async (event) => {
    // Handle API Gateway V2 proxy event
    let input = event;
    if (event.body) {
        try {
            input = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        }
        catch (e) {
            console.warn('Could not parse event body, using event as is');
        }
    }
    const { sessionId, selectedFixIds, bucketName: eventBucket, distributionId: eventDist } = input;
    const analysisBucket = eventBucket || process.env.ANALYSIS_BUCKET || 'lensy-analysis-951411676525-us-east-1';
    const demoBucket = process.env.DEMO_BUCKET || 'lensy-demo-docs-951411676525';
    const distributionId = eventDist || process.env.DISTRIBUTION_ID || 'E2ZTB22KJUIH93';
    console.log(`Starting Fix Application for session: ${sessionId} (Bucket: ${analysisBucket})`);
    if (!sessionId) {
        return {
            statusCode: 400,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: false, error: 'sessionId is required' })
        };
    }
    try {
        // 1. Get fixes from S3
        const fixesKey = `sessions/${sessionId}/fixes.json`;
        const fixesResponse = await s3Client.send(new client_s3_1.GetObjectCommand({ Bucket: analysisBucket, Key: fixesKey }));
        const fixesData = JSON.parse(await fixesResponse.Body.transformToString());
        const { fixes, documentUrl } = fixesData;
        // Extract filename from URL (e.g., https://.../api-reference.md -> api-reference.md)
        const filename = documentUrl.split('/').pop();
        if (!filename)
            throw new Error('Could not determine filename from URL');
        // 2. Get original document from demo bucket
        const docResponse = await s3Client.send(new client_s3_1.GetObjectCommand({ Bucket: demoBucket, Key: filename }));
        let content = await docResponse.Body.transformToString();
        // 3. Apply selected fixes
        // 3. Apply selected fixes
        const selectedFixes = fixes.filter((f) => selectedFixIds.includes(f.id));
        let appliedFixes = [];
        for (const fix of selectedFixes) {
            console.log(`Attempting to apply fix: ${fix.id} (${fix.category})`);
            // Strategy 1: Exact match
            if (content.includes(fix.originalContent)) {
                content = content.replace(fix.originalContent, fix.proposedContent);
                appliedFixes.push(fix);
                console.log(`✅ Applied fix ${fix.id} via exact match`);
                continue;
            }
            // Strategy 2: Whitespace-tolerant Regex match
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = escapeRegExp(fix.originalContent.trim()).replace(/\s+/g, '\\s+');
            const regex = new RegExp(pattern);
            if (regex.test(content)) {
                content = content.replace(regex, fix.proposedContent);
                appliedFixes.push(fix);
                console.log(`✅ Applied fix ${fix.id} via whitespace-tolerant regex`);
                continue;
            }
            // Strategy 3: Normalized Fuzzy Match (strips non-alphanumeric for discovery)
            // This handles cases like 'Array' vs 'Array<Finding>' or minor punctuation shifts
            const normalize = (str) => str.replace(/[^a-z0-9]/gi, '').toLowerCase();
            const normalizedOriginal = normalize(fix.originalContent);
            // We use a sliding window-ish approach or just search for the normalized string
            // For simplicity and performance, we'll try to find a block of text that normalizes to the same thing
            // Since documents aren't huge, we can do a line-by-line or block search if needed, 
            // but first let's try a simpler 'broken regex'
            // Create a regex that allows any characters BETWEEN tokens
            const tokens = fix.originalContent.trim().split(/\s+/).filter((t) => t.length > 2);
            if (tokens.length > 2) {
                const fuzzyPattern = tokens.map((t) => escapeRegExp(t)).join('.{0,50}?');
                const fuzzyRegex = new RegExp(fuzzyPattern, 's'); // 's' flag for dot-all (matching across lines)
                if (fuzzyRegex.test(content)) {
                    content = content.replace(fuzzyRegex, fix.proposedContent);
                    appliedFixes.push(fix);
                    console.log(`✅ Applied fix ${fix.id} via fuzzy token matching`);
                }
                else {
                    console.error(`❌ Fix ${fix.id} NOT applied - content not found even with fuzzy matching`);
                    console.log(`Original content snippet: "${fix.originalContent.substring(0, 50)}..."`);
                }
            }
            else {
                console.error(`❌ Fix ${fix.id} NOT applied - too short for fuzzy matching`);
            }
        }
        // 4. Update doc-level changelog WITHIN the document
        let changelogMessage = '';
        if (appliedFixes.length > 0) {
            const dateStr = new Date().toISOString().split('T')[0];
            const entry = `\n### [${dateStr}] - AI Update\n- ${appliedFixes.length} fixes applied:\n${appliedFixes.map((f) => `  - ${f.category}: ${f.rationale}`).join('\n')}\n`;
            // Check for existing Changelog section
            const changelogHeaderRegex = /##\s+Changelog/i;
            if (changelogHeaderRegex.test(content)) {
                // Insert after the header
                content = content.replace(changelogHeaderRegex, `## Changelog\n${entry}`);
                console.log('Appended to existing Changelog section');
            }
            else {
                // Append new section before Support or at end
                const supportRegex = /##\s+Support/i;
                if (supportRegex.test(content)) {
                    content = content.replace(supportRegex, `## Changelog\n${entry}\n---\n\n## Support`);
                    console.log('Inserted Changelog section before Support');
                }
                else {
                    content += `\n\n---\n\n## Changelog\n${entry}`;
                    console.log('Appended Changelog section to end of file');
                }
            }
            changelogMessage = ' Document changelog section updated.';
        }
        // 5. Write updated content back to S3
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: demoBucket,
            Key: filename,
            Body: content,
            ContentType: 'text/markdown'
        }));
        // 5b. Generate and Upload HTML version
        const htmlFilename = filename.replace(/\.md$/, '.html');
        // Convert Markdown to HTML
        const htmlBody = marked_1.marked.parse(content);
        // Wrap in GitHub-style template
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${filename}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-dark.min.css">
<style>
    body { 
        box-sizing: border-box; 
        min-width: 200px; 
        max-width: 980px; 
        margin: 0 auto; 
        padding: 45px; 
        background-color: #0d1117; 
        color: #c9d1d9;
    }
    @media (max-width: 767px) { body { padding: 15px; } }
</style>
</head>
<body class="markdown-body">
    ${htmlBody}
</body>
</html>`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: demoBucket,
            Key: htmlFilename,
            Body: htmlContent,
            ContentType: 'text/html'
        }));
        console.log(`✅ Generated and uploaded ${htmlFilename}`);
        // 6. INVALIDATE BACKEND ANALYSIS CACHE
        // We delete the dimension results and processed content for this session
        // to ensure the next scan is forced to be fresh.
        try {
            console.log(`Invalidating backend analysis cache for session ${sessionId}`);
            const deletePromises = [
                s3Client.send(new client_s3_1.DeleteObjectCommand({ Bucket: analysisBucket, Key: `sessions/${sessionId}/dimension-results.json` })),
                s3Client.send(new client_s3_1.DeleteObjectCommand({ Bucket: analysisBucket, Key: `sessions/${sessionId}/processed-content.json` })),
                s3Client.send(new client_s3_1.DeleteObjectCommand({ Bucket: analysisBucket, Key: `sessions/${sessionId}/report.json` }))
            ];
            await Promise.allSettled(deletePromises);
            console.log('✅ Backend analysis cache invalidated');
        }
        catch (cacheError) {
            console.warn('Failed to invalidate backend analysis cache:', cacheError);
        }
        // 5. Invalidate CloudFront cache
        console.log(`Creating invalidation for ${distributionId} path /${filename}`);
        const invalidation = await cfClient.send(new client_cloudfront_1.CreateInvalidationCommand({
            DistributionId: distributionId,
            InvalidationBatch: {
                CallerReference: `invalidate-${Date.now()}`,
                Paths: {
                    Items: [`/${filename}`, '/CHANGELOG.md', `/${filename.replace(/\.md$/, '.html')}`],
                    Quantity: 3
                }
            }
        }));
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                message: `Applied ${appliedFixes.length} fixes to ${filename}.${changelogMessage} CloudFront cache purge started (ID: ${invalidation.Invalidation?.Id})`,
                filename,
                invalidationId: invalidation.Invalidation?.Id
            })
        };
    }
    catch (error) {
        console.error('Error applying fixes:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: error.message || 'Failed to apply fixes' })
        };
    }
};
exports.handler = handler;
