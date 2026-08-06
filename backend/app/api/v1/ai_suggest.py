"""AI-powered metadata suggestion endpoint."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings as app_config
from app.core.encryption import decrypt_value
from app.database import get_db
from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.ea_principle import EAPrinciple
from app.models.user import User
from app.schemas.ai_suggest import (
    AiSuggestRequest,
    AiSuggestResponse,
    PortfolioInsightsRequest,
    PortfolioInsightsResponse,
)
from app.services.ai_service import (
    DEFAULT_AZURE_API_VERSION,
    call_llm,
    fetch_running_models,
    generate_portfolio_insights,
    suggest_metadata,
)
from app.services.file_extraction_service import extract_text
from app.services.permission_service import PermissionService

logger = logging.getLogger("turboea.ai")

router = APIRouter(prefix="/ai", tags=["AI Suggestions"])


def _get_ai_config(general: dict) -> dict:
    """Resolve AI configuration from DB settings with env-var fallback."""
    ai = general.get("ai", {})
    encrypted_key = ai.get("apiKey", "")
    return {
        "enabled": ai.get("enabled", False),
        "provider_type": ai.get("providerType", "ollama"),
        "provider_url": ai.get("providerUrl") or app_config.AI_PROVIDER_URL,
        "api_key": decrypt_value(encrypted_key) if encrypted_key else "",
        "model": ai.get("model") or app_config.AI_MODEL,
        "api_version": ai.get("apiVersion", DEFAULT_AZURE_API_VERSION),
        "search_provider": "duckduckgo",
        "search_url": "",
        "enabled_types": ai.get("enabledTypes", []),
        "portfolio_insights_enabled": ai.get("portfolioInsightsEnabled", False),
    }


@router.post("/suggest", response_model=AiSuggestResponse)
async def suggest(
    body: AiSuggestRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate AI-powered metadata suggestions for a card.

    Uses a two-step pipeline: web search → local LLM extraction.
    """
    await PermissionService.require_permission(db, user, "ai.suggest")

    # Load AI configuration
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    if not ai_cfg["enabled"]:
        raise HTTPException(
            status_code=400,
            detail="AI suggestions are not enabled. An admin must configure this in Settings.",
        )

    if not ai_cfg["provider_url"] or not ai_cfg["model"]:
        raise HTTPException(
            status_code=400,
            detail="AI provider URL and model must be configured in Settings.",
        )

    # Commercial providers require an API key
    if ai_cfg["provider_type"] in ("openai", "azure_openai", "anthropic") and not ai_cfg["api_key"]:
        raise HTTPException(
            status_code=400,
            detail="API key is required for commercial LLM providers.",
        )

    # Validate that the card type is enabled for AI suggestions
    if ai_cfg["enabled_types"] and body.type_key not in ai_cfg["enabled_types"]:
        raise HTTPException(
            status_code=400,
            detail=f"AI suggestions are not enabled for card type '{body.type_key}'.",
        )

    # Fetch the card type definition
    ct_result = await db.execute(select(CardType).where(CardType.key == body.type_key))
    card_type = ct_result.scalar_one_or_none()
    if not card_type:
        raise HTTPException(status_code=404, detail=f"Card type '{body.type_key}' not found")

    try:
        result_data = await suggest_metadata(
            name=body.name,
            type_key=body.type_key,
            type_label=card_type.label,
            subtype=body.subtype,
            provider_url=ai_cfg["provider_url"],
            model=ai_cfg["model"],
            context=body.context,
            provider_type=ai_cfg["provider_type"],
            api_key=ai_cfg["api_key"],
            api_version=ai_cfg["api_version"],
            fields_schema=card_type.fields_schema or [],
        )
    except httpx.HTTPError as exc:
        logger.warning("AI suggestion failed for '%s': %s", body.name, exc)
        raise HTTPException(
            status_code=502,
            detail="Could not reach the AI provider. Check that it is running and accessible.",
        ) from exc
    except Exception as exc:
        logger.exception("AI suggestion failed for '%s'", body.name)
        raise HTTPException(
            status_code=502,
            detail="AI suggestion failed. Check server logs for details.",
        ) from exc

    return AiSuggestResponse(**result_data)


