# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import os
from pathlib import Path
from dotenv import load_dotenv

from ttnn_visualizer.utils import str_to_bool

load_dotenv()

class DefaultConfig(object):
    # General Settings
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False
    PRINT_ENV = True
    SERVER_MODE = str_to_bool(os.getenv("SERVER_MODE", "false"))
    MALWARE_SCANNER = os.getenv("MALWARE_SCANNER")
    ALLOWED_ORIGINS = [
        o for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8000").split(",")
        if o
    ]
    BASE_PATH = os.getenv("BASE_PATH", "/")
    MAX_CONTENT_LENGTH = (
        None if not (v := os.getenv("MAX_CONTENT_LENGTH")) else int(v)
    )

    # Path Settings
    DB_VERSION = "0.29.0"  # App version when DB schema last changed
    REPORT_DATA_DIRECTORY = os.getenv("REPORT_DATA_DIRECTORY", Path(__file__).parent.absolute().joinpath("data"))
    LOCAL_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("local")
    REMOTE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("remote")
    PROFILER_DIRECTORY_NAME = "profiler-reports"
    PERFORMANCE_DIRECTORY_NAME = "performance-reports"
    NPE_DIRECTORY_NAME = "npe-reports"
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    APP_DATA_DIRECTORY = os.getenv("APP_DATA_DIRECTORY", APPLICATION_DIR)
    STATIC_ASSETS_DIR = Path(APPLICATION_DIR).joinpath("ttnn_visualizer", "static")
    SEND_FILE_MAX_AGE_DEFAULT = 0

    LAUNCH_BROWSER_ON_START = str_to_bool(os.getenv("LAUNCH_BROWSER_ON_START", "true"))

    # File Name Configs
    TEST_CONFIG_FILE = "config.json"
    SQLITE_DB_PATH = "db.sqlite"

    # For development you may want to disable sockets
    USE_WEBSOCKETS = str_to_bool(os.getenv("USE_WEBSOCKETS", "true"))

    # SQL Alchemy Settings
    SQLALCHEMY_DATABASE_URI = (
        f"sqlite:///{os.path.join(APP_DATA_DIRECTORY, f'ttnn_{DB_VERSION}.db')}"
    )
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": 10,  # Adjust pool size as needed (default is 5)
        "max_overflow": 20,  # Allow overflow of the pool size if necessary
        "pool_timeout": 30,  # Timeout in seconds before giving up on getting a connection
    }
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Gunicorn settings
    GUNICORN_WORKER_CLASS = os.getenv("GUNICORN_WORKER_CLASS", "gevent")
    GUNICORN_WORKERS = os.getenv("GUNICORN_WORKERS", "1")
    PORT = os.getenv("PORT", "8000")
    HOST = os.getenv("HOST", "localhost")
    DEV_SERVER_PORT = "5173"
    DEV_SERVER_HOST = "localhost"

    GUNICORN_BIND = f"{HOST}:{PORT}"
    GUNICORN_APP_MODULE = os.getenv(
        "GUNICORN_APP_MODULE", "ttnn_visualizer.app:create_app()"
    )

    # Session Settings
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = False  # For development on HTTP

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
