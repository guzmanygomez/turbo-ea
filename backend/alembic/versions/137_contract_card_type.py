"""Seed the custom 'Contract' card type, its fields, relation types, and AI extraction scenario.

The Contract card type is admin-created (built_in=False) and therefore lives
outside seed.py, which only handles built-in types.  On a fresh DB rebuild the
type simply doesn't exist, so this migration seeds it.

On an existing install (where the admin already created it via the UI) we
update fields_schema to the canonical definition, patch section_config to
ensure 'End of Life', 'Hierarchy', and 'Successors/Lineage' sections are
collapsed by default, upsert the relation types if missing, and upsert the
AI file extraction scenario.

Revision ID: 137
Revises: 136
Create Date: 2026-07-10
"""

import json
import uuid
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "137"
down_revision: Union[str, None] = "136"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

# ---------------------------------------------------------------------------
# Card type definition
# ---------------------------------------------------------------------------

_FIELDS_SCHEMA = [
    {
        "section": "Contract Overview",
        "columns": 2,
        "fields": [
            {"key": "totalCost", "label": "Total Cost (ex GST)", "type": "cost", "column": 0},
            {"key": "totalDiscount", "label": "Total Discount", "type": "cost", "column": 0},
            {"key": "termLength", "label": "Term Length", "type": "number", "column": 0},
            {
                "key": "termUnits",
                "label": "Term Units",
                "type": "single_select",
                "column": 0,
                "options": [
                    {"key": "monthly", "label": "Monthly"},
                    {"key": "quarterly", "label": "Quarterly"},
                    {"key": "annual", "label": "Annual"},
                    {"key": "multi_year", "label": "Multi-year"},
                ],
            },
            {
                "key": "paymentType",
                "label": "Payment Type",
                "type": "single_select",
                "column": 0,
                "options": [
                    {"key": "annual", "label": "Annual"},
                    {"key": "monthly", "label": "Monthly"},
                    {"key": "quarterly", "label": "Quarterly"},
                    {"key": "one_time", "label": "One-time"},
                    {"key": "custom", "label": "Custom"},
                ],
            },
            {"key": "startDate", "label": "Start Date", "type": "date", "column": 1},
            {"key": "endDate", "label": "End Date", "type": "date", "column": 1},
            {
                "key": "cancellationDeadline",
                "label": "Cancelation Deadline",
                "type": "date",
                "column": 1,
            },
            {"key": "autoRenew", "label": "Auto Renew", "type": "boolean", "column": 1},
            {"key": "currency", "label": "Currency", "type": "text", "column": 1},
        ],
    },
    {
        "section": "Contract Details",
        "columns": 1,
        "fields": [
            {
                "key": "lineItemDetails",
                "label": "Line Items",
                "type": "table",
                "columns": [
                    {"key": "itemName", "label": "Item Name", "type": "text"},
                    {"key": "quantity", "label": "Quantity", "type": "number"},
                    {"key": "unitCost", "label": "Unit Cost", "type": "number"},
                    {"key": "totalCost", "label": "Total Cost", "type": "number"},
                ],
            },
            {"key": "billingSchedule", "label": "Billing Schedule", "type": "multiline_text"},
            {"key": "keyTerms", "label": "Key Terms", "type": "multiline_text"},
        ],
    },
]

_SECTION_CONFIG = {
    "__order": [
        "description",
        "eol",
        "lifecycle",
        "custom:0",
        "custom:1",
        "hierarchy",
        "successors",
        "tags",
        "relations",
    ],
    "eol": {"defaultExpanded": False},
    "hierarchy": {"defaultExpanded": False},
    "successors": {"defaultExpanded": False},
}

# Collapsed keys to inject into an existing section_config
_COLLAPSED_SECTIONS = {
    "eol": {"defaultExpanded": False},
    "hierarchy": {"defaultExpanded": False},
    "successors": {"defaultExpanded": False},
}

# ---------------------------------------------------------------------------
# AI file extraction scenario
# ---------------------------------------------------------------------------

