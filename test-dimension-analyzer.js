const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const lambdaClient = new LambdaClient({ region: 'us-east-1' });

async function testDimensionAnalyzer() {
    const sessionId = 'direct-test-1766711947703';

    const payload = {
        url: 'https://developer.wordpress.org/block-editor/',
        selectedModel: 'claude',
        sessionId: sessionId,
        analysisStartTime: Date.now()
    };

    console.log('Testing Dimension Analyzer Lambda...');
    console.log('Session ID:', sessionId);
    console.log('This will analyze 5 dimensions using AI - may take 30-60 seconds...\n');

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
            console.log('\n✅ Dimension analysis completed!');
            console.log('Message:', result.message);

            // Check if results were stored in S3
            console.log('\n📦 Checking S3 for dimension results...');
            const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
            const s3Client = new S3Client({ region: 'us-east-1' });

            const getCommand = new GetObjectCommand({
                Bucket: 'lensy-analysis-951411676525-us-east-1',
                Key: `sessions/${sessionId}/dimension-results.json`
            });

            const s3Response = await s3Client.send(getCommand);
            const resultsContent = await s3Response.Body.transformToString();
            const dimensionResults = JSON.parse(resultsContent);

            console.log('\n📊 Dimension Analysis Results:\n');

            for (const [dimension, result] of Object.entries(dimensionResults)) {
                console.log(`\n${dimension.toUpperCase()}:`);
                console.log(`  Score: ${result.score}/100`);
                console.log(`  Status: ${result.status}`);
                console.log(`  Processing Time: ${result.processingTime}ms`);
                console.log(`  Findings: ${result.findings.length}`);
                result.findings.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
                console.log(`  Recommendations: ${result.recommendations.length}`);
                result.recommendations.forEach((r, i) => {
                    console.log(`    ${i + 1}. [${r.priority}] ${r.action}`);
                });
            }
        } else {
            console.log('\n❌ Dimension analysis failed:', result.message);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.$metadata) {
            console.error('AWS Error Details:', error.$metadata);
        }
    }
}

testDimensionAnalyzer();
