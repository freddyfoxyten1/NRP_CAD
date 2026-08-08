/**
 * Rank / title display helpers.
 *
 * Superadmin is an access flag only — it must never replace a user's
 * staff roster title (or invent a "Super Admin" rank).
 */

type RankFields = {
  rank?: string | null;
  role?: string | null;
  staff_rank?: string | null;
  staff_role?: string | null;
  dps_rank?: string | null;
};

const ROLE_LIKE = new Set([
  'community members',
  'executive team',
  'management',
  'admin',
  'moderation',
  'member',
]);

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Staff roster / Admin staff table title — roster title only. */
export function getStaffRosterTitle(profile: RankFields | null | undefined): string {
  const title = clean(profile?.staff_rank);
  return title || '—';
}

/** Sidebar label on Staff / Admin portals. */
export function getStaffSidebarTitle(profile: RankFields | null | undefined): string {
  const title = clean(profile?.staff_rank);
  return title || 'Staff Member';
}

/**
 * Member Portal display rank:
 * prefer staff title, then DPS title, then community rank.
 * Never treat a role-group name as a rank.
 */
export function getMemberDisplayRank(profile: RankFields | null | undefined): string {
  const staff = clean(profile?.staff_rank);
  if (staff) return staff;

  const dps = clean(profile?.dps_rank);
  if (dps) return dps;

  const community = clean(profile?.rank);
  if (community && !ROLE_LIKE.has(community.toLowerCase())) return community;
  if (community && community.toLowerCase() === 'member') return 'Community Member';

  return 'Community Member';
}

export function getMemberDisplayRole(profile: RankFields | null | undefined): string {
  const staffRole = clean(profile?.staff_role);
  if (staffRole) return staffRole;
  const role = clean(profile?.role);
  return role || 'Member';
}
