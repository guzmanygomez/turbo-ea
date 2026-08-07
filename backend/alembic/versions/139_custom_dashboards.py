"""Add custom_dashboards table.

Revision ID: 122
Revises: 121
Create Date: 2026-07-12
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision: str = "122"
down_revision: Union[str, None] = "121"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "custom_dashboards",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("translations", pg.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column(
            "audience_groups", pg.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "default_for_groups", pg.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("priority", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "owner_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("layout", pg.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_custom_dashboards_status", "custom_dashboards", ["status"])
    op.create_index("ix_custom_dashboards_owner_id", "custom_dashboards", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_dashboards_owner_id", table_name="custom_dashboards")
    op.drop_index("ix_custom_dashboards_status", table_name="custom_dashboards")
    op.drop_table("custom_dashboards")
