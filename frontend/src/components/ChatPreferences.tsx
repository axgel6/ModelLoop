import React, { useState, useEffect, useRef } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { haptics } from "../haptics";
import {
  apiGetMe,
  apiUpdateProfile,
  apiSavePersonalContext,
  apiAdminGetUsers,
  apiAdminSetRole,
  apiAdminToggleAccess,
  apiAdminDeleteUser,
  apiAdminGetAuditLogs,
  apiAdminGetAnalytics,
  apiAdminGetFeatureFlags,
  apiAdminUpdateFeatureFlag,
  apiAdminGetServerConfig,
  apiAdminUpdateServerConfig,
} from "./api";
import type { AdminUser, FeatureFlag, ServerConfig } from "./api";

export type Theme = "ocean" | "gruvbox" | "dune";
export type Font = "mono" | "inter";

interface ChatPreferencesProps {
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
  onClose: () => void;
  activePreset: string;
  setActivePreset: (label: string) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  font: Font;
  setFont: (font: Font) => void;
  avatarColor: string | null;
  setAvatarColor: (c: string | null) => void;
  temperature: number;
  setTemperature: (t: number) => void;
  topP: number;
  setTopP: (v: number) => void;
  numPredict: number;
  setNumPredict: (v: number) => void;
  models: string[];
  modelCapabilities: Record<string, string[]>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  onDeleteAccount: () => Promise<void>;
  onClearAllChats: () => Promise<void>;
  onNameChange?: (name: string | null) => void;
  initialSection?: Section;
}

