import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Truck } from 'lucide-react';
import { toast } from 'sonner';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { PageLoadingScreen } from '@/components/shared/LoadingProgress';
import { clearCadSession, getCadSession, setCadSession, type CadSession } from '@/lib/cad-session';
import { applySuperAdminSessionOverrides, isSuperAdminSession } from '@/lib/superadmin';

const DepartmentOfTransportation = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<CadSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const current = getCadSession();
      if (!current) {
        navigate('/', { replace: true });
        return;
      }
      try {
        const res = await fetch('/api/cad-auth/session-status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: current.id, email: current.email }),
        });
        const data = await res.json() as { active?: boolean; account?: CadSession };
        if (!data.active || !data.account) {
          clearCadSession();
          navigate('/', { replace: true });
          return;
        }
        const next = applySuperAdminSessionOverrides({ ...current, ...data.account });
        setCadSession(next);
        if (!cancelled) setSession(next);
        if (!isSuperAdminSession(next)) {
          toast.error('Department of Transportation is not available yet.');
          navigate('/portal_dashboard', { replace: true });
        }
      } catch {
        if (!cancelled) {
          toast.error('Unable to verify session.');
          navigate('/portal_dashboard', { replace: true });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void boot();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    clearCadSession();
    toast.success('Signed out.');
    navigate('/', { replace: true });
  };

  if (isLoading || !session) {
    return (
      <main className="min-h-screen bg-[#02060b] text-white">
        <PageLoadingScreen loading label="Loading Transportation…" accent="#fb923c" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#02060b] text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-[#131f30] bg-[#02060b] px-5 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[265px] lg:flex-col lg:border-b-0 lg:border-r lg:border-[#131f30]">
          <div className="flex items-center gap-3">
            <DojrpShield className="h-10 w-10" />
            <div>
              <p className="text-lg font-black tracking-[-0.04em]">
                <DojrpLogo />
              </p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#526179]">
                Transportation
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm font-black text-[#fb923c]">{session.username}</p>
          <p className="mt-1 text-[10px] font-black uppercase tracking-[0.22em] text-[#526179]">
            {(session.staff_rank || session.rank || 'Member').trim()}
          </p>

          <nav className="mt-8 flex flex-col gap-1">
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-md border-l-2 border-[#fb923c] bg-[#1a1008] px-4 py-3 text-left text-sm font-semibold text-[#fb923c]"
            >
              <Truck className="h-4 w-4 shrink-0" />
              Overview
            </button>
          </nav>

          <div className="mt-6 flex flex-col gap-2 border-t border-[#131f30] pt-6">
            <button
              type="button"
              onClick={() => navigate('/portal_dashboard')}
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:text-[#4384ff]"
            >
              <LayoutDashboard className="h-4 w-4" />
              Member Portal
            </button>
          </div>

          <div className="mt-auto hidden border-t border-[#131f30] px-1 pt-4 lg:block">
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" />
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </aside>

        <section className="flex-1 lg:ml-[265px]">
          <header className="flex items-center justify-between border-b border-[#131f30] px-5 py-4 sm:px-8">
            <div>
              <h1 className="text-xl font-black tracking-[-0.04em] text-white">Department of Transportation</h1>
              <p className="mt-1 text-xs text-[#8392aa]">DOT division portal</p>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="rounded-full px-3 py-2 text-sm font-bold text-[#526179] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60 lg:hidden"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </header>

          <div className="px-5 py-8 sm:px-8">
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl border border-[#131f30] bg-[#070d16] text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#fb923c]/20 bg-[#fb923c]/8">
                <Truck className="h-8 w-8 text-[#fb923c]/70" />
              </div>
              <div>
                <p className="text-sm font-black text-white">Transportation workspace</p>
                <p className="mt-1 max-w-md text-xs text-[#526179]">
                  Superadmin preview access. Full DOT tools and workflows can be added here.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default DepartmentOfTransportation;
