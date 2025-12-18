# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
import time
import webbrowser
from os import environ
from pathlib import Path
from typing import cast
from urllib.error import URLError
from urllib.request import urlopen

import flask
from dotenv import load_dotenv
from flask import Flask, abort, jsonify
from flask_cors import CORS
from ttnn_visualizer.exceptions import (
    DatabaseFileNotFoundException,
    InvalidProfilerPath,
    InvalidReportPath,
)
from ttnn_visualizer.instances import create_instance_from_local_paths
from ttnn_visualizer.settings import Config, DefaultConfig
from ttnn_visualizer.utils import find_gunicorn_path, get_app_data_directory
from werkzeug.debug import DebuggedApplication
from werkzeug.middleware.proxy_fix import ProxyFix

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

    # logging.basicConfig(level=app.config.get("LOG_LEVEL", "DEBUG"))
    logging.basicConfig(level=logging.DEBUG)
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
                "TT_METAL_HOME": app.config["TT_METAL_HOME"],
                "REPORT_DATA_DIRECTORY": str(app.config["REPORT_DATA_DIRECTORY"]),
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
    from ttnn_visualizer.extensions import db, flask_static_digest, socketio
    from ttnn_visualizer.sockets import register_handlers

    """
    Register 0 or more extensions (mutates the app passed in).

    :param app: Flask application instance
    :return: None
    """
    flask_static_digest.init_app(app)
    if app.config["USE_WEBSOCKETS"]:
        socketio.init_app(app)

    Path(app.config["APP_DATA_DIRECTORY"]).mkdir(parents=True, exist_ok=True)
    db.init_app(app)

    if app.config["USE_WEBSOCKETS"]:
        register_handlers(socketio)

    with app.app_context():
        db.create_all()

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

    max_attempts = 10
    attempt = 0
    server_ready = False

    print(f"Waiting for server to be ready at {url}...")
    while attempt < max_attempts and not server_ready:
        try:
            urlopen(url, timeout=1)
            server_ready = True
        except (URLError, ConnectionError, OSError):
            attempt += 1
            time.sleep(0.5)

    if not server_ready:
        print(f"❌ Server not ready after {max_attempts} attempts.")
    else:
        print(f"Launching browser with url: {url}")

        try:
            if (
                os.name == "posix" and "DISPLAY" in os.environ
            ):  # Checks for non-headless
                subprocess.run(["xdg-open", url], check=True)
            else:
                webbrowser.open(url)
        except webbrowser.Error as e:
            print(f"Could not open the default browser: {e}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="A tool for visualizing the Tenstorrent Neural Network model (TT-NN)"
    )
    parser.add_argument(
        "--profiler-path", type=str, help="Specify a profiler path", default=None
    )
    parser.add_argument(
        "--performance-path", help="Specify a performance path", default=None
    )
    parser.add_argument(
        "--tt-metal-home", help="Specify a TT-Metal home path", default=None
    )
    parser.add_argument(
        "--host",
        type=str,
        help="Host to bind to (default: auto-detected based on environment)",
        default=None,
    )
    parser.add_argument(
        "--port",
        type=str,
        help="Port to bind to (default: 8000)",
        default=None,
    )
    parser.add_argument(
        "--server",
        action="store_true",
        help="Bind to all network interfaces (0.0.0.0) and enable server mode. Useful for servers and VMs",
    )
    parser.add_argument(
        "-d",
        "--daemon",
        action="store_true",
        help="Run the server as a daemon process",
    )
    return parser.parse_args()


def display_mode_info_without_db(config):
    """Display mode information using only config, without initializing database."""
    # Determine if we're in TT-Metal mode
    tt_metal_home = config.TT_METAL_HOME
    is_tt_metal_mode = tt_metal_home is not None

    if is_tt_metal_mode:
        print("🚀 TT-METAL MODE: Working directly with tt-metal generated directory")
        print(f"   TT_METAL_HOME: {tt_metal_home}")

        profiler_base = Path(tt_metal_home) / "generated" / "ttnn" / "reports"
        performance_base = Path(tt_metal_home) / "generated" / "profiler" / "reports"

        print(f"   Profiler reports: {profiler_base}")
        print(f"   Performance reports: {performance_base}")

        # Validate setup
        if not Path(tt_metal_home).exists():
            print(
                f"   ⚠️  Warning: TT_METAL_HOME directory does not exist: {tt_metal_home}"
            )
        elif not (Path(tt_metal_home) / "generated").exists():
            print(f"   ⚠️  Warning: TT-Metal generated directory not found")
        elif not profiler_base.exists():
            print(
                f"   ⚠️  Warning: Profiler reports directory not found: {profiler_base}"
            )
        elif not performance_base.exists():
            print(
                f"   ⚠️  Warning: Performance reports directory not found: {performance_base}"
            )
        else:
            print(f"   ✓ TT-Metal setup is valid")
    else:
        print(
            "📁 UPLOAD/SYNC MODE: Using local data directory for uploaded/synced reports"
        )
        print(f"   Local directory: {config.LOCAL_DATA_DIRECTORY}")
        print(f"   Remote directory: {config.REMOTE_DATA_DIRECTORY}")


