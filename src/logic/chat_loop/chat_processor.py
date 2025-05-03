# -*- coding: utf-8 -*-
"""
Main chat processing orchestrator. Uses helper modules for configuration,
initialization, logging, and tool handling.
Supports multi-turn function calling within a single user request.
Includes a system instruction to guide model behavior.
"""

import asyncio
import traceback
import json
from typing import Dict, Any, List, Tuple, Optional, Callable

# --- Google Generative AI SDK Imports ---
from google import genai
from google.genai import types as genai_types

# --- Local Imports ---
import src.logic.config as config
import src.logic.utils as utils
from src.logic.mcp_server import MCPServer

# Import the new helper module
import src.logic.chat_loop.chat_helpers as chat_helpers

# --- Global State (Initialized by app.py calling initializers) ---
gemini_client: Optional[genai.Client] = None
summarizer_client: Optional[genai.Client] = None
mcp_servers: Dict[str, MCPServer] = {}

# --- Constants ---
MAX_FUNCTION_CALLS_PER_TURN = 25

SYSTEM_INSTRUCTION_FILE = "bot_config/system_instruction.md"
SYSTEM_INSTRUCTION = "Default system instruction if file loading fails."  # Fallback
try:
    with open(SYSTEM_INSTRUCTION_FILE, "r", encoding="utf-8") as f:
        SYSTEM_INSTRUCTION = f.read().strip()
    utils.add_debug_log(
        f"Successfully loaded system instruction from {SYSTEM_INSTRUCTION_FILE}"
    )
except FileNotFoundError:
    utils.add_debug_log(
        f"Warning: System instruction file not found at {SYSTEM_INSTRUCTION_FILE}. Using default."
    )
except Exception as e:
    utils.add_debug_log(
        f"Error loading system instruction from {SYSTEM_INSTRUCTION_FILE}: {e}. Using default."
    )


