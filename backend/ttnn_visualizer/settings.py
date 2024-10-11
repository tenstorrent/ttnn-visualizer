import os
from pathlib import Path

from ttnn_visualizer.utils import str_to_bool


class Config(object):
    TEST_CONFIG_FILE = "config.json"
    REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")
    LOCAL_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("local")
    REMOTE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("remote")
    SEND_FILE_MAX_AGE_DEFAULT = 0
    MIGRATE_ON_COPY = True
    SQLITE_DB_PATH = "db.sqlite"
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    # Base directory where the SQLite database will be stored

    # SQLite database URL
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{os.path.join(APPLICATION_DIR, 'ttnn.db')}"

    # Enable connection pooling (default for SQLite is disabled)
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_size": 10,  # Adjust pool size as needed (default is 5)
        "max_overflow": 20,  # Allow overflow of the pool size if necessary
        "pool_timeout": 30,  # Timeout in seconds before giving up on getting a connection
    }

    # Disable modification tracking to improve performance
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = False  # For development on HTTP


class DevelopmentConfig(Config):
    pass


class TestingConfig(Config):
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "True")))
    TESTING = True


class ProductionConfig(Config):
    DEBUG = False
    TESTING = False


development = DevelopmentConfig()
testing = TestingConfig()
production = ProductionConfig()
