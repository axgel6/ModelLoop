// The chat's web studio project: loading it, the files a running turn has changed so far,
// and whether the studio is open. Chat.tsx feeds it stream events through the handlers.
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Message } from "../components/api";
import { apiGetProject, apiGetProjectVersion, apiReportProjectCheck, apiRestoreProjectVersion, type StoredProject } from "./api";
import { runPreviewCheck } from "./check";
import {
  timeAgo,
  withLiveFiles,
  type LiveFiles,
  type StudioMessage,
  type StudioProject,
  type WebDevContextValue,
} from "./context";

interface Options {
  messages: Message[];
  activeChatId: string | null;
  activeChatIdRef: MutableRefObject<string | null>;
  /** False for guests and private chats, which can't have a project */
  enabled: boolean;
}

export function useWebDevProject({ messages, activeChatId, activeChatIdRef, enabled }: Options) {
  // Open on the chat's project, at a file when given one
  const [studio, setStudio] = useState<{ path?: string } | null>(null);
  const closeStudio = useCallback(() => setStudio(null), []);
  const openStudio = useCallback((options?: { path?: string }) => setStudio({ path: options?.path }), []);
  // A chat has a project once a reply carries project changes (the turn that starts one always does)
  const hasProject = useMemo(() => messages.some((m) => m.project_changes), [messages]);
  const [storedProject, setStoredProject] = useState<{ chatId: string; data: StoredProject } | null>(null);
  // Bumped when a turn saves a version, to load the new files
  const [projectTick, setProjectTick] = useState(0);
  // Files the running turn has changed so far ({path: contents, or null when deleted}), so the
  // preview follows each step instead of waiting for the turn to end
  const [liveFiles, setLiveFiles] = useState<{ chatId: string | null; files: LiveFiles } | null>(null);
  // The running turn saved a version, so its live files give way once the saved ones load
  const liveSavedRef = useRef(false);
  useEffect(() => {
    if (!activeChatId || !hasProject || !enabled) return;
    let cancelled = false;
    const chatId = activeChatId;
    apiGetProject(chatId)
      .then((data) => {
        if (cancelled) return;
        setStoredProject({ chatId, data });
        if (liveSavedRef.current) {
          liveSavedRef.current = false;
          setLiveFiles(null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeChatId, hasProject, enabled, projectTick]);
  // Another chat's studio never stays open over this one
  const [studioChat, setStudioChat] = useState(activeChatId);
  if (studioChat !== activeChatId) {
    setStudioChat(activeChatId);
    setStudio(null);
  }

  const project = useMemo<StudioProject | null>(() => {
    if (!storedProject || storedProject.chatId !== activeChatId || !hasProject) return null;
    const { data } = storedProject;
    const last = [...messages].reverse().find((m) => m.project_changes?.files.length);
    return {
      name: data.name,
      version: data.version,
      files: liveFiles?.chatId === activeChatId ? withLiveFiles(data.files, liveFiles.files) : data.files,
      versions: data.versions.map((v) => ({ version: v.version, label: v.label, when: timeAgo(v.created_at) })),
      lastChanges: last?.project_changes?.files ?? [],
      restoredFrom: data.versions[0]?.restored_from,
    };
  }, [storedProject, activeChatId, hasProject, messages, liveFiles]);
  const studioMessages = useMemo<StudioMessage[]>(
    () =>
      messages.map((m) => ({
        role: m.role,
        text: m.content,
        changes: m.project_changes?.files,
        version: m.project_changes?.version,
        steps: m.steps,
        createdAt: m.created_at,
      })),
    [messages],
  );
  const loadVersion = useCallback(
    (version: number) => apiGetProjectVersion(activeChatIdRef.current!, version),
    [activeChatIdRef],
  );
  const restoreVersion = useCallback(
    async (version: number) => {
      await apiRestoreProjectVersion(activeChatIdRef.current!, version);
      setProjectTick((t) => t + 1);
    },
    [activeChatIdRef],
  );
  const webDev = useMemo<WebDevContextValue>(() => ({ project, open: openStudio }), [project, openStudio]);

  // ── Stream events ──────────────────────────────────────────────────────
  /** A project turn started */
  const onTurnStart = useCallback(() => {
    liveSavedRef.current = false;
  }, []);
  /** The running turn wrote or deleted a file (content null) */
  const onFileChanged = useCallback(
    (file: { path: string; content: string | null }) => {
      const chatId = activeChatIdRef.current;
      setLiveFiles((live) => ({
        chatId,
        files: { ...(live?.chatId === chatId ? live.files : {}), [file.path]: file.content },
      }));
    },
    [activeChatIdRef],
  );
  /** The turn saved a version. The live files stay on screen until the saved ones load. */
  const onVersionSaved = useCallback(() => {
    liveSavedRef.current = true;
    setProjectTick((t) => t + 1);
  }, []);
  /** The stream ended. A turn that saved nothing (stopped, failed or no changes) leaves the project as it was. */
  const onTurnEnd = useCallback(() => {
    if (!liveSavedRef.current) setLiveFiles(null);
  }, []);
  /** The turn's checker waits for this: run the new files hidden and report their errors.
   *  Not awaited, so the stream keeps reading meanwhile. */
  const runCheck = useCallback((chatId: string, checkId: string, files: { path: string; content: string }[]) => {
    void runPreviewCheck(files)
      .then((errors) => apiReportProjectCheck(chatId, checkId, errors))
      .catch(() => {});
  }, []);

  return {
    project,
    studio,
    openStudio,
    closeStudio,
    studioMessages,
    loadVersion,
    restoreVersion,
    webDev,
    onTurnStart,
    onFileChanged,
    onVersionSaved,
    onTurnEnd,
    runCheck,
  };
}
