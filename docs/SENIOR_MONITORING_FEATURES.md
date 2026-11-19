# Senior monitoring update

Apply `supabase/migrations/20261118164949_senior_monitoring_features.sql` after
`20261103_sos_response_handoff.sql`, then deploy both apps together. The migration
is additive and repeatable. It does not delete seniors, links, requests, or history.

The Family Home, Location, Health and Alerts selectors search approved linked
seniors only. Admin Location History, Daily averages, and both apps' Activity &
Alert History use the same searchable picker. Matching is partial and ignores
case. Names are labels; Watch IDs identify selections and distinguish duplicate
names. Arrow keys and Enter select, Escape closes, and options support touch.
Manage watches still uses the complete physical Watch ID for new requests.

SOS snapshots are recorded by a database trigger in `alerts.details.sos_location`.
The snapshot contains the opening time, GPS recording time, source and point.
Only valid watch fixes recorded in the preceding 45 seconds are eligible. Missing
RF timestamps on instrumented gateway packets, zero coordinates, future fixes
and stale fixes are excluded. Family SOS submission uses the same server-time
rule. Updating, moving, confirming or resolving an incident cannot replace its
snapshot. Existing SOS history is backfilled from samples at its original time;
it never uses the current watch position. Address lookup is optional, runs only
after the incident has been saved/displayed, and cannot delay submission. Failure
keeps the saved coordinates and View SOS location link. Missing fixes show
“Location unavailable at the time of SOS.”

Senior photos use the private `senior-photos` Storage bucket and a `devices.photo_path`
pointer. Staff can upload/replace/remove them during registration or via Edit photo.
The client validates type, signature, size (2 MB maximum), decoding, and dimensions
(20 megapixels maximum), then resizes to 1024 pixels and re-encodes as WebP to remove
EXIF/GPS metadata. The bucket enforces WebP MIME type and the 2 MB limit. The staff
RPC verifies the existing object, metadata and senior-specific path before attaching
it. Replacements use unique immutable objects; old objects become unreadable to families
as soon as the pointer changes. Staff retain the read/delete permission needed to
clean up the old object through the Storage API.
Authenticated downloads enforce approved family links or authorized staff with MFA;
there are no public/signed photo URLs or persistent browser photo caches. The avatar
remains the fallback for absent or failed photos.

Family Access replaces Settings in the Admin sidebar. It shows Pending family
access requests above Current family links. Barangay Profile in the avatar menu
contains editable Profile Information, password and MFA controls; staff account
management remains restricted to super administrators. The Family Profile / Manage
watches screen retains submission and request tracking.

Bell request items are derived from saved request rows: a pending request for staff,
and approved/rejected decisions for its requester. They have their own Family access
category and stable request-ID/status keys, so polling and refresh do not duplicate
items or reset read state. Existing server uniqueness on pending user/watch requests
handles retried submissions. The staff bell opens and highlights the matching request.
These items do not enter safety alert counters, sounds, escalation or response timers.

Daily averages run in `get_watch_daily_health`, using every recorded sample for
one authorized Watch ID in the selected Asia/Manila calendar date. The query uses
RF receive time where available, or legacy creation time, and excludes instrumented
packets without RF time. Pulse values must be 1–300 bpm; blood oxygen must be 1–100%.
These are validity bounds, not normal-range thresholds. Nulls, zeros and out-of-range
values are excluded independently. Each metric displays its own count, average to
one decimal place, and empty-date message. Future samples are excluded. GPS availability
does not affect health validity. Latest reading cards/tables remain separately labeled.

Verification:

```powershell
node --test apps/shared/*.test.js
node supabase/tests/senior_monitoring_features.test.mjs
node supabase/tests/family_access_approval.test.mjs
node scripts/verify_sos_response_ui.mjs
node scripts/verify_monitoring_features.mjs
```

The browser script uses installed Edge and the bundled Playwright runtime. Its
fixtures never contact Supabase or write real health, account or incident data.
Screenshots and a JSON report are written to `output/verification/senior-monitoring/`.
Database verification uses PGlite/PostGIS with the real migration chain and a mock
Storage catalog, including anonymous/unlinked/revoked access and broad legacy policies.
Build each app using its existing `npm run build` command.
