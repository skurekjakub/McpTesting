import { ChildProcess } from 'child_process';
import { Writable, Readable } from 'stream';
import { EventEmitter } from 'events';
import logger from './logger';
// Import types from the new location
import {
    McpClientState,
    McpInitializeParams,
    McpInitializeResult,
    McpListToolsResult,
    McpCallToolResult,
    McpListResourcesResult,
    McpReadResourceResult,
    McpListPromptsResult,
    McpGetPromptParams,
    McpGetPromptResult,
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcNotification,
    PendingRequest,
    McpClientInfo // Added missing import used in initialize
} from './types/mcp';

// --- Constants ---
const JSON_RPC_VERSION = '2.0';
const HEADER_CONTENT_LENGTH = 'Content-Length';
const HEADER_DELIMITER = '\r\n\r\n';
const DEFAULT_TIMEOUT_MS = 12000; // Increase timeout to 120 seconds (2 minutes)
const MAX_CONTENT_LENGTH = 1024 * 1024 * 10; // 10 MB limit for message size

// Extend EventEmitter
export class McpStdioClient extends EventEmitter {
    private serverId: string;
    private process: ChildProcess;
    private stdin!: Writable; // Add definite assignment assertion
    private stdout!: Readable; // Add definite assignment assertion
    private stderr!: Readable; // Add definite assignment assertion
    private messageBuffer: string = '';
    private nextRequestId: number = 1;
    private pendingRequests: Map<number | string, PendingRequest<any>> = new Map();
    private state: McpClientState; // Correctly define the state property type

    constructor(serverId: string, process: ChildProcess) {
        super();
        this.serverId = serverId;
        this.process = process;
        this.state = 'idle'; // Initial state assignment

        if (!process.stdin || !process.stdout || !process.stderr) {
            logger.error(`[${serverId}] ChildProcess is missing required stdio streams.`);
            // Set state to error before throwing
            this.setState('error');
            throw new Error(`[${serverId}] ChildProcess is missing required stdio streams.`);
        }
        // Assignments happen here, after the check
        this.stdin = process.stdin;
        this.stdout = process.stdout;
        this.stderr = process.stderr;

        // ... rest of constructor ...
    }

    private setState(newState: McpClientState): void {
        if (this.state !== newState) {
            const oldState = this.state;
            this.state = newState;
            logger.info(`[${this.serverId}] State changed: ${oldState} -> ${newState}`);
            this.emit('stateChange', newState, oldState);
        }
    }

    public getState(): McpClientState {
        return this.state;
    }

