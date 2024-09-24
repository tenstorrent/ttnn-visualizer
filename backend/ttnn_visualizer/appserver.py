import os
import pathlib
import sys

from gunicorn.app.wsgiapp import run

app_dir = pathlib.Path(__file__).parent.resolve()
config_dir = app_dir.joinpath("config")
static_assets_dir = app_dir.joinpath("static")


def serve():
    os.environ.setdefault("FLASK_ENV", "production")
    os.environ.setdefault("STATIC_ASSETS", str(static_assets_dir))
    sys.argv = [
        "gunicorn",
        "-c",
        str(config_dir.joinpath("gunicorn.py").absolute()),
        "ttnn_visualizer.app:create_app()",
    ]
    run()
