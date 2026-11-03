-- Additive: run after the account, approval, identity and family safe-zone migrations.
BEGIN;

CREATE INDEX IF NOT EXISTS telemetry_device_observed_history
  ON public.telemetry(device_id, (COALESCE(received_at, created_at)) DESC, id DESC);

-- A separate trigger preserves the installed geofence/SOS implementation.
CREATE OR REPLACE FUNCTION public.check_watch_battery()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE observed TIMESTAMPTZ; BEGIN
  PERFORM 1 FROM public.devices WHERE id=NEW.device_id FOR UPDATE;
  observed := CASE WHEN NEW.rx_uptime_ms IS NOT NULL THEN NEW.received_at
    ELSE COALESCE(NEW.received_at,NEW.created_at) END;
  IF NEW.battery_percent IS NULL OR NEW.battery_percent NOT BETWEEN 0 AND 100
    OR observed IS NULL OR observed < now()-interval '45 seconds' OR observed > now()+interval '5 seconds' THEN
    RETURN NEW;
  END IF;
  -- Delayed/reordered gateway packets must not reopen or clear a newer state.
  IF EXISTS(SELECT 1 FROM public.telemetry t WHERE t.device_id=NEW.device_id
    AND t.battery_percent BETWEEN 0 AND 100
    AND (t.rx_uptime_ms IS NULL OR t.received_at IS NOT NULL)
    AND COALESCE(t.received_at,t.created_at) <= now()+interval '5 seconds'
    AND (COALESCE(t.received_at,t.created_at),t.id) > (observed,NEW.id)) THEN RETURN NEW; END IF;

  IF NEW.battery_percent >= 25 THEN
    UPDATE public.alerts SET details=details || jsonb_build_object('status','RESOLVED',
      'incident_open',false,'resolved_at',observed,'resolved_reason','battery_recovered','battery_percent',NEW.battery_percent)
      WHERE device_id=NEW.device_id AND alert_type='LOW_BATTERY' AND details->>'incident_open'='true';
  ELSIF NEW.battery_percent <= 20 THEN
    INSERT INTO public.alerts(device_id,alert_type,created_at,details)
      VALUES(NEW.device_id,'LOW_BATTERY',observed,jsonb_build_object('status','PENDING_FAMILY',
        'incident_open',true,'first_seen_at',observed,'last_seen_at',observed,'update_count',1,
        'battery_percent',NEW.battery_percent,'threshold_percent',20,'recovery_percent',25))
      ON CONFLICT(device_id,alert_type) WHERE details->>'incident_open'='true'
      DO UPDATE SET details=alerts.details || jsonb_build_object('last_seen_at',observed,
        'battery_percent',NEW.battery_percent,'update_count',COALESCE((alerts.details->>'update_count')::bigint,1)+1);
  ELSE
    UPDATE public.alerts SET details=details || jsonb_build_object('last_seen_at',observed,
      'battery_percent',NEW.battery_percent,'update_count',COALESCE((details->>'update_count')::bigint,1)+1)
      WHERE device_id=NEW.device_id AND alert_type='LOW_BATTERY' AND details->>'incident_open'='true';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.check_watch_battery() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS telemetry_battery_trigger ON public.telemetry;
CREATE TRIGGER telemetry_battery_trigger AFTER INSERT ON public.telemetry
  FOR EACH ROW EXECUTE FUNCTION public.check_watch_battery();

-- The existing public wrapper still enforces approved linked family/staff access.
CREATE OR REPLACE FUNCTION public._safewatch_acknowledge_incident(p_alert_id BIGINT,p_role TEXT DEFAULT 'family')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ DECLARE target public.alerts; BEGIN
  IF p_role IS NULL OR p_role NOT IN ('family','barangay') THEN RAISE EXCEPTION 'Invalid confirmation role'; END IF;
  SELECT * INTO target FROM public.alerts WHERE id=p_alert_id;
  IF NOT FOUND OR target.alert_type NOT IN ('GEOFENCE','SOS','LOW_BATTERY') THEN RETURN false; END IF;
  PERFORM 1 FROM public.devices WHERE id=target.device_id FOR UPDATE;
  SELECT * INTO target FROM public.alerts WHERE id=p_alert_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF target.details->>'status' IN ('ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW') THEN RETURN true; END IF;
  IF COALESCE(target.details->>'status','PENDING_FAMILY') NOT IN ('PENDING_FAMILY','ESCALATED_BHW')
    OR target.details->>'incident_open'='false' THEN RETURN false; END IF;
  UPDATE public.alerts SET details=COALESCE(details,'{}'::jsonb) || jsonb_build_object(
    'status',CASE WHEN p_role='family' THEN 'ACKNOWLEDGED_FAMILY' ELSE 'ACKNOWLEDGED_BHW' END,
    'acknowledged_at',now(),'incident_open',COALESCE(details->>'source','')<>'family_app') WHERE id=target.id;
  RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public._safewatch_acknowledge_incident(BIGINT,TEXT) FROM PUBLIC,anon,authenticated;

-- Read the existing telemetry history with RLS; no duplicate location store.
CREATE OR REPLACE FUNCTION public.get_watch_location_history(p_device_id UUID,p_start TIMESTAMPTZ,p_end TIMESTAMPTZ,
  p_before_at TIMESTAMPTZ DEFAULT NULL,p_before_id BIGINT DEFAULT NULL,p_limit INTEGER DEFAULT 201)
RETURNS TABLE(telemetry_id BIGINT,observed_at TIMESTAMPTZ,lat DOUBLE PRECISION,lng DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,extensions
AS $$ BEGIN
  IF NOT (public.safewatch_has_app_access('family') OR public.safewatch_has_app_access('dashboard'))
    OR NOT EXISTS(SELECT 1 FROM public.devices d WHERE d.id=p_device_id AND d.patient_name<>'[HIDDEN]') THEN
    RAISE EXCEPTION 'Approved access to this watch is required' USING ERRCODE='42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '7 days'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
    OR (p_before_at IS NULL)<>(p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Choose a valid history range and page size' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT t.id,COALESCE(t.received_at,t.created_at),ST_Y(t.location::geometry),ST_X(t.location::geometry)
    FROM public.telemetry t WHERE t.device_id=p_device_id
      AND (t.rx_uptime_ms IS NULL OR t.received_at IS NOT NULL)
      AND COALESCE(t.received_at,t.created_at)>=p_start AND COALESCE(t.received_at,t.created_at)<p_end
      AND t.location IS NOT NULL
      AND NOT ST_Equals(t.location::geometry,ST_SetSRID(ST_MakePoint(0,0),4326))
      AND (p_before_at IS NULL OR (COALESCE(t.received_at,t.created_at),t.id)<(p_before_at,p_before_id))
    ORDER BY COALESCE(t.received_at,t.created_at) DESC,t.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.get_watch_location_history(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_watch_location_history(UUID,TIMESTAMPTZ,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT,INTEGER) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