    private handleData(chunk: string): void {
        // Log the raw chunk received for debugging
        logger.trace({ serverId: this.serverId, chunk }, `Received raw stdout chunk`);
        this.messageBuffer += chunk;
        logger.debug(`[${this.serverId}] Buffer size after chunk: ${this.messageBuffer.length}`);
        while (this.messageBuffer.length > 0) {
            const headerMatch = this.messageBuffer.match(new RegExp(`^${HEADER_CONTENT_LENGTH}: (\\d+)${HEADER_DELIMITER}`, 'i'));
            if (!headerMatch) {
                logger.debug(`[${this.serverId}] No complete header found in buffer.`);
                if (this.messageBuffer.length > 1024 * 20) {
                    logger.error(`[${this.serverId}] Message buffer growing large (20KB) without valid header. Potential corruption. Clearing buffer.`);
                    this.messageBuffer = '';
                    this.setState('error');
                    this.emit('protocolError', new Error('Buffer overflow without header'));
                }
                break;
            }

            const contentLength = parseInt(headerMatch[1], 10);
            const headerLength = headerMatch[0].length;

            if (isNaN(contentLength) || contentLength < 0) {
                logger.error(`[${this.serverId}] Invalid Content-Length received: ${headerMatch[1]}. Clearing buffer.`);
                this.messageBuffer = '';
                this.setState('error');
                this.emit('protocolError', new Error(`Invalid Content-Length: ${headerMatch[1]}`));
                break;
            }
            if (contentLength > MAX_CONTENT_LENGTH) {
                logger.error(`[${this.serverId}] Excessive Content-Length received: ${contentLength} bytes (Max: ${MAX_CONTENT_LENGTH}). Clearing buffer.`);
                this.messageBuffer = '';
                this.setState('error');
                this.emit('protocolError', new Error(`Excessive Content-Length: ${contentLength}`));
                break;
            }

            const totalMessageLength = headerLength + contentLength;
            logger.debug(`[${this.serverId}] Found header: Content-Length=${contentLength}, HeaderLength=${headerLength}, Total=${totalMessageLength}, BufferSize=${this.messageBuffer.length}`);

            if (this.messageBuffer.length >= totalMessageLength) {
                const messageJson = this.messageBuffer.substring(headerLength, totalMessageLength);
                this.messageBuffer = this.messageBuffer.substring(totalMessageLength);
                logger.debug(`[${this.serverId}] Extracted message, remaining buffer size: ${this.messageBuffer.length}`);

                if (!messageJson.trim()) {
                    logger.warn(`[${this.serverId}] Received empty message body after header.`);
                    continue;
                }

                try {
                    const message = JSON.parse(messageJson) as JsonRpcResponse | JsonRpcNotification;
                    this.processMessage(message);
                } catch (error: any) {
                    logger.error(`[${this.serverId}] Failed to parse JSON message: ${error.message}`, { json: messageJson });
                    this.emit('protocolError', new Error(`JSON parse error: ${error.message}`), messageJson);
                }
            } else {
                logger.debug(`[${this.serverId}] Incomplete message body, need ${totalMessageLength - this.messageBuffer.length} more bytes.`);
                break;
            }
        }
    }

