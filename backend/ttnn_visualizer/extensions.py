from flask_static_digest import FlaskStaticDigest
from flask_sqlalchemy import SQLAlchemy
from flask_session import Session


flask_static_digest = FlaskStaticDigest()
# Initialize Flask SQLAlchemy
db = SQLAlchemy()


# Initialize Flask-Session
session = Session()
