# -*- coding: utf-8 -*-
"""
Initialization functions for Gemini client and MCP servers.
Reads configuration from the config module.
"""

import os
import traceback
from typing import Dict, Optional

# --- Google Generative AI SDK Imports ---
from google import genai

# --- MCP Imports ---
from mcp import StdioServerParameters

# --- Local Imports ---
import src.logic.config as config  # Import configuration constants and variables
import src.logic.utils as utils  # Import logging utilities
from src.logic.mcp_server import MCPServer  # Import the MCPServer class


# --- Gemini Client Initialization ---
def initialize_gemini_client() -> Optional[genai.Client]:
    """
    Initializes and returns the Gemini client instance using config settings.
    Returns None if initialization fails or config is invalid.
    """
    # Check if config validation passed
    if not config.config_valid:
        utils.add_debug_log(
            "Skipping Gemini client initialization due to invalid configuration."
        )
        return None

    # Get API Key from the config module (which handles ENV > JSON)
    api_key = config.GEMINI_API_KEY
    # Basic check again, although config.py should have validated
    if not api_key:
        utils.add_debug_log(
            "ERROR: Gemini API Key not available in config during initialization."
        )
        return None

    try:
        print("Initializing Gemini client...")
        utils.add_debug_log("Initializing Gemini client...")
        client = genai.Client(api_key=api_key)
        # Validate connection using the model specified in config
        _ = client.models.get(model=config.DEFAULT_GEMINI_MODEL)
        print("Gemini client initialized successfully.")
        utils.add_debug_log("Gemini client initialized successfully.")
        return client
    except Exception as e:
        print(f"ERROR: Error initializing Gemini client: {e}")
        utils.add_debug_log(
            f"ERROR: Error initializing Gemini client: {e}\n{traceback.format_exc()}"
        )
        return None


# --- MCP Server Initialization ---
def initialize_mcp_servers() -> Dict[str, MCPServer]:
    """
    Initializes and returns a dictionary of configured MCPServer instances
    using settings from the config module.
    Returns an empty dictionary if initialization fails or config is invalid.
    """
    mcp_servers: Dict[str, MCPServer] = {}

    # Check if config validation passed
    if not config.config_valid:
        utils.add_debug_log(
            "Skipping MCP server initialization due to invalid configuration."
        )
        return mcp_servers

    utils.add_debug_log("Initializing MCP server configurations...")

    # --- Filesystem Server ---
    # Use the list of directory paths from config module
    fs_target_dirs = config.FILESYSTEM_TARGET_DIRECTORIES
    # Config validation should have ensured this is a list (possibly empty)
    if fs_target_dirs:  # Only initialize if the list is not empty and paths are valid (checked in config.py)
        try:
            # Construct the args list: command, flags, package name, THEN all directories
            fs_args = [
                "-y",  # Assume npx needs -y to execute without confirmation
                "@modelcontextprotocol/server-filesystem",
            ]
            fs_args.extend(
                fs_target_dirs
            )  # Add all configured directories to the args list

            fs_params = StdioServerParameters(
                command="npx",
                args=fs_args,  # Pass the combined args list
                env={},  # Use default environment
            )
            mcp_servers["filesystem"] = MCPServer(
                server_id="filesystem", params=fs_params
            )
            utils.add_debug_log(
                f"Initialized 'filesystem' MCPServer instance for directories: {fs_target_dirs}"
            )
        except Exception as e:
            print(f"ERROR: Failed to initialize 'filesystem' MCPServer: {e}")
            utils.add_debug_log(
                f"ERROR: Failed to initialize 'filesystem' MCPServer: {e}\n{traceback.format_exc()}"
            )
    else:
        utils.add_debug_log(
            "Skipping 'filesystem' MCPServer initialization: No valid target directories configured."
        )

    # --- NEW: Memory Server ---
    if config.ENABLE_MEMORY_SERVER:  # Check the flag from config
        try:
            utils.add_debug_log("Attempting to initialize 'memory' MCPServer...")
            # Args for memory server are simpler
            mem_args = [
                "-y",  # Assume npx needs -y
                "@modelcontextprotocol/server-memory",
            ]
            mem_params = StdioServerParameters(
                command="npx",
                args=mem_args,
                env={
                    "MEMORY_FILE_PATH": "C:\\projects\\python\\mcpbro\\memory.json"
                },  # Use default environment
            )
            # Use a distinct server_id
            mcp_servers["memory"] = MCPServer(server_id="memory", params=mem_params)
            utils.add_debug_log("Initialized 'memory' MCPServer instance successfully.")
        except Exception as e:
            print(f"ERROR: Failed to initialize 'memory' MCPServer: {e}")
            utils.add_debug_log(
                f"ERROR: Failed to initialize 'memory' MCPServer: {e}\n{traceback.format_exc()}"
            )
    else:
        utils.add_debug_log(
            "Skipping 'memory' MCPServer initialization: 'enable_memory_server' is false in config."
        )
    # --- END NEW ---

    # --- Add Initialization for Other Servers Here ---
    # (Example placeholder remains)

    if mcp_servers:
        print(
            f"Initialized {len(mcp_servers)} MCP server configurations: {list(mcp_servers.keys())}"
        )
    else:
        print("WARNING: No MCP servers were successfully initialized.")
        utils.add_debug_log("WARNING: No MCP servers were successfully initialized.")

    return mcp_servers
