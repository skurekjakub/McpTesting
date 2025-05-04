import ChatInterface from '@/components/ChatInterface';

export default function Home() {
  return (
    // Remove layout styles from here, they are now in layout.tsx
    <div className="flex flex-col flex-grow"> {/* Keep flex-col and add flex-grow */} 
      {/* Chat Title */}
      <h1 className="text-2xl font-bold mb-4 text-center">MCPBro Chat (Next.js)</h1>

      {/* Render the Chat Interface Component */}
      <ChatInterface />
    </div>
  );
}
