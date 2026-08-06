import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, LabelList,
} from "recharts";
import AiQuickCreateWidget from "@/features/dashboard/AiQuickCreateWidget";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useTypeLabel } from "@/hooks/useResolveLabel";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { CustomDashboard, DashboardWidget } from "@/types";

// ── KPI Measure types ────────────────────────────────────────────────────────
type ConditionOperator =
  | "=" | "!=" | ">" | ">=" | "<" | "<="
  | "IN" | "NOT_IN" | "IS_NULL" | "IS_NOT_NULL";
type AggregationType = "count" | "sum" | "average";

interface KpiMeasure {
  id: string;
  fieldKey: string;
  condition: ConditionOperator;
  conditionValue: string;
  aggregation: AggregationType;
  label?: string;
  color?: string;
}

interface KpiSummaryConfig {
  cardType?: string;
  subtype?: string;
  measures?: KpiMeasure[];
}

function getKpiFieldValue(
  card: {
    status?: string;
    approval_status?: string;
    data_quality?: number;
    lifecycle?: Record<string, string | null> | null;
    attributes?: Record<string, unknown> | null;
  },
  fieldKey: string,
): unknown {
  if (fieldKey === "status") return card.status;
  if (fieldKey === "approval_status") return card.approval_status;
  if (fieldKey === "data_quality") return card.data_quality;
  if (fieldKey.startsWith("lifecycle_")) return card.lifecycle?.[fieldKey.slice("lifecycle_".length)] ?? null;
  return card.attributes?.[fieldKey] ?? null;
}

function evaluateKpiCondition(value: unknown, op: ConditionOperator, condValue: string): boolean {
  if (op === "IS_NULL") return value == null || value === "";
  if (op === "IS_NOT_NULL") return value != null && value !== "";
  const strVal = String(value ?? "");
  const numVal = parseFloat(strVal);
  const condNum = parseFloat(condValue);
  switch (op) {
    case "=": return strVal === condValue;
    case "!=": return strVal !== condValue;
    case ">": return !isNaN(numVal) && !isNaN(condNum) && numVal > condNum;
    case ">=": return !isNaN(numVal) && !isNaN(condNum) && numVal >= condNum;
    case "<": return !isNaN(numVal) && !isNaN(condNum) && numVal < condNum;
    case "<=": return !isNaN(numVal) && !isNaN(condNum) && numVal <= condNum;
    case "IN": return condValue.split(",").map((s) => s.trim()).includes(strVal);
    case "NOT_IN": return !condValue.split(",").map((s) => s.trim()).includes(strVal);
  }
  return false;
}

type KpiCard = {
  status?: string;
  approval_status?: string;
  data_quality?: number;
  lifecycle?: Record<string, string | null> | null;
  attributes?: Record<string, unknown> | null;
};

function computeMeasureValue(cards: KpiCard[], measure: KpiMeasure): number {
  const matching = cards.filter((c) =>
    evaluateKpiCondition(getKpiFieldValue(c, measure.fieldKey), measure.condition, measure.conditionValue),
  );
  if (measure.aggregation === "count") return matching.length;
  const nums = matching
    .map((c) => Number(getKpiFieldValue(c, measure.fieldKey)))
    .filter((n) => !isNaN(n));
  if (!nums.length) return 0;
  if (measure.aggregation === "sum") return Math.round(nums.reduce((s, n) => s + n, 0) * 10) / 10;
  return Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;
}

const MEASURE_COLORS = ["#1976d2", "#2e7d32", "#e65100", "#6a1b9a", "#0277bd", "#558b2f", "#c62828", "#00838f"];
const MEASURE_AGG_ICONS: Record<AggregationType, string> = { count: "numbers", sum: "functions", average: "calculate" };
interface CardListConfig {
  type?: string;
  limit?: number;
  title?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}
interface SavedReportConfig {
  reportId?: string;
}
interface ActivityFeedConfig {
  limit?: number;
}
interface LifecycleChartConfig {
  type?: string;
}
interface GroupCountBand {
  label: string;
  maxDays: number; // -1 = no upper limit (catch-all)
  color: string;
}
interface GroupCountChartConfig {
  type?: string;
  fieldKey?: string;
  bands?: GroupCountBand[];
  timescale?: string;
}

interface BarChartWidgetConfig {
  cardType?: string;
  subtype?: string;
  orientation?: "horizontal" | "vertical";
  xField?: string;
  yField?: string;
}

