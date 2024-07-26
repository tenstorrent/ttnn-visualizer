import os
from distutils.util import strtobool


class Config(object):
    SEND_FILE_MAX_AGE_DEFAULT = 0
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = False
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(strtobool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False

    SERVER_NAME = os.getenv(
        "SERVER_NAME", "localhost:{0}".format(os.getenv("PORT", "8000"))
    )

    # SQLAlchemy.
    DATABASE_OPTIONS = "check_same_thread=False"
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    DATABASE_FILE = os.path.join(APPLICATION_DIR, "db.sqlite")

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "sqlite:///" + f"{DATABASE_FILE}?{DATABASE_OPTIONS}"
    )


class DevelopmentConfig(Config):
    SQLALCHEMY_ECHO = True


class TestingConfig(Config):
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    DEBUG = bool(strtobool(os.getenv("FLASK_DEBUG", "True")))
    TESTING = True

class ProductionConfig(Config):
    SQLALCHEMY_TRACK_MODIFICATIONS = True
    SQLALCHEMY_ECHO = False
    DEBUG = False
    TESTING = False


development = DevelopmentConfig()
testing = TestingConfig()
production = ProductionConfig()