"""Add file_extraction_scenarios table.

Revision ID: 135
Revises: 134
Create Date: 2026-07-08
"""

from typing import Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "135"
down_revision: Union[str, None] = "134"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.create_table(
        "file_extraction_scenarios",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("card_type_key", sa.String(100), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("target_fields", postgresql.JSONB(), nullable=False),
        sa.Column("linked_subtypes", postgresql.JSONB(), nullable=False),
        sa.Column("linked_file_categories", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_file_extraction_scenarios_card_type_key",
        "file_extraction_scenarios",
        ["card_type_key"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_file_extraction_scenarios_card_type_key", table_name="file_extraction_scenarios"
    )
    op.drop_table("file_extraction_scenarios")
