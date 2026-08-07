# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import ipaddress
import os
from pathlib import Path
from typing import Any, Callable, List, Mapping, Optional, Set

from dotenv import load_dotenv
from sqlalchemy.pool import NullPool
from ttnn_visualizer.usage import USAGE_RECORDING_ENV_VAR
from ttnn_visualizer.utils import (
    get_app_data_directory,
    get_report_data_directory,
    is_running_in_container,
    parse_tcp_port,
    str_to_bool,
)

load_dotenv()


def _build_allowed_origins(
    configured: Optional[str],
    app_port: str,
    dev_server_host: str,
    dev_server_port: str,
    flask_env: str,
) -> List[str]:
    """Resolve the CORS allowlist, defaulting to the narrowest set that still works.

    This governs which *other* pages may read us, not whether the app can reach itself:
    local-only endpoints hand out SSH host, user and path metadata, and with no
    authentication CORS is what stops a page served from a different localhost port
    reading it. Production serves the built SPA same-origin, while ``pnpm dev`` serves
    it from Vite's own origin, so only non-production adds the dev server.

    The default therefore doesn't have to name the origin the app is actually served
    on. A same-origin fetch is unaffected by a missing ``Access-Control-Allow-Origin``,
    so a binding this list doesn't mention still works. Sockets are the exception —
    engine.io refuses an unlisted ``Origin`` outright — which is why they go through
    :func:`build_socketio_origin_check` rather than taking this list verbatim.
    """
    if configured is None:
        configured = f"http://localhost:{app_port}"
        if flask_env.lower() != "production":
            configured += f",http://{dev_server_host}:{dev_server_port}"

    # Trimmed because an allowlist written the natural way ("a, b") would otherwise
    # carry a leading space that can never match an Origin header.
    origins = (origin.strip() for origin in configured.split(","))
    return [origin for origin in origins if origin]


def _hostname_of(host: str) -> str:
    """Hostname from a ``Host`` header or bind address, without port or IPv6 brackets."""
    hostname = host.strip().lower()
    if hostname.startswith("["):
        closing_bracket = hostname.find("]")
        return hostname[1:closing_bracket] if closing_bracket != -1 else hostname[1:]

    return hostname.split(":", 1)[0]


def _names_this_machine(host: str, bind_host: str) -> bool:
    """Whether a ``Host`` header can only be a name for the machine we're running on.

    A ``Host`` header is attacker-controlled, and self-derivation only ever matches a
    *same-origin* request, so the question is which same-origin claims can be forged.
    DNS rebinding forges one for a **name**: a page on ``attacker.example`` points that
    name at 127.0.0.1, and both its origin and the ``Host`` it sends become
    ``attacker.example`` — enough to pass a naive self-check and read instance-scoped
    socket traffic (SSH host, username, paths) from a local install.

    An **IP literal** cannot be forged that way, because no name is resolved: a page
    whose origin is ``http://10.0.0.5:8000`` was served from that address, so matching
    it means the request really is same-origin. That keeps ``--server`` and containers
    reachable by address without configuration. ``localhost`` and the address passed to
    ``--host`` are accepted as names the operator chose for this machine; every other
    name — a proxy's, notably — has to go in ``ALLOWED_ORIGINS``.
    """
    hostname = _hostname_of(host)
    if not hostname:
        return False

    if hostname == _hostname_of(bind_host) or hostname == "localhost":
        return True

    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return False

    return True


def _request_own_origins(environ: Mapping[str, Any], bind_host: str) -> Set[str]:
    """Origins naming the app itself, derived as engine.io does when unconfigured.

    Only the derivations whose host survives :func:`_names_this_machine` are returned,
    so an unrecognised name yields nothing to match against rather than trusting itself.
    """
    scheme = environ.get("wsgi.url_scheme")
    host = environ.get("HTTP_HOST")
    if not scheme or not host:
        return set()

    forwarded_scheme = (
        str(environ.get("HTTP_X_FORWARDED_PROTO", scheme)).split(",")[0].strip()
    )
    forwarded_host = (
        str(environ.get("HTTP_X_FORWARDED_HOST", host)).split(",")[0].strip()
    )

    return {
        f"{origin_scheme}://{origin_host}"
        for origin_scheme, origin_host in (
            (scheme, host),
            (forwarded_scheme, forwarded_host),
        )
        if _names_this_machine(origin_host, bind_host)
    }


