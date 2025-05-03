# -*- coding: utf-8 -*-
"""
Main chat processing orchestrator. Uses helper modules for configuration,
initialization, logging, and tool handling.
Supports multi-turn function calling within a single user request.
Includes a system instruction to guide model behavior.
"""
import traceback
import json # Import json for logging tool structure
from typing import Dict, Any, List, Tuple, Optional

# --- Google Generative AI SDK Imports ---
from google import genai
from google.genai import types as genai_types
# from google.generativeai.types import generation_types # Import specific exceptions if needed

# --- Local Imports ---
import src.logic.config as config                # Configuration constants
import src.logic.utils as utils                 # Logging utilities
import src.logic.tool_handler as tool_handler          # Tool discovery, formatting, execution
import src.logic.history_manager as history_manager       # History management
from src.logic.mcp_server import MCPServer # Type hint for mcp_servers dictionary

# --- Global State (Initialized by app.py calling initializers) ---
# These are populated by functions in initializers.py
gemini_client: Optional[genai.Client] = None
summarizer_client: Optional[genai.Client] = None
mcp_servers: Dict[str, MCPServer] = {}

# --- Constants ---
MAX_FUNCTION_CALLS_PER_TURN = 25 # Safeguard against infinite loops

# --- NEW: System Instruction ---
SYSTEM_INSTRUCTION = """You are a helpful assistant with access to tools for interacting with a local filesystem and a knowledge graph API.

You can use these tools sequentially within a single user turn to fulfill complex requests. If a request requires multiple steps (like reading one file to find the name of another file to read), make the necessary function calls one after another. When your are done querying tools, answer the user with a comprehensive response.

After each query, update the 'session_summary' field in the knowledge graph. This field should contain a summary of the last 10 topics discussed, ordered from most recent to least recent. Compress the summaries by removing specific details but keep things like directory and file names that you worked with so that you can get quickly up to date. Each topic should be no longer than 500 characters though. If the history exceeds 10 topics, compress the 3 oldest ones into a single summary. Number each topic in the summary for clarity with 1 indicating the most recent.

When you don't have enough context to understand the current user query, refer to the 'session_summary' field to understand the ongoing conversation. Use the 'search_nodes' function to search for the field.

After you have finished using all the tools required for the user's request, provide a final, comprehensive answer synthesizing the information gathered. Please use Markdown formatting (like code blocks, lists, etc.) in your final response where appropriate."""
# --- END NEW ---


