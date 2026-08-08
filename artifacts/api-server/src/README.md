# API Server — Source

Express/Node.js REST API that powers the DOJRP CAD/MDT frontend.

## Folder Layout

```
src/
├── index.ts         ← Entry point; starts the HTTP server
├── app.ts           ← Express app setup: middleware, CORS, route registration
│
├── routes/          ← One file per API domain (each exports an Express Router)
└── lib/             ← In-process state stores and shared utilities
```

## Route Map

| File | Base path | Description |
|---|---|---|
| `health.ts` | `/api/health` | Liveness check |
| `cad-auth.ts` | `/api/cad-auth` | Discord OAuth login, session validation, sign-off |
| `roster.ts` | `/api/roster` | Member roster, rank groups, fleet vehicles |
| `units.ts` | `/api/units` | Live CAD unit tracking (sign-on, heartbeat, sign-off) |
| `cad-calls.ts` | `/api/cad/calls` | Active call/incident management |
| `cad-profiles.ts` | `/api/cad/profiles` | Officer CAD profiles |
| `civilian.ts` | `/api/civilian` | Civilian record CRUD |
| `reports.ts` | `/api/reports` | Incident report CRUD |
| `resources.ts` | `/api/resources` | DPS document resources (rich-text docs) |
| `announcements.ts` | `/api/announcements` | Announcement CRUD |
| `phone.ts` | `/api/phone` | In-app phone calls (SSE push + REST) |
| `discord.ts` | `/api/discord` | Discord bot bridge (role sync, webhooks) |
| `erlc.ts` | `/api/erlc` | ER:LC game server API proxy |
| `moderations.ts` | `/api/moderations` | Moderation / ban records |
| `staff.ts` | `/api/staff` | Staff management |
| `admin.ts` | `/api/admin` | Admin-only configuration endpoints |
| `settings.ts` | `/api/settings` | App-wide settings (CAD status, etc.) |
| `stats.ts` | `/api/stats` | Analytics and statistics |
| `doc.ts` | `/api/doc` | CAD documentation pages |

## In-Process State (lib/)

| File | What it stores |
|---|---|
| `unit-store.ts` | Active CAD units — added on sign-on, expired on timeout |
| `group-store.ts` | Unit groups — created when a unit invites another |
| `online-tracker.ts` | Which Discord users are currently online (heartbeat-based) |
| `audit-log.ts` | Helper for writing structured audit log rows to the database |
| `logger.ts` | Pino structured logger instance shared across the server |
