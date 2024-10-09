import logging
from os import environ
from pathlib import Path

import flask
from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from werkzeug.debug import DebuggedApplication
from werkzeug.middleware.proxy_fix import ProxyFix

from ttnn_visualizer import settings
from ttnn_visualizer.sessions import init_sessions, CustomRequest, init_session_db


def create_app(settings_override=None):
    from ttnn_visualizer.views import api

    """
    Create a Flask application using the app factory pattern.

    :param settings_override: Override settings
    :return: Flask app
    """

    dotenv_path = Path(__file__).parent.parent.joinpath(".env")
    if dotenv_path.exists():
        load_dotenv(str(dotenv_path))

    static_assets_dir = environ.get("STATIC_ASSETS", "/public")
    flask_env = environ.get("FLASK_ENV", "development")

    app = Flask(__name__, static_folder=static_assets_dir, static_url_path="/")
    app.request_class = CustomRequest

    app.config.from_object(getattr(settings, flask_env))

    logging.basicConfig(level=app.config.get("LOG_LEVEL", "INFO"))

    app.logger.info(f"Starting TTNN visualizer in {flask_env} mode")

    if settings_override:
        app.config.update(settings_override)

    init_session_db()

    middleware(app)

    app.register_blueprint(api)

    extensions(app)

    if flask_env == "production":

        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def catch_all(path):
            return app.send_static_file("index.html")

    return app


def extensions(app: flask.Flask):
    from ttnn_visualizer.extensions import flask_static_digest

    """
    Register 0 or more extensions (mutates the app passed in).

    :param app: Flask application instance
    :return: None
    """

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
    origins = ["http://localhost:5173", "http://localhost:8000"]

    init_sessions(app)

    CORS(
        app,
        origins=origins,
    )

    return None
