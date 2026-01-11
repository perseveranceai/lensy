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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvZ3Jlc3MtcHVibGlzaGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicHJvZ3Jlc3MtcHVibGlzaGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDhEQUEwRDtBQUMxRCx3REFBNkU7QUFDN0UsNEZBQWlIO0FBRWpILE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXLEVBQUUsQ0FBQyxDQUFDO0FBQzNGLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztBQUU1RCxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUJBQWlCLElBQUksNkJBQTZCLENBQUM7QUFDekYsTUFBTSxzQkFBc0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQixDQUFDO0FBa0JsRSxNQUFhLGlCQUFpQjtJQUkxQixZQUFZLFNBQWlCO1FBQ3pCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBRTNCLElBQUksc0JBQXNCLEVBQUUsQ0FBQztZQUN6QixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSw4REFBNkIsQ0FBQztnQkFDdEQsUUFBUSxFQUFFLHNCQUFzQjtnQkFDaEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVc7YUFDaEQsQ0FBQyxDQUFDO1FBQ1AsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQXdCO1FBQ2xDLElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztZQUN6QixPQUFPLENBQUMsR0FBRyxDQUFDLHFEQUFxRCxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQzVFLE9BQU87UUFDWCxDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0Qs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UUFBUTtTQUNYLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQWUsRUFBRSxRQUFzQztRQUNuRSxNQUFNLElBQUksQ0FBQyxPQUFPLENBQUM7WUFDZixJQUFJLEVBQUUsWUFBWTtZQUNsQixPQUFPO1lBQ1AsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsUUFBUTtTQUNYLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQTVJRCw4Q0E0SUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBRdWVyeUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xuaW1wb3J0IHsgQXBpR2F0ZXdheU1hbmFnZW1lbnRBcGlDbGllbnQsIFBvc3RUb0Nvbm5lY3Rpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWFwaWdhdGV3YXltYW5hZ2VtZW50YXBpJztcblxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnIH0pO1xuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XG5cbmNvbnN0IENPTk5FQ1RJT05TX1RBQkxFID0gcHJvY2Vzcy5lbnYuQ09OTkVDVElPTlNfVEFCTEUgfHwgJ2xlbnN5LXdlYnNvY2tldC1jb25uZWN0aW9ucyc7XG5jb25zdCBXRUJTT0NLRVRfQVBJX0VORFBPSU5UID0gcHJvY2Vzcy5lbnYuV0VCU09DS0VUX0FQSV9FTkRQT0lOVDtcblxuZXhwb3J0IGludGVyZmFjZSBQcm9ncmVzc01lc3NhZ2Uge1xuICAgIHR5cGU6ICdpbmZvJyB8ICdzdWNjZXNzJyB8ICdlcnJvcicgfCAncHJvZ3Jlc3MnIHwgJ2NhY2hlLWhpdCcgfCAnY2FjaGUtbWlzcyc7XG4gICAgbWVzc2FnZTogc3RyaW5nO1xuICAgIHRpbWVzdGFtcDogbnVtYmVyO1xuICAgIHBoYXNlPzogJ3VybC1wcm9jZXNzaW5nJyB8ICdzdHJ1Y3R1cmUtZGV0ZWN0aW9uJyB8ICdkaW1lbnNpb24tYW5hbHlzaXMnIHwgJ3JlcG9ydC1nZW5lcmF0aW9uJztcbiAgICBtZXRhZGF0YT86IHtcbiAgICAgICAgZGltZW5zaW9uPzogc3RyaW5nO1xuICAgICAgICBzY29yZT86IG51bWJlcjtcbiAgICAgICAgcHJvY2Vzc2luZ1RpbWU/OiBudW1iZXI7XG4gICAgICAgIGNhY2hlU3RhdHVzPzogJ2hpdCcgfCAnbWlzcyc7XG4gICAgICAgIGNvbnRlbnRUeXBlPzogc3RyaW5nO1xuICAgICAgICBjb250ZXh0UGFnZXM/OiBudW1iZXI7XG4gICAgICAgIFtrZXk6IHN0cmluZ106IGFueTtcbiAgICB9O1xufVxuXG5leHBvcnQgY2xhc3MgUHJvZ3Jlc3NQdWJsaXNoZXIge1xuICAgIHByaXZhdGUgc2Vzc2lvbklkOiBzdHJpbmc7XG4gICAgcHJpdmF0ZSBhcGlHYXRld2F5Q2xpZW50PzogQXBpR2F0ZXdheU1hbmFnZW1lbnRBcGlDbGllbnQ7XG5cbiAgICBjb25zdHJ1Y3RvcihzZXNzaW9uSWQ6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNlc3Npb25JZCA9IHNlc3Npb25JZDtcblxuICAgICAgICBpZiAoV0VCU09DS0VUX0FQSV9FTkRQT0lOVCkge1xuICAgICAgICAgICAgdGhpcy5hcGlHYXRld2F5Q2xpZW50ID0gbmV3IEFwaUdhdGV3YXlNYW5hZ2VtZW50QXBpQ2xpZW50KHtcbiAgICAgICAgICAgICAgICBlbmRwb2ludDogV0VCU09DS0VUX0FQSV9FTkRQT0lOVCxcbiAgICAgICAgICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMSdcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYXN5bmMgcHVibGlzaChtZXNzYWdlOiBQcm9ncmVzc01lc3NhZ2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgaWYgKCF0aGlzLmFwaUdhdGV3YXlDbGllbnQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdXZWJTb2NrZXQgbm90IGNvbmZpZ3VyZWQsIHNraXBwaW5nIHByb2dyZXNzIHVwZGF0ZTonLCBtZXNzYWdlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBHZXQgYWxsIGNvbm5lY3Rpb25zIGZvciB0aGlzIHNlc3Npb25cbiAgICAgICAgICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gYXdhaXQgdGhpcy5nZXRTZXNzaW9uQ29ubmVjdGlvbnMoKTtcblxuICAgICAgICAgICAgaWYgKGNvbm5lY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBhY3RpdmUgY29ubmVjdGlvbnMgZm9yIHNlc3Npb246JywgdGhpcy5zZXNzaW9uSWQpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gU2VuZCBtZXNzYWdlIHRvIGFsbCBjb25uZWN0aW9uc1xuICAgICAgICAgICAgY29uc3Qgc2VuZFByb21pc2VzID0gY29ubmVjdGlvbnMubWFwKGFzeW5jIChjb25uZWN0aW9uSWQpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmFwaUdhdGV3YXlDbGllbnQhLnNlbmQobmV3IFBvc3RUb0Nvbm5lY3Rpb25Db21tYW5kKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIENvbm5lY3Rpb25JZDogY29ubmVjdGlvbklkLFxuICAgICAgICAgICAgICAgICAgICAgICAgRGF0YTogQnVmZmVyLmZyb20oSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbnQgcHJvZ3Jlc3MgdG8gY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06YCwgbWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnJvci5zdGF0dXNDb2RlID09PSA0MTApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENvbm5lY3Rpb24gaXMgc3RhbGUsIHJlbW92ZSBpdFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1N0YWxlIGNvbm5lY3Rpb24sIHJlbW92aW5nOicsIGNvbm5lY3Rpb25JZCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnJlbW92ZUNvbm5lY3Rpb24oY29ubmVjdGlvbklkKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNlbmRpbmcgdG8gY29ubmVjdGlvbjonLCBjb25uZWN0aW9uSWQsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc2VuZFByb21pc2VzKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHB1Ymxpc2hpbmcgcHJvZ3Jlc3M6JywgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBnZXRTZXNzaW9uQ29ubmVjdGlvbnMoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiBDT05ORUNUSU9OU19UQUJMRSxcbiAgICAgICAgICAgICAgICBJbmRleE5hbWU6ICdTZXNzaW9uSWRJbmRleCcsXG4gICAgICAgICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Nlc3Npb25JZCA9IDpzZXNzaW9uSWQnLFxuICAgICAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgJzpzZXNzaW9uSWQnOiB0aGlzLnNlc3Npb25JZFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pKTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtcz8ubWFwKGl0ZW0gPT4gaXRlbS5jb25uZWN0aW9uSWQpIHx8IFtdO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgcXVlcnlpbmcgY29ubmVjdGlvbnM6JywgZXJyb3IpO1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyByZW1vdmVDb25uZWN0aW9uKGNvbm5lY3Rpb25JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCB7IERlbGV0ZUNvbW1hbmQgfSA9IGF3YWl0IGltcG9ydCgnQGF3cy1zZGsvbGliLWR5bmFtb2RiJyk7XG4gICAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiBDT05ORUNUSU9OU19UQUJMRSxcbiAgICAgICAgICAgICAgICBLZXk6IHsgY29ubmVjdGlvbklkIH1cbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHJlbW92aW5nIGNvbm5lY3Rpb246JywgZXJyb3IpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ29udmVuaWVuY2UgbWV0aG9kcyBmb3IgY29tbW9uIG1lc3NhZ2UgdHlwZXNcbiAgICBhc3luYyBpbmZvKG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBQcm9ncmVzc01lc3NhZ2VbJ21ldGFkYXRhJ10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdpbmZvJyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBzdWNjZXNzKG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBQcm9ncmVzc01lc3NhZ2VbJ21ldGFkYXRhJ10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdzdWNjZXNzJyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBlcnJvcihtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUHJvZ3Jlc3NNZXNzYWdlWydtZXRhZGF0YSddKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaCh7XG4gICAgICAgICAgICB0eXBlOiAnZXJyb3InLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICAgIG1ldGFkYXRhXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGFzeW5jIHByb2dyZXNzKG1lc3NhZ2U6IHN0cmluZywgcGhhc2U6IFByb2dyZXNzTWVzc2FnZVsncGhhc2UnXSwgbWV0YWRhdGE/OiBQcm9ncmVzc01lc3NhZ2VbJ21ldGFkYXRhJ10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKHtcbiAgICAgICAgICAgIHR5cGU6ICdwcm9ncmVzcycsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgICAgcGhhc2UsXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBjYWNoZUhpdChtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUHJvZ3Jlc3NNZXNzYWdlWydtZXRhZGF0YSddKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaCh7XG4gICAgICAgICAgICB0eXBlOiAnY2FjaGUtaGl0JyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBjYWNoZU1pc3MobWVzc2FnZTogc3RyaW5nLCBtZXRhZGF0YT86IFByb2dyZXNzTWVzc2FnZVsnbWV0YWRhdGEnXSk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2goe1xuICAgICAgICAgICAgdHlwZTogJ2NhY2hlLW1pc3MnLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICAgIG1ldGFkYXRhXG4gICAgICAgIH0pO1xuICAgIH1cbn1cbiJdfQ==