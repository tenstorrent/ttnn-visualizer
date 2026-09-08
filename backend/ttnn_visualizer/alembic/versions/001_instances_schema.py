# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Baseline ``instances`` table and nullable-column upgrades for legacy DBs.

Revision ID: 001_instances_schema
Revises:
Create Date: 2026-05-11

"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "001_instances_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "instances" not in table_names:
        op.create_table(
            "instances",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("instance_id", sa.String(), nullable=False),
            sa.Column("profiler_path", sa.String(), nullable=True),
            sa.Column("performance_path", sa.String(), nullable=True),
            sa.Column("npe_path", sa.String(), nullable=True),
            sa.Column("mlir_path", sa.String(), nullable=True),
            sa.Column(
                "active_report",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
            sa.Column("remote_connection", sa.JSON(), nullable=True),
            sa.Column("remote_profiler_folder", sa.JSON(), nullable=True),
            sa.Column("remote_performance_folder", sa.JSON(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("instance_id"),
        )
        return

    existing_columns = {c["name"] for c in inspector.get_columns("instances")}
    nullable_additions: list[tuple[str, sa.types.TypeEngine]] = [
        ("profiler_path", sa.String()),
        ("performance_path", sa.String()),
        ("npe_path", sa.String()),
        ("mlir_path", sa.String()),
        ("remote_connection", sa.JSON()),
        ("remote_profiler_folder", sa.JSON()),
        ("remote_performance_folder", sa.JSON()),
    ]
    for column_name, column_type in nullable_additions:
        if column_name not in existing_columns:
            op.add_column(
                "instances",
                sa.Column(column_name, column_type, nullable=True),
            )

    if "active_report" not in existing_columns:
        op.add_column(
            "instances",
            sa.Column(
                "active_report",
                sa.JSON(),
                nullable=False,
                server_default=sa.text("'{}'"),
            ),
        )


def downgrade() -> None:
    raise NotImplementedError(
        "Downgrade is not supported for the baseline instances migration."
    )
