import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronRight, ChevronUp, ClipboardList, FileText, FolderOpen,
  GripVertical, Info, Layers, Pencil, Plus, Radio, RefreshCw, Search, Settings, Trash2, UserMinus, UserPlus, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { isPdfLikeResource, resourceTypeLabel } from '@/lib/resource-type';
import ImageInput from '@/components/shared/ImageInput';
import { ContentBlocksEditor, renderFormattedText, type ContentBlock } from '@/components/shared/ContentBlocks';
import { useDiscordPresence } from '@/hooks/useDiscordPresence';
import { DiscordStatusBadge } from '@/components/shared/DiscordStatusBadge';

export type DpsDivision = {
  id: number;
  name: string;
  sort_order: number;
  discord_role_id?: string | null;
  unit_key?: string | null;
};
export type DpsDivisionRank = {
  id: number;
  division_id: number | null;
  name: string;
  sort_order: number;
  color_hex: string | null;
  insignia_url: string | null;
  discord_role_id?: string | null;
  callsign_prefix?: string | null;
  callsign_type?: 'static' | 'dynamic' | 'custom' | null;
  callsign_static?: string | null;
  callsign_min?: number | null;
  callsign_max?: number | null;
};

type DpsPersonnelRank = {
  id: number;
  name: string;
  sort_order: number;
  color_hex: string | null;
  insignia_url: string | null;
};

function getPersonnelRankMeta(
  ranks: DpsPersonnelRank[],
  name: string | null | undefined,
): DpsPersonnelRank | null {
  if (!name?.trim()) return null;
  return ranks.find(r => r.name.toLowerCase() === name.toLowerCase().trim()) ?? null;
}

