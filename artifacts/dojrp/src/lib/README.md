# lib/

Client-side libraries for session handling and shared utilities.

| File | What it does |
|---|---|
| `cad-session.ts` | Reads and writes the active CAD session to `localStorage`. Exposes the session type and helper functions used across the whole app. |
| `cad-local-accounts.ts` | Manages a list of saved local test accounts stored in `localStorage` (used for development / demo logins). |
| `utils.ts` | `cn()` helper — merges Tailwind classes via `clsx` + `tailwind-merge`. Used everywhere a conditional class is needed. |
