// ─────────────────────────────────────────────────────────────────────────────
// components/overlays/PhonePanel.tsx  —  In-app phone / comms panel
//
// Slide-in panel for the Northpoint Roleplay in-app phone system.  Shows call history,
// lets officers make and receive calls, and displays active call state.
// Communicates with /api/phone/* endpoints on the API server.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import {
  Phone, MessageSquare, ShoppingBag, Users,
  PhoneOff, Delete, Lock, ChevronUp,
  Plus, Search, Trash2, X, Pin,
} from 'lucide-react';

import type { PhoneSSEEvent } from '@/hooks/usePhoneSSE';

// ── Types ─────────────────────────────────────────────────────────────────────
type Screen = 'lock' | 'home' | 'call' | 'contacts' | 'store' | 'messages';

const DIAL_KEYS: { digit: string; sub: string }[][] = [
  [{ digit: '1', sub: '' },    { digit: '2', sub: 'ABC' }, { digit: '3', sub: 'DEF'  }],
  [{ digit: '4', sub: 'GHI' },{ digit: '5', sub: 'JKL' }, { digit: '6', sub: 'MNO'  }],
  [{ digit: '7', sub: 'PQRS'},{ digit: '8', sub: 'TUV' }, { digit: '9', sub: 'WXYZ' }],
  [{ digit: '*', sub: '' },    { digit: '0', sub: '+' },   { digit: '#', sub: ''     }],
];

const APPS = [
  { id: 'contacts' as Screen, label: 'Contacts',  Icon: Users,         bg: 'bg-green-500'   },
  { id: 'store'    as Screen, label: 'Store',      Icon: ShoppingBag,   bg: 'bg-blue-500'    },
  { id: 'call'     as Screen, label: 'Call',       Icon: Phone,         bg: 'bg-emerald-500' },
  { id: 'messages' as Screen, label: 'Messages',   Icon: MessageSquare, bg: 'bg-yellow-500'  },
];

// ── Audio helpers ─────────────────────────────────────────────────────────────
function createCtx() {
  return new (window.AudioContext || (window as any).webkitAudioContext)();
}

function startRing(): () => void {
  const ctx   = createCtx();
  let stopped = false;

  const doRing = () => {
    if (stopped) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.setValueAtTime(0.18, ctx.currentTime + 0.9);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.0);
    g.connect(ctx.destination);

    [440, 480].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.0);
    });

    // Second ring pulse
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, ctx.currentTime + 1.2);
    g2.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 1.22);
    g2.gain.setValueAtTime(0.18, ctx.currentTime + 2.1);
    g2.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.2);
    g2.connect(ctx.destination);

    [440, 480].forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g2);
      osc.start(ctx.currentTime + 1.2);
      osc.stop(ctx.currentTime + 2.2);
    });

    setTimeout(() => doRing(), 4000);
  };

  doRing();
  return () => { stopped = true; ctx.close(); };
}

// US busy signal — 480 Hz + 620 Hz, 0.5 s on / 0.5 s off × 3 cycles
function playBusy() {
  try {
    const ctx = getDtmfCtx();
    const now = ctx.currentTime;
    const cycles = 3;
    for (let i = 0; i < cycles; i++) {
      const start = now + i * 1.0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.15, start + 0.005);
      g.gain.setValueAtTime(0.15, start + 0.495);
      g.gain.linearRampToValueAtTime(0, start + 0.5);
      g.connect(ctx.destination);
      [480, 620].forEach(freq => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(g);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    }
  } catch { /* audio not available */ }
}

// SIT (Special Information Tone) — standard "number not in service" triplet
function playSIT() {
  try {
    const ctx = getDtmfCtx();
    const now = ctx.currentTime;
    // Three rising tones played in sequence: 913.8 Hz, 1370.6 Hz, 1776.7 Hz
    const tones: [number, number, number][] = [
      [913.8,  0,     0.274],
      [1370.6, 0.32,  0.274],
      [1776.7, 0.64,  0.38 ],
    ];
    tones.forEach(([freq, offset, dur]) => {
      const start = now + offset;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.2, start + 0.005);
      g.gain.setValueAtTime(0.2, start + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, start + dur);
      g.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g);
      osc.start(start);
      osc.stop(start + dur);
    });
  } catch { /* audio not available */ }
}

function playHangup() {
  const ctx  = createCtx();
  const g    = ctx.createGain();
  g.gain.setValueAtTime(0.25, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  g.connect(ctx.destination);

  [480, 620].forEach(freq => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  });
}

// ── DTMF tones ────────────────────────────────────────────────────────────────
const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

// Shared context — reused across all keypresses to avoid browser limits
let _dtmfCtx: AudioContext | null = null;
function getDtmfCtx(): AudioContext {
  if (!_dtmfCtx || _dtmfCtx.state === 'closed') {
    _dtmfCtx = createCtx();
  }
  return _dtmfCtx;
}

