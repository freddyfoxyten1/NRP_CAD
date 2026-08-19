import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  Clock3,
  Gamepad2,
  HeartPulse,
  Home,
  Info,
  LogOut,
  Megaphone,
  Menu,
  Radio,
  Scale,
  Shield,
  Truck,
  User,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import DojrpShield from '@/components/shared/DojrpShield';
import { getCadSession } from '@/lib/cad-session';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import { renderContentBlocks } from '@/components/shared/ContentBlocks';
import { cadModeLabel } from '@/hooks/useCadStatus';
import { useMemberPortal } from './member-portal-shared';

const DPS_SEAL_URL = `${(import.meta.env.BASE_URL as string) ?? '/'}dps-seal.png`;
const DPH_SEAL_URL = `${(import.meta.env.BASE_URL as string) ?? '/'}dph-seal.png`;
const DOC_SEAL_URL = `${(import.meta.env.BASE_URL as string) ?? '/'}doc-seal.png`;
const IAB_SEAL_URL = `${(import.meta.env.BASE_URL as string) ?? '/'}iab-seal.png?v=4`;
const CIVILIAN_SEAL_URL = `${(import.meta.env.BASE_URL as string) ?? '/'}civilian-seal.png`;

type DepartmentEntry = {
  key: string;
  label: string;
  short: string;
  description: string;
  icon: typeof Shield;
  logoUrl?: string;
  placeholder?: boolean;
  accent: string;
  glow: string;
  path?: string;
  live: boolean;
};

const DEPARTMENTS: DepartmentEntry[] = [
  {
    key: 'dps',
    label: 'Department of Public Safety',
    short: 'DPS',
    description: 'Patrol, roster, resources, and department information.',
    icon: Shield,
    logoUrl: DPS_SEAL_URL,
    accent: '#4384ff',
    glow: 'rgba(67,132,255,0.22)',
    path: '/dps_information',
    live: true,
  },
  {
    key: 'dph',
    label: 'Department of Public Health',
    short: 'DPH',
    description: 'Medical division portal, roster, and department updates.',
    icon: HeartPulse,
    logoUrl: DPH_SEAL_URL,
    accent: '#34d399',
    glow: 'rgba(52,211,153,0.2)',
    path: '/dph_information',
    live: true,
  },
  {
    key: 'doc',
    label: 'Department of Communications',
    short: 'DOC',
    description: 'Communications division — opening soon.',
    icon: Radio,
    logoUrl: DOC_SEAL_URL,
    accent: '#a78bfa',
    glow: 'rgba(167,139,250,0.18)',
    live: false,
  },
  {
    key: 'iab',
    label: 'Department of Internal Affairs',
    short: 'IAB',
    description: 'Professional standards and oversight — opening soon.',
    icon: Scale,
    logoUrl: IAB_SEAL_URL,
    accent: '#f4c542',
    glow: 'rgba(244,197,66,0.18)',
    live: false,
  },
  {
    key: 'dot',
    label: 'Department of Transportation',
    short: 'DOT',
    description: 'Transportation division — opening soon.',
    icon: Truck,
    placeholder: true,
    accent: '#fb923c',
    glow: 'rgba(251,146,60,0.18)',
    live: false,
  },
  {
    key: 'civilian',
    label: 'Civilian Operations',
    short: 'CIV',
    description: 'Civilian division portal — opening soon.',
    icon: Briefcase,
    logoUrl: CIVILIAN_SEAL_URL,
    accent: '#94a3b8',
    glow: 'rgba(148,163,184,0.16)',
    live: false,
  },
];