# --- Core Async Prompt Processing Logic ---
async def process_prompt(
    user_prompt: str,
    gemini_history: List[genai_types.Content],
    internal_step_callback: Optional[Callable[[str], None]] = None,
) -> Tuple[str, List[genai_types.Content]]:
    """
    Processes user prompt, orchestrates Gemini calls and tool execution using helpers.

    Args:
        user_prompt: The new prompt from the user.
        gemini_history: The existing internal conversation history (list of Content objects).
        internal_step_callback: An optional function to call for emitting internal status updates.

    Returns:
        A tuple containing:
        - The final textual response for the user (or error message).
        - The updated internal Gemini conversation history.
    """
    internal_steps = []
    final_text_response = "Error: Processing failed to produce a response."

    # --- Pre-checks ---
    if not gemini_client:
        utils.add_debug_log(
            "Error: process_prompt called but Gemini client is not initialized."
        )
        return "Error: Chat processor not ready.", gemini_history
    # Check for mcp_servers remains relevant here for early warning
    if not mcp_servers:
        utils.add_debug_log(
            "Warning: process_prompt called but MCP servers dictionary is empty."
        )
        internal_steps.append("Warning: Tool servers may not be available.")
        if internal_step_callback:
            internal_step_callback("Warning: Tool servers may not be available.")

    # --- Prepare Initial History & Discover Tools ---
    try:
        user_part = genai_types.Part(text=user_prompt)
        current_turn_history = list(gemini_history)
        current_turn_history.append(genai_types.Content(parts=[user_part], role="user"))

        internal_steps.append(f"Processing prompt: '{user_prompt}'")
        if internal_step_callback:
            internal_step_callback(f"Processing prompt: '{user_prompt}'")

        # Call helper for tool discovery, passing dependencies
        all_mcp_tools = await chat_helpers.get_available_tools(
            mcp_servers_dict=mcp_servers, internal_step_callback=internal_step_callback
        )
        utils.add_debug_log(
            f"Discovered and formatted {len(all_mcp_tools)} tools for Gemini this turn."
        )

    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(f"Error during initial setup: {e}\n{error_trace}")
        return "Error preparing request.", gemini_history

    # --- Main Processing Loop ---
    function_call_count = 0
    response: Optional[genai_types.GenerateContentResponse] = None

    while function_call_count < MAX_FUNCTION_CALLS_PER_TURN:
        utils.add_debug_log(
            f"--- Starting API Call Loop Iteration {function_call_count + 1} ---"
        )
        step_msg = f"Sending request to Gemini (iteration {function_call_count + 1})..."
        internal_steps.append(step_msg)
        if internal_step_callback:
            internal_step_callback(step_msg)

        # Log tools only on the first iteration
        if function_call_count == 0:
            if all_mcp_tools:
                try:
                    tools_log_repr = [
                        tool.model_dump(mode="json") for tool in all_mcp_tools
                    ]
                    utils.add_debug_log(
                        f"Tools passed to Gemini:\n{json.dumps(tools_log_repr, indent=2)}"
                    )
                except Exception as log_e:
                    utils.add_debug_log(
                        f"Could not serialize tools list for logging: {log_e}"
                    )
            else:
                utils.add_debug_log("No MCP tools being passed to Gemini.")

        # Call helper for API call and validation, passing dependencies
        response, error_text = await chat_helpers.call_gemini_api_and_validate(
            gemini_client_instance=gemini_client,
            system_instruction=SYSTEM_INSTRUCTION,
            history=current_turn_history,
            tools=all_mcp_tools if all_mcp_tools else None,
            internal_step_callback=internal_step_callback,
        )

        if error_text:
            final_text_response = error_text
            # If we salvaged text from a no-candidate response, add it to history
            if response and response.text and not response.candidates:
                current_turn_history.append(
                    genai_types.Content(
                        parts=[genai_types.Part(text=final_text_response)], role="model"
                    )
                )
            break

        # Call helper to process the candidate, passing dependencies
        first_candidate = response.candidates[0]
        (
            text_response_from_candidate,
            should_continue,
        ) = await chat_helpers.process_candidate(
            candidate=first_candidate,
            current_history=current_turn_history,
            mcp_servers_dict=mcp_servers,
            max_function_calls=MAX_FUNCTION_CALLS_PER_TURN,  # Pass the constant from this module
            internal_steps_list=internal_steps,
            function_call_iter=function_call_count + 1,
            internal_step_callback=internal_step_callback,
        )

        if should_continue:
            function_call_count += 1
        else:
            # No function call, or error processing candidate
            if text_response_from_candidate:
                final_text_response = text_response_from_candidate
            elif response.text:
                # Normal exit, extract final text from the last valid response
                final_text_response = response.text
                utils.add_debug_log(
                    f"Gemini final text preview: {(final_text_response[: config.LOG_PREVIEW_LEN] + '...' if len(final_text_response) > config.LOG_PREVIEW_LEN else final_text_response).replace('\n', ' ')}"
                )
            else:
                # Normal exit but no text in the response
                utils.add_debug_log(
                    "Warning: No function call and no text found in final response."
                )
                internal_steps.append("Warning: Gemini finished but provided no text.")
                if internal_step_callback:
                    internal_step_callback(
                        "Warning: Gemini finished but provided no text."
                    )
                final_text_response = "Warning: Gemini finished processing but did not provide a textual response."
            break

    # --- End of Loop ---
    if function_call_count >= MAX_FUNCTION_CALLS_PER_TURN:
        utils.add_debug_log(
            f"Reached maximum function call limit ({MAX_FUNCTION_CALLS_PER_TURN})."
        )
        internal_steps.append(
            f"Warning: Reached maximum tool call limit ({MAX_FUNCTION_CALLS_PER_TURN}). The response might be incomplete."
        )
        if internal_step_callback:
            internal_step_callback(
                f"Warning: Reached maximum tool call limit ({MAX_FUNCTION_CALLS_PER_TURN}). The response might be incomplete."
            )
        last_response_text = "Error: Reached max tool call limit."
        # Use the last valid response text if available
        if response and response.text:
            last_response_text = (
                response.text
                + f"\n\n(Warning: Reached maximum tool call limit of {MAX_FUNCTION_CALLS_PER_TURN})"
            )
        final_text_response = last_response_text

    # --- Return Results ---
    return final_text_response, current_turn_history
