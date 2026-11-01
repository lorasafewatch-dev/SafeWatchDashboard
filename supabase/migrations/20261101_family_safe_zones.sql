-- Apply after the family-approval, identity and senior-removal migrations.
-- One active zone per watch, shared by its approved, linked family members.
-- Existing watches retain the San Isidro East boundary until a family saves a zone.
BEGIN;

CREATE OR REPLACE FUNCTION public._safewatch_valid_safe_zone(zone JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $$ SELECT CASE
  WHEN zone IS NULL THEN true
  WHEN jsonb_typeof(zone)<>'object'
    OR jsonb_typeof(zone->'name') IS DISTINCT FROM 'string'
    OR jsonb_typeof(zone->'lat') IS DISTINCT FROM 'number'
    OR jsonb_typeof(zone->'lng') IS DISTINCT FROM 'number'
    OR jsonb_typeof(zone->'radius') IS DISTINCT FROM 'number' THEN false
  ELSE length(btrim(zone->>'name')) BETWEEN 1 AND 80
    AND (zone->>'lat')::numeric BETWEEN -90 AND 90
    AND (zone->>'lng')::numeric BETWEEN -180 AND 180
    AND NOT ((zone->>'lat')::numeric=0 AND (zone->>'lng')::numeric=0)
    AND (zone->>'radius')::numeric BETWEEN 50 AND 5000
    AND (zone->>'radius')::numeric=trunc((zone->>'radius')::numeric)
  END $$;
REVOKE ALL ON FUNCTION public._safewatch_valid_safe_zone(JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._safewatch_valid_safe_zone(JSONB) TO authenticated;

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS family_safe_zone JSONB;
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS safewatch_valid_family_safe_zone;
ALTER TABLE public.devices ADD CONSTRAINT safewatch_valid_family_safe_zone
  CHECK (public._safewatch_valid_safe_zone(family_safe_zone));

CREATE OR REPLACE FUNCTION public._safewatch_family_zone_contains(point GEOGRAPHY, zone JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,extensions
AS $$ DECLARE a DOUBLE PRECISION; BEGIN
  IF point IS NULL THEN RETURN false; END IF;
  IF zone IS NULL THEN
    RETURN ST_Covers(ST_GeomFromText('POLYGON((121.11916654600009 14.043151185000056,121.12029554500009 14.043104182000036,121.1211045440001 14.042935188000058,121.12204254400001 14.04309117200006,121.12251554400007 14.043008175000068,121.12360654300005 14.042914174000032,121.12454554300007 14.043069159000027,121.1249400690001 14.043054190000078,121.12522042700004 14.042859159000045,121.12581771100008 14.042615370000021,121.1263906160001 14.042444717000024,121.1268416260001 14.042139980000059,121.1271707410001 14.041908380000052,121.12762941800008 14.041687227000068,121.12794273300005 14.041601219000029,121.12833591300011 14.041453776000026,121.12886507700011 14.041420802000061,121.12932827700001 14.041579265000053,121.12960863500007 14.041652402000068,121.12987567400012 14.041722718000074,121.1303156240001 14.041847433000044,121.13079025100001 14.04148151000004,121.13124676400002 14.040979347000075,121.1315891480001 14.04024892700005,121.13142999700005 14.039607072000024,121.13155339700006 14.039154605000022,121.13154121500008 14.038730990000033,121.13153283000008 14.03847590600003,121.13130659700005 14.037653239000065,121.13068959700001 14.036522073000071,121.13015486400002 14.036049039000034,121.12951729800011 14.035452606000035,121.12877689800007 14.034506540000052,121.12826273100006 14.033951240000022,121.12770743100009 14.033560473000023,121.12638764400003 14.033678122000026,121.12392299100009 14.033662656000047,121.1218440770001 14.032473668000023,121.12074460200006 14.031177370000023,121.12051262000011 14.031206906000023,121.12028619700004 14.031177370000023,121.12013323300005 14.031139955000071,121.11996261700006 14.031056027000034,121.11965252000005 14.030894237000041,121.11933726500001 14.030860994000022,121.11908625400008 14.030867272000023,121.11886489100004 14.030860994000022,121.11870874400006 14.030894237000041,121.1185375770001 14.030916786000034,121.11841483400008 14.030894469000032,121.11827730400012 14.030840307000062,121.11815086900003 14.030775738000045,121.11796335100007 14.032610533000025,121.11814609400005 14.03328668100005,121.11820091600009 14.034419685000046,121.11840193300009 14.035223752000036,121.1186212240001 14.035899899000071,121.11852985300004 14.036795338000047,121.1184384820001 14.037526308000054,121.11829228800002 14.037891793000028,121.1180181740001 14.038476570000057,121.11770919600008 14.038825339000027,121.11760964500002 14.039123991000054,121.11763679500007 14.039413593000063,121.11773634600002 14.039820846000055,121.11776349600007 14.040182848000029,121.1176639460001 14.040725851000047,121.11741959400001 14.041178354000067,121.11708618700004 14.041583193000065,121.11695804100009 14.041839008000068,121.11672274000011 14.042038110000021,121.11637883700007 14.042445362000024,121.1162702370001 14.042753064000067,121.1159625470001 14.042976215000067,121.11685454700012 14.043177197000034,121.11800654700005 14.043175190000056,121.1185715470001 14.043255182000053,121.11916654600009 14.043151185000056))', 4326), point::geometry);
  END IF;
  -- Same 6,371,000 m sphere as Leaflet and apps/shared/familySafeZone.js.
  a := power(sin(radians(ST_Y(point::geometry)-(zone->>'lat')::float8)/2),2)
    + cos(radians((zone->>'lat')::float8))*cos(radians(ST_Y(point::geometry)))
    * power(sin(radians(ST_X(point::geometry)-(zone->>'lng')::float8)/2),2);
  RETURN 6371000*2*atan2(sqrt(least(1,a)),sqrt(greatest(0,1-a))) <= (zone->>'radius')::float8;
END; $$;
REVOKE ALL ON FUNCTION public._safewatch_family_zone_contains(GEOGRAPHY,JSONB) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_family_safe_zone(p_device_id UUID,p_zone JSONB,p_expected_zone JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE old_zone JSONB; saved_zone JSONB; BEGIN
  IF NOT public.safewatch_has_app_access('family') THEN
    RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501';
  END IF;
  -- Same lock order as approval, revocation and deletion. Telemetry also locks
  -- this device row, so an in-flight packet cannot evaluate a half-saved zone.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id::text,0));
  PERFORM 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=p_device_id FOR SHARE;
  IF NOT FOUND OR NOT public.safewatch_has_app_access('family') THEN
    RAISE EXCEPTION 'Approved family access linked to this watch is required' USING ERRCODE='42501';
  END IF;
  SELECT family_safe_zone INTO old_zone FROM public.devices WHERE id=p_device_id AND patient_name<>'[HIDDEN]' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This watch is unavailable' USING ERRCODE='42501'; END IF;
  IF old_zone IS DISTINCT FROM p_expected_zone THEN
    RAISE EXCEPTION 'The safe zone changed. Reload before saving.' USING ERRCODE='40001';
  END IF;
  IF NOT public._safewatch_valid_safe_zone(p_zone) THEN
    RAISE EXCEPTION 'Choose a name, valid coordinates and a whole-number radius from 50 to 5000 meters' USING ERRCODE='22023';
  END IF;
  IF p_zone IS NOT NULL THEN
    saved_zone := jsonb_build_object('name',btrim(regexp_replace(p_zone->>'name','\s+',' ','g')),
      'lat',(p_zone->>'lat')::float8,'lng',(p_zone->>'lng')::float8,'radius',(p_zone->>'radius')::integer,
      'revision',gen_random_uuid(),'updated_at',now());
  END IF;
  UPDATE public.devices SET family_safe_zone=saved_zone WHERE id=p_device_id;
  -- Preserve history and SOS. A new valid GPS packet evaluates the new zone
  -- and starts a fresh incident if necessary, with its own response window.
  UPDATE public.alerts SET details=coalesce(details,'{}'::jsonb)
    || jsonb_build_object('status','RESOLVED','incident_open',false,'resolved_at',now(),'resolved_reason','safe_zone_changed')
    WHERE device_id=p_device_id AND alert_type='GEOFENCE' AND details->>'incident_open'='true';
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action,details)
    VALUES(auth.uid(),p_device_id,'family_safe_zone_changed',jsonb_build_object('device_id',p_device_id,'previous',old_zone,'zone',saved_zone));
  RETURN jsonb_build_object('device_id',p_device_id,'zone',saved_zone);
END; $$;
REVOKE ALL ON FUNCTION public.save_family_safe_zone(UUID,JSONB,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_family_safe_zone(UUID,JSONB,JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_geofence()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    family_zone JSONB;
    valid_fix BOOLEAN;
    is_inside BOOLEAN;
    row_json JSONB := to_jsonb(NEW);
    observed_at TIMESTAMPTZ := COALESCE(NEW.created_at, NOW());
    muted BOOLEAN;
BEGIN
    -- Serialize processing for each watch, including concurrent gateway posts.
    SELECT device_name LIKE '%[MUTED]%', family_safe_zone INTO muted, family_zone
    FROM public.devices WHERE id = NEW.device_id FOR UPDATE;

    valid_fix := NEW.location IS NOT NULL
        AND NOT ST_Equals(NEW.location::geometry, ST_SetSRID(ST_MakePoint(0, 0), 4326));

    -- Unknown/stale instrumented GPS data must neither breach nor clear a zone.
    IF row_json->>'rx_uptime_ms' IS NOT NULL THEN
        valid_fix := valid_fix AND row_json->>'received_at' IS NOT NULL
            AND (row_json->>'received_at')::timestamptz >= NOW() - INTERVAL '45 seconds'
            AND (row_json->>'received_at')::timestamptz <= NOW() + INTERVAL '5 seconds';
    END IF;

    IF valid_fix THEN
        is_inside := public._safewatch_family_zone_contains(NEW.location, family_zone);
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
                'update_count', 1, 'zone_name', coalesce(family_zone->>'name','San Isidro East'),
                'zone_revision', family_zone->>'revision', 'location', ST_AsText(NEW.location)))
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

NOTIFY pgrst,'reload schema';
COMMIT;
