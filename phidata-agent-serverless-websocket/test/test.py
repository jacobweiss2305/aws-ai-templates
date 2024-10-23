import asyncio
import json
import websockets
import logging
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WebSocketAgentTester:
    def __init__(self, websocket_url: str):
        self.websocket_url = websocket_url
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None

    async def connect(self):
        """Establish WebSocket connection"""
        try:
            self.websocket = await websockets.connect(self.websocket_url)
            logger.info("Connected to AI agent")
            return True
        except Exception as e:
            logger.error(f"Connection failed: {str(e)}")
            return False

    async def send_question(self, question: str):
        """Send a question to the AI agent"""
        if not self.websocket:
            logger.error("No active connection")
            return

        message = {
            "question": question
        }
        
        try:
            await self.websocket.send(json.dumps(message))
            logger.info(f"Sent question: {question}")
        except Exception as e:
            logger.error(f"Error sending message: {str(e)}")

    async def receive_messages(self):
        """Receive and process messages from the AI agent"""
        if not self.websocket:
            logger.error("No active connection")
            return

        try:
            while True:
                message = await self.websocket.recv()
                data = json.loads(message)
                
                if 'type' in data:
                    if data['type'] == 'status':
                        logger.info(f"Status: {data['message']}")
                    elif data['type'] == 'response':
                        logger.info(f"AI Response: {data['content']}")
                    elif data['type'] == 'error':
                        logger.error(f"Error: {data['message']}")
                else:
                    logger.info(f"Received message: {data}")
        except websockets.exceptions.ConnectionClosed:
            logger.info("Connection closed")
        except Exception as e:
            logger.error(f"Error receiving message: {str(e)}")

    async def close(self):
        """Close the WebSocket connection"""
        if self.websocket:
            await self.websocket.close()
            logger.info("Connection closed")

async def main():
    # Replace with your WebSocket URL
    websocket_url = "wss://p3ttev6hdf.execute-api.us-east-1.amazonaws.com/prod"
    
    # Create tester instance
    tester = WebSocketAgentTester(websocket_url)
    
    # Connect to the WebSocket
    if not await tester.connect():
        return

    try:
        # Start receiving messages in the background
        receive_task = asyncio.create_task(tester.receive_messages())
        
        # Send test questions
        test_questions = [
            "What is the meaning of life?",
            "How does photosynthesis work?",
            "Tell me a joke about programming",
        ]
        
        for question in test_questions:
            await tester.send_question(question)
            # Wait a bit between questions
            await asyncio.sleep(2)

        # Wait for a while to receive responses
        await asyncio.sleep(30)
        
    except Exception as e:
        logger.error(f"Error during test: {str(e)}")
    finally:
        # Clean up
        if receive_task:
            receive_task.cancel()
        await tester.close()

if __name__ == "__main__":
    # Run the test
    asyncio.run(main())