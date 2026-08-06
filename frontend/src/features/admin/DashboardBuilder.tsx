import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import type { CustomDashboard, DashboardWidget, UserGroup } from "@/types";

// ─── widget catalogue ──────────────────────────────────────────────────────

interface WidgetMeta {
  type: string;
  icon: string;
  defaultW: 1 | 2 | 3;
}

const WIDGET_TYPES: WidgetMeta[] = [
  { type: "kpi_summary", icon: "bar_chart", defaultW: 3 },
  { type: "card_list", icon: "list", defaultW: 1 },
  { type: "saved_report", icon: "bookmark", defaultW: 2 },
  { type: "activity_feed", icon: "history", defaultW: 1 },
  { type: "lifecycle_chart", icon: "donut_large", defaultW: 2 },
  { type: "group_count_chart", icon: "calendar_month", defaultW: 3 },
  { type: "ai_quick_create", icon: "auto_awesome", defaultW: 2 },
  { type: "bar_chart", icon: "stacked_bar_chart", defaultW: 2 },
];

interface GroupCountBand {
  label: string;
  maxDays: number;
  color: string;
}

const DEFAULT_GC_BANDS: GroupCountBand[] = [
  { label: "≤30d", maxDays: 30, color: "#e53935" },
  { label: "31–90d", maxDays: 90, color: "#f57c00" },
  { label: ">90d", maxDays: -1, color: "#1976d2" },
];

const LIFECYCLE_DATE_OPTIONS = [
  { key: "lifecycle_plan", label: "Plan Date" },
  { key: "lifecycle_phaseIn", label: "Phase-in Date" },
  { key: "lifecycle_active", label: "Active Date" },
  { key: "lifecycle_phaseOut", label: "Phase-out Date" },
  { key: "lifecycle_endOfLife", label: "End of Life Date" },
];

interface KpiMeasureRow {
  id: string;
  fieldKey: string;
  condition: string;
  conditionValue: string;
  aggregation: string;
  label?: string;
  color?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function newWidget(type: string, w: 1 | 2 | 3): DashboardWidget {
  return {
    id: `${type}-${Date.now()}`,
    type,
    title: "",
    w,
    config: {},
  };
}

// ─── sortable widget row ─────────────────────────────────────────────────────

interface SortableWidgetProps {
  widget: DashboardWidget;
  onConfigure: (w: DashboardWidget) => void;
  onDelete: (id: string) => void;
  widgetLabel: (type: string) => string;
}

function SortableWidget({ widget, onConfigure, onDelete, widgetLabel }: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        p: 1,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        bgcolor: "background.paper",
      }}
    >
      <Box {...attributes} {...listeners} sx={{ cursor: "grab", color: "text.disabled", flexShrink: 0 }}>
        <MaterialSymbol icon="drag_indicator" size={20} />
      </Box>
      <MaterialSymbol
        icon={WIDGET_TYPES.find((m) => m.type === widget.type)?.icon ?? "widgets"}
        size={18}
        style={{ flexShrink: 0 }}
      />
      <Typography variant="body2" sx={{ flex: 1, fontWeight: widget.title ? 600 : 400, color: widget.title ? "text.primary" : "text.secondary" }}>
        {widget.title || widgetLabel(widget.type)}
      </Typography>
      <Chip label={`${widget.w}/3`} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
      <Tooltip title="Configure">
        <IconButton size="small" onClick={() => onConfigure(widget)}>
          <MaterialSymbol icon="settings" size={16} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Remove">
        <IconButton size="small" color="error" onClick={() => onDelete(widget.id)}>
          <MaterialSymbol icon="delete" size={16} />
        </IconButton>
      </Tooltip>
    </Paper>
  );
}

// ─── widget config dialog ───────────────────────────────────────────────────

interface WidgetConfigDialogProps {
  widget: DashboardWidget | null;
  onClose: () => void;
  onSave: (updated: DashboardWidget) => void;
}

