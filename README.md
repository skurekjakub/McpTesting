# MCPBro - Gemini Chatbot with MCP Tools

This project is a web-based chatbot powered by Google Gemini, utilizing the Model Context Protocol (MCP) to interact with external tools like filesystem access and memory.

## Features

*   **Web Interface:** Simple chat interface built with Flask and SocketIO.
*   **Gemini Integration:** Uses the Google Generative AI SDK for chat responses.
*   **MCP Tool Usage:** Connects to MCP servers (filesystem, memory) to provide tools to the Gemini model.
*   **Real-time Communication:** Uses Flask-SocketIO for instant message updates.
*   **Configuration:** Flexible configuration via `config.json` and environment variables.
*   **Dependency Management:** Uses Poetry for managing Python dependencies.

## Prerequisites

*   Python >= 3.13
*   [Poetry](https://python-poetry.org/docs/#installation)
*   Node.js and npx (for running MCP servers like `@modelcontextprotocol/server-filesystem` and `@modelcontextprotocol/server-memory`)
*   A Google Gemini API Key

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd mcpbro
    ```

2.  **Install dependencies:**
    ```bash
    poetry install
    ```
    This will install all necessary Python packages based on the `poetry.lock` file.

3.  **Configure the application:**
    *   Copy the sample configuration file:
        ```bash
        cp bot_config/config.json.sample bot_config/config.json
        ```
    *   Edit `bot_config/config.json`:
        *   Set `gemini_api_key` to your Google Gemini API key (alternatively, set the `GEMINI_API_KEY` environment variable).
        *   Add the absolute paths to the directories you want the filesystem tool to access under `filesystem_target_directories`.
        *   Set `enable_memory_server` to `true` if you want to use the memory tool.
    *   (Optional) Edit `bot_config/system_instruction.md` to customize the chatbot's behavior and personality.

## Running the Application

1.  **Start the server:**
    You can use the Poe the Poet task defined in `pyproject.toml`:
    ```bash
    poetry run poe start
    ```
    Alternatively, run directly:
    ```bash
    poetry run python run.py
    ```

2.  **Access the application:**
    Open your web browser and navigate to `http://127.0.0.1:5000` (or the host/port specified in the console output).

## Usage

*   Type your messages into the input box and press Enter or click Send.
*   The chatbot will respond, potentially using the configured MCP tools.
*   Internal steps (like tool usage) will be displayed in the chat interface.
*   Use the `/reset` endpoint (e.g., `http://127.0.0.1:5000/reset`) to clear the chat history.
*   Use the `/debug` endpoint to view server-side debug logs.

## Key Dependencies

*   Flask
*   Flask-SocketIO
*   Flask-Session
*   gevent
*   google-generativeai
*   mcp

See `pyproject.toml` for the full list of dependencies.