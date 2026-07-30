# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from flask_static_digest import FlaskStaticDigest

flask_static_digest = FlaskStaticDigest()
# Initialize Flask SQLAlchemy
db = SQLAlchemy()

# Origins are supplied at init_app time from ALLOWED_ORIGINS: the socket handshake
# carries the same instance-scoped report and file-transfer data as the HTTP API, so it
# has to honour the same allowlist rather than accept every origin.
socketio = SocketIO(async_mode="gevent")
