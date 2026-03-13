import React, { useEffect, useState } from "react";

interface HistoryItem {
  id: number;
  title: string;
  lastMessage: string;
  lastModified: string;
}

interface HistoryProps {
  onClose: () => void;
}

const History: React.FC<HistoryProps> = ({ onClose }) => {
  const [searchTerm, setSearchTerm] = useState("");

  const historyData: HistoryItem[] = [
    {
      id: 1,
      title: "Coming Soon",
      lastMessage: "User accounts & saved chat history",
      lastModified: "2026-03-12",
    },
  ];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

      {filteredHistory.length > 0 && (
        <div
          className="history-floating-list"
          onClick={(e) => e.stopPropagation()}
        >
          {filteredHistory.map((item) => (
            <button
              key={item.id}
              className="history-result-item"
              onClick={() => {
                console.log(`Loading chat ${item.id}`);
                onClose();
              }}
            >
              <div className="item-text-stack">
                <div className="item-header-row">
                  <span className="item-title">{item.title}</span>
                  <span className="item-date">{item.lastModified}</span>
                </div>
                <span className="item-preview">{item.lastMessage}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default History;
