import { useEffect, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react';
import {
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import type { CadSession } from '@/lib/cad-session';
import { cadModeLabel } from '@/hooks/useCadStatus';

const SHIELD_URL = `${(import.meta.env.BASE_URL as string) ?? '/'}dojrp-shield.png`;

export type AdminNavTab = {
  id: string;
  label: string;
  icon: React.ElementType;
};

type AdminModernShellProps = {
  tabs: AdminNavTab[];
  activeTab: string;
  setActiveTab: (id: string) => void;
  tabTitle: string;
  tabSubtitle: string;
  username: string;
  rankLabel: string;
  isLoading: boolean;
  pageLoading: boolean;
  loadingLabel?: string;
  cadOnline: boolean | null;
  cadMode: string;
  session: CadSession | null;
  profileOpen: boolean;
  setProfileOpen: Dispatch<SetStateAction<boolean>>;
  profileRef: RefObject<HTMLDivElement | null>;
  handleSignOut: () => void;
  isSigningOut: boolean;
  navigate: (path: string) => void;
  children: ReactNode;
};

function CadStatusPill({ cadOnline, cadMode, compact = false }: { cadOnline: boolean | null; cadMode: string; compact?: boolean }) {
  const offline = cadOnline === false;
  const label = cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`;
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border ${compact ? 'px-2 py-1' : 'px-3.5 py-1.5'} ${offline ? 'border-[#4a2028] bg-[#1a0a0e]' : 'border-[#1e3a5f] bg-[#081422]/90'}`} title={label}>
      <span className={`h-2 w-2 rounded-full ${offline ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
      <span className={`font-black uppercase ${compact ? 'hidden min-[420px]:inline text-[9px] tracking-[0.18em]' : 'text-[10px] tracking-[0.28em]'} ${offline ? 'text-[#ff8a8a]' : 'text-[#7eb8ff]'}`}>{label}</span>
    </div>
  );
}

function ProfileAvatar({ session, username }: { session: CadSession | null; username: string }) {
  if (session?.discord_id && session?.avatar_hash) {
    return <img src={`https://cdn.discordapp.com/avatars/${session.discord_id}/${session.avatar_hash}.png?size=128`} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
  }
  return <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1a3050] to-[#0d1422] text-sm font-black text-[#67b0ff]">{(username || '?')[0]?.toUpperCase()}</span>;
}

type AdminSidebarContentProps = {
  username: string;
  rankLabel: string;
  isLoading: boolean;
  session: CadSession | null;
  tabs: AdminNavTab[];
  activeTab: string;
  setActiveTab: (id: string) => void;
  navigate: (path: string) => void;
  handleSignOut: () => void;
  isSigningOut: boolean;
  onNavigate?: () => void;
  showClose?: boolean;
  onClose?: () => void;
};

function AdminSidebarContent({
  username,
  rankLabel,
  isLoading,
  session,
  tabs,
  activeTab,
  setActiveTab,
  navigate,
  handleSignOut,
  isSigningOut,
  onNavigate,
  showClose,
  onClose,
}: AdminSidebarContentProps) {
  const finish = () => onNavigate?.();

  return (
    <>
      <div className="shrink-0 px-5 pb-4 pt-5 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={SHIELD_URL} alt="" className="h-10 w-10 shrink-0 object-contain" />
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#4a6080]">DOJ:RP CAD</p>
              <h1 className="text-base font-black tracking-tight text-white">Admin Portal</h1>
            </div>
          </div>
          {showClose && (
            <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1a2d45] text-[#8392aa] hover:bg-white/5 hover:text-white lg:hidden" aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-[#1a2d45] bg-gradient-to-br from-[#0c1628] to-[#070d16] p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[#243650]">
              <ProfileAvatar session={session} username={username} />
            </div>
            <div className="min-w-0">
              {isLoading ? (
                <p className="text-xs font-bold text-[#526179]">Loading…</p>
              ) : (
                <>
                  <p className="truncate text-sm font-black text-white">{username}</p>
                  <p className="truncate text-[11px] font-bold text-[#f4c542]">{rankLabel || 'Admin'}</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sidebar-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-2 lg:px-3">
        <p className="mb-1 mt-1 px-3 text-[9px] font-black uppercase tracking-[0.24em] text-[#3f5470]">Admin sections</p>
        <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button key={id} type="button" onClick={() => { setActiveTab(id); finish(); }} className={`flex shrink-0 items-center gap-3 rounded-md border-l-2 px-4 py-3 text-left text-sm font-semibold leading-snug transition-colors lg:w-full ${active ? 'border-[#f4c542] bg-[#071120] text-white' : 'border-transparent text-[#8392aa] hover:bg-[#070d16] hover:text-white'}`}>
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#f4c542]' : ''}`} />
                <span className="whitespace-nowrap capitalize lg:whitespace-normal">{label}</span>
                {active && <ChevronRight className="ml-auto hidden h-4 w-4 shrink-0 text-[#f4c542] lg:block" />}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="shrink-0 border-t border-[#132033]">
        <div className="px-4 py-4">
          <p className="mb-2 px-2 text-[9px] font-black uppercase tracking-[0.24em] text-[#3f5470]">Portal tools</p>
          <div className="space-y-0.5">
            <button type="button" onClick={() => { navigate('/staff_roster'); finish(); }} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-bold text-[#7a90aa] hover:bg-white/5 hover:text-[#f4c542]">
              <Users className="h-3.5 w-3.5 shrink-0" />
              Staff Roster
            </button>
            <button type="button" onClick={() => { window.open('https://portal.dojrblx.com/', '_blank'); finish(); }} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs font-bold text-[#7a90aa] hover:bg-white/5 hover:text-[#f4c542]">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              Staff Portal
            </button>
          </div>
        </div>

        <div className="border-t border-[#132033] px-4 py-3 space-y-0.5">
          <button type="button" onClick={() => { navigate('/portal_dashboard'); finish(); }} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-[#5a7090] hover:bg-white/5 hover:text-white">
            <LayoutDashboard className="h-4 w-4" />
            Member Portal
          </button>
          <button type="button" onClick={() => { handleSignOut(); finish(); }} disabled={isSigningOut} className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold text-[#ff7b7b] hover:bg-[#ff5d5d]/10 disabled:opacity-60">
            <LogOut className="h-4 w-4" />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </>
  );
}

export function AdminModernShell({
  tabs,
  activeTab,
  setActiveTab,
  tabTitle,
  tabSubtitle,
  username,
  rankLabel,
  isLoading,
  pageLoading,
  loadingLabel = 'Loading…',
  cadOnline,
  cadMode,
  session,
  profileOpen,
  setProfileOpen,
  profileRef,
  handleSignOut,
  isSigningOut,
  navigate,
  children,
}: AdminModernShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileNavOpen]);

  const sidebarProps: AdminSidebarContentProps = {
    username,
    rankLabel,
    isLoading,
    session,
    tabs,
    activeTab,
    setActiveTab,
    navigate,
    handleSignOut,
    isSigningOut,
    onNavigate: () => setMobileNavOpen(false),
  };

  const primaryTabs = tabs.slice(0, 3);
  const bottomNav = [
    ...primaryTabs.map(t => ({ id: t.id, label: t.label.split(' ')[0], icon: t.icon })),
    { id: 'menu', label: 'Menu', icon: Menu },
  ].slice(0, 4);

  return (
    <main className="min-h-screen bg-[#030810] text-white">
      <div className="relative z-50 border-b border-[#f4c542]/25 bg-gradient-to-r from-[#0a1a32] via-[#102040] to-[#0a1a32] px-4 py-2 text-center">
        <p className="text-[11px] font-bold tracking-wide text-[#fde68a]">
          <Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-[#f4c542]" />
          Preview Admin Portal layout — tell us if you want this as the new admin page
        </p>
      </div>

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-0 h-96 w-96 rounded-full bg-[#f4c542]/8 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#4384ff]/5 blur-3xl" />
      </div>

      <div className="relative flex min-h-[calc(100vh-36px)] flex-col lg:flex-row">
        <aside className="hidden lg:flex lg:w-[300px] lg:flex-col lg:overflow-hidden lg:border-r lg:border-[#132033] lg:bg-[#050b14]/95 lg:backdrop-blur-xl lg:fixed lg:inset-y-0 lg:top-[36px] lg:z-30">
          <AdminSidebarContent {...sidebarProps} />
        </aside>

        {mobileNavOpen && (
          <>
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} />
            <aside className="fixed inset-y-0 left-0 z-[60] flex w-[min(300px,88vw)] flex-col overflow-hidden border-r border-[#132033] bg-[#050b14] shadow-2xl lg:hidden">
              <AdminSidebarContent {...sidebarProps} showClose onClose={() => setMobileNavOpen(false)} />
            </aside>
          </>
        )}

        <section className="flex min-h-full flex-1 flex-col lg:ml-[300px]">
          <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[#132033]/80 bg-[#030810]/90 px-4 py-3 backdrop-blur-xl sm:px-5 lg:px-8 lg:py-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 lg:hidden">
              <button type="button" onClick={() => setMobileNavOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#1a2d45] text-[#8392aa] hover:bg-white/5 hover:text-white" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">{tabTitle}</p>
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[#f4c542]">{rankLabel || 'Admin'}</p>
              </div>
            </div>
            <div className="hidden lg:block">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#4a6080]">Administration</p>
              <p className="text-sm font-bold text-white">{tabTitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="lg:hidden"><CadStatusPill cadOnline={cadOnline} cadMode={cadMode} compact /></div>
              <div className="hidden lg:block"><CadStatusPill cadOnline={cadOnline} cadMode={cadMode} /></div>
              <div className="relative" ref={profileRef}>
                <button type="button" onClick={() => setProfileOpen(o => !o)} className="h-9 w-9 overflow-hidden rounded-xl border-2 border-[#243650] transition hover:border-[#f4c542] sm:h-10 sm:w-10">
                  <ProfileAvatar session={session} username={username} />
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-[#1a2d45] bg-[#0a121c] shadow-2xl sm:top-12">
                    <div className="border-b border-[#132033] px-4 py-3">
                      <p className="text-sm font-black text-white">{username}</p>
                      <p className="text-[11px] text-[#f4c542]">{rankLabel || 'Admin'}</p>
                    </div>
                    <button type="button" onClick={() => { setProfileOpen(false); handleSignOut(); }} disabled={isSigningOut} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-bold text-[#ff7b7b] hover:bg-white/5">
                      <LogOut className="h-4 w-4" />
                      {isSigningOut ? 'Signing out…' : 'Log off'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1 px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:px-10 lg:py-10 lg:pb-10">
            <div className="mb-6 overflow-hidden rounded-2xl border border-[#3d3418] bg-gradient-to-br from-[#0d1a30] via-[#0a1424] to-[#060c14] p-5 sm:p-6 lg:mb-8">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#f4c542] sm:text-[11px]">Admin Portal</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-4xl">{tabTitle}</h2>
              <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[#8fa3bc] sm:text-sm">{tabSubtitle}</p>
            </div>

            <div className="relative min-h-[280px]">
              {pageLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-[#030810]/85 backdrop-blur-[1px]">
                  <PageLoadingScreen loading label={loadingLabel} accent="#f4c542" minHeightClass="min-h-0" />
                </div>
              )}
              <div className={pageLoading ? 'pointer-events-none opacity-0' : 'opacity-100 transition-opacity duration-150'}>
                {children}
              </div>
            </div>
          </div>

          <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#132033] bg-[#050b14]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden">
            <div className="grid grid-cols-4">
              {bottomNav.map(({ id, label, icon: Icon }) => {
                const active = id !== 'menu' && activeTab === id;
                return (
                  <button key={id} type="button" onClick={() => { if (id === 'menu') setMobileNavOpen(true); else setActiveTab(id); }} className={`flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[10px] font-bold transition-colors ${active ? 'text-[#f4c542]' : 'text-[#5a7090] hover:text-[#9eb4cc]'}`}>
                    <Icon className={`h-5 w-5 ${active ? 'text-[#f4c542]' : ''}`} />
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
}
