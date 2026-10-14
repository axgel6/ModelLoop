import { useEffect, useRef, useState } from "react";
import { apiGetModels, apiHealth } from "../api";
import { DEFAULT_MODEL } from "../ChatInput";

const DEFAULT_SYSTEM_PROMPT = "";
const GAME_MODEL_KEY = "game_model";
const THINK_KEY = "think_mode";

export function useChatSettings() {
  const [models, setModels] = useState<string[]>([]);
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, string[]>>({});
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [isConnected, setIsConnected] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showPreferences, setShowPreferences] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("Olly");
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [numPredict, setNumPredict] = useState(-1);
  const [speechRate, setSpeechRateState] = useState<number>(() => {
    const stored = localStorage.getItem("voice_speech_rate");
    return stored ? parseFloat(stored) : 1.0;
  });
  // The games' model: empty means the server's default (GAME_MODEL). Remembered in this browser.
  const [gameModel, setGameModelState] = useState<string>(() => {
    try {
      return localStorage.getItem(GAME_MODEL_KEY) ?? "";
    } catch {
      return "";
    }
  });
  // Thinking: the model reasons before answering. On or off for every model that can, remembered.
  const [thinking, setThinkingState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THINK_KEY) === "on";
    } catch {
      return false;
    }
  });
  const setThinking = (on: boolean) => {
    setThinkingState(on);
    try {
      localStorage.setItem(THINK_KEY, on ? "on" : "off");
    } catch {
      // private mode: it lasts until the page closes
    }
  };
  const [serverDefaults, setServerDefaults] = useState<{ chat?: string; game?: string }>({});
  const modelsLoadedRef = useRef(false);

  useEffect(() => {
    const tryLoadModels = async () => {
      try {
        const { models: availableModels, capabilities, defaults } = await apiGetModels();
        setModels(availableModels);
        setModelCapabilities(capabilities);
        setServerDefaults(defaults);
        setIsConnected(true);
        modelsLoadedRef.current = true;
        if (availableModels.length > 0) {
          setSelectedModel((prev) => {
            if (availableModels.includes(prev)) return prev;
            // Then the server's DEFAULT_MODEL, then whatever is installed
            if (defaults.chat && availableModels.includes(defaults.chat)) return defaults.chat;
            return availableModels[0];
          });
        }
        return true;
      } catch {
        setIsConnected(false);
        return false;
      }
    };

    void tryLoadModels();
    const modelRetry = setInterval(async () => {
      if (modelsLoadedRef.current) {
        clearInterval(modelRetry);
        return;
      }
      if (await tryLoadModels()) clearInterval(modelRetry);
    }, 5000);

    // apiHealth resolves false on network errors rather than rejecting.
    const healthInterval = setInterval(async () => {
      if (!modelsLoadedRef.current) return;
      setIsConnected(await apiHealth());
    }, 30000);

    return () => {
      clearInterval(modelRetry);
      clearInterval(healthInterval);
    };
  }, []);

  const setGameModel = (model: string) => {
    setGameModelState(model);
    try {
      if (model) localStorage.setItem(GAME_MODEL_KEY, model);
      else localStorage.removeItem(GAME_MODEL_KEY);
    } catch {
      // private mode: it lasts until the page closes
    }
  };

  const setSpeechRate = (rate: number) => {
    localStorage.setItem("voice_speech_rate", String(rate));
    setSpeechRateState(rate);
  };

  return {
    models,
    modelCapabilities,
    gameModel,
    setGameModel,
    serverDefaults,
    thinking,
    setThinking,
    selectedModel,
    setSelectedModel,
    isConnected,
    systemPrompt,
    setSystemPrompt,
    showPreferences,
    setShowPreferences,
    activePreset,
    setActivePreset,
    temperature,
    setTemperature,
    topP,
    setTopP,
    numPredict,
    setNumPredict,
    speechRate,
    setSpeechRate,
  };
}
