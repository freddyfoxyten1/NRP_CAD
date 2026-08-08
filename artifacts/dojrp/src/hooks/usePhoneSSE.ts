// ─────────────────────────────────────────────────────────────────────────────
// hooks/usePhoneSSE.ts  —  Real-time phone notifications
//
// Opens a Server-Sent Events (SSE) connection to /api/phone/events and fires
// the onEvent callback whenever the server pushes a phone call event (incoming
// call, hangup, etc.).  The connection is automatically reconnected on error.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';

export type PhoneSSEEvent =
  | { type: 'incoming_call';  callId: string; callerUsername: string; calleeName: string; phone: string }
  | { type: 'call_answered';  callId: string }
  | { type: 'call_ended';     callId: string }
  | { type: 'call_timeout';   callId: string }
  | { type: 'webrtc_signal';  callId: string; from: string; signal: unknown };

/**
 * Opens a persistent SSE connection to /api/phone/events for this user.
 * All events are dispatched to `onEvent`. The connection is closed on unmount.
 */
export function usePhoneSSE(
  username: string | null | undefined,
  onEvent: (e: PhoneSSEEvent) => void,
) {
  const cbRef = useRef(onEvent);
  useEffect(() => { cbRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!username) return;
    const es = new EventSource(`/api/phone/events?username=${encodeURIComponent(username)}`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as PhoneSSEEvent;
        cbRef.current(data);
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [username]);
}
