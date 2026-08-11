import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortalSection } from '@/hooks/usePortalSection';
import { BookOpen, CalendarDays, ChevronDown, ChevronRight, FileText, LayoutDashboard, LogOut, MapPin, Pencil, Plus, Search, Shield, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import DocumentEditor from '@/components/editor/DocumentEditor';
import PdfViewer from '@/components/shared/PdfViewer';
import { clearCadSession, getCadSession, setCadSession, type CadSession } from '@/lib/cad-session';
import { isSuperAdminSession } from '@/lib/superadmin';
import { getStaffRosterTitle, getStaffSidebarTitle } from '@/lib/display-rank';

// ── Access control ─────────────────────────────────────────────────────────────
const STAFF_ROLE_GROUPS = ['Executive Team', 'Owner', 'Executive', 'Management', 'Admin', 'Moderation'];
const ADMIN_ROLE_GROUPS = ['Executive Team', 'Owner', 'Executive', 'Management', 'Admin'];
const hasStaffRole = (role: string) =>
  STAFF_ROLE_GROUPS.some((g) => g.toLowerCase() === role.trim().toLowerCase());
const hasAdminRole = (role: string) =>
  ADMIN_ROLE_GROUPS.some((g) => g.toLowerCase() === role.trim().toLowerCase());

// ── Types ──────────────────────────────────────────────────────────────────────
type StaffGroup  = { id: number; name: string; sort_order: number; locked: boolean; staff_access: boolean; admin_access: boolean };
type StaffRank   = { id: number; name: string; sort_order: number; group_id: number | null; color_hex: string | null };
type StaffMember = {
  id: number; username: string; discord_username: string; discord_id: string;
  avatar_hash: string | null;
  /** Legacy fields kept for backward compat */
  rank: string; role: string;
  /** New separated fields */
  staff_rank: string | null; staff_role: string | null;
  status: string; staff_appointed_date: string | null;
};
type StaffResource = {
  id: number;
  title: string;
  type: string;
  logo_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type StaffEvent = {
  id: number;
  title: string;
  event_date: string;
  event_time: string | null;
  location: string | null;
  purpose: string | null;
  hosted_by: string | null;
  hosting_department: string | null;
  is_public: boolean;
  created_at: string;
};
type ModerationLog = {
  id: number; target_username: string; type: string;
  reason: string; issued_by: string; created_at: string;
};
type LookupAccount = {
  id: number; username: string; rank: string; role: string;
  status: string; discord_username: string; discord_id: string; avatar_hash: string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────────
const MOD_TYPES = ['Warning', 'Strike', 'BOLO', 'Kick', 'Ban'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────
const modTypeCls = (type: string) => {
  const t = type.toLowerCase();
  if (t === 'ban')    return 'border-red-600/40 bg-red-600/15 text-red-300';
  if (t === 'kick')   return 'border-orange-500/40 bg-orange-500/15 text-orange-300';
  if (t === 'bolo')   return 'border-[#ff5d5d]/40 bg-[#ff5d5d]/15 text-[#ff7070]';
  if (t === 'strike') return 'border-amber-400/40 bg-amber-400/15 text-amber-200';
  return 'border-blue-500/40 bg-blue-500/15 text-blue-300'; // Warning
};

// ── Sub-components ─────────────────────────────────────────────────────────────
const StatusBadge = ({ status }: { status: string }) => {
  const active = status?.toLowerCase() === 'active';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${
      active ? 'bg-emerald-500 text-white' : 'bg-[#1a2638] text-[#526179]'
    }`}>
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

const Avatar = ({ name, discordId, avatarHash, size = 'sm' }: { name: string; discordId?: string; avatarHash?: string | null; size?: 'sm' | 'md' }) => {
  const [imgError, setImgError] = React.useState(false);
  const initial = (name?.[0] ?? '?').toUpperCase();
  const colors = ['bg-[#5865f2]', 'bg-[#3ba55c]', 'bg-[#ed4245]', 'bg-[#faa61a]', 'bg-[#9c84ec]'];
  const color  = colors[(name?.charCodeAt(0) ?? 0) % colors.length];
  const sz     = size === 'md' ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[9px]';
  const src = !imgError ? discordAvatarUrl(discordId, avatarHash, size === 'md' ? 128 : 64) : null;
  if (src) {
    return <img src={src} alt={name} className={`${sz} shrink-0 rounded-full object-cover`} onError={() => setImgError(true)} />;
  }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${color} ${sz} font-black text-white`}>
      {initial}
    </span>
  );
};

// ── Main page ──────────────────────────────────────────────────────────────────
const StaffPortalClassic = () => {
  const navigate = useNavigate();
  const [session,     setSession]     = useState<CadSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── Tab ───────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = usePortalSection<'roster' | 'resources' | 'events'>({
    base: 'staff',
    valid: ['roster', 'resources', 'events'] as const,
    defaultSection: 'roster',
  });

  // ── Roster state ──────────────────────────────────────────────────────────
  const [groups,       setGroups]       = useState<StaffGroup[]>([]);
  const [ranks,        setRanks]        = useState<StaffRank[]>([]);
  const [members,      setMembers]      = useState<StaffMember[]>([]);
  const [dataLoading,  setDataLoading]  = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [collapsed,    setCollapsed]    = useState<Record<string, boolean>>({});

  // ── Resources (view-only) ─────────────────────────────────────────────────
  const [resources,        setResources]        = useState<StaffResource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [openDocId,        setOpenDocId]        = useState<number | null>(null);
  const [openPdf,          setOpenPdf]          = useState<StaffResource | null>(null);

  // ── Events ────────────────────────────────────────────────────────────────
  const [events,          setEvents]          = useState<StaffEvent[]>([]);
  const [eventsLoading,   setEventsLoading]   = useState(false);
  const [showEventForm,   setShowEventForm]   = useState(false);
  const [editingEvent,    setEditingEvent]    = useState<StaffEvent | null>(null);
  const [eventForm,       setEventForm]       = useState({
    title: '', event_date: '', event_time: '', location: '', purpose: '',
    hosted_by: '', is_public: true,
  });
  const [savingEvent,     setSavingEvent]     = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);

  // ── Moderation state ──────────────────────────────────────────────────────
  const [modForm,       setModForm]       = useState({ username: '', type: '', reason: '' });
  const [modSubmitting, setModSubmitting] = useState(false);
  const [recentMods,    setRecentMods]    = useState<ModerationLog[]>([]);
  const [feedLoading,   setFeedLoading]   = useState(false);
  const [lookupQuery,   setLookupQuery]   = useState('');
  const [lookupResult,  setLookupResult]  = useState<{ account: LookupAccount | null; moderations: ModerationLog[] } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupPanel,   setLookupPanel]   = useState<'account' | 'moderations'>('account');
  const feedInterval = useRef<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [profileOpen]);

  // ── Auth ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const validate = async () => {
      const s = getCadSession();
      if (!s) { navigate('/', { replace: true }); return; }
      try {
        const [res, grpRes] = await Promise.all([
          fetch('/api/cad-auth/session-status', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ id: s.id, email: s.email }),
          }),
          fetch('/api/staff/groups', { headers: { accept: 'application/json' } }),
        ]);
        if (!res.ok) throw new Error();
        const data = await res.json() as { active: boolean; account?: CadSession };
        if (!data.active || !data.account) {
          clearCadSession(); toast.error('Session expired. Please log in again.');
          navigate('/', { replace: true }); return;
        }
        const account = data.account;
        let canAccess = isSuperAdminSession(account);
        if (!canAccess && grpRes.ok) {
          try {
            const fetchedGroups = await grpRes.json() as StaffGroup[];
            const effectiveRole = (account.staff_role ?? account.role).toLowerCase().trim();
            const grp = fetchedGroups.find(g => g.name.toLowerCase() === effectiveRole);
            canAccess = grp?.staff_access ?? false;
          } catch { /* deny on parse error */ }
        }
        if (!canAccess) { navigate('/portal_dashboard', { replace: true }); return; }
        setCadSession(account);
        if (mounted) { setSession(account); setAuthLoading(false); }
      } catch {
        // Network failure — cannot verify group flags; deny access
        navigate('/portal_dashboard', { replace: true });
      }
    };
    validate();
    return () => { mounted = false; };
  }, [navigate]);

  // ── Fetch roster ───────────────────────────────────────────────────────────
  const fetchRoster = async (currentSession?: typeof session) => {
    setDataLoading(true);
    try {
      const [grps, rnks, mems] = await Promise.all([
        fetch('/api/staff/groups',       { headers: { accept: 'application/json' } }).then(r => r.json()),
        fetch('/api/staff/ranks',        { headers: { accept: 'application/json' } }).then(r => r.json()),
        fetch('/api/staff/roster?all=1', { headers: { accept: 'application/json' } }).then(r => r.json()),
      ]);
      const groupList = grps as StaffGroup[];
      const sess = currentSession ?? session;
      const userRole = (sess?.staff_role ?? sess?.role) ?? '';
      const userGroup = groupList.find(g => g.name.toLowerCase() === userRole.toLowerCase().trim());
      if (!isSuperAdminSession(sess) && userGroup && !userGroup.staff_access) {
        toast.error('Your role no longer has Staff Portal access.');
        navigate('/portal_dashboard', { replace: true }); return;
      }
      setGroups(groupList);
      setRanks(rnks   as StaffRank[]);
      setMembers(Array.isArray(mems) ? mems as StaffMember[] : []);
    } catch {
      toast.error('Failed to load staff roster.');
    } finally {
      setDataLoading(false);
    }
  };

  // ── Fetch recent moderations ───────────────────────────────────────────────
  const fetchRecentMods = async () => {
    setFeedLoading(true);
    try {
      const r = await fetch('/api/moderations', { headers: { accept: 'application/json' } });
      if (r.ok) setRecentMods(await r.json() as ModerationLog[]);
    } catch { /* silent */ } finally { setFeedLoading(false); }
  };

  useEffect(() => {
    if (!authLoading && session) fetchRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const fetchResources = async () => {
    setResourcesLoading(true);
    try {
      const r = await fetch('/api/staff/resources', { headers: { accept: 'application/json' } });
      if (!r.ok) {
        setResources([]);
        return;
      }
      const rows = await r.json();
      setResources(Array.isArray(rows) ? rows as StaffResource[] : []);
    } catch {
      setResources([]);
    } finally {
      setResourcesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'resources') return;
    void fetchResources();
  }, [activeTab]);

  const fetchEvents = async () => {
    setEventsLoading(true);
    try {
      const r = await fetch('/api/staff/events', { headers: { accept: 'application/json' } });
      if (!r.ok) { setEvents([]); return; }
      const rows = await r.json();
      setEvents(Array.isArray(rows) ? rows as StaffEvent[] : []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'events') return;
    void fetchEvents();
  }, [activeTab]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const getRankMeta = (rankName: string) =>
    ranks.find(r => r.name.toLowerCase() === rankName?.toLowerCase().trim()) ?? null;

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    try {
      // Append local noon so date-only strings (YYYY-MM-DD) don't shift a day in UTC-behind timezones
      const s = d.length === 10 ? d + 'T12:00:00' : d;
      return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return d; }
  };

  const formatDateTime = (d: string) => {
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
             dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch { return d; }
  };

  const toggleGroup = (label: string) =>
    setCollapsed(p => ({ ...p, [label]: !p[label] }));

  // ── Moderation handlers ────────────────────────────────────────────────────
  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = lookupQuery.trim();
    if (!q) return;
    setLookupLoading(true); setLookupResult(null);
    try {
      const r = await fetch(`/api/moderations/user/${encodeURIComponent(q)}`, { headers: { accept: 'application/json' } });
      if (r.ok) { setLookupResult(await r.json() as { account: LookupAccount | null; moderations: ModerationLog[] }); setLookupPanel('account'); }
      else toast.error('Lookup failed.');
    } catch { toast.error('Lookup failed.'); }
    finally { setLookupLoading(false); }
  };

  const handleSubmitMod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modForm.username.trim() || !modForm.type || !modForm.reason.trim()) {
      toast.error('All fields are required.'); return;
    }
    setModSubmitting(true);
    try {
      const r = await fetch('/api/moderations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target_username: modForm.username.trim(),
          type: modForm.type,
          reason: modForm.reason.trim(),
          issued_by: session?.username ?? 'Unknown',
        }),
      });
      const data = await r.json() as ModerationLog & { error?: string };
      if (!r.ok) { toast.error(data.error ?? 'Failed to log moderation.'); return; }
      toast.success(`Moderation logged for ${modForm.username}.`);
      setModForm({ username: '', type: '', reason: '' });
      setRecentMods(prev => [data, ...prev].slice(0, 50));
    } catch { toast.error('Failed to log moderation.'); }
    finally { setModSubmitting(false); }
  };

  // ── Roster filter / group ──────────────────────────────────────────────────
  const filteredMembers = members.filter(m => {
    const q = rosterSearch.toLowerCase();
    return !q || m.username.toLowerCase().includes(q) || (m.staff_rank || m.rank || '').toLowerCase().includes(q) || m.discord_username?.toLowerCase().includes(q);
  });
  const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const groupedRoster = sortedGroups.map(g => ({
    id: g.id, label: g.name, locked: g.locked,
    members: filteredMembers.filter(m => (m.staff_role ?? m.role) === g.name),
  }));
  const definedLabels = new Set(groups.map(g => g.name));
  const orphans = filteredMembers.filter(m => !definedLabels.has(m.staff_role ?? m.role ?? ''));
  if (orphans.length > 0) groupedRoster.push({ id: -1, label: 'Other', locked: false, members: orphans });
  const totalVisible = filteredMembers.length;

  const pageLoading = authLoading
    || (activeTab === 'roster' && dataLoading)
    || (activeTab === 'resources' && resourcesLoading)
    || (activeTab === 'events' && eventsLoading);

  const inputCls = 'h-10 w-full rounded-lg border border-[#1f3050] bg-[#07111f] px-3 text-sm font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#ff5d5d] transition-colors';
  const labelCls = 'block text-[10px] font-black uppercase tracking-[0.18em] text-[#6f7f99] mb-1.5';

  return (
    <main className="min-h-screen bg-[#02060b] text-white">

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 flex w-[265px] flex-col border-r border-[#182232] bg-[#03070c] px-5 py-5">
        <div className="shrink-0">
          <h1 className="text-xl font-black tracking-[-0.04em] text-white">Staff Roster</h1>
          <p className="mt-2 flex items-center gap-2 text-sm font-black leading-none text-[#ff5d5d]"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#7b8ca7]">
            {getStaffSidebarTitle(session)}
          </p>
        </div>

        <div className="sidebar-scroll mt-8 flex-1 overflow-x-hidden overflow-y-auto">
          <nav className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('roster')}
              className={`flex items-center gap-2.5 rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
                activeTab === 'roster'
                  ? 'border-l-2 border-[#ff5d5d] bg-[#1a0608] text-white'
                  : 'text-[#a8b7cd] hover:bg-white/5 hover:text-white'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" />
              Staff Roster
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('resources')}
              className={`flex items-center gap-2.5 rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
                activeTab === 'resources'
                  ? 'border-l-2 border-[#ff5d5d] bg-[#1a0608] text-white'
                  : 'text-[#a8b7cd] hover:bg-white/5 hover:text-white'
              }`}
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              Resources
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('events')}
              className={`flex items-center gap-2.5 rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors ${
                activeTab === 'events'
                  ? 'border-l-2 border-[#ff5d5d] bg-[#1a0608] text-white'
                  : 'text-[#a8b7cd] hover:bg-white/5 hover:text-white'
              }`}
            >
              <CalendarDays className="h-4 w-4 shrink-0" />
              Events
            </button>
          </nav>

          <div className="mt-6 flex flex-col gap-2 border-t border-[#182232] pt-6">
            <button
              type="button"
              onClick={() => window.open('https://portal.dojrblx.com/', '_blank')}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase text-[#a8b7cd] transition-colors hover:text-white"
            >
              <Shield className="h-4 w-4" />
              Staff Portal
            </button>
            {(isSuperAdminSession(session) || (groups.find(g => g.name.toLowerCase() === ((session?.staff_role ?? session?.role) ?? '').toLowerCase().trim())?.admin_access ?? false)) && (
              <button
                type="button"
                onClick={() => navigate('/admin_members')}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase text-[#a8b7cd] transition-colors hover:text-white"
              >
                <Shield className="h-4 w-4" />
                Admin Portal
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/portal_dashboard')}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase text-[#a8b7cd] transition-colors hover:text-white"
            >
              <LayoutDashboard className="h-4 w-4" />
              Member Portal
            </button>
          </div>
        </div>

        <div className="hidden lg:block border-t border-[#182232] px-3 py-4">
          <button type="button" onClick={() => { clearCadSession(); navigate('/', { replace: true }); }}
            className="flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm font-bold text-[#dce7f8] transition-colors hover:bg-white/5 hover:text-[#4384ff]">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <section className="ml-[265px] flex min-h-screen flex-col">
        <header className="relative z-40 flex items-center justify-between border-b border-[#182232] px-9 py-4">
          <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
          {/* Right — profile avatar */}
          <div className="relative" ref={profileRef}>
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
                  <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{getStaffSidebarTitle(session)}</p>
                </div>
                <button type="button" onClick={() => { setProfileOpen(false); clearCadSession(); navigate('/', { replace: true }); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-bold text-[#ff7070] transition-colors hover:bg-white/5">
                  <LogOut className="h-4 w-4" />
                  Log off
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ─── ROSTER TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'roster' && (
          <div className="flex-1 px-8 py-9">
            {pageLoading ? (
              <PageLoadingScreen loading accent="#ff7070" />
            ) : (
            <>
            <div className="mb-8">
              <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">Staff Roster</h2>
              <p className="mt-2 text-sm text-[#8392aa]">Active staff roster for DOJ:RP.</p>
            </div>

            <div className="rounded-xl border border-[#172235] bg-[#0d1422] shadow-[0_22px_55px_rgba(0,0,0,0.22)] overflow-hidden">
              <div className="flex items-center gap-4 border-b border-[#172235] px-6 py-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#526179]" />
                  <input
                    type="text"
                    placeholder="Search by name, rank title…"
                    value={rosterSearch}
                    onChange={e => setRosterSearch(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#1f3050] bg-[#07111f] pl-9 pr-4 text-xs font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#2f70ff]"
                  />
                </div>
                <span className="shrink-0 text-[10px] font-black text-[#526179]">
                  {totalVisible} member{totalVisible !== 1 ? 's' : ''}
                </span>
              </div>

              {members.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
                  <Users className="h-8 w-8 text-[#1e2e42]" />
                  <p className="text-sm font-bold text-[#3f5470]">No staff members on the roster yet.</p>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-2">
                  <Users className="h-8 w-8 text-[#1e2e42]" />
                  <p className="text-sm font-bold text-[#3f5470]">No members match your search.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#131f30]">
                        <th className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-52">Name</th>
                        <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-40">Title</th>
                        <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-20">Status</th>
                        <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470] w-28">Appointed</th>
                        <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#3f5470]">Discord ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedRoster.map(group => (
                        <React.Fragment key={group.label}>
                          <tr
                            className="cursor-pointer border-b border-t border-[#172235] bg-[#0a1525] hover:bg-[#0c1830] transition-colors"
                            onClick={() => toggleGroup(group.label)}
                          >
                            <td colSpan={5} className="px-5 py-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                {collapsed[group.label]
                                  ? <ChevronRight className="h-3.5 w-3.5 text-[#ff5d5d] shrink-0" />
                                  : <ChevronDown  className="h-3.5 w-3.5 text-[#ff5d5d] shrink-0" />}
                                <span className="text-xs font-black text-white">{group.label}</span>
                                <span className="rounded-full bg-[#172235] px-2 py-0.5 text-[9px] font-black text-[#526179]">{group.members.length}</span>
                                {group.locked && (
                                  <span className="rounded border border-[#ff5d5d]/30 bg-[#ff5d5d]/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#ff7070]">PERMANENT</span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {!collapsed[group.label] && group.members.map(m => {
                            const rankMeta  = getRankMeta(m.staff_rank ?? '');
                            const chipColor = rankMeta?.color_hex ?? null;
                            return (
                              <tr key={m.id} className="border-b border-[#0f1b28] hover:bg-[#081422] transition-colors">
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-2">
                                    <Avatar name={m.discord_username || m.username} discordId={m.discord_id} avatarHash={m.avatar_hash} />
                                    <div className="min-w-0">
                                      <span className="block text-xs font-black text-white truncate">{m.username || '—'}</span>
                                      {m.discord_username && <span className="block text-[10px] text-[#526179] truncate">@{m.discord_username}</span>}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3.5">
                                  <span className="text-[10px] font-black" style={{ color: chipColor ?? '#a8b7cd' }}>{getStaffRosterTitle(m)}</span>
                                </td>
                                <td className="px-4 py-3.5"><StatusBadge status={m.status} /></td>
                                <td className="px-4 py-3.5 text-[#8392aa] text-[11px]">{formatDate(m.staff_appointed_date)}</td>
                                <td className="px-4 py-3.5"><span className="font-mono text-[11px] text-[#526179]">{m.discord_id || '—'}</span></td>
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
            </>
            )}
          </div>
        )}

        {/* ─── RESOURCES TAB (view only) ─────────────────────────────────────── */}
        {activeTab === 'resources' && (
          <div className="flex-1 px-8 py-9">
            {pageLoading ? (
              <PageLoadingScreen loading accent="#ff7070" />
            ) : (
              <>
                <div className="mb-8">
                  <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">
                    Staff Resources
                  </h2>
                  <p className="mt-2 text-sm text-[#8392aa]">
                    Guides and reference materials for staff. Managed from the Admin Portal.
                  </p>
                </div>

                {resources.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-[#172235] bg-[#0d1422] py-24 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#ff5d5d]/20 bg-[#ff5d5d]/8">
                      <BookOpen className="h-8 w-8 text-[#ff5d5d]/60" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-[#526179]">No resources posted</p>
                      <p className="mt-1 text-xs text-[#3f5470]">
                        Admins can add staff resources from the Admin Portal.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {resources.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          if (r.type === 'pdf') setOpenPdf(r);
                          else setOpenDocId(r.id);
                        }}
                        className="group relative flex flex-col gap-3 rounded-2xl border border-[#1e2d42] bg-[#0d1422] p-6 text-left shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all hover:border-[#ff5d5d]/40 hover:shadow-[0_12px_32px_rgba(0,0,0,0.3)]"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#ff5d5d]/20 bg-[#ff5d5d]/8">
                          <FileText className="h-5 w-5 text-[#ff7070]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-black text-white">{r.title}</p>
                          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#526179]">
                            {r.type === 'pdf' ? 'PDF' : 'Document'}
                          </p>
                        </div>
                        <p className="text-[10px] text-[#3f5470]">
                          {new Date(r.updated_at).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── EVENTS TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'events' && (
          <div className="flex-1 px-8 py-9">
            {pageLoading ? (
              <PageLoadingScreen loading accent="#ff7070" />
            ) : (
              <>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">
                      Staff Events
                    </h2>
                    <p className="mt-2 text-sm text-[#8392aa]">
                      Host server events as DOJ Staff. Public events appear on the website index as “Server event hosted by DOJ Staff”.
                    </p>
                  </div>
                  {!showEventForm && !editingEvent && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowEventForm(true);
                        setEditingEvent(null);
                        setEventForm({
                          title: '', event_date: '', event_time: '', location: '', purpose: '',
                          hosted_by: session?.username ?? '',
                          is_public: true,
                        });
                      }}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#ff5d5d] px-4 py-2.5 text-xs font-black text-white hover:bg-[#ff7070]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Host Event
                    </button>
                  )}
                </div>

                {(showEventForm || editingEvent) && (
                  <div className="mb-6 rounded-xl border border-[#ff5d5d]/25 bg-[#0d1422] p-6">
                    <h3 className="mb-4 text-sm font-black text-white">
                      {editingEvent ? 'Edit Event' : 'Host New Event'}
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Event title</label>
                        <input type="text" value={eventForm.title} placeholder="e.g. Server Community Night"
                          onChange={e => setEventForm(p => ({ ...p, title: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Date</label>
                        <input type="date" value={eventForm.event_date}
                          onChange={e => setEventForm(p => ({ ...p, event_date: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Time</label>
                        <input type="time" value={eventForm.event_time}
                          onChange={e => setEventForm(p => ({ ...p, event_time: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Hosted by</label>
                        <input type="text" value={eventForm.hosted_by} placeholder="Your name"
                          onChange={e => setEventForm(p => ({ ...p, hosted_by: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Hosting department</label>
                        <input type="text" value="DOJ Staff" readOnly
                          className={`${inputCls} cursor-not-allowed opacity-80`} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Location</label>
                        <input type="text" value={eventForm.location} placeholder="e.g. Main City, Discord VC"
                          onChange={e => setEventForm(p => ({ ...p, location: e.target.value }))}
                          className={inputCls} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Purpose / details</label>
                        <textarea value={eventForm.purpose} rows={3}
                          placeholder="What is this event for?"
                          onChange={e => setEventForm(p => ({ ...p, purpose: e.target.value }))}
                          className="w-full resize-none rounded-lg border border-[#1f3050] bg-[#07111f] px-3 py-2 text-sm font-semibold text-white placeholder:text-[#3f5470] outline-none focus:border-[#ff5d5d]" />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          type="button"
                          onClick={() => setEventForm(p => ({ ...p, is_public: !p.is_public }))}
                          className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                            eventForm.is_public
                              ? 'border-[#ff5d5d]/40 bg-[#ff5d5d]/8'
                              : 'border-[#1f3050] bg-[#07111f] hover:border-[#2f4060]'
                          }`}
                        >
                          <div className={`relative h-4 w-7 rounded-full transition-colors ${eventForm.is_public ? 'bg-[#ff5d5d]' : 'bg-[#1f3050]'}`}>
                            <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${eventForm.is_public ? 'translate-x-3' : 'translate-x-0.5'}`} />
                          </div>
                          <div>
                            <p className={`text-xs font-black ${eventForm.is_public ? 'text-[#ff7070]' : 'text-[#526179]'}`}>
                              {eventForm.is_public ? 'Public Event' : 'Internal Event'}
                            </p>
                            <p className="text-[10px] text-[#3f5470]">
                              {eventForm.is_public
                                ? 'Shown on the public website as a server event hosted by DOJ Staff'
                                : 'Only visible to staff in this portal'}
                            </p>
                          </div>
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={savingEvent || !eventForm.title.trim() || !eventForm.event_date}
                        onClick={async () => {
                          setSavingEvent(true);
                          try {
                            const url = editingEvent ? `/api/staff/events/${editingEvent.id}` : '/api/staff/events';
                            const r = await fetch(url, {
                              method: editingEvent ? 'PATCH' : 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                ...eventForm,
                                hosting_department: 'DOJ Staff',
                              }),
                            });
                            if (!r.ok) throw new Error();
                            toast.success(editingEvent ? 'Event updated.' : 'Event hosted.');
                            setShowEventForm(false);
                            setEditingEvent(null);
                            void fetchEvents();
                          } catch {
                            toast.error('Failed to save event.');
                          } finally {
                            setSavingEvent(false);
                          }
                        }}
                        className="rounded-lg bg-[#ff5d5d] px-4 py-2 text-xs font-black text-white hover:bg-[#ff7070] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingEvent ? 'Saving…' : (editingEvent ? 'Save Changes' : 'Host Event')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowEventForm(false); setEditingEvent(null); }}
                        className="rounded-lg border border-[#1e2d42] px-4 py-2 text-xs font-black text-[#526179] hover:border-[#2f4060] hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-xl border border-[#172235] bg-[#0d1422]">
                  {events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
                      <CalendarDays className="h-8 w-8 text-[#ff5d5d]/30" />
                      <p className="text-sm font-black text-[#526179]">No staff events yet</p>
                      <p className="text-xs text-[#3f5470]">Click “Host Event” to schedule a server event.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#0f1b28]">
                      {events.map(ev => {
                        const dateObj = new Date(ev.event_date + 'T12:00:00');
                        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                        const timeStr = ev.event_time
                          ? new Date(`1970-01-01T${ev.event_time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                          : null;
                        return (
                          <div key={ev.id} className="flex items-start gap-4 px-6 py-4 hover:bg-white/[0.02]">
                            <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border border-[#ff5d5d]/20 bg-[#ff5d5d]/8 text-center">
                              <span className="text-[8px] font-black uppercase text-[#ff7070]">
                                {dateObj.toLocaleDateString('en-US', { month: 'short' })}
                              </span>
                              <span className="text-sm font-black leading-none text-white">{dateObj.getDate()}</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs font-black text-white">{ev.title}</p>
                                {ev.is_public
                                  ? <span className="rounded-full border border-[#ff5d5d]/30 bg-[#ff5d5d]/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#ff7070]">Public</span>
                                  : <span className="rounded-full border border-[#1f3050] bg-[#0d1a28] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#3f5470]">Internal</span>}
                              </div>
                              <p className="mt-0.5 text-[10px] text-[#526179]">{dateStr}{timeStr ? ` · ${timeStr}` : ''}</p>
                              <p className="mt-0.5 text-[10px] text-[#8392aa]">
                                {ev.hosted_by ? `Hosted by ${ev.hosted_by}` : 'Hosted by DOJ Staff'} · DOJ Staff
                              </p>
                              {ev.location && (
                                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[#3f5470]">
                                  <MapPin className="h-2.5 w-2.5 shrink-0" />{ev.location}
                                </p>
                              )}
                              {ev.purpose && <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#526179]">{ev.purpose}</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
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
                                    is_public: ev.is_public,
                                  });
                                }}
                                className="rounded-md p-1.5 text-[#526179] hover:bg-white/5 hover:text-[#ff7070]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={deletingEventId === ev.id}
                                onClick={async () => {
                                  if (!confirm(`Delete "${ev.title}"?`)) return;
                                  setDeletingEventId(ev.id);
                                  try {
                                    const r = await fetch(`/api/staff/events/${ev.id}`, { method: 'DELETE' });
                                    if (!r.ok) throw new Error();
                                    toast.success('Event deleted.');
                                    void fetchEvents();
                                  } catch {
                                    toast.error('Failed to delete event.');
                                  } finally {
                                    setDeletingEventId(null);
                                  }
                                }}
                                className="rounded-md p-1.5 text-[#526179] hover:bg-red-900/20 hover:text-red-400 disabled:opacity-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {openDocId !== null && (
        <DocumentEditor
          key={`${openDocId}-view`}
          resourceId={openDocId}
          canEdit={false}
          apiBase="/api/staff/resources"
          onClose={() => setOpenDocId(null)}
        />
      )}

      {openPdf !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85">
          <div className="flex items-center justify-between border-b border-[#1e2d42] bg-[#0d1422] px-5 py-3">
            <p className="truncate text-sm font-black text-white">{openPdf.title}</p>
            <button
              type="button"
              onClick={() => setOpenPdf(null)}
              className="rounded-full p-1.5 text-[#4a5568] hover:bg-white/5 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PdfViewer
            fileUrl={`/api/staff/resources/${openPdf.id}/file`}
            downloadName={`${openPdf.title}.pdf`}
          />
        </div>
      )}
    </main>
  );
};

export default StaffPortalClassic;
