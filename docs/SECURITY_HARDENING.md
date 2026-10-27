# SafeWatch security update — 27 October 2026

## Live rollout status

Both existing Vercel apps are published. The family approval and identity
hardening migrations are applied to the live database. Email confirmation is
enabled; production confirmation/recovery redirects are saved; TOTP is enabled.
Live checks retained two watches, two existing family links and one approved
administrator. Staff must enroll their own authenticator at their next sign-in.
Real email delivery and account-owner enrollment still need an owner check.

The gateway/radio migration is **not applied**, and no device has been flashed.
Until the coordinated hardware cutover below, the old public-key telemetry
insertion path and legacy radio protections remain in service. The web changes
do not close that separate device-ingestion vulnerability.

The final deployment commits, full dependency audit results, test coverage and
remaining operator steps are recorded in `outputs/security-fixes/ROLLOUT_STATUS.md`.

## Multiple seniors remain supported

One family account can monitor multiple seniors. There is no one-senior limit.
The database retains the composite `(user_id, device_id)` relationship and all
existing links. The existing selector still switches the active senior.

In **Profile → My seniors → Add senior**, a family can enter a registered Watch ID
or submit a new senior's details. Both paths create a pending request. They do
not reveal a global directory or grant access to another person's health data.

Approved barangay staff use **Settings → Family watch access** to verify the
physical watch and relationship, then approve/reject. Approval adds that senior
without replacing the family's other seniors. Requests may be canceled by their
applicant. Rejected/revoked/removed relationships need fresh approval to be added
again. Staff can review/revoke a particular current link without deleting the
watch, history, other families' access or the family's other seniors.

Existing links are retained for continuity, not retroactively proven legitimate.
Staff should review them through **Current family links**.

## App/database rollout

Use the existing database; do not run the destructive clean-slate `setup.sql` on it.

1. Apply `supabase/migrations/20261027_family_access_approval.sql`. This is additive,
   repeatable and preserves existing devices, histories, account roles and links.
   It restricts family device reads, blocks direct family-link INSERT and turns
   legacy link/register functions into approval requests. Updated clients use
   new RPC names so they fail closed against an unpatched database.
2. Deploy both current frontend packages. They include staff review/revocation,
   multiple-senior selection, local avatars, safe DOM map markers, a staff
   authenticator enrollment gate, CSP/frame protections, cache cleanup on sign-out,
   and the family splash screen. No privileged key belongs in browser variables.
3. After the new staff enrollment screen is available, apply
   `supabase/migrations/20261027_identity_hardening.sql`. All barangay/super-admin
   data access then requires an enrolled verified factor and an AAL2 session.
   Existing roles are preserved. Automatic reserved-email admin promotion is
   disabled; first-admin provisioning requires a trusted database operator.
4. Enable **Confirm email** in Supabase Authentication → Sign In / Providers.
   Existing accounts created with autoconfirm are not retroactively verified.
   Verify ownership of existing privileged accounts and test real email delivery
   with the account owner. Do not substitute UI validation for server settings.
5. Verify anonymous requests return no records; test two independent families;
   confirm staff approval/revocation; enroll staff MFA and verify sign-in; test
   recovery email redirects with the account owner. Never enroll a real user's
   authenticator or set their password on their behalf.

The migrations create no new users, approve no actual access requests and remove
no existing relationships automatically. Approval/revocation operations are audited.
Database migrations are not applied automatically by a Vercel frontend build.

## Gateway/radio cutover is a separate maintenance step

The prepared firmware and `20261027_authenticated_gateway.sql` must be installed
as one coordinated update. Applying that SQL immediately blocks raw public-key
telemetry inserts; old gateway firmware then cannot upload. Keep the current
gateway running until the devices and operator are ready for the cutover.

