import { ChildProcess } from 'child_process';
import { Writable, Readable } from 'stream';

// Basic JSON-RPC types (can be expanded based on MCP spec)
interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string | null;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: any;
}

// Type for pending requests waiting for a response
type PendingRequest = {
    resolve: (result: any) => void;
    reject: (error: any) => void;
    method: string;
    startTime: number; // For potential timeouts
};

// --- Constants ---
const JSON_RPC_VERSION = '2.0';
const HEADER_CONTENT_LENGTH = 'Content-Length';
const HEADER_DELIMITER = '\r\n\r\n';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

export class McpStdioClient {
    private serverId: string;
    private process: ChildProcess;
    private stdin: Writable;
    private stdout: Readable;
    private stderr: Readable;
    private messageBuffer: string = '';
    private nextRequestId: number = 1;
    private pendingRequests: Map<number | string, PendingRequest> = new Map();

    constructor(serverId: string, process: ChildProcess) {
        this.serverId = serverId;
        this.process = process;

        if (!process.stdin || !process.stdout || !process.stderr) {
            throw new Error(`[${serverId}] ChildProcess is missing required stdio streams.`);
        }
        this.stdin = process.stdin;
        this.stdout = process.stdout;
        this.stderr = process.stderr;

        this.stdout.setEncoding('utf-8');
        this.stdout.on('data', this.handleData.bind(this));
        this.stdout.on('error', (err) => console.error(`[${this.serverId} stdout] Error:`, err));
        this.stdout.on('close', () => console.log(`[${this.serverId} stdout] Stream closed.`));

        this.stderr.setEncoding('utf-8');
        this.stderr.on('data', (data) => console.error(`[${this.serverId} stderr]: ${data.trim()}`));
        this.stderr.on('error', (err) => console.error(`[${this.serverId} stderr] Error:`, err));
        this.stderr.on('close', () => console.log(`[${this.serverId} stderr] Stream closed.`));

        console.log(`[${this.serverId}] McpStdioClient initialized for PID: ${this.process.pid}`);
    }

    private handleData(chunk: string): void {
        this.messageBuffer += chunk;
        // Process buffer to find complete messages based on Content-Length
        while (true) {
            const headerMatch = this.messageBuffer.match(new RegExp(`^${HEADER_CONTENT_LENGTH}: (\\d+)${HEADER_DELIMITER}`, 'i'));
            if (!headerMatch) {
                // Need more data for header or header is malformed
                if (this.messageBuffer.length > 1024 * 10) { // Increase buffer limit slightly
                    console.error(`[${this.serverId}] Message buffer growing large (10KB) without valid header. Clearing.`);
                    this.messageBuffer = '';
                }
                break;
            }

            const contentLength = parseInt(headerMatch[1], 10);
            const headerLength = headerMatch[0].length;
            const totalMessageLength = headerLength + contentLength;

            if (this.messageBuffer.length >= totalMessageLength) {
                // We have a complete message
                const messageJson = this.messageBuffer.substring(headerLength, totalMessageLength);
                this.messageBuffer = this.messageBuffer.substring(totalMessageLength); // Remove processed message from buffer

                try {
                    const message = JSON.parse(messageJson);
                    this.processMessage(message);
                } catch (error) {
                    console.error(`[${this.serverId}] Failed to parse JSON message:`, error, 'JSON:', messageJson);
                }
            } else {
                // Need more data for the body
                break;
            }
        }
    }

