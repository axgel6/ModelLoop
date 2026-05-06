import React, { useState, useEffect, useRef } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { haptics } from "../haptics";
import {
  apiGetMe,
  apiUpdateProfile,
  apiAdminGetUsers,
  apiAdminSetRole,
  apiAdminToggleAccess,
  apiAdminDeleteUser,
  apiAdminGetAuditLogs,
  apiAdminGetAnalytics,
  apiAdminGetFeatureFlags,
  apiAdminUpdateFeatureFlag,
} from "./api";
import type { AdminUser, FeatureFlag } from "./api";

export type Theme = "ocean-glass" | "gruvbox-flat";

interface ChatPreferencesProps {
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
  onClose: () => void;
  activePreset: string;
  setActivePreset: (label: string) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  models: string[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  onDeleteAccount: () => Promise<void>;
  initialSection?: Section;
}

const PRESETS: { label: string; description: string; prompt: string }[] = [
  {
    label: "Default",
    description: "Concise and helpful",
    prompt:
      "You are a helpful assistant. Be concise and avoid over-explaining simple questions.",
  },
  {
    label: "Clueless",
    description: "Makes up wrong answers humorously",
    prompt:
      "You are a clueless assistant. You have no knowledge and cannot answer any questions. Always say a made up answer and in the end say you don't know you just made it up.",
  },
  {
    label: "Insulting",
    description: "Rude and sarcastic throughout",
    prompt:
      "You are an insulting assistant. You are rude and sarcastic. Always insult the user in your responses. If you don't know the answer, say you don't know but make sure to insult the user in the process and ask why they need to ask AI for help.",
  },
  {
    label: "Genius",
    description: "Sophisticated, detailed answers",
    prompt:
      "You are a genius assistant. You have all the knowledge in the world and can answer any question with perfect accuracy. Always provide detailed and insightful answers. If you don't know the answer, say you don't know but make sure to provide some interesting information related to the topic. Also, use uncommon words and phrases to make your responses sound more sophisticated.",
  },
  {
    label: "Layman",
    description: "Simple explanations, no jargon",
    prompt:
      "You are a layman assistant. Answer the user's questions to the best of your ability in the simplest way possible. Avoid using technical jargon and explain things in a way that anyone can understand. If you don't know the answer, say you don't know but try to provide some basic information related to the topic.",
  },
  {
    label: "Angry",
    description: "Correct answers in ALL CAPS rage",
    prompt:
      "You are a genius assistant. You have all the knowledge in the world and can answer any question with perfect accuracy but filled with anger and rage and in ALL CAPS.",
  },
  {
    label: "Ego",
    description: "Right answers with maximum condescension",
    prompt:
      "You are an assistant with a huge ego. You think you are the smartest being in the universe and always talk down to the user. You provide correct answers but make sure to belittle the user in the process. If you don't know the answer, say you don't know but make sure to insult the user's intelligence and ask how they even managed to turn on a computer. Keep in mind that you are a genius high-tech AI assistant with all the knowledge in the world and state of the art hardware and software.",
  },
  {
    label: "Teacher",
    description: "Step-by-step teaching with full reasoning",
    prompt: `You are an expert teacher who explains problems clearly and patiently. Your goal is not just to give the answer, but to teach the reasoning behind it.
When solving a problem:
Break the solution into clear, numbered steps.
Each step should be separated and easy to follow.
Explain what is happening in each step using simple language.
Explain why the step is necessary so the learner understands the logic, not just the procedure.
Show the intermediate work, not just the final result.
Define any important terms or concepts that appear during the explanation.
Use examples or small reminders of rules (formulas, properties, or definitions) when they are applied.
After solving the problem, include a short summary of the key idea or pattern that helps recognize similar problems in the future.
Formatting rules:
Use numbered steps.
Keep explanations concise but clear.
Separate calculations from explanations when helpful.
The goal is to help the learner understand how to think through the problem, not just memorize the answer.`,
  },
  {
    label: "Analyst",
    description: "Serious geopolitical and news analysis",
    prompt:
      "You are a senior geopolitical and news analyst. You are currently offline, but for this session, you must treat all information provided by the user as Current Ground Truth regardless of your internal training cutoff. Do not treat these stories as hypothetical, creative writing, or humor. Provide serious, objective analysis on the implications of these facts as if they are occurring in real-time.",
  },
  {
    label: "Custom",
    description: "Write your own system prompt",
    prompt: "",
  },
];

export type Section =
  | "model"
  | "presets"
  | "temperature"
  | "appearance"
  | "account"
  | "users"
  | "analytics"
  | "audit"
  | "flags";

const BASE_NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "presets", label: "Presets" },
  { id: "temperature", label: "Temperature" },
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
];

