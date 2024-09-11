# serve.py
import sys
from gunicorn.app.wsgiapp import run
from backend.app import create_app

app = create_app()
