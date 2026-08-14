import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  nestedPortalSectionPath,
  parseNestedPortalSection,
  portalSectionPath,
  usePortalSection,
} from '@/hooks/usePortalSection';
import { BookOpen, Car, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair, ExternalLink, FileText, GripVertical, Image as ImageIcon, Info, Link, Lock, LogOut, Megaphone, Monitor, Pencil, Plus, RefreshCw, Scale, Search, Settings, Shield, ShoppingBag, Terminal as TerminalIcon, Trash2, Upload, User, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import DocumentEditor from '@/components/editor/DocumentEditor';
import PdfViewer from '@/components/shared/PdfViewer';
import StoreProductCard, { type StorePriceIcon, type StoreProduct } from '@/components/shared/StoreProductCard';
import StoreDescriptionEditor from '@/components/shared/StoreDescriptionEditor';
import { ContentBlocksEditor, renderContentBlocks, type ContentBlock } from '@/components/shared/ContentBlocks';
import { removeCadLocalAccountsByIds } from '@/lib/cad-local-accounts';
import { clearCadSession, getCadSession, setCadSession, type CadSession } from '@/lib/cad-session';
import {
  DEFAULT_PRIVACY_SECTIONS,
  DEFAULT_TERMS_SECTIONS,
  resolveLegalSections,
} from '@/lib/legal-defaults';
import { isSuperAdminSession } from '@/lib/superadmin';
import { getStaffRosterTitle, getStaffSidebarTitle } from '@/lib/display-rank';
import { sortByRankThenUsername } from '@/lib/roster-sort';
import { collectStaffWebsitePermissions } from '@/lib/permission-access';
import { PermissionAccessOverview, type PermissionAccessOverviewRow } from '@/components/shared/PermissionAccessOverview';
import { cadModeLabel, type CadMode } from '@/hooks/useCadStatus';

type StoreProductRow = StoreProduct & { id: number; sort_order?: number | null; created_at?: string };

const EMPTY_STORE_PRODUCT: StoreProduct = {
  badge_label: '',
  heading: '',
  description: '',
  price: '',
  price_label: '',
  price_icon: 'robux',
  price_icon_url: '',
  footer_text: '',
  button_text: '',
  button_url: '',
  image_url: '',
};

type AdminMember = {
  id: number;
  auth_user_id: string | null;
  username: string;
  discord_username: string;
  discord_id: string;
  email: string;
  community_code: string;
  status: string;
  /** Legacy fields */
  rank: string;
  role: string;
  /** Separated fields */
  dps_rank:   string | null;
  dps_role:   string | null;
  staff_rank: string | null;
  staff_role: string | null;
  whitelisted: boolean;
  avatar_hash: string | null;
  created_at: string;
  updated_at: string;
};

type EditMemberForm = Pick<
  AdminMember,
  'auth_user_id' | 'username' | 'discord_username' | 'discord_id' | 'email' | 'community_code' | 'status' | 'rank' | 'role' | 'dps_rank' | 'dps_role' | 'staff_rank' | 'staff_role'
>;

type AdminTab = 'members' | 'staff-roster' | 'announcement' | 'information-support' | 'staff-resources' | 'terms-privacy' | 'gallery' | 'store' | 'terminal' | 'logs';

const ADMIN_SECTIONS = [
  'members',
  'staff-roster',
  'announcement',
  'information-support',
  'staff-resources',
  'terms-privacy',
  'gallery',
  'store',
  'terminal',
  'logs',
] as const satisfies readonly AdminTab[];
type LegalEditDoc = 'terms' | 'privacy';
type LogsSubTab =
  | 'members'
  | 'staff'
  | 'announcements'
  | 'terminal'
  | 'portal'
  | 'gallery'
  | 'store'
  | 'dps_personnel'
  | 'dps_vehicles'
  | 'dps_equipment'
  | 'cad_dispatch'
  | 'doc_personnel'
  | 'doc_vehicles'
  | 'dph_personnel'
  | 'dph_vehicles'
  | 'dph_equipment'
  | null;

const LOGS_SUB_TAB_TITLES: Record<Exclude<LogsSubTab, null>, string> = {
  members: 'Member Logs',
  staff: 'Staff Roster Logs',
  announcements: 'Announcement Logs',
  terminal: 'Terminal Logs',
  portal: 'Portal Content Logs',
  gallery: 'Gallery Logs',
  store: 'Server Store Logs',
  dps_personnel: 'DPS Personnel Logs',
  dps_vehicles: 'DPS Vehicle Logs',
  dps_equipment: 'DPS Equipment Logs',
  cad_dispatch: 'CAD Dispatch Logs',
  doc_personnel: 'DOC Personnel Logs',
  doc_vehicles: 'DOC Vehicle Logs',
  dph_personnel: 'DPH Personnel Logs',
  dph_vehicles: 'DPH Vehicle Logs',
  dph_equipment: 'DPH Equipment Logs',
};

type AuditLog = {
  id: number;
  category: string;
  actor: string;
  action: string;
  details: string | null;
  created_at: string;
};

type StaffGroup  = { id: number; name: string; sort_order: number; locked: boolean; staff_access: boolean; admin_access: boolean; doc_access: boolean };
type StaffRank        = { id: number; name: string; sort_order: number; group_id: number | null; color_hex: string | null; discord_role_id: string | null; };
type DiscordRoleOption = { id: string; name: string; position: number };
type StaffMember = { id: number; username: string; discord_username: string; discord_id: string; avatar_hash: string | null; staff_rank: string | null; staff_role: string | null; status: string; staff_appointed_date: string | null; can_access_iab?: boolean; can_access_system_logs?: boolean; can_access_terms_privacy?: boolean; can_access_terminal_offline?: boolean; can_access_doc_dps_cad?: boolean };
type UserHit     = { id: number | null; username: string; discord_username: string | null; discord_id: string | null; nick: string | null; rank: string | null; source: 'cad' | 'discord' };

type Announcement = {
  id: number;
  title: string;
  message: string;
  posted_by: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

type StaffForm = {
  memberId: string;
  rank: string;
};

type CivCharacter = {
  id: number;
  first_name: string;
  last_name: string;
  dob: string | null;
  gender: string | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
  wanted: boolean;
};

type CivVehicle = {
  id: number;
  plate: string;
  make: string;
  model: string;
  year: string | null;
  color: string | null;
  registered: boolean;
  stolen: boolean;
  civilian_name: string | null;
};

type CivWeapon = {
  id: number;
  weapon_type: string;
  serial_number: string | null;
  registered: boolean;
  civilian_name: string | null;
};

type MemberCivData = {
  characters: CivCharacter[];
  vehicles: CivVehicle[];
  weapons: CivWeapon[];
  loading: boolean;
  error: string | null;
};

type GuildMember = {
  discord_id: string;
  discord_username: string;
  nickname: string | null;
  avatar_hash: string | null;
  discord_roles: string[];
  cad_rank: string | null;
  cad_profile: AdminMember | null;
};

const STAFF_RANKS = [
  'Owner',
  'Executive',
  'Co-Owner',
  'Manager',
  'Administrator',
  'Head Moderator',
  'Moderator',
  'Junior Moderator',
] as const;

const ADMIN_ROLE_GROUPS = ['Executive Team', 'Executive Board', 'Owner', 'Executive', 'Management', 'Admin'];
const STAFF_ROLE_GROUPS = [...ADMIN_ROLE_GROUPS, 'Moderation'];

const ADMIN_CODE = 'ADMIN2026';
const ADMIN_CODE_STORAGE_KEY = 'west-coast-admin-code';

const getRoleForRank = (rank: string) => {
  if (rank === 'Owner' || rank === 'Executive') return 'Executive Team';
  if (rank === 'Co-Owner' || rank === 'Manager') return 'Management';
  if (rank === 'Administrator' || rank === 'Head Moderator') return 'Admin';
  return 'Moderation';
};

const hasAdminRole = (role: string) => ADMIN_ROLE_GROUPS.some((group) => group.toLowerCase() === role.trim().toLowerCase());

const hasStaffRole = (role: string) => STAFF_ROLE_GROUPS.some((group) => group.toLowerCase() === role.trim().toLowerCase());

const getRankLevel = (rank: string, role: string) => {
  const rankIndex = STAFF_RANKS.findIndex((staffRank) => staffRank.toLowerCase() === rank.trim().toLowerCase());

  if (rankIndex >= 0) {
    return rankIndex;
  }

  const normalizedRole = role.trim().toLowerCase();
  if (normalizedRole === 'executive team') return 0;
  if (normalizedRole === 'executive board') return 0;
  if (normalizedRole === 'management') return 2;
  if (normalizedRole === 'admin') return 3;
  if (normalizedRole === 'moderation') return 4;
  return Number.POSITIVE_INFINITY;
};

const canManageStaffMember = (admin: CadSession | null, member: AdminMember) =>
  Boolean(admin) && admin!.id !== member.id &&
  getRankLevel(admin!.staff_rank ?? admin!.rank, admin!.staff_role ?? admin!.role) <
  getRankLevel(member.staff_rank ?? member.rank, member.staff_role ?? member.role);

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

const toEditForm = (member: AdminMember): EditMemberForm => ({
  auth_user_id:   member.auth_user_id,
  username:       member.username,
  discord_username: member.discord_username,
  discord_id:     member.discord_id,
  email:          member.email,
  community_code: member.community_code,
  status:         member.status,
  rank:           member.rank,
  role:           member.role,
  dps_rank:       member.dps_rank,
  dps_role:       member.dps_role,
  staff_rank:     member.staff_rank,
  staff_role:     member.staff_role,
});

// -- Staff Roster helper components ----
const SrStatusBadge = ({ status }: { status: string }) => {
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

const SrDiscordAvatar = ({ name, discordId, avatarHash, size = 'sm' }: { name: string; discordId?: string; avatarHash?: string | null; size?: 'sm' | 'md' }) => {
  const [imgError, setImgError] = React.useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const colors  = ['bg-[#5865f2]', 'bg-[#3ba55c]', 'bg-[#ed4245]', 'bg-[#faa61a]', 'bg-[#9c84ec]'];
  const color   = colors[(name.charCodeAt(0) ?? 0) % colors.length];
  const imgSz   = size === 'md' ? 'h-11 w-11' : 'h-6 w-6';
  const txtSz   = size === 'md' ? 'text-xs'  : 'text-[9px]';
  const src = !imgError ? discordAvatarUrl(discordId, avatarHash, size === 'md' ? 128 : 64) : null;
  if (src) {
    return <img src={src} alt={name} className={`${imgSz} shrink-0 rounded-full object-cover`} onError={() => setImgError(true)} />;
  }
  return <span className={`inline-flex ${imgSz} shrink-0 items-center justify-center rounded-full ${color} ${txtSz} font-black text-white`}>{initial}</span>;
};
const srInputCls  = 'h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]';
const srSelectCls = 'h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff] appearance-none';
const srLabelCls  = 'block text-[9px] font-black uppercase tracking-[0.18em] text-[#3f5470] mb-1.5';
const SR_STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave', 'Suspended'];

// -- Add Staff Member Modal ----
type SrAddForm = { userId: number | null; discordId: string | null; discordUsername: string | null; username: string; rank: string; status: string; staff_appointed_date: string };
const AddStaffMemberModal = ({ onClose, onAdd, ranks }: { onClose: () => void; onAdd: (f: SrAddForm) => Promise<void>; ranks: StaffRank[] }) => {
  const [form, setForm] = React.useState<SrAddForm>({ userId: null, discordId: null, discordUsername: null, username: '', rank: ranks[0]?.name ?? '', status: 'Active', staff_appointed_date: '' });
  const [saving, setSaving]           = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<UserHit[]>([]);
  const [showSugg, setShowSugg]       = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef     = React.useRef<HTMLDivElement>(null);
  const set = <K extends keyof SrAddForm>(k: K, v: SrAddForm[K]) => setForm(p => ({ ...p, [k]: v }));
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowSugg(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const onUsernameChange = (val: string) => {
    setForm(p => ({ ...p, username: val, userId: null, discordId: null, discordUsername: null }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); setShowSugg(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/staff/member-search?q=${encodeURIComponent(val.trim())}`, { headers: { accept: 'application/json' } });
        if (!r.ok) { setSuggestions([]); setShowSugg(false); return; }
        const rows = await r.json();
        const list = Array.isArray(rows) ? rows as UserHit[] : [];
        setSuggestions(list);
        setShowSugg(list.length > 0);
      } catch { /* ignore */ }
    }, 280);
  };
  const selectHit = (hit: UserHit) => {
    setForm(p => ({ ...p, userId: hit.id, discordId: hit.discord_id, discordUsername: hit.discord_username, username: hit.username }));
    setSuggestions([]); setShowSugg(false);
  };
  const isSelected = form.userId !== null || form.discordId !== null;
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSelected) { toast.error('Select a member from the suggestions.'); return; }
    setSaving(true);
    try { await onAdd(form); onClose(); } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to add staff member.'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-base font-black text-white">Add Staff Member</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div ref={wrapRef} className="relative">
            <label className={srLabelCls}>Search staff Discord server members <span className="text-red-400">*</span></label>
            <input type="text" required autoComplete="off" placeholder="Start typing a name or @username..." value={form.username}
              onChange={e => onUsernameChange(e.target.value)} onFocus={() => suggestions.length > 0 && setShowSugg(true)} className={srInputCls} />
            {isSelected && (
              <p className="mt-1 text-[10px] font-black text-emerald-400">
                 {form.discordId && !form.userId ? 'Discord member selected  -  a CAD profile will be created on add' : 'CAD user selected'}
              </p>
            )}
            {showSugg && suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[#1f3050] bg-[#070e1a] shadow-2xl">
                {suggestions.map((hit, i) => (
                  <li key={hit.id ?? hit.discord_id ?? i}>
                    <button type="button" onMouseDown={() => selectHit(hit)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[#0d1a2e]">
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-black text-white truncate">{hit.username}</span>
                        {hit.discord_username && <span className="block text-[10px] text-[#526179] truncate">@{hit.discord_username}</span>}
                      </div>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-black ${hit.source === 'discord' ? 'border-[#4384ff]/30 bg-[#4384ff]/10 text-[#4384ff]' : 'border-[#1f3050] bg-[#0a1525] text-[#526179]'}`}>
                        {hit.source === 'discord' ? 'Staff Server' : (hit.rank ?? 'CAD')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={srLabelCls}>Staff Rank</label>
              <select value={form.rank} onChange={e => set('rank', e.target.value)} className={srSelectCls}>
                {ranks.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className={srLabelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={srSelectCls}>
                {SR_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={srLabelCls}>Appointed Date</label>
            <input type="date" value={form.staff_appointed_date} onChange={e => set('staff_appointed_date', e.target.value)} className={srInputCls} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={saving || !isSelected} className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-60">{saving ? 'Adding...' : 'Add Staff Member'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// -- Edit Staff Member Modal ----
type SrEditForm = { rank: string; status: string; staff_appointed_date: string };
const EditStaffMemberModal = ({ member, onClose, onSave, ranks }: { member: StaffMember; onClose: () => void; onSave: (id: number, f: SrEditForm) => Promise<void>; ranks: StaffRank[] }) => {
  const [form, setForm] = React.useState<SrEditForm>({
    rank: member.staff_rank ?? '',
    status: member.status ?? 'Active',
    staff_appointed_date: member.staff_appointed_date ? member.staff_appointed_date.slice(0, 10) : '',
  });
  const [saving, setSaving] = React.useState(false);
  const set = <K extends keyof SrEditForm>(k: K, v: SrEditForm[K]) => setForm(p => ({ ...p, [k]: v }));
  const handleSubmit = async (e: FormEvent) => { e.preventDefault(); setSaving(true); try { await onSave(member.id, form); onClose(); } finally { setSaving(false); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div><h3 className="text-base font-black text-white">Edit Staff Member</h3><p className="mt-0.5 text-xs text-[#526179]">{member.username}</p></div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={srLabelCls}>Staff Rank</label>
            <select value={form.rank} onChange={e => set('rank', e.target.value)} className={srSelectCls}>
              {ranks.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={srLabelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={srSelectCls}>
                {SR_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={srLabelCls}>Appointed Date</label>
              <input type="date" value={form.staff_appointed_date} onChange={e => set('staff_appointed_date', e.target.value)} className={srInputCls} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-60">{saving ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// -- Staff Access Permissions Modal ----
const StaffAccessPermissionsModal = ({
  member,
  onClose,
  iabSaving,
  adminTabSaving,
  onToggleIab,
  onToggleAdminTab,
  onToggleTerminalOffline,
  onToggleDocDpsCad,
  terminalSaving,
  cadSaving,
}: {
  member: StaffMember;
  onClose: () => void;
  iabSaving: boolean;
  adminTabSaving: boolean;
  terminalSaving: boolean;
  cadSaving: boolean;
  onToggleIab: (enabled: boolean) => void;
  onToggleAdminTab: (field: 'can_access_system_logs' | 'can_access_terms_privacy', enabled: boolean) => void;
  onToggleTerminalOffline: (enabled: boolean) => void;
  onToggleDocDpsCad: (enabled: boolean) => void;
}) => {
  const rows: Array<{
    key: string;
    label: string;
    description: string;
    enabled: boolean;
    saving: boolean;
    icon: React.ReactNode;
    on: string;
    off: string;
    onClick: () => void;
  }> = [
    {
      key: 'iab',
      label: 'IAB',
      description: 'DPS Internal Affairs access',
      enabled: Boolean(member.can_access_iab),
      saving: iabSaving,
      icon: <Scale className="h-3.5 w-3.5" />,
      on: 'border-[#f4c542]/50 bg-[#f4c542]/10 text-[#f4c542]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#f4c542]/40 hover:text-[#f4c542]',
      onClick: () => onToggleIab(!member.can_access_iab),
    },
    {
      key: 'logs',
      label: 'System Logs',
      description: 'Admin portal System Logs tab',
      enabled: Boolean(member.can_access_system_logs),
      saving: adminTabSaving,
      icon: <FileText className="h-3.5 w-3.5" />,
      on: 'border-[#38bdf8]/50 bg-[#38bdf8]/10 text-[#38bdf8]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#38bdf8]/40 hover:text-[#38bdf8]',
      onClick: () => onToggleAdminTab('can_access_system_logs', !member.can_access_system_logs),
    },
    {
      key: 'tspp',
      label: 'TS&PP',
      description: 'Terms of Service & Privacy Policy',
      enabled: Boolean(member.can_access_terms_privacy),
      saving: adminTabSaving,
      icon: <Shield className="h-3.5 w-3.5" />,
      on: 'border-[#a78bfa]/50 bg-[#a78bfa]/10 text-[#a78bfa]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#a78bfa]/40 hover:text-[#a78bfa]',
      onClick: () => onToggleAdminTab('can_access_terms_privacy', !member.can_access_terms_privacy),
    },
    {
      key: 'term',
      label: 'Terminal Lockdown',
      description: 'Sign in during Terminal lockdown',
      enabled: Boolean(member.can_access_terminal_offline),
      saving: terminalSaving,
      icon: <TerminalIcon className="h-3.5 w-3.5" />,
      on: 'border-[#ff7070]/50 bg-[#ff7070]/10 text-[#ff7070]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#ff7070]/40 hover:text-[#ff7070]',
      onClick: () => onToggleTerminalOffline(!member.can_access_terminal_offline),
    },
    {
      key: 'cad',
      label: 'DOC & DPS CAD',
      description: 'View DOC and DPS CAD terminals without department roster membership',
      enabled: Boolean(member.can_access_doc_dps_cad),
      saving: cadSaving,
      icon: <Monitor className="h-3.5 w-3.5" />,
      on: 'border-[#4384ff]/50 bg-[#4384ff]/10 text-[#4384ff]',
      off: 'border-[#1f3050] bg-[#0a1525] text-[#a8b7cd] hover:border-[#4384ff]/40 hover:text-[#4384ff]',
      onClick: () => onToggleDocDpsCad(!member.can_access_doc_dps_cad),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-white">Access Permissions</h3>
            <p className="mt-0.5 text-xs text-[#526179]">{member.username}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
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

// -- Staff Rank Edit Modal ----
const SrRankEditModal = ({ rank, discordRoles, onClose, onSaved }: {
  rank: StaffRank;
  discordRoles: DiscordRoleOption[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [name,           setName]           = React.useState(rank.name);
  const [colorHex,       setColorHex]       = React.useState(rank.color_hex ?? '');
  const [discordRoleId,  setDiscordRoleId]  = React.useState(rank.discord_role_id ?? '');
  const [saving,         setSaving]         = React.useState(false);
  const [colorErr,       setColorErr]       = React.useState('');
  const colorRef = React.useRef<HTMLInputElement>(null);
  const valid = (v: string) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
  const rankColor = colorHex && valid(colorHex) ? colorHex : null;
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); if (!name.trim()) return;
    if (colorHex && !valid(colorHex)) { setColorErr('Invalid hex (e.g. #3b82f6)'); return; }
    setColorErr(''); setSaving(true);
    try {
      const res = await fetch(`/api/staff/ranks/${rank.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-discord-id': getCadSession()?.discord_id ?? '' },
        body: JSON.stringify({
          name: name.trim(),
          color_hex: colorHex.trim() || null,
          discord_role_id: discordRoleId || null,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to save rank.'); return; }
      if (discordRoleId !== (rank.discord_role_id ?? '')) {
        toast.success(discordRoleId ? 'Rank saved — Discord sync triggered.' : 'Rank saved — Discord link cleared.');
      }
      onSaved(); onClose();
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="mb-6 flex items-center justify-between">
          <div><h3 className="text-base font-black text-white">Edit Rank</h3><p className="mt-0.5 text-xs text-[#526179]">{rank.name}</p></div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={srLabelCls}>Rank Name <span className="text-red-400">*</span></label>
            <input autoFocus type="text" required value={name} onChange={e => setName(e.target.value)} className={srInputCls} />
          </div>
          <div>
            <label className={srLabelCls}>Colour Hex</label>
            <div className="flex items-center gap-3">
              <div className="h-9 w-10 shrink-0 rounded-lg border border-[#1f3050] cursor-pointer overflow-hidden relative" style={{ backgroundColor: rankColor ?? '#07111f' }} onClick={() => colorRef.current?.click()}>
                <input ref={colorRef} type="color" value={rankColor ?? '#4384ff'} onChange={e => { setColorHex(e.target.value); setColorErr(''); }} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
              </div>
              <input type="text" placeholder="#4384ff" value={colorHex} onChange={e => { setColorHex(e.target.value); setColorErr(''); }} className={`${srInputCls} font-mono`} />
            </div>
            {colorErr && <p className="mt-1 text-[10px] font-bold text-red-400">{colorErr}</p>}
          </div>
          <div>
            <label className={srLabelCls}>
              <Link className="mr-1 inline h-3 w-3" />
              Link to Discord Role
              <span className="ml-1 font-normal text-[#3f5470]">(optional  -  auto-assigns this rank)</span>
            </label>
            <select value={discordRoleId} onChange={e => setDiscordRoleId(e.target.value)} className={srInputCls}>
              <option value="">No Discord role link</option>
              {discordRoles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {discordRoleId && (
              <p className="mt-1 text-[10px] text-[#4384ff]">
                Members with this Discord role will automatically receive this staff rank.
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-[#1e2d42] bg-transparent text-xs font-bold text-[#a8b7cd] hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-[#2f66ee] text-xs font-black text-white hover:bg-[#3977ff] disabled:opacity-60">{saving ? 'Saving...' : 'Save Rank'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AdminPortal = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab, rawSection] = usePortalSection<AdminTab>({
    base: 'admin',
    valid: ADMIN_SECTIONS,
    defaultSection: 'members',
    resolveParent: (raw) => (raw === 'logs' || raw.startsWith('logs-') ? 'logs' : null),
  });
  const logsSubTab = useMemo((): LogsSubTab => {
    const parsed = parseNestedPortalSection(rawSection, 'logs');
    if (!parsed.isParent || !parsed.nested) return null;
    return parsed.nested in LOGS_SUB_TAB_TITLES
      ? (parsed.nested as Exclude<LogsSubTab, null>)
      : null;
  }, [rawSection]);
  const setLogsSubTab = useCallback((next: LogsSubTab) => {
    if (next) navigate(nestedPortalSectionPath('admin', 'logs', next));
    else navigate(portalSectionPath('admin', 'logs'));
  }, [navigate]);
  const [members, setMembers] = useState<AdminMember[]>([]);
  // Guild-member view (Discord members merged with CAD profiles + staff groups)
  const [guildMembers,        setGuildMembers]        = useState<GuildMember[]>([]);
  const [guildGroups,         setGuildGroups]         = useState<StaffGroup[]>([]);
  const [guildMembersLoading, setGuildMembersLoading] = useState(true);
  const [guildMembersError,   setGuildMembersError]   = useState<string | null>(null);
  const [guildLoadProgress,   setGuildLoadProgress]   = useState({ percent: 0, label: 'Preparing…', loaded: 0, total: null as number | null });
  const [memberSearch, setMemberSearch] = useState('');
  const [memberPage,   setMemberPage]   = useState(1);
  const [expandedRoleIds, setExpandedRoleIds] = useState<Set<string>>(new Set());
  const [staffSearch, setStaffSearch] = useState('');
  const [staffMemberSearch, setStaffMemberSearch] = useState('');
  const [staffForm, setStaffForm] = useState<StaffForm>({ memberId: '', rank: 'Administrator' });
  const [staffRankDrafts, setStaffRankDrafts] = useState<Record<number, string>>({});
  const [currentAdmin, setCurrentAdmin] = useState<CadSession | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<number | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditMemberForm | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [isDeletingAccounts, setIsDeletingAccounts] = useState(false);
  const [deletingMemberId, setDeletingMemberId] = useState<number | null>(null);
  const [savingMemberId, setSavingMemberId] = useState<number | null>(null);
  const [assigningStaffMemberId, setAssigningStaffMemberId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<number | null>(null);
  const [editDraftTitle, setEditDraftTitle] = useState('');
  const [editDraftMessage, setEditDraftMessage] = useState('');
  const [savingAnnouncementId, setSavingAnnouncementId] = useState<number | null>(null);
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [confirmingPost, setConfirmingPost] = useState(false);

  // -- Information & Support (Member Portal) ----
  const [infoSupportSections, setInfoSupportSections] = useState<ContentBlock[]>([{ type: 'text', body: '' }]);
  const [infoSupportLoading, setInfoSupportLoading] = useState(false);
  const [infoSupportSaving, setInfoSupportSaving] = useState(false);
  const [legalEditDoc, setLegalEditDoc] = useState<LegalEditDoc | null>(null);
  const [termsSections, setTermsSections] = useState<ContentBlock[]>(DEFAULT_TERMS_SECTIONS);
  const [privacySections, setPrivacySections] = useState<ContentBlock[]>(DEFAULT_PRIVACY_SECTIONS);
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);

  // -- Staff Resources ----
  type StaffResourceRow = {
    id: number;
    title: string;
    type: string;
    logo_url: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
  const [staffResources, setStaffResources] = useState<StaffResourceRow[]>([]);
  const [staffResourcesLoading, setStaffResourcesLoading] = useState(false);
  const [staffResourceDeletingId, setStaffResourceDeletingId] = useState<number | null>(null);
  const [staffAddStep, setStaffAddStep] = useState<0 | 1 | 2>(0);
  const [staffNewTitle, setStaffNewTitle] = useState('');
  const [staffNewType, setStaffNewType] = useState<'document' | 'file'>('document');
  const [staffUploadFile, setStaffUploadFile] = useState<File | null>(null);
  const [staffCreating, setStaffCreating] = useState(false);
  const [staffUploadStatus, setStaffUploadStatus] = useState<string | null>(null);
  const [staffOpenDocId, setStaffOpenDocId] = useState<number | null>(null);
  const [staffOpenDocCanEdit, setStaffOpenDocCanEdit] = useState(false);
  const [staffOpenPdf, setStaffOpenPdf] = useState<StaffResourceRow | null>(null);

  // -- Gallery state ----
  type GalleryImage = { id: number; title: string; caption: string; image_url: string; created_at: string };
  const [galleryImages,     setGalleryImages]     = useState<GalleryImage[]>([]);
  const [galleryLoading,    setGalleryLoading]    = useState(false);
  const [galleryUploading,  setGalleryUploading]  = useState(false);
  const [galleryFile,       setGalleryFile]       = useState<File | null>(null);
  const [galleryCredit,     setGalleryCredit]     = useState('');
  const [galleryDeleteId,   setGalleryDeleteId]   = useState<number | null>(null);
  const [galleryDeletingId, setGalleryDeletingId] = useState<number | null>(null);
  const [galleryEditId,     setGalleryEditId]     = useState<number | null>(null);
  const [galleryEditTitle,  setGalleryEditTitle]  = useState('');
  const [galleryEditCredit, setGalleryEditCredit] = useState('');
  const [gallerySavingId,   setGallerySavingId]   = useState<number | null>(null);
  const [galleryDragIdx,    setGalleryDragIdx]    = useState<number | null>(null);
  const [galleryDragOver,   setGalleryDragOver]   = useState<number | null>(null);
  const [gallerySavingOrder,setGallerySavingOrder]= useState(false);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  // -- Server Store state ----
  const [storeUrl,         setStoreUrl]         = useState('');
  const [storeUrlDraft,    setStoreUrlDraft]    = useState('');
  const [storeLoading,     setStoreLoading]     = useState(false);
  const [storeSaving,      setStoreSaving]      = useState(false);
  const [storeProducts,    setStoreProducts]    = useState<StoreProductRow[]>([]);
  const [storeProductForm, setStoreProductForm] = useState<StoreProduct>({ ...EMPTY_STORE_PRODUCT });
  const [editingStoreId,   setEditingStoreId]   = useState<number | null>(null);
  const [storeProductSaving, setStoreProductSaving] = useState(false);
  const [storeProductUploading, setStoreProductUploading] = useState(false);
  const [deletingStoreId,  setDeletingStoreId]  = useState<number | null>(null);
  const storeImageRef = useRef<HTMLInputElement>(null);
  const storeIconRef = useRef<HTMLInputElement>(null);

  const [confirmingDeleteMemberId, setConfirmingDeleteMemberId] = useState<number | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [confirmingRankSaveMemberId, setConfirmingRankSaveMemberId] = useState<number | null>(null);
  const [confirmingRemoveStaffId, setConfirmingRemoveStaffId] = useState<number | null>(null);
  const [cadMode, setCadMode] = useState<CadMode | null>(null);
  const cadOnline = cadMode === null ? null : cadMode === 'online';
  const [isTogglingCad, setIsTogglingCad] = useState(false);
  const [confirmingCadAction, setConfirmingCadAction] = useState<'members_locked' | 'lockdown' | 'open' | null>(null);
  const [memberCivData, setMemberCivData] = useState<Record<number, MemberCivData>>({});
  const [expandedCivSection, setExpandedCivSection] = useState<Record<number, 'characters' | 'vehicles' | 'weapons' | null>>({});
  const [editingCivItem, setEditingCivItem] = useState<{ type: 'character' | 'vehicle' | 'weapon'; id: number } | null>(null);
  const [civEditDraft, setCivEditDraft] = useState<Record<string, string | boolean>>({});
  const [confirmingDeleteCivItem, setConfirmingDeleteCivItem] = useState<{ type: 'character' | 'vehicle' | 'weapon'; id: number; memberId: number } | null>(null);
  const [savingCivItemId, setSavingCivItemId] = useState<number | null>(null);
  const [deletingCivItemId, setDeletingCivItemId] = useState<number | null>(null);

  // -- Staff tab: Add Staff Member typeahead ----
  const [staffAddSuggestions, setStaffAddSuggestions] = useState<UserHit[]>([]);
  const [staffAddShowSugg, setStaffAddShowSugg] = useState(false);
  const staffAddDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- Staff Roster tab state ----
  const [staffGroups,         setStaffGroups]         = useState<StaffGroup[]>([]);
  const [staffRanks,          setStaffRanks]           = useState<StaffRank[]>([]);
  const [staffRosterMembers,  setStaffRosterMembers]   = useState<StaffMember[]>([]);
  const [staffRosterLoading,  setStaffRosterLoading]   = useState(false);
  const [iabAccessSavingId,   setIabAccessSavingId]    = useState<number | null>(null);
  const [adminTabAccessSavingId, setAdminTabAccessSavingId] = useState<number | null>(null);
  const [terminalAccessSavingId, setTerminalAccessSavingId] = useState<number | null>(null);
  const [cadAccessSavingId, setCadAccessSavingId] = useState<number | null>(null);
  // Group management
  const [addStaffGroupOpen,    setAddStaffGroupOpen]    = useState(false);
  const [newStaffGroupName,    setNewStaffGroupName]    = useState('');
  const [addingStaffGroup,     setAddingStaffGroup]     = useState(false);
  const [editingStaffGroupId,  setEditingStaffGroupId]  = useState<number | null>(null);
  const [editingStaffGroupName,setEditingStaffGroupName]= useState('');
  // Rank management
  const [addStaffRankGroupId,  setAddStaffRankGroupId]  = useState<number | null>(null);
  const [newStaffRankName,     setNewStaffRankName]     = useState('');
  const [addingStaffRank,      setAddingStaffRank]      = useState(false);
  // Member management inside roster
  const [staffRosterAddOpen,   setStaffRosterAddOpen]   = useState(false);
  const [srAddSearch,          setSrAddSearch]          = useState('');
  const [srAddSuggestions,     setSrAddSuggestions]     = useState<UserHit[]>([]);
  const [srAddShowSugg,        setSrAddShowSugg]        = useState(false);
  const [srAddUserId,          setSrAddUserId]          = useState<number | null>(null);
  const [srAddUsername,        setSrAddUsername]        = useState('');
  const [srAddRank,            setSrAddRank]            = useState('');
  const [srAddSaving,          setSrAddSaving]          = useState(false);
  const srAddDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingRosterMemberId,  setEditingRosterMemberId]  = useState<number | null>(null);
  const [rosterMemberEditRank,   setRosterMemberEditRank]   = useState('');
  const [savingRosterMember,     setSavingRosterMember]     = useState<number | null>(null);
  const [confirmRemoveRosterId,  setConfirmRemoveRosterId]  = useState<number | null>(null);
  const [removingRosterMember,   setRemovingRosterMember]   = useState<number | null>(null);

  // Staff Roster  -  DPS-style panel state
  const [srPanelSearch,       setSrPanelSearch]       = useState('');
  const [srMembersCollapsed,  setSrMembersCollapsed]  = useState(false);
  const [srAddOpen,           setSrAddOpen]           = useState(false);
  const [srEditMember,        setSrEditMember]        = useState<StaffMember | null>(null);
  const [srAccessMemberId,    setSrAccessMemberId]    = useState<number | null>(null);
  const [srEditRank,          setSrEditRank]          = useState<StaffRank | null>(null);
  // rank drag-and-drop
  const [srDragRankId,        setSrDragRankId]        = useState<number | null>(null);
  const [srDragOverRankId,    setSrDragOverRankId]    = useState<number | null>(null);
  const [srDragOverSide,      setSrDragOverSide]      = useState<'before' | 'after'>('after');
  const [srDragOverGroupId,   setSrDragOverGroupId]   = useState<number | null>(null);
  // group drag-and-drop
  const [srDragGroupId,       setSrDragGroupId]       = useState<number | null>(null);
  const [srDragGroupOverId,   setSrDragGroupOverId]   = useState<number | null>(null);
  const [srDragGroupOverSide, setSrDragGroupOverSide] = useState<'before' | 'after'>('after');
  // Discord role auto-assignment
  const [staffGuildRoles,         setStaffGuildRoles]         = useState<DiscordRoleOption[]>([]);
  const [staffGuildRolesLoading,  setStaffGuildRolesLoading]  = useState(false);
  const [newStaffRankDiscordRole, setNewStaffRankDiscordRole] = useState('');
  const [syncingDiscordRoles,     setSyncingDiscordRoles]     = useState(false);
  const [assigningDiscordRoles,   setAssigningDiscordRoles]   = useState(false);

  // -- System Logs ----
  const [auditLogs,        setAuditLogs]        = useState<AuditLog[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [auditLogSearch,   setAuditLogSearch]   = useState('');
  const [auditLogActionFilter, setAuditLogActionFilter] = useState('all');
  const [auditLogActorFilter,  setAuditLogActorFilter]  = useState('all');


  const adminCode = ADMIN_CODE;

  // Load audit logs when System Logs tab is active or sub-tab changes

  useEffect(() => {
    if (activeTab !== 'logs' || !logsSubTab) return;
    setAuditLogSearch('');
    setAuditLogActionFilter('all');
    setAuditLogActorFilter('all');
    setAuditLogsLoading(true);
    fetch(`/api/admin/logs?category=${logsSubTab}`, { headers: { 'x-admin-code': adminCode, accept: 'application/json' } })
      .then(r => r.ok ? r.json() : [])
      .then((rows: AuditLog[]) => setAuditLogs(rows))
      .catch(() => setAuditLogs([]))
      .finally(() => setAuditLogsLoading(false));
  }, [activeTab, logsSubTab]);

  // Clear log filters when leaving the logs section
  useEffect(() => {
    if (activeTab !== 'logs') {
      setAuditLogSearch('');
      setAuditLogActionFilter('all');
      setAuditLogActorFilter('all');
    }
  }, [activeTab]);

  // Load gallery when that tab becomes active
  useEffect(() => {
    if (activeTab !== 'gallery') return;
    setGalleryLoading(true);
    fetch('/api/public/gallery')
      .then(r => r.json()).then(setGalleryImages).catch(() => {})
      .finally(() => setGalleryLoading(false));
  }, [activeTab]);

  // Load Information & Support content when that tab becomes active
  useEffect(() => {
    if (activeTab !== 'information-support') return;
    setInfoSupportLoading(true);
    fetch('/api/portal/content/information_support', { headers: { accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { sections?: ContentBlock[] } | null) => {
        const sections = Array.isArray(d?.sections) && d!.sections.length > 0
          ? d!.sections
          : [{ type: 'text' as const, body: '' }];
        setInfoSupportSections(sections);
      })
      .catch(() => setInfoSupportSections([{ type: 'text', body: '' }]))
      .finally(() => setInfoSupportLoading(false));
  }, [activeTab]);

  // Load Terms / Privacy content when that tab becomes active
  useEffect(() => {
    if (activeTab !== 'terms-privacy') return;
    setLegalEditDoc(null);
    setLegalLoading(true);
    Promise.all([
      fetch('/api/portal/content/terms_of_service', { headers: { accept: 'application/json' } })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch('/api/portal/content/privacy_policy', { headers: { accept: 'application/json' } })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([terms, privacy]: [{ sections?: ContentBlock[] } | null, { sections?: ContentBlock[] } | null]) => {
        setTermsSections(resolveLegalSections(terms?.sections, DEFAULT_TERMS_SECTIONS));
        setPrivacySections(resolveLegalSections(privacy?.sections, DEFAULT_PRIVACY_SECTIONS));
      })
      .finally(() => setLegalLoading(false));
  }, [activeTab]);

  const fetchStaffResources = async () => {
    setStaffResourcesLoading(true);
    try {
      const r = await fetch('/api/staff/resources', { headers: { accept: 'application/json' } });
      if (!r.ok) {
        setStaffResources([]);
        return;
      }
      const rows = await r.json();
      setStaffResources(Array.isArray(rows) ? rows as StaffResourceRow[] : []);
    } catch {
      setStaffResources([]);
    } finally {
      setStaffResourcesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'staff-resources') return;
    void fetchStaffResources();
  }, [activeTab]);

  useEffect(() => {
    if (!currentAdmin) return;
    const superAdmin = isSuperAdminSession(currentAdmin);
    const logsOk = superAdmin || Boolean(currentAdmin.can_access_system_logs);
    const termsOk = superAdmin || Boolean(currentAdmin.can_access_terms_privacy);
    if (activeTab === 'logs' && !logsOk) setActiveTab('members');
    if (activeTab === 'terms-privacy' && !termsOk) setActiveTab('members');
  }, [activeTab, currentAdmin]);

  // Load Server Store URL + products when that tab becomes active
  useEffect(() => {
    if (activeTab !== 'store') return;
    setStoreLoading(true);
    Promise.all([
      fetch('/api/settings/server-store').then(r => r.json() as Promise<{ url?: string }>),
      fetch('/api/public/store-products').then(r => r.json() as Promise<StoreProductRow[]>),
    ])
      .then(([settings, products]) => {
        const url = (settings.url ?? '').trim();
        setStoreUrl(url);
        setStoreUrlDraft(url);
        setStoreProducts(Array.isArray(products) ? products : []);
      })
      .catch(() => {})
      .finally(() => setStoreLoading(false));
  }, [activeTab]);

  // Load staff roster + Discord roles when that tab becomes active
  const loadStaffGuildRoles = (refresh = false) => {
    setStaffGuildRolesLoading(true);
    fetch(`/api/staff/discord-roles${refresh ? '?refresh=1' : ''}`)
      .then(r => r.ok ? r.json() as Promise<DiscordRoleOption[]> : [])
      .then(setStaffGuildRoles)
      .catch(() => setStaffGuildRoles([]))
      .finally(() => setStaffGuildRolesLoading(false));
  };

  useEffect(() => {
    if (activeTab !== 'staff-roster') return;
    fetchStaffRoster();
    void handleSyncDiscordRoles({ silent: true });
    loadStaffGuildRoles(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'staff-roster') return;
    if (!srEditRank && addStaffRankGroupId == null) return;
    loadStaffGuildRoles(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srEditRank, addStaffRankGroupId, activeTab]);

  const handleSaveStoreUrl = async () => {
    const next = storeUrlDraft.trim();
    if (next && !/^https?:\/\//i.test(next)) {
      toast.error('Store URL must start with http:// or https://.');
      return;
    }
    setStoreSaving(true);
    try {
      const res = await fetch('/api/settings/server-store', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
        body: JSON.stringify({ url: next, actor: currentAdmin?.username ?? 'Admin' }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to save store URL.'); return; }
      const saved = (data.url ?? next).trim();
      setStoreUrl(saved);
      setStoreUrlDraft(saved);
      toast.success(saved ? 'Server Store URL saved — live on the index page.' : 'Server Store URL cleared.');
    } catch {
      toast.error('Failed to save store URL.');
    } finally {
      setStoreSaving(false);
    }
  };

  const resetStoreProductForm = () => {
    setEditingStoreId(null);
    setStoreProductForm({ ...EMPTY_STORE_PRODUCT });
  };

  const handleStoreImageUpload = async (file: File | null, target: 'image' | 'icon' = 'image') => {
    if (!file) return;
    setStoreProductUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const upRes = await fetch('/api/images/upload', { method: 'POST', body: fd });
      if (!upRes.ok) {
        const e = await upRes.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? 'Upload failed');
      }
      const { url } = await upRes.json() as { url: string };
      if (!url) throw new Error('Upload succeeded but no image URL was returned.');
      if (target === 'icon') {
        setStoreProductForm(p => ({ ...p, price_icon: 'custom', price_icon_url: url }));
        toast.success('Money icon uploaded.');
      } else {
        setStoreProductForm(p => ({ ...p, image_url: url }));
        toast.success('Image uploaded.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Image upload failed.';
      toast.error(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? 'Could not reach the API to upload. Make sure the API server is running, then try again.'
          : msg,
      );
    } finally {
      setStoreProductUploading(false);
      if (storeImageRef.current) storeImageRef.current.value = '';
      if (storeIconRef.current) storeIconRef.current.value = '';
    }
  };

  const handleSaveStoreProduct = async () => {
    if (!storeProductForm.heading.trim()) {
      toast.error('Heading is required.');
      return;
    }
    setStoreProductSaving(true);
    try {
      const payload = {
        ...storeProductForm,
        badge_label: storeProductForm.badge_label.trim(),
        heading: storeProductForm.heading.trim(),
        description: storeProductForm.description.trim(),
        price: storeProductForm.price.trim(),
        price_label: storeProductForm.price_label.trim(),
        price_icon: storeProductForm.price_icon,
        price_icon_url: storeProductForm.price_icon === 'custom' ? storeProductForm.price_icon_url.trim() : '',
        footer_text: storeProductForm.footer_text.trim(),
        button_text: storeProductForm.button_text.trim(),
        button_url: storeProductForm.button_url.trim(),
        image_url: storeProductForm.image_url.trim(),
      };
      const res = await fetch(
        editingStoreId ? `/api/public/store-products/${editingStoreId}` : '/api/public/store-products',
        {
          method: editingStoreId ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json', 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json() as StoreProductRow & { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to save product.'); return; }
      if (editingStoreId) {
        setStoreProducts(prev => prev.map(p => p.id === editingStoreId ? { ...p, ...data } : p));
        toast.success('Product updated.');
      } else {
        setStoreProducts(prev => [...prev, data]);
        toast.success('Product added to Server Store.');
      }
      resetStoreProductForm();
    } catch {
      toast.error('Failed to save product.');
    } finally {
      setStoreProductSaving(false);
    }
  };

  const handleDeleteStoreProduct = async (id: number) => {
    if (!confirm('Delete this store product?')) return;
    setDeletingStoreId(id);
    try {
      const res = await fetch(`/api/public/store-products/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
      });
      if (!res.ok) { toast.error('Failed to delete product.'); return; }
      setStoreProducts(prev => prev.filter(p => p.id !== id));
      if (editingStoreId === id) resetStoreProductForm();
      toast.success('Product deleted.');
    } catch {
      toast.error('Failed to delete product.');
    } finally {
      setDeletingStoreId(null);
    }
  };

  // -- Gallery handlers ----
  const handleGalleryUpload = async () => {
    if (!galleryFile) return;
    setGalleryUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', galleryFile);
      const upRes = await fetch('/api/images/upload', { method: 'POST', body: fd });
      const upJson = await upRes.json().catch(() => ({})) as { url?: string; error?: string };
      if (!upRes.ok || !upJson.url) {
        throw new Error(upJson.error ?? 'Upload failed');
      }

      const saveRes = await fetch('/api/public/gallery', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
        body: JSON.stringify({ image_url: upJson.url, title: '', caption: galleryCredit.trim() }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'Failed to add image to gallery');
      }

      toast.success('Image added to gallery.');
      setGalleryFile(null);
      setGalleryCredit('');
      if (galleryFileRef.current) galleryFileRef.current.value = '';
      const fresh = await fetch('/api/public/gallery').then(r => r.json()) as typeof galleryImages;
      setGalleryImages(fresh);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to upload image.';
      toast.error(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? 'Could not reach the API to upload. Make sure the API server is running, then try again.'
          : msg,
      );
    } finally {
      setGalleryUploading(false);
    }
  };

  const handleGalleryDelete = async (id: number) => {
    setGalleryDeletingId(id);
    try {
      const res = await fetch(`/api/public/gallery/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'Failed to remove image.');
      }
      setGalleryImages(prev => prev.filter(img => img.id !== id));
      setGalleryDeleteId(null);
      if (galleryEditId === id) {
        setGalleryEditId(null);
        setGalleryEditTitle('');
        setGalleryEditCredit('');
      }
      toast.success('Image removed from gallery.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove image.');
    } finally {
      setGalleryDeletingId(null);
    }
  };

  const openGalleryEdit = (img: GalleryImage) => {
    setGalleryDeleteId(null);
    setGalleryEditId(img.id);
    setGalleryEditTitle(img.title ?? '');
    setGalleryEditCredit(img.caption ?? '');
  };

  const handleGallerySaveEdit = async (id: number) => {
    setGallerySavingId(id);
    try {
      const res = await fetch(`/api/public/gallery/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-admin-code': ADMIN_CODE,
          'x-actor': currentAdmin?.username ?? 'Admin',
        },
        body: JSON.stringify({
          title: galleryEditTitle.trim(),
          caption: galleryEditCredit.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? 'Failed to update image.');
      }
      const updated = await res.json() as { id: number; title: string; caption: string };
      setGalleryImages(prev => prev.map(img =>
        img.id === id ? { ...img, title: updated.title, caption: updated.caption } : img
      ));
      setGalleryEditId(null);
      setGalleryEditTitle('');
      setGalleryEditCredit('');
      toast.success('Gallery image updated.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to update image.');
    } finally {
      setGallerySavingId(null);
    }
  };

  const loadAnnouncements = async () => {
    try {
      const response = await fetch('/api/admin/announcements', {
        headers: { accept: 'application/json', 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
      });
      if (response.ok) setAnnouncements((await response.json()) as Announcement[]);
    } catch {
      // silently ignore
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    setConfirmingDeleteId(null);
    setDeletingAnnouncementId(id);
    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', 'x-admin-code': adminCode },
        body: JSON.stringify({ deleted_by: currentAdmin?.username ?? 'Admin' }),
      });
      if (!response.ok) throw new Error();
      const updated = (await response.json()) as Announcement;
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? updated : a)));
      toast.success('Announcement deleted.');
    } catch {
      toast.error('Unable to delete announcement. Please try again.');
    } finally {
      setDeletingAnnouncementId(null);
    }
  };

  const handleSaveAnnouncementEdit = async (id: number) => {
    const title = editDraftTitle.trim();
    const message = editDraftMessage.trim();
    if (!title || !message) {
      toast.error('Title and message cannot be empty.');
      return;
    }
    setSavingAnnouncementId(id);
    try {
      const response = await fetch(`/api/announcements/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-admin-code': adminCode },
        body: JSON.stringify({ title, message, actor: currentAdmin?.username ?? 'Admin' }),
      });
      if (!response.ok) throw new Error();
      const updated = (await response.json()) as Announcement;
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setEditingAnnouncementId(null);
      toast.success('Announcement updated.');
    } catch {
      toast.error('Unable to update announcement. Please try again.');
    } finally {
      setSavingAnnouncementId(null);
    }
  };

  const handlePostAnnouncement = async () => {
    const title = announcementTitle.trim();
    const message = announcementMessage.trim();
    if (!title || !message) {
      toast.error('Please fill in both the title and message.');
      return;
    }
    setIsPostingAnnouncement(true);
    try {
      const response = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-admin-code': adminCode },
        body: JSON.stringify({ title, message, posted_by: currentAdmin?.username ?? 'Admin' }),
      });
      if (!response.ok) throw new Error('Failed to post announcement.');
      const created = (await response.json()) as Announcement;
      setAnnouncements((prev) => [created, ...prev]);
      setAnnouncementTitle('');
      setAnnouncementMessage('');
      toast.success('Announcement posted successfully.');
    } catch {
      toast.error('Unable to post announcement. Please try again.');
    } finally {
      setIsPostingAnnouncement(false);
    }
  };

  const handleSaveInfoSupport = async () => {
    setInfoSupportSaving(true);
    try {
      const response = await fetch('/api/portal/content/information_support', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-admin-code': adminCode,
          'x-actor': currentAdmin?.username ?? 'Admin',
        },
        body: JSON.stringify({
          sections: infoSupportSections,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      if (!response.ok) throw new Error('Failed to save.');
      const data = (await response.json()) as { sections?: ContentBlock[] };
      if (Array.isArray(data.sections)) setInfoSupportSections(data.sections);
      toast.success('Information & Support page saved.');
    } catch {
      toast.error('Unable to save Information & Support content.');
    } finally {
      setInfoSupportSaving(false);
    }
  };

  const handleSaveLegalDoc = async (doc: LegalEditDoc) => {
    const key = doc === 'terms' ? 'terms_of_service' : 'privacy_policy';
    const sections = doc === 'terms' ? termsSections : privacySections;
    const label = doc === 'terms' ? 'Terms of Service' : 'Privacy Policy';
    setLegalSaving(true);
    try {
      const response = await fetch(`/api/portal/content/${key}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-admin-code': adminCode,
          'x-actor': currentAdmin?.username ?? 'Admin',
        },
        body: JSON.stringify({
          sections,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      if (!response.ok) throw new Error('Failed to save.');
      const data = (await response.json()) as { sections?: ContentBlock[] };
      if (Array.isArray(data.sections)) {
        if (doc === 'terms') setTermsSections(data.sections);
        else setPrivacySections(data.sections);
      }
      toast.success(`${label} saved.`);
    } catch {
      toast.error(`Unable to save ${label}.`);
    } finally {
      setLegalSaving(false);
    }
  };
  const resetStaffAddDialog = () => {
    setStaffAddStep(0);
    setStaffNewTitle('');
    setStaffNewType('document');
    setStaffUploadFile(null);
    setStaffUploadStatus(null);
    setStaffCreating(false);
  };

  const handleCreateStaffDocument = async () => {
    const title = staffNewTitle.trim();
    if (!title) return;
    setStaffCreating(true);
    try {
      const res = await fetch('/api/staff/resources', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-code': adminCode,
        },
        body: JSON.stringify({ title, created_by: currentAdmin?.username ?? 'Admin' }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as StaffResourceRow;
      resetStaffAddDialog();
      await fetchStaffResources();
      setStaffOpenDocId(created.id);
      setStaffOpenDocCanEdit(true);
      toast.success('Document created.');
    } catch {
      toast.error('Failed to create document.');
    } finally {
      setStaffCreating(false);
    }
  };

  const handleUploadStaffResource = async () => {
    const title = staffNewTitle.trim();
    if (!title || !staffUploadFile) return;
    setStaffCreating(true);
    setStaffUploadStatus('Uploading…');
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('created_by', currentAdmin?.username ?? 'Admin');
      form.append('file', staffUploadFile);
      const res = await fetch('/api/staff/resources/upload', {
        method: 'POST',
        headers: { 'x-admin-code': adminCode },
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'Upload failed.');
      }
      resetStaffAddDialog();
      await fetchStaffResources();
      toast.success('File uploaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setStaffCreating(false);
      setStaffUploadStatus(null);
    }
  };

  const handleDeleteStaffResource = async (id: number) => {
    setStaffResourceDeletingId(id);
    try {
      const res = await fetch(`/api/staff/resources/${id}`, {
        method: 'DELETE',
        headers: {
          'x-admin-code': adminCode,
          'x-actor': currentAdmin?.username ?? 'Admin',
        },
      });
      if (!res.ok) throw new Error();
      setStaffResources(p => p.filter(r => r.id !== id));
      toast.success('Resource deleted.');
    } catch {
      toast.error('Failed to delete resource.');
    } finally {
      setStaffResourceDeletingId(null);
    }
  };

  const loadMembers = async () => {
    // all=1 requests a lightweight full summary list for staff tooling.
    // Paginated Members UI should call /api/admin/members?page=&limit=&q= instead.
    const response = await fetch('/api/admin/members?all=1', {
      headers: { 'x-admin-code': adminCode, accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      throw new Error('Unable to load members from the shared CAD database.');
    }

    if (!contentType.includes('application/json')) {
      throw new Error('The shared members API is not running yet. Restart the app server and try again.');
    }

    const data = await response.json() as AdminMember[] | { items: AdminMember[] };
    return Array.isArray(data) ? data : (data.items ?? []);
  };

  const loadGuildMembers = async () => {
    setGuildMembersLoading(true);
    setGuildMembersError(null);
    setGuildLoadProgress({ percent: 1, label: 'Starting member load…', loaded: 0, total: null });
    try {
      const r = await fetch('/api/admin/guild-members?stream=1', {
        headers: { 'x-admin-code': adminCode, accept: 'application/x-ndjson, application/json' },
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? 'Unable to load guild members.');
      }

      const contentType = r.headers.get('content-type') ?? '';
      if (!contentType.includes('ndjson') || !r.body) {
        // Fallback for non-streaming responses
        const data = (await r.json()) as {
          groups: StaffGroup[];
          ranks: StaffRank[];
          members: GuildMember[];
        };
        setGuildLoadProgress({
          percent: 100,
          label: `Loaded ${(Array.isArray(data.members) ? data.members.length : 0).toLocaleString()} members`,
          loaded: Array.isArray(data.members) ? data.members.length : 0,
          total: Array.isArray(data.members) ? data.members.length : 0,
        });
        setGuildGroups(Array.isArray(data.groups) ? data.groups : []);
        setGuildMembers(Array.isArray(data.members) ? data.members : []);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      while (!completed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let msg: {
            type?: string;
            percent?: number;
            label?: string;
            loaded?: number;
            total?: number | null;
            error?: string;
            groups?: StaffGroup[];
            members?: GuildMember[];
          };
          try {
            msg = JSON.parse(trimmed) as typeof msg;
          } catch {
            continue;
          }

          if (msg.type === 'progress') {
            setGuildLoadProgress({
              percent: Math.max(0, Math.min(100, Number(msg.percent) || 0)),
              label: msg.label ?? 'Loading…',
              loaded: Number(msg.loaded) || 0,
              total: typeof msg.total === 'number' ? msg.total : null,
            });
          } else if (msg.type === 'complete') {
            setGuildLoadProgress({
              percent: 100,
              label: `Loaded ${(Array.isArray(msg.members) ? msg.members.length : 0).toLocaleString()} members`,
              loaded: Array.isArray(msg.members) ? msg.members.length : 0,
              total: Array.isArray(msg.members) ? msg.members.length : 0,
            });
            setGuildGroups(Array.isArray(msg.groups) ? msg.groups : []);
            setGuildMembers(Array.isArray(msg.members) ? msg.members : []);
            completed = true;
          } else if (msg.type === 'error') {
            throw new Error(msg.error ?? 'Unable to load guild members.');
          }
        }
      }

      if (!completed) {
        throw new Error('Member load ended before completion.');
      }
    } catch (err) {
      setGuildMembers([]);
      setGuildMembersError(err instanceof Error ? err.message : 'Unable to load guild members.');
    } finally {
      setGuildMembersLoading(false);
    }
  };

  const loadMemberCivData = async (member: AdminMember) => {
    const id = member.id;
    setMemberCivData(prev => {
      if (prev[id]) return prev;
      return { ...prev, [id]: { characters: [], vehicles: [], weapons: [], loading: true, error: null } };
    });
    try {
      const u = encodeURIComponent(member.username);
      const [chars, vehs, weps] = await Promise.all([
        fetch(`/api/civilian/characters?username=${u}`).then(r => r.json()),
        fetch(`/api/civilian/vehicles?username=${u}`).then(r => r.json()),
        fetch(`/api/civilian/weapons?username=${u}`).then(r => r.json()),
      ]);
      setMemberCivData(prev => ({
        ...prev,
        [id]: { characters: chars as CivCharacter[], vehicles: vehs as CivVehicle[], weapons: weps as CivWeapon[], loading: false, error: null },
      }));
    } catch {
      setMemberCivData(prev => ({
        ...prev,
        [id]: { characters: [], vehicles: [], weapons: [], loading: false, error: 'Failed to load civilian data.' },
      }));
    }
  };

  const handleStartCivEdit = (type: 'character' | 'vehicle' | 'weapon', item: CivCharacter | CivVehicle | CivWeapon) => {
    setEditingCivItem({ type, id: item.id });
    if (type === 'character') {
      const c = item as CivCharacter;
      setCivEditDraft({ first_name: c.first_name, last_name: c.last_name, dob: c.dob ?? '', gender: c.gender ?? '', address: c.address ?? '', notes: c.notes ?? '', wanted: c.wanted });
    } else if (type === 'vehicle') {
      const v = item as CivVehicle;
      setCivEditDraft({ plate: v.plate, make: v.make, model: v.model, year: v.year ?? '', color: v.color ?? '', registered: v.registered, stolen: v.stolen });
    } else {
      const w = item as CivWeapon;
      setCivEditDraft({ weapon_type: w.weapon_type, serial_number: w.serial_number ?? '', registered: w.registered });
    }
  };

  const handleSaveCivItem = async (memberId: number) => {
    if (!editingCivItem) return;
    const { type, id } = editingCivItem;
    setSavingCivItemId(id);
    try {
      const endpoint = type === 'character' ? 'characters' : type === 'vehicle' ? 'vehicles' : 'weapons';
      const res = await fetch(`/api/civilian/${endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(civEditDraft),
      });
      const updated = await res.json();
      setMemberCivData(prev => {
        const d = prev[memberId];
        if (!d) return prev;
        return {
          ...prev,
          [memberId]: {
            ...d,
            characters: type === 'character' ? d.characters.map(c => c.id === id ? { ...c, ...updated } : c) : d.characters,
            vehicles:   type === 'vehicle'   ? d.vehicles.map(v => v.id === id ? { ...v, ...updated } : v)   : d.vehicles,
            weapons:    type === 'weapon'    ? d.weapons.map(w => w.id === id ? { ...w, ...updated } : w)     : d.weapons,
          },
        };
      });
      setEditingCivItem(null);
    } catch {
      toast.error('Failed to save changes.');
    } finally {
      setSavingCivItemId(null);
    }
  };

  const handleDeleteCivItem = async (type: 'character' | 'vehicle' | 'weapon', id: number, memberId: number) => {
    setDeletingCivItemId(id);
    try {
      const endpoint = type === 'character' ? 'characters' : type === 'vehicle' ? 'vehicles' : 'weapons';
      await fetch(`/api/civilian/${endpoint}/${id}`, { method: 'DELETE' });
      setMemberCivData(prev => {
        const d = prev[memberId];
        if (!d) return prev;
        return {
          ...prev,
          [memberId]: {
            ...d,
            characters: type === 'character' ? d.characters.filter(c => c.id !== id) : d.characters,
            vehicles:   type === 'vehicle'   ? d.vehicles.filter(v => v.id !== id)   : d.vehicles,
            weapons:    type === 'weapon'    ? d.weapons.filter(w => w.id !== id)     : d.weapons,
          },
        };
      });
      setConfirmingDeleteCivItem(null);
    } catch {
      toast.error('Failed to delete item.');
    } finally {
      setDeletingCivItemId(null);
    }
  };

  useEffect(() => {
    const initializeMembers = async () => {
      const session = getCadSession();

      if (!session) {
        navigate('/', { replace: true });
        return;
      }

      // Dynamic access check: prefer group config, fall back to hardcoded list
      let hasAccess = isSuperAdminSession(session);
      if (!hasAccess) {
        try {
          const grpRes = await fetch('/api/staff/groups', { headers: { accept: 'application/json' } });
          if (grpRes.ok) {
            const grps = await grpRes.json() as Array<{ name: string; admin_access: boolean }>;
            const userGrp = grps.find(g => g.name.toLowerCase() === (session.staff_role ?? session.role).trim().toLowerCase());
            hasAccess = userGrp?.admin_access ?? false;
          }
        } catch {
          hasAccess = false;
        }
      }
      if (!hasAccess) {
        toast.error('Admin portal access requires an admin-level role.');
        navigate('/portal_dashboard', { replace: true });
        return;
      }

      // Refresh permissions from server so tab access flags are current
      let activeSession = session;
      try {
        const statusRes = await fetch('/api/cad-auth/session-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ id: session.id, email: session.email }),
        });
        if (statusRes.ok) {
          const status = await statusRes.json() as { active?: boolean; account?: CadSession };
          if (status.active && status.account) {
            activeSession = { ...session, ...status.account };
            setCadSession(activeSession);
          }
        }
      } catch { /* keep local session */ }

      setCurrentAdmin(activeSession);

      // Load CAD member list (for staff-roster operations) and guild members (for Members tab)
      try {
        setMembers(await loadMembers());
        setError(null);
      } catch (membersError) {
        setMembers([]);
        setError(membersError instanceof Error ? membersError.message : 'Unable to load all CAD member accounts.');
      } finally {
        setIsLoading(false);
      }
      // Guild members load independently  -  failure is shown inline on the tab
      void loadGuildMembers();
    };

    initializeMembers();
    loadAnnouncements();

    // Load initial CAD status
    fetch('/api/settings/cad-status', { headers: { accept: 'application/json' } })
      .then((r) => r.json())
      .then((d: { mode?: string; online?: boolean }) => {
        if (d.mode === 'online' || d.mode === 'members_locked' || d.mode === 'lockdown') {
          setCadMode(d.mode);
        } else {
          setCadMode(d.online === false ? 'lockdown' : 'online');
        }
      })
      .catch(() => setCadMode('online'));
  }, [adminCode, navigate]);

  const handleSetCadMode = async (mode: CadMode) => {
    setConfirmingCadAction(null);
    setIsTogglingCad(true);
    try {
      const res = await fetch('/api/settings/cad-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-code': adminCode },
        body: JSON.stringify({ mode, actor: currentAdmin?.username ?? 'Admin' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json() as { mode?: CadMode };
      setCadMode(data.mode === 'online' || data.mode === 'members_locked' || data.mode === 'lockdown' ? data.mode : mode);
      toast.success(
        mode === 'online'
          ? 'CAD is now online. Members can sign in.'
          : mode === 'members_locked'
            ? 'Members Locked. Staff can still sign in.'
            : 'Lockdown on. Everyone including staff is blocked except superadmins and authorised staff.',
      );
    } catch {
      toast.error('Failed to update CAD status. Please try again.');
    } finally {
      setIsTogglingCad(false);
    }
  };

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [profileOpen]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    clearCadSession();
    sessionStorage.removeItem(ADMIN_CODE_STORAGE_KEY);
    toast.success('Signed out of the admin portal.');
    navigate('/', { replace: true });
  };

  const handleDeleteAllAccounts = async () => {
    setConfirmingDeleteAll(false);
    setIsDeletingAccounts(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/members', {
        method: 'DELETE',
        headers: { 'x-admin-code': adminCode, accept: 'application/json', 'x-actor': currentAdmin?.username ?? 'Admin' },
      });
      const contentType = response.headers.get('content-type') ?? '';

      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('Unable to delete signup accounts from shared MDT storage.');
      }

      const result = (await response.json()) as {
        deleted_count?: number;
        protected_count?: number;
        deleted_ids?: number[];
      };
      const deletedIds = result.deleted_ids ?? [];
      const currentSession = getCadSession();
      removeCadLocalAccountsByIds(deletedIds);
      setMembers(await loadMembers());
      setExpandedMemberId(null);
      setEditingMemberId(null);
      setEditForm(null);
      toast.success(
        `Deleted ${result.deleted_count ?? 0} account${result.deleted_count === 1 ? '' : 's'} and kept ${
          result.protected_count ?? 0
        } protected admin account${result.protected_count === 1 ? '' : 's'}.`,
      );
      void loadGuildMembers();

      if (currentSession && deletedIds.includes(currentSession.id)) {
        clearCadSession();
        sessionStorage.removeItem(ADMIN_CODE_STORAGE_KEY);
        navigate('/', { replace: true });
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete signup accounts.');
    } finally {
      setIsDeletingAccounts(false);
    }
  };

  const handleStartEdit = (member: AdminMember) => {
    setExpandedMemberId(member.id);
    setEditingMemberId(member.id);
    setEditForm(toEditForm(member));
  };

  const handleCancelEdit = () => {
    setEditingMemberId(null);
    setEditForm(null);
  };

  const updateMember = async (memberId: number, updates: EditMemberForm) => {
    const response = await fetch('/api/admin/members', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-admin-code': adminCode,
        accept: 'application/json',
      },
      body: JSON.stringify({ id: memberId, ...updates, actor: currentAdmin?.username ?? 'Admin' }),
    });
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok || !contentType.includes('application/json')) {
      throw new Error('Unable to save account changes.');
    }

    const updatedMember = (await response.json()) as AdminMember;
    setMembers((current) => current.map((member) => (member.id === updatedMember.id ? updatedMember : member)));
    return updatedMember;
  };

  const handleSaveEdit = async (event: FormEvent<HTMLFormElement>, memberId: number) => {
    event.preventDefault();

    if (!editForm) {
      return;
    }

    setSavingMemberId(memberId);
    setError(null);

    try {
      const updatedMember = await updateMember(memberId, editForm);
      setEditingMemberId(null);
      setEditForm(null);
      toast.success(`Updated ${updatedMember.username}.`);
      void loadGuildMembers();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save account changes.');
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleDeleteMember = async (member: AdminMember) => {
    if (hasAdminRole(member.staff_role ?? member.role)) return;
    setConfirmingDeleteMemberId(null);
    setDeletingMemberId(member.id);
    setError(null);

    try {
      const response = await fetch(`/api/admin/members?id=${member.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-code': adminCode, accept: 'application/json', 'x-actor': currentAdmin?.username ?? 'Admin' },
      });
      const contentType = response.headers.get('content-type') ?? '';

      if (!response.ok || !contentType.includes('application/json')) {
        throw new Error('Unable to delete this account.');
      }

      const result = (await response.json()) as {
        deleted_count?: number;
        protected_count?: number;
        deleted_ids?: number[];
      };
      const deletedIds = result.deleted_ids ?? [];

      if (result.protected_count) {
        toast.error('Executive Board, Management, and Admin accounts cannot be deleted.');
        return;
      }

      removeCadLocalAccountsByIds(deletedIds);
      setMembers((current) => current.filter((candidate) => !deletedIds.includes(candidate.id)));
      setExpandedMemberId((current) => (current && deletedIds.includes(current) ? null : current));
      if (editingMemberId && deletedIds.includes(editingMemberId)) {
        handleCancelEdit();
      }
      toast.success(`Deleted ${member.username}'s account.`);
      void loadGuildMembers();

      const currentSession = getCadSession();
      if (currentSession && deletedIds.includes(currentSession.id)) {
        clearCadSession();
        sessionStorage.removeItem(ADMIN_CODE_STORAGE_KEY);
        navigate('/', { replace: true });
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete this account.');
    } finally {
      setDeletingMemberId(null);
    }
  };

  const updateEditField = (field: keyof EditMemberForm, value: string) => {
    setEditForm((current) => (current ? { ...current, [field]: field === 'auth_user_id' && value === '' ? null : value } : current));
  };

  const handleAssignStaffRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const memberId = Number(staffForm.memberId);
    const member = members.find((candidate) => candidate.id === memberId);
    const rank = (manageableStaffRanks.includes(staffForm.rank as (typeof STAFF_RANKS)[number])
      ? staffForm.rank
      : manageableStaffRanks[0] ?? ''
    ).trim();

    if (!member || !rank) {
      setError('Choose a member and select a staff rank.');
      return;
    }

    const role = getRoleForRank(rank);

    if (getRankLevel(rank, role) <= currentAdminLevel) {
      setError('You can only assign staff ranks below your own rank.');
      return;
    }

    setAssigningStaffMemberId(member.id);
    setError(null);

    try {
      const updatedMember = await updateMember(member.id, { ...toEditForm(member), rank, role });
      setStaffForm({ memberId: '', rank: 'Administrator' });
      setStaffMemberSearch('');
      toast.success(`${updatedMember.username} was added to the staff team as ${updatedMember.staff_rank ?? updatedMember.rank} under ${updatedMember.staff_role ?? updatedMember.role}.`);
    } catch (staffError) {
      setError(staffError instanceof Error ? staffError.message : 'Unable to add this member to staff.');
    } finally {
      setAssigningStaffMemberId(null);
    }
  };

  const handleUpdateStaffRank = async (member: AdminMember) => {
    if (!canManageStaffMember(currentAdmin, member)) {
      toast.error('You can only manage staff below your own rank.');
      return;
    }

    const rank = staffRankDrafts[member.id] ?? member.rank;
    const role = getRoleForRank(rank);

    if (getRankLevel(rank, role) <= currentAdminLevel) {
      toast.error('You can only assign staff ranks below your own rank.');
      return;
    }

    setAssigningStaffMemberId(member.id);
    setError(null);

    try {
      const updatedMember = await updateMember(member.id, { ...toEditForm(member), rank, role });
      toast.success(`${updatedMember.username} is now ${updatedMember.staff_rank ?? updatedMember.rank} under ${updatedMember.staff_role ?? updatedMember.role}.`);
    } catch (staffError) {
      setError(staffError instanceof Error ? staffError.message : 'Unable to update this staff member.');
    } finally {
      setAssigningStaffMemberId(null);
    }
  };

  const handleRemoveStaffMember = async (member: AdminMember) => {
    if (!canManageStaffMember(currentAdmin, member)) {
      toast.error('You can only remove staff below your own rank.');
      return;
    }
    setConfirmingRemoveStaffId(null);
    setAssigningStaffMemberId(member.id);
    setError(null);

    try {
      const updatedMember = await updateMember(member.id, { ...toEditForm(member), rank: 'member', role: 'Community Members' });
      setStaffRankDrafts((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });
      toast.success(`${updatedMember.username} was removed from the staff team.`);
    } catch (staffError) {
      setError(staffError instanceof Error ? staffError.message : 'Unable to remove this staff member.');
    } finally {
      setAssigningStaffMemberId(null);
    }
  };

  // -- Staff Roster fetch & handlers ----
  const fetchStaffRoster = async () => {
    setStaffRosterLoading(true);
    try {
      const [grps, rnks, mems] = await Promise.all([
        fetch('/api/staff/groups',  { headers: { accept: 'application/json' } }).then(r => r.json()),
        fetch('/api/staff/ranks',   { headers: { accept: 'application/json' } }).then(r => r.json()),
        fetch('/api/staff/roster?all=1', { headers: { accept: 'application/json' } }).then(r => r.json()),
      ]);
      setStaffGroups(Array.isArray(grps) ? grps as StaffGroup[] : []);
      setStaffRanks(Array.isArray(rnks)  ? rnks as StaffRank[]  : []);
      setStaffRosterMembers(Array.isArray(mems) ? mems as StaffMember[] : []);
    } catch {
      toast.error('Failed to load staff roster.');
    } finally {
      setStaffRosterLoading(false);
    }
  };

  const handleAddStaffGroup = async () => {
    const name = newStaffGroupName.trim();
    if (!name) return;
    setAddingStaffGroup(true);
    try {
      const res = await fetch('/api/staff/groups', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, actor: currentAdmin?.username ?? 'Admin' }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add group.'); return; }
      setNewStaffGroupName(''); setAddStaffGroupOpen(false);
      fetchStaffRoster();
    } finally { setAddingStaffGroup(false); }
  };

  const handleRenameStaffGroup = async (id: number) => {
    const name = editingStaffGroupName.trim();
    if (!name) { setEditingStaffGroupId(null); return; }
    const res = await fetch(`/api/staff/groups/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, actor: currentAdmin?.username ?? 'Admin' }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) { toast.error(data.error ?? 'Failed to rename group.'); return; }
    setEditingStaffGroupId(null);
    fetchStaffRoster();
  };

  const handleDeleteStaffGroup = async (id: number, name: string) => {
    if (!confirm(`Delete the "${name}" group? All members in this group will be demoted to Community Members.`)) return;
    const res = await fetch(`/api/staff/groups/${id}`, { method: 'DELETE', headers: { 'x-actor': currentAdmin?.username ?? 'Admin' } });
    const data = await res.json() as { error?: string };
    if (!res.ok) { toast.error(data.error ?? 'Failed to delete group.'); return; }
    toast.success(`"${name}" group deleted.`);
    fetchStaffRoster();
  };

  const handleToggleGroupAccess = async (id: number, field: 'staff_access' | 'admin_access' | 'doc_access', value: boolean) => {
    try {
      const res = await fetch(`/api/staff/groups/${id}/access`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-discord-id': currentAdmin?.discord_id ?? '',
          'x-actor': currentAdmin?.username ?? 'Admin',
        },
        body: JSON.stringify({ [field]: value, actor: currentAdmin?.username ?? 'Admin' }),
      });
      const data = await res.json() as StaffGroup & { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to update access.'); return; }
      setStaffGroups(prev => prev.map(g => g.id === id ? { ...g, ...data } : g));
    } catch {
      toast.error('Failed to update access.');
    }
  };

  const handleToggleStaffIabAccess = async (memberId: number, enabled: boolean) => {
    const member = staffRosterMembers.find(m => m.id === memberId);
    if (!member) return;
    setIabAccessSavingId(memberId);
    setStaffRosterMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, can_access_iab: enabled } : m
    ));
    try {
      const res = await fetch(`/api/staff/roster/${memberId}/iab-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          can_access_iab: enabled,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      const data = await res.json() as { can_access_iab?: boolean; error?: string };
      if (!res.ok) {
        setStaffRosterMembers(prev => prev.map(m =>
          m.id === memberId ? { ...m, can_access_iab: !enabled } : m
        ));
        toast.error(data.error ?? 'Failed to update Internal Affairs access.');
        return;
      }
      const nextFlag = Boolean(data.can_access_iab);
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, can_access_iab: nextFlag } : m
      ));
      if (currentAdmin && currentAdmin.id === memberId) {
        const next = { ...currentAdmin, can_access_iab: nextFlag };
        setCurrentAdmin(next);
        setCadSession(next);
      }
      toast.success(nextFlag
        ? `${member.username} granted DPS Internal Affairs access.`
        : `${member.username} Internal Affairs access revoked.`);
    } catch {
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, can_access_iab: !enabled } : m
      ));
      toast.error('Failed to update Internal Affairs access.');
    } finally {
      setIabAccessSavingId(null);
    }
  };

  const handleToggleStaffTerminalOfflineAccess = async (
    memberId: number,
    enabled: boolean,
  ) => {
    const member = staffRosterMembers.find(m => m.id === memberId);
    if (!member) return;
    setTerminalAccessSavingId(memberId);
    setStaffRosterMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, can_access_terminal_offline: enabled } : m
    ));
    try {
      const res = await fetch(`/api/staff/roster/${memberId}/terminal-offline-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          can_access_terminal_offline: enabled,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      const data = await res.json() as { can_access_terminal_offline?: boolean; error?: string };
      if (!res.ok) {
        setStaffRosterMembers(prev => prev.map(m =>
          m.id === memberId ? { ...m, can_access_terminal_offline: !enabled } : m
        ));
        toast.error(data.error ?? 'Failed to update terminal lockdown access.');
        return;
      }
      const nextFlag = Boolean(data.can_access_terminal_offline);
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, can_access_terminal_offline: nextFlag } : m
      ));
      if (currentAdmin && currentAdmin.id === memberId) {
        const next = { ...currentAdmin, can_access_terminal_offline: nextFlag };
        setCurrentAdmin(next);
        setCadSession(next);
      }
      toast.success(nextFlag ? 'Terminal lockdown access granted.' : 'Terminal lockdown access revoked.');
    } catch {
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, can_access_terminal_offline: !enabled } : m
      ));
      toast.error('Failed to update terminal lockdown access.');
    } finally {
      setTerminalAccessSavingId(null);
    }
  };

  const handleToggleStaffDocDpsCadAccess = async (memberId: number, enabled: boolean) => {
    const member = staffRosterMembers.find(m => m.id === memberId);
    if (!member) return;
    setCadAccessSavingId(memberId);
    setStaffRosterMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, can_access_doc_dps_cad: enabled } : m
    ));
    try {
      const res = await fetch(`/api/staff/roster/${memberId}/doc-dps-cad-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          can_access_doc_dps_cad: enabled,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      const data = await res.json() as { can_access_doc_dps_cad?: boolean; error?: string };
      if (!res.ok) {
        setStaffRosterMembers(prev => prev.map(m =>
          m.id === memberId ? { ...m, can_access_doc_dps_cad: !enabled } : m
        ));
        toast.error(data.error ?? 'Failed to update DOC & DPS CAD access.');
        return;
      }
      const nextFlag = Boolean(data.can_access_doc_dps_cad);
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, can_access_doc_dps_cad: nextFlag } : m
      ));
      if (currentAdmin && currentAdmin.id === memberId) {
        const next = { ...currentAdmin, can_access_doc_dps_cad: nextFlag };
        setCurrentAdmin(next);
        setCadSession(next);
      }
      toast.success(nextFlag
        ? `${member.username} granted DOC & DPS CAD view access.`
        : `${member.username} DOC & DPS CAD view access revoked.`);
    } catch {
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, can_access_doc_dps_cad: !enabled } : m
      ));
      toast.error('Failed to update DOC & DPS CAD access.');
    } finally {
      setCadAccessSavingId(null);
    }
  };

  const handleToggleStaffAdminTabAccess = async (
    memberId: number,
    field: 'can_access_system_logs' | 'can_access_terms_privacy',
    enabled: boolean,
  ) => {
    const member = staffRosterMembers.find(m => m.id === memberId);
    if (!member) return;
    setAdminTabAccessSavingId(memberId);
    setStaffRosterMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, [field]: enabled } : m
    ));
    try {
      const res = await fetch(`/api/staff/roster/${memberId}/admin-tab-access`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          [field]: enabled,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      const data = await res.json() as {
        can_access_system_logs?: boolean;
        can_access_terms_privacy?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setStaffRosterMembers(prev => prev.map(m =>
          m.id === memberId ? { ...m, [field]: !enabled } : m
        ));
        toast.error(data.error ?? 'Failed to update access permission.');
        return;
      }
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId
          ? {
              ...m,
              can_access_system_logs: Boolean(data.can_access_system_logs),
              can_access_terms_privacy: Boolean(data.can_access_terms_privacy),
            }
          : m
      ));
      if (currentAdmin && currentAdmin.id === memberId) {
        const next = {
          ...currentAdmin,
          can_access_system_logs: Boolean(data.can_access_system_logs),
          can_access_terms_privacy: Boolean(data.can_access_terms_privacy),
        };
        setCurrentAdmin(next);
        setCadSession(next);
      }
      const label = field === 'can_access_system_logs'
        ? 'System Logs'
        : 'Terms of Service & Privacy Policy';
      toast.success(enabled
        ? `${member.username} granted ${label} access.`
        : `${member.username} ${label} access revoked.`);
    } catch {
      setStaffRosterMembers(prev => prev.map(m =>
        m.id === memberId ? { ...m, [field]: !enabled } : m
      ));
      toast.error('Failed to update access permission.');
    } finally {
      setAdminTabAccessSavingId(null);
    }
  };

  const handleMoveStaffGroup = async (id: number, direction: 'up' | 'down') => {
    const sorted = [...staffGroups].filter(g => !g.locked).sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(g => g.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const newOrder = [...sorted];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    // locked groups always stay first
    const lockedGroups = staffGroups.filter(g => g.locked);
    const allOrdered = [...lockedGroups, ...newOrder];
    setStaffGroups(prev => {
      const map = new Map(allOrdered.map((g, i) => [g.id, { ...g, sort_order: i }]));
      return prev.map(g => map.get(g.id) ?? g);
    });
    try {
      await fetch('/api/staff/groups/reorder', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: allOrdered.map(g => g.id) }),
      });
    } catch { fetchStaffRoster(); toast.error('Failed to reorder groups.'); }
  };

  const handleAddStaffRank = async (groupId: number) => {
    const name = newStaffRankName.trim();
    if (!name) return;
    setAddingStaffRank(true);
    try {
      const res = await fetch('/api/staff/ranks', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-discord-id': currentAdmin?.discord_id ?? '' },
        body: JSON.stringify({
          name, group_id: groupId,
          discord_role_id: newStaffRankDiscordRole || null,
          actor: currentAdmin?.username ?? 'Admin',
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add rank.'); return; }
      setNewStaffRankName(''); setNewStaffRankDiscordRole(''); setAddStaffRankGroupId(null);
      fetchStaffRoster();
      toast.success(newStaffRankDiscordRole ? 'Rank added and Discord sync triggered.' : 'Rank added.');
    } finally { setAddingStaffRank(false); }
  };

  const handleSyncDiscordRoles = async (opts?: { silent?: boolean }) => {
    setSyncingDiscordRoles(true);
    try {
      const res = await fetch('/api/staff/sync-discord-roles', { method: 'POST' });
      const data = await res.json().catch(() => ({})) as {
        assigned?: number; skipped?: number; removed?: number; errors?: string[]; error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? 'Sync failed.');
      fetchStaffRoster();
      if (!opts?.silent) {
        const assigned = data.assigned ?? 0;
        const removed = data.removed ?? 0;
        const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
        if (errCount > 0) {
          toast.error(`Discord sync finished with ${errCount} error(s). Added ${assigned}, removed ${removed}.`);
        } else {
          toast.success(`Discord sync complete — added ${assigned}, removed ${removed}.`);
        }
      }
    } catch (err) {
      if (!opts?.silent) {
        toast.error(err instanceof Error ? err.message : 'Sync failed.');
      }
    } finally {
      setSyncingDiscordRoles(false);
    }
  };

  const handleAssignDiscordRoles = async () => {
    setAssigningDiscordRoles(true);
    try {
      const res = await fetch('/api/staff/assign-discord-roles', { method: 'POST' });
      const data = await res.json() as { assigned?: number; skipped?: number; removed?: number; errors?: string[] };
      if (!res.ok) { toast.error(data.errors?.[0] ?? 'Role assignment failed.'); return; }
      const assigned = data.assigned ?? 0;
      const removed = data.removed ?? 0;
      if (assigned > 0 || removed > 0) {
        toast.success(`Discord roles updated — assigned ${assigned}, removed ${removed} stale role(s).`);
      } else {
        toast.success('Scan complete — all members already have the correct roles.');
      }
    } catch { toast.error('Role assignment failed.'); }
    finally { setAssigningDiscordRoles(false); }
  };

  const handleDeleteStaffRank = async (id: number, name: string) => {
    if (!confirm(`Delete the "${name}" rank? Any members with this rank will be demoted.`)) return;
    const res = await fetch(`/api/staff/ranks/${id}`, {
      method: 'DELETE',
      headers: { 'x-actor': currentAdmin?.username ?? 'Admin', 'x-discord-id': currentAdmin?.discord_id ?? '' },
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) { toast.error(data.error ?? 'Failed to delete rank.'); return; }
    toast.success(`"${name}" rank deleted.`);
    fetchStaffRoster();
  };

  const handleMoveStaffRank = async (id: number, groupId: number | null, direction: 'up' | 'down') => {
    const groupRanks = staffRanks.filter(r => r.group_id === groupId).sort((a, b) => a.sort_order - b.sort_order);
    const idx = groupRanks.findIndex(r => r.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= groupRanks.length) return;
    const newOrder = [...groupRanks];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    setStaffRanks(prev => {
      const map = new Map(newOrder.map((r, i) => [r.id, { ...r, sort_order: i }]));
      return prev.map(r => map.get(r.id) ?? r);
    });
    try {
      await fetch('/api/staff/ranks/reorder', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-discord-id': currentAdmin?.discord_id ?? '' },
        body: JSON.stringify({ ids: newOrder.map(r => r.id) }),
      });
    } catch { fetchStaffRoster(); toast.error('Failed to reorder ranks.'); }
  };

  const handleAddToStaffRoster = async () => {
    if (!srAddUserId || !srAddRank) { toast.error('Select a member and a rank.'); return; }
    setSrAddSaving(true);
    try {
      const res = await fetch('/api/staff/roster', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: srAddUserId, rank: srAddRank, actor: currentAdmin?.username ?? 'Admin' }),
      });
      const data = await res.json() as { error?: string; username?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add staff member.'); return; }
      toast.success(`${srAddUsername} added to staff as ${srAddRank}.`);
      setSrAddSearch(''); setSrAddUserId(null); setSrAddUsername(''); setSrAddRank('');
      setStaffRosterAddOpen(false);
      fetchStaffRoster();
      setMembers(await loadMembers());
      void loadGuildMembers();
    } finally { setSrAddSaving(false); }
  };

  const handleUpdateRosterMemberRank = async (member: StaffMember) => {
    if (!rosterMemberEditRank) return;
    setSavingRosterMember(member.id);
    try {
      const res = await fetch(`/api/staff/roster/${member.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rank: rosterMemberEditRank, actor: currentAdmin?.username ?? 'Admin' }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to update rank.'); return; }
      toast.success(`${member.username} updated to ${rosterMemberEditRank}.`);
      setEditingRosterMemberId(null);
      fetchStaffRoster();
      setMembers(await loadMembers());
      void loadGuildMembers();
    } finally { setSavingRosterMember(null); }
  };

  const handleRemoveFromRoster = async (member: StaffMember) => {
    setConfirmRemoveRosterId(null);
    setRemovingRosterMember(member.id);
    try {
      const res = await fetch(`/api/staff/roster/${member.id}`, { method: 'DELETE', headers: { 'x-actor': currentAdmin?.username ?? 'Admin' } });
      if (!res.ok) { toast.error('Failed to remove staff member.'); return; }
      toast.success(`${member.username} removed from staff.`);
      fetchStaffRoster();
      setMembers(await loadMembers());
      void loadGuildMembers();
    } finally { setRemovingRosterMember(null); }
  };

  // -- Staff Roster drag-and-drop handlers (DPS-style) ----
  const handleSrRankReorder = async (
    targetGroupId: number,
    draggedId: number,
    targetId: number | null,
    side: 'before' | 'after'
  ) => {
    const draggedRank = staffRanks.find(r => r.id === draggedId);
    if (!draggedRank || draggedId === targetId) return;
    const targetGroup = staffGroups.find(g => g.id === targetGroupId);
    const sourceGroup = staffGroups.find(g => g.id === draggedRank.group_id);
    const superAdmin = isSuperAdminSession(currentAdmin);
    // Executive Team (locked) ranks can only be managed by superadmins
    if ((targetGroup?.locked || sourceGroup?.locked) && !superAdmin) return;

    const isCrossGroup = draggedRank.group_id !== targetGroupId;
    const targetGroupRanks = staffRanks
      .filter(r => r.group_id === targetGroupId && r.id !== draggedId)
      .sort((a, b) => a.sort_order - b.sort_order);

    let newOrder: typeof staffRanks;
    if (targetId !== null) {
      const without = [...targetGroupRanks];
      const targetIdx = without.findIndex(r => r.id === targetId);
      const insertAt  = side === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      without.splice(insertAt, 0, draggedRank);
      newOrder = without;
    } else {
      newOrder = [...targetGroupRanks, draggedRank];
    }

    setStaffRanks(prev => [
      ...prev.filter(r => r.id !== draggedId && r.group_id !== targetGroupId),
      ...newOrder.map((r, i) => ({ ...r, group_id: targetGroupId, sort_order: i })),
    ]);

    const discordHdr = { 'content-type': 'application/json', 'x-discord-id': currentAdmin?.discord_id ?? '' };
    try {
      if (isCrossGroup) {
        const mv = await fetch(`/api/staff/ranks/${draggedId}`, {
          method: 'PATCH', headers: discordHdr,
          body: JSON.stringify({ group_id: targetGroupId }),
        });
        if (!mv.ok) throw new Error('move failed');
      }
      const ro = await fetch('/api/staff/ranks/reorder', {
        method: 'POST', headers: discordHdr,
        body: JSON.stringify({ ids: newOrder.map(r => r.id) }),
      });
      if (!ro.ok) throw new Error('reorder failed');
    } catch {
      fetchStaffRoster();
      toast.error('Failed to move rank.');
    }
  };

  const handleSrGroupReorder = (draggedId: number, targetId: number, side: 'before' | 'after') => {
    const draggedGroup = staffGroups.find(g => g.id === draggedId);
    const targetGroup  = staffGroups.find(g => g.id === targetId);
    if (!draggedGroup || draggedGroup.locked || targetGroup?.locked) return;

    const sorted  = [...staffGroups].sort((a, b) => a.sort_order - b.sort_order);
    const dragged = sorted.find(g => g.id === draggedId);
    if (!dragged) return;
    const rest      = sorted.filter(g => g.id !== draggedId);
    const targetIdx = rest.findIndex(g => g.id === targetId);
    if (targetIdx < 0) return;
    rest.splice(side === 'before' ? targetIdx : targetIdx + 1, 0, dragged);
    const updated = rest.map((g, i) => ({ ...g, sort_order: i }));
    setStaffGroups(updated);
    fetch('/api/staff/groups/reorder', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: updated.map(g => g.id) }),
    }).catch(() => { fetchStaffRoster(); toast.error('Failed to reorder groups.'); });
  };

  const memberSearchTerm = memberSearch.trim().toLowerCase();
  const filteredGuildMembers = guildMembers
    .filter((gm) =>
      [gm.discord_username, gm.nickname ?? '', gm.discord_id, gm.cad_rank ?? '',
       ...(gm.discord_roles ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(memberSearchTerm),
    )
    .sort((a, b) => {
      // Staff (has cad_rank) always first
      const aStaff = a.cad_rank !== null ? 0 : 1;
      const bStaff = b.cad_rank !== null ? 0 : 1;
      if (aStaff !== bStaff) return aStaff - bStaff;
      return (a.nickname ?? a.discord_username).localeCompare(b.nickname ?? b.discord_username);
    });
  // Keep legacy filtered/staff lists for any dead-code paths that still reference them
  const filteredMembers = filteredGuildMembers.filter(gm => gm.cad_profile !== null).map(gm => gm.cad_profile as AdminMember);
  const currentAdminLevel = currentAdmin ? getRankLevel(currentAdmin.staff_rank ?? currentAdmin.rank, currentAdmin.staff_role ?? currentAdmin.role) : Number.POSITIVE_INFINITY;
  const isSuperAdmin = isSuperAdminSession(currentAdmin);
  const manageableStaffRanks = STAFF_RANKS.filter((rank) => getRankLevel(rank, getRoleForRank(rank)) > currentAdminLevel);
  const staffMembers = members.filter((member) => hasStaffRole(member.staff_role ?? member.role));
  const nonStaffMembers = members.filter((member) => !hasStaffRole(member.staff_role ?? member.role));
  const staffMemberSearchTerm = staffMemberSearch.trim().toLowerCase();
  const filteredStaffAssignableMembers = nonStaffMembers.filter((member) =>
    [member.username, member.rank, member.role, member.email, member.discord_username, member.discord_id]
      .join(' ')
      .toLowerCase()
      .includes(staffMemberSearchTerm),
  );
  const selectedStaffMember = members.find((member) => member.id === Number(staffForm.memberId)) ?? null;
  const staffSearchTerm = staffSearch.trim().toLowerCase();
  const filteredStaffMembers = staffMembers.filter((member) =>
    [member.username, member.rank, member.role, member.email, member.discord_username, member.discord_id]
      .join(' ')
      .toLowerCase()
      .includes(staffSearchTerm),
  );

  const auditLogSearchTerm = auditLogSearch.trim().toLowerCase();
  const auditLogActions = Array.from(new Set(auditLogs.map(l => l.action).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const auditLogActors = Array.from(new Set(auditLogs.map(l => l.actor).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const filteredAuditLogs = auditLogs.filter(log => {
    if (auditLogActionFilter !== 'all' && log.action !== auditLogActionFilter) return false;
    if (auditLogActorFilter !== 'all' && log.actor !== auditLogActorFilter) return false;
    if (!auditLogSearchTerm) return true;
    return [log.actor, log.action, log.details ?? '']
      .join(' ')
      .toLowerCase()
      .includes(auditLogSearchTerm);
  });

  const isAdminSuper = isSuperAdminSession(currentAdmin);
  const canViewSystemLogs = isAdminSuper || Boolean(currentAdmin?.can_access_system_logs);
  const canViewTermsPrivacy = isAdminSuper || Boolean(currentAdmin?.can_access_terms_privacy);

  const staffPermissionOverviewRows = useMemo((): PermissionAccessOverviewRow[] => (
    sortByRankThenUsername(staffRosterMembers, staffRanks, m => m.staff_rank ?? null).map(m => {
      const rankMeta = staffRanks.find(r => r.name.toLowerCase() === (m.staff_rank ?? '').toLowerCase());
      return {
        id: m.id,
        username: m.username,
        subtitle: m.discord_username,
        rankLabel: getStaffRosterTitle(m),
        rankColor: rankMeta?.color_hex ?? null,
        permissions: collectStaffWebsitePermissions(m, staffGroups),
      };
    })
  ), [staffRosterMembers, staffRanks, staffGroups]);

  const adminNavTabs = ([
    { id: 'members' as const, label: 'Members' },
    { id: 'staff-roster' as const, label: 'Staff Roster' },
    { id: 'announcement' as const, label: 'Announcement' },
    { id: 'information-support' as const, label: 'Information & Support' },
    { id: 'staff-resources' as const, label: 'Staff Resources' },
    { id: 'gallery' as const, label: 'Gallery' },
    { id: 'store' as const, label: 'Server Store' },
    { id: 'terminal' as const, label: 'Terminal' },
    { id: 'logs' as const, label: 'System Logs' },
    { id: 'terms-privacy' as const, label: 'Terms of Service & Privacy Policy' },
  ] as { id: AdminTab; label: string }[]).filter(tab => {
    if (tab.id === 'logs') return canViewSystemLogs;
    if (tab.id === 'terms-privacy') return canViewTermsPrivacy;
    return true;
  });

  const pageLoading = isLoading || (
    activeTab === 'members' ? guildMembersLoading
    : activeTab === 'staff-roster' ? staffRosterLoading
    : activeTab === 'information-support' ? infoSupportLoading
    : activeTab === 'terms-privacy' ? legalLoading
    : activeTab === 'staff-resources' ? staffResourcesLoading
    : activeTab === 'gallery' ? galleryLoading
    : activeTab === 'store' ? storeLoading
    : activeTab === 'logs' ? (logsSubTab !== null && auditLogsLoading)
    : false
  );

  const guildLoadDetail = guildLoadProgress.loaded > 0 || guildLoadProgress.total
    ? `${guildLoadProgress.loaded.toLocaleString()}${
        guildLoadProgress.total != null
          ? ` / ~${guildLoadProgress.total.toLocaleString()}`
          : ''
      } members`
    : undefined;

  return (
    <main className="min-h-screen bg-[#02060b] text-white">
      {/* Mobile-only fixed top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[#131f30] bg-[#02060b] px-5 py-3 lg:hidden">
        <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
          <span className={`text-[9px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
            {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="rounded-full px-3 py-2 text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>

      <div className="flex min-h-screen flex-col pt-[53px] lg:flex-row lg:pt-0">
        <aside className="border-b border-[#131f30] bg-[#02060b] px-5 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[265px] lg:flex-col lg:border-b-0 lg:border-r lg:border-[#131f30]">
          <div className="lg:shrink-0">
            <h1 className="text-xl font-black tracking-[-0.04em] text-white">Admin Portal</h1>
            <p className="mt-2 flex items-center gap-2 text-sm font-black leading-none text-[#4384ff]"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#526179]">
              {getStaffSidebarTitle(currentAdmin)}
            </p>
          </div>

          <div className="sidebar-scroll mt-8 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {adminNavTabs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`shrink-0 rounded-md px-4 py-3 text-left text-sm font-semibold capitalize transition-colors ${
                    activeTab === id
                      ? 'border-l-2 border-[#4384ff] bg-[#071120] text-white'
                      : 'text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <button
              type="button"
              onClick={() => navigate('/staff_roster')}
              className="mt-6 flex w-full items-center gap-3 border-t border-[#131f30] px-4 pt-6 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff] lg:mt-5"
            >
              <Users className="h-4 w-4" />
              Staff Roster
            </button>

            <button
              type="button"
              onClick={() => window.open('https://portal.dojrblx.com/', '_blank')}
              className="mt-4 flex w-full items-center gap-3 px-4 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]"
            >
              <Shield className="h-4 w-4" />
              Staff Portal
            </button>

            <button
              type="button"
              onClick={() => navigate('/portal_dashboard')}
              className="mt-4 flex w-full items-center gap-3 px-4 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]"
            >
              <Shield className="h-4 w-4" />
              Member Portal
            </button>
          </div>

          {/* Sign out  -  pinned to bottom of sidebar */}
          <div className="hidden lg:block border-t border-[#131f30] px-3 py-4">
            <button type="button" onClick={handleSignOut} disabled={isSigningOut}
              className="flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60">
              <LogOut className="h-4 w-4" />
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>

        </aside>

        <section className="flex min-h-screen flex-1 flex-col lg:ml-[265px]">
          <header className="relative z-40 hidden items-center justify-between border-b border-[#131f30] bg-[#02060b]/90 px-5 py-4 backdrop-blur-md sm:px-8 lg:flex lg:px-9">
            {/* Left  -  logo */}
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white">
              <DojrpShield className="h-5 w-5" /><DojrpLogo />
            </p>
            {/* Center  -  terminal status */}
            <div className="flex justify-center">
              <div className={`flex items-center gap-2 rounded-full border px-4 py-2 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
                <span className={`h-2 w-2 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
                <span className={`text-[10px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
                  {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
                </span>
              </div>
            </div>
            {/* Right  -  profile avatar */}
            <div className="relative flex justify-end" ref={profileRef}>
              <button type="button" onClick={() => setProfileOpen(o => !o)}
                className="h-9 w-9 overflow-hidden rounded-full border-2 border-[#1b2738] transition-all hover:border-[#4384ff]">
                {currentAdmin?.discord_id && currentAdmin?.avatar_hash
                  ? <img src={`https://cdn.discordapp.com/avatars/${currentAdmin.discord_id}/${currentAdmin.avatar_hash}.png?size=64`} alt="Profile" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  : <div className="flex h-full w-full items-center justify-center bg-[#0f1b28] text-xs font-black text-[#4384ff]">{(currentAdmin?.username ?? '?')[0].toUpperCase()}</div>}
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-11 z-[80] w-56 rounded-xl border border-[#1b2738] bg-[#0b1422] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-[#131f30] px-4 py-3">
                    <p className="text-xs font-black text-white">{currentAdmin?.username}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{getStaffSidebarTitle(currentAdmin)}</p>
                  </div>
                  <button type="button" onClick={() => { setProfileOpen(false); handleSignOut(); }} disabled={isSigningOut}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-bold text-[#ff7070] transition-colors hover:bg-white/5 disabled:opacity-60">
                    <LogOut className="h-4 w-4" />
                    {isSigningOut ? 'Signing out...' : 'Log off'}
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="flex-1 px-5 py-8 sm:px-8 lg:px-9">
            {pageLoading ? (
              <PageLoadingScreen
                loading
                accent="#ff7070"
                label={activeTab === 'members' && guildMembersLoading ? guildLoadProgress.label : 'Loading…'}
                percent={activeTab === 'members' && guildMembersLoading ? guildLoadProgress.percent : undefined}
                detail={activeTab === 'members' && guildMembersLoading ? guildLoadDetail : undefined}
              />
            ) : (
            <>
            <section className="mb-8">
              <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">
                {activeTab === 'members'      ? 'Member Management'
                  : activeTab === 'staff-roster' ? 'Staff Roster'
                  : activeTab === 'announcement' ? 'Announcements'
                  : activeTab === 'information-support' ? 'Information & Support'
                  : activeTab === 'staff-resources' ? 'Staff Resources'
                  : activeTab === 'terms-privacy' ? 'Terms of Service & Privacy Policy'
                  : activeTab === 'gallery'       ? 'Gallery'
                  : activeTab === 'store'         ? 'Server Store'
                  : activeTab === 'logs'          ? 'System Logs'
                  : 'Terminal'}
              </h2>
              <p className="mt-2 text-sm text-[#8392aa] sm:text-base">
                {activeTab === 'members'
                  ? 'View members of the DOJRP Discord server (823606319529066548) — username, Discord ID, website rank, and server roles.'
                  : activeTab === 'staff-roster'
                  ? 'Manage staff rank groups and members. Only superadmins can manage the Executive Team or reorder its ranks.'
                  : activeTab === 'announcement'
                  ? 'Compose and publish announcements visible to all DOJRP CAD members.'
                  : activeTab === 'information-support'
                  ? 'Edit the Information & Support page shown in the Member Portal.'
                  : activeTab === 'staff-resources'
                  ? 'Add, edit, and remove resources shown on the Staff Roster Resources tab.'
                  : activeTab === 'terms-privacy'
                  ? 'Edit the Terms of Service and Privacy Policy shown on the sign-in screen.'
                  : activeTab === 'gallery'
                  ? 'Upload images to the public gallery. Uploaded images are immediately visible on the community index page.'
                  : activeTab === 'store'
                  ? 'Create store product cards for the public index — badge, heading, text, price, picture, footer, and buy button.'
                  : activeTab === 'logs'
                  ? 'Audit trail for admin, DPS, DPH, and DOC actions — including portal content, Terms & Privacy, gallery, store, staff access grants, rosters, and terminal settings.'
                  : 'Manage CAD system settings including online/offline status and access controls.'}
              </p>
            </section>

            
            {activeTab === 'members' && (() => {
              const PAGE_SIZE = 30;
              const totalPages = Math.max(1, Math.ceil(filteredGuildMembers.length / PAGE_SIZE));
              const safePage   = Math.min(memberPage, totalPages);
              const pageStart  = (safePage - 1) * PAGE_SIZE;
              const pagedMembers = filteredGuildMembers.slice(pageStart, pageStart + PAGE_SIZE);
              // Find where staff ends and community begins on this page
              const firstCommunityIdx = pagedMembers.findIndex((gm) => !gm.cad_rank);
              const pageHasStaff      = pagedMembers.some((gm) => !!gm.cad_rank);
              const pageHasCommunity  = firstCommunityIdx !== -1;

              const PaginationBar = () => (
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={safePage === 1}
                    onClick={() => setMemberPage((p) => Math.max(1, p - 1))}
                    className="flex items-center gap-1 rounded-full border border-[#1e3050] bg-[#071120] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#8ea1bb] transition-colors hover:border-[#2f70ff]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <span className="text-center text-[10px] font-bold text-[#526179]">
                    Page {safePage} of {totalPages}
                    <span className="ml-2 text-[#3a5272]">({filteredGuildMembers.length.toLocaleString()} members)</span>
                  </span>
                  <button
                    type="button"
                    disabled={safePage === totalPages}
                    onClick={() => setMemberPage((p) => Math.min(totalPages, p + 1))}
                    className="flex items-center gap-1 rounded-full border border-[#1e3050] bg-[#071120] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#8ea1bb] transition-colors hover:border-[#2f70ff]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              );

              return (
            <section className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
              {/* Header */}
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5 text-[#ff7070]" />
                  <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">
                    Discord Server Members
                  </h3>
                </div>
                <span className="rounded-full border border-[#263247] bg-[#071120] px-3 py-1 text-center text-[10px] font-black uppercase tracking-[0.18em] text-[#8ea1bb]">
                  {filteredGuildMembers.length} / {guildMembers.length} Members
                </span>
              </div>

              {/* Search */}
              <SearchField
                value={memberSearch}
                onChange={(v) => { setMemberSearch(v); setMemberPage(1); }}
                placeholder="Search by username, Discord ID, role, or website rank..."
              />

              {/* States */}
              {guildMembersError ? (
                <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-5 text-sm font-bold text-red-100">
                  {guildMembersError}
                </div>
              ) : guildMembers.length === 0 ? (
                <div className="flex min-h-[280px] items-center justify-center text-sm italic text-[#526179]">
                  No Discord server members found.
                </div>
              ) : filteredGuildMembers.length === 0 ? (
                <div className="flex min-h-[280px] items-center justify-center text-sm italic text-[#526179]">
                  No members match your search.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <PaginationBar />

                  {/* Member rows with staff / community dividers */}
                  <div className="space-y-2">
                    {pagedMembers.map((gm, idx) => {
                      const roles      = gm.discord_roles ?? [];
                      const isExpanded = expandedRoleIds.has(gm.discord_id);
                      const toggleRoles = () =>
                        setExpandedRoleIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(gm.discord_id)) next.delete(gm.discord_id);
                          else next.add(gm.discord_id);
                          return next;
                        });

                      const divider = (
                        <>
                          {/* Staff section header */}
                          {idx === 0 && pageHasStaff && (
                            <div className="mb-1 flex items-center gap-2 pt-1">
                              <Shield className="h-3.5 w-3.5 text-[#4384ff]" />
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#4384ff]">Staff Members</span>
                              <div className="h-px flex-1 bg-[#182232]" />
                            </div>
                          )}
                          {/* Community section header  -  appears at the transition */}
                          {idx === firstCommunityIdx && pageHasStaff && pageHasCommunity && (
                            <div className="mb-1 flex items-center gap-2 pt-2">
                              <Users className="h-3.5 w-3.5 text-[#526179]" />
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#526179]">Community Members</span>
                              <div className="h-px flex-1 bg-[#182232]" />
                            </div>
                          )}
                          {/* Community-only page (no staff at all) */}
                          {idx === 0 && !pageHasStaff && (
                            <div className="mb-1 flex items-center gap-2 pt-1">
                              <Users className="h-3.5 w-3.5 text-[#526179]" />
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#526179]">Community Members</span>
                              <div className="h-px flex-1 bg-[#182232]" />
                            </div>
                          )}
                        </>
                      );

                      return (
                        <div key={gm.discord_id}>
                          {divider}
                          {/* Row */}
                          <div className="overflow-hidden rounded-xl border border-[#1a2638] bg-[#070d16]">
                            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                              {/* Avatar */}
                              <SrDiscordAvatar name={gm.discord_username} discordId={gm.discord_id} avatarHash={gm.avatar_hash} size="md" />

                              {/* Identity */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-black text-white">{gm.nickname ?? gm.discord_username}</p>
                                <p className="mt-0.5 text-[11px] text-[#526179]">@{gm.discord_username}</p>
                                <p className="mt-0.5 font-mono text-[10px] text-[#3a5272]">{gm.discord_id}</p>
                              </div>

                              {/* Right side: rank badge + roles toggle */}
                              <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                                {gm.cad_rank && (
                                  <span className="rounded-full border border-[#2f70ff]/35 bg-[#102145] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#93b4ff]">
                                    {gm.cad_rank}
                                  </span>
                                )}
                                {roles.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={toggleRoles}
                                    className="flex items-center gap-1.5 rounded-full border border-[#1e3050] bg-[#0c1828] px-3 py-1 text-[10px] font-bold text-[#7b9ac4] transition-colors hover:border-[#2f70ff]/40 hover:text-white"
                                  >
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    {roles.length} Role{roles.length !== 1 ? 's' : ''}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Expanded roles panel */}
                            {isExpanded && roles.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 border-t border-[#1a2638] bg-[#050c18] px-5 py-3">
                                {roles.map((role) => (
                                  <span
                                    key={role}
                                    className="rounded-full border border-[#1e3050] bg-[#0c1828] px-2.5 py-1 text-[10px] font-semibold text-[#7b9ac4]"
                                  >
                                    {role}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <PaginationBar />
                </div>
              )}
            </section>
              );
            })()}
            {activeTab === 'staff-roster' && (
              <>
                {/* Modals */}
                {srAddOpen && (
                  <AddStaffMemberModal
                    ranks={staffRanks}
                    onClose={() => setSrAddOpen(false)}
                    onAdd={async (form) => {
                      const body: Record<string, unknown> = {
                        rank: form.rank, status: form.status,
                        appointed_date: form.staff_appointed_date || null,
                        actor: currentAdmin?.username ?? 'Admin',
                      };
                      if (form.userId) {
                        body.id = form.userId;
                      } else {
                        body.discord_id       = form.discordId;
                        body.discord_username = form.discordUsername;
                        body.nick             = form.username;
                      }
                      const res = await fetch('/api/staff/roster', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(body),
                      });
                      const data = await res.json() as { error?: string };
                      if (!res.ok) throw new Error(data.error ?? 'Failed to add staff member.');
                      toast.success(`${form.username} added to staff as ${form.rank}.`);
                      fetchStaffRoster();
                      setMembers(await loadMembers());
                    }}
                  />
                )}
                {srEditMember && (
                  <EditStaffMemberModal
                    member={srEditMember}
                    ranks={staffRanks}
                    onClose={() => setSrEditMember(null)}
                    onSave={async (id, form) => {
                      const res = await fetch(`/api/staff/roster/${id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ rank: form.rank, status: form.status, appointed_date: form.staff_appointed_date || null, actor: currentAdmin?.username ?? 'Admin' }),
                      });
                      const data = await res.json() as { error?: string };
                      if (!res.ok) throw new Error(data.error ?? 'Failed to save.');
                      toast.success('Staff member updated.');
                      fetchStaffRoster();
                      setMembers(await loadMembers());
                    }}
                  />
                )}
                {(() => {
                  const accessMember = srAccessMemberId == null
                    ? null
                    : staffRosterMembers.find(m => m.id === srAccessMemberId) ?? null;
                  if (!accessMember) return null;
                  return (
                    <StaffAccessPermissionsModal
                      member={accessMember}
                      onClose={() => setSrAccessMemberId(null)}
                      iabSaving={iabAccessSavingId === accessMember.id}
                      adminTabSaving={adminTabAccessSavingId === accessMember.id}
                      terminalSaving={terminalAccessSavingId === accessMember.id}
                      cadSaving={cadAccessSavingId === accessMember.id}
                      onToggleIab={enabled => void handleToggleStaffIabAccess(accessMember.id, enabled)}
                      onToggleAdminTab={(field, enabled) => void handleToggleStaffAdminTabAccess(accessMember.id, field, enabled)}
                      onToggleTerminalOffline={enabled => void handleToggleStaffTerminalOfflineAccess(accessMember.id, enabled)}
                      onToggleDocDpsCad={enabled => void handleToggleStaffDocDpsCadAccess(accessMember.id, enabled)}
                    />
                  );
                })()}
                {srEditRank && (
                  <SrRankEditModal
                    rank={srEditRank}
                    discordRoles={staffGuildRoles}
                    onClose={() => setSrEditRank(null)}
                    onSaved={fetchStaffRoster}
                  />
                )}

                {/* -- Main panel card (DPS-style) ---- */}
                <div className="space-y-6">
                <div className="rounded-xl border border-[#ff5d5d]/20 bg-[#070d16] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">

                  {/* Card header */}
                  <div className="flex flex-wrap items-center gap-3 border-b border-[#131f30] px-6 py-4">
                    <Settings className="h-4 w-4 shrink-0 text-[#ff7070]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">Staff Management</h3>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                        <input type="text" placeholder="Search staff..."
                          value={srPanelSearch} onChange={e => setSrPanelSearch(e.target.value)}
                          className="h-9 w-44 rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                      </div>
                      <button type="button" onClick={() => setSrAddOpen(true)}
                        className="flex items-center gap-2 rounded-lg bg-[#2f66ee] px-3.5 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors">
                        <Plus className="h-3.5 w-3.5" />Add Staff Member
                      </button>
                      <button type="button" onClick={() => { setAddStaffGroupOpen(true); setNewStaffGroupName(''); }}
                        className="flex items-center gap-2 rounded-lg border border-[#ff5d5d]/30 bg-[#ff5d5d]/5 px-3.5 py-2 text-xs font-black text-[#ff7070] hover:bg-[#ff5d5d]/10 transition-colors">
                        <Plus className="h-3.5 w-3.5" />Add Title
                      </button>
                      <button type="button" onClick={() => void handleSyncDiscordRoles()} disabled={syncingDiscordRoles}
                        title="Check staff Discord server and add/remove roster members from linked roles"
                        className="flex items-center gap-2 rounded-lg border border-[#3ecf8e]/35 bg-[#3ecf8e]/10 px-3.5 py-2 text-xs font-black text-[#3ecf8e] hover:bg-[#3ecf8e]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <RefreshCw className={`h-3.5 w-3.5 ${syncingDiscordRoles ? 'animate-spin' : ''}`} />
                        {syncingDiscordRoles ? 'Syncing Discord…' : 'Sync Discord'}
                      </button>
                      <button type="button" onClick={handleAssignDiscordRoles} disabled={assigningDiscordRoles}
                        title="CAD rank -> Discord role: scan staff server and grant linked Discord roles"
                        className="flex items-center gap-2 rounded-lg border border-[#4384ff]/30 bg-[#4384ff]/5 px-3.5 py-2 text-xs font-black text-[#4384ff] hover:bg-[#4384ff]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <Link className={`h-3.5 w-3.5 ${assigningDiscordRoles ? 'animate-pulse' : ''}`} />
                        {assigningDiscordRoles ? 'Assigning...' : 'Assign Roles'}
                      </button>
                    </div>
                  </div>

                  {/* -- Titles section ---- */}
                  {(staffGroups.length > 0 || addStaffGroupOpen) && (
                    <div>
                      <div className="flex items-center gap-2 bg-[#070d16] px-6 py-2.5">
                        <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Titles</span>
                        <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{staffGroups.length}</span>
                      </div>

                      <div className="divide-y divide-[#0c1525]">
                          {[...staffGroups].sort((a, b) => a.sort_order - b.sort_order).map((g) => {
                            const canManageGroup = !g.locked || isSuperAdmin;
                            const isRankDrop    = srDragRankId !== null && srDragOverGroupId === g.id && canManageGroup;
                            const isGroupDrop   = srDragGroupId !== null && srDragGroupOverId === g.id;
                            const nonLocked     = [...staffGroups].filter(x => !x.locked).sort((a, b) => a.sort_order - b.sort_order);
                            const nlIdx         = nonLocked.findIndex(x => x.id === g.id);
                            const clearRankDrag = () => { setSrDragRankId(null); setSrDragOverRankId(null); setSrDragOverGroupId(null); };
                            const clearGrpDrag  = () => { setSrDragGroupId(null); setSrDragGroupOverId(null); };
                            return (
                              <div key={g.id}
                                draggable={!g.locked}
                                onDragStart={e => {
                                  if (g.locked) { e.preventDefault(); return; }
                                  if ((e.target as HTMLElement).closest('[data-rank-chip]')) { e.preventDefault(); return; }
                                  setSrDragGroupId(g.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={clearGrpDrag}
                                onDragOver={e => {
                                  if (srDragGroupId !== null && srDragGroupId !== g.id && !g.locked) {
                                    e.preventDefault();
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setSrDragGroupOverId(g.id);
                                    setSrDragGroupOverSide(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
                                    return;
                                  }
                                  if (srDragRankId !== null && canManageGroup) { e.preventDefault(); setSrDragOverGroupId(g.id); }
                                }}
                                onDragLeave={e => {
                                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                    setSrDragOverGroupId(null); setSrDragGroupOverId(null);
                                  }
                                }}
                                onDrop={e => {
                                  e.preventDefault();
                                  if (srDragGroupId !== null && srDragGroupId !== g.id && !g.locked) {
                                    handleSrGroupReorder(srDragGroupId, g.id, srDragGroupOverSide);
                                    clearGrpDrag(); return;
                                  }
                                  if (srDragRankId !== null && canManageGroup) handleSrRankReorder(g.id, srDragRankId, null, 'after');
                                  clearRankDrag();
                                }}
                                style={isGroupDrop && !g.locked ? { boxShadow: srDragGroupOverSide === 'before' ? 'inset 0 3px 0 #ff5d5d' : 'inset 0 -3px 0 #ff5d5d' } : undefined}>

                                <div className={`flex items-center gap-3 px-6 py-2.5 transition-colors group/row ${isRankDrop ? 'bg-[#1a0808] ring-1 ring-inset ring-[#ff5d5d]/30' : 'hover:bg-[#081422]'}`}>
                                  {editingStaffGroupId === g.id ? (
                                    <>
                                      <input autoFocus type="text" value={editingStaffGroupName}
                                        onChange={e => setEditingStaffGroupName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleRenameStaffGroup(g.id); if (e.key === 'Escape') setEditingStaffGroupId(null); }}
                                        className="flex-1 h-7 rounded border border-[#ff5d5d]/40 bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none" />
                                      <button type="button" onClick={() => handleRenameStaffGroup(g.id)}
                                        className="rounded px-2 py-1 text-[10px] font-black bg-[#ff5d5d] text-white hover:bg-[#ff7474] transition-colors">Save</button>
                                      <button type="button" onClick={() => setEditingStaffGroupId(null)}
                                        className="rounded px-2 py-1 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                                    </>
                                  ) : (
                                    <>
                                      {g.locked
                                        ? <Lock className="h-3 w-3 shrink-0 text-[#ff7070] opacity-60" />
                                        : <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab opacity-0 group-hover/row:opacity-40 transition-opacity text-[#526179]" />
                                      }
                                      <span className="text-xs font-black text-[#a8b7cd]">
                                        {g.name}
                                        {g.locked && <span className="ml-2 rounded-full border border-[#ff5d5d]/20 bg-[#ff5d5d]/10 px-1.5 py-0.5 text-[8px] font-black text-[#ff9090]">PERMANENT</span>}
                                        {g.locked && !isSuperAdmin && <span className="ml-2 rounded-full border border-[#3f5470]/30 bg-[#0a1525] px-1.5 py-0.5 text-[8px] font-black text-[#526179]">SUPERADMIN ONLY</span>}
                                      </span>

                                      {/* Rank chips */}
                                      <div className="ml-2 flex flex-1 flex-wrap gap-1"
                                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (srDragRankId && canManageGroup) setSrDragOverGroupId(g.id); }}
                                        onDrop={e => {
                                          e.preventDefault(); e.stopPropagation();
                                          if (srDragRankId !== null && srDragOverRankId === null && canManageGroup) handleSrRankReorder(g.id, srDragRankId, null, 'after');
                                          clearRankDrag();
                                        }}>
                                        {staffRanks.filter(r => r.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order).map(r => {
                                          const chipColor  = r.color_hex ?? null;
                                          const isDragging = srDragRankId === r.id;
                                          const isDropTgt  = srDragOverRankId === r.id && !isDragging && canManageGroup;
                                          const canDrag    = canManageGroup;
                                          const baseStyle: React.CSSProperties = chipColor
                                            ? { borderColor: chipColor + '55', backgroundColor: chipColor + '18', color: chipColor }
                                            : { borderColor: '#1f3050', backgroundColor: '#0a1525', color: '#526179' };
                                          const dropStyle: React.CSSProperties = isDropTgt
                                            ? srDragOverSide === 'before' ? { boxShadow: '-3px 0 0 #ff5d5d' } : { boxShadow: '3px 0 0 #ff5d5d' }
                                            : {};
                                          return (
                                            <button key={r.id} type="button" draggable={canDrag} data-rank-chip
                                              title={canDrag ? `Click to edit  ·  drag to reorder: ${r.name}` : (g.locked ? `${r.name} (superadmin only)` : r.name)}
                                              onClick={() => { if (!srDragRankId && canManageGroup) setSrEditRank(r); }}
                                              onDragStart={e => {
                                                if (!canDrag) { e.preventDefault(); return; }
                                                e.stopPropagation();
                                                setSrDragRankId(r.id);
                                                e.dataTransfer.effectAllowed = 'move';
                                                e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                                              }}
                                              onDragOver={e => {
                                                if (!canManageGroup) return;
                                                e.preventDefault(); e.stopPropagation();
                                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                setSrDragOverRankId(r.id);
                                                setSrDragOverGroupId(g.id);
                                                setSrDragOverSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after');
                                              }}
                                              onDragLeave={() => setSrDragOverRankId(null)}
                                              onDrop={e => {
                                                e.preventDefault(); e.stopPropagation();
                                                if (srDragRankId !== null && canManageGroup) handleSrRankReorder(g.id, srDragRankId, r.id, srDragOverSide);
                                                clearRankDrag();
                                              }}
                                              onDragEnd={clearRankDrag}
                                              className="group/chip flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold select-none transition-all"
                                              style={{ ...baseStyle, ...dropStyle, opacity: isDragging ? 0.35 : 1, cursor: canDrag ? 'grab' : 'default' }}>
                                              {canDrag && <GripVertical className="h-2.5 w-2.5 opacity-20 group-hover/chip:opacity-50 transition-opacity shrink-0" />}
                                              {r.name}
                                              {r.discord_role_id && <span title="Linked to a Discord role"><Link className="h-2 w-2 shrink-0 opacity-50 text-[#4384ff]" /></span>}
                                              {canDrag && (
                                                <>
                                                  <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                  <span role="button" title="Delete rank"
                                                    onClick={e => { e.stopPropagation(); handleDeleteStaffRank(r.id, r.name); }}
                                                    className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-red-400 cursor-pointer leading-none">
                                                    <Trash2 className="h-2.5 w-2.5" />
                                                  </span>
                                                </>
                                              )}
                                            </button>
                                          );
                                        })}
                                        {staffRanks.filter(r => r.group_id === g.id).length === 0 && srDragRankId !== null && canManageGroup && (
                                          <span className="rounded border border-dashed border-[#ff5d5d]/40 px-2 py-0.5 text-[9px] text-[#ff5d5d]/60 select-none">Drop here</span>
                                        )}
                                      </div>

                                      {/* Add Rank button */}
                                      {canManageGroup && (
                                        <button type="button" onClick={() => { setAddStaffRankGroupId(g.id); setNewStaffRankName(''); }}
                                          className="flex shrink-0 items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#ff5d5d]/40 hover:text-[#ff7070] transition-colors">
                                          <Plus className="h-3 w-3" />Rank
                                        </button>
                                      )}

                                      {/* Access toggles */}
                                      <button
                                        type="button"
                                        disabled={!canManageGroup}
                                        title={!canManageGroup ? 'Only superadmins can change Executive Team access' : (g.staff_access ? 'Staff Portal access ON  -  click to revoke' : 'Staff Portal access OFF  -  click to grant')}
                                        onClick={e => { e.stopPropagation(); if (canManageGroup) handleToggleGroupAccess(g.id, 'staff_access', !g.staff_access); }}
                                        className={`shrink-0 rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                          g.staff_access
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                            : 'border-[#1f3050] bg-[#07111f] text-[#3f5470] hover:border-[#526179]/40 hover:text-[#526179]'
                                        }`}>
                                        Staff
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!canManageGroup}
                                        title={!canManageGroup ? 'Only superadmins can change Executive Team access' : (g.admin_access ? 'Admin Portal access ON  -  click to revoke' : 'Admin Portal access OFF  -  click to grant')}
                                        onClick={e => { e.stopPropagation(); if (canManageGroup) handleToggleGroupAccess(g.id, 'admin_access', !g.admin_access); }}
                                        className={`shrink-0 rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                          g.admin_access
                                            ? 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                                            : 'border-[#1f3050] bg-[#07111f] text-[#3f5470] hover:border-blue-500/20 hover:text-[#526179]'
                                        }`}>
                                        Admin
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!canManageGroup}
                                        title={!canManageGroup ? 'Only superadmins can change Executive Team access' : (g.doc_access ? 'DOC access ON  -  click to revoke' : 'DOC access OFF  -  click to grant')}
                                        onClick={e => { e.stopPropagation(); if (canManageGroup) handleToggleGroupAccess(g.id, 'doc_access', !g.doc_access); }}
                                        className={`shrink-0 rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                          g.doc_access
                                            ? 'border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20'
                                            : 'border-[#1f3050] bg-[#07111f] text-[#3f5470] hover:border-violet-500/20 hover:text-[#526179]'
                                        }`}>
                                        DOC
                                      </button>

                                      {/* Group hover actions (non-locked only) */}
                                      {!g.locked && (
                                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                          <button type="button" title="Rename" onClick={() => { setEditingStaffGroupId(g.id); setEditingStaffGroupName(g.name); }}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-[#ff7070] transition-colors">
                                            <Pencil className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move up" onClick={() => handleMoveStaffGroup(g.id, 'up')} disabled={nlIdx <= 0}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronUp className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Move down" onClick={() => handleMoveStaffGroup(g.id, 'down')} disabled={nlIdx >= nonLocked.length - 1}
                                            className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                                            <ChevronDown className="h-3 w-3" />
                                          </button>
                                          <button type="button" title="Delete title" onClick={() => handleDeleteStaffGroup(g.id, g.name)}
                                            className="rounded p-1 text-[#3f5470] hover:bg-red-500/10 hover:text-red-400 transition-colors">
                                            <Trash2 className="h-3 w-3" />
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>

                                {/* Add rank inline form */}
                                {addStaffRankGroupId === g.id && (
                                  <div className="border-t border-[#0c1525] bg-[#060c18] px-6 py-3 space-y-2">
                                    {/* Name row */}
                                    <div className="flex items-center gap-2">
                                      <input autoFocus type="text" placeholder="Rank name..."
                                        value={newStaffRankName} onChange={e => setNewStaffRankName(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleAddStaffRank(g.id); if (e.key === 'Escape') { setAddStaffRankGroupId(null); setNewStaffRankDiscordRole(''); } }}
                                        className="flex-1 h-8 rounded border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#ff5d5d]/60" />
                                      <button type="button" onClick={() => handleAddStaffRank(g.id)} disabled={addingStaffRank || !newStaffRankName.trim()}
                                        className="rounded border border-[#ff5d5d]/40 bg-[#ff5d5d]/10 px-3 py-1.5 text-[10px] font-black text-[#ff7070] hover:bg-[#ff5d5d]/20 transition-colors disabled:opacity-40">
                                        {addingStaffRank ? 'Adding...' : 'Add'}
                                      </button>
                                      <button type="button" onClick={() => { setAddStaffRankGroupId(null); setNewStaffRankDiscordRole(''); }}
                                        className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                    {/* Discord role link row */}
                                    <div className="flex items-center gap-2">
                                      <Link className="h-3 w-3 shrink-0 text-[#3f5470]" />
                                      <select
                                        value={newStaffRankDiscordRole}
                                        onChange={e => setNewStaffRankDiscordRole(e.target.value)}
                                        className="flex-1 h-7 rounded border border-[#1f3050] bg-[#07111f] px-2 text-[10px] font-semibold text-white outline-none focus:border-[#4384ff]/60"
                                        disabled={staffGuildRolesLoading}
                                      >
                                        <option value="">{staffGuildRolesLoading ? 'Loading Discord roles...' : 'No Discord role link (optional)'}</option>
                                        {staffGuildRoles.map(role => (
                                          <option key={role.id} value={role.id}>{role.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Add Title inline form */}
                          {addStaffGroupOpen && (
                            <div className="flex items-center gap-2 bg-[#060c18] px-6 py-3">
                              <input autoFocus type="text" placeholder="Title name..."
                                value={newStaffGroupName} onChange={e => setNewStaffGroupName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddStaffGroup(); if (e.key === 'Escape') setAddStaffGroupOpen(false); }}
                                className="flex-1 h-8 rounded border border-[#ff5d5d]/30 bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#ff5d5d]/60" />
                              <button type="button" onClick={handleAddStaffGroup} disabled={addingStaffGroup || !newStaffGroupName.trim()}
                                className="rounded border border-[#ff5d5d]/40 bg-[#ff5d5d]/10 px-3 py-1.5 text-[10px] font-black text-[#ff7070] hover:bg-[#ff5d5d]/20 transition-colors disabled:opacity-40">
                                {addingStaffGroup ? 'Creating...' : 'Create'}
                              </button>
                              <button type="button" onClick={() => setAddStaffGroupOpen(false)}
                                className="rounded p-1.5 text-[#526179] hover:text-white transition-colors">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                    </div>
                  )}

                  {/* Prompt when no titles yet */}
                  {staffGroups.length === 0 && !addStaffGroupOpen && !staffRosterLoading && (
                    <div className="flex items-center gap-3 border-t border-[#131f30] px-6 py-4">
                      <span className="text-xs text-[#3f5470]">No titles yet.</span>
                      <button type="button" onClick={() => { setAddStaffGroupOpen(true); setNewStaffGroupName(''); }}
                        className="text-xs font-black text-[#ff7070] hover:underline">Add your first title -&gt;</button>
                    </div>
                  )}

                  {/* -- Staff member table ---- */}
                  <div className="border-t border-[#131f30]">
                    <button
                      type="button"
                      onClick={() => setSrMembersCollapsed(c => !c)}
                      className="flex w-full items-center gap-2 bg-[#070d16] px-6 py-2.5 text-left hover:bg-[#081422] transition-colors"
                      aria-expanded={!srMembersCollapsed}
                    >
                      <Users className="h-3.5 w-3.5 shrink-0 text-[#ff7070]" />
                      <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Staff Members</span>
                      <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{staffRosterMembers.length}</span>
                      {srMembersCollapsed
                        ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[#526179]" />
                        : <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-[#526179]" />}
                    </button>

                  {!srMembersCollapsed && (() => {
                    const q        = srPanelSearch.toLowerCase();
                    const filtered = sortByRankThenUsername(
                      staffRosterMembers.filter(m =>
                        !q || m.username.toLowerCase().includes(q) || (m.staff_rank ?? '').toLowerCase().includes(q) || (m.discord_username ?? '').toLowerCase().includes(q)
                      ),
                      staffRanks,
                      m => m.staff_rank ?? null,
                    );
                    const fmt = (d: string | null) => {
                      if (!d) return ' - ';
                      try {
                        // Append T12:00:00 so date-only strings (YYYY-MM-DD) are parsed
                        // as local noon rather than UTC midnight (avoids off-by-one day).
                        const s = d.length === 10 ? d + 'T12:00:00' : d;
                        return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                      } catch { return d; }
                    };
                    if (filtered.length === 0) return (
                      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
                        <Users className="h-8 w-8 text-[#1e2e42]" />
                        <p className="text-sm font-bold text-[#3f5470]">{srPanelSearch ? 'No staff members match your search.' : 'No staff members yet.'}</p>
                      </div>
                    );
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[580px] border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-[#131f30]">
                              <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Username</th>
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Rank</th>
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Status</th>
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Appointed</th>
                              <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map(m => {
                              const rankMeta  = staffRanks.find(r => r.name.toLowerCase() === (m.staff_rank ?? '').toLowerCase());
                              const chipColor = rankMeta?.color_hex ?? null;
                              return (
                                <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                  <td className="px-5 py-3.5">
                                    <div className="flex items-center gap-2">
                                      <SrDiscordAvatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                                      <div>
                                        <p className="font-black text-white">{m.username}</p>
                                        {m.discord_username && <p className="text-[10px] text-[#526179]">@{m.discord_username}</p>}
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5">
                                    <span className="text-[10px] font-black" style={{ color: chipColor ?? '#a8b7cd' }}>{getStaffRosterTitle(m)}</span>
                                  </td>
                                  <td className="px-4 py-3.5"><SrStatusBadge status={m.status} /></td>
                                  <td className="px-4 py-3.5 text-[#8392aa]">{fmt(m.staff_appointed_date ?? null)}</td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        title="Access permissions"
                                        onClick={() => setSrAccessMemberId(m.id)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#f4c542]/50 hover:text-[#f4c542] transition-colors"
                                      >
                                        <Lock className="h-3 w-3" />Access
                                      </button>
                                      <button type="button" onClick={() => setSrEditMember(m)}
                                        className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#2f70ff] hover:text-white transition-colors">
                                        <Pencil className="h-3 w-3" />Edit
                                      </button>
                                      <button type="button" disabled={removingRosterMember === m.id}
                                        onClick={async () => {
                                          if (!confirm(`Remove ${m.username} from staff?`)) return;
                                          setRemovingRosterMember(m.id);
                                          try {
                                            const res = await fetch(`/api/staff/roster/${m.id}`, { method: 'DELETE', headers: { 'x-actor': currentAdmin?.username ?? 'Admin' } });
                                            if (!res.ok) { toast.error('Failed to remove.'); return; }
                                            toast.success(`${m.username} removed from staff.`);
                                            fetchStaffRoster(); setMembers(await loadMembers());
                                          } finally { setRemovingRosterMember(null); }
                                        }}
                                        className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-black text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors disabled:opacity-60">
                                        <Trash2 className="h-3 w-3" />{removingRosterMember === m.id ? 'Removing...' : 'Remove'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                  </div>
                </div>

                <PermissionAccessOverview
                  title="Website Permission Access"
                  description="Staff Portal, Admin Portal, DOC, and individual grants (IAB, System Logs, TS & PP, Terminal Lockdown, DOC & DPS CAD)."
                  accentTextClass="text-[#ff7070]"
                  accentBorderClass="border-[#ff5d5d]/20"
                  rows={staffPermissionOverviewRows}
                  emptyMessage="No staff members with website permission grants match your filters."
                />
                </div>
              </>
            )}
            {activeTab === 'announcement' && (
              <section className="space-y-5">
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <Megaphone className="h-5 w-5 text-[#ff7070]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">
                      Post Announcement
                    </h3>
                  </div>
                  <div className="space-y-4">
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Title</span>
                      <input
                        type="text"
                        value={announcementTitle}
                        onChange={(e) => { setAnnouncementTitle(e.target.value); setConfirmingPost(false); }}
                        placeholder="Announcement title..."
                        className="mt-2 h-10 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-[#66748a] focus:border-[#2f70ff]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Message</span>
                      <textarea
                        rows={6}
                        value={announcementMessage}
                        onChange={(e) => { setAnnouncementMessage(e.target.value); setConfirmingPost(false); }}
                        placeholder="Write your announcement here..."
                        className="mt-2 w-full resize-none rounded-md border border-[#27354c] bg-[#101827] px-3 py-2 text-sm font-bold text-white outline-none transition-colors placeholder:text-[#66748a] focus:border-[#2f70ff]"
                      />
                    </label>
                    {confirmingPost ? (
                      <div className="rounded-lg border border-[#ff5d5d]/30 bg-[#ff5d5d]/10 p-4">
                        <p className="mb-3 text-sm font-bold text-red-200">
                          Post this announcement to all members?
                        </p>
                        <p className="mb-4 text-xs text-[#ff9090]"><span className="font-black">Title:</span> {announcementTitle}</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handlePostAnnouncement}
                            disabled={isPostingAnnouncement}
                            className="inline-flex items-center gap-2 rounded-lg bg-[#ff5d5d] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#ff7474] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Megaphone className="h-4 w-4" />
                            {isPostingAnnouncement ? 'Posting...' : 'Confirm Post'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingPost(false)}
                            disabled={isPostingAnnouncement}
                            className="rounded-lg border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setConfirmingPost(true)}
                          disabled={!announcementTitle.trim() || !announcementMessage.trim()}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#ff5d5d] px-5 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#ff7474] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Megaphone className="h-4 w-4" />
                          Post Announcement
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <Megaphone className="h-5 w-5 text-[#ff7070]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">
                      Previous Announcements
                    </h3>
                  </div>
                  {announcements.length === 0 ? (
                    <div className="flex min-h-[120px] items-center justify-center text-center text-sm italic text-[#526179]">
                      No announcements have been posted yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {announcements.map((a) => {
                        const isDeleted = !!a.deleted_at;
                        const isEditing = editingAnnouncementId === a.id;
                        const isSaving = savingAnnouncementId === a.id;
                        const isDeleting = deletingAnnouncementId === a.id;
                        const isConfirmingDelete = confirmingDeleteId === a.id;

                        // Deleted state  -  red card, no actions
                        if (isDeleted) {
                          return (
                            <div key={a.id} className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 opacity-70">
                              <div className="flex items-start justify-between gap-4">
                                <p className="text-sm font-black text-red-300 line-through">{a.title}</p>
                                <span className="shrink-0 text-[10px] font-semibold text-red-400/70">
                                  {new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-sm text-red-300/50 line-through">{a.message}</p>
                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-red-300">
                                  Post Deleted
                                </span>
                                <p className="text-[10px] font-semibold text-red-400/70">
                                  Deleted by {a.deleted_by}  ·  {new Date(a.deleted_at!).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          );
                        }

                        // Edit state
                        if (isEditing) {
                          return (
                            <div key={a.id} className="rounded-lg border border-[#2f70ff]/40 bg-[#070d16] p-4">
                              <div className="space-y-3">
                                <input
                                  type="text"
                                  value={editDraftTitle}
                                  onChange={(e) => setEditDraftTitle(e.target.value)}
                                  className="h-10 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-sm font-bold text-white outline-none transition-colors focus:border-[#2f70ff]"
                                />
                                <textarea
                                  rows={4}
                                  value={editDraftMessage}
                                  onChange={(e) => setEditDraftMessage(e.target.value)}
                                  className="w-full resize-none rounded-md border border-[#27354c] bg-[#101827] px-3 py-2 text-sm font-bold text-white outline-none transition-colors focus:border-[#2f70ff]"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveAnnouncementEdit(a.id)}
                                    disabled={isSaving}
                                    className="rounded-md bg-[#2f70ff] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#4384ff] disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {isSaving ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingAnnouncementId(null)}
                                    disabled={isSaving}
                                    className="rounded-md border border-[#263247] px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // Normal / confirm-delete state
                        return (
                          <div key={a.id} className="rounded-lg border border-[#1a2638] bg-[#070d16] p-4">
                            <div className="flex items-start justify-between gap-4">
                              <p className="text-sm font-black text-white">{a.title}</p>
                              <span className="shrink-0 text-[10px] font-semibold text-[#526179]">
                                {new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-[#8392aa]">{a.message}</p>

                            {isConfirmingDelete ? (
                              <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 p-3">
                                <p className="mb-2 text-xs font-bold text-red-200">Delete this announcement? This cannot be undone.</p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAnnouncement(a.id)}
                                    disabled={isDeleting}
                                    className="rounded-md bg-red-500 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-red-400 disabled:opacity-60"
                                  >
                                    {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingDeleteId(null)}
                                    disabled={isDeleting}
                                    className="rounded-md border border-[#263247] px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 flex items-center justify-between gap-4">
                                <p className="text-[10px] font-semibold text-[#526179]">Posted by {a.posted_by}</p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => { setEditingAnnouncementId(a.id); setEditDraftTitle(a.title); setEditDraftMessage(a.message); }}
                                    disabled={isDeleting}
                                    className="rounded-md border border-[#27354c] bg-[#101827] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:border-[#2f70ff] hover:text-white disabled:opacity-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmingDeleteId(a.id)}
                                    disabled={isDeleting}
                                    className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-red-100 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}
            {activeTab === 'information-support' && (
              <section className="space-y-5">
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Info className="h-5 w-5 text-[#4384ff]" />
                      <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">
                        Edit Information & Support
                      </h3>
                    </div>
                    <button
                      type="button"
                      disabled={infoSupportSaving || infoSupportLoading}
                      onClick={() => void handleSaveInfoSupport()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#4384ff] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#5a94ff] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {infoSupportSaving ? 'Saving…' : 'Save Page'}
                    </button>
                  </div>
                  {infoSupportLoading ? (
                    <div className="flex min-h-[160px] items-center justify-center">
                      <p className="text-sm font-bold text-[#3f5470]">Loading…</p>
                    </div>
                  ) : (
                    <ContentBlocksEditor
                      sections={infoSupportSections}
                      onChange={setInfoSupportSections}
                      accent="#4384ff"
                    />
                  )}
                </div>

                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <Info className="h-5 w-5 text-[#526179]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#8392aa]">
                      Live Preview
                    </h3>
                  </div>
                  {renderContentBlocks(
                    infoSupportSections.filter(b => {
                      if (b.type === 'divider') return true;
                      if (b.type === 'text') return Boolean(b.body.trim());
                      if (b.type === 'thumbnail') return Boolean(b.url.trim());
                      if ('text' in b) return Boolean(b.text.trim());
                      return true;
                    }),
                    {
                      emptyTitle: 'Nothing to preview',
                      emptyHint: 'Add content blocks above to see how the Member Portal page will look.',
                      accent: '#4384ff',
                    },
                  )}
                </div>
              </section>
            )}
            {activeTab === 'terms-privacy' && (
              <section className="space-y-5">
                {legalEditDoc === null ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      {
                        id: 'terms' as const,
                        title: 'Terms of Service',
                        hint: 'Shown under the sign-in popup on the public index.',
                        icon: Scale,
                      },
                      {
                        id: 'privacy' as const,
                        title: 'Privacy Policy',
                        hint: 'Shown under the sign-in popup on the public index.',
                        icon: Shield,
                      },
                    ]).map(({ id, title, hint, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLegalEditDoc(id)}
                        className="group rounded-xl border border-[#131f30] bg-[#070d16] p-6 text-left shadow-[0_22px_55px_rgba(0,0,0,0.22)] transition-colors hover:border-[#2a4060] hover:bg-[#101a2c]"
                      >
                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#ff5d5d]/20 bg-[#ff5d5d]/8">
                          <Icon className="h-5 w-5 text-[#ff7070]" />
                        </div>
                        <h3 className="text-base font-black text-white">{title}</h3>
                        <p className="mt-2 text-xs leading-relaxed text-[#6a7f9a]">{hint}</p>
                        <p className="mt-5 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#ff7070] group-hover:text-[#ff8a8a]">
                          <Pencil className="h-3 w-3" />
                          Edit document
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setLegalEditDoc(null)}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#1e2d42] bg-[#07111f] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#8392aa] transition-colors hover:border-[#2a4060] hover:text-white"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Back to documents
                      </button>
                      <button
                        type="button"
                        disabled={legalSaving || legalLoading}
                        onClick={() => void handleSaveLegalDoc(legalEditDoc)}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#ff5d5d] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#ff7474] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {legalSaving ? 'Saving…' : 'Save Document'}
                      </button>
                    </div>

                    <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                      <div className="mb-5 flex items-center gap-3">
                        {legalEditDoc === 'terms' ? (
                          <Scale className="h-5 w-5 text-[#ff7070]" />
                        ) : (
                          <Shield className="h-5 w-5 text-[#ff7070]" />
                        )}
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">
                          Edit {legalEditDoc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
                        </h3>
                      </div>
                      {legalLoading ? (
                        <div className="flex min-h-[160px] items-center justify-center">
                          <p className="text-sm font-bold text-[#3f5470]">Loading…</p>
                        </div>
                      ) : (
                        <ContentBlocksEditor
                          sections={legalEditDoc === 'terms' ? termsSections : privacySections}
                          onChange={legalEditDoc === 'terms' ? setTermsSections : setPrivacySections}
                          accent="#ff7070"
                        />
                      )}
                    </div>

                    <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                      <div className="mb-5 flex items-center gap-3">
                        <Info className="h-5 w-5 text-[#526179]" />
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#8392aa]">
                          Live Preview
                        </h3>
                      </div>
                      {renderContentBlocks(
                        (legalEditDoc === 'terms' ? termsSections : privacySections).filter(b => {
                          if (b.type === 'divider') return true;
                          if (b.type === 'text') return Boolean(b.body.trim());
                          if (b.type === 'thumbnail') return Boolean(b.url.trim());
                          if ('text' in b) return Boolean(b.text.trim());
                          return true;
                        }),
                        {
                          emptyTitle: 'Nothing to preview',
                          emptyHint: 'Add content blocks above to see how the sign-in document will look.',
                          accent: '#5b8fd9',
                        },
                      )}
                    </div>
                  </>
                )}
              </section>
            )}
            {activeTab === 'staff-resources' && (
              <section className="space-y-5">
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <BookOpen className="h-5 w-5 text-[#ff7070]" />
                      <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">
                        Staff Resources
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStaffNewTitle('');
                        setStaffNewType('document');
                        setStaffUploadFile(null);
                        setStaffAddStep(1);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#ff5d5d] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#ff7474]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Resource
                    </button>
                  </div>

                  {staffResources.length === 0 ? (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                      <BookOpen className="h-8 w-8 text-[#1e2e42]" />
                      <p className="text-sm font-bold text-[#3f5470]">No staff resources yet.</p>
                      <p className="text-xs text-[#3f5470]">Add a document or upload a PDF for staff to view.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#172235]">
                      {staffResources.map(r => (
                        <div key={r.id} className="flex flex-wrap items-center gap-3 py-4">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#ff5d5d]/20 bg-[#ff5d5d]/8">
                            <FileText className="h-4 w-4 text-[#ff7070]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-white">{r.title}</p>
                            <p className="text-[10px] text-[#3f5470]">
                              {r.type === 'pdf' ? 'PDF' : 'Document'} · Updated{' '}
                              {new Date(r.updated_at).toLocaleDateString('en-US', {
                                month: 'short', day: 'numeric', year: 'numeric',
                              })}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (r.type === 'pdf') setStaffOpenPdf(r);
                              else {
                                setStaffOpenDocId(r.id);
                                setStaffOpenDocCanEdit(true);
                              }
                            }}
                            className="rounded-lg border border-[#ff5d5d]/30 bg-[#ff5d5d]/8 px-3 py-1.5 text-[11px] font-black text-[#ff7070] hover:bg-[#ff5d5d]/15"
                          >
                            {r.type === 'pdf' ? 'View' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            disabled={staffResourceDeletingId === r.id}
                            onClick={() => void handleDeleteStaffResource(r.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/8 text-red-400 hover:bg-red-500/15 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            {activeTab === 'gallery' && (
              <section className="space-y-5">

                {/* Upload card */}
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <Upload className="h-5 w-5 text-[#4384ff]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Upload Image</h3>
                  </div>
                  <div className="space-y-4">
                    {/* File picker */}
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Image File</span>
                      <div
                        className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${
                          galleryFile ? 'border-[#2f70ff]/50 bg-[#2f70ff]/5' : 'border-[#27354c] bg-[#101827] hover:border-[#2f70ff]/40'
                        }`}
                        onClick={() => galleryFileRef.current?.click()}
                      >
                        {galleryFile ? (
                          <>
                            <img
                              src={URL.createObjectURL(galleryFile)}
                              alt="preview"
                              className="max-h-40 rounded-lg object-contain"
                            />
                            <p className="text-xs font-bold text-[#8392aa]">{galleryFile.name}</p>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); setGalleryFile(null); if (galleryFileRef.current) galleryFileRef.current.value = ''; }}
                              className="text-[10px] font-black uppercase tracking-[0.15em] text-[#ff7070] hover:text-red-300"
                            >
                              Remove
                            </button>
                          </>
                        ) : (
                          <>
                            <ImageIcon className="h-8 w-8 text-[#3f5470]" />
                            <p className="text-xs font-bold text-[#526179]">Click to choose an image</p>
                            <p className="text-[10px] text-[#3f5470]">JPG, PNG, GIF, WebP  ·  max 8 MB</p>
                          </>
                        )}
                      </div>
                      <input
                        ref={galleryFileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        className="hidden"
                        onChange={e => setGalleryFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Credit <span className="font-normal normal-case text-[#3f5470]">(optional)</span></span>
                      <input
                        type="text"
                        value={galleryCredit}
                        onChange={e => setGalleryCredit(e.target.value)}
                        placeholder="e.g. Photo by Officer Smith"
                        className="mt-2 h-10 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-[#66748a] focus:border-[#2f70ff]"
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleGalleryUpload}
                        disabled={!galleryFile || galleryUploading}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#2f70ff] px-5 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#4384ff] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Upload className="h-4 w-4" />
                        {galleryUploading ? 'Uploading...' : 'Upload to Gallery'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Existing images card */}
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <ImageIcon className="h-5 w-5 text-[#4384ff]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Gallery Images</h3>
                    <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{galleryImages.length}</span>
                  </div>

                  {galleryImages.length === 0 ? (
                    <div className="flex min-h-[120px] items-center justify-center text-center text-sm italic text-[#526179]">
                      No images in the gallery yet. Upload one above.
                    </div>
                  ) : (
                    <>
                      {gallerySavingOrder && (
                        <p className="mb-3 flex items-center gap-2 text-[10px] font-bold text-[#4384ff]">
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#4384ff] border-t-transparent" />
                          Saving order...
                        </p>
                      )}
                      <p className="mb-4 text-[10px] text-[#3f5470]">
                        Drag images to reorder how they appear on the public gallery.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {galleryImages.map((img, idx) => (
                          <div
                            key={img.id}
                            draggable={galleryEditId !== img.id}
                            onDragStart={() => { if (galleryEditId === img.id) return; setGalleryDragIdx(idx); }}
                            onDragEnd={() => { setGalleryDragIdx(null); setGalleryDragOver(null); }}
                            onDragOver={e => { e.preventDefault(); if (galleryDragOver !== idx) setGalleryDragOver(idx); }}
                            onDrop={async e => {
                              e.preventDefault();
                              if (galleryDragIdx === null || galleryDragIdx === idx) {
                                setGalleryDragIdx(null); setGalleryDragOver(null); return;
                              }
                              const next = [...galleryImages];
                              const [moved] = next.splice(galleryDragIdx, 1);
                              next.splice(idx, 0, moved);
                              setGalleryImages(next);
                              setGalleryDragIdx(null);
                              setGalleryDragOver(null);
                              setGallerySavingOrder(true);
                              try {
                                await fetch('/api/public/gallery/reorder', {
                                  method: 'PUT',
                                  headers: { 'content-type': 'application/json', 'x-admin-code': ADMIN_CODE, 'x-actor': currentAdmin?.username ?? 'Admin' },
                                  body: JSON.stringify({ ids: next.map(i => i.id) }),
                                });
                              } catch {
                                toast.error('Failed to save order.');
                              } finally {
                                setGallerySavingOrder(false);
                              }
                            }}
                            className={`group relative overflow-hidden rounded-xl border bg-[#070d16] transition-all ${
                              galleryDragOver === idx && galleryDragIdx !== idx
                                ? 'border-[#4384ff] shadow-[0_0_0_2px_rgba(67,132,255,0.3)]'
                                : 'border-[#1a2638]'
                            } ${galleryDragIdx === idx ? 'opacity-40 scale-95' : 'cursor-grab active:cursor-grabbing'}`}
                          >
                            {/* drag handle */}
                            <div className="absolute left-2 top-2 z-10 rounded-md bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <GripVertical className="h-3.5 w-3.5 text-white" />
                            </div>

                            <div className="aspect-video w-full overflow-hidden">
                              <img
                                src={img.image_url}
                                alt="Gallery image"
                                className="h-full w-full object-cover"
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            </div>
                            <div className="px-4 py-3">
                              {galleryEditId === img.id ? (
                                <div className="space-y-3" onMouseDown={e => e.stopPropagation()}>
                                  <label className="block">
                                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#6f7f99]">Info / Title</span>
                                    <input
                                      type="text"
                                      value={galleryEditTitle}
                                      onChange={e => setGalleryEditTitle(e.target.value)}
                                      placeholder="Optional title shown on the public gallery"
                                      className="mt-1.5 h-9 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-xs font-bold text-white outline-none placeholder:text-[#66748a] focus:border-[#2f70ff]"
                                    />
                                  </label>
                                  <label className="block">
                                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#6f7f99]">Credit</span>
                                    <input
                                      type="text"
                                      value={galleryEditCredit}
                                      onChange={e => setGalleryEditCredit(e.target.value)}
                                      placeholder="e.g. Photo by Officer Smith"
                                      className="mt-1.5 h-9 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-xs font-bold text-white outline-none placeholder:text-[#66748a] focus:border-[#2f70ff]"
                                    />
                                  </label>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleGallerySaveEdit(img.id)}
                                      disabled={gallerySavingId === img.id}
                                      className="rounded-md bg-[#2f70ff] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-[#4384ff] disabled:opacity-60"
                                    >
                                      {gallerySavingId === img.id ? 'Saving...' : 'Save'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setGalleryEditId(null);
                                        setGalleryEditTitle('');
                                        setGalleryEditCredit('');
                                      }}
                                      disabled={gallerySavingId === img.id}
                                      className="rounded-md border border-[#263247] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {img.title
                                    ? <p className="text-[10px] font-black text-white">{img.title}</p>
                                    : null}
                                  {img.caption
                                    ? <p className={`text-[10px] text-[#526179] ${img.title ? 'mt-1' : ''}`}><span className="font-black text-[#6f7f99]">Credit:</span> {img.caption}</p>
                                    : <p className={`text-[10px] italic text-[#3f5470] ${img.title ? 'mt-1' : ''}`}>No credit</p>
                                  }
                                  <p className="mt-1 text-[10px] text-[#2a3a50]">
                                    {new Date(img.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </p>
                                </>
                              )}
                            </div>

                            {galleryEditId === img.id ? null : galleryDeleteId === img.id ? (
                              <div className="px-4 pb-3">
                                <p className="mb-2 text-[10px] font-bold text-red-200">Remove this image?</p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleGalleryDelete(img.id)}
                                    disabled={galleryDeletingId === img.id}
                                    className="rounded-md bg-red-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white transition-colors hover:bg-red-400 disabled:opacity-60"
                                  >
                                    {galleryDeletingId === img.id ? 'Removing...' : 'Confirm'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setGalleryDeleteId(null)}
                                    disabled={galleryDeletingId === img.id}
                                    className="rounded-md border border-[#263247] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-2 px-4 pb-3">
                                <button
                                  type="button"
                                  onClick={() => openGalleryEdit(img)}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#a8b7cd] transition-colors hover:border-[#2f70ff] hover:text-white"
                                >
                                  <Pencil className="h-3 w-3" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setGalleryDeleteId(img.id)}
                                  className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-100 transition-colors hover:bg-red-500/20"
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

              </section>
            )}

            {activeTab === 'store' && (
              <section className="space-y-5">
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ShoppingBag className="h-5 w-5 text-[#4384ff]" />
                      <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">
                        {editingStoreId ? 'Edit Store Product' : 'Create Store Product'}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/public_store')}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#4384ff]/35 bg-[#4384ff]/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#4384ff] transition-colors hover:bg-[#4384ff]/18"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View Index Store
                    </button>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Badge / Label</label>
                          <input type="text" value={storeProductForm.badge_label}
                            onChange={e => setStoreProductForm(p => ({ ...p, badge_label: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Heading</label>
                          <input type="text" value={storeProductForm.heading}
                            onChange={e => setStoreProductForm(p => ({ ...p, heading: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Description Text</label>
                        <StoreDescriptionEditor
                          key={editingStoreId ?? 'new-store-product'}
                          resetKey={editingStoreId ?? 'new'}
                          value={storeProductForm.description}
                          onChange={html => setStoreProductForm(p => ({ ...p, description: html }))}
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Price</label>
                          <input type="text" value={storeProductForm.price}
                            onChange={e => setStoreProductForm(p => ({ ...p, price: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Price Label</label>
                          <input type="text" value={storeProductForm.price_label}
                            onChange={e => setStoreProductForm(p => ({ ...p, price_label: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Money Icon</label>
                        <div className="flex flex-wrap gap-2">
                          {([
                            { id: 'robux' as StorePriceIcon, label: 'Robux' },
                            { id: 'dollar' as StorePriceIcon, label: '$' },
                            { id: 'custom' as StorePriceIcon, label: 'Custom' },
                          ]).map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setStoreProductForm(p => ({
                                ...p,
                                price_icon: opt.id,
                                price_icon_url: opt.id === 'custom' ? p.price_icon_url : '',
                              }))}
                              className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] transition-colors ${
                                storeProductForm.price_icon === opt.id
                                  ? 'border-[#4384ff]/50 bg-[#4384ff]/15 text-[#6ea8ff]'
                                  : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:text-[#a8b7cd]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        {storeProductForm.price_icon === 'custom' ? (
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <input ref={storeIconRef} type="file" accept="image/*" className="hidden"
                              onChange={e => void handleStoreImageUpload(e.target.files?.[0] ?? null, 'icon')} />
                            <button type="button" disabled={storeProductUploading}
                              onClick={() => storeIconRef.current?.click()}
                              className="inline-flex items-center gap-2 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#a8b7cd] transition-colors hover:border-[#2f70ff] hover:text-white disabled:opacity-50">
                              <Upload className="h-3.5 w-3.5" />
                              {storeProductUploading ? 'Uploading…' : 'Upload Icon'}
                            </button>
                            {storeProductForm.price_icon_url ? (
                              <>
                                <img src={storeProductForm.price_icon_url} alt="" className="h-8 w-8 rounded object-contain border border-[#1f3050] bg-[#07111f] p-1" />
                                <button type="button"
                                  onClick={() => setStoreProductForm(p => ({ ...p, price_icon_url: '' }))}
                                  className="text-[10px] font-black uppercase text-red-400 hover:underline">
                                  Clear
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Footer Text</label>
                        <input type="text" value={storeProductForm.footer_text}
                          onChange={e => setStoreProductForm(p => ({ ...p, footer_text: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Button Text</label>
                          <input type="text" value={storeProductForm.button_text}
                            onChange={e => setStoreProductForm(p => ({ ...p, button_text: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Buy Link URL</label>
                          <input type="url" value={storeProductForm.button_url}
                            onChange={e => setStoreProductForm(p => ({ ...p, button_url: e.target.value }))}
                            className="h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]" />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Picture</label>
                        <div className="flex flex-wrap items-center gap-3">
                          <input ref={storeImageRef} type="file" accept="image/*" className="hidden"
                            onChange={e => void handleStoreImageUpload(e.target.files?.[0] ?? null)} />
                          <button type="button" disabled={storeProductUploading}
                            onClick={() => storeImageRef.current?.click()}
                            className="inline-flex items-center gap-2 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#a8b7cd] transition-colors hover:border-[#2f70ff] hover:text-white disabled:opacity-50">
                            <Upload className="h-3.5 w-3.5" />
                            {storeProductUploading ? 'Uploading…' : 'Upload Image'}
                          </button>
                          <input type="url" value={storeProductForm.image_url}
                            onChange={e => setStoreProductForm(p => ({ ...p, image_url: e.target.value }))}
                            className="h-9 min-w-[200px] flex-1 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white outline-none focus:border-[#2f70ff]" />
                          {storeProductForm.image_url ? (
                            <button type="button" onClick={() => setStoreProductForm(p => ({ ...p, image_url: '' }))}
                              className="text-[10px] font-black uppercase text-red-400 hover:underline">Clear</button>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" onClick={() => void handleSaveStoreProduct()}
                          disabled={storeProductSaving || !storeProductForm.heading.trim()}
                          className="h-10 rounded-lg bg-[#2f66ee] px-5 text-xs font-black text-white transition-colors hover:bg-[#3977ff] disabled:cursor-not-allowed disabled:opacity-50">
                          {storeProductSaving ? 'Saving…' : editingStoreId ? 'Save Product' : 'Add Product'}
                        </button>
                        {editingStoreId ? (
                          <button type="button" onClick={resetStoreProductForm}
                            className="h-10 rounded-lg border border-[#1f3050] bg-transparent px-4 text-xs font-black text-[#a8b7cd] hover:text-white">
                            Cancel Edit
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Live Preview</p>
                      <StoreProductCard
                        product={storeProductForm}
                        fallbackBuyUrl={storeUrl}
                        collapsibleDescription
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white">Store Products</h3>
                    <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">
                      {storeProducts.length}
                    </span>
                  </div>
                  {storeProducts.length === 0 ? (
                    <p className="py-8 text-center text-sm font-bold text-[#3f5470]">
                      No products yet. Create one above — it will appear on the index Server Store tab.
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {storeProducts.map(p => (
                        <div key={p.id} className="space-y-2">
                          <StoreProductCard
                            product={p}
                            fallbackBuyUrl={storeUrl}
                            collapsibleDescription
                          />
                          <div className="flex gap-2">
                            <button type="button"
                              onClick={() => {
                                setEditingStoreId(p.id);
                                const icon = (p.price_icon === 'dollar' || p.price_icon === 'custom') ? p.price_icon : 'robux';
                                setStoreProductForm({
                                  badge_label: p.badge_label ?? '',
                                  heading: p.heading ?? '',
                                  description: p.description ?? '',
                                  price: p.price ?? '',
                                  price_label: p.price_label ?? '',
                                  price_icon: icon,
                                  price_icon_url: p.price_icon_url ?? '',
                                  footer_text: p.footer_text ?? '',
                                  button_text: p.button_text ?? '',
                                  button_url: p.button_url ?? '',
                                  image_url: p.image_url ?? '',
                                });
                              }}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-[10px] font-black text-[#a8b7cd] hover:border-[#2f70ff] hover:text-white">
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                            <button type="button" disabled={deletingStoreId === p.id}
                              onClick={() => void handleDeleteStoreProduct(p.id)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] font-black text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                              <Trash2 className="h-3 w-3" /> {deletingStoreId === p.id ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-4 flex items-center gap-3">
                    <Link className="h-4 w-4 text-[#526179]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#a8b7cd]">Default Store Link</h3>
                  </div>
                  <p className="mb-3 text-xs text-[#526179]">
                    Optional fallback buy URL used when a product has no individual Buy Link set.
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="url"
                      value={storeUrlDraft}
                      onChange={e => setStoreUrlDraft(e.target.value)}
                      placeholder=""
                      className="h-10 flex-1 rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#2f70ff]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveStoreUrl()}
                      disabled={storeSaving || storeUrlDraft.trim() === storeUrl.trim()}
                      className="h-10 shrink-0 rounded-lg bg-[#2f66ee] px-5 text-xs font-black text-white transition-colors hover:bg-[#3977ff] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {storeSaving ? 'Saving…' : 'Save Link'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'terminal' && (
              <section className="space-y-5">
                {/* CAD Status Card */}
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)] sm:p-7">
                  <div className="mb-6 flex items-center gap-3">
                    <TerminalIcon className="h-5 w-5 text-[#ff7070]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">
                      CAD System Status
                    </h3>
                  </div>

                  {/* Big status indicator */}
                  <div className="mb-8 flex flex-col items-center gap-4 py-6">
                    <div className={`flex h-20 w-20 items-center justify-center rounded-full border-2 ${
                      cadMode === 'lockdown'
                        ? 'border-red-500/40 bg-red-500/10'
                        : cadMode === 'members_locked'
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-blue-500/40 bg-blue-500/10'
                    }`}>
                      <span className={`h-8 w-8 rounded-full ${
                        cadMode === 'lockdown'
                          ? 'bg-[#ff5d5d] shadow-[0_0_18px_rgba(255,93,93,0.6)]'
                          : cadMode === 'members_locked'
                            ? 'bg-[#f4c542] shadow-[0_0_18px_rgba(244,197,66,0.55)]'
                            : 'bg-[#4384ff] shadow-[0_0_18px_rgba(67,132,255,0.6)]'
                      }`} />
                    </div>
                    <div className="text-center">
                      <p className={`text-2xl font-black tracking-tight ${
                        cadMode === 'lockdown'
                          ? 'text-[#ff7070]'
                          : cadMode === 'members_locked'
                            ? 'text-[#f4c542]'
                            : 'text-[#4384ff]'
                      }`}>
                        {cadMode === null ? 'Loading...' : `Terminal ${cadModeLabel(cadMode)}`}
                      </p>
                      <p className="mt-1 text-sm text-[#526179]">
                        {cadMode === 'lockdown'
                          ? 'Everyone including staff is blocked except superadmins and staff with Terminal lockdown access.'
                          : cadMode === 'members_locked'
                            ? 'Members cannot sign in. Staff can still sign in normally.'
                            : 'CAD is active. All members can sign in normally.'}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  {cadOnline === false ? (
                    confirmingCadAction === 'open' ? (
                      <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-4">
                        <p className="mb-3 text-sm font-bold text-blue-200">Bring the CAD back online? All members will be able to sign in again.</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSetCadMode('online')}
                            disabled={isTogglingCad}
                            className="rounded-md bg-[#4384ff] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#2f70ff] disabled:opacity-60"
                          >
                            {isTogglingCad ? 'Opening...' : 'Confirm Open Terminal'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingCadAction(null)}
                            disabled={isTogglingCad}
                            className="rounded-md border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingCadAction('open')}
                        disabled={isTogglingCad || cadMode === null}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#4384ff] px-6 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#2f70ff] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <TerminalIcon className="h-4 w-4" />
                        Open Terminal
                      </button>
                    )
                  ) : confirmingCadAction === 'members_locked' ? (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4">
                      <p className="mb-3 text-sm font-bold text-amber-100">Lock members out? Staff can still sign in. Members will be blocked until you reopen.</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSetCadMode('members_locked')}
                          disabled={isTogglingCad}
                          className="rounded-md bg-[#f4c542] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#1a1400] transition-colors hover:bg-[#ffd45a] disabled:opacity-60"
                        >
                          {isTogglingCad ? 'Updating...' : 'Confirm Members Locked'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingCadAction(null)}
                          disabled={isTogglingCad}
                          className="rounded-md border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : confirmingCadAction === 'lockdown' ? (
                    <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-4">
                      <p className="mb-3 text-sm font-bold text-red-200">Full lockdown? Everyone including staff is blocked. Only superadmins and staff with Terminal lockdown access (roster) can sign in.</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSetCadMode('lockdown')}
                          disabled={isTogglingCad}
                          className="rounded-md bg-red-500 px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-colors hover:bg-red-400 disabled:opacity-60"
                        >
                          {isTogglingCad ? 'Updating...' : 'Confirm Lockdown'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingCadAction(null)}
                          disabled={isTogglingCad}
                          className="rounded-md border border-[#263247] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#a8b7cd] transition-colors hover:text-white disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => setConfirmingCadAction('members_locked')}
                        disabled={isTogglingCad || cadMode === null}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-6 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Users className="h-4 w-4" />
                        Members Locked
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingCadAction('lockdown')}
                        disabled={isTogglingCad || cadMode === null}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-6 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-red-100 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Lock className="h-4 w-4" />
                        Lockdown
                      </button>
                    </div>
                  )}
                </div>

                {/* Access info */}
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] p-5 sm:p-7">
                  <h3 className="mb-4 text-sm font-black uppercase tracking-[0.2em] text-[#ff7070]">Access Rules</h3>
                  <div className="space-y-3 text-sm text-[#8392aa]">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#4384ff]" />
                      <p><span className="font-bold text-white">Online</span> — All members with valid accounts can sign in.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#f4c542]" />
                      <p><span className="font-bold text-white">Members Locked</span> — Regular members cannot sign in. Staff (anyone on the staff roster) can still sign in.</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#ff5d5d]" />
                      <p><span className="font-bold text-white">Lockdown</span> — Everyone including staff cannot sign in except superadmins and members granted Terminal lockdown access on the staff roster (Access → Terminal Lockdown).</p>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'logs' && !logsSubTab && (() => {
              const LogCard = ({
                id, label, desc, icon, accent, accentBg, buttonLabel,
              }: {
                id: Exclude<LogsSubTab, null>;
                label: string;
                desc: string;
                icon: React.ReactNode;
                accent: string;
                accentBg: string;
                buttonLabel?: string;
              }) => (
                <div className="flex flex-col rounded-xl border border-[#131f30] bg-[#070d16] p-5 shadow-[0_22px_55px_rgba(0,0,0,0.22)]">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: accentBg, color: accent }}>
                      {icon}
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">{label}</p>
                      <p className="mt-0.5 text-xs text-[#526179]">{desc}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogsSubTab(id)}
                    className="mt-auto flex w-full items-center justify-center gap-2 rounded-lg border border-[#1f3050] bg-[#0a1525] py-2.5 text-xs font-black uppercase tracking-[0.1em] text-[#a8b7cd] transition-colors hover:border-[#2f70ff] hover:text-white"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    {buttonLabel ?? `View ${label} Logs`}
                  </button>
                </div>
              );

              return (
              <section className="space-y-6">

                {/* -- Admin Portal Logs ---- */}
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#6f7f99]">Admin Portal Logs</h3>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <LogCard
                    id="members"
                    label="Member Logs"
                    desc="Account edits, deletions, and bulk removals from the Members tab."
                    accent="#f59e0b"
                    accentBg="rgba(245,158,11,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8z" /></svg>}
                  />
                  <LogCard
                    id="staff"
                    label="Staff Roster"
                    desc="Staff groups, ranks, assignments, Discord sync, IAB / System Logs / TS&PP access grants, portal group access, and staff resource changes."
                    accent="#3b82f6"
                    accentBg="rgba(59,130,246,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>}
                  />
                  <LogCard
                    id="announcements"
                    label="Announcements"
                    desc="Posted, edited, and deleted portal announcements."
                    accent="#8b5cf6"
                    accentBg="rgba(139,92,246,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>}
                  />
                  <LogCard
                    id="terminal"
                    label="Terminal"
                    desc="CAD online/offline toggles, Self Dispatch, and Server Store URL changes."
                    accent="#ef4444"
                    accentBg="rgba(239,68,68,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                  />
                  <LogCard
                    id="portal"
                    label="Portal Content"
                    desc="Information & Support, Terms of Service, and Privacy Policy edits."
                    accent="#38bdf8"
                    accentBg="rgba(56,189,248,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                  />
                  <LogCard
                    id="gallery"
                    label="Gallery"
                    desc="Public gallery image uploads, reorders, and deletions."
                    accent="#ec4899"
                    accentBg="rgba(236,72,153,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                  />
                  <LogCard
                    id="store"
                    label="Server Store"
                    desc="Store product cards created, updated, reordered, or removed."
                    accent="#a855f7"
                    accentBg="rgba(168,85,247,0.12)"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>}
                  />
                </div>

                <hr className="border-[#131f30]" />

                {/* -- DPS Logs ---- */}
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#6f7f99]">DPS Logs</h3>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <LogCard
                    id="dps_personnel"
                    label="Personnel Roster"
                    desc="Roster edits, Discord sync, panel/division oversight, resource access, IAB access, and division info/access changes."
                    accent="#f59e0b"
                    accentBg="rgba(245,158,11,0.12)"
                    buttonLabel="View Personnel Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8z" /></svg>}
                  />
                  <LogCard
                    id="dps_vehicles"
                    label="Vehicle Roster"
                    desc="Vehicle additions, updates, and removals in the DPS fleet."
                    accent="#10b981"
                    accentBg="rgba(16,185,129,0.12)"
                    buttonLabel="View Vehicle Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM1 1h4l2.68 13.39a2 2 0 001.98 1.61h9.72a2 2 0 001.98-1.61L23 6H6" /></svg>}
                  />
                  <LogCard
                    id="dps_equipment"
                    label="Equipment Roster"
                    desc="Equipment inventory additions, updates, and deletions."
                    accent="#14b8a6"
                    accentBg="rgba(20,184,166,0.12)"
                    buttonLabel="View Equipment Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
                  />
                  <LogCard
                    id="cad_dispatch"
                    label="CAD Dispatch"
                    desc="Created, updated, unit-changed, and closed dispatch calls."
                    accent="#2f66ee"
                    accentBg="rgba(47,102,238,0.12)"
                    buttonLabel="View Dispatch Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9m0 0L9 7" /></svg>}
                  />
                </div>

                <hr className="border-[#131f30]" />

                {/* -- DOC Logs ---- */}
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#6f7f99]">DOC Logs</h3>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <LogCard
                    id="doc_personnel"
                    label="Personnel Roster"
                    desc="DOC roster changes, removals, and Department Panel access grants."
                    accent="#f97316"
                    accentBg="rgba(249,115,22,0.12)"
                    buttonLabel="View Personnel Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8z" /></svg>}
                  />
                  <LogCard
                    id="doc_vehicles"
                    label="Vehicle Roster"
                    desc="DOC vehicle additions, updates, and deletions."
                    accent="#22c55e"
                    accentBg="rgba(34,197,94,0.12)"
                    buttonLabel="View Vehicle Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM1 1h4l2.68 13.39a2 2 0 001.98 1.61h9.72a2 2 0 001.98-1.61L23 6H6" /></svg>}
                  />
                </div>

                <hr className="border-[#131f30]" />

                {/* -- DPH Logs ---- */}
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[#6f7f99]">DPH Logs</h3>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <LogCard
                    id="dph_personnel"
                    label="Personnel Roster"
                    desc="DPH roster edits, Discord sync, panel/division oversight, division member access, resource changes, and division information edits."
                    accent="#06b6d4"
                    accentBg="rgba(6,182,212,0.12)"
                    buttonLabel="View Personnel Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8z" /></svg>}
                  />
                  <LogCard
                    id="dph_vehicles"
                    label="Vehicle Roster"
                    desc="DPH vehicle additions, updates, and deletions."
                    accent="#14b8a6"
                    accentBg="rgba(20,184,166,0.12)"
                    buttonLabel="View Vehicle Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0zM1 1h4l2.68 13.39a2 2 0 001.98 1.61h9.72a2 2 0 001.98-1.61L23 6H6" /></svg>}
                  />
                  <LogCard
                    id="dph_equipment"
                    label="Equipment Roster"
                    desc="DPH equipment inventory additions, updates, and deletions."
                    accent="#0ea5e9"
                    accentBg="rgba(14,165,233,0.12)"
                    buttonLabel="View Equipment Logs"
                    icon={<svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
                  />
                </div>

              </section>
              );
            })()}

            {activeTab === 'logs' && logsSubTab && (
              <section className="space-y-4">
                {/* Back + heading */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setLogsSubTab(null);
                      setAuditLogs([]);
                      setAuditLogSearch('');
                      setAuditLogActionFilter('all');
                      setAuditLogActorFilter('all');
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-[#131f30] bg-[#070d16] px-3 py-2 text-xs font-bold text-[#6f7f99] transition-colors hover:text-white"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                    Back
                  </button>
                  <h3 className="text-sm font-black uppercase tracking-[0.12em] text-white">
                    {LOGS_SUB_TAB_TITLES[logsSubTab]}
                  </h3>
                </div>

                {/* Search + filters */}
                <div className="flex flex-col gap-3 rounded-xl border border-[#131f30] bg-[#070d16] p-4 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                    <input
                      type="search"
                      value={auditLogSearch}
                      onChange={e => setAuditLogSearch(e.target.value)}
                      placeholder="Search actor, action, or details…"
                      className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] py-2.5 pl-9 pr-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                    />
                  </div>
                  <label className="flex min-w-[160px] flex-col gap-1">
                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#526179]">Action</span>
                    <select
                      value={auditLogActionFilter}
                      onChange={e => setAuditLogActionFilter(e.target.value)}
                      className="rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2.5 text-xs font-semibold text-white outline-none focus:border-[#2f70ff]"
                    >
                      <option value="all">All actions</option>
                      {auditLogActions.map(action => (
                        <option key={action} value={action}>{action}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[160px] flex-col gap-1">
                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#526179]">Actor</span>
                    <select
                      value={auditLogActorFilter}
                      onChange={e => setAuditLogActorFilter(e.target.value)}
                      className="rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2.5 text-xs font-semibold text-white outline-none focus:border-[#2f70ff]"
                    >
                      <option value="all">All actors</option>
                      {auditLogActors.map(actor => (
                        <option key={actor} value={actor}>{actor}</option>
                      ))}
                    </select>
                  </label>
                  {(auditLogSearch || auditLogActionFilter !== 'all' || auditLogActorFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuditLogSearch('');
                        setAuditLogActionFilter('all');
                        setAuditLogActorFilter('all');
                      }}
                      className="rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#8392aa] transition-colors hover:border-[#2f70ff] hover:text-white sm:self-end"
                    >
                      Clear
                    </button>
                  )}
                  <p className="text-[10px] font-bold text-[#526179] sm:ml-auto sm:self-end sm:pb-2">
                    {filteredAuditLogs.length} of {auditLogs.length} entries
                  </p>
                </div>

                {/* Log table */}
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
                  {auditLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <svg className="mb-3 h-10 w-10 text-[#172235]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <p className="text-sm font-bold text-[#526179]">No log entries yet</p>
                      <p className="mt-1 text-xs text-[#3a4d63]">Actions taken in this section will appear here.</p>
                    </div>
                  ) : filteredAuditLogs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <Search className="mb-3 h-8 w-8 text-[#172235]" />
                      <p className="text-sm font-bold text-[#526179]">No matching log entries</p>
                      <p className="mt-1 text-xs text-[#3a4d63]">Try a different search or clear the filters.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[580px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#131f30] bg-[#070d16]">
                            <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Timestamp</th>
                            <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Actor</th>
                            <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Action</th>
                            <th className="px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAuditLogs.map((log, i) => (
                            <tr key={log.id} className={`border-b border-[#0f1b29] transition-colors hover:bg-[#0a1220] ${i % 2 === 0 ? 'bg-[#070d16]' : 'bg-[#0b1220]'}`}>
                              <td className="px-5 py-3 font-mono text-[#526179] whitespace-nowrap">
                                {new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </td>
                              <td className="px-5 py-3 font-bold text-[#a8b7cd] whitespace-nowrap">{log.actor}</td>
                              <td className="px-5 py-3 font-semibold text-white">{log.action}</td>
                              <td className="px-5 py-3 text-[#6f7f99] max-w-[280px] truncate">{log.details ?? ' - '}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            </>
            )}
          </div>

        </section>
      </div>

      {staffOpenDocId !== null && (
        <DocumentEditor
          key={`${staffOpenDocId}-${staffOpenDocCanEdit ? 'edit' : 'view'}`}
          resourceId={staffOpenDocId}
          canEdit={staffOpenDocCanEdit}
          apiBase="/api/staff/resources"
          onClose={() => {
            setStaffOpenDocId(null);
            setStaffOpenDocCanEdit(false);
            void fetchStaffResources();
          }}
        />
      )}

      {staffOpenPdf !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85">
          <div className="flex items-center justify-between border-b border-[#1e2d42] bg-[#070d16] px-5 py-3">
            <p className="truncate text-sm font-black text-white">{staffOpenPdf.title}</p>
            <button
              type="button"
              onClick={() => setStaffOpenPdf(null)}
              className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PdfViewer
            fileUrl={`/api/staff/resources/${staffOpenPdf.id}/file`}
            downloadName={`${staffOpenPdf.title}.pdf`}
          />
        </div>
      )}

      {staffAddStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-white">New Staff Resource</h3>
                <p className="mt-0.5 text-xs text-[#526179]">Step 1 of 2 — Name your resource</p>
              </div>
              <button type="button" onClick={resetStaffAddDialog}
                className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={staffNewTitle}
              onChange={e => setStaffNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && staffNewTitle.trim()) setStaffAddStep(2);
              }}
              placeholder="Resource title…"
              className="mb-4 h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white outline-none focus:border-[#ff5d5d]"
            />
            <button
              type="button"
              disabled={!staffNewTitle.trim()}
              onClick={() => setStaffAddStep(2)}
              className="h-10 w-full rounded-lg bg-[#ff5d5d] text-xs font-black text-white hover:bg-[#ff7474] disabled:opacity-40"
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {staffAddStep === 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-white">{staffNewTitle}</h3>
                <p className="mt-0.5 text-xs text-[#526179]">Step 2 of 2 — Choose type</p>
              </div>
              <button type="button" onClick={resetStaffAddDialog}
                className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setStaffNewType('document'); setStaffUploadFile(null); }}
                className={`rounded-xl border px-3 py-4 text-center transition-colors ${
                  staffNewType === 'document'
                    ? 'border-[#ff5d5d]/50 bg-[#ff5d5d]/10 text-[#ff7070]'
                    : 'border-[#1f3050] text-[#526179] hover:text-white'
                }`}
              >
                <FileText className="mx-auto mb-2 h-5 w-5" />
                <p className="text-[10px] font-black uppercase tracking-widest">Document</p>
              </button>
              <button
                type="button"
                onClick={() => setStaffNewType('file')}
                className={`rounded-xl border px-3 py-4 text-center transition-colors ${
                  staffNewType === 'file'
                    ? 'border-[#ff5d5d]/50 bg-[#ff5d5d]/10 text-[#ff7070]'
                    : 'border-[#1f3050] text-[#526179] hover:text-white'
                }`}
              >
                <Upload className="mx-auto mb-2 h-5 w-5" />
                <p className="text-[10px] font-black uppercase tracking-widest">PDF / DOCX</p>
              </button>
            </div>
            {staffNewType === 'file' && (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-[#3f5470]">File</span>
                <input
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={e => setStaffUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-[#a8b7cd] file:mr-3 file:rounded-lg file:border-0 file:bg-[#ff5d5d]/15 file:px-3 file:py-1.5 file:text-[10px] file:font-black file:uppercase file:text-[#ff7070]"
                />
              </label>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={() => setStaffAddStep(1)}
                className="h-10 flex-1 rounded-lg border border-[#1e2d42] text-xs font-bold text-[#a8b7cd] hover:bg-white/5">
                ← Back
              </button>
              <button
                type="button"
                disabled={staffCreating || (staffNewType === 'file' && !staffUploadFile)}
                onClick={() => {
                  if (staffNewType === 'file') void handleUploadStaffResource();
                  else void handleCreateStaffDocument();
                }}
                className="h-10 flex-1 rounded-lg bg-[#ff5d5d] text-xs font-black text-white hover:bg-[#ff7474] disabled:opacity-40"
              >
                {staffCreating
                  ? (staffUploadStatus ?? 'Creating…')
                  : staffNewType === 'file' ? 'Upload →' : 'Create & Edit →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

const SearchField = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <label className="mb-5 block rounded-xl border border-[#131f30] bg-[#070d16] p-4">
    <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">
      <Search className="h-4 w-4 text-[#ff7070]" />
      Search
    </span>
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="mt-3 h-11 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-[#66748a] focus:border-[#2f70ff]"
    />
  </label>
);

const ProfileField = ({ label, value }: { label: string; value: string | number | null }) => (
  <div className="rounded-lg border border-[#131f30] bg-[#0b111d] p-4">
    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">{label}</p>
    <p className="mt-2 break-words text-sm font-bold text-white">{value ?? 'Not linked'}</p>
  </div>
);

const EditField = ({
  label,
  value,
  onChange,
  type = 'text',
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) => (
  <label className="block rounded-lg border border-[#131f30] bg-[#070d16] p-4">
    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99]">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      className="mt-2 h-10 w-full rounded-md border border-[#27354c] bg-[#101827] px-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-[#66748a] focus:border-[#2f70ff]"
    />
  </label>
);

export default AdminPortal;
