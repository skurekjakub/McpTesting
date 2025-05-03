# -*- coding: utf-8 -*-
"""
Flask application factory for the MCP Filesystem Chatbot.
Handles routing, session management, and interacts with chat_processor.
Uses Flask-SocketIO for asynchronous chat communication.
Runs asyncio tasks in a separate thread.
"""
import asyncio
import os
import sys
import traceback
import json
from typing import List
import threading

from flask import Flask, request, render_template, redirect, url_for, session
from flask_socketio import SocketIO, emit
from flask_session import Session
from google.genai import types as genai_types

from .logic import chat_processor
from .logic import initializers
from .logic import utils
from config import app_config

gemini_client_global = None
mcp_servers_global = None
summarizer_client_global = None

socketio = SocketIO(manage_session=False, async_mode='threading')

background_asyncio_loop = asyncio.new_event_loop()

def run_background_loop():
    """Runs the dedicated asyncio event loop in a background thread."""
    utils.add_debug_log("Starting background asyncio event loop...")
    asyncio.set_event_loop(background_asyncio_loop)
    try:
        background_asyncio_loop.run_forever()
    finally:
        background_asyncio_loop.close()
        utils.add_debug_log("Background asyncio event loop stopped.")

background_thread = threading.Thread(target=run_background_loop, daemon=True)
background_thread.start()

