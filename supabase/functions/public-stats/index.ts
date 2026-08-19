import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://northpointrp.xyz",
  "https://www.northpointrp.xyz",
  "https://freddyfoxyten1.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://northpointrp.xyz";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  const token = (Deno.env.get("DISCORD_BOT_TOKEN") ?? "").trim();
  const guildId = (Deno.env.get("DISCORD_GUILD_ID") ?? "1539452857592324116").trim();

  let discord_members = 0;
  let discord_online = 0;

  if (token) {
    try {
      const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (r.ok) {
        const guild = await r.json() as {
          approximate_member_count?: number;
          approximate_presence_count?: number;
        };
        discord_members = guild.approximate_member_count ?? 0;
        discord_online = guild.approximate_presence_count ?? 0;
      }
    } catch {
      /* return zeros */
    }
  }

  const body = JSON.stringify({
    erlc_players: 0,
    erlc_max_players: 0,
    discord_members,
    discord_online,
  });

  return new Response(body, { headers: corsHeaders(origin) });
});
