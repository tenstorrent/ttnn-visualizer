import logging
import subprocess
from os import environ
from pathlib import Path

import flask
from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from werkzeug.debug import DebuggedApplication
from werkzeug.middleware.proxy_fix import ProxyFix

from ttnn_visualizer.settings import Config


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

    app.config.from_object(Config())

    logging.basicConfig(level=app.config.get("LOG_LEVEL", "INFO"))

    app.logger.info(f"Starting TTNN visualizer in {flask_env} mode")

    if settings_override:
        app.config.update(settings_override)

    app.config["USE_WEBSOCKETS"] = True  # Set this based on environment
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
    from ttnn_visualizer.extensions import flask_static_digest, db, session, socketio
    from ttnn_visualizer.sockets import register_handlers

    """
    Register 0 or more extensions (mutates the app passed in).

    :param app: Flask application instance
    :return: None
    """

    flask_static_digest.init_app(app)
    socketio.init_app(app)
    db.init_app(app)

    app.config["SESSION_TYPE"] = "sqlalchemy"
    app.config["SESSION_SQLALCHEMY"] = db

    with app.app_context():
        db.drop_all()

    session.init_app(app)
    # Register the handlers by passing the socketio instance

    register_handlers(socketio)

    # Create the tables within the application context
    with app.app_context():
        db.create_all()

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
    # Only use the middleware if running in pure WSGI (HTTP requests)
    if not app.config.get("USE_WEBSOCKETS"):
        # Enable the Flask interactive debugger in the browser for development.
        if app.debug:
            app.wsgi_app = DebuggedApplication(app.wsgi_app, evalex=True)

        # Set the real IP address into request.remote_addr when behind a proxy.
        app.wsgi_app = ProxyFix(app.wsgi_app)

    # CORS configuration
    origins = ["http://localhost:5173", "http://localhost:8000"]

    CORS(
        app,
        origins=origins,
    )

    return None


if __name__ == "__main__":
    config = Config()

    gunicorn_args = [
        "gunicorn",
        "-k",
        config.GUNICORN_WORKER_CLASS,
        "-w",
        config.GUNICORN_WORKERS,
        config.GUNICORN_APP_MODULE,
        "-b",
        config.GUNICORN_BIND,
    ]

    subprocess.run(gunicorn_args)