# --- Core Async Prompt Processing Logic ---
async def process_prompt(user_prompt: str, gemini_history: List[genai_types.Content]) -> Tuple[str, List[genai_types.Content], List[str]]:
    """
    Processes user prompt, discovers tools, orchestrates Gemini calls,
    and handles tool execution, allowing for multiple function calls per turn.

    Args:
        user_prompt: The new prompt from the user.
        gemini_history: The existing internal conversation history (list of Content objects).

    Returns:
        A tuple containing:
        - The final textual response for the user (or error message).
        - The updated internal Gemini conversation history.
        - A list of internal step messages for display during this turn.
    """
    internal_steps = [] # Log steps for this specific turn
    final_text_response = "Error: Processing failed to produce a response." # Default error

    # --- Pre-checks ---
    if not gemini_client:
        utils.add_debug_log("Error: process_prompt called but Gemini client is not initialized.")
        return "Error: Chat processor not ready.", gemini_history, ["Initialization error."]
    if not mcp_servers:
         utils.add_debug_log("Warning: process_prompt called but MCP servers dictionary is empty.")
         internal_steps.append("Warning: Tool servers may not be available.")

    # try:
    #     # Checks history length and summarizes if needed
    #     processed_history, was_summarized, token_count = await history_manager.manage_history_tokens(
    #         gemini_history=gemini_history,
    #         summarization_model_instance=summarizer_client # Pass the pre-initialized summarizer client (optional)
    #     )
    #     # Update the history variable used for the rest of the function
    #     gemini_history = processed_history
    #     internal_steps.append(f"History check complete. Tokens: {token_count}. Summarized: {was_summarized}.")
    #     if was_summarized:
    #         utils.add_debug_log("History was summarized in this turn.")
    #     # If summarization failed inside the manager, logs there indicate it.

    # except Exception as hist_mgmt_e:
    #     utils.add_debug_log(f"Critical error during history_manager call: {hist_mgmt_e}")
    #     internal_steps.append(f"Warning: Error managing history: {hist_mgmt_e}")
    #     # Proceed with potentially unmodified (and possibly too long) history

    # --- Prepare Initial History & Discover Tools ---
    try:
         user_part = genai_types.Part(text=user_prompt)
         # Start a *copy* of the history for this turn's processing
         current_turn_history = list(gemini_history)
         current_turn_history.append(genai_types.Content(parts=[user_part], role="user"))
         internal_steps.append(f"Processing prompt: '{user_prompt}'")

         # Discover and format tools ONCE at the beginning of the turn
         all_mcp_tools = await tool_handler.discover_and_format_tools(mcp_servers, internal_steps)
         utils.add_debug_log(f"Discovered {len(all_mcp_tools)} MCP tools for this turn.")

    except Exception as e:
         utils.add_debug_log(f"Error during initial setup: {e}")
         return "Error preparing request.", gemini_history, ["Input processing error."]

    # --- Main Processing Loop ---
    function_call_count = 0
    while function_call_count < MAX_FUNCTION_CALLS_PER_TURN:
        utils.add_debug_log(f"--- Starting API Call Loop Iteration {function_call_count + 1} ---")
        internal_steps.append(f"Sending request to Gemini (iteration {function_call_count + 1})...")

        try:
            # --- Log the tools being passed (optional, can be verbose) ---
            if function_call_count == 0: # Log tools only on the first iteration
                if all_mcp_tools:
                    try:
                        tools_log_repr = [tool.model_dump(mode='json') for tool in all_mcp_tools]
                        utils.add_debug_log(f"Tools passed to Gemini:\n{json.dumps(tools_log_repr, indent=2)}")
                    except Exception as log_e:
                        utils.add_debug_log(f"Could not serialize tools list for logging: {log_e}")
                else:
                    utils.add_debug_log("No MCP tools being passed to Gemini.")
            # --- End Log ---

            # --- Call Gemini API ---
            response = gemini_client.models.generate_content(
                model=config.GENERATION_GEMINI_MODEL,
                contents=current_turn_history, # Send the latest history
                # --- MODIFIED: Add system instruction ---
                # --- END MODIFIED ---
                config=genai_types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=1.1,
                    # Pass the discovered tools on every iteration
                    tools=all_mcp_tools if all_mcp_tools else None
                ),
            )
            utils.add_debug_log(f"Gemini response received. Candidates: {len(response.candidates) if response and response.candidates else 'N/A'}")

            # --- Validate Response & Process Candidate ---
            if not response or not response.candidates:
                feedback = response.prompt_feedback if response else "N/A"
                utils.add_debug_log(f"Gemini response issue: No candidates. Feedback: {feedback}")
                internal_steps.append(f"Warning: Gemini response had no candidates. Feedback: {feedback}")
                final_text_response = "Error: Gemini returned no candidates."
                if response and response.text:
                     final_text_response = response.text
                     current_turn_history.append(genai_types.Content(parts=[genai_types.Part(text=final_text_response)], role="model"))
                break # Exit loop on invalid response

            first_candidate = response.candidates[0]
            utils.add_debug_log(f"Processing candidate 0. Finish Reason: {first_candidate.finish_reason}. Safety: {first_candidate.safety_ratings}")

            # --- IMPORTANT: Add Model's Response Content to History ---
            if first_candidate.content:
                 current_turn_history.append(first_candidate.content)
            else:
                 utils.add_debug_log("Warning: First candidate has no content. Cannot proceed.")
                 internal_steps.append("Warning: Gemini candidate had no content.")
                 final_text_response = "Error: Gemini response lacked content."
                 break # Exit loop

            # --- Check for Function Call ---
            function_call_requested = None
            if first_candidate.content.parts:
                 for part in first_candidate.content.parts:
                     if part.function_call:
                         function_call_requested = part.function_call
                         break # Found a function call

            if function_call_requested:
                function_call_count += 1
                utils.add_debug_log(f"Gemini requested function call #{function_call_count}: {function_call_requested.name}")
                internal_steps.append(f"Gemini wants to use tool: {function_call_requested.name} (call {function_call_count}/{MAX_FUNCTION_CALLS_PER_TURN})")

                # --- Execute Tool ---
                function_response_part = await tool_handler.handle_function_call(
                    function_call_requested, mcp_servers, internal_steps
                )

                # --- Add Function Response to History ---
                current_turn_history.append(genai_types.Content(
                    role="function", # Role MUST be 'function' for the response
                    parts=[genai_types.Part(function_response=function_response_part)]
                ))
                utils.add_debug_log(f"Added function response for {function_call_requested.name} to history.")
                # --- Continue Loop ---

            else:
                # --- No Function Call - Extract Text and Exit Loop ---
                utils.add_debug_log("No function call requested by Gemini. Assuming final text response.")
                internal_steps.append("Gemini provided final response.")
                if response.text:
                    final_text_response = response.text
                    utils.add_debug_log(f"Gemini final text preview: {(final_text_response[:config.LOG_PREVIEW_LEN] + '...' if len(final_text_response) > config.LOG_PREVIEW_LEN else final_text_response).replace('\n', ' ')}")
                else:
                     utils.add_debug_log("Warning: No function call and no text found in final response.")
                     internal_steps.append("Warning: Gemini finished but provided no text.")
                     final_text_response = "Warning: Gemini finished processing but did not provide a textual response."

                break # Exit the while loop

        # --- Handle Errors During API Call/Processing --
        except Exception as e:
            error_trace = traceback.format_exc()
            utils.add_debug_log(f"Unexpected error in API call loop: {e}\n{error_trace}")
            internal_steps.append(f"An unexpected error occurred during processing: {e}")
            final_text_response = f"An unexpected server error occurred: {e}"
            break # Exit loop on unexpected error

    # --- End of Loop ---

    if function_call_count >= MAX_FUNCTION_CALLS_PER_TURN:
        utils.add_debug_log(f"Reached maximum function call limit ({MAX_FUNCTION_CALLS_PER_TURN}).")
        internal_steps.append(f"Warning: Reached maximum tool call limit ({MAX_FUNCTION_CALLS_PER_TURN}). The response might be incomplete.")
        last_response_text = "Error: Reached max tool call limit."
        if 'response' in locals() and response and response.text:
             last_response_text = response.text + f"\n\n(Warning: Reached maximum tool call limit of {MAX_FUNCTION_CALLS_PER_TURN})"
        final_text_response = last_response_text


    # --- Return Results ---
    return final_text_response, current_turn_history, internal_steps

