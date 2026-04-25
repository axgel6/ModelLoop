import { useEffect, useRef, useState } from "react";
import { apiGetMessages, type Message } from "../api";

export function useChatSession(activeChatId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageCache = useRef<Map<string, Message[]>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  const justCreatedChatRef = useRef(false);

  activeChatIdRef.current = activeChatId;

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    if (justCreatedChatRef.current) {
      justCreatedChatRef.current = false;
      return;
    }

    const load = async () => {
      const cached = messageCache.current.get(activeChatId);
      if (cached) setMessages(cached);
      else setMessagesLoading(true);

      try {
        const msgs = await apiGetMessages(activeChatId);
        messageCache.current.set(activeChatId, msgs);
        setMessages(msgs);
      } catch {
        console.error("Failed to load messages for chat", activeChatId);
      } finally {
        setMessagesLoading(false);
      }
    };

    void load();
  }, [activeChatId]);

  useEffect(() => {
    return () => {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    isThinking,
    setIsThinking,
    messagesLoading,
    thinkingTimerRef,
    messageCache,
    abortControllerRef,
    activeChatIdRef,
    justCreatedChatRef,
  };
}
