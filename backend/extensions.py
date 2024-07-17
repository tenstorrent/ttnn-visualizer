from flask_sqlalchemy import SQLAlchemy
from flask_static_digest import FlaskStaticDigest
from flask_marshmallow import Marshmallow

db = SQLAlchemy()
flask_static_digest = FlaskStaticDigest()
ma = Marshmallow()
