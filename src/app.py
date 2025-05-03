# -*- coding: utf-8 -*-
"""
Flask application factory for the MCP Filesystem Chatbot.
Handles routing, session management, and interacts with chat_processor.
"""
import asyncio
import os
import sys
import traceback
import json
from typing import List

from flask import Flask, request, render_template, redirect, url_for, session
from flask_session import Session
from google.genai import types as genai_types

# --- Use relative imports within the 'src' package ---
from .logic import chat_processor # Main logic orchestrator
from .logic import initializers   # Initialization functions
from .logic import utils          # Logging utilities
from config import app_config      # Import the application config

# --- Global variables for initialized clients (consider alternatives for scalability) ---
# These are initialized within create_app but accessed by routes.
# Be mindful of concurrency issues if not using request context properly.
# A better approach might involve Flask's application context (g) or dependency injection.
gemini_client_global = None
mcp_servers_global = None
summarizer_client_global = None

def create_app(config_object=app_config):
    """Application Factory Function"""
    app = Flask(__name__, template_folder='templates', static_folder='static') # Define template/static folders relative to src
    app.config.from_object(config_object)

    # Initialize Flask-Session
    Session(app)

    # --- Initialize Clients and Servers on Startup ---
    # Use global variables declared outside the factory function
    global gemini_client_global, mcp_servers_global, summarizer_client_global

    utils.add_debug_log("App factory starting...")
    gemini_client_global = initializers.initialize_gemini_client()
    mcp_servers_global = initializers.initialize_mcp_servers()
    summarizer_client_global = initializers.initialize_gemini_client() # Assuming same init for summarizer

    # Store in chat_processor module (or pass explicitly to functions)
    # This approach of setting module-level variables from app factory can be debated.
    # Passing clients explicitly or using Flask's 'g' object might be cleaner.
    chat_processor.gemini_client = gemini_client_global
    chat_processor.mcp_servers = mcp_servers_global
    chat_processor.summarizer_client = summarizer_client_global

    # Check initialization status
    gemini_ok = gemini_client_global is not None
    summarizer_ok = summarizer_client_global is not None
    mcp_ok = bool(mcp_servers_global)

    if not gemini_ok:
        print("\n--- WARNING: Gemini client failed to initialize during app startup. ---")
    if not summarizer_ok:
        print("\n--- WARNING: Summarizer client failed to initialize during app startup. ---")
    if not mcp_ok:
        print("\n--- WARNING: MCP servers dictionary is empty after initialization. ---")

    # --- Register Blueprints or Routes ---
    with app.app_context():
        # --- Flask Routes ---

        @app.route('/', methods=['GET'])
        def index():
            """Renders the main chat page, retrieving history from session."""
            if 'chat_history_display' not in session: session['chat_history_display'] = []
            if 'gemini_history_internal' not in session: session['gemini_history_internal'] = []
            return render_template('index.html', chat_history=session.get('chat_history_display', []))

        @app.route('/chat', methods=['POST'])
        def chat():
            """Handles user input, calls async processing, updates session history."""
            user_input = request.form.get('prompt', '').strip()
            if not user_input:
                return redirect(url_for('index'))

            # Access initialized clients (using the module variables for now)
            display_history_error = None
            if not chat_processor.gemini_client:
                display_history_error = "Chat client is not initialized. Cannot process request."
            elif not chat_processor.mcp_servers:
                display_history_error = "Tool servers are not initialized. Tool usage may fail."

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
                except AttributeError:
                    try:
                        utils.add_debug_log(f"AttributeError: .model_dump() not found for item #{i}. Trying .dict()...")
                        item_dict = item.dict()
                        serialized_history.append(item_dict)
                    except Exception as e_dict:
                        serialization_error_occurred = True
                        error_trace = traceback.format_exc()
                        utils.add_debug_log(f"Error serializing history item #{i} (using .dict()): {e_dict}\n{error_trace}")
                except Exception as e:
                    serialization_error_occurred = True
                    error_trace = traceback.format_exc()
                    utils.add_debug_log(f"Error serializing history item #{i} to session: {e}\n{error_trace}")

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
            session.modified = True
            utils.add_debug_log("Chat history reset via /reset.")
            return redirect(url_for('index'))

        @app.route('/debug', methods=['GET'])
        def debug():
            """Displays the in-memory debug log from the utils module."""
            html = "<!DOCTYPE html><html><head><title>Debug Log</title>"
            html += "<style>body {font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 10px; font-size: 0.9em;}"
            html += "h1 { border-bottom: 1px solid #ccc; padding-bottom: 5px; } </style>"
            html += "</head><body><h1>Debug Log</h1>\n"
            html += "\n".join(utils.get_debug_logs()) # Access via utils module
            html += "</body></html>"
            return html

    return app

# --- Remove the if __name__ == '__main__': block ---
# The app is now run via run.py
