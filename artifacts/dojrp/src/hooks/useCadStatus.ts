// ─────────────────────────────────────────────────────────────────────────────
// hooks/useCadStatus.ts  —  CAD online / members-locked / lockdown indicator
//
// Polls /api/settings/cad-status on an interval and returns the terminal mode.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

export type CadMode = 'online' | 'members_locked' | 'lockdown';

export type CadStatus = {
  /** true only when mode === 'online' */
  online: boolean | null;
  mode: CadMode | null;
};

export function cadModeLabel(mode: CadMode | null | undefined): string {
  if (mode === 'members_locked') return 'Members Locked';
  if (mode === 'lockdown') return 'Lockdown';
  if (mode === 'online') return 'Online';
  return 'Online';
}

export function cadModeShortLabel(mode: CadMode | null | undefined): string {
  if (mode === 'members_locked') return 'Members Locked';
  if (mode === 'lockdown') return 'Lockdown';
  return 'Online';
}

/**
 * Polls /api/settings/cad-status every 15 seconds.
 * `online` is null while loading.
 */
export function useCadStatus(): CadStatus {
  const [status, setStatus] = useState<CadStatus>({ online: null, mode: null });

  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      try {
        const res = await fetch('/api/settings/cad-status', {
          headers: { accept: 'application/json' },
        });
        if (res.ok && mounted) {
          const data = (await res.json()) as { online?: boolean; mode?: string };
          const mode =
            data.mode === 'members_locked' || data.mode === 'lockdown' || data.mode === 'online'
              ? data.mode
              : data.online === false
                ? 'lockdown'
                : 'online';
          setStatus({ mode, online: mode === 'online' });
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

  return status;
}