function playDtmf(key: string) {
  const freqs = DTMF[key];
  if (!freqs) return;
  try {
    const ctx = getDtmfCtx();
    const now = ctx.currentTime;
    const dur = 0.12; // 120 ms — clean, snappy, real-phone feel

    const g = ctx.createGain();
    // Tiny linear attack (1 ms) to kill the click, then a smooth decay
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.001);
    g.gain.setValueAtTime(0.18, now + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    g.connect(ctx.destination);

    freqs.forEach(freq => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(g);
      osc.start(now);
      osc.stop(now + dur);
    });
  } catch { /* audio not available */ }
}

// ── Number formatting ─────────────────────────────────────────────────────────
function fmtPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

// ── Clock helpers ─────────────────────────────────────────────────────────────
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const fmtTime    = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtDate    = (d: Date) => d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const fmtElapsed = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// ── Lock screen ───────────────────────────────────────────────────────────────
function LockScreen({ onUnlock, now }: { onUnlock: () => void; now: Date }) {
  return (
    <div className="flex flex-col items-center justify-between h-full px-4 py-8">
      <div className="flex-1 flex flex-col items-center justify-center gap-1">
        <p className="text-6xl font-thin text-white tracking-tight">{fmtTime(now)}</p>
        <p className="text-sm text-white/60">{fmtDate(now)}</p>
      </div>
      <button
        type="button"
        onClick={onUnlock}
        className="flex flex-col items-center gap-1.5 text-white/60 hover:text-white transition-colors group"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 group-hover:bg-white/20 transition-colors">
          <ChevronUp className="h-5 w-5" />
        </span>
        <span className="text-[10px] uppercase tracking-[0.22em] font-bold">Unlock</span>
      </button>
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────
function HomeScreen({ onOpen, now, myPhone }: { onOpen: (s: Screen) => void; now: Date; myPhone?: string | null }) {
  return (
    <div className="flex flex-col h-full px-4 py-6">
      <div className="text-center mb-6">
        <p className="text-2xl font-light text-white">{fmtTime(now)}</p>
        <p className="text-[10px] text-white/40 mt-0.5">{fmtDate(now)}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 flex-1 content-start">
        {APPS.map(({ id, label, Icon, bg }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white/5 border border-white/10 py-5 hover:bg-white/10 active:scale-95 transition-all"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${bg} shadow-lg`}>
              <Icon className="h-6 w-6 text-white" />
            </span>
            <span className="text-xs font-semibold text-white/80">{label}</span>
          </button>
        ))}
      </div>
      {/* My number footer */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        <Phone className="h-4 w-4 text-white/35" />
        <span className="text-sm font-mono text-white/50 tracking-[0.12em]">
          {myPhone ?? 'No number'}
        </span>
      </div>
    </div>
  );
}

// ── Call app ──────────────────────────────────────────────────────────────────
type AnsweredCall = { phone: string; name: string; callId: string };

type CallState =
  | 'idle' | 'dialling' | 'active' | 'invalid' | 'noanswer'
  | '911-options' | '911-form' | '911-submitted';

type EmergencyService = 'Police' | 'FD' | 'EMS';

function CallApp({ onBack, username, callEvent, answeredCall, dialPreset, onDialPresetConsumed }: {
  onBack: () => void;
  username?: string;
  callEvent: PhoneSSEEvent | null;
  answeredCall?: AnsweredCall | null;
  dialPreset?: string | null;
  onDialPresetConsumed?: () => void;
}) {
  const [display,    setDisplay]    = useState(dialPreset ?? '');
  const [callerName, setCallerName] = useState('');
  const [callState,  setCallState]  = useState<CallState>('idle');
  const [elapsed,    setElapsed]    = useState(0);
  const [activeKey,  setActiveKey]  = useState<string | null>(null);
  const [callId,     setCallId]     = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);

  // 911 form state
  const [eService,  setEService]  = useState<EmergencyService>('Police');
  const [eLocation, setELocation] = useState('');
  const [eReason,   setEReason]   = useState('');
  const [eSubmitting, setESubmitting] = useState(false);
  const [eError,    setEError]    = useState('');

  const stopRingRef      = useRef<(() => void) | null>(null);
  const nineTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayRef       = useRef(display);
  const callStateRef     = useRef(callState);
  const callIdRef        = useRef(callId);
  // WebRTC
  const peerRef          = useRef<RTCPeerConnection | null>(null);
  const localStreamRef   = useRef<MediaStream | null>(null);
  const remoteAudioRef   = useRef<HTMLAudioElement | null>(null);
  useEffect(() => { displayRef.current   = display;   }, [display]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { callIdRef.current    = callId;    }, [callId]);

  // Pre-fill number when dialling from contacts
  useEffect(() => {
    if (!dialPreset) return;
    setDisplay(dialPreset);
    onDialPresetConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialPreset]);

  // Auto-enter active state when this is a received (answered) call
  useEffect(() => {
    if (!answeredCall) return;
    stopRingRef.current?.(); stopRingRef.current = null;
    setDisplay(answeredCall.phone);
    setCallerName(answeredCall.name);
    setCallId(answeredCall.callId);
    setCallState('active');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredCall?.callId]);

  // React to SSE events for our active call
  useEffect(() => {
    if (!callEvent) return;
    const ev = callEvent as any;
    // webrtc_signal may arrive for the callee before callIdRef is synced — match on event callId
    if (ev.type === 'webrtc_signal') {
      if (ev.callId === callIdRef.current || (answeredCall && ev.callId === answeredCall.callId)) {
        handleWebRTCSignal(ev.signal as { type: string; sdp?: string; candidate?: RTCIceCandidateInit });
      }
      return;
    }
    if (!callIdRef.current) return;
    if (ev.callId !== callIdRef.current) return;
    if (callEvent.type === 'call_answered') {
      stopRingRef.current?.(); stopRingRef.current = null;
      setCallState('active');
      initWebRTCCaller();
    } else if (callEvent.type === 'call_timeout') {
      stopRingRef.current?.(); stopRingRef.current = null;
      playBusy();
      closePeer();
      setCallId(null);
      setCallState('noanswer');
      setTimeout(() => setCallState('idle'), 3000);
    } else if (callEvent.type === 'call_ended') {
      stopRingRef.current?.(); stopRingRef.current = null;
      playHangup();
      closePeer();
      setCallId(null);
      setCallState('idle');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callEvent]);

  // Active call timer
  useEffect(() => {
    if (callState !== 'active') { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [callState]);

  // Clean up on unmount
  useEffect(() => () => {
    stopRingRef.current?.();
    if (nineTimerRef.current) clearTimeout(nineTimerRef.current);
    closePeer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebRTC helpers ──────────────────────────────────────────────────────────
  const closePeer = () => {
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    setMicBlocked(false);
  };

  const sendSignal = (signal: object) => {
    const cid = callIdRef.current;
    if (!cid || !username) return;
    fetch('/api/phone/signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId: cid, from: username, signal }),
    }).catch(() => {});
  };

  const buildPeer = (): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    pc.onicecandidate = e => {
      if (e.candidate) sendSignal({ type: 'ice-candidate', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = e => {
      const audio = remoteAudioRef.current ?? new Audio();
      remoteAudioRef.current = audio;
      audio.srcObject = e.streams[0] ?? null;
      audio.autoplay = true;
      audio.play().catch(() => {});
    };
    peerRef.current = pc;
    return pc;
  };

  const getLocalStream = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setMicBlocked(false);
      return stream;
    } catch {
      setMicBlocked(true);
      return null;
    }
  };

  // Re-grant mic access mid-call without hanging up
  const retryMic = async () => {
    const stream = await getLocalStream();
    if (!stream || !peerRef.current) return;

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    // Prefer replaceTrack — it swaps the track on an existing sender without
    // requiring a new offer/answer exchange.
    const existingSender = peerRef.current.getSenders()
      .find(s => s.track === null || s.track?.kind === 'audio');
    if (existingSender) {
      try { await existingSender.replaceTrack(audioTrack); } catch (e) {
        console.warn('retryMic replaceTrack failed', e);
      }
      return;
    }

    // No audio sender yet (mic was blocked from the very start of the call).
    // Add the track then renegotiate so the remote side learns about it.
    peerRef.current.addTrack(audioTrack, stream);
    try {
      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);
      sendSignal({ type: 'offer', sdp: peerRef.current.localDescription?.sdp });
    } catch (e) {
      console.warn('retryMic renegotiation failed', e);
    }
  };

  // Called by the caller after the callee answers
  const initWebRTCCaller = async () => {
    const pc     = buildPeer();
    const stream = await getLocalStream();
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', sdp: pc.localDescription?.sdp });
    } catch (e) { console.warn('WebRTC offer failed', e); }
  };

  // Called when a webrtc_signal arrives via SSE
  const handleWebRTCSignal = async (signal: { type: string; sdp?: string; candidate?: RTCIceCandidateInit }) => {
    if (signal.type === 'offer') {
      // Re-use the existing peer connection when one is already established (renegotiation).
      // Only build a fresh connection for the initial offer.
      const isRenegotiation = peerRef.current != null && peerRef.current.signalingState !== 'closed';
      const pc = isRenegotiation ? peerRef.current! : buildPeer();
      if (!isRenegotiation) {
        const stream = await getLocalStream();
        if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));
      }
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'answer', sdp: pc.localDescription?.sdp });
      } catch (e) { console.warn('WebRTC answer failed', e); }
    } else if (signal.type === 'answer') {
      try { await peerRef.current?.setRemoteDescription({ type: 'answer', sdp: signal.sdp }); }
      catch (e) { console.warn('WebRTC setRemoteDescription failed', e); }
    } else if (signal.type === 'ice-candidate' && signal.candidate) {
      try { await peerRef.current?.addIceCandidate(signal.candidate); }
      catch (e) { console.warn('ICE candidate failed', e); }
    }
  };

  const resetToIdle = () => {
    if (nineTimerRef.current) { clearTimeout(nineTimerRef.current); nineTimerRef.current = null; }
    stopRingRef.current?.(); stopRingRef.current = null;
    setCallState('idle');
    setEService('Police'); setELocation(''); setEReason(''); setEError('');
  };

  const blip = (k: string) => {
    setActiveKey(k);
    setTimeout(() => setActiveKey(null), 120);
  };

  const press = (k: string) => {
    if (callStateRef.current !== 'idle') return;
    blip(k);
    playDtmf(k);
    setDisplay(prev => fmtPhone(prev.replace(/-/g, '') + k));
  };

  const backDel = () => {
    if (callStateRef.current !== 'idle') return;
    setDisplay(prev => fmtPhone(prev.replace(/-/g, '').slice(0, -1)));
  };

  const hangup = () => {
    if (nineTimerRef.current) { clearTimeout(nineTimerRef.current); nineTimerRef.current = null; }
    stopRingRef.current?.(); stopRingRef.current = null;
    playHangup();
    closePeer();
    const cid = callIdRef.current;
    if (cid) {
      fetch('/api/phone/end', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callId: cid, username }),
      });
      setCallId(null);
    }
    setCallState('idle');
  };

  const call = async () => {
    const d = displayRef.current;
    if (!d || callStateRef.current !== 'idle') return;

    // ── 911 special flow ──────────────────────────────────────────────────────
    if (d === '911') {
      setCallState('dialling');
      stopRingRef.current = startRing();
      nineTimerRef.current = setTimeout(() => {
        stopRingRef.current?.(); stopRingRef.current = null;
        nineTimerRef.current = null;
        setCallState('911-options');
      }, 3000);
      return;
    }

    // ── Normal call flow ──────────────────────────────────────────────────────
    setCallState('dialling');
    stopRingRef.current = startRing();
    try {
      const res  = await fetch('/api/phone/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callerUsername: username, phone: d }),
      });
      const data = await res.json();
      if (data.found) {
        setCallId(data.callId);
      } else {
        stopRingRef.current?.(); stopRingRef.current = null;
        playSIT();
        setCallState('invalid');
        setTimeout(() => setCallState('idle'), 4000);
      }
    } catch {
      stopRingRef.current?.(); stopRingRef.current = null;
      playSIT();
      setCallState('invalid');
      setTimeout(() => setCallState('idle'), 4000);
    }
  };

  const submit911 = async () => {
    if (!eLocation.trim() || !eReason.trim()) {
      setEError('Please fill in all fields.');
      return;
    }
    setESubmitting(true);
    setEError('');
    try {
      const res = await fetch('/api/cad/calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: `911 — ${eService}`,
          priority: 1,
          location: eLocation.trim(),
          description: eReason.trim(),
          status: 'Pending',
          created_by: username ?? 'Civilian',
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setCallState('911-submitted');
      setTimeout(() => { resetToIdle(); setDisplay(''); }, 3500);
    } catch {
      setEError('Failed to submit. Please try again.');
    } finally {
      setESubmitting(false);
    }
  };

  // Single keyboard listener — uses refs so it never goes stale
  useEffect(() => {
    const VALID = new Set(['0','1','2','3','4','5','6','7','8','9','*','#']);
    const onKey = (e: KeyboardEvent) => {
      const cs = callStateRef.current;
      if (cs === 'dialling' || cs === 'active') {
        if (e.key === 'Enter') hangup();
        return;
      }
      if (cs !== 'idle') return;
      if (VALID.has(e.key)) {
        blip(e.key);
        playDtmf(e.key);
        setDisplay(prev => fmtPhone(prev.replace(/-/g, '') + e.key));
      } else if (e.key === 'Backspace') {
        setDisplay(prev => fmtPhone(prev.replace(/-/g, '').slice(0, -1)));
      } else if (e.key === 'Enter') {
        call();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 911 screens ─────────────────────────────────────────────────────────────
  if (callState === '911-options') {
    return (
      <div className="flex flex-col h-full">
        <button type="button" onClick={resetToIdle} className="text-[10px] uppercase tracking-[0.2em] text-[#4384ff] font-bold px-5 pt-4 pb-1 text-left">
          ‹ Back
        </button>
        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-4">
          {/* Header */}
          <div className="text-center mb-1">
            <span className="inline-block rounded-full bg-red-500/20 border border-red-500/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-red-400 mb-2">
              911 Emergency
            </span>
            <p className="text-sm font-bold text-white">How can we help?</p>
            <p className="text-[10px] text-white/40 mt-0.5">Select an option below</p>
          </div>

          {/* Option 1 — Manual call */}
          <button
            type="button"
            onClick={() => setCallState('911-form')}
            className="w-full rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-4 text-left hover:bg-red-500/20 active:scale-95 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white font-black text-sm shadow-lg shadow-red-500/30">
                1
              </span>
              <div>
                <p className="text-sm font-bold text-white">Log Emergency Call</p>
                <p className="text-[10px] text-white/40 mt-0.5">Submit details to dispatch</p>
              </div>
            </div>
          </button>

          {/* Option 2 — Operator (coming soon) */}
          <div className="w-full rounded-2xl border border-white/5 bg-white/3 px-4 py-4 opacity-40 cursor-not-allowed select-none">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/40 font-black text-sm">
                2
              </span>
              <div>
                <p className="text-sm font-bold text-white/40">Talk to an Operator</p>
                <p className="text-[10px] text-white/25 mt-0.5">Coming Soon</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (callState === '911-form') {
    const inputCls = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white placeholder:text-white/25 outline-none focus:border-red-400/60 transition-colors';
    const labelCls = 'text-[9px] font-black uppercase tracking-[0.18em] text-white/40 mb-1 block';
    return (
      <div className="flex flex-col h-full">
        <button type="button" onClick={() => setCallState('911-options')} className="text-[10px] uppercase tracking-[0.2em] text-[#4384ff] font-bold px-5 pt-4 pb-1 text-left">
          ‹ Back
        </button>
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
          <div className="text-center pt-1 pb-1">
            <span className="inline-block rounded-full bg-red-500/20 border border-red-500/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-red-400">
              911 Emergency Form
            </span>
          </div>

          {/* Service */}
          <div>
            <label className={labelCls}>Emergency Service</label>
            <select
              value={eService}
              onChange={e => setEService(e.target.value as EmergencyService)}
              className={inputCls + ' appearance-none'}
              style={{ backgroundColor: '#0d1a28', colorScheme: 'dark' }}
            >
              <option value="Police">Police</option>
              <option value="FD">Fire Department (FD)</option>
              <option value="EMS">EMS / Medical</option>
            </select>
          </div>

          {/* Location */}
          <div>
            <label className={labelCls}>Location</label>
            <input
              type="text"
              value={eLocation}
              onChange={e => setELocation(e.target.value)}
              placeholder="Street address or landmark…"
              className={inputCls}
            />
          </div>

          {/* Reason */}
          <div>
            <label className={labelCls}>Reason / Description</label>
            <textarea
              rows={3}
              value={eReason}
              onChange={e => setEReason(e.target.value)}
              placeholder="Describe the emergency…"
              className={inputCls + ' resize-none'}
            />
          </div>

          {eError && <p className="text-[10px] font-bold text-red-400">{eError}</p>}

          <button
            type="button"
            onClick={submit911}
            disabled={eSubmitting}
            className="w-full rounded-xl bg-red-500 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-red-500/30 hover:bg-red-400 active:scale-95 transition-all disabled:opacity-50"
          >
            {eSubmitting ? 'Submitting…' : 'Submit to Dispatch'}
          </button>

          <button
            type="button"
            onClick={resetToIdle}
            className="w-full rounded-xl border border-white/10 py-2 text-[10px] font-bold text-white/40 hover:text-white/70 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (callState === '911-submitted') {
    return (
      <div className="flex flex-col h-full items-center justify-center px-6 gap-3 text-center">
        <div className="h-14 w-14 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
          <Phone className="h-6 w-6 text-green-400" />
        </div>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-green-400">Dispatch Notified</p>
        <p className="text-[11px] text-white/50">Your emergency has been logged. Help is on the way.</p>
      </div>
    );
  }

  // ── Standard dial-pad screen ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <button type="button" onClick={onBack} className="text-[10px] uppercase tracking-[0.2em] text-[#4384ff] font-bold px-5 pt-4 pb-1 text-left">
        ‹ Home
      </button>

      {/* Display */}
      <div className="mx-4 mt-1 mb-3 rounded-2xl border border-[#152030] bg-[#060f1a] px-4 py-4 min-h-[72px] flex flex-col items-center justify-center">
        {callState === 'idle' && (
          <p className="text-center text-2xl font-bold tracking-[0.1em] text-white break-all">
            {display || <span className="text-[#2a3f55] text-base">Enter number</span>}
          </p>
        )}
        {callState === 'dialling' && (
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-[#4384ff] animate-pulse">
              {display === '911' ? 'Connecting to 911…' : 'Calling…'}
            </p>
            <p className="mt-1 text-lg font-bold text-white">{display}</p>
          </div>
        )}
        {callState === 'active' && (
          <div className="text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-green-400">Connected</p>
            {callerName && <p className="mt-1 text-lg font-bold text-white">{callerName}</p>}
            <p className={`font-bold text-white/60 ${callerName ? 'mt-0.5 text-sm' : 'mt-1 text-lg'}`}>{display}</p>
            <p className="mt-0.5 text-xs text-[#526179]">{fmtElapsed(elapsed)}</p>
            {micBlocked && (
              <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-red-500/15 border border-red-500/30 px-3 py-1.5">
                <span className="text-red-400 text-lg leading-none">🎙</span>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-400 leading-tight">
                  Microphone blocked
                </p>
                <button
                  type="button"
                  onClick={retryMic}
                  className="ml-1 rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] bg-red-500/30 hover:bg-red-500/50 text-red-300 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
        {callState === 'noanswer' && (
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-400">No Answer</p>
            <p className="mt-1 text-base font-bold text-white/50">{display}</p>
          </div>
        )}
        {callState === 'invalid' && (
          <div className="text-center">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-red-400">Number does not exist</p>
            <p className="mt-1 text-base font-bold text-white/50">{display}</p>
          </div>
        )}
      </div>

      {/* Dial pad */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-2 gap-0.5">
        {DIAL_KEYS.map(row => (
          <div key={row.map(c => c.digit).join('')} className="flex justify-between">
            {row.map(({ digit, sub }) => (
              <button
                key={digit}
                type="button"
                onClick={() => press(digit)}
                disabled={callState !== 'idle'}
                className={`h-12 w-12 rounded-full flex flex-col items-center justify-center transition-all active:scale-95 disabled:opacity-30 ${activeKey === digit ? 'bg-white/20 scale-95' : 'bg-[#1a2a3a] hover:bg-[#243548]'}`}
              >
                <span className="text-xl font-light text-white leading-none">{digit}</span>
                {sub && <span className="text-[8px] font-semibold tracking-[0.15em] text-white/40 mt-0.5 uppercase">{sub}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between px-8 pb-5 pt-1">
        <button
          type="button"
          onClick={backDel}
          disabled={callState !== 'idle' || !display}
          className="h-10 w-10 rounded-full text-[#526179] transition-colors hover:text-white disabled:opacity-30"
        >
          <Delete className="h-5 w-5 mx-auto" />
        </button>

        {(callState === 'idle' || callState === 'invalid') ? (
          <button
            type="button"
            onClick={call}
            disabled={!display || callState === 'invalid'}
            className="h-14 w-14 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg shadow-green-500/30 transition-all hover:bg-green-400 active:scale-95 disabled:opacity-30"
          >
            <Phone className="h-6 w-6" />
          </button>
        ) : (
          <button
            type="button"
            onClick={hangup}
            className="h-14 w-14 rounded-full bg-red-500 flex items-center justify-center text-white shadow-lg shadow-red-500/30 transition-all hover:bg-red-400 active:scale-95"
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        )}

        <div className="h-10 w-10" />
      </div>
    </div>
  );
}

// ── Contacts app ──────────────────────────────────────────────────────────────
type Contact = { id: string; name: string; phone: string; permanent?: boolean };

const DEFAULT_CONTACTS: Contact[] = [
  { id: '__911__', name: '911', phone: '911', permanent: true },
];

const STORAGE_KEY = 'phone_contacts_v1';

function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONTACTS;
    const parsed: Contact[] = JSON.parse(raw);
    // Always ensure 911 is first and present
    const without911 = parsed.filter(c => c.id !== '__911__');
    return [DEFAULT_CONTACTS[0], ...without911];
  } catch {
    return DEFAULT_CONTACTS;
  }
}

function saveContacts(contacts: Contact[]) {
  const without911 = contacts.filter(c => c.id !== '__911__');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(without911));
}

function ContactsApp({ onBack, onDial }: { onBack: () => void; onDial: (phone: string) => void }) {
  const [contacts, setContacts]   = useState<Contact[]>(loadContacts);
  const [query,    setQuery]       = useState('');
  const [adding,   setAdding]      = useState(false);
  const [newName,  setNewName]     = useState('');
  const [newPhone, setNewPhone]    = useState('');
  const [addErr,   setAddErr]      = useState('');

  const filtered = contacts.filter(c => {
    const q = query.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q);
  });

  const addContact = () => {
    setAddErr('');
    const name  = newName.trim();
    const phone = newPhone.replace(/\D/g, '').slice(0, 7);
    if (!name)  { setAddErr('Name is required.'); return; }
    if (!phone) { setAddErr('Phone number is required.'); return; }
    const next: Contact[] = [
      ...contacts,
      { id: crypto.randomUUID(), name, phone },
    ];
    setContacts(next);
    saveContacts(next);
    setNewName(''); setNewPhone(''); setAdding(false);
  };

  const deleteContact = (id: string) => {
    const next = contacts.filter(c => c.id !== id);
    setContacts(next);
    saveContacts(next);
  };

  const inputCls = 'w-full rounded-lg border border-white/10 bg-[#0d1a28] px-3 py-2 text-[11px] text-white placeholder:text-white/25 outline-none focus:border-[#4384ff]/60 transition-colors';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="text-[10px] uppercase tracking-[0.2em] text-[#4384ff] font-bold">
          ‹ Home
        </button>
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/60">Contacts</span>
        <button
          type="button"
          onClick={() => { setAdding(true); setAddErr(''); setNewName(''); setNewPhone(''); }}
          className="flex items-center gap-1 rounded-full bg-[#4384ff]/20 border border-[#4384ff]/30 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-[#4384ff] hover:bg-[#4384ff]/30 transition-colors"
        >
          <Plus className="h-2.5 w-2.5" /> Add
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-white/30 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search contacts…"
            className="w-full rounded-lg border border-white/10 bg-[#0d1a28] pl-7 pr-3 py-1.5 text-[11px] text-white placeholder:text-white/25 outline-none focus:border-[#4384ff]/50 transition-colors"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-1.5">
        {filtered.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/20 gap-2 mt-8">
            <Users className="h-8 w-8" />
            <p className="text-[10px] uppercase tracking-[0.18em]">No contacts found</p>
          </div>
        )}
        {filtered.map(c => (
          <div key={c.id} className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 group">
            {/* Avatar */}
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${c.permanent ? 'bg-red-500/20 border border-red-500/40 text-red-400' : 'bg-[#4384ff]/15 border border-[#4384ff]/25 text-[#4384ff]'}`}>
              {c.name.slice(0, 2).toUpperCase()}
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-white truncate">{c.name}</p>
              <p className="text-[9px] text-white/35 font-mono">{c.phone}</p>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onDial(c.phone)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 border border-green-500/25 text-green-400 hover:bg-green-500/30 transition-colors"
                title={`Call ${c.name}`}
              >
                <Phone className="h-3 w-3" />
              </button>
              {!c.permanent && (
                <button
                  type="button"
                  onClick={() => deleteContact(c.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20 text-red-400/60 hover:bg-red-500/25 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete contact"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              )}
              {c.permanent && <div className="h-6 w-6" />}
            </div>
          </div>
        ))}
      </div>

      {/* Add contact sheet */}
      {adding && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end" style={{ background: 'rgba(4,12,22,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="rounded-t-3xl border-t border-white/10 bg-[#070f1c] px-5 pt-5 pb-6 flex flex-col gap-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">New Contact</span>
              <button type="button" onClick={() => setAdding(false)} className="text-white/30 hover:text-white/60 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40 mb-1 block">Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Contact name…"
                className={inputCls}
                autoFocus
              />
            </div>

            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.18em] text-white/40 mb-1 block">Phone Number</label>
              <input
                type="text"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 7))}
                placeholder="7-digit number…"
                className={inputCls}
                onKeyDown={e => { if (e.key === 'Enter') addContact(); }}
              />
            </div>

            {addErr && <p className="text-[10px] font-bold text-red-400">{addErr}</p>}

            <button
              type="button"
              onClick={addContact}
              className="w-full rounded-xl bg-[#4384ff] py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white hover:bg-[#5a93ff] active:scale-95 transition-all"
            >
              Save Contact
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Placeholder apps ──────────────────────────────────────────────────────────
function PlaceholderApp({ label, Icon, onBack }: { label: string; Icon: React.ElementType; onBack: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <button type="button" onClick={onBack} className="text-[10px] uppercase tracking-[0.2em] text-[#4384ff] font-bold px-5 pt-4 pb-1 text-left">
        ‹ Home
      </button>
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#3f5470]">
        <Icon className="h-10 w-10" />
        <p className="text-sm font-bold uppercase tracking-[0.2em]">{label}</p>
        <p className="text-xs text-[#2a3a50]">Coming soon</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PhonePanel({ open, onClose, username, callEvent, answeredCall }: {
  open: boolean;
  onClose: () => void;
  username?: string;
  callEvent?: PhoneSSEEvent | null;
  answeredCall?: AnsweredCall | null;
}) {
  const [screen,     setScreen]    = useState<Screen>('lock');
  const [dialPreset, setDialPreset] = useState<string | null>(null);
  const [myPhone,    setMyPhone]   = useState<string | null>(null);
  const [pinned,     setPinned]    = useState(false);
  // pos = null → use default CSS position; non-null → dragged to explicit coords
  const [pos,        setPos]       = useState<{ x: number; y: number } | null>(null);
  const phoneRef  = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const now = useClock();

  // Fetch the user's own phone number from their first civilian character
  useEffect(() => {
    if (!username) { setMyPhone(null); return; }
    fetch(`/api/civilian/characters?username=${encodeURIComponent(username)}`)
      .then(r => r.ok ? r.json() : [])
      .then((chars: Array<{ phone?: string }>) => {
        const phone = chars.find(c => c.phone)?.phone ?? null;
        setMyPhone(phone);
      })
      .catch(() => setMyPhone(null));
  }, [username]);

  useEffect(() => { if (!open) { setScreen('lock'); setPos(null); setPinned(false); } }, [open]);

  // When answering an incoming call, jump straight to the call screen
  useEffect(() => {
    if (answeredCall) setScreen('call');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredCall?.callId]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const onDragStart = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = phoneRef.current!.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!dragState.current || !phoneRef.current) return;
    const { startX, startY, origX, origY } = dragState.current;
    const W = 260, H = 500;
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = Math.min(Math.max(origX + e.clientX - startX, 0), vw - W);
    const y = Math.min(Math.max(origY + e.clientY - startY, 0), vh - H);
    // Update DOM directly for smooth 60fps drag; React state synced on release
    phoneRef.current.style.left = `${x}px`;
    phoneRef.current.style.top  = `${y}px`;
  };

  const onDragEnd = (e: React.PointerEvent) => {
    if (!dragState.current || !phoneRef.current) return;
    dragState.current = null;
    const rect = phoneRef.current.getBoundingClientRect();
    setPos({ x: rect.left, y: rect.top });
  };

  const handleDial = (phone: string) => {
    setDialPreset(phone);
    setScreen('call');
  };

  if (!open) return null;

  const app = APPS.find(a => a.id === screen);

  // When a custom pos is set, switch to top/left positioning (drop the default translate/bottom classes)
  const phonePositionClass = pos
    ? 'fixed z-50 w-[260px] h-[500px] rounded-[2.5rem] overflow-hidden shadow-2xl shadow-black/70'
    : 'fixed bottom-6 left-1/2 z-50 -translate-x-1/2 w-[260px] h-[500px] rounded-[2.5rem] overflow-hidden shadow-2xl shadow-black/70';
  const phonePositionStyle: React.CSSProperties = pos
    ? { background: 'linear-gradient(160deg, #0a1628 0%, #040c16 100%)', left: pos.x, top: pos.y }
    : { background: 'linear-gradient(160deg, #0a1628 0%, #040c16 100%)' };

  return (
    <>
      {/* Backdrop — suppressed when pinned */}
      {!pinned && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      )}

      <div
        ref={phoneRef}
        className={phonePositionClass}
        style={phonePositionStyle}
      >
        {/* Notch */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 h-4 w-20 rounded-full bg-black z-10" />

        {/* Status bar — drag handle */}
        <div
          className="flex items-center justify-between px-4 pt-2 pb-0 relative z-10 cursor-grab active:cursor-grabbing select-none"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
        >
          <span className="text-[8px] font-bold text-white/30">NRP</span>
          <div className="flex items-center gap-1.5">
            {/* Pin toggle */}
            <button
              type="button"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => setPinned(p => !p)}
              className={`transition-colors ${pinned ? 'text-[#4384ff]' : 'text-white/25 hover:text-white/50'}`}
              title={pinned ? 'Unpin phone' : 'Pin phone (stay open)'}
            >
              <Pin className="h-2.5 w-2.5" style={pinned ? { fill: '#4384ff' } : {}} />
            </button>
            <Lock className="h-2.5 w-2.5 text-white/30" />
          </div>
        </div>

        {/* Screen */}
        <div className="absolute inset-0 pt-8">
          {screen === 'lock' && <LockScreen onUnlock={() => setScreen('home')} now={now} />}
          {screen === 'home' && <HomeScreen onOpen={setScreen} now={now} myPhone={myPhone} />}
          {screen === 'call' && (
            <CallApp
              onBack={() => setScreen('home')}
              username={username}
              callEvent={callEvent ?? null}
              answeredCall={answeredCall}
              dialPreset={dialPreset}
              onDialPresetConsumed={() => setDialPreset(null)}
            />
          )}
          {screen === 'contacts' && (
            <ContactsApp onBack={() => setScreen('home')} onDial={handleDial} />
          )}
          {(screen === 'store' || screen === 'messages') && app && (
            <PlaceholderApp label={app.label} Icon={app.Icon} onBack={() => setScreen('home')} />
          )}
        </div>

        {/* Home bar — click to close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 h-1 w-20 rounded-full bg-white/20 hover:bg-white/40 transition-colors"
          title="Close phone"
        />
      </div>
    </>
  );
}
