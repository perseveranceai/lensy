"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const ACCESS_LOG_TABLE = process.env.ACCESS_LOG_TABLE || 'perseverance-console-access-log';
const handler = async (event) => {
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
        const payload = JSON.parse(event.body || '{}');
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
            await docClient.send(new lib_dynamodb_1.UpdateCommand({
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
        }
        else {
            // Log new login attempt
            if (!payload.accessCodeHash) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'accessCodeHash is required for attempt' }),
                };
            }
            await docClient.send(new lib_dynamodb_1.PutCommand({
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
    }
    catch (error) {
        console.error('Error logging login:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Internal error' }),
        };
    }
};
exports.handler = handler;
