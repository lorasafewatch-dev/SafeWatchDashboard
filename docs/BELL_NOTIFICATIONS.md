# Bell notifications

Both apps' header bells open a notification panel containing pending watch alerts
and saved SOS responses. A red number counts unread items, including confirmations
that arrive after the active SOS disappears. Active SOS alerts have priority.
The same incident in the active query and response feed appears once; a newer
saved confirmation takes precedence over an older pending snapshot.

Click a notification to mark it read and open its alert or shared SOS response.
Use **Mark all as read** to clear unread indicators, **Refresh** to retry queries,
or **View all alerts and responses** to open the complete Alerts page. Reading
a notification does not confirm, decline, resolve or silence an active SOS.
Confirm and Decline remain explicit actions on the alert itself.

New response versions become unread even if an earlier handoff was already read.
Repeated telemetry does not keep increasing the badge. A person's own saved
response remains visible without notifying that same account as unread. Notifications
refresh through the apps' existing Realtime subscriptions and polling. Connection
errors have a retry state, and pending-alert reads have a ten-second timeout without
overlapping polls. A slow SOS-response-history query does not delay active alerts.

Read identifiers persist per account, app and browser. Only opaque incident/version
identifiers are stored; notification text and senior names are not cached. Sign-out
clears these identifiers. Read state synchronizes between tabs on the same browser;
it is not synchronized across different devices. Keyboard users can open the panel,
cycle through controls, and close it with Escape. The panel is rendered in a portal
to avoid map layers or scrolling containers clipping it on small screens.

This UI change needs no additional SQL. Saved SOS response notifications require
the existing `20261103_sos_response_handoff.sql` migration from the prior change.
Deploy both updated web apps to make the bell work on the hosted versions. This
does not add background push, SMS or email notifications.

Validate with the shared JavaScript tests, `node scripts/verify_sos_response_ui.mjs`,
and both production builds. `/tests/bell-notification-preview.html` in the family
Vite development server provides synthetic interaction controls. Component rendering
checks markup and state labels; it is not a visual browser layout check.

Local verification passes: 126 JavaScript tests, component-render checks, and
both production builds. The SOS database suite also checks the actual response
feed through the bell notification mapper: family/secretary decisions become
unread for the recipient, own decisions remain read, and reading a notification
leaves the database incident status unchanged. Hosted deployment and visual
browser interactions are not established by these checks.