function RankWithInsignia({
  rankName,
  meta,
  className = 'text-[10px] font-black',
}: {
  rankName: string;
  meta: DpsPersonnelRank | DpsDivisionRank | null;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {meta?.insignia_url && (
        <img
          src={meta.insignia_url}
          alt=""
          className="h-4 w-4 object-contain shrink-0"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <span className={className} style={{ color: meta?.color_hex ?? '#a8b7cd' }}>
        {rankName}
      </span>
    </div>
  );
}

export type DivisionRosterMember = {
  id: number;
  username: string;
  discord_username: string;
  discord_id: string;
  avatar_hash: string;
  callsign: string;
  dps_rank?: string | null;
  dph_rank?: string | null;
  rank?: string;
  division_rank: string | null;
  division_name?: string | null;
  division_names?: string[];
  division_assignments?: Array<{
    division_id: number;
    division_name: string;
    division_rank: string;
    unit_key?: string | null;
    sort_order?: number;
    can_edit_resources?: boolean;
    can_edit_roster?: boolean;
    can_edit_info?: boolean;
  }>;
  /** Division ids where the member holds the linked membership Discord role. */
  division_discord_links?: number[];
  status: string;
  appointed_date: string | null;
  certifications?: string[];
};

type DivisionResource = {
  id: number;
  title: string;
  type: 'document' | 'pdf' | string;
  logo_url: string | null;
  google_file_id?: string | null;
  header_config?: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  division_id?: number | null;
  division_only?: boolean;
  allowed_ranks?: string[];
};

type DivisionPanelMode = 'roster' | 'resources' | 'info';

export const DEFAULT_DIVISION_API_BASE = '/api/roster';
export const DEFAULT_DIVISION_RESOURCES_BASE = '/api/resources';

/**
 * Lets a department mount these components against its own endpoints.
 * Omitting both keeps the DPS routes.
 */
export type DivisionApiBases = {
  apiBase?: string;
  resourcesBase?: string;
};

function canViewDivisionResource(
  resource: DivisionResource,
  viewerRank: string | null | undefined,
  opts?: { bypass?: boolean },
) {
  if (opts?.bypass) return true;
  const ranks = Array.isArray(resource.allowed_ranks) ? resource.allowed_ranks : [];
  if (ranks.length === 0) return true;
  const rank = (viewerRank ?? '').trim().toLowerCase();
  if (!rank) return false;
  return ranks.some(r => r.trim().toLowerCase() === rank);
}

function memberDepartmentRank(m: DivisionRosterMember): string | null {
  return m.dps_rank ?? m.dph_rank ?? m.rank ?? null;
}

function memberAssignments(m: DivisionRosterMember) {
  if (Array.isArray(m.division_assignments) && m.division_assignments.length > 0) {
    return m.division_assignments;
  }
  // Legacy single-assignment fallback
  if (m.division_rank?.trim() && m.division_name?.trim() && m.division_name !== 'Unassigned') {
    return [{
      division_id: 0,
      division_name: m.division_name,
      division_rank: m.division_rank,
    }];
  }
  return [];
}

function assignmentForDivision(m: DivisionRosterMember, division: DpsDivision) {
  return memberAssignments(m).find(a =>
    a.division_id === division.id || a.division_name.toLowerCase() === division.name.toLowerCase()
  ) ?? null;
}

function memberInDivisionRoster(m: DivisionRosterMember, division: DpsDivision): boolean {
  const hasDiscordLink = Boolean(division.discord_role_id?.trim());
  if (hasDiscordLink) {
    if (Array.isArray(m.division_discord_links)) {
      if (m.division_discord_links.includes(division.id)) return true;
      if (m.division_discord_links.length > 0) return false;
    }
    return assignmentForDivision(m, division) != null;
  }
  return assignmentForDivision(m, division) != null;
}

import { compareCallsigns } from '@/lib/roster-sort';

function byCallsign(a: DivisionRosterMember, b: DivisionRosterMember) {
  return compareCallsigns(a.callsign, b.callsign);
}

/** Sort members by division rank hierarchy (sort_order), then callsign within the same rank. */
function sortMembersByDivisionRank(
  list: DivisionRosterMember[],
  division: DpsDivision,
  ranks: DpsDivisionRank[],
) {
  const order = new Map(ranks.map((r, i) => [r.name.toLowerCase(), r.sort_order ?? i]));
  const unrankedSort = 999_999;
  return [...list].sort((a, b) => {
    const rankA = (assignmentForDivision(a, division)?.division_rank ?? '').trim();
    const rankB = (assignmentForDivision(b, division)?.division_rank ?? '').trim();
    const sortA = rankA.toLowerCase() === 'unranked'
      ? unrankedSort
      : (order.has(rankA.toLowerCase()) ? order.get(rankA.toLowerCase())! : 9999);
    const sortB = rankB.toLowerCase() === 'unranked'
      ? unrankedSort
      : (order.has(rankB.toLowerCase()) ? order.get(rankB.toLowerCase())! : 9999);
    if (sortA !== sortB) return sortA - sortB;
    if (rankA.toLowerCase() !== rankB.toLowerCase()) return rankA.localeCompare(rankB);
    return byCallsign(a, b) || a.username.localeCompare(b.username);
  });
}

function divisionShortLabel(d: Pick<DpsDivision, 'name' | 'unit_key'>): string {
  const key = (d.unit_key ?? '').trim();
  if (key) return key.toUpperCase();
  const n = d.name.trim().toLowerCase();
  if (n.includes('patrol') || n === 'pob') return 'POB';
  if (n.includes('internal affairs') || n === 'iab') return 'IAB';
  if (n.includes('high speed') || n === 'hsu') return 'HSU';
  if (n.includes('special response') || n === 'sru') return 'SRU';
  if (n.includes('field operations') || n === 'fou') return 'FOU';
  const initials = d.name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 4);
  return (initials || d.name).toUpperCase();
}

type DiscordAvatarProps = {
  name: string;
  discordId?: string;
  avatarHash?: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const active = status?.toLowerCase() === 'active';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${active ? 'bg-emerald-500 text-white' : 'bg-[#1a2638] text-[#526179]'}`}>
      {status ?? 'Inactive'}
    </span>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return d; }
}

/**
 * Public Division Roster tab — pick a division card first, then open Roster or Resources.
 */
export function DivisionRosterView({
  members,
  loading,
  DiscordAvatar,
  onOpenResource,
  viewerDiscordId = null,
  bypassDivisionRestrictions = false,
  apiBase = DEFAULT_DIVISION_API_BASE,
  resourcesBase = DEFAULT_DIVISION_RESOURCES_BASE,
}: {
  members: DivisionRosterMember[];
  loading: boolean;
  DiscordAvatar: React.ComponentType<DiscordAvatarProps>;
  onOpenResource?: (resource: DivisionResource) => void;
  viewerDiscordId?: string | null;
  /** Staff exec / title oversight — see every division roster & restricted resources */
  bypassDivisionRestrictions?: boolean;
} & DivisionApiBases) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [divisions, setDivisions] = useState<DpsDivision[]>([]);
  const [divisionRanks, setDivisionRanks] = useState<DpsDivisionRank[]>([]);
  const [personnelRanks, setPersonnelRanks] = useState<DpsPersonnelRank[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | null>(null);
  const [panelMode, setPanelMode] = useState<DivisionPanelMode>('roster');
  const [cardSearch, setCardSearch] = useState('');
  const [divisionResources, setDivisionResources] = useState<DivisionResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  const discordIds = useMemo(() => members.map(m => m.discord_id), [members]);
  const discordPresence = useDiscordPresence(discordIds);

  useEffect(() => {
    fetch(`${apiBase}/divisions`, { headers: { accept: 'application/json' } })
      .then(r => r.json()).then(rows => setDivisions(Array.isArray(rows) ? rows : [])).catch(() => setDivisions([]));
    fetch(`${apiBase}/division-ranks`, { headers: { accept: 'application/json' } })
      .then(r => r.json()).then(rows => setDivisionRanks(Array.isArray(rows) ? rows : [])).catch(() => setDivisionRanks([]));
    fetch(`${apiBase}/ranks`, { headers: { accept: 'application/json' } })
      .then(r => r.json()).then(rows => setPersonnelRanks(Array.isArray(rows) ? rows : [])).catch(() => setPersonnelRanks([]));
  }, [apiBase]);

  const selectedDivision = selectedDivisionId != null
    ? divisions.find(d => d.id === selectedDivisionId) ?? null
    : null;

  // If the selected division was deleted, return to the card grid
  useEffect(() => {
    if (selectedDivisionId == null) return;
    if (divisions.length > 0 && !divisions.some(d => d.id === selectedDivisionId)) {
      setSelectedDivisionId(null);
    }
  }, [divisions, selectedDivisionId]);

  useEffect(() => {
    if (selectedDivisionId == null || panelMode !== 'resources') return;
    let cancelled = false;
    setResourcesLoading(true);
    fetch(`${resourcesBase}?division_id=${selectedDivisionId}`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((rows: DivisionResource[]) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setDivisionResources(list.filter(r => r.division_id === selectedDivisionId));
      })
      .catch(() => {
        if (!cancelled) {
          setDivisionResources([]);
          toast.error('Failed to load division resources.');
        }
      })
      .finally(() => { if (!cancelled) setResourcesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDivisionId, panelMode, resourcesBase]);

  const openDivision = (id: number, mode: DivisionPanelMode) => {
    setSelectedDivisionId(id);
    setPanelMode(mode);
    setSearch('');
    setCollapsed({});
  };

  const backToCards = () => {
    setSelectedDivisionId(null);
    setPanelMode('roster');
    setSearch('');
    setCollapsed({});
    setDivisionResources([]);
  };

  const ranksForDivision = (divisionId: number) =>
    divisionRanks
      .filter(r => r.division_id === divisionId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const membersInDivision = (division: DpsDivision) =>
    members.filter(m => memberInDivisionRoster(m, division));

  const getDpsRankMeta = (name: string | null | undefined) =>
    getPersonnelRankMeta(personnelRanks, name);

  const getDivRankMeta = (divisionId: number, name: string | null | undefined) => {
    if (!name?.trim()) return null;
    const ranks = ranksForDivision(divisionId);
    return ranks.find(r => r.name.toLowerCase() === name.toLowerCase().trim()) ?? null;
  };

  const viewerMember = viewerDiscordId
    ? members.find(m => m.discord_id === viewerDiscordId) ?? null
    : null;

  const canAccessDivision = (division: DpsDivision) => {
    if (bypassDivisionRestrictions) return true;
    // Avoid flashing empty / kicking users out while the roster is still loading
    if (loading) return true;
    if (!viewerMember) return false;
    return memberInDivisionRoster(viewerMember, division);
  };

  // If selection is no longer allowed after membership resolves, return to cards
  useEffect(() => {
    if (loading || selectedDivision == null || bypassDivisionRestrictions) return;
    if (!viewerMember || !memberInDivisionRoster(viewerMember, selectedDivision)) {
      setSelectedDivisionId(null);
      setPanelMode('roster');
    }
  }, [loading, selectedDivision, bypassDivisionRestrictions, viewerMember]);

  // ── Landing: division cards ────────────────────────────────────────────────
  if (selectedDivision == null) {
    const q = cardSearch.toLowerCase().trim();
    const visibleDivisions = [...divisions]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .filter(d => {
        if (!canAccessDivision(d)) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q)
          || divisionShortLabel(d).toLowerCase().includes(q)
          || (d.unit_key ?? '').toLowerCase().includes(q)
        );
      });

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 max-w-sm min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#526179]" />
            <input
              type="text"
              placeholder="Search divisions…"
              value={cardSearch}
              onChange={e => setCardSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#0d1422] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
            />
          </div>
          <span className="shrink-0 text-[10px] font-black text-[#526179]">
            {visibleDivisions.length} division{visibleDivisions.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading && divisions.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-[#172235] bg-[#0d1422]">
            <Layers className="h-8 w-8 text-[#1e2e42] animate-pulse" />
            <p className="text-sm font-bold text-[#3f5470]">Loading divisions…</p>
          </div>
        ) : visibleDivisions.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-[#172235] bg-[#0d1422]">
            <Layers className="h-8 w-8 text-[#1e2e42]" />
            <p className="text-sm font-bold text-[#3f5470]">
              {cardSearch
                ? 'No divisions match your search.'
                : divisions.length > 0
                  ? 'You are not assigned to any divisions.'
                  : 'No divisions configured yet.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleDivisions.map(d => {
              const ranks = ranksForDivision(d.id);
              const count = membersInDivision(d).length;
              return (
                <div
                  key={d.id}
                  className="group relative flex flex-col rounded-2xl border border-[#172235] bg-[#0d1422] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.22)] transition-all hover:border-[#22d3ee]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="mb-5 flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/8">
                      <span className="text-[11px] font-black tracking-wide text-[#22d3ee]">
                        {divisionShortLabel(d)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-black text-white">{d.name}</h3>
                      <p className="mt-1 text-[10px] font-semibold text-[#526179]">
                        Choose roster or resources
                      </p>
                    </div>
                  </div>
                  <div className="mb-4 flex gap-2">
                    <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-2.5 py-2 text-center">
                      <p className="text-base font-black text-white">{count}</p>
                      <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#3f5470]">Members</p>
                    </div>
                    <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-2.5 py-2 text-center">
                      <p className="text-base font-black text-white">{ranks.length}</p>
                      <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#3f5470]">Ranks</p>
                    </div>
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => openDivision(d.id, 'roster')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#4384ff]/35 bg-[#4384ff]/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#4384ff] transition-colors hover:bg-[#4384ff]/18 hover:border-[#4384ff]/55"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Roster
                    </button>
                    <button
                      type="button"
                      onClick={() => openDivision(d.id, 'resources')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#a78bfa] transition-colors hover:bg-[#a78bfa]/18 hover:border-[#a78bfa]/55"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      Resources
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const detailHeader = (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#172235] px-5 py-4">
      <button
        type="button"
        onClick={backToCards}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#8392aa] transition-colors hover:border-[#2f70ff] hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Divisions
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="rounded-md border border-[#22d3ee]/25 bg-[#22d3ee]/10 px-2 py-0.5 text-[10px] font-black tracking-wide text-[#22d3ee]">
          {divisionShortLabel(selectedDivision)}
        </span>
        <h2 className="truncate text-sm font-black text-white">{selectedDivision.name}</h2>
      </div>
      <div className="flex rounded-lg border border-[#1f3050] bg-[#07111f] p-0.5">
        <button
          type="button"
          onClick={() => setPanelMode('roster')}
          className={`rounded-md px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
            panelMode === 'roster' ? 'bg-[#4384ff]/20 text-[#4384ff]' : 'text-[#526179] hover:text-white'
          }`}
        >
          Roster
        </button>
        <button
          type="button"
          onClick={() => setPanelMode('resources')}
          className={`rounded-md px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
            panelMode === 'resources' ? 'bg-[#a78bfa]/20 text-[#a78bfa]' : 'text-[#526179] hover:text-white'
          }`}
        >
          Resources
        </button>
      </div>
    </div>
  );

  // ── Resources detail ───────────────────────────────────────────────────────
  if (panelMode === 'resources') {
    const viewerRank = selectedDivision && viewerMember
      ? assignmentForDivision(viewerMember, selectedDivision)?.division_rank ?? null
      : null;
    const visibleResources = divisionResources.filter(r =>
      canViewDivisionResource(r, viewerRank, { bypass: bypassDivisionRestrictions })
    );
    return (
      <div className="rounded-xl border border-[#172235] bg-[#0d1422] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
        {detailHeader}
        <div className="p-5">
          {resourcesLoading ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-2">
              <BookOpen className="h-8 w-8 text-[#1e2e42] animate-pulse" />
              <p className="text-sm font-bold text-[#3f5470]">Loading resources…</p>
            </div>
          ) : visibleResources.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                <BookOpen className="h-7 w-7 text-[#a78bfa]/70" />
              </div>
              <div>
                <p className="text-sm font-black text-[#526179]">No resources for this division</p>
                <p className="mt-1 text-xs text-[#3f5470]">
                  Division guides and materials will appear here when posted.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleResources.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onOpenResource?.(r)}
                  className="group relative flex flex-col gap-3 rounded-2xl border border-[#1e2d42] bg-[#07111f] p-5 text-left transition-all hover:border-[#a78bfa]/40"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                    <FileText className="h-5 w-5 text-[#a78bfa]" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{r.title}</p>
                    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                      {resourceTypeLabel(r)}
                    </p>
                  </div>
                  <p className="text-[10px] text-[#3f5470]">
                    {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Detail: one division’s roster (personnel-style, grouped by division ranks) ──
  const divRanks = ranksForDivision(selectedDivision.id);
  const divisionMembers = membersInDivision(selectedDivision);
  const filtered = divisionMembers.filter(m => {
    const q = search.toLowerCase();
    if (!q) return true;
    const assign = assignmentForDivision(m, selectedDivision);
    return (
      m.username.toLowerCase().includes(q)
      || (assign?.division_rank ?? '').toLowerCase().includes(q)
      || (memberDepartmentRank(m) ?? '').toLowerCase().includes(q)
      || (m.callsign ?? '').toLowerCase().includes(q)
      || (m.discord_username ?? '').toLowerCase().includes(q)
      || (m.discord_id ?? '').includes(q)
    );
  });

  const groupedByRank = (() => {
    const groups: Array<{
      label: string;
      sort: number;
      rank: DpsDivisionRank | null;
      members: DivisionRosterMember[];
    }> = divRanks.map(r => ({
      label: r.name,
      sort: r.sort_order,
      rank: r,
      members: filtered
        .filter(m => {
          const assign = assignmentForDivision(m, selectedDivision);
          return (assign?.division_rank ?? '').toLowerCase() === r.name.toLowerCase();
        })
        .sort(byCallsign),
    }));
    const known = new Set(divRanks.map(r => r.name.toLowerCase()));
    const orphans = filtered.filter(m => {
      const assign = assignmentForDivision(m, selectedDivision);
      const rankName = (assign?.division_rank ?? '').trim();
      return rankName && !known.has(rankName.toLowerCase());
    });
    if (orphans.length > 0) {
      const byOrphan = new Map<string, DivisionRosterMember[]>();
      for (const m of orphans) {
        const label = assignmentForDivision(m, selectedDivision)!.division_rank;
        if (!byOrphan.has(label)) byOrphan.set(label, []);
        byOrphan.get(label)!.push(m);
      }
      for (const [label, list] of byOrphan) {
        groups.push({
          label,
          sort: label.toLowerCase() === 'unranked' ? 999_999 : 999,
          rank: null,
          members: list.sort(byCallsign),
        });
      }
    }
    // Defined ranks first (by sort_order), then any orphan ranks
    return groups
      .filter(g => g.rank != null || g.members.length > 0)
      .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  })();

  const toggle = (label: string) => setCollapsed(p => ({ ...p, [label]: !p[label] }));
  const colCount = 9;

  return (
    <div className="rounded-xl border border-[#172235] bg-[#0d1422] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
      {detailHeader}
      <div className="flex flex-wrap items-center gap-3 border-b border-[#172235] px-5 py-3">
        <div className="relative w-full max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#526179]" />
          <input
            type="text"
            placeholder="Search by name, division rank, callsign…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
          />
        </div>
        <span className="shrink-0 text-[10px] font-black text-[#526179]">
          {filtered.length} member{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {filtered.length === 0 && divRanks.length === 0 ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
          <Users className="h-8 w-8 text-[#1e2e42]" />
          <p className="text-sm font-bold text-[#3f5470]">
            {search ? 'No members match your search.' : 'No ranks or members in this division yet.'}
          </p>
        </div>
      ) : filtered.length === 0 && search ? (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
          <Users className="h-8 w-8 text-[#1e2e42]" />
          <p className="text-sm font-bold text-[#3f5470]">No members match your search.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#131f30]">
                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Name</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Division Rank</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-36">DPS Rank</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-24">Callsign</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-20">Status</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-28">Discord Status</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-28">Appointed</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord ID</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Certifications</th>
              </tr>
            </thead>
            <tbody>
              {groupedByRank.map(group => {
                const rankMeta = group.rank ?? getDivRankMeta(selectedDivision.id, group.label);
                return (
                  <React.Fragment key={group.label}>
                    <tr
                      className="cursor-pointer border-b border-t border-[#172235] bg-[#0a1525] hover:bg-[#0c1830] transition-colors"
                      onClick={() => toggle(group.label)}
                    >
                      <td colSpan={colCount} className="px-5 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {collapsed[group.label]
                            ? <ChevronRight className="h-3.5 w-3.5 text-[#4384ff] shrink-0" />
                            : <ChevronDown className="h-3.5 w-3.5 text-[#4384ff] shrink-0" />}
                          {rankMeta?.insignia_url && (
                            <img
                              src={rankMeta.insignia_url}
                              alt=""
                              className="h-4 w-4 object-contain shrink-0"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <span
                            className="text-xs font-black"
                            style={{ color: rankMeta?.color_hex ?? '#ffffff' }}
                          >
                            {group.label}
                          </span>
                          <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">
                            {group.members.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {!collapsed[group.label] && group.members.length === 0 && (
                      <tr className="border-b border-[#0f1b28]">
                        <td colSpan={colCount} className="px-5 py-3 text-[11px] text-[#3f5470]">
                          No officers at this rank.
                        </td>
                      </tr>
                    )}
                    {!collapsed[group.label] && group.members.map(m => {
                      const assign = assignmentForDivision(m, selectedDivision);
                      const memberRankMeta = getDivRankMeta(selectedDivision.id, assign?.division_rank);
                      const chipColor = memberRankMeta?.color_hex ?? rankMeta?.color_hex ?? null;
                      return (
                        <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <DiscordAvatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                              <span className="text-xs font-black text-white">{m.username || '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1.5">
                              {memberRankMeta?.insignia_url && (
                                <img
                                  src={memberRankMeta.insignia_url}
                                  alt=""
                                  className="h-4 w-4 object-contain shrink-0"
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              )}
                              <span className="text-[10px] font-black" style={{ color: chipColor ?? '#a8b7cd' }}>
                                {assign?.division_rank || '—'}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <RankWithInsignia
                              rankName={memberDepartmentRank(m) || '—'}
                              meta={getDpsRankMeta(memberDepartmentRank(m))}
                            />
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="inline-flex items-center rounded border border-[#1b2d44] bg-[#070d16] px-2 py-0.5 font-mono text-[10px] font-black text-[#4384ff]">
                              {m.callsign || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                          <td className="px-4 py-3.5">
                            <DiscordStatusBadge
                              status={m.discord_id ? (discordPresence[m.discord_id] ?? 'offline') : 'offline'}
                            />
                          </td>
                          <td className="px-4 py-3.5 text-[#8392aa]">{formatDate(m.appointed_date)}</td>
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-[11px] text-[#526179]">{m.discord_id || '—'}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-wrap gap-1">
                              {(m.certifications?.length ?? 0) > 0
                                ? m.certifications!.map(c => (
                                    <span key={c} className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-black text-[#6a8aaa]">{c}</span>
                                  ))
                                : <span className="text-[#2a3a50]">—</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Department Panel landing card */
export function DivisionPanelCard({
  memberCount,
  rankCount,
  divisionCount,
  onEdit,
}: {
  memberCount: number;
  rankCount: number;
  divisionCount: number;
  onEdit: () => void;
}) {
  return (
    <div className="group relative rounded-2xl border border-[#22d3ee]/20 bg-[#0d1422] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#22d3ee]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/40 to-transparent" />
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/8">
          <Layers className="h-6 w-6 text-[#22d3ee]" />
        </div>
        <div>
          <h3 className="text-base font-black text-white">Divisions</h3>
          <p className="mt-1 text-xs text-[#526179] leading-relaxed">
            Manage divisions, ranks, roster assignments, resources, and division information.
          </p>
        </div>
      </div>
      <div className="mb-6 flex gap-4">
        <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-3 py-2.5 text-center">
          <p className="text-lg font-black text-white">{memberCount || '—'}</p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Members</p>
        </div>
        <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-3 py-2.5 text-center">
          <p className="text-lg font-black text-white">{rankCount || '—'}</p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Ranks</p>
        </div>
        <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-3 py-2.5 text-center">
          <p className="text-lg font-black text-white">{divisionCount || '—'}</p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Divisions</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/8 py-3 text-xs font-black text-[#22d3ee] transition-all hover:bg-[#22d3ee]/15 hover:border-[#22d3ee]/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.12)]">
        <Pencil className="h-3.5 w-3.5" />
        Edit Divisions
      </button>
    </div>
  );
}

type DivisionInfoBlock =
  | { type: 'text'; body: string }
  | { type: 'heading'; text: string }
  | { type: 'bold_heading'; text: string }
  | { type: 'divider' }
  | { type: 'thumbnail'; url: string; caption: string }
  | { type: 'footer'; text: string };

function renderDivisionInfoBlocks(sections: DivisionInfoBlock[]) {
  if (!sections.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
          <Info className="h-7 w-7 text-[#a78bfa]/60" />
        </div>
        <div>
          <p className="text-sm font-black text-[#526179]">No information posted</p>
          <p className="mt-1 text-xs text-[#3f5470]">This division has not published an information section yet.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {sections.map((blk, i) => {
        if (blk.type === 'divider') return <hr key={i} className="my-2 border-[#1e2d42]" />;
        if (blk.type === 'heading') {
          return (
            <h3 key={i} className="pt-2 text-xs font-black uppercase tracking-[0.18em] text-[#4384ff]">
              {blk.text}
            </h3>
          );
        }
        if (blk.type === 'bold_heading') {
          return (
            <h2 key={i} className="pt-2 text-base font-black text-white">
              {blk.text}
            </h2>
          );
        }
        if (blk.type === 'thumbnail') {
          return (
            <div key={i} className="overflow-hidden rounded-xl border border-[#1e2d42]">
              <img src={blk.url} alt={blk.caption || ''} className="max-h-64 w-full object-cover" />
              {blk.caption ? (
                <p className="bg-[#0d1422] px-4 py-2 text-[11px] italic text-[#526179]">{blk.caption}</p>
              ) : null}
            </div>
          );
        }
        if (blk.type === 'footer') {
          return (
            <div key={i} className="pt-1">{renderFormattedText(blk.text, { className: "whitespace-pre-wrap text-[11px] italic leading-relaxed text-[#3f5470]", bulletClassName: "list-disc space-y-1 pl-5 text-[11px] italic leading-relaxed text-[#3f5470]" })}</div>
          );
        }
        return (
          <div key={i} className="rounded-2xl border border-[#1e2d42] bg-[#0d1422] px-7 py-6">
            {renderFormattedText(blk.body, { className: "whitespace-pre-wrap text-xs leading-relaxed text-[#8392aa]", bulletClassName: "list-disc space-y-1 pl-5 text-xs leading-relaxed text-[#8392aa]" })}
          </div>
        );
      })}
    </div>
  );
}

/** Public sidebar tab — Divisions Information */
export function DivisionsInformationView({
  members,
  loading,
  viewerDiscordId = null,
  bypassDivisionRestrictions = false,
  apiBase = DEFAULT_DIVISION_API_BASE,
}: {
  members: DivisionRosterMember[];
  loading: boolean;
  viewerDiscordId?: string | null;
  bypassDivisionRestrictions?: boolean;
} & DivisionApiBases) {
  const [divisions, setDivisions] = useState<DpsDivision[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [infoLoading, setInfoLoading] = useState(false);
  const [sections, setSections] = useState<DivisionInfoBlock[]>([]);

  useEffect(() => {
    fetch(`${apiBase}/divisions`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then(rows => setDivisions(Array.isArray(rows) ? rows : []))
      .catch(() => setDivisions([]));
  }, [apiBase]);

  const selectedDivision = selectedDivisionId != null
    ? divisions.find(d => d.id === selectedDivisionId) ?? null
    : null;

  const viewerMember = viewerDiscordId
    ? members.find(m => m.discord_id === viewerDiscordId) ?? null
    : null;

  const canAccessDivision = (division: DpsDivision) => {
    if (bypassDivisionRestrictions) return true;
    if (loading) return true;
    if (!viewerMember) return false;
    return memberInDivisionRoster(viewerMember, division);
  };

  useEffect(() => {
    if (loading || selectedDivision == null || bypassDivisionRestrictions) return;
    if (!viewerMember || !memberInDivisionRoster(viewerMember, selectedDivision)) {
      setSelectedDivisionId(null);
    }
  }, [loading, selectedDivision, bypassDivisionRestrictions, viewerMember]);

  useEffect(() => {
    if (selectedDivisionId == null) {
      setSections([]);
      return;
    }
    let cancelled = false;
    setInfoLoading(true);
    fetch(`${apiBase}/divisions/${selectedDivisionId}/info`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((d: { sections?: DivisionInfoBlock[] }) => {
        if (cancelled) return;
        setSections(Array.isArray(d.sections) ? d.sections : []);
      })
      .catch(() => {
        if (!cancelled) {
          setSections([]);
          toast.error('Failed to load division information.');
        }
      })
      .finally(() => { if (!cancelled) setInfoLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDivisionId, apiBase]);

  if (selectedDivision == null) {
    const q = cardSearch.toLowerCase().trim();
    const visibleDivisions = [...divisions]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .filter(d => {
        if (!canAccessDivision(d)) return false;
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q)
          || divisionShortLabel(d).toLowerCase().includes(q)
          || (d.unit_key ?? '').toLowerCase().includes(q)
        );
      });

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative max-w-sm min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#526179]" />
            <input
              type="text"
              placeholder="Search divisions…"
              value={cardSearch}
              onChange={e => setCardSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#0d1422] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
            />
          </div>
          <span className="shrink-0 text-[10px] font-black text-[#526179]">
            {visibleDivisions.length} division{visibleDivisions.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading && divisions.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-[#172235] bg-[#0d1422]">
            <Info className="h-8 w-8 animate-pulse text-[#1e2e42]" />
            <p className="text-sm font-bold text-[#3f5470]">Loading divisions…</p>
          </div>
        ) : visibleDivisions.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-[#172235] bg-[#0d1422]">
            <Info className="h-8 w-8 text-[#1e2e42]" />
            <p className="text-sm font-bold text-[#3f5470]">
              {cardSearch
                ? 'No divisions match your search.'
                : divisions.length > 0
                  ? 'You are not assigned to any divisions.'
                  : 'No divisions configured yet.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleDivisions.map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedDivisionId(d.id)}
                className="group relative flex flex-col rounded-2xl border border-[#172235] bg-[#0d1422] p-6 text-left shadow-[0_18px_40px_rgba(0,0,0,0.22)] transition-all hover:border-[#a78bfa]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]"
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#a78bfa]/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                    <span className="text-[11px] font-black tracking-wide text-[#a78bfa]">
                      {divisionShortLabel(d)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-black text-white">{d.name}</h3>
                    <p className="mt-1 text-[10px] font-semibold text-[#526179]">
                      View division information
                    </p>
                  </div>
                </div>
                <span className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#a78bfa] transition-colors group-hover:bg-[#a78bfa]/18">
                  <Info className="h-3.5 w-3.5" />
                  Open
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => setSelectedDivisionId(null)}
        className="flex items-center gap-2 text-xs font-black text-[#526179] transition-colors hover:text-[#a78bfa]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Divisions Information
        <span className="text-[#2a3a50]">/</span>
        <span className="text-[#a78bfa]">{selectedDivision.name}</span>
      </button>
      {infoLoading ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-[#172235] bg-[#0d1422]">
          <Info className="h-8 w-8 animate-pulse text-[#1e2e42]" />
          <p className="text-sm font-bold text-[#3f5470]">Loading information…</p>
        </div>
      ) : (
        renderDivisionInfoBlocks(sections)
      )}
    </div>
  );
}

/** Department Panel landing card — Division Information */
export function DivisionInfoPanelCard({
  divisionCount,
  onEdit,
}: {
  divisionCount: number;
  onEdit: () => void;
}) {
  return (
    <div className="group relative rounded-2xl border border-[#a78bfa]/20 bg-[#0d1422] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#a78bfa]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#a78bfa]/40 to-transparent" />
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
          <Info className="h-6 w-6 text-[#a78bfa]" />
        </div>
        <div>
          <h3 className="text-base font-black text-white">Division Information</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#526179]">
            Edit the information section shown for each division on the Divisions Information tab.
          </p>
        </div>
      </div>
      <div className="mb-6 flex gap-4">
        <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-3 py-2.5 text-center">
          <p className="text-lg font-black text-white">{divisionCount || '—'}</p>
          <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Divisions</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#a78bfa]/30 bg-[#a78bfa]/8 py-3 text-xs font-black text-[#a78bfa] transition-all hover:border-[#a78bfa]/50 hover:bg-[#a78bfa]/15 hover:shadow-[0_0_20px_rgba(167,139,250,0.12)]"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit Division Information
      </button>
    </div>
  );
}

type DivisionRankEditModalProps = {
  rank: DpsDivisionRank;
  onClose: () => void;
  onSaved: () => void;
} & DivisionApiBases;

type DivisionCustomCallsign = {
  id: number;
  division_rank_id: number;
  callsign: string;
  assigned_profile_id: number | null;
  assigned_username?: string | null;
  sort_order?: number;
};

type DivisionRankMember = {
  id: number;
  username: string;
  discord_username: string | null;
  discord_id: string | null;
  avatar_hash: string | null;
  callsign: string | null;
  status: string | null;
};

type DivisionRankDetail = DpsDivisionRank & {
  members: DivisionRankMember[];
  custom_callsigns: DivisionCustomCallsign[];
};

type DivisionRankEditForm = {
  name: string;
  color_hex: string;
  callsign_prefix: string;
  insignia_url: string;
  discord_role_id: string;
  callsign_type: 'static' | 'dynamic' | 'custom';
  callsign_static: string;
  callsign_static_suffix: boolean;
  callsign_min: string;
  callsign_max: string;
};

function DivisionRankEditModal({
  rank,
  discordRoles,
  DiscordAvatar,
  onClose,
  onSaved,
  apiBase = DEFAULT_DIVISION_API_BASE,
}: DivisionRankEditModalProps & {
  discordRoles: DiscordGuildRole[];
  DiscordAvatar: React.ComponentType<DiscordAvatarProps>;
}) {
  const labelCls = 'mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]';
  const inputCls = 'h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff]';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<DivisionRankDetail | null>(null);
  const [form, setForm] = useState<DivisionRankEditForm>({
    name: rank.name,
    color_hex: rank.color_hex ?? '#22d3ee',
    callsign_prefix: '',
    insignia_url: rank.insignia_url ?? '',
    discord_role_id: rank.discord_role_id ?? '',
    callsign_type: 'static',
    callsign_static: '0',
    callsign_static_suffix: false,
    callsign_min: '0',
    callsign_max: '0',
  });
  const [customSlots, setCustomSlots] = useState<DivisionCustomCallsign[]>([]);
  const [newSlotText, setNewSlotText] = useState('');
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const set = <K extends keyof DivisionRankEditForm>(k: K, v: DivisionRankEditForm[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    setLoading(true);
    fetch(`${apiBase}/division-ranks/${rank.id}`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((d: DivisionRankDetail) => {
        setDetail(d);
        setForm({
          name: d.name,
          color_hex: d.color_hex ?? '#22d3ee',
          callsign_prefix: d.callsign_prefix ?? '',
          insignia_url: d.insignia_url ?? '',
          discord_role_id: d.discord_role_id ?? '',
          callsign_type: d.callsign_type === 'dynamic' ? 'dynamic' : d.callsign_type === 'custom' ? 'custom' : 'static',
          callsign_static: (d.callsign_static && d.callsign_static !== 'XX') ? d.callsign_static : '0',
          callsign_static_suffix: d.callsign_static != null && d.callsign_static !== 'XX',
          callsign_min: d.callsign_min != null ? String(d.callsign_min) : '0',
          callsign_max: d.callsign_max != null ? String(d.callsign_max) : '0',
        });
        setCustomSlots(d.custom_callsigns ?? []);
        if (d.callsign_type === 'dynamic' && (d.members?.length ?? 0) > 0) {
          void fetch(`${apiBase}/division-ranks/${rank.id}/auto-assign-callsigns`, { method: 'POST' })
            .then(r => (r.ok ? r.json() : null))
            .then((data: { results: { profile_id: number; callsign: string }[] } | null) => {
              if (!data) return;
              const csMap = new Map(data.results.map(x => [x.profile_id, x.callsign]));
              setDetail(prev => prev ? {
                ...prev,
                members: prev.members.map(m => ({ ...m, callsign: csMap.get(m.id) ?? m.callsign })),
              } : prev);
            })
            .catch(() => {});
        }
      })
      .catch(() => toast.error('Failed to load division rank.'))
      .finally(() => setLoading(false));
  }, [rank.id, apiBase]);

  const autoAssignAll = async () => {
    try {
      const r = await fetch(`${apiBase}/division-ranks/${rank.id}/auto-assign-callsigns`, { method: 'POST' });
      if (!r.ok) return;
      const { results } = await r.json() as { results: { profile_id: number; callsign: string }[] };
      const csMap = new Map(results.map(x => [x.profile_id, x.callsign]));
      setDetail(prev => prev ? {
        ...prev,
        members: prev.members.map(m => ({ ...m, callsign: csMap.get(m.id) ?? m.callsign })),
      } : prev);
    } catch { /* non-fatal */ }
  };

  const reorderSlots = async (newOrder: DivisionCustomCallsign[]) => {
    setCustomSlots(newOrder);
    await fetch(`${apiBase}/division-ranks/${rank.id}/custom-callsigns/reorder`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: newOrder.map(s => s.id) }),
    });
  };

  const addCustomSlot = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    const r = await fetch(`${apiBase}/division-ranks/${rank.id}/custom-callsigns`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callsign: t }),
    });
    if (!r.ok) return;
    const slot = await r.json() as DivisionCustomCallsign;
    setCustomSlots(prev => [...prev, slot]);
  };

  const deleteCustomSlot = async (csId: number) => {
    const slot = customSlots.find(s => s.id === csId);
    await fetch(`${apiBase}/division-rank-callsigns/${csId}`, { method: 'DELETE' });
    setCustomSlots(prev => prev.filter(s => s.id !== csId));
    if (slot?.assigned_profile_id) {
      setDetail(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.id === slot.assigned_profile_id ? { ...m, callsign: '4D-XX' } : m),
      } : prev);
    }
  };

  const updateSlotCallsign = async (csId: number, callsign: string) => {
    if (!callsign.trim()) return;
    const r = await fetch(`${apiBase}/division-rank-callsigns/${csId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callsign }),
    });
    if (!r.ok) return;
    const updated = await r.json() as DivisionCustomCallsign;
    setCustomSlots(prev => prev.map(s => s.id === csId ? updated : s));
    if (updated.assigned_profile_id) {
      setDetail(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.id === updated.assigned_profile_id ? { ...m, callsign: updated.callsign } : m),
      } : prev);
    }
  };

  const assignMemberToSlot = async (csId: number, profileId: number | null) => {
    const prevSlot = customSlots.find(s => s.id === csId);
    const prevAssigneeId = prevSlot?.assigned_profile_id ?? null;
    const r = await fetch(`${apiBase}/division-rank-callsigns/${csId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assigned_profile_id: profileId }),
    });
    if (!r.ok) return;
    const updated = await r.json() as DivisionCustomCallsign;
    setCustomSlots(prev => prev.map(s => s.id === csId ? updated : s));
    setDetail(prev => {
      if (!prev) return prev;
      let members = prev.members;
      if (prevAssigneeId && prevAssigneeId !== profileId) {
        members = members.map(m => m.id === prevAssigneeId ? { ...m, callsign: '4D-XX' } : m);
      }
      if (updated.assigned_profile_id) {
        members = members.map(m => m.id === updated.assigned_profile_id ? { ...m, callsign: updated.callsign } : m);
      }
      return { ...prev, members };
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/division-ranks/${rank.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          color_hex: form.color_hex || null,
          insignia_url: form.insignia_url.trim() || null,
          discord_role_id: form.discord_role_id.trim() || null,
          callsign_prefix: form.callsign_prefix.trim() || null,
          callsign_type: form.callsign_type,
          callsign_static: form.callsign_type === 'static'
            ? (form.callsign_static_suffix ? (form.callsign_static.trim() || '0') : 'XX')
            : null,
          callsign_min: form.callsign_type === 'dynamic' ? (parseInt(form.callsign_min) || 0) : null,
          callsign_max: form.callsign_type === 'dynamic' ? (parseInt(form.callsign_max) || 0) : null,
        }),
      });
      if (!res.ok) throw new Error('Failed to update division rank.');
      if (form.callsign_type === 'dynamic') void autoAssignAll();
      toast.success(form.discord_role_id.trim() ? 'Division rank saved — Discord sync triggered.' : 'Division rank updated.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1e2d42] bg-[#0d1422] shadow-2xl my-auto">
        <div className="flex items-center justify-between border-b border-[#172235] px-7 py-5">
          <h3 className="text-base font-black text-white">Edit Division Rank</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="px-7 py-12 text-center text-xs text-[#526179]">Loading…</div>
        ) : (
          <form onSubmit={save}>
            <div className="space-y-4 px-7 py-5 max-h-[70vh] overflow-y-auto">
              <div>
                <label className={labelCls}>Name</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.color_hex || '#22d3ee'} onChange={e => set('color_hex', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-[#1f3050] bg-[#07111f]" />
                  <input value={form.color_hex} onChange={e => set('color_hex', e.target.value)}
                    className="h-9 flex-1 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 font-mono text-xs text-white outline-none focus:border-[#2f70ff]" />
                </div>
              </div>

              {/* Callsign configuration — same system as personnel roster */}
              <div className="space-y-3">
                {form.callsign_type !== 'custom' && (
                  <div>
                    <label className={labelCls}>Callsign Prefix <span className="text-[#3f5470] normal-case font-normal">(optional)</span></label>
                    <input type="text" placeholder="e.g. 1D, 2D, 3D" value={form.callsign_prefix}
                      onChange={e => set('callsign_prefix', e.target.value)} className={inputCls} />
                    <p className="mt-1.5 text-[10px] text-[#3f5470]">
                      First segment of the callsign (e.g. <span className="font-mono">3D</span>). A dash is inserted automatically before the suffix.
                    </p>
                  </div>
                )}

                <div>
                  <label className={labelCls}>Callsign Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['static', 'dynamic', 'custom'] as const).map(t => (
                      <button key={t} type="button" onClick={() => set('callsign_type', t)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-colors ${
                          form.callsign_type === t
                            ? 'border-[#4384ff] bg-[#4384ff]/10 text-white'
                            : 'border-[#1f3050] bg-[#070d16] text-[#526179] hover:border-[#2a4060]'
                        }`}>
                        <span className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                          form.callsign_type === t ? 'border-[#4384ff] bg-[#4384ff]' : 'border-[#3f5470]'
                        }`}>
                          {form.callsign_type === t && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                        {t === 'static' ? 'Static' : t === 'dynamic' ? 'Dynamic' : 'Custom'}
                      </button>
                    ))}
                  </div>

                  {form.callsign_type === 'static' && (
                    <div className="mt-3 space-y-2">
                      <button type="button"
                        onClick={() => set('callsign_static_suffix', !form.callsign_static_suffix)}
                        className="flex items-center gap-2 text-[10px] text-[#a8b7cd] hover:text-white transition-colors">
                        <div className={`relative h-4 w-7 rounded-full transition-colors ${form.callsign_static_suffix ? 'bg-[#4384ff]' : 'bg-[#1f3050]'}`}>
                          <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${form.callsign_static_suffix ? 'left-3.5' : 'left-0.5'}`} />
                        </div>
                        Include number suffix
                      </button>
                      {form.callsign_static_suffix && (
                        <div>
                          <label className="block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470] mb-1.5">Number</label>
                          <div className="flex items-center gap-2">
                            <button type="button"
                              onClick={() => set('callsign_static', String(Math.max(0, parseInt(form.callsign_static) - 1 || 0)))}
                              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[#1f3050] bg-[#070d16] text-[#a8b7cd] hover:bg-white/5 font-black">−</button>
                            <input type="number" min={0} value={form.callsign_static}
                              onChange={e => set('callsign_static', e.target.value)}
                              className={`${inputCls} text-center font-mono flex-1`} />
                            <button type="button"
                              onClick={() => set('callsign_static', String((parseInt(form.callsign_static) || 0) + 1))}
                              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[#1f3050] bg-[#070d16] text-[#a8b7cd] hover:bg-white/5 font-black">+</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {form.callsign_type === 'dynamic' && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470] mb-1.5">From</label>
                        <div className="flex items-center gap-2">
                          <button type="button"
                            onClick={() => set('callsign_min', String(Math.max(0, (parseInt(form.callsign_min) || 0) - 1)))}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[#1f3050] bg-[#070d16] text-[#a8b7cd] hover:bg-white/5 font-black">−</button>
                          <input type="number" min={0} value={form.callsign_min}
                            onChange={e => set('callsign_min', e.target.value)}
                            className={`${inputCls} text-center font-mono flex-1`} />
                          <button type="button"
                            onClick={() => set('callsign_min', String((parseInt(form.callsign_min) || 0) + 1))}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[#1f3050] bg-[#070d16] text-[#a8b7cd] hover:bg-white/5 font-black">+</button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470] mb-1.5">To</label>
                        <div className="flex items-center gap-2">
                          <button type="button"
                            onClick={() => set('callsign_max', String(Math.max(0, (parseInt(form.callsign_max) || 0) - 1)))}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[#1f3050] bg-[#070d16] text-[#a8b7cd] hover:bg-white/5 font-black">−</button>
                          <input type="number" min={0} value={form.callsign_max}
                            onChange={e => set('callsign_max', e.target.value)}
                            className={`${inputCls} text-center font-mono flex-1`} />
                          <button type="button"
                            onClick={() => set('callsign_max', String((parseInt(form.callsign_max) || 0) + 1))}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-[#1f3050] bg-[#070d16] text-[#a8b7cd] hover:bg-white/5 font-black">+</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {form.callsign_type === 'custom' && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[10px] text-[#3f5470] mb-2">
                        Create named callsign slots and assign a member from this division rank to each one. Changes save immediately.
                      </p>
                      {customSlots.map((slot, index) => (
                        <div
                          key={slot.id}
                          draggable
                          onDragStart={() => { dragIndexRef.current = index; }}
                          onDragOver={e => { e.preventDefault(); setDragOverIndex(index); }}
                          onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
                          onDrop={e => {
                            e.preventDefault();
                            const from = dragIndexRef.current;
                            if (from === null || from === index) { setDragOverIndex(null); return; }
                            const next = [...customSlots];
                            const [moved] = next.splice(from, 1);
                            next.splice(index, 0, moved);
                            dragIndexRef.current = null;
                            setDragOverIndex(null);
                            void reorderSlots(next);
                          }}
                          className={`flex items-center gap-2 rounded transition-colors ${dragOverIndex === index ? 'opacity-40' : ''}`}
                        >
                          <span className="shrink-0 cursor-grab active:cursor-grabbing text-[#2a3a50] hover:text-[#526179]">
                            <GripVertical className="h-4 w-4" />
                          </span>
                          <input
                            type="text"
                            defaultValue={slot.callsign}
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== slot.callsign) void updateSlotCallsign(slot.id, v);
                            }}
                            className="w-28 shrink-0 rounded border border-[#1f3050] bg-[#070d16] px-2 py-1.5 font-mono text-[10px] text-white outline-none focus:border-[#4384ff]"
                          />
                          <select
                            value={slot.assigned_profile_id ?? ''}
                            onChange={e => void assignMemberToSlot(slot.id, e.target.value ? Number(e.target.value) : null)}
                            className="flex-1 h-7 rounded border border-[#1f3050] bg-[#070d16] px-2 text-[10px] text-white outline-none focus:border-[#4384ff] appearance-none cursor-pointer"
                          >
                            <option value="">— Unassigned —</option>
                            {detail?.members.map(m => (
                              <option key={m.id} value={m.id}>{m.username}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => void deleteCustomSlot(slot.id)}
                            className="h-7 w-7 shrink-0 flex items-center justify-center rounded border border-[#1f3050] bg-[#070d16] text-[#526179] hover:bg-red-900/30 hover:text-red-400 hover:border-red-800 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text" placeholder="e.g. CHIEF-1" value={newSlotText}
                          onChange={e => setNewSlotText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void addCustomSlot(newSlotText);
                              setNewSlotText('');
                            }
                          }}
                          className="w-28 shrink-0 rounded border border-[#172235] bg-[#07111f] px-2 py-1.5 font-mono text-[10px] text-[#a8b7cd] placeholder:text-[#2a3a50] outline-none focus:border-[#4384ff]"
                        />
                        <button type="button"
                          onClick={() => { if (newSlotText.trim()) { void addCustomSlot(newSlotText); setNewSlotText(''); } }}
                          className="h-7 flex items-center gap-1 rounded border border-[#172235] bg-[#070d16] px-2.5 text-[10px] font-bold text-[#a8b7cd] hover:bg-white/5 transition-colors">
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      </div>
                    </div>
                  )}

                  {form.callsign_type !== 'custom' && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-[10px] text-[#3f5470]">Preview:</span>
                      <span className="rounded border border-[#1f3050] bg-[#070d16] px-2 py-0.5 font-mono text-[11px] text-[#4384ff]">
                        {(() => {
                          const pre = form.callsign_prefix.trim();
                          const sep = pre ? '-' : '';
                          if (form.callsign_type === 'static') {
                            return form.callsign_static_suffix
                              ? `${pre}${sep}${form.callsign_static || '0'}`
                              : `${pre}${sep}XX`;
                          }
                          const mn = parseInt(form.callsign_min) || 0;
                          const mx = parseInt(form.callsign_max) || 0;
                          const pad = Math.max(String(mx).length, 2);
                          return `${pre}${sep}${String(mn).padStart(pad, '0')} – ${pre}${sep}${String(mx).padStart(pad, '0')}`;
                        })()}
                      </span>
                      {form.callsign_type === 'dynamic' && (
                        <span className="text-[10px] text-[#3f5470]">auto-assigned in order</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <ImageInput
                value={form.insignia_url}
                onChange={v => set('insignia_url', v)}
                label="Insignia Image"
                accent="#4384ff"
                hint="Badge or insignia — paste a URL or upload a file."
                labelClassName={labelCls}
                previewHeight="h-24"
              />

              <div>
                <label className={labelCls}>Discord Role</label>
                <select
                  value={form.discord_role_id}
                  onChange={e => set('discord_role_id', e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  <option value="">— No Discord role linked —</option>
                  {discordRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-[#3f5470]">
                  Optional — link a role from the Division Discord guild.
                </p>
              </div>
            </div>

            <div className="border-t border-[#172235] px-7 pt-5 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-3.5 w-3.5 text-[#4384ff]" />
                <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Members with this rank</span>
                <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#526179]">{detail?.members.length ?? 0}</span>
                {(form.callsign_type === 'dynamic' || form.callsign_type === 'static') && (
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={async () => {
                      setSyncing(true);
                      try { await autoAssignAll(); } finally { setSyncing(false); }
                    }}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#2f66ee]/40 bg-[#2f66ee]/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#4384ff] hover:bg-[#2f66ee]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Radio className="h-3 w-3" />
                    {syncing ? 'Syncing…' : 'Sync Callsigns'}
                  </button>
                )}
              </div>
              {!detail?.members.length ? (
                <p className="text-[11px] text-[#2a3a50]">No officers currently hold this division rank.</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {detail.members.map(m => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#0f1b28] bg-[#070d16] px-3 py-2">
                      <DiscordAvatar
                        name={m.discord_username || m.username}
                        discordId={m.discord_id ?? ''}
                        avatarHash={m.avatar_hash ?? ''}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-white truncate">{m.username}</p>
                        {m.discord_username && <p className="text-[10px] text-[#526179]">@{m.discord_username}</p>}
                      </div>
                      <span className="shrink-0 font-black text-[10px] text-[#4384ff]">{m.callsign || '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-[#172235] px-7 py-5">
              <button type="button" onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs font-black text-[#526179] hover:text-white">Cancel</button>
              <button type="submit" disabled={saving || !form.name.trim()}
                className="rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Add officer to a specific division (manual — not cleared by Discord sync). */
function DivisionAddOfficerModal({
  division,
  ranks,
  onClose,
  onAdded,
  apiBase = DEFAULT_DIVISION_API_BASE,
  personNoun = 'officer',
}: {
  division: DpsDivision;
  ranks: DpsDivisionRank[];
  onClose: () => void;
  onAdded: () => void;
  personNoun?: 'officer' | 'member';
} & DivisionApiBases) {
  const personNounTitle = personNoun.charAt(0).toUpperCase() + personNoun.slice(1);
  const personNounPlural = `${personNoun}s`;
  type UserHit = { id: number | null; username: string; discord_username: string; discord_id: string; rank: string };
  const [username, setUsername] = useState('');
  const [discordUsername, setDiscordUsername] = useState('');
  const [discordId, setDiscordId] = useState('');
  const [profileId, setProfileId] = useState<number | null>(null);
  const [divisionRank, setDivisionRank] = useState(ranks[ranks.length - 1]?.name ?? ranks[0]?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<UserHit[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowSugg(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const onUsernameChange = (val: string) => {
    setUsername(val);
    setProfileId(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); setShowSugg(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${apiBase}/member-search?q=${encodeURIComponent(val.trim())}`,
          { headers: { accept: 'application/json' } });
        if (!r.ok) { setSuggestions([]); setShowSugg(false); return; }
        const rows = await r.json();
        const list = Array.isArray(rows) ? rows as UserHit[] : [];
        setSuggestions(list);
        setShowSugg(list.length > 0);
      } catch { /* ignore */ }
    }, 280);
  };

  const pickUser = (hit: UserHit) => {
    setUsername(hit.username);
    setDiscordUsername(hit.discord_username || '');
    setDiscordId(hit.discord_id || '');
    setProfileId(hit.id);
    setSuggestions([]);
    setShowSugg(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    if (!divisionRank.trim()) {
      toast.error('Select a division rank.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/divisions/${division.id}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profile_id: profileId ?? undefined,
          username: username.trim(),
          discord_username: discordUsername.trim(),
          discord_id: discordId.trim(),
          division_rank: divisionRank.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Failed to add ${personNoun}.`);
      }
      toast.success(`${username.trim()} added to ${division.name}.`);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to add ${personNoun}.`);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff]';
  const labelCls = 'mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#0d1422] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-white">Add {personNounTitle}</h3>
            <p className="mt-1 text-[10px] font-semibold text-[#526179]">{division.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div ref={wrapRef} className="relative">
            <label className={labelCls}>Search Discord / CAD member</label>
            <input
              type="text"
              required
              autoComplete="off"
              placeholder="Start typing a name…"
              value={username}
              onChange={e => onUsernameChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSugg(true)}
              className={inputCls}
            />
            {profileId != null && (
              <p className="mt-1 text-[10px] font-black text-emerald-400">CAD profile selected</p>
            )}
            {showSugg && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[#1f3050] bg-[#0a1525] shadow-xl">
                {suggestions.map(hit => (
                  <li key={`${hit.id ?? 'x'}-${hit.discord_id}-${hit.username}`}>
                    <button
                      type="button"
                      onClick={() => pickUser(hit)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#122038]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black text-white">{hit.username}</span>
                        {hit.discord_username && (
                          <span className="block truncate text-[10px] text-[#526179]">@{hit.discord_username}</span>
                        )}
                      </span>
                      {hit.rank && <span className="shrink-0 text-[9px] font-bold text-[#3f5470]">{hit.rank}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className={labelCls}>Division Rank</label>
            <select
              value={divisionRank}
              onChange={e => setDivisionRank(e.target.value)}
              className={`${inputCls} cursor-pointer`}
              required
            >
              {ranks.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] text-[#3f5470]">
              Manually added {personNounPlural} stay on this roster even without the linked Discord role until removed.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-black text-[#526179] hover:text-white">Cancel</button>
            <button type="submit" disabled={saving || !username.trim() || !divisionRank}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-40">
              <UserPlus className="h-3.5 w-3.5" />
              {saving ? 'Adding…' : `Add ${personNounTitle}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Department Panel — Division Roster editor */
export function DivisionPanelSection({
  members,
  membersLoading,
  DiscordAvatar,
  onBack,
  onMembersChanged,
  onOpenResource,
  onAddResource,
  onDeleteResource,
  deletingResourceId = null,
  resourcesRefreshKey = 0,
  fullAccess = true,
  divisionAccess = [],
  actor = 'DPS Panel',
  personNoun = 'officer',
  apiBase = DEFAULT_DIVISION_API_BASE,
  resourcesBase = DEFAULT_DIVISION_RESOURCES_BASE,
}: {
  members: DivisionRosterMember[];
  membersLoading: boolean;
  DiscordAvatar: React.ComponentType<DiscordAvatarProps>;
  onBack: () => void;
  onMembersChanged: () => void;
  onOpenResource: (resource: DivisionResource, canEdit: boolean) => void;
  onAddResource: (divisionId: number) => void;
  onDeleteResource: (id: number) => void | Promise<void>;
  deletingResourceId?: number | null;
  resourcesRefreshKey?: number;
  fullAccess?: boolean;
  divisionAccess?: Array<{
    division_id: number;
    can_edit_resources: boolean;
    can_edit_roster: boolean;
    can_edit_info?: boolean;
  }>;
  actor?: string;
  /** Singular noun for roster people — DPS uses "officer", DPH uses "member". */
  personNoun?: 'officer' | 'member';
} & DivisionApiBases) {
  const personNounPlural = `${personNoun}s`;
  const personNounTitle = personNoun.charAt(0).toUpperCase() + personNoun.slice(1);
  const [divisions, setDivisions] = useState<DpsDivision[]>([]);
  const [divisionRanks, setDivisionRanks] = useState<DpsDivisionRank[]>([]);
  const [personnelRanks, setPersonnelRanks] = useState<DpsPersonnelRank[]>([]);
  const [discordRoles, setDiscordRoles] = useState<DiscordGuildRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | null>(null);
  const [panelMode, setPanelMode] = useState<DivisionPanelMode>('roster');
  const [search, setSearch] = useState('');
  const [addDivisionOpen, setAddDivisionOpen] = useState(false);
  const [newDivisionName, setNewDivisionName] = useState('');
  const [newDivisionDiscordRoleId, setNewDivisionDiscordRoleId] = useState('');
  const [addingDivision, setAddingDivision] = useState(false);
  const [editingDivisionId, setEditingDivisionId] = useState<number | null>(null);
  const [editingDivisionName, setEditingDivisionName] = useState('');
  const [editingDivisionDiscordRoleId, setEditingDivisionDiscordRoleId] = useState('');
  const [addingRank, setAddingRank] = useState(false);
  const [addRankOpen, setAddRankOpen] = useState(false);
  const [newRankName, setNewRankName] = useState('');
  const [newRankDiscordRoleId, setNewRankDiscordRoleId] = useState('');
  const [editRank, setEditRank] = useState<DpsDivisionRank | null>(null);
  const [dragRankId, setDragRankId] = useState<number | null>(null);
  const [dragOverRankId, setDragOverRankId] = useState<number | null>(null);
  const [dragOverSide, setDragOverSide] = useState<'before' | 'after'>('after');
  const [divisionResources, setDivisionResources] = useState<DivisionResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [infoSections, setInfoSections] = useState<DivisionInfoBlock[]>([{ type: 'text', body: '' }]);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoSaving, setInfoSaving] = useState(false);
  const [addOfficerOpen, setAddOfficerOpen] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [accessSavingKey, setAccessSavingKey] = useState<string | null>(null);
  const [syncingDiscord, setSyncingDiscord] = useState(false);

  const panelDiscordIds = useMemo(() => members.map(m => m.discord_id), [members]);
  const panelDiscordPresence = useDiscordPresence(panelDiscordIds);

  const handleSyncDivisionDiscord = async () => {
    setSyncingDiscord(true);
    try {
      const res = await fetch(`${apiBase}/sync-division-discord-roles`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as {
        assigned?: number;
        removed?: number;
        pruned?: number;
        errors?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Division Discord sync failed.');
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      const assigned = data.assigned ?? 0;
      const removed = (data.removed ?? 0) + (data.pruned ?? 0);
      if (errCount > 0) {
        toast.error(`Division sync finished with ${errCount} error(s). Added/updated ${assigned}, removed ${removed}.`);
      } else {
        toast.success(`Division Discord sync complete — updated ${assigned}, removed ${removed}.`);
      }
      onMembersChanged();
      refresh({ silent: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Division Discord sync failed.');
    } finally {
      setSyncingDiscord(false);
    }
  };

  const refresh = (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? divisions.length > 0;
    if (!silent) setLoading(true);
    Promise.all([
      fetch(`${apiBase}/divisions`, { headers: { accept: 'application/json' } }).then(r => r.json()),
      fetch(`${apiBase}/division-ranks`, { headers: { accept: 'application/json' } }).then(r => r.json()),
      fetch(`${apiBase}/ranks`, { headers: { accept: 'application/json' } }).then(r => r.json()),
      fetch(`${apiBase}/division-discord-roles?refresh=1`, { headers: { accept: 'application/json' } })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([divs, ranks, personnel, roles]) => {
        setDivisions(Array.isArray(divs) ? divs : []);
        setDivisionRanks(Array.isArray(ranks) ? ranks : []);
        setPersonnelRanks(Array.isArray(personnel) ? personnel : []);
        setDiscordRoles(Array.isArray(roles) ? roles : []);
      })
      .catch(() => toast.error('Failed to load divisions.'))
      .finally(() => { if (!silent) setLoading(false); });
  };

  useEffect(() => { refresh({ silent: false }); }, []);

  useEffect(() => {
    if (!addRankOpen && !editRank && !addDivisionOpen && editingDivisionId == null) return;
    fetch(`${apiBase}/division-discord-roles?refresh=1`, { headers: { accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : []))
      .then(roles => setDiscordRoles(Array.isArray(roles) ? roles : []))
      .catch(() => {});
  }, [addRankOpen, editRank, addDivisionOpen, editingDivisionId, apiBase]);

  const selectedDivision = selectedDivisionId != null
    ? divisions.find(d => d.id === selectedDivisionId) ?? null
    : null;

  useEffect(() => {
    if (selectedDivisionId == null) return;
    if (divisions.length > 0 && !divisions.some(d => d.id === selectedDivisionId)) {
      setSelectedDivisionId(null);
      setPanelMode('roster');
    }
  }, [divisions, selectedDivisionId]);

  useEffect(() => {
    if (selectedDivisionId == null || panelMode !== 'resources') return;
    let cancelled = false;
    setResourcesLoading(true);
    fetch(`${resourcesBase}?division_id=${selectedDivisionId}`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((rows: DivisionResource[]) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setDivisionResources(list.filter(r => r.division_id === selectedDivisionId));
      })
      .catch(() => {
        if (!cancelled) {
          setDivisionResources([]);
          toast.error('Failed to load division resources.');
        }
      })
      .finally(() => { if (!cancelled) setResourcesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDivisionId, panelMode, resourcesRefreshKey, resourcesBase]);

  useEffect(() => {
    if (selectedDivisionId == null || panelMode !== 'info') return;
    let cancelled = false;
    setInfoLoading(true);
    fetch(`${apiBase}/divisions/${selectedDivisionId}/info`, { headers: { accept: 'application/json' } })
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<{ sections?: DivisionInfoBlock[] }>;
      })
      .then(d => {
        if (cancelled) return;
        const sections = Array.isArray(d.sections) && d.sections.length > 0
          ? d.sections
          : [{ type: 'text' as const, body: '' }];
        setInfoSections(sections);
      })
      .catch(() => {
        if (!cancelled) {
          setInfoSections([{ type: 'text', body: '' }]);
          toast.error('Failed to load division information.');
        }
      })
      .finally(() => { if (!cancelled) setInfoLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDivisionId, panelMode, apiBase]);

  const ranksForDivision = (divisionId: number) =>
    divisionRanks
      .filter(r => r.division_id === divisionId)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const getDpsRankMeta = (name: string | null | undefined) =>
    getPersonnelRankMeta(personnelRanks, name);

  const getDivRankMeta = (divisionId: number, name: string | null | undefined) => {
    if (!name?.trim()) return null;
    return ranksForDivision(divisionId).find(r => r.name.toLowerCase() === name.toLowerCase().trim()) ?? null;
  };

  const membersInDivision = (division: DpsDivision) =>
    members.filter(m => memberInDivisionRoster(m, division));

  const openDivision = (id: number, mode: DivisionPanelMode) => {
    const access = accessForDivision(id);
    const canRoster = fullAccess || access.can_edit_roster;
    const canResources = fullAccess || access.can_edit_resources;
    const canInfo = fullAccess || access.can_edit_info;
    let nextMode = mode;
    if (mode === 'roster' && !canRoster) {
      nextMode = canResources ? 'resources' : canInfo ? 'info' : 'roster';
    } else if (mode === 'resources' && !canResources) {
      nextMode = canRoster ? 'roster' : canInfo ? 'info' : 'resources';
    } else if (mode === 'info' && !canInfo) {
      nextMode = canRoster ? 'roster' : canResources ? 'resources' : 'info';
    }
    setSelectedDivisionId(id);
    setPanelMode(nextMode);
    setSearch('');
    setAddRankOpen(false);
    setEditingDivisionId(null);
  };

  const backToCards = () => {
    setSelectedDivisionId(null);
    setPanelMode('roster');
    setSearch('');
    setAddRankOpen(false);
    setDivisionResources([]);
    setInfoSections([{ type: 'text', body: '' }]);
  };

  const saveDivisionInfo = async () => {
    if (selectedDivisionId == null) return;
    setInfoSaving(true);
    try {
      const r = await fetch(`${apiBase}/divisions/${selectedDivisionId}/info`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sections: infoSections, actor }),
      });
      if (!r.ok) throw new Error();
      toast.success('Division information saved.');
    } catch {
      toast.error('Failed to save.');
    } finally {
      setInfoSaving(false);
    }
  };

  const handleAddDivision = async () => {
    if (!newDivisionName.trim()) return;
    setAddingDivision(true);
    try {
      const res = await fetch(`${apiBase}/divisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newDivisionName.trim(),
          discord_role_id: newDivisionDiscordRoleId.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to create division.');
      toast.success('Division created.');
      setAddDivisionOpen(false);
      setNewDivisionName('');
      setNewDivisionDiscordRoleId('');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create.');
    } finally {
      setAddingDivision(false);
    }
  };

  const handleRenameDivision = async (id: number) => {
    if (!editingDivisionName.trim()) return;
    const res = await fetch(`${apiBase}/divisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: editingDivisionName.trim(),
        discord_role_id: editingDivisionDiscordRoleId.trim() || null,
      }),
    });
    if (!res.ok) { toast.error('Failed to update division.'); return; }
    setEditingDivisionId(null);
    refresh();
  };

  const startEditDivision = (d: DpsDivision) => {
    setEditingDivisionId(d.id);
    setEditingDivisionName(d.name);
    setEditingDivisionDiscordRoleId(d.discord_role_id ?? '');
  };

  const handleMoveDivision = async (id: number, move: 'up' | 'down') => {
    await fetch(`${apiBase}/divisions/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ move }),
    });
    refresh();
  };

  const handleDeleteDivision = async (id: number, name: string) => {
    if (!confirm(`Delete division "${name}"? Division ranks under it will be removed and member assignments cleared.`)) return;
    const res = await fetch(`${apiBase}/divisions/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Failed to delete.'); return; }
    toast.success('Division deleted.');
    if (selectedDivisionId === id) {
      setSelectedDivisionId(null);
      setPanelMode('roster');
    }
    refresh();
    onMembersChanged();
  };

  const handleAddRank = async (divisionId: number) => {
    if (!newRankName.trim()) return;
    setAddingRank(true);
    try {
      const res = await fetch(`${apiBase}/division-ranks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: newRankName.trim(),
          division_id: divisionId,
          discord_role_id: newRankDiscordRoleId.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Failed to add rank.');
      toast.success('Division rank added.');
      setAddRankOpen(false);
      setNewRankName('');
      setNewRankDiscordRoleId('');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add.');
    } finally {
      setAddingRank(false);
    }
  };

  const handleDeleteRank = async (id: number, name: string) => {
    if (!confirm(`Delete division rank "${name}"?`)) return;
    const res = await fetch(`${apiBase}/division-ranks/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Failed to delete.'); return; }
    toast.success('Rank deleted.');
    refresh();
    onMembersChanged();
  };

  const handleRankReorder = async (
    targetDivisionId: number,
    draggedId: number,
    overId: number | null,
    side: 'before' | 'after',
  ) => {
    const next = divisionRanks.map(r => ({ ...r }));
    const dragged = next.find(r => r.id === draggedId);
    if (!dragged) return;
    dragged.division_id = targetDivisionId;

    const inDiv = next
      .filter(r => r.division_id === targetDivisionId && r.id !== draggedId)
      .sort((a, b) => a.sort_order - b.sort_order);

    let insertAt = inDiv.length;
    if (overId != null) {
      const oi = inDiv.findIndex(r => r.id === overId);
      if (oi >= 0) insertAt = side === 'before' ? oi : oi + 1;
    }
    inDiv.splice(insertAt, 0, dragged);

    const other = next.filter(r => r.division_id !== targetDivisionId);
    const rebuilt = [
      ...other,
      ...inDiv.map((r, i) => ({ ...r, sort_order: i })),
    ];
    setDivisionRanks(rebuilt);

    await Promise.all([
      fetch(`${apiBase}/division-ranks/${draggedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ division_id: targetDivisionId }),
      }),
      fetch(`${apiBase}/division-ranks/reorder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: inDiv.map(r => r.id) }),
      }),
    ]);
  };

  const removeFromDivision = async (memberId: number, divisionId: number, username: string) => {
    if (!confirm(`Remove ${username} from this division?`)) return;
    setRemovingMemberId(memberId);
    try {
      const res = await fetch(`${apiBase}/divisions/${divisionId}/members/${memberId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Failed to remove ${personNoun}.`);
      }
      toast.success(`${username} removed from division.`);
      onMembersChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to remove ${personNoun}.`);
    } finally {
      setRemovingMemberId(null);
    }
  };

  const toggleMemberAccess = async (
    memberId: number,
    divisionId: number,
    field: 'can_edit_resources' | 'can_edit_roster' | 'can_edit_info' | 'can_edit_division',
    nextValue: boolean,
  ) => {
    const key = `${memberId}:${field}`;
    setAccessSavingKey(key);
    try {
      const body = field === 'can_edit_division'
        ? { can_edit_resources: nextValue, can_edit_roster: nextValue }
        : { [field]: nextValue };
      const res = await fetch(`${apiBase}/divisions/${divisionId}/members/${memberId}/access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, actor }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'Failed to update access.');
      }
      const labels: Record<typeof field, [string, string]> = {
        can_edit_resources: ['Resources edit access granted.', 'Resources edit access removed.'],
        can_edit_roster: ['Roster edit access granted.', 'Roster edit access removed.'],
        can_edit_info: ['Info edit access granted.', 'Info edit access removed.'],
        can_edit_division: ['Division edit access granted.', 'Division edit access removed.'],
      };
      const [granted, revoked] = labels[field];
      toast.success(nextValue ? granted : revoked);
      onMembersChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update access.');
    } finally {
      setAccessSavingKey(null);
    }
  };

  const clearRankDrag = () => {
    setDragRankId(null);
    setDragOverRankId(null);
  };

  const sortedDivisions = [...divisions]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .filter(d => {
      if (fullAccess) return true;
      const access = divisionAccess.find(a => a.division_id === d.id);
      return Boolean(access?.can_edit_resources || access?.can_edit_roster || access?.can_edit_info);
    });

  const accessForDivision = (divisionId: number) => {
    if (fullAccess) return { can_edit_resources: true, can_edit_roster: true, can_edit_info: true };
    return divisionAccess.find(a => a.division_id === divisionId)
      ?? { can_edit_resources: false, can_edit_roster: false, can_edit_info: false };
  };

  const modeToggle = selectedDivision && (() => {
    const access = accessForDivision(selectedDivision.id);
    const showRoster = fullAccess || access.can_edit_roster;
    const showResources = fullAccess || access.can_edit_resources;
    const showInfo = fullAccess || access.can_edit_info;
    if (!showRoster && !showResources && !showInfo) return null;
    return (
    <div className="flex rounded-lg border border-[#1f3050] bg-[#07111f] p-0.5">
      {showRoster && (
      <button
        type="button"
        onClick={() => setPanelMode('roster')}
        className={`rounded-md px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
          panelMode === 'roster' ? 'bg-[#22d3ee]/20 text-[#22d3ee]' : 'text-[#526179] hover:text-white'
        }`}
      >
        Edit Roster
      </button>
      )}
      {showResources && (
      <button
        type="button"
        onClick={() => setPanelMode('resources')}
        className={`rounded-md px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
          panelMode === 'resources' ? 'bg-[#34d399]/20 text-[#34d399]' : 'text-[#526179] hover:text-white'
        }`}
      >
        Resources
      </button>
      )}
      {showInfo && (
      <button
        type="button"
        onClick={() => setPanelMode('info')}
        className={`rounded-md px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
          panelMode === 'info' ? 'bg-[#a78bfa]/20 text-[#a78bfa]' : 'text-[#526179] hover:text-white'
        }`}
      >
        Information
      </button>
      )}
    </div>
    );
  })();

  // ── Landing: division cards ────────────────────────────────────────────────
  if (selectedDivision == null) {
    return (
      <div className="space-y-6">
        <button type="button" onClick={onBack}
          className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#22d3ee] transition-colors">
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
          Department Panel
          <span className="text-[#2a3a50]">/</span>
          <span className="text-[#22d3ee]">Divisions</span>
        </button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Layers className="h-4 w-4 text-[#22d3ee]" />
            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#22d3ee]">Divisions</h3>
            <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#3f5470]">
              {sortedDivisions.length}
            </span>
          </div>
          {fullAccess && (
          <button
            type="button"
            onClick={() => {
              setAddDivisionOpen(true);
              setNewDivisionName('');
              setNewDivisionDiscordRoleId('');
            }}
            className="flex items-center gap-2 rounded-lg border border-[#22d3ee]/30 bg-[#22d3ee]/5 px-4 py-2 text-xs font-black text-[#22d3ee] hover:bg-[#22d3ee]/10 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Division
          </button>
          )}
        </div>

        {fullAccess && addDivisionOpen && (
          <div className="rounded-xl border border-[#22d3ee]/20 bg-[#0d1422] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Division name…"
                value={newDivisionName}
                onChange={e => setNewDivisionName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleAddDivision();
                  if (e.key === 'Escape') setAddDivisionOpen(false);
                }}
                className="flex-1 h-9 rounded-lg border border-[#22d3ee]/30 bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#22d3ee]/60"
              />
              <button
                type="button"
                onClick={() => void handleAddDivision()}
                disabled={addingDivision || !newDivisionName.trim()}
                className="rounded-lg border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-3 py-2 text-[10px] font-black text-[#22d3ee] disabled:opacity-40"
              >
                {addingDivision ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setAddDivisionOpen(false)}
                className="rounded p-1.5 text-[#526179] hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div>
              <label className="mb-1 block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">
                Discord Role
              </label>
              <select
                value={newDivisionDiscordRoleId}
                onChange={e => setNewDivisionDiscordRoleId(e.target.value)}
                className="h-9 w-full max-w-md rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff] cursor-pointer"
              >
                <option value="">— No Discord role linked —</option>
                {discordRoles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {loading && divisions.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-[#172235] bg-[#0d1422]">
            <Layers className="h-8 w-8 text-[#1e2e42] animate-pulse" />
            <p className="text-sm font-bold text-[#3f5470]">Loading divisions…</p>
          </div>
        ) : divisions.length === 0 && !addDivisionOpen ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl border border-[#172235] bg-[#0d1422] text-center">
            <Layers className="h-8 w-8 text-[#1e2e42]" />
            <p className="text-sm font-bold text-[#3f5470]">No divisions configured yet.</p>
            <button
              type="button"
              onClick={() => { setAddDivisionOpen(true); setNewDivisionName(''); setNewDivisionDiscordRoleId(''); }}
              className="text-xs font-black text-[#22d3ee] hover:underline"
            >
              Add your first division →
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sortedDivisions.map((d, i) => {
              const ranks = ranksForDivision(d.id);
              const count = membersInDivision(d).length;
              const isEditing = editingDivisionId === d.id && fullAccess;
              const access = accessForDivision(d.id);
              const showRosterBtn = fullAccess || access.can_edit_roster;
              const showResourcesBtn = fullAccess || access.can_edit_resources;
              const showInfoBtn = fullAccess || access.can_edit_info;
              const actionCount = [showRosterBtn, showResourcesBtn, showInfoBtn].filter(Boolean).length;
              return (
                <div
                  key={d.id}
                  className="group relative flex flex-col rounded-2xl border border-[#172235] bg-[#0d1422] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.22)] transition-all hover:border-[#22d3ee]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                  {isEditing ? (
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          autoFocus
                          type="text"
                          value={editingDivisionName}
                          onChange={e => setEditingDivisionName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleRenameDivision(d.id);
                            if (e.key === 'Escape') setEditingDivisionId(null);
                          }}
                          className="flex-1 min-w-[120px] h-8 rounded border border-[#2f70ff] bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none"
                        />
                        <button type="button" onClick={() => void handleRenameDivision(d.id)}
                          className="rounded px-2 py-1 text-[10px] font-black bg-[#2f66ee] text-white">Save</button>
                        <button type="button" onClick={() => setEditingDivisionId(null)}
                          className="rounded px-2 py-1 text-[10px] font-black text-[#526179]">Cancel</button>
                      </div>
                      <select
                        value={editingDivisionDiscordRoleId}
                        onChange={e => setEditingDivisionDiscordRoleId(e.target.value)}
                        className="h-8 w-full rounded border border-[#1f3050] bg-[#07111f] px-2 text-[10px] font-semibold text-white outline-none focus:border-[#2f70ff] cursor-pointer"
                      >
                        <option value="">— No Discord role —</option>
                        {discordRoles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="mb-5 flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/8">
                        <span className="text-[11px] font-black tracking-wide text-[#22d3ee]">
                          {divisionShortLabel(d)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-black text-white">{d.name}</h3>
                        <p className="mt-1 text-[10px] font-semibold text-[#526179]">
                          Choose roster, resources, or information
                        </p>
                      </div>
                      {fullAccess && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                        <button type="button" title="Rename" onClick={() => startEditDivision(d)}
                          className="rounded p-1 text-[#3f5470] hover:text-[#4384ff]"><Pencil className="h-3 w-3" /></button>
                        <button type="button" title="Move up" onClick={() => void handleMoveDivision(d.id, 'up')} disabled={i === 0}
                          className="rounded p-1 text-[#3f5470] hover:text-white disabled:opacity-20"><ChevronUp className="h-3 w-3" /></button>
                        <button type="button" title="Move down" onClick={() => void handleMoveDivision(d.id, 'down')} disabled={i === sortedDivisions.length - 1}
                          className="rounded p-1 text-[#3f5470] hover:text-white disabled:opacity-20"><ChevronDown className="h-3 w-3" /></button>
                        <button type="button" title="Delete division" onClick={() => void handleDeleteDivision(d.id, d.name)}
                          className="rounded p-1 text-[#3f5470] hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                      </div>
                      )}
                    </div>
                  )}

                  <div className="mb-4 flex gap-2">
                    <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-2.5 py-2 text-center">
                      <p className="text-base font-black text-white">{count}</p>
                      <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#3f5470]">Members</p>
                    </div>
                    <div className="flex-1 rounded-lg border border-[#172235] bg-[#07111f] px-2.5 py-2 text-center">
                      <p className="text-base font-black text-white">{ranks.length}</p>
                      <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#3f5470]">Ranks</p>
                    </div>
                  </div>

                  <div className={`mt-auto grid gap-2 ${actionCount >= 3 ? 'grid-cols-1 sm:grid-cols-3' : actionCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {showRosterBtn && (
                    <button
                      type="button"
                      onClick={() => openDivision(d.id, 'roster')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#22d3ee]/35 bg-[#22d3ee]/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#22d3ee] transition-colors hover:bg-[#22d3ee]/18 hover:border-[#22d3ee]/55"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Edit Roster
                    </button>
                    )}
                    {showResourcesBtn && (
                    <button
                      type="button"
                      onClick={() => openDivision(d.id, 'resources')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#34d399]/35 bg-[#34d399]/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#34d399] transition-colors hover:bg-[#34d399]/18 hover:border-[#34d399]/55"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      Resources
                    </button>
                    )}
                    {showInfoBtn && (
                    <button
                      type="button"
                      onClick={() => openDivision(d.id, 'info')}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#a78bfa]/35 bg-[#a78bfa]/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#a78bfa] transition-colors hover:bg-[#a78bfa]/18 hover:border-[#a78bfa]/55"
                    >
                      <Info className="h-3.5 w-3.5" />
                      Edit Info
                    </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Detail breadcrumb ──────────────────────────────────────────────────────
  const detailBreadcrumb = (
    <button
      type="button"
      onClick={backToCards}
      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#22d3ee] transition-colors"
    >
      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      Divisions
      <span className="text-[#2a3a50]">/</span>
      <span className="text-white">{selectedDivision.name}</span>
      <span className="text-[#2a3a50]">/</span>
      <span className={
        panelMode === 'resources' ? 'text-[#34d399]'
          : panelMode === 'info' ? 'text-[#a78bfa]'
            : 'text-[#22d3ee]'
      }>
        {panelMode === 'resources' ? 'Resources' : panelMode === 'info' ? 'Information' : 'Edit Roster'}
      </span>
    </button>
  );

  // ── Resources mode ─────────────────────────────────────────────────────────
  if (panelMode === 'resources') {
    return (
      <div className="space-y-6">
        {detailBreadcrumb}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-[#22d3ee]/25 bg-[#22d3ee]/10 px-2 py-0.5 text-[10px] font-black tracking-wide text-[#22d3ee]">
              {divisionShortLabel(selectedDivision)}
            </span>
            <h2 className="text-sm font-black text-white">{selectedDivision.name}</h2>
          </div>
          {modeToggle}
        </div>

        <div className="relative rounded-2xl border border-[#34d399]/20 bg-[#0d1422] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#34d399]/40 to-transparent" />

          <div className="flex items-center justify-between border-b border-[#172235] px-8 py-5">
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#34d399]">Resources</h3>
              <p className="mt-1 text-xs text-[#526179]">
                Publish guides and materials for this division.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAddResource(selectedDivision.id)}
              className="flex items-center gap-1.5 rounded-lg border border-[#34d399]/30 bg-[#34d399]/8 px-3 py-2 text-xs font-black text-[#34d399] hover:bg-[#34d399]/15 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Resource
            </button>
          </div>

          {resourcesLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 px-8 py-20">
              <BookOpen className="h-8 w-8 text-[#1e2e42] animate-pulse" />
              <p className="text-sm font-bold text-[#3f5470]">Loading resources…</p>
            </div>
          ) : divisionResources.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-8 py-20 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#34d399]/20 bg-[#34d399]/8">
                <BookOpen className="h-8 w-8 text-[#34d399]/60" />
              </div>
              <div>
                <p className="text-sm font-black text-[#526179]">No resources posted</p>
                <p className="mt-1 text-xs text-[#3f5470]">
                  Add your first resource for this division.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#172235]">
              {divisionResources.map(r => (
                <div key={r.id} className="flex items-center gap-4 px-8 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#34d399]/20 bg-[#34d399]/8">
                    <FileText className="h-4 w-4 text-[#34d399]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-black text-white">{r.title}</p>
                    <p className="text-[10px] text-[#3f5470]">
                      {resourceTypeLabel(r)} · Updated{' '}
                      {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                    {(r.division_only || (Array.isArray(r.allowed_ranks) && r.allowed_ranks.length > 0)) && (
                      <p className="mt-1 text-[10px] font-semibold text-[#7c8ba5]">
                        {r.division_only ? 'Division only' : null}
                        {r.division_only && Array.isArray(r.allowed_ranks) && r.allowed_ranks.length > 0 ? ' · ' : null}
                        {Array.isArray(r.allowed_ranks) && r.allowed_ranks.length > 0
                          ? `Ranks: ${r.allowed_ranks.join(', ')}`
                          : null}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenResource(r, true)}
                    className="flex items-center gap-1 rounded-lg border border-[#34d399]/30 bg-[#34d399]/8 px-3 py-1.5 text-[11px] font-black text-[#34d399] hover:bg-[#34d399]/15 transition-colors"
                  >
                    {isPdfLikeResource(r) ? <BookOpen className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                    {isPdfLikeResource(r) ? 'View' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteResource(r.id)}
                    disabled={deletingResourceId === r.id}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/8 text-red-400 hover:bg-red-500/15 disabled:opacity-40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Information mode ───────────────────────────────────────────────────────
  if (panelMode === 'info') {
    return (
      <div className="space-y-6">
        {detailBreadcrumb}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-[#22d3ee]/25 bg-[#22d3ee]/10 px-2 py-0.5 text-[10px] font-black tracking-wide text-[#22d3ee]">
              {divisionShortLabel(selectedDivision)}
            </span>
            <h2 className="text-sm font-black text-white">{selectedDivision.name}</h2>
          </div>
          {modeToggle}
        </div>

        <div className="relative rounded-2xl border border-[#a78bfa]/20 bg-[#0d1422] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#a78bfa]/40 to-transparent" />
          <div className="flex items-center justify-between border-b border-[#172235] px-8 py-5">
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#a78bfa]">
                {selectedDivision.name} Information
              </h3>
              <p className="mt-1 text-xs text-[#526179]">
                Shown on the Divisions Information tab for members of this division.
              </p>
            </div>
          </div>
          {infoLoading ? (
            <div className="flex min-h-[200px] items-center justify-center px-8 py-6">
              <p className="text-sm font-bold text-[#3f5470]">Loading…</p>
            </div>
          ) : (
            <div className="space-y-4 px-8 py-6">
              <ContentBlocksEditor
                sections={infoSections as ContentBlock[]}
                onChange={next => setInfoSections(next as DivisionInfoBlock[])}
                accent="#a78bfa"
              />

              <button
                type="button"
                disabled={infoSaving}
                onClick={() => void saveDivisionInfo()}
                className="flex items-center gap-1.5 rounded-lg bg-[#a78bfa] px-5 py-2 text-xs font-black text-[#0d1422] transition-colors hover:bg-[#c4b5fd] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {infoSaving ? 'Saving…' : 'Save Division Info'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Roster mode ────────────────────────────────────────────────────────────
  const divRanks = ranksForDivision(selectedDivision.id);
  const divisionMembers = members.filter(m => assignmentForDivision(m, selectedDivision) != null);
  const filtered = sortMembersByDivisionRank(
    divisionMembers.filter(m => {
      const q = search.toLowerCase();
      if (!q) return true;
      const assign = assignmentForDivision(m, selectedDivision);
      return (
        m.username.toLowerCase().includes(q)
        || (assign?.division_rank ?? '').toLowerCase().includes(q)
        || (memberDepartmentRank(m) ?? '').toLowerCase().includes(q)
        || (m.callsign ?? '').toLowerCase().includes(q)
        || (m.discord_username ?? '').toLowerCase().includes(q)
      );
    }),
    selectedDivision,
    divRanks,
  );

  return (
    <div className="space-y-6">
      {editRank && (
        <DivisionRankEditModal
          rank={editRank}
          discordRoles={discordRoles}
          DiscordAvatar={DiscordAvatar}
          onClose={() => setEditRank(null)}
          onSaved={refresh}
          apiBase={apiBase}
        />
      )}

      {addOfficerOpen && (
        <DivisionAddOfficerModal
          division={selectedDivision}
          ranks={divRanks}
          onClose={() => setAddOfficerOpen(false)}
          onAdded={() => { setAddOfficerOpen(false); onMembersChanged(); }}
          apiBase={apiBase}
          personNoun={personNoun}
        />
      )}

      {detailBreadcrumb}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[#22d3ee]/25 bg-[#22d3ee]/10 px-2 py-0.5 text-[10px] font-black tracking-wide text-[#22d3ee]">
            {divisionShortLabel(selectedDivision)}
          </span>
          <h2 className="text-sm font-black text-white">{selectedDivision.name}</h2>
        </div>
        {modeToggle}
      </div>

      <div className="rounded-xl border border-[#22d3ee]/20 bg-[#0d1422] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
        {/* Ranks for this division */}
        <div className="border-b border-[#172235] px-6 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings className="h-3.5 w-3.5 text-[#22d3ee]" />
              <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">
                Division Ranks
              </span>
              <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">
                {divRanks.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setAddRankOpen(true); setNewRankName(''); setNewRankDiscordRoleId(''); }}
              className="flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#2f70ff] hover:text-[#4384ff]"
            >
              <Plus className="h-3 w-3" />
              Add Rank
            </button>
          </div>

          <div
            className="flex flex-wrap gap-1.5 min-h-[28px]"
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => {
              e.preventDefault();
              if (dragRankId !== null && dragOverRankId === null) {
                void handleRankReorder(selectedDivision.id, dragRankId, null, 'after');
              }
              clearRankDrag();
            }}
          >
            {divRanks.map(r => {
              const chipColor = r.color_hex ?? null;
              const isDragging = dragRankId === r.id;
              const isDropTarget = dragOverRankId === r.id && !isDragging;
              const baseStyle = chipColor
                ? { borderColor: chipColor + '55', backgroundColor: chipColor + '18', color: chipColor }
                : { borderColor: '#1f3050', backgroundColor: '#0a1525', color: '#526179' };
              const dropStyle = isDropTarget
                ? dragOverSide === 'before' ? { boxShadow: '-3px 0 0 #4384ff' } : { boxShadow: '3px 0 0 #4384ff' }
                : {};
              return (
                <button
                  key={r.id}
                  type="button"
                  draggable
                  title={`Drag to reorder · Click to edit: ${r.name}`}
                  onClick={() => { if (!dragRankId) setEditRank(r); }}
                  onDragStart={e => {
                    setDragRankId(r.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setDragOverRankId(r.id);
                    setDragOverSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
                  }}
                  onDragLeave={() => setDragOverRankId(null)}
                  onDrop={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragRankId !== null) void handleRankReorder(selectedDivision.id, dragRankId, r.id, dragOverSide);
                    clearRankDrag();
                  }}
                  onDragEnd={clearRankDrag}
                  className="group/chip flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold select-none transition-all"
                  style={{ ...baseStyle, ...dropStyle, opacity: isDragging ? 0.35 : 1, cursor: 'grab' }}
                >
                  <GripVertical className="h-2.5 w-2.5 opacity-20 group-hover/chip:opacity-50 shrink-0" />
                  {r.insignia_url && (
                    <img
                      src={r.insignia_url}
                      alt=""
                      className="h-4 w-4 object-contain shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  {r.name}
                  <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 shrink-0" />
                  <span
                    role="button"
                    title="Delete rank"
                    onClick={e => { e.stopPropagation(); void handleDeleteRank(r.id, r.name); }}
                    className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 shrink-0 text-red-400 cursor-pointer"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </span>
                </button>
              );
            })}
            {divRanks.length === 0 && (
              <span className="text-[10px] text-[#3f5470]">No ranks yet — add one to assign {personNounPlural}.</span>
            )}
          </div>

          {addRankOpen && (
            <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[#0c1525] bg-[#060c18] p-3">
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Rank name…"
                  value={newRankName}
                  onChange={e => setNewRankName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void handleAddRank(selectedDivision.id);
                    if (e.key === 'Escape') { setAddRankOpen(false); setNewRankDiscordRoleId(''); }
                  }}
                  className="flex-1 h-8 rounded border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff]"
                />
                <button
                  type="button"
                  onClick={() => void handleAddRank(selectedDivision.id)}
                  disabled={addingRank || !newRankName.trim()}
                  className="rounded border border-[#2f66ee] bg-[#2f66ee]/10 px-3 py-1.5 text-[10px] font-black text-[#4384ff] disabled:opacity-40"
                >
                  {addingRank ? 'Adding…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAddRankOpen(false); setNewRankDiscordRoleId(''); }}
                  className="rounded p-1.5 text-[#526179] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div>
                <label className="mb-1 block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">
                  Assign Discord Role
                </label>
                <select
                  value={newRankDiscordRoleId}
                  onChange={e => setNewRankDiscordRoleId(e.target.value)}
                  className="h-8 w-full rounded border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff] cursor-pointer"
                >
                  <option value="">— No Discord role linked —</option>
                  {discordRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Member / officer table */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[#172235] px-6 py-3">
          <div className="relative w-full max-w-sm flex-1 min-w-[12rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
            <input
              type="text"
              placeholder={`Search ${personNounPlural}…`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
            />
          </div>
          <span className="shrink-0 text-[10px] font-black text-[#526179]">
            {filtered.length} {filtered.length !== 1 ? personNounPlural : personNoun}
          </span>
          {(fullAccess || accessForDivision(selectedDivision.id).can_edit_roster) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSyncDivisionDiscord()}
              disabled={syncingDiscord}
              className="flex items-center gap-1.5 rounded-lg border border-[#4384ff]/30 bg-[#4384ff]/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#4384ff] hover:bg-[#4384ff]/15 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingDiscord ? 'animate-spin' : ''}`} />
              {syncingDiscord ? 'Syncing…' : 'Sync Discord'}
            </button>
            <button
              type="button"
              onClick={() => setAddOfficerOpen(true)}
              disabled={divRanks.length === 0}
              title={divRanks.length === 0 ? 'Add a division rank first' : `Add ${personNoun} to this division`}
              className="flex items-center gap-1.5 rounded-lg border border-[#22d3ee]/30 bg-[#22d3ee]/8 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#22d3ee] hover:bg-[#22d3ee]/15 disabled:opacity-40 transition-colors"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add {personNounTitle}
            </button>
          </div>
          )}
        </div>

        {membersLoading && members.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
            <Users className="h-8 w-8 text-[#1e2e42] animate-pulse" />
            <p className="text-sm font-bold text-[#3f5470]">Loading {personNounPlural}…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
            <Users className="h-8 w-8 text-[#1e2e42]" />
            <p className="text-sm font-bold text-[#3f5470]">
              {search
                ? `No ${personNounPlural} match your search.`
                : selectedDivision.discord_role_id
                  ? `No ${personNounPlural} in this division yet. Members with the linked Discord role sync automatically, or add one manually.`
                  : `No ${personNounPlural} in this division yet. Link a Discord role or add a ${personNoun}.`}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#131f30]">
                  <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Username</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">DPS Rank</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Division Rank</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Callsign</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Status</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord Status</th>
                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const assign = assignmentForDivision(m, selectedDivision);
                  const currentRank = assign?.division_rank ?? '';
                  const canEditDivision = Boolean(assign?.can_edit_resources || assign?.can_edit_roster);
                  const canEditInfo = Boolean(assign?.can_edit_info);
                  const savingDivision = accessSavingKey === `${m.id}:can_edit_division`;
                  const savingInfo = accessSavingKey === `${m.id}:can_edit_info`;
                  const selectedAccess = accessForDivision(selectedDivision.id);
                  const canManageRoster = fullAccess || selectedAccess.can_edit_roster;
                  return (
                    <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <DiscordAvatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                          <div>
                            <p className="font-black text-white">{m.username}</p>
                            {m.discord_username && <p className="text-[10px] text-[#526179]">@{m.discord_username}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <RankWithInsignia
                          rankName={memberDepartmentRank(m) || '—'}
                          meta={getDpsRankMeta(memberDepartmentRank(m))}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <RankWithInsignia
                          rankName={currentRank || '—'}
                          meta={getDivRankMeta(selectedDivision.id, currentRank)}
                        />
                      </td>
                      <td className="px-4 py-3.5 font-black text-[#4384ff]">{m.callsign || '—'}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                      <td className="px-4 py-3.5">
                        <DiscordStatusBadge
                          status={m.discord_id ? (panelDiscordPresence[m.discord_id] ?? 'offline') : 'offline'}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {fullAccess && (
                            <>
                              <button
                                type="button"
                                disabled={savingDivision}
                                title={canEditDivision ? 'Revoke division roster & resources edit access' : 'Grant division roster & resources edit access'}
                                onClick={() => void toggleMemberAccess(m.id, selectedDivision.id, 'can_edit_division', !canEditDivision)}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] transition-colors disabled:opacity-40 ${
                                  canEditDivision
                                    ? 'border-[#22d3ee]/40 bg-[#22d3ee]/15 text-[#22d3ee]'
                                    : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#22d3ee]/30 hover:text-[#22d3ee]'
                                }`}
                              >
                                <ClipboardList className="h-3 w-3" />
                                {savingDivision ? '…' : 'Access'}
                              </button>
                              <button
                                type="button"
                                disabled={savingInfo}
                                title={canEditInfo ? 'Revoke division info edit access' : 'Grant division info edit access'}
                                onClick={() => void toggleMemberAccess(m.id, selectedDivision.id, 'can_edit_info', !canEditInfo)}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] transition-colors disabled:opacity-40 ${
                                  canEditInfo
                                    ? 'border-[#a78bfa]/40 bg-[#a78bfa]/15 text-[#a78bfa]'
                                    : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#a78bfa]/30 hover:text-[#a78bfa]'
                                }`}
                              >
                                <Info className="h-3 w-3" />
                                {savingInfo ? '…' : 'Info'}
                              </button>
                            </>
                          )}
                          {canManageRoster && (
                          <button
                            type="button"
                            disabled={removingMemberId === m.id}
                            onClick={() => void removeFromDivision(m.id, selectedDivision.id, m.username)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/8 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-red-400 hover:bg-red-500/15 disabled:opacity-40 transition-colors"
                          >
                            <UserMinus className="h-3 w-3" />
                            {removingMemberId === m.id ? 'Removing…' : 'Remove'}
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
