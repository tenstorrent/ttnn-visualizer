# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import os
import subprocess
import sys
from pathlib import Path

from ttnn_visualizer.app import StandaloneGunicornApplication


class FakeGunicornConfig:
    settings = {
        "timeout": object(),
        "workers": object(),
    }

    def __init__(self):
        self.value_by_key = {}

    def set(self, key, value):
        self.value_by_key[key] = value


def test_standalone_gunicorn_loads_local_config_before_options(tmp_path, monkeypatch):
    (tmp_path / "gunicorn.conf.py").write_text("timeout = 5\n")
    monkeypatch.chdir(tmp_path)

    app = StandaloneGunicornApplication.__new__(StandaloneGunicornApplication)
    app.cfg = FakeGunicornConfig()
    app.options = {
        "timeout": "60",
        "workers": "2",
        "unknown": "ignored",
        "bind": None,
    }
    loaded_config_file_by_path = {}

    def load_config_from_file(path):
        loaded_config_file_by_path[path] = dict(app.cfg.value_by_key)

    app.load_config_from_file = load_config_from_file

    app.load_config()

    assert loaded_config_file_by_path == {"gunicorn.conf.py": {}}
    assert app.cfg.value_by_key == {
        "timeout": "60",
        "workers": "2",
    }


def test_importing_app_module_does_not_eagerly_import_flask_stack():
    backend_path = Path(__file__).resolve().parents[2]
    env = os.environ.copy()
    env["PYTHONPATH"] = (
        f"{backend_path}{os.pathsep}{env['PYTHONPATH']}"
        if env.get("PYTHONPATH")
        else str(backend_path)
    )

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                "import ttnn_visualizer.app; "
                "eager = {'flask', 'flask_cors', 'werkzeug'} & set(sys.modules); "
                "raise SystemExit(','.join(sorted(eager)))"
            ),
        ],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
