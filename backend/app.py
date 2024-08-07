from os import environ
from pathlib import Path
import shutil
from flask import Flask
import flask
from werkzeug.debug import DebuggedApplication
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_cors import CORS
from backend import settings


def create_app(settings_override=None):
    from backend.views import api

    """
    Create a Flask application using the app factory pattern.

    :param settings_override: Override settings
    :return: Flask app
    """
    app = Flask(__name__, static_folder="../public", static_url_path="/")
    env = environ.get("FLASK_ENV", "development")
    app.config.from_object(getattr(settings, env))

    if settings_override:
        app.config.update(settings_override)

    middleware(app)

    app.register_blueprint(api)


    # Ensure there is always a schema to reference 
    # In the future we can probabably re-init the DB or 
    # wait for initialization until the user has provided a DB
    ACTIVE_DATA_DIRECTORY = app.config["ACTIVE_DATA_DIRECTORY"]

    active_db_path = Path(ACTIVE_DATA_DIRECTORY, "db.sqlite")
    empty_db_path = Path(__file__).parent.resolve().joinpath("empty.sqlite")
    if not active_db_path.exists():
        active_db_path.parent.mkdir(exist_ok=True, parents=True)
        shutil.copy(empty_db_path, active_db_path)
    
    extensions(app)

    if flask_env == "production":
        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def catch_all(path):
            return app.send_static_file("index.html")

    return app


def extensions(app: flask.Flask):
    from backend.extensions import flask_static_digest, db, ma

    """
    Register 0 or more extensions (mutates the app passed in).

    :param app: Flask application instance
    :return: None
    """

    db.init_app(app)
    ma.init_app(app)
    flask_static_digest.init_app(app)

    # For automatically reflecting table data
    # with app.app_context():
    #    db.reflect()

    return None


def middleware(app: flask.Flask):
    """
    Register 0 or more middleware (mutates the app passed in).

    :param app: Flask application instance
    :return: None
    """
    # Enable the Flask interactive debugger in the brower for development.
    if app.debug:
        app.wsgi_app = DebuggedApplication(app.wsgi_app, evalex=True)

    # Set the real IP address into request.remote_addr when behind a proxy.
    app.wsgi_app = ProxyFix(app.wsgi_app)

    # CORS configuration
    origins = ["http://localhost:5173"]
    CORS(
        app,
        origins=origins,
        allow_headers="*",
        methods="*",
        supports_credentials=True,
    )

    return None