const DEFAULT_BANDS: GroupCountBand[] = [
  { label: "≤30d", maxDays: 30, color: "#e53935" },
  { label: "31–90d", maxDays: 90, color: "#f57c00" },
  { label: ">90d", maxDays: -1, color: "#1976d2" },
];

function getCardDateValue(
  card: {
    lifecycle?: Record<string, string | null> | null;
    attributes?: Record<string, unknown> | null;
  },
  fieldKey: string,
): string | null {
  if (fieldKey.startsWith("lifecycle_")) {
    const lcKey = fieldKey.slice("lifecycle_".length);
    return (card.lifecycle?.[lcKey] as string | null | undefined) ?? null;
  }
  const val = card.attributes?.[fieldKey];
  return typeof val === "string" ? val : null;
}

function assignBand(daysUntil: number, sortedBands: GroupCountBand[]): GroupCountBand {
  for (const band of sortedBands) {
    if (band.maxDays === -1 || daysUntil <= band.maxDays) return band;
  }
  return sortedBands[sortedBands.length - 1];
}

type Timescale = "weeks" | "months" | "quarters" | "years";

interface GCBucket {
  key: string;
  label: string;
  start: string;
  end: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function generateTimescaleBuckets(today: Date, ts: Timescale): GCBucket[] {
  const buckets: GCBucket[] = [];
  switch (ts) {
    case "weeks": {
      const dow = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
      monday.setHours(0, 0, 0, 0);
      for (let i = 0; i < 13; i++) {
        const start = new Date(monday);
        start.setDate(monday.getDate() + i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        buckets.push({
          key: toDateStr(start),
          label: `${start.getDate()} ${start.toLocaleDateString("en", { month: "short" })}`,
          start: toDateStr(start),
          end: toDateStr(end),
        });
      }
      break;
    }
    case "months": {
      for (let i = 0; i < 12; i++) {
        const m = new Date(today.getFullYear(), today.getMonth() + i, 1);
        const endD = new Date(today.getFullYear(), today.getMonth() + i + 1, 0);
        let label = m.toLocaleDateString("en", { month: "short" });
        if (i > 0 && m.getMonth() === 0) label = `${label} '${String(m.getFullYear()).slice(2)}`;
        buckets.push({
          key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`,
          label,
          start: toDateStr(m),
          end: toDateStr(endD),
        });
      }
      break;
    }
    case "quarters": {
      const startQ = Math.floor(today.getMonth() / 3);
      for (let i = 0; i < 8; i++) {
        const totalQ = startQ + i;
        const year = today.getFullYear() + Math.floor(totalQ / 4);
        const q = totalQ % 4;
        const qStart = new Date(year, q * 3, 1);
        const qEnd = new Date(year, q * 3 + 3, 0);
        buckets.push({
          key: `${year}-Q${q + 1}`,
          label: `Q${q + 1} '${String(year).slice(2)}`,
          start: toDateStr(qStart),
          end: toDateStr(qEnd),
        });
      }
      break;
    }
    case "years": {
      for (let i = 0; i < 5; i++) {
        const year = today.getFullYear() + i;
        buckets.push({
          key: `${year}`,
          label: `${year}`,
          start: `${year}-01-01`,
          end: `${year}-12-31`,
        });
      }
      break;
    }
  }
  return buckets;
}

type GCBucketData = { bucket: string; total: number; _topMarker: 0; [band: string]: number | string };

function WidgetShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardHeader
        title={title}
        subheader={subtitle}
        titleTypographyProps={{ variant: "subtitle1", fontWeight: 600 }}
        subheaderTypographyProps={{ variant: "caption" }}
        sx={{ pb: 0 }}
      />
      <Divider />
      <CardContent sx={{ flex: 1, overflow: "auto" }}>{children}</CardContent>
    </Card>
  );
}

function KpiSummaryWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["admin", "common"]);
  const config = widget.config as KpiSummaryConfig;
  const measuresJson = JSON.stringify(config.measures ?? []);
  const [values, setValues] = useState<number[] | null>(null);

  useEffect(() => {
    const measures: KpiMeasure[] = JSON.parse(measuresJson);
    if (!config.cardType || !measures.length) {
      setValues([]);
      return;
    }
    const params = new URLSearchParams({ type: config.cardType, page_size: "1000" });
    if (config.subtype) params.set("subtype", config.subtype);
    api
      .get<{ items: KpiCard[] }>(`/cards?${params}`)
      .then((d) => {
        const cards = (d.items ?? []).filter((c) => c.status !== "ARCHIVED");
        setValues(measures.map((m) => computeMeasureValue(cards, m)));
      })
      .catch(() => setValues([]));
  }, [config.cardType, config.subtype, measuresJson]);

  const measures: KpiMeasure[] = JSON.parse(measuresJson);

  return (
    <WidgetShell title={widget.title || t("admin:dashboards.widgets.kpiSummary")}>
      {values === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : !config.cardType || !measures.length ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("admin:dashboards.kpiMeasures.noMeasures")}
        </Typography>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 1.5, pt: 1 }}>
          {measures.map((m, i) => {
            const color = m.color ?? MEASURE_COLORS[i % MEASURE_COLORS.length];
            const icon = MEASURE_AGG_ICONS[m.aggregation] ?? "numbers";
            const label = m.label || `${m.fieldKey}: ${m.conditionValue || m.condition}`;
            const displayVal = values[i] ?? 0;
            return (
              <Box
                key={m.id}
                sx={{ p: 1.5, borderRadius: 1, border: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}
              >
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, mb: 1 }}>
                  <MaterialSymbol icon={icon} size={20} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
                    {label}
                  </Typography>
                </Box>
                <Typography variant="h4" fontWeight={700} sx={{ color }}>
                  {displayVal.toLocaleString()}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </WidgetShell>
  );
}

function CardListWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["common", "admin"]);
  const navigate = useNavigate();
  const config = widget.config as CardListConfig;
  const limit = config.limit ?? 10;
  const sortBy = config.sortBy ?? "name";
  const sortDir = config.sortDir ?? "asc";
  const [items, setItems] = useState<{ id: string; name: string; type: string }[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page_size: String(limit), sort_by: sortBy, sort_dir: sortDir });
    if (config.type) params.set("type", config.type);
    api.get<{ items: { id: string; name: string; type: string }[] }>(`/cards?${params}`)
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, [config.type, limit, sortBy, sortDir]);

  return (
    <WidgetShell title={widget.title || t("dashboards.widgets.cardList")}>
      {items === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("common:labels.noResults")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.map((card, idx) => (
            <ListItem
              key={card.id}
              disableGutters
              divider={idx < items.length - 1}
              sx={{ cursor: "pointer", "&:hover": { bgcolor: "action.hover" }, px: 0.5, borderRadius: 1 }}
              onClick={() => navigate(`/cards/${card.id}`)}
            >
              <ListItemText
                primary={card.name}
                secondary={card.type}
                primaryTypographyProps={{ variant: "body2", noWrap: true }}
                secondaryTypographyProps={{ variant: "caption" }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </WidgetShell>
  );
}

function SavedReportWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["common", "admin"]);
  const navigate = useNavigate();
  const config = widget.config as SavedReportConfig;
  const [report, setReport] = useState<{ id: string; name: string; report_type: string; thumbnail?: string } | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!config.reportId) {
      setReport(null);
      return;
    }
    api.get<{ id: string; name: string; report_type: string; thumbnail?: string }>(
      `/saved-reports/${config.reportId}`,
    )
      .then(setReport)
      .catch(() => setReport(null));
  }, [config.reportId]);

  return (
    <WidgetShell title={widget.title || t("dashboards.widgets.savedReport")}>
      {report === undefined ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : report === null ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {config.reportId
            ? t("dashboards.widgets.reportNotFound")
            : t("dashboards.widgets.noReportConfigured")}
        </Typography>
      ) : (
        <Box sx={{ pt: 1 }}>
          {report.thumbnail && (
            <Box
              component="img"
              src={report.thumbnail}
              alt={report.name}
              sx={{ width: "100%", borderRadius: 1, mb: 1, maxHeight: 160, objectFit: "cover" }}
            />
          )}
          <Typography variant="body2" gutterBottom>
            {report.name}
          </Typography>
          <Chip label={report.report_type} size="small" variant="outlined" sx={{ mb: 1 }} />
          <Box>
            <Link
              component="button"
              variant="body2"
              onClick={() => navigate(`/reports/saved?open=${report.id}`)}
            >
              {t("dashboards.widgets.openReport")}
            </Link>
          </Box>
        </Box>
      )}
    </WidgetShell>
  );
}

function ActivityFeedWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["common", "admin"]);
  const config = widget.config as ActivityFeedConfig;
  const limit = config.limit ?? 10;
  const [events, setEvents] = useState<
    { id: string; event_type: string; created_at: string; card_name?: string }[] | null
  >(null);

  useEffect(() => {
    api.get<{ items: { id: string; event_type: string; created_at: string; card_name?: string }[] }>(
      `/events?page_size=${limit}`,
    )
      .then((d) => setEvents(d.items ?? []))
      .catch(() => setEvents([]));
  }, [limit]);

  return (
    <WidgetShell title={widget.title || t("dashboards.widgets.activityFeed")}>
      {events === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : events.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("common:labels.noResults")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {events.map((ev, idx) => (
            <ListItem key={ev.id} disableGutters divider={idx < events.length - 1}>
              <ListItemText
                primary={ev.event_type.replace(/_/g, " ")}
                secondary={ev.card_name ?? new Date(ev.created_at).toLocaleDateString()}
                primaryTypographyProps={{ variant: "body2", sx: { textTransform: "capitalize" } }}
                secondaryTypographyProps={{ variant: "caption" }}
              />
            </ListItem>
          ))}
        </List>
      )}
    </WidgetShell>
  );
}

const LIFECYCLE_PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number] | "none";

const LIFECYCLE_COLORS: Record<LifecyclePhase, string> = {
  plan: "#9e9e9e",
  phaseIn: "#1976d2",
  active: "#2e7d32",
  phaseOut: "#ed6c02",
  endOfLife: "#c62828",
  none: "#bdbdbd",
};

function getCurrentPhase(lifecycle: Record<string, string | null> | null | undefined): LifecyclePhase {
  if (!lifecycle) return "none";
  const today = new Date().toISOString().slice(0, 10);
  if (lifecycle.endOfLife && today >= lifecycle.endOfLife) return "endOfLife";
  if (lifecycle.phaseOut && today >= lifecycle.phaseOut) return "phaseOut";
  if (lifecycle.active && today >= lifecycle.active) return "active";
  if (lifecycle.phaseIn && today >= lifecycle.phaseIn) return "phaseIn";
  if (LIFECYCLE_PHASES.some((p) => lifecycle[p])) return "plan";
  return "none";
}

function LifecycleChartWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["common", "admin"]);
  const navigate = useNavigate();
  const config = widget.config as LifecycleChartConfig;
  const [phaseCounts, setPhaseCounts] = useState<Record<LifecyclePhase, number> | null>(null);

  useEffect(() => {
    if (!config.type) {
      setPhaseCounts({ plan: 0, phaseIn: 0, active: 0, phaseOut: 0, endOfLife: 0, none: 0 });
      return;
    }
    const params = new URLSearchParams({ type: config.type, page_size: "500" });
    api
      .get<{ items: { status: string; lifecycle: Record<string, string | null> | null }[] }>(
        `/cards?${params}`,
      )
      .then((d) => {
        const counts: Record<LifecyclePhase, number> = {
          plan: 0, phaseIn: 0, active: 0, phaseOut: 0, endOfLife: 0, none: 0,
        };
        for (const card of d.items ?? []) {
          if (card.status === "ARCHIVED") continue;
          counts[getCurrentPhase(card.lifecycle)]++;
        }
        setPhaseCounts(counts);
      })
      .catch(() =>
        setPhaseCounts({ plan: 0, phaseIn: 0, active: 0, phaseOut: 0, endOfLife: 0, none: 0 }),
      );
  }, [config.type]);

  const phaseLabel = (phase: LifecyclePhase) =>
    phase === "none" ? t("common:lifecycle.notSet") : t(`common:lifecycle.${phase}`);

  const hasData =
    phaseCounts !== null &&
    (Object.values(phaseCounts) as number[]).some((c) => c > 0);

  return (
    <WidgetShell title={widget.title || t("dashboards.widgets.lifecycleChart")}>
      {phaseCounts === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : !hasData ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("common:labels.noResults")}
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, pt: 1 }}>
          {([...LIFECYCLE_PHASES, "none"] as LifecyclePhase[])
            .filter((phase) => phaseCounts[phase] > 0)
            .map((phase) => (
              <Box
                key={phase}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  p: 1,
                  borderRadius: 1,
                  minWidth: 72,
                  cursor: "pointer",
                  bgcolor: `${LIFECYCLE_COLORS[phase]}18`,
                  border: `1px solid ${LIFECYCLE_COLORS[phase]}55`,
                  "&:hover": { bgcolor: `${LIFECYCLE_COLORS[phase]}30` },
                }}
                onClick={() => {
                  const params = new URLSearchParams();
                  if (config.type) params.set("type", config.type);
                  navigate(`/inventory?${params}`);
                }}
              >
                <Typography
                  variant="h6"
                  fontWeight={700}
                  sx={{ color: LIFECYCLE_COLORS[phase] }}
                >
                  {phaseCounts[phase]}
                </Typography>
                <Typography variant="caption" color="text.secondary" textAlign="center">
                  {phaseLabel(phase)}
                </Typography>
              </Box>
            ))}
        </Box>
      )}
    </WidgetShell>
  );
}

function GroupCountChartWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["admin", "common"]);
  const { types } = useMetamodel();
  const typeLabel = useTypeLabel();
  const config = widget.config as GroupCountChartConfig;
  const bandsJson = JSON.stringify(config.bands ?? DEFAULT_BANDS);

  const [chartData, setChartData] = useState<GCBucketData[] | null>(null);
  const [stats, setStats] = useState<{
    total: number;
    withinCount: number;
    withinDays: number | null;
    asOf: string;
  } | null>(null);

  useEffect(() => {
    const activeBands: GroupCountBand[] = JSON.parse(bandsJson);
    if (!config.type || !config.fieldKey) {
      setChartData([]);
      setStats(null);
      return;
    }

    const ts = (config.timescale ?? "months") as Timescale;
    const sortedBands = [...activeBands].sort((a, b) => {
      if (a.maxDays === -1) return 1;
      if (b.maxDays === -1) return -1;
      return a.maxDays - b.maxDays;
    });

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const buckets = generateTimescaleBuckets(today, ts);
    const lastBucketEnd = buckets[buckets.length - 1]?.end ?? todayStr;

    api
      .get<{
        items: {
          status: string;
          lifecycle?: Record<string, string | null> | null;
          attributes?: Record<string, unknown> | null;
        }[];
      }>(`/cards?type=${encodeURIComponent(config.type)}&page_size=1000`)
      .then((d) => {
        const bucketCounts: Record<string, Record<string, number>> = {};
        for (const { key } of buckets) {
          bucketCounts[key] = {};
          for (const b of sortedBands) bucketCounts[key][b.label] = 0;
        }

        const maxDefinedDays = sortedBands.find((b) => b.maxDays !== -1)
          ? Math.max(...sortedBands.filter((b) => b.maxDays !== -1).map((b) => b.maxDays))
          : null;

        let total = 0;
        let withinCount = 0;

        for (const card of d.items ?? []) {
          if (card.status === "ARCHIVED") continue;
          const dateStr = getCardDateValue(card, config.fieldKey!);
          if (!dateStr || dateStr <= todayStr || dateStr > lastBucketEnd) continue;

          const bucket = buckets.find((b) => dateStr >= b.start && dateStr <= b.end);
          if (!bucket) continue;

          const daysUntil = Math.ceil(
            (new Date(`${dateStr}T00:00:00`).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );
          const band = assignBand(daysUntil, sortedBands);
          bucketCounts[bucket.key][band.label]++;
          total++;
          if (maxDefinedDays !== null && daysUntil <= maxDefinedDays) withinCount++;
        }

        const data: GCBucketData[] = buckets.map(({ key, label }) => {
          const counts = bucketCounts[key];
          const bucketTotal = Object.values(counts).reduce((s, n) => s + n, 0);
          return { bucket: label, _topMarker: 0, total: bucketTotal, ...counts };
        });

        setChartData(data);
        setStats({
          total,
          withinCount,
          withinDays: maxDefinedDays,
          asOf: today.toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        });
      })
      .catch(() => {
        setChartData([]);
        setStats(null);
      });
  }, [config.type, config.fieldKey, config.timescale, bandsJson]);

  const sortedBands: GroupCountBand[] = [...(config.bands ?? DEFAULT_BANDS)].sort((a, b) => {
    if (a.maxDays === -1) return 1;
    if (b.maxDays === -1) return -1;
    return a.maxDays - b.maxDays;
  });

  const cardType = types.find((ct) => ct.key === config.type);
  const typeName = cardType ? typeLabel(cardType).toLowerCase() : t("admin:dashboards.groupCountChart.items");
  const timescale = (config.timescale ?? "months") as Timescale;
  const periodLabel = (
    {
      weeks: `13 ${t("admin:dashboards.groupCountChart.timescaleWeeks").toLowerCase()}`,
      months: `12 ${t("admin:dashboards.groupCountChart.timescaleMonths").toLowerCase()}`,
      quarters: `8 ${t("admin:dashboards.groupCountChart.timescaleQuarters").toLowerCase()}`,
      years: `5 ${t("admin:dashboards.groupCountChart.timescaleYears").toLowerCase()}`,
    } as Record<string, string>
  )[timescale] ?? "12 months";

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ dataKey: string; value: number; fill: string }>;
    label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    const visible = payload.filter((p) => p.dataKey !== "_topMarker" && p.value > 0);
    if (!visible.length) return null;
    return (
      <Box
        sx={{
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          p: 1,
          minWidth: 80,
          boxShadow: 1,
        }}
      >
        <Typography variant="caption" fontWeight={700} display="block" mb={0.5}>
          {label}
        </Typography>
        {visible.map((p) => (
          <Box key={p.dataKey} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={{ width: 8, height: 8, bgcolor: p.fill, borderRadius: "50%", flexShrink: 0 }}
            />
            <Typography variant="caption">
              {p.dataKey}: {p.value}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  return (
    <WidgetShell title={widget.title || t("admin:dashboards.widgets.groupCountChart")}>
      {chartData === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : !config.type || !config.fieldKey ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("admin:dashboards.groupCountChart.notConfigured")}
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          {/* Legend */}
          <Box
            sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, mb: 0.5, flexWrap: "wrap" }}
          >
            {sortedBands.map((band) => (
              <Box key={band.label} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Box
                  sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: band.color, flexShrink: 0 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {band.label}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Chart */}
          <Box sx={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={32}
                />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                {sortedBands.map((band) => (
                  <Bar
                    key={band.label}
                    dataKey={band.label}
                    stackId="a"
                    fill={band.color}
                    isAnimationActive={false}
                    maxBarSize={40}
                  />
                ))}
                <Bar
                  dataKey="_topMarker"
                  stackId="a"
                  fill="transparent"
                  isAnimationActive={false}
                  legendType="none"
                >
                  <LabelList
                    dataKey="total"
                    position="top"
                    style={{ fontSize: 10, fill: "#777" }}
                    formatter={(v: unknown) => (Number(v) > 0 ? String(v) : "")}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>

          {/* Footer */}
          {stats && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mt: 1,
                pt: 1,
                borderTop: "1px solid",
                borderColor: "divider",
                flexWrap: "wrap",
                gap: 0.5,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {stats.total} {typeName} in {periodLabel}
              </Typography>
              {stats.withinDays !== null && (
                <Typography variant="caption" color="text.secondary">
                  {stats.withinCount} within {stats.withinDays}d · as of {stats.asOf}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      )}
    </WidgetShell>
  );
}

function BarChartWidget({ widget }: { widget: DashboardWidget }) {
  const { t } = useTranslation(["common", "admin"]);
  const { types } = useMetamodel();
  const config = widget.config as BarChartWidgetConfig;
  const [chartData, setChartData] = useState<{ label: string; value: number }[] | null>(null);

  useEffect(() => {
    if (!config.cardType || !config.xField) {
      setChartData([]);
      return;
    }
    const params = new URLSearchParams({ type: config.cardType, page_size: "1000" });
    if (config.subtype) params.set("subtype", config.subtype);
    type RawCard = { status?: string; approval_status?: string; subtype?: string; attributes?: Record<string, unknown> | null };

    const xField = config.xField!;
    const yField = config.yField;
    const ct = types.find((ct_) => ct_.key === config.cardType);
    const allFields = (ct?.fields_schema ?? []).flatMap((s) => s.fields);

    const resolveXLabel = (rawVal: string): string => {
      if (xField === "status" || xField === "approval_status") {
        return t(`common:status.${rawVal.toLowerCase()}`, { defaultValue: rawVal });
      }
      if (xField === "subtype") {
        return ct?.subtypes?.find((s) => s.key === rawVal)?.label ?? rawVal;
      }
      const field = allFields.find((f) => f.key === xField);
      return field?.options?.find((o) => o.key === rawVal)?.label ?? rawVal;
    };

    api
      .get<{ items: RawCard[] }>(`/cards?${params}`)
      .then((d) => {
        const cards = (d.items ?? []).filter((c) => c.status !== "ARCHIVED");
        const noneLabel = t("common:labels.none");
        // Use raw key for grouping, display label for rendering
        const groups = new Map<string, { label: string; value: number }>();
        cards.forEach((c) => {
          let xRaw: unknown;
          if (xField === "status") xRaw = c.status;
          else if (xField === "approval_status") xRaw = c.approval_status;
          else if (xField === "subtype") xRaw = c.subtype;
          else xRaw = c.attributes?.[xField];
          const rawKey = (xRaw != null && String(xRaw).trim() !== "") ? String(xRaw) : "";
          const displayLabel = rawKey ? resolveXLabel(rawKey) : noneLabel;
          const yNum = (!yField || yField === "count") ? 1 : Number(c.attributes?.[yField] ?? 0);
          const existing = groups.get(rawKey);
          if (existing) {
            existing.value += yNum;
          } else {
            groups.set(rawKey, { label: displayLabel, value: yNum });
          }
        });
        setChartData(
          Array.from(groups.values()).sort((a, b) => b.value - a.value),
        );
      })
      .catch(() => setChartData([]));
  }, [config.cardType, config.subtype, config.xField, config.yField, t, types]);

  const isHorizontal = config.orientation === "horizontal";
  const selectedType = types.find((ct) => ct.key === config.cardType);
  const yLabel =
    !config.yField || config.yField === "count"
      ? t("admin:dashboards.barChart.yFieldCount")
      : (selectedType?.fields_schema ?? []).flatMap((s) => s.fields).find((f) => f.key === config.yField)?.label ?? config.yField;

  return (
    <WidgetShell title={widget.title || t("admin:dashboards.widgets.barChart")}>
      {chartData === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : !config.cardType || !config.xField ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("admin:dashboards.barChart.notConfigured")}
        </Typography>
      ) : chartData.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
          {t("common:labels.noResults")}
        </Typography>
      ) : isHorizontal ? (
        <Box sx={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={chartData} margin={{ top: 4, right: 36, left: 0, bottom: 4 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                label={{ value: yLabel, position: "insideBottomRight", offset: 0, fontSize: 10, fill: "#999" }}
              />
              <YAxis
                type="category"
                dataKey="label"
                tick={{ fontSize: 10, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                width={100}
              />
              <RechartsTooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Bar dataKey="value" fill="#1976d2" isAnimationActive={false} maxBarSize={22}>
                <LabelList dataKey="value" position="right" style={{ fontSize: 10, fill: "#777" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      ) : (
        <Box sx={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 16, right: 4, left: -24, bottom: 40 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 10, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={32}
                label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 16, fontSize: 10, fill: "#999" }}
              />
              <RechartsTooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
              <Bar dataKey="value" fill="#1976d2" isAnimationActive={false} maxBarSize={40}>
                <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: "#777" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}
    </WidgetShell>
  );
}

function WidgetRenderer({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case "kpi_summary":
      return <KpiSummaryWidget widget={widget} />;
    case "card_list":
      return <CardListWidget widget={widget} />;
    case "saved_report":
      return <SavedReportWidget widget={widget} />;
    case "activity_feed":
      return <ActivityFeedWidget widget={widget} />;
    case "lifecycle_chart":
      return <LifecycleChartWidget widget={widget} />;
    case "group_count_chart":
      return <GroupCountChartWidget widget={widget} />;
    case "ai_quick_create":
      return <AiQuickCreateWidget widget={widget} />;
    case "bar_chart":
      return <BarChartWidget widget={widget} />;
    default:
      return (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              {widget.title || widget.type}
            </Typography>
          </CardContent>
        </Card>
      );
  }
}

export default function CustomDashboardTab({ dashboard }: { dashboard: CustomDashboard }) {
  if (dashboard.layout.length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="body1" color="text.secondary">
          This dashboard has no widgets yet.
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 2,
        alignItems: "start",
      }}
    >
      {dashboard.layout.map((widget) => (
        <Box key={widget.id} sx={{ gridColumn: `span ${widget.w}` }}>
          <WidgetRenderer widget={widget} />
        </Box>
      ))}
    </Box>
  );
}
