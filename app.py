# -*- coding: utf-8 -*-
"""
Flask web application for the MCP Filesystem Chatbot.
Handles routing, session management, and interacts with chat_processor.
"""
import asyncio
import os
import sys # Import sys for traceback printing
import traceback # Import traceback for detailed error logs
from typing import List # Keep for type hinting if needed

# --- Flask Imports ---
from flask import Flask, request, render_template, redirect, url_for, session

# --- Import Core Logic ---
# Assuming chat_processor.py is in the same directory
import chat_processor
from google.genai import types as genai_types # Needed for type conversion

# --- Flask App Setup ---
app = Flask(__name__)
# Secret key is needed for session management
app.secret_key = os.urandom(24) # Replace with a fixed secret in production if needed

# --- Initialize Gemini Client and MCP Servers on Startup ---
# Call the initialization functions from the processor module
gemini_ok = chat_processor.initialize_gemini_client()
mcp_ok = False # Flag for MCP server init status
if gemini_ok:
    # Initialize MCP servers only if Gemini client is okay
    try:
        chat_processor.initialize_mcp_servers()
        mcp_ok = True # Assume success if no exception
    except Exception as e:
         print(f"\n--- ERROR: Failed to initialize MCP servers during startup: {e} ---")
         chat_processor.add_debug_log(f"MCP Server Init Error: {e}\n{traceback.format_exc()}")

if not gemini_ok:
    print("\n--- WARNING: Gemini client failed to initialize during app startup. ---")
    print("--- Chat functionality will likely fail. Check API Key and logs. ---")
if not mcp_ok and gemini_ok: # Only warn about MCP if Gemini was okay
     print("\n--- WARNING: MCP servers failed to initialize during app startup. ---")
     print("--- Tool functionality will likely fail. Check MCP server configurations and logs. ---")


# --- Flask Routes ---

@app.route('/', methods=['GET'])
def index():
    """Renders the main chat page, retrieving history from session."""
    # Initialize session variables if they don't exist
    if 'chat_history_display' not in session:
        session['chat_history_display'] = []
    if 'gemini_history_internal' not in session:
        session['gemini_history_internal'] = []
    # Pass the display history to the template
    return render_template('index.html', chat_history=session['chat_history_display'])

