# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""CORS defaults are a trust boundary: local-only endpoints publish SSH host, user and
path metadata, and the app has no authentication, so every extra allowed origin is
another local page that can read them.
"""

from ttnn_visualizer.settings import DefaultConfig, _build_allowed_origins

DEV_ARGS = {
    "app_port": "8000",
    "dev_server_host": "localhost",
    "dev_server_port": "5173",
}


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
