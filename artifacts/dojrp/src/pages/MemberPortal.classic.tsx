import { Clock3, Gamepad2, Info, LogOut, Megaphone, Shield, Users, Wifi } from 'lucide-react';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { getCadSession } from '@/lib/cad-session';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import { renderContentBlocks } from '@/components/shared/ContentBlocks';
import { MEMBER_PORTAL_NAV_ITEMS, useMemberPortal } from './member-portal-shared';

const statusCards = [
  {
    label: 'Total Members',
    accent: 'text-[#ff5d66]',
    icon: Users,
    valueKey: 'totalMembers' as const,
  },
  {
    label: 'Total Play Time',
    accent: 'text-[#f4c542]',
    icon: Clock3,
    valueKey: 'totalPlayTime' as const,
  },
  {
    label: 'Total Online Members',
    accent: 'text-[#4384ff]',
    icon: Wifi,
    valueKey: 'totalOnlineMembers' as const,
  },
  {
    label: 'In-Game',
    accent: 'text-[#3ecf78]',
    icon: Gamepad2,
    valueKey: 'inGameCount' as const,
  },
];

const MemberPortalClassic = () => {
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
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-[#182232] bg-[#03070c] px-5 py-3 lg:hidden">
        <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white"><DojrpShield className="h-5 w-5" /><DojrpLogo /></p>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
          <span className={`text-[9px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
            {cadOnline === false ? 'Terminal Offline' : 'Terminal Online'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="rounded-full px-3 py-2 text-sm font-bold text-[#dce7f8] transition-colors hover:bg-white/5 hover:text-[#4384ff] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSigningOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>

      <div className="flex min-h-screen flex-col pt-[53px] lg:flex-row lg:pt-0">
        <aside className="border-b border-[#182232] bg-[#03070c] px-5 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[265px] lg:flex-col lg:border-b-0 lg:border-r">
          <div className="lg:shrink-0">
            <h1 className="text-xl font-black tracking-[-0.04em] text-white">Member Portal</h1>
            <p className="mt-2 text-sm font-black leading-none text-[#3f85ff]">{username}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#7b8ca7]">
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
                      if (item === 'Department of Public Safety') navigate('/dps?tab=information');
                      if (item === 'Department of Public Health') navigate('/dph?tab=information');
                    }}
                    className={`flex w-[240px] shrink-0 flex-col items-start justify-center gap-0.5 rounded-md border-l-2 px-4 py-3 text-left text-sm font-semibold leading-snug transition-colors lg:w-full ${
                      isComingSoon
                        ? 'cursor-not-allowed border-transparent text-[#3f5470]'
                        : isActive
                          ? 'border-[#4384ff] bg-[#081329] text-white'
                          : 'border-transparent text-[#a8b7cd] hover:bg-[#08111f] hover:text-white'
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
                      onClick={() => navigate('/dps/internal-affairs')}
                      className="flex w-[240px] shrink-0 items-center rounded-md border-l-2 border-transparent px-4 py-3 pl-8 text-left text-sm font-semibold leading-snug text-[#a8b7cd] transition-colors hover:bg-[#08111f] hover:text-white lg:w-full"
                    >
                      <span className="w-full whitespace-normal break-words">DPS Internal Affairs</span>
                    </button>
                  )}
                  {item === 'Department of Public Health' && canAccessDphInternalAffairs && (
                    <button
                      type="button"
                      onClick={() => navigate('/dph/internal-affairs')}
                      className="flex w-[240px] shrink-0 items-center rounded-md border-l-2 border-transparent px-4 py-3 pl-8 text-left text-sm font-semibold leading-snug text-[#a8b7cd] transition-colors hover:bg-[#08111f] hover:text-white lg:w-full"
                    >
                      <span className="w-full whitespace-normal break-words">DPH Internal Affairs</span>
                    </button>
                  )}
                </div>
                );
              })}
            </nav>

            {(canAccessStaff || canAccessAdminPortal) && (
              <div className="mt-6 flex flex-col gap-1 border-t border-[#182232] pt-6 lg:mt-5">
                {canAccessStaff && (
                  <button
                    type="button"
                    onClick={() => window.open('https://portal.dojrblx.com/', '_blank')}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase text-[#ff5d5d] transition-colors hover:text-[#ff8585]"
                  >
                    <Shield className="h-4 w-4" />
                    Staff Portal
                  </button>
                )}
                {canAccessStaff && (
                  <button
                    type="button"
                    onClick={() => navigate('/staff')}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase text-[#ff5d5d] transition-colors hover:text-[#ff8585]"
                  >
                    <Users className="h-4 w-4" />
                    Staff Roster
                  </button>
                )}
                {canAccessAdminPortal && (
                  <button
                    type="button"
                    onClick={handleAdminPortal}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase text-[#ff5d5d] transition-colors hover:text-[#ff8585]"
                  >
                    <Shield className="h-4 w-4" />
                    Admin Portal
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sign out — pinned to bottom of sidebar */}
          <div className="hidden lg:block border-t border-[#182232] px-3 py-4">
            <button type="button" onClick={handleSignOut} disabled={isSigningOut}
              className="flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm font-bold text-[#dce7f8] transition-colors hover:bg-white/5 hover:text-[#4384ff] disabled:opacity-60">
              <LogOut className="h-4 w-4" />
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>

        </aside>


        <section className="flex min-h-screen flex-1 flex-col lg:ml-[265px]">
          <header className="relative z-40 hidden items-center border-b border-[#182232] px-9 py-4 lg:grid lg:grid-cols-3">
            {/* Left — logo */}
            <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white">
              <DojrpShield className="h-5 w-5" /><DojrpLogo />
            </p>
            {/* Center — terminal status */}
            <div className="flex justify-center">
              <div className={`flex items-center gap-2 rounded-full border px-4 py-2 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
                <span className={`h-2 w-2 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d]' : 'bg-[#4384ff]'}`} />
                <span className={`text-[10px] font-black uppercase tracking-[0.34em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
                  {cadOnline === false ? 'Terminal Offline' : 'Terminal Online'}
                </span>
              </div>
            </div>
            {/* Right — profile avatar */}
            <div className="relative flex justify-end" ref={profileRef}>
              <button type="button" onClick={() => setProfileOpen(o => !o)}
                className="h-9 w-9 overflow-hidden rounded-full border-2 border-[#1b2738] transition-all hover:border-[#4384ff]">
                {(() => { const s = getCadSession(); return s?.discord_id && s?.avatar_hash
                  ? <img src={`https://cdn.discordapp.com/avatars/${s.discord_id}/${s.avatar_hash}.png?size=64`} alt="Profile" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  : <div className="flex h-full w-full items-center justify-center bg-[#0f1b28] text-xs font-black text-[#4384ff]">{(portalData?.profile.username ?? '?')[0].toUpperCase()}</div>;
                })()}
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-11 z-[80] w-56 rounded-xl border border-[#1b2738] bg-[#0b1422] py-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                  <div className="border-b border-[#131f30] px-4 py-3">
                    <p className="text-xs font-black text-white">{portalData?.profile.username}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-[#526179]">{portalData?.profile.rank ?? 'Member'}</p>
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
            {isLoading ? (
              <PageLoadingScreen loading label="Loading member portal…" accent="#4384ff" />
            ) : error ? (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-6 text-sm font-bold text-red-100">
                {error}
              </div>
            ) : activeNav === 'Information & Support' ? (
              <section className="rounded-xl border border-[#172235] bg-[#0d1422] p-7 shadow-[0_22px_55px_rgba(0,0,0,0.22)]">
                <div className="mb-6 flex items-center gap-3">
                  <Info className="h-5 w-5 text-[#4384ff]" />
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff]">
                    Information & Support
                  </h2>
                </div>
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
              </section>
            ) : (
              <>
                <section className="mb-8">
                  <h2 className="text-3xl font-black leading-none tracking-[-0.05em] text-white sm:text-4xl">
                    Welcome back, {username}
                  </h2>
                  <p className="mt-2 text-sm text-[#8392aa] sm:text-base">
                    You are currently logged in as{' '}
                    <span className="font-bold text-[#4384ff]">{rank}</span>
                    {role !== 'Member' && (
                      <span className="text-[#8392aa]"> · {role}</span>
                    )}
                  </p>
                </section>

                <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
                  {statusCards.map(({ label, accent, icon: Icon, valueKey }) => (
                    <div
                      key={label}
                      className="rounded-xl border border-[#172235] bg-[#0d1422] p-6 shadow-[0_18px_38px_rgba(0,0,0,0.2)]"
                    >
                      <div className="flex items-start justify-between gap-5">
                        <div>
                          <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${accent}`}>
                            {label}
                          </p>
                          <p className="mt-4 text-2xl font-black tracking-[-0.04em] text-white">
                            {portalData?.stats[valueKey]}
                          </p>
                        </div>
                        <Icon className="h-7 w-7 text-[#647086] opacity-80" />
                      </div>
                    </div>
                  ))}
                </section>

                <section className="mt-8 min-h-[430px] rounded-xl border border-[#172235] bg-[#0d1422] p-7 shadow-[0_22px_55px_rgba(0,0,0,0.22)]">
                  <div className="flex items-center gap-3">
                    <Megaphone className="h-5 w-5 text-[#bc74ff]" />
                    <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[#c06dff]">
                      Community Announcements
                    </h3>
                  </div>

                  {announcements.length === 0 ? (
                    <div className="flex min-h-[320px] items-center justify-center text-center">
                      <p className="text-sm italic text-[#526179]">No recent announcements to display.</p>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      {announcements.map((a) => (
                        <div key={a.id} className="rounded-lg border border-[#1a2638] bg-[#070d16] p-5">
                          <div className="flex items-start justify-between gap-4">
                            <p className="text-base font-black text-white">{a.title}</p>
                            <span className="shrink-0 text-[10px] font-semibold text-[#526179]">
                              {new Date(a.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#8392aa]">{a.message}</p>
                          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#526179]">— {a.posted_by}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

        </section>
      </div>
    </main>
  );
};

export default MemberPortalClassic;
