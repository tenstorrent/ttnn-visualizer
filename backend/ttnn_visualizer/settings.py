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
from ttnn_visualizer.usage import is_recording_enabled
from ttnn_visualizer.utils import (
    FALSE_VALUES,
    TRUE_VALUES,
    get_app_data_directory,
    get_report_data_directory,
    is_running_in_container,
    parse_bool,
    parse_tcp_port,
    require_tcp_port,
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


class _UsageRecordingEnabled:
    """Resolve whether usage recording is active, on read rather than at import time.

    A descriptor so the override loop skips it (it tests for ``__get__``) — assigning a
    raw environment string would shadow the live check. Same reason ``ALLOWED_ORIGINS``
    is one. Reading on access also picks up a ``SERVER_MODE`` override applied after
    import, and delegates to :func:`usage.is_recording_enabled` so the ``PRINT_ENV``
    dump cannot claim recording is on while the posture or the marker file has switched
    it off.
    """

    def __get__(self, instance: object, owner: type) -> bool:
        server_mode = (
            getattr(instance, "SERVER_MODE", False) if instance is not None else False
        )
        return is_recording_enabled(server_mode)


_DEFAULT_SSH_PORT = 22


def _parse_max_content_length(env_value: str) -> Optional[int]:
    """Empty means no limit — the bare form ``.env.sample`` documents.

    Anything else unreadable raises, for the reason ``SERVER_MODE`` is strict: the
    value to fall back on is *no limit*, so guessing would drop an upload cap the
    operator asked for. The class-body call is unguarded, so this message is what
    they get in place of a bare ``int()`` traceback; the override loop catches it
    and keeps the declared limit instead.
    """
    if not env_value:
        return None

    try:
        return int(env_value)
    except ValueError:
        raise ValueError(
            f"MAX_CONTENT_LENGTH={env_value!r} is not a byte count. "
            "Set a whole number of bytes, or leave it empty for no limit."
        ) from None


def _parse_ssh_port(env_value: Optional[str]) -> int:
    """Range-check an SSH port, falling back to the default for anything unusable.

    The class body has nothing else to keep, so substituting the default is the only
    option here. The override loop uses :func:`require_tcp_port` instead, which reports
    a bad value rather than changing the port silently — an out-of-range one is
    published to the browser through ``_build_spa_client_config``.
    """
    return parse_tcp_port(env_value, default=_DEFAULT_SSH_PORT)


# Settings whose class body parses more richly than their type. Keyed by name because
# the rule belongs to the setting: dispatching on ``int`` alone would drop the SSH port
# range check, and ``MAX_CONTENT_LENGTH`` is an ``int`` whose empty value is not one.
_ENV_PARSERS: Mapping[str, Callable[[str], Any]] = {
    "SSH_DEFAULT_PORT": require_tcp_port,
    "MAX_CONTENT_LENGTH": _parse_max_content_length,
}

# Booleans an unreadable value must stop the app over rather than warn about. Registered
# per setting rather than passed at the call site, so the class body and the override
# loop can't disagree about which spellings are fatal: the loop has no call site to pass
# it at, and ``create_app``'s ``load_dotenv`` can introduce a value the class body never
# saw. ``SERVER_MODE`` is the one whose fallback is itself a posture — keeping the
# default means *local*, which un-gates every ``@local_only`` endpoint.
_STRICT_BOOLEANS = frozenset({"SERVER_MODE"})

# Config attributes whose environment variable is spelled differently. ``DEBUG`` is the
# only one: a bare ``DEBUG`` variable is the log-level knob ``pnpm flask:start-debug``
# sets, so reading the attribute name would let it turn on Flask's debug mode — and
# suppress the catch-all error handler — for anyone who only wanted verbose logs.
_ENV_ALIASES: Mapping[str, str] = {"DEBUG": "FLASK_DEBUG"}

# Derived or constant attributes the override loop must not touch. String-typed derived
# values (``GUNICORN_BIND``, ``SQLALCHEMY_DATABASE_URI``, ``APPLICATION_DIR``) would
# otherwise accept an env string and diverge from their parents; ``Path`` / ``dict``
# ones are declined by ``_coerce_env_value`` as a backstop, but skipping them here
# keeps the loop from warning on every visit. Constants have no env story.
_ENV_OVERRIDE_SKIP = frozenset(
    {
        "APPLICATION_DIR",
        "GUNICORN_BIND",
        "SQLALCHEMY_DATABASE_URI",
        "SQLALCHEMY_ENGINE_OPTIONS",
        "SQLALCHEMY_TRACK_MODIFICATIONS",
        "LOCAL_DATA_DIRECTORY",
        "REMOTE_DATA_DIRECTORY",
        "STATIC_ASSETS_DIR",
        "DB_VERSION",
        "PROFILER_DIRECTORY_NAME",
        "PERFORMANCE_DIRECTORY_NAME",
        "NPE_DIRECTORY_NAME",
        "MLIR_DIRECTORY_NAME",
        "TEST_CONFIG_FILE",
        "SQLITE_DB_PATH",
        "SEND_FILE_MAX_AGE_DEFAULT",
        "DEV_SERVER_PORT",
        "DEV_SERVER_HOST",
        "SESSION_COOKIE_SAMESITE",
        "SESSION_COOKIE_SECURE",
        "PRINT_ENV",
    }
)


def _env_name_for(key: str) -> str:
    """The variable a setting reads, so every registry can be keyed by attribute name.

    Both parse paths take the attribute and resolve the variable here, which keeps the
    aliased spelling written once and lets warnings still name what the operator set.
    """
    return _ENV_ALIASES.get(key, key)


def _keep_declared(key: str, declared: Any, env_value: str, expected: str) -> Any:
    logger.warning(
        "Ignoring %s=%r: expected %s. Keeping %r.",
        _env_name_for(key),
        env_value,
        expected,
        declared,
    )
    return declared


def _coerce_bool(key: str, declared: bool, env_value: str) -> bool:
    """Parse a boolean setting, refusing a value we don't recognise where it matters.

    Shared by the class body and the override loop so a spelling can't be fatal at
    import and tolerated afterwards. Everything outside :data:`_STRICT_BOOLEANS` is a
    feature flag and keeps its default with a warning, which doesn't warrant refusing
    to boot.
    """
    parsed = parse_bool(env_value)
    if parsed is not None:
        return parsed

    if key in _STRICT_BOOLEANS:
        recognised = ", ".join(sorted(TRUE_VALUES | FALSE_VALUES))
        raise ValueError(
            f"{_env_name_for(key)}={env_value!r} is not a recognised boolean. "
            f"Use one of: {recognised}."
        )

    return bool(_keep_declared(key, declared, env_value, "a boolean"))


def _parse_env_bool(key: str, default: bool) -> bool:
    """Read a boolean setting in the class body, reporting a value we don't recognise.

    Shared with the override loop via :func:`_coerce_bool`, so a spelling can't be fatal
    at import and tolerated afterwards. A strict setting raises from here, which lands
    on ``stderr`` before ``create_app`` configures logging; that is the point, since a
    warning at this stage goes nowhere.
    """
    env_value = os.getenv(_env_name_for(key))
    if env_value is None:
        return default

    return _coerce_bool(key, default, env_value)


def _coerce_env_value(key: str, declared: Any, env_value: str) -> Any:
    """Parse an environment string into the value the class body would have produced.

    Assigning the raw string would discard that parse, and ``"false"`` is truthy — so
    an explicitly disabled boolean setting would come back enabled.

    Keyed by *attribute*, like every registry here, so an aliased setting reaches its
    parser; warnings name the variable through :func:`_env_name_for`.

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
    # value is worse than declining. The override loop also lists these in
    # :data:`_ENV_OVERRIDE_SKIP`; this is the backstop for any future non-skipped type.
    return _keep_declared(
        key,
        declared,
        env_value,
        f"a coercible type, not {type(declared).__name__}",
    )


class DefaultConfig(object):
    # General Settings
    SECRET_KEY = os.getenv("SECRET_KEY", "90909")
    DEBUG = _parse_env_bool("DEBUG", False)
    TESTING = False
    PRINT_ENV = True
    SERVER_MODE = _parse_env_bool("SERVER_MODE", False)
    # Local usage recording is on by default. Written on this machine only; the
    # application transmits nothing. See backend/ttnn_visualizer/usage.py.
    USAGE_RECORDING_ENABLED = _UsageRecordingEnabled()
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

        Walks the MRO so inherited settings on ``DefaultConfig`` are reachable when the
        concrete class is a subclass. Subclass declarations win because later
        ``setattr`` calls overwrite earlier ones. Values are coerced to what the class
        body would have produced; see :func:`_coerce_env_value`. Attributes read a
        differently named variable where :data:`_ENV_ALIASES` says so.

        Derived and constant attributes in :data:`_ENV_OVERRIDE_SKIP` are left alone;
        ``GUNICORN_BIND`` is recomputed from ``HOST`` and ``PORT`` afterwards so a late
        bind change cannot go stale.
        """
        for cls in reversed(type(self).__mro__):
            for key, value in cls.__dict__.items():
                # Descriptors (and methods) resolve their own value on read; assigning
                # the raw environment string over one would shadow it with an unparsed
                # value. Derived / constant attrs have no sensible string form.
                if (
                    key.startswith("_")
                    or key in _ENV_OVERRIDE_SKIP
                    or hasattr(value, "__get__")
                ):
                    continue

                env_value = os.getenv(_env_name_for(key))
                if env_value is None:
                    continue

                setattr(self, key, _coerce_env_value(key, value, env_value))

        self.GUNICORN_BIND = f"{self.HOST}:{self.PORT}"
        self._refuse_debug_under_server_mode()

    def _refuse_debug_under_server_mode(self) -> None:
        """Hosted mode wins over debug mode, because ``DEBUG`` is not just verbosity.

        A truthy ``Flask.debug`` suppresses the catch-all error handler, so an unhandled
        exception answers an untrusted caller with a traceback, and without websockets
        it mounts Werkzeug's interactive console. Neither survives a multi-user
        deployment, so the two settings can't both be honoured and the restrictive one
        has to win. Applied after the loop so it covers the class body and the override
        alike.
        """
        if not (self.SERVER_MODE and self.DEBUG):
            return

        logger.warning(
            "Ignoring FLASK_DEBUG under SERVER_MODE: debug mode would return tracebacks "
            "to untrusted callers. Keeping debug mode off."
        )
        self.DEBUG = False

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
    DEBUG = _parse_env_bool("DEBUG", True)
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
