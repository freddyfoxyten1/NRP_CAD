import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  nestedPortalSectionPath,
  parseNestedPortalSection,
  usePortalSection,
} from '@/hooks/usePortalSection';
import {
  AlertCircle, CalendarDays, Car, ChevronDown, ChevronRight, ChevronUp,
  GripVertical, LayoutDashboard, LogOut, Package,
  Pencil, Phone, Plus, Radio, Search, Settings,
  Shield, Trash2, Users, X, Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import PhonePanel from '@/components/overlays/PhonePanel';
import IncomingCallOverlay, { type IncomingCall } from '@/components/overlays/IncomingCallOverlay';
import { clearCadSession, getCadSession, setCadSession, type CadSession } from '@/lib/cad-session';
import { canAccessDocCad } from '@/lib/cad-access';
import { isSuperAdminSession } from '@/lib/superadmin';
import { useCadStatus, cadModeLabel } from '@/hooks/useCadStatus';
import { usePhoneSSE } from '@/hooks/usePhoneSSE';

// ── Types ──────────────────────────────────────────────────────────────────────
type Tab = 'personnel-roster' | 'vehicle-roster' | 'equipment-roster' | 'event-calendar' | 'department-panel';

const DOC_SECTIONS = [
  'personnel-roster',
  'vehicle-roster',
  'equipment-roster',
  'event-calendar',
  'department-panel',
] as const satisfies readonly Tab[];

type DocRank = {
  id: number; name: string; sort_order: number; group_id: number | null;
  color_hex: string | null; callsign_prefix: string | null; insignia_url: string | null;
};

type RankMember = {
  id: number; username: string; discord_username: string; discord_id: string;
  avatar_hash: string | null; callsign: string; doc_rank: string | null; status: string;
};

type RankDetail = DocRank & { members: RankMember[] };
type DocGroup = { id: number; name: string; sort_order: number; panel_access: boolean };

type FleetVehicle = {
  id: number;
  name: string;
  year: string | null;
  category: string;
  category_sort: number;
  image_url: string | null;
  who_can_drive: string[];
  restrict_to_divisions: string[];
  liveries: string[];
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
  rank: string;
  role: string;
  doc_rank: string | null;
  doc_role: string | null;
  status: string;
  appointed_date: string | null;
  certifications: string[];
  group_name: string;
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
  return { ...m, certifications: asStringArray(m.certifications) };
}

// ── Constants ──────────────────────────────────────────────────────────────────
const RANK_OPTIONS = [
  'Director of Communications', 'Deputy Director', 'Communications Supervisor',
  'Lead Dispatcher', 'Senior Dispatcher', 'Dispatcher',
  'Junior Dispatcher', 'Trainee', 'Member',
];

const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave', 'Suspended'];

// No department-specific unit columns for DOC
const UNIT_COLS: never[] = [];

const DIVISION_OPTIONS = [
  { key: 'POB', label: 'Patrol Operations Bureau' },
  { key: 'IAB', label: 'Internal Affairs Bureau' },
  { key: 'HSU', label: 'High Speed Unit' },
  { key: 'SRU', label: 'Special Response Unit' },
  { key: 'FOU', label: 'Field Operations Unit' },
];

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'personnel-roster',  label: 'Personnel Roster',  icon: Users        },
  { id: 'vehicle-roster',    label: 'Vehicle Roster',    icon: Car          },
  { id: 'equipment-roster',  label: 'Equipment Roster',  icon: Package      },
  { id: 'event-calendar',    label: 'Event Calendar',    icon: CalendarDays },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

