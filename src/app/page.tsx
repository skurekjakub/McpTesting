import ChatInterface from '@/components/ChatInterface'; // Import the new component

export default function Home() {
  return (
    // Main container using Flexbox for layout, full height, dark background
    <div className="flex flex-col h-screen bg-gray-800 text-white p-4 font-sans">
      {/* Chat Title */}
      <h1 className="text-2xl font-bold mb-4 text-center">MCPBro Chat (Next.js)</h1>

      {/* Render the Chat Interface Component */}
      <ChatInterface />
    </div>
  );
}
