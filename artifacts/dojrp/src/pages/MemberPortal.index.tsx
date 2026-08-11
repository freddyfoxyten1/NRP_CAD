import { Calendar, Clock3, Gamepad2, Info, LogOut, Megaphone, Shield, User, Users, Wifi, BadgeCheck } from 'lucide-react';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { getCadSession } from '@/lib/cad-session';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import { renderContentBlocks } from '@/components/shared/ContentBlocks';
import { cadModeLabel } from '@/hooks/useCadStatus';
import { MEMBER_PORTAL_NAV_ITEMS, useMemberPortal } from './member-portal-shared';

function SectionHeading({ icon: Icon, title, count }: {
  icon: React.ComponentType<{ className?: string }>; title: string; count?: number;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <Icon className="h-4 w-4 text-[#4384ff]" />
      <h2 className="text-sm font-black uppercase tracking-[0.22em] text-white">{title}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-[#0f1b28] px-2 py-0.5 text-[9px] font-black text-[#526179]">{count}</span>
      )}
      <div className="ml-3 h-px flex-1 bg-[#131f30]" />
    </div>
  );
}

const MemberPortalIndex = () => {
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
    handleAdminPortal,
    cadOnline,
    cadMode,
    username,
    rank,
    role,
    canAccessStaff,
    canAccessIab,
    canAccessDphInternalAffairs,
    canAccessAdminPortal,
  } = useMemberPortal();

  return (
    <main className="min-h-screen bg-[#02060b] text-white">
      {/* Mobile-only fixed top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[#131f30] bg-[#02060b]/90 px-5 py-3 backdrop-blur-md lg:hidden">
        <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white">
          <DojrpShield className="h-5 w-5" /><DojrpLogo />
        </p>
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
            <h1 className="text-xl font-black tracking-[-0.04em] text-white">Member Portal</h1>
            <p className="mt-2 text-sm font-black leading-none text-[#4384ff]">{username}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#526179]">
              {rank}
            </p>
          </div>

          <div className="sidebar-scroll mt-8 lg:flex-1 lg:overflow-x-hidden lg:overflow-y-auto">
            <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {MEMBER_PORTAL_NAV_ITEMS.map((item) => {
                const isComingSoon =
                  item === 'Department of Communications'
                  || item === 'Department of Transportation';
                const isActive = activeNav === item;
                return (
                <div key={item} className="contents lg:block lg:w-full">
                  <button
                    type="button"
                    disabled={isComingSoon}
                    onClick={() => {
                      if (isComingSoon) return;
                      if (item === 'Dashboard' || item === 'Information & Support') {
                        setActiveNav(item);
                        return;
                      }
                      if (item === 'Department of Public Safety') navigate('/dps_information');
                      if (item === 'Department of Public Health') navigate('/dph_information');
                    }}
                    className={`flex w-[240px] shrink-0 flex-col items-start justify-center gap-0.5 rounded-md border-l-2 px-4 py-3 text-left text-sm font-semibold leading-snug transition-colors lg:w-full ${
                      isComingSoon
                        ? 'cursor-not-allowed border-transparent text-[#3f5470]'
                        : isActive
                          ? 'border-[#4384ff] bg-[#071120] text-white'
                          : 'border-transparent text-[#8392aa] hover:bg-[#070d16] hover:text-white'
                    }`}
                  >
                    <span className="w-full whitespace-normal break-words">{item}</span>
                    {isComingSoon && (
                      <span className="text-[10px] font-normal tracking-wide text-[#526179]">
                        Coming Soon
                      </span>
                    )}
                  </button>
                  {item === 'Department of Public Safety' && canAccessIab && (
                    <button
                      type="button"
                      onClick={() => navigate('/dps_internal-affairs')}
                      className="flex w-[240px] shrink-0 items-center rounded-md border-l-2 border-transparent px-4 py-3 pl-8 text-left text-sm font-semibold leading-snug text-[#8392aa] transition-colors hover:bg-[#070d16] hover:text-white lg:w-full"
                    >
                      <span className="w-full whitespace-normal break-words">DPS Internal Affairs</span>
                    </button>
                  )}
                  {item === 'Department of Public Health' && canAccessDphInternalAffairs && (
                    <button
                      type="button"
                      onClick={() => navigate('/dph_internal-affairs')}
                      className="flex w-[240px] shrink-0 items-center rounded-md border-l-2 border-transparent px-4 py-3 pl-8 text-left text-sm font-semibold leading-snug text-[#8392aa] transition-colors hover:bg-[#070d16] hover:text-white lg:w-full"
                    >
                      <span className="w-full whitespace-normal break-words">DPH Internal Affairs</span>
                    </button>
                  )}
                </div>
                );
              })}
            </nav>

            {(canAccessStaff || canAccessAdminPortal) && (
              <div className="mt-6 flex flex-col gap-1 border-t border-[#131f30] pt-6 lg:mt-5">
                {canAccessStaff && (
                  <button
                    type="button"
                    onClick={() => window.open('https://portal.dojrblx.com/', '_blank')}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]"
                  >
                    <Shield className="h-4 w-4" />
                    Staff Portal
                  </button>
                )}
                {canAccessStaff && (
                  <button
                    type="button"
                    onClick={() => navigate('/staff_roster')}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]"
                  >
                    <Users className="h-4 w-4" />
                    Staff Roster
                  </button>
                )}
                {canAccessAdminPortal && (
                  <button
                    type="button"
                    onClick={handleAdminPortal}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]"
                  >
                    <Shield className="h-4 w-4" />
                    Admin Portal
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="hidden lg:block border-t border-[#131f30] px-3 py-4">
            <button type="button" onClick={handleSignOut} disabled={isSigningOut}
              className="flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60">
              <LogOut className="h-4 w-4" />
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </aside>

        <section className="flex min-h-screen flex-1 flex-col lg:ml-[265px]">
          <header className="relative z-40 hidden items-center border-b border-[#131f30] bg-[#02060b]/90 px-9 py-4 backdrop-blur-md lg:grid lg:grid-cols-3">
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white">
              <DojrpShield className="h-5 w-5" /><DojrpLogo />
            </p>
            <div className="flex justify-center">
              <div className={`flex items-center gap-2 rounded-full border px-4 py-2 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
                <span className={`h-2 w-2 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
                <span className={`text-[10px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
                  {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
                </span>
              </div>
            </div>
            <div className="relative z-50 flex justify-end" ref={profileRef}>
              <button type="button" onClick={() => setProfileOpen(o => !o)}
                className="h-9 w-9 overflow-hidden rounded-full border-2 border-[#1b2738] transition-all hover:border-[#4384ff]">
                {(() => { const s = getCadSession(); return s?.discord_id && s?.avatar_hash
                  ? <img src={`https://cdn.discordapp.com/avatars/${s.discord_id}/${s.avatar_hash}.png?size=64`} alt="Profile" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  : <div className="flex h-full w-full items-center justify-center bg-[#0f1b28] text-xs font-black text-[#4384ff]">{(portalData?.profile.username ?? '?')[0].toUpperCase()}</div>;
                })()}
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-11 z-[80] w-56 rounded-xl border border-[#131f30] bg-[#070d16] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-[#0f1b28] px-4 py-3">
                    <p className="text-xs font-black text-white">{portalData?.profile.username}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{rank}</p>
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

          <div className="relative flex-1 px-5 py-8 sm:px-8 lg:px-9">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(20,45,90,0.18)_0,rgba(2,6,11,0)_70%)]" />

            {isLoading ? (
              <PageLoadingScreen loading label="Loading member portal…" accent="#4384ff" />
            ) : error ? (
              <div className="relative rounded-xl border border-red-500/25 bg-red-500/10 p-6 text-sm font-bold text-red-100">
                {error}
              </div>
            ) : activeNav === 'Information & Support' ? (
              <section className="relative">
                <SectionHeading icon={Info} title="Information & Support" />
                <div className="rounded-xl border border-[#131f30] bg-[#070d16] px-6 py-7 sm:px-8 sm:py-8">
                  {infoLoading ? (
                    <div className="flex min-h-[240px] items-center justify-center">
                      <p className="text-sm font-bold text-[#3f5470]">Loading…</p>
                    </div>
                  ) : (
                    renderContentBlocks(infoSections, {
                      emptyTitle: 'No information posted yet',
                      emptyHint: 'Admins can publish Information & Support content from the Admin Portal.',
                      accent: '#4384ff',
                    })
                  )}
                </div>
              </section>
            ) : (
              <div className="relative space-y-10">
                <section>
                  <h2 className="text-[32px] font-black leading-none tracking-[-0.05em] text-white sm:text-[42px]">
                    Welcome back, {username}
                  </h2>
                  <p className="mt-3 max-w-xl text-sm font-semibold text-[#526179]">
                    You are currently logged in as{' '}
                    <span className="font-black text-[#4384ff]">{rank}</span>
                    {role !== 'Member' && (
                      <span className="text-[#8392aa]"> · {role}</span>
                    )}
                  </p>
                </section>

                <section>
                  <SectionHeading icon={Wifi} title="Portal Status" />
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      {
                        label: 'Your Rank',
                        icon: User,
                        value: rank,
                        color: 'border-[#1b2a40] text-[#4384ff]',
                      },
                      {
                        label: 'Account Status',
                        icon: BadgeCheck,
                        value: (() => {
                          const status = portalData?.profile.status?.trim();
                          if (!status) return '—';
                          return status.charAt(0).toUpperCase() + status.slice(1);
                        })(),
                        color: 'border-[#1b3320] text-[#3ecf8e]',
                      },
                      {
                        label: 'Total Play Time',
                        icon: Clock3,
                        value: portalData?.stats.totalPlayTime ?? 'Coming Soon!',
                        color: 'border-[#2a2418] text-[#f4c542]',
                      },
                      {
                        label: 'In-Game',
                        icon: Gamepad2,
                        value: portalData?.stats.inGameCount ?? '—',
                        color: 'border-[#1a2a38] text-[#4fc3f7]',
                      },
                    ].map(({ label, icon: Icon, value, color }) => (
                      <div
                        key={label}
                        className={`flex items-center gap-4 rounded-xl border bg-[#070d16] px-5 py-4 ${color}`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-current/10">
                          <Icon className="h-5 w-5" style={{ color: 'inherit' }} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-[#526179]">
                            {label}
                          </p>
                          <p className="mt-0.5 truncate text-xl font-black tabular-nums tracking-[-0.03em] text-white">
                            {value}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <SectionHeading icon={Megaphone} title="Community Announcements" count={announcements.length} />
                  {announcements.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-[#0f1b28] py-16 text-center">
                      <Megaphone className="h-7 w-7 text-[#1e2e42]" />
                      <p className="text-sm font-bold text-[#2a3a50]">No recent announcements to display.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {announcements.map((a) => (
                        <div key={a.id} className="rounded-xl border border-[#131f30] bg-[#070d16] px-4 py-4 sm:px-6 sm:py-5">
                          <div className="flex items-start justify-between gap-4">
                            <h3 className="text-sm font-black text-white">{a.title}</h3>
                            <span className="shrink-0 text-[10px] text-[#3f5470]">
                              {new Date(a.created_at).toLocaleString(undefined, {
                                month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#8392aa]">{a.message}</p>
                          <div className="mt-3 flex items-center gap-1.5">
                            <User className="h-3 w-3 text-[#3f5470]" />
                            <span className="text-[10px] font-bold text-[#3f5470]">{a.posted_by}</span>
                            <span className="text-[10px] text-[#2a3a50]"> · </span>
                            <Calendar className="h-3 w-3 text-[#2a3a50]" />
                            <span className="text-[10px] text-[#2a3a50]">
                              {new Date(a.created_at).toLocaleDateString('en-US', {
                                year: 'numeric', month: 'short', day: 'numeric',
                              })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
};

export default MemberPortalIndex;
