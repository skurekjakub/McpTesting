# -*- coding: utf-8 -*-
"""
Handles discovery, formatting, and execution of tools via MCP servers.
"""

import asyncio
import traceback
from typing import Dict, List, Optional

# --- Google Generative AI SDK Imports ---
from google.genai import types as genai_types

# --- Local Imports ---
import src.logic.utils as utils  # Logging utilities
import src.logic.config as config  # Configuration constants (e.g., log preview length)
from src.logic.mcp_server import MCPServer  # The class managing individual servers

# --- Tool Discovery and Formatting ---


async def discover_and_format_tools(
    mcp_servers: Dict[str, MCPServer], internal_steps: List[str]
) -> List[genai_types.Tool]:
    """
    Lists tools from all registered MCP servers and formats them for Gemini.

    Args:
        mcp_servers: Dictionary of initialized MCPServer instances.
        internal_steps: List to append user-facing status messages.

    Returns:
        A combined list of genai_types.Tool objects from all servers.
    """
    internal_steps.append("Listing tools from all MCP servers...")
    utils.add_debug_log("Listing tools from all configured MCP servers...")
    all_gemini_tools = []

    if not mcp_servers:
        internal_steps.append("Warning: No MCP servers configured.")
        utils.add_debug_log("Warning: No MCP servers available for tool discovery.")
        return []

    # Use asyncio.gather to list tools from servers concurrently
    list_tool_tasks = [server.list_tools() for server in mcp_servers.values()]
    # Gather results, return_exceptions=True prevents one failure from stopping all
    tool_results = await asyncio.gather(*list_tool_tasks, return_exceptions=True)

    # Process results and format tools
    for server_id, result in zip(mcp_servers.keys(), tool_results):
        if isinstance(result, Exception):
            utils.add_debug_log(
                f"Error listing tools from server '{server_id}': {result}"
            )
            internal_steps.append(f"Error contacting tool server '{server_id}'.")
        elif result:  # result is the list of Tool objects from mcp_server.list_tools
            server_instance = mcp_servers[server_id]
            # format_tools_for_gemini uses the tools cached during list_tools()
            formatted_tools = server_instance.format_tools_for_gemini()
            all_gemini_tools.extend(formatted_tools)
            internal_steps.append(f"Found {len(result)} tools from '{server_id}'.")
        else:  # Result was empty list or None
            internal_steps.append(f"No tools found from '{server_id}'.")
            utils.add_debug_log(
                f"No tools listed or returned from server '{server_id}'."
            )

    if not all_gemini_tools:
        internal_steps.append("Warning: No tools available from any server.")
        utils.add_debug_log(
            "No tools available from any MCP server after listing and formatting."
        )

    return all_gemini_tools


# --- Tool Execution ---


def find_server_for_tool(
    tool_name: str, mcp_servers: Dict[str, MCPServer]
) -> Optional[MCPServer]:
    """
    Finds which MCPServer instance contains the specified tool name based on cached tools.

    Args:
        tool_name: The name of the tool to find.
        mcp_servers: Dictionary of initialized MCPServer instances.

    Returns:
        The MCPServer instance that owns the tool, or None if not found.
    """
    for server_id, server_instance in mcp_servers.items():
        # Check against the last known tools cached in the instance
        if any(tool.name == tool_name for tool in server_instance.last_known_tools):
            utils.add_debug_log(f"Tool '{tool_name}' found in server '{server_id}'.")
            return server_instance
    utils.add_debug_log(
        f"Warning: Tool '{tool_name}' not found in any known server's cached tools."
    )
    return None


