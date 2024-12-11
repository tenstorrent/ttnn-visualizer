# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import logging
import os
import subprocess
import threading
import webbrowser
from os import environ
from pathlib import Path
import sys
from typing import cast

import flask
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.debug import DebuggedApplication
from werkzeug.middleware.proxy_fix import ProxyFix

from ttnn_visualizer.exceptions import DatabaseFileNotFoundException
from ttnn_visualizer.settings import Config, DefaultConfig

logger = logging.getLogger(__name__)


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

    flask_env = environ.get("FLASK_ENV", "development")

    config = cast(DefaultConfig, Config())

    app = Flask(__name__, static_folder=config.STATIC_ASSETS_DIR, static_url_path="/")
    logging.basicConfig(level=app.config.get("LOG_LEVEL", "INFO"))

    app.config.from_object(config)

    if settings_override:
        app.config.update(settings_override)

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
    from ttnn_visualizer.extensions import flask_static_digest, db, socketio
    from ttnn_visualizer.sockets import register_handlers

    """
    Register 0 or more extensions (mutates the app passed in).

    :param app: Flask application instance
    :return: None
    """

    flask_static_digest.init_app(app)
    if app.config["USE_WEBSOCKETS"]:
        socketio.init_app(app)
    db.init_app(app)

    app.config["SESSION_TYPE"] = "sqlalchemy"
    app.config["SESSION_SQLALCHEMY"] = db

    if app.config["USE_WEBSOCKETS"]:
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

    @app.errorhandler(DatabaseFileNotFoundException)
    def handle_database_not_found_error(error):
        # Return a JSON response with a 404 status code
        response = jsonify({"error": str(error)})
        response.status_code = 404
        return response

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


def open_browser(host, port, protocol="http"):

    url = f"{protocol}://{host}:{port}"

    print(f"Launching browser with url: {url}")
    try:
        if os.name == "posix" and "DISPLAY" in os.environ:  # Checks for non-headless
            subprocess.run(["xdg-open", url], check=True)
        else:
            webbrowser.open(url)
    except webbrowser.Error as e:
        print(f"Could not open the default browser: {e}")


def main():

    run_command = sys.argv[0].split("/")
    if run_command[-1] == "ttnn-visualizer":
        os.environ.setdefault("FLASK_ENV", "production")

    config = cast(DefaultConfig, Config())

    # Check if DEBUG environment variable is set
    debug_mode = os.environ.get("DEBUG", "false").lower() == "true"
    if config.PRINT_ENV:
        print("ENVIRONMENT:")
        for key, value in config.to_dict().items():
            print(f"{key}={value}")

    gunicorn_args = [
        "gunicorn",
        "-k",
        config.GUNICORN_WORKER_CLASS,
        "-w",
        config.GUNICORN_WORKERS,
        "-b",
        config.GUNICORN_BIND,
        config.GUNICORN_APP_MODULE,
    ]

    if debug_mode:
        gunicorn_args.insert(1, "--reload")

    if config.LAUNCH_BROWSER_ON_START:
        flask_env = os.getenv("FLASK_ENV", "development")
        port = config.PORT if flask_env == "production" else config.DEV_SERVER_PORT
        host = config.HOST if flask_env == "production" else config.DEV_SERVER_HOST
        threading.Timer(2, open_browser, [host, port]).start()
    try:
        subprocess.run(gunicorn_args)
    except KeyboardInterrupt:
        print("\nServer stopped by user (Ctrl+C)")


if __name__ == "__main__":
    main()
