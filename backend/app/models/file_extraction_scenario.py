from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDMixin


class FileExtractionScenario(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "file_extraction_scenarios"

    card_type_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Lists of field keys / subtype keys / file-category keys stored as JSONB arrays
    target_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    linked_subtypes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    linked_file_categories: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
