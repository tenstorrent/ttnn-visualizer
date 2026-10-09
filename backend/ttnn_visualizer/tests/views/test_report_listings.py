# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`isDemo` on the profiler and performance report listings.

The frontend records a hosted pick of a listed folder as `demo` or `upload` from this
flag alone, so the listing is the single owner of the demo rule.
"""

from http import HTTPStatus
from pathlib import Path

import pytest


def _make_profiler_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "db.sqlite").write_bytes(b"")


def _make_performance_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "profile_log_device.csv").write_text("")
    (root / name / "ops_perf_results.csv").write_text("")


@pytest.mark.parametrize(
    ("endpoint", "directory_key", "make_report_dir", "demo_name"),
    [
        (
            "/api/profiler",
            "PROFILER_DIRECTORY_NAME",
            _make_profiler_report,
            "demo_n300-llama",
        ),
        (
            "/api/performance",
            "PERFORMANCE_DIRECTORY_NAME",
            _make_performance_report,
            "DEMO_N300-LLAMA",
        ),
    ],
)
@pytest.mark.parametrize("server_mode", [True, False])
def test_listing_marks_demo_folders_only_under_server_mode(
    app,
    client,
    make_report,
    endpoint,
    directory_key,
    make_report_dir,
    demo_name,
    server_mode,
):
    app.config["SERVER_MODE"] = server_mode
    root = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    make_report_dir(root, demo_name)
    make_report_dir(root, "my-report")

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    is_demo_by_path = {
        folder["path"]: folder["isDemo"] for folder in response.get_json()
    }
    if server_mode:
        # Hosted listings never show another session's uploads, so only the demo appears.
        assert is_demo_by_path == {demo_name: True}
    else:
        assert is_demo_by_path == {demo_name: False, "my-report": False}
