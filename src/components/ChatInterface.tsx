'use client'; // This component uses hooks, so it must be a client component

import React, { useState, useEffect, useRef, FormEvent, ChangeEvent } from 'react'; // Add ChangeEvent
import { useChatSocket } from '@/hooks/useChatSocket';
import ChatMessage from '@/components/ChatMessage';

const ChatInterface: React.FC = () => {
  const {
    messages,
    connectionStatus,
    processingStatus,
    sessionId, // Get sessionId
    availableSessions, // Get available sessions
    sendMessage,
    resetChat,
    startNewSession, // Get startNewSession
    switchSession, // Get switch session function
  } = useChatSocket(); // Use our custom hook

  const [inputValue, setInputValue] = useState('');
  const chatHistoryRef = useRef<HTMLDivElement>(null); // Ref for scrolling

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatHistoryRef.current) {
      // Use setTimeout to ensure scroll happens after DOM update
      setTimeout(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
      }, 50); // Small delay can help in some browsers/frameworks
    }
  }, [messages]); // Dependency array includes messages

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault(); // Prevent default form submission
    if (inputValue.trim() && processingStatus !== 'processing') {
      sendMessage(inputValue);
      setInputValue(''); // Clear input field
    }
  };

  const handleReset = () => {
    // Maybe add a confirmation dialog here in a real app
    resetChat();
  };

  const handleNewSession = () => {
    // Consider adding a confirmation dialog here
    startNewSession();
  };

  // Handler for the session dropdown change
  const handleSessionChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const newSessionId = event.target.value;
    switchSession(newSessionId);
  };

  // Determine status text and style based on connection and processing state
  const getStatusIndicator = () => {
    if (connectionStatus === 'error' || processingStatus === 'error') {
      return <span className="text-red-500">Error</span>;
    }
    if (connectionStatus === 'connecting') {
      return <span className="text-yellow-500">Connecting...</span>;
    }
    if (connectionStatus === 'disconnected') {
      return <span className="text-gray-500">Disconnected</span>;
    }
    if (processingStatus === 'processing') {
      return <span className="text-blue-400">Processing...</span>;
    }
    if (connectionStatus === 'connected') {
      return <span className="text-green-500">Connected</span>;
    }
    return <span className="text-gray-400">Idle</span>; // Default/initial state
  };

  return (
    // This structure mirrors the one in page.tsx, but now it's dynamic
    <div className="flex flex-col flex-grow overflow-hidden border border-gray-600 rounded">
      {/* Chat History Area */}
      <div
        ref={chatHistoryRef} // Assign ref here
        id="chat-history"
        className="flex-grow p-4 overflow-y-auto space-y-4 bg-gray-700 flex flex-col" // Added flex flex-col
      >
        {messages.map((msg, index) => (
          <ChatMessage key={index} message={msg} />
        ))}
        {/* Add a small spacer at the bottom to ensure last message isn't cut off */}
        <div className="h-2"></div>
      </div>

      {/* Chat Input Area */}
      <div className="chat-input p-4 border-t border-gray-600 bg-gray-800">
        {/* Form for sending messages */}
        <form id="chat-form" className="flex items-center mb-2" onSubmit={handleSendMessage}>
          <input
            type="text"
            id="prompt"
            name="prompt"
            placeholder="Enter your message..."
            autoComplete="off"
            required
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={connectionStatus !== 'connected' || processingStatus === 'processing'} // Disable input when not ready
            className="flex-grow p-2 border border-gray-500 rounded-l bg-gray-600 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={connectionStatus !== 'connected' || processingStatus === 'processing'} // Disable button when not ready
            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-r focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            Send
          </button>
        </form>
        {/* Controls Area */}
        <div className="controls flex justify-between items-center text-sm">
          <div className="space-x-2">
            {/* Add New Chat Button */}
            <button
              onClick={handleNewSession}
              className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-white disabled:opacity-50"
              disabled={connectionStatus !== 'connected'}
            >
              New Chat
            </button>
            <button
              onClick={handleReset}
              className="reset-button text-red-500 hover:text-red-400 disabled:opacity-50 disabled:hover:text-red-500"
              disabled={connectionStatus !== 'connected'} // Disable reset if not connected
            >
              Reset Chat
            </button>
            {/* Session Dropdown */}
            <select
              value={sessionId || ''} // Ensure value is controlled
              onChange={handleSessionChange}
              disabled={connectionStatus !== 'connected'}
              className="px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="" disabled={!!sessionId}>-- Select Session --</option>
              {availableSessions.map((session) => (
                <option key={session} value={session}>
                  {session.substring(0, 8)}...
                </option>
              ))}
            </select>
          </div>
          {/* Display Status */}
          <div className="flex items-center space-x-2">
            <span>Status: {getStatusIndicator()}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
