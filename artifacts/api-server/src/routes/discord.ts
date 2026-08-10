import { Router } from "express";
import { pool } from "@workspace/db";
import {
  canSignInForCadMode,
  createCadAccountFromDiscord,
  getCommunityGuildJoinInfo,
  getRedirectUri,
  isCommunityGuildMember,
  isCommunityGuildMemberViaOAuth,
  loadCadSession,
} from "../lib/discord-auth";
import { ensureSuperAdminAccess, isSuperAdminDiscordId } from "../lib/superadmin";

const router = Router();

router.get("/discord/oauth/url", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    res.status(503).json({ error: "Discord OAuth is not configured." });
    return;
  }

  let redirectUri: string;
  try {
    redirectUri = getRedirectUri(req);
  } catch {
    res.status(503).json({ error: "Server redirect URI is not configured." });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds",
  });

  req.log.info({ redirectUri }, "discord oauth url generated");
  res.json({ url: `https://discord.com/oauth2/authorize?${params.toString()}` });
});

router.post("/discord/oauth/exchange", async (req, res) => {
  const { code } = req.body as { code?: string };

  if (!code) {
    res.status(400).json({ error: "code is required." });
    return;
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: "Discord OAuth is not configured." });
    return;
  }

  let redirectUri: string;
  try {
    redirectUri = getRedirectUri(req);
  } catch {
    res.status(503).json({ error: "Server redirect URI is not configured." });
    return;
  }

  req.log.info({ redirectUri, code: code.slice(0, 8) + "…" }, "discord oauth exchange");

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      req.log.warn({ body, status: tokenRes.status }, "discord token exchange failed");
      res.status(400).json({ error: "Failed to exchange Discord authorisation code." });
      return;
    }

    const token = (await tokenRes.json()) as { access_token: string };

    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });

    if (!userRes.ok) {
      res.status(400).json({ error: "Failed to retrieve Discord user information." });
      return;
    }

    const user = (await userRes.json()) as {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
    };

    // Prefer OAuth guild list — does not require the bot to be in the server.
    const inGuildViaOAuth = await isCommunityGuildMemberViaOAuth(token.access_token);

    res.json({
      id: user.id,
      username: user.username,
      globalName: user.global_name ?? null,
      avatarHash: user.avatar ?? null,
      // Short-lived token used only for the immediate login call (guild verify).
      accessToken: token.access_token,
      inCommunityGuild: inGuildViaOAuth,
    });
  } catch (err) {
    req.log.error({ err }, "discord/oauth/exchange error");
    res.status(500).json({ error: "Discord authorisation failed. Please try again." });
  }
});

router.post("/discord/oauth/login", async (req, res) => {
  const { id, username, avatarHash, accessToken } = req.body as {
    id?: string;
    username?: string;
    globalName?: string | null;
    avatarHash?: string | null;
    accessToken?: string;
  };

  if (!id || !username) {
    res.status(400).json({ error: "Discord user info is required." });
    return;
  }

  try {
    // Must be in the community Discord server (OAuth guilds preferred, bot fallback).
    let guildMember: boolean | null = null;
    if (accessToken) {
      guildMember = await isCommunityGuildMemberViaOAuth(accessToken);
    }
    if (guildMember === null) {
      guildMember = await isCommunityGuildMember(id);
    }

    if (guildMember !== true) {
      const joinInfo = await getCommunityGuildJoinInfo();
      res.status(403).json({
        error: "You are not within our Discord server.",
        code: "not_in_guild",
        guild_name: joinInfo.guild_name,
        invite_code: joinInfo.invite_code,
        invite_url: joinInfo.invite_url,
      });
      return;
    }

    const existing = await pool.query<{ id: number }>(
      `SELECT id FROM cad_user_profiles WHERE discord_id = $1 LIMIT 1`,
      [id],
    );

    let profileId: number;

    if (existing.rows.length > 0) {
      profileId = existing.rows[0].id;

      await pool.query(
        `UPDATE cad_user_profiles
         SET discord_username = $1,
             avatar_hash      = $2,
             updated_at       = NOW()
         WHERE id = $3`,
        [username, avatarHash ?? "", profileId],
      );
    } else {
      const session = await createCadAccountFromDiscord({
        id,
        username,
        avatarHash,
      });
      profileId = session.id;
      req.log.info({ discordId: id, cadId: profileId }, "discord login: created account");
    }

    if (isSuperAdminDiscordId(id)) {
      await ensureSuperAdminAccess(id, profileId);
      req.log.info({ discordId: id, cadId: profileId }, "discord login: superadmin elevated");
    }

    const access = await canSignInForCadMode(profileId);
    if (!access.allowed) {
      res.status(503).json({
        error: access.error ?? "CAD is currently offline.",
        code: "cad_offline",
        mode: access.mode,
      });
      return;
    }

    const session = await loadCadSession(profileId);
    if (!session) {
      res.status(500).json({ error: "Unable to load account session." });
      return;
    }

    req.log.info({ discordId: id, cadId: profileId }, "discord login: success");
    res.json(session);
  } catch (err) {
    req.log.error({ err }, "discord/oauth/login error");
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

export default router;