const StatusBadge = ({ status }: { status: string }) => {
  const active = status?.toLowerCase() === 'active';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${active ? 'bg-emerald-500 text-white' : 'bg-[#1a2638] text-[#526179]'}`}>
      {status ?? 'Inactive'}
    </span>
  );
};

const DiscordAvatar = ({ name, discordId, avatarHash }: { name: string; discordId?: string; avatarHash?: string | null }) => {
  const [imgError, setImgError] = React.useState(false);
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const colors = ['bg-[#5865f2]', 'bg-[#3ba55c]', 'bg-[#ed4245]', 'bg-[#faa61a]', 'bg-[#9c84ec]'];
  const color = colors[(name.charCodeAt(0) ?? 0) % colors.length];
  const src = discordId && avatarHash && !imgError
    ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=64`
    : null;
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

// ── Edit Member Modal ──────────────────────────────────────────────────────────
type EditForm = {
  doc_rank: string; doc_role: string; callsign: string; status: string;
  appointed_date: string; certifications: string;
};

const EditModal = ({
  member, onClose, onSave, ranks,
}: {
  member: RosterMember;
  onClose: () => void;
  onSave: (id: number, form: EditForm) => Promise<void>;
  ranks: DocRank[];
}) => {
  const [form, setForm] = useState<EditForm>({
    doc_rank: member.doc_rank || member.rank || '',
    doc_role: member.doc_role ?? '',
    callsign: member.callsign ?? '',
    status: member.status ?? 'Active',
    appointed_date: member.appointed_date ? member.appointed_date.slice(0, 10) : '',
    certifications: asStringArray(member.certifications).join(', '),
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) => setForm(p => ({ ...p, [k]: v }));

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
            <h3 className="text-base font-black text-white">Edit Member</h3>
            <p className="mt-0.5 text-xs text-[#526179]">{member.username}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>DOC Rank</label>
              <select value={form.doc_rank} onChange={e => set('doc_rank', e.target.value)} className={selectCls}>
                <option value="">— Select rank —</option>
                {(ranks.length > 0 ? ranks.map(r => r.name) : RANK_OPTIONS).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Callsign</label>
              <input type="text" placeholder="e.g. DOC-01" value={form.callsign}
                onChange={e => set('callsign', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>DOC Role</label>
            <input type="text" placeholder="e.g. Dispatcher, Supervisor" value={form.doc_role}
              onChange={e => set('doc_role', e.target.value)} className={inputCls} />
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
            <label className={labelCls}>Certifications (comma-separated)</label>
            <input type="text" placeholder="e.g. Basic Comms, Advanced Dispatch, FTO"
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

// ── Rank Edit Modal ────────────────────────────────────────────────────────────
type RankEditForm = {
  name: string; color_hex: string; callsign_prefix: string; insignia_url: string;
};

const RankEditModal = ({
  rankId, onClose, onSaved,
}: {
  rankId: number;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [detail, setDetail]   = useState<RankDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [form, setForm]       = useState<RankEditForm>({ name: '', color_hex: '', callsign_prefix: '', insignia_url: '' });
  const [colorErr, setColorErr] = useState('');
  const colorInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/doc/ranks/${rankId}`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((d: RankDetail) => {
        setDetail(d);
        setForm({ name: d.name, color_hex: d.color_hex ?? '', callsign_prefix: d.callsign_prefix ?? '', insignia_url: d.insignia_url ?? '' });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rankId]);

  const set = <K extends keyof RankEditForm>(k: K, v: RankEditForm[K]) => setForm(p => ({ ...p, [k]: v }));

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
      const body: Record<string, string | null> = {
        name: form.name.trim(),
        color_hex: form.color_hex.trim() || null,
        callsign_prefix: form.callsign_prefix.trim() || null,
        insignia_url: form.insignia_url.trim() || null,
      };
      const res = await fetch(`/api/doc/ranks/${rankId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? 'Failed to save.');
      }
      onSaved();
      onClose();
    } catch { /* toast handled by caller */ }
    finally { setSaving(false); }
  };

  const rankColor = form.color_hex && validateColor(form.color_hex) ? form.color_hex : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-xl rounded-2xl border border-[#1e2d42] bg-[#070d16] shadow-2xl max-h-[90vh] overflow-y-auto">
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
          <div className="flex min-h-[200px] items-center justify-center px-7 py-10 text-sm font-bold text-[#8ea1bb]">Loading…</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="px-7 pt-6 pb-4 space-y-5">
              <div>
                <label className={labelCls}>Rank Name <span className="text-red-400">*</span></label>
                <input type="text" required value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Colour Hex</label>
                <div className="flex items-center gap-3">
                  <div className="h-9 w-10 shrink-0 rounded-lg border border-[#1f3050] cursor-pointer overflow-hidden relative"
                    style={{ backgroundColor: rankColor ?? '#07111f' }}
                    title="Open colour picker"
                    onClick={() => colorInputRef.current?.click()}>
                    <input ref={colorInputRef} type="color"
                      value={rankColor ?? '#4384ff'}
                      onChange={e => { set('color_hex', e.target.value); setColorErr(''); }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" />
                  </div>
                  <input type="text" placeholder="#4384ff" value={form.color_hex}
                    onChange={e => { set('color_hex', e.target.value); setColorErr(''); }}
                    className={`${inputCls} font-mono`} />
                </div>
                {colorErr && <p className="mt-1 text-[10px] font-bold text-red-400">{colorErr}</p>}
                <p className="mt-1.5 text-[10px] text-[#3f5470]">Used to tint rank chips and badges.</p>
              </div>
              <div>
                <label className={labelCls}>Callsign Prefix / Format</label>
                <input type="text" placeholder="e.g. DOC, DISP, SUP" value={form.callsign_prefix}
                  onChange={e => set('callsign_prefix', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Insignia Image URL</label>
                <input type="url" placeholder="https://…/insignia.png" value={form.insignia_url}
                  onChange={e => set('insignia_url', e.target.value)} className={inputCls} />
                {form.insignia_url && (
                  <div className="mt-2 flex items-center gap-3">
                    <img src={form.insignia_url} alt="Insignia preview" className="h-10 w-10 rounded border border-[#1f3050] bg-[#07111f] object-contain p-1"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <p className="text-[10px] text-[#526179]">Insignia preview</p>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[#131f30] px-7 pt-5 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-3.5 w-3.5 text-[#4384ff]" />
                <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Members with this rank</span>
                <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#526179]">{detail?.members.length ?? 0}</span>
              </div>
              {!detail?.members.length ? (
                <p className="text-[11px] text-[#2a3a50]">No members currently hold this rank.</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {detail.members.map(m => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#0f1b28] bg-[#070d16] px-3 py-2">
                      <DiscordAvatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-white truncate">{m.username}</p>
                        {m.discord_username && <p className="text-[10px] text-[#526179]">@{m.discord_username}</p>}
                      </div>
                      <span className="shrink-0 font-black text-[10px] text-[#4384ff]">{m.callsign || '—'}</span>
                      <StatusBadge status={m.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

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

// ── Add Member Modal ───────────────────────────────────────────────────────────
type AddForm = {
  username: string; discord_username: string; discord_id: string;
  doc_rank: string; doc_role: string; callsign: string; status: string; appointed_date: string;
};

type UserHit = { id: number; username: string; discord_username: string; discord_id: string; rank: string };

const AddMemberModal = ({
  onClose, onAdd, ranks,
}: {
  onClose: () => void;
  onAdd: (form: AddForm) => Promise<void>;
  ranks: DocRank[];
}) => {
  const [form, setForm] = useState<AddForm>({
    username: '', discord_username: '', discord_id: '',
    doc_rank: 'Unranked', doc_role: '', callsign: '', status: 'Active', appointed_date: '',
  });
  const [saving, setSaving]           = useState(false);
  const [suggestions, setSuggestions] = useState<UserHit[]>([]);
  const [showSugg, setShowSugg]       = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);

  const set = <K extends keyof AddForm>(k: K, v: AddForm[K]) => setForm(p => ({ ...p, [k]: v }));

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
        const r = await fetch(`/api/doc/users/search?q=${encodeURIComponent(val.trim())}`, { headers: { accept: 'application/json' } });
        if (!r.ok) return;
        const rows = await r.json() as UserHit[];
        setSuggestions(rows);
        setShowSugg(rows.length > 0);
      } catch { /* ignore */ }
    }, 280);
  };

  const pickUser = (hit: UserHit) => {
    setForm(p => ({ ...p, username: hit.username, discord_username: hit.discord_username || p.discord_username, discord_id: hit.discord_id || p.discord_id }));
    setSuggestions([]); setShowSugg(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.username.trim()) return;
    setSaving(true);
    try { await onAdd(form); onClose(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to add member.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="relative w-full max-w-md rounded-2xl border border-[#1e2d42] bg-[#070d16] p-7 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-base font-black text-white">Add New Member</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div ref={wrapRef} className="relative">
            <label className={labelCls}>CAD Username <span className="text-red-400">*</span></label>
            <input type="text" required autoComplete="off" placeholder="Start typing a name…"
              value={form.username}
              onChange={e => onUsernameChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSugg(true)}
              className={inputCls} />
            {showSugg && (
              <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-[#1f3050] bg-[#070e1a] shadow-2xl">
                {suggestions.map(hit => (
                  <li key={hit.id}>
                    <button type="button" onMouseDown={() => pickUser(hit)}
                      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[#0d1a2e]">
                      <div className="min-w-0 flex-1">
                        <span className="block text-xs font-black text-white truncate">{hit.username}</span>
                        {hit.discord_username && <span className="block text-[10px] text-[#526179] truncate">@{hit.discord_username}</span>}
                      </div>
                      <span className="shrink-0 rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-black text-[#526179]">
                        {hit.rank || 'Community Member'}
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
              <label className={labelCls}>DOC Rank</label>
              <select value={form.doc_rank} onChange={e => set('doc_rank', e.target.value)} className={selectCls}>
                <option value="Unranked">Unranked</option>
                {(ranks.length > 0 ? ranks.map(r => r.name) : RANK_OPTIONS).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Callsign</label>
              <input type="text" placeholder="e.g. DOC-01" value={form.callsign}
                onChange={e => set('callsign', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>DOC Role</label>
            <input type="text" placeholder="e.g. Dispatcher, Supervisor" value={form.doc_role}
              onChange={e => set('doc_role', e.target.value)} className={inputCls} />
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
              {saving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────────
const DepartmentOfCommunications = () => {
  const navigate = useNavigate();
  const { online: cadOnline, mode: cadMode } = useCadStatus();

  const [session,      setSession]      = useState<CadSession | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen]                  = useState(true);
  type PanelSection = 'personnel' | 'vehicle' | 'calendar';
  const PANEL_SECTIONS = new Set<string>(['personnel', 'vehicle', 'calendar']);
  const [activeTab, setActiveTab, rawSection] = usePortalSection<Tab>({
    base: 'doc',
    valid: DOC_SECTIONS,
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
    navigate(nestedPortalSectionPath('doc', 'department-panel', next));
  }, [navigate]);
  const [showPhone,    setShowPhone]    = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [phoneCallEvent, setPhoneCallEvent] = useState<import('@/hooks/usePhoneSSE').PhoneSSEEvent | null>(null);
  const [answeredCall, setAnsweredCall] = useState<{ phone: string; name: string; callId: string } | null>(null);

  // User's DOC record (for panel access check)
  const [myDocRank, setMyDocRank] = useState<string | null>(null);

  // Personnel roster
  const [roster,        setRoster]        = useState<RosterMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSearch,  setRosterSearch]  = useState('');
  const [collapsed,     setCollapsed]     = useState<Record<string, boolean>>({});

  // Department panel — personnel
  const [panelMembers,  setPanelMembers]  = useState<RosterMember[]>([]);
  const [panelLoading,  setPanelLoading]  = useState(false);
  const [panelSearch,   setPanelSearch]   = useState('');
  const [editMember,    setEditMember]    = useState<RosterMember | null>(null);
  const [addOpen,       setAddOpen]       = useState(false);
  // Department panel — ranks
  const [ranks,           setRanks]           = useState<DocRank[]>([]);
  const [ranksLoading,    setRanksLoading]    = useState(false);

  // Vehicle roster
  const [fleet,             setFleet]             = useState<FleetVehicle[]>([]);
  const [fleetLoading,      setFleetLoading]       = useState(false);
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
  });
  const [savingVehicle,       setSavingVehicle]       = useState(false);
  const [editVehicleItem,     setEditVehicleItem]     = useState<FleetVehicle | null>(null);

  // Department panel — groups
  const [groups,           setGroups]           = useState<DocGroup[]>([]);
  const [groupsLoading,    setGroupsLoading]    = useState(false);
  const [addTitleOpen,     setAddTitleOpen]     = useState(false);
  const [newGroupName,     setNewGroupName]     = useState('');
  const [addingGroup,      setAddingGroup]      = useState(false);
  const [editingGroupId,   setEditingGroupId]   = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [addRankGroupId,   setAddRankGroupId]   = useState<number | null>(null);
  const [newRankName,      setNewRankName]      = useState('');
  const [addingRank,       setAddingRank]       = useState(false);
  const [editRankId,       setEditRankId]       = useState<number | null>(null);

  // Drag-and-drop — ranks
  const [dragRankId,       setDragRankId]       = useState<number | null>(null);
  const [dragOverRankId,   setDragOverRankId]   = useState<number | null>(null);
  const [dragOverSide,     setDragOverSide]     = useState<'before' | 'after'>('after');
  const [dragOverGroupId,  setDragOverGroupId]  = useState<number | null>(null);
  // Drag-and-drop — groups
  const [dragGroupId,      setDragGroupId]      = useState<number | null>(null);
  const [dragGroupOverId,  setDragGroupOverId]  = useState<number | null>(null);
  const [dragGroupOverSide, setDragGroupOverSide] = useState<'before' | 'after'>('after');
  // Drag-and-drop — vehicles
  const [dragVehicleId,       setDragVehicleId]       = useState<number | null>(null);
  const [dragOverVehicleId,   setDragOverVehicleId]   = useState<number | null>(null);
  const [dragOverVehicleSide, setDragOverVehicleSide] = useState<'before' | 'after'>('after');
  const [dragOverVehicleCat,  setDragOverVehicleCat]  = useState<string | null>(null);

  // ── Auth ────────────────────────────────────────────────────────────────────
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
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [profileOpen]);

  const handleSignOut = () => { setIsSigningOut(true); clearCadSession(); toast.success('Signed out successfully.'); navigate('/', { replace: true }); };

  // ── Vehicle roster fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'vehicle-roster') return;
    setFleetLoading(true);
    fetch('/api/doc/vehicles', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((rows: unknown) => setFleet(Array.isArray(rows) ? rows as FleetVehicle[] : []))
      .catch(() => toast.error('Failed to load vehicle roster.'))
      .finally(() => setFleetLoading(false));
  }, [activeTab]);

  // ── Mount: load groups + ranks + my DOC record ────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/doc/groups', { headers: { accept: 'application/json' } }).then(r => r.json()),
      fetch('/api/doc/ranks',  { headers: { accept: 'application/json' } }).then(r => r.json()),
    ]).then(([grps, rnks]: [DocGroup[], DocRank[]]) => {
      setGroups(grps); setRanks(rnks);
    }).catch(() => {});
  }, []);

  // Fetch the current user's DOC rank once session is known
  useEffect(() => {
    if (!session?.username) return;
    fetch(`/api/doc/me?username=${encodeURIComponent(session.username)}`, { headers: { accept: 'application/json' } })
      .then(r => r.json())
      .then((d: { doc_rank?: string } | null) => { setMyDocRank(d?.doc_rank ?? null); })
      .catch(() => {});
  }, [session?.username]);

  // ── Personnel roster fetch ────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'personnel-roster') return;
    let cancelled = false;
    setRosterLoading(true);
    const loadJson = async <T,>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' } });
        if (!r.ok) return null;
        return await r.json() as T;
      } catch { return null; }
    };
    void (async () => {
      try {
        const [members, grps, rnks] = await Promise.all([
          loadJson<RosterMember[]>('/api/doc'),
          loadJson<DocGroup[]>('/api/doc/groups'),
          loadJson<DocRank[]>('/api/doc/ranks'),
        ]);
        if (cancelled) return;
        if (!Array.isArray(members)) {
          setRoster([]);
          toast.error('Failed to load roster.');
        } else {
          setRoster(members.map(normalizeRosterMember));
        }
        if (Array.isArray(grps)) setGroups(grps);
        if (Array.isArray(rnks)) setRanks(rnks);
      } catch {
        if (!cancelled) {
          setRoster([]);
          toast.error('Failed to load roster.');
        }
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab]);

  // ── Department panel fetch ────────────────────────────────────────────────────
  const fetchPanelMembers = () => {
    setPanelLoading(true);
    fetch('/api/doc?all=1', { headers: { accept: 'application/json' } })
      .then(r => r.json()).then((rows: RosterMember[]) => setPanelMembers(Array.isArray(rows) ? rows.map(normalizeRosterMember) : []))
      .catch(() => toast.error('Failed to load members.')).finally(() => setPanelLoading(false));
  };
  const fetchRanks = () => {
    setRanksLoading(true);
    fetch('/api/doc/ranks', { headers: { accept: 'application/json' } })
      .then(r => r.json()).then((rows: DocRank[]) => setRanks(rows))
      .catch(() => toast.error('Failed to load ranks.')).finally(() => setRanksLoading(false));
  };
  const fetchGroups = () => {
    setGroupsLoading(true);
    fetch('/api/doc/groups', { headers: { accept: 'application/json' } })
      .then(r => r.json()).then((rows: DocGroup[]) => setGroups(rows))
      .catch(() => toast.error('Failed to load groups.')).finally(() => setGroupsLoading(false));
  };
  const fetchFleetPanel = () => {
    setFleetLoading(true); setCategoriesLoading(true);
    Promise.all([
      fetch('/api/doc/vehicles',         { headers: { accept: 'application/json' }, cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
      fetch('/api/doc/fleet/categories', { headers: { accept: 'application/json' }, cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([vehicles, cats]: [unknown, unknown]) => {
        setFleet(Array.isArray(vehicles) ? vehicles as FleetVehicle[] : []);
        setFleetCategories(Array.isArray(cats) ? cats as {id:number;name:string;sort_order:number}[] : []);
      })
      .catch(() => toast.error('Failed to load vehicles.'))
      .finally(() => { setFleetLoading(false); setCategoriesLoading(false); });
  };

  useEffect(() => {
    if (panelSection === 'personnel') { fetchPanelMembers(); fetchRanks(); fetchGroups(); }
    if (panelSection === 'vehicle' || panelSection === null) { fetchFleetPanel(); fetchRanks(); }
  }, [panelSection]);

  // ── Roster helpers ─────────────────────────────────────────────────────────────
  const filteredRoster = roster.filter(m => {
    const q = rosterSearch.toLowerCase();
    return !q || m.username.toLowerCase().includes(q) || (m.doc_rank || m.rank).toLowerCase().includes(q)
      || m.callsign?.toLowerCase().includes(q) || m.discord_username?.toLowerCase().includes(q);
  });
  const getRankMeta = (rankName: string | null | undefined) =>
    rankName ? (ranks.find(r => r.name.toLowerCase() === rankName.toLowerCase().trim()) ?? null) : null;
  const groupedRoster = (() => {
    const defined = groups.map(g => ({
      id: g.id as number | null,
      label: g.name,
      members: filteredRoster.filter(m => m.group_name === g.name),
    }));
    const definedLabels = new Set(groups.map(g => g.name));
    const orphans = filteredRoster.filter(m => !definedLabels.has(m.group_name));
    if (orphans.length > 0) {
      defined.push({ id: null, label: orphans[0].group_name || 'Community Members', members: orphans });
    }
    return defined;
  })();
  const toggleGroup = (label: string) => setCollapsed(p => ({ ...p, [label]: !p[label] }));

  const filteredPanel = panelMembers.filter(m => {
    const q = panelSearch.toLowerCase();
    return !q || m.username.toLowerCase().includes(q) || (m.doc_rank || m.rank).toLowerCase().includes(q) || m.callsign?.toLowerCase().includes(q);
  });

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch { return d; }
  };

  // ── Department panel actions ───────────────────────────────────────────────────
  const handleSaveEdit = async (id: number, form: EditForm) => {
    const certs = form.certifications.split(',').map(s => s.trim()).filter(Boolean);
    const res = await fetch(`/api/doc/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, certifications: certs, actor: session?.username ?? 'DOC Panel' }),
    });
    if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? 'Failed to save.'); }
    toast.success('Member updated.');
    fetchPanelMembers();
    if (roster.length > 0) {
      fetch('/api/doc', { headers: { accept: 'application/json' } })
        .then(r => r.json()).then((rows: RosterMember[]) => setRoster(Array.isArray(rows) ? rows.map(normalizeRosterMember) : [])).catch(() => {});
    }
  };

  const handleAddMember = async (form: AddForm) => {
    const res = await fetch('/api/doc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, actor: session?.username ?? 'DOC Panel' }),
    });
    if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? 'Failed to add member.'); }
    toast.success('Member added successfully.');
    fetchPanelMembers();
  };

  const handleDelete = async (member: RosterMember) => {
    if (!confirm(`Remove ${member.username} from the roster? This cannot be undone.`)) return;
    const res = await fetch(`/api/doc/${member.id}`, { method: 'DELETE', headers: { 'x-actor': session?.username ?? 'DOC Panel' } });
    if (!res.ok) { toast.error('Failed to remove member.'); return; }
    toast.success(`${member.username} removed from roster.`);
    fetchPanelMembers();
  };

  // ── Rank reorder ──────────────────────────────────────────────────────────────
  const handleRankReorder = async (targetGroupId: number, draggedId: number, targetId: number | null, side: 'before' | 'after') => {
    const draggedRank = ranks.find(r => r.id === draggedId);
    if (!draggedRank) return;
    if (draggedId === targetId) return;
    const sourceGroupId = draggedRank.group_id;
    const isCrossGroup  = sourceGroupId !== targetGroupId;
    const targetGroupRanks = ranks.filter(r => r.group_id === targetGroupId && r.id !== draggedId).sort((a, b) => a.sort_order - b.sort_order);
    let newOrder: typeof ranks;
    if (targetId !== null) {
      const without = [...targetGroupRanks];
      const targetIdx = without.findIndex(r => r.id === targetId);
      const insertAt  = side === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      without.splice(insertAt, 0, draggedRank);
      newOrder = without;
    } else { newOrder = [...targetGroupRanks, draggedRank]; }
    setRanks(prev => [...prev.filter(r => r.id !== draggedId && r.group_id !== targetGroupId), ...newOrder.map((r, i) => ({ ...r, group_id: targetGroupId, sort_order: i }))]);
    try {
      if (isCrossGroup) {
        const mv = await fetch(`/api/doc/ranks/${draggedId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ group_id: targetGroupId }) });
        if (!mv.ok) throw new Error('move failed');
      }
      const ro = await fetch('/api/doc/ranks/reorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: newOrder.map(r => r.id) }) });
      if (!ro.ok) throw new Error('reorder failed');
    } catch { fetchRanks(); toast.error('Failed to move rank.'); }
  };

  // ── Vehicle reorder ──────────────────────────────────────────────────────────
  const handleVehicleReorder = async (targetCat: string, targetCatSort: number, draggedId: number, targetId: number | null, side: 'before' | 'after') => {
    const draggedVehicle = fleet.find(v => v.id === draggedId);
    if (!draggedVehicle || draggedId === targetId) return;
    const isCrossCat = draggedVehicle.category !== targetCat;
    const targetCatVehicles = fleet.filter(v => v.category === targetCat && v.id !== draggedId).sort((a, b) => a.sort_order - b.sort_order);
    let newOrder: typeof fleet;
    if (targetId !== null) {
      const without = [...targetCatVehicles];
      const targetIdx = without.findIndex(v => v.id === targetId);
      const insertAt  = side === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      without.splice(insertAt, 0, draggedVehicle);
      newOrder = without;
    } else { newOrder = [...targetCatVehicles, draggedVehicle]; }
    setFleet(prev => [...prev.filter(v => v.id !== draggedId && v.category !== targetCat), ...newOrder.map((v, i) => ({ ...v, category: targetCat, category_sort: targetCatSort, sort_order: i }))]);
    try {
      if (isCrossCat) {
        const mv = await fetch(`/api/doc/fleet/${draggedId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: targetCat, category_sort: targetCatSort }) });
        if (!mv.ok) throw new Error('move failed');
      }
      const ro = await fetch('/api/doc/fleet/reorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: newOrder.map(v => v.id) }) });
      if (!ro.ok) throw new Error('reorder failed');
    } catch { fetchFleetPanel(); toast.error('Failed to move vehicle.'); }
  };

  // ── Delete a rank ─────────────────────────────────────────────────────────────
  const handleDeleteRank = async (rankId: number, rankName: string) => {
    if (!window.confirm(`Delete the rank "${rankName}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/doc/ranks/${rankId}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete rank.'); return; }
      setRanks(prev => prev.filter(r => r.id !== rankId));
      toast.success(`Rank "${rankName}" deleted.`);
    } catch { toast.error('Failed to delete rank.'); }
  };

  // ── Add rank ─────────────────────────────────────────────────────────────────
  const handleAddRankToGroup = async (groupId: number) => {
    const name = newRankName.trim();
    if (!name) return;
    setAddingRank(true);
    try {
      const res = await fetch('/api/doc/ranks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, group_id: groupId }) });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add rank.'); return; }
      setNewRankName(''); setAddRankGroupId(null); fetchRanks(); toast.success('Rank added.');
    } finally { setAddingRank(false); }
  };

  // ── Group actions ─────────────────────────────────────────────────────────────
  const handleAddGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setAddingGroup(true);
    try {
      const res = await fetch('/api/doc/groups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await res.json() as { error?: string };
      if (!res.ok) { toast.error(data.error ?? 'Failed to add group.'); return; }
      setNewGroupName(''); fetchGroups();
    } finally { setAddingGroup(false); }
  };

  const reorderGroupsApi = async (ordered: DocGroup[]) => {
    try {
      const res = await fetch('/api/doc/groups/reorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: ordered.map(g => g.id) }) });
      if (!res.ok) throw new Error('failed');
    } catch { fetchGroups(); toast.error('Failed to reorder groups.'); }
  };

  const handleMoveGroup = async (id: number, direction: 'up' | 'down') => {
    const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(g => g.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const newOrder = [...sorted];
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    const updated = newOrder.map((g, i) => ({ ...g, sort_order: i }));
    setGroups(updated); reorderGroupsApi(updated);
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
    setGroups(updated); reorderGroupsApi(updated);
  };

  const handleRenameGroup = async (id: number) => {
    const name = editingGroupName.trim();
    if (!name) { setEditingGroupId(null); return; }
    const res = await fetch(`/api/doc/groups/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await res.json() as { error?: string };
    if (!res.ok) { toast.error(data.error ?? 'Failed to rename group.'); return; }
    setEditingGroupId(null); fetchGroups();
  };

  const handleDeleteGroup = async (id: number, name: string) => {
    if (!confirm(`Remove the "${name}" group? Its ranks will be moved to the last remaining group.`)) return;
    await fetch(`/api/doc/groups/${id}`, { method: 'DELETE' });
    fetchGroups();
  };

  const handleTogglePanelAccess = async (id: number, enabled: boolean) => {
    setGroups(prev => prev.map(g => g.id === id ? { ...g, panel_access: enabled } : g));
    const res = await fetch(`/api/doc/groups/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panel_access: enabled, actor: session?.username ?? 'DOC Panel' }),
    });
    if (!res.ok) {
      setGroups(prev => prev.map(g => g.id === id ? { ...g, panel_access: !enabled } : g));
      toast.error('Failed to update panel access.');
    }
  };

  const username = session?.username ?? '';
  const rank     = session?.dps_rank || session?.rank || '';

  // Staff Executive Team members (and hardcoded superadmins) get full DOC access
  const isStaffExecutive =
    isSuperAdminSession(session) ||
    session?.staff_role?.toLowerCase() === 'executive team';

  // Panel access: staff exec OR user's DOC rank group has panel_access
  const hasPanelAccess = isStaffExecutive || (() => {
    if (!myDocRank) return false;
    const matchedRank = ranks.find(r => r.name.trim().toLowerCase() === myDocRank.trim().toLowerCase());
    if (!matchedRank || matchedRank.group_id == null) return false;
    return groups.some(g => g.id === matchedRank.group_id && g.panel_access);
  })();

  const pageLoading = isLoading || (
    activeTab === 'personnel-roster' ? rosterLoading
    : activeTab === 'vehicle-roster' ? fleetLoading
    : activeTab === 'department-panel' ? (
      panelSection === 'personnel' ? (panelLoading || ranksLoading || groupsLoading)
      : panelSection === 'vehicle' ? (fleetLoading || categoriesLoading)
      : panelSection === null ? (fleetLoading || ranksLoading)
      : false
    )
    : false
  );

  return (
    <main className="min-h-screen bg-[#02060b] text-white">

      {/* Modals */}
      {editMember && (
        <EditModal member={editMember} ranks={ranks} onClose={() => setEditMember(null)}
          onSave={async (id, form) => { await handleSaveEdit(id, form); }} />
      )}
      {addOpen && (
        <AddMemberModal ranks={ranks} onClose={() => setAddOpen(false)} onAdd={handleAddMember} />
      )}
      {editRankId !== null && (
        <RankEditModal rankId={editRankId} onClose={() => setEditRankId(null)} onSaved={() => { fetchRanks(); fetchPanelMembers(); }} />
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
              <h1 className="text-xl font-black tracking-[-0.04em] text-white">Dept. of Communications</h1>
            </div>
            {isLoading ? (
              <p className="mt-2 text-sm font-bold text-[#526179]">Loading…</p>
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

              {/* Department Panel — visible to staff execs or rank groups with panel_access */}
              {session && hasPanelAccess && (
                <button type="button" onClick={() => setActiveTab('department-panel')}
                  className={`flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-black uppercase transition-colors ${
                    activeTab === 'department-panel'
                      ? 'border-l-2 border-[#f4c542] bg-[#131002] text-[#f4c542]'
                      : 'text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                  }`}>
                  <Settings className="h-4 w-4" />
                  Department Panel
                </button>
              )}

              {session && canAccessDocCad(session, myDocRank) && (
                <button type="button" onClick={() => navigate('/doc_cad')}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#3ecf8e]">
                  <Monitor className="h-4 w-4" />
                  DOC CAD
                </button>
              )}

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
            {/* Right — profile avatar */}
            <div className="relative z-50 flex justify-end" ref={profileRef}>
              <button type="button" onClick={() => setProfileOpen(o => !o)}
                className="h-9 w-9 overflow-hidden rounded-full border-2 border-[#1b2738] transition-all hover:border-[#4384ff]">
                {session?.discord_id && session?.avatar_hash
                  ? <img src={`https://cdn.discordapp.com/avatars/${session.discord_id}/${session.avatar_hash}.png?size=64`} alt="Profile" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  : <div className="flex h-full w-full items-center justify-center bg-[#0f1b28] text-xs font-black text-[#4384ff]">{(session?.username ?? '?')[0].toUpperCase()}</div>}
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-11 z-[80] w-56 rounded-xl border border-[#1b2738] bg-[#0b1422] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-[#131f30] px-4 py-3">
                    <p className="text-xs font-black text-white">{session?.username}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{session?.rank ?? 'Officer'}</p>
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

          <div className="flex-1 px-5 py-7 sm:px-8 sm:py-9">
            {pageLoading ? (
              <PageLoadingScreen loading accent="#4384ff" />
            ) : (
            <>
            <div className="mb-8">
              <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">Department of Communications</h2>
              <p className="mt-2 text-sm text-[#8392aa]">
                {activeTab === 'personnel-roster'  ? 'Active personnel roster for the Department of Communications.'
                : activeTab === 'vehicle-roster'   ? 'Vehicle inventory and assignments for the Department of Communications.'
                : activeTab === 'equipment-roster' ? 'Equipment inventory and assignments for the Department of Communications.'
                : activeTab === 'event-calendar'   ? 'Upcoming department events, training sessions, and operations.'
                : 'Manage dispatchers, ranks, callsigns, and certifications.'}
              </p>
            </div>

            {/* ── PERSONNEL ROSTER ──────────────────────────────────────────── */}
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
                    {filteredRoster.length} member{filteredRoster.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {filteredRoster.length === 0 ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
                    <Users className="h-8 w-8 text-[#1e2e42]" />
                    <p className="text-sm font-bold text-[#3f5470]">
                      {rosterSearch ? 'No members match your search.' : 'No members on the roster yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#131f30]">
                          <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Name</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Rank</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-24">Callsign</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-20">Status</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-28">Appointed</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord ID</th>
                          <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Certifications</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedRoster.map(group => {
                          const groupDef  = groups.find(g => g.name === group.label);
                          return (
                            <React.Fragment key={group.label}>
                              <tr className="cursor-pointer border-b border-t border-[#131f30] bg-[#0a1525] hover:bg-[#0c1830] transition-colors"
                                onClick={() => toggleGroup(group.label)}>
                                <td colSpan={7} className="px-5 py-2.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {collapsed[group.label]
                                      ? <ChevronRight className="h-3.5 w-3.5 text-[#4384ff] shrink-0" />
                                      : <ChevronDown  className="h-3.5 w-3.5 text-[#4384ff] shrink-0" />}
                                    <span className="text-xs font-black text-white">{group.label}</span>
                                    <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">{group.members.length}</span>
                                  </div>
                                </td>
                              </tr>
                              {!collapsed[group.label] && group.members.map(m => {
                                const rankMeta  = getRankMeta(m.doc_rank || m.rank);
                                const chipColor = rankMeta?.color_hex ?? null;
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
                                        {rankMeta?.insignia_url && (
                                          <img src={rankMeta.insignia_url} alt="" className="h-4 w-4 object-contain shrink-0"
                                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        )}
                                        <span className="text-[10px] font-black" style={{ color: chipColor ?? '#a8b7cd' }}>
                                          {m.doc_rank || m.rank || '—'}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3.5"><span className="font-black text-[#4384ff]">{m.callsign || '—'}</span></td>
                                    <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                                    <td className="px-4 py-3.5 text-[#8392aa]">{formatDate(m.appointed_date)}</td>
                                    <td className="px-4 py-3.5"><span className="font-mono text-[11px] text-[#526179]">{m.discord_id || '—'}</span></td>
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
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── VEHICLE ROSTER ──────────────────────────────────────────────── */}
            {activeTab === 'vehicle-roster' && (
              <div className="space-y-8">
                {fleet.length === 0 ? (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl border border-[#131f30] bg-[#070d16]">
                    <Car className="h-10 w-10 text-[#1e2e42]" />
                    <p className="text-sm font-bold text-[#3f5470]">No vehicles in the roster yet.</p>
                  </div>
                ) : (() => {
                  const catMap = new Map<string, FleetVehicle[]>();
                  fleet.forEach(v => { if (!catMap.has(v.category)) catMap.set(v.category, []); catMap.get(v.category)!.push(v); });
                  const categories = [...catMap.entries()].sort((a, b) => {
                    const sa = a[1][0]?.category_sort ?? 0; const sb = b[1][0]?.category_sort ?? 0;
                    return sa !== sb ? sa - sb : a[0].localeCompare(b[0]);
                  });
                  return categories.map(([cat, vehicles]) => {
                    const sortedVehicles = [...vehicles].sort((a, b) => a.sort_order - b.sort_order);
                    return (
                      <div key={cat}>
                        <div className="mb-4 flex items-center gap-3">
                          <div className="h-5 w-1 rounded-full bg-[#4384ff]" />
                          <h2 className="text-sm font-black text-white">{cat}</h2>
                          <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[10px] font-black text-[#526179]">{vehicles.length}</span>
                        </div>
                        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {sortedVehicles.map(v => (
                            <div key={v.id} className="flex flex-col overflow-hidden rounded-xl border border-[#131f30] bg-[#070d16] transition-colors hover:border-[#1e3050]">
                              <div className="relative flex h-[130px] w-full items-center justify-center bg-[#070d16]">
                                {v.image_url ? (
                                  <img src={v.image_url} alt={v.name} className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                ) : <Car className="h-8 w-8 text-[#1e2e42]" />}
                              </div>
                              <div className="flex flex-1 flex-col gap-3 p-4">
                                <div>
                                  <p className="text-sm font-black leading-snug text-white">{v.name}</p>
                                  {v.year && <p className="text-[10px] font-semibold text-[#526179] mt-0.5">{v.year}</p>}
                                </div>
                                {v.who_can_drive.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Who Can Use</span>
                                    <div className="flex flex-wrap gap-1">
                                      {v.who_can_drive.map(r => <span key={r} className="rounded border border-[#4384ff]/30 bg-[#4384ff]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6fa3ff]">{r}</span>)}
                                    </div>
                                  </div>
                                )}
                                {v.liveries.length > 0 && (
                                  <div className="flex flex-col gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Liveries</span>
                                    <div className="flex flex-wrap gap-1">
                                      {v.liveries.map(l => <span key={l} className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-semibold text-[#526179]">{l}</span>)}
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

            {/* ── EQUIPMENT ROSTER ────────────────────────────────────────────── */}
            {activeTab === 'equipment-roster' && (
              <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#4384ff]/20 bg-[#4384ff]/8">
                  <Package className="h-8 w-8 text-[#4384ff]/60" />
                </div>
                <div>
                  <p className="text-sm font-black text-[#526179]">No equipment logged</p>
                  <p className="mt-1 text-xs text-[#3f5470]">Equipment added in the Department Panel will appear here.</p>
                </div>
              </div>
            )}

            {/* ── EVENT CALENDAR ──────────────────────────────────────────────── */}
            {activeTab === 'event-calendar' && (
              <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/8">
                  <CalendarDays className="h-8 w-8 text-[#a78bfa]/60" />
                </div>
                <div>
                  <p className="text-sm font-black text-[#526179]">No events scheduled</p>
                  <p className="mt-1 text-xs text-[#3f5470]">Events added in the Department Panel will appear here.</p>
                </div>
              </div>
            )}

            {/* ── DEPARTMENT PANEL ────────────────────────────────────────────── */}
            {activeTab === 'department-panel' && (
              <>
                {/* ── Landing picker ──────────────────────────────────────────── */}
                {panelSection === null && (
                  <div className="space-y-4">
                    <div className="grid gap-5 sm:grid-cols-2">
                      {/* Personnel Roster card */}
                      <div className="group relative rounded-2xl border border-[#f4c542]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#f4c542]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#f4c542]/40 to-transparent" />
                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#f4c542]/20 bg-[#f4c542]/8">
                            <Users className="h-6 w-6 text-[#f4c542]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Personnel Roster</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">Manage dispatchers, ranks, callsigns, and certifications.</p>
                          </div>
                        </div>
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
                        <button type="button" onClick={() => setPanelSection('personnel')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#f4c542]/30 bg-[#f4c542]/8 py-3 text-xs font-black text-[#f4c542] transition-all hover:bg-[#f4c542]/15 hover:border-[#f4c542]/50 hover:shadow-[0_0_20px_rgba(244,197,66,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />Edit Personnel Roster
                        </button>
                      </div>

                      {/* Vehicle Roster card */}
                      <div className="group relative rounded-2xl border border-[#4384ff]/20 bg-[#070d16] p-7 shadow-[0_18px_40px_rgba(0,0,0,0.25)] transition-all hover:border-[#4384ff]/40 hover:shadow-[0_22px_55px_rgba(0,0,0,0.35)]">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#4384ff]/40 to-transparent" />
                        <div className="mb-6 flex items-start gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#4384ff]/20 bg-[#4384ff]/8">
                            <Car className="h-6 w-6 text-[#4384ff]" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">Vehicle Roster</h3>
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">Manage department vehicles, assignments, and fleet inventory.</p>
                          </div>
                        </div>
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
                        <button type="button" onClick={() => setPanelSection('vehicle')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#4384ff]/30 bg-[#4384ff]/8 py-3 text-xs font-black text-[#4384ff] transition-all hover:bg-[#4384ff]/15 hover:border-[#4384ff]/50 hover:shadow-[0_0_20px_rgba(67,132,255,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />Edit Vehicle Roster
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
                            <p className="mt-1 text-xs text-[#526179] leading-relaxed">Schedule and manage department events, training sessions, and operations.</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => setPanelSection('calendar')}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#a78bfa]/30 bg-[#a78bfa]/8 py-3 text-xs font-black text-[#a78bfa] transition-all hover:bg-[#a78bfa]/15 hover:border-[#a78bfa]/50 hover:shadow-[0_0_20px_rgba(167,139,250,0.12)]">
                          <Pencil className="h-3.5 w-3.5" />Edit Event Calendar
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Personnel section ──────────────────────────────────────── */}
                {panelSection === 'personnel' && (
                  <div className="space-y-6">
                    <button type="button" onClick={() => setPanelSection(null)}
                      className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#f4c542] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                      Department Panel
                      <span className="text-[#2a3a50]">/</span>
                      <span className="text-[#f4c542]">Personnel Roster</span>
                    </button>

                    <div className="rounded-xl border border-[#f4c542]/20 bg-[#070d16] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
                      <div className="flex items-center gap-4 border-b border-[#131f30] px-6 py-4">
                        <Settings className="h-4 w-4 text-[#f4c542]" />
                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#f4c542]">Personnel Management</h3>
                        <div className="ml-auto flex items-center gap-3">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                            <input type="text" placeholder="Search members…"
                              value={panelSearch} onChange={e => setPanelSearch(e.target.value)}
                              className="h-9 w-48 rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                          </div>
                          <button type="button" onClick={() => setAddOpen(true)}
                            className="flex items-center gap-2 rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors">
                            <Plus className="h-3.5 w-3.5" />Add Member
                          </button>
                          <button type="button" onClick={() => { setAddTitleOpen(true); setNewGroupName(''); }}
                            className="flex items-center gap-2 rounded-lg border border-[#f4c542]/30 bg-[#f4c542]/5 px-4 py-2 text-xs font-black text-[#f4c542] hover:bg-[#f4c542]/10 transition-colors">
                            <Plus className="h-3.5 w-3.5" />Add Title
                          </button>
                        </div>
                      </div>

                      {/* Titles section */}
                      {(groups.length > 0 || addTitleOpen) && (
                        <div className="border-t border-[#131f30]">
                          <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                            <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Titles</span>
                            <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{groups.length}</span>
                          </div>
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
                                      setDragGroupId(g.id); e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragEnd={() => clearGroupDrag()}
                                    onDragOver={e => {
                                      if (dragGroupId !== null && dragGroupId !== g.id) {
                                        e.preventDefault();
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        setDragGroupOverId(g.id);
                                        setDragGroupOverSide(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
                                        return;
                                      }
                                      if (dragRankId === null) return;
                                      e.preventDefault(); setDragOverGroupId(g.id);
                                    }}
                                    onDragLeave={e => {
                                      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                        setDragOverGroupId(null); setDragGroupOverId(null);
                                      }
                                    }}
                                    onDrop={e => {
                                      e.preventDefault();
                                      if (dragGroupId !== null && dragGroupId !== g.id) { handleGroupReorder(dragGroupId, g.id, dragGroupOverSide); clearGroupDrag(); return; }
                                      if (dragRankId !== null) handleRankReorder(g.id, dragRankId, null, 'after');
                                      clearDrag();
                                    }}
                                    style={isGroupDragOver ? { boxShadow: dragGroupOverSide === 'before' ? 'inset 0 3px 0 #4384ff' : 'inset 0 -3px 0 #4384ff' } : undefined}>
                                    <div className={`flex items-center gap-3 px-6 py-2.5 transition-colors group/row ${isRankDropTarget ? 'bg-[#091828] ring-1 ring-inset ring-[#4384ff]/30' : 'hover:bg-[#081422]'}`}>
                                      {editingGroupId === g.id ? (
                                        <>
                                          <input autoFocus type="text" value={editingGroupName}
                                            onChange={e => setEditingGroupName(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') handleRenameGroup(g.id); if (e.key === 'Escape') setEditingGroupId(null); }}
                                            className="flex-1 h-7 rounded border border-[#2f70ff] bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none" />
                                          <button type="button" onClick={() => handleRenameGroup(g.id)} className="rounded px-2 py-1 text-[10px] font-black bg-[#2f66ee] text-white hover:bg-[#3977ff] transition-colors">Save</button>
                                          <button type="button" onClick={() => setEditingGroupId(null)} className="rounded px-2 py-1 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
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
                                            {ranks.filter(r => r.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order).map(r => {
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
                                                <button key={r.id} type="button" draggable data-rank-chip
                                                  title={`Drag to reorder or move · Click to edit: ${r.name}`}
                                                  onClick={() => { if (!dragRankId) setEditRankId(r.id); }}
                                                  onDragStart={e => { e.stopPropagation(); setDragRankId(r.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setDragImage(e.currentTarget, 0, 0); }}
                                                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDragOverRankId(r.id); setDragOverGroupId(g.id); setDragOverSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'); }}
                                                  onDragLeave={() => setDragOverRankId(null)}
                                                  onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragRankId !== null) handleRankReorder(g.id, dragRankId, r.id, dragOverSide); clearDrag(); }}
                                                  onDragEnd={clearDrag}
                                                  className="group/chip flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold select-none transition-all"
                                                  style={{ ...baseStyle, ...dropStyle, opacity: isDragging ? 0.35 : 1, cursor: 'grab' }}>
                                                  <GripVertical className="h-2.5 w-2.5 opacity-20 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                  {r.insignia_url && <img src={r.insignia_url} alt="" className="h-4 w-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                                                  {r.name}
                                                  <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                  <span role="button" title="Delete rank" onClick={e => { e.stopPropagation(); handleDeleteRank(r.id, r.name); }} className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-red-400 cursor-pointer leading-none">
                                                    <Trash2 className="h-2.5 w-2.5" />
                                                  </span>
                                                </button>
                                              );
                                            })}
                                            {ranks.filter(r => r.group_id === g.id).length === 0 && dragRankId !== null && (
                                              <span className="rounded border border-dashed border-[#4384ff]/40 px-2 py-0.5 text-[9px] text-[#4384ff]/60 select-none">Drop here</span>
                                            )}
                                          </div>
                                          <button type="button" onClick={() => { setAddRankGroupId(g.id); setNewRankName(''); }}
                                            className="flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#2f70ff] hover:text-[#4384ff] transition-colors shrink-0">
                                            <Plus className="h-3 w-3" />Add Rank
                                          </button>
                                          <button type="button"
                                            title={g.panel_access ? 'Department Panel access ON — click to disable' : 'Department Panel access OFF — click to enable'}
                                            onClick={() => handleTogglePanelAccess(g.id, !g.panel_access)}
                                            className={`flex items-center gap-1 rounded border px-2 py-1 text-[9px] font-black transition-colors shrink-0 ${g.panel_access ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'border-[#1f3050] bg-[#0a1525] text-[#3f5470] hover:border-[#2f70ff] hover:text-[#4384ff]'}`}>
                                            <Shield className="h-3 w-3" />Panel
                                          </button>
                                          <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                                            <button type="button" title="Rename" onClick={() => { setEditingGroupId(g.id); setEditingGroupName(g.name); }} className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-[#4384ff] transition-colors"><Pencil className="h-3 w-3" /></button>
                                            <button type="button" title="Move up" onClick={() => handleMoveGroup(g.id, 'up')} disabled={i === 0} className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"><ChevronUp className="h-3 w-3" /></button>
                                            <button type="button" title="Move down" onClick={() => handleMoveGroup(g.id, 'down')} disabled={i === groups.length - 1} className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"><ChevronDown className="h-3 w-3" /></button>
                                            <button type="button" title="Delete title" onClick={() => handleDeleteGroup(g.id, g.name)} className="rounded p-1 text-[#3f5470] hover:bg-red-500/10 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                    {addRankGroupId === g.id && (
                                      <div className="flex items-center gap-2 px-6 py-2.5 bg-[#060c18] border-t border-[#0c1525]">
                                        <input autoFocus type="text" placeholder="Rank name…" value={newRankName} onChange={e => setNewRankName(e.target.value)}
                                          onKeyDown={e => { if (e.key === 'Enter') handleAddRankToGroup(g.id); if (e.key === 'Escape') setAddRankGroupId(null); }}
                                          className="flex-1 h-8 rounded border border-[#1f3050] bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                                        <button type="button" onClick={() => handleAddRankToGroup(g.id)} disabled={addingRank || !newRankName.trim()}
                                          className="rounded border border-[#2f66ee] bg-[#2f66ee]/10 px-3 py-1.5 text-[10px] font-black text-[#4384ff] hover:bg-[#2f66ee]/20 transition-colors disabled:opacity-40">
                                          {addingRank ? 'Adding…' : 'Add'}
                                        </button>
                                        <button type="button" onClick={() => setAddRankGroupId(null)} className="rounded p-1.5 text-[#526179] hover:text-white transition-colors"><X className="h-3.5 w-3.5" /></button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {addTitleOpen && (
                                <div className="flex items-center gap-2 px-6 py-3 bg-[#060c18]">
                                  <input autoFocus type="text" placeholder="Title name…" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') setAddTitleOpen(false); }}
                                    className="flex-1 h-8 rounded border border-[#f4c542]/30 bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#f4c542]/60" />
                                  <button type="button" onClick={handleAddGroup} disabled={addingGroup || !newGroupName.trim()}
                                    className="rounded border border-[#f4c542]/40 bg-[#f4c542]/10 px-3 py-1.5 text-[10px] font-black text-[#f4c542] hover:bg-[#f4c542]/20 transition-colors disabled:opacity-40">
                                    {addingGroup ? 'Creating…' : 'Create'}
                                  </button>
                                  <button type="button" onClick={() => setAddTitleOpen(false)} className="rounded p-1.5 text-[#526179] hover:text-white transition-colors"><X className="h-3.5 w-3.5" /></button>
                                </div>
                              )}
                            </div>
                        </div>
                      )}

                      {groups.length === 0 && !addTitleOpen && !groupsLoading && (
                        <div className="border-t border-[#131f30] px-6 py-4 flex items-center gap-3">
                          <span className="text-xs text-[#3f5470]">No titles yet.</span>
                          <button type="button" onClick={() => { setAddTitleOpen(true); setNewGroupName(''); }} className="text-xs font-black text-[#f4c542] hover:underline">Add your first title →</button>
                        </div>
                      )}

                      {/* Members table */}
                      {filteredPanel.length === 0 ? (
                        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2">
                          <Users className="h-8 w-8 text-[#1e2e42]" />
                          <p className="text-sm font-bold text-[#3f5470]">No members found.</p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-[#131f30]">
                                <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Username</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Rank</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Callsign</th>
                                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Status</th>
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
                                      {(() => { const ins = ranks.find(r => r.name.toLowerCase() === (m.doc_rank || m.rank)?.toLowerCase())?.insignia_url; return ins ? <img src={ins} alt="" className="h-4 w-4 object-contain shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null; })()}
                                      <span className="capitalize text-[#a8b7cd]">{m.doc_rank || m.rank || '—'}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3.5 font-black text-[#4384ff]">{m.callsign || '—'}</td>
                                  <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                                  <td className="px-4 py-3.5 text-[#8392aa]">{formatDate(m.appointed_date)}</td>
                                  <td className="px-4 py-3.5">
                                    <div className="flex items-center justify-end gap-2">
                                      <button type="button" onClick={() => setEditMember(m)} className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#2f70ff] hover:text-white transition-colors"><Pencil className="h-3 w-3" />Edit</button>
                                      <button type="button" onClick={() => handleDelete(m)} className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-black text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"><Trash2 className="h-3 w-3" />Remove</button>
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
                )}

                {/* ── Vehicle section ──────────────────────────────────────────── */}
                {panelSection === 'vehicle' && (() => {
                  const filteredFleet = fleet.filter(v => {
                    const q = vehiclePanelSearch.toLowerCase();
                    return !q || v.name.toLowerCase().includes(q) || v.category.toLowerCase().includes(q) || v.who_can_drive.some(r => r.toLowerCase().includes(q));
                  });

                  const handleAddCategory = async () => {
                    if (!newCategoryName.trim()) return;
                    setAddingCategory(true);
                    try {
                      await fetch('/api/doc/fleet/categories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: newCategoryName.trim() }) });
                      setAddCategoryOpen(false); setNewCategoryName(''); fetchFleetPanel();
                    } catch { toast.error('Failed to add title.'); }
                    finally { setAddingCategory(false); }
                  };

                  const handleRenameCategory = async (id: number) => {
                    if (!editingCategoryName.trim()) return;
                    try {
                      await fetch(`/api/doc/fleet/categories/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: editingCategoryName.trim() }) });
                      setEditingCategoryId(null); fetchFleetPanel();
                    } catch { toast.error('Failed to rename title.'); }
                  };

                  const handleDeleteCategory = async (id: number, name: string) => {
                    if (!confirm(`Delete title "${name}" and all its vehicles?`)) return;
                    try { await fetch(`/api/doc/fleet/categories/${id}`, { method: 'DELETE' }); fetchFleetPanel(); }
                    catch { toast.error('Failed to delete title.'); }
                  };

                  const handleMoveCategory = async (id: number, dir: 'up' | 'down') => {
                    const idx = fleetCategories.findIndex(c => c.id === id);
                    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
                    if (swapIdx < 0 || swapIdx >= fleetCategories.length) return;
                    const reordered = [...fleetCategories];
                    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
                    setFleetCategories(reordered);
                    try {
                      await fetch('/api/doc/fleet/categories/reorder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ordered: reordered.map(c => c.id) }) });
                    } catch { toast.error('Failed to reorder.'); fetchFleetPanel(); }
                  };

                  const addVehicleCatName = fleetCategories.find(c => c.id === addVehicleCatId)?.name ?? '';

                  const handleAddVehicleToCategory = async () => {
                    if (!newVehicleForm.name.trim()) return;
                    setAddingVehicleInCat(true);
                    try {
                      await fetch('/api/doc/fleet', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          name: newVehicleForm.name.trim(), year: newVehicleForm.year.trim() || null,
                          category: addVehicleCatName, image_url: newVehicleForm.imageUrl.trim() || null,
                          who_can_drive: newVehicleForm.restrictToRanks.split(',').map(s => s.trim()).filter(Boolean),
                          restrict_to_divisions: newVehicleForm.restrictToDivisions,
                          liveries: newVehicleForm.liveries.split(',').map(s => s.trim()).filter(Boolean),
                          notes: newVehicleForm.notes.trim() || null, actor: session?.username ?? 'DOC Panel',
                        }),
                      });
                      setAddVehicleCatId(null);
                      setNewVehicleForm({ name: '', year: '', restrictToRanks: '', restrictToDivisions: [], notes: '', imageUrl: '', liveries: '' });
                      fetchFleetPanel();
                    } catch { toast.error('Failed to add vehicle.'); }
                    finally { setAddingVehicleInCat(false); }
                  };

                  const handleDeleteVehicle = async (id: number, name: string) => {
                    if (!confirm(`Remove "${name}" from the roster?`)) return;
                    try { await fetch(`/api/doc/fleet/${id}`, { method: 'DELETE', headers: { 'x-actor': session?.username ?? 'DOC Panel' } }); fetchFleetPanel(); }
                    catch { toast.error('Failed to remove vehicle.'); }
                  };

                  const handleSaveVehicle = async () => {
                    if (!editVehicleItem) return;
                    setSavingVehicle(true);
                    try {
                      await fetch(`/api/doc/fleet/${editVehicleItem.id}`, {
                        method: 'PATCH', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ name: editVehicleItem.name, year: editVehicleItem.year || null, category: editVehicleItem.category, image_url: editVehicleItem.image_url || null, who_can_drive: editVehicleItem.who_can_drive, restrict_to_divisions: editVehicleItem.restrict_to_divisions, liveries: editVehicleItem.liveries, notes: editVehicleItem.notes || null, actor: session?.username ?? 'DOC Panel' }),
                      });
                      setEditVehicleItem(null); fetchFleetPanel();
                    } catch { toast.error('Failed to save vehicle.'); }
                    finally { setSavingVehicle(false); }
                  };

                  return (
                    <div className="space-y-6">
                      <button type="button" onClick={() => setPanelSection(null)} className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#4384ff] transition-colors">
                        <ChevronRight className="h-3.5 w-3.5 rotate-180" />Department Panel<span className="text-[#2a3a50]">/</span><span className="text-[#4384ff]">Vehicle Roster</span>
                      </button>

                      {/* Add Vehicle modal */}
                      {addVehicleCatId !== null && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                          <div className="w-full max-w-lg rounded-2xl border border-[#1e3050] bg-[#0a1525] shadow-2xl flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between border-b border-[#131f30] px-6 py-4 shrink-0">
                              <div><h3 className="text-sm font-black text-white">Add Vehicle</h3><p className="text-[10px] text-[#526179] mt-0.5">Title: <span className="text-[#4384ff]">{addVehicleCatName}</span></p></div>
                              <button type="button" onClick={() => setAddVehicleCatId(null)} className="rounded p-1 text-[#526179] hover:text-white"><X className="h-4 w-4" /></button>
                            </div>
                            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                              {newVehicleForm.imageUrl && (
                                <div className="rounded-lg overflow-hidden border border-[#1f3050] bg-[#07111f] h-36 flex items-center justify-center">
                                  <img src={newVehicleForm.imageUrl} alt="Vehicle preview" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2"><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Name <span className="text-red-400">*</span></label><input autoFocus type="text" placeholder="e.g. Ford Explorer" value={newVehicleForm.name} onChange={e => setNewVehicleForm(f => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Year</label><input type="text" placeholder="e.g. 2024" value={newVehicleForm.year} onChange={e => setNewVehicleForm(f => ({ ...f, year: e.target.value }))} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Picture URL</label><input type="text" placeholder="https://…" value={newVehicleForm.imageUrl} onChange={e => setNewVehicleForm(f => ({ ...f, imageUrl: e.target.value }))} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div className="col-span-2">
                                  <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Restrict to Ranks</label>
                                  {(() => {
                                    const selected = newVehicleForm.restrictToRanks.split(',').map(s => s.trim()).filter(Boolean);
                                    const toggle = (name: string) => { const next = selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name]; setNewVehicleForm(f => ({ ...f, restrictToRanks: next.join(', ') })); };
                                    return (
                                      <div className="relative">
                                        <button type="button" onClick={() => setAddRankDropOpen(o => !o)} className="w-full flex items-center justify-between rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-left outline-none focus:border-[#4384ff] transition-colors hover:border-[#2f50a0]">
                                          <span className={selected.length === 0 ? 'text-[#3f5470]' : 'text-white'}>{selected.length === 0 ? 'Select ranks…' : selected.join(', ')}</span>
                                          <ChevronDown className="h-3.5 w-3.5 text-[#526179] shrink-0 ml-2" />
                                        </button>
                                        {addRankDropOpen && (
                                          <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#1f3050] bg-[#07111f] shadow-xl max-h-48 overflow-y-auto">
                                            {ranks.length === 0 ? <div className="px-3 py-2 text-xs text-[#3f5470]">No ranks found.</div> : ranks.map(r => (<label key={r.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0d1a2e] cursor-pointer transition-colors"><input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)} className="accent-[#4384ff] h-3.5 w-3.5 shrink-0" /><span className="text-xs font-semibold text-[#a8b7cd]">{r.name}</span></label>))}
                                            <div className="border-t border-[#131f30] px-3 py-2"><button type="button" onClick={() => setAddRankDropOpen(false)} className="w-full rounded bg-[#1a2a40] py-1.5 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Done</button></div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                                <div className="col-span-2">
                                  <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Divisional Accessible By</label>
                                  <div className="flex flex-wrap gap-2">
                                    {DIVISION_OPTIONS.map(d => { const checked = newVehicleForm.restrictToDivisions.includes(d.key); return (<button key={d.key} type="button" onClick={() => setNewVehicleForm(f => ({ ...f, restrictToDivisions: checked ? f.restrictToDivisions.filter(x => x !== d.key) : [...f.restrictToDivisions, d.key] }))} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-black transition-colors ${checked ? 'border-[#4384ff] bg-[#0d1e36] text-[#4384ff]' : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#2a4060] hover:text-[#a8b7cd]'}`}><span className="font-black">{d.key}</span><span className="font-semibold opacity-70">| {d.label}</span></button>); })}
                                  </div>
                                </div>
                                <div className="col-span-2"><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Livery <span className="normal-case font-normal text-[#3f5470]">(comma-separated)</span></label><input type="text" placeholder="Standard, Supervisor, Unmarked" value={newVehicleForm.liveries} onChange={e => setNewVehicleForm(f => ({ ...f, liveries: e.target.value }))} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div className="col-span-2"><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Notes</label><textarea rows={3} placeholder="Any additional notes…" value={newVehicleForm.notes} onChange={e => setNewVehicleForm(f => ({ ...f, notes: e.target.value }))} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff] resize-none" /></div>
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t border-[#131f30] px-6 py-4 shrink-0">
                              <button type="button" onClick={() => setAddVehicleCatId(null)} className="rounded-lg border border-[#1f3050] px-4 py-2 text-xs font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                              <button type="button" onClick={handleAddVehicleToCategory} disabled={addingVehicleInCat || !newVehicleForm.name.trim()} className="rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors disabled:opacity-50">{addingVehicleInCat ? 'Adding…' : 'Add Vehicle'}</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Edit vehicle modal */}
                      {editVehicleItem && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                          <div className="w-full max-w-lg rounded-2xl border border-[#1e3050] bg-[#0a1525] shadow-2xl flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between border-b border-[#131f30] px-6 py-4 shrink-0">
                              <div><h3 className="text-sm font-black text-white">Edit Vehicle</h3><p className="text-[10px] text-[#526179] mt-0.5">Title: <span className="text-[#4384ff]">{editVehicleItem.category}</span></p></div>
                              <button type="button" onClick={() => setEditVehicleItem(null)} className="rounded p-1 text-[#526179] hover:text-white"><X className="h-4 w-4" /></button>
                            </div>
                            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
                              {editVehicleItem.image_url && (<div className="rounded-lg overflow-hidden border border-[#1f3050] bg-[#07111f] h-36 flex items-center justify-center"><img src={editVehicleItem.image_url} alt="Vehicle" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} /></div>)}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2"><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Name</label><input type="text" placeholder="e.g. Ford Explorer" value={editVehicleItem.name} onChange={e => setEditVehicleItem({ ...editVehicleItem, name: e.target.value })} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Vehicle Year</label><input type="text" placeholder="e.g. 2024" value={editVehicleItem.year ?? ''} onChange={e => setEditVehicleItem({ ...editVehicleItem, year: e.target.value })} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Picture URL</label><input type="text" placeholder="https://…" value={editVehicleItem.image_url ?? ''} onChange={e => setEditVehicleItem({ ...editVehicleItem, image_url: e.target.value })} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div className="col-span-2">
                                  <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Restrict to Ranks</label>
                                  {(() => {
                                    const selected = editVehicleItem.who_can_drive;
                                    const toggle = (name: string) => { const next = selected.includes(name) ? selected.filter(r => r !== name) : [...selected, name]; setEditVehicleItem({ ...editVehicleItem, who_can_drive: next }); };
                                    return (
                                      <div className="relative">
                                        <button type="button" onClick={() => setEditRankDropOpen(o => !o)} className="w-full flex items-center justify-between rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-left outline-none focus:border-[#4384ff] transition-colors hover:border-[#2f50a0]">
                                          <span className={selected.length === 0 ? 'text-[#3f5470]' : 'text-white'}>{selected.length === 0 ? 'Select ranks…' : selected.join(', ')}</span>
                                          <ChevronDown className="h-3.5 w-3.5 text-[#526179] shrink-0 ml-2" />
                                        </button>
                                        {editRankDropOpen && (
                                          <div className="absolute z-10 mt-1 w-full rounded-lg border border-[#1f3050] bg-[#07111f] shadow-xl max-h-48 overflow-y-auto">
                                            {ranks.length === 0 ? <div className="px-3 py-2 text-xs text-[#3f5470]">No ranks found.</div> : ranks.map(r => (<label key={r.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#0d1a2e] cursor-pointer transition-colors"><input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggle(r.name)} className="accent-[#4384ff] h-3.5 w-3.5 shrink-0" /><span className="text-xs font-semibold text-[#a8b7cd]">{r.name}</span></label>))}
                                            <div className="border-t border-[#131f30] px-3 py-2"><button type="button" onClick={() => setEditRankDropOpen(false)} className="w-full rounded bg-[#1a2a40] py-1.5 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Done</button></div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                                <div className="col-span-2">
                                  <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Divisional Accessible By</label>
                                  <div className="flex flex-wrap gap-2">
                                    {DIVISION_OPTIONS.map(d => { const checked = editVehicleItem.restrict_to_divisions.includes(d.key); return (<button key={d.key} type="button" onClick={() => setEditVehicleItem({ ...editVehicleItem, restrict_to_divisions: checked ? editVehicleItem.restrict_to_divisions.filter(x => x !== d.key) : [...editVehicleItem.restrict_to_divisions, d.key] })} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-black transition-colors ${checked ? 'border-[#4384ff] bg-[#0d1e36] text-[#4384ff]' : 'border-[#1f3050] bg-[#07111f] text-[#526179] hover:border-[#2a4060] hover:text-[#a8b7cd]'}`}><span className="font-black">{d.key}</span><span className="font-semibold opacity-70">| {d.label}</span></button>); })}
                                  </div>
                                </div>
                                <div className="col-span-2"><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Livery <span className="normal-case font-normal text-[#3f5470]">(comma-separated)</span></label><input type="text" placeholder="Standard, Supervisor, Unmarked" value={editVehicleItem.liveries.join(', ')} onChange={e => setEditVehicleItem({ ...editVehicleItem, liveries: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]" /></div>
                                <div className="col-span-2"><label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-[#526179]">Notes</label><textarea rows={3} placeholder="Any additional notes…" value={editVehicleItem.notes ?? ''} onChange={e => setEditVehicleItem({ ...editVehicleItem, notes: e.target.value })} className="w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff] resize-none" /></div>
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 border-t border-[#131f30] px-6 py-4 shrink-0">
                              <button type="button" onClick={() => setEditVehicleItem(null)} className="rounded-lg border border-[#1f3050] px-4 py-2 text-xs font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                              <button type="button" onClick={handleSaveVehicle} disabled={savingVehicle} className="rounded-lg bg-[#2f66ee] px-4 py-2 text-xs font-black text-white hover:bg-[#3977ff] transition-colors disabled:opacity-50">{savingVehicle ? 'Saving…' : 'Save Changes'}</button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Main card */}
                      <div className="rounded-xl border border-[#4384ff]/20 bg-[#070d16] overflow-hidden shadow-[0_22px_55px_rgba(0,0,0,0.22)]">
                        <div className="flex items-center gap-4 border-b border-[#131f30] px-6 py-4">
                          <Car className="h-4 w-4 text-[#4384ff]" />
                          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">Vehicle Management</h3>
                          <div className="ml-auto flex items-center gap-3">
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#526179]" />
                              <input type="text" placeholder="Search vehicles…" value={vehiclePanelSearch} onChange={e => setVehiclePanelSearch(e.target.value)} className="h-9 w-48 rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]" />
                            </div>
                            <button type="button" onClick={() => { setAddCategoryOpen(true); setNewCategoryName(''); }} className="flex items-center gap-2 rounded-lg border border-[#4384ff]/30 bg-[#4384ff]/5 px-4 py-2 text-xs font-black text-[#4384ff] hover:bg-[#4384ff]/10 transition-colors"><Plus className="h-3.5 w-3.5" />Add Title</button>
                          </div>
                        </div>

                        {(fleetCategories.length > 0 || addCategoryOpen) && (
                          <div className="border-b border-[#131f30]">
                            <div className="flex items-center gap-2 px-6 py-2.5 bg-[#070d16]">
                              <span className="text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Titles</span>
                              <span className="rounded-full bg-[#0f1b28] px-1.5 py-0.5 text-[9px] font-black text-[#3f5470]">{fleetCategories.length}</span>
                            </div>
                            <div className="divide-y divide-[#0c1525]">
                                {fleetCategories.map((cat, i) => (
                                  <div key={cat.id}>
                                    <div className="flex items-center gap-3 px-6 py-2.5 transition-colors group/row hover:bg-[#081422]"
                                      onDragOver={e => { if (dragVehicleId === null) return; e.preventDefault(); setDragOverVehicleCat(cat.name); setDragOverVehicleId(null); }}
                                      onDrop={e => { e.preventDefault(); if (dragVehicleId === null) return; handleVehicleReorder(cat.name, cat.sort_order, dragVehicleId, null, 'after'); setDragVehicleId(null); setDragOverVehicleId(null); setDragOverVehicleCat(null); }}>
                                      {editingCategoryId === cat.id ? (
                                        <>
                                          <input autoFocus type="text" value={editingCategoryName} onChange={e => setEditingCategoryName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRenameCategory(cat.id); if (e.key === 'Escape') setEditingCategoryId(null); }} className="flex-1 h-7 rounded border border-[#2f70ff] bg-[#07111f] px-2.5 text-xs font-semibold text-white outline-none" />
                                          <button type="button" onClick={() => handleRenameCategory(cat.id)} className="rounded px-2 py-1 text-[10px] font-black bg-[#2f66ee] text-white hover:bg-[#3977ff] transition-colors">Save</button>
                                          <button type="button" onClick={() => setEditingCategoryId(null)} className="rounded px-2 py-1 text-[10px] font-black text-[#526179] hover:text-white transition-colors">Cancel</button>
                                        </>
                                      ) : (
                                        <>
                                          <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover/row:opacity-40 transition-opacity text-[#526179]" />
                                          <span className="flex-1 text-xs font-black text-[#a8b7cd]">{cat.name}</span>
                                          <div className="flex flex-wrap gap-1 mr-2">
                                            {fleet.filter(v => v.category === cat.name).sort((a, b) => a.sort_order - b.sort_order).map(v => {
                                              const chipDragging   = dragVehicleId === v.id;
                                              const chipDropBefore = dragOverVehicleId === v.id && dragOverVehicleSide === 'before';
                                              const chipDropAfter  = dragOverVehicleId === v.id && dragOverVehicleSide === 'after';
                                              return (
                                                <button key={v.id} type="button" draggable title={`Drag to reorder · Click to edit: ${v.name}`}
                                                  onDragStart={e => { setDragVehicleId(v.id); e.dataTransfer.effectAllowed = 'move'; const ghost = document.createElement('div'); ghost.style.cssText = 'position:fixed;top:-9999px'; document.body.appendChild(ghost); e.dataTransfer.setDragImage(ghost, 0, 0); setTimeout(() => document.body.removeChild(ghost), 0); }}
                                                  onDragOver={e => { if (dragVehicleId === null || dragVehicleId === v.id) return; e.preventDefault(); e.stopPropagation(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDragOverVehicleId(v.id); setDragOverVehicleSide(e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'); setDragOverVehicleCat(cat.name); }}
                                                  onDragLeave={() => setDragOverVehicleId(null)}
                                                  onDrop={e => { e.preventDefault(); e.stopPropagation(); if (dragVehicleId === null) return; handleVehicleReorder(cat.name, cat.sort_order, dragVehicleId, v.id, dragOverVehicleSide); setDragVehicleId(null); setDragOverVehicleId(null); setDragOverVehicleCat(null); }}
                                                  onDragEnd={() => { setDragVehicleId(null); setDragOverVehicleId(null); setDragOverVehicleCat(null); }}
                                                  onClick={() => setEditVehicleItem(v)}
                                                  style={{ opacity: chipDragging ? 0.35 : 1, boxShadow: chipDropBefore ? '-3px 0 0 0 #4384ff' : chipDropAfter ? '3px 0 0 0 #4384ff' : undefined, transition: 'box-shadow 80ms, opacity 80ms' }}
                                                  className="group/chip flex items-center gap-1 rounded border border-[#4384ff]/30 bg-[#4384ff]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6fa3ff] select-none cursor-grab active:cursor-grabbing transition-all hover:border-[#4384ff]/60">
                                                  <GripVertical className="h-2.5 w-2.5 opacity-30 shrink-0" />
                                                  {v.name}
                                                  <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/chip:opacity-50 transition-opacity shrink-0" />
                                                  <span role="button" title="Delete vehicle" onClick={e => { e.stopPropagation(); handleDeleteVehicle(v.id, v.name); }} className="opacity-0 group-hover/chip:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-red-400 cursor-pointer leading-none"><Trash2 className="h-2.5 w-2.5" /></span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                          <button type="button" onClick={() => { setAddVehicleCatId(cat.id); setAddRankDropOpen(false); setNewVehicleForm({ name: '', year: '', restrictToRanks: '', restrictToDivisions: [], notes: '', imageUrl: '', liveries: '' }); }} className="flex items-center gap-1 rounded border border-[#1f3050] bg-[#0a1525] px-2.5 py-1 text-[9px] font-black text-[#526179] hover:border-[#2f70ff] hover:text-[#4384ff] transition-colors shrink-0"><Plus className="h-3 w-3" />Add Vehicle</button>
                                          <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0">
                                            <button type="button" title="Rename" onClick={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }} className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-[#4384ff] transition-colors"><Pencil className="h-3 w-3" /></button>
                                            <button type="button" title="Move up" onClick={() => handleMoveCategory(cat.id, 'up')} disabled={i === 0} className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"><ChevronUp className="h-3 w-3" /></button>
                                            <button type="button" title="Move down" onClick={() => handleMoveCategory(cat.id, 'down')} disabled={i === fleetCategories.length - 1} className="rounded p-1 text-[#3f5470] hover:bg-[#0d1a28] hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"><ChevronDown className="h-3 w-3" /></button>
                                            <button type="button" title="Delete title" onClick={() => handleDeleteCategory(cat.id, cat.name)} className="rounded p-1 text-[#3f5470] hover:bg-red-500/10 hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                {addCategoryOpen && (
                                  <div className="flex items-center gap-2 px-6 py-3 bg-[#060c18]">
                                    <input autoFocus type="text" placeholder="Title name…" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddCategory(); if (e.key === 'Escape') setAddCategoryOpen(false); }} className="flex-1 h-8 rounded border border-[#4384ff]/30 bg-[#07111f] px-3 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#4384ff]/60" />
                                    <button type="button" onClick={handleAddCategory} disabled={addingCategory || !newCategoryName.trim()} className="rounded border border-[#4384ff]/40 bg-[#4384ff]/10 px-3 py-1.5 text-[10px] font-black text-[#4384ff] hover:bg-[#4384ff]/20 transition-colors disabled:opacity-40">{addingCategory ? 'Creating…' : 'Create'}</button>
                                    <button type="button" onClick={() => setAddCategoryOpen(false)} className="rounded p-1.5 text-[#526179] hover:text-white transition-colors"><X className="h-3.5 w-3.5" /></button>
                                  </div>
                                )}
                              </div>
                          </div>
                        )}

                        {fleetCategories.length === 0 && !addCategoryOpen && !categoriesLoading && (
                          <div className="border-b border-[#131f30] px-6 py-4 flex items-center gap-3">
                            <span className="text-xs text-[#3f5470]">No titles yet.</span>
                            <button type="button" onClick={() => { setAddCategoryOpen(true); setNewCategoryName(''); }} className="text-xs font-black text-[#4384ff] hover:underline">Add your first title →</button>
                          </div>
                        )}

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
                          <div className="flex min-h-[160px] flex-col items-center justify-center gap-2"><Car className="h-8 w-8 text-[#1e2e42]" /><p className="text-sm font-bold text-[#3f5470]">No vehicles found.</p></div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[620px] border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-[#131f30]">
                                  <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Vehicle</th>
                                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Title</th>
                                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Who Can Use</th>
                                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Liveries</th>
                                  <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredFleet.map(v => (
                                  <tr key={v.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                    <td className="px-5 py-3.5 font-black text-white">{v.name}</td>
                                    <td className="px-4 py-3.5 text-[#526179]">{v.category}</td>
                                    <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1">{v.who_can_drive.length > 0 ? v.who_can_drive.map(r => <span key={r} className="rounded border border-[#4384ff]/30 bg-[#4384ff]/10 px-1.5 py-0.5 text-[9px] font-semibold text-[#6fa3ff]">{r}</span>) : <span className="text-[#2a3a50]">—</span>}</div></td>
                                    <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1">{v.liveries.length > 0 ? v.liveries.map(l => <span key={l} className="rounded border border-[#1f3050] bg-[#0a1525] px-1.5 py-0.5 text-[9px] font-semibold text-[#526179]">{l}</span>) : <span className="text-[#2a3a50]">—</span>}</div></td>
                                    <td className="px-4 py-3.5"><div className="flex items-center justify-end gap-2">
                                      <button type="button" onClick={() => setEditVehicleItem(v)} className="flex items-center gap-1.5 rounded-lg border border-[#1f3050] bg-[#0a1525] px-3 py-1.5 text-[10px] font-black text-[#a8b7cd] hover:border-[#2f70ff] hover:text-white transition-colors"><Pencil className="h-3 w-3" />Edit</button>
                                      <button type="button" onClick={() => handleDeleteVehicle(v.id, v.name)} className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-black text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors"><Trash2 className="h-3 w-3" />Remove</button>
                                    </div></td>
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

                {/* ── Event Calendar section ──────────────────────────────────── */}
                {panelSection === 'calendar' && (
                  <div className="space-y-6">
                    <button type="button" onClick={() => setPanelSection(null)} className="flex items-center gap-2 text-xs font-black text-[#526179] hover:text-[#a78bfa] transition-colors">
                      <ChevronRight className="h-3.5 w-3.5 rotate-180" />Back<span className="text-[#a78bfa]">Event Calendar</span>
                    </button>
                    <div className="relative rounded-2xl border border-[#a78bfa]/20 bg-[#070d16] shadow-[0_18px_40px_rgba(0,0,0,0.25)]">
                      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-[#a78bfa]/40 to-transparent" />
                      <div className="flex items-center justify-between border-b border-[#131f30] px-8 py-5">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#a78bfa]">Event Calendar</h3>
                          <p className="mt-1 text-xs text-[#526179]">Schedule and manage department events, training sessions, and operations.</p>
                        </div>
                        <button type="button" className="flex items-center gap-1.5 rounded-lg border border-[#a78bfa]/30 bg-[#a78bfa]/8 px-3 py-2 text-xs font-black text-[#a78bfa] hover:bg-[#a78bfa]/15 transition-colors"><Plus className="h-3.5 w-3.5" />Add Event</button>
                      </div>
                      <div className="flex flex-col items-center justify-center gap-4 px-8 py-20 text-center">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/8"><CalendarDays className="h-8 w-8 text-[#a78bfa]/60" /></div>
                        <div>
                          <p className="text-sm font-black text-[#526179]">No events scheduled</p>
                          <p className="mt-1 text-xs text-[#3f5470]">Add your first department event to get started.</p>
                        </div>
                      </div>
                    </div>
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
  );
};

export default DepartmentOfCommunications;
