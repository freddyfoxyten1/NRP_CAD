import { useEffect, useMemo, useState } from "react";
import { fetchDiscordPresence, type DiscordPresenceStatus } from "@/lib/discord-presence";

export function useDiscordPresence(
  discordIds: Array<string | null | undefined>,
): Record<string, DiscordPresenceStatus> {
  const idsKey = useMemo(() => {
    const unique = [...new Set(
      discordIds.map(id => id?.trim()).filter(Boolean) as string[],
    )];
    unique.sort();
    return unique.join(",");
  }, [discordIds]);

  const [presence, setPresence] = useState<Record<string, DiscordPresenceStatus>>({});

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setPresence({});
      return;
    }
    let cancelled = false;
    void fetchDiscordPresence(ids).then(map => {
      if (!cancelled) setPresence(map);
    });
    return () => { cancelled = true; };
  }, [idsKey]);

  return presence;
}
