# DOJRP CAD/MDT — Frontend Source

This is the React/TypeScript frontend for the DOJRP CAD/MDT system.

## Folder Layout

```
src/
├── App.tsx              ← React Router setup; all routes are defined here
├── main.tsx             ← Entry point; mounts the React app to the DOM
├── index.css            ← Global styles + TipTap editor CSS
├── globals.d.ts         ← TypeScript global type declarations
│
├── pages/               ← Full-page views, one file per route
├── components/
│   ├── editor/          ← Document editor and image components (TipTap-based)
│   ├── overlays/        ← Modals, drawers, and full-screen overlays
│   ├── shared/          ← Small reusable UI pieces (logo, badges, etc.)
│   └── ui/              ← Auto-generated shadcn/ui primitives (don't edit)
│
├── hooks/               ← Custom React hooks for data fetching and state
├── lib/                 ← Session management and utility libraries
├── extensions/          ← Custom TipTap editor extensions
└── utils/               ← Misc helper functions (toast wrappers, etc.)
```

## Pages at a Glance

| Route | File | Description |
|---|---|---|
| `/` | `Index.tsx` | Public landing / sign-in page |
| `/portal` | `MemberPortal.tsx` | General member portal |
| `/dps` | `DepartmentOfPublicSafety.tsx` | DPS officer portal (roster, vehicles, docs) |
| `/doc` | `DepartmentOfCommunications.tsx` | DOC dispatcher panel |
| `/admin` | `AdminPortal.tsx` | Admin management panel |
| `/staff` | `StaffPortal.tsx` | Staff / moderation portal |
| `/discord-callback` | `DiscordCallback.tsx` | Discord OAuth callback |
| `*` | `NotFound.tsx` | 404 catch-all |
