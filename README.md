# SafeWatch Dashboard deployment

Import this entire folder as one Vercel project. Root Directory is `.`.
Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before deploying.
Use Node.js 24.x. See [deployment instructions](DEPLOYMENT.md).

Local install: `npm ci --prefix apps/dashboard-admin`. Local build: `npm run build`.
Provide public Supabase values through process environment variables or
`apps/dashboard-admin/.env` for local builds. Keep `apps/shared` with the app.

[Family safe zones](docs/FAMILY_SAFE_ZONES.md) describes the family map editor and
the required database migration for per-senior monitoring.
