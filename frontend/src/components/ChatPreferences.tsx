import React, { useState, useEffect, useRef } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { sounds, SOUND_GROUPS, type SoundGroup } from "../sounds";
import { background, backgroundsFor } from "../background";
import { uiScale, UI_SCALES } from "../uiScale";
import { panels, PANELS } from "../panels";
import { tempUnit } from "../tempUnit";
import { openFestiveThemes, type Theme } from "../festive";
import logoUrl from "../assets/ModelLoop.png";
import {
  automaticVoice,
  betterVoicesTip,
  isNoveltyVoice,
  speakWithVoice,
  useVoiceChoice,
  voiceLabel,
  voiceQuality,
  voiceRegion,
} from "./speechVoice";
import {
  apiGetMe,
  apiUpdateEmail,
  apiUpdateProfile,
  apiSavePersonalContext,
  apiSetOllamaUrl,
  apiOllamaStatus,
  apiTestOllamaUrl,
} from "./api";
import type { OllamaStatus } from "./api";
import { readableTextOn } from "./utils/chatUtils";
import { PRESETS } from "./presets";
import { language, useLanguage, useT } from "../i18n";

export type { Theme };
export type Font = "inter" | "rounded";

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
  speechRate: number;
  setSpeechRate: (rate: number) => void;
  models: string[];
  modelCapabilities: Record<string, string[]>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  /** The games' model; empty means the server's default */
  gameModel: string;
  setGameModel: (model: string) => void;
  /** The server's default for games (GAME_MODEL), to name in the picker */
  serverGameModel?: string;
  /** The web studio's model; empty means Auto */
  studioModel: string;
  /** Whether the web studio is on (the server's web_studio feature) */
  webStudio?: boolean;
  setStudioModel: (model: string) => void;
  onDeleteAccount: () => Promise<void>;
  onClearAllChats: () => Promise<void>;
  onNameChange?: (name: string | null) => void;
  onLogout?: () => void;
  initialSection?: Section;
}

// Plain-language explanations for the Generation sliders, shown by the (i) toggles.
const GENERATION_INFO: Record<string, { title: string; body: string }> = {
  temperature: {
    title: "Temperature",
    body: "Controls how random the model's word choices are. Low values (0.0 to 0.3) keep replies focused and repeatable, so the same question returns nearly the same answer every time. High values (1.2 and above) make replies more varied and creative, but also more likely to wander off topic or invent details. 0.7 is a balanced default.",
  },
  topP: {
    title: "Top P",
    body: "Also called nucleus sampling. Before choosing each word, the model ranks every candidate by probability and keeps only the smallest group whose combined probability reaches this value. At 0.9 it considers the most likely 90 percent and discards the long tail. Lowering it restricts the model to safe, predictable words; raising it toward 1.0 lets rare words back in, adding variety and risk. It works alongside Temperature: Temperature reshapes the odds, Top P trims the shortlist.",
  },
  numPredict: {
    title: "Max Tokens",
    body: "A hard cap on the length of a single reply. One token is roughly three quarters of a word. Left unlimited, the model stops when it judges the answer complete. Set a number and the reply is cut off once it reaches that many tokens, even mid sentence, which is useful for keeping answers short or bounding how long a response can take.",
  },
  voice: {
    title: "Voice",
    body: "The voice Olly speaks with in voice mode, and when a reply is read aloud with Listen or in focused mode. The list is the voices your browser offers for your language, which depend on your device. Premium and Enhanced voices sound the most natural. Automatic picks the best one it can find.",
  },
  speechRate: {
    title: "Voice Speed",
    body: "Playback rate for spoken replies in voice mode. 1.0 is the speech engine's natural pace, 0.5 plays at half speed, and 2.0 at double. This only affects how a reply is read aloud. It does not change the wording the model generates.",
  },
};

export type Section =
  | "model"
  | "presets"
  | "temperature"
  | "appearance"
  | "shortcuts"
  | "account"
  | "advanced"
  | "about";

// The sections, in groups. Wider screens list them straight down the sidebar; phones show each
// group as a card of rows, like a phone's own Settings.
const NAV_GROUPS: { id: Section; label: string }[][] = [
  [
    { id: "model", label: "Model" },
    { id: "presets", label: "Presets" },
    { id: "temperature", label: "Generation" },
  ],
  [
    { id: "appearance", label: "Appearance" },
    { id: "shortcuts", label: "Shortcuts" },
  ],
  [
    { id: "account", label: "Account" },
    { id: "advanced", label: "Advanced" },
    { id: "about", label: "About" },
  ],
];

const sectionLabel = (id: Section) =>
  NAV_GROUPS.flat().find((n) => n.id === id)?.label ?? "";

