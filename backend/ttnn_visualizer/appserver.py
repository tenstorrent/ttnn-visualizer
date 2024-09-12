# serve.py
import sys
from gunicorn.app.wsgiapp import run
import pathlib

app_dir = pathlib.Path(__file__).parent.resolve()
config_dir = app_dir.joinpath('config')

def serve():
    # Prepare arguments for Gunicorn
    sys.argv = [
        "gunicorn",
        "-c",
        str(config_dir.joinpath('gunicorn.py').absolute()),
        # "-k", "uvicorn.workers.UvicornWorker",
        "ttnn_visualizer.app:create_app()",
    ]
    run()