def main():

    run_command = sys.argv[0].split("/")
    if run_command[-1] == "ttnn-visualizer":
        os.environ.setdefault("FLASK_ENV", "production")

    args = parse_args()

    # Handle host/port CLI overrides
    # Priority: CLI args > env vars > auto-detection (in settings.py)
    # Note: We need to set env vars before creating Config, but also
    # manually update the config object in case it was already instantiated
    if args.host:
        os.environ["HOST"] = args.host
        print(f"🌐 Binding to host: {args.host} (from --host flag)")
    elif args.server:
        os.environ["HOST"] = "0.0.0.0"
        os.environ["SERVER_MODE"] = "true"
        print("🌐 Binding to all interfaces (0.0.0.0) via --server flag")
        print("🖥️  Server mode enabled")

    if args.port:
        os.environ["PORT"] = args.port
        print(f"🔌 Binding to port: {args.port}")

    config = cast(DefaultConfig, Config())

    # Apply CLI overrides directly to config object
    # (Config is a singleton that may have been created before we set env vars)
    if args.host:
        config.HOST = args.host
    elif args.server:
        config.HOST = "0.0.0.0"
        config.SERVER_MODE = True

    if args.port:
        config.PORT = args.port

    # Recalculate GUNICORN_BIND with the updated values
    config.GUNICORN_BIND = f"{config.HOST}:{config.PORT}"

    instance_id = None

    # Display mode information first (using config only, no DB needed)
    if args.tt_metal_home:
        os.environ["TT_METAL_HOME"] = args.tt_metal_home
        config.TT_METAL_HOME = args.tt_metal_home

        if not os.getenv("APP_DATA_DIRECTORY"):
            config.APP_DATA_DIRECTORY = get_app_data_directory(
                args.tt_metal_home, config.APPLICATION_DIR
            )
            # Recalculate database path with new APP_DATA_DIRECTORY
            _db_file_path = str(
                Path(config.APP_DATA_DIRECTORY) / f"ttnn_{config.DB_VERSION}.db"
            )
            config.SQLALCHEMY_DATABASE_URI = f"sqlite:///{_db_file_path}"

    display_mode_info_without_db(config)

    # If profiler/performance paths are provided, create an instance
    # This requires DB access, so we create the app temporarily
    if args.profiler_path or args.performance_path:
        app = create_app()
        with app.app_context():
            try:
                session = create_instance_from_local_paths(
                    profiler_path=args.profiler_path,
                    performance_path=args.performance_path,
                )
                instance_id = session.instance_id
            except InvalidReportPath:
                sys.exit("Invalid report path")
            except InvalidProfilerPath:
                sys.exit("Invalid profiler path")

        # Clean up this temporary app - workers will create their own
        del app

    # Check if DEBUG environment variable is set
    debug_mode = os.environ.get("DEBUG", "false").lower() == "true"
    if config.PRINT_ENV:
        print("\nENVIRONMENT:")
        for key, value in config.to_dict().items():
            print(f"{key}={value}")

    # Warn if there's a gunicorn config file in current directory
    if Path("gunicorn.conf.py").exists():
        logger.warning(
            "Found gunicorn.conf.py in current directory - this may override environment settings"
        )

    gunicorn_cmd, gunicorn_warning = find_gunicorn_path()

    if gunicorn_warning:
        print(gunicorn_warning)

    gunicorn_args = [
        gunicorn_cmd,
        "-t",
        config.GUNICORN_TIMEOUT,
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

    if args.daemon:
        gunicorn_args.insert(1, "--daemon")

    if config.LAUNCH_BROWSER_ON_START and not args.daemon:
        flask_env = os.getenv("FLASK_ENV", "development")
        port = config.PORT if flask_env == "production" else config.DEV_SERVER_PORT
        host = config.HOST if flask_env == "production" else config.DEV_SERVER_HOST
        threading.Thread(target=open_browser, args=[host, port, instance_id]).start()
    try:
        subprocess.run(gunicorn_args)
    except KeyboardInterrupt:
        print("\nServer stopped by user (Ctrl+C)")


if __name__ == "__main__":
    main()
