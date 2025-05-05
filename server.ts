import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';
import fs from 'fs'; // Import fs
import path from 'path'; // Import path

import logger from './src/server/logger'; // Import the shared logger
// Update import path for Gemini client initialization
import { initializeGeminiClient } from './src/server/llm/gemini/client';
import { initializeMcpClients, shutdownMcpClients } from './src/server/tools/mcp/mcp-initializer';
import { processPrompt } from './src/server/chat-processor';
// Update import path for history cache functions
import {
    loadSessionData,      // Renamed from getCachedData
    saveSessionData,      // Renamed from saveCachedData
    serializeHistory,
    deserializeHistory,
    resetSessionData,     // Renamed from resetCacheForSid
    DisplayHistoryItem
} from './src/server/agent/history/history-cache'; // Updated path
import { resolvedProjectRoot } from './src/server/config'; // Import project root

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const SESSIONS_DIR = path.join(resolvedProjectRoot, 'chat_sessions'); // Define sessions dir path

// Prepare Next.js app
const nextApp = next({ dev, hostname, port });
const nextHandler = nextApp.getRequestHandler();

// --- Backend Initialization --- 
logger.info("--- Initializing Backend Components ---");
const geminiClient = initializeGeminiClient(); // Call initializer from new location
// Call the renamed MCP client initialization function
initializeMcpClients()
    .then(() => {
        logger.info("MCP Client initialization sequence initiated.");
    })
    .catch(err => {
        logger.error("Error initiating MCP client initialization sequence:", err);
    });
