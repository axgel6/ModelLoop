import { useEffect, useRef, useState } from "react";
import { apiGetModels, apiHealth } from "../api";
import { DEFAULT_MODEL, MODEL_PRESETS } from "../ChatInput";

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant. Be concise and avoid over-explaining simple questions.";

export function useChatSettings() {
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [isConnected, setIsConnected] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [showPreferences, setShowPreferences] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("Default");
  const [temperature, setTemperature] = useState(0.7);
  const modelsLoadedRef = useRef(false);

  useEffect(() => {
    const tryLoadModels = async () => {
      try {
        const availableModels = await apiGetModels();
        setModels(availableModels);
        setIsConnected(true);
        modelsLoadedRef.current = true;
        if (availableModels.length > 0) {
          setSelectedModel((prev) => {
            if (availableModels.includes(prev)) return prev;
            const firstPreset = MODEL_PRESETS.find((p) =>
              availableModels.includes(p.model),
            );
            return firstPreset ? firstPreset.model : availableModels[0];
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

    let healthFailures = 0;
    const healthInterval = setInterval(async () => {
      if (!modelsLoadedRef.current) return;
      try {
        const ok = await apiHealth();
        setIsConnected(ok);
        healthFailures = 0;
      } catch {
        if (++healthFailures >= 3) setIsConnected(false);
      }
    }, 30000);

    return () => {
      clearInterval(modelRetry);
      clearInterval(healthInterval);
    };
  }, []);

  return {
    models,
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
  };
}
