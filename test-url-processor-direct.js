const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: 'us-east-1' });

async function testURLProcessor() {
    const payload = {
        url: 'https://developer.wordpress.org/block-editor/',
        selectedModel: 'claude',
        sessionId: 'direct-test-' + Date.now(),
        analysisStartTime: Date.now()
    };

    console.log('Testing URL Processor Lambda directly...');
    console.log('Payload:', JSON.stringify(payload, null, 2));

    try {
        const command = new InvokeCommand({
            FunctionName: 'LensyStack-URLProcessorFunction9D9AF427-iqKxw2fBkk9o',
            Payload: JSON.stringify(payload),
        });

        const response = await lambdaClient.send(command);
        const result = JSON.parse(Buffer.from(response.Payload).toString());

        console.log('\n✅ Lambda Response:');
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('\n✅ Lambda executed successfully!');
            console.log('Session ID:', result.sessionId);
            console.log('Message:', result.message);

            // Now check S3 bucket
            console.log('\n📦 Checking S3 bucket for stored content...');
            const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
            const s3Client = new S3Client({ region: 'us-east-1' });

            const listCommand = new ListObjectsV2Command({
                Bucket: 'lensy-analysis-951411676525-us-east-1',
                Prefix: `sessions/${result.sessionId}/`
            });

            const listResponse = await s3Client.send(listCommand);

            if (listResponse.Contents && listResponse.Contents.length > 0) {
                console.log('✅ Found objects in S3:');
                listResponse.Contents.forEach(obj => {
                    console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
                });

                // Try to read the content
                const getCommand = new GetObjectCommand({
                    Bucket: 'lensy-analysis-951411676525-us-east-1',
                    Key: `sessions/${result.sessionId}/processed-content.json`
                });

                const getResponse = await s3Client.send(getCommand);
                const content = await getResponse.Body.transformToString();
                const parsedContent = JSON.parse(content);

                console.log('\n📄 Stored content summary:');
                console.log('  - URL:', parsedContent.url);
                console.log('  - Content Type:', parsedContent.contentType);
                console.log('  - HTML Length:', parsedContent.htmlContent?.length || 0);
                console.log('  - Markdown Length:', parsedContent.markdownContent?.length || 0);
                console.log('  - Code Snippets:', parsedContent.codeSnippets?.length || 0);
                console.log('  - Media Elements:', parsedContent.mediaElements?.length || 0);
                console.log('  - Total Links:', parsedContent.linkAnalysis?.totalLinks || 0);
            } else {
                console.log('❌ No objects found in S3 bucket!');
                console.log('Expected path: sessions/' + result.sessionId + '/processed-content.json');
            }
        } else {
            console.log('\n❌ Lambda failed:', result.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.$metadata) {
            console.error('AWS Error Details:', error.$metadata);
        }
    }
}

testURLProcessor();
