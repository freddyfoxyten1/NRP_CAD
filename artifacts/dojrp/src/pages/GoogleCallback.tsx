import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DojrpLogo from '@/components/shared/DojrpLogo';
import { readApiJson } from '@/lib/fetch-api-json';

const GoogleCallback = () => {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('Connecting Google account…');

  useEffect(() => {
    const error = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    const notify = (payload: Record<string, unknown>) => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'dojcad-google-oauth', ...payload }, window.location.origin);
        window.close();
        return true;
      }
      return false;
    };

    if (error === 'access_denied') {
      const text = 'Google sign-in was cancelled.';
      if (!notify({ error: text })) setMessage(text);
      return;
    }
    if (error || !code) {
      const text = 'Google authentication failed.';
      if (!notify({ error: text })) setMessage(text);
      return;
    }

    void (async () => {
      try {
        const res = await fetch('/api/google/oauth/exchange', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code,
            state,
            redirect_uri: `${window.location.origin}/dojcad/google-callback`,
          }),
        });
        const body = await readApiJson<{ id?: number; email?: string; error?: string }>(res);
        if (!res.ok || !body.id) {
          throw new Error(body.error ?? 'Google authentication failed.');
        }
        if (!notify({ integration: { id: body.id, email: body.email } })) {
          setMessage(`Connected as ${body.email}. You can close this tab and return to CAD.`);
        }
      } catch (err) {
        const text = err instanceof Error ? err.message : 'Google authentication failed.';
        if (!notify({ error: text })) setMessage(text);
      }
    })();
  }, [params]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#02060b] px-6 text-white">
      <div className="mb-6 text-3xl font-black tracking-widest"><DojrpLogo /></div>
      <p className="text-sm font-bold text-[#a8b7cd]">{message}</p>
    </div>
  );
};

export default GoogleCallback;
