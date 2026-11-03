-- Apply after 20261103_sos_response_handoff.sql. Additive; never rewrites alerts/telemetry.
BEGIN;

CREATE TABLE IF NOT EXISTS public.safewatch_activity_events (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('alerts','system')),
  event_kind TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  alert_type TEXT,
  status TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS safewatch_activity_device_time ON public.safewatch_activity_events(device_id,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS safewatch_activity_time ON public.safewatch_activity_events(occurred_at DESC,id DESC);
ALTER TABLE public.safewatch_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.safewatch_activity_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.safewatch_activity_events_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.safewatch_activity_events TO authenticated,service_role;
DROP POLICY IF EXISTS safewatch_activity_read ON public.safewatch_activity_events;
CREATE POLICY safewatch_activity_read ON public.safewatch_activity_events FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.devices d WHERE d.id=device_id AND d.patient_name<>'[HIDDEN]')
  AND (public.safewatch_has_app_access('dashboard') OR
    (public.safewatch_has_app_access('family') AND EXISTS(
      SELECT 1 FROM public.family_seniors f WHERE f.user_id=auth.uid() AND f.device_id=safewatch_activity_events.device_id)))
);

CREATE OR REPLACE FUNCTION public.safewatch_record_alert_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE kind TEXT; BEGIN
  IF TG_OP='INSERT' THEN kind:='alert_opened';
  ELSIF (NEW.details->>'status',NEW.details->>'incident_open',NEW.details->'sos_responses')
    IS NOT DISTINCT FROM (OLD.details->>'status',OLD.details->>'incident_open',OLD.details->'sos_responses') THEN RETURN NEW;
  ELSIF NEW.details->'sos_responses' IS DISTINCT FROM OLD.details->'sos_responses'
    AND NEW.details->'sos_responses' IS NOT NULL THEN kind:='sos_response';
  ELSIF NEW.details->>'incident_open'='false' THEN kind:='alert_closed';
  ELSIF NEW.details->>'status' IN ('ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW') THEN kind:='alert_confirmed';
  ELSE kind:='alert_changed'; END IF;
  INSERT INTO public.safewatch_activity_events(device_id,category,event_kind,alert_type,status,details,source_key)
    VALUES(NEW.device_id,'alerts',kind,NEW.alert_type,NEW.details->>'status',
      jsonb_strip_nulls(jsonb_build_object('alert_id',NEW.id,'incident_open',NEW.details->'incident_open',
        'family_decision',NEW.details->'sos_responses'->'family'->>'decision',
        'barangay_decision',NEW.details->'sos_responses'->'barangay'->>'decision',
        'battery_percent',NEW.details->'battery_percent')),
      CASE WHEN TG_OP='INSERT' THEN 'alert:'||NEW.id||':initial' END)
    ON CONFLICT(source_key) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_record_alert_activity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS safewatch_alert_activity ON public.alerts;
CREATE TRIGGER safewatch_alert_activity AFTER INSERT OR UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION public.safewatch_record_alert_activity();