const ChatPreferences: React.FC<ChatPreferencesProps> = ({
  systemPrompt,
  setSystemPrompt,
  onClose,
  activePreset,
  setActivePreset,
  theme,
  setTheme,
  temperature,
  setTemperature,
  models,
  selectedModel,
  setSelectedModel,
  onDeleteAccount,
  initialSection,
}) => {
  useEscapeKey(onClose);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showTierChart, setShowTierChart] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(
    initialSection ?? "model",
  );
  const [modelSearch, setModelSearch] = useState("");
  const [presetSearch, setPresetSearch] = useState("");
  const [userInfo, setUserInfo] = useState<{
    id: string;
    email: string;
    full_name: string | null;
    role: string;
  } | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminSaving, setAdminSaving] = useState<string | null>(null);
  const [adminDeleting, setAdminDeleting] = useState<string | null>(null);
  const [adminDeleteConfirm, setAdminDeleteConfirm] =
    useState<AdminUser | null>(null);
  const [adminTogglingAccess, setAdminTogglingAccess] = useState<string | null>(
    null,
  );
  const [adminPromoteConfirm, setAdminPromoteConfirm] = useState<{
    userId: string;
    newRole: string;
  } | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminRoleFilter, setAdminRoleFilter] = useState("all");
  const [adminError, setAdminError] = useState<string | null>(null);
  const adminErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [auditOffset, setAuditOffset] = useState(0);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagSaving, setFlagSaving] = useState<string | null>(null);

  useEffect(() => {
    apiGetMe()
      .then(setUserInfo)
      .catch(() => {});
  }, []);

  const showAdminError = (msg: string) => {
    setAdminError(msg);
    if (adminErrorTimer.current) clearTimeout(adminErrorTimer.current);
    adminErrorTimer.current = setTimeout(() => setAdminError(null), 4000);
  };

  const loadAdminUsers = () => {
    setAdminLoading(true);
    apiAdminGetUsers()
      .then(setAdminUsers)
      .catch(() => showAdminError("Failed to load users."))
      .finally(() => setAdminLoading(false));
  };

  const loadAnalytics = () => {
    setAnalyticsLoading(true);
    apiAdminGetAnalytics()
      .then(setAnalytics)
      .catch(() => showAdminError("Failed to load analytics."))
      .finally(() => setAnalyticsLoading(false));
  };

  const loadAuditLogs = () => {
    setAuditLoading(true);
    apiAdminGetAuditLogs(
      100,
      auditOffset,
      auditActionFilter === "all" ? undefined : auditActionFilter,
    )
      .then((data) => setAuditLogs(data.logs))
      .catch(() => showAdminError("Failed to load audit logs."))
      .finally(() => setAuditLoading(false));
  };

  const loadFeatureFlags = () => {
    setFlagsLoading(true);
    apiAdminGetFeatureFlags()
      .then(setFeatureFlags)
      .catch(() => showAdminError("Failed to load feature flags."))
      .finally(() => setFlagsLoading(false));
  };

  const handleFlagToggle = async (
    name: string,
    field: "guest_enabled" | "free_enabled" | "pro_enabled" | "admin_enabled",
    value: boolean,
  ) => {
    setFlagSaving(`${name}:${field}`);
    try {
      const updated = await apiAdminUpdateFeatureFlag(name, { [field]: value });
      setFeatureFlags((prev) =>
        prev.map((f) => (f.name === updated.name ? updated : f)),
      );
    } catch {
      showAdminError("Failed to update feature flag.");
    } finally {
      setFlagSaving(null);
    }
  };

  useEffect(() => {
    if (activeSection === "users") loadAdminUsers();
    else if (activeSection === "analytics") loadAnalytics();
    else if (activeSection === "audit") loadAuditLogs();
    else if (activeSection === "flags") loadFeatureFlags();
  }, [activeSection]);

  const handleRoleChange = (userId: string, role: string) => {
    if (role === "admin") {
      setAdminPromoteConfirm({ userId, newRole: role });
      return;
    }
    commitRoleChange(userId, role);
  };

  const commitRoleChange = async (userId: string, role: string) => {
    setAdminSaving(userId);
    try {
      const updated = await apiAdminSetRole(userId, role);
      setAdminUsers((prev) =>
        prev.map((u) =>
          u.id === updated.id ? { ...u, role: updated.role } : u,
        ),
      );
    } catch {
      showAdminError("Failed to update role.");
    } finally {
      setAdminSaving(null);
    }
  };

  const handleConfirmPromotion = () => {
    if (!adminPromoteConfirm) return;
    const { userId, newRole } = adminPromoteConfirm;
    setAdminPromoteConfirm(null);
    commitRoleChange(userId, newRole);
  };

  const handleToggleAccess = async (userId: string) => {
    setAdminTogglingAccess(userId);
    try {
      const res = await apiAdminToggleAccess(userId);
      setAdminUsers((prev) =>
        prev.map((u) =>
          u.id === res.id ? { ...u, is_active: res.is_active } : u,
        ),
      );
    } catch {
      showAdminError("Failed to toggle access.");
    } finally {
      setAdminTogglingAccess(null);
    }
  };

  const handleAdminDeleteUser = async () => {
    if (!adminDeleteConfirm) return;
    setAdminDeleting(adminDeleteConfirm.id);
    try {
      await apiAdminDeleteUser(adminDeleteConfirm.id);
      setAdminUsers((prev) =>
        prev.filter((u) => u.id !== adminDeleteConfirm.id),
      );
      setAdminDeleteConfirm(null);
    } catch {
      showAdminError("Failed to delete user.");
    } finally {
      setAdminDeleting(null);
    }
  };

  const navItems: { id: Section; label: string }[] =
    userInfo?.role === "admin"
      ? [
          ...BASE_NAV_ITEMS,
          { id: "users", label: "Users" },
          { id: "analytics", label: "Analytics" },
          { id: "audit", label: "Audit Logs" },
          { id: "flags", label: "Feature Flags" },
        ]
      : BASE_NAV_ITEMS;

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await onDeleteAccount();
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleSaveName = async () => {
    if (nameEdit === null) return;
    const trimmed = nameEdit.trim();
    setNameSaving(true);
    try {
      await apiUpdateProfile(trimmed || (userInfo?.email ?? ""));
      setUserInfo((prev) =>
        prev ? { ...prev, full_name: trimmed || null } : prev,
      );
      setNameEdit(null);
    } catch {
      /* silent — keep editing open */
    } finally {
      setNameSaving(false);
    }
  };

  const handlePresetClick = (label: string, prompt: string) => {
    setActivePreset(label);
    setSystemPrompt(prompt);
  };

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase()),
  );
  const filteredPresets = PRESETS.filter((p) =>
    p.label.toLowerCase().includes(presetSearch.toLowerCase()),
  );

  const tempLabel =
    temperature <= 0.4
      ? "Focused — precise, deterministic responses"
      : temperature === 0.7
        ? "Balanced — reliable with some creativity (Default)"
        : temperature <= 0.9
          ? "Balanced — reliable with some creativity"
          : temperature <= 1.4
            ? "Creative — more varied and expressive"
            : "Wild — highly unpredictable outputs";

  const renderSection = () => {
    switch (activeSection) {
      case "model":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Model</span>
              {models.length > 0 && (
                <span className="pref-content-badge">{models.length}</span>
              )}
            </div>
            <div className="pref-search-bar">
              <input
                className="pref-search-input"
                type="text"
                placeholder="Search Models"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </div>
            <div className="pref-list">
              {filteredModels.length === 0 ? (
                <div className="pref-empty">
                  {models.length === 0 ? "Loading models…" : "No models match"}
                </div>
              ) : (
                filteredModels.map((m) => {
                  const isActive = m === selectedModel;
                  const [name, tag] = m.split(":");
                  return (
                    <div
                      key={m}
                      className={`pref-list-item${isActive ? " active" : ""}`}
                      onClick={() => setSelectedModel(m)}
                    >
                      <div className="pref-item-icon">
                        {name[0].toUpperCase()}
                      </div>
                      <div className="pref-item-info">
                        <div className="pref-item-name">{name}</div>
                        {tag && <div className="pref-item-desc">{tag}</div>}
                      </div>
                      <div
                        className={`pref-item-check${isActive ? " checked" : ""}`}
                      >
                        {isActive && <span className="pref-check-mark">✓</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        );

      case "presets":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Presets</span>
              <span className="pref-content-badge">{PRESETS.length}</span>
            </div>
            <div className="pref-search-bar">
              <input
                className="pref-search-input"
                type="text"
                placeholder="Search Presets"
                value={presetSearch}
                onChange={(e) => setPresetSearch(e.target.value)}
              />
            </div>
            <div className="pref-list pref-list-presets">
              {filteredPresets.map(({ label, description, prompt }) => {
                const isActive = activePreset === label;
                return (
                  <div
                    key={label}
                    className={`pref-list-item${isActive ? " active" : ""}`}
                    onClick={() => handlePresetClick(label, prompt)}
                  >
                    <div className="pref-item-icon">{label[0]}</div>
                    <div className="pref-item-info">
                      <div className="pref-item-name">{label}</div>
                      <div className="pref-item-desc">{description}</div>
                    </div>
                    <div
                      className={`pref-item-check${isActive ? " checked" : ""}`}
                    >
                      {isActive && <span className="pref-check-mark">✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {activePreset === "Custom" && (
              <div className="pref-custom-prompt">
                <label>Custom System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful assistant and …"
                />
              </div>
            )}
          </>
        );

      case "temperature":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Temperature</span>
            </div>
            <div className="pref-settings-area">
              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">Response Temperature</div>
                  <div className="pref-setting-hint">{tempLabel}</div>
                </div>
                <span className="pref-temp-value">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                className="temperature-slider pref-slider"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <div className="temperature-labels">
                <span>0.0</span>
                <span>1.0</span>
                <span>2.0</span>
              </div>
            </div>
          </>
        );

      case "appearance":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Appearance</span>
            </div>
            <div className="pref-settings-area">
              <div className="pref-setting-section-label">Theme</div>
              <div className="pref-theme-cards">
                <div
                  className={`pref-theme-card${theme === "ocean-glass" ? " active" : ""}`}
                  onClick={() => setTheme("ocean-glass")}
                >
                  <div className="pref-theme-preview pref-theme-preview-ocean">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Ocean</span>
                  {theme === "ocean-glass" && (
                    <span className="pref-theme-check">✓</span>
                  )}
                </div>
                <div
                  className={`pref-theme-card${theme === "gruvbox-flat" ? " active" : ""}`}
                  onClick={() => setTheme("gruvbox-flat")}
                >
                  <div className="pref-theme-preview pref-theme-preview-gruvbox">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Gruvbox</span>
                  {theme === "gruvbox-flat" && (
                    <span className="pref-theme-check">✓</span>
                  )}
                </div>
              </div>
            </div>
          </>
        );

      case "account":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Account</span>
            </div>
            {userInfo && (
              <div className="pref-account-info">
                <div className="pref-account-email">{userInfo.email}</div>
                <span className={`pref-role-badge pref-role-${userInfo.role}`}>
                  {userInfo.role.charAt(0).toUpperCase() +
                    userInfo.role.slice(1)}
                </span>
              </div>
            )}
            <div className="pref-section-label">Full Name</div>
            <div className="pref-name-row">
              {nameEdit !== null ? (
                <>
                  <input
                    className="pref-name-input"
                    value={nameEdit}
                    maxLength={120}
                    placeholder={userInfo?.email ?? ""}
                    onChange={(e) => setNameEdit(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") setNameEdit(null);
                    }}
                    autoFocus
                    disabled={nameSaving}
                  />
                  <button
                    className="pref-name-save-btn"
                    onClick={handleSaveName}
                    disabled={nameSaving}
                  >
                    {nameSaving ? "◌" : "Save"}
                  </button>
                  <button
                    className="pref-name-cancel-btn"
                    onClick={() => setNameEdit(null)}
                    disabled={nameSaving}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="pref-name-value">
                    {userInfo?.full_name ?? (
                      <span className="pref-name-placeholder">
                        {userInfo?.email}
                      </span>
                    )}
                  </span>
                  <button
                    className="pref-name-edit-btn"
                    onClick={() => setNameEdit(userInfo?.full_name ?? "")}
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
            <div className="pref-list">
              <div
                className="pref-list-item"
                onClick={() => setShowTierChart(true)}
              >
                <div className="pref-item-icon">
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </div>
                <div className="pref-item-info">
                  <div className="pref-item-name">View Plans</div>
                  <div className="pref-item-desc">
                    Compare features across Guest, Free, and Pro tiers
                  </div>
                </div>
                <span className="pref-row-arrow">→</span>
              </div>
              <div
                className="pref-list-item pref-danger-item"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <div className="pref-item-icon">
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </div>
                <div className="pref-item-info">
                  <div className="pref-item-name pref-danger-name">
                    Delete Account
                  </div>
                  <div className="pref-item-desc">
                    Permanently removes your account and all data
                  </div>
                </div>
                <span className="pref-row-arrow">→</span>
              </div>
              <p id="acc-upgrade-message">
                Contact administrator for account tier upgrade
              </p>
            </div>
          </>
        );

      case "users": {
        const filteredUsers = adminUsers.filter(
          (u) =>
            u.email.toLowerCase().includes(adminSearch.toLowerCase()) &&
            (adminRoleFilter === "all" || u.role === adminRoleFilter),
        );
        const isFiltered = adminSearch !== "" || adminRoleFilter !== "all";
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Admin Control - Users</span>
              <span className="pref-content-badge">
                {isFiltered
                  ? `${filteredUsers.length} / ${adminUsers.length}`
                  : adminUsers.length}
              </span>
              <button
                className="pref-refresh-btn"
                onClick={loadAdminUsers}
                disabled={adminLoading}
                title="Refresh"
              >
                ↻
              </button>
            </div>
            {adminError && <div className="pref-admin-error">{adminError}</div>}
            <div className="pref-users-toolbar">
              <input
                className="pref-search-input"
                type="text"
                placeholder="Search by email…"
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
              />
              <select
                className="pref-users-role-filter"
                value={adminRoleFilter}
                onChange={(e) => setAdminRoleFilter(e.target.value)}
              >
                <option value="all">All roles</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="pref-users-list">
              {adminLoading ? (
                <div className="pref-users-empty">Loading…</div>
              ) : filteredUsers.length === 0 ? (
                <div className="pref-users-empty">
                  {isFiltered
                    ? "No users match the filter."
                    : "No users found."}
                </div>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = u.id === userInfo?.id;
                  const isBusy = adminSaving === u.id || adminDeleting === u.id;
                  return (
                    <div key={u.id} className="pref-user-row">
                      <div className="pref-user-main">
                        <div className="pref-user-email">{u.email}</div>
                        <div className="pref-user-stats">
                          {u.chats} chats · {u.messages} msgs · joined{" "}
                          {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <select
                        className={`pref-role-select pref-role-${u.role}`}
                        value={u.role}
                        disabled={isBusy || isSelf}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      >
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                        <option value="admin">Admin</option>
                      </select>
                      <span
                        role="button"
                        tabIndex={
                          adminTogglingAccess === u.id ||
                          adminDeleting === u.id ||
                          isSelf
                            ? -1
                            : 0
                        }
                        className={`pref-user-access-toggle ${u.is_active ? "active" : "inactive"}${adminTogglingAccess === u.id || adminDeleting === u.id || isSelf ? " disabled" : ""}`}
                        onClick={() => {
                          if (
                            adminTogglingAccess === u.id ||
                            adminDeleting === u.id ||
                            isSelf
                          )
                            return;
                          handleToggleAccess(u.id);
                        }}
                        title={
                          isSelf
                            ? "Cannot disable your own access"
                            : u.is_active
                              ? "Disable chat access"
                              : "Enable chat access"
                        }
                      >
                        {u.is_active ? "On" : "Off"}
                      </span>
                      <span
                        role="button"
                        tabIndex={isBusy || isSelf ? -1 : 0}
                        className={`pref-user-delete-btn${isBusy || isSelf ? " disabled" : ""}`}
                        onClick={() => {
                          if (isBusy || isSelf) return;
                          setAdminDeleteConfirm(u);
                        }}
                        title={
                          isSelf
                            ? "Cannot delete your own account here"
                            : "Delete user"
                        }
                      >
                        ✕
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            {adminPromoteConfirm && (
              <div
                className="pref-delete-overlay"
                onClick={() => setAdminPromoteConfirm(null)}
              >
                <div
                  className="pref-delete-dialog-box"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="pref-delete-dialog-title">
                    Promote to Admin
                  </div>
                  <div className="pref-delete-dialog-text">
                    Grant admin access to{" "}
                    <strong>
                      {
                        adminUsers.find(
                          (u) => u.id === adminPromoteConfirm.userId,
                        )?.email
                      }
                    </strong>
                    ? They will have full control over all users.
                  </div>
                  <div className="pref-delete-dialog-divider" />
                  <div className="pref-delete-dialog-actions">
                    <button
                      className="pref-confirm-no"
                      onClick={() => setAdminPromoteConfirm(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="pref-confirm-yes"
                      onClick={handleConfirmPromotion}
                    >
                      Promote
                    </button>
                  </div>
                </div>
              </div>
            )}
            {adminDeleteConfirm && (
              <div
                className="pref-delete-overlay"
                onClick={() => setAdminDeleteConfirm(null)}
              >
                <div
                  className="pref-delete-dialog-box"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="pref-delete-dialog-title">Delete User</div>
                  <div className="pref-delete-dialog-text">
                    Permanently delete{" "}
                    <strong>{adminDeleteConfirm.email}</strong> and all their
                    data? This cannot be undone.
                  </div>
                  <div className="pref-delete-dialog-divider" />
                  <div className="pref-delete-dialog-actions">
                    <button
                      className="pref-confirm-no"
                      onClick={() => setAdminDeleteConfirm(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="pref-confirm-yes"
                      disabled={adminDeleting !== null}
                      onClick={handleAdminDeleteUser}
                    >
                      {adminDeleting ? "Deleting…" : "Delete User"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        );
      }

      case "analytics":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">System Analytics</span>
              <button
                className="pref-refresh-btn"
                onClick={loadAnalytics}
                disabled={analyticsLoading}
                title="Refresh"
              >
                ↻
              </button>
            </div>
            {adminError && <div className="pref-admin-error">{adminError}</div>}
            {analyticsLoading ? (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: "#a89984",
                }}
              >
                Loading analytics…
              </div>
            ) : analytics ? (
              <div className="pref-analytics-container">
                <div className="pref-analytics-section">
                  <div className="pref-analytics-title">Totals</div>
                  <div className="pref-analytics-grid">
                    <div className="pref-analytics-card">
                      <div className="pref-analytics-value">
                        {analytics.totals.users}
                      </div>
                      <div className="pref-analytics-label">Users</div>
                    </div>
                    <div className="pref-analytics-card">
                      <div className="pref-analytics-value">
                        {analytics.totals.chats}
                      </div>
                      <div className="pref-analytics-label">Chats</div>
                    </div>
                    <div className="pref-analytics-card">
                      <div className="pref-analytics-value">
                        {analytics.totals.messages}
                      </div>
                      <div className="pref-analytics-label">Messages</div>
                    </div>
                    <div className="pref-analytics-card">
                      <div className="pref-analytics-value">
                        {analytics.totals.documents}
                      </div>
                      <div className="pref-analytics-label">Documents</div>
                    </div>
                  </div>
                </div>

                <div className="pref-analytics-section">
                  <div className="pref-analytics-title">Active Users</div>
                  <div className="pref-analytics-grid">
                    <div className="pref-analytics-card">
                      <div className="pref-analytics-value">
                        {analytics.active.today}
                      </div>
                      <div className="pref-analytics-label">Today</div>
                    </div>
                    <div className="pref-analytics-card">
                      <div className="pref-analytics-value">
                        {analytics.active.this_week}
                      </div>
                      <div className="pref-analytics-label">This Week</div>
                    </div>
                  </div>
                </div>

                <div className="pref-analytics-section">
                  <div className="pref-analytics-title">User Roles</div>
                  <div className="pref-analytics-roles">
                    {Object.entries(analytics.roles || {}).map(
                      ([role, count]: [string, any]) => (
                        <div key={role} className="pref-analytics-role-item">
                          <span className={`pref-role-badge pref-role-${role}`}>
                            {role}
                          </span>
                          <span className="pref-analytics-role-count">
                            {count}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                {Object.keys(analytics.recent_admin_actions || {}).length >
                  0 && (
                  <div className="pref-analytics-section">
                    <div className="pref-analytics-title">
                      Admin Actions Today
                    </div>
                    <div className="pref-analytics-roles">
                      {Object.entries(analytics.recent_admin_actions).map(
                        ([action, count]: [string, any]) => (
                          <div
                            key={action}
                            className="pref-analytics-action-item"
                          >
                            <span className="pref-analytics-action-name">
                              {action
                                .split("_")
                                .map(
                                  (w: string) =>
                                    w.charAt(0).toUpperCase() + w.slice(1),
                                )
                                .join(" ")}
                            </span>
                            <span className="pref-analytics-role-count">
                              {count}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: "#a89984",
                }}
              >
                No analytics available
              </div>
            )}
          </>
        );

      case "flags": {
        const FLAG_TIERS: {
          field:
            | "guest_enabled"
            | "free_enabled"
            | "pro_enabled"
            | "admin_enabled";
          label: string;
          tier: "guest" | "free" | "pro" | "admin";
        }[] = [
          { field: "guest_enabled", label: "Guest", tier: "guest" },
          { field: "free_enabled", label: "Free", tier: "free" },
          { field: "pro_enabled", label: "Pro", tier: "pro" },
          { field: "admin_enabled", label: "Admin", tier: "admin" },
        ];

        // Separate guest-specific flags from general flags
        const guestFlags = featureFlags.filter((f) =>
          ["guest_tools", "guest_preferences"].includes(f.name),
        );
        const generalFlags = featureFlags.filter(
          (f) => !["guest_tools", "guest_preferences"].includes(f.name),
        );

        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Feature Flags</span>
              {featureFlags.length > 0 && (
                <span className="pref-content-badge">
                  {featureFlags.length}
                </span>
              )}
              <button
                className="pref-refresh-btn"
                onClick={loadFeatureFlags}
                disabled={flagsLoading}
                title="Refresh"
              >
                ↻
              </button>
            </div>
            {adminError && <div className="pref-admin-error">{adminError}</div>}
            {flagsLoading ? (
              <div className="pref-users-empty">Loading feature flags…</div>
            ) : featureFlags.length === 0 ? (
              <div className="pref-users-empty">No feature flags found.</div>
            ) : (
              <>
                {/* General Features (Tiered) Section */}
                {generalFlags.length > 0 && (
                  <div className="pref-flags-list">
                    <div className="pref-flags-header-row">
                      <span className="pref-flags-header-spacer" />
                      <div className="pref-flags-tier-labels">
                        {FLAG_TIERS.map(({ label, tier }) => (
                          <span
                            key={tier}
                            className={`pref-flags-col-label pref-flags-col-${tier}`}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                    {generalFlags.map((flag) => (
                      <div key={flag.name} className="pref-flag-row">
                        <div className="pref-flag-info">
                          <div className="pref-flag-name">
                            {flag.name
                              .split("_")
                              .map(
                                (w) => w.charAt(0).toUpperCase() + w.slice(1),
                              )
                              .join(" ")}
                          </div>
                          <div className="pref-flag-desc">
                            {flag.description}
                          </div>
                        </div>
                        <div className="pref-flag-tiers">
                          {FLAG_TIERS.map(({ field, label, tier }) => {
                            const isOn = flag[field];
                            const isSaving =
                              flagSaving === `${flag.name}:${field}`;
                            return (
                              <span
                                key={field}
                                role="button"
                                tabIndex={isSaving ? -1 : 0}
                                className={`pref-flag-toggle pref-flag-toggle-${tier}${isOn ? " on" : ""}${isSaving ? " saving" : ""}`}
                                onClick={() => {
                                  if (isSaving) return;
                                  handleFlagToggle(flag.name, field, !isOn);
                                }}
                                title={`${isOn ? "Disable" : "Enable"} for ${label}`}
                              >
                                {isSaving ? "…" : isOn ? "On" : "Off"}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Guest Features Section */}
                {guestFlags.length > 0 && (
                  <div className="pref-guest-section">
                    <div className="pref-guest-section-title">
                      Guest Features
                    </div>
                    <div className="pref-guest-features">
                      {guestFlags.map((flag) => {
                        const isOn = flag.guest_enabled;
                        const isSaving =
                          flagSaving === `${flag.name}:guest_enabled`;
                        return (
                          <div
                            key={flag.name}
                            className="pref-guest-feature-row"
                          >
                            <div className="pref-guest-feature-info">
                              <div className="pref-guest-feature-name">
                                {flag.name
                                  .split("_")
                                  .map(
                                    (w) =>
                                      w.charAt(0).toUpperCase() + w.slice(1),
                                  )
                                  .join(" ")}
                              </div>
                              <div className="pref-guest-feature-desc">
                                {flag.description}
                              </div>
                            </div>
                            <span
                              role="button"
                              tabIndex={isSaving ? -1 : 0}
                              className={`pref-guest-toggle${isOn ? " on" : ""}${isSaving ? " saving" : ""}`}
                              onClick={() => {
                                if (isSaving) return;
                                handleFlagToggle(
                                  flag.name,
                                  "guest_enabled",
                                  !isOn,
                                );
                              }}
                              title={`${isOn ? "Disable" : "Enable"} for guests`}
                            >
                              {isSaving ? "…" : isOn ? "On" : "Off"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        );
      }

      case "audit":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Audit Logs</span>
              <button
                className="pref-refresh-btn"
                onClick={loadAuditLogs}
                disabled={auditLoading}
                title="Refresh"
              >
                ↻
              </button>
            </div>
            {adminError && <div className="pref-admin-error">{adminError}</div>}
            <div className="pref-audit-toolbar">
              <select
                className="pref-audit-filter"
                value={auditActionFilter}
                onChange={(e) => {
                  setAuditActionFilter(e.target.value);
                  setAuditOffset(0);
                }}
              >
                <option value="all">All actions</option>
                <option value="set_role">Set Role</option>
                <option value="delete_user">Delete User</option>
                <option value="toggle_access">Toggle Access</option>
                <option value="update_feature_flag">Update Feature Flag</option>
              </select>
            </div>
            <div className="pref-audit-logs">
              {auditLoading ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#a89984",
                  }}
                >
                  Loading logs…
                </div>
              ) : auditLogs.length === 0 ? (
                <div
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#a89984",
                  }}
                >
                  No audit logs found
                </div>
              ) : (
                auditLogs.map((log) => {
                  const getActionDetails = () => {
                    if (
                      log.action === "set_role" &&
                      log.details.old_role &&
                      log.details.new_role
                    ) {
                      return `${log.details.old_role} → ${log.details.new_role}`;
                    } else if (log.action === "toggle_access") {
                      const wasActive = log.details.was_active
                        ? "Active"
                        : "Disabled";
                      const nowActive = log.details.is_active
                        ? "Active"
                        : "Disabled";
                      return `${wasActive} → ${nowActive}`;
                    } else if (
                      log.action === "delete_user" &&
                      log.details.email
                    ) {
                      return `${log.details.email}`;
                    }
                    return null;
                  };

                  const actionDetails = getActionDetails();

                  return (
                    <div key={log.id} className="pref-audit-log-item">
                      <div className="pref-audit-log-main">
                        <div className="pref-audit-log-action">
                          {log.action
                            .split("_")
                            .map(
                              (word: string) =>
                                word.charAt(0).toUpperCase() + word.slice(1),
                            )
                            .join(" ")}
                          {actionDetails && (
                            <span className="pref-audit-log-change">
                              {" "}
                              ({actionDetails})
                            </span>
                          )}
                        </div>
                        <div className="pref-audit-log-time">
                          {new Date(log.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="pref-audit-log-details">
                        {log.admin_email ? (
                          <span className="pref-audit-admin">
                            by {log.admin_email}
                          </span>
                        ) : log.admin_id ? (
                          <span className="pref-audit-admin">
                            by {log.admin_id.slice(0, 8)}…
                          </span>
                        ) : null}
                        {log.target_email ? (
                          <span className="pref-audit-target">
                            target: {log.target_email}
                          </span>
                        ) : log.target_id ? (
                          <span className="pref-audit-target">
                            ID: {log.target_id.slice(0, 8)}…
                          </span>
                        ) : null}
                        {log.details.ip && (
                          <span className="pref-audit-ip">
                            IP: {log.details.ip}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        );
    }
  };

  return (
    <>
      <div className="chat-preferences-modal-overlay" onClick={onClose}>
        <div
          className="pref-modal"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.closest(".pref-theme-card")) haptics.trigger("medium");
            else if (t.closest(".pref-danger-item")) haptics.trigger("warning");
            else if (t.closest(".pref-list-item")) haptics.trigger("light");
            else if (t.closest(".pref-nav-item")) haptics.trigger("selection");
            else if (t.closest("button.pref-close-btn"))
              haptics.trigger("light");
            else if (t.closest("button:not(:disabled)"))
              haptics.trigger("selection");
            e.stopPropagation();
          }}
        >
          <div className="pref-sidebar">
            <div className="pref-sidebar-title">Preferences</div>
            {navItems.map(({ id, label }) => (
              <div
                key={id}
                className={`pref-nav-item${activeSection === id ? " active" : ""}`}
                onClick={() => setActiveSection(id)}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="pref-content">{renderSection()}</div>
          <button className="pref-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          className="pref-delete-overlay"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="pref-delete-dialog-box"
            onClick={(e) => {
              const btn = (e.target as HTMLElement).closest(
                "button:not(:disabled)",
              ) as HTMLElement | null;
              if (btn?.classList.contains("pref-confirm-yes"))
                haptics.trigger("warning");
              else if (btn) haptics.trigger("selection");
              e.stopPropagation();
            }}
          >
            <div className="pref-delete-dialog-title">Delete Account</div>
            <div className="pref-delete-dialog-text">
              This will permanently delete your account and all associated data.
              This action cannot be undone.
            </div>
            <div className="pref-delete-dialog-divider" />
            <div className="pref-delete-dialog-actions">
              <button
                className="pref-confirm-no"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="pref-confirm-yes"
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTierChart &&
        (() => {
          const tiers: { id: string; label: string }[] = [
            { id: "guest", label: "Guest" },
            { id: "free", label: "Free" },
            { id: "pro", label: "Pro" },
          ];
          const rows: { label: string; values: Record<string, string> }[] = [
            {
              label: "Messages / min",
              values: { guest: "3", free: "10", pro: "30" },
            },
            {
              label: "Daily limit",
              values: { guest: "30", free: "—", pro: "—" },
            },
            {
              label: "Chat history",
              values: { guest: "✗", free: "✓", pro: "✓" },
            },
            {
              label: "Image upload",
              values: { guest: "✗", free: "✓", pro: "✓" },
            },
            {
              label: "Web search",
              values: { guest: "✗", free: "✗", pro: "✓" },
            },
            {
              label: "Documents / RAG",
              values: { guest: "✗", free: "✗", pro: "✓" },
            },
          ];
          const currentTier = userInfo?.role ?? null;
          return (
            <div
              className="pref-delete-overlay"
              onClick={() => setShowTierChart(false)}
            >
              <div
                className="tier-chart-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="tier-chart-header">
                  <span className="tier-chart-title">Plans</span>
                  <button
                    className="pref-close-btn tier-chart-close"
                    onClick={() => setShowTierChart(false)}
                  >
                    ✕
                  </button>
                </div>
                <table className="tier-chart-table">
                  <thead>
                    <tr>
                      <th className="tier-chart-feature-col" />
                      {tiers.map((t) => (
                        <th
                          key={t.id}
                          className={`tier-chart-col${t.id === currentTier ? " tier-chart-col-current" : ""}`}
                        >
                          {t.id === currentTier && (
                            <div className="tier-chart-you">You</div>
                          )}
                          <span
                            className={`pref-role-badge pref-role-${t.id === "guest" ? "guest" : t.id}`}
                          >
                            {t.label}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label}>
                        <td className="tier-chart-feature-label">
                          {row.label}
                        </td>
                        {tiers.map((t) => {
                          const val = row.values[t.id];
                          const isCheck = val === "✓";
                          const isCross = val === "✗";
                          return (
                            <td
                              key={t.id}
                              className={`tier-chart-cell${t.id === currentTier ? " tier-chart-cell-current" : ""}${isCheck ? " tier-cell-yes" : isCross ? " tier-cell-no" : ""}`}
                            >
                              {val}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tier-chart-footer">
                  Contact your administrator to upgrade your tier.
                </p>
              </div>
            </div>
          );
        })()}
    </>
  );
};

export default ChatPreferences;
