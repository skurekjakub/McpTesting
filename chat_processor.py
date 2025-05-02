# -*- coding: utf-8 -*-
"""
Core logic for processing chat prompts using Gemini and MCP servers.
Handles client initialization, orchestrates MCP interactions via MCPServer instances,
manages history, and provides logging.
"""
import asyncio
import os
import sys
import traceback
from datetime import datetime
from typing import Dict, Any, List, Tuple, Optional

# --- Google Generative AI SDK Imports ---
from google import genai
from google.genai import types as genai_types
# from google.generativeai.types import generation_types # Import specific exceptions if needed

# --- MCP Imports ---
from mcp import StdioServerParameters # Keep for defining server params

# --- Local Imports ---
# Import the MCPServer class from the separate file
from mcp_server import MCPServer

# --- Configuration ---
# Filesystem server configuration remains here for now
FILESYSTEM_TARGET_DIRECTORY = "C:/projects/kentico-docs-jekyll/gems/jekyll-learn-portal"

# Basic path validation
if "C:/path/to/your/target/directory" in FILESYSTEM_TARGET_DIRECTORY:
    print("ERROR: Default FILESYSTEM_TARGET_DIRECTORY detected. Please update it in chat_processor.py.")
elif not os.path.isdir(FILESYSTEM_TARGET_DIRECTORY):
    print(f"ERROR: FILESYSTEM_TARGET_DIRECTORY '{FILESYSTEM_TARGET_DIRECTORY}' not found or is not a directory.")

# --- Global State (Module Level) ---

# Gemini Client (initialized via function)
gemini_client: Optional[genai.Client] = None

# Dictionary to hold different MCP server instances
# Key: Server ID (string), Value: MCPServer instance
mcp_servers: Dict[str, MCPServer] = {}

# Debug Log (In-memory) - Kept here for app.py access
MAX_DEBUG_LOG_SIZE = 150
debug_log: List[str] = []

# --- Logging Function (Remains here) ---
def add_debug_log(message: str):
    """Adds a timestamped message to the in-memory debug log."""
    global debug_log
    try:
        log_entry = f"{datetime.now().isoformat()} - {str(message)}"
        debug_log.append(log_entry)
        while len(debug_log) > MAX_DEBUG_LOG_SIZE: debug_log.pop(0)
    except Exception as e: print(f"Error adding to debug log: {e}")

# --- Initialization Functions ---
def initialize_gemini_client():
    """Initializes the global Gemini client. Returns True on success, False on failure."""
    global gemini_client
    if gemini_client: return True

    GEMINI_API_KEY = "AIzaSyAxWctwC8Iun0kLgLsnWpTsWZ2gjFPzs4c"
    if not GEMINI_API_KEY or "YOUR_API_KEY_HERE" in GEMINI_API_KEY:
        print("Error: GEMINI_API_KEY is not set or is using the placeholder.")
        add_debug_log("Error: GEMINI_API_KEY not configured.")
        return False
    try:
        print("Initializing Gemini client...")
        add_debug_log("Initializing Gemini client...")
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        _ = gemini_client.models.get(model="gemini-1.5-flash")
        print("Gemini client initialized successfully.")
        add_debug_log("Gemini client initialized successfully.")
        return True
    except Exception as e:
        print(f"Error initializing Gemini client: {e}")
        add_debug_log(f"Error initializing Gemini client: {e}")
        gemini_client = None
        return False

def initialize_mcp_servers():
    """Initializes and stores instances of MCPServer."""
    global mcp_servers
    # --- Filesystem Server ---
    fs_params = StdioServerParameters(
        command="npx",
        args=[
            "-y",
            "@modelcontextprotocol/server-filesystem",
            FILESYSTEM_TARGET_DIRECTORY
        ],
        env={},
    )
    mcp_servers["filesystem"] = MCPServer(server_id="filesystem", params=fs_params)
    add_debug_log("Initialized 'filesystem' MCPServer instance.")

    # --- Add other servers here ---
    # Example:
    # db_params = StdioServerParameters(...)
    # mcp_servers["database"] = MCPServer(server_id="database", params=db_params)
    # add_debug_log("Initialized 'database' MCPServer instance.")

    print(f"Initialized {len(mcp_servers)} MCP server configurations.")


