const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: 'us-east-1' });

async function testStructureDetector() {
    // First, we need a session with processed content
    // Let's use the session from our previous successful test
    const sessionId = 'direct-test-1766711947703';

    const payload = {
        url: 'https://developer.wordpress.org/block-editor/',
        selectedModel: 'claude',
        sessionId: sessionId,
        analysisStartTime: Date.now()
    };

    console.log('Testing Structure Detector Lambda...');
    console.log('Session ID:', sessionId);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    try {
        const command = new InvokeCommand({
            FunctionName: 'LensyStack-StructureDetectorFunction8B32579C-vQyokODpuMVd',
            Payload: JSON.stringify(payload),
        });

        console.log('\n⏳ Invoking Lambda (this may take 10-30 seconds for AI analysis)...\n');
        const response = await lambdaClient.send(command);
        const result = JSON.parse(Buffer.from(response.Payload).toString());

        console.log('✅ Lambda Response:');
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('\n✅ Structure detection completed!');
            console.log('Message:', result.message);

            // Check if structure was stored in S3
            console.log('\n📦 Checking S3 for structure analysis...');
            const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
            const s3Client = new S3Client({ region: 'us-east-1' });

            const getCommand = new GetObjectCommand({
                Bucket: 'lensy-analysis-951411676525-us-east-1',
                Key: `sessions/${sessionId}/structure.json`
            });

            const s3Response = await s3Client.send(getCommand);
            const structureContent = await s3Response.Body.transformToString();
            const structure = JSON.parse(structureContent);

            console.log('\n📄 Structure Analysis:');
            console.log(JSON.stringify(structure, null, 2));
        } else {
            console.log('\n❌ Structure detection failed:', result.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.$metadata) {
            console.error('AWS Error Details:', error.$metadata);
        }
    }
}

testStructureDetector();
