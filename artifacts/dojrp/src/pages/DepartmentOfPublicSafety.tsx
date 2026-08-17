import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  nestedPortalSectionPath,
  parseNestedPortalSection,
  usePortalSection,
} from '@/hooks/usePortalSection';
import {
  AlertCircle, BookOpen, CalendarDays, Car, ChevronDown, ChevronRight, ChevronUp,
  Clock, FileText, Globe, GripVertical, Info, LayoutDashboard, Layers, Lock, LogOut, MapPin, Package,
  Pencil, Phone, Plus, Radio, RefreshCw, Scale, Search, Settings,
  Shield, Trash2, Users, X, Monitor,
} from 'lucide-react';
import DocumentEditor from '@/components/editor/DocumentEditor';
import PdfViewer from '@/components/shared/PdfViewer';
import ImageInput, { imageStyle, DEFAULT_ADJUST, type ImageAdjust } from '@/components/shared/ImageInput';
import { toast } from 'sonner';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import PhonePanel from '@/components/overlays/PhonePanel';
import IncomingCallOverlay, { type IncomingCall } from '@/components/overlays/IncomingCallOverlay';
import {
  DivisionPanelCard,
  DivisionPanelSection,
  DivisionRosterView,
  DivisionsInformationView,
} from '@/components/dps/DivisionRoster';
import { clearCadSession, getCadSession, setCadSession, type CadSession } from '@/lib/cad-session';
import { canAccessDpsCad } from '@/lib/cad-access';
import { isSuperAdminSession } from '@/lib/superadmin';
import { useCadStatus, cadModeLabel } from '@/hooks/useCadStatus';
import { usePhoneSSE } from '@/hooks/usePhoneSSE';
import { ContentBlocksEditor, renderFormattedText, type ContentBlock } from '@/components/shared/ContentBlocks';
import { buildPersonnelTitleGroups, dedupeRosterMembersById, sortByRankThenCallsign } from '@/lib/roster-sort';
import { fetchRosterArray, fetchRosterJson, normalizeRankGroupId, rankBelongsToGroup } from '@/lib/roster-fetch';
import { collectDepartmentPermissions } from '@/lib/permission-access';
import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';

// ── Access control ─────────────────────────────────────────────────────────────
// Panel access is now driven by the panel_access flag on each rank group.
// The check is done at render time from the loaded groups + ranks state.

// ── Types ──────────────────────────────────────────────────────────────────────
type Tab = 'personnel-roster' | 'division-roster' | 'divisions-information' | 'vehicle-roster' | 'equipment-roster' | 'event-calendar' | 'information' | 'resources' | 'department-panel';

const DPS_SECTIONS = [
  'personnel-roster',
  'division-roster',
  'divisions-information',
  'vehicle-roster',
  'equipment-roster',
  'event-calendar',
  'information',
  'resources',
  'department-panel',
] as const satisfies readonly Tab[];

type DpsRank = {
  id: number; name: string; sort_order: number; group_id: number | null;
  color_hex: string | null; callsign_prefix: string | null; insignia_url: string | null;
  discord_role_id: string | null;
  callsign_type: 'static' | 'dynamic' | 'custom' | null;
  callsign_static: string | null;
  callsign_min: number | null;
  callsign_max: number | null;
};

type DpsDiscordRole = { id: string; name: string; position: number };

type RankMember = {
  id: number; username: string; discord_username: string; discord_id: string;
  avatar_hash: string | null; callsign: string; rank: string; dps_rank: string | null; status: string;
};

type CustomCallsign = {
  id: number; rank_id: number; callsign: string;
  assigned_profile_id: number | null; assigned_username: string | null;
};

type RankDetail = DpsRank & { members: RankMember[]; custom_callsigns: CustomCallsign[] };
type DpsGroup = {
  id: number;
  name: string;
  sort_order: number;
  panel_access: boolean;
  division_oversight?: boolean;
};

type DpsEvent = {
  id: number;
  title: string;
  event_date: string;   // 'YYYY-MM-DD'
  event_time: string | null;
  location: string | null;
  purpose: string | null;
  hosted_by: string | null;
  hosting_department: string | null;
  is_public: boolean;
  created_at: string;
};

type DpsResource = {
  id: number;
  title: string;
  type: 'document' | 'pdf';
  logo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  division_id?: number | null;
  division_only?: boolean;
  allowed_ranks?: string[];
  personnel_only?: boolean;
  allowed_dps_ranks?: string[];
};

type FleetVehicle = {
  id: number;
  name: string;
  year: string | null;
  category: string;
  category_sort: number;
  image_url: string | null;
  image_scale: number;
  image_position_x: number;
  image_position_y: number;
  who_can_drive: string[];
  restrict_to_divisions: string[];
  liveries: string[];
  notes: string | null;
  sort_order: number;
};

type EquipmentItem = {
  id: number;
  name: string;
  category: string;
  category_sort: number;
  image_url: string | null;
  image_scale: number;
  image_position_x: number;
  image_position_y: number;
  who_can_use: string[];
  restrict_to_divisions: string[];
  notes: string | null;
  sort_order: number;
};

type RosterMember = {
  id: number;
  username: string;
  discord_username: string;
  discord_id: string;
  avatar_hash: string;
  callsign: string;
  /** Legacy fields kept for session display compat */
  rank: string;
  role: string;
  /** Separated DPS fields */
  dps_rank: string | null;
  dps_role: string | null;
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
  staff_role?: string | null;
  status: string;
  appointed_date: string | null;
  can_view_all_resources?: boolean;
  can_access_iab?: boolean;
  pob: boolean; iab: boolean; hsu: boolean; sru: boolean; fou: boolean;
  certifications: string[];
  group_name: string | null;
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* fall through */ }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeRosterMember(m: RosterMember): RosterMember {
  return {
    ...m,
    certifications: asStringArray(m.certifications),
    can_view_all_resources: Boolean(m.can_view_all_resources),
    can_access_iab: Boolean(m.can_access_iab),
    division_assignments: Array.isArray(m.division_assignments)
      ? m.division_assignments.map(a => ({
          ...a,
          can_edit_resources: Boolean(a.can_edit_resources),
          can_edit_roster: Boolean(a.can_edit_roster),
          can_edit_info: Boolean(a.can_edit_info),
        }))
      : m.division_assignments,
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────
const RANK_OPTIONS = [
  'Owner', 'Executive', 'Chief of Department', 'Assistant Chief', 'Deputy Chief',
  'Captain', 'Lieutenant', 'Sergeant', 'Corporal',
  'Senior Officer', 'Field Training Officer', 'Officer',
  'Probationary Officer', 'Cadet', 'Recruit', 'Member',
];

const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave', 'Suspended'];

type RosterDivision = {
  id: number;
  name: string;
  sort_order: number;
  discord_role_id?: string | null;
  unit_key?: string | null;
};

type UnitFlagKey = 'pob' | 'iab' | 'hsu' | 'sru' | 'fou';
const UNIT_FLAG_KEYS: UnitFlagKey[] = ['pob', 'iab', 'hsu', 'sru', 'fou'];

function unitFlagForDivision(d: Pick<RosterDivision, 'name' | 'unit_key'>): UnitFlagKey | null {
  const explicit = (d.unit_key ?? '').trim().toLowerCase();
  if ((UNIT_FLAG_KEYS as string[]).includes(explicit)) return explicit as UnitFlagKey;
  const n = d.name.trim().toLowerCase();
  if (n.includes('patrol') || n === 'pob') return 'pob';
  if (n.includes('internal affairs') || n === 'iab') return 'iab';
  if (n.includes('high speed') || n === 'hsu') return 'hsu';
  if (n.includes('special response') || n === 'sru') return 'sru';
  if (n.includes('field operations') || n === 'fou') return 'fou';
  return null;
}

/** Short label for roster columns/badges (e.g. POB), full name via title hover. */
function divisionShortName(d: Pick<RosterDivision, 'name' | 'unit_key'>): string {
  const key = (d.unit_key ?? '').trim() || unitFlagForDivision(d) || '';
  if (key) return key.toUpperCase();
  const initials = d.name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 4);
  return (initials || d.name).toUpperCase();
}

function memberInDivision(m: RosterMember, d: RosterDivision): boolean {
  if (Array.isArray(m.division_assignments) && m.division_assignments.some(a =>
    a.division_id === d.id || a.division_name.toLowerCase() === d.name.toLowerCase()
  )) return true;
  if (Array.isArray(m.division_names) && m.division_names.some(n => n.toLowerCase() === d.name.toLowerCase())) {
    return true;
  }
  if (m.division_name && m.division_name.toLowerCase() === d.name.toLowerCase()) return true;
  const flag = unitFlagForDivision(d);
  return flag ? !!m[flag] : false;
}

/** @deprecated Hardcoded labels — fleet/equipment still use these as fallback keys. */
const DIVISION_OPTIONS = [
  { key: 'POB', label: 'Patrol Operations Bureau' },
  { key: 'IAB', label: 'Internal Affairs Bureau' },
  { key: 'HSU', label: 'High Speed Unit' },
  { key: 'SRU', label: 'Special Response Unit' },
  { key: 'FOU', label: 'Field Operations Unit' },
];

type DivisionRankRow = { id: number; name: string; division_id: number | null };

let rosterMetadataPromise: Promise<{
  groups: DpsGroup[];
  ranks: DpsRank[];
  divs: RosterDivision[];
  divRanks: DivisionRankRow[];
}> | null = null;

function loadRosterMetadata() {
  if (!rosterMetadataPromise) {
    rosterMetadataPromise = Promise.all([
      fetchRosterArray<DpsGroup>('/api/roster/groups', 'groups'),
      fetchRosterArray<DpsRank>('/api/roster/ranks', 'ranks'),
      fetchRosterArray<RosterDivision>('/api/roster/divisions', 'divisions'),
      fetchRosterArray<DivisionRankRow>('/api/roster/division-ranks', 'division ranks'),
    ])
      .then(([groups, ranks, divs, divRanks]) => ({ groups, ranks, divs, divRanks }))
      .catch((err) => {
        rosterMetadataPromise = null;
        throw err;
      });
  }
  return rosterMetadataPromise;
}

// Group headings are loaded dynamically from /api/roster/groups.
// Each RosterMember already carries a group_name field returned by the API.

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'information',             label: 'Information',             icon: Info         },
  { id: 'personnel-roster',        label: 'Personnel Roster',        icon: Users        },
  { id: 'resources',               label: 'Resources',               icon: BookOpen     },
  { id: 'vehicle-roster',          label: 'Vehicle Roster',          icon: Car          },
  { id: 'equipment-roster',        label: 'Equipment Roster',        icon: Package      },
  { id: 'divisions-information',   label: 'Division Information',    icon: FileText     },
  { id: 'division-roster',         label: 'Division Roster',         icon: Layers       },
  { id: 'event-calendar',          label: 'Event Calendar',          icon: CalendarDays },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const UnitDot = ({ active }: { active: boolean }) => (
  <span className={`mx-auto block h-2.5 w-2.5 rounded-full ${active ? 'bg-[#f4c542] shadow-[0_0_6px_rgba(244,197,66,0.6)]' : 'bg-[#1a2638]'}`} />
);

