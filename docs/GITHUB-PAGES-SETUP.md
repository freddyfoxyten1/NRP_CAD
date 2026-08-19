# Turn GitHub Pages back on (one-time)

If https://northpointrp.xyz shows **404**, GitHub Pages is disabled on the repo. Turn it on once:

1. Open **https://github.com/freddyfoxyten1/NRP_CAD/settings/pages**
2. Under **Build and deployment**:
   - **Source:** GitHub Actions
3. Save (no branch picker when using Actions)
4. Open **Actions** → **Deploy GitHub Pages** → **Run workflow** → branch `cursor/vps-deploy-ia-roster-fixes` → Run

After ~1 minute the site should load at:

- https://northpointrp.xyz
- https://freddyfoxyten1.github.io/NRP_CAD/

DNS for `northpointrp.xyz` must point at GitHub Pages (CNAME file is included in each deploy).

## Verify

```bash
curl -sI https://northpointrp.xyz/ | head -3
curl -s https://nrp-cad-api.onrender.com/api/public/live-stats
```

Homepage **Members / Online** cards use Render + Supabase. See [`LIVE-SETUP.md`](LIVE-SETUP.md).
