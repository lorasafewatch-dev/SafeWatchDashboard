# Login, recovery and barangay approval

**Privacy terms update (29 October 2026):** Both apps now show terms at sign-up
and first login. Follow [Terms and privacy pop-ups](PRIVACY_TERMS.md) and apply
`20261029_privacy_terms.sql` after the security migrations before deploying the
updated clients. Existing accounts review the notice at their next visit.

**Current security update (27 October 2026):** Follow
[Security hardening](SECURITY_HARDENING.md) for the latest migrations and rollout.
Families now request barangay approval for each additional watch, staff require
authenticator enrollment/AAL2, and automatic reserved-email administrator signup
is disabled. Existing family links and the ability to monitor multiple seniors
are preserved. The older first-admin and direct-linking descriptions below refer
to the October 13 baseline, not the current rollout.

The family app runs at `http://localhost:5173`; the barangay dashboard runs at
`http://localhost:5174`. Both offer login, signup and password recovery. Accounts
belong to one app and need different email addresses when a person uses both.
Signing into the other app displays an explanation and stops protected data
polling. Auth success alone does not grant dashboard access.

## Existing database setup

1. Run the complete `supabase/migrations/20261013_account_access.sql` in the
   Supabase SQL Editor, after the notification and family-senior migrations.
   This additive migration can be rerun. Do not run the clean-slate
   `supabase/setup.sql` against the existing live database.
   If an earlier copy of account_access.sql was applied, run
   `supabase/migrations/20261013_gateway_access_guard.sql` for its final anonymous
   access guards. These guards are also included in the current main migration.
2. If the earlier version was installed, run
   `supabase/migrations/20261013_automatic_super_admin.sql` once. It installs
   automatic first-admin signup and also handles a reserved dashboard account
   that is already registered. The current main migration includes this update.
3. In **Authentication → URL Configuration**, set **Site URL** to the single
   value `http://localhost:5173` and save it. Add these separately under
   **Redirect URLs**: `http://localhost:5173/**` and `http://localhost:5174/**`.
   Each app supplies its own return address for signup and password reset.
4. Register `lorasafewatch@gmail.com` through the dashboard's **Create an
   account** form. Enter the password yourself. Confirm its email if the
   project requires confirmation. The database assigns it the initial super-admin
   role automatically, once. Open **Settings → Barangay account access** to
   approve later staff signups. No separate initializer is needed. For an account
   that was already signed in before the update, click **Check access again**.
5. To verify actual email delivery, use **Forgot password?** on each app with
   an account belonging to it. Open the newest inbox link on the computer
   running these localhost apps and complete the reset yourself. Email
   templates must preserve Supabase's verification link and the requested
   return address. Production deployments need their actual URLs configured.
   In **Authentication → Email Templates → Reset Password**, replace the body
   with `supabase/templates/reset_password.html` and save. Its button opens the
   requesting app directly and provides a 6-digit alternative reset code.

The public Auth settings checked on October 13 had email login and signup
enabled, with email autoconfirm enabled. At the user's request, the first
dashboard signup matching the reserved address initializes the super-admin
role. The trigger still respects confirmed-email requirements when using the
account. SMTP configuration and real inbox delivery cannot be verified using
the public project key.

## Permissions and handover

New family accounts receive the family role; new dashboard accounts receive a
pending barangay role, except the one-time designated initial super admin.
Approved super admins can approve, reject or suspend
dashboard requests. Approval requires a confirmed email. Existing accounts with
trusted Auth app roles `barangay`, `bhw` or `admin` retain staff access when first
migrated. Other existing accounts become family accounts unless their original
signup requested the dashboard, in which case they wait for approval.

The `safewatch_account_access` table is authoritative. Later email/name/metadata
edits cannot change the account type, approve access or elevate a role. Clients
can read their own permission record but cannot write it. Permission operations
derive their actor from `auth.uid()` and require the current super admin. Audit
records retain the approval and transfer actions.

