# -*- coding: utf-8 -*-

import os
from pathlib import Path

from dotenv import load_dotenv

from ttnn_visualizer.utils import str_to_bool

# Load dotenv from root directory
dotenv_path = Path(__file__).parent.parent.parent.joinpath(".env")
if dotenv_path.exists():
    load_dotenv(str(dotenv_path))

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
accesslog = "-"
access_log_format = "%(h)s %(l)s %(u)s %(t)s '%(r)s' %(s)s %(b)s '%(f)s' '%(a)s' in %(D)sµs"  # noqa: E501

reload = bool(str_to_bool(os.getenv("WEB_RELOAD", "false")))

worker_class = "gevent"

workers = 1
