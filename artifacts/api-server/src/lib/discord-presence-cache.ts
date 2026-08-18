/** Discord user presence — updated from Gateway PRESENCE_UPDATE events. */
export type DiscordPresenceStatus = "online" | "idle" | "dnd" | "offline";

const cache = new Map<string, DiscordPresenceStatus>();

export function normalizeDiscordPresence(status: unknown): DiscordPresenceStatus {
  switch (String(status ?? "").toLowerCase()) {
    case "online":
      return "online";
    case "idle":
      return "idle";
    case "dnd":
      return "dnd";
    default:
      return "offline";
  }
}

export function setDiscordPresence(userId: string, status: unknown): void {
  const id = userId.trim();
  if (!id) return;
  cache.set(id, normalizeDiscordPresence(status));
}

export function getDiscordPresence(userId: string): DiscordPresenceStatus {
  return cache.get(userId.trim()) ?? "offline";
}

export function getDiscordPresenceBatch(ids: string[]): Record<string, DiscordPresenceStatus> {
  const out: Record<string, DiscordPresenceStatus> = {};
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    out[id] = getDiscordPresence(id);
  }
  return out;
}

export function discordPresenceCacheSize(): number {
  return cache.size;
}
