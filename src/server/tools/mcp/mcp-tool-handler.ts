// src/server/tools/mcp/mcp-tool-handler.ts
import {
    FunctionCall,
    FunctionDeclarationSchemaType,
    Part,
    Tool,
    Schema as GeminiSchema,
    FunctionDeclaration,
    FunctionDeclarationSchema
} from '@google/generative-ai';
// Import from the new mcp-initializer location
import { getMcpSdkClient } from './mcp-initializer';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import logger from '../../logger'; // Adjust path
import { cleanSchemaForGeminiDeclaration } from '../../utils/schema-utils'; // Adjust path

// Store a mapping from tool name to server ID (populated during discovery)
let toolToServerMap: { [toolName: string]: string } = {};

/**
 * Discovers tools from all active MCP servers using the SDK and formats them for Gemini.
 * @returns A promise resolving to a list of Tool objects for Gemini.
 */
export async function discoverAndFormatTools(): Promise<Tool[]> {
    logger.info('[MCP Tool Handler] Discovering and formatting tools from MCP servers using SDK...');
    const serverIds = ['filesystem', 'memory', 'chroma'];
    const activeClients: { serverId: string; client: Client }[] = []; // Use SDK Client type

    for (const id of serverIds) {
        const client = getMcpSdkClient(id); // Use renamed getter
        if (client) {
            activeClients.push({ serverId: id, client });
        } else {
            logger.info(`[MCP Tool Handler] MCP SDK client '${id}' not available, skipping tool discovery.`);
        }
    }

    if (activeClients.length === 0) {
        logger.warn('[MCP Tool Handler] No active MCP SDK clients found for tool discovery.');
        return [];
    }

    const toolPromises = activeClients.map(({ serverId, client }) =>
        client.listTools()
            .then(result => {
                const tools = (result as any)?.tools as any[];
                return { serverId, status: 'fulfilled' as const, value: tools };
            })
            .catch((error: Error) => ({ serverId, status: 'rejected' as const, reason: error }))
    );

    const results = await Promise.allSettled(toolPromises);

    const allDeclarations: FunctionDeclaration[] = [];
    toolToServerMap = {}; // Reset map

    results.forEach(settledResult => {
        if (settledResult.status === 'rejected') {
            logger.error(`[MCP Tool Handler] Unexpected rejection in tool discovery promise wrapper:`, settledResult.reason);
            return;
        }

        const result = settledResult.value;

        if (result.status === 'fulfilled') {
            const tools = result.value as any[];
            if (tools && Array.isArray(tools)) {
                logger.info(`[MCP Tool Handler] Received ${tools.length} tools from '${result.serverId}'.`);
                tools.forEach((mcpTool: any) => {
                    try {
                        const toolName = mcpTool?.name;
                        const toolDescription = mcpTool?.description;
                        const toolSchema = mcpTool?.inputSchema;

                        if (!toolName) {
                            logger.warn(`[MCP Tool Handler - ${result.serverId}] Skipping tool with missing name.`);
                            return;
                        }
                        if (toolToServerMap[toolName]) {
                            logger.warn(`[MCP Tool Handler - ${result.serverId}] Duplicate tool name found: '${toolName}'. Overwriting server mapping. Previous: ${toolToServerMap[toolName]}`);
                        }

                        toolToServerMap[toolName] = result.serverId;

                        const parameters = cleanSchemaForGeminiDeclaration(toolSchema);

                        const declaration: FunctionDeclaration = {
                            name: toolName,
                            description: toolDescription || '',
                            ...(parameters && { parameters }),
                        };

                        allDeclarations.push(declaration);

                    } catch (formatError: any) {
                        logger.error(`[MCP Tool Handler - ${result.serverId}] Error formatting tool '${mcpTool?.name ?? 'unknown'}': ${formatError?.message ?? formatError}`);
                    }
                });
            } else {
                logger.warn(`[MCP Tool Handler] No tools array found or invalid format in successful response from '${result.serverId}'. Result:`, result.value);
            }
        } else { // status === 'rejected'
            logger.error(`[MCP Tool Handler] Error listing tools from '${result.serverId}': ${result.reason?.message ?? result.reason}`);
        }
    });

    logger.info(`[MCP Tool Handler] Total formatted declarations for Gemini: ${allDeclarations.length}`);

    if (allDeclarations.length > 0) {
        return [{ functionDeclarations: allDeclarations }];
    } else {
        return [];
    }
}

/**
 * Handles the execution of a function call via the appropriate MCP server using the SDK.
 * @param functionCall The FunctionCall object from Gemini.
 * @returns A promise resolving to the structure needed for FunctionResponsePart.
 */
export async function handleFunctionCall(functionCall: FunctionCall): Promise<{ name: string; response: object }> {
    const toolName = functionCall.name;
    const args = functionCall.args;

    logger.info(`[MCP Tool Handler] Handling function call for tool: ${toolName}`);

    const serverId = toolToServerMap[toolName];
    if (!serverId) {
        const errorMsg = `Tool '${toolName}' not found. It might be unavailable or discovery failed.`;
        logger.error(`[MCP Tool Handler] ${errorMsg}`);
        return { name: toolName, response: { error: errorMsg } };
    }

    const client = getMcpSdkClient(serverId); // Use renamed getter
    if (!client) {
        const errorMsg = `MCP SDK client for server '${serverId}' (tool: ${toolName}) is not available.`;
        logger.error(`[MCP Tool Handler] ${errorMsg}`);
        return { name: toolName, response: { error: errorMsg } };
    }

    try {
        logger.info(`[MCP Tool Handler] Executing tool '${toolName}' via SDK client '${serverId}'`, { args });
        const result = await client.callTool({
            name: toolName,
            arguments: args as Record<string, unknown>
        });

        logger.info(`[MCP Tool Handler] Raw SDK result from tool '${toolName}':`, result);

        let responseContent: any;
        if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
            const textPart = result.content.find((part: any) => part.type === 'text' && typeof part.text === 'string');
            if (textPart) {
                responseContent = { content: textPart.text };
                logger.info(`[MCP Tool Handler] Tool '${toolName}' executed successfully via SDK.`, { content: textPart.text });
            } else {
                logger.warn(`[MCP Tool Handler] Tool '${toolName}' SDK result content part lacks simple 'text'. Stringifying first part.`);
                responseContent = { content: JSON.stringify(result.content[0]) };
            }
        } else {
            logger.warn(`[MCP Tool Handler] Tool '${toolName}' SDK result has no content or unexpected structure. Returning empty success.`);
            responseContent = { success: true };
        }

        return {
            name: toolName,
            response: responseContent,
        };

    } catch (error: any) {
        const errorMsg = `Failed to execute tool '${toolName}' via MCP SDK client: ${error.message || String(error)}`;
        logger.error(`[MCP Tool Handler] Error calling tool '${toolName}' on server '${serverId}' via SDK:`, error);
        return { name: toolName, response: { error: errorMsg } };
    }
}
