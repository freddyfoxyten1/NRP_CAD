import type { CadSession } from '@/lib/cad-session';
import { isSuperAdminSession } from '@/lib/superadmin';

const NON_ROSTER_RANKS = new Set(['', 'unranked', 'community member']);

/** True when the user has a real department roster rank (not community / unranked). */
export function hasDepartmentRosterRank(rank: string | null | undefined): boolean {
  const normalized = (rank ?? '').trim().toLowerCase();
  return normalized.length > 0 && !NON_ROSTER_RANKS.has(normalized);
}

export function canAccessDpsCad(session: CadSession | null | undefined): boolean {
  if (!session) return false;
  if (isSuperAdminSession(session)) return true;
  if (session.can_access_doc_dps_cad) return true;
  return hasDepartmentRosterRank(session.dps_rank);
}

export function canAccessDocCad(
  session: CadSession | null | undefined,
  docRank?: string | null,
): boolean {
  if (!session) return false;
  if (isSuperAdminSession(session)) return true;
  if (session.can_access_doc_dps_cad) return true;
  return hasDepartmentRosterRank(docRank ?? session.doc_rank);
}
