"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProgressPublisher = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
class ProgressPublisher {
    constructor(sessionId) {
        this.apiGatewayClient = null;
        this.sessionId = sessionId;
        this.dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
        if (process.env.WEBSOCKET_API_ENDPOINT) {
            this.apiGatewayClient = new client_apigatewaymanagementapi_1.ApiGatewayManagementApiClient({
                endpoint: process.env.WEBSOCKET_API_ENDPOINT,
                region: process.env.AWS_REGION
            });
        }
    }
    async progress(message, phase, metadata) {
        await this.publishMessage({
            type: 'progress',
            message,
            timestamp: Date.now(),
            phase,
            metadata
        });
    }
    async success(message, metadata) {
        await this.publishMessage({
            type: 'success',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
    async error(message, metadata) {
        await this.publishMessage({
            type: 'error',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
    async publishMessage(message) {
        if (!this.apiGatewayClient || !process.env.CONNECTIONS_TABLE) {
            console.log('WebSocket not configured, logging message:', message);
            return;
        }
        try {
            // Get connections for this session
            const queryCommand = new client_dynamodb_1.QueryCommand({
                TableName: process.env.CONNECTIONS_TABLE,
                IndexName: 'SessionIdIndex',
                KeyConditionExpression: 'sessionId = :sessionId',
                ExpressionAttributeValues: {
                    ':sessionId': { S: this.sessionId }
                }
            });
            const connections = await this.dynamoClient.send(queryCommand);
            if (!connections.Items || connections.Items.length === 0) {
                console.log('No WebSocket connections found for session:', this.sessionId);
                return;
            }
            // Send message to all connections for this session
            const sendPromises = connections.Items.map(async (item) => {
                const connectionId = item.connectionId?.S;
                if (!connectionId)
                    return;
                try {
                    await this.apiGatewayClient.send(new client_apigatewaymanagementapi_1.PostToConnectionCommand({
                        ConnectionId: connectionId,
                        Data: JSON.stringify(message)
                    }));
                }
                catch (error) {
                    if (error.statusCode === 410) {
                        console.log('Stale connection:', connectionId);
                    }
                    else {
                        console.error('Error sending message to connection:', connectionId, error);
                    }
                }
            });
            await Promise.allSettled(sendPromises);
        }
        catch (error) {
            console.error('Error publishing progress message:', error);
        }
    }
}
exports.ProgressPublisher = ProgressPublisher;
