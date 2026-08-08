import { Router } from "express";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { randomUUID } from "crypto";

const router = Router();

// ── SSE client registry ───────────────────────────────────────────────────────
const clients = new Map<string, Response>();

function push(username: string, payload: object) {
  const res = clients.get(username);
  if (res) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Pending call registry (ringing, not yet answered) ────────────────────────
interface PendingCall {
  callId: string;
  callerUsername: string;
  calleeUsername: string;
  timer: ReturnType<typeof setTimeout>;
}
const pendingCalls = new Map<string, PendingCall>();

// ── Active call registry (answered, for WebRTC signal routing) ───────────────
interface ActiveCall {
  callerUsername: string;
  calleeUsername: string;
}
const activeCalls = new Map<string, ActiveCall>();

// GET /api/phone/events?username=xxx  — SSE stream
router.get("/phone/events", (req: Request, res: Response) => {
  const { username } = req.query as { username?: string };
  if (!username) { res.status(400).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  clients.set(username, res);
  // heartbeat keeps the connection alive through proxies
  const hb = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clients.delete(username);
    clearInterval(hb);
  });
});

// POST /api/phone/call  — initiate outgoing call
router.post("/phone/call", async (req: Request, res: Response) => {
  const { callerUsername, phone } = req.body as Record<string, string>;
  if (!callerUsername || !phone) {
    res.status(400).json({ error: "callerUsername and phone required" });
    return;
  }

  const result = await pool.query(
    `SELECT owner_username, first_name, last_name FROM cad_civilians WHERE phone=$1 LIMIT 1`,
    [phone]
  );

  if (result.rows.length === 0) {
    res.json({ found: false });
    return;
  }

  const { owner_username: calleeUsername, first_name, last_name } = result.rows[0];
  const calleeName = `${first_name} ${last_name}`;
  const callId = randomUUID();

  // Push incoming-call event to callee
  push(calleeUsername, { type: "incoming_call", callId, callerUsername, calleeName, phone });

  // 30-second auto-timeout
  const timer = setTimeout(() => {
    if (!pendingCalls.has(callId)) return;
    pendingCalls.delete(callId);
    push(callerUsername,  { type: "call_timeout", callId });
    push(calleeUsername,  { type: "call_timeout", callId });
  }, 30000);

  pendingCalls.set(callId, { callId, callerUsername, calleeUsername, timer });

  res.json({ found: true, callId, calleeUsername, calleeName });
});

// POST /api/phone/answer  — callee answers; moves call to activeCalls for WebRTC routing
router.post("/phone/answer", (req: Request, res: Response) => {
  const { callId } = req.body as Record<string, string>;
  const call = pendingCalls.get(callId);
  if (!call) { res.status(404).json({ error: "call not found" }); return; }

  clearTimeout(call.timer);
  pendingCalls.delete(callId);

  // Keep participants so WebRTC signals can be routed
  activeCalls.set(callId, {
    callerUsername: call.callerUsername,
    calleeUsername: call.calleeUsername,
  });

  push(call.callerUsername, { type: "call_answered", callId });
  res.json({ ok: true });
});

// POST /api/phone/signal  — relay WebRTC signaling between call participants
router.post("/phone/signal", (req: Request, res: Response) => {
  const { callId, from, signal } = req.body as { callId: string; from: string; signal: unknown };
  if (!callId || !from || signal === undefined) {
    res.status(400).json({ error: "callId, from, signal required" });
    return;
  }

  const active = activeCalls.get(callId);
  if (!active) { res.status(404).json({ error: "active call not found" }); return; }

  const to =
    from === active.callerUsername ? active.calleeUsername : active.callerUsername;

  push(to, { type: "webrtc_signal", callId, from, signal });
  res.json({ ok: true });
});

// POST /api/phone/end  — either party ends the call
router.post("/phone/end", (req: Request, res: Response) => {
  const { callId, username } = req.body as Record<string, string>;

  // Check pending (still ringing)
  const pending = pendingCalls.get(callId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCalls.delete(callId);
    const other =
      username === pending.callerUsername
        ? pending.calleeUsername
        : pending.callerUsername;
    push(other, { type: "call_ended", callId });
    res.json({ ok: true });
    return;
  }

  // Check active (answered / in WebRTC)
  const active = activeCalls.get(callId);
  if (active) {
    activeCalls.delete(callId);
    const other =
      username === active.callerUsername
        ? active.calleeUsername
        : active.callerUsername;
    push(other, { type: "call_ended", callId });
    res.json({ ok: true });
    return;
  }

  res.status(404).json({ error: "call not found" });
});

export { router as phoneRouter };
