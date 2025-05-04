import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/atom-one-dark.css'; // Import the desired highlight.js theme
import { ChatMessage as ChatMessageType } from '@/hooks/useChatSocket'; // Import the type

interface ChatMessageProps {
  message: ChatMessageType;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  // Determine styling based on message type
  const messageTypeClasses = () => {
    switch (message.type) {
      case 'user':
        return 'bg-blue-600 self-end rounded-l-lg rounded-tr-lg';
      case 'model':
        return 'bg-gray-600 self-start rounded-r-lg rounded-tl-lg';
      case 'error':
        return 'bg-red-700 text-red-100 self-start rounded-lg';
      case 'system':
        return 'bg-gray-500 text-gray-300 self-center text-xs italic rounded-lg';
      default:
        return 'bg-gray-500 self-start rounded-lg';
    }
  };

  const senderLabel = () => {
    switch (message.type) {
        case 'user': return 'User';
        case 'model': return 'Model';
        case 'error': return 'Error';
        case 'system': return null; // No sender label for system messages
        default: return 'System';
    }
  }

  const sender = senderLabel();

  return (
    <div className={`message p-3 max-w-[80%] break-words ${messageTypeClasses()}`}>
      {sender && <span className="font-semibold block mb-1 text-sm">{sender}:</span>}
      <div className="text whitespace-pre-wrap">
        {message.type === 'model' ? (
          <ReactMarkdown
            rehypePlugins={[rehypeHighlight]}
            components={{
              // Customize rendering for elements if needed, e.g., code blocks
              // Prefix unused 'node' with '_' and remove unused 'match'
              code({ node: _node, inline, className, children, ...props }) {
                return !inline ? (
                  <code className={`${className || ''} block whitespace-pre overflow-x-auto p-2 rounded bg-gray-800 my-2`} {...props}>
                    {children}
                  </code>
                ) : (
                  <code className={`${className || ''} bg-gray-800 px-1 rounded`} {...props}>
                    {children}
                  </code>
                );
              },
              // Ensure paragraphs don't add extra margins within the markdown content
              // Prefix unused 'node' with '_'
              p({node: _node, ...props}) {
                return <p className="mb-0" {...props} />;
              }
            }}
          >
            {message.text}
          </ReactMarkdown>
        ) : (
          // Render non-model text directly (preserving whitespace)
          message.text
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
