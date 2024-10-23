import os
import json
import time
import logging
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.DEBUG)

# Environment variables
AGENT_LAMBDA_NAME = os.environ['AGENT_LAMBDA_NAME']
CONNECTIONS_TABLE_NAME = os.environ['CONNECTIONS_TABLE_NAME']
REGION = os.environ['REGION']

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
lambda_client = boto3.client('lambda')
connections_table = dynamodb.Table(CONNECTIONS_TABLE_NAME)

def store_connection(connection_id: str, connection_data: dict):
    """Store connection information in DynamoDB"""
    try:
        ttl = int(time.time()) + 24 * 60 * 60  # 24 hour TTL
        item = {
            'connectionId': connection_id,
            'ttl': ttl,
            'connectionData': connection_data
        }
        connections_table.put_item(Item=item)
    except Exception as e:
        logger.error(f"Error storing connection: {str(e)}")
        raise

def delete_connection(connection_id: str):
    """Delete connection information from DynamoDB"""
    try:
        connections_table.delete_item(
            Key={'connectionId': connection_id}
        )
    except Exception as e:
        logger.error(f"Error deleting connection: {str(e)}")
        raise

def send_websocket_message(connection_id: str, data: dict, event: dict):
    """Send a message back through the WebSocket connection"""
    domain_name = event["requestContext"]["domainName"]
    stage = event["requestContext"]["stage"]
    endpoint = f"https://{domain_name}/{stage}"
    
    try:
        client = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint)
        client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data)
        )
    except ClientError as e:
        logger.error(f"Error sending message: {str(e)}")
        if e.response['Error']['Code'] == 'GoneException':
            logger.info(f"Connection {connection_id} is gone")
            delete_connection(connection_id)
        else:
            raise

def invoke_agent_lambda(event: dict, connection_id: str):
    """Invoke the agent Lambda function"""
    # Add connection details to the event
    event['connectionInfo'] = {
        'connectionId': connection_id,
        'domainName': event["requestContext"]["domainName"],
        'stage': event["requestContext"]["stage"]
    }
    
    try:
        response = lambda_client.invoke(
            FunctionName=AGENT_LAMBDA_NAME,
            InvocationType='Event',  # Asynchronous invocation
            Payload=json.dumps(event)
        )
        return response
    except Exception as e:
        logger.error(f"Error invoking agent Lambda: {str(e)}")
        raise

def handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    # Get connection information
    connection_id = event["requestContext"]["connectionId"]
    route_key = event["requestContext"]["routeKey"]

    try:
        # Handle different WebSocket routes
        if route_key == "$connect":
            # Store connection information
            connection_data = {
                'domainName': event["requestContext"]["domainName"],
                'stage': event["requestContext"]["stage"],
                'connectedAt': int(time.time())
            }
            store_connection(connection_id, connection_data)
            
            return {
                "statusCode": 200,
                "body": "Connected"
            }
            
        elif route_key == "$disconnect":
            # Remove connection information
            delete_connection(connection_id)
            
            return {
                "statusCode": 200,
                "body": "Disconnected"
            }
            
        elif route_key == "$default":
            # Parse the message body
            body = json.loads(event.get("body", "{}"))
            question = body.get("question")
            
            if not question:
                error_message = {"error": "No question provided"}
                send_websocket_message(connection_id, error_message, event)
                return {"statusCode": 400}

            # Send a message that processing has started
            send_websocket_message(connection_id, {
                "type": "status",
                "message": "Processing your question..."
            }, event)

            # Invoke the agent Lambda
            invoke_agent_lambda(event, connection_id)
            
            return {"statusCode": 200}
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        try:
            error_message = {
                "type": "error",
                "message": "An error occurred during processing"
            }
            send_websocket_message(connection_id, error_message, event)
        except:
            logger.error("Failed to send error message to client")
            
        return {"statusCode": 500}