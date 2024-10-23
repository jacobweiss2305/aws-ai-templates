import os
import json
import logging
import boto3
from botocore.exceptions import ClientError
from utils import get_secret

from phi.agent import Agent, RunResponse
from phi.model.openai import OpenAIChat

logger = logging.getLogger()
logger.setLevel(logging.DEBUG)

secret_storage = os.environ["SECRET_STORAGE"]
region_name = "us-east-1"

secret = get_secret(secret_storage, region_name)
api_key = secret["OPENAI_API_KEY"]

def send_websocket_message(connection_info: dict, data: dict):
    """Send a message back through the WebSocket connection"""
    endpoint = f"https://{connection_info['domainName']}/{connection_info['stage']}"
    
    try:
        client = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint)
        client.post_to_connection(
            ConnectionId=connection_info['connectionId'],
            Data=json.dumps(data)
        )
    except ClientError as e:
        logger.error(f"Error sending message: {str(e)}")
        if e.response['Error']['Code'] == 'GoneException':
            logger.info(f"Connection {connection_info['connectionId']} is gone")
        else:
            raise

def handler(event, context):
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Get connection information
        connection_info = event['connectionInfo']
        
        # Parse the message body
        body = json.loads(event.get("body", "{}"))
        question = body.get("question")

        # Initialize agent and get response
        agent = Agent(model=OpenAIChat(id="gpt-4o", api_key=api_key), markdown=True)
        
        # Get the response
        run: RunResponse = agent.run(question)
        
        # Send the response back to the client
        response_data = {
            "type": "response",
            "content": run.content
        }
        send_websocket_message(connection_info, response_data)
        
        return {"statusCode": 200}
            
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        try:
            error_message = {
                "type": "error",
                "message": "An error occurred during processing"
            }
            send_websocket_message(connection_info, error_message)
        except:
            logger.error("Failed to send error message to client")
            
        return {"statusCode": 500}