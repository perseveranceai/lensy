import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Table to store WebSocket connections
const CONNECTIONS_TABLE = process.env.WS_CONNECTIONS_TABLE || process.env.CONNECTIONS_TABLE || 'lensy-websocket-connections';

interface WebSocketEvent {
    requestContext: {
        connectionId: string;
        routeKey: string;
        domainName: string;
        stage: string;
    };
    body?: string;
}

export const handler: Handler<WebSocketEvent, any> = async (event) => {
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
            case 'ping':
                return await handlePing(connectionId);
            default:
                console.log('Unknown route:', routeKey);
                return { statusCode: 400, body: 'Unknown route' };
        }
    } catch (error) {
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

async function handleConnect(connectionId: string): Promise<any> {
    console.log('Client connected:', connectionId);

    // Store connection in DynamoDB
    await docClient.send(new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
            connectionId,
            connectedAt: Date.now(),
            ttl: Math.floor(Date.now() / 1000) + 3600 // 1 hour TTL
        }
    }));

    return { statusCode: 200, body: 'Connected' };
}

async function handleDisconnect(connectionId: string): Promise<any> {
    console.log('Client disconnected:', connectionId);

    // Remove connection from DynamoDB
    await docClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId }
    }));

    return { statusCode: 200, body: 'Disconnected' };
}

async function handleSubscribe(connectionId: string, body?: string): Promise<any> {
    if (!body) {
        return { statusCode: 400, body: 'Missing body' };
    }

    const { sessionId } = JSON.parse(body);

    if (!sessionId) {
        return { statusCode: 400, body: 'Missing sessionId' };
    }

    console.log(`Subscribing connection ${connectionId} to session ${sessionId}`);

    // Update connection with sessionId
    await docClient.send(new PutCommand({
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

async function handlePing(connectionId: string): Promise<any> {
    const endpoint = process.env.WEBSOCKET_API_ENDPOINT;
    if (!endpoint) return { statusCode: 200, body: 'Pong (no endpoint)' };

    const client = new ApiGatewayManagementApiClient({ endpoint });
    try {
        await client.send(new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: JSON.stringify({ message: 'pong', timestamp: Date.now() })
        }));
    } catch (error) {
        console.error('Failed to send pong:', error);
    }
    return { statusCode: 200, body: 'Pong' };
}

// Helper function to send progress updates (called by other Lambdas)
export async function sendProgressUpdate(
    sessionId: string,
    message: string,
    type: 'info' | 'success' | 'error' | 'progress',
    metadata?: Record<string, any>
) {
    // This function will be imported and used by other Lambda functions
    // to send progress updates to connected WebSocket clients
    console.log(`Progress update for session ${sessionId}:`, message);

    // Implementation will query DynamoDB for connections with this sessionId
    // and send the message to each connection via API Gateway Management API
}
