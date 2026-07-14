# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import re

from ttnn_visualizer.app import _build_spa_client_config, _serialize_spa_js_config
from ttnn_visualizer.utils import parse_tcp_port


class _FakeApp:
    def __init__(self, config: dict):
        self.config = config


def test_build_spa_client_config_includes_ssh_defaults_when_not_server_mode():
    app = _FakeApp(
        {
            "SERVER_MODE": False,
            "BASE_PATH": "/",
            "TT_METAL_HOME": "/metal",
            "REPORT_DATA_DIRECTORY": "/reports",
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
