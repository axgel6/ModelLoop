import React, { useEffect, useState } from "react";
import { apiDeleteChat, type ChatMeta } from "./api";
import { useEscapeKey } from "./useEscapeKey";

// Format an ISO date string as a human-readable relative label
function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ----- Types -----

interface HistoryProps {
  chats: ChatMeta[];
  loading: boolean;
  onClose: () => void;
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onChatsChanged: () => void;
}

// ----- Component -----

const History: React.FC<HistoryProps> = ({
  chats,
  loading,
  onClose,
  activeChatId,
  onSelectChat,
  onNewChat,
  onChatsChanged,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  // Local copy for optimistic deletes; synced when parent refreshes
  const [localChats, setLocalChats] = useState<ChatMeta[]>(chats);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalChats(chats);
  }, [chats]);

  useEscapeKey(onClose);

  // ----- Handlers -----

  const handleDelete = async (id: string) => {
    const snapshot = localChats.find((c) => c.id === id);
    const snapshotIndex = localChats.findIndex((c) => c.id === id);

    setLocalChats((prev) => prev.filter((c) => c.id !== id));
    setDeletingIds((prev) => new Set(prev).add(id));

    if (id === activeChatId) onNewChat();

    try {
      await apiDeleteChat(id);
      onChatsChanged();
    } catch (e: unknown) {
      if (snapshot) {
        setLocalChats((prev) => {
          const next = [...prev];
          next.splice(snapshotIndex, 0, snapshot);
          return next;
        });
      }
      setError(e instanceof Error ? e.message : "Failed to delete chat");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const filtered = localChats.filter((c) =>
    (c.title || "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="history-modal-overlay" onClick={onClose}>
      <input
        autoFocus
        type="text"
        placeholder="Search history..."
        className="history-floating-input"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />
      {loading && localChats.length === 0 && (
        <div className="history-loading">Loading...</div>
      )}
      {error && <div className="history-error">{error}</div>}
      {!error && filtered.length > 0 && (
        <div
          className="history-floating-list"
          onClick={(e) => e.stopPropagation()}
        >
          {filtered.map((item) => (
            <div
              key={item.id}
              className={`history-result-item${activeChatId === item.id ? " active" : ""}`}
              onClick={() => {
                onSelectChat(item.id);
                onClose();
              }}
            >
              <div className="item-text-stack">
                <div className="item-header-row">
                  <span className="item-title">{item.title || "Untitled"}</span>
                  <span className="item-date">{formatDate(item.updated_at)}</span>
                </div>
              </div>
              <button
                className="history-delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(item.id);
                }}
                disabled={deletingIds.has(item.id)}
                title="Delete chat"
              >
                {deletingIds.has(item.id) ? "…" : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}
      {!loading && filtered.length === 0 && (
        <div className="history-empty">No history found.</div>
      )}
    </div>
  );
};

export default History;
