# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""One baseline for the settings every app-building test fixture starts from.

A module of its own rather than part of ``conftest.py`` so that ``test_settings.py`` can
import the inventory below without importing a conftest.
"""

import tempfile
from pathlib import Path
from typing import Any, Dict

# Settings an exported environment variable would otherwise reach through
# ``DefaultConfig``. Every name in ``test_settings._OVERRIDABLE_SETTINGS`` was exported
# individually against the full suite; these are the ones that changed a behaviour the
# suite asserts, plus the three the shared fixture already set. Kept in step with
# ``_INHERITED_BY_TEST_FIXTURES`` by ``test_the_test_fixtures_pin_every_env_reachable_setting``.
PINNED_ENV_SETTINGS = frozenset(
    {
        "BASE_PATH",
        "MALWARE_SCANNER",
        "MAX_CONTENT_LENGTH",
        "SERVER_MODE",
        "SSH_DEFAULT_PERFORMANCE_PATH",
        "SSH_DEFAULT_PORT",
        "SSH_DEFAULT_PROFILER_PATH",
        "TESTING",
        "TT_METAL_HOME",
        "USE_WEBSOCKETS",
    }
)


def base_test_settings(tmpdir: str, **overrides: Any) -> Dict[str, Any]:
    """Test settings with the developer's own environment pinned out.

    ``DefaultConfig`` reads each pinned name from the environment, and ``TT_METAL_HOME``
    is exported on any machine that profiles TT-Metal. Left to the environment they flip
    the app into direct-report mode, cap request bodies at whatever an operator set, shell
    uploads out to a real malware scanner, publish an operator's SSH defaults, and move
    every route off ``/api`` — each failing in a way indistinguishable from a real
    regression. See issue #1869.

    Pinning has to happen through ``settings_override`` rather than by deleting the
    variables: ``Config`` is a process singleton whose class attributes bind at import,
    and ``override_with_env_variables`` skips a key whose variable is unset, so
    ``monkeypatch.delenv`` cannot un-bind one. ``create_app`` applies
    ``settings_override`` last, so it always wins.

    The directory pins are load-bearing for the ``TT_METAL_HOME`` one:
    ``app.config.update`` sets a single key and does not run
    ``recompute_derived_settings()``, so the derived path tree has to be pinned here too.

    A fixture that genuinely wants one of these passes it in *overrides*, which is the
    clearer default — see ``direct_mode_app`` in ``views/test_report_deletion.py``.
    """
    settings: Dict[str, Any] = {
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{Path(tmpdir) / 'app.db'}",
        "SERVER_MODE": True,
        "USE_WEBSOCKETS": True,
        "TT_METAL_HOME": None,
        "MALWARE_SCANNER": None,
        "MAX_CONTENT_LENGTH": None,
        "BASE_PATH": "/",
        "SSH_DEFAULT_PORT": 22,
        "SSH_DEFAULT_PROFILER_PATH": "",
        "SSH_DEFAULT_PERFORMANCE_PATH": "",
        "APP_DATA_DIRECTORY": tmpdir,
        "REPORT_DATA_DIRECTORY": tmpdir,
        "LOCAL_DATA_DIRECTORY": str(Path(tmpdir) / "local"),
        "REMOTE_DATA_DIRECTORY": str(Path(tmpdir) / "remote"),
    }
    settings.update(overrides)

    return settings


def pinned_settings_sample() -> Dict[str, Any]:
    """A baseline built on a throwaway directory, for asserting on its keys.

    Exists so the guard test can inspect the shape without inventing a path of its own —
    nothing is created or written, the directory only seeds the derived values.
    """
    return base_test_settings(tempfile.gettempdir())
