import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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
    accessCodeHash?: string;
    userAgent: string;
    action?: 'attempt' | 'verified';
    loginTimestamp?: string;  // For verify action — references the original attempt
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

        if (!payload.email) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'email is required' }),
            };
        }

        const now = new Date();
        const action = payload.action || 'attempt';

        if (action === 'verified' && payload.loginTimestamp) {
            // Update existing attempt record to mark as verified
            await docClient.send(new UpdateCommand({
                TableName: ACCESS_LOG_TABLE,
                Key: {
                    email: payload.email.toLowerCase().trim(),
                    loginTimestamp: payload.loginTimestamp,
                },
                UpdateExpression: 'SET #status = :status, verifiedAt = :verifiedAt',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                    ':status': 'verified',
                    ':verifiedAt': now.toISOString(),
                },
            }));

            console.log(`Login VERIFIED for: ${payload.email}`);
        } else {
            // Log new login attempt
            if (!payload.accessCodeHash) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'accessCodeHash is required for attempt' }),
                };
            }

            await docClient.send(new PutCommand({
                TableName: ACCESS_LOG_TABLE,
                Item: {
                    email: payload.email.toLowerCase().trim(),
                    loginTimestamp: now.toISOString(),
                    accessCodeHash: payload.accessCodeHash,
                    userAgent: payload.userAgent || 'unknown',
                    ipAddress: event.requestContext?.http?.sourceIp || event.headers?.['x-forwarded-for'] || 'unknown',
                    agreedToTerms: true,
                    status: 'attempted',
                },
            }));

            console.log(`Login ATTEMPTED for: ${payload.email}`);

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ success: true, loginTimestamp: now.toISOString() }),
            };
        }

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
