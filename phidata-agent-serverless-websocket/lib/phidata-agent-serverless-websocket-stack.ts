import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as dotenv from 'dotenv';

dotenv.config();

export class PhidataAgentServerlessWebsocketStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const requiredEnvVars = [
        'OPENAI_API_KEY',
    ];

    for (const envVar of requiredEnvVars) {
        if (typeof process.env[envVar] !== 'string') {
            throw new Error(`${envVar} environment variable is not set`);
        }
    }
    
    // Create DynamoDB table for connection management
    const connectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
      tableName: 'websocket-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development - change for production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    
    const secret = new secretsmanager.Secret(this, 'EnvVarsSecret', {
        secretName: 'PhidataServerlessAgentSecrets',
        generateSecretString: {
            secretStringTemplate: JSON.stringify({
                OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            }),
            generateStringKey: 'ignore_this',
        }
    });        

    // Create WebSocket API
    const webSocketApi = new apigatewayv2.CfnApi(this, 'PhidataServerlessAgentWebSocketApi', {
      name: 'PhidataServerlessAgentWebSocketApi',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
    });

    // Create Agent Lambda
    const agentLambda = new lambda.DockerImageFunction(this, "PhidataServerlessAgent", {
        code: lambda.DockerImageCode.fromImageAsset("./lambdas/agents"),
        memorySize: 1024 * 2,
        architecture: lambda.Architecture.X86_64,
        timeout: cdk.Duration.seconds(90),
        environment: {
            SECRET_STORAGE: secret.secretName,
        },
    });

    // Create Connection Handler Lambda
    const connectionHandlerLambda = new lambda.Function(this, "WebSocketConnectionHandler", {
        runtime: lambda.Runtime.PYTHON_3_9,
        code: lambda.Code.fromAsset("./lambdas/connection_handler"),
        handler: "handler.handler",
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        environment: {
            AGENT_LAMBDA_NAME: agentLambda.functionName,
            CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
            REGION: this.region
        }
    });

    // Grant DynamoDB permissions to the Connection Handler Lambda
    connectionsTable.grantReadWriteData(connectionHandlerLambda);

    // Grant permissions to the Connection Handler Lambda
    connectionHandlerLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'execute-api:ManageConnections',
        'lambda:InvokeFunction'
      ],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`,
        agentLambda.functionArn
      ]
    }));

    // Grant permissions to the Agent Lambda
    agentLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'execute-api:ManageConnections'
      ],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`
      ]
    }));

    secret.grantRead(agentLambda);

    // Create Lambda integration for the connection handler
    const connectIntegration = new apigatewayv2.CfnIntegration(this, 'ConnectIntegration', {
      apiId: webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${connectionHandlerLambda.functionArn}/invocations`,
    });

    // Create routes
    new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    new apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    new apigatewayv2.CfnRoute(this, 'DefaultRoute', {
      apiId: webSocketApi.ref,
      routeKey: '$default',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    // Create and deploy stage
    const stage = new apigatewayv2.CfnStage(this, 'ProductionStage', {
      apiId: webSocketApi.ref,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant Lambda permissions to be invoked by API Gateway
    connectionHandlerLambda.addPermission('WebSocketPermission', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*`,
    });

    new cdk.CfnOutput(this, "SecretName", {
        value: secret.secretName,
    });    

    new cdk.CfnOutput(this, "WebSocketApiUrl", {
        value: `wss://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${stage.stageName}`,
    });

    new cdk.CfnOutput(this, "ConnectionsTableName", {
        value: connectionsTable.tableName,
    });
  }
}