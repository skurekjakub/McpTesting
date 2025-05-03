# -*- coding: utf-8 -*-
"""
Configuration constants for the MCP Chat application.
Loads settings from config.json and environment variables.
"""

import os
import json
from typing import List

# --- Default Values (used if not found in JSON or ENV) ---
# Default is now an empty list, forcing user to configure
DEFAULT_FILESYSTEM_TARGET_DIRECTORIES: List[str] = []
DEFAULT_ENABLE_MEMORY_SERVER = False  # Default to disabled
DEFAULT_GEMINI_MODEL_FALLBACK = "gemini-1.5-flash"
DEFAULT_GENERATION_MODEL_FALLBACK = "gemini-1.5-flash"
DEFAULT_SUMMARIZATION_MODEL_FALLBACK = (
    "gemini-1.5-flash"  # Default to the same as generation model
)
DEFAULT_MAX_DEBUG_LOG_SIZE = 1500
DEFAULT_LOG_PREVIEW_LEN = 250
CONFIG_FILENAME = "config.json"
BOT_CONFIG_DIR = "bot_config"

# --- Load Configuration from JSON ---
config_data = {}
config_load_error = None
# Construct the path to config.json inside the bot_config directory at the project root
project_root = os.path.dirname(
    os.path.dirname(os.path.dirname(__file__))
)  # Go up two levels from src/logic
config_file_path = os.path.join(project_root, BOT_CONFIG_DIR, CONFIG_FILENAME)

try:
    print(f"Attempting to load configuration from: {config_file_path}")
    with open(config_file_path, "r") as f:
        config_data = json.load(f)
    print(f"Successfully loaded configuration from {CONFIG_FILENAME}")
except FileNotFoundError:
    config_load_error = f"WARNING: {CONFIG_FILENAME} not found at {config_file_path}. Using environment variables and defaults."
    print(config_load_error)
except json.JSONDecodeError as e:
    config_load_error = f"ERROR: Could not parse {CONFIG_FILENAME}: {e}. Using environment variables and defaults."
    print(config_load_error)
except Exception as e:
    config_load_error = f"ERROR: Unexpected error loading {CONFIG_FILENAME}: {e}. Using environment variables and defaults."
    print(config_load_error)

# --- Set Configuration Variables ---

# Priority: Environment Variable > config.json > Default (for sensitive keys like API key)
GEMINI_API_KEY = os.getenv(
    "GEMINI_API_KEY",  # Check environment variable first
    config_data.get("gemini_api_key", None),  # Fallback to value from config.json
)

# Priority: config.json > Default (for non-sensitive settings)
# Load the list of directories
FILESYSTEM_TARGET_DIRECTORIES: List[str] = config_data.get(
    "filesystem_target_directories",  # Get list from config.json
    DEFAULT_FILESYSTEM_TARGET_DIRECTORIES,  # Fallback to default empty list
)

# Load the memory server enable flag
ENABLE_MEMORY_SERVER: bool = config_data.get(
    "enable_memory_server",  # Get from config.json
    DEFAULT_ENABLE_MEMORY_SERVER,  # Fallback to default (False)
)

DEFAULT_GEMINI_MODEL = config_data.get(
    "default_gemini_model",  # Get from config.json
    DEFAULT_GEMINI_MODEL_FALLBACK,  # Fallback to default
)
GENERATION_GEMINI_MODEL = config_data.get(
    "generation_gemini_model",  # Get from config.json
    DEFAULT_GENERATION_MODEL_FALLBACK,  # Fallback to default
)
MAX_DEBUG_LOG_SIZE = config_data.get(
    "max_debug_log_size",  # Get from config.json
    DEFAULT_MAX_DEBUG_LOG_SIZE,  # Fallback to default
)
LOG_PREVIEW_LEN = config_data.get(
    "log_preview_len",  # Get from config.json
    DEFAULT_LOG_PREVIEW_LEN,  # Fallback to default
)
SUMMARIZATION_MODEL_NAME = config_data.get(
    "summarization_gemini_model",  # Get from config.json
    DEFAULT_SUMMARIZATION_MODEL_FALLBACK,  # Fallback to default
)


