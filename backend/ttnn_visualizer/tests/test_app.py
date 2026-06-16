# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

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
