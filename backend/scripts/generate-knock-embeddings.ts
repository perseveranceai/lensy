import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import https from 'https';

const s3Client = new S3Client({ region: 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

interface RichContentEmbedding {
    url: string;
    title: string;
    description: string;
    content: string;
    embedding: number[];
}

/**
 * Make HTTPS request
 */
function makeHttpRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

/**
 * Generate embedding for text using Amazon Bedrock Titan
 */
async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const input = {
            modelId: 'amazon.titan-embed-text-v1',
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                inputText: text
            })
        };

        const command = new InvokeModelCommand(input);
        const response = await bedrockClient.send(command);

        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        return responseBody.embedding;
    } catch (error) {
        console.error('Error generating embedding:', error);
        throw error;
    }
}

/**
 * Extract page content from HTML
 */
function extractPageContent(html: string): { title: string; description: string; content: string } {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["'][^>]*>/i);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract main content (remove scripts, styles, nav, footer)
    let content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Limit content length for embedding
    if (content.length > 8000) {
        content = content.substring(0, 8000) + '...';
    }

    return { title, description, content };
}

/**
 * Fetch sitemap and extract URLs
 */
async function fetchSitemap(): Promise<string[]> {
    const sitemapUrl = 'https://docs.knock.app/sitemap.xml';
    console.log(`Fetching sitemap from: ${sitemapUrl}`);

    const xml = await makeHttpRequest(sitemapUrl);
    const urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];

    const urls = urlMatches.map(match => {
        const url = match.replace(/<\/?loc>/g, '');
        return url;
    });

    console.log(`Found ${urls.length} URLs in sitemap`);
    return urls;
}

/**
 * Fetch page content
 */
async function fetchPageContent(url: string): Promise<string | null> {
    try {
        return await makeHttpRequest(url);
    } catch (error) {
        console.error(`Failed to fetch ${url}:`, error);
        return null;
    }
}

/**
 * Main function to generate embeddings
 */
async function main() {
    console.log('🚀 Starting Knock.app documentation embedding generation...\n');

    const startTime = Date.now();
    const urls = await fetchSitemap();
    const embeddings: RichContentEmbedding[] = [];

    console.log(`\n📄 Processing ${urls.length} pages...\n`);

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const progress = `[${i + 1}/${urls.length}]`;

        try {
            const html = await fetchPageContent(url);
            if (!html) {
                console.log(`${progress} ⏭️  Skipped: ${url} (fetch failed)`);
                continue;
            }

            const { title, description, content } = extractPageContent(html);

            // Combine title, description, and content for embedding
            const textForEmbedding = `${title} ${description} ${content}`.trim();

            if (textForEmbedding.length < 10) {
                console.log(`${progress} ⏭️  Skipped: ${url} (minimal content)`);
                continue;
            }

            const embedding = await generateEmbedding(textForEmbedding);

            // Extract pathname for storage
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;

            embeddings.push({
                url: pathname,
                title,
                description,
                content,
                embedding
            });

            console.log(`${progress} ✅ Generated: ${pathname} (${title.substring(0, 50)}...)`);

            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
            console.error(`${progress} ❌ Failed: ${url}`, error);
        }
    }

    console.log(`\n📊 Generated ${embeddings.length} embeddings\n`);

    // Store embeddings in S3
    const bucketName = 'lensy-analysis-951411676525-us-east-1';
    const embeddingsKey = 'rich-content-embeddings-docs-knock-app.json';

    try {
        const putCommand = new PutObjectCommand({
            Bucket: bucketName,
            Key: embeddingsKey,
            Body: JSON.stringify(embeddings, null, 2),
            ContentType: 'application/json'
        });

        await s3Client.send(putCommand);

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Stored embeddings in S3: s3://${bucketName}/${embeddingsKey}`);
        console.log(`⏱️  Total time: ${elapsedTime}s`);
        console.log(`📦 File size: ${(JSON.stringify(embeddings).length / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
        console.error('❌ Failed to store embeddings in S3:', error);
        throw error;
    }
}

main().catch(console.error);
