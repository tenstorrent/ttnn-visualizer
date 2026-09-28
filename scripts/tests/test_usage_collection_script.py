# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

_REPOSITORY_ROOT = Path(__file__).parents[2]
# Runs the module rather than the ``ttnn-visualizer-prometheus-config`` entry point,
# which is only on ``PATH`` once the package is installed into the active environment.
_RENDERER = [sys.executable, "-m", "ttnn_visualizer.usage_collection"]
_HAS_DOCKER_COMPOSE = (
    shutil.which("docker") is not None
    and subprocess.run(
        ["docker", "compose", "version"],
        check=False,
        capture_output=True,
    ).returncode
    == 0
    and subprocess.run(
        ["docker", "info"],
        check=False,
        capture_output=True,
    ).returncode
    == 0
)


def test_prometheus_config_renderer_is_runnable():
    result = subprocess.run(
        [*_RENDERER, "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "Render Prometheus config" in result.stdout


def test_renderer_initialises_local_collection_when_config_is_missing(tmp_path):
    output_path = tmp_path / "prometheus.yml"

    result = subprocess.run(
        [*_RENDERER, "--output", str(output_path)],
        check=False,
        capture_output=True,
        text=True,
        env=os.environ
        | {
            "BASE_PATH": "/visualizer/",
            "HOME": str(tmp_path),
        },
    )

    assert result.returncode == 0, result.stderr
    collection_config = json.loads(
        (tmp_path / ".ttnn-visualizer" / "app" / "collection.json").read_text(
            encoding="utf-8"
        )
    )
    prometheus_config = yaml.safe_load(output_path.read_text(encoding="utf-8"))
    assert collection_config["enabled"] is True
    assert len(collection_config["machine_id"]) == 32
    assert "remote_write" not in prometheus_config
    assert (
        prometheus_config["scrape_configs"][0]["metrics_path"]
        == "/visualizer/api/metrics"
    )


@pytest.mark.skipif(not _HAS_DOCKER_COMPOSE, reason="Docker Compose is unavailable")
def test_renderer_and_compose_accept_an_enabled_config(tmp_path):
    config_path = tmp_path / ".ttnn-visualizer" / "app" / "collection.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        json.dumps(
            {
                "enabled": True,
                "remote_write_endpoint": "https://metrics.example/write",
            }
        ),
        encoding="utf-8",
    )
    output_path = tmp_path / "prometheus.yml"
    environment = os.environ | {"HOME": str(tmp_path)}

    rendered = subprocess.run(
        [
            *_RENDERER,
            "--app-target",
            "host.docker.internal:8123",
            "--output",
            str(output_path),
        ],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )

    assert rendered.returncode == 0, rendered.stderr
    prometheus_config = yaml.safe_load(output_path.read_text(encoding="utf-8"))
    assert prometheus_config["scrape_configs"][0]["static_configs"] == [
        {"targets": ["host.docker.internal:8123"]}
    ]
    assert prometheus_config["remote_write"] == [
        {
            "url": "https://metrics.example/write",
            "write_relabel_configs": [
                {
                    "source_labels": ["__name__"],
                    "regex": "ttnn_visualizer_.*",
                    "action": "keep",
                },
                {"regex": "job|instance", "action": "labeldrop"},
            ],
        }
    ]
    assert len(prometheus_config["global"]["external_labels"]["machine_id"]) == 32
    assert stat.S_IMODE(output_path.stat().st_mode) == 0o644

    compose_environment = os.environ | {"PROMETHEUS_CONFIG_FILE": str(output_path)}
    compose = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(_REPOSITORY_ROOT / "docker" / "prometheus" / "docker-compose.yml"),
            "config",
            "--quiet",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=compose_environment,
    )

    assert compose.returncode == 0, compose.stderr

    promtool = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(_REPOSITORY_ROOT / "docker" / "prometheus" / "docker-compose.yml"),
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "promtool",
            "prometheus",
            "check",
            "config",
            "/etc/prometheus/prometheus.yml",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=compose_environment,
    )

    assert promtool.returncode == 0, promtool.stderr

    linux_compose = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(_REPOSITORY_ROOT / "docker" / "prometheus" / "docker-compose.yml"),
            "-f",
            str(
                _REPOSITORY_ROOT / "docker" / "prometheus" / "docker-compose.linux.yml"
            ),
            "config",
            "--quiet",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=compose_environment,
    )

    assert linux_compose.returncode == 0, linux_compose.stderr
