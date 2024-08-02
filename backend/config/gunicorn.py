# -*- coding: utf-8 -*-

import multiprocessing
import os
from distutils.util import strtobool
from pathlib import Path

from dotenv import load_dotenv

# Load dotenv from root directory
dotenv_path = Path(__file__).parent.parent.parent.joinpath('.env')
print(f"Looking for .env at {dotenv_path}")
if dotenv_path.exists():
    print('Loading .env file')
    load_dotenv(str(dotenv_path))

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
accesslog = "-"
access_log_format = "%(h)s %(l)s %(u)s %(t)s '%(r)s' %(s)s %(b)s '%(f)s' '%(a)s' in %(D)sµs"  # noqa: E501

workers = int(os.getenv("WEB_CONCURRENCY", multiprocessing.cpu_count() * 2))
threads = int(os.getenv("PYTHON_MAX_THREADS", 1))

reload = bool(strtobool(os.getenv("WEB_RELOAD", "false")))