@app.route('/chat', methods=['POST'])
def chat():
    """Handles user input, calls async processing, updates session history."""
    user_input = request.form.get('prompt', '').strip()
    if not user_input:
        return redirect(url_for('index')) # Ignore empty input

    # Check if clients initialization failed earlier
    display_history_error = None
    if not chat_processor.gemini_client:
        display_history_error = "Chat client is not initialized. Cannot process request."
    elif not chat_processor.mcp_servers: # Check if MCP server dict is empty
         display_history_error = "Tool servers are not initialized. Tool usage may fail."
         # Allow chat to proceed, but warn the user

    if display_history_error:
         chat_history_display = session.get('chat_history_display', [])
         chat_history_display.append({'type': 'error', 'text': display_history_error})
         session['chat_history_display'] = chat_history_display
         session.modified = True
         return redirect(url_for('index'))


    # Retrieve history from session
    chat_history_display = session.get('chat_history_display', [])
    gemini_history_internal_raw = session.get('gemini_history_internal', [])

    # Convert raw dict history back to Content objects using genai_types
    try:
        # Use the imported genai_types for consistency
        gemini_history_internal = [genai_types.Content.model_validate(item) for item in gemini_history_internal_raw]
    except Exception as e:
         # Use the imported logger
         error_trace = traceback.format_exc() # Get traceback
         chat_processor.add_debug_log(f"Error deserializing history from session: {e}")
         chat_processor.add_debug_log(f"Deserialization Traceback:\n{error_trace}")
         # Reset history if deserialization fails
         session['chat_history_display'] = []
         session['gemini_history_internal'] = []
         chat_history_display = [{'type': 'error', 'text': f"Error loading chat history: {e}. History reset."}]
         session['chat_history_display'] = chat_history_display # Update session immediately
         session.modified = True
         # Render index directly to show the error without redirect loop
         return render_template('index.html', chat_history=chat_history_display)


    # Add user message to display history
    chat_history_display.append({'type': 'user', 'text': user_input})

    # --- Run the async logic by calling the imported function ---
    # Use the imported logger
    chat_processor.add_debug_log(f"User input received: {user_input}")
    try:
        # Call the imported process_prompt function
        final_response_text, updated_gemini_history, internal_steps = asyncio.run(
            chat_processor.process_prompt(user_input, gemini_history_internal)
        )
        chat_processor.add_debug_log(f"Processing complete. Final text preview: {(final_response_text[:100] + '...' if len(final_response_text) > 100 else final_response_text).replace('\n', ' ')}")
    except Exception as e:
         # Catch potential errors during asyncio.run or if process_prompt raises unexpectedly
         error_trace = traceback.format_exc()
         chat_processor.add_debug_log(f"Error running/calling process_prompt: {e}\n{error_trace}")
         final_response_text = f"Critical error during processing: {e}"
         updated_gemini_history = gemini_history_internal # Keep old history on critical failure
         internal_steps = [f"Critical error: {e}"]


    # Add internal steps and final response to display history
    for step in internal_steps:
        chat_history_display.append({'type': 'internal', 'text': step})
    response_type = 'error' if final_response_text.lower().startswith("error:") else 'model'
    chat_history_display.append({'type': response_type, 'text': final_response_text})

    # --- Store updated history back in session ---
    session['chat_history_display'] = chat_history_display

    # --- Serialize history item by item with detailed logging ---
    serialized_history = []
    serialization_error_occurred = False
    for i, item in enumerate(updated_gemini_history):
        try:
            # Use .model_dump() for serialization
            item_dict = item.model_dump(mode='json') # Use mode='json' for session compatibility
            serialized_history.append(item_dict)
        except AttributeError:
             # Fallback for older Pydantic versions if model_dump doesn't exist
             try:
                  chat_processor.add_debug_log(f"AttributeError: .model_dump() not found for item #{i}. Trying .dict()...")
                  item_dict = item.dict() # Older Pydantic method
                  serialized_history.append(item_dict)
             except Exception as e_dict:
                  serialization_error_occurred = True
                  error_trace = traceback.format_exc()
                  chat_processor.add_debug_log(f"Error serializing history item #{i} to session (using .dict()): {e_dict}")
                  chat_processor.add_debug_log(f"Problematic item type: {type(item)}")
                  try: chat_processor.add_debug_log(f"Problematic item repr: {repr(item)}")
                  except Exception as repr_e: chat_processor.add_debug_log(f"Could not get repr for problematic item: {repr_e}")
                  chat_processor.add_debug_log(f"Serialization Traceback:\n{error_trace}")
        except Exception as e:
            serialization_error_occurred = True
            # Log the error and the problematic item
            error_trace = traceback.format_exc() # Get traceback for context
            chat_processor.add_debug_log(f"Error serializing history item #{i} to session: {e}")
            chat_processor.add_debug_log(f"Problematic item type: {type(item)}")
            # Try logging representation, might fail if object is complex
            try:
                 chat_processor.add_debug_log(f"Problematic item repr: {repr(item)}")
            except Exception as repr_e:
                 chat_processor.add_debug_log(f"Could not get repr for problematic item: {repr_e}")
            chat_processor.add_debug_log(f"Serialization Traceback:\n{error_trace}")
            # Option: Append a placeholder or skip the item
            # For now, let's skip it to avoid breaking session saving entirely
            # serialized_history.append({"error": "Serialization failed", "original_index": i})

    session['gemini_history_internal'] = serialized_history # Save the successfully serialized items
    session.modified = True

    # Add a message to display history if an error occurred during serialization
    if serialization_error_occurred:
         session['chat_history_display'].append({'type': 'error', 'text': "Error saving full chat history state. Some history may be lost."})
         session.modified = True # Ensure session is marked modified again

    return redirect(url_for('index'))

@app.route('/reset', methods=['GET'])
def reset():
    """Clears the chat history stored in the session."""
    session.pop('chat_history_display', None)
    session.pop('gemini_history_internal', None)
    # Use the imported logger
    chat_processor.add_debug_log("Chat history reset via /reset.")
    return redirect(url_for('index'))

@app.route('/debug', methods=['GET'])
def debug():
    """Displays the in-memory debug log from the chat_processor."""
    html = "<!DOCTYPE html><html><head><title>Debug Log</title>"
    html += "<style>body {font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 10px; font-size: 0.9em;}"
    html += "h1 { border-bottom: 1px solid #ccc; padding-bottom: 5px; } </style>"
    html += "</head><body><h1>Debug Log</h1>\n"
    # Access the imported debug_log list directly
    html += "\n".join(reversed(chat_processor.debug_log)) # Access list directly, reverse for newest first
    html += "</body></html>"
    return html


# --- Run Flask App ---
if __name__ == '__main__':
    # Check the flags set during initialization
    if not gemini_ok:
         print("\n--- Flask app not starting due to Gemini client initialization failure. ---")
    # Optionally, you could prevent startup if MCP fails too, depending on requirements
    # elif not mcp_ok:
    #      print("\n--- Flask app not starting due to MCP server initialization failure. ---")
    else:
        print(f"\nFlask app starting. Access at http://127.0.0.1:5000")
        # TARGET_DIRECTORY_PATH is defined in chat_processor
        # print(f"MCP server target directory: {chat_processor.TARGET_DIRECTORY_PATH}")
        print(f"Ensure Node.js/npx is installed and in PATH.")
        print("Use Ctrl+C to stop the server.")
        # debug=True enables auto-reloading and better error pages during development
        app.run(debug=True, host='127.0.0.1', port=5000)
