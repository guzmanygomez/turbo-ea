"""File extraction scenario CRUD — admin configuration for AI field extraction on uploads."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.file_extraction_scenario import FileExtractionScenario
from app.models.user import User
from app.services.permission_service import PermissionService

router = APIRouter(tags=["file-extraction"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class ScenarioCreate(BaseModel):
    card_type_key: str
    instructions: str
    target_fields: list[str] = []
    linked_subtypes: list[str] = []
    linked_file_categories: list[str] = []
    is_active: bool = True


class ScenarioUpdate(BaseModel):
    instructions: str | None = None
    target_fields: list[str] | None = None
    linked_subtypes: list[str] | None = None
    linked_file_categories: list[str] | None = None
    is_active: bool | None = None


def _to_dict(s: FileExtractionScenario) -> dict[str, Any]:
    return {
        "id": str(s.id),
        "card_type_key": s.card_type_key,
        "instructions": s.instructions,
        "target_fields": list(s.target_fields or []),
        "linked_subtypes": list(s.linked_subtypes or []),
        "linked_file_categories": list(s.linked_file_categories or []),
        "is_active": s.is_active,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/file-extraction/scenarios")
async def list_scenarios(
    card_type_key: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(FileExtractionScenario)
        .where(FileExtractionScenario.card_type_key == card_type_key)
        .order_by(FileExtractionScenario.created_at)
    )
    return [_to_dict(s) for s in result.scalars().all()]


@router.post("/file-extraction/scenarios", status_code=201)
async def create_scenario(
    body: ScenarioCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    s = FileExtractionScenario(
        card_type_key=body.card_type_key,
        instructions=body.instructions,
        target_fields=body.target_fields,
        linked_subtypes=body.linked_subtypes,
        linked_file_categories=body.linked_file_categories,
        is_active=body.is_active,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _to_dict(s)


@router.patch("/file-extraction/scenarios/{scenario_id}")
async def update_scenario(
    scenario_id: str,
    body: ScenarioUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(FileExtractionScenario).where(FileExtractionScenario.id == uuid.UUID(scenario_id))
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Scenario not found")

    if body.instructions is not None:
        s.instructions = body.instructions
    if body.target_fields is not None:
        s.target_fields = body.target_fields
    if body.linked_subtypes is not None:
        s.linked_subtypes = body.linked_subtypes
    if body.linked_file_categories is not None:
        s.linked_file_categories = body.linked_file_categories
    if body.is_active is not None:
        s.is_active = body.is_active

    await db.commit()
    await db.refresh(s)
    return _to_dict(s)


@router.delete("/file-extraction/scenarios/{scenario_id}", status_code=204)
async def delete_scenario(
    scenario_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    result = await db.execute(
        select(FileExtractionScenario).where(FileExtractionScenario.id == uuid.UUID(scenario_id))
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Scenario not found")
    await db.delete(s)
    await db.commit()
