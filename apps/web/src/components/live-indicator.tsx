'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useLiveEvents, type LiveEvent } from './use-live-events';

/** Small "Live" dot in the header; shows the latest alert as it arrives. */
export function LiveIndicator() {
  const [latestAlert, setLatestAlert] = useState<string | null>(null);
  const { connected } = useLiveEvents(['alert.created'], (event: LiveEvent) => {
    if (typeof event.message === 'string') setLatestAlert(event.message);
  });

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {latestAlert ? (
        <span className="hidden max-w-64 truncate rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 md:inline">
          {latestAlert}
        </span>
      ) : null}
      <span
        className={cn('h-2.5 w-2.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-slate-300')}
        title={connected ? 'Live updates connected' : 'Live updates disconnected'}
      />
      <span className="hidden text-xs text-muted-foreground md:inline">
        {connected ? 'Live' : 'Offline'}
      </span>
    </div>
  );
}
