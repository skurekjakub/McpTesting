# -*- coding: utf-8 -*-
"""
Handles SocketIO events for the Flask application.
"""

import traceback
import asyncio
from typing import TYPE_CHECKING, List, Tuple, Optional, Any
from flask import request
from flask_socketio import emit, SocketIO
from cachelib.file import FileSystemCache
from google.genai import types as genai_types
from ..chat import chat_processor
from .. import utils

# --- Cache Setup ---
# Use a separate directory for this cache
# threshold: max number of items before cleanup (0 = unlimited)
# default_timeout: 0 = never expire
history_cache = FileSystemCache('.chat_history_cache', threshold=1000, default_timeout=0)
utils.add_debug_log("Initialized FileSystemCache for chat history at .chat_history_cache")

# Type hinting for Flask-SocketIO and asyncio loop
if TYPE_CHECKING:
    from google.genai import types as genai_types
    # Define a type alias for deserialized history for clarity
    DeserializedHistory = List[genai_types.Content]
    # Define a type alias for serialized history
    SerializedHistory = List[dict[str, Any]]

# --- Helper Functions (Moved from app.py) ---


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


def _deserialize_history(
    session_data: List[dict], sid: str
) -> Optional["DeserializedHistory"]:
    """Deserializes Gemini history from session data.

    Args:
        session_data: Raw history data (list of dicts) from the session.
        sid: The session ID of the client.

    Returns:
        A list of genai_types.Content objects, or None if deserialization fails.
    """
    try:
        history: "DeserializedHistory" = [
            genai_types.Content.model_validate(item) for item in session_data
        ]
        return history
    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(
            f"Error deserializing history from session for {sid}: {e}\n{error_trace}"
        )
        return None


def _serialize_history(
    history: "DeserializedHistory", sid: str
) -> Tuple["SerializedHistory", bool]:
    """Serializes Gemini history for session storage.

    Args:
        history: The list of genai_types.Content objects.
        sid: The session ID of the client.

    Returns:
        A tuple containing:
            - The serialized history (list of dicts).
            - A boolean indicating if a serialization error occurred.
    """
    serialized_history: "SerializedHistory" = []
    serialization_error_occurred = False
    for i, item in enumerate(history):
        try:
            item_dict = item.model_dump(mode="json")
            serialized_history.append(item_dict)
        except Exception as e_ser:
            serialization_error_occurred = True
            error_trace = traceback.format_exc()
            utils.add_debug_log(
                f"Error serializing history item #{i} for {sid}: {e_ser}\n{error_trace}"
            )

    if serialization_error_occurred:
        utils.add_debug_log(
            f"Serialization error occurred for {sid}, message not emitted directly from here."
        )
    return serialized_history, serialization_error_occurred


# --- Background Task ---
# Change from async def to def
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

        # --- Cache Update ---
        current_data = history_cache.get(client_sid) or {
            "gemini_history_internal": [],
            "chat_history_display": []
        }
        current_display_history = current_data.get("chat_history_display", [])
        if not isinstance(current_display_history, list):
            utils.add_debug_log(f"[{client_sid}] Warning: chat_history_display from cache was not a list, resetting.")
            current_display_history = []

        current_display_history.append({"type": "user", "text": user_input})
        current_display_history.append(
            {"type": response_type, "text": final_response_text}
        )

        serialized_internal_history: "SerializedHistory"
        serialization_error: bool
        serialized_internal_history, serialization_error = _serialize_history(
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

        data_to_save = {
            "gemini_history_internal": serialized_internal_history,
            "chat_history_display": current_display_history
        }

        history_cache.set(client_sid, data_to_save)
        utils.add_debug_log(
            f"[{client_sid}] Cache update complete. Saved internal history length: {len(updated_gemini_history)}. Saved display history length: {len(current_display_history)}."
        )

    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(
            f"[{client_sid}] Critical error in background task: {e}\n{error_trace}"
        )
        try:
            error_data = history_cache.get(client_sid) or {
                "gemini_history_internal": [],
                "chat_history_display": []
            }
            error_display_history = error_data.get("chat_history_display", [])
            if not isinstance(error_display_history, list):
                error_display_history = []
            error_display_history.append({"type": "user", "text": user_input})
            error_message = f"Critical server error during processing: {e}"
            socketio_instance.emit(
                "new_message", {"type": "error", "text": error_message}, room=client_sid
            )
            error_display_history.append({"type": "error", "text": error_message})

            internal_hist_to_save_on_err = initial_gemini_history
            if 'updated_gemini_history' in locals():
                internal_hist_to_save_on_err = updated_gemini_history
            serialized_internal_history_err, _ = _serialize_history(internal_hist_to_save_on_err, client_sid)

            error_data_to_save = {
                "gemini_history_internal": serialized_internal_history_err,
                "chat_history_display": error_display_history
            }
            history_cache.set(client_sid, error_data_to_save)
            utils.add_debug_log(f"[{client_sid}] Updated cache during error handling.")
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
            error_data = history_cache.get(client_sid) or {"chat_history_display": []}
            error_display = error_data.get("chat_history_display", [])
            if not isinstance(error_display, list):
                error_display = []
            error_display.append({"type": "error", "text": init_error})
            error_data["chat_history_display"] = error_display
            history_cache.set(client_sid, error_data)
        except Exception as cache_err:
            utils.add_debug_log(f"[{client_sid}] Failed to update cache during init error handling: {cache_err}")
        return

    cached_data = history_cache.get(client_sid) or {
        "gemini_history_internal": [],
        "chat_history_display": []
    }
    gemini_history_internal_raw = cached_data.get("gemini_history_internal", [])

    gemini_history_internal: Optional["DeserializedHistory"] = _deserialize_history(
        gemini_history_internal_raw, client_sid
    )
    if gemini_history_internal is None:
        utils.add_debug_log(f"[{client_sid}] Deserialization failed, stopping processing.")
        try:
            emit("new_message", {"type": "error", "text": "Chat history corrupted, resetting."}, room=client_sid)
            history_cache.set(client_sid, {"gemini_history_internal": [], "chat_history_display": [{"type": "error", "text": "History corrupted, reset."}]})
            utils.add_debug_log(f"[{client_sid}] Reset cache due to deserialization failure.")
        except Exception as cache_err:
            utils.add_debug_log(f"[{client_sid}] Failed to reset cache after deserialization failure: {cache_err}")
        return
    else:
        utils.add_debug_log(f"[{client_sid}] Loaded from cache. Deserialized history length BEFORE processing: {len(gemini_history_internal)}")

    utils.add_debug_log(f"[{client_sid}] Starting background task via socketio.start_background_task.")
    socketio_instance.start_background_task(
        process_chat_task,
        user_input=user_input,
        client_sid=client_sid,
        initial_gemini_history=gemini_history_internal,
        socketio_instance=socketio_instance
    )
    utils.add_debug_log(f"[{client_sid}] Background task scheduled.")
