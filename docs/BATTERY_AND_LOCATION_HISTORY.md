# Low battery alerts and location history

Apply `supabase/migrations/20261103_battery_location_history.sql` after the existing
account, identity, family-approval and safe-zone migrations. Deploy both updated
apps together. The migration preserves devices, links, telemetry and alert history.
It does not generate alerts from old readings; the next fresh watch packet evaluates
the battery. The watch and gateway already transmit battery percentage and GPS.

A fresh reading at or below 20% opens one LOW_BATTERY incident. Linked approved
families and approved barangay staff see an in-app alert and hear a battery tone
when browser audio is enabled. Battery alerts appear immediately in the staff
Alerts page; they have no emergency countdown. SOS and geofence alerts retain
priority and their existing response windows. Notifications require the app to
be open; this change does not add background push, SMS or email delivery.

Repeated readings update the same incident. Confirmation persists for that low
battery episode. A reading at or above 25% closes it and enables a later drop to
20% to create a new incident. The 21–24% range prevents repeated alerts when the
reading fluctuates. Missing, invalid, stale, future and reordered readings cannot
replace a newer battery state. No GPS fix is required for a battery notification.

Families open Location and scroll to Location history. Staff open Location History
and choose a senior. Select a Philippine calendar date to see a route and recorded
GPS points with timestamps; select a timestamp to center the historical map.
History uses existing telemetry, including records collected before this update.
No-fix points and instrumented packets without a known reception time are excluded.
Routes leave gaps longer than five minutes open. Lines connect observations and
do not establish the actual path traveled between them.

The first 200 points load initially; Load earlier locations uses a timestamp/ID
cursor to avoid duplicate or missing points at page boundaries. Refresh history
loads the most recent points for that day. Dates use Asia/Manila, even on devices
in another timezone. Empty history, loading and failed queries have separate states.
History is held in component memory and cleared when changing watches or dates;
it is not saved to browser storage.

The history RPC is SECURITY INVOKER and retains telemetry/device RLS. It rejects
anonymous, unapproved, unlinked and unavailable-watch access, validates query
ranges, and bounds page size. Staff access still requires the installed MFA policy.
The confirmation wrapper retains its existing family-link and staff-role checks.

The migration and app changes must be deployed before these features work on the
hosted system. Local tests do not establish deployment or hardware delivery.

Validation: 107 shared/dashboard JavaScript tests, the PostgreSQL/PostGIS battery
and history scenarios, and the existing alert, safe-zone and authenticated gateway
regression suites pass. Both apps build for production. An isolated synthetic UI
fixture is available at `/tests/battery-history-preview.html` on the family Vite
development server. Browser verification was blocked by the computer-use tool's
Chrome URL detection; visual layout and interactions have not been verified.
