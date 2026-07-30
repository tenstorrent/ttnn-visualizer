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


def test_empty_configured_origins_trust_nothing():
    assert _build_allowed_origins("", flask_env="development", **DEV_ARGS) == []


def test_config_exposes_origins_as_a_list():
    assert isinstance(DefaultConfig.ALLOWED_ORIGINS, list)
