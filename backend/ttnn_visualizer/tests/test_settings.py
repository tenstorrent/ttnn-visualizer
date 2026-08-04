# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""CORS defaults are a trust boundary: local-only endpoints publish SSH host, user and
path metadata, and the app has no authentication, so every extra allowed origin is
another local page that can read them.
"""

import pytest
from ttnn_visualizer.settings import (
    DefaultConfig,
    _build_allowed_origins,
    build_socketio_origin_check,
)

DEV_ARGS = {
    "app_port": "8000",
    "dev_server_host": "localhost",
    "dev_server_port": "5173",
}


def wsgi_environ(host: str, scheme: str = "http", **headers: str) -> dict:
    return {"wsgi.url_scheme": scheme, "HTTP_HOST": host, **headers}


def test_defaults_add_the_vite_dev_server_outside_production():
    assert _build_allowed_origins(None, flask_env="development", **DEV_ARGS) == [
        "http://localhost:8000",
        "http://localhost:5173",
    ]


def test_defaults_omit_the_vite_dev_server_in_production():
    assert _build_allowed_origins(None, flask_env="production", **DEV_ARGS) == [
        "http://localhost:8000"
    ]

    assert _build_allowed_origins(None, flask_env="PRODUCTION", **DEV_ARGS) == [
        "http://localhost:8000"
    ]


def test_defaults_follow_the_configured_app_port():
    origins = _build_allowed_origins(
        None,
        app_port="9001",
        dev_server_host="localhost",
        dev_server_port="5173",
        flask_env="production",
    )

    assert origins == ["http://localhost:9001"]


def test_configured_origins_replace_the_defaults():
    origins = _build_allowed_origins(
        "https://ttnn-visualizer.tenstorrent.com,https://other.example",
        flask_env="development",
        **DEV_ARGS,
    )

    assert origins == [
        "https://ttnn-visualizer.tenstorrent.com",
        "https://other.example",
    ]


def test_configured_origins_tolerate_whitespace():
    origins = _build_allowed_origins(
        " https://a.example , https://b.example ,, ",
        flask_env="development",
        **DEV_ARGS,
    )

    assert origins == ["https://a.example", "https://b.example"]


def test_empty_configured_origins_trust_nothing():
    assert _build_allowed_origins("", flask_env="development", **DEV_ARGS) == []


def test_config_defaults_to_the_apps_own_origin():
    origins = DefaultConfig.ALLOWED_ORIGINS

    assert isinstance(origins, list)
    assert f"http://localhost:{DefaultConfig.PORT}" in origins


def test_config_narrows_to_production_set_after_import(monkeypatch):
    # ``main()`` defaults FLASK_ENV to production long after this module is imported,
    # so an allowlist frozen at import time would keep trusting the Vite dev server.
    monkeypatch.setenv("FLASK_ENV", "production")

    assert DefaultConfig.ALLOWED_ORIGINS == [f"http://localhost:{DefaultConfig.PORT}"]


def test_config_follows_a_port_applied_after_import(monkeypatch):
    # ``--port`` is applied by mutating the environment and the config object, both
    # after import; the allowlist has to name the port the app actually serves on.
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("PORT", "9123")

    class PortOverride(DefaultConfig):
        PORT = "9123"

    assert PortOverride.ALLOWED_ORIGINS == ["http://localhost:9123"]


def test_config_honours_configured_origins(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://ttnn-visualizer.tenstorrent.com")

    assert DefaultConfig.ALLOWED_ORIGINS == ["https://ttnn-visualizer.tenstorrent.com"]


# engine.io rejects an unlisted Origin with a 400 rather than merely withholding CORS
# headers, so the socket check has to accept the app's own origin under every binding —
# the default allowlist only ever names localhost.
@pytest.mark.parametrize("host", ["localhost:8000", "0.0.0.0:8000", "127.0.0.1:8000"])
def test_socketio_accepts_the_origin_the_app_is_served_on(host):
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert is_allowed(f"http://{host}", wsgi_environ(host))


def test_socketio_accepts_a_configured_cross_origin():
    is_allowed = build_socketio_origin_check(
        ["http://localhost:8000", "http://localhost:5173"]
    )

    assert is_allowed("http://localhost:5173", wsgi_environ("localhost:8000"))


def test_socketio_rejects_an_unrelated_origin():
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert not is_allowed("http://evil.example", wsgi_environ("0.0.0.0:8000"))


def test_socketio_accepts_the_origin_a_proxy_presents():
    # Behind TLS termination the browser's Origin names the proxy, not the bind address.
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])
    environ = wsgi_environ(
        "127.0.0.1:8000",
        HTTP_X_FORWARDED_PROTO="https",
        HTTP_X_FORWARDED_HOST="visualizer.example.com",
    )

    assert is_allowed("https://visualizer.example.com", environ)


def test_socketio_still_accepts_same_origin_when_nothing_is_configured():
    # An empty list means "skip the origin check entirely" to engine.io, so trusting
    # nothing must not be expressible as one — a callable is always consulted.
    is_allowed = build_socketio_origin_check([])

    assert is_allowed("http://0.0.0.0:8000", wsgi_environ("0.0.0.0:8000"))
    assert not is_allowed("http://evil.example", wsgi_environ("0.0.0.0:8000"))
