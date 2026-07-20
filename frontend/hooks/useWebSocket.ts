"use client";

import { useEffect, useRef, useCallback } from "react";
import type { WsMessage } from "@/types";
import { WS_URL } from "@/lib/config";

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const wsRef        = useRef<WebSocket | null>(null);
  const onMsgRef     = useRef(onMessage);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  onMsgRef.current = onMessage;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[WS] connected");
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WsMessage;
        onMsgRef.current(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      console.log("[WS] disconnected — reconnecting in 3s");
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    // Keep-alive ping every 20 s
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 20_000);

    ws.addEventListener("close", () => clearInterval(ping));
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
