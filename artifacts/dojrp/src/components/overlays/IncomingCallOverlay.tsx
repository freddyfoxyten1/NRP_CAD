// ─────────────────────────────────────────────────────────────────────────────
// components/overlays/IncomingCallOverlay.tsx  —  Incoming call alert
//
// Full-screen overlay shown when a phone call arrives via the SSE connection
// (usePhoneSSE).  Plays an alert sound, displays caller info, and provides
// Accept / Reject buttons.  Auto-dismisses if ignored after a timeout.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import { Phone, PhoneOff } from 'lucide-react';

export interface IncomingCall {
  callId: string;
  callerUsername: string;
  calleeName: string;
  phone: string;
}

interface Props {
  call: IncomingCall;
  onAnswer: (callId: string) => void;
  onDecline: (callId: string) => void;
}

// ── Ring tone ─────────────────────────────────────────────────────────────────
function useRingTone(active: boolean) {
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) { stopRef.current?.(); stopRef.current = null; return; }

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let stopped = false;

    const doRing = () => {
      if (stopped) return;
      [[0, 1.0], [1.2, 2.2]].forEach(([start, end]) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, ctx.currentTime + start);
        g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
        g.gain.setValueAtTime(0.18, ctx.currentTime + end - 0.1);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + end);
        g.connect(ctx.destination);
        [440, 480].forEach(freq => {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          osc.connect(g);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + end);
        });
      });
      setTimeout(doRing, 4000);
    };

    doRing();
    stopRef.current = () => { stopped = true; ctx.close(); };
    return () => { stopped = true; ctx.close(); };
  }, [active]);
}

export default function IncomingCallOverlay({ call, onAnswer, onDecline }: Props) {
  useRingTone(true);

  return (
    <div className="fixed bottom-6 right-6 z-[60] pointer-events-auto animate-in slide-in-from-bottom-4 fade-in duration-200">
      <div
        className="flex items-center gap-3 rounded-2xl px-4 py-3 shadow-2xl shadow-black/60 border border-white/10"
        style={{ background: 'linear-gradient(135deg,#0d1f38 0%,#060f1a 100%)' }}
      >
        {/* Pulsing phone icon */}
        <div className="h-9 w-9 rounded-full bg-[#1a2f45] flex items-center justify-center shrink-0 animate-pulse">
          <Phone className="h-4 w-4 text-[#4384ff]" />
        </div>

        {/* Info */}
        <div className="min-w-0 mr-1">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-[#4384ff] leading-none mb-0.5">
            Incoming Call
          </p>
          <p className="text-sm font-bold text-white leading-tight truncate">{call.phone}</p>
          {call.calleeName && (
            <p className="text-[10px] text-[#526179] leading-tight truncate">{call.calleeName}</p>
          )}
        </div>

        {/* Decline */}
        <button
          type="button"
          onClick={() => onDecline(call.callId)}
          className="h-9 w-9 rounded-full bg-red-500 flex items-center justify-center text-white shrink-0 hover:bg-red-400 active:scale-95 transition-all shadow-lg shadow-red-500/30"
          title="Decline"
        >
          <PhoneOff className="h-4 w-4" />
        </button>

        {/* Answer */}
        <button
          type="button"
          onClick={() => onAnswer(call.callId)}
          className="h-9 w-9 rounded-full bg-green-500 flex items-center justify-center text-white shrink-0 hover:bg-green-400 active:scale-95 transition-all shadow-lg shadow-green-500/30"
          title="Answer"
        >
          <Phone className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