// Each section's icon on phones, drawn in a 24-unit box with round 2-unit strokes
const NAV_ICONS: Record<Section, React.ReactNode> = {
  model: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3" />
    </>
  ),
  presets: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  temperature: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  appearance: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </>
  ),
  shortcuts: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  advanced: <path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5" />,
  about: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.75h.01" />
    </>
  ),
};

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
  speechRate,
  setSpeechRate,
  models,
  modelCapabilities,
  selectedModel,
  setSelectedModel,
  gameModel,
  setGameModel,
  serverGameModel,
  studioModel,
  setStudioModel,
  webStudio = false,
  onDeleteAccount,
  onClearAllChats,
  onNameChange,
  onLogout,
  initialSection,
}) => {
  useEscapeKey(onClose);
  const t = useT();
  const lang = useLanguage();
  const [soundOn, setSoundOn] = useState(() => sounds.isEnabled());
  const [soundVolume, setSoundVolume] = useState(() => sounds.getVolume());
  const [soundGroups, setSoundGroups] = useState(() =>
    Object.fromEntries(SOUND_GROUPS.map((g) => [g.id, sounds.isGroupOn(g.id)])) as Record<SoundGroup, boolean>,
  );
  const [bg, setBg] = useState(() => background.get());
  const [scale, setScale] = useState(() => uiScale.get());
  const [unit, setUnit] = useState(() => tempUnit.get());
  const [panelsId, setPanelsId] = useState(() => panels.get());
  const voiceChoice = useVoiceChoice();
  // The voice being previewed: a voiceURI, "auto" for the automatic row, or null
  const [previewing, setPreviewing] = useState<string | null>(null);
  // The list shows its first few voices (the best ones, as it's sorted) until asked for all,
  // so it never needs a scroll area of its own. The picked voice is always shown.
  const [showAllVoices, setShowAllVoices] = useState(false);
  const autoVoice = voiceChoice.voices.length > 0 ? automaticVoice() : null;
  const VOICES_SHOWN = 5;
  const listedVoices = showAllVoices
    ? voiceChoice.voices
    : voiceChoice.voices.filter(
        (v, i) => (i < VOICES_SHOWN && !isNoveltyVoice(v)) || v.voiceURI === voiceChoice.choice,
      );
  const hiddenVoices = voiceChoice.voices.length - listedVoices.length;
  const hasBestVoice = voiceChoice.voices.some((v) => voiceQuality(v) !== null);
  const voiceTip = hasBestVoice ? null : betterVoicesTip();

  const previewVoice = (key: string, voice: SpeechSynthesisVoice | null) => {
    if (previewing === key) {
      window.speechSynthesis.cancel();
      setPreviewing(null);
      return;
    }
    setPreviewing(key);
    speakWithVoice(t("Hi, I'm Olly. This is how I'll sound when I talk with you."), voice, {
      rate: speechRate,
      onEnd: () => setPreviewing((p) => (p === key ? null : p)),
    });
  };
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(
    initialSection ?? "model",
  );
  // Phones show one pane at a time: the list of sections, or the open section. Opening straight to
  // a section (from elsewhere in the app) skips the list. "back" is the list, slid in from the left.
  const [phonePane, setPhonePane] = useState<"list" | "back" | "section">(
    initialSection ? "section" : "list",
  );
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; pulling: boolean | null } | null>(
    null,
  );

  // Pull the sheet down by its handle or top bar to close it (phones only; both are hidden on
  // wider screens).
  const isSheet = () => window.matchMedia("(max-width: 640px)").matches;
  const sheetDrag = {
    onTouchStart: (e: React.TouchEvent) => {
      if (!isSheet()) return;
      const t = e.touches[0];
      drag.current = { x: t.clientX, y: t.clientY, pulling: null };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const d = drag.current;
      const sheet = sheetRef.current;
      if (!d || !sheet) return;
      const dx = e.touches[0].clientX - d.x;
      const dy = e.touches[0].clientY - d.y;
      // Decide once whether this is a pull down or a sideways swipe.
      if (d.pulling === null && Math.hypot(dx, dy) > 8)
        d.pulling = dy > Math.abs(dx);
      if (d.pulling) {
        sheet.style.transition = "none";
        sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
      }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const d = drag.current;
      const sheet = sheetRef.current;
      drag.current = null;
      if (!d?.pulling || !sheet) return;
      const dy = e.changedTouches[0].clientY - d.y;
      sheet.style.transition = "transform 0.22s cubic-bezier(0.3, 0.7, 0.3, 1)";
      if (dy > 90) {
        sheet.style.transform = "translateY(100%)";
        setTimeout(onClose, 180);
      } else {
        sheet.style.transform = "";
      }
    },
  };
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaSaving, setOllamaSaving] = useState(false);
  const [ollamaTesting, setOllamaTesting] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [ollamaSaved, setOllamaSaved] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [ollamaStatusLoading, setOllamaStatusLoading] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [presetSearch, setPresetSearch] = useState("");
  const [userInfo, setUserInfo] = useState<{
    id: string;
    username: string;
    email: string | null;
    full_name: string | null;
  } | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [emailEdit, setEmailEdit] = useState<string | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [personalContext, setPersonalContext] = useState<string>("");
  const [personalContextSaving, setPersonalContextSaving] = useState(false);
  useEffect(() => {
    apiGetMe()
      .then((info) => {
        setUserInfo(info);
        setPersonalContext(info.personal_context ?? "");
        setOllamaUrl(info.ollama_url ?? "");
      })
      .catch(() => {});
  }, []);

  const loadOllamaStatus = () => {
    setOllamaStatusLoading(true);
    setOllamaStatus(null);
    apiOllamaStatus()
      .then(setOllamaStatus)
      .catch(() => setOllamaStatus(null))
      .finally(() => setOllamaStatusLoading(false));
  };

  useEffect(() => {
    if (activeSection === "advanced") loadOllamaStatus();
  }, [activeSection]);

  const handleTestOllama = async () => {
    const candidate = ollamaUrl.trim();
    if (!candidate) return;
    setOllamaTesting(true);
    setOllamaError(null);
    setOllamaSaved(null);
    try {
      setOllamaStatus(await apiTestOllamaUrl(candidate));
    } catch (e: any) {
      setOllamaError(e.message || t("That test didn't work."));
      setOllamaStatus(null);
    } finally {
      setOllamaTesting(false);
    }
  };

  const handleSaveOllama = async () => {
    setOllamaSaving(true);
    setOllamaError(null);
    setOllamaSaved(null);
    try {
      const saved = await apiSetOllamaUrl(ollamaUrl.trim() || null);
      setOllamaUrl(saved.ollama_url ?? "");
      setOllamaSaved(
        saved.ollama_url
          ? t("Saved. New chats will use your server.")
          : t("Cleared. You are back on the shared test server."),
      );
      loadOllamaStatus();
    } catch (e: any) {
      setOllamaError(e.message || t("I couldn't save that."));
    } finally {
      setOllamaSaving(false);
    }
  };

  // (i) toggle beside a Generation label, plus the panel it reveals
  const infoButton = (id: string) => {
    const question = t("What does {setting} do?", { setting: t(GENERATION_INFO[id].title) });
    return (
      <button
        type="button"
        className={`pref-info-btn${openInfo === id ? " active" : ""}`}
        aria-expanded={openInfo === id}
        aria-label={question}
        title={question}
        onClick={() => setOpenInfo((prev) => (prev === id ? null : id))}
      >
        <svg
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="12" y1="11" x2="12" y2="18.5" />
          <line x1="12" y1="5.5" x2="12" y2="5.5" />
        </svg>
      </button>
    );
  };

  const infoPanel = (id: string) =>
    openInfo === id ? (
      <div className="pref-info-panel">{t(GENERATION_INFO[id].body)}</div>
    ) : null;

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
      await apiUpdateProfile(trimmed || (userInfo?.username ?? ""));
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

  // Saving it blank removes the email
  const handleSaveEmail = async () => {
    if (emailEdit === null) return;
    setEmailSaving(true);
    setEmailError(null);
    try {
      const saved = await apiUpdateEmail(emailEdit.trim() || null);
      setUserInfo((prev) => (prev ? { ...prev, email: saved } : prev));
      setEmailEdit(null);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : t("I couldn't save that email."));
    } finally {
      setEmailSaving(false);
    }
  };

  const cancelEmailEdit = () => {
    setEmailEdit(null);
    setEmailError(null);
  };

  const handlePresetClick = (label: string, prompt: string) => {
    setActivePreset(label);
    setSystemPrompt(prompt);
  };

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(modelSearch.toLowerCase()),
  );
  const filteredPresets = PRESETS.filter((p) =>
    t(p.label).toLowerCase().includes(presetSearch.toLowerCase()),
  );

  const tempLabel =
    temperature <= 0.4
      ? t("Focused - precise, deterministic responses")
      : temperature === 0.7
        ? t("Balanced - reliable with some creativity (Default)")
        : temperature <= 0.9
          ? t("Balanced - reliable with some creativity")
          : temperature <= 1.4
            ? t("Creative - more varied and expressive")
            : t("Wild - highly unpredictable outputs");

  // The current value beside each row in the phone list, where there's a short one to show
  const navHint = (id: Section): string => {
    switch (id) {
      case "model":
        return (selectedModel.split(":")[0] ?? "").split("/").pop() ?? "";
      case "presets":
        return t(activePreset);
      case "temperature":
        return t("Temp {n}", { n: temperature.toFixed(1) });
      case "appearance":
        return theme.charAt(0).toUpperCase() + theme.slice(1);
      default:
        return "";
    }
  };

  const renderSection = () => {
    switch (activeSection) {
      case "model":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">{t("Model")}</span>
              {models.length > 0 && (
                <span className="pref-content-badge">{models.length}</span>
              )}
            </div>
            <div className="pref-search-bar">
              <input
                className="pref-search-input"
                type="text"
                placeholder={t("Search Models")}
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </div>
            <div className="pref-list">
              {filteredModels.length === 0 ? (
                <div className="pref-empty">
                  {models.length === 0 ? t("Loading models…") : t("No models match")}
                </div>
              ) : (
                filteredModels.map((m) => {
                  const isActive = m === selectedModel;
                  const [name, tag] = m.split(":");
                  const caps = modelCapabilities[m] ?? [];
                  // The model the games play with: your pick in Advanced, or the server's default
                  const gamesModel = gameModel && models.includes(gameModel) ? gameModel : serverGameModel;
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
                        <div className="pref-item-name pref-model-name">
                          <span className="pref-model-name-text">{name}</span>
                          {caps.includes("web") && (
                            <span className="pref-model-badge pref-model-badge--web">
                              Web
                            </span>
                          )}
                          {caps.includes("thinking") && (
                            <span className="pref-model-badge pref-model-badge--thinking">
                              {t("Thinking")}
                            </span>
                          )}
                          {caps.includes("vision") && (
                            <span className="pref-model-badge pref-model-badge--vision" title={t("Can read images")}>
                              {t("Images")}
                            </span>
                          )}
                          {m === gamesModel && (
                            <span className="pref-model-badge pref-model-badge--games" title={t("The games play with this model")}>
                              {t("Games")}
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
              <span className="pref-content-title">{t("Presets")}</span>
              <span className="pref-content-badge">{PRESETS.length}</span>
            </div>
            <div className="pref-search-bar">
              <input
                className="pref-search-input"
                type="text"
                placeholder={t("Search Presets")}
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
                    <div className="pref-item-icon">{t(label)[0]}</div>
                    <div className="pref-item-info">
                      <div className="pref-item-name">{t(label)}</div>
                      <div className="pref-item-desc">{t(description)}</div>
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
                <label>{t("Custom System Prompt")}</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t("You are a helpful assistant and …")}
                />
              </div>
            )}
          </>
        );

      case "temperature":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">{t("Generation")}</span>
            </div>
            <div className="pref-settings-area">
              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    {t("Temperature")}
                    {infoButton("temperature")}
                  </div>
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
              {infoPanel("temperature")}

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    Top P{infoButton("topP")}
                  </div>
                  <div className="pref-setting-hint">
                    {topP <= 0.5
                      ? t("Narrow - only high-probability tokens")
                      : topP <= 0.85
                        ? t("Balanced - moderate token diversity")
                        : topP === 0.9
                          ? t("Balanced - moderate token diversity (Default)")
                          : t("Broad - considers a wide range of tokens")}
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
              {infoPanel("topP")}

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    {t("Max Tokens")}
                    {infoButton("numPredict")}
                  </div>
                  <div className="pref-setting-hint">
                    {numPredict === -1
                      ? t("Unlimited - model decides when to stop (Default)")
                      : numPredict <= 512
                        ? t("Short - brief responses only")
                        : numPredict <= 2048
                          ? t("Medium - suitable for most tasks")
                          : t("Long - extended responses and analysis")}
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
              {infoPanel("numPredict")}

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    {t("Voice")}
                    {infoButton("voice")}
                  </div>
                  <div className="pref-setting-hint">
                    {t("Used for voice mode and reading replies aloud")}
                  </div>
                </div>
              </div>
              {infoPanel("voice")}
              <div className="pref-voice-list" role="radiogroup" aria-label={t("Voice")}>
                {[null, ...listedVoices].map((v) => {
                  const key = v ? v.voiceURI : "auto";
                  const isActive = (v ? v.voiceURI : "") === voiceChoice.choice;
                  const quality = v ? voiceQuality(v) : null;
                  const playing = previewing === key;
                  return (
                    <div
                      key={key}
                      className={`pref-list-item${isActive ? " active" : ""}`}
                      role="radio"
                      aria-checked={isActive}
                      tabIndex={0}
                      onClick={() => voiceChoice.setChoice(v ? v.voiceURI : "")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          voiceChoice.setChoice(v ? v.voiceURI : "");
                        }
                      }}
                    >
                      {/* The round icon is the preview button: tap it to hear the voice */}
                      <span
                        className={`pref-item-icon pref-voice-play${playing ? " is-playing" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-label={playing ? t("Stop preview") : t("Preview {voice}", { voice: v ? voiceLabel(v) : t("the automatic voice") })}
                        title={playing ? t("Stop") : t("Preview")}
                        onClick={(e) => {
                          e.stopPropagation();
                          previewVoice(key, v ?? autoVoice);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            previewVoice(key, v ?? autoVoice);
                          }
                        }}
                      >
                        {playing ? (
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
                            <rect x="5" y="5" width="14" height="14" rx="2.5" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
                          </svg>
                        )}
                      </span>
                      <div className="pref-item-info">
                        <div className="pref-item-name">
                          {v ? voiceLabel(v) : t("Automatic")}
                          {quality === "premium" && (
                            <span className="pref-model-badge pref-model-badge--thinking">{t("Premium")}</span>
                          )}
                          {quality === "enhanced" && (
                            <span className="pref-model-badge pref-model-badge--web">{t("Enhanced")}</span>
                          )}
                          {quality === "natural" && (
                            <span className="pref-model-badge pref-model-badge--games">{t("Natural")}</span>
                          )}
                        </div>
                        <div className="pref-item-desc">
                          {v
                            ? `${voiceRegion(v)}${v.localService ? "" : ` · ${t("Online")}`}`
                            : autoVoice
                              ? t("The best voice on this device, now {voice}", { voice: voiceLabel(autoVoice) })
                              : t("The best voice on this device")}
                        </div>
                      </div>
                      <div className={`pref-item-check${isActive ? " checked" : ""}`}>
                        {isActive && <span className="pref-check-mark">✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {(hiddenVoices > 0 || showAllVoices || voiceTip || voiceChoice.missing) && (
                <div className="pref-voice-foot">
                  {voiceChoice.missing && (
                    <span>{t("The voice you picked isn't on this device, so the automatic one is used here.")}</span>
                  )}
                  {voiceTip && <span>{t(voiceTip)}</span>}
                  {(hiddenVoices > 0 || showAllVoices) && (
                    <button
                      type="button"
                      className="pref-voice-more"
                      onClick={() => setShowAllVoices((v) => !v)}
                    >
                      {showAllVoices ? t("Show fewer") : t("Show all {n} voices", { n: voiceChoice.voices.length })}
                    </button>
                  )}
                </div>
              )}


              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    {t("Voice Speed")}
                    {infoButton("speechRate")}
                  </div>
                  <div className="pref-setting-hint">
                    {speechRate <= 0.7
                      ? t("Slow — easier to follow")
                      : speechRate <= 1.1
                        ? speechRate === 1.0
                          ? t("Normal — natural pace (Default)")
                          : t("Normal — natural pace")
                        : speechRate <= 1.5
                          ? t("Fast — quicker delivery")
                          : t("Very fast — for rapid listening")}
                  </div>
                </div>
                <span className="pref-temp-value">
                  {speechRate.toFixed(1)}×
                </span>
              </div>
              <input
                className="temperature-slider pref-slider"
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={speechRate}
                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
              />
              <div className="temperature-labels">
                <span>0.5×</span>
                <span>1.0×</span>
                <span>2.0×</span>
              </div>
              {infoPanel("speechRate")}
              <button
                className="pref-generation-reset-btn"
                onClick={() => {
                  setTemperature(0.7);
                  setTopP(0.9);
                  setNumPredict(-1);
                  setSpeechRate(1.0);
                  voiceChoice.setChoice("");
                }}
                title={t("Reset to defaults")}
              >
                {t("Reset to defaults")}
              </button>
            </div>
          </>
        );

      case "appearance":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">{t("Appearance")}</span>
            </div>
            <div className="pref-settings-area">
              {/* Each language named in itself, so it can be found by someone who reads only that one */}
              <div className="pref-setting-section-label">{t("Language")}</div>
              <div className="pref-font-cards" style={{ marginBottom: "20px" }}>
                {(
                  [
                    { id: "en", name: "English", preview: "Hi" },
                    { id: "es", name: "Español", preview: "Hola" },
                  ] as const
                ).map((l) => (
                  <div
                    key={l.id}
                    lang={l.id}
                    className={`pref-font-card${lang === l.id ? " active" : ""}`}
                    onClick={() => {
                      language.set(l.id);
                    }}
                  >
                    <span className="pref-font-preview">{l.preview}</span>
                    <span className="pref-font-label">{l.name}</span>
                  </div>
                ))}
              </div>
              <div className="pref-setting-section-label">{t("Theme")}</div>
              <div className="pref-theme-cards">
                <div
                  className={`pref-theme-card${theme === "meadow" ? " active" : ""}`}
                  onClick={() => setTheme("meadow")}
                >
                  <div className="pref-theme-preview pref-theme-preview-meadow">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Meadow</span>
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
                <div
                  className={`pref-theme-card${theme === "ember" ? " active" : ""}`}
                  onClick={() => setTheme("ember")}
                >
                  <div className="pref-theme-preview pref-theme-preview-ember">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Ember</span>
                </div>
                <div
                  className={`pref-theme-card${theme === "frost" ? " active" : ""}`}
                  onClick={() => setTheme("frost")}
                >
                  <div className="pref-theme-preview pref-theme-preview-frost">
                    <span className="ptc-bar ptc-bar-1" />
                    <span className="ptc-bar ptc-bar-2" />
                    <span className="ptc-bar ptc-bar-3" />
                  </div>
                  <span className="pref-theme-label">Frost</span>
                </div>
                {/* Festive themes, each only offered in its season (see festive.ts) */}
                {openFestiveThemes().map((f) => (
                  <div
                    key={f.id}
                    className={`pref-theme-card${theme === f.id ? " active" : ""}`}
                    onClick={() => setTheme(f.id)}
                  >
                    <div className={`pref-theme-preview pref-theme-preview-${f.id}`}>
                      <span className="ptc-bar ptc-bar-1" />
                      <span className="ptc-bar ptc-bar-2" />
                      <span className="ptc-bar ptc-bar-3" />
                    </div>
                    <span className="pref-theme-label">{t(f.label)}</span>
                  </div>
                ))}
              </div>
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                {t("Font")}
              </div>
              <div className="pref-font-cards">
                <div
                  className={`pref-font-card${font === "rounded" ? " active" : ""}`}
                  onClick={() => setFont("rounded")}
                >
                  <span className="pref-font-preview pref-font-preview-rounded">
                    Aa
                  </span>
                  <span className="pref-font-label">Nunito</span>
                </div>
                <div
                  className={`pref-font-card${font === "inter" ? " active" : ""}`}
                  onClick={() => setFont("inter")}
                >
                  <span className="pref-font-preview pref-font-preview-inter">
                    Aa
                  </span>
                  <span className="pref-font-label">Inter</span>
                </div>
              </div>
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                {t("Background")}
              </div>
              {/* Each preview is the picture under the current theme's wash, as it will look. A saved
                  choice this theme doesn't offer (Earthset in a light theme) shows as Plain, which
                  is what's on the page; it comes back with a theme that has it. */}
              <div className="pref-theme-cards pref-bg-cards">
                {backgroundsFor(theme).map((b, _i, offered) => (
                  <div
                    key={b.id}
                    className={`pref-theme-card${
                      (offered.some((o) => o.id === bg) ? bg : "plain") === b.id ? " active" : ""
                    }`}
                    onClick={() => {
                      background.set(b.id);
                      setBg(b.id);
                    }}
                  >
                    <div className={`pref-bg-preview pref-bg-preview-${b.id}`} />
                    <span className="pref-theme-label">{t(b.label)}</span>
                    {b.credit && <span className="pref-bg-credit">{t(b.credit)}</span>}
                  </div>
                ))}
              </div>
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                {t("Panels")}
              </div>
              {/* How much shows through the windows (this one included) and the sidebar. Each preview is a
                  sample window at that level over a still scene in the theme's colours. */}
              <div className="pref-theme-cards pref-bg-cards">
                {PANELS.map((p) => (
                  <div
                    key={p.id}
                    className={`pref-theme-card${panelsId === p.id ? " active" : ""}`}
                    onClick={() => {
                      panels.set(p.id);
                      setPanelsId(p.id);
                    }}
                  >
                    <div
                      className={`pref-panels-preview frosting-scope${p.id === "opaque" ? " panels-opaque" : ""}`}
                      style={{ "--frosting": p.frosting } as React.CSSProperties}
                    >
                      <div className="pref-panels-sample" />
                    </div>
                    <span className="pref-theme-label">{t(p.label)}</span>
                  </div>
                ))}
              </div>
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                {t("Sound")}
              </div>
              <div className="pref-sound-row">
                <span className="pref-sound-desc">
                  {t("Soft, calm tones as you use ModelLoop. Pick which kinds below.")}
                </span>
                <button
                  type="button"
                  className={`pref-switch${soundOn ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={soundOn}
                  aria-label={t("Sound effects")}
                  onClick={() => {
                    const next = !soundOn;
                    sounds.setEnabled(next);
                    setSoundOn(next);
                    if (next) sounds.play("done");
                  }}
                >
                  <span className="pref-switch-knob" aria-hidden="true" />
                </button>
              </div>
              {soundOn && (
                <div className="pref-volume">
                  {/* Each step plays the menu tick (see the range handler in main.tsx),
                      so the new level is heard as it is set. */}
                  <input
                    type="range"
                    className="temperature-slider pref-slider"
                    aria-label={t("Sound volume")}
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(soundVolume * 100)}
                    onChange={(e) => {
                      const next = Number(e.target.value) / 100;
                      sounds.setVolume(next);
                      setSoundVolume(next);
                    }}
                  />
                  <div className="temperature-labels">
                    <span>{t("Quiet")}</span>
                    <span>{Math.round(soundVolume * 100)}%</span>
                    <span>{t("Loud")}</span>
                  </div>
                </div>
              )}
              {soundOn && (
                <div className="pref-sound-groups">
                  {SOUND_GROUPS.map((g) => (
                    <div key={g.id} className="pref-sound-row">
                      <span className="pref-sound-text">
                        <span className="pref-sound-name">{t(g.label)}</span>
                        <span className="pref-sound-desc">{t(g.desc)}</span>
                      </span>
                      <button
                        type="button"
                        className={`pref-switch${soundGroups[g.id] ? " is-on" : ""}`}
                        role="switch"
                        aria-checked={soundGroups[g.id]}
                        aria-label={t("{group} sounds", { group: t(g.label) })}
                        onClick={() => {
                          const next = !soundGroups[g.id];
                          sounds.setGroupOn(g.id, next);
                          setSoundGroups((prev) => ({ ...prev, [g.id]: next }));
                        }}
                      >
                        <span className="pref-switch-knob" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                {t("UI scale")}
              </div>
              <input
                type="range"
                className="temperature-slider pref-slider"
                min={0}
                max={UI_SCALES.length - 1}
                step={1}
                value={UI_SCALES.indexOf(scale)}
                onChange={(e) => {
                  const next = UI_SCALES[Number(e.target.value)];
                  setScale(next);
                  uiScale.set(next);
                }}
              />
              <div className="temperature-labels">
                <span>{t("Smaller")}</span>
                <span>{Math.round(scale * 100)}%</span>
                <span>{t("Larger")}</span>
              </div>
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                {t("Temperature")}
              </div>
              <div className="pref-font-cards">
                {(
                  [
                    { id: "F", label: "Fahrenheit" },
                    { id: "C", label: "Celsius" },
                  ] as const
                ).map((u) => (
                  <div
                    key={u.id}
                    className={`pref-font-card${unit === u.id ? " active" : ""}`}
                    onClick={() => {
                      tempUnit.set(u.id);
                      setUnit(u.id);
                    }}
                  >
                    <span className="pref-font-preview pref-unit-preview">°{u.id}</span>
                    <span className="pref-font-label">{t(u.label)}</span>
                  </div>
                ))}
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
              <span className="pref-content-title">{t("Shortcuts")}</span>
            </div>
            <div className="pref-settings-area">
              {groups.map((group) => (
                <div key={group.label} className="pref-shortcut-group">
                  <div className="pref-setting-section-label">
                    {t(group.label)}
                  </div>
                  <div className="pref-shortcut-list">
                    {group.rows.map((row) => (
                      <div key={row.desc} className="pref-shortcut-row">
                        <span className="pref-shortcut-desc">{t(row.desc)}</span>
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
              <span className="pref-content-title">{t("Account")}</span>
            </div>
            <div className="pref-account-scroll">
              <div className="pref-account-card">
                {userInfo && (
                  <div className="pref-account-field">
                    <div className="pref-field-label">{t("Username")}</div>
                    <div className="pref-field-row">
                      <span className="pref-account-email">
                        {userInfo.username}
                      </span>
                    </div>
                  </div>
                )}
                {userInfo && (
                  <div className="pref-account-field pref-account-field-sep">
                    <div className="pref-field-label">{t("Email")}</div>
                    <div className="pref-field-desc">
                      {t("Optional. You can sign in with it instead of your username.")}
                    </div>
                    <div className="pref-name-row">
                      {emailEdit !== null ? (
                        <>
                          <input
                            className="pref-name-input"
                            type="email"
                            value={emailEdit}
                            maxLength={254}
                            placeholder="you@example.com"
                            onChange={(e) => setEmailEdit(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEmail();
                              if (e.key === "Escape") cancelEmailEdit();
                            }}
                            autoFocus
                            autoComplete="email"
                            disabled={emailSaving}
                          />
                          <button
                            className="pref-name-save-btn"
                            onClick={handleSaveEmail}
                            disabled={emailSaving}
                          >
                            {emailSaving ? <span className="btn-spinner" /> : t("Save")}
                          </button>
                          <button
                            className="pref-name-cancel-btn"
                            onClick={cancelEmailEdit}
                            disabled={emailSaving}
                          >
                            {t("Cancel")}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="pref-name-value">
                            {userInfo.email ?? (
                              <span className="pref-name-placeholder">{t("None added")}</span>
                            )}
                          </span>
                          <button
                            className="pref-name-edit-btn"
                            onClick={() => setEmailEdit(userInfo.email ?? "")}
                          >
                            {userInfo.email ? t("Edit") : t("Add")}
                          </button>
                        </>
                      )}
                    </div>
                    {emailError && (
                      <div className="pref-ollama-msg pref-ollama-msg--error">
                        {emailError}
                      </div>
                    )}
                  </div>
                )}
                <div className="pref-account-field pref-account-field-sep">
                  <div className="pref-field-label">{t("Full name")}</div>
                  <div className="pref-name-row">
                    {nameEdit !== null ? (
                      <>
                        <input
                          className="pref-name-input"
                          value={nameEdit}
                          maxLength={120}
                          placeholder={userInfo?.username ?? ""}
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
                          {nameSaving ? (
                            <span className="btn-spinner" />
                          ) : (
                            "Save"
                          )}
                        </button>
                        <button
                          className="pref-name-cancel-btn"
                          onClick={() => setNameEdit(null)}
                          disabled={nameSaving}
                        >
                          {t("Cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="pref-name-value">
                          {userInfo?.full_name ?? (
                            <span className="pref-name-placeholder">
                              {userInfo?.username}
                            </span>
                          )}
                        </span>
                        <button
                          className="pref-name-edit-btn"
                          onClick={() => setNameEdit(userInfo?.full_name ?? "")}
                        >
                          {t("Edit")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Personal context")}</div>
                  <div className="pref-field-desc">
                    {t("Background about you that the model will always see")}
                  </div>
                  <textarea
                    className="pref-context-textarea"
                    value={personalContext}
                    maxLength={1000}
                    placeholder={t("e.g. I'm a software engineer working in TypeScript. Prefer concise answers.")}
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
                      {personalContextSaving ? (
                        <span className="btn-spinner" />
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pref-account-card" style={{ marginTop: 10 }}>
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Icon color")}</div>
                  <div className="pref-avatar-preview-row">
                    <div
                      className="pref-avatar-preview"
                      style={
                        avatarColor
                          ? { background: avatarColor, color: readableTextOn(avatarColor) }
                          : undefined
                      }
                    >
                      {(userInfo?.full_name ??
                        userInfo?.username ??
                        "?")[0].toUpperCase()}
                    </div>
                    <div className="pref-avatar-swatches">
                      <button
                        className={`pref-avatar-swatch pref-avatar-swatch--default${!avatarColor ? " active" : ""}`}
                        onClick={() => setAvatarColor(null)}
                        title={t("Default")}
                      />
                      {[
                        "#cc241d",
                        "#d65d0e",
                        "#b57614",
                        "#fabd2f",
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
                {onLogout && (
                  <div className="pref-list-item" onClick={onLogout}>
                    <div className="pref-item-icon">
                      <svg
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </div>
                    <div className="pref-item-info">
                      <div className="pref-item-name">{t("Sign Out")}</div>
                      <div className="pref-item-desc">
                        {t("Sign out of your account")}
                      </div>
                    </div>
                    <span className="pref-row-arrow">→</span>
                  </div>
                )}
                <div
                  className="pref-list-item pref-danger-item"
                  onClick={() => setShowClearAllConfirm(true)}
                >
                  <div className="pref-item-icon">
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </div>
                  <div className="pref-item-info">
                    <div className="pref-item-name pref-danger-name">
                      {t("Clear All Chats")}
                    </div>
                    <div className="pref-item-desc">
                      {t("Delete all chat history permanently")}
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
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
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
                      {t("Delete Account")}
                    </div>
                    <div className="pref-item-desc">
                      {t("Permanently removes your account and all data")}
                    </div>
                  </div>
                  <span className="pref-row-arrow">→</span>
                </div>
              </div>
            </div>
          </>
        );

      case "advanced":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">{t("Advanced")}</span>
            </div>
            <div className="pref-account-scroll">
              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Games model")}</div>
                  <div className="pref-field-desc">
                    {t("The model the games play with, apart from the one you chat with. The games need one that follows instructions closely and replies in clean JSON. Leave it on the server default unless you want to try another.")}
                  </div>
                  <select
                    className="pref-name-input pref-game-model"
                    value={gameModel && models.includes(gameModel) ? gameModel : ""}
                    onChange={(e) => setGameModel(e.target.value)}
                    aria-label={t("Games model")}
                  >
                    <option value="">
                      Server default{serverGameModel ? ` (${serverGameModel})` : ""}
                    </option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {webStudio && (
              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Web studio model")}</div>
                  <div className="pref-field-desc">
                    {t("The model that builds sites with /web. It needs one that can use tools, so only those are listed. Auto picks an installed coding model, such as qwen2.5-coder, and otherwise the model you chat with. A bigger model is slower but makes fewer mistakes.")}
                  </div>
                  <select
                    className="pref-name-input pref-game-model"
                    value={studioModel && models.includes(studioModel) ? studioModel : ""}
                    onChange={(e) => setStudioModel(e.target.value)}
                    aria-label={t("Web studio model")}
                  >
                    <option value="">{t("Auto")}</option>
                    {models
                      .filter((m) => modelCapabilities[m]?.includes("web"))
                      .map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                  </select>
                  {studioModel && !models.includes(studioModel) && models.length > 0 && (
                    <div className="pref-ollama-msg pref-ollama-msg--error">
                      {studioModel} is not on this server, so the studio picks one automatically.
                    </div>
                  )}
                </div>
              </div>
              )}

              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Ollama server")}</div>
                  <div className="pref-field-desc">
                    {t("Leave empty to use the shared test server. To use your own, enter an address reachable from the internet, such as an ngrok or Tailscale Funnel URL. ModelLoop connects from its own server, so localhost and private network addresses are refused.")}
                  </div>
                  <input
                    className="pref-name-input pref-ollama-input"
                    value={ollamaUrl}
                    maxLength={300}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="https://your-tunnel.ngrok-free.dev"
                    onChange={(e) => {
                      setOllamaUrl(e.target.value);
                      setOllamaSaved(null);
                      setOllamaError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveOllama();
                    }}
                    disabled={ollamaSaving}
                  />
                  <div className="pref-ollama-actions">
                    <button
                      className="pref-name-cancel-btn"
                      onClick={handleTestOllama}
                      disabled={
                        ollamaTesting || ollamaSaving || !ollamaUrl.trim()
                      }
                    >
                      {ollamaTesting ? (
                        <span className="btn-spinner" />
                      ) : (
                        "Test"
                      )}
                    </button>
                    <button
                      className="pref-name-save-btn"
                      onClick={handleSaveOllama}
                      disabled={ollamaSaving}
                    >
                      {ollamaSaving ? <span className="btn-spinner" /> : t("Save")}
                    </button>
                  </div>

                  {ollamaError && (
                    <div className="pref-ollama-msg pref-ollama-msg--error">
                      {ollamaError}
                    </div>
                  )}
                  {ollamaSaved && (
                    <div className="pref-ollama-msg pref-ollama-msg--ok">
                      {ollamaSaved}
                    </div>
                  )}
                </div>
              </div>

              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Connection")}</div>
                  {ollamaStatusLoading ? (
                    <div className="pref-field-desc">
                      {t("Checking, this can take up to 25 seconds if the server is asleep.")}
                    </div>
                  ) : ollamaStatus ? (
                    <>
                      <div className="pref-ollama-status">
                        <span
                          className={`pref-ollama-dot${ollamaStatus.reachable ? " online" : " offline"}`}
                        />
                        <span>
                          {ollamaStatus.reachable
                            ? ollamaStatus.latency_ms != null
                              ? t("Reachable in {ms} ms", { ms: ollamaStatus.latency_ms })
                              : t("Reachable")
                            : ollamaStatus.reason === "timeout"
                              ? t("No answer yet")
                              : t("Not reachable")}
                        </span>
                        <span className="pref-ollama-target">
                          {ollamaStatus.using_shared_server
                            ? t("shared test server")
                            : (ollamaStatus.url ?? t("your server"))}
                        </span>
                      </div>
                      {ollamaStatus.reachable &&
                        ollamaStatus.models != null && (
                          <div className="pref-field-desc">
                            {ollamaStatus.models === 1
                              ? t("1 model available")
                              : t("{n} models available", { n: ollamaStatus.models })}
                            {ollamaStatus.sample &&
                            ollamaStatus.sample.length > 0
                              ? `: ${ollamaStatus.sample.join(", ")}`
                              : ""}
                          </div>
                        )}
                      {!ollamaStatus.reachable && ollamaStatus.detail && (
                        <div className="pref-field-desc">
                          {ollamaStatus.detail}
                        </div>
                      )}
                      {ollamaStatus.using_shared_server && (
                        <div className="pref-ollama-note">
                          {t("The shared server sleeps when idle, so the first reply after a quiet spell can take a minute to arrive. It is shared with everyone, so it can also be slow under load.")}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="pref-field-desc">{t("Status unavailable.")}</div>
                  )}
                  <div className="pref-ollama-actions">
                    <button
                      className="pref-name-cancel-btn"
                      onClick={loadOllamaStatus}
                      disabled={ollamaStatusLoading}
                    >
                      {t("Re-check")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        );

      case "about":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">{t("About")}</span>
            </div>
            <div className="pref-account-scroll">
              <div className="pref-about-hero">
                <img className="pref-about-logo" src={logoUrl} alt="" />
                <div className="pref-about-wordmark">ModelLoop</div>
                <div className="pref-about-build">
                  Latest Build Date: Nov 25, 2026
                </div>
                <div className="pref-about-tagline">
                  {t("Self-hosted AI chat powered by your local LLM")}
                </div>
              </div>
              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">{t("Version")}</div>
                  <div className="pref-about-meta-value">v2.3.0</div>
                </div>
                <div className="pref-account-field pref-account-field-sep">
                  <div className="pref-field-label">{t("Built by")}</div>
                  <a
                    href="https://aynjel.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pref-about-link"
                  >
                    Angel Gutierrez
                  </a>
                </div>
                <div className="pref-account-field pref-account-field-sep">
                  <div className="pref-field-label">{t("Source")}</div>
                  <a
                    href="https://github.com/axgel6/ModelLoop"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pref-about-link"
                  >
                    github.com/axgel6/ModelLoop
                  </a>
                </div>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <>
      <div className="chat-preferences-modal-overlay" onClick={onClose}>
        <div
          className={`pref-modal pref-modal--${phonePane}`}
          ref={sheetRef}
          // Clicks inside stay inside, so they do not close the window. Their sounds come from the
          // page-wide press handler in main.tsx, which already knows every element here.
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pref-sheet-handle" {...sheetDrag} />
          <div className="pref-phone-bar" {...sheetDrag}>
            {phonePane === "section" ? (
              <button
                type="button"
                className="pref-phone-btn"
                onClick={() => setPhonePane("back")}
                aria-label={t("Back to Preferences")}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
                </svg>
              </button>
            ) : (
              <span className="pref-phone-btn-space" />
            )}
            <span className="pref-phone-title">
              {phonePane === "section" ? t(sectionLabel(activeSection)) : t("Preferences")}
            </span>
            <button
              type="button"
              className="pref-phone-btn"
              onClick={onClose}
              aria-label={t("Close")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="pref-sidebar">
            {NAV_GROUPS.map((group) => (
              <div className="pref-nav-group" key={group[0].id}>
                {group.map(({ id, label }) => (
                  <div
                    key={id}
                    data-section={id}
                    className={`pref-nav-item${activeSection === id ? " active" : ""}`}
                    onClick={() => {
                      setActiveSection(id);
                      setPhonePane("section");
                    }}
                  >
                    <span className="pref-nav-icon">
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {NAV_ICONS[id]}
                      </svg>
                    </span>
                    <span className="pref-nav-label">{t(label)}</span>
                    <span className="pref-nav-hint">{navHint(id)}</span>
                    <svg className="pref-nav-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
                    </svg>
                  </div>
                ))}
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
            // Sounds come from the page-wide press handler; this only keeps clicks inside the dialog
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pref-delete-dialog-title">{t("Delete Account")}</div>
            <div className="pref-delete-dialog-text">
              {t("This removes your account and everything in it for good. There is no way to bring it back.")}
            </div>
            <div className="pref-delete-dialog-divider" />
            <div className="pref-delete-dialog-actions">
              <button
                className="pref-confirm-no"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="pref-confirm-yes"
                onClick={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? t("Deleting…") : t("Delete Account")}
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
            // Sounds come from the page-wide press handler; this only keeps clicks inside the dialog
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pref-delete-dialog-title">{t("Clear All Chats")}</div>
            <div className="pref-delete-dialog-text">
              {t("This removes every chat you have for good. There is no way to bring them back.")}
            </div>
            <div className="pref-delete-dialog-divider" />
            <div className="pref-delete-dialog-actions">
              <button
                className="pref-confirm-no"
                onClick={() => setShowClearAllConfirm(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="pref-confirm-yes"
                onClick={handleClearAllChats}
                disabled={clearingAll}
              >
                {clearingAll ? t("Clearing…") : t("Clear All")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatPreferences;
