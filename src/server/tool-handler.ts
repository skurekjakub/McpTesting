// Create file: c:/projects/python/mcpbro/mcpbro-nextjs/src/server/tool-handler.ts
import {
    FunctionCall,
    FunctionDeclarationSchemaType,
    FunctionResponse,
    FunctionResponsePart, // Import FunctionResponsePart
    Part,
    Tool,
    Schema,
    FunctionDeclaration,
} from '@google/generative-ai';
import { getMcpClient } from './initializers'; // To get MCP client instances
import { McpStdioClient } from './mcp-client'; // Import the client class type

// Define types for MCP tool results (adjust based on actual MCP spec/library)
interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema?: any; // Schema definition from MCP server
}

interface McpListToolsResult {
    tools: McpToolDefinition[];
}

interface McpCallToolResult {
    content?: { type: string; text?: string; [key: string]: any }[];
    isError?: boolean;
}

// Store a mapping from tool name to server ID (populated during discovery)
let toolToServerMap: { [toolName: string]: string } = {}; // Initialize as empty

/**
 * Cleans an MCP schema for Gemini compatibility (basic version).
 * TODO: Implement more robust cleaning similar to Python's version if needed.
 */
function cleanSchemaForGemini(schema: any): Schema | undefined {
    if (!schema || typeof schema !== 'object') {
        return undefined;
    }
    // Basic cleaning: remove disallowed top-level keys, assume object type if properties exist
    const { $schema, title, additionalProperties, ...rest } = schema;
    const properties = rest.properties;
    // A very basic conversion - assumes properties are correctly structured
    // More complex cleaning (recursion, type mapping) might be needed.
    if (properties && typeof properties === 'object') {
        return {
            type: FunctionDeclarationSchemaType.OBJECT,
            properties: properties,
            required: rest.required || [],
        };
    }
    // Handle other simple types if necessary, otherwise return undefined
    if (rest.type && typeof rest.type === 'string' && rest.type !== 'object' && rest.type !== 'null') {
        // Attempt to map simple types (needs refinement)
        const typeMap: { [key: string]: FunctionDeclarationSchemaType } = {
            string: FunctionDeclarationSchemaType.STRING,
            number: FunctionDeclarationSchemaType.NUMBER,
            integer: FunctionDeclarationSchemaType.INTEGER,
            boolean: FunctionDeclarationSchemaType.BOOLEAN,
            array: FunctionDeclarationSchemaType.ARRAY,
        };
        const geminiType = typeMap[rest.type.toLowerCase()];
        if (geminiType) {
            return { type: geminiType, ...rest }; // Include other properties like description
        }
    }

    console.warn(`Could not convert MCP schema for Gemini: ${JSON.stringify(schema)}`);
    return undefined; // Return undefined if conversion isn't straightforward
}

/**
 * Discovers tools from all active MCP servers and formats them for Gemini.
 * @returns A promise resolving to a list of Tool objects for Gemini.
 */
