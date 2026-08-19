// ─────────────────────────────────────────────────────────────────────────────
// lib/cad-session.ts  —  CAD session storage
//
// Reads and writes the active officer session to localStorage.
// Discord sign-in sessions last 7 days, then the user must sign in again.
// Call getCadSession() to read, setCadSession() to write, clearCadSession() to
// sign out.  The session is shared across all pages via this module.
// ─────────────────────────────────────────────────────────────────────────────
import { applySuperAdminSessionOverrides } from '@/lib/superadmin';
const CAD_SESSION_KEY = 'west-coast-cad-session';
const DEFAULT_RANK = 'Community Member';
const DEFAULT_ROLE = 'Member';

/** How long a Discord sign-in stays valid before re-auth is required. */
export const CAD_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CadSession = {
  id: number;
  username: string;
  email: string;
  /** Legacy combined rank field — prefer dps_rank or staff_rank when available. */
  rank: string;
  /** Legacy combined role field — prefer staff_role when available. */
  role: string;
  status: string;
  dps_rank:   string | null;
  dps_role:   string | null;
  doc_rank:   string | null;
  staff_rank: string | null;
  staff_role: string | null;
  discord_id:  string | null;
  avatar_hash: string | null;
  /** Granted via DPS personnel roster or Admin staff roster */
  can_access_iab?: boolean;
  /** Admin Portal — System Logs tab */
  can_access_system_logs?: boolean;
  /** Admin Portal — Terms of Service & Privacy Policy tab */
  can_access_terms_privacy?: boolean;
  /** Sign-in during Terminal lockdown (staff roster grant) */
  can_access_terminal_offline?: boolean;
  /** Staff roster grant — view DOC & DPS CAD terminals without department roster membership */
  can_access_doc_dps_cad?: boolean;
  /** ISO timestamp when this local session expires (set on Discord login). */
  expires_at?: string;
};

type StoredCadSession = CadSession & { expires_at?: string };

const readStoredSession = (): StoredCadSession | null => {
  const raw = localStorage.getItem(CAD_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCadSession;
  } catch {
    localStorage.removeItem(CAD_SESSION_KEY);
    return null;
  }
};

const normalizeSession = (session: StoredCadSession): CadSession => {
  const rank = session.rank?.trim() || DEFAULT_RANK;
  const role = session.role?.includes('+') ? 'Admin' : session.role?.trim() || DEFAULT_ROLE;
  return applySuperAdminSessionOverrides({ ...session, rank, role });
};

const writeSession = (session: StoredCadSession) => {
  localStorage.setItem(CAD_SESSION_KEY, JSON.stringify(session));
};

/**
 * Persist the CAD session.
 * Pass `{ renewExpiry: true }` after a fresh Discord sign-in to start a new 7-day window.
 * Heartbeat / profile refreshes should omit that flag so expiry is preserved.
 */
export const setCadSession = (
  session: CadSession,
  options?: { renewExpiry?: boolean },
) => {
  const prev = readStoredSession();
  let expires_at = session.expires_at ?? prev?.expires_at;
  if (options?.renewExpiry || !expires_at) {
    expires_at = new Date(Date.now() + CAD_SESSION_TTL_MS).toISOString();
  }
  writeSession({ ...applySuperAdminSessionOverrides(session), expires_at });
};

export const getCadSession = (): CadSession | null => {
  const session = readStoredSession();
  if (!session) return null;

  // Migrate older sessions that have no expiry — grant one 7-day window.
  if (!session.expires_at) {
    const expires_at = new Date(Date.now() + CAD_SESSION_TTL_MS).toISOString();
    const next = { ...session, expires_at };
    writeSession(next);
    return normalizeSession(next);
  }

  if (Date.parse(session.expires_at) <= Date.now()) {
    localStorage.removeItem(CAD_SESSION_KEY);
    return null;
  }

  return normalizeSession(session);
};

export const clearCadSession = () => {
  localStorage.removeItem(CAD_SESSION_KEY);
};

/** True when a non-expired CAD session exists in localStorage. */
export const isCadSignedIn = (): boolean => getCadSession() != null;
