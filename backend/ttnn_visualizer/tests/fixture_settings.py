# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""One baseline for the settings every app-building test fixture starts from.

A module of its own rather than part of ``conftest.py`` so that ``test_settings.py`` can
import the inventory below without importing a conftest.
"""

import os
import tempfile
from pathlib import Path
from typing import Any, Dict

from ttnn_visualizer.settings import (
    _DEFAULT_SESSION_MAX_UPLOADED_REPORTS,
    DefaultConfig,
    _build_allowed_origins,
)

# Settings an exported environment variable would otherwise reach through
# ``DefaultConfig``. Every name in ``test_settings._OVERRIDABLE_SETTINGS`` was exported
# individually against the full suite; these are the ones that changed a behaviour the
# suite asserts, plus the three the shared fixture already set. Kept in step with
# ``_INHERITED_BY_TEST_FIXTURES`` by ``test_the_test_fixtures_pin_every_env_reachable_setting``.
PINNED_ENV_SETTINGS = frozenset(
    {
        "BASE_PATH",
        "DEBUG",
        "MALWARE_SCANNER",
        "MAX_CONTENT_LENGTH",
        "SERVER_MODE",
        "SESSION_MAX_UPLOADED_REPORTS",
        "SSH_DEFAULT_PERFORMANCE_PATH",
        "SSH_DEFAULT_PORT",
        "SSH_DEFAULT_PROFILER_PATH",
        "TESTING",
        "TT_METAL_HOME",
        "USE_WEBSOCKETS",
    }
)

# ``ALLOWED_ORIGINS`` is pinned too but deliberately absent from the frozenset above:
# ``override_with_env_variables`` skips anything with ``__get__``, so it never reaches
# ``_OVERRIDABLE_SETTINGS`` and the guard test that reconciles these two inventories
# cannot police it. Pinned in the baseline all the same, because the CORS and socket
# boundary tests use the shared fixture and read the resolved allowlist.
_UNPOLICEABLE_PINS = frozenset({"ALLOWED_ORIGINS"})


def base_test_settings(tmpdir: str, **overrides: Any) -> Dict[str, Any]:
    """Test settings with the developer's own environment pinned out.

    ``DefaultConfig`` reads each pinned name from the environment, and ``TT_METAL_HOME``
    is exported on any machine that profiles TT-Metal. Left to the environment they flip
    the app into direct-report mode, cap request bodies at whatever an operator set, shell
    uploads out to a real malware scanner, publish an operator's SSH defaults, bound the
    session's stored report list at whatever an operator set, and move every route off
    ``/api`` — each failing in a way indistinguishable from a real regression. See issue
    #1869.

    Pinning has to happen through ``settings_override`` rather than by deleting the
    variables: ``Config`` is a process singleton whose class attributes bind at import,
    and ``override_with_env_variables`` skips a key whose variable is unset, so
    ``monkeypatch.delenv`` cannot un-bind one. ``create_app`` applies
    ``settings_override`` after ``from_object``, so it wins for every value read once the
    app exists — but not for the two things ``create_app`` consumes while building it:
    ``static_url_path`` is composed from the pre-override ``BASE_PATH``, and
    ``_refuse_debug_under_server_mode`` has already run against the pre-override
    ``SERVER_MODE``, which is why ``DEBUG`` is pinned here rather than left to the guard
    in ``settings.py``.

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
        # Not merely verbosity: a truthy ``Flask.debug`` suppresses the catch-all error
        # handler, so a fixture app inheriting ``FLASK_DEBUG`` answers with tracebacks and
        # stops reproducing the hosted posture the ``SERVER_MODE`` tests assert.
        "DEBUG": False,
        "MAX_CONTENT_LENGTH": None,
        "BASE_PATH": "/",
        # The shipped default rather than a literal, so it follows a change to it. Not
        # ``DefaultConfig.SESSION_MAX_UPLOADED_REPORTS``, which is the value this pin
        # exists to displace: it binds at import from the environment.
        "SESSION_MAX_UPLOADED_REPORTS": _DEFAULT_SESSION_MAX_UPLOADED_REPORTS,
        "SSH_DEFAULT_PORT": 22,
        "SSH_DEFAULT_PROFILER_PATH": "",
        "SSH_DEFAULT_PERFORMANCE_PATH": "",
        # The allowlist the descriptor would resolve with no operator variable set.
        # Derived from ``DefaultConfig`` rather than written as a literal so it follows a
        # change to the shipped defaults.
        "ALLOWED_ORIGINS": _build_allowed_origins(
            None,
            app_port=DefaultConfig.PORT,
            dev_server_host=DefaultConfig.DEV_SERVER_HOST,
            dev_server_port=DefaultConfig.DEV_SERVER_PORT,
            flask_env=os.getenv("FLASK_ENV", "development"),
        ),
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
