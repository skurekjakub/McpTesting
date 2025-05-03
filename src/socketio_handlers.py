# -*- coding: utf-8 -*-
"""
Handles SocketIO events for the Flask application.
"""

import asyncio
import traceback
from typing import TYPE_CHECKING, List, Tuple, Optional, Any
from flask import request, session
from flask_socketio import emit
from google.genai import types as genai_types

from .logic.chat_loop import chat_processor

# Assuming chat_processor and utils are accessible or passed appropriately
from .logic import utils

# Type hinting for Flask-SocketIO and asyncio loop
if TYPE_CHECKING:
    from flask_socketio import SocketIO
    from asyncio import AbstractEventLoop

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
        emit(
            "new_message",
            {
                "type": "error",
                "text": f"Error loading chat history: {e}. History reset.",
            },
            room=sid,
        )
        session["chat_history_display"] = [
            {
                "type": "error",
                "text": f"Error loading chat history: {e}. History reset.",
            }
        ]
        session["gemini_history_internal"] = []
        session.modified = True
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


# --- SocketIO Event Handlers ---


def on_connect() -> None:
    """Handles client connection."""
    utils.add_debug_log(f"Client connected: {request.sid}")


def on_disconnect() -> None:
    """Handles client disconnection."""
    utils.add_debug_log(f"Client disconnected: {request.sid}")


def process_user_message(
    socketio_instance: "SocketIO", background_loop: "AbstractEventLoop", data: dict
) -> None:
    """Handles incoming user messages and processes the chat logic."""
    user_input = data.get("prompt", "").strip()
    client_sid = request.sid

    if not user_input:
        emit("error", {"message": "Empty prompt received."}, room=client_sid)
        return

    utils.add_debug_log(f"Received prompt from {client_sid}: '{user_input}'")
    emit("new_message", {"type": "user", "text": user_input}, room=client_sid)

    chat_history_display = session.get("chat_history_display", [])
    chat_history_display.append({"type": "user", "text": user_input})
    session["chat_history_display"] = chat_history_display
    session.modified = True

    init_error = _check_initialization(client_sid)
    if init_error:
        utils.add_debug_log(f"Initialization error for {client_sid}: {init_error}")
        emit("new_message", {"type": "error", "text": init_error}, room=client_sid)
        chat_history_display.append({"type": "error", "text": init_error})
        session["chat_history_display"] = chat_history_display
        session.modified = True
        return

    gemini_history_internal_raw = session.get("gemini_history_internal", [])
    gemini_history_internal: Optional["DeserializedHistory"] = _deserialize_history(
        gemini_history_internal_raw, client_sid
    )
    if gemini_history_internal is None:
        return

    def emit_internal_step(message: str) -> None:
        """Callback function to emit internal steps via SocketIO."""
        try:
            socketio_instance.emit(
                "new_message", {"type": "internal", "text": message}, room=client_sid
            )
        except Exception as e:
            utils.add_debug_log(f"Error emitting internal step for {client_sid}: {e}")

    async def process_chat_task() -> None:
        current_display_history = list(session.get("chat_history_display", []))

        try:
            utils.add_debug_log(
                f"Starting process_prompt for {client_sid} in background thread"
            )
            socketio_instance.emit(
                "status_update", {"message": "Processing..."}, room=client_sid
            )

            final_response_text: str
            updated_gemini_history: "DeserializedHistory"
            (
                final_response_text,
                updated_gemini_history,
            ) = await chat_processor.process_prompt(
                user_input,
                gemini_history_internal,
                internal_step_callback=emit_internal_step,
            )

            utils.add_debug_log(
                f"Processing complete for {client_sid}. Final text preview: {(final_response_text[:50] + '...').replace('\n', ' ')}"
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
            current_display_history.append(
                {"type": response_type, "text": final_response_text}
            )

            serialized_history: "SerializedHistory"
            serialization_error: bool
            serialized_history, serialization_error = _serialize_history(
                updated_gemini_history, client_sid
            )
            session["gemini_history_internal"] = serialized_history
            if serialization_error:
                socketio_instance.emit(
                    "new_message",
                    {"type": "error", "text": "Error saving full chat history state."},
                    room=client_sid,
                )
                current_display_history.append(
                    {"type": "error", "text": "Error saving full chat history state."}
                )

            session["chat_history_display"] = current_display_history
            session.modified = True
            utils.add_debug_log(
                f"Session updated for {client_sid} from background task."
            )

        except Exception as e:
            error_trace = traceback.format_exc()
            utils.add_debug_log(
                f"Critical error in process_chat_task for {client_sid}: {e}\n{error_trace}"
            )
            socketio_instance.emit(
                "new_message",
                {
                    "type": "error",
                    "text": f"Critical server error during processing: {e}",
                },
                room=client_sid,
            )
            current_display_history.append(
                {"type": "error", "text": f"Critical server error: {e}"}
            )
            session["chat_history_display"] = current_display_history
            session.modified = True
        finally:
            socketio_instance.emit(
                "status_update", {"message": "Idle"}, room=client_sid
            )

    utils.add_debug_log(
        f"Scheduling process_chat_task for {client_sid} on background loop."
    )
    asyncio.run_coroutine_threadsafe(process_chat_task(), background_loop)
