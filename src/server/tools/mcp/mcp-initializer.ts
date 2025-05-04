// src/server/tools/mcp/mcp-initializer.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import { serverConfig } from '../../config/server'; // Import from server config module
import { resolvedProjectRoot } from '../../config/base'; // Import from base config module
import { validateConfig } from '../../config'; // Import the validation function only
import logger from '../../logger'; // Adjust path
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// --- State ---
// Store SDK Client instances specific to MCP
const mcpClients: { [key: string]: Client | null } = {
    filesystem: null,
    memory: null,
    chroma: null,
};

// --- MCP Server Initialization & Management ---

export async function initializeMcpClients(): Promise<void> { // Renamed function
    const isConfigValid = validateConfig(); // Use the validation function
    if (!isConfigValid) {
        logger.error('[MCP Initializer] Skipping MCP client initialization due to invalid config.');
        return;
    }

    logger.info('[MCP Initializer] Initializing all configured MCP SDK clients...');
    const connectPromises: Promise<any>[] = [];

    // --- Filesystem Server ---
    if (serverConfig.FILESYSTEM_TARGET_DIRECTORIES && serverConfig.FILESYSTEM_TARGET_DIRECTORIES.length > 0) {
        const fsArgs = [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            ...serverConfig.FILESYSTEM_TARGET_DIRECTORIES.map(p => path.resolve(resolvedProjectRoot, p))
        ];
        const fsTransport = new StdioClientTransport({
            command: 'npx',
            args: fsArgs
        });
        const fsClient = new Client({ name: 'mcpbro-client-fs', version: '0.1.0' });
        mcpClients.filesystem = fsClient;
        logger.info('[MCP Initializer - filesystem] Connecting MCP SDK client...');
        connectPromises.push(
            fsClient.connect(fsTransport)
                .then(() => logger.info('[MCP Initializer - filesystem] MCP SDK Client connected successfully.'))
                .catch(err => {
                    logger.error("[MCP Initializer - filesystem] MCP SDK Client connection failed:", err);
                    mcpClients.filesystem = null;
                })
        );
    } else {
        logger.info("[MCP Initializer] Skipping 'filesystem' MCPServer start: No target directories configured.");
    }

    // --- Memory Server ---
    if (serverConfig.ENABLE_MEMORY_SERVER) {
        const memArgs = [
            '-y',
            '@modelcontextprotocol/server-memory',
        ];
        const memTransport = new StdioClientTransport({
            command: 'npx',
            args: memArgs
        });
        const memClient = new Client({ name: 'mcpbro-client-mem', version: '0.1.0' });
        mcpClients.memory = memClient;
        logger.info('[MCP Initializer - memory] Connecting MCP SDK client...');
        connectPromises.push(
            memClient.connect(memTransport)
                .then(() => logger.info('[MCP Initializer - memory] MCP SDK Client connected successfully.'))
                .catch(err => {
                    logger.error("[MCP Initializer - memory] MCP SDK Client connection failed:", err);
                    mcpClients.memory = null;
                })
        );
    } else {
        logger.info("[MCP Initializer] Skipping 'memory' MCPServer start: 'enable_memory_server' is false.");
    }

    // --- ChromaDB Server ---
    if (serverConfig.ENABLE_CHROMA_SERVER) {
        const absChromaPath = path.resolve(resolvedProjectRoot, serverConfig.CHROMA_PATH);
        const chromaArgs = [
            'chroma-mcp',
            '--client-type',
            'persistent',
            '--data-dir',
            absChromaPath,
        ];
        const chromaTransport = new StdioClientTransport({
            command: 'uvx',
            args: chromaArgs
        });
        const chromaClient = new Client({ name: 'mcpbro-client-chroma', version: '0.1.0' });
        mcpClients.chroma = chromaClient;
        logger.info('[MCP Initializer - chroma] Connecting MCP SDK client...');
        connectPromises.push(
            chromaClient.connect(chromaTransport)
                .then(() => logger.info('[MCP Initializer - chroma] MCP SDK Client connected successfully.'))
                .catch(err => {
                    logger.error("[MCP Initializer - chroma] MCP SDK Client connection failed:", err);
                    mcpClients.chroma = null;
                })
        );
    } else {
        logger.info("[MCP Initializer] Skipping 'chroma' MCPServer start: 'enable_chroma_server' is false.");
    }

    logger.info('[MCP Initializer] Waiting for MCP SDK client connections...');
    await Promise.allSettled(connectPromises);
    logger.info('[MCP Initializer] MCP SDK client connection process complete.');
}

export async function shutdownMcpClients(): Promise<void> { // Renamed function
    logger.info('[MCP Initializer] Initiating graceful shutdown for all active MCP SDK clients...');
    const closePromises: Promise<any>[] = [];

    for (const serverId in mcpClients) {
        const client = mcpClients[serverId];
        if (client) {
            logger.info(`[MCP Initializer] Closing connection for ${serverId} MCP SDK client...`);
            closePromises.push(
                client.close()
                    .then(() => logger.info(`[MCP Initializer - ${serverId}] SDK client connection closed.`))
                    .catch(err => {
                        logger.error(`[MCP Initializer - ${serverId}] Error closing SDK client connection:`, err);
                    })
                    .finally(() => {
                        mcpClients[serverId] = null;
                    })
            );
        }
    }

    if (closePromises.length > 0) {
        logger.info(`[MCP Initializer] Waiting for ${closePromises.length} MCP SDK client(s) to close...`);
        await Promise.allSettled(closePromises);
    } else {
        logger.info('[MCP Initializer] No active MCP SDK clients needed closing.');
    }

    logger.info('[MCP Initializer] MCP SDK client shutdown process complete.');
}

// Renamed function
export function getMcpSdkClient(serverId: string): Client | null {
    return mcpClients[serverId] || null;
}

// Removed Gemini client initialization - belongs elsewhere or is handled by gemini-service
// export function initializeGeminiClient(): GoogleGenerativeAI | null { ... }
// export function getGeminiClient(): GoogleGenerativeAI | null { ... }