function resolveMemberPortalDepartments(
  depts: DepartmentEntry[],
  options: { superAdmin: boolean; canAccessIab: boolean },
): DepartmentEntry[] {
  const unlockPaths: Record<string, string> = {
    doc: '/doc_information',
    iab: '/dps_internal-affairs',
    dot: '/dot_information',
    civilian: '/civilian_operations',
  };

  return depts.map((dept) => {
    if (dept.key === 'iab' && options.canAccessIab && !options.superAdmin) {
      return { ...dept, live: true, path: unlockPaths.iab };
    }
    if (!options.superAdmin || !unlockPaths[dept.key]) return dept;
    return { ...dept, live: true, path: unlockPaths[dept.key] };
  });
}

function DepartmentMark({
  dept,
  size = 'sm',
}: {
  dept: DepartmentEntry;
  size?: 'sm' | 'lg';
}) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-7 w-7 rounded-md';
  const iconSize = size === 'lg' ? 'h-6 w-6' : 'h-3.5 w-3.5';
  const bgAlpha = dept.live ? '22' : '14';

  if (dept.logoUrl) {
    const logoSize = size === 'lg' ? 'h-12 w-12' : 'h-8 w-8';
    return (
      <img
        src={dept.logoUrl}
        alt=""
        className={`shrink-0 object-contain ${logoSize}`}
      />
    );
  }

  if (dept.placeholder) {
    const circleSize = size === 'lg' ? 'h-14 w-14' : 'h-9 w-9';
    const textSize = size === 'lg' ? 'text-[8px]' : 'text-[6px]';
    return (
      <span
        className={`flex shrink-0 flex-col items-center justify-center rounded-full border border-[#1a2d45] bg-[#0a1018] px-1 text-center ${circleSize}`}
        aria-hidden="true"
      >
        <span className={`${textSize} font-bold uppercase leading-[1.1] tracking-wide text-[#4a6080]`}>
          coming
          <br />
          soon
        </span>
      </span>
    );
  }

  const Icon = dept.icon;
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${box}`}
      style={{ backgroundColor: `${dept.accent}${bgAlpha}`, color: dept.accent }}
    >
      <Icon className={iconSize} />
    </span>
  );
}

function ProfileAvatar({ username }: { username: string }) {
  const session = getCadSession();
  if (session?.discord_id && session?.avatar_hash) {
    return (
      <img
        src={`https://cdn.discordapp.com/avatars/${session.discord_id}/${session.avatar_hash}.png?size=128`}
        alt=""
        className="h-full w-full object-cover"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1a3a6e] to-[#0d1422] text-sm font-black text-[#67b0ff]">
      {(username || '?')[0]?.toUpperCase()}
    </span>
  );
}

function CadStatusPill({ cadOnline, cadMode, compact = false }: { cadOnline: boolean | null; cadMode: string; compact?: boolean }) {
  const offline = cadOnline === false;
  const label = cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`;
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border ${
        compact ? 'px-2 py-1' : 'px-3.5 py-1.5'
      } ${offline ? 'border-[#4a2028] bg-[#1a0a0e]' : 'border-[#1e3a5f] bg-[#081422]/90'}`}
      title={label}
    >
      <span className={`rounded-full ${compact ? 'h-2 w-2' : 'h-2 w-2'} ${offline ? 'bg-[#ff5d5d] shadow-[0_0_8px_rgba(255,93,93,0.55)]' : 'bg-[#4384ff] shadow-[0_0_8px_rgba(67,132,255,0.55)]'}`} />
      <span className={`font-black uppercase ${compact ? 'hidden min-[420px]:inline text-[9px] tracking-[0.18em]' : 'text-[10px] tracking-[0.28em]'} ${offline ? 'text-[#ff8a8a]' : 'text-[#7eb8ff]'}`}>
        {label}
      </span>
    </div>
  );
}

type PortalSidebarProps = {
  username: string;
  rank: string;
  role: string;
  activeNav: string;
  setActiveNav: (nav: string) => void;
  navigate: (path: string) => void;
  departments: DepartmentEntry[];
  canAccessStaff: boolean;
  canAccessAdminPortal: boolean;
  handleAdminPortal: () => void;
  handleGoToIndex: () => void;
  handleSignOut: () => void;
  isSigningOut: boolean;
  onNavigate?: () => void;
  showClose?: boolean;
  onClose?: () => void;
};

