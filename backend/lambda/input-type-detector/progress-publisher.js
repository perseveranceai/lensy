"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
            // Get all connections for this session
            const connections = await this.getSessionConnections();
            if (connections.length === 0) {
                console.log('No active connections for session:', this.sessionId);
                return;
            }
            // Send message to all connections
            const sendPromises = connections.map(async (connectionId) => {
                try {
                    await this.apiGatewayClient.send(new client_apigatewaymanagementapi_1.PostToConnectionCommand({
                        ConnectionId: connectionId,
                        Data: Buffer.from(JSON.stringify(message))
                    }));
                    console.log(`Sent progress to connection ${connectionId}:`, message.message);
                }
                catch (error) {
                    if (error.statusCode === 410) {
                        // Connection is stale, remove it
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
            const { DeleteCommand } = await Promise.resolve().then(() => __importStar(require('@aws-sdk/lib-dynamodb')));
            await docClient.send(new DeleteCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connectionId }
            }));
        }
        catch (error) {
            console.error('Error removing connection:', error);
        }
    }
    // Convenience methods for common message types
    async info(message, metadata) {
        await this.publish({
            type: 'info',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
    async success(message, metadata) {
        await this.publish({
            type: 'success',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
    async error(message, metadata) {
        await this.publish({
            type: 'error',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
    async progress(message, phase, metadata) {
        await this.publish({
            type: 'progress',
            message,
            timestamp: Date.now(),
            phase,
            metadata
        });
    }
    async cacheHit(message, metadata) {
        await this.publish({
            type: 'cache-hit',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
    async cacheMiss(message, metadata) {
        await this.publish({
            type: 'cache-miss',
            message,
            timestamp: Date.now(),
            metadata
        });
    }
}
exports.ProgressPublisher = ProgressPublisher;
