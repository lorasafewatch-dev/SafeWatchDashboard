# SafeWatch Dashboard deployment

Import this entire folder as one Vercel project. Root Directory is `.`.
Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before deploying.
Use Node.js 24.x. See [deployment instructions](DEPLOYMENT.md).

Local install: `npm ci --prefix apps/dashboard-admin`. Local build: `npm run build`.
Provide public Supabase values through process environment variables or
`apps/dashboard-admin/.env` for local builds. Keep `apps/shared` with the app.

[Family safe zones](docs/FAMILY_SAFE_ZONES.md) describes the family map editor and
the required database migration for per-senior monitoring.

## Watch alerts and notification bell

The bell shows unread watch alerts and shared SOS responses. Families and barangay
secretaries can hand off an SOS and see each other's confirmation. Location history
provides dated GPS route review, and low-battery readings create charge alerts.

Before deployment, apply these additive migrations after the existing family-safe-zone migration:

1. `supabase/migrations/20261103_battery_location_history.sql`
2. `supabase/migrations/20261103_sos_response_handoff.sql`

See [bell notifications](docs/BELL_NOTIFICATIONS.md), [SOS handoffs](docs/SOS_RESPONSE_HANDOFF.md),
and [battery and location history](docs/BATTERY_AND_LOCATION_HISTORY.md).
Publishing this web app does not apply the Supabase database migrations.
