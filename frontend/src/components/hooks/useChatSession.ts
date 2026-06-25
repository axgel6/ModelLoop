import { useEffect, useRef, useState } from "react";
import { apiGetMessages, type Message } from "../api";

export function useChatSession(activeChatId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const messageCache = useRef<Map<string, Message[]>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef<string | null>(activeChatId);
  const justCreatedChatRef = useRef(false);

  activeChatIdRef.current = activeChatId;

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      setMessagesLoading(false);
      return;
    }
    if (justCreatedChatRef.current) {
      justCreatedChatRef.current = false;
      return;
    }

    let cancelled = false;

    const load = async () => {
      const cached = messageCache.current.get(activeChatId);
      if (cached) setMessages(cached);
      else setMessagesLoading(true);

      try {
        const msgs = await apiGetMessages(activeChatId);
        if (!cancelled) {
          messageCache.current.set(activeChatId, msgs);
          setMessages(msgs);
        }
      } catch {
        if (!cancelled) console.error("Failed to load messages for chat", activeChatId);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      setMessagesLoading(false);
    };
  }, [activeChatId]);

  useEffect(() => {
    return () => {
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
    messageCache,
    abortControllerRef,
    activeChatIdRef,
    justCreatedChatRef,
  };
}