def build_socketio_origin_check(
    allowed_origins: List[str],
    bind_host: str = "",
) -> Callable[[Optional[str], Mapping[str, Any]], bool]:
    """Accept the configured origins plus the origin the app is actually served on.

    ``flask_cors`` only withholds response headers for an unlisted origin, but engine.io
    refuses the handshake with a 400, and only its unconfigured branch derives the
    allowed origin from the request. Handing it the HTTP allowlist alone therefore
    breaks the app against itself wherever it is not reached as ``localhost``:
    ``--server`` binds and opens ``0.0.0.0`` and ``--host`` names an interface. Those
    same-origin cases are allowed without configuration — the allowlist governs which
    *other* pages may talk to us.

    Self-derivation stops at hosts that can only mean this machine (see
    :func:`_names_this_machine`), so a hosted deployment behind a proxy, or anything
    else reached under a hostname we were not launched with, needs ``ALLOWED_ORIGINS``.

    A callable is also the only form engine.io always consults: an empty list means
    "skip the origin check entirely" there, so configuring ``ALLOWED_ORIGINS=""`` to
    trust nothing would otherwise widen the socket to every origin.
    """

    def is_allowed_origin(origin: Optional[str], environ: Mapping[str, Any]) -> bool:
        if origin in allowed_origins:
            return True

        return origin in _request_own_origins(environ, bind_host)

    return is_allowed_origin


class _AllowedOrigins:
    """Resolve the CORS allowlist on read rather than at class-body import time.

    ``main()`` defaults ``FLASK_ENV`` to production and applies ``--port`` by mutating
    the environment *after* this module is imported. Today the serving process is a
    fresh gunicorn subprocess that inherits those values, so a value computed in the
    class body happens to be right there — but wrong in the launching process, which
    prints it in the startup environment dump, and wrong for anything that builds an
    app in-process. Reading through ``PORT`` on the owning config also picks up a
    ``--port`` override applied to the config object rather than the environment.
    """

    def __get__(self, instance: object, owner: type) -> List[str]:
        source = instance if instance is not None else owner

        return _build_allowed_origins(
            os.getenv("ALLOWED_ORIGINS"),
            app_port=str(getattr(source, "PORT")),
            dev_server_host=str(getattr(source, "DEV_SERVER_HOST")),
            dev_server_port=str(getattr(source, "DEV_SERVER_PORT")),
            flask_env=os.getenv("FLASK_ENV", "development"),
        )


class _UsageRecordingEnabled:
    """Resolve the usage off switch on read rather than at class-body import time.

    ``override_with_env_variables`` copies raw environment strings over class
    attributes, which would replace a parsed bool with ``"false"`` — a truthy string,
    so setting ``USAGE_RECORDING_ENABLED=false`` would leave recording on. A
    descriptor is skipped by that loop (it tests for ``__get__``), which is the same
    reason ``ALLOWED_ORIGINS`` is one.

    This is only the environment half of the switch; :func:`usage.is_recording_enabled`
    combines it with ``SERVER_MODE`` and the marker file at the usage path.
    """

    def __get__(self, instance: object, owner: type) -> bool:
        return str_to_bool(os.getenv(USAGE_RECORDING_ENV_VAR, "true"))


