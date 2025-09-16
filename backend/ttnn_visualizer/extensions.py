# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from flask_static_digest import FlaskStaticDigest

flask_static_digest = FlaskStaticDigest()
# Initialize Flask SQLAlchemy
db = SQLAlchemy()

socketio = SocketIO(cors_allowed_origins="*", async_mode="gevent")
