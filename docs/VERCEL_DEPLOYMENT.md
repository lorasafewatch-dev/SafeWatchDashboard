# Deploy both apps to Vercel

Create two Vercel projects, one per app. Each receives a separate HTTPS URL and
uses the same existing Supabase database. The frontends need no local backend.

## Separate prepared packages

Use `safewatch-dashboard.zip` and `safewatch-family.zip` from `outputs/vercel/`.
Extract each archive and upload all its contents to its own GitHub repository,
then import that repository into Vercel. Choose Root Directory **`.`**, Framework
**Vite**, and Node.js **24.x**. Keep `apps/` intact. The root `vercel.json` supplies
the install/build/output settings and includes the shared files inside the root.

| Setting | Dashboard package | Family package |
| --- | --- | --- |
| Root Directory | `.` | `.` |
| Install Command | `npm ci --prefix apps/dashboard-admin` | `npm ci --prefix apps/family-app` |
| Build Command | `npm run build` | `npm run build` |
| Output Directory | `apps/dashboard-admin/dist` | `apps/family-app/dist` |

Packages contain source, locked dependencies and shared code. They exclude local
`.env`, installed dependencies, prebuilt output, firmware, account test fixtures,
logs and tools. Run `python scripts/prepare_vercel.py` to regenerate after edits.

## One GitHub repository for the full workspace

Import the same repository twice and configure these project roots instead:

| Setting | Dashboard | Family |
| --- | --- | --- |
| Root Directory | `apps/dashboard-admin` | `apps/family-app` |
| Framework | Vite | Vite |
| Node.js | 24.x | 24.x |
| Install Command | `npm ci` | `npm ci` |
| Build Command | `npm run build` | `npm run build` |
| Output Directory | `dist` | `dist` |

Enable **Include source files outside of the Root Directory in the Build Step**
for both projects because they import `apps/shared`. App-local `vercel.json`
files configure SPA fallback routing and headers. An app subfolder alone is
insufficient without its shared source.

## Environment variables

Before deploying, add these in **each** Vercel project under **Settings →
Environment Variables** for Production (and Preview if previews use this database):

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://mtokpeuvibiloowtopim.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The project's public anon JWT or publishable key |

Copy the public key from the existing app `.env` or Supabase project API
settings. Never use a secret or service-role key in a browser app. The build
stops with a useful error for missing/placeholders/malformed/privileged values.
Redeploy after changing variables; Vite includes public values at build time.
Configured `.env` files are deliberately absent from the source packages.

## Production login and reset URLs

Once Vercel creates the domains, open **Supabase → Authentication → URL
Configuration** and replace the example domains below with the actual stable URLs:

- **Site URL:** `https://YOUR-FAMILY-DOMAIN.vercel.app` (one URL).
- **Redirect URLs:** `https://YOUR-FAMILY-DOMAIN.vercel.app/` and
  `https://YOUR-FAMILY-DOMAIN.vercel.app/?auth=reset-password`.
- **Redirect URLs:** `https://YOUR-DASHBOARD-DOMAIN.vercel.app/` and
  `https://YOUR-DASHBOARD-DOMAIN.vercel.app/?auth=reset-password`.

Add custom domains too if used. Retain localhost entries for local testing if
needed. Use exact production URLs; previews need their own explicitly allowed
URLs. Auth callbacks already use the current app origin, so production has no
hardcoded localhost callback.

In Supabase **Authentication**, open **Email Templates** (or **Emails →
Templates**, depending on the dashboard layout), then **Reset Password**. Use
the **Source** editor, paste the contents of
`supabase/templates/reset_password.html`, and save. Copy the HTML source rather
than the rendered browser preview. The button uses `{{ .RedirectTo }}` to return
to the requesting app and verify inside the app; **Enter reset code** is the
alternative. Request a fresh email after saving; existing emails retain old links.

## Database and first admin

Vercel does not apply database migrations. Keep the existing Supabase database.
If the earlier account-access version was installed, apply
`supabase/migrations/20261013_automatic_super_admin.sql` after
`20261013_account_access.sql`. The current main migration includes the update.

Register `lorasafewatch@gmail.com` through the dashboard. It becomes the initial
super admin once; later staff signups require its approval in **Settings →
Barangay account access**. Family accounts use different emails. After transfer,
signup cannot reclaim the old role. The separate `initialize_super_admin.sql`
command is no longer required.

Apply `supabase/migrations/20261013_san_isidro_boundary.sql` to update the live
geofence trigger. Both frontends now use the PSA/NAMRIA mapped San Isidro East
boundary (valid 6 November 2023), including the formerly omitted road-side strip.
The migration uses that same polygon and preserves alert confirmations/history.
Current GPS packets resolve incidents when a watch returns inside the corrected
boundary. Map changes alone do not update the database trigger.

Apply the complete current `20261013_gateway_access_guard.sql` file after the
account migration. Its anonymous restrictions override legacy public policies
while preserving gateway telemetry uploads. The live diagnostic identified
missing anonymous guards, and applying the complete file resolved the issue:
anonymous reads of devices, telemetry and alerts now return no rows, including
a fresh noncached device check. `supabase/check_live_access.sql` is a read-only
diagnostic for future policy checks.
Do not run the clean-slate `supabase/setup.sql` on the existing database.

## Check after deployment

Open and refresh both HTTPS URLs. Verify login, cross-app restrictions, linked
seniors, live data and alert confirmation. Request a fresh reset email from each
app and confirm it returns to that app's password form. Enter real new passwords
yourself. Check a later staff signup waiting for approval and its approval by
the super admin. Use stable production domains for these checks.

The family app generates a production PWA manifest/service worker. `sw.js` is
revalidated for updates, and development service workers are disabled. An old
localhost worker may need removal in browser Application settings if stale
development content remains.

## Validation

The release packages are checked using fresh locked dependency installs and
production builds with public settings supplied only to build processes. The
archive checks verify shared code, lockfiles, config paths and exclusions.
Both compiled apps also load successfully in the browser with no console errors;
the dashboard signup and family password-reset forms open correctly.
The dashboard cards use four status bars with gray, red, orange, yellow and green
levels. Its profile button shows the current account and opens account settings
or logout. Both logout controls were checked with successful and failed requests,
and the sidebar logout remains visible in a short window.
Geofence tests check agreement between the apps and PostGIS at all 78 mapped
vertices and the corrected road-side strip. Re-entry, acknowledgement and repeated
outside packets retain the existing incident behavior. Both maps were checked in
the browser, including the family app's inside/outside classification.
Account-access SQL tests reproduce the legacy public-policy leak and verify that
the guard blocks anonymous history/writes while approved roles and gateway
uploads continue to work. The live anonymous-read check also passes.
Local preparation does not create or publish a Vercel project. Actual domains
and live Auth configuration are supplied after deployment.

References: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite),
[shared source](https://vercel.com/docs/monorepos/monorepo-faq),
[Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Vite environment](https://vite.dev/guide/env-and-mode),
[Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls).
