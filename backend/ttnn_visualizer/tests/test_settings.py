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


def test_socketio_accepts_an_ipv6_loopback_binding():
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert is_allowed("http://[::1]:8000", wsgi_environ("[::1]:8000"))


def test_socketio_accepts_the_host_it_was_launched_with():
    # ``--host name.example`` is the operator naming this machine, so serving the SPA
    # from it must work without also spelling the name out in ALLOWED_ORIGINS.
    is_allowed = build_socketio_origin_check([], bind_host="name.example")

    assert is_allowed("http://name.example:8000", wsgi_environ("name.example:8000"))


# Self-derivation only ever matches a same-origin request, and an IP literal can't be
# forged into one by DNS: a page whose origin is an address was served from it. So
# ``--server`` and containers stay reachable by address without configuration.
@pytest.mark.parametrize(
    "host", ["10.0.0.5:8000", "192.168.1.20:8000", "[fd00::1]:8000"]
)
def test_socketio_accepts_being_reached_by_address(host):
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert is_allowed(f"http://{host}", wsgi_environ(host))


# The Host header is attacker-controlled, so a name that merely resolves here must not
# vouch for itself: a page on attacker.example that points the name at 127.0.0.1 would
# otherwise pass its own origin check and read instance-scoped socket traffic.
@pytest.mark.parametrize(
    "environ",
    [
        wsgi_environ("attacker.example"),
        # A proxy is not distinguishable from a forged header without a trust signal.
        wsgi_environ(
            "127.0.0.1:8000",
            HTTP_X_FORWARDED_PROTO="https",
            HTTP_X_FORWARDED_HOST="attacker.example",
        ),
    ],
    ids=["host", "forwarded-host"],
)
def test_socketio_refuses_to_derive_trust_from_an_unrecognised_name(environ):
    is_allowed = build_socketio_origin_check(["http://localhost:8000"])

    assert not is_allowed("http://attacker.example", environ)
    assert not is_allowed("https://attacker.example", environ)


def test_socketio_accepts_a_proxy_origin_once_it_is_configured():
    # Reaching the app under a name it was not launched with — a hosted deployment
    # behind TLS termination, a LAN or container address — is a configuration step.
    is_allowed = build_socketio_origin_check(["https://visualizer.example.com"])
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


# Unit-testing the builder alone leaves the wiring unpinned, and both halves fail open:
# ``SocketIO`` carried ``cors_allowed_origins="*"`` before this allowlist existed, and
# ``socketio.test_client`` never reaches engine.io's origin gate, so a revert to ``"*"``
# would pass every test above.
def test_socketio_is_wired_with_the_origin_check(app):
    from ttnn_visualizer.extensions import socketio

    # engine.io owns the origin gate; socketio.Server just forwards the option to it.
    origin_check = socketio.server.eio.cors_allowed_origins

    assert callable(origin_check)
    assert origin_check("http://localhost:8000", wsgi_environ("localhost:8000"))
    assert not origin_check("http://evil.example", wsgi_environ("localhost:8000"))


# The HTTP half of the same boundary: flask_cors withholds the header rather than
# refusing the request, so only the response headers show whether the allowlist arrived.
def test_cors_withholds_the_header_for_an_unlisted_origin(client):
    response = client.get("/api/up", headers={"Origin": "http://evil.example"})

    assert "Access-Control-Allow-Origin" not in response.headers


def test_cors_echoes_a_listed_origin(app, client):
    allowed_origin = app.config["ALLOWED_ORIGINS"][0]

    response = client.get("/api/up", headers={"Origin": allowed_origin})

    assert response.headers["Access-Control-Allow-Origin"] == allowed_origin
