-- Additive migration: preserves telemetry, alerts, device IDs and alert history.
-- Run after the 20261006 migrations. Never run setup.sql on an existing database.
BEGIN;
-- Pause writes in the same table order as telemetry processing while legacy
-- rows are consolidated. No old trigger may insert duplicates during rollout.
LOCK TABLE public.telemetry, public.devices, public.alerts IN SHARE ROW EXCLUSIVE MODE;

-- Consolidate existing unconfirmed packet alerts without deleting their history.
-- Confirmed legacy geofences remain confirmed while the person is outside.
DO $$
DECLARE
    incident RECORD;
    root_id BIGINT;
BEGIN
    FOR incident IN
        SELECT a.device_id, a.alert_type, MIN(a.created_at) AS started,
               MAX(COALESCE((a.details->>'last_seen_at')::timestamptz, a.created_at)) AS last_seen,
               SUM(COALESCE((a.details->>'update_count')::bigint, 1)) AS update_count
        FROM public.alerts a
        WHERE a.alert_type IN ('GEOFENCE', 'SOS')
          AND COALESCE(a.details->>'source', '') <> 'family_app'
          AND (COALESCE(a.details->>'status', 'PENDING_FAMILY') IN ('PENDING_FAMILY', 'ESCALATED_BHW')
               OR a.details->>'incident_open' = 'true')
          AND COALESCE(a.details->>'incident_open', 'true') = 'true'
          AND a.created_at > COALESCE((
              SELECT MAX(w.created_at) FROM public.alerts w
              WHERE w.device_id = a.device_id
                AND (w.alert_type = 'RESOLVE_ALL'
                     OR (w.alert_type = 'RESOLVE_GEOFENCE' AND a.alert_type = 'GEOFENCE'))
          ), '-infinity'::timestamptz)
        GROUP BY a.device_id, a.alert_type
    LOOP
        SELECT id INTO root_id FROM public.alerts
        WHERE device_id = incident.device_id AND alert_type = incident.alert_type
          AND created_at >= incident.started
          AND COALESCE(details->>'source', '') <> 'family_app'
          AND (COALESCE(details->>'status', 'PENDING_FAMILY') IN ('PENDING_FAMILY', 'ESCALATED_BHW')
               OR details->>'incident_open' = 'true')
          AND COALESCE(details->>'incident_open', 'true') = 'true'
        ORDER BY created_at, id LIMIT 1;

        UPDATE public.alerts
        SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
            'status', 'MERGED', 'incident_open', false, 'merged_into', root_id)
        WHERE device_id = incident.device_id AND alert_type = incident.alert_type
          AND id <> root_id AND created_at >= incident.started
          AND COALESCE(details->>'source', '') <> 'family_app'
          AND (COALESCE(details->>'status', 'PENDING_FAMILY') IN ('PENDING_FAMILY', 'ESCALATED_BHW')
               OR details->>'incident_open' = 'true');

        UPDATE public.alerts a
        SET details = COALESCE(a.details, '{}'::jsonb) || jsonb_build_object(
            'incident_open', true, 'first_seen_at', incident.started,
            'last_seen_at', incident.last_seen, 'update_count', incident.update_count,
            'status', CASE
                WHEN a.details->>'status' LIKE 'ACKNOWLEDGED_%' THEN a.details->>'status'
                WHEN incident.alert_type = 'GEOFENCE' AND EXISTS (
                    SELECT 1 FROM public.devices d WHERE d.id = incident.device_id
                      AND d.device_name LIKE '%[MUTED]%'
                ) THEN 'ACKNOWLEDGED_FAMILY'
                WHEN incident.started <= NOW() - INTERVAL '3 minutes' THEN 'ESCALATED_BHW'
                ELSE 'PENDING_FAMILY' END)
        WHERE a.id = root_id;
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_open_incident
    ON public.alerts (device_id, alert_type)
    WHERE details->>'incident_open' = 'true';

CREATE OR REPLACE FUNCTION public.check_geofence()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    boundary GEOMETRY;
    valid_fix BOOLEAN;
    is_inside BOOLEAN;
    row_json JSONB := to_jsonb(NEW);
    observed_at TIMESTAMPTZ := COALESCE(NEW.created_at, NOW());
    muted BOOLEAN;
