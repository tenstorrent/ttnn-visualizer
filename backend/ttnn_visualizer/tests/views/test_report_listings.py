# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""`isDemo` on the profiler and performance report listings.

The frontend records a hosted pick of a listed folder as `demo` or `upload` from this
flag alone, so the listing is the single owner of the demo rule.
"""

from http import HTTPStatus
from io import BytesIO
from pathlib import Path

import pytest
from ttnn_visualizer.views import (
    DEMO_PERFORMANCE_DIRECTORY_NAMES,
    DEMO_PROFILER_DIRECTORY_NAMES,
)


def _make_profiler_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "db.sqlite").write_bytes(b"")


def _make_performance_report(root: Path, name: str) -> None:
    (root / name).mkdir(parents=True)
    (root / name / "profile_log_device.csv").write_text("")
    (root / name / "ops_perf_results.csv").write_text("")


_LISTINGS = {
    "profiler": (
        "/api/profiler",
        "PROFILER_DIRECTORY_NAME",
        _make_profiler_report,
        DEMO_PROFILER_DIRECTORY_NAMES,
    ),
    "performance": (
        "/api/performance",
        "PERFORMANCE_DIRECTORY_NAME",
        _make_performance_report,
        DEMO_PERFORMANCE_DIRECTORY_NAMES,
    ),
}

_DEMO_CASES = [
    pytest.param(kind, name, id=name)
    for kind, (*_, demo_names) in _LISTINGS.items()
    for name in sorted(demo_names)
]

# Names an upload might use to pass as a demo. None is on the list, so none qualifies.
_LOOKALIKE_NAMES = [
    "my_demo_report",
    "demo_n300-llama",
    "DEMO_N300-LLAMA",
    "BH_DEMO_x",
    "WH_DEMO_x",
    "wh_demo_n300-llama",
]


def _listing(app, kind):
    endpoint, directory_key, make_report_dir, _ = _LISTINGS[kind]
    root = Path(app.config["LOCAL_DATA_DIRECTORY"]) / app.config[directory_key]
    return endpoint, root, make_report_dir


@pytest.mark.parametrize(("kind", "demo_name"), _DEMO_CASES)
@pytest.mark.parametrize("server_mode", [True, False])
def test_listing_marks_demo_folders_only_under_server_mode(
    app, client, make_report, kind, demo_name, server_mode
):
    app.config["SERVER_MODE"] = server_mode
    endpoint, root, make_report_dir = _listing(app, kind)
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


@pytest.mark.parametrize("kind", list(_LISTINGS))
@pytest.mark.parametrize("folder_name", _LOOKALIKE_NAMES)
def test_hosted_listing_hides_folders_that_only_look_like_demos(
    app, client, make_report, kind, folder_name
):
    # A demo is listed to every hosted session, so only the bundled folders qualify;
    # anything else in the shared directory stays private to the session that made it.
    app.config["SERVER_MODE"] = True
    endpoint, root, make_report_dir = _listing(app, kind)
    make_report_dir(root, folder_name)

    response = client.get(endpoint, query_string={"instanceId": make_report()})

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert response.get_json() == []


def test_hosted_upload_named_after_a_demo_cannot_replace_it(app, client, make_report):
    # Hosted uploads land under a `<timestamp>_` prefix, so reusing a demo's folder
    # name writes beside the demo rather than into it.
    app.config["SERVER_MODE"] = True
    app.config["LOCAL_DATA_DIRECTORY"] = Path(app.config["LOCAL_DATA_DIRECTORY"])
    _, root, make_report_dir = _listing(app, "profiler")
    make_report_dir(root, "WH_DEMO_n300-llama")
    demo_db = root / "WH_DEMO_n300-llama" / "db.sqlite"

    response = client.post(
        "/api/local/upload/profiler",
        query_string={"instanceId": make_report()},
        data={"files": [(BytesIO(b"not-the-demo"), "WH_DEMO_n300-llama/db.sqlite")]},
        content_type="multipart/form-data",
    )

    assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
    assert demo_db.read_bytes() == b""
    uploaded = [
        path.parent.name
        for path in root.glob("*_WH_DEMO_n300-llama/db.sqlite")
        if path.read_bytes() == b"not-the-demo"
    ]
    assert len(uploaded) == 1
