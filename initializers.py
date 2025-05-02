# -*- coding: utf-8 -*-
"""
Initialization functions for Gemini client and MCP servers.
"""
import os
import traceback
from typing import Dict, Optional

# --- Google Generative AI SDK Imports ---
from google import genai

# --- MCP Imports ---
from mcp import StdioServerParameters

# --- Local Imports ---
import config  # Import configuration constants
import utils   # Import logging utilities
from mcp_server import MCPServer # Import the MCPServer class

# --- Gemini Client Initialization ---
def initialize_gemini_client() -> Optional[genai.Client]:
    """
    Initializes and returns the Gemini client instance.
    Returns None if initialization fails.
    """
    # Use environment variable for API Key
    GEMINI_API_KEY = "AIzaSyAxWctwC8Iun0kLgLsnWpTsWZ2gjFPzs4c"
    if not GEMINI_API_KEY:
        print("ERROR: GEMINI_API_KEY environment variable not set.")
        utils.add_debug_log("ERROR: GEMINI_API_KEY not configured.")
        return None

    try:
        print("Initializing Gemini client...")
        utils.add_debug_log("Initializing Gemini client...")
        client = genai.Client(api_key=GEMINI_API_KEY)
        # Validate connection using the model specified in config
        _ = client.models.get(model=config.DEFAULT_GEMINI_MODEL)
        print("Gemini client initialized successfully.")
        utils.add_debug_log("Gemini client initialized successfully.")
        return client
    except Exception as e:
        print(f"ERROR: Error initializing Gemini client: {e}")
        utils.add_debug_log(f"ERROR: Error initializing Gemini client: {e}\n{traceback.format_exc()}")
        return None

# --- MCP Server Initialization ---
def initialize_mcp_servers() -> Dict[str, MCPServer]:
    """
    Initializes and returns a dictionary of configured MCPServer instances.
    Returns an empty dictionary if initialization fails for all servers.
    """
    mcp_servers: Dict[str, MCPServer] = {}
    utils.add_debug_log("Initializing MCP server configurations...")

    # --- Filesystem Server ---
    try:
        # Use directory path from config
        fs_params = StdioServerParameters(
            command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem", config.FILESYSTEM_TARGET_DIRECTORY],
            env={},
        )
        mcp_servers["filesystem"] = MCPServer(server_id="filesystem", params=fs_params)
        utils.add_debug_log("Initialized 'filesystem' MCPServer instance.")
    except Exception as e:
        print(f"ERROR: Failed to initialize 'filesystem' MCPServer: {e}")
        utils.add_debug_log(f"ERROR: Failed to initialize 'filesystem' MCPServer: {e}\n{traceback.format_exc()}")


    # --- Add Initialization for Other Servers Here ---
    # Example:
    # try:
    #     db_params = StdioServerParameters(...) # Define params for DB server
    #     mcp_servers["database"] = MCPServer(server_id="database", params=db_params)
    #     utils.add_debug_log("Initialized 'database' MCPServer instance.")
    # except Exception as e:
    #     print(f"ERROR: Failed to initialize 'database' MCPServer: {e}")
    #     utils.add_debug_log(f"ERROR: Failed to initialize 'database' MCPServer: {e}\n{traceback.format_exc()}")


    if mcp_servers:
        print(f"Initialized {len(mcp_servers)} MCP server configurations.")
    else:
        print("WARNING: No MCP servers were successfully initialized.")
        utils.add_debug_log("WARNING: No MCP servers were successfully initialized.")

    return mcp_servers

