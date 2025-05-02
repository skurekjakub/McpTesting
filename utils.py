# -*- coding: utf-8 -*-
"""
Shared utility functions and constants for the MCP Chat application,
primarily focused on logging.
"""
from datetime import datetime
from typing import List

# --- Logging Configuration ---
MAX_DEBUG_LOG_SIZE = 1500
log_preview_len = 250 # Preview length for logs

# --- Global State (Module Level) ---
# In-memory debug log (shared across modules that import this)
debug_log: List[str] = []

# --- Logging Functions ---
def add_debug_log(message: str):
    """Adds a timestamped message to the shared in-memory debug log."""
    global debug_log
    try:
        log_entry = f"{datetime.now().isoformat()} - {str(message)}"
        debug_log.append(log_entry)
        # Trim old messages if log gets too large
        while len(debug_log) > MAX_DEBUG_LOG_SIZE:
            debug_log.pop(0)
    except Exception as e:
        # Avoid crashing the logger itself
        print(f"Error adding to debug log: {e}")

def get_debug_logs() -> List[str]:
    """Returns a copy of the current debug logs, newest first."""
    global debug_log
    # Return logs in reverse chronological order for display
    return list(reversed(debug_log))

