-- Follow-up for projects that ran the notification fix before the explicit
-- anon revocation was added. Signed-in family/Barangay access is preserved.
BEGIN;
REVOKE ALL ON FUNCTION public.acknowledge_alert_incident(BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_family_sos(UUID) FROM PUBLIC, anon;
NOTIFY pgrst, 'reload schema';
COMMIT;
