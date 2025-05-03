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

from ..chat import chat_processor
from .. import utils

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
    # Capture the session object for this specific request
    current_request_session = session

    if not user_input:
        emit("error", {"message": "Empty prompt received."}, room=client_sid)
        return

    utils.add_debug_log(f"Received prompt from {client_sid}: '{user_input}'")
    # Emit user message to the frontend immediately
    emit("new_message", {"type": "user", "text": user_input}, room=client_sid)

    init_error = _check_initialization(client_sid)
    # Use current_request_session when handling init error display history
    if init_error:
        utils.add_debug_log(f"Initialization error for {client_sid}: {init_error}")
        emit("new_message", {"type": "error", "text": init_error}, room=client_sid)
        # If init fails, add error to display history now
        chat_history_display = current_request_session.get("chat_history_display", [])
        chat_history_display.append({"type": "error", "text": init_error})
        current_request_session["chat_history_display"] = chat_history_display
        current_request_session.modified = True
        return

    # Load history using the captured session
    gemini_history_internal_raw = current_request_session.get("gemini_history_internal", [])
    # Pass current_request_session to deserialize helper if it needs session access (it doesn't currently, but good practice)
    gemini_history_internal: Optional["DeserializedHistory"] = _deserialize_history(
        gemini_history_internal_raw, client_sid
    )
    if gemini_history_internal is None:
        # Deserialization failed, history was reset, error emitted. Stop processing.
        utils.add_debug_log(f"[{client_sid}] Deserialization failed, stopping processing.")
        return
    else:
        utils.add_debug_log(f"[{client_sid}] Deserialized history length BEFORE processing: {len(gemini_history_internal)}")

    def emit_internal_step(message: str) -> None:
        """Callback function to emit internal steps via SocketIO."""
        try:
            socketio_instance.emit(
                "new_message", {"type": "internal", "text": message}, room=client_sid
            )
        except Exception as e:
            utils.add_debug_log(f"Error emitting internal step for {client_sid}: {e}")

    # Modify process_chat_task to accept the session object
    async def process_chat_task(req_session) -> None:
        try:
            utils.add_debug_log(
                f"Starting process_prompt for {client_sid} with input: '{user_input}'"
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
                user_input,  # Pass user_input from outer scope
                gemini_history_internal,  # Pass deserialized history
                internal_step_callback=emit_internal_step,
            )

            utils.add_debug_log(
                f"Processing complete for {client_sid}. Final text preview: {(final_response_text[:50] + '...').replace('\\n', ' ')}"
            )

            response_type = (
                "error"
                if final_response_text.lower().startswith(("error:", "warning:"))
                else "model"
            )
            # Emit model response to frontend
            socketio_instance.emit(
                "new_message",
                {"type": response_type, "text": final_response_text},
                room=client_sid,
            )

            # --- Session Update ---
            # Use the passed req_session object for all session operations
            current_display_history = list(req_session.get("chat_history_display", []))
            # Append the user message for THIS turn
            current_display_history.append({"type": "user", "text": user_input})
            # Append the model response for THIS turn
            current_display_history.append(
                {"type": response_type, "text": final_response_text}
            )

            serialized_internal_history: "SerializedHistory"
            serialization_error: bool
            serialized_internal_history, serialization_error = _serialize_history(
                updated_gemini_history, client_sid  # Use the history returned by process_prompt
            )
            req_session["gemini_history_internal"] = serialized_internal_history

            if serialization_error:
                # Emit error to user if internal history saving failed
                socketio_instance.emit(
                    "new_message",
                    {"type": "error", "text": "Error saving full chat history state."},
                    room=client_sid,
                )
                # Also append error to display history if serialization failed
                current_display_history.append(
                    {"type": "error", "text": "Error saving full chat history state."}
                )

            # Save the updated display history (now includes user + model/error)
            req_session["chat_history_display"] = current_display_history
            req_session.modified = True  # Mark session as modified AFTER all updates
            utils.add_debug_log(
                f"[{client_sid}] Session update complete. Saved internal history length: {len(updated_gemini_history)}. Saved display history length: {len(current_display_history)}."
            )

        except Exception as e:
            error_trace = traceback.format_exc()
            utils.add_debug_log(
                f"Critical error in process_chat_task for {client_sid}: {e}\n{error_trace}"
            )
            # Use req_session for error handling updates
            current_display_history_on_error = list(req_session.get("chat_history_display", []))
            # Append user message for this turn even on error
            current_display_history_on_error.append({"type": "user", "text": user_input})
            # Emit and append the critical error message
            error_message = f"Critical server error during processing: {e}"
            socketio_instance.emit(
                "new_message",
                {"type": "error", "text": error_message},
                room=client_sid,
            )
            current_display_history_on_error.append(
                {"type": "error", "text": error_message}  # Use the actual error message
            )
            req_session["chat_history_display"] = current_display_history_on_error
            # Also try to save the potentially partial internal history if available before error
            if 'updated_gemini_history' in locals():
                utils.add_debug_log(f"[{client_sid}] Error occurred. Internal history length before potential save: {len(updated_gemini_history)}")
                serialized_internal_history_err, _ = _serialize_history(updated_gemini_history, client_sid)
                req_session["gemini_history_internal"] = serialized_internal_history_err
            else:
                utils.add_debug_log(f"[{client_sid}] Error occurred before internal history was updated.")

            req_session.modified = True
        finally:
            # Ensure status is updated regardless of success or failure
            socketio_instance.emit(
                "status_update", {"message": "Idle"}, room=client_sid
            )

    utils.add_debug_log(
        f"Scheduling process_chat_task for {client_sid} on background loop."
    )
    # Pass the captured session object to the background task
    asyncio.run_coroutine_threadsafe(process_chat_task(current_request_session), background_loop)
