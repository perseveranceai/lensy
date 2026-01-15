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
        'claude': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
        'titan': 'amazon.titan-text-premier-v1:0',
        'llama': 'us.meta.llama3-1-70b-instruct-v1:0',
        'auto': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
    };
    return modelMap[selectedModel] || modelMap['claude'];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvc3RydWN0dXJlLWRldGVjdG9yL2luZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUNBLGtEQUFrRjtBQUNsRiw0RUFBMkY7QUE0QjNGLE1BQU0sUUFBUSxHQUFHLElBQUksb0JBQVEsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBQ2pGLE1BQU0sYUFBYSxHQUFHLElBQUksNkNBQW9CLENBQUMsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVyxFQUFFLENBQUMsQ0FBQztBQUUzRixNQUFNLE9BQU8sR0FBNEMsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFO0lBQzVFLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0NBQW9DLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFbEYsd0RBQXdEO0lBQ3hELE1BQU0sRUFBRSxHQUFHLEVBQUUsYUFBYSxFQUFFLFNBQVMsRUFBRSxpQkFBaUIsRUFBRSxHQUFHLEtBQUssQ0FBQztJQUVuRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBRXRELElBQUk7UUFDQSxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQztRQUMvQyxJQUFJLENBQUMsVUFBVSxFQUFFO1lBQ2IsTUFBTSxJQUFJLEtBQUssQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO1NBQ25FO1FBRUQscUNBQXFDO1FBQ3JDLE1BQU0sS0FBSyxHQUFHLFlBQVksU0FBUyx5QkFBeUIsQ0FBQztRQUM3RCxNQUFNLFdBQVcsR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBZ0IsQ0FBQztZ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QUEyQjtRQUNyQyxRQUFRLEVBQUUsOENBQThDO1FBQ3hELE9BQU8sRUFBRSxnQ0FBZ0M7UUFDekMsT0FBTyxFQUFFLG9DQUFvQztRQUM3QyxNQUFNLEVBQUUsOENBQThDO0tBQ3pELENBQUM7SUFFRixPQUFPLFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7QUFDekQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IFMzQ2xpZW50LCBHZXRPYmplY3RDb21tYW5kLCBQdXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcbmltcG9ydCB7IEJlZHJvY2tSdW50aW1lQ2xpZW50LCBJbnZva2VNb2RlbENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtYmVkcm9jay1ydW50aW1lJztcblxuaW50ZXJmYWNlIFN0cnVjdHVyZURldGVjdG9yRXZlbnQge1xuICAgIHVybDogc3RyaW5nO1xuICAgIHNlbGVjdGVkTW9kZWw6IHN0cmluZztcbiAgICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgICBhbmFseXNpc1N0YXJ0VGltZTogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgU3RydWN0dXJlRGV0ZWN0b3JSZXNwb25zZSB7XG4gICAgc3VjY2VzczogYm9vbGVhbjtcbiAgICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBUb3BpYyB7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIHBhZ2VDb3VudDogbnVtYmVyO1xuICAgIHVybHM6IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgRG9jdW1lbnRTdHJ1Y3R1cmUge1xuICAgIHR5cGU6ICdzaW5nbGVfdG9waWMnIHwgJ211bHRpX3RvcGljJztcbiAgICB0b3BpY3M6IFRvcGljW107XG4gICAgY29uZmlkZW5jZTogbnVtYmVyO1xuICAgIGNvbnRlbnRUeXBlOiAnYXBpLWRvY3MnIHwgJ3R1dG9yaWFsJyB8ICdyZWZlcmVuY2UnIHwgJ21peGVkJztcbn1cblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScgfSk7XG5jb25zdCBiZWRyb2NrQ2xpZW50ID0gbmV3IEJlZHJvY2tSdW50aW1lQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxhbnksIFN0cnVjdHVyZURldGVjdG9yUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gICAgY29uc29sZS5sb2coJ1N0cnVjdHVyZSBkZXRlY3RvciByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuXG4gICAgLy8gRXh0cmFjdCBvcmlnaW5hbCBwYXJhbWV0ZXJzIGZyb20gU3RlcCBGdW5jdGlvbnMgaW5wdXRcbiAgICBjb25zdCB7IHVybCwgc2VsZWN0ZWRNb2RlbCwgc2Vzc2lvbklkLCBhbmFseXNpc1N0YXJ0VGltZSB9ID0gZXZlbnQ7XG5cbiAgICBjb25zb2xlLmxvZygnRGV0ZWN0aW5nIGRvY3VtZW50IHN0cnVjdHVyZSBmb3I6JywgdXJsKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwcm9jZXNzLmVudi5BTkFMWVNJU19CVUNLRVQ7XG4gICAgICAgIGlmICghYnVja2V0TmFtZSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBTkFMWVNJU19CVUNLRVQgZW52aXJvbm1lbnQgdmFyaWFibGUgbm90IHNldCcpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmV0cmlldmUgcHJvY2Vzc2VkIGNvbnRlbnQgZnJvbSBTM1xuICAgICAgICBjb25zdCBzM0tleSA9IGBzZXNzaW9ucy8ke3Nlc3Npb25JZH0vcHJvY2Vzc2VkLWNvbnRlbnQuanNvbmA7XG4gICAgICAgIGNvbnN0IGdldFJlc3BvbnNlID0gYXdhaXQgczNDbGllbnQuc2VuZChuZXcgR2V0T2JqZWN0Q29tbWFuZCh7XG4gICAgICAgICAgICBCdWNrZXQ6IGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBLZXk6IHMzS2V5XG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zdCBjb250ZW50U3RyID0gYXdhaXQgZ2V0UmVzcG9uc2UuQm9keSEudHJhbnNmb3JtVG9TdHJpbmcoKTtcbiAgICAgICAgY29uc3QgcHJvY2Vzc2VkQ29udGVudCA9IEpTT04ucGFyc2UoY29udGVudFN0cik7XG5cbiAgICAgICAgY29uc29sZS5sb2coJ1JldHJpZXZlZCBwcm9jZXNzZWQgY29udGVudCBmcm9tIFMzJyk7XG5cbiAgICAgICAgLy8gVXNlIEFJIHRvIGFuYWx5emUgZG9jdW1lbnQgc3RydWN0dXJlXG4gICAgICAgIGNvbnN0IHN0cnVjdHVyZSA9IGF3YWl0IGFuYWx5emVTdHJ1Y3R1cmUoXG4gICAgICAgICAgICBwcm9jZXNzZWRDb250ZW50Lm1hcmtkb3duQ29udGVudCxcbiAgICAgICAgICAgIHByb2Nlc3NlZENvbnRlbnQuY29udGVudFR5cGUsXG4gICAgICAgICAgICBwcm9jZXNzZWRDb250ZW50LmxpbmtBbmFseXNpcyxcbiAgICAgICAgICAgIGV2ZW50LnNlbGVjdGVkTW9kZWxcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBTdG9yZSBzdHJ1Y3R1cmUgYW5hbHlzaXMgaW4gUzNcbiAgICAgICAgY29uc3Qgc3RydWN0dXJlS2V5ID0gYHNlc3Npb25zLyR7c2Vzc2lvbklkfS9zdHJ1Y3R1cmUuanNvbmA7XG4gICAgICAgIGF3YWl0IHMzQ2xpZW50LnNlbmQobmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgICAgICAgQnVja2V0OiBidWNrZXROYW1lLFxuICAgICAgICAgICAgS2V5OiBzdHJ1Y3R1cmVLZXksXG4gICAgICAgICAgICBCb2R5OiBKU09OLnN0cmluZ2lmeShzdHJ1Y3R1cmUpLFxuICAgICAgICAgICAgQ29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJ1xuICAgICAgICB9KSk7XG5cbiAgICAgICAgY29uc29sZS5sb2coJ1N0cnVjdHVyZSBkZXRlY3Rpb24gY29tcGxldGVkOicsIHN0cnVjdHVyZS50eXBlKTtcblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIHNlc3Npb25JZDogc2Vzc2lvbklkLFxuICAgICAgICAgICAgbWVzc2FnZTogYERvY3VtZW50IHN0cnVjdHVyZSBhbmFseXplZDogJHtzdHJ1Y3R1cmUudHlwZX1gXG4gICAgICAgIH07XG5cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdTdHJ1Y3R1cmUgZGV0ZWN0aW9uIGZhaWxlZDonLCBlcnJvcik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIHNlc3Npb25JZDogc2Vzc2lvbklkLFxuICAgICAgICAgICAgbWVzc2FnZTogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvcidcbiAgICAgICAgfTtcbiAgICB9XG59O1xuXG5hc3luYyBmdW5jdGlvbiBhbmFseXplU3RydWN0dXJlKFxuICAgIG1hcmtkb3duQ29udGVudDogc3RyaW5nLFxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICAgbGlua0FuYWx5c2lzOiBhbnksXG4gICAgc2VsZWN0ZWRNb2RlbDogc3RyaW5nXG4pOiBQcm9taXNlPERvY3VtZW50U3RydWN0dXJlPiB7XG4gICAgY29uc3QgcHJvbXB0ID0gYEFuYWx5emUgdGhpcyBkb2N1bWVudGF0aW9uIGNvbnRlbnQgYW5kIGlkZW50aWZ5IGl0cyBzdHJ1Y3R1cmUgYW5kIHRvcGljcy5cblxuQ29udGVudCBUeXBlOiAke2NvbnRlbnRUeXBlfVxuVG90YWwgTGlua3M6ICR7bGlua0FuYWx5c2lzLnRvdGFsTGlua3N9XG5JbnRlcm5hbCBMaW5rczogJHtsaW5rQW5hbHlzaXMuaW50ZXJuYWxMaW5rc31cblN1Yi1wYWdlcyBSZWZlcmVuY2VkOiAke2xpbmtBbmFseXNpcy5zdWJQYWdlc0lkZW50aWZpZWQuam9pbignLCAnKX1cblxuQ29udGVudCBQcmV2aWV3IChmaXJzdCAyMDAwIGNoYXJzKTpcbiR7bWFya2Rvd25Db250ZW50LnNsaWNlKDAsIDIwMDApfVxuXG5QbGVhc2UgYW5hbHl6ZTpcbjEuIElzIHRoaXMgYSBzaW5nbGUtdG9waWMgb3IgbXVsdGktdG9waWMgZG9jdW1lbnQ/XG4yLiBXaGF0IGFyZSB0aGUgbWFpbiB0b3BpY3MgY292ZXJlZD9cbjMuIEhvdyBjb25maWRlbnQgYXJlIHlvdSBpbiB0aGlzIGFuYWx5c2lzICgwLTEwMCk/XG5cblJlc3BvbmQgaW4gSlNPTiBmb3JtYXQ6XG57XG4gIFwidHlwZVwiOiBcInNpbmdsZV90b3BpY1wiIG9yIFwibXVsdGlfdG9waWNcIixcbiAgXCJ0b3BpY3NcIjogW3tcIm5hbWVcIjogXCJ0b3BpYyBuYW1lXCIsIFwicGFnZUNvdW50XCI6IDEsIFwidXJsc1wiOiBbXX1dLFxuICBcImNvbmZpZGVuY2VcIjogODUsXG4gIFwiY29udGVudFR5cGVcIjogXCJhcGktZG9jc1wiIHwgXCJ0dXRvcmlhbFwiIHwgXCJyZWZlcmVuY2VcIiB8IFwibWl4ZWRcIlxufWA7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCBtb2RlbElkID0gZ2V0TW9kZWxJZChzZWxlY3RlZE1vZGVsKTtcblxuICAgICAgICBjb25zdCByZXF1ZXN0Qm9keSA9IHtcbiAgICAgICAgICAgIGFudGhyb3BpY192ZXJzaW9uOiBcImJlZHJvY2stMjAyMy0wNS0zMVwiLFxuICAgICAgICAgICAgbWF4X3Rva2VuczogMTAwMCxcbiAgICAgICAgICAgIHRlbXBlcmF0dXJlOiAwLjEsXG4gICAgICAgICAgICBtZXNzYWdlczogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHByb21wdFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZU1vZGVsQ29tbWFuZCh7XG4gICAgICAgICAgICBtb2RlbElkLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdEJvZHkpXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKCdDYWxsaW5nIEJlZHJvY2sgQVBJIGZvciBzdHJ1Y3R1cmUgYW5hbHlzaXMuLi4nKTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBiZWRyb2NrQ2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLmJvZHkpKTtcblxuICAgICAgICBjb25zb2xlLmxvZygnQmVkcm9jayByZXNwb25zZTonLCBKU09OLnN0cmluZ2lmeShyZXNwb25zZUJvZHksIG51bGwsIDIpKTtcblxuICAgICAgICAvLyBFeHRyYWN0IHRoZSB0ZXh0IGNvbnRlbnQgZnJvbSBDbGF1ZGUncyByZXNwb25zZVxuICAgICAgICBjb25zdCB0ZXh0Q29udGVudCA9IHJlc3BvbnNlQm9keS5jb250ZW50WzBdLnRleHQ7XG5cbiAgICAgICAgLy8gUGFyc2UgSlNPTiBmcm9tIHRoZSByZXNwb25zZVxuICAgICAgICBjb25zdCBqc29uTWF0Y2ggPSB0ZXh0Q29udGVudC5tYXRjaCgvXFx7W1xcc1xcU10qXFx9Lyk7XG4gICAgICAgIGlmICghanNvbk1hdGNoKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIEpTT04gZm91bmQgaW4gQUkgcmVzcG9uc2UnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHN0cnVjdHVyZSA9IEpTT04ucGFyc2UoanNvbk1hdGNoWzBdKTtcblxuICAgICAgICByZXR1cm4gc3RydWN0dXJlO1xuXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignQUkgYW5hbHlzaXMgZmFpbGVkLCB1c2luZyBmYWxsYmFjazonLCBlcnJvcik7XG5cbiAgICAgICAgLy8gRmFsbGJhY2sgdG8gc2ltcGxlIGhldXJpc3RpYy1iYXNlZCBhbmFseXNpc1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgdHlwZTogbGlua0FuYWx5c2lzLnN1YlBhZ2VzSWRlbnRpZmllZC5sZW5ndGggPiAzID8gJ211bHRpX3RvcGljJyA6ICdzaW5nbGVfdG9waWMnLFxuICAgICAgICAgICAgdG9waWNzOiBbe1xuICAgICAgICAgICAgICAgIG5hbWU6ICdNYWluIFRvcGljJyxcbiAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IDEsXG4gICAgICAgICAgICAgICAgdXJsczogW11cbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgY29uZmlkZW5jZTogNTAsXG4gICAgICAgICAgICBjb250ZW50VHlwZTogY29udGVudFR5cGUgYXMgYW55XG4gICAgICAgIH07XG4gICAgfVxufVxuXG5mdW5jdGlvbiBnZXRNb2RlbElkKHNlbGVjdGVkTW9kZWw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgbW9kZWxNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgICdjbGF1ZGUnOiAndXMuYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LTIwMjQxMDIyLXYyOjAnLCAgLy8gQ3Jvc3MtcmVnaW9uIGluZmVyZW5jZSBwcm9maWxlXG4gICAgICAgICd0aXRhbic6ICdhbWF6b24udGl0YW4tdGV4dC1wcmVtaWVyLXYxOjAnLFxuICAgICAgICAnbGxhbWEnOiAndXMubWV0YS5sbGFtYTMtMS03MGItaW5zdHJ1Y3QtdjE6MCcsICAvLyBDcm9zcy1yZWdpb24gaW5mZXJlbmNlIHByb2ZpbGVcbiAgICAgICAgJ2F1dG8nOiAndXMuYW50aHJvcGljLmNsYXVkZS0zLTUtc29ubmV0LTIwMjQxMDIyLXYyOjAnXG4gICAgfTtcblxuICAgIHJldHVybiBtb2RlbE1hcFtzZWxlY3RlZE1vZGVsXSB8fCBtb2RlbE1hcFsnY2xhdWRlJ107XG59Il19