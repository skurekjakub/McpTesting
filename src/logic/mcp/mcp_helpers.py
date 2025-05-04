# -*- coding: utf-8 -*-
"""
Helper functions for MCP server interactions, including logging and schema cleaning.
"""

from typing import Dict, Any, Optional

# --- Logging ---
# Simple logging function (can be replaced with a more robust logger)
def _log_error(message: str):
    """Basic error logging."""
    print(f"MCP_SERVER_ERROR: {message}")
    # In a real app, integrate with chat_processor's logger or a dedicated logging setup

def _log_debug(message: str):
    """Basic debug logging."""
    # print(f"MCP_SERVER_DEBUG: {message}") # Optional: Enable for verbose debugging
    pass

# --- Helper: Clean Schema ---
def clean_schema_for_gemini(schema: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Recursively cleans schema properties not allowed by Gemini FunctionDeclaration
    and removes keys with None values or 'type: null'.
    """
    if not isinstance(schema, dict):
        return schema  # Return non-dict items as is

    cleaned_schema = {}
    for key, value in schema.items():
        # Skip disallowed keys (unless nested under allowed ones like properties/items)
        if key in ["additionalProperties", "$schema", "title"] and key not in [
            "properties",
            "items",
        ]:
            continue

        # Skip keys with None value
        if value is None:
            continue

        # Skip 'type: null' as it's invalid for Gemini
        if key == "type" and value == "null":
            _log_debug(
                f"Skipping invalid 'type: null' in schema cleaning for key '{key}' in parent schema: {schema.get('title', 'N/A')}"
            )
            continue

        # Recursively clean nested structures
        if key == "properties" and isinstance(value, dict):
            cleaned_properties = {
                prop_key: clean_schema_for_gemini(prop_value)
                for prop_key, prop_value in value.items()
            }
            # Remove properties that became None after cleaning
            cleaned_properties = {
                k: v for k, v in cleaned_properties.items() if v is not None
            }
            if cleaned_properties:  # Only add properties if there are any left
                cleaned_schema[key] = cleaned_properties
        elif key == "items" and isinstance(value, dict):
            # Clean the items schema itself first
            cleaned_item_schema = clean_schema_for_gemini(value)
            if (
                cleaned_item_schema
            ):  # Only add items if the schema is not empty after cleaning
                cleaned_schema[key] = cleaned_item_schema
        elif isinstance(value, dict):
            cleaned_value = clean_schema_for_gemini(value)
            if cleaned_value:  # Only add if not empty after cleaning
                cleaned_schema[key] = cleaned_value
        elif isinstance(value, list):
            # Clean items in the list, removing None results
            cleaned_list = [
                clean_schema_for_gemini(item) if isinstance(item, dict) else item
                for item in value
            ]
            cleaned_list = [item for item in cleaned_list if item is not None]
            if cleaned_list:  # Only add if list is not empty
                cleaned_schema[key] = cleaned_list
        else:
            # Keep non-None, non-dict, non-list values
            cleaned_schema[key] = value

    # Ensure type is set correctly if properties exist or if it's an object
    if "properties" in cleaned_schema and "type" not in cleaned_schema:
        cleaned_schema["type"] = "OBJECT"
    elif schema.get("type") == "OBJECT" and "type" not in cleaned_schema:
        # Preserve OBJECT type if it was originally specified, even if properties are gone
        # This might be needed if it's an object with no defined properties allowed
        cleaned_schema["type"] = "OBJECT"

    # Return None if the entire schema became empty after cleaning
    return cleaned_schema if cleaned_schema else None