    private processMessage(message: JsonRpcResponse | JsonRpcNotification): void {
        if ('id' in message && message.id !== undefined && message.id !== null) {
            const response = message as JsonRpcResponse;
            if (response.id === null) {
                logger.error(`[${this.serverId}] Received response with null ID, which is unexpected for client-initiated requests.`, response);
                return;
            }
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
                this.pendingRequests.delete(response.id);
                const duration = Date.now() - pending.startTime;
                logger.info(`[${this.serverId}] Received response for [${response.id}] ${pending.method} (${duration}ms)`);
                if (response.error) {
                    logger.error(`[${this.serverId}] Error response for [${response.id}] ${pending.method}:`, response.error);
                    pending.reject(response.error);
                } else {
                    pending.resolve(response.result);
                }
            } else {
                logger.warn(`[${this.serverId}] Received response for unknown request ID: ${response.id}`);
            }
        } else if ('method' in message) {
            const notification = message as JsonRpcNotification;
            logger.info(`[${this.serverId}] Received notification: ${notification.method}`, notification.params || '');
            this.emit(notification.method, notification.params);
            this.emit('notification', notification.method, notification.params);
        } else {
            logger.warn(`[${this.serverId}] Received invalid message structure:`, message);
        }
    }

    private sendRequestInternal<TResult>(method: string, params?: any): Promise<TResult> {
        let settled = false;
        return new Promise<TResult>((resolve, reject) => {
            if (!this.stdin.writable) {
                logger.error(`[${this.serverId}] Attempted to write to non-writable stdin.`);
                settled = true;
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

            logger.info(`[${this.serverId}] Sending request [${requestId}] ${method}`, params || '');
            logger.debug(`[${this.serverId}] Sending raw message [${requestId}]: ${message}`);

            let timeoutHandle: NodeJS.Timeout | null = null;

            const cleanup = () => {
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = null;
                }
                this.pendingRequests.delete(requestId);
            };

            const pendingRequestData: PendingRequest<TResult> = {
                resolve: (result) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(result);
                },
                reject: (error) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(error);
                },
                method,
                startTime: Date.now(),
            };
            this.pendingRequests.set(requestId, pendingRequestData);

            timeoutHandle = setTimeout(() => {
                if (settled) return;
                logger.error(`[${this.serverId}] Request [${requestId}] ${method} timed out after ${DEFAULT_TIMEOUT_MS}ms`);
                pendingRequestData.reject(new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms`));
            }, DEFAULT_TIMEOUT_MS);

            this.stdin.write(message, 'utf-8', (err) => {
                if (err) {
                    if (settled) {
                        logger.error(`[${this.serverId}] Write error occurred for request [${requestId}] after it was already handled: ${err.message}`);
                        return;
                    }
                    logger.error(`[${this.serverId}] Error writing request [${requestId}] to stdin: ${err.message}`);
                    pendingRequestData.reject(err);
                } else {
                    logger.debug(`[${this.serverId}] Successfully wrote request [${requestId}] to stdin.`);
                }
            });
        });
    }

    // --- Public API ---

    /**
     * Verifies connection readiness by sending a 'list_allowed_directories' tool call
     * as a readiness check, instead of the standard 'initialize' handshake.
     */
    public async initialize(): Promise<boolean> { // Return boolean indicating success
        if (this.state !== 'idle' && this.state !== 'disconnected') {
            logger.warn(`[${this.serverId}] Initialize (ping) called while in state: ${this.state}`);
        }
        this.setState('initializing');
        const pingToolName = 'list_allowed_directories';
        logger.info(`[${this.serverId}] Sending '${pingToolName}' tool call as readiness check...`);

        try {
            // Send the ping request using the callTool structure
            // Method is 'callTool', params contain name and empty arguments
            await this.sendRequestInternal<any>('callTool', {
                name: pingToolName,
                arguments: {}
            });
            this.setState('ready');
            logger.info(`[${this.serverId}] Readiness check successful (received response for '${pingToolName}'). Client is ready.`);
            return true;
        } catch (error) {
            logger.error(`[${this.serverId}] Readiness check ('${pingToolName}') failed:`, error);
            this.setState('error');
            this.close(); // Close client if readiness check fails
            return false;
        }
    }

    public async listTools(): Promise<McpListToolsResult> {
        logger.info(`[${this.serverId}] Sending 'listTools' request...`);
        return this.sendRequestInternal<McpListToolsResult>('listTools');
    }

    public async callTool(toolName: string, args: any): Promise<McpCallToolResult> {
        logger.info(`[${this.serverId}] Sending 'callTool' request for tool: ${toolName}`);
        return this.sendRequestInternal<McpCallToolResult>('callTool', { name: toolName, arguments: args });
    }

    public async listResources(): Promise<McpListResourcesResult> {
        logger.info(`[${this.serverId}] Sending 'listResources' request...`);
        return this.sendRequestInternal<McpListResourcesResult>('listResources');
    }

    public async readResource(uri: string): Promise<McpReadResourceResult> {
        logger.info(`[${this.serverId}] Sending 'readResource' request for URI: ${uri}`);
        return this.sendRequestInternal<McpReadResourceResult>('readResource', { uri });
    }

    public async listPrompts(): Promise<McpListPromptsResult> {
        logger.info(`[${this.serverId}] Sending 'listPrompts' request...`);
        return this.sendRequestInternal<McpListPromptsResult>('listPrompts');
    }

    public async getPrompt(params: McpGetPromptParams): Promise<McpGetPromptResult> {
        logger.info(`[${this.serverId}] Sending 'getPrompt' request for ID: ${params.id}`);
        return this.sendRequestInternal<McpGetPromptResult>('getPrompt', params);
    }

    public isConnected(): boolean {
        return this.state === 'ready' && !!this.process && !this.process.killed && !!this.stdin?.writable;
    }

    public close(): void {
        // ... existing close logic ...
    }

    public async shutdown(): Promise<void> {
        // ... existing shutdown logic ...
    }

    public async exit(): Promise<void> {
        // ... existing exit logic ...
    }
}
