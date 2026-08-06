from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.models.base import Base, TimestampMixin, UUIDMixin


class CustomDashboard(Base, UUIDMixin, TimestampMixin):
    """Admin-authored dashboard shown as a tab to specific user groups."""

    __tablename__ = "custom_dashboards"

    name = Column(String(200), nullable=False)
    translations = Column(JSONB, nullable=False, default={}, server_default=sa.text("'{}'::jsonb"))
    # "draft" | "published"
    status = Column(String(20), nullable=False, default="draft", server_default="draft")
    # List of UserGroup UUID strings — only users in these groups see this tab
    audience_groups = Column(
        JSONB, nullable=False, default=[], server_default=sa.text("'[]'::jsonb")
    )
    # Subset of audience_groups: users in these groups get this as their default landing tab
    default_for_groups = Column(
        JSONB, nullable=False, default=[], server_default=sa.text("'[]'::jsonb")
    )
    # Tie-break when multiple dashboards claim the default for the same group
    priority = Column(Integer, nullable=False, default=0, server_default="0")
    owner_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Ordered list of widget instances [{id, type, title, w, config}]
    layout = Column(JSONB, nullable=False, default=[], server_default=sa.text("'[]'::jsonb"))
