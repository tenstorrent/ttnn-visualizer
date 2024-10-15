import os
from pathlib import Path

from ttnn_visualizer.utils import str_to_bool


class DefaultConfig(object):
    # General Settings
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False

    # Path Settings
    REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")
    LOCAL_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("local")
    REMOTE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("remote")
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    SEND_FILE_MAX_AGE_DEFAULT = 0

    # File Name Configs
    TEST_CONFIG_FILE = "config.json"
    SQLITE_DB_PATH = "db.sqlite"

    # SQL Alchemy Settings
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{os.path.join(APPLICATION_DIR, 'ttnn.db')}"
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": 10,  # Adjust pool size as needed (default is 5)
        "max_overflow": 20,  # Allow overflow of the pool size if necessary
        "pool_timeout": 30,  # Timeout in seconds before giving up on getting a connection
    }
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Gunicorn settings
    GUNICORN_WORKER_CLASS = os.getenv("GUNICORN_WORKER_CLASS", "gevent")
    GUNICORN_WORKERS = os.getenv("GUNICORN_WORKERS", "1")
    GUNICORN_BIND = os.getenv("GUNICORN_BIND", "localhost:8000")
    GUNICORN_APP_MODULE = os.getenv(
        "GUNICORN_APP_MODULE", "ttnn_visualizer.app:create_app()"
    )

    # Session Settings
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = False  # For development on HTTP


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
