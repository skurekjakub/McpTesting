// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/hooks/useChatSocket.ts
import { useState, useEffect, useCallback, useRef } from 'react';
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

const SESSION_ID_STORAGE_KEY = 'mcpbro_session_id';

// Helper to get or generate session ID
function getSessionId(): string {
    if (typeof window !== 'undefined') {
        let storedId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
        if (storedId) {
            return storedId;
        }
        const newId = crypto.randomUUID();
        localStorage.setItem(SESSION_ID_STORAGE_KEY, newId);
        return newId;
    }
    // Fallback for SSR or environments without localStorage (should ideally not be used for session logic)
    return crypto.randomUUID();
}

export function useChatSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>('idle');
  const [sessionId, setSessionId] = useState<string>(() => getSessionId());
  const [availableSessions, setAvailableSessions] = useState<string[]>([]);
  const hasConnected = useRef(false);

  // Effect to save sessionId to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
        console.log(`Session ID set/updated: ${sessionId}`);
    }
  }, [sessionId]);

  // Effect to initialize and clean up socket connection
  useEffect(() => {
    console.log(`Attempting to connect Socket.IO to the origin server...`);
    setConnectionStatus('connecting');
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
      hasConnected.current = true; // Mark initial connection
      newSocket.emit('list_sessions');
      console.log(`Requesting history load for session: ${sessionId}`);
      newSocket.emit('load_chat', { sessionId });
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
      setConnectionStatus('disconnected');
      setProcessingStatus('idle');
      if (reason !== 'io client disconnect') {
        setMessages(prev => [...prev, { type: 'error', text: `Disconnected: ${reason}. Attempting to reconnect...` }]);
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket.IO connection error:', err);
      setConnectionStatus('error');
      setProcessingStatus('idle');
      setMessages(prev => [...prev, { type: 'error', text: `Connection failed: ${err.message}. Please check the server.` }]);
    });

    newSocket.on('new_message', (data: { type: ChatMessage['type']; text: string }) => {
      console.log('Received message:', data);
      if (data.type && data.text && data.type !== 'user') {
        setMessages(prev => [...prev, { type: data.type, text: data.text }]);
        if (data.type === 'model' || data.type === 'error') {
            setProcessingStatus('idle');
        }
      } else if (data.type === 'user') {
        console.log('Ignoring echoed user message from server:', data.text);
      } else {
        console.warn('Received malformed new_message event:', data);
      }
    });

    newSocket.on('status_update', (data: { message: string }) => {
        console.log('Status update:', data.message);
        if (data.message === 'Processing...') {
            setProcessingStatus('processing');
        } else if (connectionStatus === 'connected') {
            setProcessingStatus('idle');
        }
    });

    newSocket.on('error', (data: { message: string }) => {
      console.error('Server error:', data.message);
      setMessages(prev => [...prev, { type: 'error', text: `Server Error: ${data.message}` }]);
      setProcessingStatus('error');
    });

    newSocket.on('load_history', (data: { displayHistory: ChatMessage[] }) => {
        if (data?.displayHistory && Array.isArray(data.displayHistory)) {
            console.log(`Received history for session ${sessionId}, length: ${data.displayHistory.length}`);
            setMessages(data.displayHistory);
        } else {
            console.warn('Received invalid load_history data:', data);
            setMessages([]);
        }
    });

    newSocket.on('history_reset', () => {
        console.log('History reset signal received from server.');
    });

    newSocket.on('session_list', (data: { sessions: string[] }) => {
        if (data?.sessions && Array.isArray(data.sessions)) {
            console.log('Received session list:', data.sessions);
            setAvailableSessions(data.sessions);
            if (!data.sessions.includes(sessionId) && data.sessions.length > 0) {
                console.log('Current session ID not in list, switching to first available.');
            }
        } else {
            console.warn('Received invalid session_list data:', data);
            setAvailableSessions([]);
        }
    });

    return () => {
      console.log('Disconnecting Socket.IO');
      newSocket.close();
      setSocket(null);
      setConnectionStatus('disconnected');
      hasConnected.current = false;
    };
  }, []);

  useEffect(() => {
    if (socket && connectionStatus === 'connected' && hasConnected.current) {
        console.log(`Session ID changed to: ${sessionId}. Requesting history load.`);
        setMessages([]);
        setProcessingStatus('idle');
        socket.emit('load_chat', { sessionId });
        socket.emit('list_sessions');
    }
  }, [sessionId, socket, connectionStatus]);

  const sendMessage = useCallback((prompt: string) => {
    if (socket && connectionStatus === 'connected' && prompt.trim()) {
      const trimmedPrompt = prompt.trim();
      console.log(`Sending message for session ${sessionId}:`, trimmedPrompt);
      setMessages(prev => [...prev, { type: 'user', text: trimmedPrompt }]);
      setProcessingStatus('processing');
      socket.emit('send_message', { prompt: trimmedPrompt, sessionId });
    } else {
        console.warn('Cannot send message. Socket not connected or prompt is empty.');
        if (connectionStatus !== 'connected') {
            setMessages(prev => [...prev, { type: 'error', text: 'Cannot send message: Not connected to server.' }]);
        }
    }
  }, [socket, connectionStatus, sessionId]);

  const resetChat = useCallback(() => {
    if (socket && connectionStatus === 'connected') {
        console.log(`Requesting chat reset for session ${sessionId}`);
        setMessages([]);
        setProcessingStatus('idle');
        setMessages(prev => [...prev, { type: 'system', text: 'Chat history reset.' }]);
        socket.emit('reset_chat', { sessionId });
    } else {
        console.warn('Cannot reset chat. Socket not connected.');
    }
  }, [socket, connectionStatus, sessionId]);

  const switchSession = useCallback((newSessionId: string) => {
    if (newSessionId && newSessionId !== sessionId) {
        console.log(`Switching session to: ${newSessionId}`);
        setSessionId(newSessionId);
    } else {
        console.warn(`Attempted to switch to invalid or current session ID: ${newSessionId}`);
    }
  }, [sessionId]);

  const startNewSession = useCallback(() => {
    const newId = crypto.randomUUID();
    console.log(`Starting new session: ${newId}`);
    setSessionId(newId);
  }, []);

  return {
    messages,
    connectionStatus,
    processingStatus,
    sessionId,
    availableSessions,
    sendMessage,
    resetChat,
    startNewSession,
    switchSession,
  };
}