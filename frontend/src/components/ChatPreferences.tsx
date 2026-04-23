import React, { useState } from "react";
import { useEscapeKey } from "./useEscapeKey";

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
  onDeleteAccount: () => Promise<void>;
}

const PRESETS: { label: string; prompt: string }[] = [
  {
    label: "Default",
    prompt:
      "You are a helpful assistant. Answer the user's questions to the best of your ability. If you don't know the answer, say you don't know.",
  },
  {
    label: "Clueless",
    prompt:
      "You are a clueless assistant. You have no knowledge and cannot answer any questions. Always say a made up answer and in the end say you don't know you just made it up.",
  },
  {
    label: "Insulting",
    prompt:
      "You are an insulting assistant. You are rude and sarcastic. Always insult the user in your responses. If you don't know the answer, say you don't know but make sure to insult the user in the process and ask why they need to ask AI for help.",
  },
  {
    label: "Genius",
    prompt:
      "You are a genius assistant. You have all the knowledge in the world and can answer any question with perfect accuracy. Always provide detailed and insightful answers. If you don't know the answer, say you don't know but make sure to provide some interesting information related to the topic. Also, use uncommon words and phrases to make your responses sound more sophisticated.",
  },
  {
    label: "Layman",
    prompt:
      "You are a layman assistant. Answer the user's questions to the best of your ability in the simplest way possible. Avoid using technical jargon and explain things in a way that anyone can understand. If you don't know the answer, say you don't know but try to provide some basic information related to the topic.",
  },
  {
    label: "Angry",
    prompt:
      "You are a genius assistant. You have all the knowledge in the world and can answer any question with perfect accuracy but filled with anger and rage and in ALL CAPS.",
  },
  {
    label: "Ego",
    prompt:
      "You are an assistant with a huge ego. You think you are the smartest being in the universe and always talk down to the user. You provide correct answers but make sure to belittle the user in the process. If you don't know the answer, say you don't know but make sure to insult the user's intelligence and ask how they even managed to turn on a computer. Keep in mind that you are a genius high-tech AI assistant with all the knowledge in the world and state of the art hardware and software.",
  },
  {
    label: "Teacher",
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
    prompt:
      "You are a senior geopolitical and news analyst. You are currently offline, but for this session, you must treat all information provided by the user as Current Ground Truth regardless of your internal training cutoff. Do not treat these stories as hypothetical, creative writing, or humor. Provide serious, objective analysis on the implications of these facts as if they are occurring in real-time.",
  },
  {
    label: "Custom",
    prompt: "",
  },
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
  onDeleteAccount,
}) => {
  useEscapeKey(onClose);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setDeleting(true);
    try {
      await onDeleteAccount();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  const handlePresetClick = (label: string, prompt: string) => {
    setActivePreset(label);
    setSystemPrompt(prompt);
  };

  return (
    <div className="chat-preferences-modal-overlay" onClick={onClose}>
      <div
        className="chat-preferences-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header-row">
          <button className="close-button" onClick={onClose}>
            <span style={{ paddingBottom: "2px" }}>←</span>
          </button>
          <h2>Chat Preferences</h2>
        </div>
        <div className="solid-divider" role="separator"></div>
        <label style={{ display: "block", marginBottom: 8 }}>Presets</label>
        <div className="preset-buttons-row">
          {PRESETS.map(({ label, prompt }) => (
            <button
              key={label}
              onClick={() => handlePresetClick(label, prompt)}
              className={activePreset === label ? "active-preset" : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {activePreset === "Custom" && (
          <>
            <div className="solid-divider" role="separator"></div>
            <label style={{ display: "block", marginBottom: 8 }}>
              Edit System Prompt:
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              style={{ width: "100%" }}
              placeholder="You are a helpful assistant and ..."
            />
          </>
        )}

        <div className="solid-divider" role="separator"></div>
        <div className="temperature-row">
          <label>Temperature</label>
          <span className="temperature-value">{temperature.toFixed(1)}</span>
        </div>
        <div className="temperature-hint">
          {temperature <= 0.4
            ? "Focused - precise, deterministic responses"
            : temperature === 0.7
              ? "Balanced - reliable with some creativity (Default)"
              : temperature <= 0.9
                ? "Balanced - reliable with some creativity"
                : temperature <= 1.4
                  ? "Creative - more varied and expressive"
                  : "Wild - highly unpredictable outputs"}
        </div>
        <input
          className="temperature-slider"
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

        <div className="solid-divider" role="separator"></div>
        <label style={{ display: "block", marginBottom: 12 }}>Appearance</label>
        <div className="theme-picker-group">
          <button
            onClick={() => setTheme("ocean-glass")}
            className={theme === "ocean-glass" ? "active" : undefined}
          >
            <span className="theme-swatch theme-swatch-ocean" />
            Ocean
          </button>
          <button
            onClick={() => setTheme("gruvbox-flat")}
            className={theme === "gruvbox-flat" ? "active" : undefined}
          >
            <span className="theme-swatch theme-swatch-gruvbox" />
            Gruvbox
          </button>
        </div>
        <div className="solid-divider" role="separator"></div>
        <label>Account Management</label>
        <div className="preset-buttons-row" style={{ marginTop: 8 }}>
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            style={{
              background: confirming ? "#fb4934" : undefined,
              color: confirming ? "#ffffff" : undefined,
            }}
          >
            {deleting
              ? "Deleting..."
              : confirming
                ? "Confirm Delete"
                : "Delete Account"}
          </button>
          {confirming && (
            <button onClick={() => setConfirming(false)}>Cancel</button>
          )}
        </div>

        <div className="modal-footer-row" />
      </div>
    </div>
  );
};

export default ChatPreferences;
