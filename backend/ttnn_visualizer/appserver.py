import os
import pathlib
import sys

from gunicorn.app.wsgiapp import run

from ttnn_visualizer.settings import Config

app_dir = pathlib.Path(__file__).parent.resolve()
config_dir = app_dir.joinpath("config")
static_assets_dir = app_dir.joinpath("static")


def serve():
    """Run command for use in wheel package entrypoint"""
    config = Config()

    os.environ.setdefault("FLASK_ENV", "production")
    os.environ.setdefault("STATIC_ASSETS", str(static_assets_dir))

    sys.argv = [
        "gunicorn",
        "-k",
        config.GUNICORN_WORKER_CLASS,
        "-w",
        config.GUNICORN_WORKERS,
        "-b",
        config.GUNICORN_BIND,
        config.GUNICORN_APP_MODULE,
    ]

    run()
