import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigwv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
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

        // 2b. Console Access Log — audit trail for login events (IP protection)
        // RETAIN: This table stores legal consent records (terms/privacy opt-in) and must survive stack deletion
        // No TTL — records are kept permanently for legal compliance
        const consoleAccessLogTable = new dynamodb.Table(this, 'ConsoleAccessLogTable', {
            partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'loginTimestamp', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // 3. WebSocket API
        const webSocketHandler = new lambda.Function(this, 'WebSocketHandlerFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/websocket-handler')),
            timeout: cdk.Duration.seconds(30),
            environment: {
                WS_CONNECTIONS_TABLE: webSocketConnectionsTable.tableName,
                CONNECTIONS_TABLE: webSocketConnectionsTable.tableName,
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
        webSocketHandler.addEnvironment('WEBSOCKET_API_ENDPOINT', wsEndpoint);

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
        const githubIssuesAnalyzer = createLambda('GitHubIssuesAnalyzerFunction', 'github-issues-analyzer', 300, 1024);

        githubIssuesAnalyzer.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        }));

        const fixGenerator = createLambda('FixGeneratorFunction', 'fix-generator', 300, 1024);
        const fixApplicator = createLambda('FixApplicatorFunction', 'fix-applicator', 300, 512);

        issueValidator.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        }));

        fixGenerator.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: ['*'],
        }));

        fixApplicator.addToRolePolicy(new iam.PolicyStatement({
            actions: ['s3:GetObject', 's3:PutObject'],
            resources: [`arn:aws:s3:::lensy-demo-docs-${this.account}/*`],
        }));

        fixApplicator.addToRolePolicy(new iam.PolicyStatement({
            actions: ['cloudfront:CreateInvalidation'],
            resources: ['*'], // Allow invalidating any distribution (distribution ID is dynamic/external)
        }));

        const aiReadinessChecker = createLambda('AIReadinessCheckerFunction', 'ai-readiness-checker', 60);

        // NEW: Sitemap health for doc mode
        const sitemapHealthForDocMode = createLambda('SitemapHealthForDocModeFunction', 'sitemap-health-for-doc-mode', 300, 512, {
            SITEMAP_PARSER_FUNCTION_NAME: sitemapParser.functionName,
            SITEMAP_HEALTH_CHECKER_FUNCTION_NAME: sitemapHealthChecker.functionName
        });
        sitemapParser.grantInvoke(sitemapHealthForDocMode);
        sitemapHealthChecker.grantInvoke(sitemapHealthForDocMode);

        // 5. Step Functions Workflow
        // Updated to include parallel sitemap health check for Doc Mode
        const definitionString = `{"StartAt":"DetectInputType","States":{"DetectInputType":{"Next":"InputTypeChoice","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.inputTypeDetectorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${inputTypeDetector.functionArn}","Payload.$":"$"}},"InputTypeChoice":{"Type":"Choice","Choices":[{"Variable":"$.inputTypeDetectorResult.Payload.inputType","StringEquals":"sitemap","Next":"ParseSitemap"}],"Default":"ProcessURL"},"ProcessURL":{"Next":"DetectStructure","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.urlProcessorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${urlProcessor.functionArn}","Payload.$":"$"}},"DetectStructure":{"Next":"CheckAIReadiness","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.structureDetectorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${structureDetector.functionArn}","Payload.$":"$"}},"CheckAIReadiness":{"Next":"ParallelAnalysis","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.aiReadinessResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${aiReadinessChecker.functionArn}","Payload.$":"$"}},"ParallelAnalysis":{"Type":"Parallel","Next":"GenerateReport","ResultPath":"$.parallelResults","Branches":[{"StartAt":"AnalyzeDimensions","States":{"AnalyzeDimensions":{"End":true,"Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.dimensionAnalyzerResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${dimensionAnalyzer.functionArn}","Payload.$":"$"}}}},{"StartAt":"SitemapHealthForDocMode","States":{"SitemapHealthForDocMode":{"End":true,"Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":2,"BackoffRate":2}],"Catch":[{"ErrorEquals":["States.ALL"],"ResultPath":"$.sitemapHealthError","Next":"SitemapHealthSkipped"}],"Type":"Task","ResultPath":"$.sitemapHealthForDocModeResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${sitemapHealthForDocMode.functionArn}","Payload.$":"$"}},"SitemapHealthSkipped":{"Type":"Pass","End":true,"Result":{"success":false,"message":"Sitemap health check skipped due to error"}}}}]},"GenerateReport":{"End":true,"Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.reportGeneratorResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${reportGenerator.functionArn}","Payload.$":"$"}},"CheckSitemapHealth":{"Next":"GenerateReport","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.sitemapHealthCheckerResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${sitemapHealthChecker.functionArn}","Payload.$":"$"}},"ParseSitemap":{"Next":"CheckSitemapHealth","Retry":[{"ErrorEquals":["Lambda.ClientExecutionTimeoutException","Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","ResultPath":"$.sitemapParserResult","Resource":"arn:aws:states:::lambda:invoke","Parameters":{"FunctionName":"${sitemapParser.functionArn}","Payload.$":"$"}}},"TimeoutSeconds":900}`;

        const stateMachine = new sfn.StateMachine(this, 'LensyAnalysisWorkflow', {
            definitionBody: sfn.DefinitionBody.fromString(definitionString),
            timeout: cdk.Duration.minutes(15),
        });

        // Grant Step Functions permission to invoke all Lambda functions
        inputTypeDetector.grantInvoke(stateMachine);
        sitemapParser.grantInvoke(stateMachine);
        sitemapHealthChecker.grantInvoke(stateMachine);
        urlProcessor.grantInvoke(stateMachine);
        structureDetector.grantInvoke(stateMachine);
        dimensionAnalyzer.grantInvoke(stateMachine);
        reportGenerator.grantInvoke(stateMachine);
        aiReadinessChecker.grantInvoke(stateMachine);
        sitemapHealthForDocMode.grantInvoke(stateMachine);

        // 6. API Handler and HTTP API
        const apiHandler = createLambda('ApiHandlerFunction', 'api-handler', 90, 256, {
            STATE_MACHINE_ARN: stateMachine.stateMachineArn,
            ISSUE_DISCOVERER_FUNCTION_NAME: issueDiscoverer.functionName,
            ISSUE_VALIDATOR_FUNCTION_NAME: issueValidator.functionName,
            FIX_GENERATOR_FUNCTION_NAME: fixGenerator.functionName,
            FIX_APPLICATOR_FUNCTION_NAME: fixApplicator.functionName,
            GITHUB_ISSUES_ANALYZER_FUNCTION_NAME: githubIssuesAnalyzer.functionName,
        });

        stateMachine.grantStartExecution(apiHandler);
        issueDiscoverer.grantInvoke(apiHandler);
        issueValidator.grantInvoke(apiHandler);
        fixGenerator.grantInvoke(apiHandler);
        fixApplicator.grantInvoke(apiHandler);
        githubIssuesAnalyzer.grantInvoke(apiHandler);

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
        httpApi.addRoutes({ path: '/sessions/{sessionId}/fixes', methods: [apigwv2.HttpMethod.GET], integration: apiIntegration });
        httpApi.addRoutes({ path: '/get-fixes/{sessionId}', methods: [apigwv2.HttpMethod.GET], integration: apiIntegration });
        httpApi.addRoutes({ path: '/github-issues', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });
        httpApi.addRoutes({ path: '/github-issues/analyze', methods: [apigwv2.HttpMethod.POST], integration: apiIntegration });

        // 6b. Console Login Logger — records login events for audit trail
        const consoleLoginLogger = new lambda.Function(this, 'ConsoleLoginLoggerFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/console-login-logger')),
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            environment: {
                ACCESS_LOG_TABLE: consoleAccessLogTable.tableName,
            },
        });
        consoleAccessLogTable.grantReadWriteData(consoleLoginLogger);

        const loginLoggerIntegration = new apigwv2_integrations.HttpLambdaIntegration('LoginLoggerIntegration', consoleLoginLogger);
        httpApi.addRoutes({ path: '/console/log-login', methods: [apigwv2.HttpMethod.POST], integration: loginLoggerIntegration });

        // ============================================
        // 7. Console Frontend Infrastructure
        //    console.perseveranceai.com
        // ============================================

        const consoleDomainName = 'console.perseveranceai.com';

        // 7a. Route53 Hosted Zone lookup
        const hostedZone = route53.HostedZone.fromLookup(this, 'PerseveranceAIZone', {
            domainName: 'perseveranceai.com',
        });

        // 7b. ACM Certificate for console.perseveranceai.com (must be us-east-1)
        const consoleCertificate = new acm.Certificate(this, 'ConsoleCertificate', {
            domainName: consoleDomainName,
            validation: acm.CertificateValidation.fromDns(hostedZone),
        });

        // 7c. S3 Bucket for Console Frontend (already exists from prior deploy, importing by name)
        const consoleBucket = s3.Bucket.fromBucketName(this, 'ConsoleFrontendBucket',
            `lensy-console-${this.account}-${this.region}`
        );

        // 7d. CloudFront Origin Access Identity
        const consoleOAI = new cloudfront.OriginAccessIdentity(this, 'ConsoleOAI', {
            comment: 'OAI for console.perseveranceai.com',
        });
        consoleBucket.grantRead(consoleOAI);

        // 7e. CloudFront Function for Password Protection
        const passwordAuthFunction = new cloudfront.Function(this, 'ConsolePasswordAuthFunction', {
            code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
    var request = event.request;
    var cookies = request.cookies;
    var uri = request.uri;

    // Bypass auth for login page, legal pages, and static assets
    if (uri === '/login' || uri === '/login/' ||
        uri === '/terms' || uri === '/terms/' ||
        uri === '/privacy' || uri === '/privacy/' ||
        uri.startsWith('/static/') ||
        uri.endsWith('.ico') || uri.endsWith('.png') || uri.endsWith('.svg') ||
        uri.endsWith('.woff') || uri.endsWith('.woff2') ||
        uri === '/manifest.json' || uri === '/favicon.png') {
        // Rewrite SPA routes to index.html (except actual static files)
        if (!uri.startsWith('/static/') && !uri.includes('.')) {
            request.uri = '/index.html';
        }
        return request;
    }

    // Check for valid access token cookie
    var token = cookies['perseverance_console_token']
        ? cookies['perseverance_console_token'].value : null;

    if (token && isValidToken(token)) {
        // Rewrite SPA routes to index.html (except actual static files)
        if (!uri.startsWith('/static/') && !uri.includes('.')) {
            request.uri = '/index.html';
        }
        return request;
    }

    // Not authenticated - redirect to login (with error flag if they had a bad/expired token)
    var loginPath = token ? '/login?error=auth' : '/login';
    return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: {
            'location': { value: loginPath },
            'cache-control': { value: 'no-store' }
        }
    };
}

