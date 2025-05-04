import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import next from 'next';

import logger from './src/server/logger'; // Import the shared logger
import { initializeGeminiClient } from './src/server/gemini-service'; // Assuming gemini-service exports this or similar
import { initializeMcpClients, shutdownMcpClients } from './src/server/tools/mcp/mcp-initializer';
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

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Prepare Next.js app
const nextApp = next({ dev, hostname, port });
const nextHandler = nextApp.getRequestHandler();

// --- Backend Initialization --- 
logger.info("--- Initializing Backend Components ---");
const geminiClient = initializeGeminiClient(); // Uses logger internally
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
    const clientSid = socket.id;
    logger.info({ sid: clientSid }, `Socket connected: ${clientSid}`);

    // --- Send Message Handler ---
    socket.on('send_message', async (data) => {
        const userPrompt = data?.prompt?.trim();
        if (!userPrompt) {
            logger.warn({ sid: clientSid }, 'Empty prompt received.');
            socket.emit('error', { message: 'Empty prompt received.' });
            return;
        }

        logger.info({ sid: clientSid, prompt: userPrompt }, `Received prompt`);

        // Define callback for internal steps
        const internalStepCallback = (message: string) => {
            logger.debug({ sid: clientSid }, `Internal step: ${message}`);
            socket.emit('new_message', { type: 'internal', text: message });
        };

        try {
            // 1. Load history from cache
            const cachedData = getCachedData(clientSid);
            const initialInternalHistory = deserializeHistory(cachedData.gemini_history_internal);

            if (initialInternalHistory === null) {
                logger.error({ sid: clientSid }, 'Failed to deserialize history, resetting.');
                resetCacheForSid(clientSid, "Chat history corrupted, resetting.");
                socket.emit('new_message', { type: 'error', text: 'Chat history corrupted, resetting.' });
                return;
            }

            logger.info({ sid: clientSid, historyLength: initialInternalHistory.length }, `History length before processing`);
            socket.emit('status_update', { message: 'Processing...' });

            // 2. Process the prompt (uses logger internally)
            const [finalResponseText, updatedInternalHistory] = await processPrompt(
                userPrompt,
                initialInternalHistory,
                internalStepCallback
            );

            // 3. Emit response
            const responseType: DisplayHistoryItem['type'] = finalResponseText.toLowerCase().startsWith('error:') ? 'error' : 'model';
            logger.info({ sid: clientSid, responseType, responseLength: finalResponseText.length }, `Emitting final response`);
            socket.emit('new_message', { type: responseType, text: finalResponseText });

            // 4. Prepare data for saving
            const currentDisplayHistory = cachedData.chat_history_display;
            currentDisplayHistory.push({ type: 'user', text: userPrompt });
            currentDisplayHistory.push({ type: responseType, text: finalResponseText });

            const [serializedInternalHistory, serializationError] = serializeHistory(updatedInternalHistory);

            if (serializationError) {
                logger.error({ sid: clientSid }, 'Error serializing internal history for saving.');
                socket.emit('new_message', { type: 'error', text: 'Error saving full chat history state.' });
                currentDisplayHistory.push({ type: 'error', text: 'Error saving full chat history state.' });
            }

            // 5. Save history
            saveCachedData(clientSid, serializedInternalHistory, currentDisplayHistory);
            logger.info({ sid: clientSid, internalLen: updatedInternalHistory.length, displayLen: currentDisplayHistory.length }, `Saved history`);

        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error({ sid: clientSid, error: errorMsg, stack: (error instanceof Error ? error.stack : undefined) }, `Critical error processing message`);
            socket.emit('new_message', { type: 'error', text: `Critical server error: ${errorMsg}` });
            // Attempt to save error state
            try {
                const errorData = getCachedData(clientSid);
                const errorDisplay = errorData.chat_history_display;
                errorDisplay.push({ type: 'user', text: userPrompt }); // Add user prompt that caused error
                errorDisplay.push({ type: 'error', text: `Critical server error: ${errorMsg}` });
                saveCachedData(clientSid, errorData.gemini_history_internal, errorDisplay);
                 logger.info({ sid: clientSid }, `Saved error state to cache`);
            } catch (cacheError: any) {
                logger.error({ sid: clientSid, error: cacheError?.message }, `Failed to save error state to cache`);
            }
        } finally {
            socket.emit('status_update', { message: 'Idle' });
        }
    });

    // --- Disconnect Handler ---
    socket.on('disconnect', (reason) => {
      logger.info({ sid: clientSid, reason }, `Socket disconnected`);
      deleteCacheForSid(clientSid);
    });

    // --- Error Handler ---
    socket.on('error', (error) => {
        logger.error({ sid: clientSid, error: error?.message }, `Socket error reported`);
    });

    // --- Reset Chat Handler ---
    socket.on('reset_chat', () => {
        logger.info({ sid: clientSid }, `Received reset_chat request.`);
        resetCacheForSid(clientSid, "Chat history reset.");
        socket.emit('history_reset');
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
