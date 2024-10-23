type MessageHandler = (data: any, messageType: 'response' | 'status' | 'error') => void;

const wsUrl = process.env.NEXT_PUBLIC_AWS_GATEWAY_WS_URL || '';

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageHandlers: MessageHandler[] = [];
  private readonly url: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeout: number = 1000;
  private isIntentionallyClosed: boolean = false;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly CONNECTION_TIMEOUT = 10000; // 10 seconds
  private readonly PING_INTERVAL = 30000; // 30 seconds

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log('WebSocket already connected');
        resolve(true);
        return;
      }

      try {
        this.isIntentionallyClosed = false;
        console.log('Initiating WebSocket connection...');
        
        // Clear any existing connection timeout
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }

        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
          console.log('Connection timeout - closing socket');
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            this.ws.close();
            resolve(false);
          }
        }, this.CONNECTION_TIMEOUT);

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected successfully');
          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
          }
          
          // Setup ping interval to keep connection alive
          this.setupPing();
          
          this.reconnectAttempts = 0;
          this.reconnectTimeout = 1000;
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('Received message:', data);
            
            if (data.type === 'response') {
              this.messageHandlers.forEach(handler => handler(data.content, 'response'));
            } else if (data.type === 'status') {
              this.messageHandlers.forEach(handler => handler(data.message, 'status'));
            } else if (data.type === 'error') {
              this.messageHandlers.forEach(handler => handler(data.message, 'error'));
            }
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error event:', error);
          // Don't resolve here, wait for close event
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });

          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
          }
          
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
          }

          if (!this.isIntentionallyClosed) {
            this.handleReconnection();
          }

          resolve(false);
        };

      } catch (error) {
        console.error('Connection setup failed:', error);
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
        }
        resolve(false);
      }
    });
  }

  private setupPing() {
    // Clear any existing ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Set up new ping interval
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          // Send a ping message to keep the connection alive
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('Error sending ping:', error);
        }
      }
    }, this.PING_INTERVAL);
  }

  private async handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts && !this.isIntentionallyClosed) {
      console.log(`Attempting to reconnect... Attempt ${this.reconnectAttempts + 1}`);
      
      this.messageHandlers.forEach(handler => 
        handler(`Reconnecting... Attempt ${this.reconnectAttempts + 1}`, 'status')
      );

      await new Promise(resolve => setTimeout(resolve, this.reconnectTimeout));
      
      this.reconnectTimeout = Math.min(this.reconnectTimeout * 2, 10000); // Cap at 10 seconds
      this.reconnectAttempts += 1;
      
      await this.connect();
    } else if (!this.isIntentionallyClosed) {
      this.messageHandlers.forEach(handler => 
        handler('Unable to establish connection after multiple attempts', 'error')
      );
    }
  }

  sendMessage(question: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('No active connection, current state:', this.ws?.readyState);
      return false;
    }

    const message = {
      action: 'sendmessage', // Add API Gateway action
      question: question
    };

    try {
      this.ws.send(JSON.stringify(message));
      console.log('Sent question:', question);
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }
  addMessageHandler(handler: MessageHandler) {
    this.messageHandlers.push(handler);
  }

  removeMessageHandler(handler: MessageHandler) {
    this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
  }

  close() {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close(1000, 'Client closing connection');
    }
  }
}

const websocketService = new WebSocketService(wsUrl);

export default websocketService;