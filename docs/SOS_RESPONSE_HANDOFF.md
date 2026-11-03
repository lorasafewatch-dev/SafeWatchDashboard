# Shared SOS response and handoff

Apply `supabase/migrations/20261103_sos_response_handoff.sql` after
`20261103_battery_location_history.sql`, then deploy both apps. This additive
migration preserves existing incidents, confirmations, devices and family links.

The family app's SOS popup and Alerts page offer **Confirm response** and
**Decline — notify barangay secretary**. The secretary can confirm or choose
**Decline — notify family** in the dashboard overview, Alerts page and alert details.
Decline means the person cannot respond; it is not dismissal or cancellation.

| Action | Result visible to both sides |
| --- | --- |
| Family declines | SOS immediately needs the barangay secretary's attention, without waiting three minutes. |
| Secretary confirms | Family sees **Barangay secretary confirmed the response** with the time. |
| Secretary declines | Family receives an actionable SOS and sees that the secretary declined. |
| Family confirms | Secretary sees **Family confirmed the response** with the time. |
| Both decline | SOS remains actionable for both; the indicator says both declined and a response is still needed. |

The most recent shared decision appears as a notice outside the Alerts page.
The **SOS response updates** panel retains the latest 50 responses, including
confirmed alerts that have left the pending list. Each incident shows the latest
decision for each side and a Philippine timestamp. Existing confirmations also
receive an indicator from their saved status. The current staff role remains
the existing approved barangay/super-admin role; no new permission is introduced.

Realtime updates and the existing polling refresh synchronize both apps. When
Realtime is unavailable, family updates normally refresh within five seconds and
staff updates within ten seconds, subject to connectivity. In-app sounds announce
a new handoff once when browser audio is enabled; repeated watch packets do not
repeat that initial notification. This feature does not send SMS, email or OS push.
The response-history query runs separately so its failure cannot delay pending SOS
notifications. Failed response writes display an error and keep the alert active.

Responses are saved on the server with the authenticated actor, timestamp and a
monotonic response version. A device lock serializes responses against telemetry;
the advisory/link locks coordinate family revocation and deletion. Duplicate
decisions are idempotent. Once confirmed, a late decline cannot reopen an SOS.
Watch packets preserve the handoff metadata; a newly triggered watch SOS starts
with fresh responses after the prior confirmed signal has cleared. Manual family
SOS requests remain independent from watch-generated SOS incidents.

Only an approved linked family or approved staff with required MFA can respond.
The response-history RPC uses SECURITY INVOKER and the existing device/alert RLS.
Family responses cannot forge a staff role or an actor ID. Non-SOS battery and
geofence confirmations retain their existing behavior.

Validate with `node --test apps/shared/sosResponse.test.js`,
`node supabase/tests/sos_response_handoff.test.mjs`,
`node scripts/verify_sos_response_ui.mjs`, and both apps' production builds.
Component rendering checks labels and indicators; it does not verify browser
layout, hosted deployment, device delivery or background notifications.
