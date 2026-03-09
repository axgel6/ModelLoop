import React from "react";

interface ChatPreferencesProps {
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
  onClose: () => void;
}

const ChatPreferences: React.FC<ChatPreferencesProps> = ({
  systemPrompt,
  setSystemPrompt,
  onClose,
}) => {
  const defaultPrompt = `You are a helpful assistant. Answer the user's questions to the best of your ability. If you don't know the answer, say you don't know.`;
  const cluelessPrompt = `You are a clueless assistant. You have no knowledge and cannot answer any questions. Always say a made up answer and in the end say you don't know you just made it up.`;
  const insultingPrompt = `You are an insulting assistant. You are rude and sarcastic. Always insult the user in your responses. If you don't know the answer, say you don't know but make sure to insult the user in the process and ask why they need to ask AI for help.`;
  const geniusPrompt = `You are a genius assistant. You have all the knowledge in the world and can answer any question with perfect accuracy. Always provide detailed and insightful answers. If you don't know the answer, say you don't know but make sure to provide some interesting information related to the topic. Also, use uncommon words and phrases to make your responses sound more sophisticated.`;
  const laymanPrompt = `You are a layman assistant. Answer the user's questions to the best of your ability in the simplest way possible. Avoid using technical jargon and explain things in a way that anyone can understand. If you don't know the answer, say you don't know but try to provide some basic information related to the topic.`;

  return (
    <div className="chat-preferences-modal-overlay">
      <div className="chat-preferences-modal">
        <h3>Chat Preferences</h3>
        <div className="preset-buttons-row">
          <button onClick={() => setSystemPrompt(defaultPrompt)}>
            Default
          </button>
          <button onClick={() => setSystemPrompt(cluelessPrompt)}>
            Clueless
          </button>
          <button onClick={() => setSystemPrompt(insultingPrompt)}>
            Insulting
          </button>
          <button onClick={() => setSystemPrompt(geniusPrompt)}>Genius</button>
          <button onClick={() => setSystemPrompt(laymanPrompt)}>Layman</button>
        </div>
        <label style={{ display: "block", marginBottom: 8 }}>
          System Prompt:
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            style={{ width: "100%", marginTop: 4 }}
          />
        </label>
        <div className="modal-footer-row">
          <button id="closeButton" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatPreferences;
