# SafeWatch notifications — 13 October 2026

The [3 November SOS response update](SOS_RESPONSE_HANDOFF.md) adds immediate,
reciprocal decline handoffs and persistent family/secretary confirmation indicators.
Deploy its additive migration after the battery/location-history update. The
historical notes below describe the earlier notification rollout.

The live API check on 13 October returned `PGRST202` for
`acknowledge_alert_incident`. Its latest 1,000 sampled alert rows had no incident
status or open-incident flag. The incident migration prepared on 9 October was
not deployed. This caused per-packet duplicates and SOS confirmations that
updated no rows under the old RLS policies. The dashboard also had two badges
hardcoded to display one alert.

## Live deployment

The main SQL fix was applied on 13 October. A subsequent live check found saved
watch and manual SOS confirmations, zero active family incidents, and zero
incidents requiring Barangay attention. Confirmed geofences continued receiving
packet updates without reopening. The signed-in family app showed zero active
alerts and no browser errors.

The first deployed version revoked execute from PUBLIC but did not remove
Supabase's explicit default grant to anon. The source now revokes both. For a
project that already ran the earlier file, also run
`supabase/migrations/20261013_notification_rpc_permissions.sql`. This leaves
authenticated and service-role access intact. This follow-up has been tested
with explicit anon default privileges; its live application is pending.

## Database files

Run `supabase/notification_fix.sql` in the existing project's SQL Editor, or apply
both migrations in order:

1. `supabase/migrations/20261009_alert_incidents.sql`
2. `supabase/migrations/20261013_notification_confirmation.sql`

The combined file is ready to run. It preserves tables, devices, telemetry and
alert history. It briefly locks writes while consolidating legacy duplicates,
replaces the telemetry trigger, and provides authenticated confirmation and
manual SOS RPCs. RLS stays enabled, using the existing shared-device access model.
The browser's public key cannot apply migrations; a connected Supabase project
or its SQL Editor is required. `supabase/setup.sql` is for a fresh database only:
it drops existing tables and must not be run on this installation.

## Family and Barangay behavior

- Repeated outside-zone packets update one geofence incident without changing
  its original three-minute response window.
- Family notifications play once when an incident is discovered and once when
  30 seconds remain. Further packet updates stay silent.
- Confirmation uses the database RPC. The UI removes the incident only after
  the server reports success. Repeated confirmations are idempotent.
- A confirmed geofence stays confirmed while the watch is outside. A current
  valid GPS fix inside the zone resolves it; a new departure creates a new alert.
- A confirmed watch SOS stays confirmed while the watch keeps transmitting its
  SOS signal. After the signal clears, a new SOS can alert again. Geofence and
  SOS confirmations do not suppress one another.
- Repeated manual SOS requests reuse the same pending request. An explicit new
  request after confirmation remains possible. Failed sends show an error.
- Only unconfirmed incidents whose response window has expired appear in
  Barangay alerts. Family-confirmed incidents are excluded even after that
  deadline. Dashboard badges show the actual count and disappear at zero.
- Both apps invalidate pending refreshes around confirmation and guard against
  duplicate clicks. Queued sounds are tied to active incidents; confirmation
  stops scheduled notes. Dashboard sound identities persist across reloads.
- The dashboard refreshes through Realtime and polling, so another client's
  confirmation can take up to the polling interval to appear if Realtime is
  unavailable. Notifications are in-app; OS push or SMS delivery is not provided.

The old device-name mutation fallback has been removed. It did not provide a
working SOS confirmation or a reliable shared incident lifecycle. If the database
update is missing, the app reports that requirement and keeps the alert active.

## Validation

- 16 alert lifecycle tests: grouping, deadlines, independent incidents, reload
  sound memory, failed saves, and confirmed incidents excluded from Barangay.
- Two audio tests: blocked audio queues nothing, new tones replace old scheduled
  notes, and confirmation cancels remaining SOS notes.
- 13 PostgreSQL/PostGIS scenarios: reproduce the legacy RLS save failure, apply
  and reapply the migrations, verify authenticated confirmations, preserve
  history, suppress repeated packets after acknowledgment, rearm genuine new
  events, deduplicate manual SOS, and reject anonymous RPC calls.
- Production builds pass for both apps.
- The isolated browser fixture at
  `http://localhost:5173/tests/notification-preview.html` verifies repeated packets,
  geofence confirmation, failed SOS confirmation, successful retry, and zero
  Barangay alerts after confirmation. It creates no production alerts.

The main notification migration and saved production confirmations have been
verified. The explicit anon permissions follow-up still needs to be applied.
The client boundary remains the existing map polygon, not a separately
surveyed administrative boundary. Extra dashboard trusted locations are stored
in browser memory and are not part of the server geofence.
