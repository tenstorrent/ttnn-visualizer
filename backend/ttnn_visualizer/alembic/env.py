# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import create_engine, pool

# Import models so ``db.metadata`` is populated for autogenerate workflows.
_backend_root = Path(__file__).resolve().parent.parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

from ttnn_visualizer import models  # noqa: F401, E402
from ttnn_visualizer.extensions import db  # noqa: E402

config = context.config

# When invoked embedded in the running app, the app has already configured
# logging; ``fileConfig`` would reset the root logger to WARN and (with its
# default ``disable_existing_loggers=True``) silence every ``ttnn_visualizer.*``
# logger for the rest of the process. ``run_alembic_migrations`` sets this flag
# to skip that; the standalone ``alembic`` CLI leaves it unset so logging is
# still configured from ``alembic.ini``.
if config.config_file_name is not None and config.attributes.get(
    "configure_logging", True
):
    fileConfig(config.config_file_name)

target_metadata = db.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        config.get_main_option("sqlalchemy.url"),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
