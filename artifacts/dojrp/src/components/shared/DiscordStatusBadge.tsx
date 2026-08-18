import {
  discordStatusLabel,
  discordStatusTone,
  type DiscordPresenceStatus,
} from "@/lib/discord-presence";

export function DiscordStatusBadge({ status }: { status: DiscordPresenceStatus }) {
  const tone = discordStatusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${tone.border} ${tone.bg} ${tone.text}`}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tone.dot }}
        aria-hidden
      />
      {discordStatusLabel(status)}
    </span>
  );
}
