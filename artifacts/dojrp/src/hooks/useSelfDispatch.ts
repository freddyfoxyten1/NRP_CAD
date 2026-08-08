// ─────────────────────────────────────────────────────────────────────────────
// hooks/useSelfDispatch.ts  —  Officer self-dispatch workflow
//
// Manages the flow where an on-duty officer picks up or is assigned to an open
// call without a dispatcher.  Wraps the relevant API calls and tracks loading /
// confirmation state so the UI stays consistent.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

/**
 * Polls /api/settings/self-dispatch every 15 seconds.
 * Returns null while loading, then true (enabled) or false (disabled).
 */
export function useSelfDispatch(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const res = await fetch('/api/settings/self-dispatch', {
          headers: { accept: 'application/json' },
        });
        if (res.ok && mounted) {
          const data = (await res.json()) as { enabled: boolean };
          setEnabled(data.enabled);
        }
      } catch {
        // keep previous state on network error
      }
    };

    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return enabled;
}