function WidgetConfigDialog({ widget, onClose, onSave }: WidgetConfigDialogProps) {
  const { t } = useTranslation(["admin", "common"]);
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const [title, setTitle] = useState("");
  const [w, setW] = useState<1 | 2 | 3>(1);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [savedReports, setSavedReports] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!widget) return;
    setTitle(widget.title);
    setW(widget.w);
    setConfig({ ...widget.config });
    if (widget.type === "saved_report") {
      api.get<{ id: string; name: string }[]>("/saved-reports")
        .then(setSavedReports)
        .catch(() => setSavedReports([]));
    }
  }, [widget]);

  if (!widget) return null;

  const setConfigKey = (key: string, value: unknown) =>
    setConfig((prev) => ({ ...prev, [key]: value }));

  const cardTypeOptions = types
    .filter((ct) => !ct.is_hidden)
    .map((ct) => ({ id: ct.key, label: typeLabel(ct) }));

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>
        {t("dashboards.configureWidget", {
          type: t(`dashboards.widgetTypes.${widget.type}`, { defaultValue: widget.type }),
        })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t("dashboards.widgetTitle")}
            size="small"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(`dashboards.widgetTypes.${widget.type}`, { defaultValue: widget.type })}
            fullWidth
          />
          <Box>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">
              {t("dashboards.columnSpan")}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={w}
              onChange={(_, v) => { if (v !== null) setW(v as 1 | 2 | 3); }}
            >
              <ToggleButton value={1}>1 col</ToggleButton>
              <ToggleButton value={2}>2 col</ToggleButton>
              <ToggleButton value={3}>3 col</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Type-specific config */}
          {widget.type === "kpi_summary" && (() => {
            const kpiCardType = config.cardType as string | undefined;
            const kpiSubtype = config.subtype as string | undefined;
            const measures = (config.measures as KpiMeasureRow[] | undefined) ?? [];
            const selectedCardType = types.find((ct) => ct.key === kpiCardType) ?? null;
            const subtypeOptions: { key: string; label: string }[] =
              selectedCardType?.subtypes ?? [];

            const STANDARD_OPTS = [
              { key: "status", label: "Status" },
              { key: "approval_status", label: "Approval Status" },
              { key: "data_quality", label: "Data Quality (%)" },
            ];
            const LIFECYCLE_OPTS = [
              { key: "lifecycle_plan", label: "Plan Date" },
              { key: "lifecycle_phaseIn", label: "Phase-in Date" },
              { key: "lifecycle_active", label: "Active Date" },
              { key: "lifecycle_phaseOut", label: "Phase-out Date" },
              { key: "lifecycle_endOfLife", label: "End of Life Date" },
            ];
            const customOpts = selectedCardType
              ? (selectedCardType.fields_schema ?? []).flatMap((s) => s.fields).map((f) => ({ key: f.key, label: f.label }))
              : [];

            const COND_OPS = ["=", "!=", ">", ">=", "<", "<=", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"];
            const NO_VAL_OPS = ["IS_NULL", "IS_NOT_NULL"];
            const AGG_OPTS = [
              { v: "count", l: t("dashboards.kpiMeasures.count") },
              { v: "sum", l: t("dashboards.kpiMeasures.sum") },
              { v: "average", l: t("dashboards.kpiMeasures.average") },
            ];

            const addMeasure = () =>
              setConfigKey("measures", [
                ...measures,
                { id: `m_${Date.now()}`, fieldKey: "status", condition: "=", conditionValue: "", aggregation: "count" } as KpiMeasureRow,
              ]);
            const updMeasure = (idx: number, field: string, value: unknown) =>
              setConfigKey("measures", measures.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
            const delMeasure = (idx: number) =>
              setConfigKey("measures", measures.filter((_, i) => i !== idx));

            return (
              <Stack spacing={2}>
                <Autocomplete
                  options={cardTypeOptions}
                  value={cardTypeOptions.find((o) => o.id === kpiCardType) ?? null}
                  onChange={(_, v) => {
                    setConfig((prev) => ({ ...prev, cardType: v?.id ?? undefined, subtype: undefined, measures: [] }));
                  }}
                  getOptionLabel={(o) => o.label}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderInput={(params) => (
                    <TextField {...params} label={t("dashboards.cardType")} size="small" />
                  )}
                  size="small"
                />

                {subtypeOptions.length > 0 && (
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("dashboards.kpiSubtype")}</InputLabel>
                    <Select
                      label={t("dashboards.kpiSubtype")}
                      value={kpiSubtype ?? ""}
                      onChange={(e) => setConfigKey("subtype", e.target.value || undefined)}
                    >
                      <MenuItem value=""><em>{t("common:labels.none")}</em></MenuItem>
                      {subtypeOptions.map((st) => (
                        <MenuItem key={st.key} value={st.key}>{st.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    {t("dashboards.kpiMeasures.title")}
                  </Typography>
                  {!kpiCardType ? (
                    <Typography variant="body2" color="text.disabled" sx={{ py: 0.5 }}>
                      {t("dashboards.kpiMeasures.selectType")}
                    </Typography>
                  ) : measures.length === 0 ? (
                    <Typography variant="body2" color="text.disabled" sx={{ py: 0.5 }}>
                      {t("dashboards.kpiMeasures.noMeasures")}
                    </Typography>
                  ) : (
                    <Stack spacing={1.5}>
                      {measures.map((m, i) => (
                        <Paper key={m.id} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack spacing={1}>
                            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                              <FormControl size="small" sx={{ flex: 2, minWidth: 0 }}>
                                <InputLabel shrink>{t("dashboards.kpiMeasures.field")}</InputLabel>
                                <Select
                                  label={t("dashboards.kpiMeasures.field")}
                                  value={m.fieldKey}
                                  notched
                                  onChange={(e) => updMeasure(i, "fieldKey", e.target.value)}
                                >
                                  <ListSubheader>{t("dashboards.kpiMeasures.standardFields")}</ListSubheader>
                                  {STANDARD_OPTS.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                                  <ListSubheader>{t("dashboards.kpiMeasures.lifecycleFields")}</ListSubheader>
                                  {LIFECYCLE_OPTS.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                                  {customOpts.length > 0 && (
                                    <ListSubheader>{t("dashboards.kpiMeasures.customFields")}</ListSubheader>
                                  )}
                                  {customOpts.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
                                </Select>
                              </FormControl>
                              <FormControl size="small" sx={{ width: 110 }}>
                                <InputLabel shrink>{t("dashboards.kpiMeasures.condition")}</InputLabel>
                                <Select
                                  label={t("dashboards.kpiMeasures.condition")}
                                  value={m.condition}
                                  notched
                                  onChange={(e) => updMeasure(i, "condition", e.target.value)}
                                >
                                  {COND_OPS.map((op) => <MenuItem key={op} value={op}>{op}</MenuItem>)}
                                </Select>
                              </FormControl>
                              {!NO_VAL_OPS.includes(m.condition) && (
                                <TextField
                                  size="small"
                                  label={t("dashboards.kpiMeasures.value")}
                                  value={m.conditionValue ?? ""}
                                  onChange={(e) => updMeasure(i, "conditionValue", e.target.value)}
                                  sx={{ flex: 1.5, minWidth: 0 }}
                                  InputLabelProps={{ shrink: true }}
                                />
                              )}
                              <IconButton size="small" color="error" onClick={() => delMeasure(i)} sx={{ flexShrink: 0 }}>
                                <MaterialSymbol icon="delete" size={16} />
                              </IconButton>
                            </Box>
                            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                              <FormControl size="small" sx={{ width: 120 }}>
                                <InputLabel shrink>{t("dashboards.kpiMeasures.aggregation")}</InputLabel>
                                <Select
                                  label={t("dashboards.kpiMeasures.aggregation")}
                                  value={m.aggregation}
                                  notched
                                  onChange={(e) => updMeasure(i, "aggregation", e.target.value)}
                                >
                                  {AGG_OPTS.map((a) => <MenuItem key={a.v} value={a.v}>{a.l}</MenuItem>)}
                                </Select>
                              </FormControl>
                              <TextField
                                size="small"
                                label={t("dashboards.kpiMeasures.label")}
                                value={m.label ?? ""}
                                onChange={(e) => updMeasure(i, "label", e.target.value || undefined)}
                                sx={{ flex: 1, minWidth: 0 }}
                                InputLabelProps={{ shrink: true }}
                              />
                              <Box
                                component="input"
                                type="color"
                                value={m.color ?? "#1976d2"}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updMeasure(i, "color", e.target.value)}
                                sx={{
                                  width: 34,
                                  height: 34,
                                  border: "1px solid",
                                  borderColor: "divider",
                                  borderRadius: 1,
                                  cursor: "pointer",
                                  p: "2px",
                                  bgcolor: "transparent",
                                  flexShrink: 0,
                                }}
                              />
                            </Box>
                          </Stack>
                        </Paper>
                      ))}
                    </Stack>
                  )}
                  {kpiCardType && (
                    <Button
                      size="small"
                      startIcon={<MaterialSymbol icon="add" size={16} />}
                      onClick={addMeasure}
                      sx={{ mt: 1, textTransform: "none" }}
                    >
                      {t("dashboards.kpiMeasures.addMeasure")}
                    </Button>
                  )}
                </Box>
              </Stack>
            );
          })()}

          {(widget.type === "card_list" || widget.type === "lifecycle_chart") && (
            <Autocomplete
              options={cardTypeOptions}
              value={cardTypeOptions.find((o) => o.id === config.type) ?? null}
              onChange={(_, v) => setConfigKey("type", v?.id ?? "")}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField {...params} label={t("dashboards.cardType")} size="small" />
              )}
              size="small"
            />
          )}

          {widget.type === "card_list" && (
            <Stack spacing={2}>
              <TextField
                label={t("dashboards.limit")}
                type="number"
                size="small"
                value={config.limit ?? 10}
                onChange={(e) => setConfigKey("limit", Math.max(1, Math.min(50, Number(e.target.value))))}
                inputProps={{ min: 1, max: 50 }}
              />
              <FormControl size="small" fullWidth>
                <InputLabel>{t("dashboards.cardList.sortBy")}</InputLabel>
                <Select
                  label={t("dashboards.cardList.sortBy")}
                  value={(config.sortBy as string | undefined) ?? "name"}
                  onChange={(e) => setConfigKey("sortBy", e.target.value)}
                >
                  <MenuItem value="name">{t("dashboards.cardList.sortName")}</MenuItem>
                  <MenuItem value="created_at">{t("dashboards.cardList.sortCreated")}</MenuItem>
                  <MenuItem value="updated_at">{t("dashboards.cardList.sortUpdated")}</MenuItem>
                  <MenuItem value="data_quality">{t("dashboards.cardList.sortDataQuality")}</MenuItem>
                  <MenuItem value="status">{t("dashboards.cardList.sortStatus")}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("dashboards.cardList.sortDir")}</InputLabel>
                <Select
                  label={t("dashboards.cardList.sortDir")}
                  value={(config.sortDir as string | undefined) ?? "asc"}
                  onChange={(e) => setConfigKey("sortDir", e.target.value)}
                >
                  <MenuItem value="asc">{t("dashboards.cardList.sortAsc")}</MenuItem>
                  <MenuItem value="desc">{t("dashboards.cardList.sortDesc")}</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          )}

          {widget.type === "activity_feed" && (
            <TextField
              label={t("dashboards.limit")}
              type="number"
              size="small"
              value={config.limit ?? 10}
              onChange={(e) => setConfigKey("limit", Math.max(1, Math.min(50, Number(e.target.value))))}
              inputProps={{ min: 1, max: 50 }}
            />
          )}

          {widget.type === "saved_report" && (
            <FormControl size="small" fullWidth>
              <InputLabel>{t("dashboards.savedReport")}</InputLabel>
              <Select
                label={t("dashboards.savedReport")}
                value={config.reportId ?? ""}
                onChange={(e) => setConfigKey("reportId", e.target.value)}
              >
                <MenuItem value="">{t("common:labels.none")}</MenuItem>
                {savedReports.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {widget.type === "group_count_chart" && (() => {
            const gcType = config.type as string | undefined;
            const gcFieldKey = config.fieldKey as string | undefined;
            const gcBands = (config.bands as GroupCountBand[] | undefined) ?? [...DEFAULT_GC_BANDS];
            const selectedCT = types.find((ct) => ct.key === gcType) ?? null;
            const customDateFields = selectedCT
              ? (selectedCT.fields_schema ?? [])
                  .flatMap((s) => s.fields)
                  .filter((f) => f.type === "date")
              : [];

            const updateBand = (idx: number, field: string, value: unknown) => {
              setConfigKey(
                "bands",
                gcBands.map((b, i) => (i === idx ? { ...b, [field]: value } : b)),
              );
            };
            const removeBand = (idx: number) => {
              setConfigKey("bands", gcBands.filter((_, i) => i !== idx));
            };
            const addBand = () => {
              setConfigKey("bands", [
                ...gcBands,
                { label: "New band", maxDays: -1, color: "#9e9e9e" },
              ]);
            };

            return (
              <Stack spacing={2}>
                <Autocomplete
                  options={cardTypeOptions}
                  value={cardTypeOptions.find((o) => o.id === gcType) ?? null}
                  onChange={(_, v) => {
                    setConfig((prev) => ({
                      ...prev,
                      type: v?.id ?? undefined,
                      fieldKey: undefined,
                    }));
                  }}
                  getOptionLabel={(o) => o.label}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderInput={(params) => (
                    <TextField {...params} label={t("dashboards.cardType")} size="small" />
                  )}
                  size="small"
                />

                <FormControl size="small" fullWidth>
                  <InputLabel>{t("dashboards.groupCountChart.timescale")}</InputLabel>
                  <Select
                    label={t("dashboards.groupCountChart.timescale")}
                    value={(config.timescale as string | undefined) ?? "months"}
                    onChange={(e) => setConfigKey("timescale", e.target.value)}
                  >
                    <MenuItem value="weeks">{t("dashboards.groupCountChart.timescaleWeeks")}</MenuItem>
                    <MenuItem value="months">{t("dashboards.groupCountChart.timescaleMonths")}</MenuItem>
                    <MenuItem value="quarters">{t("dashboards.groupCountChart.timescaleQuarters")}</MenuItem>
                    <MenuItem value="years">{t("dashboards.groupCountChart.timescaleYears")}</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>{t("dashboards.groupCountChart.dateField")}</InputLabel>
                  <Select
                    label={t("dashboards.groupCountChart.dateField")}
                    value={gcFieldKey ?? ""}
                    onChange={(e) => setConfigKey("fieldKey", e.target.value || undefined)}
                  >
                    <MenuItem value="">
                      <em>{t("common:labels.none")}</em>
                    </MenuItem>
                    <ListSubheader>{t("dashboards.groupCountChart.lifecycleFields")}</ListSubheader>
                    {LIFECYCLE_DATE_OPTIONS.map((f) => (
                      <MenuItem key={f.key} value={f.key}>
                        {f.label}
                      </MenuItem>
                    ))}
                    {customDateFields.length > 0 && (
                      <ListSubheader>{t("dashboards.groupCountChart.customFields")}</ListSubheader>
                    )}
                    {customDateFields.map((f) => (
                      <MenuItem key={f.key} value={f.key}>
                        {f.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
                    {t("dashboards.groupCountChart.bands")}
                  </Typography>
                  <Stack spacing={1}>
                    {gcBands.map((band, i) => (
                      <Box
                        key={i}
                        sx={{ display: "flex", gap: 1, alignItems: "center" }}
                      >
                        <Box
                          component="input"
                          type="color"
                          value={band.color}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            updateBand(i, "color", e.target.value)
                          }
                          sx={{
                            width: 34,
                            height: 34,
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 1,
                            cursor: "pointer",
                            p: "2px",
                            bgcolor: "transparent",
                            flexShrink: 0,
                          }}
                        />
                        <TextField
                          size="small"
                          label={t("dashboards.groupCountChart.bandLabel")}
                          value={band.label}
                          onChange={(e) => updateBand(i, "label", e.target.value)}
                          sx={{ flex: 1 }}
                        />
                        <TextField
                          size="small"
                          label={t("dashboards.groupCountChart.maxDays")}
                          type="number"
                          value={band.maxDays === -1 ? "" : band.maxDays}
                          placeholder={t("dashboards.groupCountChart.noLimit")}
                          onChange={(e) =>
                            updateBand(
                              i,
                              "maxDays",
                              e.target.value === "" ? -1 : Math.max(1, Number(e.target.value)),
                            )
                          }
                          sx={{ width: 110 }}
                          inputProps={{ min: 1 }}
                        />
                        <Tooltip title={t("common:actions.delete", { ns: "common" })}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeBand(i)}
                            disabled={gcBands.length <= 1}
                          >
                            <MaterialSymbol icon="delete" size={16} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Stack>
                  <Button
                    size="small"
                    startIcon={<MaterialSymbol icon="add" size={16} />}
                    onClick={addBand}
                    sx={{ mt: 1, textTransform: "none" }}
                  >
                    {t("dashboards.groupCountChart.addBand")}
                  </Button>
                </Box>
              </Stack>
            );
          })()}

          {widget.type === "bar_chart" && (() => {
            const bcType = config.cardType as string | undefined;
            const bcSubtype = config.subtype as string | undefined;
            const selectedBcCT = types.find((ct) => ct.key === bcType) ?? null;
            const bcCustomFields = selectedBcCT
              ? (selectedBcCT.fields_schema ?? []).flatMap((s) => s.fields)
              : [];
            const bcSelectFields = bcCustomFields.filter(
              (f) => f.type === "single_select" || f.type === "multiple_select",
            );
            const bcNumericFields = bcCustomFields.filter(
              (f) => f.type === "number" || f.type === "cost",
            );
            const subtypeOptions = selectedBcCT?.subtypes ?? [];

            return (
              <Stack spacing={2}>
                <Autocomplete
                  options={cardTypeOptions}
                  value={cardTypeOptions.find((o) => o.id === bcType) ?? null}
                  onChange={(_, v) => {
                    setConfig((prev) => ({
                      ...prev,
                      cardType: v?.id ?? undefined,
                      subtype: undefined,
                      xField: undefined,
                      yField: undefined,
                    }));
                  }}
                  getOptionLabel={(o) => o.label}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderInput={(params) => (
                    <TextField {...params} label={t("dashboards.cardType")} size="small" />
                  )}
                  size="small"
                />

                {subtypeOptions.length > 0 && (
                  <FormControl size="small" fullWidth>
                    <InputLabel>{t("dashboards.barChart.subtype")}</InputLabel>
                    <Select
                      label={t("dashboards.barChart.subtype")}
                      value={bcSubtype ?? ""}
                      onChange={(e) => setConfigKey("subtype", e.target.value || undefined)}
                    >
                      <MenuItem value="">
                        <em>{t("common:labels.all")}</em>
                      </MenuItem>
                      {subtypeOptions.map((s) => (
                        <MenuItem key={s.key} value={s.key}>
                          {s.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <FormControl size="small" fullWidth>
                  <InputLabel>{t("dashboards.barChart.orientation")}</InputLabel>
                  <Select
                    label={t("dashboards.barChart.orientation")}
                    value={(config.orientation as string | undefined) ?? "vertical"}
                    onChange={(e) => setConfigKey("orientation", e.target.value)}
                  >
                    <MenuItem value="vertical">{t("dashboards.barChart.orientationVertical")}</MenuItem>
                    <MenuItem value="horizontal">{t("dashboards.barChart.orientationHorizontal")}</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>{t("dashboards.barChart.xField")}</InputLabel>
                  <Select
                    label={t("dashboards.barChart.xField")}
                    value={(config.xField as string | undefined) ?? ""}
                    onChange={(e) => setConfigKey("xField", e.target.value || undefined)}
                  >
                    <MenuItem value="">
                      <em>{t("common:labels.none")}</em>
                    </MenuItem>
                    <ListSubheader>{t("dashboards.barChart.standardFields")}</ListSubheader>
                    <MenuItem value="status">{t("dashboards.barChart.fieldStatus")}</MenuItem>
                    <MenuItem value="approval_status">{t("dashboards.barChart.fieldApprovalStatus")}</MenuItem>
                    <MenuItem value="subtype">{t("dashboards.barChart.fieldSubtype")}</MenuItem>
                    {bcSelectFields.length > 0 && (
                      <ListSubheader>{t("dashboards.barChart.customFields")}</ListSubheader>
                    )}
                    {bcSelectFields.map((f) => (
                      <MenuItem key={f.key} value={f.key}>
                        {f.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>{t("dashboards.barChart.yField")}</InputLabel>
                  <Select
                    label={t("dashboards.barChart.yField")}
                    value={(config.yField as string | undefined) ?? "count"}
                    onChange={(e) => setConfigKey("yField", e.target.value)}
                  >
                    <MenuItem value="count">{t("dashboards.barChart.yFieldCount")}</MenuItem>
                    {bcNumericFields.length > 0 && (
                      <ListSubheader>{t("dashboards.barChart.numericFields")}</ListSubheader>
                    )}
                    {bcNumericFields.map((f) => (
                      <MenuItem key={f.key} value={f.key}>
                        {f.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            );
          })()}

          {widget.type === "ai_quick_create" && (
            <>
              <Autocomplete
                options={cardTypeOptions}
                value={cardTypeOptions.find((o) => o.id === config.cardType) ?? null}
                onChange={(_, v) => setConfigKey("cardType", v?.id ?? "")}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t("dashboards.aiQuickCreate.cardType")}
                    size="small"
                    required
                  />
                )}
                size="small"
              />

              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={(config.aiEnabled as boolean | undefined) ?? false}
                    onChange={(e) => setConfigKey("aiEnabled", e.target.checked)}
                  />
                }
                label={t("dashboards.aiQuickCreate.aiEnabled")}
              />

              {(config.aiEnabled as boolean | undefined) && (
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={(config.attachFile as boolean | undefined) ?? true}
                      onChange={(e) => setConfigKey("attachFile", e.target.checked)}
                    />
                  }
                  label={t("dashboards.aiQuickCreate.attachFile")}
                />
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:cancel")}</Button>
        <Button
          variant="contained"
          onClick={() => onSave({ ...widget, title, w, config })}
        >
          {t("common:apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── main builder ────────────────────────────────────────────────────────────

export default function DashboardBuilder() {
  const { t } = useTranslation(["admin", "common"]);
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [name, setName] = useState("");
  const [audienceGroups, setAudienceGroups] = useState<string[]>([]);
  const [defaultForGroups, setDefaultForGroups] = useState<string[]>([]);
  const [priority, setPriority] = useState(0);
  const [layout, setLayout] = useState<DashboardWidget[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [configWidget, setConfigWidget] = useState<DashboardWidget | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const widgetLabel = useCallback(
    (type: string) =>
      t(`dashboards.widgetTypes.${type}`, { defaultValue: type }),
    [t],
  );

  useEffect(() => {
    api.get<UserGroup[]>("/user-groups").then(setGroups).catch(() => {});
    if (!isNew && id) {
      setLoading(true);
      api
        .get<CustomDashboard>(`/custom-dashboards/${id}`)
        .then((d) => {
          setName(d.name);
          setAudienceGroups(d.audienceGroups);
          setDefaultForGroups(d.defaultForGroups);
          setPriority(d.priority);
          setLayout(d.layout);
        })
        .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
        .finally(() => setLoading(false));
    }
  }, [id, isNew, t]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setLayout((prev) => {
        const oldIdx = prev.findIndex((w) => w.id === active.id);
        const newIdx = prev.findIndex((w) => w.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  const addWidget = (type: string) => {
    const widgetMeta = WIDGET_TYPES.find((m) => m.type === type);
    setLayout((prev) => [...prev, newWidget(type, widgetMeta?.defaultW ?? 1)]);
  };

  const deleteWidget = (widgetId: string) =>
    setLayout((prev) => prev.filter((w) => w.id !== widgetId));

  const saveWidgetConfig = (updated: DashboardWidget) => {
    setLayout((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
    setConfigWidget(null);
  };

  const save = async (publish?: boolean) => {
    if (!name.trim()) {
      setError(t("dashboards.nameRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        audience_groups: audienceGroups,
        default_for_groups: defaultForGroups.filter((g) => audienceGroups.includes(g)),
        priority,
        layout,
      };
      let saved: CustomDashboard;
      if (isNew) {
        saved = await api.post<CustomDashboard>("/custom-dashboards", payload);
      } else {
        saved = await api.patch<CustomDashboard>(`/custom-dashboards/${id}`, payload);
      }
      if (publish) {
        await api.post(`/custom-dashboards/${saved.id}/publish`, {});
      }
      navigate("/admin/dashboards");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const groupOptions = groups.map((g) => ({ id: g.id, label: g.name }));

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
        <IconButton size="small" onClick={() => navigate("/admin/dashboards")}>
          <MaterialSymbol icon="arrow_back" size={20} />
        </IconButton>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {isNew ? t("dashboards.newDashboard") : t("dashboards.editDashboard")}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          disabled={saving}
          sx={{ textTransform: "none" }}
          onClick={() => save(false)}
        >
          {t("common:save")}
        </Button>
        <Button
          variant="contained"
          size="small"
          disabled={saving}
          sx={{ textTransform: "none" }}
          onClick={() => save(true)}
        >
          {t("dashboards.saveAndPublish")}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 3, alignItems: "start" }}>
        {/* Left: Canvas */}
        <Box>
          {/* Settings section */}
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {t("dashboards.settings")}
            </Typography>
            <Stack spacing={2}>
              <TextField
                label={t("dashboards.name")}
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                fullWidth
              />
              <Autocomplete
                multiple
                options={groupOptions}
                value={groupOptions.filter((g) => audienceGroups.includes(g.id))}
                onChange={(_, v) => {
                  const newIds = v.map((g) => g.id);
                  setAudienceGroups(newIds);
                  setDefaultForGroups((prev) => prev.filter((g) => newIds.includes(g)));
                }}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => (
                  <TextField {...params} label={t("dashboards.audienceGroups")} size="small" />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={option.id}
                      label={option.label}
                      size="small"
                    />
                  ))
                }
                size="small"
              />
              <Autocomplete
                multiple
                options={groupOptions.filter((g) => audienceGroups.includes(g.id))}
                value={groupOptions.filter((g) => defaultForGroups.includes(g.id))}
                onChange={(_, v) => setDefaultForGroups(v.map((g) => g.id))}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => (
                  <TextField {...params} label={t("dashboards.defaultForGroups")} size="small" />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={option.id}
                      label={option.label}
                      size="small"
                    />
                  ))
                }
                size="small"
                disabled={audienceGroups.length === 0}
              />
              <TextField
                label={t("dashboards.priority")}
                type="number"
                size="small"
                value={priority}
                onChange={(e) => setPriority(Math.max(0, Number(e.target.value)))}
                inputProps={{ min: 0 }}
                helperText={t("dashboards.priorityHelp")}
                sx={{ width: 180 }}
              />
            </Stack>
          </Paper>

          {/* Widget canvas */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              {t("dashboards.layout")}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                ({layout.length} {t("dashboards.widgetCount", { count: layout.length })})
              </Typography>
            </Typography>

            {layout.length === 0 ? (
              <Box
                sx={{
                  border: "2px dashed",
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 4,
                  textAlign: "center",
                }}
              >
                <MaterialSymbol icon="widgets" size={32} style={{ color: "#bdbdbd" }} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t("dashboards.emptyCanvas")}
                </Typography>
              </Box>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={layout.map((w) => w.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Stack spacing={1}>
                    {layout.map((widget) => (
                      <SortableWidget
                        key={widget.id}
                        widget={widget}
                        onConfigure={setConfigWidget}
                        onDelete={deleteWidget}
                        widgetLabel={widgetLabel}
                      />
                    ))}
                  </Stack>
                </SortableContext>
              </DndContext>
            )}
          </Paper>
        </Box>

        {/* Right: Widget palette */}
        <Paper variant="outlined" sx={{ p: 2, position: "sticky", top: 80 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            {t("dashboards.addWidget")}
          </Typography>
          <Stack spacing={1}>
            {WIDGET_TYPES.map((meta) => (
              <Button
                key={meta.type}
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<MaterialSymbol icon={meta.icon} size={18} />}
                sx={{ textTransform: "none", justifyContent: "flex-start" }}
                onClick={() => addWidget(meta.type)}
              >
                {t(`dashboards.widgetTypes.${meta.type}`, { defaultValue: meta.type })}
              </Button>
            ))}
          </Stack>
        </Paper>
      </Box>

      <WidgetConfigDialog
        widget={configWidget}
        onClose={() => setConfigWidget(null)}
        onSave={saveWidgetConfig}
      />
    </Box>
  );
}
