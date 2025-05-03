# filepath: c:\projects\python\mcpbro\config.py
import os

class Config:
    """Base configuration."""
    SECRET_KEY = os.environ.get('SECRET_KEY', os.urandom(24))
    SESSION_TYPE = 'filesystem'
    SESSION_FILE_DIR = './.flask_session_files' # Optional: Specify dir
    SESSION_FILE_THRESHOLD = 500
    SESSION_PERMANENT = False
    SESSION_USE_SIGNER = True
    # Add other configurations like API keys, database URIs, etc.
    # Example: GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
    # Example: FILESYSTEM_TARGET_DIRECTORY = "path/to/your/target"

class DevelopmentConfig(Config):
    """Development configuration."""
    DEBUG = True

class ProductionConfig(Config):
    """Production configuration."""
    DEBUG = False
    # Override base settings for production if needed
    # Example: SESSION_COOKIE_SECURE = True

# Select configuration based on environment variable (optional)
config_by_name = dict(
    development=DevelopmentConfig,
    production=ProductionConfig,
    default=DevelopmentConfig
)

key = os.environ.get('FLASK_ENV', 'default')
app_config = config_by_name[key]