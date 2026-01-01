import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';

interface ProgressMessage {
    type: 'info' | 'success' | 'error' | 'progress';
    message: string;
    timestamp: number;
    phase?: string;
    metadata?: Record<string, any>;
}

export class ProgressPublisher {
    private dynamoClient: DynamoDBClient;
    private apiGatewayClient: ApiGatewayManagementApiClient | null = null;
    private sessionId: string;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

        if (process.env.WEBSOCKET_API_ENDPOINT) {
            this.apiGatewayClient = new ApiGatewayManagementApiClient({
                endpoint: process.env.WEBSOCKET_API_ENDPOINT,
                region: process.env.AWS_REGION
            });
        }
    }

    async progress(message: string, phase?: string, metadata?: Record<string, any>) {
        await this.publishMessage({
            type: 'progress',
            message,
            timestamp: Date.now(),
            phase,
            metadata
        });
    }

    async success(message: string, metadata?: Record<string, any>) {
        await this.publishMessage({
            type: 'success',
            message,
            timestamp: Date.now(),
            metadata
        });
    }

    async error(message: string, metadata?: Record<string, any>) {
        await this.publishMessage({
            type: 'error',
            message,
            timestamp: Date.now(),
            metadata
        });
    }

    private async publishMessage(message: ProgressMessage) {
        if (!this.apiGatewayClient || !process.env.CONNECTIONS_TABLE) {
            console.log('WebSocket not configured, logging message:', message);
            return;
        }

        try {
            // Get connections for this session
            const queryCommand = new QueryCommand({
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
                if (!connectionId) return;

                try {
                    await this.apiGatewayClient!.send(new PostToConnectionCommand({
                        ConnectionId: connectionId,
                        Data: JSON.stringify(message)
                    }));
                } catch (error: any) {
                    if (error.statusCode === 410) {
                        console.log('Stale connection:', connectionId);
                    } else {
                        console.error('Error sending message to connection:', connectionId, error);
                    }
                }
            });

            await Promise.allSettled(sendPromises);
        } catch (error) {
            console.error('Error publishing progress message:', error);
        }
    }
}