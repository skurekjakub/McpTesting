# -*- coding: utf-8 -*-
"""
Flask web application for the MCP Filesystem Chatbot.
Handles routing, session management, and interacts with chat_processor.
Uses initializers module for setup.
"""
import asyncio
import os
import sys
import traceback
import json
from typing import List

# --- Flask Imports ---
from flask import Flask, request, render_template, redirect, url_for, session

# --- Local Imports ---
import chat_processor      # Main logic orchestrator
import initializers        # Initialization functions
import utils               # Logging utilities
from google.genai import types as genai_types # Needed for type conversion

# --- Flask App Setup ---
app = Flask(__name__)
app.secret_key = os.urandom(24) # Secret key for session management

# --- Initialize Clients and Servers on Startup ---
# Call the initialization functions from the initializers module
# Store the results in the global variables within chat_processor
utils.add_debug_log("App starting up...")
chat_processor.gemini_client = initializers.initialize_gemini_client()
chat_processor.mcp_servers = initializers.initialize_mcp_servers()

# Check initialization status
gemini_ok = chat_processor.gemini_client is not None
mcp_ok = bool(chat_processor.mcp_servers) # True if dict is not empty

if not gemini_ok:
    print("\n--- WARNING: Gemini client failed to initialize during app startup. ---")
    # Log already added by initializer
if not mcp_ok:
     print("\n--- WARNING: MCP servers dictionary is empty after initialization. ---")
     # Log already added by initializer


# --- Flask Routes ---

@app.route('/', methods=['GET'])
def index():
    """Renders the main chat page, retrieving history from session."""
    if 'chat_history_display' not in session: session['chat_history_display'] = []
    if 'gemini_history_internal' not in session: session['gemini_history_internal'] = []
    return render_template('index.html', chat_history=session['chat_history_display'])

@app.route('/chat', methods=['POST'])
def chat():
    """Handles user input, calls async processing, updates session history."""
    user_input = request.form.get('prompt', '').strip()
    if not user_input:
        return redirect(url_for('index'))

    # Check if clients initialization failed earlier by checking the globals in chat_processor
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

    # Convert raw dict history back to Content objects
    try:
        gemini_history_internal = [genai_types.Content.model_validate(item) for item in gemini_history_internal_raw]
    except Exception as e:
         error_trace = traceback.format_exc()
         utils.add_debug_log(f"Error deserializing history from session: {e}")
         utils.add_debug_log(f"Deserialization Traceback:\n{error_trace}")
         session['chat_history_display'] = []
         session['gemini_history_internal'] = []
         chat_history_display = [{'type': 'error', 'text': f"Error loading chat history: {e}. History reset."}]
         session['chat_history_display'] = chat_history_display
         session.modified = True
         return render_template('index.html', chat_history=chat_history_display)


    # Add user message to display history
    chat_history_display.append({'type': 'user', 'text': user_input})

    # --- Run the async logic ---
    utils.add_debug_log(f"User input received: {user_input}")
    try:
        # Call the process_prompt function from chat_processor
        final_response_text, updated_gemini_history, internal_steps = asyncio.run(
            chat_processor.process_prompt(user_input, gemini_history_internal)
        )
        utils.add_debug_log(f"Processing complete. Final text preview: {(final_response_text[:250] + '...' if len(final_response_text) > 250 else final_response_text).replace('\n', ' ')}")
    except Exception as e:
         error_trace = traceback.format_exc()
         utils.add_debug_log(f"Error running/calling process_prompt: {e}\n{error_trace}")
         final_response_text = f"Critical error during processing: {e}"
         updated_gemini_history = gemini_history_internal # Keep old history
         internal_steps = [f"Critical error: {e}"]


    # Add internal steps and final response to display history
    for step in internal_steps:
        chat_history_display.append({'type': 'internal', 'text': step})
    response_type = 'error' if final_response_text.lower().startswith("error:") else 'model'
    chat_history_display.append({'type': response_type, 'text': final_response_text})

    # --- Store updated history back in session ---
    session['chat_history_display'] = chat_history_display

    # --- Serialize history item by item ---
    serialized_history = []
    serialization_error_occurred = False
    for i, item in enumerate(updated_gemini_history):
        try:
            item_dict = item.model_dump(mode='json')
            serialized_history.append(item_dict)
        except AttributeError: # Fallback for older pydantic/sdk versions
             try:
                  utils.add_debug_log(f"AttributeError: .model_dump() not found for item #{i}. Trying .dict()...")
                  item_dict = item.dict()
                  serialized_history.append(item_dict)
             except Exception as e_dict:
                  serialization_error_occurred = True
                  error_trace = traceback.format_exc()
                  utils.add_debug_log(f"Error serializing history item #{i} (using .dict()): {e_dict}\n{error_trace}")
                  # Log item details might be helpful here too
        except Exception as e:
            serialization_error_occurred = True
            error_trace = traceback.format_exc()
            utils.add_debug_log(f"Error serializing history item #{i} to session: {e}\n{error_trace}")
            # Log item details might be helpful here too

    session['gemini_history_internal'] = serialized_history
    session.modified = True

    if serialization_error_occurred:
         session['chat_history_display'].append({'type': 'error', 'text': "Error saving full chat history state. Some history may be lost."})
         session.modified = True

    return redirect(url_for('index'))

@app.route('/reset', methods=['GET'])
def reset():
    """Clears the chat history stored in the session."""
    session.pop('chat_history_display', None)
    session.pop('gemini_history_internal', None)
    utils.add_debug_log("Chat history reset via /reset.")
    return redirect(url_for('index'))

@app.route('/debug', methods=['GET'])
def debug():
    """Displays the in-memory debug log from the utils module."""
    html = "<!DOCTYPE html><html><head><title>Debug Log</title>"
    html += "<style>body {font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 10px; font-size: 0.9em;}"
    html += "h1 { border-bottom: 1px solid #ccc; padding-bottom: 5px; } </style>"
    html += "</head><body><h1>Debug Log</h1>\n"
    # Access the log list via the utils module's getter
    html += "\n".join(utils.get_debug_logs())
    html += "</body></html>"
    return html


# --- Run Flask App ---
if __name__ == '__main__':
    # Check the flags set during initialization
    if not gemini_ok:
         print("\n--- Flask app not starting due to Gemini client initialization failure. ---")
    # Optionally add check for mcp_ok if MCP servers are essential for startup
    # elif not mcp_ok:
    #      print("\n--- Flask app not starting due to MCP server initialization failure. ---")
    else:
        print(f"\nFlask app starting. Access at http://127.0.0.1:5000")
        # Target directory is now configured in config.py
        # print(f"MCP server target directory: {config.FILESYSTEM_TARGET_DIRECTORY}")
        print(f"Ensure Node.js/npx is installed and in PATH.")
        print("Use Ctrl+C to stop the server.")
        app.run(debug=True, host='127.0.0.1', port=5000)

