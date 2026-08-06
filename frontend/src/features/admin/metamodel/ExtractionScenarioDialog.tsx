import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import type { CardType as FSType, FileExtractionScenario, ResourceType } from "@/types";
import { fieldLabel } from "@/hooks/useResolveLabel";

interface FieldOption {
  key: string;
  label: string;
  type: string;
  group?: string;
}

const STANDARD_FIELDS: FieldOption[] = [
  { key: "name", label: "Name", type: "text", group: "Standard Fields" },
  { key: "description", label: "Description", type: "text", group: "Standard Fields" },
  { key: "subtype", label: "Subtype", type: "single_select", group: "Standard Fields" },
  { key: "lifecycle_plan", label: "Plan Date", type: "date", group: "Standard Fields" },
  { key: "lifecycle_phaseIn", label: "Phase-in Date", type: "date", group: "Standard Fields" },
  { key: "lifecycle_active", label: "Active Date", type: "date", group: "Standard Fields" },
  { key: "lifecycle_phaseOut", label: "Phase-out Date", type: "date", group: "Standard Fields" },
  { key: "lifecycle_endOfLife", label: "End of Life Date", type: "date", group: "Standard Fields" },
];

interface Props {
  open: boolean;
  cardType: FSType;
  scenario: FileExtractionScenario | null;
  fileCategories: ResourceType[];
  locale: string;
  onClose: () => void;
  onSave: (data: {
    instructions: string;
    target_fields: string[];
    linked_subtypes: string[];
    linked_file_categories: string[];
    is_active: boolean;
  }) => Promise<void>;
}

export default function ExtractionScenarioDialog({
  open,
  cardType,
  scenario,
  fileCategories,
  locale,
  onClose,
  onSave,
}: Props) {
  const { t } = useTranslation("admin");

  const [instructions, setInstructions] = useState("");
  const [targetFields, setTargetFields] = useState<FieldOption[]>([]);
  const [linkedSubtypes, setLinkedSubtypes] = useState<string[]>([]);
  const [linkedCategories, setLinkedCategories] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Build derived option lists from props (stable across the dialog lifetime)
  const customFields: FieldOption[] = (cardType.fields_schema || []).flatMap((section) =>
    section.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      group: "Custom Fields",
    })),
  );
  // Exclude subtype from standard fields when the card type has no subtypes
  const standardFields = STANDARD_FIELDS.filter(
    (f) => f.key !== "subtype" || (cardType.subtypes && cardType.subtypes.length > 0),
  );
  const allFieldOptions: FieldOption[] = [...standardFields, ...customFields];

  const subtypeOptions = (cardType.subtypes || []).map((s) => s.key);

  const categoryOptions = fileCategories.map((c) => c.key);

  // Populate form when editing an existing scenario
  useEffect(() => {
    if (!open) return;
    if (scenario) {
      setInstructions(scenario.instructions);
      setTargetFields(
        scenario.target_fields
          .map((key) => allFieldOptions.find((f) => f.key === key))
          .filter(Boolean) as FieldOption[],
      );
      setLinkedSubtypes(scenario.linked_subtypes);
      setLinkedCategories(scenario.linked_file_categories);
      setIsActive(scenario.is_active);
    } else {
      setInstructions("");
      setTargetFields([]);
      setLinkedSubtypes([]);
      setLinkedCategories([]);
      setIsActive(true);
    }
    // allFieldOptions is derived from cardType props which are stable for the
    // lifetime of this dialog — intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scenario]);

  const isValid = instructions.trim().length > 0 && targetFields.length > 0;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);
    try {
      await onSave({
        instructions: instructions.trim(),
        target_fields: targetFields.map((f) => f.key),
        linked_subtypes: linkedSubtypes,
        linked_file_categories: linkedCategories,
        is_active: isActive,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        {scenario
          ? t("metamodel.fileUpload.editScenario")
          : t("metamodel.fileUpload.addScenario")}
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, pt: 0.5 }}>
          {/* Active toggle */}
          <FormControlLabel
            control={
              <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            }
            label={t("metamodel.fileUpload.scenarioActive")}
          />

          {/* AI Instructions */}
          <Box>
            <TextField
              label={t("metamodel.fileUpload.scenarioInstructions")}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              multiline
              rows={4}
              fullWidth
              required
              size="small"
              placeholder={t("metamodel.fileUpload.scenarioInstructionsPlaceholder")}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {t("metamodel.fileUpload.scenarioInstructionsHelp")}
            </Typography>
          </Box>

          {/* Target Fields */}
          <Box>
            <Autocomplete
              multiple
              options={allFieldOptions}
              value={targetFields}
              onChange={(_, v) => setTargetFields(v)}
              getOptionLabel={(o) => `${o.label} (${o.key})`}
              isOptionEqualToValue={(a, b) => a.key === b.key}
              groupBy={(o) => o.group ?? "Custom Fields"}
              renderTags={(value, getTagProps) =>
                value.map((opt, idx) => (
                  <Chip
                    size="small"
                    label={opt.label}
                    {...getTagProps({ index: idx })}
                    key={opt.key}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label={t("metamodel.fileUpload.scenarioTargetFields")}
                  required
                />
              )}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {t("metamodel.fileUpload.scenarioTargetFieldsHelp")}
            </Typography>
          </Box>

          {/* Linked Sub-Types */}
          <Box>
            <Autocomplete
              multiple
              options={subtypeOptions}
              value={linkedSubtypes}
              onChange={(_, v) => setLinkedSubtypes(v)}
              getOptionLabel={(key) => {
                const sub = (cardType.subtypes || []).find((s) => s.key === key);
                return sub ? `${sub.label} (${key})` : key;
              }}
              renderTags={(value, getTagProps) =>
                value.map((key, idx) => {
                  const sub = (cardType.subtypes || []).find((s) => s.key === key);
                  return (
                    <Chip
                      size="small"
                      label={sub ? sub.label : key}
                      {...getTagProps({ index: idx })}
                      key={key}
                    />
                  );
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label={t("metamodel.fileUpload.scenarioLinkedSubtypes")}
                  placeholder={
                    linkedSubtypes.length === 0
                      ? t("metamodel.fileUpload.scenarioAllSubtypes")
                      : undefined
                  }
                />
              )}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {t("metamodel.fileUpload.scenarioLinkedSubtypesHelp")}
            </Typography>
          </Box>

          {/* Linked File Categories */}
          <Box>
            <Autocomplete
              multiple
              options={categoryOptions}
              value={linkedCategories}
              onChange={(_, v) => setLinkedCategories(v)}
              getOptionLabel={(key) => {
                const cat = fileCategories.find((c) => c.key === key);
                return cat ? fieldLabel(cat, locale) : key;
              }}
              renderTags={(value, getTagProps) =>
                value.map((key, idx) => {
                  const cat = fileCategories.find((c) => c.key === key);
                  return (
                    <Chip
                      size="small"
                      label={cat ? fieldLabel(cat, locale) : key}
                      {...getTagProps({ index: idx })}
                      key={key}
                    />
                  );
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label={t("metamodel.fileUpload.scenarioLinkedCategories")}
                  placeholder={
                    linkedCategories.length === 0
                      ? t("metamodel.fileUpload.scenarioAllCategories")
                      : undefined
                  }
                />
              )}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {t("metamodel.fileUpload.scenarioLinkedCategoriesHelp")}
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t("common:actions.cancel", { ns: "common" })}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={!isValid || saving}>
          {saving ? t("metamodel.typeDrawer.saving") : t("common:actions.save", { ns: "common" })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