_EXTRACTION_INSTRUCTIONS = (
    "Extract the following from this document:\n"
    "- start_date: The date the contract term commences (effective date /"
    " commencement date). Format as DD/MM/YYYY\n"
    "- end_date: The date the contract term ends (expiration / end date)."
    " Format as DD/MM/YYYY\n"
    "- term_length: The numeric duration of the contract term (integer or decimal)."
    " Extract the number only.\n"
    '- term_units: The unit of the term length. Must be one of: "months", "years".\n'
    "- auto_renew: A flag indicating if the contract has an auto-renew clause."
    " Format boolean value\n"
    "- cancelation_deadline: The final date a customer must inform the provider"
    " for contract renewal cancellation. Format as DD/MM/YYYY\n"
    "- total_cost: The total dollar cost of the contract, excluding GST\n"
    "- total_discount: The total discount applied by the provider\n"
    "- currency: The currency code for the commercials i.e AUD, USD etc\n"
    "- payment_type: The method in which the customer will be billed."
    ' Must be one of: "Billing Schedule", "Invoice - Fixed", "Invoice - T&M"\n'
    "- key_terms: A list of specific terms in the contract that should be called out."
    " Format a multiline text block\n"
    "- billing_schedule: If the contract features a billing schedule then provide it"
    " as a list. Columns delimited by pipes.\n"
    "- lineItemDetails: Extract all contract line items (products, services, licences,"
    " etc.). For each row capture the item name/description, quantity, unit cost, and"
    " total cost.\n"
    "\n"
    "Rules:\n"
    "1. Extract values only if they are explicitly stated or can be directly derived"
    " from the text. Do not guess or infer beyond what the document supports.\n"
    "2. If a field cannot be found, set its value to null.\n"
    "3. If start_date and end_date are both present but term_length/term_units are not"
    " stated, calculate term_length and term_units from the two dates, choosing the"
    " most natural whole unit (e.g. exactly 36 months → 3 years; 18 months →"
    " 18 months). If it does not divide cleanly into a whole unit, use months.\n"
    "4. If term_length and start_date are present but end_date is not, you may derive"
    " end_date from them.\n"
    "5. Ignore renewal terms, option periods, and notice periods unless the document"
    " has no primary term, in which case set the fields to null rather than using a"
    " renewal figure.\n"
    '6. Dates may appear in any format (e.g. "1 July 2026", "07/01/2026",'
    ' "July 1st, 2026"). Interpret ambiguous numeric dates using DD/MM/YYYY'
    " (Australian) convention unless the document clearly indicates otherwise."
)

_EXTRACTION_TARGET_FIELDS = [
    "startDate",
    "endDate",
    "termLength",
    "termUnits",
    "autoRenew",
    "cancellationDeadline",
    "totalCost",
    "totalDiscount",
    "currency",
    "paymentType",
    "keyTerms",
    "billingSchedule",
    "lineItemDetails",
]

# ---------------------------------------------------------------------------
# Relation type definitions
# ---------------------------------------------------------------------------

# One relation type per (source, target) pair — enforced by the application.
# source_visible / source_mandatory match the Visible + Mandatory toggles on
# the Contract card's Relations tab in the Admin metamodel UI.
_RELATION_TYPES = [
    {
        "key": "relContractToOrganization",
        "label": "has party",
        "reverse_label": "party to",
        "source_type_key": "Contract",
        "target_type_key": "Organization",
        "cardinality": "1:n",
        "source_visible": True,
        "source_mandatory": True,
        "target_visible": True,
        "target_mandatory": False,
    },
    {
        "key": "relContractToProvider",
        "label": "has party",
        "reverse_label": "party to",
        "source_type_key": "Contract",
        "target_type_key": "Provider",
        "cardinality": "1:n",
        "source_visible": True,
        "source_mandatory": True,
        "target_visible": True,
        "target_mandatory": False,
    },
    {
        "key": "relContractToApplication",
        "label": "governs",
        "reverse_label": "governed by",
        "source_type_key": "Contract",
        "target_type_key": "Application",
        "cardinality": "1:n",
        "source_visible": True,
        "source_mandatory": False,
        "target_visible": True,
        "target_mandatory": False,
    },
    {
        "key": "relContractToITComponent",
        "label": "governs",
        "reverse_label": "governed by",
        "source_type_key": "Contract",
        "target_type_key": "ITComponent",
        "cardinality": "1:n",
        "source_visible": True,
        "source_mandatory": False,
        "target_visible": True,
        "target_mandatory": False,
    },
]


