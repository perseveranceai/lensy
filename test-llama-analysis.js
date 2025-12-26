const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: 'us-east-1' });

async function testLlamaAnalysis() {
    // Use an existing session with processed content
    const sessionId = 'direct-test-1766711947703';

    const payload = {
        url: 'https://developer.wordpress.org/block-editor/',
        selectedModel: 'llama',  // Test with Llama
        sessionId: sessionId,
        analysisStartTime: Date.now()
    };

    console.log('Testing Dimension Analyzer with Llama...');
    console.log('Session ID:', sessionId);
    console.log('This will take 30-60 seconds...\n');

    try {
        const command = new InvokeCommand({
            FunctionName: 'LensyStack-DimensionAnalyzerFunction602624D3-UdrQiXBAqFWK',
            Payload: JSON.stringify(payload),
        });

        console.log('⏳ Invoking Lambda...\n');
        const startTime = Date.now();
        const response = await lambdaClient.send(command);
        const duration = Date.now() - startTime;
        const result = JSON.parse(Buffer.from(response.Payload).toString());

        console.log('✅ Lambda Response (took', duration, 'ms):');
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log('\n✅ Analysis completed!');

            // Check S3 for results
            const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
            const s3Client = new S3Client({ region: 'us-east-1' });

            const getCommand = new GetObjectCommand({
                Bucket: 'lensy-analysis-951411676525-us-east-1',
                Key: `sessions/${sessionId}/dimension-results.json`
            });

            const s3Response = await s3Client.send(getCommand);
            const resultsContent = await s3Response.Body.transformToString();
            const dimensionResults = JSON.parse(resultsContent);

            console.log('\n📊 Dimension Results:\n');

            for (const [dimension, result] of Object.entries(dimensionResults)) {
                console.log(`${dimension.toUpperCase()}:`);
                console.log(`  Score: ${result.score}`);
                console.log(`  Status: ${result.status}`);
                if (result.failureReason) {
                    console.log(`  Failure: ${result.failureReason}`);
                }
            }
        } else {
            console.log('\n❌ Analysis failed:', result.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testLlamaAnalysis();
