// A chat's web studio project: loading it, its versions, and answering preview checks
import { apiFetch } from "../components/api";

export interface StoredProject {
  id: string;
  name: string;
  /** The latest version, or 0 before any file is written */
  version: number;
  files: { path: string; content: string }[];
  /** Newest first. The label is what the user asked for in that turn. */
  versions: { version: number; label: string; restored_from: number | null; created_at: string }[];
}

// The chat's project, as it is now
export async function apiGetProject(chatId: string): Promise<StoredProject> {
  const res = await apiFetch(`/api/v1/chats/${chatId}/project`);
  if (!res.ok) throw new Error("I couldn't load this project.");
  return res.json();
}

// Every file as it was in one version
export async function apiGetProjectVersion(
  chatId: string,
  version: number,
): Promise<{ path: string; content: string }[]> {
  const res = await apiFetch(`/api/v1/chats/${chatId}/project/versions/${version}`);
  if (!res.ok) throw new Error("I couldn't load that version.");
  return (await res.json()).files;
}

// Answers a running turn's check with the errors its hidden preview saw
export async function apiReportProjectCheck(chatId: string, checkId: string, errors: string[]): Promise<void> {
  await apiFetch(`/api/v1/chats/${chatId}/project/checks/${checkId}`, {
    method: "POST",
    body: JSON.stringify({ errors }),
  });
}

// Saves an older version as the newest, and returns its number
export async function apiRestoreProjectVersion(chatId: string, version: number): Promise<number> {
  const res = await apiFetch(`/api/v1/chats/${chatId}/project/versions/${version}/restore`, { method: "POST" });
  if (!res.ok) throw new Error("I couldn't restore that version.");
  return (await res.json()).version;
}
