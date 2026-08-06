import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import KeyInput, { isValidKey } from "@/components/KeyInput";
import { api } from "@/api/client";
import { LOCALE_LABELS } from "@/i18n";
import type { FieldDef, FieldOption, TableColumn, TranslationMap } from "@/types";
import { FIELD_TYPE_OPTIONS, DEFAULT_OPTION_COLOR } from "./constants";

/** Remove empty-string entries from a TranslationMap. Returns undefined if all empty. */
function cleanTranslationMap(map: TranslationMap | undefined): TranslationMap | undefined {
  if (!map) return undefined;
  const cleaned: TranslationMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/* ------------------------------------------------------------------ */
/*  Field Editor Dialog                                                */
/* ------------------------------------------------------------------ */

export interface FieldEditorProps {
  open: boolean;
  field: FieldDef;
  typeKey: string;
  fieldKey: string;
  onClose: () => void;
  onSave: (field: FieldDef) => void;
  /** True if this field is the target of an active calculation */
  isCalculated?: boolean;
}

export default function FieldEditorDialog({ open, field: initial, typeKey, fieldKey, onClose, onSave, isCalculated }: FieldEditorProps) {
  const { t, i18n } = useTranslation(["admin", "common"]);
  const locale = i18n.language;
  const [field, setField] = useState<FieldDef>(initial);

  // The label input reads/writes translations[currentLocale]
  const [displayLabel, setDisplayLabel] = useState("");

  // Keys that appear on more than one option — flagged red, and block Save.
  // Keys must be unique within a select field's option list.
  const duplicateOptionKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of field.options || []) {
      if (o.key) counts.set(o.key, (counts.get(o.key) || 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, [field.options]);

  // Duplicate column keys (table type)
  const duplicateColumnKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of field.columns || []) {
      if (c.key) counts.set(c.key, (counts.get(c.key) || 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, [field.columns]);

  // Option deletion confirmation
  const [deleteOptConfirm, setDeleteOptConfirm] = useState<{
    idx: number;
    optionKey: string;
    optionLabel: string;
    cardCount: number | null; // null = loading
  } | null>(null);

  // Column deletion confirmation (table type)
  const [deleteColConfirm, setDeleteColConfirm] = useState<{
    idx: number;
    colLabel: string;
  } | null>(null);

  useEffect(() => {
    if (open) {
      // Mark options that already exist so their key stays locked. A row's
      // original-ness travels with the row (survives add/remove), so a new row
      // never locks just because its typed key matches an existing one.
      setField({
        ...initial,
        options: (initial.options || []).map((o) => ({ ...o, _original: true })),
        columns: (initial.columns || []).map((c) => ({ ...c, _original: true })),
      });
      setDisplayLabel(initial.translations?.[locale] || initial.label || "");
      setDeleteOptConfirm(null);
      setDeleteColConfirm(null);
    }
  }, [open, initial, locale]);

  const isSelect = field.type === "single_select" || field.type === "multiple_select";
  const isTable = field.type === "table";

  const updateOption = (idx: number, patch: Partial<FieldOption>) => {
    const opts = [...(field.options || [])];
    opts[idx] = { ...opts[idx], ...patch };
    setField({ ...field, options: opts });
  };

  const addOption = () => {
    setField({
      ...field,
      options: [...(field.options || []), { key: "", label: "", color: DEFAULT_OPTION_COLOR }],
    });
  };

  const removeOption = (idx: number) => {
    const opts = [...(field.options || [])];
    opts.splice(idx, 1);
    setField({ ...field, options: opts });
    setDeleteOptConfirm(null);
  };

  const promptRemoveOption = (idx: number) => {
    const opt = (field.options || [])[idx];
    if (!opt) return;

    // New options (not yet saved) can be removed without confirmation
    if (!opt._original) {
      removeOption(idx);
      return;
    }

    // Existing option — check usage
    setDeleteOptConfirm({ idx, optionKey: opt.key, optionLabel: opt.label, cardCount: null });
    if (typeKey && fieldKey) {
      api
        .get<{ card_count: number }>(
          `/metamodel/types/${typeKey}/option-usage?field_key=${encodeURIComponent(fieldKey)}&option_key=${encodeURIComponent(opt.key)}`,
        )
        .then((r) => setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: r.card_count } : null)))
        .catch(() => setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null)));
    } else {
      setDeleteOptConfirm((prev) => (prev ? { ...prev, cardCount: 0 } : null));
    }
  };

  // Column management helpers (table type)
  const updateColumn = (idx: number, patch: Partial<TableColumn>) => {
    const cols = [...(field.columns || [])];
    cols[idx] = { ...cols[idx], ...patch };
    setField({ ...field, columns: cols });
  };

  const addColumn = () => {
    setField({
      ...field,
      columns: [...(field.columns || []), { key: "", label: "", type: "text" }],
    });
  };

  const removeColumn = (idx: number) => {
    const cols = [...(field.columns || [])];
    cols.splice(idx, 1);
    setField({ ...field, columns: cols });
    setDeleteColConfirm(null);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{initial.key ? t("metamodel.fieldEditor.editField") : t("metamodel.fieldEditor.addField")}</DialogTitle>
      <DialogContent>
        {isCalculated && (
          <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
            {t("metamodel.fieldEditor.calculatedInfo")}
          </Alert>
        )}
        <KeyInput
          fullWidth
          label={t("metamodel.fieldEditor.keyLabel")}
          value={field.key}
          onChange={(v) => setField({ ...field, key: v })}
          sx={{ mt: 1, mb: 2 }}
          size="small"
          locked={!!initial.key}
          lockedReason={t("metamodel.fieldEditor.keyLockedReason")}
          required={!!displayLabel.trim()}
        />
        <TextField
          fullWidth
          label={`${t("metamodel.fieldEditor.labelLabel")} (${LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] || locale})`}
          value={displayLabel}
          onChange={(e) => setDisplayLabel(e.target.value)}
          sx={{ mb: 2 }}
          error={!displayLabel.trim()}
        />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("metamodel.fieldEditor.typeLabel")}</InputLabel>
          <Select
            value={field.type}
            label={t("metamodel.fieldEditor.typeLabel")}
            disabled={!!isCalculated}
            onChange={(e) =>
              setField({ ...field, type: e.target.value as FieldDef["type"] })
            }
          >
            {FIELD_TYPE_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {t(o.tKey)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "center" }}>
          <FormControlLabel
            control={
              <Switch
                checked={!!field.required}
                onChange={(e) =>
                  setField({ ...field, required: e.target.checked })
                }
              />
            }
            label={t("metamodel.fieldEditor.required")}
          />
          <Typography variant="caption" color="text.secondary">
            {t("metamodel.fieldEditor.weightMovedHint")}
          </Typography>
        </Box>
        {isSelect && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t("metamodel.fieldEditor.options")}
            </Typography>
            {(field.options || []).map((opt, idx) => (
              <Box key={idx}>
                <Box
                  sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "flex-start" }}
                >
                  <KeyInput
                    size="small"
                    label={t("metamodel.fieldEditor.optionKeyLabel")}
                    value={opt.key}
                    onChange={(v) => updateOption(idx, { key: v })}
                    sx={{ flex: 1 }}
                    locked={!!opt._original}
                    lockedReason={t("metamodel.fieldEditor.optionKeyLocked")}
                    required={!!opt.label.trim()}
                    externalError={
                      duplicateOptionKeys.has(opt.key) ? t("validation:key.duplicate") : undefined
                    }
                  />
                  <TextField
                    size="small"
                    label={t("metamodel.fieldEditor.optionLabelLabel")}
                    value={opt.label}
                    onChange={(e) => updateOption(idx, { label: e.target.value })}
                    sx={{ flex: 1 }}
                    helperText=" "
                  />
                  <ColorPicker
                    compact
                    value={opt.color || DEFAULT_OPTION_COLOR}
                    onChange={(c) => updateOption(idx, { color: c })}
                  />
                  <IconButton size="small" onClick={() => promptRemoveOption(idx)}>
                    <MaterialSymbol icon="close" size={18} />
                  </IconButton>
                </Box>
                {deleteOptConfirm?.idx === idx && (
                  <Alert
                    severity={deleteOptConfirm.cardCount === null ? "info" : deleteOptConfirm.cardCount > 0 ? "warning" : "info"}
                    sx={{ mb: 1, py: 0.5 }}
                    action={
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button size="small" color="inherit" onClick={() => setDeleteOptConfirm(null)}>
                          {t("common:actions.cancel")}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={deleteOptConfirm.cardCount === null}
                          onClick={() => removeOption(idx)}
                        >
                          {t("common:actions.remove")}
                        </Button>
                      </Box>
                    }
                  >
                    {deleteOptConfirm.cardCount === null
                      ? t("metamodel.fieldEditor.checkingUsage")
                      : deleteOptConfirm.cardCount > 0
                        ? t("metamodel.fieldEditor.optionUsedByCards", { label: deleteOptConfirm.optionLabel, count: deleteOptConfirm.cardCount })
                        : t("metamodel.fieldEditor.optionSafeToRemove", { label: deleteOptConfirm.optionLabel })}
                  </Alert>
                )}
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={addOption}
            >
              {t("metamodel.fieldEditor.addOption")}
            </Button>
          </>
        )}
        {isTable && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1, mt: 1 }}>
              {t("metamodel.fieldEditor.columns")}
            </Typography>
            {/* System row-index column (read-only hint) */}
            <Box sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "center", opacity: 0.5 }}>
              <TextField size="small" label={t("metamodel.fieldEditor.colKeyLabel")} value="idx" disabled sx={{ flex: 1 }} />
              <TextField size="small" label={t("metamodel.fieldEditor.colLabelLabel")} value="#" disabled sx={{ flex: 1 }} />
              <TextField size="small" label={t("metamodel.fieldEditor.colTypeLabel")} value="number" disabled sx={{ flex: 1 }} />
              <IconButton size="small" disabled sx={{ flexShrink: 0 }}>
                <MaterialSymbol icon="close" size={18} />
              </IconButton>
            </Box>
            {(field.columns || []).map((col, idx) => (
              <Box key={idx}>
                <Box sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "flex-start" }}>
                  <KeyInput
                    size="small"
                    label={t("metamodel.fieldEditor.colKeyLabel")}
                    value={col.key}
                    onChange={(v) => updateColumn(idx, { key: v })}
                    sx={{ flex: 1 }}
                    locked={!!col._original}
                    lockedReason={t("metamodel.fieldEditor.colKeyLocked")}
                    required={!!col.label.trim()}
                    externalError={
                      duplicateColumnKeys.has(col.key) ? t("validation:key.duplicate") : undefined
                    }
                  />
                  <TextField
                    size="small"
                    label={t("metamodel.fieldEditor.colLabelLabel")}
                    value={col.label}
                    onChange={(e) => updateColumn(idx, { label: e.target.value })}
                    sx={{ flex: 1 }}
                    helperText=" "
                  />
                  <FormControl size="small" sx={{ flex: 1 }}>
                    <InputLabel>{t("metamodel.fieldEditor.colTypeLabel")}</InputLabel>
                    <Select
                      value={col.type}
                      label={t("metamodel.fieldEditor.colTypeLabel")}
                      onChange={(e) =>
                        updateColumn(idx, { type: e.target.value as TableColumn["type"] })
                      }
                    >
                      <MenuItem value="text">{t("common:fieldTypes.text")}</MenuItem>
                      <MenuItem value="number">{t("common:fieldTypes.number")}</MenuItem>
                      <MenuItem value="date">{t("common:fieldTypes.date")}</MenuItem>
                      <MenuItem value="cost">{t("common:fieldTypes.cost")}</MenuItem>
                    </Select>
                  </FormControl>
                  <IconButton
                    size="small"
                    sx={{ flexShrink: 0, mt: 0.5 }}
                    onClick={() => {
                      if (!col._original) {
                        removeColumn(idx);
                      } else {
                        setDeleteColConfirm({ idx, colLabel: col.label });
                      }
                    }}
                  >
                    <MaterialSymbol icon="close" size={18} />
                  </IconButton>
                </Box>
                {deleteColConfirm?.idx === idx && (
                  <Alert
                    severity="warning"
                    sx={{ mb: 1, py: 0.5 }}
                    action={
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button size="small" color="inherit" onClick={() => setDeleteColConfirm(null)}>
                          {t("common:actions.cancel")}
                        </Button>
                        <Button size="small" color="error" onClick={() => removeColumn(idx)}>
                          {t("common:actions.remove")}
                        </Button>
                      </Box>
                    }
                  >
                    {t("metamodel.fieldEditor.colDeleteWarning", { label: deleteColConfirm.colLabel })}
                  </Alert>
                )}
              </Box>
            ))}
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={16} />}
              onClick={addColumn}
            >
              {t("metamodel.fieldEditor.addColumn")}
            </Button>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          onClick={() => {
            const mergedTranslations = { ...field.translations, [locale]: displayLabel };
            const cleanedField: FieldDef = {
              ...field,
              label: displayLabel,
              translations: cleanTranslationMap(mergedTranslations),
              options: field.options?.map(({ _original, ...o }) => ({
                ...o,
                // Persist the default the picker displays so an option whose
                // swatch was never touched still saves a color (issue #718).
                color: o.color || DEFAULT_OPTION_COLOR,
                translations: cleanTranslationMap(o.translations),
              })),
              columns: field.columns?.map(({ _original, ...c }) => c),
            };
            onSave(cleanedField);
          }}
          disabled={
            !field.key ||
            !displayLabel ||
            (!initial.key && !isValidKey(field.key)) ||
            (isSelect && (
              (field.options || []).some((o) => !o._original && !isValidKey(o.key)) ||
              duplicateOptionKeys.size > 0
            )) ||
            (isTable && (
              (field.columns || []).some((c) => !c._original && !isValidKey(c.key)) ||
              duplicateColumnKeys.size > 0
            ))
          }
        >
          {t("common:actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