const StatusBadge = ({ status }: { status: string }) => {
  const active = status?.toLowerCase() === 'active';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${active ? 'bg-emerald-500 text-white' : 'bg-[#1a2638] text-[#526179]'}`}>
      {status ?? 'Inactive'}
    </span>
  );
};

const discordAvatarUrl = (discordId?: string | null, avatarHash?: string | null, size = 64): string | null => {
  if (!discordId) return null;
  const hash = avatarHash?.trim();
  if (hash) {
    const ext = hash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.${ext}?size=${size}`;
  }
  try {
    const idx = Number(BigInt(discordId) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
};

const DiscordAvatar = ({ name, discordId, avatarHash }: { name: string; discordId?: string; avatarHash?: string | null }) => {
  const [imgError, setImgError] = React.useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const colors = ['bg-[#5865f2]', 'bg-[#3ba55c]', 'bg-[#ed4245]', 'bg-[#faa61a]', 'bg-[#9c84ec]'];
  const color = colors[(name.charCodeAt(0) ?? 0) % colors.length];
  const src = !imgError ? discordAvatarUrl(discordId, avatarHash) : null;
  if (src) {
    return <img src={src} alt={name} className="inline-block h-6 w-6 shrink-0 rounded-full object-cover" onError={() => setImgError(true)} />;
  }
  return (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${color} text-[9px] font-black text-white`}>{initial}</span>
  );
};

const inputCls = "h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]";
const selectCls = "h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff] appearance-none";
const labelCls  = "block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470] mb-1.5";

// ── Edit Member Modal ─────────────────────────────────────────────────────────
type EditForm = {
  dps_rank: string; dps_role: string; division_rank: string; callsign: string; status: string;
  appointed_date: string;
  pob: boolean; iab: boolean; hsu: boolean; sru: boolean; fou: boolean;
  certifications: string;
};

const EditModal = ({
  member, onClose, onSave, ranks, divisionRanks, divisions,
}: {
  member: RosterMember;
  onClose: () => void;
  onSave: (id: number, form: EditForm) => Promise<void>;
  ranks: DpsRank[];
  divisionRanks: { id: number; name: string; division_id: number | null }[];
  divisions: RosterDivision[];
}) => {
  const [form, setForm] = useState<EditForm>({
    dps_rank: member.dps_rank || member.rank || '',
    dps_role: member.dps_role ?? '',
    division_rank: member.division_rank ?? '',
    callsign: member.callsign ?? '',
    status: member.status ?? 'Active',
    appointed_date: member.appointed_date ? member.appointed_date.slice(0, 10) : '',
    pob: member.pob ?? false, iab: member.iab ?? false,
    hsu: member.hsu ?? false, sru: member.sru ?? false, fou: member.fou ?? false,
    certifications: asStringArray(member.certifications).join(', '),
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setForm(p => ({ ...p, [k]: v }));

  // ── Rank-aware callsign helpers ───────────────────────────────────────────
  const originalRank  = member.dps_rank || member.rank || '';
  const rankChanged   = form.dps_rank.trim().toLowerCase() !== originalRank.trim().toLowerCase();
  const selectedRank  = ranks.find(r => r.name === form.dps_rank) ?? null;
  const isDynamicRank = selectedRank?.callsign_type === 'dynamic';
  const isStaticRank  = selectedRank?.callsign_type === 'static';
  const csPrefix = selectedRank?.callsign_prefix?.trim() ?? '';
  const csPadLen = String(selectedRank?.callsign_max ?? 0).length || 1;

  // Local suffix string for the dynamic stepper (mirrors the numeric part of form.callsign)
  const parseSuffix = (callsign: string) => {
    const parts = callsign.split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    return isNaN(n) ? '' : String(n);
  };
  const [dynSuffix, setDynSuffix] = useState<string>(() => parseSuffix(member.callsign ?? ''));

  // When rank changes: auto-fill static callsign; reset suffix for dynamic
  useEffect(() => {
    const rank = ranks.find(r => r.name === form.dps_rank);
    if (!rank) return;
    if (rank.callsign_type === 'static' && rank.callsign_prefix && rank.callsign_static != null) {
      const auto = `${rank.callsign_prefix.trim()}-${rank.callsign_static}`;
      setForm(p => ({ ...p, callsign: auto }));
    } else if (rank.callsign_type === 'dynamic') {
      const parsed = parseSuffix(form.callsign);
      const fallback = String(rank.callsign_min ?? 0);
      setDynSuffix(parsed || fallback);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dps_rank]);

  // Build full callsign from a suffix number and write it into the form
  const applyDynSuffix = (suffix: string) => {
    const n = parseInt(suffix, 10);
    if (isNaN(n)) return;
    const padded = String(n).padStart(csPadLen, '0');
    const callsign = csPrefix ? `${csPrefix}-${padded}` : padded;
    setDynSuffix(String(n));
    setForm(p => ({ ...p, callsign }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(member.id, form); onClose(); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-lg rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-white">Edit Officer</h3>
            <p className="mt-0.5 text-xs text-[#526179]">{member.username}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>DPS Rank</label>
              <select value={form.dps_rank} onChange={e => set('dps_rank', e.target.value)} className={selectCls}>
                <option value="">— Select rank —</option>
                {(ranks.length > 0 ? ranks.map(r => r.name) : RANK_OPTIONS).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Callsign</label>
              {rankChanged && (isDynamicRank || isStaticRank) ? (
                /* Rank is changing — backend will auto-assign; show notice */
                <div className="flex items-center gap-2 h-9 rounded-lg border border-[#1b3320] bg-[#071410] px-3">
                  <Radio className="h-3 w-3 text-[#3ecf8e] shrink-0" />
                  <span className="text-[11px] font-semibold text-[#3ecf8e]">Auto-assigned on save</span>
                  {csPrefix && (
                    <span className="ml-auto font-mono text-[10px] text-[#526179]">{csPrefix}-…</span>
                  )}
                </div>
              ) : isDynamicRank ? (
                /* Same dynamic rank — callsign is fully managed; show read-only */
                <div className="flex items-center gap-2 h-9 rounded-lg border border-[#1b2e1a] bg-[#071410] px-3">
                  <Radio className="h-3 w-3 text-[#3ecf8e] shrink-0" />
                  <span className="font-mono text-xs font-bold text-[#3ecf8e]">{form.callsign || '—'}</span>
                  <span className="text-[9px] text-[#3f5470] ml-auto">managed by rank</span>
                </div>
              ) : isStaticRank ? (
                /* Same static rank — show assigned value, allow override */
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 h-9 rounded-lg border border-[#1f3050] bg-[#07111f] px-3">
                    <span className="font-mono text-xs font-bold text-[#4384ff]">{form.callsign || '—'}</span>
                    <span className="text-[9px] text-[#3f5470] ml-auto">auto-assigned</span>
                  </div>
                  <input type="text" placeholder="Override callsign…" value={form.callsign}
                    onChange={e => set('callsign', e.target.value)}
                    className="h-8 w-full rounded-lg border border-[#131f30] bg-[#070d16] px-3 text-[11px] font-semibold text-[#a8b7cd] placeholder:text-[#2a3a50] outline-none focus:border-[#2f70ff]" />
                </div>
              ) : (
                /* No rank config — plain text */
                <input type="text" placeholder="e.g. 1A-01" value={form.callsign}
                  onChange={e => set('callsign', e.target.value)} className={inputCls} />
              )}
              {!rankChanged && (isDynamicRank || isStaticRank) && (
                <p className="mt-1 text-[10px] text-[#3f5470]">
                  Full callsign: <span className="font-mono text-[#4384ff]">{form.callsign || '—'}</span>
                </p>
              )}
            </div>
          </div>

          <div>
            <label className={labelCls}>DPS Role</label>
            <input type="text" placeholder="e.g. Patrol, Detective, SWAT" value={form.dps_role}
              onChange={e => set('dps_role', e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Division Rank</label>
            <select value={form.division_rank} onChange={e => set('division_rank', e.target.value)} className={selectCls}>
              <option value="">— Unassigned —</option>
              {divisionRanks.map(r => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={selectCls}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Appointed Date</label>
              <input type="date" value={form.appointed_date}
                onChange={e => set('appointed_date', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Unit Assignments</label>
            <div className="flex flex-wrap gap-3">
              {divisions.length === 0 ? (
                <p className="text-[11px] text-[#3f5470]">No divisions yet — create them in Division Roster.</p>
              ) : divisions.map(d => {
                const flag = unitFlagForDivision(d);
                const checked = flag ? !!form[flag] : memberInDivision(member, d);
                return (
                  <label key={d.id} className={`flex items-center gap-2 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 ${flag ? 'cursor-pointer' : 'opacity-70'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!flag}
                      onChange={e => { if (flag) set(flag, e.target.checked); }}
                      className="accent-[#4384ff]"
                    />
                    <span className="text-[11px] font-black text-[#a8b7cd]" title={d.name}>{divisionShortName(d)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className={labelCls}>Certifications (comma-separated)</label>
            <input type="text" placeholder="e.g. Basic Leadership, Scene Command, FTO"
              value={form.certifications} onChange={e => set('certifications', e.target.value)} className={inputCls} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Roster Access Permissions Modal ───────────────────────────────────────────
const RosterAccessPermissionsModal = ({
  member,
  iabLabel,
  resourceSaving,
  iabSaving,
  clearing,
  onClose,
  onToggleResources,
  onToggleIab,
  onClearAll,
}: {
  member: RosterMember;
  iabLabel: string;
  resourceSaving: boolean;
  iabSaving: boolean;
  clearing: boolean;
  onClose: () => void;
  onToggleResources: (enabled: boolean) => void;
  onToggleIab: (enabled: boolean) => void;
  onClearAll: () => void;
}) => {
  const rows = [
    {
      key: 'resources',
      label: 'Resources',
      description: 'View all restricted department resources',
      enabled: Boolean(member.can_view_all_resources),
      saving: resourceSaving,
      icon: <BookOpen className="h-3.5 w-3.5" />,
      on: 'border-[#a78bfa]/50 bg-[#a78bfa]/10 text-[#a78bfa]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#a78bfa]/40 hover:text-[#a78bfa]',
      onClick: () => onToggleResources(!member.can_view_all_resources),
    },
    {
      key: 'iab',
      label: 'IAB',
      description: iabLabel,
      enabled: Boolean(member.can_access_iab),
      saving: iabSaving,
      icon: <Scale className="h-3.5 w-3.5" />,
      on: 'border-[#f4c542]/50 bg-[#f4c542]/10 text-[#f4c542]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#f4c542]/40 hover:text-[#f4c542]',
      onClick: () => onToggleIab(!member.can_access_iab),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-black text-white">Access Permissions</h3>
            <p className="mt-0.5 text-xs text-[#526179]">{member.username}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClearAll}
              disabled={clearing || resourceSaving || iabSaving}
              title="Remove all access permissions for this member"
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/8 px-2.5 py-1.5 text-[10px] font-black text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
            >
              <Lock className="h-3 w-3" />
              {clearing ? 'Clearing…' : 'Clear All'}
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map(row => (
            <button
              key={row.key}
              type="button"
              disabled={row.saving}
              onClick={row.onClick}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-40 ${row.enabled ? row.on : row.off}`}
            >
              <span className="shrink-0">{row.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-black">{row.saving ? '…' : row.label}</span>
                <span className="mt-0.5 block text-[10px] opacity-70">{row.description}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${
                row.enabled ? 'bg-white/10' : 'bg-black/20 text-[#8392aa]'
              }`}>
                {row.enabled ? 'On' : 'Off'}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 h-10 w-full rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5"
        >
          Done
        </button>
      </div>
    </div>
  );
};

// ── Rank Edit Modal ───────────────────────────────────────────────────────────
type RankEditForm = {
  name: string; color_hex: string; callsign_prefix: string; insignia_url: string; discord_role_id: string;
  callsign_type: 'static' | 'dynamic' | 'custom';
  callsign_static: string;
  callsign_static_suffix: boolean;   // false → store 'XX', true → store the numeric value
  callsign_min: string;
  callsign_max: string;
};

const RankEditModal = ({
  rankId, dpsGuildRoles, onClose, onSaved,
}: {
  rankId: number;
  dpsGuildRoles: DpsDiscordRole[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [detail, setDetail]   = useState<RankDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm]       = useState<RankEditForm>({ name: '', color_hex: '', callsign_prefix: '', insignia_url: '', discord_role_id: '', callsign_type: 'static', callsign_static: '0', callsign_static_suffix: false, callsign_min: '0', callsign_max: '0' });
  const [colorErr, setColorErr] = useState('');
  const colorInputRef = useRef<HTMLInputElement>(null);
  // Per-member callsign suffix overrides (dynamic range mode)
  const [memberSuffixes, setMemberSuffixes] = useState<Record<number, string>>({});
  const [savingMemberId, setSavingMemberId] = useState<number | null>(null);
  // Custom callsign slots (custom type)
  const [customSlots, setCustomSlots] = useState<CustomCallsign[]>([]);
  const [newSlotText, setNewSlotText] = useState('');
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchRosterJson<RankDetail & { discord_role_id?: string | null; callsign_type?: string | null; callsign_static?: string | null; callsign_min?: number | null; callsign_max?: number | null }>(`/api/roster/ranks/${rankId}`, 'rank')
      .then((d) => {
        setDetail(d);
        setForm({
          name:            d.name,
          color_hex:       d.color_hex ?? '',
          callsign_prefix: d.callsign_prefix ?? '',
          insignia_url:    d.insignia_url ?? '',
          discord_role_id: d.discord_role_id ?? '',
          callsign_type:          d.callsign_type === 'dynamic' ? 'dynamic' : d.callsign_type === 'custom' ? 'custom' : 'static',
          callsign_static:        (d.callsign_static && d.callsign_static !== 'XX') ? d.callsign_static : '0',
          callsign_static_suffix: d.callsign_static != null && d.callsign_static !== 'XX',
          callsign_min:    d.callsign_min != null ? String(d.callsign_min) : '0',
          callsign_max:    d.callsign_max != null ? String(d.callsign_max) : '0',
        });
        // Initialise per-member suffix map from their stored callsigns
        const suffixMap: Record<number, string> = {};
        for (const m of d.members) {
          const parts = (m.callsign ?? '').split('-');
          const last = parts[parts.length - 1];
          const n = parseInt(last, 10);
          suffixMap[m.id] = isNaN(n) ? '' : String(n);
        }
        setMemberSuffixes(suffixMap);
        setCustomSlots(d.custom_callsigns ?? []);
        // Auto-fill dynamic callsigns for members that don't have a valid one yet
        if (d.callsign_type === 'dynamic' && d.members.length > 0) {
          const rangeMax = d.callsign_max ?? 0;
          fetch(`/api/roster/ranks/${rankId}/auto-assign-callsigns`, { method: 'POST' })
            .then(r => r.ok ? r.json() : null)
            .then((data: { results: { profile_id: number; callsign: string }[] } | null) => {
              if (!data) return;
              const csMap = new Map(data.results.map(x => [x.profile_id, x.callsign]));
              const padLen = Math.max(String(rangeMax).length, 2);
              setDetail(prev => prev ? { ...prev, members: prev.members.map(m => ({ ...m, callsign: csMap.get(m.id) ?? m.callsign })).sort((a, b) => { const nA = parseInt((a.callsign ?? '').split('-').pop() ?? '', 10); const nB = parseInt((b.callsign ?? '').split('-').pop() ?? '', 10); return (!isNaN(nA) && !isNaN(nB)) ? nA - nB : (a.callsign ?? '').localeCompare(b.callsign ?? ''); }) } : prev);
              setMemberSuffixes(prev => {
                const next = { ...prev };
                for (const [pid, cs] of csMap) {
                  const parts = cs.split('-');
                  const n = parseInt(parts[parts.length - 1], 10);
                  next[pid] = isNaN(n) ? '' : String(n).padStart(padLen, '0');
                }
                return next;
              });
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rankId]);

  const set = <K extends keyof RankEditForm>(k: K, v: RankEditForm[K]) => setForm(p => ({ ...p, [k]: v }));

  const saveMemberCallsign = async (memberId: number, suffix: string) => {
    const prefix = form.callsign_prefix.trim();
    const padLen = Math.max(String(parseInt(form.callsign_max) || 0).length, 2);
    const num = parseInt(suffix);
    if (isNaN(num)) return;
    const padded = String(num).padStart(padLen, '0');
    const callsign = prefix ? `${prefix}-${padded}` : padded;
    setSavingMemberId(memberId);
    try {
      await fetch(`/api/roster/${memberId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callsign }),
      });
      // Update the displayed callsign in detail so it reflects immediately
      setDetail(prev => prev ? {
        ...prev,
        members: prev.members.map(m => m.id === memberId ? { ...m, callsign } : m),
      } : prev);
    } catch { /* non-fatal */ } finally {
      setSavingMemberId(null);
    }
  };

  // ── Custom callsign slot CRUD ─────────────────────────────────────────────
  const autoAssignAll = async (maxVal?: number) => {
    try {
      const r = await fetch(`/api/roster/ranks/${rankId}/auto-assign-callsigns`, { method: 'POST' });
      if (!r.ok) return;
      const { results } = await r.json() as { results: { profile_id: number; callsign: string }[] };
      const csMap = new Map(results.map(x => [x.profile_id, x.callsign]));
      setDetail(prev => prev ? {
        ...prev,
        members: prev.members.map(m => ({ ...m, callsign: csMap.get(m.id) ?? m.callsign })).sort((a, b) => { const nA = parseInt((a.callsign ?? '').split('-').pop() ?? '', 10); const nB = parseInt((b.callsign ?? '').split('-').pop() ?? '', 10); return (!isNaN(nA) && !isNaN(nB)) ? nA - nB : (a.callsign ?? '').localeCompare(b.callsign ?? ''); }),
      } : prev);
      const padLen = Math.max(String((maxVal ?? parseInt(form.callsign_max)) || 0).length, 2);
      setMemberSuffixes(prev => {
        const next = { ...prev };
        for (const [pid, cs] of csMap) {
          const parts = cs.split('-');
          const n = parseInt(parts[parts.length - 1], 10);
          next[pid] = isNaN(n) ? '' : String(n).padStart(padLen, '0');
        }
        return next;
      });
    } catch { /* non-fatal */ }
  };

  const reorderSlots = async (newOrder: CustomCallsign[]) => {
    setCustomSlots(newOrder);
    await fetch(`/api/roster/ranks/${rankId}/custom-callsigns/reorder`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: newOrder.map(s => s.id) }),
    });
  };

  const addCustomSlot = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    const r = await fetch(`/api/roster/ranks/${rankId}/custom-callsigns`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callsign: t }),
    });
    if (!r.ok) return;
    const slot = await r.json() as CustomCallsign;
    setCustomSlots(prev => [...prev, slot]);
  };

  const deleteCustomSlot = async (csId: number) => {
    // Capture assignee before deleting so we can clear their display callsign
    const slot = customSlots.find(s => s.id === csId);
    await fetch(`/api/roster/rank-callsigns/${csId}`, { method: 'DELETE' });
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
    const r = await fetch(`/api/roster/rank-callsigns/${csId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callsign }),
    });
    if (!r.ok) return;
    const updated = await r.json() as CustomCallsign;
    setCustomSlots(prev => prev.map(s => s.id === csId ? updated : s));
    // Sync the new callsign text into the member list if someone is assigned
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
    const r = await fetch(`/api/roster/rank-callsigns/${csId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assigned_profile_id: profileId }),
    });
    if (!r.ok) return;
    const updated = await r.json() as CustomCallsign;
    setCustomSlots(prev => prev.map(s => s.id === csId ? updated : s));
    // Sync callsign changes into the member list
    setDetail(prev => {
      if (!prev) return prev;
      let members = prev.members;
      // Clear the old assignee's callsign (if different from new)
      if (prevAssigneeId && prevAssigneeId !== profileId) {
        members = members.map(m => m.id === prevAssigneeId ? { ...m, callsign: '4D-XX' } : m);
      }
      // Write the slot callsign to the new assignee
      if (updated.assigned_profile_id) {
        members = members.map(m => m.id === updated.assigned_profile_id ? { ...m, callsign: updated.callsign } : m);
      }
      return { ...prev, members };
    });
  };

  const validateColor = (v: string) => {
    if (!v) return true;
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.color_hex && !validateColor(form.color_hex)) { setColorErr('Invalid hex colour (e.g. #3b82f6)'); return; }
    setColorErr('');
    setSaving(true);
    try {
      const body: Record<string, string | number | null> = {
        name: form.name.trim(),
        color_hex: form.color_hex.trim() || null,
        callsign_prefix: form.callsign_prefix.trim() || null,
        insignia_url: form.insignia_url.trim() || null,
        discord_role_id: form.discord_role_id.trim() || null,
        callsign_type: form.callsign_type,
        callsign_static: form.callsign_type === 'static'
          ? (form.callsign_static_suffix ? (form.callsign_static.trim() || '0') : 'XX')
          : null,
        callsign_min: form.callsign_type === 'dynamic' ? (parseInt(form.callsign_min) || 0) : null,
        callsign_max: form.callsign_type === 'dynamic' ? (parseInt(form.callsign_max) || 0) : null,
      };
      const res = await fetch(`/api/roster/ranks/${rankId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Failed to save.');
      }
      // Auto-fill dynamic callsigns after saving (fires in background)
      if (form.callsign_type === 'dynamic') void autoAssignAll();
      toast.success(form.discord_role_id.trim() ? 'Rank saved — Discord sync triggered.' : 'Rank saved.');
      onSaved();
      onClose();
    } catch (err) {
      // toast handled by caller
    } finally {
      setSaving(false);
    }
  };

  const rankColor = form.color_hex && validateColor(form.color_hex) ? form.color_hex : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-xl rounded-2xl border border-[#1e2d42] bg-[#070d16] shadow-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#131f30] px-7 pt-7 pb-5">
          <div className="flex items-center gap-3">
            {rankColor ? (
              <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center" style={{ backgroundColor: rankColor + '22', border: `2px solid ${rankColor}` }}>
                {form.insignia_url
                  ? <img src={form.insignia_url} alt="" className="h-5 w-5 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  : <Shield className="h-4 w-4" style={{ color: rankColor }} />}
              </span>
            ) : (
              <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center bg-[#0a1525] border border-[#1f3050]">
                <Shield className="h-4 w-4 text-[#3f5470]" />
              </span>
            )}
            <div>
              <h3 className="text-base font-black text-white">Edit Rank</h3>
              <p className="text-xs text-[#526179]">{detail?.name ?? '…'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center text-sm font-bold text-[#8ea1bb]">Loading rank…</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-7 pt-6 pb-4 space-y-5">

              {/* Name */}
              <div>
                <label className={labelCls}>Rank Name <span className="text-red-400">*</span></label>
                <input type="text" required value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
              </div>

              {/* Colour */}
              <div>
                <label className={labelCls}>Colour Hex</label>
                <div className="flex items-center gap-3">
                  {/* Native colour picker as swatch */}
                  <div
                    className="h-9 w-10 shrink-0 rounded-lg border border-[#1f3050] cursor-pointer overflow-hidden relative"
                    style={{ backgroundColor: rankColor ?? '#07111f' }}
                    title="Open colour picker"
                    onClick={() => colorInputRef.current?.click()}>
                    <input ref={colorInputRef} type="color"
                      value={rankColor ?? '#4384ff'}
                      onChange={e => { set('color_hex', e.target.value); setColorErr(''); }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                  </div>
                  <input type="text" placeholder="#4384ff"
                    value={form.color_hex}
                    onChange={e => { set('color_hex', e.target.value); setColorErr(''); }}
                    className={`${inputCls} font-mono`} />
                </div>
                {colorErr && <p className="mt-1 text-[10px] font-bold text-red-400">{colorErr}</p>}
                <p className="mt-1.5 text-[10px] text-[#3f5470]">Used to tint rank chips and badges across the CAD.</p>
              </div>

              {/* Callsign configuration */}
              <div className="space-y-3">
                {/* Prefix — hidden for custom type (callsigns are fully specified) */}
                {form.callsign_type !== 'custom' && (
                  <div>
                    <label className={labelCls}>Callsign Prefix <span className="text-[#3f5470] normal-case font-normal">(optional)</span></label>
                    <input type="text" placeholder="e.g. 1D, 2D, 3D" value={form.callsign_prefix}
                      onChange={e => set('callsign_prefix', e.target.value)} className={inputCls} />
                    <p className="mt-1.5 text-[10px] text-[#3f5470]">First segment of the callsign (e.g. <span className="font-mono">3D</span>). A dash is inserted automatically before the suffix.</p>
                  </div>
                )}

                {/* Callsign Type toggle */}
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

                  {/* Static — optional numeric suffix */}
                  {form.callsign_type === 'static' && (
                    <div className="mt-3 space-y-2">
                      {/* Toggle */}
                      <button type="button"
                        onClick={() => set('callsign_static_suffix', !form.callsign_static_suffix)}
                        className="flex items-center gap-2 text-[10px] text-[#a8b7cd] hover:text-white transition-colors">
                        <div className={`relative h-4 w-7 rounded-full transition-colors ${form.callsign_static_suffix ? 'bg-[#4384ff]' : 'bg-[#1f3050]'}`}>
                          <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${form.callsign_static_suffix ? 'left-3.5' : 'left-0.5'}`} />
                        </div>
                        Include number suffix
                      </button>
                      {/* Stepper — only shown when suffix is on */}
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

                  {/* Dynamic — min/max range */}
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

                  {/* Custom — explicit named callsign slots */}
                  {form.callsign_type === 'custom' && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[10px] text-[#3f5470] mb-2">
                        Create named callsign slots and assign a member from this rank to each one. Changes save immediately.
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
                            reorderSlots(next);
                          }}
                          className={`flex items-center gap-2 rounded transition-colors ${dragOverIndex === index ? 'opacity-40' : ''}`}
                        >
                          {/* Drag handle */}
                          <span className="shrink-0 cursor-grab active:cursor-grabbing text-[#2a3a50] hover:text-[#526179]">
                            <GripVertical className="h-4 w-4" />
                          </span>
                          {/* Callsign text — editable on blur */}
                          <input
                            type="text"
                            defaultValue={slot.callsign}
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== slot.callsign) updateSlotCallsign(slot.id, v);
                            }}
                            className="w-28 shrink-0 rounded border border-[#1f3050] bg-[#070d16] px-2 py-1.5 font-mono text-[10px] text-white outline-none focus:border-[#4384ff]"
                          />
                          {/* Member assignment dropdown */}
                          <select
                            value={slot.assigned_profile_id ?? ''}
                            onChange={e => assignMemberToSlot(slot.id, e.target.value ? Number(e.target.value) : null)}
                            className="flex-1 h-7 rounded border border-[#1f3050] bg-[#070d16] px-2 text-[10px] text-white outline-none focus:border-[#4384ff] appearance-none cursor-pointer"
                          >
                            <option value="">— Unassigned —</option>
                            {detail?.members.map(m => (
                              <option key={m.id} value={m.id}>{m.username}</option>
                            ))}
                          </select>
                          {/* Delete */}
                          <button type="button" onClick={() => deleteCustomSlot(slot.id)}
                            className="h-7 w-7 shrink-0 flex items-center justify-center rounded border border-[#1f3050] bg-[#070d16] text-[#526179] hover:bg-red-900/30 hover:text-red-400 hover:border-red-800 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {/* Add new slot row */}
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text" placeholder="e.g. CHIEF-1" value={newSlotText}
                          onChange={e => setNewSlotText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addCustomSlot(newSlotText);
                              setNewSlotText('');
                            }
                          }}
                          className="w-28 shrink-0 rounded border border-[#131f30] bg-[#07111f] px-2 py-1.5 font-mono text-[10px] text-[#a8b7cd] placeholder:text-[#2a3a50] outline-none focus:border-[#4384ff]"
                        />
                        <button type="button"
                          onClick={() => { if (newSlotText.trim()) { addCustomSlot(newSlotText); setNewSlotText(''); } }}
                          className="h-7 flex items-center gap-1 rounded border border-[#131f30] bg-[#070d16] px-2.5 text-[10px] font-bold text-[#a8b7cd] hover:bg-white/5 transition-colors">
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Live preview — not shown for custom type */}
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

              {/* Insignia */}
              <ImageInput
                value={form.insignia_url}
                onChange={v => set('insignia_url', v)}
                label="Insignia Image"
                accent="#4384ff"
                hint="Badge or insignia icon shown on the roster."
                labelClassName={labelCls}
                previewHeight="h-24"
              />

              {/* Discord Role Link */}
              <div>
                <label className={labelCls}>Linked Discord Role</label>
                <select
                  value={form.discord_role_id}
                  onChange={e => set('discord_role_id', e.target.value)}
                  className={inputCls + ' cursor-pointer'}
                >
                  <option value="">— No Discord role linked —</option>
                  {dpsGuildRoles.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-[10px] text-[#3f5470]">Link this rank to a role in the DPS Discord server.</p>
              </div>
            </div>

            {/* Members */}
            <div className="border-t border-[#131f30] px-7 pt-5 pb-4">
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
                <p className="text-[11px] text-[#2a3a50]">No officers currently hold this rank.</p>
              ) : (
                <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                  {detail.members.map(m => {
                    const isDynamic = form.callsign_type === 'dynamic';
                    const suffix = memberSuffixes[m.id] ?? '';
                    const isSaving = savingMemberId === m.id;
                    const padLen = Math.max(String(parseInt(form.callsign_max) || 0).length, 2);
                    const pre = form.callsign_prefix.trim();
                    const preview = suffix !== '' && !isNaN(parseInt(suffix))
                      ? (pre ? `${pre}-${String(parseInt(suffix)).padStart(padLen, '0')}` : String(parseInt(suffix)).padStart(padLen, '0'))
                      : (m.callsign || '—');
                    return (
                      <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#0f1b28] bg-[#070d16] px-3 py-2">
                        <DiscordAvatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black text-white truncate">{m.username}</p>
                          {m.discord_username && <p className="text-[10px] text-[#526179]">@{m.discord_username}</p>}
                        </div>
                        <span className="shrink-0 font-black text-[10px] text-[#4384ff]">{m.callsign || '—'}</span>
                        <StatusBadge status={m.status} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 border-t border-[#131f30] px-7 py-5">
              <button type="button" onClick={onClose}
                className="flex-1 h-10 rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-60">
                {saving ? 'Saving…' : 'Save Rank'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// ── Add Officer Modal ─────────────────────────────────────────────────────────
type AddForm = {
  username: string; discord_username: string; discord_id: string;
  dps_rank: string; dps_role: string; callsign: string; status: string; appointed_date: string;
};

type UserHit = { id: number | null; username: string; discord_username: string; discord_id: string; rank: string };

const AddOfficerModal = ({
  onClose, onAdd, ranks,
}: {
  onClose: () => void;
  onAdd: (form: AddForm) => Promise<void>;
  ranks: DpsRank[];
}) => {
  const [form, setForm] = useState<AddForm>({
    username: '', discord_username: '', discord_id: '',
    dps_rank: 'Unranked', dps_role: '', callsign: '', status: 'Active', appointed_date: '',
  });
  const [saving, setSaving]         = useState(false);
  const [suggestions, setSuggestions] = useState<UserHit[]>([]);
  const [showSugg, setShowSugg]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);

  const set = <K extends keyof AddForm>(k: K, v: AddForm[K]) => setForm(p => ({ ...p, [k]: v }));

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowSugg(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const onUsernameChange = (val: string) => {
    set('username', val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); setShowSugg(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const list = await fetchRosterArray<UserHit>(
          `/api/roster/member-search?q=${encodeURIComponent(val.trim())}`,
          'members',
        );
        setSuggestions(list);
        setShowSugg(list.length > 0);
      } catch { /* ignore */ }
    }, 280);
  };

  const pickUser = (hit: UserHit) => {
    setForm(p => ({
      ...p,
      username:         hit.username,
      discord_username: hit.discord_username || p.discord_username,
      discord_id:       hit.discord_id       || p.discord_id,
    }));
    setSuggestions([]); setShowSugg(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.username.trim()) return;
    setSaving(true);
    try {
      await onAdd(form);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add officer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-base font-black text-white">Add New Officer</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Username with typeahead ── */}
          <div ref={wrapRef} className="relative">
            <label className={labelCls}>CAD Username <span className="text-red-400">*</span></label>
            <input
              type="text" required autoComplete="off"
              placeholder="Start typing a name or ID…"
              value={form.username}
              onChange={e => onUsernameChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSugg(true)}
              className={inputCls}
            />
            {showSugg && (
              <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-[#1f3050] bg-[#070e1a] shadow-2xl">
                {suggestions.map(hit => (
                  <li key={hit.discord_id || hit.id || hit.username}>
                    <button
                      type="button"
                      onMouseDown={() => pickUser(hit)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[#0d1a2e]"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-black text-white truncate">{hit.username}</span>
                        {hit.discord_username && (
                          <span className="block text-[10px] text-[#526179] truncate">@{hit.discord_username}</span>
                        )}
                      </div>
                      <span className="shrink-0 rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-black text-[#526179]">
                        {hit.rank || 'DPS Server'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Discord Username</label>
              <input type="text" placeholder="e.g. awsomeman04" value={form.discord_username}
                onChange={e => set('discord_username', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Discord ID</label>
              <input type="text" placeholder="Snowflake ID" value={form.discord_id}
                onChange={e => set('discord_id', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>DPS Rank</label>
              <select value={form.dps_rank} onChange={e => set('dps_rank', e.target.value)} className={selectCls}>
                <option value="Unranked">Unranked</option>
                {(ranks.length > 0 ? ranks.map(r => r.name) : RANK_OPTIONS).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Callsign</label>
              <input type="text" placeholder="e.g. 1A-01" value={form.callsign}
                onChange={e => set('callsign', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>DPS Role</label>
            <input type="text" placeholder="e.g. Patrol, Detective, SWAT" value={form.dps_role}
              onChange={e => set('dps_role', e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={selectCls}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Appointed Date</label>
              <input type="date" value={form.appointed_date}
                onChange={e => set('appointed_date', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-60">
              {saving ? 'Adding…' : 'Add Officer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────────

type PageBlock =
  | { type: 'text'; body: string }
  | { type: 'heading'; text: string }
  | { type: 'bold_heading'; text: string }
  | { type: 'divider' }
  | { type: 'thumbnail'; url: string; caption: string }
  | { type: 'footer'; text: string };

const DepartmentOfPublicSafety = () => {
  const navigate = useNavigate();
  const { online: cadOnline, mode: cadMode } = useCadStatus();

  const [session,      setSession]      = useState<CadSession | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  type PanelSection = 'personnel' | 'division' | 'vehicle' | 'equipment' | 'resources' | 'calendar' | 'information';
  const PANEL_SECTIONS = new Set<string>([
    'personnel', 'division', 'vehicle', 'equipment', 'resources', 'calendar', 'information',
  ]);
  const [activeTab, setActiveTab, rawSection] = usePortalSection<Tab>({
    base: 'dps',
    valid: DPS_SECTIONS,
    defaultSection: 'personnel-roster',
    resolveParent: (raw) =>
      (raw === 'department-panel' || raw.startsWith('department-panel-') ? 'department-panel' : null),
  });
  const panelSection = useMemo((): PanelSection | null => {
    const parsed = parseNestedPortalSection(rawSection, 'department-panel');
    if (!parsed.isParent || !parsed.nested || !PANEL_SECTIONS.has(parsed.nested)) return null;
    return parsed.nested as PanelSection;
  }, [rawSection]);
  const setPanelSection = useCallback((next: PanelSection | null) => {
    navigate(nestedPortalSectionPath('dps', 'department-panel', next));
  }, [navigate]);
  const [divisionRanksForEdit, setDivisionRanksForEdit] = useState<{ id: number; name: string; division_id: number | null }[]>([]);
  const [rosterDivisions, setRosterDivisions] = useState<RosterDivision[]>([]);
  const [divisionStats, setDivisionStats] = useState({ divisions: 0, ranks: 0 });
  const [profileOpen,  setProfileOpen]  = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [showPhone,    setShowPhone]    = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [phoneCallEvent, setPhoneCallEvent] = useState<import('@/hooks/usePhoneSSE').PhoneSSEEvent | null>(null);
  const [answeredCall, setAnsweredCall] = useState<{ phone: string; name: string; callId: string } | null>(null);

  // Personnel roster
  const [roster,        setRoster]        = useState<RosterMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSearch,  setRosterSearch]  = useState('');
  const [collapsed,     setCollapsed]     = useState<Record<string, boolean>>({});

  // Department panel — personnel
  const [panelMembers,  setPanelMembers]  = useState<RosterMember[]>([]);
  const [panelLoading,  setPanelLoading]  = useState(false);
  const [panelSearch,   setPanelSearch]   = useState('');
  const [panelMembersCollapsed, setPanelMembersCollapsed] = useState(false);
  const [editMember,    setEditMember]    = useState<RosterMember | null>(null);
  const [accessMemberId, setAccessMemberId] = useState<number | null>(null);
  const [addOpen,       setAddOpen]       = useState(false);
  // Department panel — ranks (for modal dropdowns)
  const [ranksRaw,        setRanksRaw]        = useState<DpsRank[]>([]);
  const ranks = Array.isArray(ranksRaw) ? ranksRaw : [];
  const setRanks = (value: React.SetStateAction<DpsRank[]>) => {
    setRanksRaw(prev => {
      const base = Array.isArray(prev) ? prev : [];
      const next = typeof value === 'function' ? value(base) : value;
      return Array.isArray(next) ? next : [];
    });
  };
  const [ranksLoading,    setRanksLoading]    = useState(false);
  const [syncingCallsigns, setSyncingCallsigns] = useState(false);
  const [syncingDiscord, setSyncingDiscord] = useState(false);

  // Vehicle roster
  const [fleet,             setFleet]             = useState<FleetVehicle[]>([]);
  const [fleetLoading,      setFleetLoading]       = useState(false);
  // Vehicle panel (department panel edit view)
  const [vehiclePanelSearch,  setVehiclePanelSearch]  = useState('');
  const [fleetCategories,     setFleetCategories]     = useState<{id: number; name: string; sort_order: number}[]>([]);
  const [categoriesLoading,   setCategoriesLoading]   = useState(false);
  const [addCategoryOpen,     setAddCategoryOpen]     = useState(false);
  const [newCategoryName,     setNewCategoryName]     = useState('');
  const [addingCategory,      setAddingCategory]      = useState(false);
  const [editingCategoryId,   setEditingCategoryId]   = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [addVehicleCatId,     setAddVehicleCatId]     = useState<number | null>(null);
  const [addingVehicleInCat,  setAddingVehicleInCat]  = useState(false);
  const [addRankDropOpen,     setAddRankDropOpen]     = useState(false);
  const [editRankDropOpen,    setEditRankDropOpen]    = useState(false);
  const [newVehicleForm,      setNewVehicleForm]      = useState({
    name: '', year: '', restrictToRanks: '', restrictToDivisions: [] as string[], notes: '', imageUrl: '', liveries: '',
    imageScale: 1, imagePosX: 50, imagePosY: 50,
  });
  const [savingVehicle,       setSavingVehicle]       = useState(false);
  const [editVehicleItem,     setEditVehicleItem]     = useState<FleetVehicle | null>(null);

  // Equipment roster
  const [equipment,              setEquipment]              = useState<EquipmentItem[]>([]);
  const [equipmentLoading,       setEquipmentLoading]       = useState(false);
  const [equipmentPanelSearch,   setEquipmentPanelSearch]   = useState('');
  const [equipmentCategories,    setEquipmentCategories]    = useState<{id: number; name: string; sort_order: number}[]>([]);
  const [eqCategoriesLoading,    setEqCategoriesLoading]    = useState(false);
  const [addEqCategoryOpen,      setAddEqCategoryOpen]      = useState(false);
  const [newEqCategoryName,      setNewEqCategoryName]      = useState('');
  const [addingEqCategory,       setAddingEqCategory]       = useState(false);
  const [editingEqCategoryId,    setEditingEqCategoryId]    = useState<number | null>(null);
  const [editingEqCategoryName,  setEditingEqCategoryName]  = useState('');
  const [addEquipmentCatId,      setAddEquipmentCatId]      = useState<number | null>(null);
  const [addingEquipmentInCat,   setAddingEquipmentInCat]   = useState(false);
  const [addEqRankDropOpen,      setAddEqRankDropOpen]      = useState(false);
  const [editEqRankDropOpen,     setEditEqRankDropOpen]     = useState(false);
  const [newEquipmentForm,       setNewEquipmentForm]       = useState({
    name: '', restrictToRanks: '', restrictToDivisions: [] as string[], notes: '', imageUrl: '',
    imageScale: 1, imagePosX: 50, imagePosY: 50,
  });
  const [savingEquipment,        setSavingEquipment]        = useState(false);
  const [editEquipmentItem,      setEditEquipmentItem]      = useState<EquipmentItem | null>(null);
  // equipment drag-and-drop
  const [dragEquipmentId,        setDragEquipmentId]        = useState<number | null>(null);
  const [dragOverEquipmentId,    setDragOverEquipmentId]    = useState<number | null>(null);
  const [dragOverEquipmentSide,  setDragOverEquipmentSide]  = useState<'before' | 'after'>('after');
  const [dragOverEquipmentCat,   setDragOverEquipmentCat]   = useState<string | null>(null);

  // Department panel — groups (roster section headings)
  const [groupsRaw,        setGroupsRaw]        = useState<DpsGroup[]>([]);
  const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
  const setGroups = (value: React.SetStateAction<DpsGroup[]>) => {
    setGroupsRaw(prev => {
      const base = Array.isArray(prev) ? prev : [];
      const next = typeof value === 'function' ? value(base) : value;
      return Array.isArray(next) ? next : [];
    });
  };
  const [groupsLoading,    setGroupsLoading]    = useState(false);
  const [addTitleOpen,     setAddTitleOpen]     = useState(false);
  const [newGroupName,     setNewGroupName]     = useState('');
  const [addingGroup,      setAddingGroup]      = useState(false);
  const [editingGroupId,   setEditingGroupId]   = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  // per-group "Add Rank" inline form
  const [addRankGroupId,   setAddRankGroupId]   = useState<number | null>(null);
  const [newRankName,      setNewRankName]      = useState('');
  const [newRankDiscordRoleId, setNewRankDiscordRoleId] = useState('');
  const [addingRank,       setAddingRank]       = useState(false);
  // rank edit modal
  const [editRankId,       setEditRankId]       = useState<number | null>(null);
  const [dpsGuildRoles,    setDpsGuildRoles]    = useState<DpsDiscordRole[]>([]);
  // Event calendar
  const [eventsRaw,       setEventsRaw]       = useState<DpsEvent[]>([]);
  const events = Array.isArray(eventsRaw) ? eventsRaw : [];
  const setEvents = (value: React.SetStateAction<DpsEvent[]>) => {
    setEventsRaw(prev => {
      const base = Array.isArray(prev) ? prev : [];
      const next = typeof value === 'function' ? value(base) : value;
      return Array.isArray(next) ? next : [];
    });
  };
  const [eventsLoading,   setEventsLoading]   = useState(false);
  const [showEventForm,   setShowEventForm]   = useState(false);
  const [editingEvent,    setEditingEvent]    = useState<DpsEvent | null>(null);
  const [eventForm,       setEventForm]       = useState({
    title: '', event_date: '', event_time: '', location: '', purpose: '',
    hosted_by: '', hosting_department: 'Department of Public Safety', is_public: false,
  });
  const [savingEvent,     setSavingEvent]     = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);

  // Department information content
  const [infoSubSection,   setInfoSubSection]   = useState<'index' | 'page' | null>(null);
  const [pageInfo,         setPageInfo]         = useState<{ sections: PageBlock[] } | null>(null);
  const [infoLoading,      setInfoLoading]      = useState(false);
  const [indexInfoForm,    setIndexInfoForm]    = useState({ description: '', divisions: '', sub_departments: [{ name: '', description: '' }] });
  const [pageInfoSections, setPageInfoSections] = useState<PageBlock[]>([{ type: 'text', body: '' }]);
  const [savingInfo,       setSavingInfo]       = useState(false);

  // Resources
  const [resources,           setResources]           = useState<DpsResource[]>([]);
  const [resourcesLoading,    setResourcesLoading]    = useState(false);
  const [addResourceStep,     setAddResourceStep]     = useState<0 | 1 | 2>(0); // 0=closed, 1=name, 2=type
  const [newResourceName,     setNewResourceName]     = useState('');
  const [creatingResource,    setCreatingResource]    = useState(false);
  const [newResourceType,     setNewResourceType]     = useState<'document' | 'file'>('document');
  const [uploadFile,          setUploadFile]          = useState<File | null>(null);
  const [uploadStatus,        setUploadStatus]        = useState<string | null>(null);
  const [openPdf,             setOpenPdf]             = useState<DpsResource | null>(null);
  const [openDocId,           setOpenDocId]           = useState<number | null>(null);
  const [openDocCanEdit,      setOpenDocCanEdit]       = useState(false);
  const [deletingResourceId,  setDeletingResourceId]  = useState<number | null>(null);
  const [resourceTargetDivisionId, setResourceTargetDivisionId] = useState<number | null>(null);
  const [newResourceDivisionOnly, setNewResourceDivisionOnly] = useState(true);
  const [newResourceAllowedRanks, setNewResourceAllowedRanks] = useState<string[]>([]);
  const [newResourcePersonnelOnly, setNewResourcePersonnelOnly] = useState(false);
  const [newResourceAllowedDpsRanks, setNewResourceAllowedDpsRanks] = useState<string[]>([]);
  const [divisionResourcesTick, setDivisionResourcesTick] = useState(0);
  // rank drag-and-drop
  const [dragRankId,       setDragRankId]       = useState<number | null>(null);
  const [dragOverRankId,   setDragOverRankId]   = useState<number | null>(null);
  const [dragOverSide,     setDragOverSide]     = useState<'before' | 'after'>('after');
  const [dragOverGroupId,  setDragOverGroupId]  = useState<number | null>(null);
  // group drag-and-drop
  const [dragGroupId,      setDragGroupId]      = useState<number | null>(null);
  const [dragGroupOverId,  setDragGroupOverId]  = useState<number | null>(null);
  const [dragGroupOverSide, setDragGroupOverSide] = useState<'before' | 'after'>('after');
  // vehicle drag-and-drop
  const [dragVehicleId,       setDragVehicleId]       = useState<number | null>(null);
  const [dragOverVehicleId,   setDragOverVehicleId]   = useState<number | null>(null);
  const [dragOverVehicleSide, setDragOverVehicleSide] = useState<'before' | 'after'>('after');
  const [dragOverVehicleCat,  setDragOverVehicleCat]  = useState<string | null>(null);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const validate = async () => {
      const s = getCadSession();
      if (!s) { navigate('/', { replace: true }); return; }
      try {
        const res = await fetch('/api/cad-auth/session-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ id: s.id, email: s.email }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { active: boolean; account?: CadSession };
        if (!data.active || !data.account) {
          clearCadSession(); toast.error('Session expired. Please log in again.');
          navigate('/', { replace: true }); return;
        }
        setCadSession(data.account);
        if (mounted) { setSession(data.account); setIsLoading(false); }
      } catch {
        if (mounted) { setSession(s); setIsLoading(false); }
      }
    };
    validate();
    return () => { mounted = false; };
  }, [navigate]);

  // ── Phone SSE ────────────────────────────────────────────────────────────────
  usePhoneSSE(session ? session.username : null, (ev) => {
    if (ev.type === 'incoming_call') {
      setIncomingCall({ callId: ev.callId, callerUsername: ev.callerUsername, calleeName: ev.calleeName, phone: ev.phone });
    } else { setPhoneCallEvent(ev); }
  });

  const handleAnswer = async (callId: string) => {
    const call = incomingCall; setIncomingCall(null);
    await fetch('/api/phone/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callId }) });
    if (call) { setAnsweredCall({ phone: call.phone, name: call.calleeName, callId }); setShowPhone(true); }
  };
  const handleDecline = async (callId: string) => {
    setIncomingCall(null);
    await fetch('/api/phone/end', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callId, username: session?.username }) });
  };
  const handleSignOut = () => { setIsSigningOut(true); clearCadSession(); toast.success('Signed out successfully.'); navigate('/', { replace: true }); };

  // ── Vehicle roster fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'vehicle-roster') return;
    setFleetLoading(true);
    fetchRosterArray<FleetVehicle>('/api/roster/vehicles', 'vehicle roster')
      .then(setFleet)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load vehicle roster.'))
      .finally(() => setFleetLoading(false));
  }, [activeTab]);

  // ── Equipment roster fetch ───────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'equipment-roster') return;
    setEquipmentLoading(true);
    fetchRosterArray<EquipmentItem>('/api/roster/equipment', 'equipment roster')
      .then(setEquipment)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load equipment roster.'))
      .finally(() => setEquipmentLoading(false));
  }, [activeTab]);

  // ── Mount: load groups + ranks so the Department Panel access check works ─────
  useEffect(() => {
    loadRosterMetadata()
      .then(({ groups: grps, ranks: rnks, divs, divRanks }) => {
        setGroups(grps);
        setRanks(rnks);
        setDivisionRanksForEdit(divRanks);
        setRosterDivisions(divs);
        setDivisionStats({
          divisions: divs.length,
          ranks: divRanks.length,
        });
      })
      .catch(() => { /* silent — button just won't show until data is available */ });
  }, []);

  // ── Roster for membership checks on Resources tab ────────────────────────────
  useEffect(() => {
    if (activeTab !== 'resources') return;
    if (roster.length > 0) return;
    fetchRosterArray<RosterMember>('/api/roster', 'roster')
      .then((rows) => setRoster(dedupeRosterMembersById(rows.map(normalizeRosterMember))))
      .catch(() => { /* silent — division-only resources may stay hidden until roster loads elsewhere */ });
  }, [activeTab, roster.length]);

  // ── Personnel / Division roster fetch ─────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'personnel-roster' && activeTab !== 'division-roster' && activeTab !== 'divisions-information') return;
    let cancelled = false;
    setRosterLoading(true);

    void (async () => {
      try {
        const members = await fetchRosterArray<RosterMember>('/api/roster', 'roster');
        if (cancelled) return;
        setRoster(dedupeRosterMembersById(members.map(normalizeRosterMember)));
      } catch (err) {
        if (!cancelled) {
          setRoster([]);
          toast.error(err instanceof Error ? err.message : 'Failed to load roster.');
        }
      } finally {
        if (!cancelled) setRosterLoading(false);
      }

      if (cancelled) return;
      void loadRosterMetadata()
        .then((meta) => {
          if (cancelled) return;
          setGroups(meta.groups);
          setRanks(meta.ranks);
          setDivisionRanksForEdit(meta.divRanks);
          setRosterDivisions(meta.divs);
          setDivisionStats(s => ({ ...s, divisions: meta.divs.length, ranks: meta.divRanks.length }));
        })
        .catch(() => { /* metadata may already be loaded from mount */ });
    })();

    return () => { cancelled = true; };
  }, [activeTab]);

  // ── Department panel fetch (all members including inactive) ───────────────────
  const fetchPanelMembers = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setPanelLoading(true);
    fetchRosterArray<RosterMember>('/api/roster?all=1', 'members')
      .then((rows) => setPanelMembers(dedupeRosterMembersById(rows.map(normalizeRosterMember))))
      .catch((err) => {
        if (!opts?.silent) {
          setPanelMembers([]);
          toast.error(err instanceof Error ? err.message : 'Failed to load members.');
        }
      })
      .finally(() => { if (!opts?.silent) setPanelLoading(false); });
  };
  const fetchRanks = () => {
    setRanksLoading(true);
    fetchRosterArray<DpsRank>('/api/roster/ranks', 'ranks')
      .then(setRanks)
      .catch((err) => {
        setRanks([]);
        toast.error(err instanceof Error ? err.message : 'Failed to load ranks.');
      })
      .finally(() => setRanksLoading(false));
  };
  const handleSyncAllCallsigns = async () => {
    setSyncingCallsigns(true);
    try {
      const dynamicRanks = ranks.filter(r => r.callsign_type === 'dynamic');
      await Promise.all(dynamicRanks.map(r =>
        fetch(`/api/roster/ranks/${r.id}/auto-assign-callsigns`, { method: 'POST' }).catch(() => null)
      ));
      fetchPanelMembers();
      toast.success('Callsigns synced.');
    } catch {
      toast.error('Sync failed.');
    } finally {
      setSyncingCallsigns(false);
    }
  };

  /** Pull DPS Discord guild members and apply linked-rank add/remove to the roster. */
  const handleSyncDiscordRoles = async (opts?: { silent?: boolean }) => {
    setSyncingDiscord(true);
    try {
      const res = await fetch('/api/roster/sync-discord-roles', { method: 'POST' });
      const data = await res.json().catch(() => ({})) as {
        assigned?: number; skipped?: number; removed?: number; errors?: string[];
        divisions?: { assigned?: number; removed?: number; errors?: string[] };
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Discord sync failed.');
      fetchPanelMembers();
      fetchRanks();
      if (!opts?.silent) {
        const assigned = (data.assigned ?? 0) + (data.divisions?.assigned ?? 0);
        const removed = (data.removed ?? 0) + (data.divisions?.removed ?? 0);
        const errCount = (Array.isArray(data.errors) ? data.errors.length : 0)
          + (Array.isArray(data.divisions?.errors) ? data.divisions.errors.length : 0);
        if (errCount > 0) {
          toast.error(`Discord sync finished with ${errCount} error(s). Added ${assigned}, removed ${removed}.`);
        } else {
          toast.success(`Discord sync complete — added ${assigned}, removed ${removed}.`);
        }
      }
    } catch (err) {
      if (!opts?.silent) {
        toast.error(err instanceof Error ? err.message : 'Discord sync failed.');
      }
    } finally {
      setSyncingDiscord(false);
    }
  };
  const fetchGroups = () => {
    setGroupsLoading(true);
    fetchRosterArray<DpsGroup>('/api/roster/groups', 'groups')
      .then(setGroups)
      .catch((err) => {
        setGroups([]);
        toast.error(err instanceof Error ? err.message : 'Failed to load groups.');
      })
      .finally(() => setGroupsLoading(false));
  };
  const fetchEvents = () => {
    setEventsLoading(true);
    fetchRosterArray<DpsEvent>('/api/roster/events', 'events')
      .then(setEvents)
      .catch((err) => {
        setEvents([]);
        toast.error(err instanceof Error ? err.message : 'Failed to load events.');
      })
      .finally(() => setEventsLoading(false));
  };
  useEffect(() => {
    if (activeTab === 'event-calendar' || activeTab === 'department-panel') fetchEvents();
  }, [activeTab]);

  const fetchPageInfo = () => {
    setInfoLoading(true);
    fetchRosterJson<{ sections?: (PageBlock | Record<string, unknown>)[] }>('/api/roster/content/page_info', 'page info')
      .then((d) => {
        if (d.sections?.length) {
          // Migrate old heading+body format to new block format
          const sections: PageBlock[] = (d.sections as any[]).map((s: any): PageBlock => {
            if (s.type) return s as PageBlock;
            if (s.body) return { type: 'text', body: s.body };
            return { type: 'text', body: '' };
          });
          setPageInfo({ sections });
          setPageInfoSections(sections);
        } else {
          setPageInfo(null);
          setPageInfoSections([{ type: 'text', body: '' }]);
        }
      })
      .catch(() => {})
      .finally(() => setInfoLoading(false));
  };

  const fetchIndexInfo = () => {
    fetchRosterJson<{ description?: string; divisions?: string[]; sub_departments?: { name: string; description: string }[] }>(
      '/api/roster/content/index_info',
      'index info',
    )
      .then((d) => {
        if (d.description) {
          setIndexInfoForm({
            description: d.description,
            divisions: (d.divisions ?? []).join('\n'),
            sub_departments: d.sub_departments?.length ? d.sub_departments : [{ name: '', description: '' }],
          });
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (activeTab === 'information') fetchPageInfo();
  }, [activeTab]);

  const fetchFleetPanel = () => {
    setFleetLoading(true); setCategoriesLoading(true);
    Promise.all([
      fetchRosterArray<FleetVehicle>('/api/roster/vehicles', 'vehicles'),
      fetchRosterArray<{ id: number; name: string; sort_order: number }>('/api/roster/fleet/categories', 'vehicle categories'),
    ])
      .then(([vehicles, cats]) => {
        setFleet(vehicles);
        setFleetCategories(cats);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load vehicles.'))
      .finally(() => { setFleetLoading(false); setCategoriesLoading(false); });
  };

  const fetchEquipmentPanel = () => {
    setEquipmentLoading(true); setEqCategoriesLoading(true);
    Promise.all([
      fetchRosterArray<EquipmentItem>('/api/roster/equipment', 'equipment'),
      fetchRosterArray<{ id: number; name: string; sort_order: number }>('/api/roster/equipment/categories', 'equipment categories'),
    ])
      .then(([items, cats]) => {
        setEquipment(items);
        setEquipmentCategories(cats);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load equipment.'))
      .finally(() => { setEquipmentLoading(false); setEqCategoriesLoading(false); });
  };

  useEffect(() => {
    if (!session) return;
    if (panelMembers.length > 0 || roster.length > 0) return;
    fetchPanelMembers({ silent: true });
  }, [session?.discord_id, session?.username, session?.id]);

  useEffect(() => {
    if (panelSection === 'personnel') {
      fetchPanelMembers(); fetchRanks(); fetchGroups();
      // Sync linked Discord roles from the DPS guild into the roster
      void handleSyncDiscordRoles({ silent: true });
      // Load DPS guild roles for the Discord-role dropdown in the rank edit modal
      fetch('/api/roster/discord-roles?refresh=1', { headers: { accept: 'application/json' } })
        .then(r => r.ok ? r.json() : [])
        .then((rows: DpsDiscordRole[]) => setDpsGuildRoles(rows))
        .catch(() => { /* non-fatal — dropdown just stays empty */ });
    }
    if (panelSection === 'division' || panelSection === null) {
      // Silent refresh when re-entering division edit so the panel does not flicker
      fetchPanelMembers({ silent: panelSection === 'division' && panelMembers.length > 0 });
      // Sync Discord-linked division ranks onto the roster
      if (panelSection === 'division') {
        fetch('/api/roster/sync-division-discord-roles', { method: 'POST' })
          .then(r => r.ok ? r.json() : null)
          .then(() => fetchPanelMembers({ silent: true }))
          .catch(() => { /* non-fatal */ });
      }
      fetchRosterArray<RosterDivision>('/api/roster/divisions', 'divisions')
        .then((rows) => {
          setRosterDivisions(rows);
          setDivisionStats(s => ({ ...s, divisions: rows.length }));
        })
        .catch(() => {});
      fetchRosterArray<{ id: number; name: string; division_id: number | null }>('/api/roster/division-ranks', 'division ranks')
        .then((divRanks) => {
          setDivisionRanksForEdit(divRanks);
          setDivisionStats(s => ({ ...s, ranks: divRanks.length }));
        })
        .catch(() => {});
    }
    if (panelSection === 'vehicle' || panelSection === null) { fetchFleetPanel(); fetchRanks(); }
    if (panelSection === 'equipment' || panelSection === null) { fetchEquipmentPanel(); }
    if (panelSection === 'resources') { fetchResources(); }
    if (panelSection === 'information') { fetchIndexInfo(); fetchPageInfo(); }
    if (panelSection !== 'information') setInfoSubSection(null);
  }, [panelSection]);

  useEffect(() => {
    if (editRankId === null && addRankGroupId == null) return;
    fetch('/api/roster/discord-roles?refresh=1', { headers: { accept: 'application/json' } })
      .then(r => r.ok ? r.json() : [])
      .then((rows: DpsDiscordRole[]) => setDpsGuildRoles(rows))
      .catch(() => {});
  }, [editRankId, addRankGroupId]);

  // ── Resources fetch ───────────────────────────────────────────────────────────
  const fetchResources = () => {
    setResourcesLoading(true);
    fetchRosterArray<DpsResource>('/api/resources', 'resources')
      .then(setResources)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load resources.'))
      .finally(() => setResourcesLoading(false));
  };

  useEffect(() => {
    if (activeTab === 'resources') fetchResources();
  }, [activeTab]);

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [profileOpen]);

  const handleCreateResource = async () => {
    if (!newResourceName.trim()) return;
    setCreatingResource(true);
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: newResourceName.trim(),
          type: 'document',
          created_by: session?.username,
          division_id: resourceTargetDivisionId,
          ...(resourceTargetDivisionId != null
            ? {
                division_only: newResourceDivisionOnly,
                allowed_ranks: newResourceAllowedRanks,
              }
            : {
                personnel_only: newResourcePersonnelOnly || newResourceAllowedDpsRanks.length > 0,
                allowed_dps_ranks: newResourceAllowedDpsRanks,
              }),
        }),
      });
      if (!res.ok) throw new Error('Failed to create resource.');
      const doc = await res.json() as DpsResource;
      if (resourceTargetDivisionId == null) {
        setResources(p => [doc, ...p]);
      } else {
        setDivisionResourcesTick(t => t + 1);
      }
      resetAddResourceDialog();
      setOpenDocId(doc.id);
      setOpenDocCanEdit(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create resource.');
    } finally {
      setCreatingResource(false);
    }
  };

  // Reset all Add Resource dialog state (used on open, cancel, and close).
  const resetAddResourceDialog = () => {
    setAddResourceStep(0);
    setNewResourceName('');
    setNewResourceType('document');
    setUploadFile(null);
    setUploadStatus(null);
    setResourceTargetDivisionId(null);
    setNewResourceDivisionOnly(true);
    setNewResourceAllowedRanks([]);
    setNewResourcePersonnelOnly(false);
    setNewResourceAllowedDpsRanks([]);
  };

  const handleUploadResource = async () => {
    if (!newResourceName.trim() || !uploadFile) return;
    const ext = (uploadFile.name.split('.').pop() ?? '').toLowerCase();
    if (ext !== 'pdf' && ext !== 'docx') {
      toast.error('Unsupported file type. Only PDF (.pdf) and Word (.docx) files are accepted.');
      return;
    }
    setCreatingResource(true);
    setUploadStatus(ext === 'docx' ? 'Converting document…' : 'Uploading…');
    try {
      const form = new FormData();
      form.append('title', newResourceName.trim());
      if (session?.username) form.append('created_by', session.username);
      form.append('file', uploadFile);
      if (resourceTargetDivisionId != null) {
        form.append('division_id', String(resourceTargetDivisionId));
        form.append('division_only', newResourceDivisionOnly ? '1' : '0');
        form.append('allowed_ranks', JSON.stringify(newResourceAllowedRanks));
      } else {
        form.append('personnel_only', (newResourcePersonnelOnly || newResourceAllowedDpsRanks.length > 0) ? '1' : '0');
        form.append('allowed_dps_ranks', JSON.stringify(newResourceAllowedDpsRanks));
      }
      const res = await fetch('/api/resources/upload', { method: 'POST', body: form });
      const body = await res.json().catch(() => ({})) as DpsResource & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Upload failed. Please try again.');
      if (resourceTargetDivisionId == null) {
        setResources(p => [body, ...p]);
      } else {
        setDivisionResourcesTick(t => t + 1);
      }
      resetAddResourceDialog();
      toast.success(ext === 'docx' ? 'Document converted to PDF and added.' : 'Resource uploaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setCreatingResource(false);
      setUploadStatus(null);
    }
  };

  const handleOpenResource = (r: DpsResource, canEdit: boolean) => {
    if (r.type === 'pdf') { setOpenPdf(r); return; }
    setOpenDocId(r.id);
    setOpenDocCanEdit(canEdit);
  };

  const handleDeleteResource = async (id: number) => {
    setDeletingResourceId(id);
    try {
      await fetch(`/api/resources/${id}`, { method: 'DELETE' });
      setResources(p => p.filter(r => r.id !== id));
      setDivisionResourcesTick(t => t + 1);
      toast.success('Resource deleted.');
    } catch {
      toast.error('Failed to delete resource.');
    } finally {
      setDeletingResourceId(null);
    }
  };

  // ── Roster helpers ────────────────────────────────────────────────────────────
  const filteredRoster = (Array.isArray(roster) ? roster : []).filter(m => {
    const q = rosterSearch.toLowerCase();
    return !q || m.username.toLowerCase().includes(q) || (m.dps_rank || m.rank).toLowerCase().includes(q)
      || m.callsign?.toLowerCase().includes(q) || m.discord_username?.toLowerCase().includes(q);
  });
  const getRankMeta = (rankName: string | null | undefined) =>
    rankName ? (ranks.find(r => r.name.toLowerCase() === rankName.toLowerCase().trim()) ?? null) : null;
  const departmentRankName = (m: RosterMember) => m.dps_rank || null;
  const sortRosterMembers = (list: RosterMember[]) =>
    sortByRankThenCallsign(list, ranks, departmentRankName);
  const groupedRoster = useMemo(() => {
    return buildPersonnelTitleGroups(
      filteredRoster,
      groups,
      ranks,
      departmentRankName,
    );
  }, [filteredRoster, groups, ranks]);
  const visibleRosterCount = useMemo(
    () => groupedRoster.reduce((sum, g) => sum + g.members.length, 0),
    [groupedRoster],
  );
  const toggleGroup = (label: string) => setCollapsed(p => ({ ...p, [label]: !p[label] }));

  const filteredPanel = sortRosterMembers((Array.isArray(panelMembers) ? panelMembers : []).filter(m => {
    const q = panelSearch.toLowerCase();
    return !q || m.username.toLowerCase().includes(q) || (m.dps_rank || m.rank).toLowerCase().includes(q) || m.callsign?.toLowerCase().includes(q);
  }));

  const departmentPermissionOverviewRows = useMemo((): PermissionAccessOverviewRow[] => (
    sortRosterMembers(Array.isArray(panelMembers) ? panelMembers : []).map(m => {
      const rankMeta = ranks.find(r => r.name.toLowerCase() === (m.dps_rank || m.rank)?.toLowerCase());
      return {
        id: m.id,
        username: m.username,
        subtitle: m.discord_username,
        rankLabel: m.dps_rank || m.rank || '—',
        rankColor: rankMeta?.color_hex ?? null,
        permissions: collectDepartmentPermissions(m, ranks, groups),
      };
    })
  ), [panelMembers, ranks, groups]);

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return d; }
  };

  // ── Department panel actions ──────────────────────────────────────────────────
  const handleSaveEdit = async (id: number, form: EditForm) => {
    const certs = form.certifications.split(',').map(s => s.trim()).filter(Boolean);
    const res = await fetch(`/api/roster/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, certifications: certs, actor: session?.username ?? 'DPS Panel' }),
    });
    if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? 'Failed to save.'); }
    toast.success('Officer updated.');
    fetchPanelMembers();
    // Also refresh personnel roster if it's loaded
    if (roster.length > 0) {
      fetch('/api/roster', { headers: { accept: 'application/json' } })
        .then(r => r.json()).then((rows) => setRoster(Array.isArray(rows) ? dedupeRosterMembersById((rows as RosterMember[]).map(normalizeRosterMember)) : [])).catch(() => {});
    }
  };

  const handleAddOfficer = async (form: AddForm) => {
    const res = await fetch('/api/roster', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, actor: session?.username ?? 'DPS Panel' }),
    });
    if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? 'Failed to add officer.'); }
    toast.success('Officer added successfully.');
    fetchPanelMembers();
  };

  const handleDelete = async (member: RosterMember) => {
    if (!confirm(`Remove ${member.username} from the roster? This cannot be undone.`)) return;
    const res = await fetch(`/api/roster/${member.id}`, { method: 'DELETE', headers: { 'x-actor': session?.username ?? 'DPS Panel' } });
    if (!res.ok) { toast.error('Failed to remove member.'); return; }
    toast.success(`${member.username} removed from roster.`);
    fetchPanelMembers();
  };

  const [resourceAccessSavingId, setResourceAccessSavingId] = useState<number | null>(null);
  const [clearingPermissionGrants, setClearingPermissionGrants] = useState(false);
  const [clearingMemberPermissionId, setClearingMemberPermissionId] = useState<number | null>(null);

  const handleClearAllPermissionGrants = async () => {
    if (!confirm(
      'Remove everyones permissions for the entire roster?\n\n'
      + 'This clears all individual grants (All Resources, IAB, division editors) '
      + 'and turns off Department Panel and Division Oversight on every title group.',
    )) return;
    setClearingPermissionGrants(true);
    try {
      const res = await fetch('/api/roster/permissions/clear-all', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor': session?.username ?? 'DPS Panel',
        },
        body: JSON.stringify({ actor: session?.username ?? 'DPS Panel' }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast.error(err.error ?? 'Failed to remove permissions.');
        return;
      }
      toast.success('Everyones permissions were removed.');
      fetchPanelMembers({ silent: true });
      fetchGroups();
      if (roster.length > 0) {
        fetch('/api/roster', { headers: { accept: 'application/json' } })
          .then(r => r.json())
          .then((rows) => {
            if (Array.isArray(rows)) {
              setRoster(dedupeRosterMembersById((rows as RosterMember[]).map(normalizeRosterMember)));
            }
          })
          .catch(() => {});
      }
    } catch {
      toast.error('Failed to remove permissions.');
    } finally {
      setClearingPermissionGrants(false);
    }
  };

  const handleToggleViewAllResources = async (member: RosterMember, enabled: boolean) => {
    setResourceAccessSavingId(member.id);
    setPanelMembers(prev => prev.map(m =>
      m.id === member.id ? { ...m, can_view_all_resources: enabled } : m
    ));
    try {
      const res = await fetch(`/api/roster/${member.id}/resource-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          can_view_all_resources: enabled,
          actor: session?.username ?? 'DPS Panel',
        }),
      });
      if (!res.ok) {
        setPanelMembers(prev => prev.map(m =>
          m.id === member.id ? { ...m, can_view_all_resources: !enabled } : m
        ));
        toast.error('Failed to update resource access.');
        return;
      }
      toast.success(enabled
        ? `${member.username} can view all restricted department resources.`
        : `${member.username} resource override removed.`);
    } catch {
      setPanelMembers(prev => prev.map(m =>
        m.id === member.id ? { ...m, can_view_all_resources: !enabled } : m
      ));
      toast.error('Failed to update resource access.');
    } finally {
      setResourceAccessSavingId(null);
    }
  };

  const [iabAccessSavingId, setIabAccessSavingId] = useState<number | null>(null);

  const handleToggleIabAccess = async (member: RosterMember, enabled: boolean) => {
    setIabAccessSavingId(member.id);
    setPanelMembers(prev => prev.map(m =>
      m.id === member.id ? { ...m, can_access_iab: enabled } : m
    ));
    try {
      const res = await fetch(`/api/roster/${member.id}/iab-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          can_access_iab: enabled,
          actor: session?.username ?? 'DPS Panel',
        }),
      });
      if (!res.ok) {
        setPanelMembers(prev => prev.map(m =>
          m.id === member.id ? { ...m, can_access_iab: !enabled } : m
        ));
        toast.error('Failed to update Internal Affairs access.');
        return;
      }
      toast.success(enabled
        ? `${member.username} granted DPS Internal Affairs access.`
        : `${member.username} Internal Affairs access revoked.`);
    } catch {
      setPanelMembers(prev => prev.map(m =>
        m.id === member.id ? { ...m, can_access_iab: !enabled } : m
      ));
      toast.error('Failed to update Internal Affairs access.');
    } finally {
      setIabAccessSavingId(null);
    }
  };

  const handleClearMemberAccessPermissions = async (member: RosterMember) => {
    if (!confirm(`Remove all access permissions for ${member.username}?`)) return;
    setClearingMemberPermissionId(member.id);
    try {
      const res = await fetch(`/api/roster/${member.id}/permissions/clear`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-actor': session?.username ?? 'DPS Panel',
        },
        body: JSON.stringify({ actor: session?.username ?? 'DPS Panel' }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast.error(err.error ?? 'Failed to clear access permissions.');
        return;
      }
      setPanelMembers(prev => prev.map(m =>
        m.id === member.id ? { ...m, can_view_all_resources: false, can_access_iab: false } : m
      ));
      toast.success(`Access permissions cleared for ${member.username}.`);
    } catch {
      toast.error('Failed to clear access permissions.');
    } finally {
      setClearingMemberPermissionId(null);
    }
  };

  // ── Reorder/move ranks via drag-and-drop (same or different group) ────────────
  const handleRankReorder = async (
    targetGroupId: number,
    draggedId: number,
    targetId: number | null,   // null = append to end of target group
    side: 'before' | 'after'
  ) => {
    const draggedRank = ranks.find(r => r.id === draggedId);
    if (!draggedRank) return;
    if (draggedId === targetId) return;

    const sourceGroupId = normalizeRankGroupId(draggedRank.group_id);
    const targetGroup = normalizeRankGroupId(targetGroupId);
    const isCrossGroup  = sourceGroupId !== targetGroup;

    // Build the new ordered list for the target group (excluding the dragged rank)
    const targetGroupRanks = ranks
      .filter(r => normalizeRankGroupId(r.group_id) === targetGroup && r.id !== draggedId)
      .sort((a, b) => a.sort_order - b.sort_order);

    let newOrder: typeof ranks;
    if (targetId !== null) {
      const without = [...targetGroupRanks];
      const targetIdx = without.findIndex(r => r.id === targetId);
      const insertAt  = side === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      without.splice(insertAt, 0, draggedRank);
      newOrder = without;
    } else {
      newOrder = [...targetGroupRanks, draggedRank];
    }

    // Optimistic update: remove dragged from old position, insert into target group
    setRanks(prev => [
      ...prev.filter(r => r.id !== draggedId && normalizeRankGroupId(r.group_id) !== targetGroup),
      ...newOrder.map((r, i) => ({ ...r, group_id: targetGroupId, sort_order: i })),
    ]);

    try {
      if (isCrossGroup) {
        const mv = await fetch(`/api/roster/ranks/${draggedId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ group_id: targetGroupId }),
        });
        if (!mv.ok) throw new Error('move failed');
      }
      const ro = await fetch('/api/roster/ranks/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: newOrder.map(r => r.id) }),
      });
      if (!ro.ok) throw new Error('reorder failed');
    } catch {
      fetchRanks();
      toast.error('Failed to move rank.');
    }
  };

  // ── Vehicle drag-and-drop reorder / cross-category move ──────────────────────
  const handleVehicleReorder = async (
    targetCat: string,
    targetCatSort: number,
    draggedId: number,
    targetId: number | null,   // null = append to end of target category
    side: 'before' | 'after'
  ) => {
    const draggedVehicle = fleet.find(v => v.id === draggedId);
    if (!draggedVehicle) return;
    if (draggedId === targetId) return;

    const sourceCat    = draggedVehicle.category;
    const isCrossCat   = sourceCat !== targetCat;

    const targetCatVehicles = fleet
      .filter(v => v.category === targetCat && v.id !== draggedId)
      .sort((a, b) => a.sort_order - b.sort_order);

    let newOrder: typeof fleet;
    if (targetId !== null) {
      const without   = [...targetCatVehicles];
      const targetIdx = without.findIndex(v => v.id === targetId);
      const insertAt  = side === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      without.splice(insertAt, 0, draggedVehicle);
      newOrder = without;
    } else {
      newOrder = [...targetCatVehicles, draggedVehicle];
    }

    // Optimistic update
    setFleet(prev => [
      ...prev.filter(v => v.id !== draggedId && v.category !== targetCat),
      ...newOrder.map((v, i) => ({ ...v, category: targetCat, category_sort: targetCatSort, sort_order: i })),
    ]);

    try {
      if (isCrossCat) {
        const mv = await fetch(`/api/roster/fleet/${draggedId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: targetCat, category_sort: targetCatSort }),
        });
        if (!mv.ok) throw new Error('move failed');
      }
      const ro = await fetch('/api/roster/fleet/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: newOrder.map(v => v.id) }),
      });
      if (!ro.ok) throw new Error('reorder failed');
    } catch {
      fetchFleetPanel();
      toast.error('Failed to move vehicle.');
    }
  };

  // ── Equipment drag-and-drop reorder / cross-category move ────────────────────
  const handleEquipmentReorder = async (
    targetCat: string,
    targetCatSort: number,
    draggedId: number,
    targetId: number | null,
    side: 'before' | 'after'
  ) => {
    const draggedItem = equipment.find(e => e.id === draggedId);
    if (!draggedItem) return;
    if (draggedId === targetId) return;

    const sourceCat = draggedItem.category;
    const isCrossCat = sourceCat !== targetCat;

    const targetCatItems = equipment
      .filter(e => e.category === targetCat && e.id !== draggedId)
      .sort((a, b) => a.sort_order - b.sort_order);

    let newOrder: typeof equipment;
    if (targetId !== null) {
      const without   = [...targetCatItems];
      const targetIdx = without.findIndex(e => e.id === targetId);
      const insertAt  = side === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      without.splice(insertAt, 0, draggedItem);
      newOrder = without;
    } else {
      newOrder = [...targetCatItems, draggedItem];
    }

    // Optimistic update
    setEquipment(prev => [
      ...prev.filter(e => e.id !== draggedId && e.category !== targetCat),
      ...newOrder.map((e, i) => ({ ...e, category: targetCat, category_sort: targetCatSort, sort_order: i })),
    ]);

    try {
      if (isCrossCat) {
        const mv = await fetch(`/api/roster/equipment/${draggedId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ category: targetCat, category_sort: targetCatSort }),
        });
        if (!mv.ok) throw new Error('move failed');
      }
      const ro = await fetch('/api/roster/equipment/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: newOrder.map(e => e.id) }),
      });
      if (!ro.ok) throw new Error('reorder failed');
    } catch {
      fetchEquipmentPanel();
      toast.error('Failed to move equipment.');
    }
  };

  // ── Delete a rank ─────────────────────────────────────────────────────────────
  const handleDeleteRank = async (rankId: number, rankName: string) => {
    if (!window.confirm(`Delete the rank "${rankName}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/roster/ranks/${rankId}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete rank.'); return; }
      setRanks(prev => prev.filter(r => r.id !== rankId));
      toast.success(`Rank "${rankName}" deleted.`);
    } catch {
      toast.error('Failed to delete rank.');
    }
  };

  // ── Add rank to a specific group ─────────────────────────────────────────────
  const handleAddRankToGroup = async (groupId: number) => {
    const name = newRankName.trim();
    if (!name) return;
    setAddingRank(true);
    try {
      const res = await fetch('/api/roster/ranks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          group_id: groupId,
          discord_role_id: newRankDiscordRoleId.trim() || null,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add rank.'); return; }
      setNewRankName('');
      setNewRankDiscordRoleId('');
      setAddRankGroupId(null);
      fetchRanks();
      toast.success(newRankDiscordRoleId.trim() ? 'Rank added — Discord sync triggered.' : 'Rank added.');
    } finally { setAddingRank(false); }
  };

  // ── Group heading actions ─────────────────────────────────────────────────────
  const handleAddGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setAddingGroup(true);
    try {
      const res = await fetch('/api/roster/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add group.'); return; }
      setNewGroupName('');
      setAddTitleOpen(false);
      fetchGroups();
      toast.success('Title added.');
    } catch {
      toast.error('Failed to add title.');
    } finally { setAddingGroup(false); }
  };

  const reorderGroupsApi = async (ordered: DpsGroup[]) => {
    try {
      const res = await fetch('/api/roster/groups/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ordered.map(g => g.id) }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      fetchGroups();
      toast.error('Failed to reorder groups.');
    }
  };

  const handleMoveGroup = async (id: number, direction: 'up' | 'down') => {
    const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(g => g.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const newOrder = [...sorted];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    const updated = newOrder.map((g, i) => ({ ...g, sort_order: i }));
    setGroups(updated);
    reorderGroupsApi(updated);
  };

  const handleGroupReorder = (draggedId: number, targetId: number, side: 'before' | 'after') => {
    const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const dragged = sorted.find(g => g.id === draggedId);
    if (!dragged) return;
    const rest = sorted.filter(g => g.id !== draggedId);
    const targetIdx = rest.findIndex(g => g.id === targetId);
    if (targetIdx < 0) return;
    rest.splice(side === 'before' ? targetIdx : targetIdx + 1, 0, dragged);
    const updated = rest.map((g, i) => ({ ...g, sort_order: i }));
    setGroups(updated);
    reorderGroupsApi(updated);
  };

  const handleRenameGroup = async (id: number) => {
    const name = editingGroupName.trim();
    if (!name) { setEditingGroupId(null); return; }
    const res = await fetch(`/api/roster/groups/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) { toast.error(data.error ?? 'Failed to rename group.'); return; }
    setEditingGroupId(null);
    fetchGroups();
  };

  const handleDeleteGroup = async (id: number, name: string) => {
    if (!confirm(`Remove the "${name}" group? Its ranks will be moved to the last remaining group.`)) return;
    await fetch(`/api/roster/groups/${id}`, { method: 'DELETE' });
    fetchGroups();
  };

  const handleTogglePanelAccess = async (id: number, enabled: boolean) => {
    // Optimistic update
    setGroups(prev => prev.map(g => g.id === id ? { ...g, panel_access: enabled } : g));
    const res = await fetch(`/api/roster/groups/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panel_access: enabled, actor: session?.username ?? 'DPS Panel' }),
    });
    if (!res.ok) {
      // Revert on failure
      setGroups(prev => prev.map(g => g.id === id ? { ...g, panel_access: !enabled } : g));
      toast.error('Failed to update panel access.');
    }
  };

  const handleToggleDivisionOversight = async (id: number, enabled: boolean) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, division_oversight: enabled } : g));
    const res = await fetch(`/api/roster/groups/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ division_oversight: enabled, actor: session?.username ?? 'DPS Panel' }),
    });
    if (!res.ok) {
      setGroups(prev => prev.map(g => g.id === id ? { ...g, division_oversight: !enabled } : g));
      toast.error('Failed to update division oversight.');
    }
  };

  const username = session?.username ?? '';
  const rank     = session?.dps_rank || session?.rank || '';

  // Staff Executive Team members (and hardcoded superadmins) get full DPS access
  const isStaffExecutive =
    isSuperAdminSession(session) ||
    session?.staff_role?.toLowerCase() === 'executive team';

  const matchedUserRankGroup = (() => {
    const userRank = (session?.dps_rank || session?.rank || '').trim().toLowerCase();
    if (!userRank) return null;
    const matchedRank = ranks.find(r => r.name.trim().toLowerCase() === userRank);
    if (!matchedRank || matchedRank.group_id == null) return null;
    return groups.find(g => g.id === matchedRank.group_id) ?? null;
  })();

  const hasRankPanelAccess = Boolean(matchedUserRankGroup?.panel_access);
  const hasDivisionOversight = Boolean(matchedUserRankGroup?.division_oversight);
  const bypassDivisionRestrictions = isStaffExecutive || hasDivisionOversight;

  const hasFullPanelAccess = isStaffExecutive || hasRankPanelAccess;

  const myRosterMember = (() => {
    if (!session) return null;
    const pool = panelMembers.length > 0 ? panelMembers : roster;
    return pool.find(m =>
      m.id === session.id
      || (!!session.discord_id && m.discord_id === session.discord_id)
      || (!!session.username && m.username.toLowerCase() === session.username.toLowerCase())
    ) ?? null;
  })();

  const myDivisionAssignments = (myRosterMember?.division_assignments ?? [])
    .filter(a => a.division_id > 0)
    .map(a => ({
      division_id: a.division_id,
      division_rank: a.division_rank ?? '',
    }));

  const myDivisionAccess = (myRosterMember?.division_assignments ?? [])
    .filter(a => a.division_id > 0 && (a.can_edit_resources || a.can_edit_roster || a.can_edit_info))
    .map(a => ({
      division_id: a.division_id,
      can_edit_resources: Boolean(a.can_edit_resources),
      can_edit_roster: Boolean(a.can_edit_roster),
      can_edit_info: Boolean(a.can_edit_info),
    }));

  const canEditDivisionRoster = hasFullPanelAccess
    || myDivisionAccess.some(a => a.can_edit_resources || a.can_edit_roster);
  const canEditDivisionInfo = hasFullPanelAccess
    || myDivisionAccess.some(a => a.can_edit_info);

  /** Access / Info grants on a division → Department Panel, limited to those divisions. */
  const canSeeDepartmentPanel = hasFullPanelAccess || myDivisionAccess.length > 0;
  const isDivisionOnlyPanelEditor = !hasFullPanelAccess && myDivisionAccess.length > 0;

  // Division Access / Info editors may only use the Divisions section of the panel.
  useEffect(() => {
    if (activeTab !== 'department-panel') return;
    if (!isDivisionOnlyPanelEditor) return;
    if (panelSection !== null && panelSection !== 'division') {
      setPanelSection('division');
    }
  }, [activeTab, panelSection, isDivisionOnlyPanelEditor]);

  const canViewDepartmentResource = (r: DpsResource) => {
    const bypassAll = isStaffExecutive || hasFullPanelAccess || hasDivisionOversight;
    if (bypassAll) return true;

    // Division-restricted resources
    if (r.division_only) {
      if (r.division_id == null) return false;
      const assign = myDivisionAssignments.find(a => a.division_id === r.division_id);
      if (!assign) return false;
      const ranksAllowed = Array.isArray(r.allowed_ranks) ? r.allowed_ranks : [];
      if (ranksAllowed.length === 0) return true;
      const myDivRank = assign.division_rank.trim().toLowerCase();
      if (!myDivRank) return false;
      return ranksAllowed.some(n => n.trim().toLowerCase() === myDivRank);
    }

    // Department resources: DPS personnel / DPS rank gates
    const dpsRanks = Array.isArray(r.allowed_dps_ranks) ? r.allowed_dps_ranks : [];
    if (r.personnel_only || dpsRanks.length > 0) {
      // Per-member override from Edit Personnel Roster
      if (myRosterMember?.can_view_all_resources) return true;
      const myDpsRank = (session?.dps_rank || session?.rank || myRosterMember?.dps_rank || '').trim();
      if (!myDpsRank && !myRosterMember) return false;
      if (dpsRanks.length === 0) return true;
      if (!myDpsRank) return false;
      return dpsRanks.some(n => n.trim().toLowerCase() === myDpsRank.toLowerCase());
    }

    return true;
  };

  const visibleResources = resources.filter(canViewDepartmentResource);

  // Only gate the session bootstrap and tab-specific data. Panel landing cards
  // render immediately — their section fetches run after the user picks one.
  const pageLoading = isLoading || (
    activeTab === 'personnel-roster' || activeTab === 'division-roster' || activeTab === 'divisions-information' ? rosterLoading
    : activeTab === 'vehicle-roster' ? fleetLoading
    : activeTab === 'equipment-roster' ? equipmentLoading
    : activeTab === 'event-calendar' ? eventsLoading
    : activeTab === 'information' ? infoLoading
    : activeTab === 'resources' ? resourcesLoading
    : activeTab === 'department-panel' ? (
      panelSection === 'personnel' ? (panelLoading || ranksLoading || groupsLoading)
      : panelSection === 'division' ? false
      : panelSection === 'vehicle' ? (fleetLoading || categoriesLoading)
      : panelSection === 'equipment' ? (equipmentLoading || eqCategoriesLoading)
      : panelSection === 'resources' ? resourcesLoading
      : panelSection === 'calendar' ? eventsLoading
      : panelSection === 'information' ? infoLoading
      : false
    )
    : false
  );

  return (
    <>
    <main className="min-h-screen bg-[#02060b] text-white">

      {/* Modals */}
      {editMember && (
        <EditModal member={editMember} ranks={ranks} divisionRanks={divisionRanksForEdit} divisions={rosterDivisions}
          onClose={() => setEditMember(null)}
          onSave={async (id, form) => { await handleSaveEdit(id, form); }} />
      )}
      {(() => {
        const accessMember = accessMemberId == null
          ? null
          : panelMembers.find(m => m.id === accessMemberId) ?? null;
        if (!accessMember) return null;
        return (
          <RosterAccessPermissionsModal
            member={accessMember}
            iabLabel="DPS Internal Affairs access"
            resourceSaving={resourceAccessSavingId === accessMember.id}
            iabSaving={iabAccessSavingId === accessMember.id}
            clearing={clearingMemberPermissionId === accessMember.id}
            onClose={() => setAccessMemberId(null)}
            onToggleResources={enabled => void handleToggleViewAllResources(accessMember, enabled)}
            onToggleIab={enabled => void handleToggleIabAccess(accessMember, enabled)}
            onClearAll={() => void handleClearMemberAccessPermissions(accessMember)}
          />
        );
      })()}
      {addOpen && (
        <AddOfficerModal ranks={ranks} onClose={() => setAddOpen(false)} onAdd={handleAddOfficer} />
      )}
      {editRankId !== null && (
        <RankEditModal
          rankId={editRankId}
          dpsGuildRoles={dpsGuildRoles}
          onClose={() => setEditRankId(null)}
          onSaved={() => { fetchRanks(); fetchPanelMembers(); }}
        />
      )}

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[#131f30] bg-[#02060b] px-5 py-3 lg:hidden">
        <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
          <span className={`text-[9px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
            {cadOnline === null ? 'Online' : cadModeLabel(cadMode)}
          </span>
        </div>
        <button type="button" onClick={handleSignOut} disabled={isSigningOut}
          className="rounded-full px-3 py-2 text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60">
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>

      <div className="flex min-h-screen flex-col pt-[53px] lg:flex-row lg:pt-0">


        {/* Sidebar */}
        <aside className={`border-b border-[#131f30] bg-[#02060b] px-5 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[265px] lg:flex-col lg:border-b-0 lg:border-r lg:border-[#131f30] lg:transition-transform lg:duration-300 ${sidebarOpen ? 'lg:translate-x-0' : 'lg:-translate-x-full'}`}>
          <div className="lg:shrink-0">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl font-black tracking-[-0.04em] text-white">Dept. of Public Safety</h1>
  
            </div>
            {isLoading ? (
              <p className="mt-2 text-xs font-bold text-[#526179]">Loading…</p>
            ) : (
              <>
                <p className="mt-2 text-sm font-black leading-none text-[#4384ff]">{username}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#526179]">{rank}</p>
              </>
            )}
          </div>

          <div className="sidebar-scroll mt-8 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => setActiveTab(id)}
                  className={`shrink-0 flex items-center gap-2.5 rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
                    activeTab === id ? 'border-l-2 border-[#4384ff] bg-[#071120] text-white' : 'text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                  }`}>
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-6 flex flex-col gap-2 border-t border-[#131f30] pt-6 lg:mt-5">

              {/* Department Panel link — Executive Team / panel_access ranks / granted division editors */}
              {session && canSeeDepartmentPanel && (
                <button type="button" onClick={() => {
                  if (isDivisionOnlyPanelEditor) setPanelSection('division');
                  else setActiveTab('department-panel');
                }}
                  className={`flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-black uppercase transition-colors ${
                    activeTab === 'department-panel'
                      ? 'border-l-2 border-[#f4c542] bg-[#131002] text-[#f4c542]'
                      : 'text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                  }`}>
                  <Settings className="h-4 w-4" />
                  Department Panel
                </button>
              )}

              {session && canAccessDpsCad(session) && (
                <button type="button" onClick={() => navigate('/dps_cad')}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]">
                  <Monitor className="h-4 w-4" />
                  DPS CAD
                </button>
              )}

              {/* Member Portal link */}
              <button type="button" onClick={() => navigate('/portal_dashboard')}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]">
                <LayoutDashboard className="h-4 w-4" />
                Member Portal
              </button>
            </div>
          </div>

          {/* Sign out — pinned to bottom of sidebar */}
          <div className="hidden lg:block border-t border-[#131f30] px-3 py-4">
            <button type="button" onClick={handleSignOut} disabled={isSigningOut}
              className="flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60">
              <LogOut className="h-4 w-4" />
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>

        </aside>


        {/* Main content */}
        <section className={`flex min-h-screen flex-1 flex-col lg:transition-all lg:duration-300 ${sidebarOpen ? 'lg:ml-[265px]' : 'lg:ml-0'}`}>
          <header className="relative z-40 hidden items-center border-b border-[#131f30] bg-[#02060b]/90 px-9 py-4 backdrop-blur-md lg:grid lg:grid-cols-3">
            {/* Left — logo */}
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white">
              <DojrpShield className="h-5 w-5" /><DojrpLogo />
            </p>

            {/* Center — terminal status */}
            <div className="flex justify-center">
              <div className={`flex items-center gap-2 rounded-full border px-4 py-2 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
                <span className={`h-2 w-2 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
                <span className={`text-[10px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
                  {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
                </span>
              </div>
            </div>

            {/* Right — profile avatar with dropdown */}
            <div className="relative z-50 flex justify-end" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen(o => !o)}
                className="h-9 w-9 overflow-hidden rounded-full border-2 border-[#1b2738] transition-all hover:border-[#4384ff]"
              >
                {session?.discord_id && session?.avatar_hash ? (
                  <img
                    src={`https://cdn.discordapp.com/avatars/${session.discord_id}/${session.avatar_hash}.png?size=64`}
                    alt="Profile"
                    className="h-full w-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#0f1b28] text-xs font-black text-[#4384ff]">
                    {(session?.username ?? '?')[0].toUpperCase()}
                  </div>
                )}
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-11 z-[80] w-56 rounded-xl border border-[#1b2738] bg-[#0b1422] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-[#131f30] px-4 py-3">
                    <p className="text-xs font-black text-white">{session?.username}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{session?.dps_rank ?? session?.rank ?? 'Officer'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setProfileOpen(false); handleSignOut(); }}
                    disabled={isSigningOut}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-bold text-[#ff7070] transition-colors hover:bg-white/5 disabled:opacity-60"
                  >
                    <LogOut className="h-4 w-4" />
                    {isSigningOut ? 'Signing out...' : 'Log off'}
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="flex-1 px-5 py-7 sm:px-8 sm:py-9">
            {pageLoading ? (
              <PageLoadingScreen loading label="Loading…" accent="#f4c542" />
            ) : (
            <>
            <div className="mb-8">
              <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">Department of Public Safety</h2>
              <p className="mt-2 text-sm text-[#8392aa]">
                {activeTab === 'personnel-roster'  ? 'Active personnel roster for the Department of Public Safety.'
                : activeTab === 'division-roster'   ? 'Select a division to view its roster, ranks, and Discord-linked assignments.'
                : activeTab === 'divisions-information' ? 'Select a division to view its information section.'
                : activeTab === 'vehicle-roster'    ? 'Vehicle inventory and assignments for the Department of Public Safety.'
                : activeTab === 'equipment-roster'  ? 'Equipment inventory and assignments for the Department of Public Safety.'
                : activeTab === 'event-calendar'    ? 'Upcoming department events, training sessions, and operations.'
                : activeTab === 'information'       ? 'Department information, announcements, and updates.'
                : activeTab === 'resources'         ? 'Department resources, guides, and reference materials.'
                : 'Manage officers, ranks, callsigns, unit assignments and certifications.'}
              </p>
            </div>


            {/* ── PERSONNEL ROSTER ─────────────────────────────────────────────── */}
            {activeTab === 'personnel-roster' && (
              <div className="rounded-xl border border-[#131f30] bg-[#070d16] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
                <div className="flex items-center gap-4 border-b border-[#131f30] px-6 py-4">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#526179]" />
                    <input type="text" placeholder="Search by name, rank, callsign…"
                      value={rosterSearch} onChange={e => setRosterSearch(e.target.value)}
                      className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                  </div>
                  <span className="shrink-0 text-[10px] font-black text-[#526179]">
                    {visibleRosterCount} member{visibleRosterCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {groupedRoster.length === 0 ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
                    <Users className="h-8 w-8 text-[#1e2e42]" />
                    <p className="text-sm font-bold text-[#3f5470]">
                      {rosterSearch ? 'No members match your search.' : 'No members on the roster yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1080px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#131f30]">
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Name</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Rank</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-24">Callsign</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-20">Status</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-28">Appointed</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord ID</th>
                          {rosterDivisions.map(d => (
                            <th key={d.id} className="px-3 py-3 text-center w-16">
                              <span className="text-[9px] font-black uppercase tracking-[0.14em] text-[#3f5470]" title={d.name}>
                                {divisionShortName(d)}
                              </span>
                            </th>
                          ))}
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Certifications</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedRoster.map(group => (
                          <React.Fragment key={group.label}>
                              {/* ── Title group header row ──────────────────────────── */}
                              <tr
                                className="cursor-pointer border-b border-t border-[#131f30] bg-[#0a1525] hover:bg-[#0c1830] transition-colors"
                                onClick={() => toggleGroup(group.label)}>
                                <td colSpan={8 + rosterDivisions.length} className="px-5 py-2.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {collapsed[group.label]
                                      ? <ChevronRight className="h-3.5 w-3.5 text-[#4384ff] shrink-0" />
                                      : <ChevronDown  className="h-3.5 w-3.5 text-[#4384ff] shrink-0" />}
                                    <span className="text-xs font-black text-white">{group.label}</span>
                                    <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">
                                      {group.members.length}
                                    </span>
                                  </div>
                                </td>
                              </tr>

                              {!collapsed[group.label] && group.members.map(m => {
                                const memberRankMeta = getRankMeta(departmentRankName(m));
                                const chipColor = memberRankMeta?.color_hex ?? null;
                                return (
                                  <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                    <td className="px-5 py-3.5 pl-10">
                                      <div className="flex items-center gap-2">
                                        <DiscordAvatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                                        <span className="text-xs font-black text-white">{m.username || '—'}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <div className="flex items-center gap-1.5">
                                        {memberRankMeta?.insignia_url && (
                                          <img src={memberRankMeta.insignia_url} alt="" className="h-4 w-4 object-contain shrink-0"
                                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        )}
                                        <span className="text-[10px] font-black"
                                          style={{ color: chipColor ?? '#a8b7cd' }}>
                                          {m.dps_rank || '—'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <span className="inline-flex items-center rounded border border-[#1b2d44] bg-[#070d16] px-2 py-0.5 font-mono text-[10px] font-black text-[#4384ff]">
                                        {m.callsign || '—'}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                                    <td className="px-4 py-3.5 text-[#8392aa]">{formatDate(m.appointed_date)}</td>
                                    <td className="px-4 py-3.5">
                                      <span className="font-mono text-[11px] text-[#526179]">{m.discord_id || '—'}</span>
                                    </td>
                                    {rosterDivisions.map(d => (
                                      <td key={d.id} className="px-3 py-3.5 text-center">
                                        <UnitDot active={memberInDivision(m, d)} />
                                      </td>
                                    ))}
                                    <td className="px-4 py-3.5">
                                      <div className="flex flex-wrap gap-1">
                                        {m.certifications?.length > 0
                                          ? m.certifications.map(c => (
                                              <span key={c} className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-black text-[#6a8aaa]">{c}</span>
                                            ))
                                          : <span className="text-[#2a3a50]">—</span>}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── DIVISION ROSTER ──────────────────────────────────────────────── */}
            {activeTab === 'division-roster' && (
              <DivisionRosterView
                members={roster}
                loading={rosterLoading}
                DiscordAvatar={DiscordAvatar}
                viewerDiscordId={session?.discord_id ?? null}
                bypassDivisionRestrictions={bypassDivisionRestrictions}
                onOpenResource={(r) => handleOpenResource(r as DpsResource, false)}
              />
            )}

            {activeTab === 'divisions-information' && (
              <DivisionsInformationView
                members={roster}
                loading={rosterLoading}
                viewerDiscordId={session?.discord_id ?? null}
                bypassDivisionRestrictions={bypassDivisionRestrictions}
              />
            )}

            {/* ── VEHICLE ROSTER ───────────────────────────────────────────────── */}
            {activeTab === 'vehicle-roster' && (
              <div className="space-y-8">
                {fleet.length === 0 ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-[#131f30] bg-[#070d16]">
                    <Car className="h-10 w-10 text-[#1e2e42]" />
                    <p className="text-sm font-bold text-[#3f5470]">No vehicles in the roster yet.</p>
                  </div>
                ) : (() => {
                  // Group by category preserving category_sort order
                  const catMap = new Map<string, FleetVehicle[]>();
                  fleet.forEach(v => {
                    if (!catMap.has(v.category)) catMap.set(v.category, []);
                    catMap.get(v.category)!.push(v);
                  });
                  const categories = [...catMap.entries()].sort((a, b) => {
                    const sa = a[1][0]?.category_sort ?? 0;
                    const sb = b[1][0]?.category_sort ?? 0;
                    return sa !== sb ? sa - sb : a[0].localeCompare(b[0]);
                  });
                  return categories.map(([cat, vehicles]) => {
                    const sortedVehicles = [...vehicles].sort((a, b) => a.sort_order - b.sort_order);
                    return (
                      <div key={cat}>
                        {/* Category header */}
                        <div className="mb-4 flex items-center gap-3">
                          <div className="h-5 w-1 rounded-full bg-[#4384ff]" />
                          <h2 className="text-sm font-black text-white">{cat}</h2>
                          <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[10px] font-black text-[#526179]">{vehicles.length}</span>
                        </div>

                        {/* Vehicle card grid */}
                        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {sortedVehicles.map(v => (
                            <div
                              key={v.id}
                              className="flex flex-col overflow-hidden rounded-xl border border-[#131f30] bg-[#070d16] transition-colors hover:border-[#1e3050]"
                            >
                              {/* Image area */}
                              <div className="relative flex h-[130px] w-full items-center justify-center bg-[#070d16]">
                                {v.image_url ? (
                                  <img src={v.image_url} alt={v.name}
                                    className="h-full w-full"
                                    style={imageStyle(v.image_scale, v.image_position_x, v.image_position_y)}
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                  <Car className="h-8 w-8 text-[#1e2e42]" />
                                )}
                              </div>

                              {/* Card body */}
                              <div className="flex flex-1 flex-col gap-3 p-4">
                                <div>
                                  <p className="text-sm font-black leading-snug text-white">{v.name}</p>
                                  {v.year && <p className="text-[10px] font-semibold text-[#526179] mt-0.5">{v.year}</p>}
                                </div>

                                {v.who_can_drive.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Who Can Drive</span>
                                    <div className="flex flex-wrap gap-1">
                                      {v.who_can_drive.map(r => {
                                        const ins = ranks.find(x => x.name.toLowerCase() === r.toLowerCase())?.insignia_url;
                                        return (
                                          <span key={r}
                                            className="inline-flex items-center gap-1 rounded border border-[#4384ff]/30 bg-[#4384ff]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6fa3ff]">
                                            {ins && <img src={ins} alt="" className="h-3 w-3 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                                            {r}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {v.liveries.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Liveries</span>
                                    <div className="flex flex-wrap gap-1">
                                      {v.liveries.map(l => (
                                        <span key={l}
                                          className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-semibold text-[#526179]">
                                          {l}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {v.restrict_to_divisions.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Divisional Accessible By</span>
                                    <div className="flex flex-wrap gap-1">
                                      {v.restrict_to_divisions.map(d => {
                                        const meta = DIVISION_OPTIONS.find(o => o.key === d);
                                        return (
                                          <span key={d} title={meta?.label}
                                            className="rounded border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-1.5 py-0.5 text-[9px] font-black text-[#c4b5fd]">
                                            {d}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* ── EQUIPMENT ROSTER ─────────────────────────────────────────────── */}
            {activeTab === 'equipment-roster' && (
              <div className="space-y-8">
                {equipment.length === 0 ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-[#131f30] bg-[#070d16]">
                    <Package className="h-10 w-10 text-[#1e2e42]" />
                    <p className="text-sm font-bold text-[#3f5470]">No equipment in the roster yet.</p>
                  </div>
                ) : (() => {
                  const catMap = new Map<string, EquipmentItem[]>();
                  equipment.forEach(e => {
                    if (!catMap.has(e.category)) catMap.set(e.category, []);
                    catMap.get(e.category)!.push(e);
                  });
                  const categories = [...catMap.entries()].sort((a, b) => {
                    const sa = a[1][0]?.category_sort ?? 0;
                    const sb = b[1][0]?.category_sort ?? 0;
                    return sa !== sb ? sa - sb : a[0].localeCompare(b[0]);
                  });
                  return categories.map(([cat, items]) => {
                    const sortedItems = [...items].sort((a, b) => a.sort_order - b.sort_order);
                    return (
                      <div key={cat}>
                        <div className="mb-4 flex items-center gap-3">
                          <div className="h-5 w-1 rounded-full bg-[#fb923c]" />
                          <h2 className="text-sm font-black text-white">{cat}</h2>
                          <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[10px] font-black text-[#526179]">{items.length}</span>
                        </div>
                        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {sortedItems.map(item => (
                            <div key={item.id}
                              className="flex flex-col overflow-hidden rounded-xl border border-[#131f30] bg-[#070d16] transition-colors hover:border-[#1e3050]">
                              <div className="relative flex h-[130px] w-full items-center justify-center bg-[#070d16]">
                                {item.image_url ? (
                                  <img src={item.image_url} alt={item.name}
                                    className="h-full w-full"
                                    style={imageStyle(item.image_scale, item.image_position_x, item.image_position_y)}
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : (
                                  <Package className="h-8 w-8 text-[#1e2e42]" />
                                )}
                              </div>
                              <div className="flex flex-1 flex-col gap-3 p-4">
                                <div>
                                  <p className="text-sm font-black leading-snug text-white">{item.name}</p>
                                </div>
                                {item.who_can_use.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Who Can Use</span>
                                    <div className="flex flex-wrap gap-1">
                                      {item.who_can_use.map(r => {
                                        const ins = ranks.find(x => x.name.toLowerCase() === r.toLowerCase())?.insignia_url;
                                        return (
                                          <span key={r} className="inline-flex items-center gap-1 rounded border border-[#fb923c]/30 bg-[#fb923c]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#fdba74]">
                                            {ins && <img src={ins} alt="" className="h-3 w-3 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                                            {r}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                                {item.restrict_to_divisions.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Divisional Accessible By</span>
                                    <div className="flex flex-wrap gap-1">
                                      {item.restrict_to_divisions.map(d => {
                                        const meta = DIVISION_OPTIONS.find(o => o.key === d);
                                        return (
                                          <span key={d} title={meta?.label}
                                            className="rounded border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-1.5 py-0.5 text-[9px] font-black text-[#c4b5fd]">
                                            {d}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            {/* ── EVENT CALENDAR ───────────────────────────────────────────────── */}
            {activeTab === 'event-calendar' && (
              <>
                {events.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                      <CalendarDays className="h-8 w-8 text-[#a78bfa]/60" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-[#526179]">No events scheduled</p>
                      <p className="mt-1 text-xs text-[#3f5470]">Events added in the Department Panel will appear here.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 py-2">
                    {events.map(ev => {
                      const dateObj = new Date(ev.event_date + 'T12:00:00');
                      const today = new Date(); today.setHours(0, 0, 0, 0);
                      const isPast = dateObj < today;
                      const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                      const timeStr = ev.event_time
                        ? new Date(`1970-01-01T${ev.event_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                        : null;
                      return (
                        <div key={ev.id} className={`relative rounded-xl border bg-[#070d16] p-5 ${isPast ? 'border-[#1e2d42] opacity-50' : 'border-[#a78bfa]/20'}`}>
                          <div className="flex items-start gap-4">
                            <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl border text-center ${isPast ? 'border-[#1e2d42] bg-[#07111f]' : 'border-[#a78bfa]/30 bg-[#a78bfa]/10'}`}>
                              <span className={`text-[9px] font-black uppercase tracking-widest ${isPast ? 'text-[#3f5470]' : 'text-[#a78bfa]'}`}>
                                {dateObj.toLocaleDateString('en-US', { month: 'short' })}
                              </span>
                              <span className={`text-xl font-black leading-tight ${isPast ? 'text-[#3f5470]' : 'text-white'}`}>
                                {dateObj.getDate()}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm font-black text-white">{ev.title}</h3>
                                {isPast && <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-[#3f5470]">Past</span>}
                              </div>
                              <p className="mt-0.5 text-[11px] text-[#526179]">{dateStr}</p>
                              <div className="mt-2 flex flex-wrap gap-3">
                                {timeStr && (
                                  <span className="flex items-center gap-1.5 text-[11px] text-[#526179]">
                                    <Clock className="h-3 w-3 shrink-0" />{timeStr}
                                  </span>
                                )}
                                {ev.location && (
                                  <span className="flex items-center gap-1.5 text-[11px] text-[#526179]">
                                    <MapPin className="h-3 w-3 shrink-0" />{ev.location}
                                  </span>
                                )}
                              </div>
                              {(ev.hosted_by || ev.hosting_department) && (
                                <p className="mt-2 text-[11px] text-[#8392aa]">
                                  {ev.hosted_by ? `Hosted by ${ev.hosted_by}` : 'Hosted event'}
                                  {ev.hosting_department ? ` · ${ev.hosting_department}` : ''}
                                </p>
                              )}
                              {ev.purpose && <p className="mt-2 text-[11px] leading-relaxed text-[#a8b7cd]">{ev.purpose}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* ── INFORMATION ──────────────────────────────────────────────────── */}
            {activeTab === 'information' && (
              pageInfo && pageInfo.sections.length > 0 ? (
                <div className="space-y-3">
                  {pageInfo.sections.map((blk, i) => {
                    if (blk.type === 'divider') {
                      return <hr key={i} className="border-[#1e2d42] my-2" />;
                    }
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
                          <img src={blk.url} alt={blk.caption || ''} className="w-full max-h-64 object-cover" />
                          {blk.caption && (
                            <p className="bg-[#070d16] px-4 py-2 text-[11px] italic text-[#526179]">{blk.caption}</p>
                          )}
                        </div>
                      );
                    }
                    if (blk.type === 'footer') {
                      return (
                        <div key={i} className="pt-1">{renderFormattedText(blk.text, { className: "whitespace-pre-wrap text-[11px] italic leading-relaxed text-[#3f5470]", bulletClassName: "list-disc space-y-1 pl-5 text-[11px] italic leading-relaxed text-[#3f5470]" })}</div>
                      );
                    }
                    // text (default)
                    return (
                      <div key={i} className="rounded-2xl border border-[#1e2d42] bg-[#070d16] px-7 py-6">
                        {renderFormattedText(blk.body, { className: "whitespace-pre-wrap text-xs leading-relaxed text-[#8392aa]", bulletClassName: "list-disc space-y-1 pl-5 text-xs leading-relaxed text-[#8392aa]" })}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#4384ff]/20 bg-[#4384ff]/8">
                    <Info className="h-8 w-8 text-[#4384ff]/60" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-[#526179]">No information posted</p>
                    <p className="mt-1 text-xs text-[#3f5470]">Department announcements and updates will appear here.</p>
                  </div>
                </div>
              )
            )}

            {/* ── RESOURCES ────────────────────────────────────────────────────── */}
            {activeTab === 'resources' && (() => {
              const departmentResources = visibleResources.filter(r => r.division_id == null);
              const divisionSections = [...rosterDivisions]
                .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                .map(d => ({
                  division: d,
                  items: visibleResources.filter(r => r.division_id === d.id),
                }))
                .filter(s => s.items.length > 0);
              // Resources linked to a division id that no longer exists
              const knownIds = new Set(rosterDivisions.map(d => d.id));
              const orphanDivisionResources = visibleResources.filter(
                r => r.division_id != null && !knownIds.has(r.division_id)
              );

              const renderCard = (r: DpsResource) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleOpenResource(r, false)}
                  className="group relative flex flex-col gap-3 rounded-2xl border border-[#1e2d42] bg-[#070d16] p-6 text-left shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all hover:border-[#a78bfa]/40 hover:shadow-[0_12px_32px_rgba(0,0,0,0.3)]"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                    <FileText className="h-5 w-5 text-[#a78bfa]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-white">{r.title}</p>
                    <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                      {r.type === 'pdf' ? 'PDF' : 'Document'}
                      {r.division_only ? ' · Division' : ''}
                      {r.personnel_only || (Array.isArray(r.allowed_dps_ranks) && r.allowed_dps_ranks.length > 0) ? ' · Personnel' : ''}
                    </p>
                  </div>
                  <p className="text-[10px] text-[#3f5470]">
                    {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </button>
              );

              if (visibleResources.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                      <BookOpen className="h-8 w-8 text-[#a78bfa]/60" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-[#526179]">No resources available</p>
                      <p className="mt-1 text-xs text-[#3f5470]">Guides, references, and department materials will appear here.</p>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-10">
                  {departmentResources.length > 0 && (
                    <section className="space-y-4">
                      <div className="flex items-end justify-between gap-3 border-b border-[#131f30] pb-3">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[#a78bfa]">Department</h3>
                          <p className="mt-1 text-xs text-[#526179]">Resources available across the Department of Public Safety.</p>
                        </div>
                        <span className="text-[10px] font-black text-[#3f5470]">{departmentResources.length}</span>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {departmentResources.map(renderCard)}
                      </div>
                    </section>
                  )}

                  {divisionSections.map(({ division, items }) => (
                    <section key={division.id} className="space-y-4">
                      <div className="flex items-end justify-between gap-3 border-b border-[#131f30] pb-3">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[#22d3ee]">{division.name}</h3>
                          <p className="mt-1 text-xs text-[#526179]">Division resources</p>
                        </div>
                        <span className="text-[10px] font-black text-[#3f5470]">{items.length}</span>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {items.map(renderCard)}
                      </div>
                    </section>
                  ))}

                  {orphanDivisionResources.length > 0 && (
                    <section className="space-y-4">
                      <div className="flex items-end justify-between gap-3 border-b border-[#131f30] pb-3">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[#526179]">Other divisions</h3>
                          <p className="mt-1 text-xs text-[#526179]">Resources linked to a division that is no longer listed.</p>
                        </div>
                        <span className="text-[10px] font-black text-[#3f5470]">{orphanDivisionResources.length}</span>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {orphanDivisionResources.map(renderCard)}
                      </div>
                    </section>
                  )}
                </div>
              );
            })()}

            {/* ── DEPARTMENT PANEL ─────────────────────────────────────────────── */}
            {activeTab === 'department-panel' && (
              <>

                {/* ── Landing picker ───────────────────────────────────────────── */}
                {panelSection === null && (
                  <div className="space-y-4">
                    {/* Section picker cards */}
                    <div className="grid gap-5 sm:grid-cols-2">

                      {/* Personnel Roster card — full panel access only */}
                      {hasFullPanelAccess && (
                      <div className="group relative rounded-2xl border border-[#f4c542]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#f4c542]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        {/* Subtle gold glow top-edge */}
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#f4c542]/40 to-transparent" />

                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#f4c542]/20 bg-[#f4c542]/8">
                            <Users className="h-6 w-6 text-[#f4c542]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Personnel Roster</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                              Manage officers, ranks, callsigns, unit assignments and certifications.
                            </p>
                          </div>
                        </div>

                        {/* Stats row */}
                        <div className="mb-6 flex gap-4">
                          <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                            <p className="text-lg font-black text-white">{panelMembers.length || '—'}</p>
                            <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Members</p>
                          </div>
                          <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                            <p className="text-lg font-black text-white">{ranks.length || '—'}</p>
                            <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Ranks</p>
                          </div>
                          <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                            <p className="text-lg font-black text-white">{groups.length || '—'}</p>
                            <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Titles</p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setPanelSection('personnel')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#f4c542]/30 bg-[#f4c542]/8 py-3 text-xs font-black text-[#f4c542] transition-all hover:bg-[#f4c542]/15 hover:border-[#f4c542]/50 hover:shadow-[0_0_20px_rgba(244,197,66,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Personnel Roster
                        </button>
                      </div>
                      )}

                      {(canEditDivisionRoster || canEditDivisionInfo) && (() => {
                        const editableIds = new Set(myDivisionAccess.map(a => a.division_id));
                        const scopedDivisions = hasFullPanelAccess
                          ? rosterDivisions
                          : rosterDivisions.filter(d => editableIds.has(d.id));
                        const scopedRankCount = hasFullPanelAccess
                          ? divisionStats.ranks
                          : divisionRanksForEdit.filter(r => editableIds.has(r.division_id ?? -1)).length;
                        return (
                      <DivisionPanelCard
                        memberCount={panelMembers.filter(m =>
                          scopedDivisions.some(d => memberInDivision(m, d))
                        ).length}
                        rankCount={scopedRankCount}
                        divisionCount={scopedDivisions.length}
                        onEdit={() => setPanelSection('division')}
                      />
                        );
                      })()}

                      {/* Full-panel sections (vehicles, equipment, resources, calendar, information) */}
                      {hasFullPanelAccess && (
                      <>
                      {/* Vehicle Roster card */}
                      <div className="group relative rounded-2xl border border-[#4384ff]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#4384ff]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#4384ff]/40 to-transparent" />

                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#4384ff]/20 bg-[#4384ff]/8">
                            <Car className="h-6 w-6 text-[#4384ff]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Vehicle Roster</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                              Manage department vehicles, assignments, and fleet inventory.
                            </p>
                          </div>
                        </div>

                        {/* Stats row */}
                        {(() => {
                          const totalVehicles = fleet.length;
                          const assignedVehicles = fleet.filter(v => v.who_can_drive.length > 0 || v.restrict_to_divisions.length > 0).length;
                          const availableVehicles = totalVehicles - assignedVehicles;
                          const fmt = (n: number) => fleetLoading ? '—' : String(n);
                          return (
                            <div className="mb-6 flex gap-4">
                              <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                                <p className="text-lg font-black text-white">{fmt(totalVehicles)}</p>
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Vehicles</p>
                              </div>
                              <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                                <p className="text-lg font-black text-white">{fmt(assignedVehicles)}</p>
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Assigned</p>
                              </div>
                              <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                                <p className="text-lg font-black text-white">{fmt(availableVehicles)}</p>
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Available</p>
                              </div>
                            </div>
                          );
                        })()}

                        <button
                          type="button"
                          onClick={() => setPanelSection('vehicle')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#4384ff]/30 bg-[#4384ff]/8 py-3 text-xs font-black text-[#4384ff] transition-all hover:bg-[#4384ff]/15 hover:border-[#4384ff]/50 hover:shadow-[0_0_20px_rgba(67,132,255,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Vehicle Roster
                        </button>
                      </div>

                      {/* Equipment Roster card */}
                      <div className="group relative rounded-2xl border border-[#fb923c]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#fb923c]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#fb923c]/40 to-transparent" />

                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#fb923c]/20 bg-[#fb923c]/8">
                            <Package className="h-6 w-6 text-[#fb923c]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Equipment Roster</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                              Manage department equipment inventory, assignments, and condition logs.
                            </p>
                          </div>
                        </div>

                        {/* Stats row */}
                        {(() => {
                          const total = equipment.length;
                          const assigned = equipment.filter(e => e.who_can_use.length > 0 || e.restrict_to_divisions.length > 0).length;
                          const unassigned = total - assigned;
                          const fmt = (n: number) => equipmentLoading ? '—' : String(n);
                          return (
                            <div className="mb-6 flex gap-4">
                              <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                                <p className="text-lg font-black text-white">{fmt(total)}</p>
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Items</p>
                              </div>
                              <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                                <p className="text-lg font-black text-white">{fmt(assigned)}</p>
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Assigned</p>
                              </div>
                              <div className="flex-1 rounded-lg border border-[#131f30] bg-[#07111f] px-3 py-2.5 text-center">
                                <p className="text-lg font-black text-white">{fmt(unassigned)}</p>
                                <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Unassigned</p>
                              </div>
                            </div>
                          );
                        })()}

                        <button
                          type="button"
                          onClick={() => setPanelSection('equipment')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#fb923c]/30 bg-[#fb923c]/8 py-3 text-xs font-black text-[#fb923c] transition-all hover:bg-[#fb923c]/15 hover:border-[#fb923c]/50 hover:shadow-[0_0_20px_rgba(251,146,60,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Equipment Roster
                        </button>
                      </div>

                      {/* Resources card */}
                      <div className="group relative rounded-2xl border border-[#34d399]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#34d399]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#34d399]/40 to-transparent" />

                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#34d399]/20 bg-[#34d399]/8">
                            <BookOpen className="h-6 w-6 text-[#34d399]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Resources</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                              Publish guides, reference documents, and department materials for members.
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setPanelSection('resources')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#34d399]/30 bg-[#34d399]/8 py-3 text-xs font-black text-[#34d399] transition-all hover:bg-[#34d399]/15 hover:border-[#34d399]/50 hover:shadow-[0_0_20px_rgba(52,211,153,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Resources
                        </button>
                      </div>

                      {/* Event Calendar card */}
                      <div className="group relative rounded-2xl border border-[#a78bfa]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#a78bfa]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#a78bfa]/40 to-transparent" />

                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                            <CalendarDays className="h-6 w-6 text-[#a78bfa]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Event Calendar</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                              Schedule and manage department events, training sessions, and operations.
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setPanelSection('calendar')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#a78bfa]/30 bg-[#a78bfa]/8 py-3 text-xs font-black text-[#a78bfa] transition-all hover:bg-[#a78bfa]/15 hover:border-[#a78bfa]/50 hover:shadow-[0_0_20px_rgba(167,139,250,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Event Calendar
                        </button>
                      </div>

                      {/* Information card */}
                      <div className="group relative rounded-2xl border border-[#22d3ee]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#22d3ee]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/40 to-transparent" />
                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/8">
                            <Info className="h-6 w-6 text-[#22d3ee]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Department Information</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                              Edit the public index page description and the member Information tab content.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPanelSection('information')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/8 py-3 text-xs font-black text-[#22d3ee] transition-all hover:bg-[#22d3ee]/15 hover:border-[#22d3ee]/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit Information
                        </button>
                      </div>
                      </>
                      )}

                    </div>
                  </div>
                )}

                {/* ── Personnel section ────────────────────────────────────────── */}
                {panelSection === 'personnel' && (
                  <div className="space-y-6">
                    {/* Back breadcrumb */}
                    <button type="button" onClick={() => setPanelSection(null)}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#f4c542] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Department Panel
                      <span className="text-[#2a3a50]">/</span>
                      <span className="text-[#f4c542]">Personnel Roster</span>
                    </button>

                    {/* Personnel Management card */}
                    <div className="rounded-xl border border-[#f4c542]/20 bg-[#070d16] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">

                      {/* Card header */}
                      <div className="flex items-center gap-4 border-b border-[#131f30] px-6 py-4">
                        <Settings className="h-4 w-4 text-[#f4c542]" />
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#f4c542]">Personnel Management</h3>
                        <div className="ml-auto flex items-center gap-3">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                            <input type="text" placeholder="Search officers…"
                              value={panelSearch} onChange={e => setPanelSearch(e.target.value)}
                              className="h-9 w-48 rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                          </div>
                          <button type="button" onClick={() => void handleSyncDiscordRoles()} disabled={syncingDiscord}
                            className="flex items-center gap-2 rounded-lg border border-[#3ecf8e]/35 bg-[#3ecf8e]/10 px-4 py-2 text-xs font-black text-[#3ecf8e] hover:bg-[#3ecf8e]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            <RefreshCw className={`h-3.5 w-3.5 ${syncingDiscord ? 'animate-spin' : ''}`} />
                            {syncingDiscord ? 'Syncing Discord…' : 'Sync Discord'}
                          </button>
                          <button type="button" onClick={handleSyncAllCallsigns} disabled={syncingCallsigns}
                            className="flex items-center gap-2 rounded-lg border border-[#2f66ee]/40 bg-[#2f66ee]/10 px-4 py-2 text-xs font-black text-[#4384ff] hover:bg-[#2f66ee]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            <Radio className="h-3.5 w-3.5" />
                            {syncingCallsigns ? 'Syncing…' : 'Sync Callsigns'}
                          </button>
                          <button type="button" onClick={() => setAddOpen(true)}
                            className="flex items-center gap-2 rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                            Add Officer
                          </button>
                          <button type="button" onClick={() => { setAddTitleOpen(true); setNewGroupName(''); }}
                            className="flex items-center gap-2 rounded-lg border border-[#f4c542]/30 bg-[#f4c542]/5 px-4 py-2 text-xs font-black text-[#f4c542] hover:bg-[#f4c542]/10 transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                            Add Title
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleClearAllPermissionGrants()}
                            disabled={clearingPermissionGrants}
                            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            {clearingPermissionGrants ? 'Removing…' : 'Remove Everyones Permissions'}
                          </button>
                        </div>
                      </div>

                      {/* Titles section — inline within the same card */}
                      {(groups.length > 0 || addTitleOpen) && (
                        <div className="border-t border-[#131f30]">
                          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Titles</span>
                            <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{groups.length}</span>
                          </div>

                          {(
                            <div className="divide-y divide-[#0c1525]">
                              {groups.map((g, i) => {
                                const isRankDropTarget  = dragRankId !== null && dragOverGroupId === g.id;
                                const isGroupDragOver   = dragGroupId !== null && dragGroupOverId === g.id;
                                const clearDrag = () => { setDragRankId(null); setDragOverRankId(null); setDragOverGroupId(null); };
                                const clearGroupDrag = () => { setDragGroupId(null); setDragGroupOverId(null); };
                                return (
                                <div key={g.id}
                                  draggable
                                  onDragStart={e => {
                                    if ((e.target as HTMLElement).closest('[data-rank-chip]')) { e.preventDefault(); return; }
                                    setDragGroupId(g.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                  }}
                                  onDragEnd={() => { clearGroupDrag(); }}
                                  onDragOver={e => {
                                    if (dragGroupId !== null && dragGroupId !== g.id) {
                                      e.preventDefault();
                                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                      setDragGroupOverId(g.id);
                                      setDragGroupOverSide(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
                                      return;
                                    }
                                    if (dragRankId === null) return;
                                    e.preventDefault();
                                    setDragOverGroupId(g.id);
                                  }}
                                  onDragLeave={e => {
                                    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                      setDragOverGroupId(null);
                                      setDragGroupOverId(null);
                                    }
                                  }}
                                  onDrop={e => {
                                    e.preventDefault();
                                    if (dragGroupId !== null && dragGroupId !== g.id) {
                                      handleGroupReorder(dragGroupId, g.id, dragGroupOverSide);
                                      clearGroupDrag(); return;
                                    }
                                    if (dragRankId !== null) handleRankReorder(g.id, dragRankId, null, 'after');
                                    clearDrag();
                                  }}
                                  style={isGroupDragOver ? {
                                    boxShadow: dragGroupOverSide === 'before'
                                      ? 'inset 0 3px 0 #4384ff'
                                      : 'inset 0 -3px 0 #4384ff',
                                  } : undefined}>
                                  <div className={`flex items-center gap-3 px-6 py-2.5 transition-colors group/row ${isRankDropTarget ? 'bg-[#091828] ring-1 ring-inset ring-[#4384ff]/30' : 'hover:bg-[#081422]'}`}>
                                    {editingGroupId === g.id ? (
                                      <>
                                        <input autoFocus type="text" value={editingGroupName}
                                          onChange={e => setEditingGroupName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') handleRenameGroup(g.id); if (e.key === 'Escape') setEditingGroupId(null); }}
                                          className="flex-1 h-7 rounded border border-[#2f70ff] bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none" />
                                        <button type="button" onClick={() => handleRenameGroup(g.id)}
                                          className="rounded px-2 py-1 text-[10px] font-black bg-[#2f66ee] text-white hover:bg-[#3977ff] transition-colors">Save</button>
                                        <button type="button" onClick={() => setEditingGroupId(null)}
                                          className="rounded px-2 py-1 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                                      </>
                                    ) : (
                                      <>
                                        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab opacity-0 group-hover/row:opacity-40 transition-opacity text-[#526179]" />
                                        <span className="flex-1 text-xs font-black text-[#a8b7cd]">{g.name}</span>
                                        <div className="flex flex-wrap gap-1 mr-2"
                                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverGroupId(g.id); }}
                                          onDrop={e => {
                                            e.preventDefault(); e.stopPropagation();
                                            if (dragRankId !== null && dragOverRankId === null) handleRankReorder(g.id, dragRankId, null, 'after');
                                            clearDrag();
                                          }}>
                                          {ranks.filter(r => rankBelongsToGroup(r, g)).sort((a, b) => a.sort_order - b.sort_order).map(r => {
                                            const chipColor = r.color_hex ?? null;
                                            const isDragging   = dragRankId === r.id;
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
                                                data-rank-chip
                                                title={`Drag to reorder or move to another title · Click to edit: ${r.name}`}
                                                onClick={() => { if (!dragRankId) setEditRankId(r.id); }}
                                                onDragStart={e => {
                                                  e.stopPropagation();
                                                  setDragRankId(r.id);
                                                  e.dataTransfer.effectAllowed = 'move';
                                                  e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                                                }}
                                                onDragOver={e => {
                                                  e.preventDefault(); e.stopPropagation();
                                                  e.dataTransfer.dropEffect = 'move';
                                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                  setDragOverRankId(r.id);
                                                  setDragOverGroupId(g.id);
                                                  setDragOverSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
                                                }}
                                                onDragLeave={() => { setDragOverRankId(null); }}
                                                onDrop={e => {
                                                  e.preventDefault(); e.stopPropagation();
                                                  if (dragRankId !== null) handleRankReorder(g.id, dragRankId, r.id, dragOverSide);
                                                  clearDrag();
                                                }}
                                                onDragEnd={clearDrag}
                                                className="group/chip flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold select-none transition-all"
                                                style={{ ...baseStyle, ...dropStyle, opacity: isDragging ? 0.35 : 1, cursor: 'grab' }}>
                                                <GripVertical className="h-2.5 w-2.5 opacity-20 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                {r.insignia_url && (
                                                  <img src={r.insignia_url} alt="" className="h-4 w-4 object-contain shrink-0"
                                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                )}
                                                {r.name}
                                                {r.discord_role_id && (
                                                  <span title="Linked to a Discord role" className="opacity-60 text-[#5865f2] leading-none">⬡</span>
                                                )}
                                                <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                <span
                                                  role="button"
                                                  title="Delete rank"
                                                  onClick={e => { e.stopPropagation(); handleDeleteRank(r.id, r.name); }}
                                                  className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-red-400 cursor-pointer leading-none">
                                                  <Trash2 className="h-2.5 w-2.5" />
                                                </span>
                                              </button>
                                            );
                                          })}
                                          {/* Empty-group drop hint */}
                                          {ranks.filter(r => rankBelongsToGroup(r, g)).length === 0 && dragRankId !== null && (
                                            <span className="rounded border border-dashed border-[#4384ff]/40 px-2 py-0.5 text-[9px] text-[#4384ff]/60 select-none">Drop here</span>
                                          )}
                                        </div>
                                        <button type="button" onClick={() => { setAddRankGroupId(g.id); setNewRankName(''); setNewRankDiscordRoleId(''); }}
                                          className="flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#2f70ff] hover:text-[#4384ff] transition-colors shrink-0">
                                          <Plus className="h-3 w-3" />Add Rank
                                        </button>
                                        {/* Panel access toggle — always visible */}
                                        <button
                                          type="button"
                                          title={g.panel_access ? 'Department Panel access ON — click to disable' : 'Department Panel access OFF — click to enable'}
                                          onClick={() => handleTogglePanelAccess(g.id, !g.panel_access)}
                                          className={`flex items-center gap-1 rounded border px-2 py-1 text-[9px] font-black transition-colors shrink-0 ${
                                            g.panel_access
                                              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                              : 'border-[#1f3050] bg-[#0a1525] text-[#3f5470] hover:border-[#2f70ff] hover:text-[#4384ff]'
                                          }`}>
                                          <Shield className="h-3 w-3" />
                                          Panel
                                        </button>
                                        {/* Division oversight — see all restricted division resources & rosters */}
                                        <button
                                          type="button"
                                          title={g.division_oversight
                                            ? 'Division oversight ON — this title can view all division resources and rosters (including restricted). Click to disable.'
                                            : 'Division oversight OFF — click to let this title view all division resources and rosters even when restricted.'}
                                          onClick={() => handleToggleDivisionOversight(g.id, !g.division_oversight)}
                                          className={`flex items-center gap-1 rounded border px-2 py-1 text-[9px] font-black transition-colors shrink-0 ${
                                            g.division_oversight
                                              ? 'border-[#a78bfa]/50 bg-[#a78bfa]/10 text-[#a78bfa] hover:bg-[#a78bfa]/20'
                                              : 'border-[#1f3050] bg-[#0a1525] text-[#3f5470] hover:border-[#a78bfa]/50 hover:text-[#a78bfa]'
                                          }`}>
                                          <Layers className="h-3 w-3" />
                                          Divisions
                                        </button>
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                                          <button type="button" title="Rename" onClick={() => { setEditingGroupId(g.id); setEditingGroupName(g.name); }}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-[#4384ff] transition-colors">
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move up" onClick={() => handleMoveGroup(g.id, 'up')} disabled={i === 0}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronUp className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move down" onClick={() => handleMoveGroup(g.id, 'down')} disabled={i === groups.length - 1}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronDown className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Delete title" onClick={() => handleDeleteGroup(g.id, g.name)}
                                            className="rounded p-1 text-[#3f5470] hover:bg-red-500/10 hover:text-red-400 transition-colors">
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>

                                  {addRankGroupId === g.id && (
                                    <div className="flex flex-col gap-2 px-6 py-2.5 bg-[#060c18] border-t border-[#0c1525]">
                                      <div className="flex items-center gap-2">
                                        <input autoFocus type="text" placeholder="Rank name…"
                                          value={newRankName} onChange={e => setNewRankName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') handleAddRankToGroup(g.id); if (e.key === 'Escape') { setAddRankGroupId(null); setNewRankDiscordRoleId(''); } }}
                                          className="flex-1 h-8 rounded border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                                        <button type="button" onClick={() => handleAddRankToGroup(g.id)} disabled={addingRank || !newRankName.trim()}
                                          className="rounded border border-[#2f66ee] bg-[#2f66ee]/10 px-3 py-1.5 text-[10px] font-black text-[#4384ff] hover:bg-[#2f66ee]/20 transition-colors disabled:opacity-40">
                                          {addingRank ? 'Adding…' : 'Add'}
                                        </button>
                                        <button type="button" onClick={() => { setAddRankGroupId(null); setNewRankDiscordRoleId(''); }}
                                          className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
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
                                          {dpsGuildRoles.map(r => (
                                            <option key={r.id} value={r.id}>{r.name}</option>
                                          ))}
                                        </select>
                                        <p className="mt-1 text-[10px] text-[#3f5470]">
                                          Optional — members with this DPS Discord role are synced onto the roster.
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                               );
                              })}

                              {addTitleOpen && (
                                <div className="flex items-center gap-2 px-6 py-3 bg-[#060c18]">
                                  <input autoFocus type="text" placeholder="Title name…"
                                    value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') setAddTitleOpen(false); }}
                                    className="flex-1 h-8 rounded border border-[#f4c542]/30 bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#f4c542]/60" />
                                  <button type="button" onClick={handleAddGroup} disabled={addingGroup || !newGroupName.trim()}
                                    className="rounded border border-[#f4c542]/40 bg-[#f4c542]/10 px-3 py-1.5 text-[10px] font-black text-[#f4c542] hover:bg-[#f4c542]/20 transition-colors disabled:opacity-40">
                                    {addingGroup ? 'Creating…' : 'Create'}
                                  </button>
                                  <button type="button" onClick={() => setAddTitleOpen(false)}
                                    className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {groups.length === 0 && !addTitleOpen && !groupsLoading && (
                        <div className="border-t border-[#131f30] px-6 py-4 flex items-center gap-3">
                          <span className="text-xs text-[#3f5470]">No titles yet.</span>
                          <button type="button" onClick={() => { setAddTitleOpen(true); setNewGroupName(''); }}
                            className="text-xs font-black text-[#f4c542] hover:underline">
                            Add your first title →
                          </button>
                        </div>
                      )}

                      {/* Officers table */}
                      <div className="border-t border-[#131f30]">
                        <button
                          type="button"
                          onClick={() => setPanelMembersCollapsed(c => !c)}
                          className="flex w-full items-center gap-2 bg-[#070d16] px-6 py-2.5 text-left hover:bg-[#081422] transition-colors"
                          aria-expanded={!panelMembersCollapsed}
                        >
                          <Users className="h-3.5 w-3.5 shrink-0 text-[#f4c542]" />
                          <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Officers</span>
                          <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{filteredPanel.length}</span>
                          {panelMembersCollapsed
                            ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[#526179]" />
                            : <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-[#526179]" />}
                        </button>

                      {!panelMembersCollapsed && (
                      filteredPanel.length === 0 ? (
                        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
                          <Users className="h-8 w-8 text-[#1e2e42]" />
                          <p className="text-sm font-bold text-[#3f5470]">No officers found.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[700px] border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-[#131f30]">
                                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Username</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Rank</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Callsign</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Status</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Units</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Appointed</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredPanel.map(m => (
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
                                    <div className="flex items-center gap-1.5">
                                      {(() => { const ins = ranks.find(r => r.name.toLowerCase() === (m.dps_rank || m.rank)?.toLowerCase())?.insignia_url; return ins ? <img src={ins} alt="" className="h-4 w-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null; })()}
                                      <span className="capitalize text-[#a8b7cd]">{m.dps_rank || m.rank || '—'}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5 font-black text-[#4384ff]">{m.callsign || '—'}</td>
                                  <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex flex-wrap gap-1">
                                      {rosterDivisions.filter(d => memberInDivision(m, d)).map(d => (
                                        <span key={d.id} title={d.name} className="rounded border border-[#f4c542]/20 bg-[#f4c542]/10 px-1.5 py-0.5 text-[9px] font-black text-[#f4c542]">{divisionShortName(d)}</span>
                                      ))}
                                      {!rosterDivisions.some(d => memberInDivision(m, d)) && <span className="text-[#2a3a50]">—</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5 text-[#8392aa]">{formatDate(m.appointed_date)}</td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        title="Access permissions"
                                        onClick={() => setAccessMemberId(m.id)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#f4c542]/50 hover:text-[#f4c542] transition-colors"
                                      >
                                        <Lock className="h-3 w-3" />
                                        Access
                                      </button>
                                      <button type="button" onClick={() => setEditMember(m)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#2f70ff] hover:text-white transition-colors">
                                        <Pencil className="h-3 w-3" />
                                        Edit
                                      </button>
                                      <button type="button" onClick={() => handleDelete(m)}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-black text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors">
                                        <Trash2 className="h-3 w-3" />
                                        Remove
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                      )}
                      </div>
                    </div>

                    <PermissionAccessOverview
                      title="Department Permission Access"
                      description="Department Panel (by title), all-resources and IAB grants, plus division editor access."
                      accentTextClass="text-[#f4c542]"
                      accentBorderClass="border-[#f4c542]/20"
                      rows={departmentPermissionOverviewRows}
                      emptyMessage="No personnel with department permission grants match your filters."
                    />
                  </div>
                )}

                {panelSection === 'division' && (
                  <DivisionPanelSection
                    members={panelMembers}
                    membersLoading={panelLoading}
                    DiscordAvatar={DiscordAvatar}
                    fullAccess={hasFullPanelAccess}
                    divisionAccess={myDivisionAccess}
                    actor={session?.username ?? 'DPS Panel'}
                    onBack={() => {
                      if (isDivisionOnlyPanelEditor) {
                        setActiveTab('personnel-roster');
                        setPanelSection(null);
                        return;
                      }
                      setPanelSection(null);
                    }}
                    onMembersChanged={() => {
                      fetchPanelMembers({ silent: true });
                      fetch('/api/roster/divisions', { headers: { accept: 'application/json' } })
                        .then(r => r.json())
                        .then(divs => {
                          const rows = Array.isArray(divs) ? (divs as RosterDivision[]) : [];
                          setRosterDivisions(rows);
                          setDivisionStats(s => ({ ...s, divisions: rows.length }));
                        })
                        .catch(() => {});
                      fetch('/api/roster/division-ranks', { headers: { accept: 'application/json' } })
                        .then(r => r.json())
                        .then(divRanks => {
                          setDivisionRanksForEdit(Array.isArray(divRanks) ? divRanks : []);
                          setDivisionStats(s => ({ ...s, ranks: Array.isArray(divRanks) ? divRanks.length : 0 }));
                        })
                        .catch(() => {});
                      if (roster.length > 0) {
                        fetch('/api/roster', { headers: { accept: 'application/json' } })
                          .then(r => r.json())
                          .then((rows) => setRoster(Array.isArray(rows) ? dedupeRosterMembersById((rows as RosterMember[]).map(normalizeRosterMember)) : []))
                          .catch(() => {});
                      }
                    }}
                    onOpenResource={(r) => handleOpenResource(r as DpsResource, true)}
                    onAddResource={(divId) => {
                      setAddResourceStep(0);
                      setNewResourceName('');
                      setNewResourceType('document');
                      setUploadFile(null);
                      setUploadStatus(null);
                      setResourceTargetDivisionId(divId);
                      setNewResourceDivisionOnly(true);
                      setNewResourceAllowedRanks([]);
                      setAddResourceStep(1);
                    }}
                    onDeleteResource={handleDeleteResource}
                    deletingResourceId={deletingResourceId}
                    resourcesRefreshKey={divisionResourcesTick}
                  />
                )}

                {/* ── Vehicle section ──────────────────────────────────────────── */}
                {panelSection === 'vehicle' && (() => {
                  const filteredFleet = fleet.filter(v => {
                    const q = vehiclePanelSearch.toLowerCase();
                    return !q || v.name.toLowerCase().includes(q) || v.category.toLowerCase().includes(q)
                      || v.who_can_drive.some(r => r.toLowerCase().includes(q));
                  });

                  const handleAddCategory = async () => {
                    if (!newCategoryName.trim()) return;
                    setAddingCategory(true);
                    try {
                      await fetch('/api/roster/fleet/categories', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: newCategoryName.trim() }),
                      });
                      setAddCategoryOpen(false); setNewCategoryName('');
                      fetchFleetPanel();
                    } catch { toast.error('Failed to add title.'); }
                    finally { setAddingCategory(false); }
                  };

                  const handleRenameCategory = async (id: number) => {
                    if (!editingCategoryName.trim()) return;
                    try {
                      await fetch(`/api/roster/fleet/categories/${id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: editingCategoryName.trim() }),
                      });
                      setEditingCategoryId(null); fetchFleetPanel();
                    } catch { toast.error('Failed to rename title.'); }
                  };

                  const handleDeleteCategory = async (id: number, name: string) => {
                    if (!confirm(`Delete title "${name}" and all its vehicles?`)) return;
                    try {
                      await fetch(`/api/roster/fleet/categories/${id}`, { method: 'DELETE' });
                      fetchFleetPanel();
                    } catch { toast.error('Failed to delete title.'); }
                  };

                  const handleMoveCategory = async (id: number, dir: 'up' | 'down') => {
                    const idx = fleetCategories.findIndex(c => c.id === id);
                    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
                    if (swapIdx < 0 || swapIdx >= fleetCategories.length) return;
                    const reordered = [...fleetCategories];
                    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
                    setFleetCategories(reordered);
                    try {
                      await fetch('/api/roster/fleet/categories/reorder', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ ordered: reordered.map(c => c.id) }),
                      });
                    } catch { toast.error('Failed to reorder.'); fetchFleetPanel(); }
                  };

                  const addVehicleCatName = fleetCategories.find(c => c.id === addVehicleCatId)?.name ?? '';

                  const handleAddVehicleToCategory = async () => {
                    if (!newVehicleForm.name.trim()) return;
                    setAddingVehicleInCat(true);
                    try {
                      await fetch('/api/roster/fleet', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          name:                  newVehicleForm.name.trim(),
                          year:                  newVehicleForm.year.trim() || null,
                          category:              addVehicleCatName,
                          image_url:             newVehicleForm.imageUrl.trim() || null,
                          image_scale:           newVehicleForm.imageScale,
                          image_position_x:      newVehicleForm.imagePosX,
                          image_position_y:      newVehicleForm.imagePosY,
                          who_can_drive:         newVehicleForm.restrictToRanks.split(',').map(s => s.trim()).filter(Boolean),
                          restrict_to_divisions: newVehicleForm.restrictToDivisions,
                          liveries:              newVehicleForm.liveries.split(',').map(s => s.trim()).filter(Boolean),
                          notes:                 newVehicleForm.notes.trim() || null,
                          actor:                 session?.username ?? 'DPS Panel',
                        }),
                      });
                      setAddVehicleCatId(null);
                      setNewVehicleForm({ name: '', year: '', restrictToRanks: '', restrictToDivisions: [], notes: '', imageUrl: '', liveries: '', imageScale: 1, imagePosX: 50, imagePosY: 50 });
                      fetchFleetPanel();
                    } catch { toast.error('Failed to add vehicle.'); }
                    finally { setAddingVehicleInCat(false); }
                  };

                  const handleDeleteVehicle = async (id: number, name: string) => {
                    if (!confirm(`Remove "${name}" from the roster?`)) return;
                    try {
                      await fetch(`/api/roster/fleet/${id}`, { method: 'DELETE', headers: { 'x-actor': session?.username ?? 'DPS Panel' } });
                      fetchFleetPanel();
                    } catch { toast.error('Failed to remove vehicle.'); }
                  };

                  const handleSaveVehicle = async () => {
                    if (!editVehicleItem) return;
                    setSavingVehicle(true);
                    try {
                      await fetch(`/api/roster/fleet/${editVehicleItem.id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          name:                  editVehicleItem.name,
                          year:                  editVehicleItem.year || null,
                          category:              editVehicleItem.category,
                          image_url:             editVehicleItem.image_url || null,
                          image_scale:           editVehicleItem.image_scale,
                          image_position_x:      editVehicleItem.image_position_x,
                          image_position_y:      editVehicleItem.image_position_y,
                          who_can_drive:         editVehicleItem.who_can_drive,
                          restrict_to_divisions: editVehicleItem.restrict_to_divisions,
                          liveries:              editVehicleItem.liveries,
                          notes:                 editVehicleItem.notes || null,
                          actor:                 session?.username ?? 'DPS Panel',
                        }),
                      });
                      setEditVehicleItem(null); fetchFleetPanel();
                    } catch { toast.error('Failed to save vehicle.'); }
                    finally { setSavingVehicle(false); }
                  };

                  return (
                  <div className="space-y-6">
                    {/* Back breadcrumb */}
                    <button type="button" onClick={() => setPanelSection(null)}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#4384ff] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Department Panel
                      <span className="text-[#2a3a50]">/</span>
                      <span className="text-[#4384ff]">Vehicle Roster</span>
                    </button>

                    {/* Add Vehicle modal */}
                    {addVehicleCatId !== null && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="w-full max-w-lg rounded-2xl border border-[#1e3050] bg-[#0a1525] shadow-2xl flex flex-col max-h-[90vh]">
                          <div className="flex items-center justify-between border-b border-[#131f30] px-6 py-4 shrink-0">
                            <div>
                              <h3 className="text-sm font-black text-white">Add Vehicle</h3>
                              <p className="text-[10px] text-[#526179] mt-0.5">Title: <span className="text-[#4384ff]">{addVehicleCatName}</span></p>
                            </div>
                            <button type="button" onClick={() => setAddVehicleCatId(null)} className="rounded p-1 text-[#526179] hover:text-white"><X className="h-4 w-4" /></button>
                          </div>
                          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Name <span className="text-red-400">*</span></label>
                                <input autoFocus type="text" placeholder="e.g. Ford Explorer"
                                  value={newVehicleForm.name} onChange={e => setNewVehicleForm(f => ({ ...f, name: e.target.value }))}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Year</label>
                                <input type="text" placeholder="e.g. 2024"
                                  value={newVehicleForm.year} onChange={e => setNewVehicleForm(f => ({ ...f, year: e.target.value }))}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" />
                              </div>
                              <ImageInput value={newVehicleForm.imageUrl} onChange={v => setNewVehicleForm(f => ({ ...f, imageUrl: v }))} label="Picture" accent="#4384ff" adjust={{ scale: newVehicleForm.imageScale, posX: newVehicleForm.imagePosX, posY: newVehicleForm.imagePosY }} onAdjustChange={a => setNewVehicleForm(f => ({ ...f, imageScale: a.scale, imagePosX: a.posX, imagePosY: a.posY }))} />
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Restrict to Ranks</label>
                                {(() => {
                                  const selected = newVehicleForm.restrictToRanks.split(',').map(s => s.trim()).filter(Boolean);
                                  const toggle = (name: string) => {
                                    const next = selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name];
                                    setNewVehicleForm(f => ({ ...f, restrictToRanks: next.join(', ') }));
                                  };
                                  return (
                                    <div className="relative">
                                      <button type="button" onClick={() => setAddRankDropOpen(o => !o)}
                                        className="w-full flex items-center justify-between rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-left outline-none focus:border-[#4384ff] transition-colors hover:border-[#2f50a0]">
                                        <span className={selected.length === 0 ? 'text-[#3f5470]' : 'text-white'}>
                                          {selected.length === 0 ? 'Select ranks…' : selected.join(', ')}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 text-[#526179] shrink-0 ml-2" />
                                      </button>
                                      {addRankDropOpen && (
                                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#1f3050] bg-[#07111f] shadow-xl max-h-48 overflow-y-auto">
                                          {ranks.length === 0
                                            ? <div className="px-3 py-2 text-xs text-[#3f5470]">No ranks found.</div>
                                            : ranks.map(r => (
                                                <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0d1a2e] cursor-pointer transition-colors">
                                                  <input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)}
                                                    className="accent-[#4384ff] h-3.5 w-3.5 shrink-0" />
                                                  <span className="text-xs font-semibold text-[#a8b7cd]">{r.name}</span>
                                                </label>
                                              ))
                                          }
                                          <div className="border-t border-[#131f30] px-3 py-2">
                                            <button type="button" onClick={() => setAddRankDropOpen(false)}
                                              className="w-full rounded bg-[#1a2a40] py-1.5 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Done</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Divisional Accessible By</label>
                                <div className="flex flex-wrap gap-2">
                                  {DIVISION_OPTIONS.map(d => {
                                    const checked = newVehicleForm.restrictToDivisions.includes(d.key);
                                    return (
                                      <button key={d.key} type="button"
                                        onClick={() => setNewVehicleForm(f => ({ ...f, restrictToDivisions: checked ? f.restrictToDivisions.filter(x => x !== d.key) : [...f.restrictToDivisions, d.key] }))}
                                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-black transition-colors ${checked ? 'border-[#4384ff] bg-[#0d1e36] text-[#4384ff]' : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#2a4060] hover:text-[#a8b7cd]'}`}>
                                        <span className="font-black">{d.key}</span>
                                        <span className="font-semibold opacity-70">| {d.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Livery <span className="normal-case font-normal text-[#3f5470]">(comma-separated)</span></label>
                                <input type="text" placeholder="Standard, Supervisor, Unmarked"
                                  value={newVehicleForm.liveries} onChange={e => setNewVehicleForm(f => ({ ...f, liveries: e.target.value }))}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" />
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Notes</label>
                                <textarea rows={3} placeholder="Any additional notes about this vehicle…"
                                  value={newVehicleForm.notes} onChange={e => setNewVehicleForm(f => ({ ...f, notes: e.target.value }))}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff] resize-none" />
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 border-t border-[#131f30] px-6 py-4 shrink-0">
                            <button type="button" onClick={() => setAddVehicleCatId(null)} className="rounded-lg border border-[#1f3050] px-4 py-2 text-xs font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                            <button type="button" onClick={handleAddVehicleToCategory} disabled={addingVehicleInCat || !newVehicleForm.name.trim()}
                              className="rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors disabled:opacity-50">
                              {addingVehicleInCat ? 'Adding…' : 'Add Vehicle'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Edit vehicle modal */}
                    {editVehicleItem && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="w-full max-w-lg rounded-2xl border border-[#1e3050] bg-[#0a1525] shadow-2xl flex flex-col max-h-[90vh]">
                          <div className="flex items-center justify-between border-b border-[#131f30] px-6 py-4 shrink-0">
                            <div>
                              <h3 className="text-sm font-black text-white">Edit Vehicle</h3>
                              <p className="text-[10px] text-[#526179] mt-0.5">Title: <span className="text-[#4384ff]">{editVehicleItem.category}</span></p>
                            </div>
                            <button type="button" onClick={() => setEditVehicleItem(null)} className="rounded p-1 text-[#526179] hover:text-white"><X className="h-4 w-4" /></button>
                          </div>
                          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Name</label>
                                <input type="text" placeholder="e.g. Ford Explorer" value={editVehicleItem.name}
                                  onChange={e => setEditVehicleItem({ ...editVehicleItem, name: e.target.value })}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Year</label>
                                <input type="text" placeholder="e.g. 2024" value={editVehicleItem.year ?? ''}
                                  onChange={e => setEditVehicleItem({ ...editVehicleItem, year: e.target.value })}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" />
                              </div>
                              <ImageInput value={editVehicleItem.image_url ?? ''} onChange={v => setEditVehicleItem({ ...editVehicleItem, image_url: v })} label="Picture" accent="#4384ff" adjust={{ scale: editVehicleItem.image_scale, posX: editVehicleItem.image_position_x, posY: editVehicleItem.image_position_y }} onAdjustChange={a => setEditVehicleItem({ ...editVehicleItem, image_scale: a.scale, image_position_x: a.posX, image_position_y: a.posY })} />
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Restrict to Ranks</label>
                                {(() => {
                                  const selected = editVehicleItem.who_can_drive;
                                  const toggle = (name: string) => {
                                    const next = selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name];
                                    setEditVehicleItem({ ...editVehicleItem, who_can_drive: next });
                                  };
                                  return (
                                    <div className="relative">
                                      <button type="button" onClick={() => setEditRankDropOpen(o => !o)}
                                        className="w-full flex items-center justify-between rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-left outline-none focus:border-[#4384ff] transition-colors hover:border-[#2f50a0]">
                                        <span className={selected.length === 0 ? 'text-[#3f5470]' : 'text-white'}>
                                          {selected.length === 0 ? 'Select ranks…' : selected.join(', ')}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 text-[#526179] shrink-0 ml-2" />
                                      </button>
                                      {editRankDropOpen && (
                                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#1f3050] bg-[#07111f] shadow-xl max-h-48 overflow-y-auto">
                                          {ranks.length === 0
                                            ? <div className="px-3 py-2 text-xs text-[#3f5470]">No ranks found.</div>
                                            : ranks.map(r => (
                                                <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0d1a2e] cursor-pointer transition-colors">
                                                  <input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)}
                                                    className="accent-[#4384ff] h-3.5 w-3.5 shrink-0" />
                                                  <span className="text-xs font-semibold text-[#a8b7cd]">{r.name}</span>
                                                </label>
                                              ))
                                          }
                                          <div className="border-t border-[#131f30] px-3 py-2">
                                            <button type="button" onClick={() => setEditRankDropOpen(false)}
                                              className="w-full rounded bg-[#1a2a40] py-1.5 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Done</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Divisional Accessible By</label>
                                <div className="flex flex-wrap gap-2">
                                  {DIVISION_OPTIONS.map(d => {
                                    const checked = editVehicleItem.restrict_to_divisions.includes(d.key);
                                    return (
                                      <button key={d.key} type="button"
                                        onClick={() => setEditVehicleItem({ ...editVehicleItem, restrict_to_divisions: checked ? editVehicleItem.restrict_to_divisions.filter(x => x !== d.key) : [...editVehicleItem.restrict_to_divisions, d.key] })}
                                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-black transition-colors ${checked ? 'border-[#4384ff] bg-[#0d1e36] text-[#4384ff]' : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#2a4060] hover:text-[#a8b7cd]'}`}>
                                        <span className="font-black">{d.key}</span>
                                        <span className="font-semibold opacity-70">| {d.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Livery <span className="normal-case font-normal text-[#3f5470]">(comma-separated)</span></label>
                                <input type="text" placeholder="Standard, Supervisor, Unmarked"
                                  value={editVehicleItem.liveries.join(', ')}
                                  onChange={e => setEditVehicleItem({ ...editVehicleItem, liveries: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" />
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Notes</label>
                                <textarea rows={3} placeholder="Any additional notes about this vehicle…"
                                  value={editVehicleItem.notes ?? ''}
                                  onChange={e => setEditVehicleItem({ ...editVehicleItem, notes: e.target.value })}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff] resize-none" />
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 border-t border-[#131f30] px-6 py-4 shrink-0">
                            <button type="button" onClick={() => setEditVehicleItem(null)} className="rounded-lg border border-[#1f3050] px-4 py-2 text-xs font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                            <button type="button" onClick={handleSaveVehicle} disabled={savingVehicle}
                              className="rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors disabled:opacity-50">
                              {savingVehicle ? 'Saving…' : 'Save Changes'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Main card */}
                    <div className="rounded-xl border border-[#4384ff]/20 bg-[#070d16] overflow-hidden shadow-[0_22px_55px_rgba(0,0,0,0.22)]">

                      {/* Card header */}
                      <div className="flex items-center gap-4 border-b border-[#131f30] px-6 py-4">
                        <Car className="h-4 w-4 text-[#4384ff]" />
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Vehicle Management</h3>
                        <div className="ml-auto flex items-center gap-3">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                            <input type="text" placeholder="Search vehicles…"
                              value={vehiclePanelSearch} onChange={e => setVehiclePanelSearch(e.target.value)}
                              className="h-9 w-48 rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                          </div>
                          <button type="button" onClick={() => { setAddCategoryOpen(true); setNewCategoryName(''); }}
                            className="flex items-center gap-2 rounded-lg border border-[#4384ff]/30 bg-[#4384ff]/5 px-4 py-2 text-xs font-black text-[#4384ff] hover:bg-[#4384ff]/10 transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                            Add Title
                          </button>
                        </div>
                      </div>

                      {/* Titles section — categories with vehicle chips */}
                      {(fleetCategories.length > 0 || addCategoryOpen) && (
                        <div className="border-b border-[#131f30]">
                          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Titles</span>
                            <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{fleetCategories.length}</span>
                          </div>
                          {(
                            <div className="divide-y divide-[#0c1525]">
                              {fleetCategories.map((cat, i) => (
                                <div key={cat.id}>
                                  <div
                                    className="flex items-center gap-3 px-6 py-2.5 transition-colors group/row hover:bg-[#081422]"
                                    onDragOver={e => {
                                      if (dragVehicleId === null) return;
                                      e.preventDefault();
                                      setDragOverVehicleCat(cat.name);
                                      setDragOverVehicleId(null);
                                    }}
                                    onDrop={e => {
                                      e.preventDefault();
                                      if (dragVehicleId === null) return;
                                      handleVehicleReorder(cat.name, cat.sort_order, dragVehicleId, null, 'after');
                                      setDragVehicleId(null); setDragOverVehicleId(null); setDragOverVehicleCat(null);
                                    }}
                                  >
                                    {editingCategoryId === cat.id ? (
                                      <>
                                        <input autoFocus type="text" value={editingCategoryName}
                                          onChange={e => setEditingCategoryName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat.id); if (e.key === 'Escape') setEditingCategoryId(null); }}
                                          className="flex-1 h-7 rounded border border-[#2f70ff] bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none" />
                                        <button type="button" onClick={() => handleRenameCategory(cat.id)}
                                          className="rounded px-2 py-1 text-[10px] font-black bg-[#2f66ee] text-white hover:bg-[#3977ff] transition-colors">Save</button>
                                        <button type="button" onClick={() => setEditingCategoryId(null)}
                                          className="rounded px-2 py-1 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                                      </>
                                    ) : (
                                      <>
                                        <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover/row:opacity-40 transition-opacity text-[#526179]" />
                                        <span className="flex-1 text-xs font-black text-[#a8b7cd]">{cat.name}</span>
                                        {/* Vehicle chips — draggable to reorder / move between categories */}
                                        <div className="flex flex-wrap gap-1 mr-2">
                                          {fleet.filter(v => v.category === cat.name).sort((a, b) => a.sort_order - b.sort_order).map(v => {
                                            const chipDragging   = dragVehicleId === v.id;
                                            const chipDropBefore = dragOverVehicleId === v.id && dragOverVehicleSide === 'before';
                                            const chipDropAfter  = dragOverVehicleId === v.id && dragOverVehicleSide === 'after';
                                            return (
                                              <button key={v.id} type="button"
                                                draggable
                                                title={`Drag to reorder · Click to edit: ${v.name}`}
                                                onDragStart={e => {
                                                  setDragVehicleId(v.id);
                                                  e.dataTransfer.effectAllowed = 'move';
                                                  const ghost = document.createElement('div');
                                                  ghost.style.cssText = 'position:fixed;top:-9999px';
                                                  document.body.appendChild(ghost);
                                                  e.dataTransfer.setDragImage(ghost, 0, 0);
                                                  setTimeout(() => document.body.removeChild(ghost), 0);
                                                }}
                                                onDragOver={e => {
                                                  if (dragVehicleId === null || dragVehicleId === v.id) return;
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                  const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                                                  setDragOverVehicleId(v.id);
                                                  setDragOverVehicleSide(side);
                                                  setDragOverVehicleCat(cat.name);
                                                }}
                                                onDragLeave={() => setDragOverVehicleId(null)}
                                                onDrop={e => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  if (dragVehicleId === null) return;
                                                  handleVehicleReorder(cat.name, cat.sort_order, dragVehicleId, v.id, dragOverVehicleSide);
                                                  setDragVehicleId(null); setDragOverVehicleId(null); setDragOverVehicleCat(null);
                                                }}
                                                onDragEnd={() => { setDragVehicleId(null); setDragOverVehicleId(null); setDragOverVehicleCat(null); }}
                                                onClick={() => setEditVehicleItem(v)}
                                                style={{
                                                  opacity: chipDragging ? 0.35 : 1,
                                                  boxShadow: chipDropBefore ? '-3px 0 0 0 #4384ff' : chipDropAfter ? '3px 0 0 0 #4384ff' : undefined,
                                                  transition: 'box-shadow 80ms, opacity 80ms',
                                                }}
                                                className="group/chip flex items-center gap-1 rounded border border-[#4384ff]/30 bg-[#4384ff]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6fa3ff] select-none cursor-grab active:cursor-grabbing transition-all hover:border-[#4384ff]/60">
                                                <GripVertical className="h-2.5 w-2.5 opacity-30 shrink-0" />
                                                {v.name}
                                                <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                <span role="button" title="Delete vehicle"
                                                  onClick={e => { e.stopPropagation(); handleDeleteVehicle(v.id, v.name); }}
                                                  className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-red-400 cursor-pointer leading-none">
                                                  <Trash2 className="h-2.5 w-2.5" />
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                        {/* Add Vehicle inline trigger */}
                                        <button type="button" onClick={() => { setAddVehicleCatId(cat.id); setAddRankDropOpen(false); setNewVehicleForm({ name: '', year: '', restrictToRanks: '', restrictToDivisions: [], notes: '', imageUrl: '', liveries: '' }); }}
                                          className="flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#2f70ff] hover:text-[#4384ff] transition-colors shrink-0">
                                          <Plus className="h-3 w-3" />Add Vehicle
                                        </button>
                                        {/* Row actions */}
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                                          <button type="button" title="Rename" onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-[#4384ff] transition-colors">
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move up" onClick={() => handleMoveCategory(cat.id, 'up')} disabled={i === 0}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronUp className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move down" onClick={() => handleMoveCategory(cat.id, 'down')} disabled={i === fleetCategories.length - 1}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronDown className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Delete title" onClick={() => handleDeleteCategory(cat.id, cat.name)}
                                            className="rounded p-1 text-[#3f5470] hover:bg-red-500/10 hover:text-red-400 transition-colors">
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {/* New title inline form */}
                              {addCategoryOpen && (
                                <div className="flex items-center gap-2 px-6 py-3 bg-[#060c18]">
                                  <input autoFocus type="text" placeholder="Title name…"
                                    value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') setAddCategoryOpen(false); }}
                                    className="flex-1 h-8 rounded border border-[#4384ff]/30 bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]/60" />
                                  <button type="button" onClick={handleAddCategory} disabled={addingCategory || !newCategoryName.trim()}
                                    className="rounded border border-[#4384ff]/40 bg-[#4384ff]/10 px-3 py-1.5 text-[10px] font-black text-[#4384ff] hover:bg-[#4384ff]/20 transition-colors disabled:opacity-40">
                                    {addingCategory ? 'Creating…' : 'Create'}
                                  </button>
                                  <button type="button" onClick={() => setAddCategoryOpen(false)}
                                    className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {fleetCategories.length === 0 && !addCategoryOpen && !categoriesLoading && (
                        <div className="border-b border-[#131f30] px-6 py-4 flex items-center gap-3">
                          <span className="text-xs text-[#3f5470]">No titles yet.</span>
                          <button type="button" onClick={() => { setAddCategoryOpen(true); setNewCategoryName(''); }}
                            className="text-xs font-black text-[#4384ff] hover:underline">Add your first title →</button>
                        </div>
                      )}

                      {/* Vehicles section — like Members (only show when there are vehicles) */}
                      {fleet.length > 0 && (
                        <div className="border-t border-[#131f30]">
                          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                            <Car className="h-3.5 w-3.5 text-[#3f5470]" />
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Vehicles</span>
                            <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{fleet.length}</span>
                          </div>
                        </div>
                      )}

                      {filteredFleet.length === 0 ? (
                        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2">
                          <Car className="h-8 w-8 text-[#1e2e42]" />
                          <p className="text-sm font-bold text-[#3f5470]">No vehicles found.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-[#131f30]">
                                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Vehicle</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Title</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Who Can Drive</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Liveries</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredFleet.map(v => (
                                <tr key={v.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                  <td className="px-5 py-3.5 font-black text-white">{v.name}</td>
                                  <td className="px-4 py-3.5 text-[#526179]">{v.category}</td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex flex-wrap gap-1">
                                      {v.who_can_drive.length > 0
                                        ? v.who_can_drive.map(r => { const ins = ranks.find(x => x.name.toLowerCase() === r.toLowerCase())?.insignia_url; return <span key={r} className="inline-flex items-center gap-1 rounded border border-[#4384ff]/30 bg-[#4384ff]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6fa3ff]">{ins && <img src={ins} alt="" className="h-3 w-3 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}{r}</span>; })
                                        : <span className="text-[#2a3a50]">—</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex flex-wrap gap-1">
                                      {v.liveries.length > 0
                                        ? v.liveries.map(l => <span key={l} className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-semibold text-[#526179]">{l}</span>)
                                        : <span className="text-[#2a3a50]">—</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex items-center justify-end gap-2">
                                      <button type="button" onClick={() => setEditVehicleItem(v)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#2f70ff] hover:text-white transition-colors">
                                        <Pencil className="h-3 w-3" />Edit
                                      </button>
                                      <button type="button" onClick={() => handleDeleteVehicle(v.id, v.name)}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-black text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors">
                                        <Trash2 className="h-3 w-3" />Remove
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}

                {/* ── Event Calendar section ───────────────────────────────────── */}
                {/* ── Equipment Roster section ─────────────────────────────────── */}
                {panelSection === 'equipment' && (() => {
                  const filteredEquipment = equipment.filter(e => {
                    const q = equipmentPanelSearch.toLowerCase();
                    return !q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)
                      || e.who_can_use.some(r => r.toLowerCase().includes(q));
                  });

                  const handleAddEqCategory = async () => {
                    if (!newEqCategoryName.trim()) return;
                    setAddingEqCategory(true);
                    try {
                      await fetch('/api/roster/equipment/categories', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: newEqCategoryName.trim() }),
                      });
                      setAddEqCategoryOpen(false); setNewEqCategoryName('');
                      fetchEquipmentPanel();
                    } catch { toast.error('Failed to add title.'); }
                    finally { setAddingEqCategory(false); }
                  };

                  const handleRenameEqCategory = async (id: number) => {
                    if (!editingEqCategoryName.trim()) return;
                    try {
                      await fetch(`/api/roster/equipment/categories/${id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: editingEqCategoryName.trim() }),
                      });
                      setEditingEqCategoryId(null); fetchEquipmentPanel();
                    } catch { toast.error('Failed to rename title.'); }
                  };

                  const handleDeleteEqCategory = async (id: number, name: string) => {
                    if (!confirm(`Delete title "${name}" and all its equipment?`)) return;
                    try {
                      await fetch(`/api/roster/equipment/categories/${id}`, { method: 'DELETE' });
                      fetchEquipmentPanel();
                    } catch { toast.error('Failed to delete title.'); }
                  };

                  const handleMoveEqCategory = async (id: number, dir: 'up' | 'down') => {
                    const idx = equipmentCategories.findIndex(c => c.id === id);
                    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
                    if (swapIdx < 0 || swapIdx >= equipmentCategories.length) return;
                    const reordered = [...equipmentCategories];
                    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
                    setEquipmentCategories(reordered);
                    try {
                      await fetch('/api/roster/equipment/categories/reorder', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ ordered: reordered.map(c => c.id) }),
                      });
                    } catch { toast.error('Failed to reorder.'); fetchEquipmentPanel(); }
                  };

                  const addEquipmentCatName = equipmentCategories.find(c => c.id === addEquipmentCatId)?.name ?? '';

                  const handleAddEquipmentToCategory = async () => {
                    if (!newEquipmentForm.name.trim()) return;
                    setAddingEquipmentInCat(true);
                    try {
                      await fetch('/api/roster/equipment', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          name:                  newEquipmentForm.name.trim(),
                          category:              addEquipmentCatName,
                          image_url:             newEquipmentForm.imageUrl.trim() || null,
                          image_scale:           newEquipmentForm.imageScale,
                          image_position_x:      newEquipmentForm.imagePosX,
                          image_position_y:      newEquipmentForm.imagePosY,
                          who_can_use:           newEquipmentForm.restrictToRanks.split(',').map(s => s.trim()).filter(Boolean),
                          restrict_to_divisions: newEquipmentForm.restrictToDivisions,
                          notes:                 newEquipmentForm.notes.trim() || null,
                          actor:                 session?.username ?? 'DPS Panel',
                        }),
                      });
                      setAddEquipmentCatId(null);
                      setNewEquipmentForm({ name: '', restrictToRanks: '', restrictToDivisions: [], notes: '', imageUrl: '', imageScale: 1, imagePosX: 50, imagePosY: 50 });
                      fetchEquipmentPanel();
                    } catch { toast.error('Failed to add equipment.'); }
                    finally { setAddingEquipmentInCat(false); }
                  };

                  const handleDeleteEquipment = async (id: number, name: string) => {
                    if (!confirm(`Remove "${name}" from the roster?`)) return;
                    try {
                      await fetch(`/api/roster/equipment/${id}`, { method: 'DELETE', headers: { 'x-actor': session?.username ?? 'DPS Panel' } });
                      fetchEquipmentPanel();
                    } catch { toast.error('Failed to remove equipment.'); }
                  };

                  const handleSaveEquipment = async () => {
                    if (!editEquipmentItem) return;
                    setSavingEquipment(true);
                    try {
                      await fetch(`/api/roster/equipment/${editEquipmentItem.id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          name:                  editEquipmentItem.name,
                          category:              editEquipmentItem.category,
                          image_url:             editEquipmentItem.image_url || null,
                          image_scale:           editEquipmentItem.image_scale,
                          image_position_x:      editEquipmentItem.image_position_x,
                          image_position_y:      editEquipmentItem.image_position_y,
                          who_can_use:           editEquipmentItem.who_can_use,
                          restrict_to_divisions: editEquipmentItem.restrict_to_divisions,
                          notes:                 editEquipmentItem.notes || null,
                          actor:                 session?.username ?? 'DPS Panel',
                        }),
                      });
                      setEditEquipmentItem(null); fetchEquipmentPanel();
                    } catch { toast.error('Failed to save equipment.'); }
                    finally { setSavingEquipment(false); }
                  };

                  return (
                  <div className="space-y-6">
                    {/* Back breadcrumb */}
                    <button type="button" onClick={() => setPanelSection(null)}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#fb923c] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Department Panel
                      <span className="text-[#2a3a50]">/</span>
                      <span className="text-[#fb923c]">Equipment Roster</span>
                    </button>

                    {/* Add Equipment modal */}
                    {addEquipmentCatId !== null && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="w-full max-w-lg rounded-2xl border border-[#1e3050] bg-[#0a1525] shadow-2xl flex flex-col max-h-[90vh]">
                          <div className="flex items-center justify-between border-b border-[#131f30] px-6 py-4 shrink-0">
                            <div>
                              <h3 className="text-sm font-black text-white">Add Equipment</h3>
                              <p className="text-[10px] text-[#526179] mt-0.5">Title: <span className="text-[#fb923c]">{addEquipmentCatName}</span></p>
                            </div>
                            <button type="button" onClick={() => setAddEquipmentCatId(null)} className="rounded p-1 text-[#526179] hover:text-white"><X className="h-4 w-4" /></button>
                          </div>
                          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Equipment Name <span className="text-red-400">*</span></label>
                                <input autoFocus type="text" placeholder="e.g. Tactical Vest"
                                  value={newEquipmentForm.name} onChange={e => setNewEquipmentForm(f => ({ ...f, name: e.target.value }))}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#fb923c]" />
                              </div>
                              <ImageInput value={newEquipmentForm.imageUrl} onChange={v => setNewEquipmentForm(f => ({ ...f, imageUrl: v }))} label="Picture" accent="#fb923c" adjust={{ scale: newEquipmentForm.imageScale, posX: newEquipmentForm.imagePosX, posY: newEquipmentForm.imagePosY }} onAdjustChange={a => setNewEquipmentForm(f => ({ ...f, imageScale: a.scale, imagePosX: a.posX, imagePosY: a.posY }))} />
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Restrict to Ranks</label>
                                {(() => {
                                  const selected = newEquipmentForm.restrictToRanks.split(',').map(s => s.trim()).filter(Boolean);
                                  const toggle = (name: string) => {
                                    const next = selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name];
                                    setNewEquipmentForm(f => ({ ...f, restrictToRanks: next.join(', ') }));
                                  };
                                  return (
                                    <div className="relative">
                                      <button type="button" onClick={() => setAddEqRankDropOpen(o => !o)}
                                        className="w-full flex items-center justify-between rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-left outline-none focus:border-[#fb923c] transition-colors hover:border-[#7a3a10]">
                                        <span className={selected.length === 0 ? 'text-[#3f5470]' : 'text-white'}>
                                          {selected.length === 0 ? 'Select ranks…' : selected.join(', ')}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 text-[#526179] shrink-0 ml-2" />
                                      </button>
                                      {addEqRankDropOpen && (
                                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#1f3050] bg-[#07111f] shadow-xl max-h-48 overflow-y-auto">
                                          {ranks.length === 0
                                            ? <div className="px-3 py-2 text-xs text-[#3f5470]">No ranks found.</div>
                                            : ranks.map(r => (
                                                <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0d1a2e] cursor-pointer transition-colors">
                                                  <input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)}
                                                    className="accent-[#fb923c] h-3.5 w-3.5 shrink-0" />
                                                  <span className="text-xs font-semibold text-[#a8b7cd]">{r.name}</span>
                                                </label>
                                              ))
                                          }
                                          <div className="border-t border-[#131f30] px-3 py-2">
                                            <button type="button" onClick={() => setAddEqRankDropOpen(false)}
                                              className="w-full rounded bg-[#1a2a40] py-1.5 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Done</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Divisional Accessible By</label>
                                <div className="flex flex-wrap gap-2">
                                  {DIVISION_OPTIONS.map(d => {
                                    const checked = newEquipmentForm.restrictToDivisions.includes(d.key);
                                    return (
                                      <button key={d.key} type="button"
                                        onClick={() => setNewEquipmentForm(f => ({ ...f, restrictToDivisions: checked ? f.restrictToDivisions.filter(x => x !== d.key) : [...f.restrictToDivisions, d.key] }))}
                                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-black transition-colors ${checked ? 'border-[#fb923c] bg-[#1a0e05] text-[#fb923c]' : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#2a4060] hover:text-[#a8b7cd]'}`}>
                                        <span className="font-black">{d.key}</span>
                                        <span className="font-semibold opacity-70">| {d.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Notes</label>
                                <textarea rows={3} placeholder="Any additional notes about this equipment…"
                                  value={newEquipmentForm.notes} onChange={e => setNewEquipmentForm(f => ({ ...f, notes: e.target.value }))}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#fb923c] resize-none" />
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 border-t border-[#131f30] px-6 py-4 shrink-0">
                            <button type="button" onClick={() => setAddEquipmentCatId(null)} className="rounded-lg border border-[#1f3050] px-4 py-2 text-xs font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                            <button type="button" onClick={handleAddEquipmentToCategory} disabled={addingEquipmentInCat || !newEquipmentForm.name.trim()}
                              className="rounded-lg bg-[#c2651e] px-4 py-2 text-xs font-black text-white hover:bg-[#e07830] transition-colors disabled:opacity-50">
                              {addingEquipmentInCat ? 'Adding…' : 'Add Equipment'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Edit equipment modal */}
                    {editEquipmentItem && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="w-full max-w-lg rounded-2xl border border-[#1e3050] bg-[#0a1525] shadow-2xl flex flex-col max-h-[90vh]">
                          <div className="flex items-center justify-between border-b border-[#131f30] px-6 py-4 shrink-0">
                            <div>
                              <h3 className="text-sm font-black text-white">Edit Equipment</h3>
                              <p className="text-[10px] text-[#526179] mt-0.5">Title: <span className="text-[#fb923c]">{editEquipmentItem.category}</span></p>
                            </div>
                            <button type="button" onClick={() => setEditEquipmentItem(null)} className="rounded p-1 text-[#526179] hover:text-white"><X className="h-4 w-4" /></button>
                          </div>
                          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Equipment Name</label>
                                <input type="text" placeholder="e.g. Tactical Vest" value={editEquipmentItem.name}
                                  onChange={e => setEditEquipmentItem({ ...editEquipmentItem, name: e.target.value })}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#fb923c]" />
                              </div>
                              <ImageInput value={editEquipmentItem.image_url ?? ''} onChange={v => setEditEquipmentItem({ ...editEquipmentItem, image_url: v })} label="Picture" accent="#fb923c" adjust={{ scale: editEquipmentItem.image_scale, posX: editEquipmentItem.image_position_x, posY: editEquipmentItem.image_position_y }} onAdjustChange={a => setEditEquipmentItem({ ...editEquipmentItem, image_scale: a.scale, image_position_x: a.posX, image_position_y: a.posY })} />
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Restrict to Ranks</label>
                                {(() => {
                                  const selected = editEquipmentItem.who_can_use;
                                  const toggle = (name: string) => {
                                    const next = selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name];
                                    setEditEquipmentItem({ ...editEquipmentItem, who_can_use: next });
                                  };
                                  return (
                                    <div className="relative">
                                      <button type="button" onClick={() => setEditEqRankDropOpen(o => !o)}
                                        className="w-full flex items-center justify-between rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-left outline-none focus:border-[#fb923c] transition-colors hover:border-[#7a3a10]">
                                        <span className={selected.length === 0 ? 'text-[#3f5470]' : 'text-white'}>
                                          {selected.length === 0 ? 'Select ranks…' : selected.join(', ')}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 text-[#526179] shrink-0 ml-2" />
                                      </button>
                                      {editEqRankDropOpen && (
                                        <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#1f3050] bg-[#07111f] shadow-xl max-h-48 overflow-y-auto">
                                          {ranks.length === 0
                                            ? <div className="px-3 py-2 text-xs text-[#3f5470]">No ranks found.</div>
                                            : ranks.map(r => (
                                                <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0d1a2e] cursor-pointer transition-colors">
                                                  <input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)}
                                                    className="accent-[#fb923c] h-3.5 w-3.5 shrink-0" />
                                                  <span className="text-xs font-semibold text-[#a8b7cd]">{r.name}</span>
                                                </label>
                                              ))
                                          }
                                          <div className="border-t border-[#131f30] px-3 py-2">
                                            <button type="button" onClick={() => setEditEqRankDropOpen(false)}
                                              className="w-full rounded bg-[#1a2a40] py-1.5 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Done</button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Divisional Accessible By</label>
                                <div className="flex flex-wrap gap-2">
                                  {DIVISION_OPTIONS.map(d => {
                                    const checked = editEquipmentItem.restrict_to_divisions.includes(d.key);
                                    return (
                                      <button key={d.key} type="button"
                                        onClick={() => setEditEquipmentItem({ ...editEquipmentItem, restrict_to_divisions: checked ? editEquipmentItem.restrict_to_divisions.filter(x => x !== d.key) : [...editEquipmentItem.restrict_to_divisions, d.key] })}
                                        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-black transition-colors ${checked ? 'border-[#fb923c] bg-[#1a0e05] text-[#fb923c]' : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#2a4060] hover:text-[#a8b7cd]'}`}>
                                        <span className="font-black">{d.key}</span>
                                        <span className="font-semibold opacity-70">| {d.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="col-span-2">
                                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Notes</label>
                                <textarea rows={3} placeholder="Any additional notes about this equipment…"
                                  value={editEquipmentItem.notes ?? ''}
                                  onChange={e => setEditEquipmentItem({ ...editEquipmentItem, notes: e.target.value })}
                                  className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#fb923c] resize-none" />
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 border-t border-[#131f30] px-6 py-4 shrink-0">
                            <button type="button" onClick={() => setEditEquipmentItem(null)} className="rounded-lg border border-[#1f3050] px-4 py-2 text-xs font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                            <button type="button" onClick={handleSaveEquipment} disabled={savingEquipment}
                              className="rounded-lg bg-[#c2651e] px-4 py-2 text-xs font-black text-white hover:bg-[#e07830] transition-colors disabled:opacity-50">
                              {savingEquipment ? 'Saving…' : 'Save Changes'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Main card */}
                    <div className="rounded-xl border border-[#fb923c]/20 bg-[#070d16] overflow-hidden shadow-[0_22px_55px_rgba(0,0,0,0.22)]">

                      {/* Card header */}
                      <div className="flex items-center gap-4 border-b border-[#131f30] px-6 py-4">
                        <Package className="h-4 w-4 text-[#fb923c]" />
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#fb923c]">Equipment Management</h3>
                        <div className="ml-auto flex items-center gap-3">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                            <input type="text" placeholder="Search equipment…"
                              value={equipmentPanelSearch} onChange={e => setEquipmentPanelSearch(e.target.value)}
                              className="h-9 w-48 rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#fb923c]" />
                          </div>
                          <button type="button" onClick={() => { setAddEqCategoryOpen(true); setNewEqCategoryName(''); }}
                            className="flex items-center gap-2 rounded-lg border border-[#fb923c]/30 bg-[#fb923c]/5 px-4 py-2 text-xs font-black text-[#fb923c] hover:bg-[#fb923c]/10 transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                            Add Title
                          </button>
                        </div>
                      </div>

                      {/* Titles section */}
                      {(equipmentCategories.length > 0 || addEqCategoryOpen) && (
                        <div className="border-b border-[#131f30]">
                          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Titles</span>
                            <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{equipmentCategories.length}</span>
                          </div>
                          {(
                            <div className="divide-y divide-[#0c1525]">
                              {equipmentCategories.map((cat, i) => (
                                <div key={cat.id}>
                                  <div
                                    className="flex items-center gap-3 px-6 py-2.5 transition-colors group/row hover:bg-[#081422]"
                                    onDragOver={e => {
                                      if (dragEquipmentId === null) return;
                                      e.preventDefault();
                                      setDragOverEquipmentCat(cat.name);
                                      setDragOverEquipmentId(null);
                                    }}
                                    onDrop={e => {
                                      e.preventDefault();
                                      if (dragEquipmentId === null) return;
                                      handleEquipmentReorder(cat.name, cat.sort_order, dragEquipmentId, null, 'after');
                                      setDragEquipmentId(null); setDragOverEquipmentId(null); setDragOverEquipmentCat(null);
                                    }}
                                  >
                                    {editingEqCategoryId === cat.id ? (
                                      <>
                                        <input autoFocus type="text" value={editingEqCategoryName}
                                          onChange={e => setEditingEqCategoryName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') handleRenameEqCategory(cat.id); if (e.key === 'Escape') setEditingEqCategoryId(null); }}
                                          className="flex-1 h-7 rounded border border-[#fb923c]/40 bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none" />
                                        <button type="button" onClick={() => handleRenameEqCategory(cat.id)}
                                          className="rounded px-2 py-1 text-[10px] font-black bg-[#c2651e] text-white hover:bg-[#e07830] transition-colors">Save</button>
                                        <button type="button" onClick={() => setEditingEqCategoryId(null)}
                                          className="rounded px-2 py-1 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                                      </>
                                    ) : (
                                      <>
                                        <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover/row:opacity-40 transition-opacity text-[#526179]" />
                                        <span className="flex-1 text-xs font-black text-[#a8b7cd]">{cat.name}</span>
                                        {/* Equipment chips — draggable */}
                                        <div className="flex flex-wrap gap-1 mr-2">
                                          {equipment.filter(e => e.category === cat.name).sort((a, b) => a.sort_order - b.sort_order).map(item => {
                                            const chipDragging   = dragEquipmentId === item.id;
                                            const chipDropBefore = dragOverEquipmentId === item.id && dragOverEquipmentSide === 'before';
                                            const chipDropAfter  = dragOverEquipmentId === item.id && dragOverEquipmentSide === 'after';
                                            return (
                                              <button key={item.id} type="button"
                                                draggable
                                                title={`Drag to reorder · Click to edit: ${item.name}`}
                                                onDragStart={e => {
                                                  setDragEquipmentId(item.id);
                                                  e.dataTransfer.effectAllowed = 'move';
                                                  const ghost = document.createElement('div');
                                                  ghost.style.cssText = 'position:fixed;top:-9999px';
                                                  document.body.appendChild(ghost);
                                                  e.dataTransfer.setDragImage(ghost, 0, 0);
                                                  setTimeout(() => document.body.removeChild(ghost), 0);
                                                }}
                                                onDragOver={e => {
                                                  if (dragEquipmentId === null || dragEquipmentId === item.id) return;
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                  const side: 'before' | 'after' = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                                                  setDragOverEquipmentId(item.id);
                                                  setDragOverEquipmentSide(side);
                                                  setDragOverEquipmentCat(cat.name);
                                                }}
                                                onDragLeave={() => setDragOverEquipmentId(null)}
                                                onDrop={e => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  if (dragEquipmentId === null) return;
                                                  handleEquipmentReorder(cat.name, cat.sort_order, dragEquipmentId, item.id, dragOverEquipmentSide);
                                                  setDragEquipmentId(null); setDragOverEquipmentId(null); setDragOverEquipmentCat(null);
                                                }}
                                                onDragEnd={() => { setDragEquipmentId(null); setDragOverEquipmentId(null); setDragOverEquipmentCat(null); }}
                                                onClick={() => setEditEquipmentItem(item)}
                                                style={{
                                                  opacity: chipDragging ? 0.35 : 1,
                                                  boxShadow: chipDropBefore ? '-3px 0 0 0 #fb923c' : chipDropAfter ? '3px 0 0 0 #fb923c' : undefined,
                                                  transition: 'box-shadow 80ms, opacity 80ms',
                                                }}
                                                className="group/chip flex items-center gap-1 rounded border border-[#fb923c]/30 bg-[#fb923c]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#fdba74] select-none cursor-grab active:cursor-grabbing transition-all hover:border-[#fb923c]/60">
                                                <GripVertical className="h-2.5 w-2.5 opacity-30 shrink-0" />
                                                {item.name}
                                                <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                <span role="button" title="Delete equipment"
                                                  onClick={e => { e.stopPropagation(); handleDeleteEquipment(item.id, item.name); }}
                                                  className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-red-400 cursor-pointer leading-none">
                                                  <Trash2 className="h-2.5 w-2.5" />
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                        {/* Add Equipment inline trigger */}
                                        <button type="button" onClick={() => { setAddEquipmentCatId(cat.id); setAddEqRankDropOpen(false); setNewEquipmentForm({ name: '', restrictToRanks: '', restrictToDivisions: [], notes: '', imageUrl: '' }); }}
                                          className="flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#fb923c]/40 hover:text-[#fb923c] transition-colors shrink-0">
                                          <Plus className="h-3 w-3" />Add Equipment
                                        </button>
                                        {/* Row actions */}
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                                          <button type="button" title="Rename" onClick={() => { setEditingEqCategoryId(cat.id); setEditingEqCategoryName(cat.name); }}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-[#fb923c] transition-colors">
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move up" onClick={() => handleMoveEqCategory(cat.id, 'up')} disabled={i === 0}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronUp className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move down" onClick={() => handleMoveEqCategory(cat.id, 'down')} disabled={i === equipmentCategories.length - 1}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronDown className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Delete title" onClick={() => handleDeleteEqCategory(cat.id, cat.name)}
                                            className="rounded p-1 text-[#3f5470] hover:bg-red-500/10 hover:text-red-400 transition-colors">
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {/* New title inline form */}
                              {addEqCategoryOpen && (
                                <div className="flex items-center gap-2 px-6 py-3 bg-[#060c18]">
                                  <input autoFocus type="text" placeholder="Title name…"
                                    value={newEqCategoryName} onChange={e => setNewEqCategoryName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddEqCategory(); if (e.key === 'Escape') setAddEqCategoryOpen(false); }}
                                    className="flex-1 h-8 rounded border border-[#fb923c]/30 bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#fb923c]/60" />
                                  <button type="button" onClick={handleAddEqCategory} disabled={addingEqCategory || !newEqCategoryName.trim()}
                                    className="rounded border border-[#fb923c]/40 bg-[#fb923c]/10 px-3 py-1.5 text-[10px] font-black text-[#fb923c] hover:bg-[#fb923c]/20 transition-colors disabled:opacity-40">
                                    {addingEqCategory ? 'Creating…' : 'Create'}
                                  </button>
                                  <button type="button" onClick={() => setAddEqCategoryOpen(false)}
                                    className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {equipmentCategories.length === 0 && !addEqCategoryOpen && !eqCategoriesLoading && (
                        <div className="border-b border-[#131f30] px-6 py-4 flex items-center gap-3">
                          <span className="text-xs text-[#3f5470]">No titles yet.</span>
                          <button type="button" onClick={() => { setAddEqCategoryOpen(true); setNewEqCategoryName(''); }}
                            className="text-xs font-black text-[#fb923c] hover:underline">Add your first title →</button>
                        </div>
                      )}

                      {/* Equipment list */}
                      {equipment.length > 0 && (
                        <div className="border-t border-[#131f30]">
                          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                            <Package className="h-3.5 w-3.5 text-[#3f5470]" />
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Equipment</span>
                            <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{equipment.length}</span>
                          </div>
                        </div>
                      )}

                      {filteredEquipment.length === 0 ? (
                        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2">
                          <Package className="h-8 w-8 text-[#1e2e42]" />
                          <p className="text-sm font-bold text-[#3f5470]">No equipment found.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-[#131f30]">
                                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Equipment</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Title</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Who Can Use</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredEquipment.map(item => (
                                <tr key={item.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                  <td className="px-5 py-3.5 font-black text-white">{item.name}</td>
                                  <td className="px-4 py-3.5 text-[#526179]">{item.category}</td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex flex-wrap gap-1">
                                      {item.who_can_use.length > 0
                                        ? item.who_can_use.map(r => { const ins = ranks.find(x => x.name.toLowerCase() === r.toLowerCase())?.insignia_url; return <span key={r} className="inline-flex items-center gap-1 rounded border border-[#fb923c]/30 bg-[#fb923c]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#fdba74]">{ins && <img src={ins} alt="" className="h-3 w-3 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}{r}</span>; })
                                        : <span className="text-[#2a3a50]">—</span>}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex items-center justify-end gap-2">
                                      <button type="button" onClick={() => setEditEquipmentItem(item)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#fb923c]/40 hover:text-white transition-colors">
                                        <Pencil className="h-3 w-3" />Edit
                                      </button>
                                      <button type="button" onClick={() => handleDeleteEquipment(item.id, item.name)}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-black text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors">
                                        <Trash2 className="h-3 w-3" />Remove
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}

                {/* ── Resources section ─────────────────────────────────────────── */}
                {panelSection === 'resources' && (
                  <div className="space-y-6">
                    <button type="button" onClick={() => setPanelSection(null)}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#34d399] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Department Panel
                      <span className="text-[#2a3a50]">/</span>
                      <span className="text-[#34d399]">Resources</span>
                    </button>

                    <div className="relative rounded-2xl border border-[#34d399]/20 bg-[#070d16] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#34d399]/40 to-transparent" />

                      <div className="flex items-center justify-between border-b border-[#131f30] px-8 py-5">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#34d399]">Resources</h3>
                          <p className="mt-1 text-xs text-[#526179]">Publish guides, reference documents, and department materials for members.</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleClearAllPermissionGrants()}
                            disabled={clearingPermissionGrants}
                            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-xs font-black text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            {clearingPermissionGrants ? 'Removing…' : 'Remove Everyones Permissions'}
                          </button>
                          <button type="button"
                            onClick={() => {
                              resetAddResourceDialog();
                              setResourceTargetDivisionId(null);
                              setAddResourceStep(1);
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-[#34d399]/30 bg-[#34d399]/8 px-3 py-2 text-xs font-black text-[#34d399] hover:bg-[#34d399]/15 transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                            Add Resource
                          </button>
                        </div>
                      </div>

                      {resources.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-4 px-8 py-20 text-center">
                          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#34d399]/20 bg-[#34d399]/8">
                            <BookOpen className="h-8 w-8 text-[#34d399]/60" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-[#526179]">No resources posted</p>
                            <p className="mt-1 text-xs text-[#3f5470]">Add your first resource to make it visible to department members.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="divide-y divide-[#172235]">
                          {resources.map(r => (
                            <div key={r.id} className="flex items-center gap-4 px-8 py-4">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#34d399]/20 bg-[#34d399]/8">
                                <FileText className="h-4 w-4 text-[#34d399]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-sm font-black text-white">{r.title}</p>
                                <p className="text-[10px] text-[#3f5470]">
                                  {r.type === 'pdf' ? 'PDF' : 'Document'} · Updated {new Date(r.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </p>
                                {(r.personnel_only || (Array.isArray(r.allowed_dps_ranks) && r.allowed_dps_ranks.length > 0) || r.division_only) && (
                                  <p className="mt-1 text-[10px] font-semibold text-[#7c8ba5]">
                                    {r.division_only ? 'Division only' : null}
                                    {r.personnel_only || (Array.isArray(r.allowed_dps_ranks) && r.allowed_dps_ranks.length > 0) ? (r.division_only ? ' · ' : '') + 'DPS personnel' : null}
                                    {Array.isArray(r.allowed_dps_ranks) && r.allowed_dps_ranks.length > 0
                                      ? ` · Ranks: ${r.allowed_dps_ranks.join(', ')}`
                                      : null}
                                  </p>
                                )}
                              </div>
                              <button type="button"
                                onClick={() => handleOpenResource(r, true)}
                                className="flex items-center gap-1 rounded-lg border border-[#34d399]/30 bg-[#34d399]/8 px-3 py-1.5 text-[11px] font-black text-[#34d399] hover:bg-[#34d399]/15 transition-colors">
                                {r.type === 'pdf' ? <BookOpen className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                                {r.type === 'pdf' ? 'View' : 'Edit'}
                              </button>
                              <button type="button"
                                onClick={() => handleDeleteResource(r.id)}
                                disabled={deletingResourceId === r.id}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/8 text-red-400 hover:bg-red-500/15 disabled:opacity-40 transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {panelSection === 'calendar' && (
                  <div className="space-y-6">
                    {/* Back breadcrumb */}
                    <button type="button" onClick={() => { setPanelSection(null); setShowEventForm(false); setEditingEvent(null); }}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#a78bfa] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Back
                      <span className="text-[#a78bfa]">Event Calendar</span>
                    </button>

                    {/* Main card */}
                    <div className="relative rounded-2xl border border-[#a78bfa]/20 bg-[#070d16] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#a78bfa]/40 to-transparent" />

                      {/* Card header */}
                      <div className="flex items-center justify-between border-b border-[#131f30] px-8 py-5">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#a78bfa]">Event Calendar</h3>
                          <p className="mt-1 text-xs text-[#526179]">Schedule and manage department events, training sessions, and operations.</p>
                        </div>
                        {!showEventForm && !editingEvent && (
                          <button type="button"
                            onClick={() => {
                              setShowEventForm(true);
                              setEventForm({
                                title: '', event_date: '', event_time: '', location: '', purpose: '',
                                hosted_by: session?.username ?? '',
                                hosting_department: 'Department of Public Safety',
                                is_public: false,
                              });
                            }}
                            className="flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/8 px-3 py-2 text-xs font-black text-[#a78bfa] hover:bg-[#a78bfa]/15 transition-colors">
                            <Plus className="h-3.5 w-3.5" />
                            Add Event
                          </button>
                        )}
                      </div>

                      {/* Add / Edit form */}
                      {(showEventForm || editingEvent) && (
                        <div className="border-b border-[#131f30] px-8 py-6">
                          <p className="mb-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#a78bfa]">
                            {editingEvent ? 'Edit Event' : 'New Event'}
                          </p>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <label className={labelCls}>Event Title <span className="text-[#ff5d5d]">*</span></label>
                              <input type="text" value={eventForm.title} placeholder="e.g. Department Training Session"
                                onChange={e => setEventForm(p => ({ ...p, title: e.target.value }))}
                                className={inputCls} />
                            </div>
                            <div>
                              <label className={labelCls}>Date <span className="text-[#ff5d5d]">*</span></label>
                              <input type="date" value={eventForm.event_date}
                                onChange={e => setEventForm(p => ({ ...p, event_date: e.target.value }))}
                                className={inputCls + ' cursor-pointer'} />
                            </div>
                            <div>
                              <label className={labelCls}>Time</label>
                              <input type="time" value={eventForm.event_time}
                                onChange={e => setEventForm(p => ({ ...p, event_time: e.target.value }))}
                                className={inputCls + ' cursor-pointer'} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={labelCls}>Where will the event take place?</label>
                              <input type="text" value={eventForm.location} placeholder="e.g. DPS HQ, Training Grounds, Online"
                                onChange={e => setEventForm(p => ({ ...p, location: e.target.value }))}
                                className={inputCls} />
                            </div>
                            <div>
                              <label className={labelCls}>Hosted by</label>
                              <input type="text" value={eventForm.hosted_by} placeholder="Host name"
                                onChange={e => setEventForm(p => ({ ...p, hosted_by: e.target.value }))}
                                className={inputCls} />
                            </div>
                            <div>
                              <label className={labelCls}>Hosting department</label>
                              <input type="text" value={eventForm.hosting_department} placeholder="Department of Public Safety"
                                onChange={e => setEventForm(p => ({ ...p, hosting_department: e.target.value }))}
                                className={inputCls} />
                            </div>
                            <div className="sm:col-span-2">
                              <label className={labelCls}>What is the event for?</label>
                              <textarea value={eventForm.purpose} rows={3}
                                placeholder="Describe the event's purpose, agenda, or any relevant details…"
                                onChange={e => setEventForm(p => ({ ...p, purpose: e.target.value }))}
                                className="w-full resize-none rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                            </div>
                            <div className="sm:col-span-2">
                              <button
                                type="button"
                                onClick={() => setEventForm(p => ({ ...p, is_public: !p.is_public }))}
                                className={`flex items-center gap-3 rounded-lg border px-4 py-3 w-full text-left transition-colors ${
                                  eventForm.is_public
                                    ? 'border-[#a78bfa]/40 bg-[#a78bfa]/8'
                                    : 'border-[#1f3050] bg-[#07111f] hover:border-[#2f4060]'
                                }`}
                              >
                                <div className={`relative h-4 w-7 rounded-full transition-colors ${eventForm.is_public ? 'bg-[#a78bfa]' : 'bg-[#1f3050]'}`}>
                                  <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${eventForm.is_public ? 'translate-x-3' : 'translate-x-0.5'}`} />
                                </div>
                                <div>
                                  <p className={`text-xs font-black ${eventForm.is_public ? 'text-[#a78bfa]' : 'text-[#526179]'}`}>
                                    {eventForm.is_public ? 'Public Event' : 'Internal Event'}
                                  </p>
                                  <p className="text-[10px] text-[#3f5470]">
                                    {eventForm.is_public
                                      ? 'Visible on the public website under "Public Events"'
                                      : 'Only visible to department members in the CAD'}
                                  </p>
                                </div>
                              </button>
                            </div>
                          </div>
                          <div className="mt-4 flex gap-2">
                            <button type="button"
                              disabled={savingEvent || !eventForm.title.trim() || !eventForm.event_date}
                              onClick={async () => {
                                setSavingEvent(true);
                                try {
                                  const url = editingEvent ? `/api/roster/events/${editingEvent.id}` : '/api/roster/events';
                                  const r = await fetch(url, {
                                    method: editingEvent ? 'PATCH' : 'POST',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify(eventForm),
                                  });
                                  if (!r.ok) throw new Error();
                                  toast.success(editingEvent ? 'Event updated.' : 'Event added.');
                                  setShowEventForm(false); setEditingEvent(null);
                                  fetchEvents();
                                } catch { toast.error('Failed to save event.'); }
                                finally { setSavingEvent(false); }
                              }}
                              className="flex items-center gap-1.5 rounded-lg bg-[#a78bfa] px-4 py-2 text-xs font-black text-[#0d1422] hover:bg-[#c4b5fd] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                              {savingEvent ? 'Saving…' : (editingEvent ? 'Save Changes' : 'Add Event')}
                            </button>
                            <button type="button"
                              onClick={() => { setShowEventForm(false); setEditingEvent(null); }}
                              className="rounded-lg border border-[#1e2d42] px-4 py-2 text-xs font-black text-[#526179] hover:text-white hover:border-[#2f4060] transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Events list */}
                      <div className="divide-y divide-[#0f1b28]">
                        {events.length === 0 ? (
                          <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
                            <CalendarDays className="h-8 w-8 text-[#a78bfa]/30" />
                            <p className="text-sm font-black text-[#526179]">No events yet</p>
                            <p className="text-xs text-[#3f5470]">Click "Add Event" to schedule your first event.</p>
                          </div>
                        ) : (
                          events.map(ev => {
                            const dateObj = new Date(ev.event_date + 'T12:00:00');
                            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                            const timeStr = ev.event_time
                              ? new Date(`1970-01-01T${ev.event_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                              : null;
                            return (
                              <div key={ev.id} className="flex items-start gap-4 px-8 py-4 hover:bg-white/[0.02] transition-colors">
                                <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border border-[#a78bfa]/20 bg-[#a78bfa]/8 text-center">
                                  <span className="text-[8px] font-black uppercase text-[#a78bfa]">
                                    {dateObj.toLocaleDateString('en-US', { month: 'short' })}
                                  </span>
                                  <span className="text-sm font-black leading-none text-white">{dateObj.getDate()}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-black text-white">{ev.title}</p>
                                    {ev.is_public
                                      ? <span className="rounded-full border border-[#a78bfa]/30 bg-[#a78bfa]/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#a78bfa]">Public</span>
                                      : <span className="rounded-full border border-[#1f3050] bg-[#0d1a28] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#3f5470]">Internal</span>
                                    }
                                  </div>
                                  <p className="mt-0.5 text-[10px] text-[#526179]">{dateStr}{timeStr ? ` · ${timeStr}` : ''}</p>
                                  {(ev.hosted_by || ev.hosting_department) && (
                                    <p className="mt-0.5 text-[10px] text-[#526179]">
                                      {ev.hosted_by ? `Hosted by ${ev.hosted_by}` : 'Hosted event'}
                                      {ev.hosting_department ? ` · ${ev.hosting_department}` : ''}
                                    </p>
                                  )}
                                  {ev.location && <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#3f5470]"><MapPin className="h-2.5 w-2.5 shrink-0" />{ev.location}</p>}
                                  {ev.purpose && <p className="mt-1 text-[10px] text-[#526179] leading-relaxed line-clamp-2">{ev.purpose}</p>}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button type="button"
                                    onClick={() => {
                                      setEditingEvent(ev);
                                      setShowEventForm(false);
                                      setEventForm({
                                        title: ev.title,
                                        event_date: ev.event_date,
                                        event_time: ev.event_time ?? '',
                                        location: ev.location ?? '',
                                        purpose: ev.purpose ?? '',
                                        hosted_by: ev.hosted_by ?? '',
                                        hosting_department: ev.hosting_department ?? 'Department of Public Safety',
                                        is_public: ev.is_public,
                                      });
                                    }}
                                    className="rounded-md p-1.5 text-[#526179] hover:bg-white/5 hover:text-[#a78bfa] transition-colors">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button"
                                    disabled={deletingEventId === ev.id}
                                    onClick={async () => {
                                      if (!confirm(`Delete "${ev.title}"?`)) return;
                                      setDeletingEventId(ev.id);
                                      try {
                                        const r = await fetch(`/api/roster/events/${ev.id}`, { method: 'DELETE' });
                                        if (!r.ok) throw new Error();
                                        toast.success('Event deleted.');
                                        fetchEvents();
                                      } catch { toast.error('Failed to delete event.'); }
                                      finally { setDeletingEventId(null); }
                                    }}
                                    className="rounded-md p-1.5 text-[#526179] hover:bg-red-900/20 hover:text-red-400 disabled:opacity-50 transition-colors">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Information section ──────────────────────────────────────── */}
                {panelSection === 'information' && (
                  <div className="space-y-6">
                    {/* Back breadcrumb */}
                    <button type="button" onClick={() => { setPanelSection(null); setInfoSubSection(null); }}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#22d3ee] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Department Panel
                      <span className="text-[#2a3a50]">/</span>
                      <span className="text-[#22d3ee]">
                        {infoSubSection === 'index' ? 'Index Page Info' : infoSubSection === 'page' ? 'DPS Page Info' : 'Department Information'}
                      </span>
                    </button>

                    {/* Sub-picker */}
                    {infoSubSection === null && (
                      <div className="grid gap-5 sm:grid-cols-2">
                        {/* Index Page Info card */}
                        <div className="relative rounded-2xl border border-[#22d3ee]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/40 to-transparent" />
                          <div className="mb-5 flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/8">
                              <Globe className="h-6 w-6 text-[#22d3ee]" />
                            </div>
                            <div>
                              <h3 className="text-base font-black text-white">Index Page Info</h3>
                              <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                                Edit the DPS description and sub-departments shown publicly on the Departments tab. Divisions are taken live from Division Roster.
                              </p>
                            </div>
                          </div>
                          <button type="button"
                            onClick={() => setInfoSubSection('index')}
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/8 py-3 text-xs font-black text-[#22d3ee] transition-all hover:bg-[#22d3ee]/15">
                            <Pencil className="h-3.5 w-3.5" />
                            Edit Index Page Info
                          </button>
                        </div>

                        {/* DPS Page Info card */}
                        <div className="relative rounded-2xl border border-[#22d3ee]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/40 to-transparent" />
                          <div className="mb-5 flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/8">
                              <FileText className="h-6 w-6 text-[#22d3ee]" />
                            </div>
                            <div>
                              <h3 className="text-base font-black text-white">DPS Page Info</h3>
                              <p className="mt-1 text-xs text-[#526179] leading-relaxed">
                                Edit the sections shown in the Information tab on the DPS portal for logged-in members.
                              </p>
                            </div>
                          </div>
                          <button type="button"
                            onClick={() => setInfoSubSection('page')}
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/8 py-3 text-xs font-black text-[#22d3ee] transition-all hover:bg-[#22d3ee]/15">
                            <Pencil className="h-3.5 w-3.5" />
                            Edit DPS Page Info
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Edit Index Page Info ──────────────────────────────────── */}
                    {infoSubSection === 'index' && (
                      <div className="relative rounded-2xl border border-[#22d3ee]/20 bg-[#070d16] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/40 to-transparent" />
                        <div className="flex items-center justify-between border-b border-[#131f30] px-8 py-5">
                          <div>
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#22d3ee]">Index Page Info</h3>
                            <p className="mt-1 text-xs text-[#526179]">Shown publicly on the Departments tab of the index page.</p>
                          </div>
                          <button type="button" onClick={() => setInfoSubSection(null)}
                            className="text-xs font-black text-[#526179] hover:text-white transition-colors">← Back</button>
                        </div>
                        <div className="space-y-5 px-8 py-6">
                          <div>
                            <label className={labelCls}>Department Description</label>
                            <textarea value={indexInfoForm.description} rows={4}
                              placeholder="A brief overview of the Department of Public Safety…"
                              onChange={e => setIndexInfoForm(p => ({ ...p, description: e.target.value }))}
                              className="w-full resize-none rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]" />
                          </div>
                          <div>
                            <label className={labelCls}>Department Divisions</label>
                            <div className="rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-3">
                              {rosterDivisions.length === 0 ? (
                                <p className="text-xs text-[#3f5470]">
                                  No divisions yet — add them under Department Panel → Division Roster.
                                </p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {[...rosterDivisions]
                                    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                                    .map(d => (
                                      <li key={d.id} className="flex items-center gap-2 text-xs font-semibold text-[#a8b7cd]">
                                        <span className="h-1 w-1 rounded-full bg-[#22d3ee]" />
                                        {d.name}
                                        {d.unit_key?.trim() ? (
                                          <span className="text-[10px] font-black uppercase tracking-wider text-[#3f5470]">
                                            ({d.unit_key.trim().toUpperCase()})
                                          </span>
                                        ) : null}
                                      </li>
                                    ))}
                                </ul>
                              )}
                              <p className="mt-2 text-[10px] text-[#3f5470]">
                                Updated automatically from Division Roster — shown live on the index Departments tab.
                              </p>
                            </div>
                          </div>
                          <div>
                            <div className="mb-3 flex items-center justify-between">
                              <label className={labelCls}>Sub-Departments</label>
                              <button type="button"
                                onClick={() => setIndexInfoForm(p => ({ ...p, sub_departments: [...p.sub_departments, { name: '', description: '' }] }))}
                                className="flex items-center gap-1 text-[10px] font-black text-[#22d3ee] hover:text-[#67e8f9] transition-colors">
                                <Plus className="h-3 w-3" /> Add
                              </button>
                            </div>
                            <div className="space-y-3">
                              {indexInfoForm.sub_departments.map((sd, i) => (
                                <div key={i} className="relative rounded-lg border border-[#1f3050] bg-[#07111f] p-4">
                                  {indexInfoForm.sub_departments.length > 1 && (
                                    <button type="button"
                                      onClick={() => setIndexInfoForm(p => ({ ...p, sub_departments: p.sub_departments.filter((_, j) => j !== i) }))}
                                      className="absolute right-3 top-3 rounded p-0.5 text-[#526179] hover:text-red-400 transition-colors">
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                  <input type="text" value={sd.name} placeholder="Sub-department name"
                                    onChange={e => setIndexInfoForm(p => ({ ...p, sub_departments: p.sub_departments.map((s, j) => j === i ? { ...s, name: e.target.value } : s) }))}
                                    className="mb-2 w-full rounded border border-[#1f3050] bg-[#0a1520] px-3 py-1.5 text-xs font-black text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]" />
                                  <textarea value={sd.description} rows={2} placeholder="Brief description…"
                                    onChange={e => setIndexInfoForm(p => ({ ...p, sub_departments: p.sub_departments.map((s, j) => j === i ? { ...s, description: e.target.value } : s) }))}
                                    className="w-full resize-none rounded border border-[#1f3050] bg-[#0a1520] px-3 py-1.5 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#22d3ee]" />
                                </div>
                              ))}
                            </div>
                          </div>
                          <button type="button"
                            disabled={savingInfo || !indexInfoForm.description.trim()}
                            onClick={async () => {
                              setSavingInfo(true);
                              try {
                                const divisions = [...rosterDivisions]
                                  .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                                  .map(d => {
                                    const key = (d.unit_key ?? '').trim().toUpperCase();
                                    return key ? `${d.name} (${key})` : d.name;
                                  });
                                const sub_departments = indexInfoForm.sub_departments.filter((s: {name:string;description:string}) => s.name.trim());
                                const r = await fetch('/api/roster/content/index_info', {
                                  method: 'PUT', headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ description: indexInfoForm.description.trim(), divisions, sub_departments }),
                                });
                                if (!r.ok) throw new Error();
                                toast.success('Index page info saved.');
                              } catch { toast.error('Failed to save.'); }
                              finally { setSavingInfo(false); }
                            }}
                            className="flex items-center gap-1.5 rounded-lg bg-[#22d3ee] px-5 py-2 text-xs font-black text-[#0d1422] hover:bg-[#67e8f9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            {savingInfo ? 'Saving…' : 'Save Index Info'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Edit DPS Page Info ────────────────────────────────────── */}
                    {infoSubSection === 'page' && (
                      <div className="relative rounded-2xl border border-[#22d3ee]/20 bg-[#070d16] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#22d3ee]/40 to-transparent" />
                        <div className="flex items-center justify-between border-b border-[#131f30] px-8 py-5">
                          <div>
                            <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#22d3ee]">DPS Page Info</h3>
                            <p className="mt-1 text-xs text-[#526179]">Shown in the Information tab of the DPS portal for logged-in members.</p>
                          </div>
                          <button type="button" onClick={() => setInfoSubSection(null)}
                            className="text-xs font-black text-[#526179] hover:text-white transition-colors">← Back</button>
                        </div>
                        {(
                          <div className="space-y-4 px-8 py-6">
                            {/* Block list */}
                            <ContentBlocksEditor
                              sections={pageInfoSections as ContentBlock[]}
                              onChange={next => setPageInfoSections(next as PageBlock[])}
                              accent="#22d3ee"
                            />

                            {/* Save */}
                            <button type="button"
                              disabled={savingInfo || pageInfoSections.length === 0}
                              onClick={async () => {
                                setSavingInfo(true);
                                try {
                                  const r = await fetch('/api/roster/content/page_info', {
                                    method: 'PUT', headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ sections: pageInfoSections }),
                                  });
                                  if (!r.ok) throw new Error();
                                  setPageInfo({ sections: pageInfoSections });
                                  toast.success('DPS page info saved.');
                                } catch { toast.error('Failed to save.'); }
                                finally { setSavingInfo(false); }
                              }}
                              className="flex items-center gap-1.5 rounded-lg bg-[#22d3ee] px-5 py-2 text-xs font-black text-[#0d1422] hover:bg-[#67e8f9] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                              {savingInfo ? 'Saving…' : 'Save DPS Page Info'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

              </>
            )}

            </>
            )}

          </div>
        </section>
      </div>
    </main>

      {/* ── Document Editor overlay ──────────────────────────────────────────── */}
      {openDocId !== null && (
        <DocumentEditor
          key={`${openDocId}-${openDocCanEdit ? 'edit' : 'view'}`}
          resourceId={openDocId}
          canEdit={openDocCanEdit}
          onClose={() => {
            setOpenDocId(null);
            setOpenDocCanEdit(false);
            fetchResources();
          }}
        />
      )}

      {/* ── PDF resource viewer overlay ─────────────────────────────────────── */}
      {openPdf !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85">
          <div className="flex items-center justify-between border-b border-[#1e2d42] bg-[#070d16] px-5 py-3">
            <p className="truncate text-sm font-black text-white">{openPdf.title}</p>
            <button type="button" onClick={() => setOpenPdf(null)}
              className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <PdfViewer
            fileUrl={`/api/resources/${openPdf.id}/file`}
            downloadName={`${openPdf.title}.pdf`}
          />
        </div>
      )}

      {/* ── Add Resource dialog — Step 1: Name ──────────────────────────────── */}
      {addResourceStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-white">New Resource</h3>
                <p className="mt-0.5 text-xs text-[#526179]">Step 1 of 2 — Name your resource</p>
              </div>
              <button type="button" onClick={resetAddResourceDialog}
                className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">
                  Resource Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newResourceName}
                  onChange={e => setNewResourceName(e.target.value)}
                  placeholder="e.g. Officer Handbook, Use of Force Policy"
                  className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                  onKeyDown={e => { if (e.key === 'Enter' && newResourceName.trim()) setAddResourceStep(2); }}
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={resetAddResourceDialog}
                  className="flex-1 h-10 rounded-lg border border-[#1e2d42] text-xs font-bold text-[#a8b7cd] hover:bg-white/5">
                  Cancel
                </button>
                <button type="button"
                  disabled={!newResourceName.trim()}
                  onClick={() => setAddResourceStep(2)}
                  className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-40">
                  Next →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Resource dialog — Step 2: Type ──────────────────────────────── */}
      {addResourceStep === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-white">New Resource</h3>
                <p className="mt-0.5 text-xs text-[#526179]">Step 2 of 2 — Type & visibility</p>
              </div>
              <button type="button" onClick={resetAddResourceDialog}
                className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Resource type cards */}
            <div className="mb-5 space-y-3">
              {/* Document card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setNewResourceType('document')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setNewResourceType('document'); }}
                className={`group relative flex cursor-pointer items-start gap-4 rounded-xl border-2 p-4 transition-colors ${newResourceType === 'document' ? 'border-[#2f66ee] bg-[#2f66ee]/8 ring-2 ring-[#2f66ee]/30' : 'border-[#1e2d42] hover:border-[#2f66ee]/50'}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#2f66ee]/30 bg-[#2f66ee]/15">
                  <FileText className="h-5 w-5 text-[#2f66ee]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white">Document</p>
                  <p className="mt-0.5 text-xs text-[#526179]">A rich-text document you can write, format, and publish to department members.</p>
                </div>
                <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${newResourceType === 'document' ? 'border-[#2f66ee] bg-[#2f66ee]' : 'border-[#3f5470]'}`}>
                  {newResourceType === 'document' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                </div>
              </div>

              {/* File upload card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setNewResourceType('file')}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setNewResourceType('file'); }}
                className={`group relative flex cursor-pointer items-start gap-4 rounded-xl border-2 p-4 transition-colors ${newResourceType === 'file' ? 'border-[#34d399] bg-[#34d399]/8 ring-2 ring-[#34d399]/30' : 'border-[#1e2d42] hover:border-[#34d399]/50'}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#34d399]/30 bg-[#34d399]/15">
                  <BookOpen className="h-5 w-5 text-[#34d399]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white">File Upload</p>
                  <p className="mt-0.5 text-xs text-[#526179]">Upload PDF or Word Document (.pdf, .docx). Word documents are automatically converted to PDF.</p>
                </div>
                <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${newResourceType === 'file' ? 'border-[#34d399] bg-[#34d399]' : 'border-[#3f5470]'}`}>
                  {newResourceType === 'file' && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                </div>
              </div>

              {/* File picker — shown when File Upload is selected */}
              {newResourceType === 'file' && (
                <div className="space-y-2">
                  <label className="flex h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#2a3b56] bg-[#07111f] px-3 text-xs font-bold text-[#a8b7cd] hover:border-[#34d399]/60">
                    <input
                      type="file"
                      accept=".pdf,.docx"
                      className="hidden"
                      onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                    />
                    <FileText className="h-4 w-4 shrink-0 text-[#34d399]" />
                    <span className="truncate">{uploadFile ? uploadFile.name : 'Choose a file… (Supported formats: PDF, DOCX)'}</span>
                  </label>
                  {uploadFile?.name.toLowerCase().endsWith('.docx') && (
                    <p className="text-[11px] text-[#5a7290]">This document will automatically be converted to PDF.</p>
                  )}
                </div>
              )}
            </div>

            {resourceTargetDivisionId != null && (() => {
              const ranks = divisionRanksForEdit
                .filter(r => r.division_id === resourceTargetDivisionId)
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name));
              return (
                <div className="mb-5 space-y-4 rounded-xl border border-[#1e2d42] bg-[#07111f] p-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Visibility</p>
                    <label className="mt-2 flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={newResourceDivisionOnly}
                        onChange={e => setNewResourceDivisionOnly(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-[#2a3b56] bg-[#070d16] text-[#2f66ee] focus:ring-[#2f66ee]"
                      />
                      <span>
                        <span className="block text-sm font-bold text-white">Division only</span>
                        <span className="mt-0.5 block text-xs text-[#526179]">
                          Still appears on the Resources tab, but only members of this division can see it.
                        </span>
                      </span>
                    </label>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Rank restriction</p>
                    <p className="mt-1 text-xs text-[#526179]">
                      Leave all unchecked to allow every rank in this division. Check ranks to limit who can see it.
                    </p>
                    {ranks.length === 0 ? (
                      <p className="mt-2 text-xs text-[#3f5470]">No ranks configured for this division yet.</p>
                    ) : (
                      <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                        {ranks.map(rank => {
                          const checked = newResourceAllowedRanks.some(
                            n => n.toLowerCase() === rank.name.toLowerCase()
                          );
                          return (
                            <label
                              key={rank.id}
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setNewResourceAllowedRanks(prev => {
                                    if (checked) {
                                      return prev.filter(n => n.toLowerCase() !== rank.name.toLowerCase());
                                    }
                                    return [...prev, rank.name];
                                  });
                                }}
                                className="h-3.5 w-3.5 rounded border-[#2a3b56] bg-[#070d16] text-[#2f66ee] focus:ring-[#2f66ee]"
                              />
                              <span className="text-xs font-semibold text-[#c5d0e0]">{rank.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {resourceTargetDivisionId == null && (
              <div className="mb-5 space-y-4 rounded-xl border border-[#1e2d42] bg-[#07111f] p-4">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Visibility</p>
                  <label className="mt-2 flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={newResourcePersonnelOnly || newResourceAllowedDpsRanks.length > 0}
                      onChange={e => {
                        const on = e.target.checked;
                        setNewResourcePersonnelOnly(on);
                        if (!on) setNewResourceAllowedDpsRanks([]);
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-[#2a3b56] bg-[#070d16] text-[#2f66ee] focus:ring-[#2f66ee]"
                    />
                    <span>
                      <span className="block text-sm font-bold text-white">DPS personnel only</span>
                      <span className="mt-0.5 block text-xs text-[#526179]">
                        Hide from the public site — only Department of Public Safety personnel can see it.
                      </span>
                    </span>
                  </label>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470]">Rank restriction</p>
                  <p className="mt-1 text-xs text-[#526179]">
                    Leave all unchecked to allow every DPS rank. Check ranks to limit who can see it.
                  </p>
                  {ranks.length === 0 ? (
                    <p className="mt-2 text-xs text-[#3f5470]">No DPS ranks configured yet.</p>
                  ) : (
                    <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                      {[...ranks]
                        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
                        .map(rank => {
                          const checked = newResourceAllowedDpsRanks.some(
                            n => n.toLowerCase() === rank.name.toLowerCase()
                          );
                          return (
                            <label
                              key={rank.id}
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setNewResourceAllowedDpsRanks(prev => {
                                    if (checked) {
                                      return prev.filter(n => n.toLowerCase() !== rank.name.toLowerCase());
                                    }
                                    setNewResourcePersonnelOnly(true);
                                    return [...prev, rank.name];
                                  });
                                }}
                                className="h-3.5 w-3.5 rounded border-[#2a3b56] bg-[#070d16] text-[#2f66ee] focus:ring-[#2f66ee]"
                              />
                              <span className="text-xs font-semibold text-[#c5d0e0]">{rank.name}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setAddResourceStep(1)}
                className="flex-1 h-10 rounded-lg border border-[#1e2d42] text-xs font-bold text-[#a8b7cd] hover:bg-white/5">
                ← Back
              </button>
              <button type="button"
                disabled={creatingResource || (newResourceType === 'file' && !uploadFile)}
                onClick={newResourceType === 'file' ? handleUploadResource : handleCreateResource}
                className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-40">
                {creatingResource
                  ? (uploadStatus ?? 'Creating…')
                  : newResourceType === 'file' ? 'Upload →' : 'Create & Edit →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DepartmentOfPublicSafety;
