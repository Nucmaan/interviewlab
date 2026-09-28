'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useLiveEvents } from './use-live-events';

/**
 * Re-renders the current server page when one of the given live events arrives (at most once
 * every `minIntervalMs`), so lists and dashboards update without a manual reload.
 */
export function RefreshOnEvent({
  types,
  minIntervalMs = 2000,
}: {
  types: string[];
  minIntervalMs?: number;
}) {
  const router = useRouter();
  const last = useRef(0);
  useLiveEvents(types, () => {
    const now = Date.now();
    if (now - last.current < minIntervalMs) return;
    last.current = now;
    router.refresh();
  });
  return null;
}
