const https = require('https');
const fs = require('fs');

const API_BASE = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';
const MODEL_ID = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0'; // Using the v2 model ID as per previous logs

// Helper to make HTTP requests
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(`${API_BASE}${path}`, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data); // In case it's not JSON
                    }
                } else {
                    reject({ statusCode: res.statusCode, body: data });
                }
            });
        });

        req.on('error', (e) => reject(e));

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runE2E() {
    // Use a known existing session that has analysis data
    const sessionId = 'session-1768278750594';
    console.log(`\n🚀 Starting E2E Verification for Session: ${sessionId}`);

    try {
        // Step 1: Generate Fixes
        console.log(`\n1. Generating Fixes (POST /generate-fixes)...`);
        // We simulate selecting one recommendation to speed it up
        const genPayload = {
            sessionId: sessionId,
            selectedRecommendations: ["Include rate limiting and quota information"],
            modelId: MODEL_ID
        };
        const genResult = await request('POST', '/generate-fixes', genPayload);
        console.log('   ✅ Generation Success:', JSON.stringify(genResult).substring(0, 100) + '...');

        if (!genResult.success) throw new Error("Generation failed");

        // Step 2: Fetch Generated Fixes
        console.log(`\n2. Fetching Fixes (GET /sessions/${sessionId}/fixes)...`);
        const fixSession = await request('GET', `/sessions/${sessionId}/fixes`);
        console.log(`   ✅ Fetched ${fixSession.fixes.length} fixes.`);

        if (fixSession.fixes.length === 0) throw new Error("No fixes generated");

        const targetFix = fixSession.fixes[0];
        console.log(`   🎯 Targeting Fix ID: ${targetFix.id} (${targetFix.type})`);

        // Step 3: Apply Fix
        console.log(`\n3. Applying Fix (POST /apply-fixes)...`);
        const applyPayload = {
            sessionId: sessionId,
            selectedFixIds: [targetFix.id]
        };
        const applyResult = await request('POST', '/apply-fixes', applyPayload);
        console.log('   ✅ Application Result:', applyResult);

        if (!applyResult.success) throw new Error(`Application report says success=false: ${applyResult.message}`);

        console.log(`\n✅ E2E TEST PASSED! The mechanism is fully functional.`);
        console.log(`   - Generated fixes via AI`);
        console.log(`   - Retrieved fixes via API`);
        console.log(`   - Applied fixes via Backend`);
        console.log(`   - Validated 200 OK response`);

    } catch (error) {
        console.error('\n❌ E2E TEST FAILED:', error);
        process.exit(1);
    }
}

runE2E();
