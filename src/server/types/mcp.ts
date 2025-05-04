// src/server/types/mcp.ts

// --- MCP Specific Types ---

// Based on potential MCP spec for tool definition
export interface McpToolParameter {
    name: string;
    type: string; // e.g., 'string', 'number', 'boolean', 'object', 'array'
    description?: string;
    required?: boolean;
}

export interface McpToolDefinition {
    name: string;
    description?: string;
    parameters?: McpToolParameter[];
    inputSchema?: any; // Schema definition from MCP server
}

export interface McpListToolsResult {
    tools: McpToolDefinition[];
}

export interface McpCallToolResult {
    content?: string; // Example: simple text response
    data?: any;       // Example: more complex structured data
    error?: string;   // Example: tool-specific error message
}

// Placeholder for initialize parameters
export interface McpClientInfo {
    name: string;
    version: string;
}

export interface McpInitializeParams {
    processId?: number | null;
    clientInfo?: McpClientInfo;
    capabilities?: any; // Keep any for now, define based on spec/needs
    // rootUri?: string | null;
    // workspaceFolders?: any[] | null;
}

// Placeholder for initialize result
export interface McpServerCapabilities {
    // Define based on expected server capabilities from MCP spec
    // e.g., supportsStreaming?: boolean;
    // e.g., supportedResourceTypes?: string[];
    [key: string]: any; // Allow arbitrary capabilities for now
}

export interface McpInitializeResult {
    serverInfo?: {
        name: string;
        version: string;
    };
    capabilities: McpServerCapabilities;
}

// Placeholder for listResources result
export interface McpResource {
    uri: string;
    type: string; // e.g., 'file', 'buffer'
    // Add other relevant metadata
}
export interface McpListResourcesResult {
    resources: McpResource[];
}

// Placeholder for readResource result
export interface McpReadResourceResult {
    uri: string;
    content: string; // Assuming text content for now
    // Add version/metadata if needed
}

// Placeholder for listPrompts result
export interface McpPromptDefinition {
    id: string;
    name: string;
    description?: string;
    // Add parameters/schema if needed
}
export interface McpListPromptsResult {
    prompts: McpPromptDefinition[];
}

// Placeholder for getPrompt result
export interface McpGetPromptParams {
    id: string;
    // Add context/variables if needed
}
export interface McpGetPromptResult {
    id: string;
    content: string; // The actual prompt text/template
}


// --- JSON-RPC Types ---

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: any;
}

export interface JsonRpcResponse<TResult = any> { // Add generic for result type
    jsonrpc: '2.0';
    id: number | string | null;
    result?: TResult; // Use the generic type
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: any;
}

// Type for pending requests waiting for a response
export type PendingRequest<TResult = any> = { // Add generic for result type
    resolve: (result: TResult) => void; // Use the generic type
    reject: (error: any) => void;
    method: string;
    startTime: number; // For potential timeouts
};

// --- Client State Type ---
export type McpClientState = 'idle' | 'initializing' | 'ready' | 'disconnected' | 'error';
