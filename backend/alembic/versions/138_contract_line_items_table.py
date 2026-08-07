"""Convert Contract lineItemDetails field from multiline_text to table type.

Updates existing installs so the Contract card type's lineItemDetails field
becomes a proper table field with columns (itemName, quantity, unitCost,
totalCost).  Also updates the AI extraction scenario instructions to match.

Revision ID: 138
Revises: 137
Create Date: 2026-07-11
"""

import json
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "138"
down_revision: Union[str, None] = "137"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

_TABLE_FIELD = {
    "key": "lineItemDetails",
    "label": "Line Items",
    "type": "table",
    "columns": [
        {"key": "itemName", "label": "Item Name", "type": "text"},
        {"key": "quantity", "label": "Quantity", "type": "number"},
        {"key": "unitCost", "label": "Unit Cost", "type": "number"},
        {"key": "totalCost", "label": "Total Cost", "type": "number"},
    ],
}

_LINE_ITEMS_INSTRUCTION = (
    "- lineItemDetails: Extract all contract line items (products, services, licences,"
    " etc.). For each row capture the item name/description, quantity, unit cost, and"
    " total cost."
)


def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # Update fields_schema — replace the lineItemDetails field definition
    # ------------------------------------------------------------------
    row = conn.execute(
        sa.text("SELECT fields_schema FROM card_types WHERE key = 'Contract'")
    ).fetchone()

    if row is None:
        # Contract type not present (e.g. completely fresh DB that ran 120
        # which already ships the correct definition) — nothing to do.
        return

    schema: list = row[0] or []
    changed = False
    for section in schema:
        for i, field in enumerate(section.get("fields", [])):
            if field.get("key") == "lineItemDetails" and field.get("type") != "table":
                section["fields"][i] = _TABLE_FIELD
                changed = True
                break

    if changed:
        conn.execute(
            sa.text(
                "UPDATE card_types SET fields_schema = CAST(:fs AS jsonb), updated_at = now()"
                " WHERE key = 'Contract'"
            ),
            {"fs": json.dumps(schema)},
        )

    # ------------------------------------------------------------------
    # Update extraction scenario instructions
    # ------------------------------------------------------------------
    scenario_row = conn.execute(
        sa.text(
            "SELECT id, instructions FROM file_extraction_scenarios"
            " WHERE card_type_key = 'Contract'"
        )
    ).fetchone()

    if scenario_row is None:
        return

    instructions: str = scenario_row[1] or ""

    # Replace the old pipe-delimited line_item_details line with the new one.
    old_patterns = [
        "- line_item_details: A list of line items in the contract in a text table format."
        " Columns delimitered by pipes.",
        "- line_items: An array of line items",
    ]
    new_line = _LINE_ITEMS_INSTRUCTION

    updated_instructions = instructions
    for pat in old_patterns:
        if pat in updated_instructions:
            # Replace the entire line (up to the next newline)
            start = updated_instructions.find(pat)
            end = updated_instructions.find("\n", start)
            if end == -1:
                end = len(updated_instructions)
            updated_instructions = (
                updated_instructions[:start] + new_line + updated_instructions[end:]
            )

    # Also replace any inline lineItemDetails instruction that may have been
    # written in a different format by a previous manual edit.
    if "lineItemDetails" not in updated_instructions:
        # Append if no existing reference found
        updated_instructions = updated_instructions.rstrip() + "\n" + new_line

    if updated_instructions != instructions:
        conn.execute(
            sa.text(
                "UPDATE file_extraction_scenarios"
                " SET instructions = :ins, updated_at = now()"
                " WHERE card_type_key = 'Contract'"
            ),
            {"ins": updated_instructions},
        )


def downgrade() -> None:
    # No-op: preserve user data on downgrade.
    pass
