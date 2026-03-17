import React, { useEffect, useState } from "react";
import { apiListChats, apiDeleteChat } from "./api";
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

interface HistoryItem {
  id: string;
  title: string;
  lastMessage: string;
  lastModified: string;
}

interface HistoryProps {
  onClose: () => void;
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  historyKey?: number;
}

// ----- Component -----

const History: React.FC<HistoryProps> = ({
  onClose,
  activeChatId,
  onSelectChat,
  onNewChat,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [historyData, setHistoryData] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Fetch all chats on mount and map them to HistoryItems
  useEffect(() => {
    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const chats = await apiListChats();
        setHistoryData(
          chats.map((chat) => ({
            id: chat.id,
            title: chat.title || "Untitled",
            lastMessage: "",
            lastModified: chat.updated_at,
          })),
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, []);

  useEscapeKey(onClose);

  // ----- Handlers -----

  const handleDelete = async (id: string) => {
    const snapshot = historyData.find((item) => item.id === id);
    const snapshotIndex = historyData.findIndex((item) => item.id === id);

    // Optimistic removal so the list updates without a loading state
    setHistoryData((prev) => prev.filter((item) => item.id !== id));
    setDeletingIds((prev) => new Set(prev).add(id));

    if (id === activeChatId) onNewChat();

    try {
      await apiDeleteChat(id);
    } catch (e: unknown) {
      // Revert on failure — restore the item at its original position
      if (snapshot) {
        setHistoryData((prev) => {
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

  const filteredHistory = historyData.filter(
    (item) =>
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.lastMessage.toLowerCase().includes(searchTerm.toLowerCase()),
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
      {loading && <div className="history-loading">Loading...</div>}
      {error && <div className="history-error">{error}</div>}
      {!loading && !error && filteredHistory.length > 0 && (
        <div
          className="history-floating-list"
          onClick={(e) => e.stopPropagation()}
        >
          {filteredHistory.map((item) => (
            <div
              key={item.id}
              className={`history-result-item${activeChatId === item.id ? " active" : ""}`}
            >
              <div
                className="item-text-stack"
                onClick={() => {
                  onSelectChat(item.id);
                  onClose();
                }}
              >
                <div className="item-header-row">
                  <span className="item-title">{item.title}</span>
                  <span className="item-date">
                    {formatDate(item.lastModified)}
                  </span>
                </div>
                <span className="item-preview">{item.lastMessage}</span>
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
      {!loading && !error && filteredHistory.length === 0 && (
        <div className="history-empty">No history found.</div>
      )}
    </div>
  );
};

export default History;
