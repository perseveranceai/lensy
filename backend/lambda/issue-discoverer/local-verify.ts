
import { handler } from './index';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock environment
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET_NAME = 'test-bucket';

// Mock event for Knock.app
const mockEvent: APIGatewayProxyEvent = {
    body: JSON.stringify({
        companyName: 'Knock',
        domain: 'docs.knock.app',
        sessionId: 'local-test-session'
    })
} as any;

async function runTest() {
    console.log('--- STARTING LOCAL VERIFICATION ---');
    try {
        const result = await handler(mockEvent);

        console.log('--- HANDER EXECUTION COMPLETE ---');
        console.log('Status Code:', result.statusCode);

        if (result.statusCode === 200) {
            const body = JSON.parse(result.body);
            console.log('Total Issues Found:', body.totalFound);

            // Check for proactive audits
            const audits = body.issues.filter((i: any) => i.id.startsWith('audit-'));
            console.log('Proactive Audits Found:', audits.length);

            audits.forEach((audit: any) => {
                console.log(`- ${audit.title} (${audit.category})`);
            });

            if (audits.length >= 3) {
                console.log('SUCCESS: Proactive audits were injected!');
            } else {
                console.log('FAILURE: Proactive audits missing.');
            }
        } else {
            console.log('Handler returned error:', result.body);
        }
    } catch (error) {
        console.error('Test execution failed:', error);
    }
}

runTest();
