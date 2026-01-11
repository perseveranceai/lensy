"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const handler = async (event) => {
    console.log('Structure detector received event:', JSON.stringify(event, null, 2));
    // Extract original parameters from Step Functions input
    const { url, selectedModel, sessionId, analysisStartTime } = event;
    console.log('Detecting document structure for:', url);
    try {
        const bucketName = process.env.ANALYSIS_BUCKET;
        if (!bucketName) {
            throw new Error('ANALYSIS_BUCKET environment variable not set');
        }
        // Retrieve processed content from S3
        const s3Key = `sessions/${sessionId}/processed-content.json`;
        const getResponse = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key
        }));
        const contentStr = await getResponse.Body.transformToString();
        const processedContent = JSON.parse(contentStr);
        console.log('Retrieved processed content from S3');
        // Use AI to analyze document structure
        const structure = await analyzeStructure(processedContent.markdownContent, processedContent.contentType, processedContent.linkAnalysis, event.selectedModel);
        // Store structure analysis in S3
        const structureKey = `sessions/${sessionId}/structure.json`;
        await s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucketName,
            Key: structureKey,
            Body: JSON.stringify(structure),
            ContentType: 'application/json'
        }));
        console.log('Structure detection completed:', structure.type);
        return {
            success: true,
            sessionId: sessionId,
            message: `Document structure analyzed: ${structure.type}`
        };
    }
    catch (error) {
        console.error('Structure detection failed:', error);
        return {
            success: false,
            sessionId: sessionId,
            message: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};
exports.handler = handler;
async function analyzeStructure(markdownContent, contentType, linkAnalysis, selectedModel) {
    const prompt = `Analyze this documentation content and identify its structure and topics.

Content Type: ${contentType}
Total Links: ${linkAnalysis.totalLinks}
Internal Links: ${linkAnalysis.internalLinks}
Sub-pages Referenced: ${linkAnalysis.subPagesIdentified.join(', ')}

Content Preview (first 2000 chars):
${markdownContent.slice(0, 2000)}

Please analyze:
1. Is this a single-topic or multi-topic document?
2. What are the main topics covered?
3. How confident are you in this analysis (0-100)?

Respond in JSON format:
{
  "type": "single_topic" or "multi_topic",
  "topics": [{"name": "topic name", "pageCount": 1, "urls": []}],
  "confidence": 85,
  "contentType": "api-docs" | "tutorial" | "reference" | "mixed"
}`;
    try {
        const modelId = getModelId(selectedModel);
        const requestBody = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            temperature: 0.1,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ]
        };
        const command = new client_bedrock_runtime_1.InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(requestBody)
        });
        console.log('Calling Bedrock API for structure analysis...');
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        console.log('Bedrock response:', JSON.stringify(responseBody, null, 2));
        // Extract the text content from Claude's response
        const textContent = responseBody.content[0].text;
        // Parse JSON from the response
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in AI response');
        }
        const structure = JSON.parse(jsonMatch[0]);
        return structure;
    }
    catch (error) {
        console.error('AI analysis failed, using fallback:', error);
        // Fallback to simple heuristic-based analysis
        return {
            type: linkAnalysis.subPagesIdentified.length > 3 ? 'multi_topic' : 'single_topic',
            topics: [{
                    name: 'Main Topic',
                    pageCount: 1,
                    urls: []
                }],
            confidence: 50,
            contentType: contentType
        };
    }
}
function getModelId(selectedModel) {
    const modelMap = {
        'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', // Cross-region inference profile
        'titan': 'amazon.titan-text-premier-v1:0',
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0', // Cross-region inference profile
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };
    return modelMap[selectedModel] || modelMap['claude'];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxrREFBa0Y7QUFDbEYsNEVBQTJGO0FBNEIzRixNQUFNLFFBQVEsR0FBRyxJQUFJLG9CQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQUNqRixNQUFNLGFBQWEsR0FBRyxJQUFJLDZDQUFvQixDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFFM0YsTUFBTSxPQUFPLEdBQTRDLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTtJQUM1RSxPQUFPLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBRWxGLHdEQUF3RDtJQUN4RCxNQUFNLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxTQUFTLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxLQUFLLENBQUM7SUFFbkUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQ0FBbUMsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUV0RCxJQUFJLENBQUM7UUFDRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQztRQUMvQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDZCxNQUFNLElBQUksS0FBSyxDQUFDLDhDQUE4QyxDQUFDLENBQUM7UUFDcEUsQ0FBQztRQUVELHFDQUFxQztRQUNyQyxNQUFNLEtBQUssR0FBRyxZQUFZLFNBQVMseUJBQXlCLENBQUM7UUFDN0QsTUFBTSxXQUFXLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksNEJBQWdCLENBQUM7WUFDekQsTUFBTSxFQUFFLFVBQVU7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QyxhQUFxQjtJQUNyQyxNQUFNLFFBQVEsR0FBMkI7UUFDckMsUUFBUSxFQUFFLDhDQUE4QyxFQUFHLGlDQUFpQztRQUM1RixPQUFPLEVBQUUsZ0NBQWdDO1FBQ3pDLE9BQU8sRUFBRSxvQ0FBb0MsRUFBRyxpQ0FBaUM7UUFDakYsTUFBTSxFQUFFLDhDQUE4QztLQUN6RCxDQUFDO0lBRUYsT0FBTyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ3pELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBTM0NsaWVudCwgR2V0T2JqZWN0Q29tbWFuZCwgUHV0T2JqZWN0Q29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zMyc7XG5pbXBvcnQgeyBCZWRyb2NrUnVudGltZUNsaWVudCwgSW52b2tlTW9kZWxDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZSc7XG5cbmludGVyZmFjZSBTdHJ1Y3R1cmVEZXRlY3RvckV2ZW50IHtcbiAgICB1cmw6IHN0cmluZztcbiAgICBzZWxlY3RlZE1vZGVsOiBzdHJpbmc7XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgYW5hbHlzaXNTdGFydFRpbWU6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFN0cnVjdHVyZURldGVjdG9yUmVzcG9uc2Uge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgVG9waWMge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBwYWdlQ291bnQ6IG51bWJlcjtcbiAgICB1cmxzOiBzdHJpbmdbXTtcbn1cblxuaW50ZXJmYWNlIERvY3VtZW50U3RydWN0dXJlIHtcbiAgICB0eXBlOiAnc2luZ2xlX3RvcGljJyB8ICdtdWx0aV90b3BpYyc7XG4gICAgdG9waWNzOiBUb3BpY1tdO1xuICAgIGNvbmZpZGVuY2U6IG51bWJlcjtcbiAgICBjb250ZW50VHlwZTogJ2FwaS1kb2NzJyB8ICd0dXRvcmlhbCcgfCAncmVmZXJlbmNlJyB8ICdtaXhlZCc7XG59XG5cbmNvbnN0IHMzQ2xpZW50ID0gbmV3IFMzQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuY29uc3QgYmVkcm9ja0NsaWVudCA9IG5ldyBCZWRyb2NrUnVudGltZUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8YW55LCBTdHJ1Y3R1cmVEZXRlY3RvclJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xuICAgIGNvbnNvbGUubG9nKCdTdHJ1Y3R1cmUgZGV0ZWN0b3IgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcblxuICAgIC8vIEV4dHJhY3Qgb3JpZ2luYWwgcGFyYW1ldGVycyBmcm9tIFN0ZXAgRnVuY3Rpb25zIGlucHV0XG4gICAgY29uc3QgeyB1cmwsIHNlbGVjdGVkTW9kZWwsIHNlc3Npb25JZCwgYW5hbHlzaXNTdGFydFRpbWUgfSA9IGV2ZW50O1xuXG4gICAgY29uc29sZS5sb2coJ0RldGVjdGluZyBkb2N1bWVudCBzdHJ1Y3R1cmUgZm9yOicsIHVybCk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBidWNrZXROYW1lID0gcHJvY2Vzcy5lbnYuQU5BTFlTSVNfQlVDS0VUO1xuICAgICAgICBpZiAoIWJ1Y2tldE5hbWUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQU5BTFlTSVNfQlVDS0VUIGVudmlyb25tZW50IHZhcmlhYmxlIG5vdCBzZXQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFJldHJpZXZlIHByb2Nlc3NlZCBjb250ZW50IGZyb20gUzNcbiAgICAgICAgY29uc3QgczNLZXkgPSBgc2Vzc2lvbnMvJHtzZXNzaW9uSWR9L3Byb2Nlc3NlZC1jb250ZW50Lmpzb25gO1xuICAgICAgICBjb25zdCBnZXRSZXNwb25zZSA9IGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IEdldE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBzM0tleVxuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc3QgY29udGVudFN0ciA9IGF3YWl0IGdldFJlc3BvbnNlLkJvZHkhLnRyYW5zZm9ybVRvU3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IHByb2Nlc3NlZENvbnRlbnQgPSBKU09OLnBhcnNlKGNvbnRlbnRTdHIpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdSZXRyaWV2ZWQgcHJvY2Vzc2VkIGNvbnRlbnQgZnJvbSBTMycpO1xuXG4gICAgICAgIC8vIFVzZSBBSSB0byBhbmFseXplIGRvY3VtZW50IHN0cnVjdHVyZVxuICAgICAgICBjb25zdCBzdHJ1Y3R1cmUgPSBhd2FpdCBhbmFseXplU3RydWN0dXJlKFxuICAgICAgICAgICAgcHJvY2Vzc2VkQ29udGVudC5tYXJrZG93bkNvbnRlbnQsXG4gICAgICAgICAgICBwcm9jZXNzZWRDb250ZW50LmNvbnRlbnRUeXBlLFxuICAgICAgICAgICAgcHJvY2Vzc2VkQ29udGVudC5saW5rQW5hbHlzaXMsXG4gICAgICAgICAgICBldmVudC5zZWxlY3RlZE1vZGVsXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gU3RvcmUgc3RydWN0dXJlIGFuYWx5c2lzIGluIFMzXG4gICAgICAgIGNvbnN0IHN0cnVjdHVyZUtleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vc3RydWN0dXJlLmpzb25gO1xuICAgICAgICBhd2FpdCBzM0NsaWVudC5zZW5kKG5ldyBQdXRPYmplY3RDb21tYW5kKHtcbiAgICAgICAgICAgIEJ1Y2tldDogYnVja2V0TmFtZSxcbiAgICAgICAgICAgIEtleTogc3RydWN0dXJlS2V5LFxuICAgICAgICAgICAgQm9keTogSlNPTi5zdHJpbmdpZnkoc3RydWN0dXJlKSxcbiAgICAgICAgICAgIENvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgfSkpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdTdHJ1Y3R1cmUgZGV0ZWN0aW9uIGNvbXBsZXRlZDonLCBzdHJ1Y3R1cmUudHlwZSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IHNlc3Npb25JZCxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBEb2N1bWVudCBzdHJ1Y3R1cmUgYW5hbHl6ZWQ6ICR7c3RydWN0dXJlLnR5cGV9YFxuICAgICAgICB9O1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignU3RydWN0dXJlIGRldGVjdGlvbiBmYWlsZWQ6JywgZXJyb3IpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IHNlc3Npb25JZCxcbiAgICAgICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXG4gICAgICAgIH07XG4gICAgfVxufTtcblxuYXN5bmMgZnVuY3Rpb24gYW5hbHl6ZVN0cnVjdHVyZShcbiAgICBtYXJrZG93bkNvbnRlbnQ6IHN0cmluZyxcbiAgICBjb250ZW50VHlwZTogc3RyaW5nLFxuICAgIGxpbmtBbmFseXNpczogYW55LFxuICAgIHNlbGVjdGVkTW9kZWw6IHN0cmluZ1xuKTogUHJvbWlzZTxEb2N1bWVudFN0cnVjdHVyZT4ge1xuICAgIGNvbnN0IHByb21wdCA9IGBBbmFseXplIHRoaXMgZG9jdW1lbnRhdGlvbiBjb250ZW50IGFuZCBpZGVudGlmeSBpdHMgc3RydWN0dXJlIGFuZCB0b3BpY3MuXG5cbkNvbnRlbnQgVHlwZTogJHtjb250ZW50VHlwZX1cblRvdGFsIExpbmtzOiAke2xpbmtBbmFseXNpcy50b3RhbExpbmtzfVxuSW50ZXJuYWwgTGlua3M6ICR7bGlua0FuYWx5c2lzLmludGVybmFsTGlua3N9XG5TdWItcGFnZXMgUmVmZXJlbmNlZDogJHtsaW5rQW5hbHlzaXMuc3ViUGFnZXNJZGVudGlmaWVkLmpvaW4oJywgJyl9XG5cbkNvbnRlbnQgUHJldmlldyAoZmlyc3QgMjAwMCBjaGFycyk6XG4ke21hcmtkb3duQ29udGVudC5zbGljZSgwLCAyMDAwKX1cblxuUGxlYXNlIGFuYWx5emU6XG4xLiBJcyB0aGlzIGEgc2luZ2xlLXRvcGljIG9yIG11bHRpLXRvcGljIGRvY3VtZW50P1xuMi4gV2hhdCBhcmUgdGhlIG1haW4gdG9waWNzIGNvdmVyZWQ/XG4zLiBIb3cgY29uZmlkZW50IGFyZSB5b3UgaW4gdGhpcyBhbmFseXNpcyAoMC0xMDApP1xuXG5SZXNwb25kIGluIEpTT04gZm9ybWF0Olxue1xuICBcInR5cGVcIjogXCJzaW5nbGVfdG9waWNcIiBvciBcIm11bHRpX3RvcGljXCIsXG4gIFwidG9waWNzXCI6IFt7XCJuYW1lXCI6IFwidG9waWMgbmFtZVwiLCBcInBhZ2VDb3VudFwiOiAxLCBcInVybHNcIjogW119XSxcbiAgXCJjb25maWRlbmNlXCI6IDg1LFxuICBcImNvbnRlbnRUeXBlXCI6IFwiYXBpLWRvY3NcIiB8IFwidHV0b3JpYWxcIiB8IFwicmVmZXJlbmNlXCIgfCBcIm1peGVkXCJcbn1gO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbW9kZWxJZCA9IGdldE1vZGVsSWQoc2VsZWN0ZWRNb2RlbCk7XG5cbiAgICAgICAgY29uc3QgcmVxdWVzdEJvZHkgPSB7XG4gICAgICAgICAgICBhbnRocm9waWNfdmVyc2lvbjogXCJiZWRyb2NrLTIwMjMtMDUtMzFcIixcbiAgICAgICAgICAgIG1heF90b2tlbnM6IDEwMDAsXG4gICAgICAgICAgICB0ZW1wZXJhdHVyZTogMC4xLFxuICAgICAgICAgICAgbWVzc2FnZXM6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwcm9tcHRcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VNb2RlbENvbW1hbmQoe1xuICAgICAgICAgICAgbW9kZWxJZCxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBhY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHJlcXVlc3RCb2R5KVxuICAgICAgICB9KTtcblxuICAgICAgICBjb25zb2xlLmxvZygnQ2FsbGluZyBCZWRyb2NrIEFQSSBmb3Igc3RydWN0dXJlIGFuYWx5c2lzLi4uJyk7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYmVkcm9ja0NsaWVudC5zZW5kKGNvbW1hbmQpO1xuICAgICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5ib2R5KSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coJ0JlZHJvY2sgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2VCb2R5LCBudWxsLCAyKSk7XG5cbiAgICAgICAgLy8gRXh0cmFjdCB0aGUgdGV4dCBjb250ZW50IGZyb20gQ2xhdWRlJ3MgcmVzcG9uc2VcbiAgICAgICAgY29uc3QgdGV4dENvbnRlbnQgPSByZXNwb25zZUJvZHkuY29udGVudFswXS50ZXh0O1xuXG4gICAgICAgIC8vIFBhcnNlIEpTT04gZnJvbSB0aGUgcmVzcG9uc2VcbiAgICAgICAgY29uc3QganNvbk1hdGNoID0gdGV4dENvbnRlbnQubWF0Y2goL1xce1tcXHNcXFNdKlxcfS8pO1xuICAgICAgICBpZiAoIWpzb25NYXRjaCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBKU09OIGZvdW5kIGluIEFJIHJlc3BvbnNlJyk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdHJ1Y3R1cmUgPSBKU09OLnBhcnNlKGpzb25NYXRjaFswXSk7XG5cbiAgICAgICAgcmV0dXJuIHN0cnVjdHVyZTtcblxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0FJIGFuYWx5c2lzIGZhaWxlZCwgdXNpbmcgZmFsbGJhY2s6JywgZXJyb3IpO1xuXG4gICAgICAgIC8vIEZhbGxiYWNrIHRvIHNpbXBsZSBoZXVyaXN0aWMtYmFzZWQgYW5hbHlzaXNcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IGxpbmtBbmFseXNpcy5zdWJQYWdlc0lkZW50aWZpZWQubGVuZ3RoID4gMyA/ICdtdWx0aV90b3BpYycgOiAnc2luZ2xlX3RvcGljJyxcbiAgICAgICAgICAgIHRvcGljczogW3tcbiAgICAgICAgICAgICAgICBuYW1lOiAnTWFpbiBUb3BpYycsXG4gICAgICAgICAgICAgICAgcGFnZUNvdW50OiAxLFxuICAgICAgICAgICAgICAgIHVybHM6IFtdXG4gICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIGNvbmZpZGVuY2U6IDUwLFxuICAgICAgICAgICAgY29udGVudFR5cGU6IGNvbnRlbnRUeXBlIGFzIGFueVxuICAgICAgICB9O1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZ2V0TW9kZWxJZChzZWxlY3RlZE1vZGVsOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG1vZGVsTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICAnY2xhdWRlJzogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJywgIC8vIENyb3NzLXJlZ2lvbiBpbmZlcmVuY2UgcHJvZmlsZVxuICAgICAgICAndGl0YW4nOiAnYW1hem9uLnRpdGFuLXRleHQtcHJlbWllci12MTowJyxcbiAgICAgICAgJ2xsYW1hJzogJ3VzLm1ldGEubGxhbWEzLTEtNzBiLWluc3RydWN0LXYxOjAnLCAgLy8gQ3Jvc3MtcmVnaW9uIGluZmVyZW5jZSBwcm9maWxlXG4gICAgICAgICdhdXRvJzogJ3VzLmFudGhyb3BpYy5jbGF1ZGUtMy01LXNvbm5ldC0yMDI0MTAyMi12MjowJ1xuICAgIH07XG5cbiAgICByZXR1cm4gbW9kZWxNYXBbc2VsZWN0ZWRNb2RlbF0gfHwgbW9kZWxNYXBbJ2NsYXVkZSddO1xufSJdfQ==