    private processMessage(message: any): void {
        if (message.id !== undefined && message.id !== null) {
            // It's a response
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                const duration = Date.now() - pending.startTime;
                console.log(`[${this.serverId}] Received response for [${message.id}] ${pending.method} (${duration}ms)`);
                if (message.error) {
                    console.error(`[${this.serverId}] Error response for [${message.id}] ${pending.method}:`, message.error);
                    pending.reject(message.error);
                } else {
                    pending.resolve(message.result);
                }
            } else {
                console.warn(`[${this.serverId}] Received response for unknown request ID: ${message.id}`);
            }
        } else if (message.method) {
            // It's a notification
            console.log(`[${this.serverId}] Received notification: ${message.method}`, message.params || '');
            // TODO: Implement notification handling (e.g., emit events)
        } else {
            console.warn(`[${this.serverId}] Received invalid message:`, message);
        }
    }

    private sendRequestInternal(method: string, params?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.stdin.writable) {
                console.error(`[${this.serverId}] Attempted to write to non-writable stdin.`);
                return reject(new Error(`[${this.serverId}] stdin stream is not writable.`));
            }

            const requestId = this.nextRequestId++;
            const request: JsonRpcRequest = {
                jsonrpc: JSON_RPC_VERSION,
                id: requestId,
                method: method,
                params: params,
            };

            const requestJson = JSON.stringify(request);
            const message = `${HEADER_CONTENT_LENGTH}: ${Buffer.byteLength(requestJson, 'utf-8')}${HEADER_DELIMITER}${requestJson}`;

            console.log(`[${this.serverId}] Sending request [${requestId}] ${method}:`, params || '');

            const pendingRequestData: PendingRequest = {
                resolve,
                reject,
                method,
                startTime: Date.now(),
            };
            this.pendingRequests.set(requestId, pendingRequestData);

            // Set timeout for the request
            const timeoutHandle = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    console.error(`[${this.serverId}] Request [${requestId}] ${method} timed out after ${DEFAULT_TIMEOUT_MS}ms`);
                    this.pendingRequests.delete(requestId);
                    reject(new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms`));
                }
            }, DEFAULT_TIMEOUT_MS);

            // Wrap resolve/reject to clear timeout
            const originalResolve = pendingRequestData.resolve;
            const originalReject = pendingRequestData.reject;
            pendingRequestData.resolve = (result) => {
                clearTimeout(timeoutHandle);
                originalResolve(result);
            };
            pendingRequestData.reject = (error) => {
                clearTimeout(timeoutHandle);
                originalReject(error);
            };

            this.stdin.write(message, 'utf-8', (err) => {
                if (err) {
                    console.error(`[${this.serverId}] Error writing to stdin:`, err);
                    if (this.pendingRequests.has(requestId)) {
                         this.pendingRequests.get(requestId)?.reject(err); // Reject promise on write error
                         this.pendingRequests.delete(requestId);
                    }
                }
            });
        });
    }

    // --- Public API ---

    public async initialize(clientCapabilities: any = {}): Promise<any> {
        // TODO: Define proper clientCapabilities type based on MCP spec
        return this.sendRequestInternal('initialize', {
            processId: process.pid, // Send current process ID
            clientInfo: { name: 'mcpbro-nextjs-backend', version: '0.1.0' },
            capabilities: clientCapabilities,
            // rootUri, workspaceFolders etc. might be needed depending on server
        });
    }

    public async listTools(): Promise<any> {
        // TODO: Define specific return type based on MCP ListToolsResult
        return this.sendRequestInternal('listTools');
    }

    public async callTool(toolName: string, args: any): Promise<any> {
        // TODO: Define specific return type based on MCP CallToolResult
        return this.sendRequestInternal('callTool', { name: toolName, arguments: args });
    }

    // TODO: Add methods for listResources, readResource, listPrompts, getPrompt etc.

    public isConnected(): boolean {
        // Basic check - process exists and stdin is writable
        // More robust checks might involve ping requests or checking process.killed
        return !!this.process && !this.process.killed && this.stdin.writable;
    }

    public close(): void {
        console.log(`[${this.serverId}] Closing client connection...`);
        // Reject any pending requests
        this.pendingRequests.forEach((pending, id) => {
            pending.reject(new Error('Client connection closed'));
            this.pendingRequests.delete(id);
        });
        // Note: This doesn't stop the underlying process, that's handled by initializers.ts
        // Detach listeners to prevent memory leaks if the client is disposed before the process
        this.stdout.removeAllListeners();
        this.stderr.removeAllListeners();
        console.log(`[${this.serverId}] Listeners removed.`);
    }
}