class DefaultConfig(object):
    # General Settings
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = bool(str_to_bool(os.getenv("FLASK_DEBUG", "false")))
    TESTING = False
    PRINT_ENV = True
    SERVER_MODE = str_to_bool(os.getenv("SERVER_MODE", "false"))
    # Local usage recording is on by default and writes nothing anywhere but this
    # machine. See backend/ttnn_visualizer/usage.py.
    USAGE_RECORDING_ENABLED = _UsageRecordingEnabled()
    MALWARE_SCANNER = os.getenv("MALWARE_SCANNER")
    BASE_PATH = os.getenv("BASE_PATH", "/")
    _raw_max_content = os.getenv("MAX_CONTENT_LENGTH")
    MAX_CONTENT_LENGTH = None if not _raw_max_content else int(_raw_max_content)

    # Path Settings
    DB_VERSION = "0.29.0"  # App version when DB schema last changed
    APPLICATION_DIR = os.path.abspath(os.path.join(__file__, "..", os.pardir))
    TT_METAL_HOME = os.getenv("TT_METAL_HOME", None)
    APP_DATA_DIRECTORY = os.getenv(
        "APP_DATA_DIRECTORY",
        get_app_data_directory(TT_METAL_HOME, APPLICATION_DIR),
    )
    REPORT_DATA_DIRECTORY = os.getenv(
        "REPORT_DATA_DIRECTORY",
        get_report_data_directory(TT_METAL_HOME, APPLICATION_DIR),
    )
    LOCAL_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("local")
    REMOTE_DATA_DIRECTORY = Path(REPORT_DATA_DIRECTORY).joinpath("remote")
    PROFILER_DIRECTORY_NAME = "profiler-reports"
    PERFORMANCE_DIRECTORY_NAME = "performance-reports"
    NPE_DIRECTORY_NAME = "npe-reports"
    MLIR_DIRECTORY_NAME = "mlir-reports"

    STATIC_ASSETS_DIR = Path(APPLICATION_DIR).joinpath("ttnn_visualizer", "static")
    SEND_FILE_MAX_AGE_DEFAULT = 0

    LAUNCH_BROWSER_ON_START = str_to_bool(os.getenv("LAUNCH_BROWSER_ON_START", "true"))

    # Remote SSH connection dialog defaults (local install only — suppressed under SERVER_MODE).
    SSH_DEFAULT_PORT = parse_tcp_port(os.getenv("SSH_DEFAULT_PORT"), default=22)
    SSH_DEFAULT_PROFILER_PATH = os.getenv("SSH_DEFAULT_PROFILER_PATH", "")
    SSH_DEFAULT_PERFORMANCE_PATH = os.getenv("SSH_DEFAULT_PERFORMANCE_PATH", "")
    # Remote SSH subprocess timeouts (seconds).
    SSH_SUBPROCESS_TIMEOUT = int(os.getenv("SSH_SUBPROCESS_TIMEOUT", "120"))
    SSH_REMOTE_CHECK_TIMEOUT = int(os.getenv("SSH_REMOTE_CHECK_TIMEOUT", "45"))

    # File Name Configs
    TEST_CONFIG_FILE = "config.json"
    SQLITE_DB_PATH = "db.sqlite"

    # For development you may want to disable sockets
    USE_WEBSOCKETS = str_to_bool(os.getenv("USE_WEBSOCKETS", "true"))

    # SQL Alchemy Settings
    # Build database path - use absolute path to avoid any ambiguity
    _db_file_path = str(Path(APP_DATA_DIRECTORY) / f"ttnn_{DB_VERSION}.db")
    SQLALCHEMY_DATABASE_URI = f"sqlite:///{_db_file_path}"
    SQLALCHEMY_ENGINE_OPTIONS = {
        # SQLite-specific settings for multi-process/worker environments
        # NullPool: Each worker gets its own connection, avoiding file locking issues
        # This is critical for gunicorn's multi-worker mode with SQLite
        "poolclass": NullPool,
        "connect_args": {
            "check_same_thread": False,  # Allow SQLite to be used across threads in gevent
        },
    }
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Gunicorn settings
    GUNICORN_WORKER_CLASS = os.getenv("GUNICORN_WORKER_CLASS", "gevent")
    GUNICORN_WORKERS = os.getenv("GUNICORN_WORKERS", "1")
    GUNICORN_TIMEOUT = os.getenv("GUNICORN_TIMEOUT", "60")
    PORT = os.getenv("PORT", "8000")
    HOST = os.getenv("HOST", "0.0.0.0" if is_running_in_container() else "localhost")
    DEV_SERVER_PORT = "5173"
    DEV_SERVER_HOST = "localhost"

    ALLOWED_ORIGINS = _AllowedOrigins()

    GUNICORN_BIND = f"{HOST}:{PORT}"
    GUNICORN_APP_MODULE = os.getenv(
        "GUNICORN_APP_MODULE", "ttnn_visualizer.app:create_app()"
    )

    # Session Settings
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = False  # For development on HTTP
    # Max uploaded report paths / instance IDs stored in session cookie (FIFO); avoids cookie size limits (e.g. 4KB)
    SESSION_MAX_UPLOADED_REPORTS = int(os.getenv("SESSION_MAX_UPLOADED_REPORTS", "10"))

    def override_with_env_variables(self):
        """Override config values with environment variables."""
        for key, value in self.__class__.__dict__.items():
            # Descriptors (and methods) resolve their own value on read; assigning the
            # raw environment string over one would shadow it with an unparsed value.
            if key.startswith("_") or hasattr(value, "__get__"):
                continue

            env_value = os.getenv(key)
            if env_value is not None:
                setattr(self, key, env_value)

    def to_dict(self):
        """Return all config values as a dictionary, including inherited attributes."""
        return {
            key: getattr(self, key)
            for key in dir(self)
            if not key.startswith("_") and not callable(getattr(self, key))
        }


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
            cls._instance.override_with_env_variables()
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
