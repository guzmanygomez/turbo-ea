import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useAuthContext } from "@/hooks/AuthContext";
import { api } from "@/api/client";
import type { CustomDashboard, DashboardTabKey } from "@/types";
import AdminTab from "./admin/AdminTab";
import OverviewTab from "./OverviewTab";
import WorkspaceTab from "./workspace/WorkspaceTab";
import CustomDashboardTab from "./CustomDashboardTab";

const ADMIN_TAB_PERMISSION = "admin.users";
const BUILT_IN_TABS: DashboardTabKey[] = ["overview", "workspace"];

function isValidTab(value: string | null): value is DashboardTabKey {
  return (
    value === "overview" ||
    value === "workspace" ||
    value === "admin" ||
    (typeof value === "string" && value.startsWith("custom-"))
  );
}

interface PinTabLabelProps {
  label: string;
  isDefault: boolean;
  onTogglePin: () => void;
  setAsDefaultTooltip: string;
  unsetAsDefaultTooltip: string;
}

function PinTabLabel({
  label,
  isDefault,
  onTogglePin,
  setAsDefaultTooltip,
  unsetAsDefaultTooltip,
}: PinTabLabelProps) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <span>{label}</span>
      <Tooltip title={isDefault ? unsetAsDefaultTooltip : setAsDefaultTooltip}>
        <IconButton
          size="small"
          aria-label={isDefault ? unsetAsDefaultTooltip : setAsDefaultTooltip}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          sx={{ p: 0.25, ml: 0.25 }}
        >
          <MaterialSymbol
            icon="push_pin"
            size={16}
            color={isDefault ? "#1976d2" : "#9e9e9e"}
            style={isDefault ? { fontVariationSettings: "'FILL' 1" } : undefined}
          />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default function Dashboard() {
  const { t } = useTranslation("common");
  const { user, refreshUser } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [customDashboards, setCustomDashboards] = useState<CustomDashboard[]>([]);

  useEffect(() => {
    api
      .get<CustomDashboard[]>("/custom-dashboards/my")
      .then(setCustomDashboards)
      .catch(() => {
        /* non-fatal — user may not be in any groups */
      });
  }, []);

  const isAdmin =
    !!user?.permissions?.["*"] || !!user?.permissions?.[ADMIN_TAB_PERMISSION];

  const validTabs = useMemo<DashboardTabKey[]>(() => {
    const customTabs: DashboardTabKey[] = customDashboards.map(
      (d) => `custom-${d.id}` as DashboardTabKey,
    );
    const adminTabs: DashboardTabKey[] = isAdmin ? ["admin"] : [];
    return [...BUILT_IN_TABS, ...customTabs, ...adminTabs];
  }, [isAdmin, customDashboards]);

  // Compute the default tab: custom dashboard default takes priority over user preference
  const computedDefaultTab = useMemo<DashboardTabKey>(() => {
    const userGroupIds = new Set(user?.group_ids ?? []);
    if (userGroupIds.size > 0) {
      // Dashboards are already sorted by priority desc from the API
      const defaultDash = customDashboards.find((d) =>
        d.defaultForGroups.some((g) => userGroupIds.has(g)),
      );
      if (defaultDash) return `custom-${defaultDash.id}`;
    }
    const prefRaw: DashboardTabKey = user?.ui_preferences?.dashboard_default_tab ?? "overview";
    return validTabs.includes(prefRaw) ? prefRaw : "overview";
  }, [customDashboards, user, validTabs]);

  const rawTab = searchParams.get("tab");
  const requestedTab: DashboardTabKey = isValidTab(rawTab) ? rawTab : computedDefaultTab;
  const activeTab: DashboardTabKey = validTabs.includes(requestedTab)
    ? requestedTab
    : computedDefaultTab;

  useEffect(() => {
    if (rawTab === null) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", activeTab);
      setSearchParams(next, { replace: true });
    }
  }, [rawTab, activeTab, searchParams, setSearchParams]);

  const setActiveTab = useCallback(
    (tab: DashboardTabKey) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const togglePin = useCallback(
    async (tab: DashboardTabKey) => {
      const isAlreadyDefault = computedDefaultTab === tab;
      const nextValue: DashboardTabKey | null = isAlreadyDefault ? null : tab;
      try {
        await api.patch("/users/me/ui-preferences", {
          dashboard_default_tab: nextValue,
        });
        await refreshUser();
      } catch (err) {
        console.error("Failed to persist dashboard pin preference", err);
      }
    },
    [computedDefaultTab, refreshUser],
  );

  const tabConfigs = useMemo(() => {
    const builtIn = BUILT_IN_TABS.map((key) => ({
      key,
      label: t(`dashboard.tabs.${key}`),
      pinnable: true,
    }));
    const custom = customDashboards.map((d) => ({
      key: `custom-${d.id}` as DashboardTabKey,
      label: d.name,
      pinnable: false,
    }));
    const adminTab = isAdmin
      ? [{ key: "admin" as DashboardTabKey, label: t("dashboard.tabs.admin"), pinnable: true }]
      : [];
    return [...builtIn, ...custom, ...adminTab];
  }, [t, customDashboards, isAdmin]);

  const activeDashboard = useMemo(() => {
    if (!activeTab.startsWith("custom-")) return null;
    const id = activeTab.slice(7);
    return customDashboards.find((d) => d.id === id) ?? null;
  }, [activeTab, customDashboards]);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          {t("dashboard.title")}
        </Typography>
      </Box>

      <Tabs
        value={activeTab}
        onChange={(_, value) => setActiveTab(value as DashboardTabKey)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        {tabConfigs.map((tab) => (
          <Tab
            key={tab.key}
            value={tab.key}
            label={
              tab.pinnable ? (
                <PinTabLabel
                  label={tab.label}
                  isDefault={computedDefaultTab === tab.key}
                  onTogglePin={() => togglePin(tab.key)}
                  setAsDefaultTooltip={t("dashboard.pinAsDefault")}
                  unsetAsDefaultTooltip={t("dashboard.unpinDefault")}
                />
              ) : (
                tab.label
              )
            }
          />
        ))}
      </Tabs>

      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "workspace" && <WorkspaceTab />}
      {activeTab === "admin" && isAdmin && <AdminTab />}
      {activeDashboard && <CustomDashboardTab dashboard={activeDashboard} />}
    </Box>
  );
}
