import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const ACCESS_LOG_TABLE = process.env.ACCESS_LOG_TABLE || 'perseverance-console-access-log';

interface LoginEvent {
    body?: string;
    headers?: Record<string, string>;
    requestContext?: {
        http?: {
            sourceIp?: string;
        };
    };
}

interface LoginPayload {
    email: string;
    accessCodeHash: string;
    userAgent: string;
}

export const handler: Handler<LoginEvent, any> = async (event) => {
    console.log('Console login event received');

    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        // Handle preflight
        if (event.requestContext?.http?.sourceIp === undefined && !event.body) {
            return { statusCode: 200, headers: corsHeaders, body: '' };
        }

        const payload: LoginPayload = JSON.parse(event.body || '{}');

        if (!payload.email || !payload.accessCodeHash) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'email and accessCodeHash are required' }),
            };
        }

        const now = new Date();
        const ttlSeconds = Math.floor(now.getTime() / 1000) + (90 * 24 * 60 * 60); // 90 days

        await docClient.send(new PutCommand({
            TableName: ACCESS_LOG_TABLE,
            Item: {
                email: payload.email.toLowerCase().trim(),
                loginTimestamp: now.toISOString(),
                accessCodeHash: payload.accessCodeHash,
                userAgent: payload.userAgent || 'unknown',
                ipAddress: event.requestContext?.http?.sourceIp || event.headers?.['x-forwarded-for'] || 'unknown',
                agreedToTerms: true,
                ttl: ttlSeconds,
            },
        }));

        console.log(`Login logged for: ${payload.email}`);

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ success: true }),
        };
    } catch (error) {
        console.error('Error logging login:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Internal error' }),
        };
    }
};