async def handle_function_call(
    function_call: genai_types.FunctionCall,
    mcp_servers: Dict[str, MCPServer],
    internal_steps: List[str],
) -> genai_types.FunctionResponse:
    """
    Handles the execution of a function call via the appropriate MCP server.

    Args:
        function_call: The FunctionCall object from Gemini.
        mcp_servers: Dictionary of initialized MCPServer instances.
        internal_steps: List to append user-facing status messages.

    Returns:
        A FunctionResponse object containing the tool's result or an error message.
    """
    tool_name = function_call.name
    tool_args = dict(function_call.args)
    function_response_part: Optional[genai_types.FunctionResponse] = None  # Initialize

    # Find the server responsible for this tool
    target_server = find_server_for_tool(tool_name, mcp_servers)

    if not target_server:
        # Tool requested by Gemini not found
        error_msg = f"Error: Gemini requested unknown tool '{tool_name}'."
        utils.add_debug_log(error_msg)
        internal_steps.append(error_msg)
        function_response_part = genai_types.FunctionResponse(
            name=tool_name,
            response={"error": f"Tool '{tool_name}' is not available or configured."},
        )
    else:
        # Execute the tool using the found server instance
        internal_steps.append(
            f"Executing tool '{tool_name}' via server '{target_server.server_id}'..."
        )
        utils.add_debug_log(
            f"Calling tool '{tool_name}' on server '{target_server.server_id}' with args: {tool_args}"
        )
        tool_result = await target_server.call_tool(tool_name, arguments=tool_args)
        utils.add_debug_log(
            f"MCP tool '{tool_name}' raw result (preview): {str(tool_result)[: config.LOG_PREVIEW_LEN]}..."
        )

        if tool_result is None:
            # call_tool returns None on connection/execution failure within MCPServer
            error_msg = f"Error executing tool '{tool_name}' on server '{target_server.server_id}'."
            internal_steps.append(error_msg)
            utils.add_debug_log(error_msg + " Check MCPServer logs for details.")
            function_response_part = genai_types.FunctionResponse(
                name=tool_name,
                response={
                    "error": f"Failed to execute tool '{tool_name}'. Server connection or execution failed."
                },
            )
        else:
            # Process successful tool result (even if tool internally returned an error message)
            tool_output_content_str = (
                f"Error extracting output from tool '{tool_name}'."  # Default
            )
            try:
                # Attempt to extract text content, common pattern for MCP tools
                if (
                    hasattr(tool_result, "content")
                    and isinstance(tool_result.content, list)
                    and len(tool_result.content) > 0
                ):
                    part = tool_result.content[0]
                    if hasattr(part, "text") and part.text is not None:
                        tool_output_content_str = part.text
                        internal_steps.append(
                            f"Tool '{tool_name}' executed successfully."
                        )
                        output_preview = (
                            str(tool_output_content_str)[: config.LOG_PREVIEW_LEN]
                            + "..."
                            if len(str(tool_output_content_str))
                            > config.LOG_PREVIEW_LEN
                            else str(tool_output_content_str)
                        ).replace("\n", " ")
                        utils.add_debug_log(
                            f"Tool '{tool_name}' output preview: {output_preview}"
                        )
                    else:  # Part exists but no .text
                        internal_steps.append(
                            f"Warning: Tool '{tool_name}' result part lacks 'text'. Using raw part representation."
                        )
                        utils.add_debug_log(
                            f"Tool '{tool_name}' result structure issue (no text): {part}"
                        )
                        tool_output_content_str = str(part)
                else:  # No .content or it's empty/not a list
                    internal_steps.append(
                        f"Warning: Tool '{tool_name}' result has unexpected structure or no content. Using raw result."
                    )
                    utils.add_debug_log(
                        f"Tool '{tool_name}' result structure issue (no content): {tool_result}"
                    )
                    tool_output_content_str = str(tool_result)

                # Create the FunctionResponse with the extracted content
                function_response_part = genai_types.FunctionResponse(
                    name=tool_name, response={"content": tool_output_content_str}
                )
            except Exception as extraction_err:
                # Catch errors during the extraction process itself
                error_msg = (
                    f"Error processing result from tool '{tool_name}': {extraction_err}"
                )
                utils.add_debug_log(f"{error_msg}\n{traceback.format_exc()}")
                internal_steps.append(error_msg)
                function_response_part = genai_types.FunctionResponse(
                    name=tool_name, response={"error": error_msg}
                )

    # Final check to ensure a response part was created
    if not function_response_part:
        utils.add_debug_log(
            f"CRITICAL: function_response_part not created for tool {tool_name} after processing."
        )
        internal_steps.append(f"Internal error preparing response for tool {tool_name}")
        function_response_part = genai_types.FunctionResponse(
            name=tool_name,
            response={
                "error": f"Internal error processing result for tool '{tool_name}'."
            },
        )

    return function_response_part