def upgrade() -> None:
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # Card type — insert on fresh DB, update fields + section_config on
    # existing installs
    # ------------------------------------------------------------------
    row = conn.execute(sa.text("SELECT id FROM card_types WHERE key = 'Contract'")).fetchone()

    if row is None:
        conn.execute(
            sa.text(
                """
                INSERT INTO card_types (
                    id, key, label, icon, color, category,
                    has_hierarchy, has_successors,
                    built_in, is_hidden, sort_order,
                    subtypes, stakeholder_roles,
                    fields_schema, section_config, translations,
                    created_at, updated_at
                ) VALUES (
                    :id, :key, :label, :icon, :color, :category,
                    :has_hierarchy, :has_successors,
                    :built_in, :is_hidden, :sort_order,
                    CAST(:subtypes AS jsonb), CAST(:stakeholder_roles AS jsonb),
                    CAST(:fields_schema AS jsonb), CAST(:section_config AS jsonb),
                    CAST(:translations AS jsonb),
                    now(), now()
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "key": "Contract",
                "label": "Contract",
                "icon": "contract",
                "color": "#7b61ff",
                "category": "Business Architecture",
                "has_hierarchy": True,
                "has_successors": True,
                "built_in": False,
                "is_hidden": False,
                "sort_order": 99,
                "subtypes": json.dumps([]),
                "stakeholder_roles": json.dumps([]),
                "fields_schema": json.dumps(_FIELDS_SCHEMA),
                "section_config": json.dumps(_SECTION_CONFIG),
                "translations": json.dumps({}),
            },
        )
    else:
        # Update fields_schema to the canonical definition and patch
        # section_config to ensure the three sections are collapsed.
        existing = conn.execute(
            sa.text("SELECT section_config FROM card_types WHERE key = 'Contract'")
        ).fetchone()
        cfg: dict = (existing[0] or {}) if existing else {}
        for section_key, settings in _COLLAPSED_SECTIONS.items():
            if section_key not in cfg:
                cfg[section_key] = settings
            else:
                cfg[section_key].setdefault("defaultExpanded", False)

        conn.execute(
            sa.text(
                """
                UPDATE card_types
                SET fields_schema = CAST(:fs AS jsonb),
                    section_config = CAST(:cfg AS jsonb),
                    updated_at = now()
                WHERE key = 'Contract'
                """
            ),
            {"fs": json.dumps(_FIELDS_SCHEMA), "cfg": json.dumps(cfg)},
        )

    # ------------------------------------------------------------------
    # Relation types — insert if the (source, target) pair is missing;
    # skip silently if the admin already created it via the UI
    # ------------------------------------------------------------------
    for rt in _RELATION_TYPES:
        exists = conn.execute(
            sa.text(
                "SELECT id FROM relation_types "
                "WHERE source_type_key = :src AND target_type_key = :tgt"
            ),
            {"src": rt["source_type_key"], "tgt": rt["target_type_key"]},
        ).fetchone()

        if exists:
            continue

        conn.execute(
            sa.text(
                """
                INSERT INTO relation_types (
                    id, key, label, reverse_label,
                    source_type_key, target_type_key, cardinality,
                    attributes_schema, built_in, is_hidden, sort_order, translations,
                    source_visible, source_mandatory,
                    target_visible, target_mandatory,
                    created_at, updated_at
                ) VALUES (
                    :id, :key, :label, :reverse_label,
                    :source_type_key, :target_type_key, :cardinality,
                    CAST(:attributes_schema AS jsonb),
                    :built_in, :is_hidden, :sort_order,
                    CAST(:translations AS jsonb),
                    :source_visible, :source_mandatory,
                    :target_visible, :target_mandatory,
                    now(), now()
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "key": rt["key"],
                "label": rt["label"],
                "reverse_label": rt["reverse_label"],
                "source_type_key": rt["source_type_key"],
                "target_type_key": rt["target_type_key"],
                "cardinality": rt["cardinality"],
                "attributes_schema": json.dumps([]),
                "built_in": False,
                "is_hidden": False,
                "sort_order": 0,
                "translations": json.dumps({}),
                "source_visible": rt["source_visible"],
                "source_mandatory": rt["source_mandatory"],
                "target_visible": rt["target_visible"],
                "target_mandatory": rt["target_mandatory"],
            },
        )

    # ------------------------------------------------------------------
    # AI file extraction scenario — upsert for the Contract card type.
    # Update instructions + target_fields if a scenario already exists so
    # the canonical definition stays current after a schema change.
    # ------------------------------------------------------------------
    scenario_row = conn.execute(
        sa.text("SELECT id FROM file_extraction_scenarios WHERE card_type_key = 'Contract'")
    ).fetchone()

    if scenario_row is None:
        conn.execute(
            sa.text(
                """
                INSERT INTO file_extraction_scenarios (
                    id, card_type_key, instructions, target_fields,
                    linked_subtypes, linked_file_categories, is_active,
                    created_at, updated_at
                ) VALUES (
                    :id, :card_type_key, :instructions,
                    CAST(:target_fields AS jsonb),
                    CAST(:linked_subtypes AS jsonb),
                    CAST(:linked_file_categories AS jsonb),
                    :is_active, now(), now()
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "card_type_key": "Contract",
                "instructions": _EXTRACTION_INSTRUCTIONS,
                "target_fields": json.dumps(_EXTRACTION_TARGET_FIELDS),
                "linked_subtypes": json.dumps([]),
                "linked_file_categories": json.dumps([]),
                "is_active": True,
            },
        )
    else:
        conn.execute(
            sa.text(
                """
                UPDATE file_extraction_scenarios
                SET instructions = :instructions,
                    target_fields = CAST(:target_fields AS jsonb),
                    updated_at = now()
                WHERE card_type_key = 'Contract'
                """
            ),
            {
                "instructions": _EXTRACTION_INSTRUCTIONS,
                "target_fields": json.dumps(_EXTRACTION_TARGET_FIELDS),
            },
        )


def downgrade() -> None:
    # No-op: preserve user data on downgrade.
    pass
