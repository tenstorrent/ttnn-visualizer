# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import re

import pytest
from ttnn_visualizer.app import _build_spa_client_config, _serialize_spa_js_config
from ttnn_visualizer.settings import DefaultConfig, _parse_env_bool
from ttnn_visualizer.utils import parse_tcp_port


class _FakeApp:
    def __init__(self, config: dict):
        self.config = config


@pytest.mark.parametrize("env_value, expected", [("false", False), ("true", True)])
def test_a_configured_server_mode_reaches_the_browser_as_a_boolean(
    env_value, expected, monkeypatch
):
    # The boundary the stringification defect crossed: a truthy ``"false"`` on the config
    # object is published straight to the page, where it decides which UI the SPA hides.
    # Built from a real config rather than a hand-written dict so the parse, the override
    # loop and this serialisation stay connected — the tests above pre-suppose a boolean.
    monkeypatch.setenv("SERVER_MODE", env_value)
    # Re-run the class-body parse: it happened at import, long before this test.
    monkeypatch.setattr(
        DefaultConfig, "SERVER_MODE", _parse_env_bool("SERVER_MODE", False)
    )

    config = DefaultConfig()
    config.override_with_env_variables()

    client_config = _build_spa_client_config(_FakeApp(config.to_dict()))

    assert client_config["SERVER_MODE"] is expected
    assert ("SSH_DEFAULT_PORT" in client_config) is not expected


@pytest.mark.parametrize("env_value, expected", [("false", False), ("true", True)])
@pytest.mark.parametrize("server_mode", [False, True])
def test_a_configured_new_menu_reaches_the_browser_as_a_boolean(
    env_value, expected, server_mode, monkeypatch
):
    # Parametrised over both postures because, unlike the SSH defaults, the menu style is
    # a restyle rather than local metadata: the hosted deployment has to be able to run it,
    # so an accidental move inside the ``if not server_mode`` block should fail here.
    monkeypatch.setenv("NEW_MENU", env_value)
    monkeypatch.setattr(DefaultConfig, "NEW_MENU", _parse_env_bool("NEW_MENU", False))
    monkeypatch.setattr(DefaultConfig, "SERVER_MODE", server_mode)

    config = DefaultConfig()
    config.override_with_env_variables()

    client_config = _build_spa_client_config(_FakeApp(config.to_dict()))

    assert client_config["NEW_MENU"] is expected


def test_build_spa_client_config_includes_ssh_defaults_when_not_server_mode():
    app = _FakeApp(
        {
            "SERVER_MODE": False,
            "BASE_PATH": "/",
            "TT_METAL_HOME": "/metal",
            "REPORT_DATA_DIRECTORY": "/reports",
            "NEW_MENU": False,
            "SSH_DEFAULT_PORT": 45985,
            "SSH_DEFAULT_PROFILER_PATH": "/mem",
            "SSH_DEFAULT_PERFORMANCE_PATH": "/perf",
        }
    )

    config = _build_spa_client_config(app)

    assert config["SSH_DEFAULT_PORT"] == 45985
    assert config["SSH_DEFAULT_PROFILER_PATH"] == "/mem"
    assert config["SSH_DEFAULT_PERFORMANCE_PATH"] == "/perf"
    assert config["SERVER_MODE"] is False


def test_build_spa_client_config_omits_ssh_defaults_under_server_mode():
    app = _FakeApp(
        {
            "SERVER_MODE": True,
            "BASE_PATH": "/",
            "TT_METAL_HOME": "/metal",
            "REPORT_DATA_DIRECTORY": "/reports",
            "NEW_MENU": False,
            "SSH_DEFAULT_PORT": 45985,
            "SSH_DEFAULT_PROFILER_PATH": "/secret/home/reports",
            "SSH_DEFAULT_PERFORMANCE_PATH": "/secret/home/perf",
        }
    )

    config = _build_spa_client_config(app)

    assert "SSH_DEFAULT_PORT" not in config
    assert "SSH_DEFAULT_PROFILER_PATH" not in config
    assert "SSH_DEFAULT_PERFORMANCE_PATH" not in config
    assert config["USERNAME"] is None
    assert config["SERVER_MODE"] is True


def test_serialize_spa_js_config_escapes_script_breakout():
    js = _serialize_spa_js_config(
        {
            "SSH_DEFAULT_PROFILER_PATH": "</script><script>alert(1)</script>",
        }
    )

    assert "</script>" not in js
    assert "\\u003c/script>" in js

    match = re.search(r"window\.TTNN_VISUALIZER_CONFIG = (.*);$", js)
    assert match is not None
    payload = json.loads(match.group(1))
    assert payload["SSH_DEFAULT_PROFILER_PATH"] == "</script><script>alert(1)</script>"


def test_app_config_exposes_ssh_default_settings(client, app):
    assert app.config["SSH_DEFAULT_PORT"] == 22
    assert app.config["SSH_DEFAULT_PROFILER_PATH"] == ""
    assert app.config["SSH_DEFAULT_PERFORMANCE_PATH"] == ""


def test_parse_tcp_port_accepts_valid_ports():
    assert parse_tcp_port("1") == 1
    assert parse_tcp_port("65535") == 65535
    assert parse_tcp_port("45985") == 45985


def test_parse_tcp_port_falls_back_for_invalid_values():
    assert parse_tcp_port(None) == 22
    assert parse_tcp_port("") == 22
    assert parse_tcp_port("   ") == 22
    assert parse_tcp_port("not-a-port") == 22
    assert parse_tcp_port("22.5") == 22
    assert parse_tcp_port("0") == 22
    assert parse_tcp_port("65536") == 22
    assert parse_tcp_port("-1", default=45985) == 45985
