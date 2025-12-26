#!/usr/bin/env node

/**
 * Quick test to verify noise reduction is working
 * Compares before/after analysis results
 */

const API_BASE_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const TEST_URL = 'https://developer.wordpress.org/apis/handbook/transients/';

async function testNoiseReduction() {
    console.log('🧪 Testing Enhanced Noise Reduction\n');
    console.log('📍 API:', API_BASE_URL);
    console.log('🔗 Test URL:', TEST_URL);
    console.log('');

    const sessionId = `session-${Date.now()}`;

    try {
        // Start analysis
        console.log('📤 Starting analysis with enhanced noise reduction...');
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
        console.log('✅ Analysis started successfully');
        console.log('   Execution ARN:', result.executionArn ? '✓ Present' : '✗ Missing');
        console.log('');

        // Wait for completion
        console.log('⏳ Waiting for analysis to complete (should be ~17 seconds)...');
        let attempts = 0;
        const maxAttempts = 20;

        while (attempts < maxAttempts) {
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000));

            try {
                const statusResponse = await fetch(`${API_BASE_URL}/status/${sessionId}`);

                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();

                    if (statusData.report) {
                        console.log('✅ Analysis completed!\n');

                        // Check for improvements
                        console.log('📊 Results Analysis:');
                        console.log('   Overall Score:', statusData.report.overallScore);

                        const relevance = statusData.report.dimensions.relevance;
                        const clarity = statusData.report.dimensions.clarity;

                        console.log('');
                        console.log('🎯 Key Dimension Scores:');
                        console.log(`   Relevance: ${relevance?.score || 'N/A'} ${relevance?.score >= 60 ? '✅ IMPROVED!' : '⚠️ Still low'}`);
                        console.log(`   Clarity: ${clarity?.score || 'N/A'} ${clarity?.score >= 60 ? '✅ IMPROVED!' : '⚠️ Still low'}`);

                        console.log('');
                        console.log('🔍 Key Findings Check:');

                        // Check relevance findings
                        if (relevance?.findings) {
                            const hasCSS = relevance.findings.some(f => f.toLowerCase().includes('css'));
                            const hasScript = relevance.findings.some(f => f.toLowerCase().includes('script'));
                            const hasWordPress = relevance.findings.some(f => f.toLowerCase().includes('wordpress'));

                            console.log(`   CSS mentions: ${hasCSS ? '❌ Still present' : '✅ Removed'}`);
                            console.log(`   Script mentions: ${hasScript ? '❌ Still present' : '✅ Removed'}`);
                            console.log(`   WordPress content: ${hasWordPress ? '✅ Detected' : '⚠️ Not detected'}`);

                            console.log('');
                            console.log('📝 Sample findings:');
                            relevance.findings.slice(0, 2).forEach((finding, i) => {
                                console.log(`   ${i + 1}. ${finding}`);
                            });
                        }

                        console.log('');
                        console.log('📈 Improvement Assessment:');

                        if (relevance?.score >= 60 && clarity?.score >= 60) {
                            console.log('   🎉 SUCCESS! Noise reduction is working');
                            console.log('   📊 Scores improved significantly');
                            console.log('   🧹 AI is analyzing clean content');
                        } else if (relevance?.score >= 50 || clarity?.score >= 50) {
                            console.log('   📈 PARTIAL SUCCESS! Some improvement seen');
                            console.log('   🔧 May need further noise reduction tuning');
                        } else {
                            console.log('   ⚠️ LIMITED IMPROVEMENT');
                            console.log('   🔍 Check CloudWatch logs for noise removal details');
                        }

                        console.log('');
                        console.log('📋 Next Steps:');
                        console.log('   1. Compare these scores with previous results');
                        console.log('   2. Check CloudWatch logs for noise removal metrics');
                        console.log('   3. If still seeing CSS/JS mentions, may need more aggressive filtering');

                        return;
                    } else if (statusData.status === 'in_progress') {
                        process.stdout.write('.');
                    }
                }
            } catch (statusError) {
                process.stdout.write('.');
            }
        }

        console.log('\n⚠️ Analysis timed out - check AWS console for results');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
testNoiseReduction().catch(console.error);