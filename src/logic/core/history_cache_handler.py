# -*- coding: utf-8 -*-
"""
Handles interaction with the FileSystemCache for storing chat history.
"""

import traceback
from typing import TYPE_CHECKING, List, Tuple, Optional, Any, Dict
from cachelib.file import FileSystemCache
# Import genai_types here if needed for TYPE_CHECKING, otherwise rely on caller
# from google.genai import types as genai_types

# Assuming utils is in the parent directory relative to core
from .. import utils

# --- Cache Setup ---
CACHE_DIR = '.chat_history_cache'
history_cache = FileSystemCache(CACHE_DIR, threshold=1000, default_timeout=0)
utils.add_debug_log(f"Initialized FileSystemCache for chat history at {CACHE_DIR}")

# Type hinting
if TYPE_CHECKING:
    # Import genai_types specifically for type hints if needed
    from google.genai import types as genai_types
    DeserializedHistory = List[genai_types.Content]
    SerializedHistory = List[Dict[str, Any]]
    DisplayHistoryItem = Dict[str, str] # e.g., {"type": "user", "text": "..."}
    DisplayHistory = List[DisplayHistoryItem]
    CachedData = Dict[str, Any] # {"gemini_history_internal": ..., "chat_history_display": ...}

# --- Serialization/Deserialization Helpers ---

def deserialize_history(
    serialized_data: "SerializedHistory", sid: str
) -> Optional["DeserializedHistory"]:
    """Deserializes Gemini history from cached data."""
    try:
        # Import genai_types locally within the function if needed
        from google.genai import types as genai_types_local
        history: "DeserializedHistory" = [
            genai_types_local.Content.model_validate(item) for item in serialized_data
        ]
        return history
    except Exception as e:
        error_trace = traceback.format_exc()
        utils.add_debug_log(
            f"Error deserializing history from cache for {sid}: {e}\n{error_trace}"
        )
        return None # Indicate failure

def serialize_history(
    history: "DeserializedHistory", sid: str
) -> Tuple["SerializedHistory", bool]:
    """Serializes Gemini history for cache storage."""
    serialized_history: "SerializedHistory" = []
    serialization_error_occurred = False
    for i, item in enumerate(history):
        try:
            # Assuming 'history' elements have model_dump method (like Pydantic models)
            item_dict = item.model_dump(mode="json")
            serialized_history.append(item_dict)
        except Exception as e_ser:
            serialization_error_occurred = True
            error_trace = traceback.format_exc()
            utils.add_debug_log(
                f"Error serializing history item #{i} for {sid}: {e_ser}\n{error_trace}"
            )
            # Don't add error message here, just flag it
    return serialized_history, serialization_error_occurred

# --- Cache Interaction Functions ---

def get_cached_data(sid: str) -> "CachedData":
    """Retrieves the data bundle (internal & display history) for a given SID."""
    try:
        cached_data = history_cache.get(sid)
        if cached_data and isinstance(cached_data, dict):
            # Ensure both keys exist, defaulting to empty lists
            if "gemini_history_internal" not in cached_data:
                cached_data["gemini_history_internal"] = []
            if "chat_history_display" not in cached_data:
                cached_data["chat_history_display"] = []
            # Ensure display history is a list
            if not isinstance(cached_data.get("chat_history_display"), list):
                 utils.add_debug_log(f"[{sid}] Warning: chat_history_display from cache was not a list, resetting.")
                 cached_data["chat_history_display"] = []
            return cached_data
        else:
            # Return default structure if not found or invalid type
            utils.add_debug_log(f"[{sid}] No valid cache data found, returning default structure.")
            return {"gemini_history_internal": [], "chat_history_display": []}
    except Exception as e:
        utils.add_debug_log(f"[{sid}] Error getting data from cache: {e}\n{traceback.format_exc()}")
        return {"gemini_history_internal": [], "chat_history_display": []}


def save_cached_data(
    sid: str,
    internal_history_serialized: "SerializedHistory",
    display_history: "DisplayHistory"
    ) -> bool:
    """Saves the data bundle for a given SID."""
    try:
        data_to_save: "CachedData" = {
            "gemini_history_internal": internal_history_serialized,
            "chat_history_display": display_history
        }
        history_cache.set(sid, data_to_save)
        return True
    except Exception as e:
        utils.add_debug_log(f"[{sid}] Failed to save data to cache: {e}\n{traceback.format_exc()}")
        return False

def reset_cache_for_sid(sid: str, error_message: Optional[str] = None) -> None:
    """Resets the cache entry for a given SID, optionally adding an error message."""
    try:
        display_hist = []
        if error_message:
            display_hist.append({"type": "error", "text": error_message})
        data_to_save: "CachedData" = {
            "gemini_history_internal": [],
            "chat_history_display": display_hist
        }
        history_cache.set(sid, data_to_save)
        utils.add_debug_log(f"[{sid}] Reset cache entry.")
    except Exception as e:
        utils.add_debug_log(f"[{sid}] Failed to reset cache entry: {e}\n{traceback.format_exc()}")

def delete_cache_for_sid(sid: str) -> None:
    """Deletes the cache entry for a given SID."""
    try:
        history_cache.delete(sid)
        utils.add_debug_log(f"[{sid}] Deleted cache entry.")
    except Exception as e:
        utils.add_debug_log(f"[{sid}] Failed to delete cache entry: {e}\n{traceback.format_exc()}")
