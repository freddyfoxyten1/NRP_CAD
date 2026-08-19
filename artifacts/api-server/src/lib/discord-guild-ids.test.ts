import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  NRP_DPS_DISCORD_GUILD_ID,
  resolveDpsDiscordGuildId,
  resolveDivisionDiscordGuildId,
} from "./discord-guild-ids.js";

const COMMUNITY_GUILD = "1539452857592324116";

describe("resolveDpsDiscordGuildId", () => {
  const original = process.env.DPS_DISCORD_GUILD_ID;

  afterEach(() => {
    if (original === undefined) delete process.env.DPS_DISCORD_GUILD_ID;
    else process.env.DPS_DISCORD_GUILD_ID = original;
  });

  test("defaults to the NRP DPS server", () => {
    delete process.env.DPS_DISCORD_GUILD_ID;
    expect(resolveDpsDiscordGuildId()).toBe(NRP_DPS_DISCORD_GUILD_ID);
  });

  test("ignores legacy community guild misconfig", () => {
    process.env.DPS_DISCORD_GUILD_ID = COMMUNITY_GUILD;
    expect(resolveDpsDiscordGuildId()).toBe(NRP_DPS_DISCORD_GUILD_ID);
  });

  test("respects an explicit non-community guild override", () => {
    process.env.DPS_DISCORD_GUILD_ID = "9999999999999999999";
    expect(resolveDpsDiscordGuildId()).toBe("9999999999999999999");
  });
});

describe("resolveDivisionDiscordGuildId", () => {
  const originalDivision = process.env.DIVISION_DISCORD_GUILD_ID;

  afterEach(() => {
    if (originalDivision === undefined) delete process.env.DIVISION_DISCORD_GUILD_ID;
    else process.env.DIVISION_DISCORD_GUILD_ID = originalDivision;
  });

  test("falls back to the DPS guild when unset", () => {
    delete process.env.DIVISION_DISCORD_GUILD_ID;
    expect(resolveDivisionDiscordGuildId(NRP_DPS_DISCORD_GUILD_ID)).toBe(NRP_DPS_DISCORD_GUILD_ID);
  });

  test("ignores legacy community guild misconfig", () => {
    process.env.DIVISION_DISCORD_GUILD_ID = COMMUNITY_GUILD;
    expect(resolveDivisionDiscordGuildId(NRP_DPS_DISCORD_GUILD_ID)).toBe(NRP_DPS_DISCORD_GUILD_ID);
  });
});
