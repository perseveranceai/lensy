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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvZ3Jlc3MtcHVibGlzaGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicHJvZ3Jlc3MtcHVibGlzaGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDhEQUF3RTtBQUN4RSw0RkFBaUg7QUFVakgsTUFBYSxpQkFBaUI7SUFLMUIsWUFBWSxTQUFpQjtRQUhyQixxQkFBZ0IsR0FBeUMsSUFBSSxDQUFDO1FBSWxFLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUUzRSxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsc0JBQXNCLEVBQUU7WUFDcEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksOERBQTZCLENBQUM7Z0JBQ3RELFFBQVEsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQjtnQkFDNUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVTthQUNqQyxDQUFDLENBQUM7U0FDTjtJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQWUsRUFBRSxLQUFjLEVBQUUsUUFBOEI7UUFDMUUsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDO1lBQ3RCLElBQUksRUFBRSxVQUFVO1lBQ2hCLE9BQU87WUFDUCxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixLQUFLO1lBQ0wsUUFBUTtTQUNYLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQWUsRUFBRSxRQUE4QjtRQUN6RCxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUM7WUFDdEIsSUFBSSxFQUFFLFNBQVM7WUFDZixPQUFPO1lBQ1AsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsUUFBUTtTQUNYLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFRCxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQWUsRUFBRSxRQUE4QjtRQUN2RCxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUM7WUFDdEIsSUFBSSxFQUFFLE9BQU87WUFDYixPQUFPO1lBQ1AsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsUUFBUTtTQUNYLENBQUMsQ0FBQztJQUNQLENBQUM7SUFFTyxLQUFLLENBQUMsY0FBYyxDQUFDLE9BQXdCO1FBQ2pELElBQUksQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixFQUFFO1lBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsNENBQTRDLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDbkUsT0FBTztTQUNWO1FBRUQsSUFBSTtZQUNBLG1DQUFtQztZQUNuQyxNQUFNLFlBQVksR0FBRyxJQUFJLDhCQUFZLENBQUM7Z0JBQ2xDLFNBQVMsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtnQkFDeEMsU0FBUyxFQUFFLGdCQUFnQjtnQkFDM0Isc0JBQXNCLEVBQUUsd0JBQXdCO2dCQUNoRCx5QkFBeUIsRUFBRTtvQkFDdkIsWUFBWSxFQUFFLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxTQUFTLEVBQUU7aUJBQ3RDO2FBQ0osQ0FBQyxDQUFDO1lBRUgsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztZQUUvRCxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssSUFBSSxXQUFXLENBQUMsS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7Z0JBQ3RELE9BQU8sQ0FBQyxHQUFHLENBQUMsNkNBQTZDLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUMzRSxPQUFPO2FBQ1Y7WUFFRCxtREFBbUQ7WUFDbkQsTUFBTSxZQUFZLEdBQUcsV0FBVyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxFQUFFO2dCQUN0RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQztnQkFDMUMsSUFBSSxDQUFDLFlBQVk7b0JBQUUsT0FBTztnQkFFMUIsSUFBSTtvQkFDQSxNQUFNLElBQUksQ0FBQyxnQkFBaUIsQ0FBQyxJQUFJLENBQUMsSUFBSSx3REFBdUIsQ0FBQzt3QkFDMUQsWUFBWSxFQUFFLFlBQVk7d0JBQzFCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQztxQkFDaEMsQ0FBQyxDQUFDLENBQUM7aUJBQ1A7Z0JBQUMsT0FBTyxLQUFVLEVBQUU7b0JBQ2pCLElBQUksS0FBSyxDQUFDLFVBQVUsS0FBSyxHQUFHLEVBQUU7d0JBQzFCLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLEVBQUUsWUFBWSxDQUFDLENBQUM7cUJBQ2xEO3lCQUFNO3dCQUNILE9BQU8sQ0FBQyxLQUFLLENBQUMsc0NBQXNDLEVBQUUsWUFBWSxFQUFFLEtBQUssQ0FBQyxDQUFDO3FCQUM5RTtpQkFDSjtZQUNMLENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO1NBQzFDO1FBQUMsT0FBTyxLQUFLLEVBQUU7WUFDWixPQUFPLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1NBQzlEO0lBQ0wsQ0FBQztDQUNKO0FBN0ZELDhDQTZGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IER5bmFtb0RCQ2xpZW50LCBRdWVyeUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xuaW1wb3J0IHsgQXBpR2F0ZXdheU1hbmFnZW1lbnRBcGlDbGllbnQsIFBvc3RUb0Nvbm5lY3Rpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWFwaWdhdGV3YXltYW5hZ2VtZW50YXBpJztcblxuaW50ZXJmYWNlIFByb2dyZXNzTWVzc2FnZSB7XG4gICAgdHlwZTogJ2luZm8nIHwgJ3N1Y2Nlc3MnIHwgJ2Vycm9yJyB8ICdwcm9ncmVzcyc7XG4gICAgbWVzc2FnZTogc3RyaW5nO1xuICAgIHRpbWVzdGFtcDogbnVtYmVyO1xuICAgIHBoYXNlPzogc3RyaW5nO1xuICAgIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pjtcbn1cblxuZXhwb3J0IGNsYXNzIFByb2dyZXNzUHVibGlzaGVyIHtcbiAgICBwcml2YXRlIGR5bmFtb0NsaWVudDogRHluYW1vREJDbGllbnQ7XG4gICAgcHJpdmF0ZSBhcGlHYXRld2F5Q2xpZW50OiBBcGlHYXRld2F5TWFuYWdlbWVudEFwaUNsaWVudCB8IG51bGwgPSBudWxsO1xuICAgIHByaXZhdGUgc2Vzc2lvbklkOiBzdHJpbmc7XG5cbiAgICBjb25zdHJ1Y3RvcihzZXNzaW9uSWQ6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNlc3Npb25JZCA9IHNlc3Npb25JZDtcbiAgICAgICAgdGhpcy5keW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XG5cbiAgICAgICAgaWYgKHByb2Nlc3MuZW52LldFQlNPQ0tFVF9BUElfRU5EUE9JTlQpIHtcbiAgICAgICAgICAgIHRoaXMuYXBpR2F0ZXdheUNsaWVudCA9IG5ldyBBcGlHYXRld2F5TWFuYWdlbWVudEFwaUNsaWVudCh7XG4gICAgICAgICAgICAgICAgZW5kcG9pbnQ6IHByb2Nlc3MuZW52LldFQlNPQ0tFVF9BUElfRU5EUE9JTlQsXG4gICAgICAgICAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFzeW5jIHByb2dyZXNzKG1lc3NhZ2U6IHN0cmluZywgcGhhc2U/OiBzdHJpbmcsIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2hNZXNzYWdlKHtcbiAgICAgICAgICAgIHR5cGU6ICdwcm9ncmVzcycsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgICAgcGhhc2UsXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBzdWNjZXNzKG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaE1lc3NhZ2Uoe1xuICAgICAgICAgICAgdHlwZTogJ3N1Y2Nlc3MnLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICAgIG1ldGFkYXRhXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIGFzeW5jIGVycm9yKG1lc3NhZ2U6IHN0cmluZywgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSB7XG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaE1lc3NhZ2Uoe1xuICAgICAgICAgICAgdHlwZTogJ2Vycm9yJyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGFzeW5jIHB1Ymxpc2hNZXNzYWdlKG1lc3NhZ2U6IFByb2dyZXNzTWVzc2FnZSkge1xuICAgICAgICBpZiAoIXRoaXMuYXBpR2F0ZXdheUNsaWVudCB8fCAhcHJvY2Vzcy5lbnYuQ09OTkVDVElPTlNfVEFCTEUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdXZWJTb2NrZXQgbm90IGNvbmZpZ3VyZWQsIGxvZ2dpbmcgbWVzc2FnZTonLCBtZXNzYWdlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBHZXQgY29ubmVjdGlvbnMgZm9yIHRoaXMgc2Vzc2lvblxuICAgICAgICAgICAgY29uc3QgcXVlcnlDb21tYW5kID0gbmV3IFF1ZXJ5Q29tbWFuZCh7XG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiBwcm9jZXNzLmVudi5DT05ORUNUSU9OU19UQUJMRSxcbiAgICAgICAgICAgICAgICBJbmRleE5hbWU6ICdTZXNzaW9uSWRJbmRleCcsXG4gICAgICAgICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Nlc3Npb25JZCA9IDpzZXNzaW9uSWQnLFxuICAgICAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgICAgICAgICAgICAgJzpzZXNzaW9uSWQnOiB7IFM6IHRoaXMuc2Vzc2lvbklkIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3QgY29ubmVjdGlvbnMgPSBhd2FpdCB0aGlzLmR5bmFtb0NsaWVudC5zZW5kKHF1ZXJ5Q29tbWFuZCk7XG5cbiAgICAgICAgICAgIGlmICghY29ubmVjdGlvbnMuSXRlbXMgfHwgY29ubmVjdGlvbnMuSXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIFdlYlNvY2tldCBjb25uZWN0aW9ucyBmb3VuZCBmb3Igc2Vzc2lvbjonLCB0aGlzLnNlc3Npb25JZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTZW5kIG1lc3NhZ2UgdG8gYWxsIGNvbm5lY3Rpb25zIGZvciB0aGlzIHNlc3Npb25cbiAgICAgICAgICAgIGNvbnN0IHNlbmRQcm9taXNlcyA9IGNvbm5lY3Rpb25zLkl0ZW1zLm1hcChhc3luYyAoaXRlbSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNvbm5lY3Rpb25JZCA9IGl0ZW0uY29ubmVjdGlvbklkPy5TO1xuICAgICAgICAgICAgICAgIGlmICghY29ubmVjdGlvbklkKSByZXR1cm47XG5cbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmFwaUdhdGV3YXlDbGllbnQhLnNlbmQobmV3IFBvc3RUb0Nvbm5lY3Rpb25Db21tYW5kKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIENvbm5lY3Rpb25JZDogY29ubmVjdGlvbklkLFxuICAgICAgICAgICAgICAgICAgICAgICAgRGF0YTogSlNPTi5zdHJpbmdpZnkobWVzc2FnZSlcbiAgICAgICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVycm9yLnN0YXR1c0NvZGUgPT09IDQxMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1N0YWxlIGNvbm5lY3Rpb246JywgY29ubmVjdGlvbklkKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNlbmRpbmcgbWVzc2FnZSB0byBjb25uZWN0aW9uOicsIGNvbm5lY3Rpb25JZCwgZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChzZW5kUHJvbWlzZXMpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgcHVibGlzaGluZyBwcm9ncmVzcyBtZXNzYWdlOicsIGVycm9yKTtcbiAgICAgICAgfVxuICAgIH1cbn0iXX0=