import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type { CustomDashboard } from "@/types";

const STATUS_COLOR: Record<string, "default" | "success"> = {
  draft: "default",
  published: "success",
};

export default function DashboardsAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<CustomDashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get<CustomDashboard[]>("/custom-dashboards")
      .then(setDashboards)
      .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handlePublishToggle = async (d: CustomDashboard) => {
    setActionBusy(true);
    try {
      await api.post(
        d.status === "published"
          ? `/custom-dashboards/${d.id}/unpublish`
          : `/custom-dashboards/${d.id}/publish`,
        {},
      );
      load();
    } finally {
      setActionBusy(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    setActionBusy(true);
    try {
      const copy = await api.post<CustomDashboard>(`/custom-dashboards/${id}/duplicate`, {});
      navigate(`/admin/dashboards/${copy.id}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setActionBusy(true);
    try {
      await api.delete(`/custom-dashboards/${deleteId}`);
      setDeleteId(null);
      load();
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 3 }}>
        <MaterialSymbol icon="space_dashboard" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ ml: 1, fontWeight: 700, flex: 1 }}>
          {t("dashboards.title")}
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          sx={{ textTransform: "none" }}
          onClick={() => navigate("/admin/dashboards/new")}
        >
          {t("dashboards.newDashboard")}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {dashboards.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 8 }}>
          <MaterialSymbol icon="space_dashboard" size={48} color="#bdbdbd" />
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            {t("dashboards.empty")}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 2, textTransform: "none" }}
            onClick={() => navigate("/admin/dashboards/new")}
          >
            {t("dashboards.newDashboard")}
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2 }}>
          {dashboards.map((d) => (
            <Card key={d.id} variant="outlined">
              <CardActionArea onClick={() => navigate(`/admin/dashboards/${d.id}`)}>
                <CardContent>
                  <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 1 }}>
                    <Typography variant="subtitle1" fontWeight={600} sx={{ flex: 1 }}>
                      {d.name}
                    </Typography>
                    <Chip
                      label={t(`dashboards.status.${d.status}`)}
                      size="small"
                      color={STATUS_COLOR[d.status] ?? "default"}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t("dashboards.widgets.count", { count: d.layout.length })}
                    {" · "}
                    {t("dashboards.audience", { count: d.audienceGroups.length })}
                  </Typography>
                  {d.priority > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t("dashboards.priority")}: {d.priority}
                    </Typography>
                  )}
                </CardContent>
              </CardActionArea>

              <Box
                sx={{ display: "flex", alignItems: "center", px: 1, pb: 1, gap: 0.5 }}
                onClick={(e) => e.stopPropagation()}
              >
                <Tooltip
                  title={
                    d.status === "published" ? t("dashboards.unpublish") : t("dashboards.publish")
                  }
                >
                  <IconButton
                    size="small"
                    disabled={actionBusy}
                    onClick={() => handlePublishToggle(d)}
                  >
                    <MaterialSymbol
                      icon={d.status === "published" ? "unpublished" : "publish"}
                      size={18}
                    />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("dashboards.duplicate")}>
                  <IconButton size="small" disabled={actionBusy} onClick={() => handleDuplicate(d.id)}>
                    <MaterialSymbol icon="content_copy" size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("common:delete")}>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={actionBusy}
                    onClick={() => setDeleteId(d.id)}
                  >
                    <MaterialSymbol icon="delete" size={18} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Card>
          ))}
        </Box>
      )}

      <Dialog open={deleteId !== null} onClose={() => setDeleteId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("dashboards.deleteTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("dashboards.deleteConfirm")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>{t("common:cancel")}</Button>
          <Button color="error" onClick={handleDelete} disabled={actionBusy}>
            {t("common:delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