BEGIN
    -- Serialize processing for each watch, including concurrent gateway posts.
    SELECT device_name LIKE '%[MUTED]%' INTO muted
    FROM public.devices WHERE id = NEW.device_id FOR UPDATE;

    -- Same polygon as apps/shared/safeZone.js (the existing admin map boundary).
    boundary := ST_GeomFromText('POLYGON((121.118 14.0435,121.123 14.044,121.126 14.043,121.1285 14.0415,121.1305 14.0385,121.131 14.035,121.130 14.033,121.128 14.0325,121.125 14.032,121.122 14.0325,121.119 14.0315,121.1175 14.035,121.118 14.039,121.118 14.0435))', 4326);
    valid_fix := NEW.location IS NOT NULL
        AND NOT ST_Equals(NEW.location::geometry, ST_SetSRID(ST_MakePoint(0, 0), 4326));

    -- Unknown/stale instrumented GPS data must neither breach nor clear a zone.
    IF row_json->>'rx_uptime_ms' IS NOT NULL THEN
        valid_fix := valid_fix AND row_json->>'received_at' IS NOT NULL
            AND (row_json->>'received_at')::timestamptz >= NOW() - INTERVAL '45 seconds'
            AND (row_json->>'received_at')::timestamptz <= NOW() + INTERVAL '5 seconds';
    END IF;

    IF valid_fix THEN
        is_inside := ST_Covers(boundary, NEW.location::geometry);
        IF is_inside THEN
            UPDATE public.alerts SET details = COALESCE(details, '{}'::jsonb)
                || jsonb_build_object('status', 'RESOLVED', 'incident_open', false, 'resolved_at', observed_at)
            WHERE device_id = NEW.device_id AND alert_type = 'GEOFENCE'
              AND details->>'incident_open' = 'true';
            -- Backward compatibility for confirmations from the old app.
            IF muted THEN
                UPDATE public.devices SET device_name = btrim(replace(device_name, '[MUTED]', ''))
                WHERE id = NEW.device_id;
            END IF;
        ELSE
            INSERT INTO public.alerts (device_id, alert_type, created_at, details)
            VALUES (NEW.device_id, 'GEOFENCE', observed_at, jsonb_build_object(
                'status', CASE WHEN muted THEN 'ACKNOWLEDGED_FAMILY' ELSE 'PENDING_FAMILY' END,
                'incident_open', true, 'first_seen_at', observed_at, 'last_seen_at', observed_at,
                'update_count', 1, 'location', ST_AsText(NEW.location)))
            ON CONFLICT (device_id, alert_type) WHERE details->>'incident_open' = 'true'
            DO UPDATE SET details = alerts.details || jsonb_build_object(
                'last_seen_at', observed_at, 'location', ST_AsText(NEW.location),
                'update_count', COALESCE((alerts.details->>'update_count')::bigint, 1) + 1,
                'status', CASE
                    WHEN alerts.details->>'status' LIKE 'ACKNOWLEDGED_%' THEN alerts.details->>'status'
                    WHEN muted THEN 'ACKNOWLEDGED_FAMILY'
                    WHEN alerts.created_at <= NOW() - INTERVAL '3 minutes' THEN 'ESCALATED_BHW'
                    ELSE 'PENDING_FAMILY' END);
        END IF;
    END IF;

    -- A geofence confirmation does not suppress a separate SOS.
    IF NEW.is_sos THEN
        INSERT INTO public.alerts (device_id, alert_type, created_at, details)
        VALUES (NEW.device_id, 'SOS', observed_at, jsonb_build_object(
            'status', 'PENDING_FAMILY', 'incident_open', true,
            'first_seen_at', observed_at, 'last_seen_at', observed_at, 'update_count', 1,
            'location', ST_AsText(NEW.location)))
        ON CONFLICT (device_id, alert_type) WHERE details->>'incident_open' = 'true'
        DO UPDATE SET details = alerts.details || jsonb_build_object(
            'last_seen_at', observed_at,
            'update_count', COALESCE((alerts.details->>'update_count')::bigint, 1) + 1,
            'status', CASE WHEN alerts.details->>'status' LIKE 'ACKNOWLEDGED_%' THEN alerts.details->>'status'
                WHEN alerts.created_at <= NOW() - INTERVAL '3 minutes' THEN 'ESCALATED_BHW'
                ELSE 'PENDING_FAMILY' END);
    ELSE
        UPDATE public.alerts SET details = details || jsonb_build_object('incident_open', false)
        WHERE device_id = NEW.device_id AND alert_type = 'SOS'
          AND details->>'incident_open' = 'true' AND details->>'status' LIKE 'ACKNOWLEDGED_%';
    END IF;
    RETURN NEW;
END;
$$;

-- Keep RLS enabled. This follows the existing installation's shared-device
-- access model; the RPC runs as its authenticated caller, not as a definer.
DROP POLICY IF EXISTS "Authenticated users confirm incidents" ON public.alerts;
CREATE POLICY "Authenticated users confirm incidents" ON public.alerts
    FOR UPDATE TO authenticated
    USING (alert_type IN ('GEOFENCE', 'SOS'))
    WITH CHECK (alert_type IN ('GEOFENCE', 'SOS')
        AND details->>'status' IN ('ACKNOWLEDGED_FAMILY', 'ACKNOWLEDGED_BHW'));

CREATE OR REPLACE FUNCTION public.acknowledge_alert_incident(p_alert_id BIGINT, p_role TEXT DEFAULT 'family')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions
AS $$
DECLARE
    target public.alerts;
BEGIN
    IF p_role IS NULL OR p_role NOT IN ('family', 'barangay') THEN RAISE EXCEPTION 'Invalid confirmation role'; END IF;
    SELECT * INTO target FROM public.alerts WHERE id = p_alert_id;
    IF NOT FOUND THEN RETURN false; END IF;
    PERFORM 1 FROM public.devices WHERE id = target.device_id FOR UPDATE;
    SELECT * INTO target FROM public.alerts WHERE id = p_alert_id;
    IF NOT FOUND OR COALESCE(target.details->>'status', 'PENDING_FAMILY') NOT IN ('PENDING_FAMILY', 'ESCALATED_BHW') THEN
        RETURN false;
    END IF;
    UPDATE public.alerts SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
        'status', CASE WHEN p_role = 'family' THEN 'ACKNOWLEDGED_FAMILY' ELSE 'ACKNOWLEDGED_BHW' END,
        'acknowledged_at', NOW(),
        'incident_open', COALESCE(details->>'source', '') <> 'family_app')
    WHERE id = target.id
      AND COALESCE(details->>'status', 'PENDING_FAMILY') IN ('PENDING_FAMILY', 'ESCALATED_BHW');
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_alert_incident(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_alert_incident(BIGINT, TEXT) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
