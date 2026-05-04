import { useEffect, useRef, useState } from "react";
import type { Message } from "../api";

export function useChatUI(messages: Message[], loading: boolean) {
  const [sidebarOpen, setSidebarOpen] = useState(window.screen.width >= 1024);
  const [historySearch, setHistorySearch] = useState("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  // True when the user has scrolled up during a response, pausing auto-scroll
  const userScrolledUpRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  // When a new request starts, always resume auto-scroll so the new response is followed
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (loading && !prevLoadingRef.current) {
      userScrolledUpRef.current = false;
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 120;
      setShowScrollBtn(!nearBottom);

      if (nearBottom) {
        // User scrolled back to bottom — resume auto-scroll
        userScrolledUpRef.current = false;
      } else if (scrollTop < lastScrollTopRef.current - 10) {
        // User scrolled up intentionally (> 10px threshold ignores animation drift)
        userScrolledUpRef.current = true;
      }
      lastScrollTopRef.current = scrollTop;
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
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
