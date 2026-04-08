"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressPublisher = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'lensy-websocket-connections';
const WEBSOCKET_API_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;
class ProgressPublisher {
    constructor(sessionId) {
        this.sessionId = sessionId;
        if (WEBSOCKET_API_ENDPOINT) {
            this.apiGatewayClient = new client_apigatewaymanagementapi_1.ApiGatewayManagementApiClient({
                endpoint: WEBSOCKET_API_ENDPOINT,
                region: process.env.AWS_REGION || 'us-east-1'
            });
        }
    }
    async publish(message) {
        if (!this.apiGatewayClient) {
            console.log('WebSocket not configured, skipping progress update:', message);
            return;
        }
        try {
            const connections = await this.getSessionConnections();
            if (connections.length === 0) {
                console.log('No active connections for session:', this.sessionId);
                return;
            }
            // Include sessionId in message for frontend filtering
            const messageWithSession = { ...message, sessionId: this.sessionId };
            // API Gateway WebSocket has a 128KB frame limit. If the serialized payload
            // exceeds 120KB (with headroom), strip the data field to prevent HTTP 413 errors
            // that silently break frontend card rendering.
            const MAX_WS_PAYLOAD_BYTES = 120 * 1024; // 120KB — leave 8KB headroom
            let payload = JSON.stringify(messageWithSession);
            if (Buffer.byteLength(payload, 'utf8') > MAX_WS_PAYLOAD_BYTES) {
                console.warn(`[ProgressPublisher] Payload too large (${Buffer.byteLength(payload, 'utf8')} bytes) for message: ${message.message}. Stripping metadata.data to fit within WebSocket frame limit.`);
                const trimmed = {
                    ...messageWithSession,
                    metadata: messageWithSession.metadata
                        ? { ...messageWithSession.metadata, data: { _truncated: true, message: 'Payload exceeded 128KB WebSocket limit — full data available in S3 artifact' } }
                        : messageWithSession.metadata,
                };
                payload = JSON.stringify(trimmed);
            }
            const sendPromises = connections.map(async (connectionId) => {
                try {
                    await this.apiGatewayClient.send(new client_apigatewaymanagementapi_1.PostToConnectionCommand({
                        ConnectionId: connectionId,
                        Data: Buffer.from(payload)
                    }));
                    console.log(`Sent progress to connection ${connectionId}:`, message.message);
                }
                catch (error) {
                    if (error.statusCode === 410) {
                        console.log('Stale connection, removing:', connectionId);
                        await this.removeConnection(connectionId);
                    }
                    else {
                        console.error('Error sending to connection:', connectionId, error);
                    }
                }
            });
            await Promise.allSettled(sendPromises);
        }
        catch (error) {
            console.error('Error publishing progress:', error);
        }
    }
    async getSessionConnections() {
        try {
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: CONNECTIONS_TABLE,
                IndexName: 'SessionIdIndex',
                KeyConditionExpression: 'sessionId = :sessionId',
                ExpressionAttributeValues: {
                    ':sessionId': this.sessionId
                }
            }));
            return result.Items?.map(item => item.connectionId) || [];
        }
        catch (error) {
            console.error('Error querying connections:', error);
            return [];
        }
    }
    async removeConnection(connectionId) {
        try {
            await docClient.send(new lib_dynamodb_1.DeleteCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connectionId }
            }));
        }
        catch (error) {
            console.error('Error removing connection:', error);
        }
    }
    async info(message, metadata) {
        await this.publish({ type: 'info', message, timestamp: Date.now(), metadata });
    }
    async success(message, metadata) {
        await this.publish({ type: 'success', message, timestamp: Date.now(), metadata });
    }
    async error(message, metadata) {
        await this.publish({ type: 'error', message, timestamp: Date.now(), metadata });
    }
    async progress(message, phase, metadata) {
        await this.publish({ type: 'progress', message, timestamp: Date.now(), phase, metadata });
    }
    async cacheHit(message, metadata) {
        await this.publish({ type: 'cache-hit', message, timestamp: Date.now(), metadata });
    }
    async cacheMiss(message, metadata) {
        await this.publish({ type: 'cache-miss', message, timestamp: Date.now(), metadata });
    }
    /**
     * Publish a category result for async card loading.
     * Frontend receives this and immediately populates the corresponding card.
     */
    async categoryResult(category, data, message) {
        await this.publish({
            type: 'category-result',
            message: message || `${category} analysis complete`,
            timestamp: Date.now(),
            metadata: { category, data },
        });
    }
}
exports.ProgressPublisher = ProgressPublisher;
