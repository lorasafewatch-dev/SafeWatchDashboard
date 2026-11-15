# PDF feature review - 15 November 2026

Reviewed both pages and screenshots of `SAFEWATCH_FEATURESTOBEADDED.pdf` against
the current family and barangay apps.

| Request | Applied behavior |
| --- | --- |
| Notify the barangay when family cannot rescue the senior | The family SOS popup and pending Alerts card show **Can’t respond — notify barangay**. The existing `respond_to_sos` RPC records the decline and immediately routes the incident to the barangay secretary/admin. A saved decline shows **Barangay already notified**; SOS remains open until a response is confirmed. |
| Return from a custom safe zone to San Isidro | Location's Safe zone card shows a full-width **Restore San Isidro East** button for a saved family zone. An inline confirmation clears the custom circle through the existing save RPC. Cancel and failed saves preserve the custom zone. This restores the default barangay boundary, not an older custom circle. |
| Replace support email and phone with real contacts | Help & Support uses the contacts supplied by the operator: **lorasafewatch@gmail.com** and **09260557361**. The email and **Send us a Message** links open `mailto:lorasafewatch@gmail.com`; the call link uses `tel:+639260557361`. No email or call is sent automatically. |

Contact values are centralized in
`apps/dashboard-admin/src/components/HelpSupport.jsx`. The operator supplied
these as the replacements; the application does not claim independent mailbox
or phone ownership verification. Removed the old sample phone number and
unconfirmed office hours.

## Existing database requirements

These changes reuse the existing safe-zone and SOS implementations. No new
database migration is introduced. Deploy both apps after ensuring the existing
`20261101_family_safe_zones.sql` and `20261103_sos_response_handoff.sql` migrations
and their prerequisites are installed, as described in
[Family safe zones](FAMILY_SAFE_ZONES.md) and
[Shared SOS response and handoff](SOS_RESPONSE_HANDOFF.md).

Notification means the existing in-app barangay alerts, bell, polling/realtime,
and enabled alert sounds. This feature does not send SMS or email. Confirmed SOS
history is retained as a receipt and cannot be used to reopen a confirmed SOS.

## Verification

- Shared SOS and safe-zone JavaScript tests.
- Local PGlite/PostGIS tests of the actual migrations and access controls.
- Real component rendering, including the supplied support link destinations.
- Family and barangay production builds.
- Synthetic browser preview: `/tests/feature-update-preview.html` in the family
  development server. It uses the actual UI components and client helpers with
  in-memory RPC responses, without production accounts or writes.

Results on 15 November 2026: **129 JavaScript tests passed** after preserving the
repositories' existing activity-history changes. Both database test
scripts passed, component-render checks passed, and both production builds passed.
Builds retain the existing warning for JavaScript chunks larger than 500 kB.
Browser checks confirmed the pending-list and popup handoff actions, the saved
handoff receipt and immediate barangay attention, cancellation of a reset,
preservation of the custom zone after a failed reset, successful retry restoring
San Isidro East, and the actual dashboard's contact link destinations. Both
preview pages had no browser console errors during these checks.

Support-page preview: `output/feature-review/support-contacts.jpg`.

Local verification does not deploy the apps, apply production database
migrations, send notifications to real staff, or verify contact ownership.