-- Existing incidents are explicitly snapshots: previous transitions cannot be reconstructed.
INSERT INTO public.safewatch_activity_events(device_id,category,event_kind,occurred_at,alert_type,status,details,source_key)
  SELECT a.device_id,'alerts','alert_snapshot',a.created_at,a.alert_type,a.details->>'status',
    jsonb_strip_nulls(jsonb_build_object('alert_id',a.id,'incident_open',a.details->'incident_open',
      'family_decision',a.details->'sos_responses'->'family'->>'decision',
      'barangay_decision',a.details->'sos_responses'->'barangay'->>'decision')),
    'alert:'||a.id||':initial' FROM public.alerts a JOIN public.devices d ON d.id=a.device_id
    ON CONFLICT(source_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.safewatch_record_device_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.safewatch_activity_events(device_id,category,event_kind) VALUES(NEW.id,'system','watch_registered');
  ELSE
    IF (NEW.patient_name,NEW.device_name,NEW.age,NEW.gender) IS DISTINCT FROM (OLD.patient_name,OLD.device_name,OLD.age,OLD.gender) THEN
      INSERT INTO public.safewatch_activity_events(device_id,category,event_kind) VALUES(NEW.id,'system','profile_updated');
    END IF;
    IF NEW.family_safe_zone IS DISTINCT FROM OLD.family_safe_zone THEN
      INSERT INTO public.safewatch_activity_events(device_id,category,event_kind)
        VALUES(NEW.id,'system',CASE WHEN NEW.family_safe_zone IS NULL THEN 'safe_zone_removed' ELSE 'safe_zone_updated' END);
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_record_device_activity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS safewatch_device_activity ON public.devices;
CREATE TRIGGER safewatch_device_activity AFTER INSERT OR UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.safewatch_record_device_activity();

CREATE OR REPLACE FUNCTION public.get_watch_activity_history(p_start TIMESTAMPTZ,p_end TIMESTAMPTZ,
  p_device_id UUID DEFAULT NULL,p_category TEXT DEFAULT 'all',p_alert_type TEXT DEFAULT NULL,
  p_before_at TIMESTAMPTZ DEFAULT NULL,p_before_id TEXT DEFAULT NULL,p_limit INTEGER DEFAULT 101)
RETURNS TABLE(event_id TEXT,occurred_at TIMESTAMPTZ,device_id UUID,patient_name TEXT,category TEXT,
  event_kind TEXT,alert_type TEXT,status TEXT,details JSONB,lat DOUBLE PRECISION,lng DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,extensions
AS $$ BEGIN
  IF NOT (public.safewatch_has_app_access('family') OR public.safewatch_has_app_access('dashboard'))
    OR (p_device_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.devices d WHERE d.id=p_device_id AND d.patient_name<>'[HIDDEN]')) THEN
    RAISE EXCEPTION 'Approved access to this watch is required' USING ERRCODE='42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end<=p_start OR p_end-p_start>interval '7 days'
    OR p_category IS NULL OR p_category NOT IN ('all','alerts','movements','system')
    OR (p_alert_type IS NOT NULL AND p_alert_type NOT IN ('SOS','GEOFENCE','LOW_BATTERY'))
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
    OR (p_before_at IS NULL)<>(p_before_id IS NULL)
    OR (p_before_id IS NOT NULL AND p_before_id !~ '^[ems]:[0-9]{1,20}$') THEN
    RAISE EXCEPTION 'Choose a valid history range, category and page size' USING ERRCODE='22023';
  END IF;
  RETURN QUERY WITH events AS (
    SELECT 'e:'||e.id AS eid,e.occurred_at AS at,e.device_id AS did,d.patient_name AS name,e.category AS cat,
      e.event_kind AS kind,e.alert_type AS atyp,e.status AS state,e.details AS info,NULL::double precision AS latitude,NULL::double precision AS longitude
      FROM public.safewatch_activity_events e JOIN public.devices d ON d.id=e.device_id
      WHERE p_category IN ('all','alerts','system') AND (p_category='all' OR e.category=p_category)
        AND (p_device_id IS NULL OR e.device_id=p_device_id) AND d.patient_name<>'[HIDDEN]'
        AND e.occurred_at>=p_start AND e.occurred_at<p_end
    UNION ALL
    SELECT 'm:'||t.id,COALESCE(t.received_at,t.created_at),t.device_id,d.patient_name,'movements','location_recorded',NULL,NULL,
      '{}'::jsonb,ST_Y(t.location::geometry),ST_X(t.location::geometry)
      FROM public.telemetry t JOIN public.devices d ON d.id=t.device_id
      WHERE p_category IN ('all','movements') AND (p_device_id IS NULL OR t.device_id=p_device_id)
        AND d.patient_name<>'[HIDDEN]' AND (t.rx_uptime_ms IS NULL OR t.received_at IS NOT NULL)
        AND COALESCE(t.received_at,t.created_at)>=p_start AND COALESCE(t.received_at,t.created_at)<p_end
        AND t.location IS NOT NULL AND NOT ST_Equals(t.location::geometry,ST_SetSRID(ST_MakePoint(0,0),4326))
    UNION ALL
    -- Existing audit-table RLS limits these administrative records to super admins.
    SELECT 's:'||a.id,a.created_at,NULL::uuid,NULL::text,'system',a.action,NULL,NULL,'{}'::jsonb,NULL::double precision,NULL::double precision
      FROM public.safewatch_access_audit a WHERE p_category IN ('all','system')
        AND (p_device_id IS NULL OR a.details->>'device_id'=p_device_id::text)
        AND a.created_at>=p_start AND a.created_at<p_end
  ) SELECT e.eid,e.at,e.did,e.name,e.cat,e.kind,e.atyp,e.state,e.info,e.latitude,e.longitude FROM events e
    WHERE (p_alert_type IS NULL OR e.atyp=p_alert_type)
      AND (p_before_at IS NULL OR (e.at,e.eid)<(p_before_at,p_before_id))
    ORDER BY e.at DESC,e.eid DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.get_watch_activity_history(TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_watch_activity_history(TIMESTAMPTZ,TIMESTAMPTZ,UUID,TEXT,TEXT,TIMESTAMPTZ,TEXT,INTEGER) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
