// ─────────────────────────────────────────────────────────────────────────────
// discord-realtime-sync.ts
//
// Connects to the Discord Gateway and schedules roster sync when guild member
// roles change (GUILD_MEMBER_UPDATE). Debounced to ~2–8s so bursts of role
// edits coalesce without waiting for the background poll interval.
// ─────────────────────────────────────────────────────────────────────────────

import { invalidateDiscordGuildRolesCache } from "./discord-guild-roles-cache";
import { logger } from "./logger";

type SyncJob = { key: string; run: () => Promise<void> };

const guildJobs = new Map<string, SyncJob[]>();

/** Debounce state per job key (guildId:jobKey). */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; firstAt: number }>();

const DEBOUNCE_MS = Math.max(
  500,
  Number(process.env.DISCORD_SYNC_DEBOUNCE_MS) || 2_000,
);
const MAX_WAIT_MS = Math.max(
  DEBOUNCE_MS,
  Number(process.env.DISCORD_SYNC_MAX_WAIT_MS) || 8_000,
);

const GATEWAY_INTENTS = (1 << 0) | (1 << 1); // GUILDS | GUILD_MEMBERS

let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastSequence: number | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let started = false;
let gatewayConnected = false;

export function registerDiscordGuildSync(
  guildId: string,
  key: string,
  run: () => Promise<void>,
): void {
  const id = guildId.trim();
  if (!id) return;
  const list = guildJobs.get(id) ?? [];
  if (list.some(j => j.key === key)) return;
  list.push({ key, run });
  guildJobs.set(id, list);
}

export function isDiscordGatewayConnected(): boolean {
  return gatewayConnected;
}

function scheduleJob(jobKey: string, run: () => Promise<void>): void {
  const now = Date.now();
  const existing = pending.get(jobKey);

  const fire = () => {
    pending.delete(jobKey);
    void run().catch(err => {
      logger.warn({ err, jobKey }, "discord realtime sync job failed");
    });
  };

  if (!existing) {
    const timer = setTimeout(fire, DEBOUNCE_MS);
    pending.set(jobKey, { timer, firstAt: now });
    return;
  }

  clearTimeout(existing.timer);
  const elapsed = now - existing.firstAt;
  const delay = elapsed >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS;
  const timer = setTimeout(fire, delay);
  pending.set(jobKey, { timer, firstAt: existing.firstAt });
}

function onGuildMemberRolesChanged(guildId: string): void {
  const jobs = guildJobs.get(guildId);
  if (!jobs?.length) return;
  for (const job of jobs) {
    scheduleJob(`${guildId}:${job.key}`, job.run);
  }
}

function clearHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendJson(payload: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function handleDispatch(event: string, data: Record<string, unknown>, seq: number | null): void {
  if (typeof seq === "number") lastSequence = seq;

  if (event === "GUILD_MEMBER_UPDATE") {
    const guildId = String(data.guild_id ?? "");
    if (guildId) onGuildMemberRolesChanged(guildId);
    return;
  }

  if (
    event === "GUILD_ROLE_CREATE"
    || event === "GUILD_ROLE_UPDATE"
    || event === "GUILD_ROLE_DELETE"
  ) {
    const guildId = String(data.guild_id ?? "");
    if (!guildId) return;
    invalidateDiscordGuildRolesCache(guildId);
    onGuildMemberRolesChanged(guildId);
  }
}

function handleMessage(raw: string): void {
  let msg: { op: number; t?: string; s?: number; d?: Record<string, unknown> & { heartbeat_interval?: number } };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }

  switch (msg.op) {
    case 10: { // HELLO
      const interval = msg.d?.heartbeat_interval ?? 41250;
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        sendJson({ op: 1, d: lastSequence });
      }, interval);
      sendJson({
        op: 2,
        d: {
          token: `Bot ${process.env.DISCORD_BOT_TOKEN ?? ""}`,
          intents: GATEWAY_INTENTS,
          properties: { os: "linux", browser: "dojcad", device: "dojcad" },
        },
      });
      break;
    }
    case 11: // HEARTBEAT ACK
      break;
    case 0: // DISPATCH
      if (msg.t) handleDispatch(msg.t, msg.d ?? {}, msg.s ?? null);
      if (msg.t === "READY") {
        gatewayConnected = true;
        reconnectAttempt = 0;
        logger.info(
          { guilds: guildJobs.size, debounceMs: DEBOUNCE_MS, maxWaitMs: MAX_WAIT_MS },
          "Discord Gateway connected — realtime role sync active",
        );
      }
      break;
    case 7: // RECONNECT
      ws?.close();
      break;
    case 9: // INVALID SESSION — reconnect with a fresh identify
      lastSequence = null;
      ws?.close();
      break;
    default:
      break;
  }
}

async function connectGateway(): Promise<void> {
  const tok = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!tok) return;

  const res = await fetch("https://discord.com/api/v10/gateway/bot", {
    headers: { Authorization: `Bot ${tok}` },
  });
  if (!res.ok) {
    throw new Error(`Gateway bot info failed: HTTP ${res.status}`);
  }
  const body = await res.json() as { url: string };
  const url = `${body.url}?v=10&encoding=json`;

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    ws = socket;

    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", (ev) => reject(ev));
  });

  ws!.addEventListener("message", (ev) => {
    handleMessage(String(ev.data ?? ""));
  });

  ws!.addEventListener("close", () => {
    gatewayConnected = false;
    clearHeartbeat();
    ws = null;
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (!started) return;
  if (reconnectTimer) return;
  reconnectAttempt += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5));
  logger.warn({ delayMs: delay }, "Discord Gateway disconnected — reconnecting");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectGateway().catch(err => {
      logger.error({ err }, "Discord Gateway reconnect failed");
      scheduleReconnect();
    });
  }, delay);
}

export function startDiscordGateway(): void {
  if (started) return;
  started = true;

  const enabled = (process.env.DISCORD_GATEWAY_ENABLED ?? "1") !== "0";
  const tok = (process.env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!enabled || !tok) {
    logger.info("Discord Gateway disabled (no token or DISCORD_GATEWAY_ENABLED=0)");
    return;
  }
  if (guildJobs.size === 0) {
    logger.warn("Discord Gateway skipped — no guild sync jobs registered");
    return;
  }

  void connectGateway().catch(err => {
    logger.error({ err }, "Discord Gateway initial connect failed");
    scheduleReconnect();
  });
}

export function stopDiscordGateway(): void {
  started = false;
  gatewayConnected = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearHeartbeat();
  for (const { timer } of pending.values()) clearTimeout(timer);
  pending.clear();
  ws?.close();
  ws = null;
}