function isValidToken(token) {
    // UPDATE THESE PASSWORDS AS NEEDED (cdk deploy to apply changes)
    // Format: { 'password': createdTimestampMs }
    // Passcodes expire 48 hours after CREATION DATE (not login time)
    var validPasswords = {
        'LensyBeta2026!': 1771186800000,
        'ShawnBeta2026!': 1771186800000
    };

    var parts = token.split(':');
    if (parts.length < 2) return false;

    var password = parts.slice(0, -1).join(':');
    var loginTime = parseInt(parts[parts.length - 1], 10);

    if (!validPasswords[password]) return false;

    var now = Date.now();
    var passcodeExpiryMs = 48 * 60 * 60 * 1000;
    var passwordCreatedTime = validPasswords[password];

    // Check if the passcode itself has expired (48hrs from creation)
    if (now - passwordCreatedTime > passcodeExpiryMs) return false;

    // Check if login session has expired (48hrs from login)
    if (now - loginTime > passcodeExpiryMs) return false;

    return true;
}
            `),
            functionName: 'perseverance-console-auth',
        });

        // 7f. CloudFront Distribution
        const consoleDistribution = new cloudfront.Distribution(this, 'ConsoleDistribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(consoleBucket, {
                    originAccessIdentity: consoleOAI,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                functionAssociations: [{
                    function: passwordAuthFunction,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                }],
            },
            additionalBehaviors: {
                '/static/*': {
                    origin: new origins.S3Origin(consoleBucket, {
                        originAccessIdentity: consoleOAI,
                    }),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                },
            },
            domainNames: [consoleDomainName],
            certificate: consoleCertificate,
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.seconds(0),
                },
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.seconds(0),
                },
            ],
            enableLogging: false,
            httpVersion: cloudfront.HttpVersion.HTTP2,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        });

        // 7g. Route53 A Record
        new route53.ARecord(this, 'ConsoleAliasRecord', {
            zone: hostedZone,
            recordName: consoleDomainName,
            target: route53.RecordTarget.fromAlias(
                new targets.CloudFrontTarget(consoleDistribution)
            ),
        });

        // ============================================
        // 8. Outputs
        // ============================================

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

        new cdk.CfnOutput(this, 'ConsoleUrl', {
            value: `https://${consoleDomainName}`,
            description: 'Console URL',
        });

        new cdk.CfnOutput(this, 'ConsoleBucketName', {
            value: consoleBucket.bucketName,
            description: 'Console S3 Bucket Name',
        });

        new cdk.CfnOutput(this, 'ConsoleDistributionId', {
            value: consoleDistribution.distributionId,
            description: 'Console CloudFront Distribution ID',
        });
    }
}
