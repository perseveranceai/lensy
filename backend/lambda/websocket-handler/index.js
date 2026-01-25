"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendProgressUpdate = exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
// Table to store WebSocket connections
const CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE || process.env.CONNECTIONS_TABLE || 'lensy-websocket-connections';
const handler = async (event) => {
    console.log('WebSocket event:', JSON.stringify(event, null, 2));
    const { connectionId, routeKey, domainName, stage } = event.requestContext;
    try {
        switch (routeKey) {
            case '$connect':
                return await handleConnect(connectionId);
            case '$disconnect':
                return await handleDisconnect(connectionId);
            case 'subscribe':
                return await handleSubscribe(connectionId, event.body);
            default:
                console.log('Unknown route:', routeKey);
                return { statusCode: 400, body: 'Unknown route' };
        }
    }
    catch (error) {
        console.error('WebSocket handler error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
};
exports.handler = handler;
async function handleConnect(connectionId) {
    console.log('Client connected:', connectionId);
    // Store connection in DynamoDB
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
            connectionId,
            connectedAt: Date.now(),
            ttl: Math.floor(Date.now() / 1000) + 3600 // 1 hour TTL
        }
    }));
    return { statusCode: 200, body: 'Connected' };
}
async function handleDisconnect(connectionId) {
    console.log('Client disconnected:', connectionId);
    // Remove connection from DynamoDB
    await docClient.send(new lib_dynamodb_1.DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId }
    }));
    return { statusCode: 200, body: 'Disconnected' };
}
async function handleSubscribe(connectionId, body) {
    if (!body) {
        return { statusCode: 400, body: 'Missing body' };
    }
    const { sessionId } = JSON.parse(body);
    if (!sessionId) {
        return { statusCode: 400, body: 'Missing sessionId' };
    }
    console.log(`Subscribing connection ${connectionId} to session ${sessionId}`);
    // Update connection with sessionId
    await docClient.send(new lib_dynamodb_1.PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
            connectionId,
            sessionId,
            connectedAt: Date.now(),
            ttl: Math.floor(Date.now() / 1000) + 3600
        }
    }));
    return { statusCode: 200, body: 'Subscribed' };
}
// Helper function to send progress updates (called by other Lambdas)
async function sendProgressUpdate(sessionId, message, type, metadata) {
    // This function will be imported and used by other Lambda functions
    // to send progress updates to connected WebSocket clients
    console.log(`Progress update for session ${sessionId}:`, message);
    // Implementation will query DynamoDB for connections with this sessionId
    // and send the message to each connection via API Gateway Management API
}
exports.sendProgressUpdate = sendProgressUpdate;
