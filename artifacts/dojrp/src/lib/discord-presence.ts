export type DiscordPresenceStatus = "online" | "idle" | "dnd" | "offline";

export function discordStatusLabel(status: DiscordPresenceStatus): string {
  switch (status) {
    case "online":
      return "Online";
    case "idle":
      return "Idle";
    case "dnd":
      return "Do Not Disturb";
    default:
      return "Offline";
  }
}

export function discordStatusTone(status: DiscordPresenceStatus): {
  dot: string;
  text: string;
  border: string;
  bg: string;
} {
  switch (status) {
    case "online":
      return {
        dot: "#23a559",
        text: "text-emerald-300",
        border: "border-emerald-500/30",
        bg: "bg-emerald-500/10",
      };
    case "idle":
      return {
        dot: "#f0b232",
        text: "text-amber-200",
        border: "border-amber-500/30",
        bg: "bg-amber-500/10",
      };
    case "dnd":
      return {
        dot: "#f23f43",
        text: "text-red-300",
        border: "border-red-500/30",
        bg: "bg-red-500/10",
      };
    default:
      return {
        dot: "#80848e",
        text: "text-[#8392aa]",
        border: "border-[#1f3050]",
        bg: "bg-[#0a1525]",
      };
  }
}

export async function fetchDiscordPresence(
  ids: string[],
): Promise<Record<string, DiscordPresenceStatus>> {
  const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const res = await fetch(
      `/api/public/discord-presence?ids=${encodeURIComponent(unique.join(","))}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return {};
    const data = await res.json() as Record<string, string>;
    const out: Record<string, DiscordPresenceStatus> = {};
    for (const id of unique) {
      const raw = data[id];
      out[id] = raw === "online" || raw === "idle" || raw === "dnd" ? raw : "offline";
    }
    return out;
  } catch {
    return {};
  }
}
