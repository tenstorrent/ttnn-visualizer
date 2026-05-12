# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""
Run Alembic migrations against the app SQLite database.

Invoked on application startup (see :func:`ttnn_visualizer.app.extensions`) so
the schema is up to date before the server handles traffic.
"""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)


def run_alembic_migrations(database_uri: str) -> None:
    """
    Apply all Alembic revisions up to ``head``.

    Idempotent: safe to call on every process start (including multiple gunicorn
    workers).
    """
    package_dir = Path(__file__).resolve().parent
    alembic_ini = package_dir / "alembic.ini"
    if not alembic_ini.is_file():
        raise FileNotFoundError(
            f"Alembic config not found at {alembic_ini}. "
            "If running from a source checkout, ensure package data is intact."
        )

    cfg = Config(str(alembic_ini))
    cfg.set_main_option("sqlalchemy.url", database_uri)
    logger.debug("Running Alembic migrations against configured database.")
    command.upgrade(cfg, "head")


def _cli_main() -> None:
    """CLI entrypoint for ``pnpm flask:migrate`` / ``python -m ...database_migrations``."""
    import sys

    from dotenv import load_dotenv

    dotenv_path = Path(__file__).resolve().parent.parent.joinpath(".env")
    if dotenv_path.exists():
        load_dotenv(str(dotenv_path))

    logging.basicConfig(level=logging.INFO)

    from ttnn_visualizer.settings import Config

    uri = Config().SQLALCHEMY_DATABASE_URI
    logger.info("Applying Alembic migrations (target: head).")
    run_alembic_migrations(uri)
    logger.info("Migrations finished.")
    sys.exit(0)


if __name__ == "__main__":
    _cli_main()
