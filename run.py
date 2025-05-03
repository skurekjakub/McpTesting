# filepath: c:\projects\python\mcpbro\run.py

import os
from src.app import create_app, socketio  # Import socketio along with create_app

# Load configuration from environment variables or a config file if needed
# For now, we'll rely on the config inside create_app

app = create_app()

if __name__ == "__main__":
    # You can fetch host and port from config or environment variables
    host = os.environ.get("FLASK_RUN_HOST", "127.0.0.1")
    port = int(os.environ.get("FLASK_RUN_PORT", 5000))
    debug = (
        os.environ.get("FLASK_DEBUG", "True").lower() == "true"
    )  # Example of env var config

    print(f"\nStarting Flask-SocketIO app. Access at http://{host}:{port}")
    print(f"Debug mode: {debug}")
    print(
        f"Using server-side sessions (type: {app.config.get('SESSION_TYPE', 'filesystem')})."
    )
    print("Ensure Node.js/npx is installed and in PATH if needed by tools.")
    print("Use Ctrl+C to stop the server.")

    # Use gevent for async operations (Flask-SocketIO will detect it)
    socketio.run(app, debug=debug, host=host, port=port, use_reloader=debug)
