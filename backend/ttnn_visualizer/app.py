# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import argparse
import json
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
from flask import Flask, abort, jsonify
from flask_cors import CORS
from werkzeug.debug import DebuggedApplication
from werkzeug.middleware.proxy_fix import ProxyFix

from ttnn_visualizer.exceptions import DatabaseFileNotFoundException, InvalidProfilerPath, InvalidReportPath
from ttnn_visualizer.instances import create_instance_from_local_paths
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

    app = Flask(
        __name__,
        static_folder=config.STATIC_ASSETS_DIR,
        static_url_path=f"{config.BASE_PATH}static",
    )
    logging.basicConfig(level=app.config.get("LOG_LEVEL", "INFO"))

    app.config.from_object(config)

    if settings_override:
        app.config.update(settings_override)

    middleware(app)

    app.register_blueprint(api, url_prefix=f"{app.config['BASE_PATH']}api")

    extensions(app)

    if flask_env == "production":
        @app.route(f"{app.config['BASE_PATH']}", defaults={"path": ""})
        @app.route(f"{app.config['BASE_PATH']}<path:path>")
        def catch_all(path):
            if path.startswith("static/"):
                abort(404)  # Pass control to Flask's static view

            js_config = {
                "SERVER_MODE": app.config["SERVER_MODE"],
                "BASE_PATH": app.config["BASE_PATH"],
            }
            js = f"window.TTNN_VISUALIZER_CONFIG = {json.dumps(js_config)};"

            with open(os.path.join(app.static_folder, "index.html")) as f:
                html = f.read()

                html_with_config = html.replace(
                    "/* SERVER_CONFIG */",
                    js,
                )

            return flask.Response(
                html_with_config,
                mimetype="text/html",
                headers={
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )

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
    origins = app.config["ALLOWED_ORIGINS"]

    CORS(
        app,
        origins=origins,
    )

    return None


def open_browser(host, port, instance_id=None):
    url = f"http://{host}:{port}"
    if instance_id:
        url = f"{url}?instanceId={instance_id}"

    print(f"Launching browser with url: {url}")
    try:
        if os.name == "posix" and "DISPLAY" in os.environ:  # Checks for non-headless
            subprocess.run(["xdg-open", url], check=True)
        else:
            webbrowser.open(url)
    except webbrowser.Error as e:
        print(f"Could not open the default browser: {e}")


def parse_args():
    parser = argparse.ArgumentParser(description="A tool for visualizing the Tenstorrent Neural Network model (TT-NN)")
    parser.add_argument("--profiler-path", type=str, help="Specify a profiler path", default=None)
    parser.add_argument("--performance-path", help="Specify a performance path", default=None)
    return parser.parse_args()


def main():

    run_command = sys.argv[0].split("/")
    if run_command[-1] == "ttnn-visualizer":
        os.environ.setdefault("FLASK_ENV", "production")

    config = cast(DefaultConfig, Config())
    args = parse_args()
    instance_id = None

    if args.profiler_path or args.performance_path:
        app = create_app()
        app.app_context().push()
        try:
            session = create_instance_from_local_paths(
                profiler_path=args.profiler_path,
                performance_path=args.performance_path,
            )
        except InvalidReportPath:
            sys.exit("Invalid report path")
        except InvalidProfilerPath:
            sys.exit("Invalid profiler path")

        instance_id = session.instance_id

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
        threading.Timer(2, open_browser, [host, port, instance_id]).start()
    try:
        subprocess.run(gunicorn_args)
    except KeyboardInterrupt:
        print("\nServer stopped by user (Ctrl+C)")


if __name__ == "__main__":
    main()
