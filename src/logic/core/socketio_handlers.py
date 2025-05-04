# -*- coding: utf-8 -*-
"""
Handles SocketIO events for the Flask application.
"""

import asyncio
import traceback
from typing import TYPE_CHECKING, List, Optional
from flask import request
from flask_socketio import emit, SocketIO

# Import the new cache handler
from . import history_cache_handler

from ..chat import chat_processor
from .. import utils

# Type hinting
if TYPE_CHECKING:
    from google.genai import types as genai_types
    DeserializedHistory = List[genai_types.Content]


# --- Helper Functions ---
def _check_initialization(sid: str) -> Optional[str]:
    """Checks if essential components are initialized.

    Args:
        sid: The session ID of the client.

    Returns:
        An error message string if initialization failed, None otherwise.
    """
    if not chat_processor.gemini_client:
        return "Chat client not initialized."
    if not chat_processor.mcp_servers:
        return "Tool servers not initialized."
    return None


# --- Background Task ---
def process_chat_task(
    user_input: str,
    client_sid: str,
    initial_gemini_history: "DeserializedHistory",
    socketio_instance: SocketIO
) -> None:
    try:
        utils.add_debug_log(
            f"[{client_sid}] Starting background task thread with input: '{user_input}'"
        )
        socketio_instance.emit(
            "status_update", {"message": "Processing..."}, room=client_sid
        )

        # Define an async inner function to run the awaitable call
        async def run_async_processing():
            return await chat_processor.process_prompt(
                user_input,
                initial_gemini_history,
                internal_step_callback=lambda msg: socketio_instance.emit(
                    "new_message", {"type": "internal", "text": msg}, room=client_sid
                )
            )

        # Run the async function using asyncio.run()
        final_response_text: str
        updated_gemini_history: "DeserializedHistory"
        (
            final_response_text,
            updated_gemini_history,
        ) = asyncio.run(run_async_processing())

        utils.add_debug_log(
            f"[{client_sid}] Async processing complete. Final text preview: {(final_response_text[:50] + '...').replace('\\n', ' ')}"
        )

        response_type = (
            "error"
            if final_response_text.lower().startswith(("error:", "warning:"))
            else "model"
        )
        socketio_instance.emit(
            "new_message",
            {"type": response_type, "text": final_response_text},
            room=client_sid,
        )

        # --- Cache Update using Handler ---
        current_data = history_cache_handler.get_cached_data(client_sid)
        current_display_history = current_data.get("chat_history_display", [])

        current_display_history.append({"type": "user", "text": user_input})
        current_display_history.append(
            {"type": response_type, "text": final_response_text}
        )

        serialized_internal_history, serialization_error = history_cache_handler.serialize_history(
            updated_gemini_history, client_sid
        )

        if serialization_error:
            socketio_instance.emit(
                "new_message",
                {"type": "error", "text": "Error saving full chat history state."},
                room=client_sid,
            )
            current_display_history.append(
                {"type": "error", "text": "Error saving full chat history state."}
            )

        save_success = history_cache_handler.save_cached_data(
            client_sid,
            serialized_internal_history,
            current_display_history
        )

        if save_success:
            utils.add_debug_log(
                f"[{client_sid}] Cache update successful via handler. Saved internal history length: {len(updated_gemini_history)}. Saved display history length: {len(current_display_history)}."
            )
        else:
            utils.add_debug_log(
                f"[{client_sid}] Cache update FAILED via handler."
            )

    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(
            f"[{client_sid}] Critical error in background task: {e}\n{error_trace}"
        )
        try:
            error_data = history_cache_handler.get_cached_data(client_sid)
            error_display_history = error_data.get("chat_history_display", [])
            error_display_history.append({"type": "user", "text": user_input})
            error_message = f"Critical server error during processing: {e}"
            socketio_instance.emit(
                "new_message", {"type": "error", "text": error_message}, room=client_sid
            )
            error_display_history.append({"type": "error", "text": error_message})

            internal_hist_to_save_on_err = initial_gemini_history
            if 'updated_gemini_history' in locals():
                internal_hist_to_save_on_err = updated_gemini_history
            serialized_internal_history_err, _ = history_cache_handler.serialize_history(
                internal_hist_to_save_on_err, client_sid
            )

            history_cache_handler.save_cached_data(
                client_sid,
                serialized_internal_history_err,
                error_display_history
            )
            utils.add_debug_log(f"[{client_sid}] Updated cache during error handling via handler.")
        except Exception as cache_err:
            utils.add_debug_log(f"[{client_sid}] Failed to update cache during error handling: {cache_err}")

    finally:
        socketio_instance.emit(
            "status_update", {"message": "Idle"}, room=client_sid
        )


# --- SocketIO Event Handlers ---
def on_connect() -> None:
    """Handles client connection."""
    client_sid = request.sid
    utils.add_debug_log(f"Client connected: {client_sid}")


def on_disconnect() -> None:
    """Handles client disconnection."""
    client_sid = request.sid
    utils.add_debug_log(f"Client disconnected: {client_sid}")


def process_user_message(socketio_instance: SocketIO, data: dict) -> None:
    """Handles incoming user messages and processes the chat logic."""
    user_input = data.get("prompt", "").strip()
    client_sid = request.sid

    if not user_input:
        emit("error", {"message": "Empty prompt received."}, room=client_sid)
        return

    utils.add_debug_log(f"[{client_sid}] Received prompt: '{user_input}'")
    emit("new_message", {"type": "user", "text": user_input}, room=client_sid)

    init_error = _check_initialization(client_sid)
    if init_error:
        utils.add_debug_log(f"[{client_sid}] Initialization error: {init_error}")
        emit("new_message", {"type": "error", "text": init_error}, room=client_sid)
        try:
            error_data = history_cache_handler.get_cached_data(client_sid)
            error_display = error_data.get("chat_history_display", [])
            error_display.append({"type": "error", "text": init_error})
            history_cache_handler.save_cached_data(
                client_sid,
                error_data.get("gemini_history_internal", []),
                error_display
            )
        except Exception as cache_err:
            utils.add_debug_log(f"[{client_sid}] Failed to update cache during init error handling: {cache_err}")
        return

    cached_data = history_cache_handler.get_cached_data(client_sid)
    gemini_history_internal_raw = cached_data.get("gemini_history_internal", [])

    gemini_history_internal: Optional["DeserializedHistory"] = history_cache_handler.deserialize_history(
        gemini_history_internal_raw, client_sid
    )
    if gemini_history_internal is None:
        utils.add_debug_log(f"[{client_sid}] Deserialization failed, stopping processing.")
        try:
            emit("new_message", {"type": "error", "text": "Chat history corrupted, resetting."}, room=client_sid)
            history_cache_handler.reset_cache_for_sid(client_sid, "History corrupted, reset.")
        except Exception as cache_err:
            utils.add_debug_log(f"[{client_sid}] Failed to reset cache after deserialization failure: {cache_err}")
        return
    else:
        utils.add_debug_log(f"[{client_sid}] Loaded from cache via handler. Deserialized history length BEFORE processing: {len(gemini_history_internal)}")

    utils.add_debug_log(f"[{client_sid}] Starting background task via socketio.start_background_task.")
    socketio_instance.start_background_task(
        process_chat_task,
        user_input=user_input,
        client_sid=client_sid,
        initial_gemini_history=gemini_history_internal,
        socketio_instance=socketio_instance
    )
    utils.add_debug_log(f"[{client_sid}] Background task scheduled.")