export async function discoverAndFormatTools(): Promise<Tool[]> {
    console.log('Discovering and formatting tools from MCP servers...');
    const serverIds = ['filesystem', 'memory', 'chroma']; // Or get dynamically
    const activeClients: { serverId: string; client: McpStdioClient }[] = [];

    for (const id of serverIds) {
        const client = getMcpClient(id);
        if (client && client.isConnected()) {
            activeClients.push({ serverId: id, client });
        } else {
            console.log(`MCP client '${id}' not active, skipping tool discovery.`);
        }
    }

    if (activeClients.length === 0) {
        console.warn('No active MCP clients found for tool discovery.');
        return [];
    }

    const toolPromises = activeClients.map(({ serverId, client }) =>
        client.listTools()
            .then(result => ({ serverId, status: 'fulfilled', value: result as McpListToolsResult }))
            .catch(error => ({ serverId, status: 'rejected', reason: error }))
    );

    const results = await Promise.allSettled(toolPromises);

    const allGeminiTools: Tool[] = [];
    toolToServerMap = {}; // Reset map for this discovery cycle

    results.forEach(settledResult => {
        if (settledResult.status === 'fulfilled') {
            const result = settledResult.value;
            if (result.status === 'fulfilled' && result.value?.tools) {
                console.log(`Received ${result.value.tools.length} tools from '${result.serverId}'.`);
                result.value.tools.forEach((mcpTool: McpToolDefinition) => {
                    try {
                        if (!mcpTool.name) {
                            console.warn(`[${result.serverId}] Skipping tool with missing name.`);
                            return;
                        }

                        toolToServerMap[mcpTool.name] = result.serverId;

                        const parameters = cleanSchemaForGemini(mcpTool.inputSchema);

                        const declaration: FunctionDeclaration = {
                            name: mcpTool.name,
                            description: mcpTool.description || '',
                            ...(parameters && { parameters }),
                        };

                        allGeminiTools.push({ functionDeclarations: [declaration] });

                    } catch (formatError) {
                        console.error(`[${result.serverId}] Error formatting tool '${mcpTool.name}':`, formatError);
                    }
                });
            } else if (result.status === 'rejected') {
                console.error(`Error listing tools from '${result.serverId}':`, result.reason);
            } else {
                console.warn(`No tools found or invalid format from '${result.serverId}'.`);
            }
        } else {
            console.error(`Failed to get tool list from a server:`, settledResult.reason);
        }
    });

    console.log(`Total formatted tools for Gemini: ${allGeminiTools.length}`);
    return allGeminiTools;
}

/**
 * Handles the execution of a function call via the appropriate MCP server.
 * @param functionCall The FunctionCall object from Gemini.
 * @returns A promise resolving to the structure needed for FunctionResponsePart.
 */
export async function handleFunctionCall(functionCall: FunctionCall): Promise<{ name: string; response: object }> {
    const toolName = functionCall.name;
    const args = functionCall.args;

    console.log(`Handling function call for tool: ${toolName}`);

    const serverId = toolToServerMap[toolName];
    if (!serverId) {
        const errorMsg = `Tool '${toolName}' not found in any known server.`;
        console.error(`Error: ${errorMsg}`);
        return { name: toolName, response: { error: errorMsg } };
    }

    const client = getMcpClient(serverId);
    if (!client || !client.isConnected()) {
        const errorMsg = `MCP client for server '${serverId}' (tool: ${toolName}) is not available or connected.`;
        console.error(`Error: ${errorMsg}`);
        return { name: toolName, response: { error: errorMsg } };
    }

    try {
        console.log(`Executing tool '${toolName}' via server '${serverId}' with args:`, args);
        const result: McpCallToolResult = await client.callTool(toolName, args);

        console.log(`Raw result from tool '${toolName}':`, result);

        let responseContent: any;
        if (result?.isError) {
            responseContent = { error: `Tool '${toolName}' reported an error.`, details: result.content };
            console.error(`Tool '${toolName}' execution resulted in an error:`, result.content);
        } else if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
            const part = result.content[0];
            if (part && typeof part.text === 'string') {
                responseContent = { content: part.text };
            } else {
                console.warn(`Tool '${toolName}' result content part lacks 'text'. Stringifying content.`);
                responseContent = { content: JSON.stringify(result.content) };
            }
        } else {
            console.warn(`Tool '${toolName}' returned unexpected result structure. Stringifying.`);
            responseContent = { content: JSON.stringify(result ?? null) };
        }

        return {
            name: toolName,
            response: responseContent,
        };

    } catch (error: any) {
        const errorMsg = `Failed to execute tool '${toolName}': ${error.message || String(error)}`;
        console.error(`Error calling tool '${toolName}' on server '${serverId}':`, error);
        return { name: toolName, response: { error: errorMsg } };
    }
}