-- Run after 20261009_alert_incidents.sql. No tables or history are deleted.
BEGIN;

CREATE OR REPLACE FUNCTION public.acknowledge_alert_incident(p_alert_id BIGINT, p_role TEXT DEFAULT 'family')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions
AS $$
DECLARE
    target public.alerts;
BEGIN
    IF p_role IS NULL OR p_role NOT IN ('family', 'barangay') THEN
        RAISE EXCEPTION 'Invalid confirmation role';
    END IF;
    SELECT * INTO target FROM public.alerts WHERE id = p_alert_id;
    IF NOT FOUND OR target.alert_type NOT IN ('GEOFENCE', 'SOS') THEN RETURN false; END IF;
    -- Use the same watch lock as the telemetry trigger: confirmation and an
    -- arriving packet cannot race to change the incident's status.
    PERFORM 1 FROM public.devices WHERE id = target.device_id FOR UPDATE;
    SELECT * INTO target FROM public.alerts WHERE id = p_alert_id FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    -- A second click, retry, or another signed-in client is already satisfied.
    IF target.details->>'status' IN ('ACKNOWLEDGED_FAMILY', 'ACKNOWLEDGED_BHW') THEN RETURN true; END IF;
    IF COALESCE(target.details->>'status', 'PENDING_FAMILY') NOT IN ('PENDING_FAMILY', 'ESCALATED_BHW')
        OR target.details->>'incident_open' = 'false' THEN RETURN false; END IF;
    UPDATE public.alerts SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
        'status', CASE WHEN p_role = 'family' THEN 'ACKNOWLEDGED_FAMILY' ELSE 'ACKNOWLEDGED_BHW' END,
        'acknowledged_at', NOW(),
        'incident_open', COALESCE(details->>'source', '') <> 'family_app')
    WHERE id = target.id
      AND COALESCE(details->>'status', 'PENDING_FAMILY') IN ('PENDING_FAMILY', 'ESCALATED_BHW');
    RETURN FOUND;
END;
$$;

-- Keep the existing authenticated, shared-device access model and RLS enabled.
-- Family-origin SOS writes are limited to pending SOS rows with that source.
DROP POLICY IF EXISTS "Authenticated users request family SOS" ON public.alerts;
CREATE POLICY "Authenticated users request family SOS" ON public.alerts
    FOR INSERT TO authenticated
    WITH CHECK (alert_type = 'SOS' AND details->>'source' = 'family_app'
        AND details->>'status' = 'PENDING_FAMILY'
        AND details->>'incident_open' IS NULL);
GRANT INSERT ON public.alerts TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.alerts_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.request_family_sos(p_device_id UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions
AS $$
DECLARE
    alert_id BIGINT;
    observed_at TIMESTAMPTZ := NOW();
BEGIN
    PERFORM 1 FROM public.devices WHERE id = p_device_id AND patient_name <> '[HIDDEN]' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No accessible watch is connected'; END IF;
    SELECT id INTO alert_id FROM public.alerts
    WHERE device_id = p_device_id AND alert_type = 'SOS' AND details->>'source' = 'family_app'
      AND COALESCE(details->>'status', 'PENDING_FAMILY') IN ('PENDING_FAMILY', 'ESCALATED_BHW')
    ORDER BY created_at, id LIMIT 1;
    IF FOUND THEN RETURN alert_id; END IF;
    INSERT INTO public.alerts(device_id, alert_type, details)
    VALUES (p_device_id, 'SOS', jsonb_build_object('source', 'family_app', 'status', 'PENDING_FAMILY',
        'first_seen_at', observed_at, 'last_seen_at', observed_at, 'update_count', 1))
    RETURNING id INTO alert_id;
    RETURN alert_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_alert_incident(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_alert_incident(BIGINT, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_family_sos(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_family_sos(UUID) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
