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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicHJvZ3Jlc3MtcHVibGlzaGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vbGFtYmRhL3NpdGVtYXAtcGFyc2VyL3Byb2dyZXNzLXB1Ymxpc2hlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw4REFBd0U7QUFDeEUsNEZBQWlIO0FBVWpILE1BQWEsaUJBQWlCO0lBSzFCLFlBQVksU0FBaUI7UUFIckIscUJBQWdCLEdBQXlDLElBQUksQ0FBQztRQUlsRSxJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztRQUMzQixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFFM0UsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQixFQUFFO1lBQ3BDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLDhEQUE2QixDQUFDO2dCQUN0RCxRQUFRLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0I7Z0JBQzVDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVU7YUFDakMsQ0FBQyxDQUFDO1NBQ047SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxPQUFlLEVBQUUsS0FBYyxFQUFFLFFBQThCO1FBQzFFLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQztZQUN0QixJQUFJLEVBQUUsVUFBVTtZQUNoQixPQUFPO1lBQ1AsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7WUFDckIsS0FBSztZQUNMLFFBQVE7U0FDWCxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFlLEVBQUUsUUFBOEI7UUFDekQsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDO1lBQ3RCLElBQUksRUFBRSxTQUFTO1lBQ2YsT0FBTztZQUNQLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLFFBQVE7U0FDWCxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFlLEVBQUUsUUFBOEI7UUFDdkQsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDO1lBQ3RCLElBQUksRUFBRSxPQUFPO1lBQ2IsT0FBTztZQUNQLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLFFBQVE7U0FDWCxDQUFDLENBQUM7SUFDUCxDQUFDO0lBRU8sS0FBSyxDQUFDLGNBQWMsQ0FBQyxPQUF3QjtRQUNqRCxJQUFJLENBQUMsSUFBSSxDQUFDLGdCQUFnQixJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsRUFBRTtZQUMxRCxPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ25FLE9BQU87U0FDVjtRQUVELElBQUk7WUFDQSxtQ0FBbUM7WUFDbkMsTUFBTSxZQUFZLEdBQUcsSUFBSSw4QkFBWSxDQUFDO2dCQUNsQyxTQUFTLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUI7Z0JBQ3hDLFNBQVMsRUFBRSxnQkFBZ0I7Z0JBQzNCLHNCQUFzQixFQUFFLHdCQUF3QjtnQkFDaEQseUJBQXlCLEVBQUU7b0JBQ3ZCLFlBQVksRUFBRSxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFO2lCQUN0QzthQUNKLENBQUMsQ0FBQztZQUVILE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFFL0QsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLElBQUksV0FBVyxDQUFDLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO2dCQUN0RCxPQUFPLENBQUMsR0FBRyxDQUFDLDZDQUE2QyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDM0UsT0FBTzthQUNWO1lBRUQsbURBQW1EO1lBQ25ELE1BQU0sWUFBWSxHQUFHLFdBQVcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsRUFBRTtnQkFDdEQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7Z0JBQzFDLElBQUksQ0FBQyxZQUFZO29CQUFFLE9BQU87Z0JBRTFCLElBQUk7b0JBQ0EsTUFBTSxJQUFJLENBQUMsZ0JBQWlCLENBQUMsSUFBSSxDQUFDLElBQUksd0RBQXVCLENBQUM7d0JBQzFELFlBQVksRUFBRSxZQUFZO3dCQUMxQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUM7cUJBQ2hDLENBQUMsQ0FBQyxDQUFDO2lCQUNQO2dCQUFDLE9BQU8sS0FBVSxFQUFFO29CQUNqQixJQUFJLEtBQUssQ0FBQyxVQUFVLEtBQUssR0FBRyxFQUFFO3dCQUMxQixPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixFQUFFLFlBQVksQ0FBQyxDQUFDO3FCQUNsRDt5QkFBTTt3QkFDSCxPQUFPLENBQUMsS0FBSyxDQUFDLHNDQUFzQyxFQUFFLFlBQVksRUFBRSxLQUFLLENBQUMsQ0FBQztxQkFDOUU7aUJBQ0o7WUFDTCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxDQUFDLFVBQVUsQ0FBQyxZQUFZLENBQUMsQ0FBQztTQUMxQztRQUFDLE9BQU8sS0FBSyxFQUFFO1lBQ1osT0FBTyxDQUFDLEtBQUssQ0FBQyxvQ0FBb0MsRUFBRSxLQUFLLENBQUMsQ0FBQztTQUM5RDtJQUNMLENBQUM7Q0FDSjtBQTdGRCw4Q0E2RkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEeW5hbW9EQkNsaWVudCwgUXVlcnlDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IEFwaUdhdGV3YXlNYW5hZ2VtZW50QXBpQ2xpZW50LCBQb3N0VG9Db25uZWN0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1hcGlnYXRld2F5bWFuYWdlbWVudGFwaSc7XG5cbmludGVyZmFjZSBQcm9ncmVzc01lc3NhZ2Uge1xuICAgIHR5cGU6ICdpbmZvJyB8ICdzdWNjZXNzJyB8ICdlcnJvcicgfCAncHJvZ3Jlc3MnO1xuICAgIG1lc3NhZ2U6IHN0cmluZztcbiAgICB0aW1lc3RhbXA6IG51bWJlcjtcbiAgICBwaGFzZT86IHN0cmluZztcbiAgICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmV4cG9ydCBjbGFzcyBQcm9ncmVzc1B1Ymxpc2hlciB7XG4gICAgcHJpdmF0ZSBkeW5hbW9DbGllbnQ6IER5bmFtb0RCQ2xpZW50O1xuICAgIHByaXZhdGUgYXBpR2F0ZXdheUNsaWVudDogQXBpR2F0ZXdheU1hbmFnZW1lbnRBcGlDbGllbnQgfCBudWxsID0gbnVsbDtcbiAgICBwcml2YXRlIHNlc3Npb25JZDogc3RyaW5nO1xuXG4gICAgY29uc3RydWN0b3Ioc2Vzc2lvbklkOiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZXNzaW9uSWQgPSBzZXNzaW9uSWQ7XG4gICAgICAgIHRoaXMuZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuXG4gICAgICAgIGlmIChwcm9jZXNzLmVudi5XRUJTT0NLRVRfQVBJX0VORFBPSU5UKSB7XG4gICAgICAgICAgICB0aGlzLmFwaUdhdGV3YXlDbGllbnQgPSBuZXcgQXBpR2F0ZXdheU1hbmFnZW1lbnRBcGlDbGllbnQoe1xuICAgICAgICAgICAgICAgIGVuZHBvaW50OiBwcm9jZXNzLmVudi5XRUJTT0NLRVRfQVBJX0VORFBPSU5ULFxuICAgICAgICAgICAgICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTlxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhc3luYyBwcm9ncmVzcyhtZXNzYWdlOiBzdHJpbmcsIHBoYXNlPzogc3RyaW5nLCBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIGFueT4pIHtcbiAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoTWVzc2FnZSh7XG4gICAgICAgICAgICB0eXBlOiAncHJvZ3Jlc3MnLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICAgIHBoYXNlLFxuICAgICAgICAgICAgbWV0YWRhdGFcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgYXN5bmMgc3VjY2VzcyhtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2hNZXNzYWdlKHtcbiAgICAgICAgICAgIHR5cGU6ICdzdWNjZXNzJyxcbiAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgICBtZXRhZGF0YVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBhc3luYyBlcnJvcihtZXNzYWdlOiBzdHJpbmcsIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgYW55Pikge1xuICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2hNZXNzYWdlKHtcbiAgICAgICAgICAgIHR5cGU6ICdlcnJvcicsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgICAgbWV0YWRhdGFcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBhc3luYyBwdWJsaXNoTWVzc2FnZShtZXNzYWdlOiBQcm9ncmVzc01lc3NhZ2UpIHtcbiAgICAgICAgaWYgKCF0aGlzLmFwaUdhdGV3YXlDbGllbnQgfHwgIXByb2Nlc3MuZW52LkNPTk5FQ1RJT05TX1RBQkxFKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZygnV2ViU29ja2V0IG5vdCBjb25maWd1cmVkLCBsb2dnaW5nIG1lc3NhZ2U6JywgbWVzc2FnZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gR2V0IGNvbm5lY3Rpb25zIGZvciB0aGlzIHNlc3Npb25cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5Q29tbWFuZCA9IG5ldyBRdWVyeUNvbW1hbmQoe1xuICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogcHJvY2Vzcy5lbnYuQ09OTkVDVElPTlNfVEFCTEUsXG4gICAgICAgICAgICAgICAgSW5kZXhOYW1lOiAnU2Vzc2lvbklkSW5kZXgnLFxuICAgICAgICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdzZXNzaW9uSWQgPSA6c2Vzc2lvbklkJyxcbiAgICAgICAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgICAgICAgICAgICc6c2Vzc2lvbklkJzogeyBTOiB0aGlzLnNlc3Npb25JZCB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGNvbnN0IGNvbm5lY3Rpb25zID0gYXdhaXQgdGhpcy5keW5hbW9DbGllbnQuc2VuZChxdWVyeUNvbW1hbmQpO1xuXG4gICAgICAgICAgICBpZiAoIWNvbm5lY3Rpb25zLkl0ZW1zIHx8IGNvbm5lY3Rpb25zLkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBXZWJTb2NrZXQgY29ubmVjdGlvbnMgZm91bmQgZm9yIHNlc3Npb246JywgdGhpcy5zZXNzaW9uSWQpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gU2VuZCBtZXNzYWdlIHRvIGFsbCBjb25uZWN0aW9ucyBmb3IgdGhpcyBzZXNzaW9uXG4gICAgICAgICAgICBjb25zdCBzZW5kUHJvbWlzZXMgPSBjb25uZWN0aW9ucy5JdGVtcy5tYXAoYXN5bmMgKGl0ZW0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBjb25uZWN0aW9uSWQgPSBpdGVtLmNvbm5lY3Rpb25JZD8uUztcbiAgICAgICAgICAgICAgICBpZiAoIWNvbm5lY3Rpb25JZCkgcmV0dXJuO1xuXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5hcGlHYXRld2F5Q2xpZW50IS5zZW5kKG5ldyBQb3N0VG9Db25uZWN0aW9uQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBDb25uZWN0aW9uSWQ6IGNvbm5lY3Rpb25JZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIERhdGE6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpXG4gICAgICAgICAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnJvci5zdGF0dXNDb2RlID09PSA0MTApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdTdGFsZSBjb25uZWN0aW9uOicsIGNvbm5lY3Rpb25JZCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzZW5kaW5nIG1lc3NhZ2UgdG8gY29ubmVjdGlvbjonLCBjb25uZWN0aW9uSWQsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoc2VuZFByb21pc2VzKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHB1Ymxpc2hpbmcgcHJvZ3Jlc3MgbWVzc2FnZTonLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICB9XG59Il19