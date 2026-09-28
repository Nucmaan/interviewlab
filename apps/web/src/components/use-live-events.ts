'use client';

import { useEffect, useRef, useState } from 'react';

export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Subscribes to /api/events (Server-Sent Events). `onEvent` is called for the listed event types.
 * EventSource reconnects by itself if the connection drops.
 */
export function useLiveEvents(types: readonly string[], onEvent?: (event: LiveEvent) => void) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);
  const typesKey = types.join(',');

  useEffect(() => {
    const source = new EventSource('/api/events');
    const listener = (message: MessageEvent<string>) => {
      try {
        handler.current?.(JSON.parse(message.data) as LiveEvent);
      } catch {
        // Ignore malformed messages; the next one will be fine.
      }
    };
    source.addEventListener('ready', () => setConnected(true));
    source.onerror = () => setConnected(false);
    const subscribed = typesKey.split(',').filter(Boolean);
    subscribed.forEach((type) => source.addEventListener(type, listener as EventListener));
    return () => {
      subscribed.forEach((type) => source.removeEventListener(type, listener as EventListener));
      source.close();
    };
  }, [typesKey]);

  return { connected };
}
