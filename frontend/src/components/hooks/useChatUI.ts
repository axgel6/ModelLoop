import { useEffect, useRef, useState } from "react";
import type { Message } from "../api";

export function useChatUI(messages: Message[]) {
  const [sidebarOpen, setSidebarOpen] = useState(window.screen.width >= 1024);
  const [historySearch, setHistorySearch] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120);
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container)
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  return {
    sidebarOpen,
    setSidebarOpen,
    historySearch,
    setHistorySearch,
    showLogoutConfirm,
    setShowLogoutConfirm,
    showScrollBtn,
    messagesContainerRef,
  };
}
