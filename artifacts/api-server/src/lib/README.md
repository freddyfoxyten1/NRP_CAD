# lib/ (API server)

Shared server-side utilities and in-process state stores.

| File | What it does |
|---|---|
| `logger.ts` | Creates and exports the Pino structured logger used across all routes. |
| `audit-log.ts` | `writeAuditLog(category, action, data)` — inserts a row into the `audit_logs` table. |
| `unit-store.ts` | In-memory map of active CAD units. Units expire if no heartbeat arrives within the TTL. |
| `group-store.ts` | In-memory map of unit groups (multi-unit partnerships). Auto-cleaned when empty. |
| `online-tracker.ts` | In-memory set of online Discord user IDs, updated by session-status heartbeats. |

> **Note:** The in-memory stores are process-local. If the server restarts, units
> and groups are cleared. This is intentional — stale state should not survive a restart.
