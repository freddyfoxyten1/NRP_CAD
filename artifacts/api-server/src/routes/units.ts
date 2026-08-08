import { Router } from "express";
import { pool } from "@workspace/db";
import {
  signOn,
  signOff,
  updateStatus,
  updateUnitNumber,
  unitHeartbeat,
  getActiveUnits,
  getUnit,
  isSignedOn,
  type UnitStatus,
} from "../lib/unit-store";
import {
  getGroups,
  getGroupForUser,
  createGroup,
  addToGroup,
  createInvite,
  getPendingInvitesFor,
  respondToInvite,
  removeFromGroup,
  pruneInvites,
} from "../lib/group-store";

const router = Router();

const VALID_STATUSES: UnitStatus[] = ['Available', 'Unavailable', 'Busy', 'Enroute', 'On-Scene'];

// GET /units/active — returns all currently active units
router.get("/units/active", (_req, res) => {
  res.json(getActiveUnits());
});

// POST /units/sign-on — sign a unit onto duty
router.post("/units/sign-on", async (req, res) => {
  try {
    const body = req.body as {
      userId?: number;
      unitNumber?: string;
      department?: string;
      division?: string;
    };

    const userId = Number(body.userId);
    const unitNumber = typeof body.unitNumber === "string" ? body.unitNumber.trim() : "";
    const department = typeof body.department === "string" ? body.department.trim() : "DPS";
    const division   = typeof body.division   === "string" ? body.division.trim() || undefined : undefined;

    if (!Number.isInteger(userId) || !unitNumber) {
      res.status(400).json({ error: "userId and unitNumber are required." });
      return;
    }

    // Fetch user profile for name/rank/callsign
    const result = await pool.query<{
      id: number;
      username: string;
      callsign: string | null;
      dps_rank: string | null;
      rank: string;
    }>(
      `SELECT id, username, callsign, dps_rank, rank
       FROM cad_user_profiles
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    const profile = result.rows[0];
    if (!profile) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const unit = signOn({
      userId: profile.id,
      username: profile.username,
      callsign: profile.callsign ?? profile.username,
      unitNumber,
      department,
      division,
      rank: profile.dps_rank ?? profile.rank ?? "Officer",
      status: "Unavailable",
    });

    res.json(unit);
  } catch (err) {
    req.log.error({ err }, "units/sign-on error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sign on failed." });
  }
});

// POST /units/sign-off — remove a unit from duty
router.post("/units/sign-off", (req, res) => {
  const body = req.body as { userId?: number };
  const userId = Number(body.userId);

  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "userId is required." });
    return;
  }

  const removed = signOff(userId);
  res.json({ ok: removed });
});

// PATCH /units/:userId/status — update a unit's status
router.patch("/units/:userId/status", (req, res) => {
  const userId = Number(req.params.userId);
  const body = req.body as { status?: string };
  const status = body.status as UnitStatus;

  if (!Number.isInteger(userId) || !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: "Valid userId and status are required." });
    return;
  }

  const unit = updateStatus(userId, status);
  if (!unit) {
    res.status(404).json({ error: "Unit not found or not signed on." });
    return;
  }

  res.json(unit);
});

// PATCH /units/:userId/unitNumber — dispatcher edits a unit's identifier
router.patch("/units/:userId/unitNumber", (req, res) => {
  const userId = Number(req.params.userId);
  const body = req.body as { unitNumber?: string };
  const unitNumber = typeof body.unitNumber === "string" ? body.unitNumber.trim() : "";

  if (!Number.isInteger(userId) || !unitNumber) {
    res.status(400).json({ error: "Valid userId and unitNumber are required." });
    return;
  }

  const unit = updateUnitNumber(userId, unitNumber);
  if (!unit) {
    res.status(404).json({ error: "Unit not found or not signed on." });
    return;
  }

  res.json(unit);
});

// POST /units/groups/assign — dispatcher directly assigns a unit to a group (no invite)
router.post("/units/groups/assign", (req, res) => {
  const body = req.body as { username?: string; groupId?: string | null };
  const username = typeof body.username === "string" ? body.username.trim() : "";

  if (!username) {
    res.status(400).json({ error: "username is required." });
    return;
  }

  removeFromGroup(username);

  if (body.groupId) {
    const ok = addToGroup(body.groupId, username);
    if (!ok) {
      res.status(404).json({ error: "Group not found." });
      return;
    }
  }

  res.json({ ok: true, groups: getGroups() });
});

// POST /units/heartbeat — keep unit alive (called alongside session heartbeat)
router.post("/units/heartbeat", (req, res) => {
  const body = req.body as { userId?: number };
  const userId = Number(body.userId);

  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "userId is required." });
    return;
  }

  unitHeartbeat(userId);
  const unit = getUnit(userId);
  res.json({ signedOn: isSignedOn(userId), unit: unit ?? null });
});

// ── Group routes ──────────────────────────────────────────────────────────────

// GET /units/groups — all active groups
router.get("/units/groups", (_req, res) => {
  pruneInvites();
  res.json(getGroups());
});

// GET /units/groups/invites?username=... — pending invites for a user
router.get("/units/groups/invites", (req, res) => {
  const username = String(req.query.username ?? "");
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  pruneInvites();
  res.json(getPendingInvitesFor(username));
});

// POST /units/groups/invite — send a group invite
router.post("/units/groups/invite", (req, res) => {
  const { fromUserId, toUsername } = req.body as { fromUserId?: number; toUsername?: string };
  if (!fromUserId || !toUsername) { res.status(400).json({ error: "fromUserId and toUsername required" }); return; }

  const fromUnit = getUnit(Number(fromUserId));
  if (!fromUnit) { res.status(404).json({ error: "Sending unit not signed on" }); return; }

  // Make sure target is signed on
  const allUnits = getActiveUnits();
  const toUnit = allUnits.find(u => u.username === toUsername);
  if (!toUnit) { res.status(404).json({ error: "Target unit not signed on" }); return; }

  // Get or create a group for the sender
  let group = getGroupForUser(fromUnit.username);
  if (!group) group = createGroup(fromUnit.username);

  // Don't invite someone already in the group
  if (group.memberUsernames.includes(toUsername)) {
    res.status(409).json({ error: "Unit is already in your group" }); return;
  }

  const invite = createInvite(
    { username: fromUnit.username, callsign: fromUnit.callsign, unitNumber: fromUnit.unitNumber },
    toUsername,
    group.id,
  );
  res.json(invite);
});

// POST /units/groups/invites/:id/respond — accept or reject
router.post("/units/groups/invites/:id/respond", (req, res) => {
  const { accepted } = req.body as { accepted?: boolean };
  if (typeof accepted !== "boolean") { res.status(400).json({ error: "accepted (boolean) required" }); return; }
  const invite = respondToInvite(req.params.id, accepted);
  if (!invite) { res.status(404).json({ error: "Invite not found or already responded" }); return; }
  res.json(invite);
});

// POST /units/groups/leave — leave current group
router.post("/units/groups/leave", (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username) { res.status(400).json({ error: "username required" }); return; }
  removeFromGroup(username);
  res.json({ ok: true });
});

export default router;