Only an approved barangay account with a confirmed email can receive a
transferred super-admin role. A transfer is atomic and keeps exactly one approved super
admin. The previous super admin keeps staff access and loses approval/transfer
controls. Re-signup with the original email, migration reapplication and the
legacy bootstrap command cannot reclaim the role after handover. The UI
refreshes access every 15 seconds; backend restrictions take effect immediately,
including requests using an existing token. **Check access again** refreshes a
pending account immediately.

Protected devices, telemetry, alerts and senior links require approved account
access and AAL2 if a verified MFA factor exists. Families read only linked-watch
telemetry and alert history and cannot use barangay confirmation actions or
update global watch records. Linked family confirmation and SOS remain available
through guarded server functions. Barangay accounts cannot create family links.
Anonymous clients cannot read these records or update/delete them. Gateway
telemetry inserts and its zero-row schema probe remain supported; anonymous
telemetry ingestion still uses the existing gateway credential model and is
not device-specific authentication.

## Password recovery behavior

Reset requests show a generic response and a resend cooldown. API errors retain
the form and do not display success. A verified SDK `PASSWORD_RECOVERY` session
opens the new-password form before any business view. Its short-lived recovery
marker is bound to the user and session, survives SDK session restoration, and
stores no password or token. A URL flag alone cannot authorize a reset.

The custom reset email sends the token hash in the app URL fragment, so it is
not sent to the local web server. **Continue password reset** explicitly verifies
it through Supabase's `verifyOtp` API with recovery type. Email scanners do not
consume the token simply by loading the page. **Enter reset code** verifies the
email and the newest 6-digit recovery code through the same API. Neither path
grants recovery proof before Supabase returns a matching user/session. Codes,
token hashes and new passwords are not written to application logs or storage.
Temporary gateway failures preserve the confirmation/code form for retry;
expired tokens ask for a new email. Existing default Supabase recovery links
remain supported.

Matching new/confirmation passwords are validated, saved through Supabase Auth,
and checked against the returned user. Existing MFA must be satisfied. Success
stays on the reset screen until **Return to login**, which signs out sessions.
Invalid, expired and used links show a useful recovery error. Normal password
sign-in clears old recovery state.

## Verification and live status

72 shared helper tests and the watch GPS display check pass. The actual SQL
migrations pass 9 account-access, 6 automatic-first-admin and 6 senior-management
scenarios.
Both apps build for production. Browser tests use the actual apps with synthetic
Auth and database responses: wrong/correct login, cross-app denial, pending and
rejected/suspended accounts, reset request failures/retries, new-password
validation/save/new login, dashboard signup, canceled/failed/successful approval,
and failed/successful handover. A separate first-admin fixture verifies ordinary
signup becoming super admin, a later signup waiting, and its subsequent approval.
No real passwords, roles or approvals were changed
by the agent.
Direct callback browser testing also covers a simulated 502, successful retry,
super-admin password change, new-password sign-in with role intact, and invalid
and valid reset-code entry in the family app.

The operator reported successful migration execution. A live read-only probe
confirmed that the permission RPC now exists and rejects anonymous execution
(`42501`), and the live family app displays its login view. A follow-up found
legacy anonymous watch reads still enabled. The operator reported applying the
final gateway guard and explicit RLS activation, but subsequent probes still
returned a watch ID to an anonymous request. The live table/policy configuration
needs investigation using `supabase/check_live_access.sql`. Telemetry and alerts
returned zero anonymous rows. The earlier manual initial bootstrap
reported that `lorasafewatch@gmail.com` must first be registered and confirmed
through dashboard signup. This workflow has now been replaced by automatic
signup. The automatic-signup SQL update, real initial account creation and
redirect saving require operator completion. Local tests do not establish live
email delivery or a live approved account.

The user reported a `Bad Gateway` response on the Supabase-hosted reset-email
verification page. Read-only Auth health/settings probes returned HTTP 200; an
intentionally invalid diagnostic token returned HTTP 403. No real reset token
was inspected or consumed. The custom email template is prepared and needs to
be saved in the live project before requesting a fresh email. Real password
entry and the final reset must be completed by the account owner.

References: [Redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls),
[Password reset requests](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
