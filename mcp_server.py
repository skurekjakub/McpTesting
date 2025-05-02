# -*- coding: utf-8 -*-
"""
Defines a class to manage interaction with a single MCP server.
Handles connection, tool listing, and tool calling via stdio.
"""
import asyncio
import traceback
from typing import Dict, Any, List, Optional, Union

# --- MCP Imports ---
from mcp import ClientSession, StdioServerParameters # Assuming Stdio for now
from mcp.client import stdio
from mcp import Tool # Use the base Tool type

# --- Google Generative AI SDK Imports (for Tool formatting) ---
# Import necessary types for formatting tools for Gemini
from google.genai import types as genai_types

# --- Logging ---
# Simple logging function (can be replaced with a more robust logger)
def _log_error(message: str):
    """Basic error logging."""
    print(f"MCP_SERVER_ERROR: {message}")
    # In a real app, integrate with chat_processor's logger or a dedicated logging setup

def _log_debug(message: str):
    """Basic debug logging."""
    # print(f"MCP_SERVER_DEBUG: {message}") # Optional: Enable for verbose debugging
    pass


# --- Helper: Clean Schema ---
# (Copied from chat_processor, could be moved to a shared utils file later)
def clean_schema_for_gemini(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively cleans schema properties not allowed by Gemini FunctionDeclaration."""
    cleaned_schema = {}
    if not isinstance(schema, dict): return schema

    for key, value in schema.items():
        if key in ["additionalProperties", "$schema", "title"] and key not in ['properties', 'items']:
             continue
        if key == 'properties' and isinstance(value, dict):
            cleaned_schema[key] = {prop_key: clean_schema_for_gemini(prop_value) for prop_key, prop_value in value.items()}
        elif key == 'items' and isinstance(value, dict):
             items_schema = value.copy()
             items_schema.pop('additionalProperties', None)
             cleaned_schema[key] = clean_schema_for_gemini(items_schema)
        elif isinstance(value, dict):
            cleaned_schema[key] = clean_schema_for_gemini(value)
        elif isinstance(value, list):
              cleaned_schema[key] = [clean_schema_for_gemini(item) if isinstance(item, dict) else item for item in value]
        else:
            cleaned_schema[key] = value

    if "properties" in cleaned_schema and "type" not in cleaned_schema:
        cleaned_schema["type"] = "OBJECT"
    elif not cleaned_schema or ("properties" not in cleaned_schema and "type" not in cleaned_schema):
         if cleaned_schema:
              if 'type' not in cleaned_schema: cleaned_schema["type"] = "OBJECT"
         else:
              cleaned_schema = {"type": "OBJECT"}
    return cleaned_schema

# --- MCPServer Class ---
class MCPServer:
    """Manages connection and interaction with a single MCP server."""

    def __init__(self, server_id: str, params: Union[StdioServerParameters, Any]):
        """
        Initializes the MCPServer wrapper.

        Args:
            server_id: A unique identifier for this server instance (e.g., 'filesystem', 'database').
            params: Configuration parameters for the server (e.g., StdioServerParameters).
                    Currently only supports StdioServerParameters.
        """
        if not isinstance(params, StdioServerParameters):
            # TODO: Add support for other connection types (e.g., SSE) later
            raise TypeError("Currently only StdioServerParameters are supported.")

        self.server_id = server_id
        self.params = params
        self.last_known_tools: List[Tool] = [] # Cache tools from list_tools
        _log_debug(f"MCPServer '{self.server_id}' initialized with params: {params}")

    async def list_tools(self) -> List[Tool]:
        """
        Connects to the MCP server, lists available tools, and caches them.

        Returns:
            A list of Tool objects provided by the server. Returns empty list on error.
        """
        _log_debug(f"[{self.server_id}] Attempting to list tools...")
        try:
            # Establish connection and session within this method's scope
            async with stdio.stdio_client(self.params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    _log_debug(f"[{self.server_id}] Session initialized. Listing tools...")
                    response = await session.list_tools()
                    if response and hasattr(response, 'tools') and response.tools:
                        self.last_known_tools = response.tools
                        _log_debug(f"[{self.server_id}] Found {len(self.last_known_tools)} tools.")
                        return self.last_known_tools
                    else:
                        _log_error(f"[{self.server_id}] list_tools response invalid or empty: {response}")
                        self.last_known_tools = []
                        return []
        except FileNotFoundError as fnfe:
             _log_error(f"[{self.server_id}] Error listing tools: Command '{self.params.command}' not found. Is it installed and in PATH? {fnfe}")
             self.last_known_tools = []
             return []
        except ConnectionRefusedError as cre:
             _log_error(f"[{self.server_id}] Error listing tools: Connection refused. Is the server process starting correctly? {cre}")
             self.last_known_tools = []
             return []
        except Exception as e:
            _log_error(f"[{self.server_id}] Unexpected error listing tools: {e}\n{traceback.format_exc()}")
            self.last_known_tools = []
            return []

    def format_tools_for_gemini(self) -> List[genai_types.Tool]:
        """
        Formats the last known tools from this server for use with Gemini.

        Returns:
            A list of genai_types.Tool objects.
        """
        gemini_tools = []
        if not self.last_known_tools:
            _log_debug(f"[{self.server_id}] No tools cached to format for Gemini.")
            return []

        _log_debug(f"[{self.server_id}] Formatting {len(self.last_known_tools)} tools for Gemini...")
        for tool in self.last_known_tools:
            try:
                parameters_schema = clean_schema_for_gemini(tool.inputSchema)
                declaration = genai_types.FunctionDeclaration(
                    name=tool.name, # Use original tool name
                    description=tool.description,
                    parameters=parameters_schema if parameters_schema else None
                )
                gemini_tools.append(genai_types.Tool(function_declarations=[declaration]))
            except Exception as e:
                 _log_error(f"[{self.server_id}] Error formatting tool '{getattr(tool, 'name', 'UNKNOWN')}' for Gemini: {e}")
                 # Optionally log schema: _log_debug(f"Schema: {getattr(tool, 'inputSchema', 'N/A')}")
        return gemini_tools


    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Optional[Any]:
        """
        Connects to the MCP server and calls a specific tool.

        Args:
            tool_name: The name of the tool to call.
            arguments: A dictionary of arguments for the tool.

        Returns:
            The result from the tool call (structure depends on the tool),
            or None if the connection or call fails.
        """
        _log_debug(f"[{self.server_id}] Attempting to call tool '{tool_name}' with args: {arguments}")
        try:
             # Establish connection and session for the call
            async with stdio.stdio_client(self.params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    _log_debug(f"[{self.server_id}] Session initialized. Calling tool '{tool_name}'...")
                    result = await session.call_tool(tool_name, arguments=arguments)
                    _log_debug(f"[{self.server_id}] Tool '{tool_name}' call successful. Result: {result}")
                    return result
        except FileNotFoundError as fnfe:
             _log_error(f"[{self.server_id}] Error calling tool '{tool_name}': Command '{self.params.command}' not found. {fnfe}")
             return None
        except ConnectionRefusedError as cre:
             _log_error(f"[{self.server_id}] Error calling tool '{tool_name}': Connection refused. {cre}")
             return None
        except Exception as e:
            # Catch potential errors from session.call_tool itself (e.g., tool not found on server)
             _log_error(f"[{self.server_id}] Unexpected error calling tool '{tool_name}': {e}\n{traceback.format_exc()}")
             return None # Indicate failure
