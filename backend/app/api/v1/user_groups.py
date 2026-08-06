from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.user import User
from app.models.user_group import UserGroup, UserGroupMember
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/user-groups", tags=["user-groups"])

GROUP_TYPES = {"domain", "functional", "other"}


class UserGroupCreate(BaseModel):
    key: str
    name: str
    description: str | None = None
    color: str = "#757575"
    group_type: str = "other"
    sort_order: int = 0


class UserGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    group_type: str | None = None
    sort_order: int | None = None


class GroupMemberUpdate(BaseModel):
    user_ids: list[str]


def _group_response(g: UserGroup, member_count: int = 0) -> dict:
    return {
        "id": str(g.id),
        "key": g.key,
        "name": g.name,
        "description": g.description,
        "color": g.color,
        "group_type": g.group_type,
        "sort_order": g.sort_order,
        "member_count": member_count,
        "created_at": g.created_at.isoformat() if g.created_at else None,
        "updated_at": g.updated_at.isoformat() if g.updated_at else None,
    }


@router.get("")
async def list_user_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "admin.users")
    result = await db.execute(select(UserGroup).order_by(UserGroup.sort_order, UserGroup.name))
    groups = result.scalars().all()

    counts_result = await db.execute(
        select(UserGroupMember.group_id, func.count(UserGroupMember.user_id)).group_by(
            UserGroupMember.group_id
        )
    )
    counts = {row[0]: row[1] for row in counts_result.all()}

    return [_group_response(g, counts.get(g.id, 0)) for g in groups]


@router.post("", status_code=201)
async def create_user_group(
    body: UserGroupCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "admin.users")

    if body.group_type not in GROUP_TYPES:
        raise HTTPException(400, f"Invalid group_type. Must be one of: {sorted(GROUP_TYPES)}")

    existing = await db.execute(select(UserGroup).where(UserGroup.key == body.key))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"A group with key '{body.key}' already exists")

    g = UserGroup(
        key=body.key,
        name=body.name,
        description=body.description,
        color=body.color,
        group_type=body.group_type,
        sort_order=body.sort_order,
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return _group_response(g)


@router.patch("/{group_id}")
async def update_user_group(
    group_id: str,
    body: UserGroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "admin.users")

    result = await db.execute(select(UserGroup).where(UserGroup.id == uuid.UUID(group_id)))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Group not found")

    data = body.model_dump(exclude_unset=True)
    if "group_type" in data and data["group_type"] not in GROUP_TYPES:
        raise HTTPException(400, f"Invalid group_type. Must be one of: {sorted(GROUP_TYPES)}")

    for field, value in data.items():
        setattr(g, field, value)

    await db.commit()
    count_result = await db.execute(
        select(func.count(UserGroupMember.user_id)).where(UserGroupMember.group_id == g.id)
    )
    return _group_response(g, count_result.scalar() or 0)


@router.delete("/{group_id}", status_code=204)
async def delete_user_group(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "admin.users")

    result = await db.execute(select(UserGroup).where(UserGroup.id == uuid.UUID(group_id)))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(404, "Group not found")

    await db.delete(g)
    await db.commit()


@router.get("/{group_id}/members")
async def list_group_members(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, current_user, "admin.users")
    result = await db.execute(
        select(UserGroupMember.user_id).where(UserGroupMember.group_id == uuid.UUID(group_id))
    )
    return [str(row[0]) for row in result.all()]


@router.put("/{group_id}/members")
async def set_group_members(
    group_id: str,
    body: GroupMemberUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Replace the full member list for a group (idempotent upsert)."""
    await PermissionService.require_permission(db, current_user, "admin.users")

    g_uuid = uuid.UUID(group_id)
    g_result = await db.execute(select(UserGroup).where(UserGroup.id == g_uuid))
    if not g_result.scalar_one_or_none():
        raise HTTPException(404, "Group not found")

    try:
        user_uuids = [uuid.UUID(i) for i in body.user_ids]
    except ValueError as exc:
        raise HTTPException(400, f"Invalid user id: {exc}") from exc

    await db.execute(delete(UserGroupMember).where(UserGroupMember.group_id == g_uuid))
    for uid in user_uuids:
        db.add(UserGroupMember(user_id=uid, group_id=g_uuid))
    await db.commit()
    return {"group_id": group_id, "member_count": len(user_uuids)}
