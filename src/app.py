# -*- coding: utf-8 -*-
"""
Flask application factory for the MCP Filesystem Chatbot.
Handles routing, session management, and interacts with chat_processor.
Uses Flask-SocketIO for asynchronous chat communication.
Runs asyncio tasks in a separate thread.
"""
import asyncio
import threading
from typing import Optional, Any

from flask import Flask, request, render_template, redirect, url_for, session, Response
from flask_socketio import SocketIO
from flask_session import Session

from .logic.chat_loop import chat_processor
from .logic import initializers
from .logic import utils
from config import app_config

from . import socketio_handlers

gemini_client_global: Optional[Any] = None
mcp_servers_global: Optional[dict] = None
summarizer_client_global: Optional[Any] = None

socketio = SocketIO(manage_session=False, async_mode='threading')

background_asyncio_loop = asyncio.new_event_loop()

def run_background_loop() -> None:
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

def create_app(config_object: Any = app_config) -> Flask:
    """Application Factory Function

    Args:
        config_object: The configuration object for the Flask app.

    Returns:
        The configured Flask application instance.
    """
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
        def index() -> str:
            if 'chat_history_display' not in session: session['chat_history_display'] = []
            if 'gemini_history_internal' not in session: session['gemini_history_internal'] = []
            return render_template('index.html', chat_history=session.get('chat_history_display', []))

        @app.route('/reset', methods=['GET'])
        def reset() -> Response:
            session.pop('chat_history_display', None)
            session.pop('gemini_history_internal', None)
            session.modified = True
            utils.add_debug_log("Chat history reset via /reset.")
            socketio.emit('history_reset', room=request.sid)
            return redirect(url_for('index'))

        @app.route('/debug', methods=['GET'])
        def debug() -> str:
            html = "<!DOCTYPE html><html><head><title>Debug Log</title>"
            html += "<style>body {font-family: monospace; white-space: pre-wrap; word-wrap: break-word; padding: 10px; font-size: 0.9em;}"
            html += "h1 { border-bottom: 1px solid #ccc; padding-bottom: 5px; } </style>"
            html += "</head><body><h1>Debug Log</h1>\n"
            html += "\n".join(utils.get_debug_logs())
            html += "</body></html>"
            return html

    socketio.on('connect')(socketio_handlers.on_connect)
    socketio.on('disconnect')(socketio_handlers.on_disconnect)

    def send_message_wrapper(data):
        socketio_handlers.process_user_message(
            socketio_instance=socketio,
            background_loop=background_asyncio_loop,
            data=data
        )

    socketio.on('send_message')(send_message_wrapper)

    return app