@router.post("/portfolio-insights", response_model=PortfolioInsightsResponse)
async def portfolio_insights(
    body: PortfolioInsightsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate AI-driven insights for the application portfolio report."""
    await PermissionService.require_permission(db, user, "ai.portfolio_insights")

    # Load AI configuration
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    if not ai_cfg["portfolio_insights_enabled"]:
        raise HTTPException(
            status_code=400,
            detail="AI portfolio insights are not enabled. An admin must enable this in Settings.",
        )

    if not ai_cfg["provider_url"] or not ai_cfg["model"]:
        raise HTTPException(
            status_code=400,
            detail="AI provider URL and model must be configured in Settings.",
        )

    if ai_cfg["provider_type"] in ("openai", "azure_openai", "anthropic") and not ai_cfg["api_key"]:
        raise HTTPException(
            status_code=400,
            detail="API key is required for commercial LLM providers.",
        )

    # Load active EA principles
    principles_result = await db.execute(
        select(EAPrinciple)
        .where(EAPrinciple.is_active == True)  # noqa: E712
        .order_by(EAPrinciple.sort_order)
    )
    principles = [
        {
            "title": p.title,
            "description": p.description or "",
            "rationale": p.rationale or "",
            "implications": p.implications or "",
        }
        for p in principles_result.scalars().all()
    ]

    try:
        result_data = await generate_portfolio_insights(
            summary=body.model_dump(),
            provider_url=ai_cfg["provider_url"],
            model=ai_cfg["model"],
            provider_type=ai_cfg["provider_type"],
            api_key=ai_cfg["api_key"],
            api_version=ai_cfg["api_version"],
            principles=principles,
        )
    except httpx.HTTPError as exc:
        logger.warning("AI portfolio insights failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Could not reach the AI provider. Check that it is running and accessible.",
        ) from exc
    except Exception as exc:
        logger.exception("AI portfolio insights failed")
        raise HTTPException(
            status_code=502,
            detail="AI portfolio insights failed. Check server logs for details.",
        ) from exc

    return PortfolioInsightsResponse(**result_data)


def _build_quick_extract_prompt(
    target_fields: list[dict[str, Any]], document_text: str
) -> list[dict[str, str]]:
    """Build a single-message prompt asking for field values + confidence scores."""
    specs: list[str] = []
    template_parts: list[str] = []
    for f in target_fields:
        key = f.get("key", "")
        label = f.get("label", key)
        ftype = f.get("type", "text")
        spec = f'  "{key}" — {label}'
        if ftype in ("single_select", "multiple_select") and f.get("options"):
            opts = [o.get("key", "") for o in f["options"]]
            spec += f" (must be one of: {opts})"
        elif ftype == "date":
            spec += " (ISO 8601: YYYY-MM-DD)"
        elif ftype in ("number", "cost"):
            spec += " (numeric value only)"
        elif ftype == "boolean":
            spec += " (true or false)"
        specs.append(spec)
        template_parts.append(f'  "{key}": {{"value": null, "confidence": 0.0, "source": null}}')

    template = "{\n" + ",\n".join(template_parts) + "\n}"
    field_block = "\n".join(specs)

    prompt = (
        "You are a document data-extraction assistant.\n\n"
        "Return ONLY a valid JSON object. For each key, provide an object with:\n"
        '- "value": the extracted value (matching any stated constraints, or null if not found)\n'
        '- "confidence": a number from 0.0 to 1.0 indicating your certainty\n'
        '- "source": a brief verbatim quote from the document supporting the value (or null)\n\n'
        "Include every key. Do not add or remove keys.\n\n"
        f"Template:\n{template}\n\n"
        f"Fields to extract:\n{field_block}\n\n"
        f"Document:\n{document_text}"
    )
    return [{"role": "user", "content": prompt}]


def _heuristic_confidence(value: Any, field_def: dict[str, Any]) -> float:
    """Assign a confidence score when the LLM returned a plain value, not a structured object."""
    if value is None:
        return 0.0
    ftype = field_def.get("type", "text")
    if ftype == "single_select":
        valid = {o.get("key", "") for o in field_def.get("options", [])}
        return 0.9 if str(value) in valid else 0.3
    if ftype == "multiple_select":
        if isinstance(value, list):
            valid = {o.get("key", "") for o in field_def.get("options", [])}
            matched = sum(1 for v in value if v in valid)
            return 0.9 if matched == len(value) > 0 else 0.5
        return 0.3
    if ftype == "boolean":
        return 0.9 if isinstance(value, bool) else 0.5
    if ftype in ("number", "cost"):
        try:
            float(str(value))
            return 0.85
        except (TypeError, ValueError):
            return 0.3
    return 0.75


@router.post("/quick-extract")
async def quick_extract_fields(
    file: UploadFile = File(...),
    type_key: str = Form(...),
    field_keys: str = Form(""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Extract field values with per-field confidence scores from an uploaded document.

    Used by the AI Quick Create dashboard widget. Accepts multipart/form-data with
    the target file, card type key, and a comma-separated list of field keys to
    extract. Requires the ai.suggest permission and a configured AI provider.
    """
    await PermissionService.require_permission(db, user, "ai.suggest")

    # Load AI config
    settings_result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    settings_row = settings_result.scalar_one_or_none()
    general = (settings_row.general_settings if settings_row else None) or {}
    ai_cfg = _get_ai_config(general)

    if not ai_cfg["enabled"]:
        raise HTTPException(status_code=400, detail="AI is not enabled.")
    if not ai_cfg["provider_url"] or not ai_cfg["model"]:
        raise HTTPException(
            status_code=400, detail="AI provider URL and model must be configured in Settings."
        )
    if ai_cfg["provider_type"] in ("openai", "azure_openai", "anthropic") and not ai_cfg["api_key"]:
        raise HTTPException(
            status_code=400, detail="API key is required for commercial LLM providers."
        )

    # Read and validate file
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds the 10 MB size limit.")

    mime_type = file.content_type or "application/octet-stream"
    document_text = extract_text(content, mime_type)
    if not document_text.strip():
        raise HTTPException(
            status_code=400,
            detail="Could not extract text from the uploaded file. "
            "Supported formats: PDF, DOCX, XLSX, TXT, CSV.",
        )

    # Load card type and requested field definitions
    ct_result = await db.execute(select(CardType).where(CardType.key == type_key))
    card_type = ct_result.scalar_one_or_none()
    if not card_type:
        raise HTTPException(status_code=404, detail=f"Card type '{type_key}' not found.")

    # Virtual (built-in) field definitions — keys not stored in fields_schema
    virtual_fields: dict[str, dict[str, Any]] = {
        "name": {"key": "name", "label": "Name", "type": "text"},
        "description": {"key": "description", "label": "Description", "type": "text"},
        "lifecycle_plan": {"key": "lifecycle_plan", "label": "Plan Date", "type": "date"},
        "lifecycle_phaseIn": {"key": "lifecycle_phaseIn", "label": "Phase-in Date", "type": "date"},
        "lifecycle_active": {"key": "lifecycle_active", "label": "Active Date", "type": "date"},
        "lifecycle_phaseOut": {
            "key": "lifecycle_phaseOut",
            "label": "Phase-out Date",
            "type": "date",
        },
        "lifecycle_endOfLife": {
            "key": "lifecycle_endOfLife",
            "label": "End of Life Date",
            "type": "date",
        },
    }

    requested_keys = [k.strip() for k in field_keys.split(",") if k.strip()] if field_keys else []

    all_fields: dict[str, dict[str, Any]] = {}
    for section in card_type.fields_schema or []:
        for field in section.get("fields", []):
            all_fields[field["key"]] = field

    target_fields: list[dict[str, Any]] = []
    for k in requested_keys:
        if k == "subtype":
            subtypes = card_type.subtypes or []
            opts = [
                {"key": s.get("key", ""), "label": s.get("label", s.get("key", ""))}
                for s in subtypes
            ]
            target_fields.append(
                {"key": "subtype", "label": "Subtype", "type": "single_select", "options": opts}
            )
        elif k in virtual_fields:
            target_fields.append(virtual_fields[k])
        elif k in all_fields:
            target_fields.append(all_fields[k])

    if not target_fields:
        raise HTTPException(status_code=400, detail="No valid fields found for extraction.")

    # Build the prompt and call the LLM
    doc_snippet = document_text[:6_000]
    messages = _build_quick_extract_prompt(target_fields, doc_snippet)
    extra: dict[str, Any] = {"num_ctx": 4096} if ai_cfg["provider_type"] == "ollama" else {}
    try:
        raw = await call_llm(
            provider_url=ai_cfg["provider_url"],
            model=ai_cfg["model"],
            messages=messages,
            provider_type=ai_cfg["provider_type"],
            api_key=ai_cfg["api_key"] or None,
            api_version=ai_cfg.get("api_version"),
            extra_options=extra,
            request_timeout=120.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("quick-extract LLM call failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Could not reach the AI provider. Check that it is running and accessible.",
        ) from exc
    except Exception as exc:
        logger.exception("quick-extract failed")
        raise HTTPException(
            status_code=502, detail="AI extraction failed. Check server logs for details."
        ) from exc

    # Normalise the response: accept both structured {value, confidence, source} and plain values
    fields_result: dict[str, Any] = {}
    for fdef in target_fields:
        key = fdef["key"]
        extracted = raw.get(key) if isinstance(raw, dict) else None
        if isinstance(extracted, dict) and "value" in extracted:
            fields_result[key] = {
                "value": extracted.get("value"),
                "confidence": float(extracted.get("confidence") or 0.7),
                "source": extracted.get("source"),
            }
        else:
            fields_result[key] = {
                "value": extracted,
                "confidence": _heuristic_confidence(extracted, fdef),
                "source": None,
            }

    return {"fields": fields_result}


@router.get("/status")
async def ai_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Check whether AI suggestions are enabled and configured.

    Returns the status without exposing secrets.
    """
    result = await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    row = result.scalar_one_or_none()
    general = (row.general_settings if row else None) or {}
    ai_cfg = _get_ai_config(general)

    # Check if user has the permission
    has_suggest_perm = await PermissionService.check_permission(db, user, "ai.suggest")
    has_portfolio_perm = await PermissionService.check_permission(db, user, "ai.portfolio_insights")

    configured = bool(ai_cfg["provider_url"] and ai_cfg["model"])
    provider_type = ai_cfg["provider_type"]

    suggest_enabled = ai_cfg["enabled"] and has_suggest_perm
    portfolio_insights_enabled = (
        ai_cfg["portfolio_insights_enabled"] and has_portfolio_perm and configured
    )

    # Only fetch running models for Ollama (commercial providers have no such endpoint)
    running_models: list[str] = []
    if suggest_enabled and configured and provider_type == "ollama" and ai_cfg["provider_url"]:
        models = await fetch_running_models(ai_cfg["provider_url"])
        running_models = [m["name"] for m in models]

    return {
        "enabled": suggest_enabled,
        "configured": configured,
        "provider_type": provider_type,
        "enabled_types": ai_cfg["enabled_types"] if ai_cfg["enabled"] else [],
        "running_models": running_models,
        "model": ai_cfg["model"] if suggest_enabled else None,
        "portfolio_insights_enabled": portfolio_insights_enabled,
    }
