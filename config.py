# -*- coding: utf-8 -*-
"""
Configuration constants for the MCP Chat application.
"""
import os

# --- Target Directories ---
# !!! IMPORTANT: Replace with your actual target directory !!!
FILESYSTEM_TARGET_DIRECTORY = "C:/projects/kentico-docs-jekyll/gems/jekyll-learn-portal"

# --- Model Configuration ---
# Model used for initialization checks and generation
# Using 1.5 flash as it's generally available and supports function calling
DEFAULT_GEMINI_MODEL = "gemini-1.5-flash"
# Model used for the main generation steps (can be the same or different)
GENERATION_GEMINI_MODEL = "models/gemini-2.5-pro-exp-03-25"
# You could also use more advanced models like "gemini-1.5-pro-latest" if needed

# --- API Keys ---
# !!! WARNING: Best practice is to load keys from environment variables ONLY. !!!
# Avoid hardcoding keys directly in the code.
# The initializers.py file will prioritize the environment variable.
# GEMINI_API_KEY_FALLBACK = "YOUR_API_KEY_HERE" # Example if needed, but strongly discouraged

# --- Logging Configuration (Moved from utils.py for better central config) ---
MAX_DEBUG_LOG_SIZE = 1500
LOG_PREVIEW_LEN = 250 # Preview length for logs

# --- Path Validation (Optional but recommended) ---
def validate_paths():
    """Validates configured paths."""
    path_valid = True
    # Filesystem Path
    if "C:/path/to/your/target/directory" in FILESYSTEM_TARGET_DIRECTORY:
        print("ERROR: Default FILESYSTEM_TARGET_DIRECTORY detected in config.py. Please update it.")
        path_valid = False
    elif not os.path.isdir(FILESYSTEM_TARGET_DIRECTORY):
        print(f"ERROR: FILESYSTEM_TARGET_DIRECTORY '{FILESYSTEM_TARGET_DIRECTORY}' in config.py not found or is not a directory.")
        path_valid = False

    # Add validation for other paths if needed

    if not path_valid:
        # Decide how to handle invalid paths (e.g., exit, raise exception)
        # For now, just print the error. The application might fail later.
        pass

# Run validation when the module is imported
validate_paths()

