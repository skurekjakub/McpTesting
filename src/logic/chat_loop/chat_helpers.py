# -*- coding: utf-8 -*-
"""
Helper functions for the main chat processing logic in chat_processor.py.
"""
import asyncio
import traceback
from typing import Dict, Any, List, Tuple, Optional, Callable

# --- Google Generative AI SDK Imports ---
from google import genai # Import the base library
from google.genai import types as genai_types

# --- Local Imports ---
# Adjust relative paths if necessary, assuming chat_helpers is in the same 'logic' directory
import src.logic.config as config
import src.logic.utils as utils
import src.logic.tool_handler as tool_handler
from src.logic.mcp_server import MCPServer

# --- Helper Functions (Extracted from chat_processor.py) ---

async def get_available_tools(
    mcp_servers_dict: Dict[str, MCPServer], # Pass mcp_servers as argument
    internal_step_callback: Optional[Callable[[str], None]] = None
) -> List[genai_types.Tool]:
    """Retrieves and combines tools from all configured MCP servers."""
    all_gemini_tools = []
    if not mcp_servers_dict: # Use the passed argument
        if internal_step_callback:
            internal_step_callback("Warning: No MCP servers initialized.")
        return []

    if internal_step_callback:
        internal_step_callback("Listing tools from all MCP servers...")
    utils.add_debug_log("Listing tools from all configured MCP servers...")

    server_instances = list(mcp_servers_dict.values()) # Use the passed argument
    server_ids = list(mcp_servers_dict.keys()) # Use the passed argument

    list_tool_tasks = [server.list_tools() for server in server_instances]
    tool_results = await asyncio.gather(*list_tool_tasks, return_exceptions=True)

    for i, result in enumerate(tool_results):
        server_id = server_ids[i]
        server_instance = server_instances[i]

        if isinstance(result, Exception):
            error_msg = f"Error listing tools from server '{server_id}': {result}"
            utils.add_debug_log(error_msg)
            if internal_step_callback:
                internal_step_callback(f"Error contacting tool server '{server_id}'.")
        elif result:
             try:
                 formatted_tools = server_instance.format_tools_for_gemini()
                 all_gemini_tools.extend(formatted_tools)
                 if internal_step_callback:
                     internal_step_callback(f"Found {len(result)} tools from '{server_id}'.")
             except Exception as format_e:
                 error_msg = f"Error formatting tools from server '{server_id}': {format_e}"
                 utils.add_debug_log(error_msg)
                 if internal_step_callback:
                     internal_step_callback(error_msg)
        else:
             if internal_step_callback:
                 internal_step_callback(f"No tools found from '{server_id}'.")
             utils.add_debug_log(f"No tools listed or returned from server '{server_id}'.")

    if not all_gemini_tools:
         if internal_step_callback:
             internal_step_callback("Warning: No tools available from any server.")
         utils.add_debug_log("No tools available from any MCP server after listing and formatting.")

    utils.add_debug_log(f"Total formatted tools collected for Gemini: {len(all_gemini_tools)}")
    return all_gemini_tools


async def call_gemini_api_and_validate(
    gemini_client_instance: genai.Client, # Pass client as argument
    system_instruction: str, # Pass system instruction
    history: List[genai_types.Content],
    tools: Optional[List[genai_types.Tool]],
    internal_step_callback: Optional[Callable[[str], None]]
) -> Tuple[Optional[genai_types.GenerateContentResponse], Optional[str]]:
    """Calls Gemini API, validates response, counts tokens, and returns response or error."""
    try:
        # --- Count Tokens Before API Call ---
        try:
            token_count_response = gemini_client_instance.models.count_tokens( # Use passed client
                model=config.GENERATION_GEMINI_MODEL,
                contents=history
            )
            total_tokens = token_count_response.total_tokens
            token_msg = f"Total tokens for next API call: {total_tokens}"
            utils.add_debug_log(token_msg)
            if internal_step_callback:
                internal_step_callback(token_msg)
        except Exception as count_e:
            utils.add_debug_log(f"Warning: Failed to count tokens before API call: {count_e}")
        # --- End Token Count ---

        # --- Call Gemini API ---
        response = gemini_client_instance.models.generate_content( # Use passed client
            model=config.GENERATION_GEMINI_MODEL,
            contents=history,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_instruction, # Use passed instruction
                temperature=0.5,
                tools=tools
            ),
        )
        utils.add_debug_log(f"Gemini response received. Candidates: {len(response.candidates) if response and response.candidates else 'N/A'}")

        # --- Validate Response ---
        if not response or not response.candidates:
            feedback = response.prompt_feedback if response else "N/A"
            error_msg = f"Warning: Gemini response had no candidates. Feedback: {feedback}"
            utils.add_debug_log(error_msg)
            if internal_step_callback:
                internal_step_callback(error_msg)
            final_text = "Error: Gemini returned no candidates."
            if response and response.text:
                 final_text = response.text
            return None, final_text

        return response, None

    except Exception as e:
        error_trace = traceback.format_exc()
        error_msg = f"Unexpected error during Gemini API call: {e}"
        utils.add_debug_log(f"{error_msg}\n{error_trace}")
        if internal_step_callback:
            internal_step_callback(error_msg)
        return None, f"An unexpected server error occurred: {e}"


async def process_candidate(
    candidate: genai_types.Candidate,
    current_history: List[genai_types.Content],
    mcp_servers_dict: Dict[str, MCPServer], # Pass mcp_servers
    max_function_calls: int, # Pass constant
    internal_steps_list: List[str],
    function_call_iter: int,
    internal_step_callback: Optional[Callable[[str], None]]
) -> Tuple[Optional[str], bool]:
    """Processes a candidate for function calls or final text.

    Returns:
        A tuple: (final_text_response, should_continue_loop)
    """
    utils.add_debug_log(f"Processing candidate 0. Finish Reason: {candidate.finish_reason}. Safety: {candidate.safety_ratings}")

    if candidate.content:
        current_history.append(candidate.content)
    else:
        utils.add_debug_log("Warning: Candidate has no content. Cannot proceed.")
        internal_steps_list.append("Warning: Gemini candidate had no content.")
        if internal_step_callback:
            internal_step_callback("Warning: Gemini candidate had no content.")
        return "Error: Gemini response lacked content.", False

    function_call_requested = None
    if candidate.content.parts:
        for part in candidate.content.parts:
            if part.function_call:
                function_call_requested = part.function_call
                break

    if function_call_requested:
        utils.add_debug_log(f"Gemini requested function call #{function_call_iter}: {function_call_requested.name}")
        step_msg = f"Gemini wants to use tool: {function_call_requested.name} (call {function_call_iter}/{max_function_calls})" # Use passed constant
        internal_steps_list.append(step_msg)
        if internal_step_callback:
            internal_step_callback(step_msg)

        function_response_part = await tool_handler.handle_function_call(
            function_call_requested, mcp_servers_dict, internal_steps_list # Use passed mcp_servers
        )

        current_history.append(genai_types.Content(
            role="function",
            parts=[genai_types.Part(function_response=function_response_part)]
        ))
        utils.add_debug_log(f"Added function response for {function_call_requested.name} to history.")
        return None, True

    else:
        utils.add_debug_log("No function call requested by Gemini. Assuming final text response.")
        internal_steps_list.append("Gemini provided final response.")
        if internal_step_callback:
            internal_step_callback("Gemini provided final response.")
        # Text extraction is handled by the caller based on the original response object
        return None, False
