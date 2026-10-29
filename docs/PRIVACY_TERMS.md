# SafeWatch terms and privacy pop-ups

Both apps show the same Terms and Conditions and Privacy Notice, version
`2026-10-29`. The complete text is archived in [the notice](PRIVACY_NOTICE_2026-10-29.md)
and rendered from `apps/shared/privacyTerms.js`.

## Behavior

- Opening **Create an account** immediately shows the sign-up pop-up. Two
  unchecked boxes record agreement to the terms/acknowledgment of the notice and
  specific consent for the user's own account/profile data. Decline or Escape
  returns to login. Registration cannot submit without both declarations.
- The first authenticated visit shows the notice again, including for existing
  accounts without a receipt. An automatic sign-in after signup counts as this
  first visit; email-confirmation signup reaches it after confirmation/login.
- First-login acceptance is saved in the database for the account, app and notice
  version, so subsequent logins, refreshes and other devices do not prompt again.
  A different account still needs its own acceptance. Sign-up acceptance alone
  cannot skip the first-login step.
- Declining first-login terms signs out locally and does not grant protected
  access. A failed save/check leaves the gate in place with a retry option.
  Password recovery remains available without accepting the notice. Cross-app
  accounts still get the usual access explanation.
- Approval, confirmed email and staff MFA remain required after acceptance.
  Account metadata edits cannot create a first-login receipt or grant access.
- The login screen includes **Terms and Conditions & Privacy Notice** for reading
  without accepting or creating an account.

## Apply to the existing system

1. Back up the database using the operator's normal process, then apply
   `supabase/migrations/20261029_privacy_terms.sql` in Supabase SQL Editor after
   `20261027_identity_hardening.sql`. It is additive, repeatable and preserves
   existing users, roles, links and records. It does not pre-accept for anyone.
2. Set `VITE_PRIVACY_CONTROLLER` to the actual controller's legal name and address,
   `VITE_PRIVACY_CONTACT` to the actual privacy/DPO contact and request channel,
   and `VITE_PRIVACY_RETENTION` to the approved periods for account data, senior
   records, health/location history, alerts, logs, acceptance receipts and backups.
   These are public build-time values; set identical values in both applications.
3. Review the completed notice with the program's responsible privacy officer,
   archive the rendered text including those values, then build/deploy both apps
   together with the database update. No live migration or deployment is performed
   merely by editing these files. Old clients cannot satisfy the new database
   gate, so coordinate rollout and refresh existing clients.

Without the migration, authenticated users see an administrator-configuration
message and cannot enter protected screens. The migration adds private acceptance
receipts and authenticated read/accept RPCs, and extends the existing protected
data access predicate to require a first-login receipt. Gateway ingestion remains
governed by its separate gateway authentication.

Receipts contain account ID, app, version, stage, both declarations and a server
timestamp. They contain no password, token, location or IP address. Direct client
inserts, updates and deletes are denied; users can read only their own receipts.
Repeated acceptance preserves the original timestamp. Account deletion cascades
to receipts, so this behavior must be considered in the retention schedule.

## Privacy scope and operator details

The draft is tailored to SafeWatch and informed by RA 10173, especially Sections
11–14, 16–18 and 20–21, and the NPC's implementing rules and rights guidance.
A pop-up alone does not establish organizational compliance. The actual
controller identity/contact, specific retention schedule, processor arrangements,
cross-border hosting details and operational handling of privacy requests must
match the deployed program. The default wording directs users to their enrolling
barangay health office; it does not invent a DPO email or fixed retention period.
Complete these details before using the draft as a final production notice.

Account consent is **not** a senior's consent to health/location monitoring.
Obtain and retain purpose-specific consent from the senior or a legally
authorized representative before enrollment, unless a documented applicable
legal exception applies. This change does not add a senior-consent registry,
automatic retention cleanup, or an in-app withdrawal/deletion workflow. The
notice directs those requests to the operator; signing out does not withdraw
consent. The operator must handle them through its actual privacy process.

Keep each published notice and its completed configuration. For material changes,
publish a new version, update both the JavaScript constant and database version
checks through a new migration, and retain old receipts and notices under the
approved schedule. Never change the meaning of an already published version.

Sources:

- [RA 10173, National Privacy Commission](https://privacy.gov.ph/data-privacy-act/)
- [Implementing Rules and Regulations, NPC](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/)
- [Data subject rights, NPC](https://privacy.gov.ph/data-subject-rights/)
