# hooks/

Custom React hooks that encapsulate data fetching and shared state.

| File | What it does |
|---|---|
| `useCadData.ts` | Fetches and caches CAD roster, unit, and call data from the API. |
| `useCadStatus.ts` | Polls `/api/settings/cad-status` to keep the CAD online/offline indicator up to date. |
| `usePhoneSSE.ts` | Opens a Server-Sent Events connection to receive real-time phone call notifications. |
| `useSelfDispatch.ts` | Manages the officer self-dispatch workflow (pick-up / assign to call). |
| `use-mobile.tsx` | Detects whether the viewport is a mobile breakpoint. |
| `use-toast.ts` | Re-exports the shadcn toast hook. |
