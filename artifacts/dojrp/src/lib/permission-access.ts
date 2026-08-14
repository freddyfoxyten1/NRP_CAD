export type PermissionBadge = {
  key: string;
  label: string;
  className: string;
};

const STAFF_PORTAL = 'border-[#2f66ee]/40 bg-[#2f66ee]/10 text-[#4384ff]';
const ADMIN_PORTAL = 'border-[#ff5d5d]/40 bg-[#ff5d5d]/10 text-[#ff7070]';
const DOC_PORTAL = 'border-[#3ecf8e]/40 bg-[#3ecf8e]/10 text-[#3ecf8e]';
const IAB = 'border-[#f4c542]/40 bg-[#f4c542]/10 text-[#f4c542]';
const LOGS = 'border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8]';
const LEGAL = 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#a78bfa]';
const TERMINAL = 'border-[#ff7070]/40 bg-[#ff7070]/10 text-[#ff9090]';
const CAD_VIEW = 'border-[#4384ff]/40 bg-[#4384ff]/10 text-[#4384ff]';
const DEPT_PANEL = 'border-[#f4c542]/40 bg-[#f4c542]/10 text-[#f4c542]';
const RESOURCES = 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#a78bfa]';
const DIVISION = 'border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8]';

type StaffGroupAccess = {
  name: string;
  staff_access: boolean;
  admin_access: boolean;
  doc_access: boolean;
};

type StaffMemberAccess = {
  staff_role: string | null;
  can_access_iab?: boolean;
  can_access_system_logs?: boolean;
  can_access_terms_privacy?: boolean;
  can_access_terminal_offline?: boolean;
  can_access_doc_dps_cad?: boolean;
};

/** Website-wide permissions granted via staff title or individual roster flags. */
export function collectStaffWebsitePermissions(
  member: StaffMemberAccess,
  groups: StaffGroupAccess[],
): PermissionBadge[] {
  const badges: PermissionBadge[] = [];
  const group = groups.find(g => g.name === member.staff_role);

  if (group?.staff_access) {
    badges.push({ key: 'staff_portal', label: 'Staff Portal', className: STAFF_PORTAL });
  }
  if (group?.admin_access) {
    badges.push({ key: 'admin_portal', label: 'Admin Portal', className: ADMIN_PORTAL });
  }
  if (group?.doc_access) {
    badges.push({ key: 'doc_portal', label: 'DOC Portal', className: DOC_PORTAL });
  }
  if (member.can_access_iab) {
    badges.push({ key: 'iab', label: 'IAB', className: IAB });
  }
  if (member.can_access_system_logs) {
    badges.push({ key: 'system_logs', label: 'System Logs', className: LOGS });
  }
  if (member.can_access_terms_privacy) {
    badges.push({ key: 'terms_privacy', label: 'TS & PP', className: LEGAL });
  }
  if (member.can_access_terminal_offline) {
    badges.push({ key: 'terminal_lockdown', label: 'Terminal Lockdown', className: TERMINAL });
  }
  if (member.can_access_doc_dps_cad) {
    badges.push({ key: 'doc_dps_cad', label: 'DOC & DPS CAD', className: CAD_VIEW });
  }

  return badges;
}

type DeptRank = { name: string; group_id: number | null };
type DeptGroup = { id: number; panel_access: boolean };
type DivisionAssignment = {
  division_id: number;
  division_name: string;
  can_edit_resources?: boolean;
  can_edit_roster?: boolean;
  can_edit_info?: boolean;
};

type DeptMemberAccess = {
  dps_rank?: string | null;
  dph_rank?: string | null;
  rank?: string | null;
  can_view_all_resources?: boolean;
  can_access_iab?: boolean;
  division_assignments?: DivisionAssignment[];
};

/** Department panel / resource / IAB / division editor permissions only. */
export function collectDepartmentPermissions(
  member: DeptMemberAccess,
  ranks: DeptRank[],
  groups: DeptGroup[],
): PermissionBadge[] {
  const badges: PermissionBadge[] = [];
  const rankName = (member.dps_rank ?? member.dph_rank ?? member.rank ?? '').trim().toLowerCase();
  const matchedRank = ranks.find(r => r.name.trim().toLowerCase() === rankName);
  const group = matchedRank?.group_id != null
    ? groups.find(g => g.id === matchedRank.group_id)
    : null;

  if (group?.panel_access) {
    badges.push({ key: 'dept_panel', label: 'Department Panel', className: DEPT_PANEL });
  }
  if (member.can_view_all_resources) {
    badges.push({ key: 'all_resources', label: 'All Resources', className: RESOURCES });
  }
  if (member.can_access_iab) {
    badges.push({ key: 'iab', label: 'IAB', className: IAB });
  }

  for (const assignment of member.division_assignments ?? []) {
    const parts: string[] = [];
    if (assignment.can_edit_roster) parts.push('Roster');
    if (assignment.can_edit_resources) parts.push('Resources');
    if (assignment.can_edit_info) parts.push('Info');
    if (parts.length === 0) continue;
    badges.push({
      key: `division-${assignment.division_id}`,
      label: `${assignment.division_name}: ${parts.join(', ')}`,
      className: DIVISION,
    });
  }

  return badges;
}
