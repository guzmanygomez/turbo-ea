import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import { api } from "@/api/client";
import type { UserGroup } from "@/types";
import MaterialSymbol from "@/components/MaterialSymbol";

interface GroupFormState {
  key: string;
  name: string;
  description: string;
  color: string;
  group_type: "domain" | "functional" | "other";
  sort_order: number;
}

const EMPTY_FORM: GroupFormState = {
  key: "",
  name: "",
  description: "",
  color: "#757575",
  group_type: "other",
  sort_order: 0,
};

const GROUP_COLORS = [
  "#757575",
  "#2889ff",
  "#c7527d",
  "#028f00",
  "#d29270",
  "#774fcc",
  "#0f7eb5",
  "#a6566d",
  "#003399",
  "#ffa31f",
];

export default function UserGroupsTab() {
  const { t } = useTranslation(["admin", "common"]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<GroupFormState>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [editGroup, setEditGroup] = useState<UserGroup | null>(null);
  const [editForm, setEditForm] = useState<GroupFormState>(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [deleteGroup, setDeleteGroup] = useState<UserGroup | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<UserGroup[]>("/user-groups");
      setGroups(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.key.trim()) {
      setCreateError(t("groups.create.requiredFields"));
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const g = await api.post<UserGroup>("/user-groups", {
        ...createForm,
        sort_order: Number(createForm.sort_order) || 0,
      });
      setGroups((prev) => [...prev, g].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)));
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      setSuccess(t("groups.create.success"));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openEdit = (g: UserGroup) => {
    setEditGroup(g);
    setEditForm({
      key: g.key,
      name: g.name,
      description: g.description || "",
      color: g.color,
      group_type: g.group_type,
      sort_order: g.sort_order,
    });
    setEditError(null);
  };

  const handleEdit = async () => {
    if (!editGroup || !editForm.name.trim()) {
      setEditError(t("groups.edit.requiredFields"));
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const updated = await api.patch<UserGroup>(`/user-groups/${editGroup.id}`, {
        name: editForm.name,
        description: editForm.description || null,
        color: editForm.color,
        group_type: editForm.group_type,
        sort_order: Number(editForm.sort_order) || 0,
      });
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? { ...updated, member_count: g.member_count } : g)));
      setEditGroup(null);
      setSuccess(t("groups.edit.success"));
    } catch (err) {
      setEditError(err instanceof Error ? err.message : t("common:errors.generic"));
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteGroup) return;
    setDeleteSubmitting(true);
    try {
      await api.delete(`/user-groups/${deleteGroup.id}`);
      setGroups((prev) => prev.filter((g) => g.id !== deleteGroup.id));
      setDeleteGroup(null);
      setSuccess(t("groups.delete.success"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common:errors.generic"));
      setDeleteGroup(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const groupTypeLabel = (type: string) => {
    if (type === "domain") return t("groups.types.domain");
    if (type === "functional") return t("groups.types.functional");
    return t("groups.types.other");
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h6">{t("groups.title")}</Typography>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" />}
          onClick={() => {
            setCreateForm(EMPTY_FORM);
            setCreateError(null);
            setCreateOpen(true);
          }}
        >
          {t("groups.createGroup")}
        </Button>
      </Box>

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Typography color="text.secondary">{t("groups.loading")}</Typography>
      ) : groups.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">{t("groups.empty")}</Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {groups.map((g) => (
            <Paper key={g.id} variant="outlined" sx={{ px: 2.5, py: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    bgcolor: g.color,
                    flexShrink: 0,
                  }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Typography variant="body1" fontWeight={600}>
                      {g.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={groupTypeLabel(g.group_type)}
                      sx={{ bgcolor: g.color + "22", color: g.color, fontWeight: 600, border: `1px solid ${g.color}44` }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {t("groups.memberCount", { count: g.member_count ?? 0 })}
                    </Typography>
                  </Box>
                  {g.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                      {g.description}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {t("groups.keyLabel")}: {g.key}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  <Tooltip title={t("groups.editTooltip")}>
                    <IconButton size="small" onClick={() => openEdit(g)}>
                      <MaterialSymbol icon="edit" size={18} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("groups.deleteTooltip")}>
                    <IconButton size="small" color="error" onClick={() => setDeleteGroup(g)}>
                      <MaterialSymbol icon="delete" size={18} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("groups.create.title")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label={t("groups.fields.key")}
              value={createForm.key}
              onChange={(e) => setCreateForm((p) => ({ ...p, key: e.target.value }))}
              fullWidth
              required
              size="small"
              helperText={t("groups.fields.keyHelp")}
              autoFocus
            />
            <TextField
              label={t("groups.fields.name")}
              value={createForm.name}
              onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
              fullWidth
              required
              size="small"
            />
            <TextField
              label={t("groups.fields.description")}
              value={createForm.description}
              onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
              size="small"
            />
            <FormControl fullWidth size="small">
              <InputLabel>{t("groups.fields.type")}</InputLabel>
              <Select
                label={t("groups.fields.type")}
                value={createForm.group_type}
                onChange={(e) => setCreateForm((p) => ({ ...p, group_type: e.target.value as GroupFormState["group_type"] }))}
              >
                <MenuItem value="domain">{t("groups.types.domain")}</MenuItem>
                <MenuItem value="functional">{t("groups.types.functional")}</MenuItem>
                <MenuItem value="other">{t("groups.types.other")}</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                {t("groups.fields.color")}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {GROUP_COLORS.map((c) => (
                  <Box
                    key={c}
                    onClick={() => setCreateForm((p) => ({ ...p, color: c }))}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      bgcolor: c,
                      cursor: "pointer",
                      border: createForm.color === c ? "3px solid" : "2px solid transparent",
                      borderColor: createForm.color === c ? "primary.main" : "transparent",
                      outline: createForm.color === c ? "2px solid" : "none",
                      outlineColor: c,
                      transition: "transform 0.1s",
                      "&:hover": { transform: "scale(1.15)" },
                    }}
                  />
                ))}
              </Box>
            </Box>
            {createError && <Alert severity="error">{createError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={createSubmitting}>
            {createSubmitting ? t("groups.create.creating") : t("groups.createGroup")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={!!editGroup} onClose={() => setEditGroup(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("groups.edit.title")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label={t("groups.fields.name")}
              value={editForm.name}
              onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
              fullWidth
              required
              size="small"
              autoFocus
            />
            <TextField
              label={t("groups.fields.description")}
              value={editForm.description}
              onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
              size="small"
            />
            <FormControl fullWidth size="small">
              <InputLabel>{t("groups.fields.type")}</InputLabel>
              <Select
                label={t("groups.fields.type")}
                value={editForm.group_type}
                onChange={(e) => setEditForm((p) => ({ ...p, group_type: e.target.value as GroupFormState["group_type"] }))}
              >
                <MenuItem value="domain">{t("groups.types.domain")}</MenuItem>
                <MenuItem value="functional">{t("groups.types.functional")}</MenuItem>
                <MenuItem value="other">{t("groups.types.other")}</MenuItem>
              </Select>
            </FormControl>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                {t("groups.fields.color")}
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {GROUP_COLORS.map((c) => (
                  <Box
                    key={c}
                    onClick={() => setEditForm((p) => ({ ...p, color: c }))}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      bgcolor: c,
                      cursor: "pointer",
                      border: editForm.color === c ? "3px solid" : "2px solid transparent",
                      borderColor: editForm.color === c ? "primary.main" : "transparent",
                      outline: editForm.color === c ? "2px solid" : "none",
                      outlineColor: c,
                      transition: "transform 0.1s",
                      "&:hover": { transform: "scale(1.15)" },
                    }}
                  />
                ))}
              </Box>
            </Box>
            {editError && <Alert severity="error">{editError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditGroup(null)} disabled={editSubmitting}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={handleEdit} disabled={editSubmitting}>
            {editSubmitting ? t("groups.edit.saving") : t("groups.edit.saveChanges")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteGroup} onClose={() => setDeleteGroup(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("groups.delete.title")}</DialogTitle>
        <DialogContent>
          <Typography>
            {t("groups.delete.confirm", { name: deleteGroup?.name ?? "" })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteGroup(null)} disabled={deleteSubmitting}>
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleteSubmitting}>
            {deleteSubmitting ? t("common:actions.deleting") : t("common:actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
