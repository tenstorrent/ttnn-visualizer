# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from sqlalchemy.pool import NullPool
from ttnn_visualizer.utils import (
    get_app_data_directory,
    get_report_data_directory,
    is_running_in_container,
    parse_tcp_port,
    str_to_bool,
)

load_dotenv()


def _build_allowed_origins(
    configured: Optional[str],
    app_port: str,
    dev_server_host: str,
    dev_server_port: str,
    flask_env: str,
) -> List[str]:
    """Resolve the CORS allowlist, defaulting to the narrowest set that still works.

    Only the app's own origin is trusted by default: local-only endpoints hand out SSH
    host, user and path metadata, and with no authentication CORS is what stops another
    page served from a different localhost port reading it. Production serves the built
    SPA same-origin, while ``pnpm dev`` serves it from Vite's own origin, so only
    non-production adds the dev server.
    """
    if configured is None:
        configured = f"http://localhost:{app_port}"
        if flask_env.lower() != "production":
            configured += f",http://{dev_server_host}:{dev_server_port}"

    # Trimmed because an allowlist written the natural way ("a, b") would otherwise
    # carry a leading space that can never match an Origin header.
    origins = (origin.strip() for origin in configured.split(","))
    return [origin for origin in origins if origin]


class DefaultConfig(object):
    # General Settings
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False
    PRINT_ENV = True
    SERVER_MODE = str_to_bool(os.getenv("SERVER_MODE", "false"))
    MALWARE_SCANNER = os.getenv("MALWARE_SCANNER")
    BASE_PATH = os.getenv("BASE_PATH", "/")
    _raw_max_content = os.getenv("MAX_CONTENT_LENGTH")
    MAX_CONTENT_LENGTH = None if not _raw_max_content else int(_raw_max_content)

    # Path Settings
    DB_VERSION = "0.29.0"  # App version when DB schema last changed
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    TT_METAL_HOME = os.getenv("TT_METAL_HOME", None)
    APP_DATA_DIRECTORY = os.getenv(
        "APP_DATA_DIRECTORY",
        get_app_data_directory(TT_METAL_HOME, APPLICATION_DIR),
    )
    REPORT_DATA_DIRECTORY = os.getenv(
        "REPORT_DATA_DIRECTORY",
        get_report_data_directory(TT_METAL_HOME, APPLICATION_DIR),
    )
    LOCAL_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("local")
    REMOTE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("remote")
    PROFILER_DIRECTORY_NAME = "profiler-reports"
    PERFORMANCE_DIRECTORY_NAME = "performance-reports"
    NPE_DIRECTORY_NAME = "npe-reports"
    MLIR_DIRECTORY_NAME = "mlir-reports"

    STATIC_ASSETS_DIR = Path(APPLICATION_DIR).joinpath("ttnn_visualizer", "static")
    SEND_FILE_MAX_AGE_DEFAULT = 0

    LAUNCH_BROWSER_ON_START = str_to_bool(os.getenv("LAUNCH_BROWSER_ON_START", "true"))

    # Remote SSH connection dialog defaults (local install only — suppressed under SERVER_MODE).
    SSH_DEFAULT_PORT = parse_tcp_port(os.getenv("SSH_DEFAULT_PORT"), default=22)
    SSH_DEFAULT_PROFILER_PATH = os.getenv("SSH_DEFAULT_PROFILER_PATH", "")
    SSH_DEFAULT_PERFORMANCE_PATH = os.getenv("SSH_DEFAULT_PERFORMANCE_PATH", "")
    # Remote SSH subprocess timeouts (seconds).
    SSH_SUBPROCESS_TIMEOUT = int(os.getenv("SSH_SUBPROCESS_TIMEOUT", "120"))
    SSH_REMOTE_CHECK_TIMEOUT = int(os.getenv("SSH_REMOTE_CHECK_TIMEOUT", "45"))

    # File Name Configs
    TEST_CONFIG_FILE = "config.json"
    SQLITE_DB_PATH = "db.sqlite"

    # For development you may want to disable sockets
    USE_WEBSOCKETS = str_to_bool(os.getenv("USE_WEBSOCKETS", "true"))

    # SQL Alchemy Settings
    # Build database path - use absolute path to avoid any ambiguity
    _db_file_path = str(Path(APP_DATA_DIRECTORY) / f"ttnn_{DB_VERSION}.db")
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{_db_file_path}"
    SQLALCHEMY_ENGINE_OPTIONS = {
        # SQLite-specific settings for multi-process/worker environments
        # NullPool: Each worker gets its own connection, avoiding file locking issues
        # This is critical for gunicorn's multi-worker mode with SQLite
        "poolclass": NullPool,
        "connect_args": {
            "check_same_thread": False,  # Allow SQLite to be used across threads in gevent
        },
    }
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Gunicorn settings
    GUNICORN_WORKER_CLASS = os.getenv("GUNICORN_WORKER_CLASS", "gevent")
    GUNICORN_WORKERS = os.getenv("GUNICORN_WORKERS", "1")
    GUNICORN_TIMEOUT = os.getenv("GUNICORN_TIMEOUT", "60")
    PORT = os.getenv("PORT", "8000")
    HOST = os.getenv("HOST", "0.0.0.0" if is_running_in_container() else "localhost")
    DEV_SERVER_PORT = "5173"
    DEV_SERVER_HOST = "localhost"

    ALLOWED_ORIGINS = _build_allowed_origins(
        os.getenv("ALLOWED_ORIGINS"),
        app_port=PORT,
        dev_server_host=DEV_SERVER_HOST,
        dev_server_port=DEV_SERVER_PORT,
        flask_env=os.getenv("FLASK_ENV", "development"),
    )

    GUNICORN_BIND = f"{HOST}:{PORT}"
    GUNICORN_APP_MODULE = os.getenv(
        "GUNICORN_APP_MODULE", "ttnn_visualizer.app:create_app()"
    )

    # Session Settings
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = False  # For development on HTTP
    # Max uploaded report paths / instance IDs stored in session cookie (FIFO); avoids cookie size limits (e.g. 4KB)
    SESSION_MAX_UPLOADED_REPORTS = int(os.getenv("SESSION_MAX_UPLOADED_REPORTS", "10"))

    def override_with_env_variables(self):
        """Override config values with environment variables."""
        for key, value in self.__class__.__dict__.items():
            if not key.startswith("_"):  # Skip private/protected attributes
                env_value = os.getenv(key)
                if env_value is not None:
                    setattr(self, key, env_value)

    def to_dict(self):
        """Return all config values as a dictionary, including inherited attributes."""
        return {
            key: getattr(self, key)
            for key in dir(self)
            if not key.startswith("_") and not callable(getattr(self, key))
        }


class DevelopmentConfig(DefaultConfig):
    pass


class TestingConfig(DefaultConfig):
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "True")))
    TESTING = True


class ProductionConfig(DefaultConfig):
    DEBUG = False
    TESTING = False


class Config:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Config, cls).__new__(cls)
            cls._instance = cls._determine_config()
            cls._instance.override_with_env_variables()
        return cls._instance

    @staticmethod
    def _determine_config():
        # Determine the environment
        flask_env = os.getenv("FLASK_ENV", "development").lower()

        # Choose the correct configuration class based on FLASK_ENV
        if flask_env == "production":
            return ProductionConfig()
        elif flask_env == "testing":
            return TestingConfig()
        else:
            return DevelopmentConfig()
