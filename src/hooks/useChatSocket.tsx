// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/hooks/useChatSocket.ts
import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// Define the structure of a chat message
export interface ChatMessage {
  type: 'user' | 'model' | 'error' | 'system'; // Added 'system' for general info
  text: string;
}

// Define the possible connection statuses
export type ConnectionStatus = 'idle' | 'connected' | 'disconnected' | 'connecting' | 'error';
// Define the possible processing statuses
export type ProcessingStatus = 'idle' | 'processing' | 'error';

export function useChatSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>('idle');

  // Effect to initialize and clean up socket connection
  useEffect(() => {
    console.log(`Attempting to connect Socket.IO to the origin server...`);
    setConnectionStatus('connecting');
    // Ensure this only runs client-side
    // Omit the URL to connect to the origin server
    const newSocket = io({
        transports: ['websocket'], // Explicitly use WebSocket
        reconnectionAttempts: 5,
        timeout: 10000,
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Socket.IO connected:', newSocket.id);
      setConnectionStatus('connected');
      setProcessingStatus('idle');
      // Optionally add a system message on connect
      // setMessages(prev => [...prev, { type: 'system', text: 'Connected to server.' }]);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
      setConnectionStatus('disconnected');
      setProcessingStatus('idle');
      if (reason !== 'io client disconnect') { // Don't show error if manually disconnected
        setMessages(prev => [...prev, { type: 'error', text: `Disconnected: ${reason}. Attempting to reconnect...` }]);
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err);
      setConnectionStatus('error');
      setProcessingStatus('idle');
      setMessages(prev => [...prev, { type: 'error', text: `Connection failed: ${err.message}. Please check the server.` }]);
    });

    // Handle incoming messages from the server
    newSocket.on('new_message', (data: { type: ChatMessage['type']; text: string }) => {
      console.log('Received message:', data);
      // Only add messages that are NOT of type 'user'
      // User messages are added optimistically in sendMessage
      if (data.type && data.text && data.type !== 'user') {
        setMessages(prev => [...prev, { type: data.type, text: data.text }]);
        // If model finished or an error occurred, set status back to idle
        if (data.type === 'model' || data.type === 'error') {
            setProcessingStatus('idle');
        }
      } else if (data.type === 'user') {
        // Optionally log that a user message was received but ignored
        console.log('Ignoring echoed user message from server:', data.text);
      } else {
        console.warn('Received malformed new_message event:', data);
      }
    });

    // Handle status updates from the server
    newSocket.on('status_update', (data: { message: string }) => {
        console.log('Status update:', data.message);
        if (data.message === 'Processing...') {
            setProcessingStatus('processing');
        } else if (connectionStatus === 'connected') {
            // Only reset to idle if connected and not an error/processing message
            setProcessingStatus('idle');
        }
        // We might want a dedicated state for the status text itself later
    });

    // Handle server-side errors
    newSocket.on('error', (data: { message: string }) => {
      console.error('Server error:', data.message);
      setMessages(prev => [...prev, { type: 'error', text: `Server Error: ${data.message}` }]);
      setProcessingStatus('error');
    });

    // Handle history reset signal (optional, could clear messages)
    newSocket.on('history_reset', () => {
        console.log('History reset signal received.');
        // setMessages([]); // Uncomment to clear messages on reset signal
    });

    // Cleanup function to disconnect socket on component unmount
    return () => {
      console.log('Disconnecting Socket.IO');
      newSocket.close();
      setSocket(null);
      setConnectionStatus('disconnected');
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // Function to send a message to the server
  const sendMessage = useCallback((prompt: string) => {
    if (socket && connectionStatus === 'connected' && prompt.trim()) {
      console.log('Sending message:', prompt);
      // Add user message immediately to the UI for responsiveness
      setMessages(prev => [...prev, { type: 'user', text: prompt.trim() }]);
      setProcessingStatus('processing'); // Set status to processing immediately
      socket.emit('send_message', { prompt: prompt.trim() });
    } else {
        console.warn('Cannot send message. Socket not connected or prompt is empty.');
        if (connectionStatus !== 'connected') {
            setMessages(prev => [...prev, { type: 'error', text: 'Cannot send message: Not connected to server.' }]);
        }
    }
  }, [socket, connectionStatus]);

  // Function to explicitly request a chat reset (if backend supports it)
  const resetChat = useCallback(() => {
    if (socket && connectionStatus === 'connected') {
        console.log('Requesting chat reset');
        // Optionally clear local messages immediately
        setMessages([]);
        setProcessingStatus('idle');
        // Add a system message indicating reset
        setMessages(prev => [...prev, { type: 'system', text: 'Chat history reset.' }]);
        socket.emit('reset_chat'); // Assuming a 'reset_chat' event exists on the backend
    } else {
        console.warn('Cannot reset chat. Socket not connected.');
    }
  }, [socket, connectionStatus]);

  return {
    messages,
    connectionStatus,
    processingStatus,
    sendMessage,
    resetChat,
  };
}