# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Record which hosted session owns an instance.

Revision ID: 002_instance_owner
Revises: 001_instances_schema
Create Date: 2026-11-24

"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "002_instance_owner"
down_revision: str | None = "001_instances_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    existing_columns = {
        column["name"] for column in inspect(op.get_bind()).get_columns("instances")
    }
    # Nullable: local instances never get an owner. `DB_VERSION` moved with this
    # revision, so a hosted database never holds rows from before it, and a release
    # from before it keeps opening its own database file.
    if "owner" not in existing_columns:
        op.add_column("instances", sa.Column("owner", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("instances", "owner")
