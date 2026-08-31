import React, { useState, useEffect } from "react";
import { useEscapeKey } from "./useEscapeKey";
import { haptics } from "../haptics";
import {
  apiGetMe,
  apiUpdateProfile,
  apiSavePersonalContext,
} from "./api";

export type Theme = "ocean" | "gruvbox" | "dune";
export type Font = "mono" | "inter";
export type TextSize = "xs" | "small" | "medium" | "large";

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
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
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
  onDeleteAccount: () => Promise<void>;
  onClearAllChats: () => Promise<void>;
  onNameChange?: (name: string | null) => void;
  onLogout?: () => void;
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

// Plain-language explanations for the Generation sliders, shown by the (i) toggles.
const GENERATION_INFO: Record<string, { title: string; body: string }> = {
  temperature: {
    title: "Temperature",
    body:
      "Controls how random the model's word choices are. Low values (0.0 to 0.3) keep replies focused and repeatable, so the same question returns nearly the same answer every time. High values (1.2 and above) make replies more varied and creative, but also more likely to wander off topic or invent details. 0.7 is a balanced default.",
  },
  topP: {
    title: "Top P",
    body:
      "Also called nucleus sampling. Before choosing each word, the model ranks every candidate by probability and keeps only the smallest group whose combined probability reaches this value. At 0.9 it considers the most likely 90 percent and discards the long tail. Lowering it restricts the model to safe, predictable words; raising it toward 1.0 lets rare words back in, adding variety and risk. It works alongside Temperature: Temperature reshapes the odds, Top P trims the shortlist.",
  },
  numPredict: {
    title: "Max Tokens",
    body:
      "A hard cap on the length of a single reply. One token is roughly three quarters of a word. Left unlimited, the model stops when it judges the answer complete. Set a number and the reply is cut off once it reaches that many tokens, even mid sentence, which is useful for keeping answers short or bounding how long a response can take.",
  },
  speechRate: {
    title: "Voice Speed",
    body:
      "Playback rate for spoken replies in voice mode. 1.0 is the speech engine's natural pace, 0.5 plays at half speed, and 2.0 at double. This only affects how a reply is read aloud. It does not change the wording the model generates.",
  },
};

export type Section =
  | "model"
  | "presets"
  | "temperature"
  | "appearance"
  | "shortcuts"
  | "account"
  | "about";

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "presets", label: "Presets" },
  { id: "temperature", label: "Generation" },
  { id: "appearance", label: "Appearance" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "account", label: "Account" },
  { id: "about", label: "About" },
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
  textSize,
  setTextSize,
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
  onDeleteAccount,
  onClearAllChats,
  onNameChange,
  onLogout,
  initialSection,
}) => {
  useEscapeKey(onClose);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(
    initialSection ?? "model",
  );
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [presetSearch, setPresetSearch] = useState("");
  const [userInfo, setUserInfo] = useState<{
    id: string;
    email: string;
    full_name: string | null;
  } | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [personalContext, setPersonalContext] = useState<string>("");
  const [personalContextSaving, setPersonalContextSaving] = useState(false);
  useEffect(() => {
    apiGetMe()
      .then((info) => {
        setUserInfo(info);
        setPersonalContext(info.personal_context ?? "");
      })
      .catch(() => {});
  }, []);

  // (i) toggle beside a Generation label, plus the panel it reveals
  const infoButton = (id: string) => (
    <button
      type="button"
      className={`pref-info-btn${openInfo === id ? " active" : ""}`}
      aria-expanded={openInfo === id}
      aria-label={`What does ${GENERATION_INFO[id].title} do?`}
      title={`What does ${GENERATION_INFO[id].title} do?`}
      onClick={() => setOpenInfo((prev) => (prev === id ? null : id))}
    >
      i
    </button>
  );

  const infoPanel = (id: string) =>
    openInfo === id ? (
      <div className="pref-info-panel">{GENERATION_INFO[id].body}</div>
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
              <button
                className="pref-generation-reset-btn"
                onClick={() => {
                  setTemperature(0.7);
                  setTopP(0.9);
                  setNumPredict(-1);
                  setSpeechRate(1.0);
                }}
                title="Reset to defaults"
              >
                Reset to defaults
              </button>
            </div>
            <div className="pref-settings-area">
              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    Temperature
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
                    Top P
                    {infoButton("topP")}
                  </div>
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
              {infoPanel("topP")}

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    Max Tokens
                    {infoButton("numPredict")}
                  </div>
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
              {infoPanel("numPredict")}

              <div className="pref-setting-divider" />

              <div className="pref-setting-row">
                <div className="pref-setting-info">
                  <div className="pref-setting-label">
                    Voice Speed
                    {infoButton("speechRate")}
                  </div>
                  <div className="pref-setting-hint">
                    {speechRate <= 0.7
                      ? "Slow — easier to follow"
                      : speechRate <= 1.1
                        ? speechRate === 1.0
                          ? "Normal — natural pace (Default)"
                          : "Normal — natural pace"
                        : speechRate <= 1.5
                          ? "Fast — quicker delivery"
                          : "Very fast — for rapid listening"}
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
              <div
                className="pref-setting-section-label"
                style={{ marginTop: "20px" }}
              >
                Chat Size
              </div>
              <input
                type="range"
                className="temperature-slider pref-slider"
                min={0}
                max={3}
                step={1}
                value={["xs", "small", "medium", "large"].indexOf(textSize)}
                onChange={(e) =>
                  setTextSize(
                    (["xs", "small", "medium", "large"] as TextSize[])[
                      Number(e.target.value)
                    ],
                  )
                }
              />
              <div className="temperature-labels">
                <span>XS</span>
                <span>S</span>
                <span>M (Default)</span>
                <span>L</span>
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
                  <div className="pref-field-label">Icon Color</div>
                  <div className="pref-avatar-preview-row">
                    <div
                      className="pref-avatar-preview"
                      style={
                        avatarColor ? { background: avatarColor } : undefined
                      }
                    >
                      {(userInfo?.full_name ??
                        userInfo?.email ??
                        "?")[0].toUpperCase()}
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
                {onLogout && (
                  <div className="pref-list-item" onClick={onLogout}>
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
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </div>
                    <div className="pref-item-info">
                      <div className="pref-item-name">Sign Out</div>
                      <div className="pref-item-desc">
                        Sign out of your account
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

      case "about":
        return (
          <>
            <div className="pref-content-header">
              <span className="pref-content-title">About</span>
            </div>
            <div className="pref-account-scroll">
              <div className="pref-about-hero">
                <div className="pref-about-wordmark">ModelLoop</div>
                <div className="pref-about-build">
                  Latest Build Date: Jun 19, 2026
                </div>
                <div className="pref-about-tagline">
                  Self-hosted AI chat powered by Ollama
                </div>
              </div>
              <div className="pref-account-card">
                <div className="pref-account-field">
                  <div className="pref-field-label">Version</div>
                  <div className="pref-about-meta-value">v1.4.3</div>
                </div>
                <div className="pref-account-field pref-account-field-sep">
                  <div className="pref-field-label">Built by</div>
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
                  <div className="pref-field-label">Source</div>
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
            {NAV_ITEMS.map(({ id, label }) => (
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

    </>
  );
};

export default ChatPreferences;
