import React, { useState, useEffect, useRef } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { haptics } from "../haptics";
import {
  apiGetMe,
  apiAdminGetUsers,
  apiAdminSetRole,
  apiAdminToggleAccess,
  apiAdminDeleteUser,
} from "./api";
import type { AdminUser } from "./api";

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
  | "users";

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
  const [activeSection, setActiveSection] = useState<Section>(
    initialSection ?? "model",
  );
  const [modelSearch, setModelSearch] = useState("");
  const [presetSearch, setPresetSearch] = useState("");
  const [userInfo, setUserInfo] = useState<{
    id: string;
    email: string;
    role: string;
  } | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminSaving, setAdminSaving] = useState<string | null>(null);
  const [adminDeleting, setAdminDeleting] = useState<string | null>(null);
  const [adminDeleteConfirm, setAdminDeleteConfirm] = useState<AdminUser | null>(null);
  const [adminTogglingAccess, setAdminTogglingAccess] = useState<string | null>(null);
  const [adminPromoteConfirm, setAdminPromoteConfirm] = useState<{ userId: string; newRole: string } | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminRoleFilter, setAdminRoleFilter] = useState("all");
  const [adminError, setAdminError] = useState<string | null>(null);
  const adminErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (activeSection === "users") loadAdminUsers();
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
        prev.map((u) => (u.id === res.id ? { ...u, is_active: res.is_active } : u)),
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
      ? [...BASE_NAV_ITEMS, { id: "users", label: "Users" }]
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
            <div className="pref-list">
              <div
                className="pref-list-item pref-danger-item"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <div className="pref-item-icon">✕</div>
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
            {adminError && (
              <div className="pref-admin-error">{adminError}</div>
            )}
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
                  {isFiltered ? "No users match the filter." : "No users found."}
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
                        {u.chats} chats · {u.messages} msgs · joined {new Date(u.created_at).toLocaleDateString()}
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
                      tabIndex={adminTogglingAccess === u.id || adminDeleting === u.id || isSelf ? -1 : 0}
                      className={`pref-user-access-toggle ${u.is_active ? "active" : "inactive"}${adminTogglingAccess === u.id || adminDeleting === u.id || isSelf ? " disabled" : ""}`}
                      onClick={() => {
                        if (adminTogglingAccess === u.id || adminDeleting === u.id || isSelf) return;
                        handleToggleAccess(u.id);
                      }}
                      title={isSelf ? "Cannot disable your own access" : u.is_active ? "Disable chat access" : "Enable chat access"}
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
                      title={isSelf ? "Cannot delete your own account here" : "Delete user"}
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
                  <div className="pref-delete-dialog-title">Promote to Admin</div>
                  <div className="pref-delete-dialog-text">
                    Grant admin access to{" "}
                    <strong>{adminUsers.find((u) => u.id === adminPromoteConfirm.userId)?.email}</strong>?
                    They will have full control over all users.
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
    </>
  );
};

export default ChatPreferences;
