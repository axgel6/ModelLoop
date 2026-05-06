export function fixMathDelimiters(text: string): string {
  text = text
    .replace(/\\\[(.+?)\\\]/gs, (_, c) => `$$${c.trim()}$$`)
    .replace(/\\\((.+?)\\\)/gs, (_, c) => `$${c.trim()}$`)
    .replace(
      /\[\s*([^[\]]*\\[a-zA-Z]+[^[\]]*)\s*\]/g,
      (_, c) => `$$${c.trim()}$$`,
    )
    .replace(
      /\[\s*(\d+[^[\]]*[+\-*/=][^[\]]*\d+[^[\]]*)\s*\]/g,
      (_, c) => `$$${c.trim()}$$`,
    );

  const saved: string[] = [];
  text = text.replace(/\$\$[\s\S]+?\$\$/g, (m) => {
    saved.push(m);
    return `\x00${saved.length - 1}\x00`;
  });
  text = text.replace(/\$(?!\s)(?:[^$\n\\]|\\.)+?(?<!\s)\$/g, (m) => {
    saved.push(m);
    return `\x00${saved.length - 1}\x00`;
  });
  text = text.replace(/\$(?=\d)/g, "\\$");
  text = text.replace(/\x00(\d+)\x00/g, (_, i) => saved[parseInt(i)]);
  return text;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtTime(iso: string | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const SUGGESTIONS = [
  "Explain quantum computing simply",
  "Write a Python script to rename files",
  "Break down a math problem for me",
  "Summarize a topic I choose",
];

export const GREETINGS = [
  "The destination is up to you.",
  "What will you discover today?",
  "Where shall we take you next?",
  "The world is at your fingertips.",
  "Your next move starts here.",
  "Which path will you choose?",
  "What can I help with?",
];

export const MANDATORY_SYSTEM_PROMPT_RULES = `Important rules:
1. Always consider the conversation history when answering follow-up questions
2. When the user says "add X" or similar, apply it to the previous result
3. For math expressions use \\( ... \\) for inline math and \\[ ... \\] for display math -/ never use $ as a math delimiter since it conflicts with currency symbols`;

export function withMandatoryPromptRules(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return MANDATORY_SYSTEM_PROMPT_RULES;
  if (trimmedPrompt.includes(MANDATORY_SYSTEM_PROMPT_RULES))
    return trimmedPrompt;
  return `${MANDATORY_SYSTEM_PROMPT_RULES}\n\n${trimmedPrompt}`;
}
