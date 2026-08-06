"""File extraction service — AI-powered field extraction from uploaded files.

When a file is uploaded to a card, this service checks whether any admin-configured
extraction scenarios match (by card type, subtype, and file category). If matched,
it extracts text from the file, calls the configured LLM with the user-defined
instructions and target field definitions, then writes the extracted values back
to the card's attributes and logs an audit event.
"""

from __future__ import annotations

import io
import json
import logging
import re
import uuid
import zipfile
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value
from app.database import async_session
from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.card_type import CardType
from app.models.file_extraction_scenario import FileExtractionScenario
from app.services.ai_service import call_llm
from app.services.event_bus import event_bus

logger = logging.getLogger("turboea.file_extraction")

# Maximum document text length sent to the LLM (characters).
_MAX_DOC_CHARS = 60_000
# Document chars sent to the extraction prompt.
# ~6 000 chars ≈ 1 500 tokens, leaving 2 500 tokens for prompt + output inside a
# 4 096-token context window — fast enough for CPU-inference on gemma3:4b.
_EXTRACTION_DOC_CHARS = 6_000


# ---------------------------------------------------------------------------
# Text extraction helpers
# ---------------------------------------------------------------------------


def _extract_text_from_docx(data: bytes) -> str:
    """Extract plain text from a .docx file (ZIP + OpenXML w:t elements)."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            with z.open("word/document.xml") as f:
                xml_bytes = f.read()
        # Strip all XML tags and collapse whitespace
        text = xml_bytes.decode("utf-8", errors="replace")
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:_MAX_DOC_CHARS]
    except Exception as exc:
        logger.debug("DOCX text extraction failed: %s", exc)
        return ""


def _extract_text_from_pdf(data: bytes) -> str:
    """Extract plain text from a PDF using pypdf."""
    try:
        import pypdf  # noqa: PLC0415

        reader = pypdf.PdfReader(io.BytesIO(data))
        pages: list[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                pages.append(page_text)
        return "\n".join(pages)[:_MAX_DOC_CHARS]
    except Exception as exc:
        logger.debug("pypdf extraction failed: %s", exc)
        return ""


def _extract_text_from_xlsx(data: bytes) -> str:
    """Extract cell values from an .xlsx file using openpyxl."""
    try:
        import openpyxl  # noqa: PLC0415

        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        lines: list[str] = []
        for sheet in wb.worksheets:
            lines.append(f"[Sheet: {sheet.title}]")
            for row in sheet.iter_rows(values_only=True):
                row_parts = [str(c) for c in row if c is not None and str(c).strip()]
                if row_parts:
                    lines.append(" | ".join(row_parts))
        wb.close()
        return "\n".join(lines)[:_MAX_DOC_CHARS]
    except Exception as exc:
        logger.debug("XLSX text extraction failed: %s", exc)
        return ""


def extract_text(data: bytes, mime_type: str) -> str:
    """Extract plain text from a file given its MIME type.

    Returns an empty string for unsupported types (images, SVG, PPTX).
    """
    if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_text_from_docx(data)
    if mime_type == "application/pdf":
        return _extract_text_from_pdf(data)
    if mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return _extract_text_from_xlsx(data)
    if mime_type in ("text/plain", "text/csv"):
        return data.decode("utf-8", errors="replace")[:_MAX_DOC_CHARS]
    return ""


# ---------------------------------------------------------------------------
# Scenario matching
# ---------------------------------------------------------------------------


async def find_matching_scenarios(
    db: AsyncSession,
    card_type_key: str,
    subtype: str | None,
    file_category: str | None,
) -> list[FileExtractionScenario]:
    """Return active scenarios whose subtype + category filters match this upload."""
    result = await db.execute(
        select(FileExtractionScenario).where(
            FileExtractionScenario.card_type_key == card_type_key,
            FileExtractionScenario.is_active.is_(True),
        )
    )
    matched: list[FileExtractionScenario] = []
    for s in result.scalars().all():
        linked_subtypes: list[str] = s.linked_subtypes or []
        linked_cats: list[str] = s.linked_file_categories or []

        # Empty list → matches all values for that dimension
        subtype_ok = (not linked_subtypes) or (bool(subtype) and subtype in linked_subtypes)
        category_ok = (not linked_cats) or (bool(file_category) and file_category in linked_cats)

        if subtype_ok and category_ok:
            matched.append(s)
    return matched


# ---------------------------------------------------------------------------
# LLM prompt builder
# ---------------------------------------------------------------------------


def _build_extraction_prompt(
    instructions: str,
    target_fields: list[dict[str, Any]],
    document_text: str,
) -> list[dict[str, str]]:
    """Build a concise single-message prompt for field extraction.

    Uses a single user-role message so that small local models (gemma3:4b,
    mistral:7b, etc.) don't get confused by long system prompts. The document
    is truncated to _EXTRACTION_DOC_CHARS to stay within their context windows.
    """
    field_specs: list[str] = []
    example: dict[str, Any] = {}
    for f in target_fields:
        key = f.get("key", "")
        label = f.get("label", key)
        ftype = f.get("type", "text")
        spec = f'"{key}" — {label}'
        if ftype in ("single_select", "multiple_select") and f.get("options"):
            opts = [o.get("key", "") for o in f["options"]]
            spec += f" (must be one of: {opts})"
            # Use actual option key as example — correct format and a valid value
            example[key] = opts[0] if opts else "option_key"
        elif ftype == "date":
            spec += " (ISO 8601: YYYY-MM-DD)"
            # Use a clearly fictional far-future year so the model won't echo it
            example[key] = "YYYY-MM-DD"
        elif ftype in ("number", "cost"):
            spec += " (numeric value only, no currency symbols or units)"
            # Avoid 0 — the model may echo it as "no value found"
            example[key] = 99
        elif ftype == "boolean":
            spec += " (true or false)"
            example[key] = True
        elif ftype == "table":
            cols = f.get("columns") or []
            if cols:
                col_keys = ", ".join(f'"{c["key"]}"' for c in cols)
                spec += (
                    f" (JSON array of objects; each object must have exactly these"
                    f" keys: {col_keys})"
                )
                example_row: dict[str, Any] = {
                    c["key"]: (99 if c.get("type") == "number" else "value") for c in cols
                }
                example[key] = [example_row]
            else:
                spec += " (JSON array of objects)"
                example[key] = []
        else:
            example[key] = "extracted text here"
        field_specs.append(spec)

    null_example = {k: None for k in example}
    null_json = json.dumps(null_example, indent=2)
    doc_snippet = document_text[:_EXTRACTION_DOC_CHARS]

    prompt = (
        "You are a document data-extraction assistant.\n\n"
        "## Output format\n"
        "Return ONLY a JSON object with exactly these keys (do not add or remove keys):\n"
        + "\n".join(f"  {s}" for s in field_specs)
        + "\n\nFor each key: output the extracted value if found, or null if not found.\n"
        f"Always include every key. Never omit a key.\n\n"
        f"Template (replace null with the extracted value, keep null if not found):\n"
        f"{null_json}\n\n"
        f"## Extraction guidance\n"
        f"{instructions}\n\n"
        f"## Document\n"
        f"{doc_snippet}"
    )

    return [{"role": "user", "content": prompt}]


# ---------------------------------------------------------------------------
# Virtual (built-in) field definitions — not stored in fields_schema
# ---------------------------------------------------------------------------

# Lifecycle extraction key → card.lifecycle dict key
_LIFECYCLE_KEY_MAP: dict[str, str] = {
    "lifecycle_plan": "plan",
    "lifecycle_phaseIn": "phaseIn",
    "lifecycle_active": "active",
    "lifecycle_phaseOut": "phaseOut",
    "lifecycle_endOfLife": "endOfLife",
}

# Static virtual field defs (subtype is built dynamically from card_type.subtypes)
_BASE_VIRTUAL_DEFS: dict[str, dict[str, Any]] = {
    "name": {"key": "name", "label": "Name", "type": "text"},
    "description": {"key": "description", "label": "Description", "type": "text"},
    "lifecycle_plan": {"key": "lifecycle_plan", "label": "Plan Date", "type": "date"},
    "lifecycle_phaseIn": {"key": "lifecycle_phaseIn", "label": "Phase-in Date", "type": "date"},
    "lifecycle_active": {"key": "lifecycle_active", "label": "Active Date", "type": "date"},
    "lifecycle_phaseOut": {"key": "lifecycle_phaseOut", "label": "Phase-out Date", "type": "date"},
    "lifecycle_endOfLife": {
        "key": "lifecycle_endOfLife",
        "label": "End of Life Date",
        "type": "date",
    },
}


# ---------------------------------------------------------------------------
# Card attribute update
# ---------------------------------------------------------------------------


async def _apply_extracted_fields(
    db: AsyncSession,
    card_id: uuid.UUID,
    extracted: dict[str, Any],
    valid_field_keys: set[str],
    scenario_id: str,
    attachment_name: str,
    user_id: uuid.UUID,
) -> list[str]:
    """Merge extracted values into the card and emit an audit event.

    Virtual fields (name, description, subtype, lifecycle_*) are written to
    their respective card columns; custom schema fields go to card.attributes.
    """
    from sqlalchemy.orm.attributes import flag_modified  # noqa: PLC0415

    result = await db.execute(select(Card).where(Card.id == card_id))
    card = result.scalar_one_or_none()
    if not card:
        return []

    attrs = dict(card.attributes or {})
    lifecycle = dict(card.lifecycle or {})
    updated: list[str] = []
    attrs_modified = False
    lifecycle_modified = False

    for key, value in extracted.items():
        if key not in valid_field_keys:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        if isinstance(value, list) and not value:
            continue

        if key == "name":
            card.name = str(value).strip()
            updated.append(key)
        elif key == "description":
            card.description = str(value).strip()
            updated.append(key)
        elif key == "subtype":
            card.subtype = str(value).strip()
            updated.append(key)
        elif key in _LIFECYCLE_KEY_MAP:
            lifecycle[_LIFECYCLE_KEY_MAP[key]] = value
            lifecycle_modified = True
            updated.append(key)
        else:
            attrs[key] = value
            attrs_modified = True
            updated.append(key)

    if not updated:
        return []

    if attrs_modified:
        card.attributes = attrs
        flag_modified(card, "attributes")
    if lifecycle_modified:
        card.lifecycle = lifecycle
        flag_modified(card, "lifecycle")

    await event_bus.publish(
        "ai.field_extraction",
        {
            "scenario_id": scenario_id,
            "attachment_name": attachment_name,
            "fields_updated": updated,
            "field_count": len(updated),
            "summary": f"AI extracted {len(updated)} field(s) from {attachment_name}",
        },
        db=db,
        card_id=card_id,
        user_id=user_id,
    )

    await db.commit()
    return updated


# ---------------------------------------------------------------------------
# Background task entry point
# ---------------------------------------------------------------------------


async def run_extraction_for_attachment(
    card_id_str: str,
    attachment_id_str: str,
    attachment_name: str,
    card_type_key: str,
    subtype: str | None,
    file_category: str | None,
    file_data: bytes,
    mime_type: str,
    uploader_user_id_str: str,
) -> None:
    """Run all matching extraction scenarios for an uploaded file.

    Designed to be called as a FastAPI BackgroundTask — creates its own DB
    session so the caller's session can be released after the upload response.
    """
    card_id = uuid.UUID(card_id_str)
    user_id = uuid.UUID(uploader_user_id_str)

    async with async_session() as db:
        try:
            # Load AI settings
            settings_result = await db.execute(
                select(AppSettings).where(AppSettings.id == "default")
            )
            settings_row = settings_result.scalar_one_or_none()
            general = (settings_row.general_settings if settings_row else None) or {}
            ai_cfg = general.get("ai", {})

            provider_url: str = ai_cfg.get("providerUrl", "")
            model: str = ai_cfg.get("model", "")
            provider_type: str = ai_cfg.get("providerType", "ollama")
            _raw_key: str = ai_cfg.get("apiKey", "")
            api_key: str = decrypt_value(_raw_key) if _raw_key else ""
            api_version: str = ai_cfg.get("apiVersion", "")

            if not provider_url or not model:
                logger.info(
                    "[extraction] AI not configured (providerUrl=%r model=%r) — skipping %s",
                    provider_url,
                    model,
                    attachment_name,
                )
                return

            # Find matching scenarios
            scenarios = await find_matching_scenarios(db, card_type_key, subtype, file_category)
            if not scenarios:
                logger.info(
                    "[extraction] No matching scenarios for card_type=%s subtype=%r"
                    " category=%r — skipping %s",
                    card_type_key,
                    subtype,
                    file_category,
                    attachment_name,
                )
                return

            # Extract text once, shared across all scenarios
            document_text = extract_text(file_data, mime_type)
            logger.info(
                "[extraction] Extracted %d chars from %s (mime=%s)",
                len(document_text),
                attachment_name,
                mime_type,
            )
            if not document_text.strip():
                logger.info(
                    "[extraction] No text extracted from %s (%s) — skipping",
                    attachment_name,
                    mime_type,
                )
                return

            # Build a field-key → field-def lookup from the card type's schema
            ct_result = await db.execute(select(CardType).where(CardType.key == card_type_key))
            card_type = ct_result.scalar_one_or_none()
            fields_by_key: dict[str, dict[str, Any]] = {}
            if card_type and card_type.fields_schema:
                for section in card_type.fields_schema:
                    for f in section.get("fields", []):
                        fields_by_key[f["key"]] = f

            # Build virtual field defs (built-in fields not stored in fields_schema)
            virtual_defs: dict[str, dict[str, Any]] = dict(_BASE_VIRTUAL_DEFS)
            if card_type and card_type.subtypes:
                opts = [
                    {"key": s.get("key", ""), "label": s.get("label", s.get("key", ""))}
                    for s in card_type.subtypes
                ]
                virtual_defs["subtype"] = {
                    "key": "subtype",
                    "label": "Subtype",
                    "type": "single_select",
                    "options": opts,
                }

            for scenario in scenarios:
                target_field_keys: list[str] = list(scenario.target_fields or [])
                target_fields: list[dict[str, Any]] = []
                for k in target_field_keys:
                    if k in fields_by_key:
                        target_fields.append(fields_by_key[k])
                    elif k in virtual_defs:
                        target_fields.append(virtual_defs[k])

                if not target_fields:
                    logger.debug(
                        "[extraction] Scenario %s has no valid target fields — skipping",
                        scenario.id,
                    )
                    continue

                messages = _build_extraction_prompt(
                    scenario.instructions, target_fields, document_text
                )

                logger.info(
                    "[extraction] LLM call for scenario %s on %s", scenario.id, attachment_name
                )
                try:
                    raw = await call_llm(
                        provider_url,
                        model,
                        messages,
                        provider_type=provider_type,
                        api_key=api_key,
                        api_version=api_version,
                        # num_ctx 4096 matches the default window of small Ollama models
                        # (gemma3:4b, mistral:7b) without the memory/latency cost of 8192.
                        extra_options={"num_ctx": 4096} if provider_type == "ollama" else None,
                        # Allow up to 5 min for local CPU inference on longer documents.
                        request_timeout=300.0,
                    )
                except Exception as exc:
                    logger.warning(
                        "[extraction] LLM call failed for scenario %s: %s", scenario.id, exc
                    )
                    continue

                logger.info("[extraction] LLM returned keys: %s", list(raw.keys()))
                valid_keys = set(target_field_keys) & (set(fields_by_key) | set(virtual_defs))
                logger.info("[extraction] Expected keys: %s", sorted(valid_keys))
                updated = await _apply_extracted_fields(
                    db,
                    card_id,
                    raw,
                    valid_keys,
                    str(scenario.id),
                    attachment_name,
                    user_id,
                )
                logger.info(
                    "[extraction] Updated %d field(s) via scenario %s: %s",
                    len(updated),
                    scenario.id,
                    updated,
                )

        except Exception:
            logger.exception(
                "[extraction] Unexpected error for attachment %s on card %s",
                attachment_id_str,
                card_id_str,
            )
