// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/server/initializers.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { config, isConfigValid, resolvedProjectRoot } from './config'; // Import config
import { McpStdioClient } from './mcp-client'; // Import the MCP client

// --- State ---
let geminiClientInstance: GoogleGenerativeAI | null = null;
// Store client instances instead of raw processes
const mcpClients: { [key: string]: McpStdioClient | null } = {
    filesystem: null,
    memory: null,
    chroma: null,
};

// --- Gemini Client Initialization ---
export function initializeGeminiClient(): GoogleGenerativeAI | null {
    if (!isConfigValid || !config?.GEMINI_API_KEY) {
        console.error('Skipping Gemini client initialization due to invalid config or missing API key.');
        return null;
    }

    try {
        console.log('Initializing Gemini client...');
        geminiClientInstance = new GoogleGenerativeAI(config.GEMINI_API_KEY);
        // TODO: Add a validation step if the SDK provides one (e.g., list models)
        console.log('Gemini client initialized successfully.');
        return geminiClientInstance;
    } catch (error: unknown) { // Use unknown instead of any
        const message = error instanceof Error ? error.message : String(error);
        console.error(`ERROR: Error initializing Gemini client: ${message}`);
        return null;
    }
}

export function getGeminiClient(): GoogleGenerativeAI | null {
    return geminiClientInstance;
}

// --- MCP Server Initialization & Management ---

function spawnMcpServer(
    serverId: string,
    command: string,
    args: string[],
    // Allow partial env overrides, default to undefined
    envOverrides: NodeJS.ProcessEnv | undefined = undefined
): ChildProcess | null {
    try {
        console.log(`Spawning MCP server: ${serverId} with command: ${command} ${args.join(' ')}`);
        // Merge process.env with overrides
        const finalEnv = { ...process.env, ...envOverrides };

        const serverProcess = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
            env: finalEnv, // Pass the merged environment
            shell: process.platform === 'win32' // Use shell on Windows for commands like npx
        });

        serverProcess.stdout?.on('data', (data) => {
            console.log(`[${serverId} stdout]: ${data.toString().trim()}`);
        });

        serverProcess.stderr?.on('data', (data) => {
            console.error(`[${serverId} stderr]: ${data.toString().trim()}`);
        });

        serverProcess.on('error', (err) => {
            console.error(`Error spawning/running ${serverId} MCP server:`, err);
            mcpClients[serverId] = null; // Mark as dead
        });

        serverProcess.on('close', (code) => {
            console.log(`${serverId} MCP server process exited with code ${code}`);
            mcpClients[serverId] = null; // Mark as dead
        });

        console.log(`MCP server ${serverId} spawned successfully (PID: ${serverProcess.pid}).`);
        return serverProcess;

    } catch (error: unknown) { // Use unknown instead of any
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to spawn ${serverId} MCP server: ${message}`);
        return null;
    }
}

export function startAllMcpServers(): void {
    if (!isConfigValid) {
        console.error('Skipping MCP server initialization due to invalid config.');
        return;
    }

    console.log('Starting all configured MCP servers...');

    // --- Filesystem Server ---
    if (config.FILESYSTEM_TARGET_DIRECTORIES && config.FILESYSTEM_TARGET_DIRECTORIES.length > 0) {
        const fsArgs = [
            '-y', // Assume npx needs -y
            '@modelcontextprotocol/server-filesystem',
            ...config.FILESYSTEM_TARGET_DIRECTORIES.map(p => path.resolve(resolvedProjectRoot, p)) // Resolve paths
        ];
        const process = spawnMcpServer('filesystem', 'npx', fsArgs);
        if (process) {
            mcpClients.filesystem = new McpStdioClient('filesystem', process);
            // Initialize asynchronously (fire and forget for now, or gather promises later)
            mcpClients.filesystem.initialize().catch(err => {
                console.error("[filesystem] MCP Client initialization failed:", err);
                // Optionally handle cleanup if init fails
            });
        }
    } else {
        console.log("Skipping 'filesystem' MCPServer start: No target directories configured.");
    }

    // --- Memory Server ---
    if (config.ENABLE_MEMORY_SERVER) {
        const memArgs = [
            '-y',
            '@modelcontextprotocol/server-memory',
        ];
        const memEnv = {
            MEMORY_FILE_PATH: path.resolve(resolvedProjectRoot, 'memory.json') // Assuming memory.json at root
        };
        const process = spawnMcpServer('memory', 'npx', memArgs, memEnv);
        if (process) {
            mcpClients.memory = new McpStdioClient('memory', process);
            mcpClients.memory.initialize().catch(err => {
                 console.error("[memory] MCP Client initialization failed:", err);
            });
        }
    } else {
        console.log("Skipping 'memory' MCPServer start: 'enable_memory_server' is false.");
    }

    // --- ChromaDB Server ---
    if (config.ENABLE_CHROMA_SERVER) {
        const absChromaPath = path.resolve(resolvedProjectRoot, config.CHROMA_PATH);
        const chromaArgs = [
            'chroma-mcp',
            '--client-type',
            'persistent',
            '--data-dir',
            absChromaPath,
        ];
        const process = spawnMcpServer('chroma', 'uvx', chromaArgs);
        if (process) {
            mcpClients.chroma = new McpStdioClient('chroma', process);
            mcpClients.chroma.initialize().catch(err => {
                 console.error("[chroma] MCP Client initialization failed:", err);
            });
        }
    } else {
        console.log("Skipping 'chroma' MCPServer start: 'enable_chroma_server' is false.");
    }

    console.log('MCP server startup process initiated.');
}

export function stopAllMcpServers(): void {
    console.log('Initiating shutdown for all MCP servers...');
    for (const serverId in mcpClients) {
        const client = mcpClients[serverId];
        if (client) {
            console.log(`Closing client and stopping ${serverId} MCP server...`);
            client.close(); // Close the client communication layer
            const process = client['process']; // Access the process via the client if needed, or retrieve from a separate map
            if (process && !process.killed) {
                 console.log(`Stopping ${serverId} process (PID: ${process.pid})...`);
                 const killed = process.kill('SIGTERM');
                 if (!killed) {
                    console.warn(`Failed to send SIGTERM to ${serverId} (PID: ${process.pid}). Attempting SIGKILL.`);
                    process.kill('SIGKILL');
                 }
            }
            mcpClients[serverId] = null;
        } else {
             console.log(`MCP client ${serverId} already stopped or not started.`);
        }
    }
    console.log('MCP server shutdown process complete.');
}

// Update getter function
export function getMcpClient(serverId: string): McpStdioClient | null {
    return mcpClients[serverId] || null;
}

// TODO: Add logic to interact with the stdin/stdout of these processes
//       This will likely involve creating a client class or functions similar
//       to the Python MCPServer class, but using Node.js streams and the
//       @modelcontextprotocol/sdk client if available/suitable, or implementing
//       the JSON-RPC communication manually.
