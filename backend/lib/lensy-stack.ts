import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigwv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export class LensyStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 1. S3 Bucket for Analysis
        const analysisBucket = new s3.Bucket(this, 'LensyAnalysisBucket', {
            bucketName: `lensy-analysis-951411676525-${this.region}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // 2. DynamoDB Tables
        const processedContentTable = new dynamodb.Table(this, 'ProcessedContentTableV3', {
            partitionKey: { name: 'url', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'contextualSetting', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        processedContentTable.addGlobalSecondaryIndex({
            indexName: 'ProcessedAtIndex',
            partitionKey: { name: 'processedAt', type: dynamodb.AttributeType.STRING },
        });

        const webSocketConnectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
            partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        webSocketConnectionsTable.addGlobalSecondaryIndex({
            indexName: 'SessionIdIndex',
            partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
        });

        // 3. WebSocket API
        const webSocketHandler = new lambda.Function(this, 'WebSocketHandlerFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/websocket-handler')),
            timeout: cdk.Duration.seconds(30),
            environment: {
                WS_CONNECTIONS_TABLE: webSocketConnectionsTable.tableName,
            }
        });
        webSocketConnectionsTable.grantReadWriteData(webSocketHandler);

        const webSocketApi = new apigwv2.WebSocketApi(this, 'LensyWebSocketApi', {
            connectRouteOptions: { integration: new apigwv2_integrations.WebSocketLambdaIntegration('ConnectIntegration', webSocketHandler) },
            disconnectRouteOptions: { integration: new apigwv2_integrations.WebSocketLambdaIntegration('DisconnectIntegration', webSocketHandler) },
            defaultRouteOptions: { integration: new apigwv2_integrations.WebSocketLambdaIntegration('DefaultIntegration', webSocketHandler) },
        });

        const webSocketStage = new apigwv2.WebSocketStage(this, 'WebSocketStage', {
            webSocketApi,
            stageName: 'prod',
            autoDeploy: true,
        });

        webSocketApi.addRoute('subscribe', {
            integration: new apigwv2_integrations.WebSocketLambdaIntegration('SubscribeIntegration', webSocketHandler),
        });

        const wsEndpoint = `https://${webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com/prod`;

        // 4. Functional Lambdas
        const commonEnv = {
            ANALYSIS_BUCKET: analysisBucket.bucketName,
            WEBSOCKET_API_ENDPOINT: wsEndpoint,
            CONNECTIONS_TABLE: webSocketConnectionsTable.tableName,
        };

        const createLambda = (id: string, dir: string, timeout = 30, memory = 128, env = {}) => {
            const fn = new lambda.Function(this, id, {
                runtime: lambda.Runtime.NODEJS_20_X,
                handler: 'index.handler',
                code: lambda.Code.fromAsset(path.join(__dirname, `../lambda/${dir}`)),
                timeout: cdk.Duration.seconds(timeout),
                memorySize: memory,
                environment: { ...commonEnv, ...env }
            });
            analysisBucket.grantReadWrite(fn);
            webSocketConnectionsTable.grantReadWriteData(fn);
            fn.addToRolePolicy(new iam.PolicyStatement({
                actions: ['execute-api:ManageConnections'],
                resources: [`arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/prod/*`],
            }));
            return fn;
        };

        const inputTypeDetector = createLambda('InputTypeDetectorFunction', 'input-type-detector', 60);
        const sitemapParser = createLambda('SitemapParserFunction', 'sitemap-parser', 120);
        const sitemapHealthChecker = createLambda('SitemapHealthCheckerFunction', 'sitemap-health-checker', 300, 256);
        const urlProcessor = createLambda('URLProcessorFunction', 'url-processor', 120, 512);
        const structureDetector = createLambda('StructureDetectorFunction', 'structure-detector', 60);
        
        const dimensionAnalyzer = createLambda('DimensionAnalyzerFunction', 'dimension-analyzer', 300, 512, {
            PROCESSED_CONTENT_TABLE: processedContentTable.tableName,
            CACHE_TTL_DAYS: '7'
        });
        processedContentTable.grantReadWriteData(dimensionAnalyzer);
        dimensionAnalyzer.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        }));

        const reportGenerator = createLambda('ReportGeneratorFunction', 'report-generator', 60, 256);
        const issueDiscoverer = createLambda('IssueDiscovererFunction', 'issue-discoverer', 120, 512, { S3_BUCKET_NAME: analysisBucket.bucketName });
        const issueValidator = createLambda('IssueValidatorFunction', 'issue-validator', 300, 1024, { S3_BUCKET_NAME: analysisBucket.bucketName });
        const fixGenerator = createLambda('FixGeneratorFunction', 'fix-generator', 300, 1024);
        const fixApplicator = createLambda('FixApplicatorFunction', 'fix-applicator', 300, 512);

        issueValidator.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        }));
        
        // 5. Step Functions Workflow
        const definitionString = `{"StartAt":"DetectInputType","States":{"DetectInputType":{"Next":"InputTypeChoice","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.inputTypeDetectorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${inputTypeDetector.functionArn}","Payload.$":"$"}},"InputTypeChoice":{"Type":"Choice","Choices":[{"Variable":"$.inputTypeDetectorResult.Payload.inputType","StringEquals":"sitemap","Next":"ParseSitemap"}],"Default":"ProcessURL"},"ProcessURL":{"Next":"DetectStructure","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.urlProcessorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${urlProcessor.functionArn}","Payload.$":"$"}},"DetectStructure":{"Next":"AnalyzeDimensions","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.structureDetectorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${structureDetector.functionArn}","Payload.$":"$"}},"AnalyzeDimensions":{"Next":"GenerateReport","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.dimensionAnalyzerResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${dimensionAnalyzer.functionArn}","Payload.$":"$"}},"GenerateReport":{"End":true,"Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.reportGeneratorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${reportGenerator.functionArn}","Payload.$":"$"}},"CheckSitemapHealth":{"Next":"GenerateReport","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.sitemapHealthCheckerResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${sitemapHealthChecker.functionArn}","Payload.$":"$"}},"ParseSitemap":{"Next":"CheckSitemapHealth","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.sitemapParserResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${sitemapParser.functionArn}","Payload.$":"$"}}},"TimeoutSeconds":900}`;

        const stateMachine = new sfn.StateMachine(this, 'LensyAnalysisWorkflow', {
            definitionBody: sfn.DefinitionBody.fromString(definitionString),
            timeout: cdk.Duration.minutes(15),
        });

        // 6. API Handler and HTTP API
        const apiHandler = createLambda('ApiHandlerFunction', 'api-handler', 30, 256, {
            STATE_MACHINE_ARN: stateMachine.stateMachineArn,
            ISSUE_DISCOVERER_FUNCTION_NAME: issueDiscoverer.functionName,
            ISSUE_VALIDATOR_FUNCTION_NAME: issueValidator.functionName,
            FIX_GENERATOR_FUNCTION_NAME: fixGenerator.functionName,
            FIX_APPLICATOR_FUNCTION_NAME: fixApplicator.functionName,
        });

        stateMachine.grantStartExecution(apiHandler);
        issueDiscoverer.grantInvoke(apiHandler);
        issueValidator.grantInvoke(apiHandler);
        fixGenerator.grantInvoke(apiHandler);
        fixApplicator.grantInvoke(apiHandler);

        const httpApi = new apigwv2.HttpApi(this, 'LensyHttpApi', {
            description: 'Lensy HTTP API',
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
                allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
                maxAge: cdk.Duration.days(10),
            },
        });

        const apiIntegration = new apigwv2_integrations.HttpLambdaIntegration('ApiHandlerIntegration', apiHandler);

        httpApi.addRoutes({ path: '/analyze', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
        httpApi.addRoutes({ path: '/scan-doc', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
        httpApi.addRoutes({ path: '/status/{sessionId}', methods: [apigwv2.HttpMethod.GET], integration: apiIntegration });
        httpApi.addRoutes({ path: '/discover-issues', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
        httpApi.addRoutes({ path: '/validate-issues', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
        httpApi.addRoutes({ path: '/generate-fixes', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
        httpApi.addRoutes({ path: '/apply-fixes', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });

        // 7. Outputs
        new cdk.CfnOutput(this, 'HttpApiUrl', {
            value: httpApi.apiEndpoint,
            description: 'HTTP API Gateway URL',
        });

        new cdk.CfnOutput(this, 'WebSocketApiUrl', {
            value: webSocketStage.url,
            description: 'WebSocket API URL',
        });

        new cdk.CfnOutput(this, 'StateMachineArn', {
            value: stateMachine.stateMachineArn,
            description: 'Step Functions State Machine ARN',
        });
    }
}
