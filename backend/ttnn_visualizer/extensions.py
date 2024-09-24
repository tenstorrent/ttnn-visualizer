from flask_marshmallow import Marshmallow
from flask_sqlalchemy import SQLAlchemy
from flask_static_digest import FlaskStaticDigest


class SQLiteAlchemy(SQLAlchemy):
    def apply_driver_hacks(self, app, info, options):
        options.update(
            {
                "isolation_level": "AUTOCOMMIT",
            }
        )
        super(SQLiteAlchemy, self).apply_driver_hacks(app, info, options)


db = SQLiteAlchemy()
flask_static_digest = FlaskStaticDigest()
ma = Marshmallow()
