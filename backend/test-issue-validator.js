/**
 * Test script for IssueValidator Lambda
 * Tests validation of real Resend issues against documentation
 */

const https = require('https');

const API_URL = 'https://5gg6ce9y9e.execute-api.us-east-1.amazonaws.com';

// Test with 2 issues - one with pre-curated pages, one without
const testIssues = [
    {
        "id": "stackoverflow-78276988",
        "title": "Resend email doesn't work in production environment with Next.js, but works in development",
        "category": "deployment",
        "description": "Works perfectly in localhost but fails in Vercel production. Environment variables (RESEND_API_KEY) not being read correctly in production deployment.",
        "frequency": 23,
        "sources": [
            "https://stackoverflow.com/questions/78276988/resend-email-doesnt-work-in-production-environement-with-next-js-but-works-in"
        ],
        "lastSeen": "2025-12-15",
        "severity": "high",
        "relatedPages": [
            "/docs/api-reference/emails/send-email",
            "/docs/api-reference/api-keys/create-api-key"
        ]
    },
    {
        "id": "stackoverflow-gmail-spam",
        "title": "Gmail marks transactional emails as 'suspicious or spam' despite proper DNS configuration",
        "category": "email-delivery",
        "description": "Transactional emails sent through Resend/React Email are being flagged by Gmail. DNS configuration and verification are properly set up but images are hidden and emails marked suspicious.",
        "frequency": 27,
        "sources": [
            "https://stackoverflow.com/questions/tagged/resend.com"
        ],
        "lastSeen": "2025-12-28",
        "severity": "high",
        "relatedPages": [
            "/docs/dashboard/domains/introduction",
            "/docs/api-reference/domains/create-domain",
            "/docs/send-with-resend/deliverability"
        ]
    }
];

async function testValidateIssues() {
    const sessionId = `test-${Date.now()}`;

    console.log('🧪 Testing IssueValidator Lambda');
    console.log('Session ID:', sessionId);
    console.log('Testing with', testIssues.length, 'issues\n');

    const requestBody = JSON.stringify({
        issues: testIssues,
        domain: 'resend.com',
        sessionId: sessionId
    });

    const options = {
        hostname: '5gg6ce9y9e.execute-api.us-east-1.amazonaws.com',
        path: '/validate-issues',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('Status Code:', res.statusCode);
                console.log('\n📊 Response:\n');

                try {
                    const result = JSON.parse(data);
                    console.log(JSON.stringify(result, null, 2));

                    // Analyze results
                    if (result.validatedIssues) {
                        console.log('\n✅ Validation Summary:');
                        console.log('Total Issues Validated:', result.validatedIssues.length);

                        const resolved = result.validatedIssues.filter(i => i.validationStatus === 'resolved');
                        const potentialGaps = result.validatedIssues.filter(i => i.validationStatus === 'potential-gap');
                        const criticalGaps = result.validatedIssues.filter(i => i.validationStatus === 'critical-gap');

                        console.log('  ✅ Resolved:', resolved.length);
                        console.log('  ⚠️  Potential Gaps:', potentialGaps.length);
                        console.log('  ❌ Critical Gaps:', criticalGaps.length);

                        // Show details for each issue
                        result.validatedIssues.forEach(issue => {
                            console.log(`\n📋 Issue: ${issue.title}`);
                            console.log(`   Status: ${issue.validationStatus}`);
                            console.log(`   Pages Found: ${issue.relevantPages?.length || 0}`);
                            if (issue.relevantPages && issue.relevantPages.length > 0) {
                                issue.relevantPages.forEach(page => {
                                    console.log(`     - ${page.url} (${page.contentQuality})`);
                                });
                            }
                        });
                    }

                    resolve(result);
                } catch (error) {
                    console.error('Failed to parse response:', error);
                    console.log('Raw response:', data);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('Request failed:', error);
            reject(error);
        });

        req.write(requestBody);
        req.end();
    });
}

// Run the test
testValidateIssues()
    .then(() => {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
