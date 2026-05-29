export const MODEL_PRESETS = [
  { label: "Fast", model: "llama3.1:8b" },
  { label: "Pro", model: "qwen2.5:7b" },
  { label: "Thinking", model: "deepseek-r1:7b" },
] as const;

export const DEFAULT_MODEL = MODEL_PRESETS[0].model;