The new ingestion RPC requires a separate revocable gateway token, checks its
watch allowlist, validates health/GPS/types/time, rate-limits valid submissions,
and rejects replayed gateway sequences through a private receipt ledger. Tokens
are stored hashed in a private database schema. Browser keys alone cannot insert.
Server timestamps and gateway identities cannot be supplied by an unrelated client.

The new gateway verifies HTTPS certificates using the ESP32 root-certificate
bundle and waits for time synchronization. It accepts only Supabase HTTPS cloud
endpoints and never falls back to an unauthenticated INSERT. Its Wi-Fi setup AP
has a random password displayed on its OLED; its private token is not prefilled
into the portal page or printed to serial logs.

The new watch/gateway radio format uses per-watch AES-256-GCM keys. GPS/health
payloads are encrypted; routing identifiers remain visible. Durable watch boot
counters plus sequence numbers prevent nonce reuse. The gateway commits replay
state before queuing a received sample, rejecting duplicates and older boots
even after a gateway restart. Unprovisioned devices and legacy plaintext frames
are rejected. Each gateway currently has 32 radio-key slots; this is separate
from the family account's number of approved seniors.

### Operator procedure

1. Keep a recoverable copy of the existing firmware and confirm a maintenance
   window. Close serial monitors. Verify the physical Watch IDs/USB ports.
2. Apply `20261027_authenticated_gateway.sql` when ready to change the gateway.
3. As a trusted SQL operator, call the following with the gateway MAC shown in
   its boot log and the complete registered Watch IDs assigned to it:

   ```sql
   SELECT public.provision_safewatch_gateway(
     'GATEWAY_MAC', ARRAY['REGISTERED_WATCH_UUID']::uuid[]
   );
   ```

   The returned token is private. Enter it yourself into the gateway's setup
   portal. Do not put it in a browser app, a Git repository or a support log.
   Repeating provisioning rotates the token and replaces the gateway allowlist;
   include every watch that gateway should receive.
4. Flash the matching gateway and smartwatch builds using their PlatformIO
   projects/board definitions. Do not use a generic firmware offset or erase NVS.
5. Pair each physical watch over local USB using Python with `pyserial` installed:

   ```text
   python hardware/tools/provision_radio.py --watch-port WATCH_PORT --gateway-port GATEWAY_PORT --watch-id WATCH_UUID
   ```

   Replace the three placeholders with verified values. The script checks the
   watch's identity, generates a fresh random key and writes it to both devices
   without logging it. The watch restarts. Retry pairing if interrupted; do not
   reuse a key after manually erasing radio NVS. A missing/invalid key stops
   radio uploads rather than sending plaintext.
6. Verify `AES_GCM_READY`, authenticated gateway receipt/HTTP success, timestamps,
   health/GPS updates for every assigned senior, SOS behavior, display timeout,
   reconnection, duplicate rejection and a controlled gateway restart. Firmware
   builds and host tests do not substitute for this physical end-to-end check.

The crypto self-test checks a public AES-GCM known-answer vector and a corrupted
tag at boot. Provisioning uses local USB only; physical possession of a device
remains a security boundary. These changes do not enable irreversible ESP32
secure-boot/eFuse protections or claim to solve all physical/BLE attack vectors.

## Validation

Security SQL tests cover direct API attempts, isolation before approval, multiple
approved seniors, new registration, sharing, cancellation, revocation, unchanged
senior records, existing-role preservation, mandatory staff MFA, gateway tokens,
watch assignment, replay/rate limits and payload validation. Browser regression
tests use synthetic users through the actual app and approval component.

Both app dependency graphs use patched Vite/PostCSS/nanoid/source-map-js versions.
Compatible transitive build-tool patches also address the additional findings
in the complete dependency audit; both full audits report zero vulnerabilities.
Development servers bind to localhost by default. Test fixtures, local `.env`,
dependency directories, credentials and logs are excluded from deployment packages.

Local evidence and rollout status are in `outputs/security-fixes/`. The earlier
`outputs/security-review/SECURITY_REVIEW.md` documents the findings before fixes.