# --- Helper: Find Server Owning a Tool ---
def find_server_for_tool(tool_name: str) -> Optional[MCPServer]:
    """Finds which MCPServer instance contains the specified tool name."""
    global mcp_servers
    for server_id, server_instance in mcp_servers.items():
        # Check against the last known tools cached in the instance
        if any(tool.name == tool_name for tool in server_instance.last_known_tools):
            add_debug_log(f"Tool '{tool_name}' found in server '{server_id}'.")
            return server_instance
    add_debug_log(f"Warning: Tool '{tool_name}' not found in any known server's cached tools.")
    return None


# --- Core Async Prompt Processing Logic ---
async def process_prompt(user_prompt: str, gemini_history: List[genai_types.Content]) -> Tuple[str, List[genai_types.Content], List[str]]:
    """
    Processes user prompt, discovers tools from configured MCP servers,
    orchestrates Gemini calls, and handles tool execution via MCPServer instances.
    """
    internal_steps = []
    if not gemini_client:
        add_debug_log("Error: process_prompt called before Gemini client initialized.")
        return "Error: Chat processor not ready.", gemini_history, ["Initialization error."]
    if not mcp_servers:
         add_debug_log("Error: process_prompt called before MCP servers initialized.")
         return "Error: Tool servers not ready.", gemini_history, ["Initialization error."]

    # Append user prompt
    try:
         user_part = genai_types.Part(text=user_prompt)
         current_turn_history = gemini_history + [genai_types.Content(parts=[user_part], role="user")]
         internal_steps.append(f"Processing prompt: '{user_prompt}'")
    except Exception as e:
         add_debug_log(f"Error creating user content: {e}")
         return "Error processing user input.", gemini_history, ["Input processing error."]

    # --- Main Processing Block ---
    try:
        # 1. Discover and Format Tools from ALL Servers
        internal_steps.append("Listing tools from all MCP servers...")
        add_debug_log("Listing tools from all configured MCP servers...")
        all_gemini_tools = []
        # Use asyncio.gather to list tools from servers concurrently
        list_tool_tasks = [server.list_tools() for server in mcp_servers.values()]
        tool_results = await asyncio.gather(*list_tool_tasks, return_exceptions=True)

        # Process results and format tools
        for server_id, result in zip(mcp_servers.keys(), tool_results):
            if isinstance(result, Exception):
                add_debug_log(f"Error listing tools from server '{server_id}': {result}")
                internal_steps.append(f"Error contacting tool server '{server_id}'.")
            elif result: # result is the list of Tool objects
                 server_instance = mcp_servers[server_id]
                 formatted_tools = server_instance.format_tools_for_gemini() # Uses cached tools
                 all_gemini_tools.extend(formatted_tools)
                 internal_steps.append(f"Found {len(result)} tools from '{server_id}'.")
            else:
                 internal_steps.append(f"No tools found from '{server_id}'.")

        if not all_gemini_tools:
             internal_steps.append("Warning: No tools available from any server.")
             add_debug_log("No tools available from any MCP server after listing.")

        # 2. First call to Gemini
        internal_steps.append("Sending prompt and discovered tools to Gemini...")
        add_debug_log(f"Calling Gemini (1st pass) with {len(all_gemini_tools)} total tools...")
        response = None
        try:
            # Call is synchronous
            response = gemini_client.models.generate_content(
                model="models/gemini-2.5-pro-exp-03-25",
                contents=current_turn_history,
                config=genai_types.GenerateContentConfig(
                    temperature=0.1,
                    # Pass the combined list of formatted tools
                    tools=all_gemini_tools if all_gemini_tools else None
                ),
            )
            add_debug_log(f"Gemini initial response received. Candidates: {len(response.candidates) if response and response.candidates else 'N/A'}")
            internal_steps.append("Received initial response structure.")

        except Exception as e:
            error_trace = traceback.format_exc()
            add_debug_log(f"Exception DURING/AFTER first Gemini call: {e}\n{error_trace}")
            internal_steps.append(f"Error during/after first Gemini API call: {e}")
            return f"Error communicating with Gemini API: {e}", gemini_history, internal_steps

        # --- Response Validation & Processing ---
        if not response or not response.candidates:
             # Handle no response or no candidates... (similar to previous version)
             feedback = response.prompt_feedback if response else "N/A"
             add_debug_log(f"Gemini response issue: No candidates. Feedback: {feedback}")
             internal_steps.append(f"Warning: Gemini response had no candidates. Feedback: {feedback}")
             if response and response.text:
                 current_turn_history.append(genai_types.Content(parts=[genai_types.Part(text=response.text)], role="model"))
                 return response.text, current_turn_history, internal_steps
             else:
                 return "Error: Gemini returned no candidates and no text.", gemini_history, internal_steps

        # --- Process First Candidate for Function Call ---
        function_call_requested = None
        first_candidate = response.candidates[0]
        add_debug_log(f"Processing candidate 0. Finish Reason: {first_candidate.finish_reason}. Safety: {first_candidate.safety_ratings}")
        if first_candidate.content:
             current_turn_history.append(first_candidate.content) # Add model response to history
             if first_candidate.content.parts:
                 for part in first_candidate.content.parts:
                     if part.function_call:
                         function_call_requested = part.function_call
                         internal_steps.append(f"Gemini requested tool call: {function_call_requested.name}(...)")
                         add_debug_log(f"Function call requested: {function_call_requested.name}, Args: {dict(function_call_requested.args)}")
                         break # Process first call
             else: add_debug_log("Candidate 0 has no parts.")
        else: add_debug_log("Warning: First candidate has no content.")


        # --- Tool Execution Flow ---
        if function_call_requested:
            tool_name = function_call_requested.name
            tool_args = dict(function_call_requested.args)

            # Find which server owns this tool
            target_server = find_server_for_tool(tool_name)

            if not target_server:
                 # Tool requested by Gemini not found in any configured server
                 error_msg = f"Error: Gemini requested unknown tool '{tool_name}'."
                 add_debug_log(error_msg)
                 internal_steps.append(error_msg)
                 # Prepare a response indicating the error
                 function_response_part = genai_types.FunctionResponse(
                     name=tool_name,
                     response={"error": f"Tool '{tool_name}' is not available or configured."}
                 )
            else:
                 # Call the tool using the identified server instance
                 internal_steps.append(f"Executing tool '{tool_name}' via server '{target_server.server_id}'...")
                 add_debug_log(f"Calling tool '{tool_name}' on server '{target_server.server_id}' with args: {tool_args}")
                 tool_result = await target_server.call_tool(tool_name, arguments=tool_args)
                 add_debug_log(f"MCP tool '{tool_name}' raw result: {tool_result}")

                 if tool_result is None: # call_tool returns None on failure
                      error_msg = f"Error executing tool '{tool_name}' on server '{target_server.server_id}'."
                      internal_steps.append(error_msg)
                      add_debug_log(error_msg + " Check MCPServer logs.")
                      function_response_part = genai_types.FunctionResponse(
                          name=tool_name,
                          response={"error": f"Failed to execute tool '{tool_name}'. Server connection or execution failed."}
                      )
                 else:
                      # Extract output (similar logic as before)
                      tool_output_content_str = f"Error extracting output from tool '{tool_name}'."
                      if tool_result and hasattr(tool_result, 'content') and isinstance(tool_result.content, list) and len(tool_result.content) > 0:
                          part = tool_result.content[0]
                          if hasattr(part, 'text') and part.text is not None:
                              tool_output_content_str = part.text
                              internal_steps.append(f"Tool '{tool_name}' executed successfully.")
                              # ... (add preview logging) ...
                          else:
                              internal_steps.append(f"Warning: Tool '{tool_name}' result part lacks 'text'. Using raw part.")
                              tool_output_content_str = str(part)
                      else:
                          internal_steps.append(f"Warning: Tool '{tool_name}' result has unexpected structure.")
                          tool_output_content_str = str(tool_result)

                      function_response_part = genai_types.FunctionResponse(
                          name=tool_name,
                          response={"content": tool_output_content_str}
                      )

            # --- Add FunctionResponse to History ---
            current_turn_history.append(genai_types.Content(
                role="function",
                parts=[genai_types.Part(function_response=function_response_part)]
            ))
            internal_steps.append("Sending tool result/error back to Gemini...")
            add_debug_log("Calling Gemini (2nd pass)...")

            # --- Second Gemini Call ---
            try:
                # Call is synchronous
                final_response = gemini_client.models.generate_content(
                    model="models/gemini-2.5-pro-exp-03-25",
                    contents=current_turn_history,
                    config=genai_types.GenerateContentConfig(temperature=0.7), # No tools needed
                )
                add_debug_log(f"Gemini final response received. Candidates: {len(final_response.candidates) if final_response and final_response.candidates else 'N/A'}")

                if final_response and final_response.candidates:
                    if final_response.candidates[0].content:
                         current_turn_history.append(final_response.candidates[0].content)
                    final_text = final_response.text
                    internal_steps.append("Received final response from Gemini.")
                    add_debug_log(f"Gemini final text preview: {(final_text[:100] + '...' if len(final_text) > 100 else final_text).replace('\n', ' ')}")
                    return final_text, current_turn_history, internal_steps
                else:
                    internal_steps.append("Error: Gemini provided no candidates in final response.")
                    add_debug_log(f"Gemini final response issue: No candidates. Feedback: {final_response.prompt_feedback if final_response else 'N/A'}")
                    return "Error: Gemini did not provide final response.", current_turn_history, internal_steps

            except Exception as e:
                 error_trace = traceback.format_exc()
                 add_debug_log(f"Exception DURING/AFTER second Gemini call: {e}\n{error_trace}")
                 internal_steps.append(f"Error during/after second Gemini API call: {e}")
                 return f"Error communicating with Gemini on final step: {e}", current_turn_history, internal_steps

        # --- Handle No Function Call Requested ---
        else:
             internal_steps.append("Gemini did not request a tool call.")
             add_debug_log("No function call requested.")
             if response and response.text:
                  final_text = response.text
                  add_debug_log(f"Gemini direct text preview: {(final_text[:100] + '...' if len(final_text) > 100 else final_text).replace('\n', ' ')}")
                  # History already includes model response from processing step 4
                  return final_text, current_turn_history, internal_steps
             else:
                  # Handle case where first response also had no text
                  internal_steps.append("Warning: Gemini provided no function call and no text.")
                  add_debug_log("Gemini response issue: No function call or text.")
                  finish_reason = first_candidate.finish_reason if first_candidate else "UNKNOWN"
                  safety = first_candidate.safety_ratings if first_candidate else "UNKNOWN"
                  error_msg = f"Error: Gemini provided no actionable response. Finish: {finish_reason}. Safety: {safety}"
                  return error_msg, current_turn_history, internal_steps

    # --- Outer Error Handling ---
    # Use specific exceptions if available and imported, otherwise generic Exception
    except genai_types.BlockedPromptException as bpe:
         add_debug_log(f"BlockedPromptException: {bpe}")
         internal_steps.append(f"Error: Request blocked. {bpe}")
         return f"Error: Request blocked by safety filters.", gemini_history, internal_steps
    except genai_types.StopCandidateException as sce:
         add_debug_log(f"StopCandidateException: {sce}")
         internal_steps.append(f"Error: Generation stopped. {sce}")
         return f"Error: Generation stopped unexpectedly.", gemini_history, internal_steps
    except FileNotFoundError as fnfe: # This might now happen inside MCPServer methods
        add_debug_log(f"FileNotFoundError: {fnfe}")
        internal_steps.append(f"Error: Command not found for MCP server.")
        return "Error: Required command for tool server not found.", gemini_history, internal_steps
    except ConnectionRefusedError as cre: # This might now happen inside MCPServer methods
         add_debug_log(f"ConnectionRefusedError: {cre}")
         internal_steps.append("Error: Could not connect to MCP server.")
         return "Error: Failed to connect to tool server process.", gemini_history, internal_steps
    except Exception as e:
        error_trace = traceback.format_exc()
        add_debug_log(f"Unexpected error in process_prompt: {e}\n{error_trace}")
        internal_steps.append(f"An unexpected error occurred: {e}")
        return f"An unexpected server error occurred: {e}", gemini_history, internal_steps

# --- Function to retrieve logs (Remains here) ---
def get_debug_logs() -> List[str]:
    """Returns a copy of the current debug logs."""
    global debug_log
    return list(reversed(debug_log)) # Return newest first

