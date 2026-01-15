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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvZml4LWFwcGxpY2F0b3IvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0Esa0RBQXVHO0FBQ3ZHLGtFQUF5RjtBQUN6RixtQ0FBZ0M7QUFFaEMsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDdkQsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQ0FBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBU3hELE1BQU0sT0FBTyxHQUFzQixLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7SUFDdEQsb0NBQW9DO0lBQ3BDLElBQUksS0FBSyxHQUFHLEtBQUssQ0FBQztJQUNsQixJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUU7UUFDWixJQUFJO1lBQ0EsS0FBSyxHQUFHLE9BQU8sS0FBSyxDQUFDLElBQUksS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO1NBQ2hGO1FBQUMsT0FBTyxDQUFDLEVBQUU7WUFDUixPQUFPLENBQUMsSUFBSSxDQUFDLCtDQUErQyxDQUFDLENBQUM7U0FDakU7S0FDSjtJQUVELE1BQU0sRUFBRSxTQUFTLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsY0FBYyxFQUFFLFNBQVMsRUFBRSxHQUFHLEtBQUssQ0FBQztJQUNoRyxNQUFNLGNBQWMsR0FBRyxXQUFXLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksdUNBQXVDLENBQUM7SUFDN0csTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksOEJBQThCLENBQUM7SUFDN0UsTUFBTSxjQUFjLEdBQUcsU0FBUyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLGdCQUFnQixDQUFDO0lBRXBGLE9BQU8sQ0FBQyxHQUFHLENBQUMseUNBQXlDLFNBQVMsYUFBYSxjQUFjLEdBQUcsQ0FBQyxDQUFDO0lBQzlGLElBQUksQ0FBQyxTQUFTLEVBQUU7UUFDWixPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsRUFBRSw2QkFBNkIsRUFBRSxHQUFHLEVBQUU7WUFDL0MsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSx1QkFBdUIsRUFBRSxDQUFDO1NBQzNFLENBQUM7S0FDTDtJQUVELElBQUk7UUFDQSx1QkFBdUI7UUFDdkIsTUFBTSxRQUFRLEdBQUcsWUFBWSxTQUFTLGFBQWEsQ0FBQztRQUNwRCxNQUFNLGFBQWEsR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBZ0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUUsR0FBRyxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUMzRyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sYUFBYSxDQUFDLElBQUssQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLENBQUM7UUFDNUUsTUFBTSxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsR0FBRyxTQUFTLENBQUM7UUFFekMscUZBQXFGO1FBQ3JGLE1BQU0sUUFBUSxHQUFHLFdBQVcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDOUMsSUFBSSxDQUFDLFFBQVE7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7UUFFeEUsNENBQTRDO1FBQzVDLE1BQU0sV0FBVyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLDRCQUFnQixDQUFDLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ3JHLElBQUksT0FBTyxHQUFHLE1BQU0sV0FBVyxDQUFDLElBQUssQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBRTFELDBCQUEwQjtRQUMxQiwwQkFBMEI7UUFDMUIsTUFBTSxhQUFhLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUM5RSxJQUFJLFlBQVksR0FBVSxFQUFFLENBQUM7UUFFN0IsS0FBSyxNQUFNLEdBQUcsSUFBSSxhQUFhLEVBQUU7WUFDN0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsR0FBRyxDQUFDLEVBQUUsS0FBSyxHQUFHLENBQUMsUUFBUSxHQUFHLENBQUMsQ0FBQztZQUVwRSwwQkFBMEI7WUFDMUIsSUFBSSxPQUFPLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsRUFBRTtnQkFDdkMsT0FBTyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsRUFBRSxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUM7Z0JBQ3BFLFlBQVksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ3ZCLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLEdBQUcsQ0FBQyxFQUFFLGtCQUFrQixDQUFDLENBQUM7Z0JBQ3ZELFNBQVM7YUFDWjtZQUVELDhDQUE4QztZQUM5QyxNQUFNLFlBQVksR0FBRyxDQUFDLE1BQWMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxNQUFNLENBQUMsQ0FBQztZQUN2RixNQUFNLE9BQU8sR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFDakYsTUFBTSxLQUFLLEdBQUcsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFbEMsSUFBSSxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFO2dCQUNyQixPQUFPLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsR0FBRyxDQUFDLGVBQWUsQ0FBQyxDQUFDO2dCQUN0RCxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUN2QixPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixHQUFHLENBQUMsRUFBRSxnQ0FBZ0MsQ0FBQyxDQUFDO2dCQUNyRSxTQUFTO2FBQ1o7WUFFRCw2RUFBNkU7WUFDN0Usa0ZBQWtGO1lBQ2xGLE1BQU0sU0FBUyxHQUFHLENBQUMsR0FBVyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNoRixNQUFNLGtCQUFrQixHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUM7WUFFMUQsZ0ZBQWdGO1lBQ2hGLHNHQUFzRztZQUN0RyxvRkFBb0Y7WUFDcEYsK0NBQStDO1lBRS9DLDJEQUEyRDtZQUMzRCxNQUFNLE1BQU0sR0FBRyxHQUFHLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDM0YsSUFBSSxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDbkIsTUFBTSxZQUFZLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO2dCQUNqRixNQUFNLFVBQVUsR0FBRyxJQUFJLE1BQU0sQ0FBQyxZQUFZLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQywrQ0FBK0M7Z0JBRWpHLElBQUksVUFBVSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRTtvQkFDMUIsT0FBTyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztvQkFDM0QsWUFBWSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDdkIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLEVBQUUsMkJBQTJCLENBQUMsQ0FBQztpQkFDbkU7cUJBQU07b0JBQ0gsT0FBTyxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsQ0FBQyxFQUFFLDJEQUEyRCxDQUFDLENBQUM7b0JBQzFGLE9BQU8sQ0FBQyxHQUFHLENBQUMsOEJBQThCLEdBQUcsQ0FBQyxlQUFlLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUM7aUJBQ3pGO2FBQ0o7aUJBQU07Z0JBQ0gsT0FBTyxDQUFDLEtBQUssQ0FBQyxTQUFTLEdBQUcsQ0FBQyxFQUFFLDZDQUE2QyxDQUFDLENBQUM7YUFDL0U7U0FDSjtRQUVELG9EQUFvRDtRQUNwRCxJQUFJLGdCQUFnQixHQUFHLEVBQUUsQ0FBQztRQUMxQixJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ3pCLE1BQU0sT0FBTyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ3ZELE1BQU0sS0FBSyxHQUFHLFVBQVUsT0FBTyxvQkFBb0IsWUFBWSxDQUFDLE1BQU0sb0JBQW9CLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsS0FBSyxDQUFDLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztZQUUzSyx1Q0FBdUM7WUFDdkMsTUFBTSxvQkFBb0IsR0FBRyxpQkFBaUIsQ0FBQztZQUMvQyxJQUFJLG9CQUFvQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRTtnQkFDcEMsMEJBQTBCO2dCQUMxQixPQUFPLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxvQkFBb0IsRUFBRSxpQkFBaUIsS0FBSyxFQUFFLENBQUMsQ0FBQztnQkFDMUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO2FBQ3pEO2lCQUFNO2dCQUNILDhDQUE4QztnQkFDOUMsTUFBTSxZQUFZLEdBQUcsZUFBZSxDQUFDO2dCQUNyQyxJQUFJLFlBQVksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUU7b0JBQzVCLE9BQU8sR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxpQkFBaUIsS0FBSyxxQkFBcUIsQ0FBQyxDQUFDO29CQUNyRixPQUFPLENBQUMsR0FBRyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7aUJBQzVEO3FCQUFNO29CQUNILE9BQU8sSUFBSSw0QkFBNEIsS0FBSyxFQUFFLENBQUM7b0JBQy9DLE9BQU8sQ0FBQyxHQUFHLENBQUMsMkNBQTJDLENBQUMsQ0FBQztpQkFDNUQ7YUFDSjtZQUNELGdCQUFnQixHQUFHLHNDQUFzQyxDQUFDO1NBQzdEO1FBSUQsc0NBQXNDO1FBQ3RDLE1BQU0sUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLDRCQUFnQixDQUFDO1lBQ3JDLE1BQU0sRUFBRSxVQUFVO1lBQ2xCLEdBQUcsRUFBRSxRQUFRO1lBQ2IsSUFBSSxFQUFFLE9BQU87WUFDYixXQUFXLEVBQUUsZUFBZTtTQUMvQixDQUFDLENBQUMsQ0FBQztRQUVKLHVDQUF1QztRQUN2QyxNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztRQUN4RCwyQkFBMkI7UUFDM0IsTUFBTSxRQUFRLEdBQUcsZUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN2QyxnQ0FBZ0M7UUFDaEMsTUFBTSxXQUFXLEdBQUc7Ozs7O1NBS25CLFFBQVE7Ozs7Ozs7Ozs7Ozs7Ozs7TUFnQlgsUUFBUTs7UUFFTixDQUFDO1FBRUQsTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksNEJBQWdCLENBQUM7WUFDckMsTUFBTSxFQUFFLFVBQVU7WUFDbEIsR0FBRyxFQUFFLFlBQVk7WUFDakIsSUFBSSxFQUFFLFdBQVc7WUFDakIsV0FBVyxFQUFFLFdBQVc7U0FDM0IsQ0FBQyxDQUFDLENBQUM7UUFDSixPQUFPLENBQUMsR0FBRyxDQUFDLDRCQUE0QixZQUFZLEVBQUUsQ0FBQyxDQUFDO1FBRXhELHVDQUF1QztRQUN2Qyx5RUFBeUU7UUFDekUsaURBQWlEO1FBQ2pELElBQUk7WUFDQSxPQUFPLENBQUMsR0FBRyxDQUFDLG1EQUFtRCxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQzVFLE1BQU0sY0FBYyxHQUFHO2dCQUNuQixRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksK0JBQW1CLENBQUMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxZQUFZLFNBQVMseUJBQXlCLEVBQUUsQ0FBQyxDQUFDO2dCQUN2SCxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksK0JBQW1CLENBQUMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxZQUFZLFNBQVMseUJBQXlCLEVBQUUsQ0FBQyxDQUFDO2dCQUN2SCxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksK0JBQW1CLENBQUMsRUFBRSxNQUFNLEVBQUUsY0FBYyxFQUFFLEdBQUcsRUFBRSxZQUFZLFNBQVMsY0FBYyxFQUFFLENBQUMsQ0FBQzthQUMvRyxDQUFDO1lBQ0YsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ3pDLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0NBQXNDLENBQUMsQ0FBQztTQUN2RDtRQUFDLE9BQU8sVUFBVSxFQUFFO1lBQ2pCLE9BQU8sQ0FBQyxJQUFJLENBQUMsOENBQThDLEVBQUUsVUFBVSxDQUFDLENBQUM7U0FDNUU7UUFFRCxpQ0FBaUM7UUFDakMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsY0FBYyxVQUFVLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDN0UsTUFBTSxZQUFZLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksNkNBQXlCLENBQUM7WUFDbkUsY0FBYyxFQUFFLGNBQWM7WUFDOUIsaUJBQWlCLEVBQUU7Z0JBQ2YsZUFBZSxFQUFFLGNBQWMsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFO2dCQUMzQyxLQUFLLEVBQUU7b0JBQ0gsS0FBSyxFQUFFLENBQUMsSUFBSSxRQUFRLEVBQUUsRUFBRSxlQUFlLEVBQUUsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsRUFBRSxDQUFDO29CQUNsRixRQUFRLEVBQUUsQ0FBQztpQkFDZDthQUNKO1NBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSixPQUFPO1lBQ0gsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUU7Z0JBQ0wsY0FBYyxFQUFFLGtCQUFrQjtnQkFDbEMsNkJBQTZCLEVBQUUsR0FBRzthQUNyQztZQUNELElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQixPQUFPLEVBQUUsSUFBSTtnQkFDYixPQUFPLEVBQUUsV0FBVyxZQUFZLENBQUMsTUFBTSxhQUFhLFFBQVEsSUFBSSxnQkFBZ0Isd0NBQXdDLFlBQVksQ0FBQyxZQUFZLEVBQUUsRUFBRSxHQUFHO2dCQUN4SixRQUFRO2dCQUNSLGNBQWMsRUFBRSxZQUFZLENBQUMsWUFBWSxFQUFFLEVBQUU7YUFDaEQsQ0FBQztTQUNMLENBQUM7S0FFTDtJQUFDLE9BQU8sS0FBVSxFQUFFO1FBQ2pCLE9BQU8sQ0FBQyxLQUFLLENBQUMsdUJBQXVCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDOUMsT0FBTztZQUNILFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFO2dCQUNMLGNBQWMsRUFBRSxrQkFBa0I7Z0JBQ2xDLDZCQUE2QixFQUFFLEdBQUc7YUFDckM7WUFDRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsT0FBTyxJQUFJLHVCQUF1QixFQUFFLENBQUM7U0FDNUUsQ0FBQztLQUNMO0FBQ0wsQ0FBQyxDQUFDO0FBak9XLFFBQUEsT0FBTyxXQWlPbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBTM0NsaWVudCwgR2V0T2JqZWN0Q29tbWFuZCwgUHV0T2JqZWN0Q29tbWFuZCwgRGVsZXRlT2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XG5pbXBvcnQgeyBDbG91ZEZyb250Q2xpZW50LCBDcmVhdGVJbnZhbGlkYXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZnJvbnQnO1xuaW1wb3J0IHsgbWFya2VkIH0gZnJvbSAnbWFya2VkJztcblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246ICd1cy1lYXN0LTEnIH0pO1xuY29uc3QgY2ZDbGllbnQgPSBuZXcgQ2xvdWRGcm9udENsaWVudCh7IHJlZ2lvbjogJ3VzLWVhc3QtMScgfSk7XG5cbmludGVyZmFjZSBBcHBseUZpeGVzRXZlbnQge1xuICAgIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIHNlbGVjdGVkRml4SWRzOiBzdHJpbmdbXTtcbiAgICBidWNrZXROYW1lPzogc3RyaW5nO1xuICAgIGRpc3RyaWJ1dGlvbklkPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxhbnksIGFueT4gPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAvLyBIYW5kbGUgQVBJIEdhdGV3YXkgVjIgcHJveHkgZXZlbnRcbiAgICBsZXQgaW5wdXQgPSBldmVudDtcbiAgICBpZiAoZXZlbnQuYm9keSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgaW5wdXQgPSB0eXBlb2YgZXZlbnQuYm9keSA9PT0gJ3N0cmluZycgPyBKU09OLnBhcnNlKGV2ZW50LmJvZHkpIDogZXZlbnQuYm9keTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdDb3VsZCBub3QgcGFyc2UgZXZlbnQgYm9keSwgdXNpbmcgZXZlbnQgYXMgaXMnKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHsgc2Vzc2lvbklkLCBzZWxlY3RlZEZpeElkcywgYnVja2V0TmFtZTogZXZlbnRCdWNrZXQsIGRpc3RyaWJ1dGlvbklkOiBldmVudERpc3QgfSA9IGlucHV0O1xuICAgIGNvbnN0IGFuYWx5c2lzQnVja2V0ID0gZXZlbnRCdWNrZXQgfHwgcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUIHx8ICdsZW5zeS1hbmFseXNpcy05NTE0MTE2NzY1MjUtdXMtZWFzdC0xJztcbiAgICBjb25zdCBkZW1vQnVja2V0ID0gcHJvY2Vzcy5lbnYuREVNT19CVUNLRVQgfHwgJ2xlbnN5LWRlbW8tZG9jcy05NTE0MTE2NzY1MjUnO1xuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbklkID0gZXZlbnREaXN0IHx8IHByb2Nlc3MuZW52LkRJU1RSSUJVVElPTl9JRCB8fCAnRTJaVEIyMktKVUlIOTMnO1xuXG4gICAgY29uc29sZS5sb2coYFN0YXJ0aW5nIEZpeCBBcHBsaWNhdGlvbiBmb3Igc2Vzc2lvbjogJHtzZXNzaW9uSWR9IChCdWNrZXQ6ICR7YW5hbHlzaXNCdWNrZXR9KWApO1xuICAgIGlmICghc2Vzc2lvbklkKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgICAgICBoZWFkZXJzOiB7ICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicgfSxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiAnc2Vzc2lvbklkIGlzIHJlcXVpcmVkJyB9KVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIC8vIDEuIEdldCBmaXhlcyBmcm9tIFMzXG4gICAgICAgIGNvbnN0IGZpeGVzS2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9maXhlcy5qc29uYDtcbiAgICAgICAgY29uc3QgZml4ZXNSZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoeyBCdWNrZXQ6IGFuYWx5c2lzQnVja2V0LCBLZXk6IGZpeGVzS2V5IH0pKTtcbiAgICAgICAgY29uc3QgZml4ZXNEYXRhID0gSlNPTi5wYXJzZShhd2FpdCBmaXhlc1Jlc3BvbnNlLkJvZHkhLnRyYW5zZm9ybVRvU3RyaW5nKCkpO1xuICAgICAgICBjb25zdCB7IGZpeGVzLCBkb2N1bWVudFVybCB9ID0gZml4ZXNEYXRhO1xuXG4gICAgICAgIC8vIEV4dHJhY3QgZmlsZW5hbWUgZnJvbSBVUkwgKGUuZy4sIGh0dHBzOi8vLi4uL2FwaS1yZWZlcmVuY2UubWQgLT4gYXBpLXJlZmVyZW5jZS5tZClcbiAgICAgICAgY29uc3QgZmlsZW5hbWUgPSBkb2N1bWVudFVybC5zcGxpdCgnLycpLnBvcCgpO1xuICAgICAgICBpZiAoIWZpbGVuYW1lKSB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBkZXRlcm1pbmUgZmlsZW5hbWUgZnJvbSBVUkwnKTtcblxuICAgICAgICAvLyAyLiBHZXQgb3JpZ2luYWwgZG9jdW1lbnQgZnJvbSBkZW1vIGJ1Y2tldFxuICAgICAgICBjb25zdCBkb2NSZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoeyBCdWNrZXQ6IGRlbW9CdWNrZXQsIEtleTogZmlsZW5hbWUgfSkpO1xuICAgICAgICBsZXQgY29udGVudCA9IGF3YWl0IGRvY1Jlc3BvbnNlLkJvZHkhLnRyYW5zZm9ybVRvU3RyaW5nKCk7XG5cbiAgICAgICAgLy8gMy4gQXBwbHkgc2VsZWN0ZWQgZml4ZXNcbiAgICAgICAgLy8gMy4gQXBwbHkgc2VsZWN0ZWQgZml4ZXNcbiAgICAgICAgY29uc3Qgc2VsZWN0ZWRGaXhlcyA9IGZpeGVzLmZpbHRlcigoZjogYW55KSA9PiBzZWxlY3RlZEZpeElkcy5pbmNsdWRlcyhmLmlkKSk7XG4gICAgICAgIGxldCBhcHBsaWVkRml4ZXM6IGFueVtdID0gW107XG5cbiAgICAgICAgZm9yIChjb25zdCBmaXggb2Ygc2VsZWN0ZWRGaXhlcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEF0dGVtcHRpbmcgdG8gYXBwbHkgZml4OiAke2ZpeC5pZH0gKCR7Zml4LmNhdGVnb3J5fSlgKTtcblxuICAgICAgICAgICAgLy8gU3RyYXRlZ3kgMTogRXhhY3QgbWF0Y2hcbiAgICAgICAgICAgIGlmIChjb250ZW50LmluY2x1ZGVzKGZpeC5vcmlnaW5hbENvbnRlbnQpKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShmaXgub3JpZ2luYWxDb250ZW50LCBmaXgucHJvcG9zZWRDb250ZW50KTtcbiAgICAgICAgICAgICAgICBhcHBsaWVkRml4ZXMucHVzaChmaXgpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDinIUgQXBwbGllZCBmaXggJHtmaXguaWR9IHZpYSBleGFjdCBtYXRjaGApO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTdHJhdGVneSAyOiBXaGl0ZXNwYWNlLXRvbGVyYW50IFJlZ2V4IG1hdGNoXG4gICAgICAgICAgICBjb25zdCBlc2NhcGVSZWdFeHAgPSAoc3RyaW5nOiBzdHJpbmcpID0+IHN0cmluZy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xuICAgICAgICAgICAgY29uc3QgcGF0dGVybiA9IGVzY2FwZVJlZ0V4cChmaXgub3JpZ2luYWxDb250ZW50LnRyaW0oKSkucmVwbGFjZSgvXFxzKy9nLCAnXFxcXHMrJyk7XG4gICAgICAgICAgICBjb25zdCByZWdleCA9IG5ldyBSZWdFeHAocGF0dGVybik7XG5cbiAgICAgICAgICAgIGlmIChyZWdleC50ZXN0KGNvbnRlbnQpKSB7XG4gICAgICAgICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShyZWdleCwgZml4LnByb3Bvc2VkQ29udGVudCk7XG4gICAgICAgICAgICAgICAgYXBwbGllZEZpeGVzLnB1c2goZml4KTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg4pyFIEFwcGxpZWQgZml4ICR7Zml4LmlkfSB2aWEgd2hpdGVzcGFjZS10b2xlcmFudCByZWdleGApO1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTdHJhdGVneSAzOiBOb3JtYWxpemVkIEZ1enp5IE1hdGNoIChzdHJpcHMgbm9uLWFscGhhbnVtZXJpYyBmb3IgZGlzY292ZXJ5KVxuICAgICAgICAgICAgLy8gVGhpcyBoYW5kbGVzIGNhc2VzIGxpa2UgJ0FycmF5JyB2cyAnQXJyYXk8RmluZGluZz4nIG9yIG1pbm9yIHB1bmN0dWF0aW9uIHNoaWZ0c1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplID0gKHN0cjogc3RyaW5nKSA9PiBzdHIucmVwbGFjZSgvW15hLXowLTldL2dpLCAnJykudG9Mb3dlckNhc2UoKTtcbiAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRPcmlnaW5hbCA9IG5vcm1hbGl6ZShmaXgub3JpZ2luYWxDb250ZW50KTtcblxuICAgICAgICAgICAgLy8gV2UgdXNlIGEgc2xpZGluZyB3aW5kb3ctaXNoIGFwcHJvYWNoIG9yIGp1c3Qgc2VhcmNoIGZvciB0aGUgbm9ybWFsaXplZCBzdHJpbmdcbiAgICAgICAgICAgIC8vIEZvciBzaW1wbGljaXR5IGFuZCBwZXJmb3JtYW5jZSwgd2UnbGwgdHJ5IHRvIGZpbmQgYSBibG9jayBvZiB0ZXh0IHRoYXQgbm9ybWFsaXplcyB0byB0aGUgc2FtZSB0aGluZ1xuICAgICAgICAgICAgLy8gU2luY2UgZG9jdW1lbnRzIGFyZW4ndCBodWdlLCB3ZSBjYW4gZG8gYSBsaW5lLWJ5LWxpbmUgb3IgYmxvY2sgc2VhcmNoIGlmIG5lZWRlZCwgXG4gICAgICAgICAgICAvLyBidXQgZmlyc3QgbGV0J3MgdHJ5IGEgc2ltcGxlciAnYnJva2VuIHJlZ2V4J1xuXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSByZWdleCB0aGF0IGFsbG93cyBhbnkgY2hhcmFjdGVycyBCRVRXRUVOIHRva2Vuc1xuICAgICAgICAgICAgY29uc3QgdG9rZW5zID0gZml4Lm9yaWdpbmFsQ29udGVudC50cmltKCkuc3BsaXQoL1xccysvKS5maWx0ZXIoKHQ6IHN0cmluZykgPT4gdC5sZW5ndGggPiAyKTtcbiAgICAgICAgICAgIGlmICh0b2tlbnMubGVuZ3RoID4gMikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZ1enp5UGF0dGVybiA9IHRva2Vucy5tYXAoKHQ6IHN0cmluZykgPT4gZXNjYXBlUmVnRXhwKHQpKS5qb2luKCcuezAsNTB9PycpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGZ1enp5UmVnZXggPSBuZXcgUmVnRXhwKGZ1enp5UGF0dGVybiwgJ3MnKTsgLy8gJ3MnIGZsYWcgZm9yIGRvdC1hbGwgKG1hdGNoaW5nIGFjcm9zcyBsaW5lcylcblxuICAgICAgICAgICAgICAgIGlmIChmdXp6eVJlZ2V4LnRlc3QoY29udGVudCkpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udGVudCA9IGNvbnRlbnQucmVwbGFjZShmdXp6eVJlZ2V4LCBmaXgucHJvcG9zZWRDb250ZW50KTtcbiAgICAgICAgICAgICAgICAgICAgYXBwbGllZEZpeGVzLnB1c2goZml4KTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBBcHBsaWVkIGZpeCAke2ZpeC5pZH0gdmlhIGZ1enp5IHRva2VuIG1hdGNoaW5nYCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZpeCAke2ZpeC5pZH0gTk9UIGFwcGxpZWQgLSBjb250ZW50IG5vdCBmb3VuZCBldmVuIHdpdGggZnV6enkgbWF0Y2hpbmdgKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYE9yaWdpbmFsIGNvbnRlbnQgc25pcHBldDogXCIke2ZpeC5vcmlnaW5hbENvbnRlbnQuc3Vic3RyaW5nKDAsIDUwKX0uLi5cImApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZpeCAke2ZpeC5pZH0gTk9UIGFwcGxpZWQgLSB0b28gc2hvcnQgZm9yIGZ1enp5IG1hdGNoaW5nYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyA0LiBVcGRhdGUgZG9jLWxldmVsIGNoYW5nZWxvZyBXSVRISU4gdGhlIGRvY3VtZW50XG4gICAgICAgIGxldCBjaGFuZ2Vsb2dNZXNzYWdlID0gJyc7XG4gICAgICAgIGlmIChhcHBsaWVkRml4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgY29uc3QgZGF0ZVN0ciA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdO1xuICAgICAgICAgICAgY29uc3QgZW50cnkgPSBgXFxuIyMjIFske2RhdGVTdHJ9XSAtIEFJIFVwZGF0ZVxcbi0gJHthcHBsaWVkRml4ZXMubGVuZ3RofSBmaXhlcyBhcHBsaWVkOlxcbiR7YXBwbGllZEZpeGVzLm1hcCgoZjogYW55KSA9PiBgICAtICR7Zi5jYXRlZ29yeX06ICR7Zi5yYXRpb25hbGV9YCkuam9pbignXFxuJyl9XFxuYDtcblxuICAgICAgICAgICAgLy8gQ2hlY2sgZm9yIGV4aXN0aW5nIENoYW5nZWxvZyBzZWN0aW9uXG4gICAgICAgICAgICBjb25zdCBjaGFuZ2Vsb2dIZWFkZXJSZWdleCA9IC8jI1xccytDaGFuZ2Vsb2cvaTtcbiAgICAgICAgICAgIGlmIChjaGFuZ2Vsb2dIZWFkZXJSZWdleC50ZXN0KGNvbnRlbnQpKSB7XG4gICAgICAgICAgICAgICAgLy8gSW5zZXJ0IGFmdGVyIHRoZSBoZWFkZXJcbiAgICAgICAgICAgICAgICBjb250ZW50ID0gY29udGVudC5yZXBsYWNlKGNoYW5nZWxvZ0hlYWRlclJlZ2V4LCBgIyMgQ2hhbmdlbG9nXFxuJHtlbnRyeX1gKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnQXBwZW5kZWQgdG8gZXhpc3RpbmcgQ2hhbmdlbG9nIHNlY3Rpb24nKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gQXBwZW5kIG5ldyBzZWN0aW9uIGJlZm9yZSBTdXBwb3J0IG9yIGF0IGVuZFxuICAgICAgICAgICAgICAgIGNvbnN0IHN1cHBvcnRSZWdleCA9IC8jI1xccytTdXBwb3J0L2k7XG4gICAgICAgICAgICAgICAgaWYgKHN1cHBvcnRSZWdleC50ZXN0KGNvbnRlbnQpKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQgPSBjb250ZW50LnJlcGxhY2Uoc3VwcG9ydFJlZ2V4LCBgIyMgQ2hhbmdlbG9nXFxuJHtlbnRyeX1cXG4tLS1cXG5cXG4jIyBTdXBwb3J0YCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdJbnNlcnRlZCBDaGFuZ2Vsb2cgc2VjdGlvbiBiZWZvcmUgU3VwcG9ydCcpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQgKz0gYFxcblxcbi0tLVxcblxcbiMjIENoYW5nZWxvZ1xcbiR7ZW50cnl9YDtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ0FwcGVuZGVkIENoYW5nZWxvZyBzZWN0aW9uIHRvIGVuZCBvZiBmaWxlJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2hhbmdlbG9nTWVzc2FnZSA9ICcgRG9jdW1lbnQgY2hhbmdlbG9nIHNlY3Rpb24gdXBkYXRlZC4nO1xuICAgICAgICB9XG5cblxuXG4gICAgICAgIC8vIDUuIFdyaXRlIHVwZGF0ZWQgY29udGVudCBiYWNrIHRvIFMzXG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBkZW1vQnVja2V0LFxuICAgICAgICAgICAgS2V5OiBmaWxlbmFtZSxcbiAgICAgICAgICAgIEJvZHk6IGNvbnRlbnQsXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ3RleHQvbWFya2Rvd24nXG4gICAgICAgIH0pKTtcblxuICAgICAgICAvLyA1Yi4gR2VuZXJhdGUgYW5kIFVwbG9hZCBIVE1MIHZlcnNpb25cbiAgICAgICAgY29uc3QgaHRtbEZpbGVuYW1lID0gZmlsZW5hbWUucmVwbGFjZSgvXFwubWQkLywgJy5odG1sJyk7XG4gICAgICAgIC8vIENvbnZlcnQgTWFya2Rvd24gdG8gSFRNTFxuICAgICAgICBjb25zdCBodG1sQm9keSA9IG1hcmtlZC5wYXJzZShjb250ZW50KTtcbiAgICAgICAgLy8gV3JhcCBpbiBHaXRIdWItc3R5bGUgdGVtcGxhdGVcbiAgICAgICAgY29uc3QgaHRtbENvbnRlbnQgPSBgPCFET0NUWVBFIGh0bWw+XG48aHRtbD5cbjxoZWFkPlxuPG1ldGEgY2hhcnNldD1cInV0Zi04XCI+XG48bWV0YSBuYW1lPVwidmlld3BvcnRcIiBjb250ZW50PVwid2lkdGg9ZGV2aWNlLXdpZHRoLCBpbml0aWFsLXNjYWxlPTFcIj5cbjx0aXRsZT4ke2ZpbGVuYW1lfTwvdGl0bGU+XG48bGluayByZWw9XCJzdHlsZXNoZWV0XCIgaHJlZj1cImh0dHBzOi8vY2RuanMuY2xvdWRmbGFyZS5jb20vYWpheC9saWJzL2dpdGh1Yi1tYXJrZG93bi1jc3MvNS4yLjAvZ2l0aHViLW1hcmtkb3duLWRhcmsubWluLmNzc1wiPlxuPHN0eWxlPlxuICAgIGJvZHkgeyBcbiAgICAgICAgYm94LXNpemluZzogYm9yZGVyLWJveDsgXG4gICAgICAgIG1pbi13aWR0aDogMjAwcHg7IFxuICAgICAgICBtYXgtd2lkdGg6IDk4MHB4OyBcbiAgICAgICAgbWFyZ2luOiAwIGF1dG87IFxuICAgICAgICBwYWRkaW5nOiA0NXB4OyBcbiAgICAgICAgYmFja2dyb3VuZC1jb2xvcjogIzBkMTExNzsgXG4gICAgICAgIGNvbG9yOiAjYzlkMWQ5O1xuICAgIH1cbiAgICBAbWVkaWEgKG1heC13aWR0aDogNzY3cHgpIHsgYm9keSB7IHBhZGRpbmc6IDE1cHg7IH0gfVxuPC9zdHlsZT5cbjwvaGVhZD5cbjxib2R5IGNsYXNzPVwibWFya2Rvd24tYm9keVwiPlxuICAgICR7aHRtbEJvZHl9XG48L2JvZHk+XG48L2h0bWw+YDtcblxuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogZGVtb0J1Y2tldCxcbiAgICAgICAgICAgIEtleTogaHRtbEZpbGVuYW1lLFxuICAgICAgICAgICAgQm9keTogaHRtbENvbnRlbnQsXG4gICAgICAgICAgICBDb250ZW50VHlwZTogJ3RleHQvaHRtbCdcbiAgICAgICAgfSkpO1xuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIEdlbmVyYXRlZCBhbmQgdXBsb2FkZWQgJHtodG1sRmlsZW5hbWV9YCk7XG5cbiAgICAgICAgLy8gNi4gSU5WQUxJREFURSBCQUNLRU5EIEFOQUxZU0lTIENBQ0hFXG4gICAgICAgIC8vIFdlIGRlbGV0ZSB0aGUgZGltZW5zaW9uIHJlc3VsdHMgYW5kIHByb2Nlc3NlZCBjb250ZW50IGZvciB0aGlzIHNlc3Npb25cbiAgICAgICAgLy8gdG8gZW5zdXJlIHRoZSBuZXh0IHNjYW4gaXMgZm9yY2VkIHRvIGJlIGZyZXNoLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEludmFsaWRhdGluZyBiYWNrZW5kIGFuYWx5c2lzIGNhY2hlIGZvciBzZXNzaW9uICR7c2Vzc2lvbklkfWApO1xuICAgICAgICAgICAgY29uc3QgZGVsZXRlUHJvbWlzZXMgPSBbXG4gICAgICAgICAgICAgICAgczNDbGllbnQuc2VuZChuZXcgRGVsZXRlT2JqZWN0Q29tbWFuZCh7IEJ1Y2tldDogYW5hbHlzaXNCdWNrZXQsIEtleTogYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9kaW1lbnNpb24tcmVzdWx0cy5qc29uYCB9KSksXG4gICAgICAgICAgICAgICAgczNDbGllbnQuc2VuZChuZXcgRGVsZXRlT2JqZWN0Q29tbWFuZCh7IEJ1Y2tldDogYW5hbHlzaXNCdWNrZXQsIEtleTogYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9wcm9jZXNzZWQtY29udGVudC5qc29uYCB9KSksXG4gICAgICAgICAgICAgICAgczNDbGllbnQuc2VuZChuZXcgRGVsZXRlT2JqZWN0Q29tbWFuZCh7IEJ1Y2tldDogYW5hbHlzaXNCdWNrZXQsIEtleTogYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9yZXBvcnQuanNvbmAgfSkpXG4gICAgICAgICAgICBdO1xuICAgICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGRlbGV0ZVByb21pc2VzKTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgQmFja2VuZCBhbmFseXNpcyBjYWNoZSBpbnZhbGlkYXRlZCcpO1xuICAgICAgICB9IGNhdGNoIChjYWNoZUVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ0ZhaWxlZCB0byBpbnZhbGlkYXRlIGJhY2tlbmQgYW5hbHlzaXMgY2FjaGU6JywgY2FjaGVFcnJvcik7XG4gICAgICAgIH1cblxuICAgICAgICAvLyA1LiBJbnZhbGlkYXRlIENsb3VkRnJvbnQgY2FjaGVcbiAgICAgICAgY29uc29sZS5sb2coYENyZWF0aW5nIGludmFsaWRhdGlvbiBmb3IgJHtkaXN0cmlidXRpb25JZH0gcGF0aCAvJHtmaWxlbmFtZX1gKTtcbiAgICAgICAgY29uc3QgaW52YWxpZGF0aW9uID0gYXdhaXQgY2ZDbGllbnQuc2VuZChuZXcgQ3JlYXRlSW52YWxpZGF0aW9uQ29tbWFuZCh7XG4gICAgICAgICAgICBEaXN0cmlidXRpb25JZDogZGlzdHJpYnV0aW9uSWQsXG4gICAgICAgICAgICBJbnZhbGlkYXRpb25CYXRjaDoge1xuICAgICAgICAgICAgICAgIENhbGxlclJlZmVyZW5jZTogYGludmFsaWRhdGUtJHtEYXRlLm5vdygpfWAsXG4gICAgICAgICAgICAgICAgUGF0aHM6IHtcbiAgICAgICAgICAgICAgICAgICAgSXRlbXM6IFtgLyR7ZmlsZW5hbWV9YCwgJy9DSEFOR0VMT0cubWQnLCBgLyR7ZmlsZW5hbWUucmVwbGFjZSgvXFwubWQkLywgJy5odG1sJyl9YF0sXG4gICAgICAgICAgICAgICAgICAgIFF1YW50aXR5OiAzXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBtZXNzYWdlOiBgQXBwbGllZCAke2FwcGxpZWRGaXhlcy5sZW5ndGh9IGZpeGVzIHRvICR7ZmlsZW5hbWV9LiR7Y2hhbmdlbG9nTWVzc2FnZX0gQ2xvdWRGcm9udCBjYWNoZSBwdXJnZSBzdGFydGVkIChJRDogJHtpbnZhbGlkYXRpb24uSW52YWxpZGF0aW9uPy5JZH0pYCxcbiAgICAgICAgICAgICAgICBmaWxlbmFtZSxcbiAgICAgICAgICAgICAgICBpbnZhbGlkYXRpb25JZDogaW52YWxpZGF0aW9uLkludmFsaWRhdGlvbj8uSWRcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGFwcGx5aW5nIGZpeGVzOicsIGVycm9yKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBlcnJvci5tZXNzYWdlIHx8ICdGYWlsZWQgdG8gYXBwbHkgZml4ZXMnIH0pXG4gICAgICAgIH07XG4gICAgfVxufTtcbiJdfQ==