import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'lensy-websocket-connections';
const WEBSOCKET_API_ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;

export interface ProgressMessage {
    type: 'info' | 'success' | 'error' | 'progress' | 'cache-hit' | 'cache-miss' | 'category-result';
    message: string;
    timestamp: number;
    sessionId?: string;
    phase?: 'url-processing' | 'structure-detection' | 'dimension-analysis' | 'report-generation' | 'input-detection' | 'ai-readiness' | 'sitemap-health';
    metadata?: {
        dimension?: string;
        score?: number;
        processingTime?: number;
        cacheStatus?: 'hit' | 'miss';
        contentType?: string;
        contextPages?: number;
        toolName?: string;
        category?: string;
        data?: any;
        [key: string]: any;
    };
}

export class ProgressPublisher {
    private sessionId: string;
    private apiGatewayClient?: ApiGatewayManagementApiClient;

    constructor(sessionId: string) {
        this.sessionId = sessionId;

        if (WEBSOCKET_API_ENDPOINT) {
            this.apiGatewayClient = new ApiGatewayManagementApiClient({
                endpoint: WEBSOCKET_API_ENDPOINT,
                region: process.env.AWS_REGION || 'us-east-1'
            });
        }
    }

    async publish(message: ProgressMessage): Promise<void> {
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

            const sendPromises = connections.map(async (connectionId) => {
                try {
                    await this.apiGatewayClient!.send(new PostToConnectionCommand({
                        ConnectionId: connectionId,
                        Data: Buffer.from(JSON.stringify(messageWithSession))
                    }));
                    console.log(`Sent progress to connection ${connectionId}:`, message.message);
                } catch (error: any) {
                    if (error.statusCode === 410) {
                        console.log('Stale connection, removing:', connectionId);
                        await this.removeConnection(connectionId);
                    } else {
                        console.error('Error sending to connection:', connectionId, error);
                    }
                }
            });

            await Promise.allSettled(sendPromises);
        } catch (error) {
            console.error('Error publishing progress:', error);
        }
    }

    private async getSessionConnections(): Promise<string[]> {
        try {
            const result = await docClient.send(new QueryCommand({
                TableName: CONNECTIONS_TABLE,
                IndexName: 'SessionIdIndex',
                KeyConditionExpression: 'sessionId = :sessionId',
                ExpressionAttributeValues: {
                    ':sessionId': this.sessionId
                }
            }));

            return result.Items?.map(item => item.connectionId) || [];
        } catch (error) {
            console.error('Error querying connections:', error);
            return [];
        }
    }

    private async removeConnection(connectionId: string): Promise<void> {
        try {
            await docClient.send(new DeleteCommand({
                TableName: CONNECTIONS_TABLE,
                Key: { connectionId }
            }));
        } catch (error) {
            console.error('Error removing connection:', error);
        }
    }

    async info(message: string, metadata?: ProgressMessage['metadata']): Promise<void> {
        await this.publish({ type: 'info', message, timestamp: Date.now(), metadata });
    }

    async success(message: string, metadata?: ProgressMessage['metadata']): Promise<void> {
        await this.publish({ type: 'success', message, timestamp: Date.now(), metadata });
    }

    async error(message: string, metadata?: ProgressMessage['metadata']): Promise<void> {
        await this.publish({ type: 'error', message, timestamp: Date.now(), metadata });
    }

    async progress(message: string, phase: ProgressMessage['phase'], metadata?: ProgressMessage['metadata']): Promise<void> {
        await this.publish({ type: 'progress', message, timestamp: Date.now(), phase, metadata });
    }

    async cacheHit(message: string, metadata?: ProgressMessage['metadata']): Promise<void> {
        await this.publish({ type: 'cache-hit', message, timestamp: Date.now(), metadata });
    }

    async cacheMiss(message: string, metadata?: ProgressMessage['metadata']): Promise<void> {
        await this.publish({ type: 'cache-miss', message, timestamp: Date.now(), metadata });
    }

    /**
     * Publish a category result for async card loading.
     * Frontend receives this and immediately populates the corresponding card.
     */
    async categoryResult(category: string, data: any, message?: string): Promise<void> {
        await this.publish({
            type: 'category-result',
            message: message || `${category} analysis complete`,
            timestamp: Date.now(),
            metadata: { category, data },
        });
    }
}
