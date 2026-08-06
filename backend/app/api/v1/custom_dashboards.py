"""Custom Dashboards — admin-authored, group-targeted dashboard tabs."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, require_permission
from app.models.custom_dashboard import CustomDashboard
from app.models.user import User
from app.models.user_group import UserGroupMember
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/custom-dashboards", tags=["custom-dashboards"])


# ── Pydantic schemas ───────────────────────────────────────────────────────


class WidgetInstance(BaseModel):
    id: str
    type: str
    title: str = ""
    w: int = 2
    config: dict[str, Any] = {}

    model_config = {"extra": "allow"}


class DashboardCreate(BaseModel):
    name: str
    translations: dict[str, Any] = {}
    audience_groups: list[str] = []
    default_for_groups: list[str] = []
    priority: int = 0
    layout: list[dict[str, Any]] = []


class DashboardUpdate(BaseModel):
    name: str | None = None
    translations: dict[str, Any] | None = None
    audience_groups: list[str] | None = None
    default_for_groups: list[str] | None = None
    priority: int | None = None
    layout: list[dict[str, Any]] | None = None
    status: str | None = None


# ── Helpers ────────────────────────────────────────────────────────────────


def _serialize(d: CustomDashboard, owner_name: str | None = None) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "name": d.name,
        "translations": d.translations or {},
        "status": d.status,
        "audienceGroups": d.audience_groups or [],
        "defaultForGroups": d.default_for_groups or [],
        "priority": d.priority,
        "ownerId": str(d.owner_id) if d.owner_id else None,
        "ownerName": owner_name,
        "layout": d.layout or [],
        "createdAt": d.created_at.isoformat() if d.created_at else None,
        "updatedAt": d.updated_at.isoformat() if d.updated_at else None,
    }


async def _owner_name(db: AsyncSession, owner_id: uuid.UUID | None) -> str | None:
    if not owner_id:
        return None
    result = await db.execute(select(User).where(User.id == owner_id))
    u = result.scalar_one_or_none()
    return u.display_name if u else None


async def _user_group_ids(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    result = await db.execute(
        select(UserGroupMember.group_id).where(UserGroupMember.user_id == user_id)
    )
    return {str(gid) for gid in result.scalars().all()}


# ── Routes ─────────────────────────────────────────────────────────────────


@router.get("")
async def list_dashboards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> list[dict[str, Any]]:
    """List all custom dashboards (admin only)."""
    result = await db.execute(
        select(CustomDashboard).order_by(CustomDashboard.updated_at.desc())
    )
    out = []
    for d in result.scalars().all():
        out.append(_serialize(d, await _owner_name(db, d.owner_id)))
    return out


@router.get("/my")
async def list_my_dashboards(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """Return published dashboards visible to the current user based on group membership."""
    group_ids = await _user_group_ids(db, current_user.id)
    if not group_ids:
        return []

    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.status == "published")
    )
    out = []
    for d in result.scalars().all():
        audience = set(d.audience_groups or [])
        if audience & group_ids:
            out.append(_serialize(d, await _owner_name(db, d.owner_id)))

    # Higher priority first; within equal priority, alphabetical by name
    out.sort(key=lambda x: (-x["priority"], x["name"]))
    return out


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    body: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> dict[str, Any]:
    """Create a new custom dashboard (starts as draft)."""
    dashboard = CustomDashboard(
        name=body.name,
        translations=body.translations,
        status="draft",
        audience_groups=body.audience_groups,
        default_for_groups=[
            g for g in body.default_for_groups if g in body.audience_groups
        ],
        priority=body.priority,
        owner_id=current_user.id,
        layout=body.layout,
    )
    db.add(dashboard)
    await db.flush()
    await event_bus.publish(
        "custom_dashboard.created",
        {"dashboard_id": str(dashboard.id), "name": dashboard.name},
        db=db,
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(dashboard)
    return _serialize(dashboard, current_user.display_name)


@router.get("/{dashboard_id}")
async def get_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Get a dashboard. Admins see any; others only see published ones they're in audience for."""
    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    is_admin = await PermissionService.check_permission(db, current_user, "dashboard.manage")
    if not is_admin:
        if dashboard.status != "published":
            raise HTTPException(status_code=404, detail="Dashboard not found")
        group_ids = await _user_group_ids(db, current_user.id)
        if not (set(dashboard.audience_groups or []) & group_ids):
            raise HTTPException(status_code=403, detail="Not in audience for this dashboard")

    return _serialize(dashboard, await _owner_name(db, dashboard.owner_id))


@router.patch("/{dashboard_id}")
async def update_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> dict[str, Any]:
    """Update a custom dashboard."""
    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    if body.name is not None:
        dashboard.name = body.name
    if body.translations is not None:
        dashboard.translations = body.translations
    if body.audience_groups is not None:
        dashboard.audience_groups = body.audience_groups
    if body.default_for_groups is not None:
        effective_audience = (
            body.audience_groups
            if body.audience_groups is not None
            else (dashboard.audience_groups or [])
        )
        dashboard.default_for_groups = [
            g for g in body.default_for_groups if g in effective_audience
        ]
    if body.priority is not None:
        dashboard.priority = body.priority
    if body.layout is not None:
        dashboard.layout = body.layout
    if body.status is not None and body.status in ("draft", "published"):
        dashboard.status = body.status

    await event_bus.publish(
        "custom_dashboard.updated",
        {"dashboard_id": str(dashboard.id), "name": dashboard.name},
        db=db,
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(dashboard)
    return _serialize(dashboard, await _owner_name(db, dashboard.owner_id))


@router.post("/{dashboard_id}/publish")
async def publish_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> dict[str, Any]:
    """Set a dashboard to published status."""
    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    dashboard.status = "published"
    await event_bus.publish(
        "custom_dashboard.published",
        {"dashboard_id": str(dashboard.id), "name": dashboard.name},
        db=db,
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(dashboard)
    return _serialize(dashboard, await _owner_name(db, dashboard.owner_id))


@router.post("/{dashboard_id}/unpublish")
async def unpublish_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> dict[str, Any]:
    """Revert a published dashboard to draft."""
    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    dashboard.status = "draft"
    await event_bus.publish(
        "custom_dashboard.unpublished",
        {"dashboard_id": str(dashboard.id), "name": dashboard.name},
        db=db,
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(dashboard)
    return _serialize(dashboard, await _owner_name(db, dashboard.owner_id))


@router.post("/{dashboard_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> dict[str, Any]:
    """Duplicate a dashboard as a new draft."""
    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.id == dashboard_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    copy = CustomDashboard(
        name=f"{source.name} (copy)",
        translations=source.translations,
        status="draft",
        audience_groups=source.audience_groups,
        default_for_groups=[],
        priority=source.priority,
        owner_id=current_user.id,
        layout=source.layout,
    )
    db.add(copy)
    await db.flush()
    await event_bus.publish(
        "custom_dashboard.created",
        {
            "dashboard_id": str(copy.id),
            "name": copy.name,
            "duplicated_from": str(source.id),
        },
        db=db,
        user_id=current_user.id,
    )
    await db.commit()
    await db.refresh(copy)
    return _serialize(copy, current_user.display_name)


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.manage")),
) -> None:
    """Permanently delete a custom dashboard."""
    result = await db.execute(
        select(CustomDashboard).where(CustomDashboard.id == dashboard_id)
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    await event_bus.publish(
        "custom_dashboard.deleted",
        {"dashboard_id": str(dashboard.id), "name": dashboard.name},
        db=db,
        user_id=current_user.id,
    )
    await db.delete(dashboard)
    await db.commit()
