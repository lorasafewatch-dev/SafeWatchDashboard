# Remove watches and senior records

The family app has a **Manage watches** button above Home, Location, Health, and
Alerts. It opens the same **My seniors** controls available in Profile. **Remove
watch** asks for confirmation and unlinks only the current family's account.
The watch, senior profile, other families, and history stay available. The app
selects another linked senior, or shows the empty state after the last removal.
Adding the watch again requires barangay approval.

In the admin dashboard, open **Senior Monitoring → Delete senior**. The dialog
identifies the senior and full Watch ID, explains the permanent consequences,
and requires typing `DELETE`. Only approved staff with verified MFA and AAL2
can perform the server operation. Family accounts cannot delete global records.

Apply `supabase/migrations/20261030_senior_watch_removal.sql` after the 27 October
family approval and identity-hardening migrations, before publishing the admin
client. This repeatable migration creates the deletion function and permissions;
applying it does not delete any senior or watch.

The staff operation atomically deletes the selected watch registration, senior
profile, telemetry (including health and GPS history), alerts, family links, and
access requests. Unrelated watches and accounts are retained. A minimal audit
entry records the actor and deleted Watch ID without copying the senior's name
or readings. Direct client DELETE on devices is revoked so removal cannot bypass
this cleanup. Approval and deletion use the same per-watch transaction lock.
Old requests cannot restore a deleted profile. Physical firmware is unchanged;
the watch must be registered again to resume monitoring.

Validation: shared helper tests, SQL approval/identity/removal regressions,
production builds of both apps, and synthetic browser checks. Tests do not
remove real seniors or modify real family links.
