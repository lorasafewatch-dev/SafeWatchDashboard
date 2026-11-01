# Family safe zones

In the Family App, open **Location → Safe zone → Add safe zone**, or use the
**Safe zone** shortcut on Home. Choose a linked senior, name the zone, tap the map
to set its center, and enter a radius from **50 to 5,000 meters**. The marker can
also be dragged; coordinates support keyboard entry. **Use watch location** uses
the watch's last recorded GPS position, whose detection time is displayed.
Choosing a center works before the watch has its first GPS fix.

Each watch has one active family zone. Saving it replaces that watch's default
San Isidro East boundary. All approved families linked to that watch see the same
zone. Other watches keep their own settings. **Edit safe zone** changes a zone;
**Use default boundary** restores San Isidro East after an inline confirmation.
Canceling an edit does not save it. Failed saves retain the draft. A concurrent
change by another family requires canceling and reopening the refreshed editor.

The saved zone appears in the Home preview, Location map, and location status.
The barangay dashboard uses the same per-watch inside/outside calculation and
shows family circles on its overview and live maps. Changing a zone resolves
open geofence incidents from the previous setting without deleting their history
or affecting SOS. The next valid, fresh GPS packet evaluates the new zone and
starts a new incident if necessary. No-fix and stale packets do not clear or
create a geofence incident. Existing response and escalation behavior is retained.

## Activate on the existing system

1. Apply `supabase/migrations/20261101_family_safe_zones.sql` to the existing
   Supabase project after the family-approval, identity-hardening and senior-removal
   migrations. It adds a nullable `devices.family_safe_zone` setting, validates
   circles, creates the linked-family save RPC and updates `check_geofence()`.
   Existing watches, family links and histories are preserved. Applying it is
   repeatable. Do not rerun `setup.sql` against an existing database.
2. Deploy the updated Family App and barangay dashboard together so both show
   the saved zone consistently. Run this migration last if also applying older
   alert/boundary SQL files: those older scripts replace `check_geofence()`.
3. Sign in as a linked family, save a zone for a test watch, reopen the app and
   verify the saved circle. Verify an actual fresh GPS packet inside and outside
   the circle, the family response window and any resulting barangay escalation.

The endpoint checks the current approved family account and its watch link on
every write. It locks the watch and compares the previously loaded configuration
before saving, preventing an older form from overwriting another family's edit.
Changes are recorded in the existing access audit. Direct device updates remain
restricted to staff; no broader family device permissions are granted.

Until the migration is installed, existing devices still load with the default
boundary and attempts to save show a setup message rather than false success.

## Verification

```
node --test apps/shared/*.test.js
node supabase/tests/family_safe_zones.test.mjs
```

The SQL test uses the existing local PGlite/PostGIS packages under
`.tools/alert-tests/node_modules` and the real account, approval and geofence
migrations. It has no network or production writes. Browser QA uses
`apps/family-app/tests/nature-preview.html?controls` against synthetic watch data,
with controls for no GPS, save failure and concurrent family edits. Its saved
zones live only in the synthetic preview's local storage.
