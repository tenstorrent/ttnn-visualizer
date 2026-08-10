# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import ipaddress
import logging
import os
from pathlib import Path
from typing import Any, Callable, List, Mapping, Optional, Set

from dotenv import load_dotenv
from sqlalchemy.pool import NullPool
from ttnn_visualizer.utils import (
    MAX_TCP_PORT,
    MIN_TCP_PORT,
    get_app_data_directory,
    get_report_data_directory,
    is_running_in_container,
    parse_bool,
    parse_tcp_port,
)

load_dotenv()

logger = logging.getLogger(__name__)


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


_DEFAULT_SSH_PORT = 22


def _parse_max_content_length(env_value: str) -> Optional[int]:
    """Empty means no limit — the bare form ``.env.sample`` documents."""
    return int(env_value) if env_value else None


def _parse_ssh_port(env_value: Optional[str]) -> int:
    """Range-check an SSH port, falling back to the default for anything unusable."""
    return parse_tcp_port(env_value, default=_DEFAULT_SSH_PORT)


def _parse_ssh_port_override(env_value: str) -> int:
    """Range-check as :func:`_parse_ssh_port` does, but reject instead of falling back.

    Substituting the default is the only option in the class body, where there is
    nothing else to keep. In the override loop there is a declared value, so raising
    keeps this the only setting that doesn't change silently — an out-of-range port is
    published to the browser through ``_build_spa_client_config``.
    """
    port = int(env_value)
    if not MIN_TCP_PORT <= port <= MAX_TCP_PORT:
        raise ValueError(f"port {port} is outside {MIN_TCP_PORT}-{MAX_TCP_PORT}")

    return port


# Settings whose class body parses more richly than their type. Keyed by name because
# the rule belongs to the setting: dispatching on ``int`` alone would drop the SSH port
# range check, and ``MAX_CONTENT_LENGTH`` is an ``int`` whose empty value is not one.
_ENV_PARSERS: Mapping[str, Callable[[str], Any]] = {
    "SSH_DEFAULT_PORT": _parse_ssh_port_override,
    "MAX_CONTENT_LENGTH": _parse_max_content_length,
}


def _keep_declared(key: str, declared: Any, env_value: str, expected: str) -> Any:
    logger.warning(
        "Ignoring %s=%r: expected %s. Keeping %r.", key, env_value, expected, declared
    )
    return declared


def _coerce_bool(key: str, declared: bool, env_value: str) -> bool:
    parsed = parse_bool(env_value)
    if parsed is None:
        return bool(_keep_declared(key, declared, env_value, "a boolean"))

    return parsed


def _parse_env_bool(key: str, default: bool) -> bool:
    """Read a boolean setting in the class body, reporting a value we don't recognise.

    The class body — not :meth:`~DefaultConfig.override_with_env_variables`, whose reach
    stops at ``DEBUG`` and ``TESTING`` until #1857 — is what decides ``SERVER_MODE``, so
    this is where the vocabulary check has to live to mean anything.
    """
    env_value = os.getenv(key)
    if env_value is None:
        return default

    return _coerce_bool(key, default, env_value)


def _coerce_env_value(key: str, declared: Any, env_value: str) -> Any:
    """Parse an environment string into the value the class body would have produced.

    Assigning the raw string would discard that parse, and ``"false"`` is truthy — so
    an explicitly disabled boolean setting would come back enabled.

    Settings with an entry in :data:`_ENV_PARSERS` reuse it; the rest dispatch on the
    declared type, not on how the value looks, since ``PORT`` and the ``GUNICORN_*``
    settings are strings because ``main()`` passes them to gunicorn as arguments. A
    value the declared type can't represent is reported and discarded rather than
    applied, so a typo can't quietly reconfigure the app.
    """
    parser = _ENV_PARSERS.get(key)
    if parser is not None:
        try:
            return parser(env_value)
        except ValueError:
            return _keep_declared(key, declared, env_value, "a parseable value")

    # bool before int: ``isinstance(True, int)`` is True.
    if isinstance(declared, bool):
        return _coerce_bool(key, declared, env_value)

    if isinstance(declared, int):
        try:
            return int(env_value)
        except ValueError:
            return _keep_declared(key, declared, env_value, "an integer")

    # A setting declared ``None`` (``MALWARE_SCANNER``, ``TT_METAL_HOME``) is an
    # optional string, so the raw value is already what the class body would hold.
    if declared is None or isinstance(declared, str):
        return env_value

    # Everything else is derived rather than configured — the ``Path`` directories, the
    # engine options dict — and handing the app a raw string where it expects a parsed
    # value is worse than declining. Unreachable until #1857 widens the loop's reach.
    return _keep_declared(
        key, declared, env_value, f"a coercible type, not {type(declared).__name__}"
    )


class DefaultConfig(object):
    # General Settings
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = _parse_env_bool("FLASK_DEBUG", False)
    TESTING = False
    PRINT_ENV = True
    SERVER_MODE = _parse_env_bool("SERVER_MODE", False)
    MALWARE_SCANNER = os.getenv("MALWARE_SCANNER")
    BASE_PATH = os.getenv("BASE_PATH", "/")
    MAX_CONTENT_LENGTH = _parse_max_content_length(os.getenv("MAX_CONTENT_LENGTH", ""))

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

    LAUNCH_BROWSER_ON_START = _parse_env_bool("LAUNCH_BROWSER_ON_START", True)

    # Remote SSH connection dialog defaults (local install only — suppressed under SERVER_MODE).
    SSH_DEFAULT_PORT = _parse_ssh_port(os.getenv("SSH_DEFAULT_PORT"))
    SSH_DEFAULT_PROFILER_PATH = os.getenv("SSH_DEFAULT_PROFILER_PATH", "")
    SSH_DEFAULT_PERFORMANCE_PATH = os.getenv("SSH_DEFAULT_PERFORMANCE_PATH", "")
    # Remote SSH subprocess timeouts (seconds).
    SSH_SUBPROCESS_TIMEOUT = int(os.getenv("SSH_SUBPROCESS_TIMEOUT", "120"))
    SSH_REMOTE_CHECK_TIMEOUT = int(os.getenv("SSH_REMOTE_CHECK_TIMEOUT", "45"))

    # File Name Configs
    TEST_CONFIG_FILE = "config.json"
    SQLITE_DB_PATH = "db.sqlite"

    # For development you may want to disable sockets
    USE_WEBSOCKETS = _parse_env_bool("USE_WEBSOCKETS", True)

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
        """Override config values with environment variables.

        Values are coerced to what the class body would have produced; see
        :func:`_coerce_env_value`.

        Only reaches attributes declared on the *concrete* config class, since it reads
        that class's own ``__dict__``: ``DevelopmentConfig`` declares none, the others
        only ``DEBUG`` and ``TESTING``. Tracked as #1857.
        """
        for key, value in self.__class__.__dict__.items():
            # Descriptors (and methods) resolve their own value on read; assigning the
            # raw environment string over one would shadow it with an unparsed value.
            if key.startswith("_") or hasattr(value, "__get__"):
                continue

            env_value = os.getenv(key)
            if env_value is None:
                continue

            setattr(self, key, _coerce_env_value(key, value, env_value))

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
    DEBUG = _parse_env_bool("FLASK_DEBUG", True)
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
