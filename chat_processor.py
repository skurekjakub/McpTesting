# -*- coding: utf-8 -*-
"""
Main chat processing orchestrator. Uses helper modules for configuration,
initialization, logging, and tool handling.
"""
import asyncio
import os
import sys
import traceback
from typing import Dict, Any, List, Tuple, Optional

# --- Google Generative AI SDK Imports ---
from google import genai
from google.genai import types as genai_types
# from google.generativeai.types import generation_types # Import specific exceptions if needed

# --- Local Imports ---
import config                # Configuration constants
import utils                 # Logging utilities
import initializers          # Initialization functions
import tool_handler          # Tool discovery, formatting, execution
from mcp_server import MCPServer # Type hint for mcp_servers dictionary

# --- Global State (Initialized by app.py calling initializers) ---
# These are populated by functions in initializers.py
gemini_client: Optional[genai.Client] = None
mcp_servers: Dict[str, MCPServer] = {}

# --- Core Async Prompt Processing Logic ---
async def process_prompt(user_prompt: str, gemini_history: List[genai_types.Content]) -> Tuple[str, List[genai_types.Content], List[str]]:
    """
    Processes user prompt, discovers tools, orchestrates Gemini calls,
    and handles tool execution via helper functions.

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

    # --- Pre-checks ---
    if not gemini_client: # Check if client was initialized successfully at startup
        utils.add_debug_log("Error: process_prompt called but Gemini client is not initialized.")
        return "Error: Chat processor not ready.", gemini_history, ["Initialization error."]
    if not mcp_servers: # Check if MCP servers were initialized
         utils.add_debug_log("Warning: process_prompt called but MCP servers dictionary is empty.")
         # Allow processing but warn that tools might not work
         internal_steps.append("Warning: Tool servers may not be available.")


    # --- Prepare History ---
    try:
         user_part = genai_types.Part(text=user_prompt)
         current_turn_history = gemini_history + [genai_types.Content(parts=[user_part], role="user")]
         internal_steps.append(f"Processing prompt: '{user_prompt}'")
    except Exception as e:
         utils.add_debug_log(f"Error creating user content: {e}")
         return "Error processing user input.", gemini_history, ["Input processing error."]

    # --- Main Processing Block ---
    try:
        # 1. Discover and Format Tools (using tool_handler)
        # Pass the globally initialized mcp_servers dictionary
        all_gemini_tools = await tool_handler.discover_and_format_tools(mcp_servers, internal_steps)

        # 2. First Gemini Call
        internal_steps.append("Sending prompt and discovered tools to Gemini...")
        utils.add_debug_log(f"Calling Gemini (1st pass) with {len(all_gemini_tools)} total tools...")
        response = None
        try:
            # Use model name from config
            response = gemini_client.models.generate_content( # Synchronous call
                model=config.GENERATION_GEMINI_MODEL,
                contents=current_turn_history,
                config=genai_types.GenerateContentConfig(
                    temperature=0.7,
                    tools=all_gemini_tools if all_gemini_tools else None
                ),
            )
            utils.add_debug_log(f"Gemini initial response received. Candidates: {len(response.candidates) if response and response.candidates else 'N/A'}")
            internal_steps.append("Received initial response structure.")
        except Exception as e:
            error_trace = traceback.format_exc()
            utils.add_debug_log(f"Exception DURING/AFTER first Gemini call: {e}\n{error_trace}")
            internal_steps.append(f"Error during/after first Gemini API call: {e}")
            return f"Error communicating with Gemini API: {e}", gemini_history, internal_steps

        # 3. Validate Response & Process First Candidate
        if not response or not response.candidates:
             feedback = response.prompt_feedback if response else "N/A"
             utils.add_debug_log(f"Gemini response issue: No candidates. Feedback: {feedback}")
             internal_steps.append(f"Warning: Gemini response had no candidates. Feedback: {feedback}")
             if response and response.text:
                 current_turn_history.append(genai_types.Content(parts=[genai_types.Part(text=response.text)], role="model"))
                 return response.text, current_turn_history, internal_steps
             else:
                 return "Error: Gemini returned no candidates and no text.", gemini_history, internal_steps

        function_call_requested = None
        first_candidate = response.candidates[0]
        utils.add_debug_log(f"Processing candidate 0. Finish Reason: {first_candidate.finish_reason}. Safety: {first_candidate.safety_ratings}")
        if first_candidate.content:
             current_turn_history.append(first_candidate.content) # Add model response to history
             if first_candidate.content.parts:
                 for part in first_candidate.content.parts:
                     if part.function_call:
                         function_call_requested = part.function_call
                         # Logging is handled within tool_handler now
                         break
             else: utils.add_debug_log("Candidate 0 has no parts.")
        else: utils.add_debug_log("Warning: First candidate has no content.")

        # 4. Handle Function Call OR Text Response
        if function_call_requested:
            # 4a. Execute Tool (using tool_handler)
            # Pass the globally initialized mcp_servers dictionary
            function_response_part = await tool_handler.handle_function_call(
                function_call_requested, mcp_servers, internal_steps
            )

            # 4b. Add FunctionResponse to History
            current_turn_history.append(genai_types.Content(
                role="function",
                parts=[genai_types.Part(function_response=function_response_part)]
            ))
            internal_steps.append("Sending tool result/error back to Gemini...")
            utils.add_debug_log("Calling Gemini (2nd pass)...")

            # 4c. Second Gemini Call
            try:
                # Use model name from config
                final_response = gemini_client.models.generate_content( # Synchronous
                    model=config.GENERATION_GEMINI_MODEL,
                    contents=current_turn_history,
                    config=genai_types.GenerateContentConfig(temperature=0.7),
                )
                utils.add_debug_log(f"Gemini final response received. Candidates: {len(final_response.candidates) if final_response and final_response.candidates else 'N/A'}")

                if final_response and final_response.candidates:
                    if final_response.candidates[0].content:
                         current_turn_history.append(final_response.candidates[0].content)
                    final_text = final_response.text
                    internal_steps.append("Received final response from Gemini.")
                    # Use log preview length from config (via utils)
                    utils.add_debug_log(f"Gemini final text preview: {(final_text[:config.LOG_PREVIEW_LEN] + '...' if len(final_text) > config.LOG_PREVIEW_LEN else final_text).replace('\n', ' ')}")
                    return final_text, current_turn_history, internal_steps
                else: # No candidates in final response
                    internal_steps.append("Error: Gemini provided no candidates in final response.")
                    utils.add_debug_log(f"Gemini final response issue: No candidates. Feedback: {final_response.prompt_feedback if final_response else 'N/A'}")
                    return "Error: Gemini did not provide final response.", current_turn_history, internal_steps

            except Exception as e:
                 error_trace = traceback.format_exc()
                 utils.add_debug_log(f"Exception DURING/AFTER second Gemini call: {e}\n{error_trace}")
                 internal_steps.append(f"Error during/after second Gemini API call: {e}")
                 return f"Error communicating with Gemini on final step: {e}", current_turn_history, internal_steps

        else: # 5. No Function Call Requested - Return Text
             internal_steps.append("Gemini did not request a tool call.")
             utils.add_debug_log("No function call requested.")
             if response and response.text:
                  final_text = response.text
                  # Use log preview length from config (via utils)
                  utils.add_debug_log(f"Gemini direct text preview: {(final_text[:config.LOG_PREVIEW_LEN] + '...' if len(final_text) > config.LOG_PREVIEW_LEN else final_text).replace('\n', ' ')}")
                  # History already includes model response content
                  return final_text, current_turn_history, internal_steps
             else:
                  internal_steps.append("Warning: Gemini provided no function call and no text.")
                  utils.add_debug_log("Gemini response issue: No function call or text.")
                  finish_reason = first_candidate.finish_reason if first_candidate else "UNKNOWN"
                  safety = first_candidate.safety_ratings if first_candidate else "UNKNOWN"
                  error_msg = f"Error: Gemini provided no actionable response. Finish: {finish_reason}. Safety: {safety}"
                  return error_msg, current_turn_history, internal_steps

    # --- Outer Error Handling ---
    # Use specific exceptions if available and imported, otherwise generic Exception
    except genai_types.BlockedPromptException as bpe: # Replace with actual exception class if different
         utils.add_debug_log(f"BlockedPromptException: {bpe}")
         internal_steps.append(f"Error: Request blocked. {bpe}")
         return f"Error: Request blocked by safety filters.", gemini_history, internal_steps
    except genai_types.StopCandidateException as sce: # Replace with actual exception class if different
         utils.add_debug_log(f"StopCandidateException: {sce}")
         internal_steps.append(f"Error: Generation stopped. {sce}")
         return f"Error: Generation stopped unexpectedly.", gemini_history, internal_steps
    except FileNotFoundError as fnfe: # This might now happen inside MCPServer/tool_handler
        utils.add_debug_log(f"FileNotFoundError: {fnfe}")
        internal_steps.append(f"Error: Command not found for MCP server.")
        return "Error: Required command for tool server not found.", gemini_history, internal_steps
    except ConnectionRefusedError as cre: # This might now happen inside MCPServer/tool_handler
         utils.add_debug_log(f"ConnectionRefusedError: {cre}")
         internal_steps.append("Error: Could not connect to MCP server.")
         return "Error: Failed to connect to tool server process.", gemini_history, internal_steps
    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(f"Unexpected error in process_prompt: {e}\n{error_trace}")
        internal_steps.append(f"An unexpected error occurred: {e}")
        return f"An unexpected server error occurred: {e}", gemini_history, internal_steps

# --- Function to retrieve logs (Now just calls utils) ---
def get_debug_logs() -> List[str]:
    """Returns a copy of the current debug logs from the utils module."""
    return utils.get_debug_logs()

