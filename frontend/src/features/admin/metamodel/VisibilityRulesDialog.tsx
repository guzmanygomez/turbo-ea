import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import type {
  FieldDef,
  VisibilityRule,
  VisibilityRuleGroup,
  VisibilityRuleSet,
  VisibilityOperator,
} from "@/types";

// ── Defaults ─────────────────────────────────────────────────────

const emptyRule = (): VisibilityRule => ({ field: "", op: "eq", value: "" });
const emptyGroup = (): VisibilityRuleGroup => ({ match: "all", rules: [emptyRule()] });
const emptyRuleSet = (): VisibilityRuleSet => ({ match: "all", groups: [emptyGroup()] });

// ── RuleRow ───────────────────────────────────────────────────────

function RuleRow({
  rule,
  allFields,
  onUpdate,
  onRemove,
  canRemove,
}: {
  rule: VisibilityRule;
  allFields: FieldDef[];
  onUpdate: (updates: Partial<VisibilityRule>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useTranslation(["admin"]);
  const fieldDef = allFields.find((f) => f.key === rule.field);
  const isSelectField =
    fieldDef?.type === "single_select" || fieldDef?.type === "multiple_select";
  const isMultiOp = rule.op === "in" || rule.op === "not_in";

  const handleFieldChange = (newField: string) => {
    onUpdate({ field: newField, value: isMultiOp ? [] : "" });
  };

  const handleOpChange = (newOp: VisibilityOperator) => {
    const nowMulti = newOp === "in" || newOp === "not_in";
    const wasMulti = isMultiOp;
    let newValue: string | string[] = rule.value;
    if (!wasMulti && nowMulti) {
      newValue = rule.value ? [String(rule.value)] : [];
    } else if (wasMulti && !nowMulti) {
      newValue = Array.isArray(rule.value) ? (rule.value[0] ?? "") : "";
    }
    onUpdate({ op: newOp, value: newValue });
  };

  const selectOptions = isSelectField ? (fieldDef?.options ?? []) : [];

  const renderValueInput = () => {
    if (isSelectField && isMultiOp) {
      return (
        <Autocomplete
          multiple
          size="small"
          options={selectOptions.map((o) => o.key)}
          getOptionLabel={(key) => selectOptions.find((o) => o.key === key)?.label ?? key}
          value={
            Array.isArray(rule.value) ? rule.value : rule.value ? [rule.value as string] : []
          }
          onChange={(_, vals) => onUpdate({ value: vals })}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label={t("metamodel.visibilityRules.valueLabel")}
            />
          )}
          sx={{ minWidth: 200, flex: 1 }}
          disableCloseOnSelect
        />
      );
    }

    if (isSelectField && !isMultiOp) {
      return (
        <FormControl size="small" sx={{ minWidth: 160, flex: 1 }}>
          <InputLabel>{t("metamodel.visibilityRules.valueLabel")}</InputLabel>
          <Select
            value={
              Array.isArray(rule.value) ? (rule.value[0] ?? "") : (rule.value ?? "")
            }
            label={t("metamodel.visibilityRules.valueLabel")}
            onChange={(e) => onUpdate({ value: e.target.value as string })}
          >
            <MenuItem value="">
              <em>{t("metamodel.visibilityRules.valuePlaceholder")}</em>
            </MenuItem>
            {selectOptions.map((o) => (
              <MenuItem key={o.key} value={o.key}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (isMultiOp) {
      return (
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={[]}
          value={
            Array.isArray(rule.value) ? rule.value : rule.value ? [rule.value as string] : []
          }
          onChange={(_, vals) => onUpdate({ value: vals.map(String) })}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              label={t("metamodel.visibilityRules.valueLabel")}
              placeholder={t("metamodel.visibilityRules.valuePlaceholderMulti")}
            />
          )}
          sx={{ minWidth: 200, flex: 1 }}
        />
      );
    }

    return (
      <TextField
        size="small"
        label={t("metamodel.visibilityRules.valueLabel")}
        value={
          Array.isArray(rule.value) ? (rule.value[0] ?? "") : (rule.value ?? "")
        }
        onChange={(e) => onUpdate({ value: e.target.value })}
        sx={{ minWidth: 160, flex: 1 }}
      />
    );
  };

  return (
    <Box
      sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1 }}
      // Silence "Each child in a list should have a unique key" — key is on the caller
    >
      <FormControl size="small" sx={{ minWidth: 150, flexShrink: 0 }}>
        <InputLabel>{t("metamodel.visibilityRules.fieldLabel")}</InputLabel>
        <Select
          value={rule.field}
          label={t("metamodel.visibilityRules.fieldLabel")}
          onChange={(e) => handleFieldChange(e.target.value)}
        >
          {allFields.map((f) => (
            <MenuItem key={f.key} value={f.key}>
              {f.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 130, flexShrink: 0 }}>
        <InputLabel>{t("metamodel.visibilityRules.operatorLabel")}</InputLabel>
        <Select
          value={rule.op}
          label={t("metamodel.visibilityRules.operatorLabel")}
          onChange={(e) => handleOpChange(e.target.value as VisibilityOperator)}
        >
          <MenuItem value="eq">{t("metamodel.visibilityRules.opEqual")}</MenuItem>
          <MenuItem value="neq">{t("metamodel.visibilityRules.opNotEqual")}</MenuItem>
          <MenuItem value="in">{t("metamodel.visibilityRules.opIn")}</MenuItem>
          <MenuItem value="not_in">{t("metamodel.visibilityRules.opNotIn")}</MenuItem>
        </Select>
      </FormControl>

      {renderValueInput()}

      <Tooltip title={t("metamodel.visibilityRules.removeRule")}>
        <span>
          <IconButton
            size="small"
            onClick={onRemove}
            disabled={!canRemove}
            sx={{ mt: 0.5, flexShrink: 0 }}
          >
            <MaterialSymbol icon="close" size={16} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  targetLabel: string;
  targetType: "field" | "section";
  initialRules: VisibilityRuleSet | undefined;
  onSave: (rules: VisibilityRuleSet | null) => void;
  allFields: FieldDef[];
}

export default function VisibilityRulesDialog({
  open,
  onClose,
  targetLabel,
  targetType,
  initialRules,
  onSave,
  allFields,
}: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const [ruleSet, setRuleSet] = useState<VisibilityRuleSet>(emptyRuleSet);

  useEffect(() => {
    if (open) {
      setRuleSet(
        initialRules && initialRules.groups.length > 0 ? initialRules : emptyRuleSet(),
      );
    }
  }, [open, initialRules]);

  const multipleGroups = ruleSet.groups.length > 1;

  const updateRule = useCallback(
    (gi: number, ri: number, updates: Partial<VisibilityRule>) => {
      setRuleSet((prev) => ({
        ...prev,
        groups: prev.groups.map((g, i) =>
          i !== gi
            ? g
            : { ...g, rules: g.rules.map((r, j) => (j !== ri ? r : { ...r, ...updates })) },
        ),
      }));
    },
    [],
  );

  const addRule = (gi: number) => {
    setRuleSet((prev) => ({
      ...prev,
      groups: prev.groups.map((g, i) =>
        i !== gi ? g : { ...g, rules: [...g.rules, emptyRule()] },
      ),
    }));
  };

  const removeRule = (gi: number, ri: number) => {
    setRuleSet((prev) => ({
      ...prev,
      groups: prev.groups.map((g, i) => {
        if (i !== gi) return g;
        const next = g.rules.filter((_, j) => j !== ri);
        return { ...g, rules: next.length ? next : [emptyRule()] };
      }),
    }));
  };

  const updateGroupMatch = (gi: number, match: "all" | "any") => {
    setRuleSet((prev) => ({
      ...prev,
      groups: prev.groups.map((g, i) => (i !== gi ? g : { ...g, match })),
    }));
  };

  const addGroup = () => {
    setRuleSet((prev) => ({ ...prev, groups: [...prev.groups, emptyGroup()] }));
  };

  const removeGroup = (gi: number) => {
    if (ruleSet.groups.length <= 1) return;
    setRuleSet((prev) => ({ ...prev, groups: prev.groups.filter((_, i) => i !== gi) }));
  };

  const handleClear = () => {
    setRuleSet(emptyRuleSet());
  };

  const handleSave = () => {
    const cleaned: VisibilityRuleSet = {
      match: ruleSet.match,
      groups: ruleSet.groups
        .map((g) => ({ ...g, rules: g.rules.filter((r) => r.field) }))
        .filter((g) => g.rules.length > 0),
    };
    onSave(cleaned.groups.length > 0 ? cleaned : null);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth disableRestoreFocus>
      <DialogTitle sx={{ pb: 0.5 }}>
        {t("metamodel.visibilityRules.title")}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontWeight: 400 }}>
          {targetType === "field"
            ? t("metamodel.visibilityRules.subtitle_field", { label: targetLabel })
            : t("metamodel.visibilityRules.subtitle_section", { label: targetLabel })}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {/* Top-level group combinator — only shown when there are multiple groups */}
        {multipleGroups && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <Typography variant="body2">{t("metamodel.visibilityRules.hideWhen")}</Typography>
            <Select
              size="small"
              value={ruleSet.match}
              onChange={(e) =>
                setRuleSet((prev) => ({ ...prev, match: e.target.value as "all" | "any" }))
              }
              sx={{ minWidth: 80 }}
            >
              <MenuItem value="all">{t("metamodel.visibilityRules.matchAll")}</MenuItem>
              <MenuItem value="any">{t("metamodel.visibilityRules.matchAny")}</MenuItem>
            </Select>
            <Typography variant="body2">
              {t("metamodel.visibilityRules.ofTheseGroups")}
            </Typography>
          </Box>
        )}

        {ruleSet.groups.map((group, gi) => (
          <Box
            key={gi}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1.5,
              p: 1.5,
              mb: 1.5,
              bgcolor: "background.paper",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              {multipleGroups && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={600}
                  sx={{ minWidth: 64 }}
                >
                  {t("metamodel.visibilityRules.group", { n: gi + 1 })}
                </Typography>
              )}
              <Select
                size="small"
                value={group.match}
                onChange={(e) => updateGroupMatch(gi, e.target.value as "all" | "any")}
                sx={{ minWidth: 80 }}
              >
                <MenuItem value="all">{t("metamodel.visibilityRules.matchAll")}</MenuItem>
                <MenuItem value="any">{t("metamodel.visibilityRules.matchAny")}</MenuItem>
              </Select>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {t("metamodel.visibilityRules.rulesMustMatch")}
              </Typography>
              {multipleGroups && (
                <Tooltip title={t("metamodel.visibilityRules.removeGroup")}>
                  <IconButton size="small" onClick={() => removeGroup(gi)} color="error">
                    <MaterialSymbol icon="delete" size={16} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            {group.rules.map((rule, ri) => (
              <RuleRow
                key={`${gi}-${ri}`}
                rule={rule}
                allFields={allFields}
                onUpdate={(updates) => updateRule(gi, ri, updates)}
                onRemove={() => removeRule(gi, ri)}
                canRemove={group.rules.length > 1 || !!rule.field}
              />
            ))}

            <Button
              size="small"
              startIcon={<MaterialSymbol icon="add" size={14} />}
              onClick={() => addRule(gi)}
              sx={{ mt: 0.5 }}
            >
              {t("metamodel.visibilityRules.addRule")}
            </Button>
          </Box>
        ))}

        <Button
          size="small"
          startIcon={<MaterialSymbol icon="add" size={14} />}
          onClick={addGroup}
          sx={{ mb: 1.5 }}
        >
          {t("metamodel.visibilityRules.addGroup")}
        </Button>

        <Divider sx={{ my: 1.5 }} />
        <Alert severity="info">
          {t("metamodel.visibilityRules.helpText")}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
        <Button
          color="error"
          onClick={handleClear}
          startIcon={<MaterialSymbol icon="delete_sweep" size={16} />}
        >
          {t("metamodel.visibilityRules.clearRules")}
        </Button>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleSave}>
            {t("common:actions.save")}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