logger.info("--- Backend Initialization Complete (MCP clients initializing asynchronously) ---");
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
    const clientSid = socket.id; // Keep socket id for logging/transient info
    logger.info({ sid: clientSid }, `Socket connected: ${clientSid}`);

    // --- Send Message Handler ---
    // Expect data to include { prompt: string, sessionId: string }
    socket.on('send_message', async (data) => {
        const userPrompt = data?.prompt?.trim();
        const sessionId = data?.sessionId; // Get sessionId from client

        if (!userPrompt) {
            logger.warn({ sid: clientSid, sessionId }, 'Empty prompt received.');
            socket.emit('error', { message: 'Empty prompt received.' });
            return;
        }
        if (!sessionId) {
            logger.warn({ sid: clientSid }, 'Missing sessionId in send_message event.');
            socket.emit('error', { message: 'Session ID is missing. Cannot process message.' });
            return;
        }

        logger.info({ sid: clientSid, sessionId, prompt: userPrompt }, `Received prompt for session`);

        const internalStepCallback = (message: string) => {
            logger.debug({ sid: clientSid, sessionId }, `Internal step: ${message}`);
            socket.emit('new_message', { type: 'internal', text: message });
        };

        try {
            // 1. Load session data using sessionId
            const sessionData = loadSessionData(sessionId);
            const initialInternalHistory = deserializeHistory(sessionData.gemini_history_internal);

            if (initialInternalHistory === null) {
                logger.error({ sid: clientSid, sessionId }, 'Failed to deserialize history, resetting session.');
                resetSessionData(sessionId, "Chat history corrupted, resetting.");
                socket.emit('new_message', { type: 'error', text: 'Chat history corrupted, resetting.' });
                // Optionally emit full history state to client after reset
                socket.emit('load_history', { displayHistory: loadSessionData(sessionId).chat_history_display });
                return;
            }

            logger.info({ sid: clientSid, sessionId, historyLength: initialInternalHistory.length }, `History length before processing`);
            socket.emit('status_update', { message: 'Processing...' });

            // 2. Process the prompt
            const [finalResponseText, updatedInternalHistory] = await processPrompt(
                userPrompt,
                initialInternalHistory,
                internalStepCallback
            );

            // 3. Emit response
            const responseType: DisplayHistoryItem['type'] = finalResponseText.toLowerCase().startsWith('error:') ? 'error' : 'model';
            logger.info({ sid: clientSid, sessionId, responseType, responseLength: finalResponseText.length }, `Emitting final response`);
            socket.emit('new_message', { type: responseType, text: finalResponseText });

            // 4. Prepare data for saving
            const currentDisplayHistory = sessionData.chat_history_display;
            currentDisplayHistory.push({ type: 'user', text: userPrompt });
            currentDisplayHistory.push({ type: responseType, text: finalResponseText });

            const [serializedInternalHistory, serializationError] = serializeHistory(updatedInternalHistory);

            if (serializationError) {
                logger.error({ sid: clientSid, sessionId }, 'Error serializing internal history for saving.');
                socket.emit('new_message', { type: 'error', text: 'Error saving full chat history state.' });
                currentDisplayHistory.push({ type: 'error', text: 'Error saving full chat history state.' });
            }

            // 5. Save updated session data using sessionId
            saveSessionData(sessionId, serializedInternalHistory, currentDisplayHistory);
            logger.info({ sid: clientSid, sessionId, internalLen: updatedInternalHistory.length, displayLen: currentDisplayHistory.length }, `Saved session history`);

        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error({ sid: clientSid, sessionId, error: errorMsg, stack: (error instanceof Error ? error.stack : undefined) }, `Critical error processing message`);
            socket.emit('new_message', { type: 'error', text: `Critical server error: ${errorMsg}` });
            // Attempt to save error state to the session file
            try {
                const errorData = loadSessionData(sessionId); // Reload data in case it changed
                const errorDisplay = errorData.chat_history_display;
                errorDisplay.push({ type: 'user', text: userPrompt });
                errorDisplay.push({ type: 'error', text: `Critical server error: ${errorMsg}` });
                saveSessionData(sessionId, errorData.gemini_history_internal, errorDisplay);
                 logger.info({ sid: clientSid, sessionId }, `Saved error state to session file`);
            } catch (cacheError: any) {
                logger.error({ sid: clientSid, sessionId, error: cacheError?.message }, `Failed to save error state to session file`);
            }
        } finally {
            socket.emit('status_update', { message: 'Idle' });
        }
    });

    // --- Disconnect Handler ---
    socket.on('disconnect', (reason) => {
      logger.info({ sid: clientSid, reason }, `Socket disconnected`);
      // No automatic history deletion on disconnect anymore
      // deleteSessionData(sessionId); // Only if explicitly needed
    });

    // --- Error Handler ---
    socket.on('error', (error) => {
        logger.error({ sid: clientSid, error: error?.message }, `Socket error reported`);
    });

    // --- Reset Chat Handler ---
    // Expect data to include { sessionId: string }
    socket.on('reset_chat', (data) => {
        const sessionId = data?.sessionId;
        if (!sessionId) {
            logger.warn({ sid: clientSid }, 'Missing sessionId in reset_chat event.');
            socket.emit('error', { message: 'Session ID is missing. Cannot reset chat.' });
            return;
        }
        logger.info({ sid: clientSid, sessionId }, `Received reset_chat request for session.`);
        resetSessionData(sessionId, "Chat history reset.");
        // Emit confirmation and potentially the new empty history state
        socket.emit('history_reset');
        socket.emit('load_history', { displayHistory: loadSessionData(sessionId).chat_history_display });
    });

    // --- Load History Handler (New) ---
    // Expect data to include { sessionId: string }
    socket.on('load_chat', (data) => {
        const sessionId = data?.sessionId;
        if (!sessionId) {
            logger.warn({ sid: clientSid }, 'Missing sessionId in load_chat event.');
            socket.emit('error', { message: 'Session ID is missing. Cannot load chat.' });
            return;
        }
        logger.info({ sid: clientSid, sessionId }, `Received load_chat request for session.`);
        const sessionData = loadSessionData(sessionId);
        // Send only the display history to the client
        socket.emit('load_history', { displayHistory: sessionData.chat_history_display });
    });

    // --- List Sessions Handler (New) ---
    socket.on('list_sessions', () => {
        logger.info({ sid: socket.id }, `Received list_sessions request.`);
        try {
            if (!fs.existsSync(SESSIONS_DIR)) {
                logger.warn(`[list_sessions] Session directory not found: ${SESSIONS_DIR}`);
                socket.emit('session_list', { sessions: [] });
                return;
            }
            const files = fs.readdirSync(SESSIONS_DIR);
            const sessionIds = files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));
            logger.info({ sid: socket.id, count: sessionIds.length }, `Sending session list.`);
            socket.emit('session_list', { sessions: sessionIds });
        } catch (error: any) {
            logger.error({ sid: socket.id, error: error?.message }, `Error listing sessions in ${SESSIONS_DIR}`);
            socket.emit('error', { message: 'Failed to retrieve session list.' });
        }
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
    logger.info(`🚀 Custom Server ready on http://${hostname}:${port}`);
    logger.info(`   Socket.IO server initialized.`);
    // Log status of initialized components
    if (geminiClient) {
        logger.info(`   Gemini Client Initialized: OK`);
    } else {
        logger.warn(`   Gemini Client Initialized: FAILED (Check API Key/Config)`);
    }
    // MCP status check can be added here later if needed (e.g., checking client states)

  }).on('error', (err) => {
    logger.error({ error: err }, 'Server failed to start');
    process.exit(1);
  });

}).catch((ex) => {
  logger.error({ error: ex }, "Error preparing Next.js app");
  process.exit(1);
});

// --- Graceful Shutdown --- 
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    // Call the renamed MCP client shutdown function
    await shutdownMcpClients();
  } catch (error) {
    logger.error("Error during MCP client shutdown:", error);
  }
  // Add any other cleanup tasks here (e.g., close database connections)
  logger.info("Shutdown complete. Exiting.");
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Catches Ctrl+C
