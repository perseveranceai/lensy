const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');


const BUCKET_NAME = 'lensy-demo-docs-951411676525';
const CLOUDFRONT_DOMAIN = 'https://d9gphnvbmrso2.cloudfront.net';
const DISTRIBUTION_ID = 'E138332152M5Z2'; // I need to find this, or pass it as arg. 
// Actually, I don't have the distribution ID handy. I can find it via AWS CLI or list distributions.
// For now, I will try to list distributions and find the one matching the domain.

const s3Client = new S3Client({ region: 'us-east-1' });


async function main() {
    try {
        // 1. Find Distribution ID if not provided (optional, but good for cache invalidation)
        // For this script, I'll rely on listing distributions or just skip invalidation if I can't find it easily without excessive permissions.
        // But the user wants to access it, so cache might be an issue if we re-generate. 
        // Let's assume for now we just upload and maybe manually invalidate or the TTL is short.

        console.log(`Listing HTML files in bucket: ${BUCKET_NAME}`);

        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
        });

        const response = await s3Client.send(command);
        const files = response.Contents || [];

        const htmlFiles = files.filter(file => file.Key.endsWith('.html'));

        console.log(`Found ${htmlFiles.length} HTML files.`);

        let sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

        htmlFiles.forEach(file => {
            sitemapContent += `
    <url>
        <loc>${CLOUDFRONT_DOMAIN}/${file.Key}</loc>
        <lastmod>${file.LastModified.toISOString()}</lastmod>
    </url>`;
        });

        sitemapContent += `
</urlset>`;

        console.log('Generated Sitemap XML:');
        console.log(sitemapContent);

        // Upload to S3
        console.log('Uploading sitemap.xml to S3...');
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: 'sitemap.xml',
            Body: sitemapContent,
            ContentType: 'application/xml',
            CacheControl: 'no-cache' // To ensure we see updates
        }));

        console.log('✅ sitemap.xml uploaded successfully!');

        // Generate llms.txt
        let llmsContent = `# Lensy Demo Documentation\n\n> Documentation for the Lensy Demo integration.\n\n## Documentation\n\n`;

        htmlFiles.forEach(file => {
            const title = file.Key.replace('.html', '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            llmsContent += `- [${title}](${CLOUDFRONT_DOMAIN}/${file.Key})\n`;
        });

        console.log('\nGenerated llms.txt:');
        console.log(llmsContent);

        console.log('Uploading llms.txt to S3...');
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: 'llms.txt',
            Body: llmsContent,
            ContentType: 'text/markdown',
            CacheControl: 'no-cache'
        }));
        console.log('✅ llms.txt uploaded successfully!');

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
