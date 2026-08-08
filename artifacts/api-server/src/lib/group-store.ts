// In-memory unit group registry.
// Groups are created when a unit invites another. Cleaned up when empty.

export interface UnitGroup {
  id: string;
  memberUsernames: string[];
  createdAt: number;
}

export interface GroupInvite {
  id: string;
  fromUsername: string;
  fromCallsign: string;
  fromUnitNumber: string;
  toUsername: string;
  groupId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}

const groups  = new Map<string, UnitGroup>();
const invites = new Map<string, GroupInvite>();

let _seq = 0;
const uid = () => `${Date.now()}-${++_seq}`;

// ── Groups ────────────────────────────────────────────────────────────────────

export const getGroups = (): UnitGroup[] => Array.from(groups.values());

export const getGroupForUser = (username: string): UnitGroup | undefined =>
  Array.from(groups.values()).find(g => g.memberUsernames.includes(username));

export const createGroup = (username: string): UnitGroup => {
  const group: UnitGroup = { id: uid(), memberUsernames: [username], createdAt: Date.now() };
  groups.set(group.id, group);
  return group;
};

export const addToGroup = (groupId: string, username: string): boolean => {
  const group = groups.get(groupId);
  if (!group) return false;
  if (!group.memberUsernames.includes(username)) group.memberUsernames.push(username);
  return true;
};

export const removeFromGroup = (username: string): void => {
  for (const [id, group] of groups) {
    const idx = group.memberUsernames.indexOf(username);
    if (idx !== -1) {
      group.memberUsernames.splice(idx, 1);
      if (group.memberUsernames.length === 0) groups.delete(id);
    }
  }
};

// ── Invites ───────────────────────────────────────────────────────────────────

export const createInvite = (
  from: { username: string; callsign: string; unitNumber: string },
  toUsername: string,
  groupId: string
): GroupInvite => {
  // Cancel any existing pending invite from this user to this target
  for (const [id, inv] of invites) {
    if (inv.fromUsername === from.username && inv.toUsername === toUsername && inv.status === 'pending') {
      invites.delete(id);
    }
  }
  const invite: GroupInvite = {
    id: uid(),
    fromUsername: from.username,
    fromCallsign: from.callsign,
    fromUnitNumber: from.unitNumber,
    toUsername,
    groupId,
    status: 'pending',
    createdAt: Date.now(),
  };
  invites.set(invite.id, invite);
  return invite;
};

export const getPendingInvitesFor = (username: string): GroupInvite[] =>
  Array.from(invites.values()).filter(i => i.toUsername === username && i.status === 'pending');

export const respondToInvite = (inviteId: string, accepted: boolean): GroupInvite | null => {
  const invite = invites.get(inviteId);
  if (!invite || invite.status !== 'pending') return null;
  invite.status = accepted ? 'accepted' : 'rejected';
  if (accepted) {
    addToGroup(invite.groupId, invite.toUsername);
  }
  return invite;
};

// Clean up stale invites (>2 min old)
export const pruneInvites = (): void => {
  const cutoff = Date.now() - 2 * 60 * 1000;
  for (const [id, inv] of invites) {
    if (inv.createdAt < cutoff) invites.delete(id);
  }
};
