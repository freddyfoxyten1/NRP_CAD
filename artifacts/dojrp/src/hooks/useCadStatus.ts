// ─────────────────────────────────────────────────────────────────────────────
// hooks/useCadStatus.ts  —  CAD online/offline indicator
//
// Polls /api/settings/cad-status on an interval and returns whether the CAD
// terminal is currently open/online.  The status badge in the nav bar uses
// this hook to stay up to date.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

/**
 * Polls /api/settings/cad-status every 15 seconds.
 * Returns null while loading, then true (online) or false (offline).
 */
export function useCadStatus(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const res = await fetch('/api/settings/cad-status', {
          headers: { accept: 'application/json' },
        });
        if (res.ok && mounted) {
          const data = (await res.json()) as { online: boolean };
          setOnline(data.online);
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

  return online;
}
