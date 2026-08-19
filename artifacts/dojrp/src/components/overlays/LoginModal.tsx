// ----
// components/overlays/LoginModal.tsx   -   Authentication modal
//
// Shown when a user clicks "Sign in" on the landing page. Discord OAuth
// redirects to Discord and returns via DiscordCallback.
// ----
import { useState } from 'react';
import { X } from 'lucide-react';
import DojrpLogo from '@/components/shared/DojrpLogo';
import DojrpShield from '@/components/shared/DojrpShield';
import { useCadStatus, cadModeLabel } from '@/hooks/useCadStatus';
import LegalDocModal, { type LegalDoc } from '@/components/overlays/LegalDocModal';
import { discordOAuthRedirectUri } from '@/lib/api-origin';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
  </svg>
);

const LoginModal = ({ isOpen, onClose }: LoginModalProps) => {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const { online: cadOnline, mode: cadMode } = useCadStatus();

  if (!isOpen) return null;

  const handleDiscordSignIn = async () => {
    setError(null);
    setPending(true);
    try {
      const redirectUri = discordOAuthRedirectUri();
      const oauthUrl = `/api/discord/oauth/url?redirect_uri=${encodeURIComponent(redirectUri)}`;
      const res = await fetch(oauthUrl, {
        headers: { accept: 'application/json' },
      });

      let data: { url?: string; error?: string };
      try {
        data = await res.json() as { url?: string; error?: string };
      } catch {
        if (res.status >= 500) {
          throw new Error('The API server is not running. From the project root, run: bun run dev');
        }
        if (res.status === 404 || res.status === 502 || res.status === 503) {
          throw new Error(
            'The live API is not running yet. Deploy the nrp-cad-api service on Render and set DATABASE_URL plus Discord secrets.',
          );
        }
        throw new Error('The server returned an unexpected response.');
      }

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start sign-in. Please try again.');
        setPending(false);
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the server. Please try again.');
      setPending(false);
    }
  };

  const offlineWarning =
    cadMode === 'members_locked'
      ? 'Terminal is locked for members. Staff accounts can still sign in.'
      : cadMode === 'lockdown'
        ? 'Terminal is in lockdown. Only superadmins and authorised staff may sign in.'
        : null;

  return (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[#03070c]/95 px-4 py-6 text-white sm:items-center sm:py-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(21,34,56,0.5)_0,rgba(3,7,12,0)_60%)]" />

      <div className="relative my-auto w-full max-w-[420px] rounded-2xl border border-[#192336] bg-[#0d1422] px-6 py-8 shadow-[0_32px_80px_rgba(0,0,0,0.72)] sm:px-8 sm:py-9">

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-[#4a5568] transition-colors hover:bg-white/5 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Branding */}
        <div className="text-center">
          <DojrpShield className="mx-auto mb-4 h-[72px] w-[72px]" />
          <p className="text-[28px] font-black leading-none tracking-[-0.03em]">
            <DojrpLogo />
          </p>
          <h2 className="mt-5 text-[32px] font-black leading-none tracking-[-0.045em] text-white">
            Northpoint CAD
          </h2>
          <p className="mt-3 text-[11px] font-black uppercase tracking-[0.22em] text-[#5b8fd9]">
            Roleplay CAD &amp; Roster
          </p>

          {/* Terminal status */}
          <div className={`mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 ${cadOnline === false ? 'border-[#3a1920] bg-[#19070b]' : 'border-[#173053] bg-[#071120]'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cadOnline === false ? 'bg-[#ff5d5d] shadow-[0_0_6px_rgba(255,93,93,0.6)]' : 'bg-[#4384ff] shadow-[0_0_6px_rgba(67,132,255,0.6)]'}`} />
            <span className={`text-[9px] font-black uppercase tracking-[0.3em] ${cadOnline === false ? 'text-[#ff7070]' : 'text-[#4384ff]'}`}>
              {cadOnline === null ? 'Terminal Online' : `Terminal ${cadModeLabel(cadMode)}`}
            </span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 text-center text-[13px] font-semibold text-red-300">
            {error}
          </div>
        )}

        {/* Offline warning */}
        {offlineWarning && (
          <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-center text-[13px] text-amber-300">
            {offlineWarning}
          </div>
        )}

        {/* Discord login */}
        <button
          type="button"
          onClick={handleDiscordSignIn}
          disabled={pending}
          className="mt-8 flex h-[52px] w-full items-center justify-center gap-3 rounded-xl bg-[#2f66ee] text-[13px] font-black uppercase tracking-[0.06em] text-white shadow-[0_10px_32px_rgba(47,102,238,0.45)] transition-all hover:-translate-y-0.5 hover:bg-[#3a74ff] hover:shadow-[0_14px_36px_rgba(47,102,238,0.55)] disabled:cursor-not-allowed disabled:opacity-60 disabled:translate-y-0"
        >
          {pending ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Redirecting…
            </>
          ) : (
            <>
              <DiscordIcon className="h-5 w-5" />
              Login with Discord
            </>
          )}
        </button>

        {/* Footer note */}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-[#6a7f9a]">
          Sign in with Discord to access the CAD terminal.
          <br />
          You must be a member of the Northpoint Roleplay Discord server.
        </p>

        <p className="mt-5 text-center text-[11px] text-[#4a5f78]">
          <button
            type="button"
            onClick={() => setLegalDoc('terms')}
            className="transition-colors hover:text-[#8aa4c4] hover:underline"
          >
            Terms of Service
          </button>
          {' · '}
          <button
            type="button"
            onClick={() => setLegalDoc('privacy')}
            className="transition-colors hover:text-[#8aa4c4] hover:underline"
          >
            Privacy Policy
          </button>
        </p>
      </div>

      {legalDoc && (
        <LegalDocModal
          doc={legalDoc}
          onClose={() => setLegalDoc(null)}
          onSwitch={setLegalDoc}
        />
      )}
    </div>
  );
};

export default LoginModal;
