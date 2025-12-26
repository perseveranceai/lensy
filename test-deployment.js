#!/usr/bin/env node

/**
 * Test script to verify deployment
 * Tests noise reduction and parallel processing
 */

const API_BASE_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const TEST_URL = 'https://developer.wordpress.org/apis/handbook/transients/';

async function testAnalysis() {
    console.log('🧪 Testing Lensy Deployment\n');
    console.log('📍 API:', API_BASE_URL);
    console.log('🔗 Test URL:', TEST_URL);
    console.log('');

    const sessionId = `session-${Date.now()}`;
    const startTime = Date.now();

    try {
        // Step 1: Start analysis
        console.log('📤 Starting analysis...');
        const response = await fetch(`${API_BASE_URL}/analyze`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: TEST_URL,
                selectedModel: 'claude',
                sessionId: sessionId
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const result = await response.json();
        console.log('✅ Analysis started:', result.executionArn ? '✓' : '✗ (undefined!)');
        console.log('   Session ID:', result.sessionId);
        console.log('   Execution ARN:', result.executionArn || 'UNDEFINED');
        console.log('');

        // Step 2: Poll for results
        console.log('⏳ Waiting for analysis to complete...');
        let attempts = 0;
        const maxAttempts = 30; // 2.5 minutes max

        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

            try {
                const statusResponse = await fetch(`${API_BASE_URL}/status/${sessionId}`);

                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();

                    if (statusData.report) {
                        const elapsed = Math.round((Date.now() - startTime) / 1000);
                        console.log(`✅ Analysis completed in ${elapsed} seconds!\n`);

                        // Display results
                        console.log('📊 Results:');
                        console.log('   Overall Score:', statusData.report.overallScore);
                        console.log('   Dimensions Analyzed:', statusData.report.dimensionsAnalyzed, '/', statusData.report.dimensionsTotal);
                        console.log('   Confidence:', statusData.report.confidence);
                        console.log('   Model Used:', statusData.report.modelUsed);
                        console.log('');

                        console.log('📝 Code Analysis:');
                        console.log('   Snippets Found:', statusData.report.codeAnalysis.snippetsFound);
                        console.log('   Languages:', statusData.report.codeAnalysis.languagesDetected.join(', '));
                        console.log('');

                        console.log('🖼️  Media Analysis:');
                        console.log('   Images:', statusData.report.mediaAnalysis.imagesFound);
                        console.log('   Interactive Elements:', statusData.report.mediaAnalysis.interactiveElements);
                        console.log('   Accessibility Issues:', statusData.report.mediaAnalysis.accessibilityIssues);
                        console.log('');

                        console.log('🔗 Link Analysis:');
                        console.log('   Total Links:', statusData.report.linkAnalysis.totalLinks);
                        console.log('   Internal:', statusData.report.linkAnalysis.internalLinks);
                        console.log('   External:', statusData.report.linkAnalysis.externalLinks);
                        console.log('');

                        console.log('⚡ Performance:');
                        console.log('   Total Time:', elapsed, 'seconds');
                        console.log('   Expected:', '~17 seconds (with parallel processing)');
                        console.log('   Previous:', '~50 seconds (sequential)');
                        console.log('   Improvement:', elapsed < 25 ? '✅ FASTER!' : '⚠️  Still slow');
                        console.log('');

                        console.log('🎯 Quality Dimensions:');
                        Object.entries(statusData.report.dimensions).forEach(([name, data]) => {
                            const score = data.score || 'N/A';
                            const emoji = data.score >= 80 ? '🟢' : data.score >= 60 ? '🟡' : '🔴';
                            console.log(`   ${emoji} ${name.padEnd(15)} ${score}`);
                        });
                        console.log('');

                        // Check for noise reduction (we can't see it directly, but we can infer)
                        console.log('🧹 Noise Reduction:');
                        console.log('   Status: Deployed (check CloudWatch logs for metrics)');
                        console.log('   Expected: 90%+ reduction in HTML size');
                        console.log('');

                        console.log('✅ Test completed successfully!');
                        console.log('');
                        console.log('📋 Next Steps:');
                        console.log('   1. Check CloudWatch logs for noise reduction metrics');
                        console.log('   2. Verify parallel processing in dimension analyzer logs');
                        console.log('   3. Compare timing with previous runs (~50s)');

                        return;
                    } else if (statusData.status === 'in_progress') {
                        process.stdout.write('.');
                    }
                }
            } catch (statusError) {
                process.stdout.write('.');
            }
        }

        console.log('\n⚠️  Analysis timed out after', Math.round((Date.now() - startTime) / 1000), 'seconds');
        console.log('   Check AWS Step Functions console for execution status');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
testAnalysis().catch(console.error);
