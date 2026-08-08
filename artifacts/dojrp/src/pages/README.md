# pages/

Each file here is a full-page React component mapped to a route in `App.tsx`.

| File | Route | What it does |
|---|---|---|
| `Index.tsx` | `/` | Public landing page with sign-in |
| `MemberPortal.tsx` | `/portal` | General member portal |
| `DepartmentOfPublicSafety.tsx` | `/dps` | DPS officer portal — roster, vehicles, equipment, documents |
| `DepartmentOfCommunications.tsx` | `/doc` | DOC dispatcher panel — CAD, calls, units |
| `CivilianOperations.tsx` | *(unused route)* | Civilian role operations |
| `AdminPortal.tsx` | `/admin` | Admin panel — settings, users, rank config |
| `StaffPortal.tsx` | `/staff` | Staff / moderation panel |
| `DiscordCallback.tsx` | `/discord-callback` | Handles the Discord OAuth redirect |
| `DocCadPage.tsx` | *(internal)* | Alternative document-driven CAD layout |
| `NotFound.tsx` | `*` | 404 page |

> **Note:** `CadPage.tsx` and `DocCadPage.tsx` are legacy/internal layouts
> kept for compatibility — the active CAD views live in the department pages.
