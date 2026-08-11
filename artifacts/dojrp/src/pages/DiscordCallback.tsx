// ─────────────────────────────────────────────────────────────────────────────
// pages/DiscordCallback.tsx  —  Discord OAuth redirect handler
//
// Discord sends the user back here after they authorise the application.
// Exchanges the code, completes login, then routes to the portal.
// New members must be in the DOJRP Discord server; accounts are created on first sign-in.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { setCadSession } from '@/lib/cad-session';
import type { CadSession } from '@/lib/cad-session';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';

type JoinPrompt = {
  guildName: string;
  inviteCode: string | null;
  inviteUrl: string | null;
};

type CallbackState =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'join'; prompt: JoinPrompt };

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
  </svg>
);

const DiscordCallback = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>({
    kind: 'loading',
    message: 'Signing you in…',
  });

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');

    if (error || !code) {
      navigate('/', { replace: true });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const exchRes = await fetch('/api/discord/oauth/exchange', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const discordUser = await exchRes.json() as {
          id?: string;
          username?: string;
          globalName?: string | null;
          avatarHash?: string | null;
          accessToken?: string;
          error?: string;
        };

        if (cancelled) return;

        if (!exchRes.ok || !discordUser.id) {
          setState({
            kind: 'error',
            message: discordUser.error ?? 'Authorisation failed.',
          });
          setTimeout(() => navigate('/', { replace: true }), 3000);
          return;
        }

        const loginRes = await fetch('/api/discord/oauth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.globalName,
            avatarHash: discordUser.avatarHash,
            accessToken: discordUser.accessToken,
          }),
        });

        const payload = await loginRes.json() as (CadSession & {
          error?: string;
          code?: string;
          mode?: string;
          guild_name?: string;
          invite_code?: string | null;
          invite_url?: string | null;
        });

        if (cancelled) return;

        if (!loginRes.ok || !payload.id) {
          if (payload.code === 'not_in_guild') {
            setState({
              kind: 'join',
              prompt: {
                guildName: payload.guild_name?.trim() || 'DOJRP',
                inviteCode: payload.invite_code ?? null,
                inviteUrl: payload.invite_url
                  ?? (payload.invite_code ? `https://discord.gg/${payload.invite_code}` : null),
              },
            });
            return;
          }

          const offlineMessage =
            payload.code === 'cad_offline'
              ? (payload.error
                ?? (payload.mode === 'members_locked'
                  ? 'CAD is locked for members. Only staff accounts may sign in.'
                  : 'CAD is in lockdown. Only superadmins and authorised staff may sign in.'))
              : (payload.error ?? 'Login failed.');
          setState({ kind: 'error', message: offlineMessage });
          setTimeout(() => navigate('/', { replace: true }), 3500);
          return;
        }

        setCadSession(payload, { renewExpiry: true });
        const redirect = sessionStorage.getItem('post_login_redirect');
        sessionStorage.removeItem('post_login_redirect');
        navigate(redirect ?? '/portal_dashboard', { replace: true });
      } catch {
        if (cancelled) return;
        setState({ kind: 'error', message: 'Something went wrong. Redirecting…' });
        setTimeout(() => navigate('/', { replace: true }), 3000);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === 'join') {
    const { guildName, inviteCode, inviteUrl } = state.prompt;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#03070c]/95 px-4 text-white">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(21,34,56,0.5)_0,rgba(3,7,12,0)_60%)]" />

        <div className="relative w-full max-w-[440px] rounded-2xl border border-[#192336] bg-[#0d1422] px-8 py-9 shadow-[0_32px_80px_rgba(0,0,0,0.72)]">
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="absolute right-4 top-4 rounded-full p-1.5 text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="text-center">
            <DojrpShield className="mx-auto mb-4 h-[64px] w-[64px]" />
            <p className="text-[24px] font-black leading-none tracking-[-0.03em]">
              <DojrpLogo />
            </p>
            <h2 className="mt-5 text-[22px] font-black leading-snug tracking-[-0.03em] text-white">
              You are not within our Discord server
            </h2>
            <p className="mt-3 text-[13px] leading-relaxed text-[#8392aa]">
              Sign-in requires membership in our community Discord.
              Would you like to join <span className="font-black text-white">{guildName}</span>?
            </p>
          </div>

          <div className="mt-6 rounded-xl border border-[#1b2738] bg-[#071120] px-4 py-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#526179]">
              Discord server
            </p>
            <p className="mt-1 text-sm font-black text-white">{guildName}</p>
            {inviteCode && (
              <>
                <p className="mt-4 text-[10px] font-black uppercase tracking-[0.18em] text-[#526179]">
                  Join code
                </p>
                <p className="mt-1 font-mono text-sm font-black tracking-wide text-[#5865f2]">
                  discord.gg/{inviteCode}
                </p>
              </>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-2.5">
            {inviteUrl ? (
              <a
                href={inviteUrl}
                target="_blank"
                rel="noreferrer"
                className="flex h-[48px] w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865f2] text-[13px] font-black uppercase tracking-[0.06em] text-white shadow-[0_10px_32px_rgba(88,101,242,0.35)] transition-all hover:-translate-y-0.5 hover:bg-[#6a76f4]"
              >
                <DiscordIcon className="h-5 w-5" />
                Yes, join {guildName}
              </a>
            ) : (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-center text-[12px] text-amber-200">
                Ask a staff member for the Discord invite link, then join and try signing in again.
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="flex h-[44px] w-full items-center justify-center rounded-xl border border-[#1e2d42] text-[12px] font-black uppercase tracking-[0.08em] text-[#8392aa] transition-colors hover:border-[#2f4060] hover:text-white"
            >
              No, return home
            </button>
          </div>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-[#4a5f78]">
            After joining, come back and sign in with Discord again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#02060b] px-6 text-center text-white">
      <div className={`h-7 w-7 animate-spin rounded-full border-2 border-white/20 ${state.kind === 'error' ? 'border-t-red-400' : 'border-t-[#5865f2]'}`} />
      <p className={`max-w-md text-sm font-semibold ${state.kind === 'error' ? 'text-red-300' : 'text-[#8a91c0]'}`}>
        {state.message}
      </p>
      {state.kind === 'error' && (
        <div className="mt-2">
          <DojrpShield className="mx-auto h-10 w-10 opacity-70" />
        </div>
      )}
    </div>
  );
};

export default DiscordCallback;
