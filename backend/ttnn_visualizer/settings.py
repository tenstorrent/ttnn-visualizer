import os
from pathlib import Path

from ttnn_visualizer.utils import str_to_bool


class Config(object):
    TEST_CONFIG_FILE = "config.json"
    REPORT_DATA_DIRECTORY = Path(__file__).parent.absolute().joinpath("data")
    SEND_FILE_MAX_AGE_DEFAULT = 0
    MIGRATE_ON_COPY = True
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    ACTIVE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("active")
    ACTIVE_DB_PATH = Path(ACTIVE_DATA_DIRECTORY, "db.sqlite")
    DATABASE_FILE = ACTIVE_DB_PATH


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
