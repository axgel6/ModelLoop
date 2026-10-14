// The choices on the start screen.
import { PRESETS } from "../../components/presets";
import type { ArenaMode } from "./types";

export interface Character {
  label: string;
  description: string;
  /** The system prompt that makes a model play this character; "" plays it straight */
  prompt: string;
}

export const NO_CHARACTER: Character = {
  label: "No character",
  description: "The model as it is",
  prompt: "",
};

// The chat presets, minus the one that needs a prompt typed in. Olly has no prompt
// of its own in chat (the server supplies it), so it gets a short one here.
export const CHARACTERS: Character[] = [
  NO_CHARACTER,
  ...PRESETS.filter((p) => p.label !== "Custom").map((p) =>
    p.label === "Olly" ? { ...p, prompt: "You are Olly, a warm, calm and helpful assistant." } : p,
  ),
];

export const MODES: { id: ArenaMode; label: string; blurb: string }[] = [
  {
    id: "argument",
    label: "Argument",
    blurb: "They go back and forth on their own: five arguments each, then closing remarks.",
  },
  {
    id: "debate",
    label: "Debate",
    blurb: "Three rounds. At the end of each one you put a question to both sides.",
  },
];

export const DEFAULT_CHARACTERS = ["Ego", "Teacher"];

export const TOPICS = [
  "Cats are better than dogs",
  "Pineapple belongs on pizza",
  "A hot dog is a sandwich",
  "Remote work is better than the office",
  "Homework should be abolished",
  "It is better to be feared than loved",
  "Humans should colonize Mars",
  "Social media has done more harm than good",
  "Morning people are superior to night owls",
  "Books are better than their film adaptations",
  "Tabs are better than spaces",
  "Money can buy happiness",
  "Aliens have already visited Earth",
  "Cereal is a soup",
  "Zoos should not exist",
  "Everyone should learn to code",
];
