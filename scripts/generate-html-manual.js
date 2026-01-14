const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { marked } = require('marked');

const s3 = new S3Client({ region: 'us-east-1' });
const BUCKET = 'lensy-demo-docs-951411676525';

async function run() {
    try {
        console.log(`Listing files in bucket: ${BUCKET}`);
        const listCmd = new ListObjectsV2Command({ Bucket: BUCKET });
        const listRes = await s3.send(listCmd);
        const files = listRes.Contents || [];

        const mdFiles = files.filter(f => f.Key.endsWith('.md') && !f.Key.startsWith('node_modules'));
        console.log(`Found ${mdFiles.length} Markdown files:`, mdFiles.map(f => f.Key));

        for (const file of mdFiles) {
            console.log(`Processing ${file.Key}...`);

            // Fetch MD
            const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: file.Key });
            const response = await s3.send(getCmd);
            const md = await response.Body.transformToString();

            // Convert
            const htmlBody = marked.parse(md);
            const title = file.Key.replace('.md', '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

            const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
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

            // Upload HTML
            const htmlKey = file.Key.replace(/\.md$/, '.html');
            console.log(`Uploading ${htmlKey}...`);

            await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: htmlKey,
                Body: htmlContent,
                ContentType: 'text/html'
            }));
        }

        console.log('All files processed!');
    } catch (err) {
        console.error('Error:', err);
    }
}

run();
