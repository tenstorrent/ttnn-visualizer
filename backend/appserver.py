# serve.py
import sys
from gunicorn.app.wsgiapp import run


def serve():
    # Prepare arguments for Gunicorn
    sys.argv = [
        "gunicorn",
        "-c",
        "backend/config/gunicorn.py",
        # "-k", "uvicorn.workers.UvicornWorker",
        "backend.app:create_app()",
    ]
    run()
