# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import json
import os
import urllib

try:
    import ttnn
    from loguru import logger
    from tt_metal.tools.profiler.common import PROFILER_OUTPUT_DIR
except ImportError:
    raise Exception("TT-Metal environment not found")


def pytest_runtest_makereport(item, call):
    if call.when != "call":
        return

    webhook_url = os.environ.get("TTNN_VISUALIZER_WEBHOOK_URL", "").strip()

    if not webhook_url:
        webhook_url = "http://localhost:8000/api/notify"

    status_str = _get_test_status_from_call(call)
    _notify_visualizer_webhook(status_str, webhook_url)


def _notify_visualizer_webhook(status_str: str, webhook_url: str) -> None:
    """POST JSON to the visualizer webhook endpoint."""
    payload = {
        "report_name": _get_ttnn_report_name(),
        "profiler_path": _get_profiler_path(),
        "performance_path": _get_performance_path(),
        "status": status_str,
    }

    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    try:
        request = urllib.request.Request(
            webhook_url, data=data, headers=headers, method="POST"
        )
        logger.info(f"Posting report to TTNN-Visualizer: {payload}")
        urllib.request.urlopen(request, timeout=2)
    except urllib.error.HTTPError as error:
        logger.error(
            f"Error posting report to TTNN-Visualizer: {error.status} {error.reason}"
        )
    except Exception as err:
        logger.error(err)


def _get_test_status_from_call(call) -> str:
    """Determine test status from the call object."""
    if call.excinfo is None:
        return "PASS"
    elif call.excinfo[0] == AssertionError:
        return "FAIL"
    else:
        return "ERROR"


def _get_ttnn_report_name() -> str:
    name = ttnn.CONFIG.report_name
    return str(name) if name else "Not Available"


def _get_profiler_path() -> str:
    tt_metal_home = os.getenv("TT_METAL_HOME", "")
    return f"{tt_metal_home}/{ttnn.CONFIG.report_path}"


def _get_performance_path() -> str:
    output_dir = PROFILER_OUTPUT_DIR

    if os.getenv("TT_METAL_DEVICE_PROFILER", None) != "1":
        return None

    try:
        directories = [item for item in output_dir.iterdir() if item.is_dir()]

        if not directories:
            return None

        # Find the newest directory by modification time
        newest_dir = max(directories, key=lambda d: d.stat().st_mtime)
        return str(newest_dir)

    except (OSError, ValueError):
        return None

    return str(output_dir)
