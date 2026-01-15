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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvZ3Jlc3MtcHVibGlzaGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGFtYmRhLWxheWVycy9zaGFyZWQvcHJvZ3Jlc3MtcHVibGlzaGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsOERBQTBEO0FBQzFELHdEQUE2RTtBQUM3RSw0RkFBaUg7QUFFakgsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVcsRUFBRSxDQUFDLENBQUM7QUFDM0YsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBRTVELE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsSUFBSSw2QkFBNkIsQ0FBQztBQUN6RixNQUFNLHNCQUFzQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLENBQUM7QUFrQmxFLE1BQWEsaUJBQWlCO0lBSTFCLFlBQVksU0FBaUI7UUFDekIsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFFM0IsSUFBSSxzQkFBc0IsRUFBRTtZQUN4QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSw4REFBNkIsQ0FBQztnQkFDdEQsUUFBUSxFQUFFLHNCQUFzQjtnQkFDaEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVc7YUFDaEQsQ0FBQyxDQUFDO1NBQ047SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUF3QjtRQUNsQyxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixFQUFFO1lBQ3hCLE9BQU8sQ0FBQyxHQUFHLENBQUMscURBQXFELEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDNUUsT0FBTztTQUNWO1FBRUQsSUFBSTtZQUNBLHVDQUF1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SSxFQUFFLFlBQVk7WUFDbEIsT0FBTztZQUNQLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLFFBQVE7U0FDWCxDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUE1SUQsOENBNElDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUXVlcnlDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcbmltcG9ydCB7IEFwaUdhdGV3YXlNYW5hZ2VtZW50QXBpQ2xpZW50LCBQb3N0VG9Db25uZWN0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1hcGlnYXRld2F5bWFuYWdlbWVudGFwaSc7XG5cbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyB9KTtcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xuXG5jb25zdCBDT05ORUNUSU9OU19UQUJMRSA9IHByb2Nlc3MuZW52LkNPTk5FQ1RJT05TX1RBQkxFIHx8ICdsZW5zeS13ZWJzb2NrZXQtY29ubmVjdGlvbnMnO1xuY29uc3QgV0VCU09DS0VUX0FQSV9FTkRQT0lOVCA9IHByb2Nlc3MuZW52LldFQlNPQ0tFVF9BUElfRU5EUE9JTlQ7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHJvZ3Jlc3NNZXNzYWdlIHtcbiAgICB0eXBlOiAnaW5mbycgfCAnc3VjY2VzcycgfCAnZXJyb3InIHwgJ3Byb2dyZXNzJyB8ICdjYWNoZS1oaXQnIHwgJ2NhY2hlLW1pc3MnO1xuICAgIG1lc3NhZ2U6IHN0cmluZztcbiAgICB0aW1lc3RhbXA6IG51bWJlcjtcbiAgICBwaGFzZT86ICd1cmwtcHJvY2Vzc2luZycgfCAnc3RydWN0dXJlLWRldGVjdGlvbicgfCAnZGltZW5zaW9uLWFuYWx5c2lzJyB8ICdyZXBvcnQtZ2VuZXJhdGlvbic7XG4gICAgbWV0YWRhdGE/OiB7XG4gICAgICAgIGRpbWVuc2lvbj86IHN0cmluZztcbiAgICAgICAgc2NvcmU/OiBudW1iZXI7XG4gICAgICAgIHByb2Nlc3NpbmdUaW1lPzogbnVtYmVyO1xuICAgICAgICBjYWNoZVN0YXR1cz86ICdoaXQnIHwgJ21pc3MnO1xuICAgICAgICBjb250ZW50VHlwZT86IHN0cmluZztcbiAgICAgICAgY29udGV4dFBhZ2VzPzogbnVtYmVyO1xuICAgICAgICBba2V5OiBzdHJpbmddOiBhbnk7XG4gICAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIFByb2dyZXNzUHVibGlzaGVyIHtcbiAgICBwcml2YXRlIHNlc3Npb25JZDogc3RyaW5nO1xuICAgIHByaXZhdGUgYXBpR2F0ZXdheUNsaWVudD86IEFwaUdhdGV3YXlNYW5hZ2VtZW50QXBpQ2xpZW50O1xuXG4gICAgY29uc3RydWN0b3Ioc2Vzc2lvbklkOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZXNzaW9uSWQgPSBzZXNzaW9uSWQ7XG5cbiAgICAgICAgaWYgKFdFQlNPQ0tFVF9BUElfRU5EUE9JTlQpIHtcbiAgICAgICAgICAgIHRoaXMuYXBpR2F0ZXdheUNsaWVudCA9IG5ldyBBcGlHYXRld2F5TWFuYWdlbWVudEFwaUNsaWVudCh7XG4gICAgICAgICAgICAgICAgZW5kcG9pbnQ6IFdFQlNPQ0tFVF9BUElfRU5EUE9JTlQsXG4gICAgICAgICAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIHB1Ymxpc2gobWVzc2FnZTogUHJvZ3Jlc3NNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGlmICghdGhpcy5hcGlHYXRld2F5Q2xpZW50KSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnV2ViU29ja2V0IG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBwcm9ncmVzcyB1cGRhdGU6JywgbWVzc2FnZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gR2V0IGFsbCBjb25uZWN0aW9ucyBmb3IgdGhpcyBzZXNzaW9uXG4gICAgICAgICAgICBjb25zdCBjb25uZWN0aW9ucyA9IGF3YWl0IHRoaXMuZ2V0U2Vzc2lvbkNvbm5lY3Rpb25zKCk7XG5cbiAgICAgICAgICAgIGlmIChjb25uZWN0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnTm8gYWN0aXZlIGNvbm5lY3Rpb25zIGZvciBzZXNzaW9uOicsIHRoaXMuc2Vzc2lvbklkKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNlbmQgbWVzc2FnZSB0byBhbGwgY29ubmVjdGlvbnNcbiAgICAgICAgICAgIGNvbnN0IHNlbmRQcm9taXNlcyA9IGNvbm5lY3Rpb25zLm1hcChhc3luYyAoY29ubmVjdGlvbklkKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5hcGlHYXRld2F5Q2xpZW50IS5zZW5kKG5ldyBQb3N0VG9Db25uZWN0aW9uQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBDb25uZWN0aW9uSWQ6IGNvbm5lY3Rpb25JZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIERhdGE6IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKVxuICAgICAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZW50IHByb2dyZXNzIHRvIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OmAsIG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZXJyb3Iuc3RhdHVzQ29kZSA9PT0gNDEwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDb25uZWN0aW9uIGlzIHN0YWxlLCByZW1vdmUgaXRcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTdGFsZSBjb25uZWN0aW9uLCByZW1vdmluZzonLCBjb25uZWN0aW9uSWQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5yZW1vdmVDb25uZWN0aW9uKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzZW5kaW5nIHRvIGNvbm5lY3Rpb246JywgY29ubmVjdGlvbklkLCBlcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHNlbmRQcm9taXNlcyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBwdWJsaXNoaW5nIHByb2dyZXNzOicsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgZ2V0U2Vzc2lvbkNvbm5lY3Rpb25zKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xuICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogQ09OTkVDVElPTlNfVEFCTEUsXG4gICAgICAgICAgICAgICAgSW5kZXhOYW1lOiAnU2Vzc2lvbklkSW5kZXgnLFxuICAgICAgICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdzZXNzaW9uSWQgPSA6c2Vzc2lvbklkJyxcbiAgICAgICAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICc6c2Vzc2lvbklkJzogdGhpcy5zZXNzaW9uSWRcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQuSXRlbXM/Lm1hcChpdGVtID0+IGl0ZW0uY29ubmVjdGlvbklkKSB8fCBbXTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHF1ZXJ5aW5nIGNvbm5lY3Rpb25zOicsIGVycm9yKTtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgYXN5bmMgcmVtb3ZlQ29ubmVjdGlvbihjb25uZWN0aW9uSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgeyBEZWxldGVDb21tYW5kIH0gPSBhd2FpdCBpbXBvcnQoJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYicpO1xuICAgICAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xuICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogQ09OTkVDVElPTlNfVEFCTEUsXG4gICAgICAgICAgICAgICAgS2V5OiB7IGNvbm5lY3Rpb25JZCB9XG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciByZW1vdmluZyBjb25uZWN0aW9uOicsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvbnZlbmllbmNlIG1ldGhvZHMgZm9yIGNvbW1vbiBtZXNzYWdlIHR5cGVzXG4gICAgYXN5bmMgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUHJvZ3Jlc3NNZXNzYWdlWydtZXRhZGF0YSddKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaCh7XG4gICAgICAgICAgICB0eXBlOiAnaW5mbycsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgICAgbWV0YWRhdGFcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgc3VjY2VzcyhtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUHJvZ3Jlc3NNZXNzYWdlWydtZXRhZGF0YSddKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaCh7XG4gICAgICAgICAgICB0eXBlOiAnc3VjY2VzcycsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgICAgbWV0YWRhdGFcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgZXJyb3IobWVzc2FnZTogc3RyaW5nLCBtZXRhZGF0YT86IFByb2dyZXNzTWVzc2FnZVsnbWV0YWRhdGEnXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2goe1xuICAgICAgICAgICAgdHlwZTogJ2Vycm9yJyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBwcm9ncmVzcyhtZXNzYWdlOiBzdHJpbmcsIHBoYXNlOiBQcm9ncmVzc01lc3NhZ2VbJ3BoYXNlJ10sIG1ldGFkYXRhPzogUHJvZ3Jlc3NNZXNzYWdlWydtZXRhZGF0YSddKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaCh7XG4gICAgICAgICAgICB0eXBlOiAncHJvZ3Jlc3MnLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICAgIHBoYXNlLFxuICAgICAgICAgICAgbWV0YWRhdGFcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgY2FjaGVIaXQobWVzc2FnZTogc3RyaW5nLCBtZXRhZGF0YT86IFByb2dyZXNzTWVzc2FnZVsnbWV0YWRhdGEnXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2goe1xuICAgICAgICAgICAgdHlwZTogJ2NhY2hlLWhpdCcsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgICAgbWV0YWRhdGFcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgY2FjaGVNaXNzKG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBQcm9ncmVzc01lc3NhZ2VbJ21ldGFkYXRhJ10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdjYWNoZS1taXNzJyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG59XG4iXX0=