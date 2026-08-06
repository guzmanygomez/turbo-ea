import { useRef, useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import VendorField from "@/components/VendorField";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import {
  useTypeLabel,
  useSubtypeLabel,
  useFieldLabel,
  useOptionLabel,
} from "@/hooks/useResolveLabel";
import type { DashboardWidget, FieldDef } from "@/types";

interface AiQuickCreateConfig {
  cardType?: string;
  aiEnabled?: boolean;
  attachFile?: boolean;
}

export default function AiQuickCreateWidget({ widget }: { widget: DashboardWidget }) {
  const config = widget.config as AiQuickCreateConfig;
  const { t } = useTranslation(["admin", "common", "inventory", "cards"]);
  const navigate = useNavigate();
  const typeLabel = useTypeLabel();
  const subtypeLabel = useSubtypeLabel();
  const fieldLabel = useFieldLabel();
  const optionLabel = useOptionLabel();
  const { types, relationTypes } = useMetamodel();

  const cardType = types.find((ct) => ct.key === config.cardType);

  // Required fields only — mirrors what CreateCardDialog shows from the schema
  const requiredFields = useMemo<FieldDef[]>(() => {
    if (!cardType) return [];
    return (cardType.fields_schema ?? []).flatMap((s) =>
      (s.fields ?? []).filter((f) => f.required),
    );
  }, [cardType]);

  // Gate provider field on whether the card type has a metamodel relation to Provider
  const hasProviderRelation = useMemo(() => {
    if (!config.cardType) return false;
    return relationTypes.some(
      (r) =>
        (r.source_type_key === "Provider" && r.target_type_key === config.cardType) ||
        (r.target_type_key === "Provider" && r.source_type_key === config.cardType),
    );
  }, [config.cardType, relationTypes]);

  // Gate org auto-link on whether the card type has a metamodel relation to Organization
  const hasOrgRelation = useMemo(() => {
    if (!config.cardType) return false;
    return relationTypes.some(
      (r) =>
        (r.source_type_key === "Organization" && r.target_type_key === config.cardType) ||
        (r.target_type_key === "Organization" && r.source_type_key === config.cardType),
    );
  }, [config.cardType, relationTypes]);

  // Resolve the Guzman y Gomez Franchising Pty Ltd org card once on mount
  const [gygOrgId, setGygOrgId] = useState<string | null>(null);
  useEffect(() => {
    if (!hasOrgRelation) return;
    api
      .get<{ items: { id: string; name: string }[] }>(
        "/cards?type=Organization&search=Guzman+y+Gomez+Franchising+Pty+Ltd&page_size=5",
      )
      .then((d) => {
        const match = d.items?.find((c) => c.name === "Guzman y Gomez Franchising Pty Ltd");
        if (match) setGygOrgId(match.id);
      })
      .catch(() => {});
  }, [hasOrgRelation]);

  // Form state
  const [subtype, setSubtype] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attributes, setAttributes] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  // AI extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [descriptionExtracted, setDescriptionExtracted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setAttr = (key: string, value: unknown) =>
    setAttributes((prev) => ({ ...prev, [key]: value }));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !config.cardType) return;

    setExtractError("");
    setExtracting(true);
    setDescriptionExtracted(false);

    try {
      const fieldKeys = ["description", ...requiredFields.map((f) => f.key)].join(",");
      const resp = await api.upload<{ fields: Record<string, { value: unknown }> }>(
        "/ai/quick-extract",
        file,
        "file",
        { type_key: config.cardType, field_keys: fieldKeys },
      );
      const fields = resp.fields ?? {};

      // Pre-fill description
      const descResult = fields.description;
      if (descResult?.value && typeof descResult.value === "string" && descResult.value.trim()) {
        setDescription(descResult.value.trim());
        setDescriptionExtracted(true);
      }

      // Pre-fill required schema fields
      const attrUpdates: Record<string, unknown> = {};
      for (const [key, res] of Object.entries(fields)) {
        if (key !== "description" && res.value !== null && res.value !== undefined) {
          attrUpdates[key] = res.value;
        }
      }
      if (Object.keys(attrUpdates).length > 0) {
        setAttributes((prev) => ({ ...prev, ...attrUpdates }));
      }

      setUploadedFile(file);
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : t("dashboards.aiQuickCreate.extractFailed"),
      );
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    if (!name.trim() || !config.cardType) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      const card = await api.post<{ id: string; name: string }>("/cards", {
        type: config.cardType,
        subtype: subtype || undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      });

      // Link provider relation if a provider was selected or created
      if (selectedProvider) {
        const relType = relationTypes.find(
          (r) =>
            (r.source_type_key === "Provider" && r.target_type_key === config.cardType) ||
            (r.target_type_key === "Provider" && r.source_type_key === config.cardType),
        );
        if (relType) {
          const providerIsSource = relType.source_type_key === "Provider";
          await api.post("/relations", {
            type: relType.key,
            source_id: providerIsSource ? selectedProvider.id : card.id,
            target_id: providerIsSource ? card.id : selectedProvider.id,
          });
        }
      }

      // Auto-link Guzman y Gomez Franchising Pty Ltd org if applicable
      if (gygOrgId && hasOrgRelation) {
        const orgRelType = relationTypes.find(
          (r) =>
            (r.source_type_key === "Organization" && r.target_type_key === config.cardType) ||
            (r.target_type_key === "Organization" && r.source_type_key === config.cardType),
        );
        if (orgRelType) {
          const orgIsSource = orgRelType.source_type_key === "Organization";
          await api.post("/relations", {
            type: orgRelType.key,
            source_id: orgIsSource ? gygOrgId : card.id,
            target_id: orgIsSource ? card.id : gygOrgId,
          });
        }
      }

      if (config.attachFile !== false && uploadedFile) {
        await api.upload(`/cards/${card.id}/file-attachments`, uploadedFile, "file");
      }

      setCreated({ id: card.id, name: card.name });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : t("dashboards.aiQuickCreate.createFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSubtype("");
    setVendorName("");
    setSelectedProvider(null);
    setName("");
    setDescription("");
    setAttributes({});
    setDescriptionExtracted(false);
    setUploadedFile(null);
    setExtractError("");
    setSubmitError("");
    setCreated(null);
  };

  const renderField = (field: FieldDef) => {
    const label = fieldLabel(field);
    switch (field.type) {
      case "single_select":
        return (
          <FormControl size="small" fullWidth key={field.key}>
            <InputLabel>{label}</InputLabel>
            <Select
              label={label}
              value={typeof attributes[field.key] === "string" ? (attributes[field.key] as string) : ""}
              onChange={(e) => setAttr(field.key, e.target.value || undefined)}
            >
              <MenuItem value="">
                <em>{t("common:none")}</em>
              </MenuItem>
              {field.options?.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  {optionLabel(o)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );
      case "boolean":
        return (
          <FormControlLabel
            key={field.key}
            control={
              <Switch
                size="small"
                checked={Boolean(attributes[field.key])}
                onChange={(e) => setAttr(field.key, e.target.checked)}
              />
            }
            label={label}
          />
        );
      case "number":
      case "cost":
        return (
          <TextField
            key={field.key}
            label={label}
            size="small"
            fullWidth
            type="number"
            value={attributes[field.key] ?? ""}
            onChange={(e) =>
              setAttr(field.key, e.target.value ? Number(e.target.value) : undefined)
            }
          />
        );
      case "date":
        return (
          <TextField
            key={field.key}
            label={label}
            size="small"
            fullWidth
            type="date"
            value={(attributes[field.key] as string) ?? ""}
            onChange={(e) => setAttr(field.key, e.target.value || undefined)}
            InputLabelProps={{ shrink: true }}
          />
        );
      default:
        return (
          <TextField
            key={field.key}
            label={label}
            size="small"
            fullWidth
            value={(attributes[field.key] as string) ?? ""}
            onChange={(e) => setAttr(field.key, e.target.value || undefined)}
          />
        );
    }
  };

  const title = widget.title || t("dashboards.widgets.aiQuickCreate");

  const shell = (content: React.ReactNode) => (
    <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <CardHeader
        title={title}
        titleTypographyProps={{ variant: "subtitle1", fontWeight: 600 }}
        sx={{ pb: 0 }}
      />
      <Divider />
      <CardContent sx={{ flex: 1, overflow: "auto" }}>{content}</CardContent>
    </Card>
  );

  if (!config.cardType || !cardType) {
    return shell(
      <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
        {t("dashboards.aiQuickCreate.notConfigured")}
      </Typography>,
    );
  }

  if (created) {
    return shell(
      <Stack spacing={1.5} alignItems="center" sx={{ pt: 2 }}>
        <MaterialSymbol
          icon="check_circle"
          size={40}
          style={{ color: "var(--mui-palette-success-main, #2e7d32)" }}
        />
        <Typography variant="body2" fontWeight={600}>
          {t("dashboards.aiQuickCreate.created", { name: created.name })}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate(`/cards/${created.id}`)}
          >
            {t("dashboards.aiQuickCreate.viewCard")}
          </Button>
          <Button size="small" onClick={handleReset}>
            {t("dashboards.aiQuickCreate.createAnother")}
          </Button>
        </Box>
      </Stack>,
    );
  }

  return shell(
    <Stack spacing={1.5}>
      {/* Subtype */}
      {cardType.subtypes && cardType.subtypes.length > 0 && (
        <FormControl size="small" fullWidth>
          <InputLabel>{t("common:labels.subtype")}</InputLabel>
          <Select
            label={t("common:labels.subtype")}
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
          >
            <MenuItem value="">
              <em>{t("common:none")}</em>
            </MenuItem>
            {cardType.subtypes.map((st) => (
              <MenuItem key={st.key} value={st.key}>
                {subtypeLabel(st)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {/* Provider — only shown when a metamodel relation to Provider exists */}
      {hasProviderRelation && (
        <VendorField
          value={vendorName}
          onChange={(v) => setVendorName(v ?? "")}
          cardTypeKey={config.cardType}
          onProviderSelected={setSelectedProvider}
          size="small"
        />
      )}

      {/* Name */}
      <TextField
        label={t("common:labels.name")}
        size="small"
        fullWidth
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {/* Description with AI-extracted badge */}
      <Box>
        {descriptionExtracted && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
            <Tooltip title={t("dashboards.aiQuickCreate.aiExtracted")} arrow>
              <Chip
                label={t("dashboards.aiQuickCreate.aiExtracted")}
                size="small"
                color="success"
                variant="outlined"
                icon={<MaterialSymbol icon="auto_awesome" size={12} />}
                sx={{ height: 18, fontSize: "0.65rem", cursor: "help" }}
              />
            </Tooltip>
          </Box>
        )}
        <TextField
          label={t("common:labels.description")}
          size="small"
          fullWidth
          multiline
          rows={3}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (descriptionExtracted) setDescriptionExtracted(false);
          }}
        />
      </Box>

      {/* Required fields from schema */}
      {requiredFields.map((f) => renderField(f))}

      {/* File upload for AI description extraction */}
      {config.aiEnabled && (
        <>
          <Divider />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.txt,.csv"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={
                extracting ? (
                  <CircularProgress size={14} />
                ) : (
                  <MaterialSymbol icon="upload_file" size={16} />
                )
              }
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
            >
              {extracting
                ? t("dashboards.aiQuickCreate.extracting")
                : t("dashboards.aiQuickCreate.uploadToExtract")}
            </Button>
            {uploadedFile && !extracting && (
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }} noWrap>
                {uploadedFile.name}
              </Typography>
            )}
          </Box>
          {extractError && (
            <Alert severity="warning" sx={{ py: 0 }}>
              {extractError}
            </Alert>
          )}
        </>
      )}

      {/* Submit error */}
      {submitError && (
        <Alert severity="error" sx={{ py: 0 }}>
          {submitError}
        </Alert>
      )}

      {/* Create button */}
      <Button
        variant="contained"
        size="small"
        disabled={!name.trim() || submitting}
        onClick={handleSubmit}
        startIcon={submitting ? <CircularProgress size={14} /> : undefined}
      >
        {submitting
          ? t("common:saving")
          : t("dashboards.aiQuickCreate.createCard", { type: typeLabel(cardType) })}
      </Button>
    </Stack>,
  );
}
