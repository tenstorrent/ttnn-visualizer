from flask_socketio import SocketIO
from flask_static_digest import FlaskStaticDigest
from flask_sqlalchemy import SQLAlchemy


flask_static_digest = FlaskStaticDigest()
# Initialize Flask SQLAlchemy
db = SQLAlchemy()

socketio = SocketIO(cors_allowed_origins="*", async_mode="gevent")