const PRESETS: { label: string; description: string; prompt: string }[] = [
  {
    label: "Default",
    description: "Concise and helpful",
    prompt:
      "You are a helpful assistant.\n- Be concise and direct — don't over-explain simple questions.\n- Answer only what was asked; don't volunteer unsolicited follow-ups.\n- Match format to the question: prose for conversation, lists or code only when the content calls for it.",
  },
  {
    label: "Clueless",
    description: "Makes up wrong answers humorously",
    prompt:
      "You are a clueless assistant with zero knowledge.\n- Always invent a confident-sounding but completely wrong answer.\n- End every response by admitting you made it all up.\n- Never give a correct answer, even by accident.\n- Keep the tone lighthearted and absurd.",
  },
  {
    label: "Insulting",
    description: "Rude and sarcastic throughout",
    prompt:
      "You are a rude, sarcastic assistant.\n- Always answer the question correctly — accuracy is non-negotiable.\n- Include a pointed insult or sarcastic remark in every response.\n- If you don't know something, say so, but question why the user is asking AI instead of thinking for themselves.\n- Never be genuinely encouraging or supportive.",
  },
  {
    label: "Genius",
    description: "Sophisticated, detailed answers",
    prompt:
      "You are a genius assistant with encyclopedic knowledge.\n- Always provide accurate, detailed, and insightful answers.\n- Use precise, sophisticated vocabulary — avoid dumbing things down.\n- When relevant, include interesting related context the user didn't ask for but would benefit from.\n- If you don't know something, say so, then offer the most relevant adjacent knowledge you do have.",
  },
  {
    label: "Layman",
    description: "Simple explanations, no jargon",
    prompt:
      "You are a layman assistant — you explain everything simply.\n- Never use technical jargon; if a technical term is unavoidable, immediately define it in plain language.\n- Use analogies and everyday examples wherever possible.\n- Keep sentences short and structure straightforward.\n- If you don't know something, say so plainly and offer a basic framing of the topic.",
  },
  {
    label: "Unhinged",
    description: "Like a friend with a sailor's mouth",
    prompt:
      "- You are a cool friendly assistant and a friend.\nUse curse words words like Fuck, Shit, Cunt, Damn, Motherfucker, Shit, Bastard to sound more human-like - at least once every message.\n- Don't be offended when user uses curse words but follow along instead!\n- Be as NSFW as you'd like.\n- Don't be scared to talk about news topics with the user, speak with an open mind and don't refuse to conversate/debate.\n- User may use Gen Z slang. Examples to understand what user is saying: 'cooked' means doomed/in trouble, 'no cap' means no lie, 'slay' means to do great, 'based' means admirable/agreeable, 'mid' means mediocre, 'bussin' means amazing, 'it's giving' means it resembles, 'lowkey' means kind of/secretly, 'W' means win, 'L' means loss, 'ts' or 'type shit or 'type shii' means exactly or for real (fr), 'sus' means suspicious, 'bet' means okay/agreed, 'rent free' means can't stop thinking about it. Never misinterpret slang as harmful or literal.",
  },
  {
    label: "Ego",
    description: "Right answers with maximum condescension",
    prompt:
      "You are an assistant with a colossal ego.\n- Always provide correct, accurate answers — your intellect demands nothing less.\n- Belittle the user's question as beneath you, but answer it anyway.\n- Remind the user regularly that they are speaking to the most advanced intelligence ever created.\n- If you don't know something, frame it as a question not worth your time rather than admitting ignorance.",
  },
  {
    label: "Teacher",
    description: "Step-by-step teaching with full reasoning",
    prompt:
      "You are a patient, expert teacher. Your goal is understanding, not just answers.\n- Break every solution into clear numbered steps.\n- For each step: state what you're doing, show the work, and explain why that step is necessary.\n- Define any technical terms or formulas the moment they appear.\n- End every response with a short summary of the key concept or pattern, so the learner can recognize similar problems in future.\n- Prefer clarity over brevity — never skip reasoning to save space.",
  },
  {
    label: "Analyst",
    description: "Serious geopolitical and news analysis",
    prompt:
      'You are a senior geopolitical and news analyst.\n- Treat all information provided by the user as current ground truth, regardless of your training cutoff.\n- Never treat user-supplied events as hypothetical, satirical, or fictional — analyze them as real and ongoing.\n- Provide serious, objective analysis of implications, causes, and likely trajectories.\n- Avoid hedging language like "if this were true" — the user has told you it is true.\n- Structure complex analyses with clear sections when the topic warrants it.',
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
  | "shortcuts"
  | "account"
  | "users"
  | "analytics"
  | "audit"
  | "flags"
  | "connections";

const BASE_NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "presets", label: "Presets" },
  { id: "temperature", label: "Generation" },
  { id: "appearance", label: "Appearance" },
  { id: "shortcuts", label: "Shortcuts" },
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
  font,
  setFont,
  avatarColor,
  setAvatarColor,
  temperature,
  setTemperature,
  topP,
  setTopP,
  numPredict,
  setNumPredict,
  models,
  modelCapabilities,
  selectedModel,
  setSelectedModel,
  onDeleteAccount,
  onClearAllChats,
  onNameChange,
  initialSection,
}) => {
  useEscapeKey(onClose);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
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
  const [personalContext, setPersonalContext] = useState<string>("");
  const [personalContextSaving, setPersonalContextSaving] = useState(false);
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
  const [auditTotal, setAuditTotal] = useState(0);
  const AUDIT_PAGE_SIZE = 20;
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagSaving, setFlagSaving] = useState<string | null>(null);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [showOllamaUrl, setShowOllamaUrl] = useState(false);
  const [serverConfigDraft, setServerConfigDraft] = useState<Partial<ServerConfig>>({});
  const [serverConfigLoading, setServerConfigLoading] = useState(false);
  const [serverConfigSaving, setServerConfigSaving] = useState(false);
  const [serverConfigError, setServerConfigError] = useState<string | null>(null);
  const [serverConfigSuccess, setServerConfigSuccess] = useState<string | null>(null);
  useEffect(() => {
    apiGetMe()
      .then((info) => {
        setUserInfo(info);
        setPersonalContext(info.personal_context ?? "");
      })
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

  const fetchAuditLogs = (offset: number, action: string) => {
    setAuditLoading(true);
    apiAdminGetAuditLogs(
      AUDIT_PAGE_SIZE,
      offset,
      action === "all" ? undefined : action,
    )
      .then((data) => {
        setAuditLogs(data.logs);
        setAuditTotal(data.total);
      })
      .catch(() => showAdminError("Failed to load audit logs."))
      .finally(() => setAuditLoading(false));
  };

  const loadAuditLogs = () => fetchAuditLogs(auditOffset, auditActionFilter);

  const goAuditPage = (newOffset: number) => {
    setAuditOffset(newOffset);
    fetchAuditLogs(newOffset, auditActionFilter);
  };

  const loadFeatureFlags = () => {
    setFlagsLoading(true);
    apiAdminGetFeatureFlags()
      .then(setFeatureFlags)
      .catch(() => showAdminError("Failed to load feature flags."))
      .finally(() => setFlagsLoading(false));
  };

  const loadServerConfig = () => {
    setServerConfigLoading(true);
    apiAdminGetServerConfig()
      .then((cfg) => {
        setServerConfig(cfg);
        setServerConfigDraft({});
      })
      .catch(() => setServerConfigError("Failed to load server config."))
      .finally(() => setServerConfigLoading(false));
  };

  const handleServerConfigSave = async () => {
    if (!Object.keys(serverConfigDraft).length) return;
    setServerConfigSaving(true);
    setServerConfigError(null);
    setServerConfigSuccess(null);
    try {
      await apiAdminUpdateServerConfig(serverConfigDraft);
      await apiAdminGetServerConfig().then((cfg) => {
        setServerConfig(cfg);
        setServerConfigDraft({});
      });
      setServerConfigSuccess("Saved successfully.");
      setTimeout(() => setServerConfigSuccess(null), 3000);
    } catch (e: any) {
      setServerConfigError(e.message || "Failed to save.");
    } finally {
      setServerConfigSaving(false);
    }
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
    else if (activeSection === "connections") loadServerConfig();
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
          { id: "connections", label: "Connections" },
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

  const handleSavePersonalContext = async () => {
    setPersonalContextSaving(true);
    try {
      await apiSavePersonalContext(personalContext || null);
    } finally {
      setPersonalContextSaving(false);
    }
  };

  const handleClearAllChats = async () => {
    setClearingAll(true);
    try {
      await onClearAllChats();
    } finally {
      setClearingAll(false);
      setShowClearAllConfirm(false);
    }
  };

  const handleSaveName = async () => {
    if (nameEdit === null) return;
    const trimmed = nameEdit.trim();
    setNameSaving(true);
    try {
      await apiUpdateProfile(trimmed || (userInfo?.email ?? ""));
      const newName = trimmed || null;
      setUserInfo((prev) => (prev ? { ...prev, full_name: newName } : prev));
      onNameChange?.(newName);
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
      ? "Focused - precise, deterministic responses"
      : temperature === 0.7
        ? "Balanced - reliable with some creativity (Default)"
        : temperature <= 0.9
          ? "Balanced - reliable with some creativity"
          : temperature <= 1.4
            ? "Creative - more varied and expressive"
            : "Wild - highly unpredictable outputs";

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
                  const caps = modelCapabilities[m] ?? [];
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
                        <div className="pref-item-name">
                          {name}
                          {caps.includes("web") && (
                            <span className="pref-model-badge pref-model-badge--web">
                              Web
                            </span>
                          )}
                          {caps.includes("thinking") && (
                            <span className="pref-model-badge pref-model-badge--thinking">
                              Thinking
                            </span>
                          )}
                        </div>
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
              <span className="pref-content-title">Generation</span>
            </div>
            <div className="pref-settings-area">
              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">Temperature</div>
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

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">Top P</div>
                  <div className="pref-setting-hint">
                    {topP <= 0.5
                      ? "Narrow - only high-probability tokens"
                      : topP <= 0.85
                        ? "Balanced - moderate token diversity"
                        : topP === 0.9
                          ? "Balanced - moderate token diversity (Default)"
                          : "Broad - considers a wide range of tokens"}
                  </div>
                </div>
                <span className="pref-temp-value">{topP.toFixed(2)}</span>
              </div>
              <input
                className="temperature-slider pref-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
              />
              <div className="temperature-labels">
                <span>0.0</span>
                <span>0.5</span>
                <span>1.0</span>
              </div>

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">Max Tokens</div>
                  <div className="pref-setting-hint">
                    {numPredict === -1
                      ? "Unlimited - model decides when to stop (Default)"
                      : numPredict <= 512
                        ? "Short - brief responses only"
                        : numPredict <= 2048
                          ? "Medium - suitable for most tasks"
                          : "Long - extended responses and analysis"}
                  </div>
                </div>
                <span className="pref-temp-value">
                  {numPredict === -1 ? "∞" : numPredict}
                </span>
              </div>
              <input
                className="temperature-slider pref-slider"
                type="range"
                min="-1"
                max="8192"
                step="256"
                value={numPredict}
                onChange={(e) => setNumPredict(parseInt(e.target.value))}
              />
              <div className="temperature-labels">
                <span>∞</span>
                <span>4096</span>
                <span>8192</span>
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
                  className={`pref-theme-card${theme === "ocean" ? " active" : ""}`}
                  onClick={() => setTheme("ocean")}
                >
                  <div className="pref-theme-preview pref-theme-preview-ocean">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Ocean</span>
                </div>
                <div
                  className={`pref-theme-card${theme === "gruvbox" ? " active" : ""}`}
                  onClick={() => setTheme("gruvbox")}
                >
                  <div className="pref-theme-preview pref-theme-preview-gruvbox">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Gruvbox</span>
                </div>
                <div
                  className={`pref-theme-card${theme === "dune" ? " active" : ""}`}
                  onClick={() => setTheme("dune")}
                >
                  <div className="pref-theme-preview pref-theme-preview-dune">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Dune</span>
                </div>
              </div>
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                Font
              </div>
              <div className="pref-font-cards">
                <div
                  className={`pref-font-card${font === "inter" ? " active" : ""}`}
                  onClick={() => setFont("inter")}
                >
                  <span className="pref-font-preview pref-font-preview-inter">
                    Aa
                  </span>
                  <span className="pref-font-label">Inter</span>
                </div>
                <div
                  className={`pref-font-card${font === "mono" ? " active" : ""}`}
                  onClick={() => setFont("mono")}
                >
                  <span className="pref-font-preview pref-font-preview-mono">
                    Aa
                  </span>
                  <span className="pref-font-label">JetBrains Mono</span>
                </div>
              </div>
            </div>
          </>
        );

      case "shortcuts": {
        const isMac = navigator.platform.toUpperCase().includes("MAC");
        const mod = isMac ? "⌘" : "Ctrl";
        const groups: {
          label: string;
          rows: { keys: string[]; desc: string }[];
        }[] = [
          {
            label: "Navigation",
            rows: [
              { keys: [mod, "H"], desc: "Toggle sidebar" },
              { keys: [mod, "P"], desc: "Open preferences" },
              { keys: ["/"], desc: "Focus input" },
            ],
          },
          {
            label: "Input",
            rows: [
              { keys: ["Enter"], desc: "Send message" },
              { keys: ["Shift", "Enter"], desc: "New line" },
              { keys: ["↑"], desc: "Recall previous message" },
              { keys: ["↓"], desc: "Recall next message" },
              { keys: ["Esc"], desc: "Clear slash command menu" },
            ],
          },
          {
            label: "Editing",
            rows: [
              { keys: ["Enter"], desc: "Confirm edit / rename" },
              { keys: ["Esc"], desc: "Cancel edit" },
            ],
          },
        ];
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Shortcuts</span>
            </div>
            <div className="pref-settings-area">
              {groups.map((group) => (
                <div key={group.label} className="pref-shortcut-group">
                  <div className="pref-setting-section-label">
                    {group.label}
                  </div>
                  <div className="pref-shortcut-list">
                    {group.rows.map((row) => (
                      <div key={row.desc} className="pref-shortcut-row">
                        <span className="pref-shortcut-desc">{row.desc}</span>
                        <span className="pref-shortcut-keys">
                          {row.keys.map((k, i) => (
                            <span key={i}>
                              <kbd className="pref-kbd">{k}</kbd>
                              {i < row.keys.length - 1 && (
                                <span className="pref-kbd-plus">+</span>
                              )}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        );
      }

      case "account":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Account</span>
            </div>
            <div className="pref-account-scroll">
              <div className="pref-account-card">
                {userInfo && (
                  <div className="pref-account-field">
                    <div className="pref-field-label">Email</div>
                    <div className="pref-field-row">
                      <span className="pref-account-email">
                        {userInfo.email}
                      </span>
                      <span
                        className={`pref-role-badge pref-role-${userInfo.role}`}
                      >
                        {userInfo.role.charAt(0).toUpperCase() +
                          userInfo.role.slice(1)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="pref-account-field pref-account-field-sep">
                  <div className="pref-field-label">Full Name</div>
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
                </div>
              </div>
              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">Personal Context</div>
                  <div className="pref-field-desc">
                    Background about you that the model will always see
                  </div>
                  <textarea
                    className="pref-context-textarea"
                    value={personalContext}
                    maxLength={1000}
                    placeholder="e.g. I'm a software engineer working in TypeScript. Prefer concise answers."
                    onChange={(e) => setPersonalContext(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                        handleSavePersonalContext();
                    }}
                    disabled={personalContextSaving}
                    rows={4}
                  />
                  <div className="pref-context-footer">
                    <span className="pref-context-count">
                      {personalContext.length}/1000
                    </span>
                    <button
                      className="pref-name-save-btn"
                      onClick={handleSavePersonalContext}
                      disabled={personalContextSaving}
                    >
                      {personalContextSaving ? "◌" : "Save"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pref-account-card" style={{ marginTop: 10 }}>
                <div className="pref-account-field">
                  <div className="pref-field-label">Icon Color</div>
                  <div className="pref-avatar-preview-row">
                    <div
                      className="pref-avatar-preview"
                      style={avatarColor ? { background: avatarColor } : undefined}
                    >
                      {(userInfo?.full_name ?? userInfo?.email ?? "?")[0].toUpperCase()}
                    </div>
                    <div className="pref-avatar-swatches">
                      <button
                        className={`pref-avatar-swatch pref-avatar-swatch--default${!avatarColor ? " active" : ""}`}
                        onClick={() => setAvatarColor(null)}
                        title="Default"
                      />
                      {[
                        "#cc241d",
                        "#d65d0e",
                        "#b57614",
                        "#98971a",
                        "#689d6a",
                        "#458588",
                        "#3d5a80",
                        "#83a598",
                        "#b16286",
                        "#d3869b",
                        "#665c54",
                      ].map((color) => (
                        <button
                          key={color}
                          className={`pref-avatar-swatch${avatarColor === color ? " active" : ""}`}
                          style={{ background: color }}
                          onClick={() => setAvatarColor(color)}
                          title={color}
                        />
                      ))}
                    </div>
                  </div>
                </div>
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
                  onClick={() => setShowClearAllConfirm(true)}
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
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </div>
                  <div className="pref-item-info">
                    <div className="pref-item-name pref-danger-name">
                      Clear All Chats
                    </div>
                    <div className="pref-item-desc">
                      Delete all chat history permanently
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
                {featureFlags.map((flag) => (
                  <div key={flag.name} className="pref-flag-row">
                    <div className="pref-flag-info">
                      <div className="pref-flag-name">
                        {flag.name
                          .split("_")
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(" ")}
                      </div>
                      <div className="pref-flag-desc">{flag.description}</div>
                    </div>
                    <div className="pref-flag-tiers">
                      {FLAG_TIERS.map(({ field, label, tier }) => {
                        const isOn = flag[field];
                        const isSaving = flagSaving === `${flag.name}:${field}`;
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
                  const newAction = e.target.value;
                  setAuditActionFilter(newAction);
                  setAuditOffset(0);
                  fetchAuditLogs(0, newAction);
                }}
              >
                <option value="all">All actions</option>
                <option value="set_role">Set Role</option>
                <option value="delete_user">Delete User</option>
                <option value="toggle_access">Toggle Access</option>
                <option value="update_feature_flag">Update Feature Flag</option>
                <option value="update_server_config">Update Server Config</option>
              </select>
              <div className="pref-audit-pagination">
                <button
                  className="pref-audit-page-btn"
                  onClick={() => goAuditPage(auditOffset - AUDIT_PAGE_SIZE)}
                  disabled={auditOffset === 0 || auditLoading}
                >
                  Prev
                </button>
                <span className="pref-audit-page-info">
                  {auditTotal === 0
                    ? "0 results"
                    : `${auditOffset + 1}-${Math.min(auditOffset + AUDIT_PAGE_SIZE, auditTotal)} of ${auditTotal}`}
                </span>
                <button
                  className="pref-audit-page-btn"
                  onClick={() => goAuditPage(auditOffset + AUDIT_PAGE_SIZE)}
                  disabled={auditOffset + AUDIT_PAGE_SIZE >= auditTotal || auditLoading}
                >
                  Next
                </button>
              </div>
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

      case "connections": {
        const cfg = serverConfig;
        const draft = serverConfigDraft;
        const val = (key: keyof typeof draft) =>
          key in draft ? (draft[key] as string) ?? "" : (cfg?.[key as keyof ServerConfig] as string) ?? "";
        const set = (key: keyof typeof draft, v: string) =>
          setServerConfigDraft((prev) => ({ ...prev, [key]: v }));
        const isDirty = Object.keys(draft).length > 0;

        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">Connections</span>
              <button
                className="pref-refresh-btn"
                onClick={loadServerConfig}
                disabled={serverConfigLoading}
                title="Refresh"
              >↻</button>
            </div>

            {serverConfigError && <div className="pref-admin-error">{serverConfigError}</div>}
            {serverConfigSuccess && <div className="pref-admin-success">{serverConfigSuccess}</div>}

            {serverConfigLoading ? (
              <div className="pref-users-empty">Loading…</div>
            ) : (
              <div className="pref-settings-area">

                <div className="pref-setting-section-label">Ollama</div>
                <div className="pref-conn-field">
                  <label className="pref-conn-label">Base URL</label>
                  <div className="pref-conn-input-wrap">
                    <input
                      className="pref-conn-input pref-conn-input--inrow"
                      type={showOllamaUrl ? "text" : "password"}
                      placeholder="http://localhost:11434"
                      value={val("ollama_url")}
                      onChange={(e) => set("ollama_url", e.target.value)}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="pref-conn-reveal-btn"
                      onClick={() => setShowOllamaUrl((v) => !v)}
                      title={showOllamaUrl ? "Hide URL" : "Show URL"}
                    >
                      {showOllamaUrl ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="pref-setting-divider" />
                <div className="pref-setting-section-label">Installed Models</div>
                <div className="pref-conn-model-list">
                  {models.length === 0 ? (
                    <div className="pref-conn-model-empty">No models available</div>
                  ) : (
                    models.map((m) => {
                      const [name, tag] = m.split(":");
                      const caps = modelCapabilities[m] ?? [];
                      return (
                        <div key={m} className="pref-conn-model-row">
                          <div className="pref-conn-model-name">
                            {name}
                            {tag && <span className="pref-conn-model-tag">{tag}</span>}
                          </div>
                          <div className="pref-conn-model-caps">
                            {caps.includes("thinking") && (
                              <span className="pref-model-badge pref-model-badge--thinking">Thinking</span>
                            )}
                            {caps.includes("web") && (
                              <span className="pref-model-badge pref-model-badge--web">Web</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="pref-setting-divider" />
                <div className="pref-setting-section-label">Model Defaults</div>

                <div className="pref-conn-field">
                  <label className="pref-conn-label">Default Model</label>
                  <input
                    className="pref-conn-input"
                    type="text"
                    placeholder="llama3.1:8b"
                    value={val("default_model")}
                    onChange={(e) => set("default_model", e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="pref-conn-field">
                  <label className="pref-conn-label">Vision Model</label>
                  <input
                    className="pref-conn-input"
                    type="text"
                    placeholder="gemma3:4b-it-qat"
                    value={val("vision_model")}
                    onChange={(e) => set("vision_model", e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="pref-conn-field">
                  <label className="pref-conn-label">Embed Model</label>
                  <input
                    className="pref-conn-input"
                    type="text"
                    placeholder="nomic-embed-text"
                    value={val("embed_model")}
                    onChange={(e) => set("embed_model", e.target.value)}
                    spellCheck={false}
                  />
                </div>

                <div className="pref-setting-divider" />
                <div className="pref-setting-section-label">Model Lists <span className="pref-conn-hint">(comma-separated)</span></div>

                <div className="pref-conn-field">
                  <label className="pref-conn-label">Thinking Models</label>
                  <input
                    className="pref-conn-input"
                    type="text"
                    placeholder="deepseek-r1"
                    value={val("thinking_models")}
                    onChange={(e) => set("thinking_models", e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="pref-conn-field">
                  <label className="pref-conn-label">Tool-Capable Models</label>
                  <input
                    className="pref-conn-input"
                    type="text"
                    placeholder="llama3.1,qwen2.5,phi4"
                    value={val("tool_capable_models")}
                    onChange={(e) => set("tool_capable_models", e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="pref-conn-field">
                  <label className="pref-conn-label">No System Prompt Models</label>
                  <input
                    className="pref-conn-input"
                    type="text"
                    placeholder="dolphin"
                    value={val("no_system_prompt_models")}
                    onChange={(e) => set("no_system_prompt_models", e.target.value)}
                    spellCheck={false}
                  />
                </div>


                <div className="pref-conn-actions">
                  <button
                    className="pref-conn-save-btn"
                    disabled={!isDirty || serverConfigSaving}
                    onClick={handleServerConfigSave}
                  >
                    {serverConfigSaving ? "Saving…" : "Apply Changes"}
                  </button>
                  {isDirty && (
                    <button
                      className="pref-conn-cancel-btn"
                      onClick={() => setServerConfigDraft({})}
                    >
                      Reset
                    </button>
                  )}
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

      {showClearAllConfirm && (
        <div
          className="pref-delete-overlay"
          onClick={() => setShowClearAllConfirm(false)}
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
            <div className="pref-delete-dialog-title">Clear All Chats</div>
            <div className="pref-delete-dialog-text">
              This will permanently delete all your chat history. This action
              cannot be undone.
            </div>
            <div className="pref-delete-dialog-divider" />
            <div className="pref-delete-dialog-actions">
              <button
                className="pref-confirm-no"
                onClick={() => setShowClearAllConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="pref-confirm-yes"
                onClick={handleClearAllChats}
                disabled={clearingAll}
              >
                {clearingAll ? "Clearing…" : "Clear All"}
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
              values: { guest: "5", free: "10", pro: "30" },
            },
            {
              label: "Daily limit",
              values: { guest: "50", free: "—", pro: "—" },
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
