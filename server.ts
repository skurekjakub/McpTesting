import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import dotenv from 'dotenv';

// Import initializers
import { initializeGeminiClient, startAllMcpServers, stopAllMcpServers } from './src/server/initializers';
// Import chat processor and history cache
import { processPrompt } from './src/server/chat-processor';
import {
    getCachedData,
    saveCachedData,
    serializeHistory,
    deserializeHistory,
    resetCacheForSid,
    deleteCacheForSid,
    DisplayHistoryItem
} from './src/server/history-cache';
import { Content } from '@google/generative-ai';

dotenv.config(); // Load environment variables from .env file

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Prepare Next.js app
const nextApp = next({ dev, hostname, port });
const nextHandler = nextApp.getRequestHandler();

// --- Backend Initialization --- 
console.log("--- Initializing Backend Components ---");
const geminiClient = initializeGeminiClient();
// Start MCP servers (this function handles logging internally)
startAllMcpServers();
console.log("--- Backend Initialization Complete ---");
// ---------------------------------------------

nextApp.prepare().then(() => {
  const app = express();
  const httpServer = createServer(app);

  // Configure Socket.IO
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: dev ? "http://localhost:3000" : false, // Allow dev origin
      methods: ["GET", "POST"]
    }
  });

  // --- Socket.IO Event Handlers ---
  io.on('connection', (socket) => {
    const clientSid = socket.id;
    console.log(`Socket connected: ${clientSid}`);

    // --- Send Message Handler ---
    socket.on('send_message', async (data) => {
        const userPrompt = data?.prompt?.trim();
        if (!userPrompt) {
            socket.emit('error', { message: 'Empty prompt received.' });
            return;
        }

        console.log(`[${clientSid}] Received prompt: '${userPrompt}'`);

        // Define callback for internal steps
        const internalStepCallback = (message: string) => {
            socket.emit('new_message', { type: 'internal', text: message });
        };

        try {
            // 1. Load history from cache
            const cachedData = getCachedData(clientSid);
            const initialInternalHistory = deserializeHistory(cachedData.gemini_history_internal);

            if (initialInternalHistory === null) {
                console.error(`[${clientSid}] Failed to deserialize history, resetting.`);
                resetCacheForSid(clientSid, "Chat history corrupted, resetting.");
                socket.emit('new_message', { type: 'error', text: 'Chat history corrupted, resetting.' });
                // Optionally disconnect the user or prevent further processing
                return;
            }

            console.log(`[${clientSid}] History length before processing: ${initialInternalHistory.length}`);
            socket.emit('status_update', { message: 'Processing...' });

            // 2. Process the prompt
            const [finalResponseText, updatedInternalHistory] = await processPrompt(
                userPrompt,
                initialInternalHistory,
                internalStepCallback
            );

            // 3. Determine response type and emit to client
            const responseType: DisplayHistoryItem['type'] = finalResponseText.toLowerCase().startsWith('error:') ? 'error' : 'model';
            socket.emit('new_message', { type: responseType, text: finalResponseText });

            // 4. Prepare data for saving
            const currentDisplayHistory = cachedData.chat_history_display; // Get latest display history
            currentDisplayHistory.push({ type: 'user', text: userPrompt });
            currentDisplayHistory.push({ type: responseType, text: finalResponseText });

            const [serializedInternalHistory, serializationError] = serializeHistory(updatedInternalHistory);

            if (serializationError) {
                socket.emit('new_message', { type: 'error', text: 'Error saving full chat history state.' });
                currentDisplayHistory.push({ type: 'error', text: 'Error saving full chat history state.' });
            }

            // 5. Save updated history to cache
            saveCachedData(clientSid, serializedInternalHistory, currentDisplayHistory);
            console.log(`[${clientSid}] Saved history. Internal: ${updatedInternalHistory.length}, Display: ${currentDisplayHistory.length}`);

        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[${clientSid}] Critical error processing message:`, error);
            socket.emit('new_message', { type: 'error', text: `Critical server error: ${errorMsg}` });
            // Attempt to save error state
            try {
                const errorData = getCachedData(clientSid);
                const errorDisplay = errorData.chat_history_display;
                errorDisplay.push({ type: 'user', text: userPrompt });
                errorDisplay.push({ type: 'error', text: `Critical server error: ${errorMsg}` });
                saveCachedData(clientSid, errorData.gemini_history_internal, errorDisplay);
            } catch (cacheError) {
                console.error(`[${clientSid}] Failed to save error state to cache:`, cacheError);
            }
        } finally {
            socket.emit('status_update', { message: 'Idle' });
        }
    });

    // --- Disconnect Handler ---
    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${clientSid}, reason: ${reason}`);
      // Clean up history for this client when they disconnect
      deleteCacheForSid(clientSid);
    });

    // --- Error Handler ---
    socket.on('error', (error) => {
        console.error(`Socket error from ${clientSid}:`, error);
    });

    // --- Reset Chat Handler (Optional) ---
    socket.on('reset_chat', () => {
        console.log(`[${clientSid}] Received reset_chat request.`);
        resetCacheForSid(clientSid, "Chat history reset.");
        // Optionally emit confirmation or history_reset event back
        socket.emit('history_reset'); // Let frontend know
    });

  });
  // --------------------------------

  // --- Express Routes ---
  // Handle all other requests with Next.js
  app.all('*', (req: Request, res: Response) => {
    return nextHandler(req, res);
  });
  // --------------------

  httpServer.listen(port, hostname, () => {
    console.log(`\n🚀 Custom Server ready on http://${hostname}:${port}`);
    console.log(`   Socket.IO server initialized.`);
    // TODO: Add logs for Gemini client and MCP server status
  }).on('error', (err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });

}).catch((ex) => {
  console.error("Error preparing Next.js app:", ex.stack);
  process.exit(1);
});

// --- Graceful Shutdown --- 
function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  stopAllMcpServers(); // Stop MCP servers
  // Add any other cleanup tasks here
  console.log("Shutdown complete. Exiting.");
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Catches Ctrl+C
