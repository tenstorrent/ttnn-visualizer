# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""CORS defaults are a trust boundary: local-only endpoints publish SSH host, user and
path metadata, and the app has no authentication, so every extra allowed origin is
another local page that can read them.

The environment-override tests guard a second failure of the same kind: ``SERVER_MODE``
switches between the local and hosted postures, so a config layer that hands back the
truthy string ``"false"`` inverts a security setting.
"""

import logging
import re
from pathlib import Path

import pytest
from ttnn_visualizer.settings import (
    DefaultConfig,
    ProductionConfig,
    _build_allowed_origins,
    build_socketio_origin_check,
)
from ttnn_visualizer.utils import str_to_bool

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


def test_config_defaults_to_localhost_on_the_serving_port():
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


def test_env_override_leaves_the_allowlist_parsed(monkeypatch):
    # The path the hosted deployment actually takes: ``Config()`` runs this on an instance and
    # ``app.config.from_object`` then reads it. ``ALLOWED_ORIGINS`` is a non-data descriptor, so
    # copying the raw environment string onto the instance would shadow it and hand flask_cors a
    # single comma-joined origin that can never match. Every assertion above reads the class
    # instead, where no instance attribute exists to do the shadowing.
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://a.example,https://b.example")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.ALLOWED_ORIGINS == ["https://a.example", "https://b.example"]
    assert config.to_dict()["ALLOWED_ORIGINS"] == [
        "https://a.example",
        "https://b.example",
    ]


def test_env_override_still_applies_to_plain_values(monkeypatch):
    # The descriptor skip is keyed on ``__get__``, so it must not quietly widen into
    # "stop overriding config" for ordinary string values.
    monkeypatch.setenv("BASE_PATH", "/visualizer/")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.BASE_PATH == "/visualizer/"


# ``is`` rather than truthiness throughout: the defect produced the string "false".
@pytest.mark.parametrize(
    "env_value, expected",
    [("false", False), ("true", True), ("0", False), ("1", True)],
)
@pytest.mark.parametrize(
    "key", ["SERVER_MODE", "LAUNCH_BROWSER_ON_START", "USE_WEBSOCKETS", "DEBUG"]
)
def test_env_override_parses_booleans(key, env_value, expected, monkeypatch):
    monkeypatch.setenv(key, env_value)

    config = DefaultConfig()
    config.override_with_env_variables()

    assert getattr(config, key) is expected


def test_production_debug_is_not_enabled_by_the_string_false(monkeypatch):
    # The only manifestation on the shipped path, since these are the sole settings a
    # concrete config class declares. ``Flask.debug`` returns ``config["DEBUG"]``
    # verbatim, and a truthy value suppresses the catch-all error handler.
    # ``ProductionConfig`` directly, as ``Config()``'s singleton leaks between tests.
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv("TESTING", "false")

    config = ProductionConfig()
    config.override_with_env_variables()

    assert config.DEBUG is False
    assert config.TESTING is False


ENV_SAMPLE_PATH = Path(__file__).parents[3] / ".env.sample"
COMMENTED_SETTING_PATTERN = re.compile(r"^#\s*([A-Z][A-Z0-9_]*)=(.*)$")


def documented_boolean_defaults():
    """``# KEY=value`` lines in ``.env.sample`` naming a boolean config attribute.

    Matching against the config class is what excludes ``FLASK_DEBUG``: the file
    documents it, but the attribute it feeds is ``DEBUG``.
    """
    documented = []

    for line in ENV_SAMPLE_PATH.read_text(encoding="utf-8").splitlines():
        match = COMMENTED_SETTING_PATTERN.match(line.strip())
        if not match:
            continue

        key, documented_value = match.group(1), match.group(2).strip()
        if isinstance(getattr(DefaultConfig, key, None), bool):
            documented.append((key, documented_value))

    return documented


def test_the_documented_defaults_do_not_invert_their_settings(monkeypatch):
    # Each setting is listed commented out at its default, so uncommenting a line
    # should be a no-op. Uncommenting ``SERVER_MODE=false`` used to enable server mode.
    if not ENV_SAMPLE_PATH.exists():
        pytest.skip(f"{ENV_SAMPLE_PATH.name} is not part of the installed package")

    documented = documented_boolean_defaults()
    # Guards against the parser silently matching nothing if the file's format changes.
    assert documented

    for key, documented_value in documented:
        monkeypatch.setenv(key, documented_value)

    config = DefaultConfig()
    config.override_with_env_variables()

    # Expected values come from the documented string, not the class attribute, which
    # ``load_dotenv()`` freezes at import against a developer ``.env`` CI won't have.
    for key, documented_value in documented:
        assert getattr(config, key) is str_to_bool(documented_value), key


def test_env_override_parses_integers(monkeypatch):
    # ``SESSION_MAX_UPLOADED_REPORTS`` is a slice bound in ``decorators.py`` and
    # ``views.py``, where a string raises rather than merely misbehaving.
    monkeypatch.setenv("SESSION_MAX_UPLOADED_REPORTS", "5")
    monkeypatch.setenv("SSH_SUBPROCESS_TIMEOUT", "30")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.SESSION_MAX_UPLOADED_REPORTS == 5
    assert config.SSH_SUBPROCESS_TIMEOUT == 30


def test_a_port_stays_a_string_so_gunicorn_can_take_it(monkeypatch):
    # Coercion follows the declared type, keeping these strings for gunicorn's argv.
    monkeypatch.setenv("PORT", "9123")
    monkeypatch.setenv("GUNICORN_WORKERS", "4")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.PORT == "9123"
    assert config.GUNICORN_WORKERS == "4"


def test_an_uncoercible_integer_keeps_the_declared_default(monkeypatch, caplog):
    monkeypatch.setenv("SESSION_MAX_UPLOADED_REPORTS", "ten")

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert (
        config.SESSION_MAX_UPLOADED_REPORTS
        == DefaultConfig.SESSION_MAX_UPLOADED_REPORTS
    )
    assert "SESSION_MAX_UPLOADED_REPORTS" in caplog.text


def test_an_empty_max_content_length_means_no_limit(monkeypatch):
    # The bare form ``.env.sample`` documents. Empty is not an integer, so the setting
    # needs its own parser: the ``int`` branch would warn and keep the existing limit,
    # the opposite of what the documented value asks for. The declared value is set
    # here so the assertion doesn't depend on a developer ``.env`` CI won't have.
    monkeypatch.setattr(DefaultConfig, "MAX_CONTENT_LENGTH", 1048576)
    monkeypatch.setenv("MAX_CONTENT_LENGTH", "")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.MAX_CONTENT_LENGTH is None


def test_a_max_content_length_is_parsed_as_an_integer(monkeypatch):
    # Werkzeug compares the request's content length against this, so a string would
    # raise on any request with a body.
    monkeypatch.setattr(DefaultConfig, "MAX_CONTENT_LENGTH", None)
    monkeypatch.setenv("MAX_CONTENT_LENGTH", "1048576")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.MAX_CONTENT_LENGTH == 1048576


@pytest.mark.parametrize("env_value, expected", [("2222", 2222), ("99999", 22)])
def test_an_overridden_ssh_port_keeps_its_range_check(env_value, expected, monkeypatch):
    # The override reuses ``parse_tcp_port``. Dispatching on ``int`` alone would accept
    # 99999 and publish it to the browser through ``_build_spa_client_config``.
    monkeypatch.setenv("SSH_DEFAULT_PORT", env_value)

    config = DefaultConfig()
    config.override_with_env_variables()

    assert config.SSH_DEFAULT_PORT == expected


def test_an_unrecognised_boolean_keeps_the_declared_default(monkeypatch, caplog):
    # ``str_to_bool`` maps anything outside its vocabulary to ``False``, and for
    # ``SERVER_MODE`` that is the local posture — the one whose endpoints publish SSH
    # host, username and path metadata. A typo should be reported, not obeyed.
    monkeypatch.setattr(DefaultConfig, "SERVER_MODE", True)
    monkeypatch.setenv("SERVER_MODE", "Ture")

    config = DefaultConfig()
    with caplog.at_level(logging.WARNING):
        config.override_with_env_variables()

    assert config.SERVER_MODE is True
    assert "SERVER_MODE" in caplog.text


@pytest.mark.parametrize("key", ["MALWARE_SCANNER", "TT_METAL_HOME"])
def test_an_optional_string_setting_is_still_overridable(key, monkeypatch):
    # These declare ``None`` when unset, which offers no type to coerce towards. They
    # are optional strings, so the raw value is already what the class body would hold;
    # skipping them would silently drop the override once #1857 widens the loop's reach.
    monkeypatch.setattr(DefaultConfig, key, None)
    monkeypatch.setenv(key, "/some/value")

    config = DefaultConfig()
    config.override_with_env_variables()

    assert getattr(config, key) == "/some/value"


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
