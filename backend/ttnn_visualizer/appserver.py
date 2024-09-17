# serve.py
import sys
from os import environ
from gunicorn.app.wsgiapp import run
import pathlib

app_dir = pathlib.Path(__file__).parent.resolve()
config_dir = app_dir.joinpath('config')

def serve():

    # Prepare arguments for Gunicorn
    environ.setdefault('FLASK_ENV', 'production')

    sys.argv = [
        "gunicorn",
        "-c",
        str(config_dir.joinpath('gunicorn.py').absolute()),
        # "-k", "uvicorn.workers.UvicornWorker",
        "ttnn_visualizer.app:create_app()",
    ]
    run()