# --- Configuration Validation ---
def validate_config():
    """Validates loaded configuration values."""
    valid = True
    print("Validating configuration...")

    # API Key Check
    if not GEMINI_API_KEY:
        print(
            "ERROR: Gemini API Key is missing. Set GEMINI_API_KEY environment variable or 'gemini_api_key' in config.json."
        )
        valid = False
    elif "YOUR_GEMINI_API_KEY" in GEMINI_API_KEY:  # Check for placeholder
        print("ERROR: Gemini API Key is using a placeholder value. Please replace it.")
        valid = False
    else:
        print("  Gemini API Key: Loaded (source: ENV or config.json)")

    # Filesystem Paths Check
    if not isinstance(FILESYSTEM_TARGET_DIRECTORIES, list):
        print(
            f"ERROR: 'filesystem_target_directories' in {CONFIG_FILENAME} must be a list of strings."
        )
        valid = False
    elif not FILESYSTEM_TARGET_DIRECTORIES:  # Check if list is empty
        print(
            f"WARNING: 'filesystem_target_directories' is empty in {CONFIG_FILENAME}. Filesystem server tools will not be available."
        )
        # Don't mark as invalid, just warn, as memory server might still be used
        # valid = False
    else:
        print(
            f"  Filesystem Target Directories ({len(FILESYSTEM_TARGET_DIRECTORIES)}):"
        )
        # Validate each path in the list
        all_fs_paths_valid = True
        for i, dir_path in enumerate(FILESYSTEM_TARGET_DIRECTORIES):
            if not isinstance(dir_path, str):
                print(f"    ERROR: Item #{i + 1} ('{dir_path}') is not a string.")
                all_fs_paths_valid = False
            elif not os.path.isdir(dir_path):
                print(
                    f"    ERROR: Directory '{dir_path}' (item #{i + 1}) not found or is not a directory."
                )
                all_fs_paths_valid = False
            else:
                print(f"    - '{dir_path}' [OK]")
        if not all_fs_paths_valid:
            valid = False  # Mark config as invalid if any FS path is bad

    # Memory Server Check
    if not isinstance(ENABLE_MEMORY_SERVER, bool):
        print(
            f"ERROR: 'enable_memory_server' in {CONFIG_FILENAME} must be a boolean (true or false)."
        )
        valid = False
    else:
        print(f"  Enable Memory Server: {ENABLE_MEMORY_SERVER}")

    # Check if at least one server type is configured/enabled
    if not FILESYSTEM_TARGET_DIRECTORIES and not ENABLE_MEMORY_SERVER:
        print(
            "ERROR: No MCP servers are configured. 'filesystem_target_directories' is empty AND 'enable_memory_server' is false."
        )
        valid = False

    # Print other loaded values
    print(f"  Default Gemini Model: {DEFAULT_GEMINI_MODEL}")
    print(f"  Generation Gemini Model: {GENERATION_GEMINI_MODEL}")
    print(f"  Max Debug Log Size: {MAX_DEBUG_LOG_SIZE}")
    print(f"  Log Preview Length: {LOG_PREVIEW_LEN}")

    if config_load_error:  # Add warning from loading phase to validation output
        print(config_load_error)
        # Decide if config load error should prevent startup
        # valid = False # Uncomment if config file MUST exist and be valid

    return valid


# Run validation when the module is imported
config_valid = validate_config()
if not config_valid:
    print(
        "--- Configuration errors detected. Application might not function correctly. ---"
    )
    # Optionally exit if config is invalid:
    # sys.exit("Exiting due to invalid configuration.")
else:
    print("--- Configuration validation passed. ---")