def create_app(config_object=app_config):
    """Application Factory Function"""
    app = Flask(__name__, template_folder='templates', static_folder='static')
    app.config.from_object(config_object)
    Session(app)
    socketio.init_app(app)

    global gemini_client_global, mcp_servers_global, summarizer_client_global
    utils.add_debug_log("App factory starting...")
    gemini_client_global = initializers.initialize_gemini_client()
    mcp_servers_global = initializers.initialize_mcp_servers()
    summarizer_client_global = initializers.initialize_gemini_client()
    chat_processor.gemini_client = gemini_client_global
    chat_processor.mcp_servers = mcp_servers_global
    chat_processor.summarizer_client = summarizer_client_global

    gemini_ok = gemini_client_global is not None
    summarizer_ok = summarizer_client_global is not None
    mcp_ok = bool(mcp_servers_global)
    if not gemini_ok: print("\n--- WARNING: Gemini client failed to initialize. ---")
    if not summarizer_ok: print("\n--- WARNING: Summarizer client failed to initialize. ---")
    if not mcp_ok: print("\n--- WARNING: MCP servers dictionary is empty. ---")

    with app.app_context():
        @app.route('/', methods=['GET'])
        def index():
            if 'chat_history_display' not in session: session['chat_history_display'] = []
            if 'gemini_history_internal' not in session: session['gemini_history_internal'] = []
            return render_template('index.html', chat_history=session.get('chat_history_display', []))

        @app.route('/reset', methods=['GET'])
        def reset():
            session.pop('chat_history_display', None)
            session.pop('gemini_history_internal', None)
            session.modified = True
            utils.add_debug_log("Chat history reset via /reset.")
            socketio.emit('history_reset', room=request.sid)
            return redirect(url_for('index'))

        @app.route('/debug', methods=['GET'])
        def debug():
            html = "<!DOCTYPE html><html><head><title>Debug Log</title>"
            html += "<style>body {font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 10px; font-size: 0.9em;}"
            html += "h1 { border-bottom: 1px solid #ccc; padding-bottom: 5px; } </style>"
            html += "</head><body><h1>Debug Log</h1>\n"
            html += "\n".join(utils.get_debug_logs())
            html += "</body></html>"
            return html

    @socketio.on('connect')
    def handle_connect():
        utils.add_debug_log(f"Client connected: {request.sid}")

    @socketio.on('disconnect')
    def handle_disconnect():
        utils.add_debug_log(f"Client disconnected: {request.sid}")

    @socketio.on('send_message')
    def handle_send_message(data):
        user_input = data.get('prompt', '').strip()
        if not user_input:
            emit('error', {'message': 'Empty prompt received.'}, room=request.sid)
            return

        utils.add_debug_log(f"Received prompt from {request.sid}: '{user_input}'")
        emit('new_message', {'type': 'user', 'text': user_input}, room=request.sid)

        chat_history_display = session.get('chat_history_display', [])
        gemini_history_internal_raw = session.get('gemini_history_internal', [])
        chat_history_display.append({'type': 'user', 'text': user_input})
        session['chat_history_display'] = chat_history_display
        session.modified = True

        display_history_error = None
        if not chat_processor.gemini_client: display_history_error = "Chat client not initialized."
        elif not chat_processor.mcp_servers: display_history_error = "Tool servers not initialized."
        if display_history_error:
            utils.add_debug_log(f"Initialization error for {request.sid}: {display_history_error}")
            emit('new_message', {'type': 'error', 'text': display_history_error}, room=request.sid)
            chat_history_display.append({'type': 'error', 'text': display_history_error})
            session['chat_history_display'] = chat_history_display
            session.modified = True
            return

        try:
            gemini_history_internal = [genai_types.Content.model_validate(item) for item in gemini_history_internal_raw]
        except Exception as e:
            error_trace = traceback.format_exc()
            utils.add_debug_log(f"Error deserializing history from session for {request.sid}: {e}\n{error_trace}")
            emit('new_message', {'type': 'error', 'text': f"Error loading chat history: {e}. History reset."}, room=request.sid)
            session['chat_history_display'] = [{'type': 'error', 'text': f"Error loading chat history: {e}. History reset."}]
            session['gemini_history_internal'] = []
            session.modified = True
            return

        client_sid = request.sid

        def emit_internal_step(message: str):
            """Callback function to emit internal steps via SocketIO."""
            try:
                socketio.emit('new_message', {'type': 'internal', 'text': message}, room=client_sid)
            except Exception as e:
                utils.add_debug_log(f"Error emitting internal step for {client_sid}: {e}")

        async def process_chat_task():
            current_display_history = list(session.get('chat_history_display', []))

            try:
                utils.add_debug_log(f"Starting process_prompt for {client_sid} in background thread")
                socketio.emit('status_update', {'message': 'Processing...'}, room=client_sid)

                final_response_text, updated_gemini_history = await chat_processor.process_prompt(
                    user_input,
                    gemini_history_internal,
                    internal_step_callback=emit_internal_step
                )

                utils.add_debug_log(f"Processing complete for {client_sid}. Final text preview: {(final_response_text[:50] + '...').replace('\n', ' ')}")

                response_type = 'error' if final_response_text.lower().startswith(("error:", "warning:")) else 'model'
                socketio.emit('new_message', {'type': response_type, 'text': final_response_text}, room=client_sid)
                current_display_history.append({'type': response_type, 'text': final_response_text})

                serialized_history = []
                serialization_error_occurred = False
                for i, item in enumerate(updated_gemini_history):
                    try:
                        item_dict = item.model_dump(mode='json')
                        serialized_history.append(item_dict)
                    except Exception as e_ser:
                        serialization_error_occurred = True
                        error_trace = traceback.format_exc()
                        utils.add_debug_log(f"Error serializing history item #{i} for {client_sid}: {e_ser}\n{error_trace}")

                session['gemini_history_internal'] = serialized_history
                if serialization_error_occurred:
                    socketio.emit('new_message', {'type': 'error', 'text': "Error saving full chat history state."}, room=client_sid)
                    current_display_history.append({'type': 'error', 'text': "Error saving full chat history state."})

                session['chat_history_display'] = current_display_history
                session.modified = True
                utils.add_debug_log(f"Session updated for {client_sid} from background task.")

            except Exception as e:
                error_trace = traceback.format_exc()
                utils.add_debug_log(f"Critical error in process_chat_task for {client_sid}: {e}\n{error_trace}")
                socketio.emit('new_message', {'type': 'error', 'text': f"Critical server error during processing: {e}"}, room=client_sid)
                current_display_history.append({'type': 'error', 'text': f"Critical server error: {e}"})
                session['chat_history_display'] = current_display_history
                session.modified = True
            finally:
                socketio.emit('status_update', {'message': 'Idle'}, room=client_sid)

        utils.add_debug_log(f"Scheduling process_chat_task for {client_sid} on background loop.")
        asyncio.run_coroutine_threadsafe(process_chat_task(), background_asyncio_loop)

    return app
