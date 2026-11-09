import { createContext } from "react";
import type { ProjectFile } from "./preview";

export type FileChange = { action: "created" | "edited" | "deleted"; path: string };

/** A change's label: "Edited" style.css */
export const CHANGE_VERBS: Record<FileChange["action"], string> = { created: "Created", edited: "Edited", deleted: "Deleted" };

/** What the studio and the project card show: the chat's stored project */
export interface StudioProject {
  name: string;
  /** The latest version, or 0 before any file is written */
  version: number;
  files: ProjectFile[];
  /** Newest first */
  versions: { version: number; label: string; when: string }[];
  /** What the last turn that changed files did, for the card */
  lastChanges: FileChange[];
  /** The version the latest one restored, when it is a restore */
  restoredFrom?: number | null;
}

/** One tool call that worked in a project turn, shown while the turn runs */
export interface ProjectStep {
  verb: "created" | "replaced" | "edited" | "deleted" | "read" | "listed";
  path: string | null;
}

/** Files a running turn has changed so far: {path: contents, or null when deleted} */
export type LiveFiles = Record<string, string | null>;

/** The saved files with a running turn's changes on top, in path order */
export function withLiveFiles(files: ProjectFile[], live: LiveFiles): ProjectFile[] {
  const merged = new Map(files.map((f) => [f.path, f.content]));
  for (const [path, content] of Object.entries(live)) {
    if (content == null) merged.delete(path);
    else merged.set(path, content);
  }
  return [...merged].map(([path, content]) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path));
}

/** One turn in the studio's chat */
export interface StudioMessage {
  role: "user" | "assistant";
  text: string;
  changes?: FileChange[];
  version?: number | null;
  /** Set on a project reply while it's being written */
  steps?: ProjectStep[];
  createdAt?: string;
}

export interface WebDevContextValue {
  /** The chat's project, or null when it has none (or it hasn't loaded) */
  project: StudioProject | null;
  /** Opens the studio, at a file when given one */
  open: (options?: { path?: string }) => void;
}

export const WebDevContext = createContext<WebDevContextValue | null>(null);

/** What the chat says while a project turn runs, by tool (see backend/actions/project_files.py) */
export const PROJECT_TOOL_PHRASES: Record<string, string> = {
  list_files: "Looking over the files",
  read_file: "Reading the code",
  write_file: "Writing the code",
  edit_file: "Editing the code",
  delete_file: "Tidying up the files",
};

/** "Just now", "4 min ago", "2 h ago", or the date */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