function PortalSidebarContent({
  username,
  rank,
  role,
  activeNav,
  setActiveNav,
  navigate,
  departments,
  canAccessStaff,
  canAccessAdminPortal,
  handleAdminPortal,
  handleGoToIndex,
  handleSignOut,
  isSigningOut,
  onNavigate,
  showClose,
  onClose,
}: PortalSidebarProps) {
  const finish = () => onNavigate?.();

  return (
    <>
      <div className="shrink-0 px-5 pb-4 pt-5 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <DojrpShield className="h-10 w-10 shrink-0 object-contain" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#4a6080]">Northpoint Roleplay CAD</p>
              <h1 className="text-base font-black tracking-tight text-white">Member Portal</h1>
            </div>
          </div>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1a2d45] text-[#8392aa] hover:bg-white/5 hover:text-white lg:hidden"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-[#1a2d45] bg-gradient-to-br from-[#0c1628] to-[#070d16] p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[#243650]">
              <ProfileAvatar username={username} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-white">{username}</p>
              <p className="truncate text-[11px] font-bold text-[#4384ff]">{rank}</p>
              {role !== 'Member' && (
                <p className="truncate text-[10px] text-[#5a7090]">{role}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-2 lg:px-3">
        <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {[
            { id: 'Dashboard', icon: Home, action: () => { setActiveNav('Dashboard'); finish(); } },
            { id: 'Information & Support', icon: Info, action: () => { setActiveNav('Information & Support'); finish(); } },
          ].map(({ id, icon: Icon, action }) => {
            const active = activeNav === id;
            return (
              <button
                key={id}
                type="button"
                onClick={action}
                className={`flex shrink-0 items-center gap-3 rounded-md border-l-2 px-4 py-3 text-left text-sm font-semibold leading-snug transition-colors lg:w-full ${
                  active
                    ? 'border-[#4384ff] bg-[#071120] text-white'
                    : 'border-transparent text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#4384ff]' : ''}`} />
                <span className="whitespace-nowrap lg:whitespace-normal">{id}</span>
                {active && <ChevronRight className="ml-auto hidden h-4 w-4 shrink-0 text-[#4384ff] lg:block" />}
              </button>
            );
          })}
        </nav>

        <p className="mb-1 mt-4 px-3 text-[9px] font-black uppercase tracking-[0.24em] text-[#3f5470]">
          Departments
        </p>

        <nav className="space-y-0.5 pb-2">
          {departments.map((dept) => (
              <button
                key={dept.key}
                type="button"
                disabled={!dept.live}
                onClick={() => {
                  if (dept.live && dept.path) {
                    navigate(dept.path);
                    finish();
                  }
                }}
                className={`flex w-full items-center gap-2.5 rounded-md border-l-2 px-3 py-2.5 text-left text-[13px] font-semibold leading-snug transition-colors ${
                  dept.live
                    ? 'border-transparent text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                    : 'cursor-not-allowed border-transparent text-[#3f5470]'
                }`}
              >
                <DepartmentMark dept={dept} size="sm" />
                <span className="min-w-0 flex-1 whitespace-normal break-words">{dept.label}</span>
                {!dept.live && (
                  <span className="shrink-0 rounded bg-[#121c2a] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#526179]">
                    Soon
                  </span>
                )}
              </button>
          ))}
        </nav>
      </div>

      <div className="shrink-0 border-t border-[#132033]">
        {(canAccessStaff || canAccessAdminPortal) && (
          <div className="px-4 py-4">
            <p className="mb-2 px-2 text-[9px] font-black uppercase tracking-[0.24em] text-[#3f5470]">Staff access</p>
            <div className="space-y-0.5">
              {canAccessStaff && (
                <>
                  <button
                    type="button"
                    onClick={() => { window.open('https://portal.dojrblx.com/', '_blank'); finish(); }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-bold text-[#7a90aa] hover:bg-white/5 hover:text-[#4384ff]"
                  >
                    <Shield className="h-3.5 w-3.5" /> Staff Portal
                  </button>
                  <button
                    type="button"
                    onClick={() => { navigate('/staff_roster'); finish(); }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-bold text-[#7a90aa] hover:bg-white/5 hover:text-[#4384ff]"
                  >
                    <Users className="h-3.5 w-3.5" /> Staff Roster
                  </button>
                </>
              )}
              {canAccessAdminPortal && (
                <button
                  type="button"
                  onClick={() => { handleAdminPortal(); finish(); }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-bold text-[#7a90aa] hover:bg-white/5 hover:text-[#4384ff]"
                >
                  <Building2 className="h-3.5 w-3.5" /> Admin Portal
                </button>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-[#132033] px-4 py-3 space-y-0.5">
          <button
            type="button"
            onClick={() => { handleGoToIndex(); finish(); }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-[#5a7090] hover:bg-white/5 hover:text-white"
          >
            <Home className="h-4 w-4" /> Back to Index
          </button>
          <button
            type="button"
            onClick={() => { handleSignOut(); finish(); }}
            disabled={isSigningOut}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-[#ff7b7b] hover:bg-[#ff5d5d]/10 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </>
  );
}

const MemberPortalModern = () => {
  const {
    navigate,
    portalData,
    isLoading,
    error,
    isSigningOut,
    profileOpen,
    setProfileOpen,
    profileRef,
    announcements,
    activeNav,
    setActiveNav,
    infoSections,
    infoLoading,
    handleSignOut,
    handleGoToIndex,
    handleAdminPortal,
    cadOnline,
    cadMode,
    username,
    rank,
    role,
    canAccessStaff,
    canAccessAdminPortal,
    superAdmin,
  } = useMemberPortal();

  const departments = resolveMemberPortalDepartments(DEPARTMENTS, {
    superAdmin,
    canAccessIab: Boolean(portalData?.profile.can_access_iab),
  });

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileNavOpen]);

  const sidebarProps: PortalSidebarProps = {
    username,
    rank,
    role,
    activeNav,
    setActiveNav,
    navigate,
    departments,
    canAccessStaff,
    canAccessAdminPortal,
    handleAdminPortal,
    handleGoToIndex,
    handleSignOut,
    isSigningOut,
    onNavigate: () => setMobileNavOpen(false),
  };

  const statusLabel = (() => {
    const status = portalData?.profile.status?.trim();
    if (!status) return '—';
    return status.charAt(0).toUpperCase() + status.slice(1);
  })();

  return (
    <main className="min-h-screen bg-[#030810] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-[#4384ff]/8 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#22d3ee]/6 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen flex-col lg:flex-row">
        {/* Desktop sidebar — unchanged at lg+ */}
        <aside className="hidden lg:flex lg:w-[300px] lg:flex-col lg:overflow-hidden lg:border-r lg:border-[#132033] lg:bg-[#050b14]/95 lg:backdrop-blur-xl lg:fixed lg:inset-y-0 lg:z-30">
          <PortalSidebarContent {...sidebarProps} />
        </aside>

        {/* Mobile / tablet drawer */}
        {mobileNavOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-[60] flex w-[min(300px,88vw)] flex-col overflow-hidden border-r border-[#132033] bg-[#050b14] shadow-2xl lg:hidden">
              <PortalSidebarContent {...sidebarProps} showClose onClose={() => setMobileNavOpen(false)} />
            </aside>
          </>
        )}

        {/* Main */}
        <section className="flex min-h-full flex-1 flex-col lg:ml-[300px]">
          <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[#132033]/80 bg-[#030810]/90 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8 lg:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#1a2d45] text-[#8392aa] hover:bg-white/5 hover:text-white"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">
                  {activeNav === 'Dashboard' ? 'Member Portal' : activeNav}
                </p>
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[#4384ff]">{rank}</p>
              </div>
            </div>
            <div className="hidden lg:block">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#4a6080]">Signed in</p>
              <p className="text-sm font-bold text-white">{activeNav}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="lg:hidden">
                <CadStatusPill cadOnline={cadOnline} cadMode={cadMode} compact />
              </div>
              <div className="hidden lg:block">
                <CadStatusPill cadOnline={cadOnline} cadMode={cadMode} />
              </div>
              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  onClick={() => setProfileOpen(o => !o)}
                  className="h-9 w-9 overflow-hidden rounded-xl border-2 border-[#243650] transition hover:border-[#4384ff] sm:h-10 sm:w-10"
                >
                  <ProfileAvatar username={username} />
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-[#1a2d45] bg-[#0a121c] shadow-2xl sm:top-12">
                    <div className="border-b border-[#132033] px-4 py-3">
                      <p className="text-sm font-black text-white">{username}</p>
                      <p className="text-[11px] text-[#4384ff]">{rank}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setProfileOpen(false); handleSignOut(); }}
                      disabled={isSigningOut}
                      className="flex w-full items-center gap-2 px-4 py-3 text-sm font-bold text-[#ff7b7b] hover:bg-white/5"
                    >
                      <LogOut className="h-4 w-4" />
                      {isSigningOut ? 'Signing out…' : 'Log off'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1 px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:px-10 lg:py-10 lg:pb-10">
            {isLoading ? (
              <PageLoadingScreen loading label="Loading member portal…" accent="#4384ff" />
            ) : error ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm font-bold text-red-100">
                {error}
              </div>
            ) : activeNav === 'Information & Support' ? (
              <div className="mx-auto max-w-4xl">
                <div className="mb-4 flex items-center gap-3 sm:mb-6">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4384ff]/15 sm:h-10 sm:w-10">
                    <Info className="h-4 w-4 text-[#4384ff] sm:h-5 sm:w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white sm:text-xl">Information & Support</h2>
                    <p className="text-[11px] text-[#5a7090] sm:text-xs">Help, policies, and community guidance</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[#1a2d45] bg-[#070d16]/90 p-4 sm:rounded-2xl sm:p-6 lg:p-8">
                  {infoLoading ? (
                    <div className="flex min-h-[240px] items-center justify-center text-sm text-[#4a6080]">
                      Loading…
                    </div>
                  ) : (
                    renderContentBlocks(infoSections, {
                      emptyTitle: 'No information posted yet',
                      emptyHint: 'Admins can publish Information & Support content from the Admin Portal.',
                      accent: '#4384ff',
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-6xl space-y-8 lg:space-y-10">
                {/* Hero */}
                <section className="relative overflow-hidden rounded-2xl border border-[#1a3050] bg-gradient-to-br from-[#0d1a30] via-[#0a1424] to-[#060c14] p-5 sm:p-6 lg:rounded-3xl lg:p-10">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#4384ff]/15 blur-3xl" />
                  <div className="relative flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#4384ff] sm:text-[11px] sm:tracking-[0.32em]">Welcome back</p>
                      <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-[2.75rem] lg:leading-none">
                        {username}
                      </h2>
                      <p className="mt-2 max-w-lg text-xs leading-relaxed text-[#8fa3bc] sm:mt-3 sm:text-sm">
                        Your hub for department portals, live server stats, and community announcements.
                        You&apos;re signed in as <span className="font-bold text-white">{rank}</span>
                        {role !== 'Member' && <> · <span className="text-[#9eb4cc]">{role}</span></>}.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4384ff]/30 bg-[#4384ff]/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#7eb8ff] sm:px-3 sm:py-1.5 sm:text-[11px]">
                        <BadgeCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> {statusLabel}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22d3ee]/25 bg-[#22d3ee]/8 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-[#7ee8f5] sm:px-3 sm:py-1.5 sm:text-[11px]">
                        <Activity className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> CAD Member
                      </span>
                    </div>
                  </div>
                </section>

                {/* Stats */}
                <section>
                  <h3 className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-[#4a6080] sm:mb-4 sm:text-[11px] sm:tracking-[0.28em]">Member Overview</h3>
                  <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                    {[
                      { label: 'Your rank', value: rank, icon: User, tone: 'from-[#1a3050] to-[#0a1525]', iconColor: '#4384ff' },
                      { label: 'Account status', value: statusLabel, icon: BadgeCheck, tone: 'from-[#143024] to-[#081510]', iconColor: '#34d399' },
                      { label: 'Play time', value: portalData?.stats.totalPlayTime ?? 'Coming soon', icon: Clock3, tone: 'from-[#2a2410] to-[#121008]', iconColor: '#f4c542' },
                      { label: 'In-game now', value: portalData?.stats.inGameCount ?? '…', icon: Gamepad2, tone: 'from-[#102030] to-[#080e18]', iconColor: '#4fc3f7' },
                    ].map(({ label, value, icon: Icon, tone, iconColor }) => (
                      <div
                        key={label}
                        className={`rounded-xl border border-[#1a2d45] bg-gradient-to-br ${tone} p-3.5 transition hover:border-[#2a4060] sm:rounded-2xl sm:p-5`}
                      >
                        <div className="flex items-start justify-between gap-2 sm:gap-3">
                          <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#5a7090] sm:text-[10px] sm:tracking-[0.2em]">{label}</p>
                            <p className="mt-1.5 truncate text-lg font-black tabular-nums tracking-tight text-white sm:mt-2 sm:text-2xl">{value}</p>
                          </div>
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 sm:rounded-xl"
                            style={{ backgroundColor: `${iconColor}18`, color: iconColor }}
                          >
                            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Department cards — horizontal scroll on phone, grid on sm+ */}
                <section>
                  <div className="mb-3 flex items-end justify-between gap-4 sm:mb-4">
                    <div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.24em] text-[#4a6080] sm:text-[11px] sm:tracking-[0.28em]">Your departments</h3>
                      <p className="mt-1 text-xs text-[#6a8098] sm:text-sm">Jump straight into a department portal</p>
                    </div>
                  </div>
                  <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 snap-x snap-mandatory sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0">
                    {departments.map((dept) => (
                        <button
                          key={dept.key}
                          type="button"
                          disabled={!dept.live}
                          onClick={() => { if (dept.live && dept.path) navigate(dept.path); }}
                          className={`group relative w-[min(82vw,280px)] shrink-0 snap-start overflow-hidden rounded-2xl border p-4 text-left transition-all sm:w-auto sm:shrink sm:p-5 ${
                            dept.live
                              ? 'border-[#1a2d45] bg-[#070d16]/90 hover:border-[#2a4060] hover:shadow-[0_12px_40px_rgba(0,0,0,0.35)]'
                              : 'cursor-not-allowed border-[#121c2a] bg-[#060a10]/80 opacity-75'
                          }`}
                        >
                          <div
                            className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl transition group-hover:opacity-100"
                            style={{ backgroundColor: dept.glow, opacity: dept.live ? 0.6 : 0.3 }}
                          />
                          <div className="relative flex items-start gap-4">
                            <DepartmentMark dept={dept} size="lg" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: dept.accent }}>
                                  {dept.short}
                                </span>
                                {!dept.live && (
                                  <span className="rounded-full bg-[#1a2438] px-2 py-0.5 text-[9px] font-bold uppercase text-[#5a7090]">
                                    Soon
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm font-black text-white">{dept.label}</p>
                              <p className="mt-1.5 text-xs leading-relaxed text-[#6a8098]">{dept.description}</p>
                            </div>
                            {dept.live && (
                              <ArrowUpRight className="h-5 w-5 shrink-0 text-[#4a6080] transition group-hover:text-white" />
                            )}
                          </div>
                        </button>
                    ))}
                  </div>
                </section>

                {/* Announcements */}
                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <Megaphone className="h-4 w-4 text-[#4384ff]" />
                    <h3 className="text-[11px] font-black uppercase tracking-[0.28em] text-[#4a6080]">
                      Announcements
                    </h3>
                    <span className="rounded-full bg-[#132033] px-2 py-0.5 text-[10px] font-black text-[#5a7090]">
                      {announcements.length}
                    </span>
                  </div>
                  {announcements.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#1a2d45] py-16 text-center">
                      <Megaphone className="h-8 w-8 text-[#243650]" />
                      <p className="text-sm font-bold text-[#4a6080]">No announcements right now.</p>
                      <p className="text-xs text-[#3a5068]">Check back later for community updates.</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-2">
                      {announcements.map((a, i) => (
                        <article
                          key={a.id}
                          className={`rounded-xl border border-[#1a2d45] bg-[#070d16]/90 p-4 sm:rounded-2xl sm:p-5 ${i === 0 ? 'md:col-span-2 md:p-6' : ''}`}
                        >
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
                            <h4 className={`font-black text-white ${i === 0 ? 'text-base sm:text-lg' : 'text-sm'}`}>{a.title}</h4>
                            <time className="shrink-0 text-[10px] font-semibold text-[#4a6080]">
                              {new Date(a.created_at).toLocaleString(undefined, {
                                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                              })}
                            </time>
                          </div>
                          <p className={`mt-3 whitespace-pre-wrap leading-relaxed text-[#8fa3bc] ${i === 0 ? 'text-sm' : 'text-xs'}`}>
                            {a.message}
                          </p>
                          <div className="mt-4 flex items-center gap-2 text-[10px] text-[#4a6080]">
                            <User className="h-3 w-3" />
                            <span className="font-bold">{a.posted_by}</span>
                            <span>·</span>
                            <Calendar className="h-3 w-3" />
                            <span>{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                {/* Community pulse */}
                <section className="rounded-xl border border-[#1a2d45] bg-[#070d16]/60 p-4 sm:rounded-2xl sm:p-5">
                  <div className="grid grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:items-center sm:gap-6">
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      <Wifi className="h-4 w-4 shrink-0 text-[#4384ff] sm:h-5 sm:w-5" />
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#4a6080] sm:text-[10px] sm:tracking-[0.2em]">Discord online</p>
                        <p className="text-base font-black text-white sm:text-lg">{portalData?.stats.totalOnlineMembers ?? '—'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      <Users className="h-4 w-4 shrink-0 text-[#34d399] sm:h-5 sm:w-5" />
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#4a6080] sm:text-[10px] sm:tracking-[0.2em]">Registered members</p>
                        <p className="text-base font-black text-white sm:text-lg">{portalData?.stats.totalMembers ?? '—'}</p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* Mobile / tablet bottom nav */}
          <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#132033] bg-[#050b14]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden">
            <div className="grid grid-cols-4">
              {[
                { id: 'Dashboard', label: 'Home', icon: Home, action: () => setActiveNav('Dashboard') },
                { id: 'Information & Support', label: 'Info', icon: Info, action: () => setActiveNav('Information & Support') },
                { id: 'departments', label: 'Depts', icon: Building2, action: () => setMobileNavOpen(true) },
                { id: 'menu', label: 'Menu', icon: Menu, action: () => setMobileNavOpen(true) },
              ].map(({ id, label, icon: Icon, action }) => {
                const active = id !== 'departments' && id !== 'menu' && activeNav === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={action}
                    className={`flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[10px] font-bold transition-colors ${
                      active ? 'text-[#4384ff]' : 'text-[#5a7090] hover:text-[#9eb4cc]'
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${active ? 'text-[#4384ff]' : ''}`} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </section>
      </div>
    </main>
  );
};

export default MemberPortalModern;
