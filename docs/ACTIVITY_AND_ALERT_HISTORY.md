# Activity log, alert history, and location history

The family app opens **Alerts → Activity log & alert history**. The barangay app
opens **Activity & Alert History** in the sidebar. Choose a Philippine date,
senior (or all accessible seniors), and record type. Alert history can be filtered
to SOS, geofence, or low battery. Refresh loads the newest records; Load earlier
records paginates without changing active alerts or acknowledging them.

Location routes remain under **Location → Location history** in the family app
and **Location History** in the barangay app. They show timestamped GPS observations
on a map; selecting a timestamp centers its location. The first 200 points load
initially, with earlier points available. Gaps over five minutes are not connected.
Points do not prove the actual path traveled between observations, and no-fix or
unknown-time instrumented packets are excluded.

## Recorded events

- New watch alerts and their confirmations, status changes, SOS response handoffs,
  and closure are stored as separate server-side activity records. Repeated radio
  packets and idempotent responses do not duplicate these records. Saved records
  remain reviewable after the alert leaves the pending list.
- Movement records use the existing GPS telemetry, including observations that
  predate this feature; a second telemetry database is not created.
- Watch registrations, senior name/age/gender/device-label changes, and family
  safe-zone changes are recorded from database triggers. Super administrators
  also see existing administrative audit actions such as access decisions and
  watch deletion, under the existing audit-table permissions. This is not a
  server-crash, browser-console, or login/logout diagnostics collector.
- Existing alerts are imported once as **Existing alert record** snapshots. Their
  stored status is available, but changes that happened before this migration
  cannot be reconstructed. The UI explicitly distinguishes these snapshots.
- Activity records are not a delivery receipt. In-app notifications require the
  app to be open; this change adds no background push, SMS, or email.

History queries use server authorization and table row-level security. Approved
families see their currently linked watches, staff must satisfy the existing MFA
policy, and administrative audit records remain limited to super administrators.
Clients cannot insert, alter, or delete activity records. Revoking a family link
immediately removes server access; changing the accessible-watch list clears the
component's cached results. History is held in component memory, not local storage.
Permanent senior/watch deletion cascades to its private activity records and
retains the existing restricted administrative deletion audit.

## Apply to the hosted system

1. Back up the database using the existing operator procedure.
2. Apply only `supabase/migrations/20261104_activity_history.sql` after the existing
   `20261103_battery_location_history.sql` and `20261103_sos_response_handoff.sql`.
   It is additive and safe to reapply; it preserves watches, links, telemetry,
   alerts, and existing audit data. Do not run the destructive fresh-install
   `supabase/setup.sql` on the existing installation. The radio-security migration
   is unrelated and is not required for history.
3. Deploy both updated web apps with the existing Supabase configuration.
4. Sign in as a linked family and an MFA-verified staff user. Review a known day's
   GPS route, inspect historical alerts and filters, and confirm that an unrelated
   family cannot see the records. In a controlled test, confirm/decline and close
   an SOS, refresh history, and verify the separate saved transitions.

The activity-history table and query function were confirmed present in the
SafeWatch hosted database on 4 November 2026 after the migration was applied.
The updated web apps must also be deployed before the new screens are available.
Local tests and database object checks alone do not establish hosted UI operation.

## Verification

- `node --test apps/shared/*.test.js apps/dashboard-admin/src/*.test.js`
- `node supabase/tests/activity_history.test.mjs`
- `node supabase/tests/battery_location_history.test.mjs`
- `node supabase/tests/sos_response_handoff.test.mjs`
- `node scripts/verify_history_ui.mjs` and `node scripts/verify_sos_response_ui.mjs`
- Production builds of both apps.

The database suites use isolated PostgreSQL/PostGIS fixtures and test immutable
transitions, deduplication, old-alert snapshots, day boundaries, tied timestamps,
pagination, invalid GPS points, per-watch authorization, MFA, revocation, rejected
client writes, and deletion. Component rendering checks filters, history records,
loading/empty/error states, escaped text, and the family entry point.
The synthetic browser preview is `/tests/activity-history-preview.html` on the
family development server. Windows Computer Use stopped because it could not
reliably determine the browser URL; visual browser validation remains unverified.
