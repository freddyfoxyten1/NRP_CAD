// ─────────────────────────────────────────────────────────────────────────────
// hooks/useCadData.ts  —  CAD roster & call data
//
// Fetches and caches roster members, active CAD units, and open calls from
// the API.  Returns loading/error state alongside the data so pages can show
// appropriate placeholders.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface CadUnit {
  username:  string;
  callsign:  string;
  dps_rank:  string;
  dps_role:  string | null;
  team:      string;
  status:    'Available' | 'Unavailable' | 'Busy' | 'Enroute' | 'On-Scene';
  location:  string;
}

export interface CadCall {
  id:        string;
  code:      string;
  title:     string;
  address:   string;
  postal:    string;
  units:     number;
  responders: string[];
  status:    string;
}

export interface CadGroup {
  name:       string;
  location:   string;
  department: string;
  status:     string;
  members:    string[];
  count:      number;
}

interface CadData {
  units:   CadUnit[];
  calls:   CadCall[];
  groups:  CadGroup[];
  loading: boolean;
  error:   string | null;
  lastUpdated: Date | null;
}

const POLL_INTERVAL = 15_000; // 15 seconds

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useCadData(): CadData {
  const [units,   setUnits]   = useState<CadUnit[]>([]);
  const [calls,   setCalls]   = useState<CadCall[]>([]);
  const [groups,  setGroups]  = useState<CadGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mounted = useRef(true);

  const refresh = async () => {
    const [u, c, g] = await Promise.all([
      safeFetch<CadUnit[]>('/api/erlc/units'),
      safeFetch<CadCall[]>('/api/erlc/calls'),
      safeFetch<CadGroup[]>('/api/erlc/groups'),
    ]);

    if (!mounted.current) return;

    if (u === null && c === null && g === null) {
      setError('Unable to reach ERLC. Check the API key or server status.');
    } else {
      setError(null);
    }

    if (u !== null) setUnits(u);
    if (c !== null) setCalls(c);
    if (g !== null) setGroups(g);
    setLastUpdated(new Date());
    setLoading(false);
  };

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { units, calls, groups, loading, error, lastUpdated };
}
