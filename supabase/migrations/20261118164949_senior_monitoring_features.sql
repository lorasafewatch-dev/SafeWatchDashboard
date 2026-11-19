-- Apply after 20261103_sos_response_handoff.sql. Additive; no history is deleted.
BEGIN;
CREATE SCHEMA IF NOT EXISTS safewatch_private;
REVOKE ALL ON SCHEMA safewatch_private FROM PUBLIC,anon,authenticated;

-- Daily aggregation runs over every recorded sample, independent of API row limits.
-- Reuse telemetry_device_observed_history(device_id,coalesce(received_at,created_at)).
CREATE OR REPLACE FUNCTION public.get_watch_daily_health(p_device_id UUID,p_day DATE)
RETURNS TABLE(pulse_average NUMERIC,pulse_count BIGINT,oxygen_average NUMERIC,oxygen_count BIGINT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ DECLARE starts TIMESTAMPTZ; ends TIMESTAMPTZ; BEGIN
  IF NOT (public.safewatch_has_app_access('family') OR public.safewatch_has_app_access('dashboard'))
    OR NOT EXISTS(SELECT 1 FROM public.devices d WHERE d.id=p_device_id AND d.patient_name<>'[HIDDEN]') THEN
    RAISE EXCEPTION 'Approved access to this senior is required' USING ERRCODE='42501';
  END IF;
  IF p_day IS NULL OR NOT isfinite(p_day) THEN RAISE EXCEPTION 'Choose a valid date' USING ERRCODE='22023'; END IF;
  starts:=p_day::timestamp AT TIME ZONE 'Asia/Manila';
  ends:=(p_day+1)::timestamp AT TIME ZONE 'Asia/Manila';
  RETURN QUERY SELECT
    round(avg(t.heart_rate) FILTER(WHERE t.heart_rate BETWEEN 1 AND 300),1),
    count(*) FILTER(WHERE t.heart_rate BETWEEN 1 AND 300),
    round(avg(t.spo2) FILTER(WHERE t.spo2 BETWEEN 1 AND 100),1),
    count(*) FILTER(WHERE t.spo2 BETWEEN 1 AND 100)
    FROM public.telemetry t WHERE t.device_id=p_device_id
      AND (t.rx_uptime_ms IS NULL OR t.received_at IS NOT NULL)
      AND COALESCE(t.received_at,t.created_at)>=starts AND COALESCE(t.received_at,t.created_at)<ends
      AND COALESCE(t.received_at,t.created_at)<=now();
END; $$;
REVOKE ALL ON FUNCTION public.get_watch_daily_health(UUID,DATE) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_watch_daily_health(UUID,DATE) TO authenticated;

-- Internal trigger helpers only. No public RPC can supply/replace SOS coordinates.
CREATE OR REPLACE FUNCTION safewatch_private.sos_snapshot(watch_id UUID,incident_at TIMESTAMPTZ,source TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,extensions
AS $$ SELECT jsonb_build_object('incident_at',incident_at,'source',source,'recorded_at',fix.observed,
    'point',CASE WHEN fix.lat IS NULL THEN NULL ELSE jsonb_build_object('lat',fix.lat,'lng',fix.lng) END)
  FROM (SELECT 1) seed LEFT JOIN LATERAL (
    SELECT COALESCE(t.received_at,t.created_at) AS observed,ST_Y(t.location::geometry) AS lat,ST_X(t.location::geometry) AS lng
    FROM public.telemetry t WHERE t.device_id=watch_id
      AND (t.rx_uptime_ms IS NULL OR t.received_at IS NOT NULL)
      AND COALESCE(t.received_at,t.created_at) BETWEEN incident_at-interval '45 seconds' AND incident_at
      AND t.location IS NOT NULL AND NOT ST_IsEmpty(t.location::geometry)
      AND ST_Y(t.location::geometry) BETWEEN -90 AND 90 AND ST_X(t.location::geometry) BETWEEN -180 AND 180
      AND NOT (ST_Y(t.location::geometry)=0 AND ST_X(t.location::geometry)=0)
    ORDER BY COALESCE(t.received_at,t.created_at) DESC,t.id DESC LIMIT 1
  ) fix ON true $$;
REVOKE ALL ON FUNCTION safewatch_private.sos_snapshot(UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC,anon,authenticated;

-- Security definer is confined to an unexposed trigger function. It observes the
-- triggering watch packet even when ingestion uses a restricted gateway role.
CREATE OR REPLACE FUNCTION safewatch_private.freeze_sos_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions
AS $$ DECLARE opened TIMESTAMPTZ; BEGIN
  IF TG_OP='UPDATE' AND OLD.alert_type='SOS' THEN
    NEW.details:=COALESCE(NEW.details,'{}'::jsonb) || jsonb_build_object('sos_location',OLD.details->'sos_location');
  ELSIF NEW.alert_type='SOS' THEN
    opened:=COALESCE((NEW.details->>'first_seen_at')::timestamptz,NEW.created_at);
    NEW.details:=COALESCE(NEW.details,'{}'::jsonb) || jsonb_build_object('sos_location',
      safewatch_private.sos_snapshot(NEW.device_id,opened,CASE WHEN NEW.details->>'source'='family_app' THEN 'family_app' ELSE 'watch' END));
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION safewatch_private.freeze_sos_location() FROM PUBLIC,anon,authenticated;

-- Historical backfill uses only samples that existed by the original opening
-- time. Never substitute a watch's current position for a past SOS.
UPDATE public.alerts a SET details=COALESCE(a.details,'{}'::jsonb) || jsonb_build_object('sos_location',
  safewatch_private.sos_snapshot(a.device_id,COALESCE((a.details->>'first_seen_at')::timestamptz,a.created_at),
    CASE WHEN a.details->>'source'='family_app' THEN 'family_app' ELSE 'watch' END))
  WHERE a.alert_type='SOS' AND NOT COALESCE(a.details,'{}'::jsonb) ? 'sos_location';
DROP TRIGGER IF EXISTS safewatch_sos_location ON public.alerts;
CREATE TRIGGER safewatch_sos_location BEFORE INSERT OR UPDATE ON public.alerts FOR EACH ROW
  EXECUTE FUNCTION safewatch_private.freeze_sos_location();

-- The pointer is never a public URL. Families read only active records' current
-- photos; authorized staff can also read superseded objects for cleanup.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS safewatch_senior_photo_path;
ALTER TABLE public.devices ADD CONSTRAINT safewatch_senior_photo_path CHECK(photo_path IS NULL OR
  photo_path ~ ('^'||id::text||'/[0-9a-f-]{36}\.webp$'));
CREATE UNIQUE INDEX IF NOT EXISTS devices_senior_photo_path ON public.devices(photo_path) WHERE photo_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS alerts_device_history ON public.alerts(device_id,id DESC);
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('senior-photos','senior-photos',false,2097152,ARRAY['image/webp'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=2097152,allowed_mime_types=ARRAY['image/webp'];

DROP POLICY IF EXISTS safewatch_senior_photo_read ON storage.objects;
CREATE POLICY safewatch_senior_photo_read ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='senior-photos' AND (public.safewatch_has_app_access('dashboard') OR
    (public.safewatch_has_app_access('family') AND EXISTS(SELECT 1 FROM public.devices d WHERE d.photo_path=name AND d.patient_name<>'[HIDDEN]'
      AND EXISTS(SELECT 1 FROM public.family_seniors f WHERE f.user_id=(SELECT auth.uid()) AND f.device_id=d.id)))));
-- A restrictive guard prevents another permissive bucket policy from exposing
-- these photos. Other buckets retain their own policies.
DROP POLICY IF EXISTS safewatch_senior_photo_private ON storage.objects;
CREATE POLICY safewatch_senior_photo_private ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING(bucket_id<>'senior-photos' OR (auth.uid() IS NOT NULL AND (public.safewatch_has_app_access('dashboard') OR
    (public.safewatch_has_app_access('family') AND EXISTS(SELECT 1 FROM public.devices d WHERE d.photo_path=name AND d.patient_name<>'[HIDDEN]'
      AND EXISTS(SELECT 1 FROM public.family_seniors f WHERE f.user_id=(SELECT auth.uid()) AND f.device_id=d.id))))));
-- Staff need SELECT on superseded objects as well as DELETE for Storage API cleanup.
-- Families can read only the current pointer of an approved link.
DROP POLICY IF EXISTS safewatch_senior_photo_upload ON storage.objects;
CREATE POLICY safewatch_senior_photo_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK(bucket_id='senior-photos' AND public.safewatch_has_app_access('dashboard') AND EXISTS(
    SELECT 1 FROM public.devices d WHERE name ~ ('^'||d.id::text||'/[0-9a-f-]{36}\.webp$') AND d.patient_name<>'[HIDDEN]'));
DROP POLICY IF EXISTS safewatch_senior_photo_staff_write ON storage.objects;
CREATE POLICY safewatch_senior_photo_staff_write ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING(bucket_id<>'senior-photos' OR public.safewatch_has_app_access('dashboard') OR
    (public.safewatch_has_app_access('family') AND EXISTS(SELECT 1 FROM public.devices d WHERE d.photo_path=name)))
  WITH CHECK(bucket_id<>'senior-photos' OR (public.safewatch_has_app_access('dashboard') AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'));
-- Immutable unique uploads; replacements create a new object and swap pointers.
DROP POLICY IF EXISTS safewatch_senior_photo_no_update ON storage.objects;
CREATE POLICY safewatch_senior_photo_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
  USING(bucket_id<>'senior-photos') WITH CHECK(bucket_id<>'senior-photos');
DROP POLICY IF EXISTS safewatch_senior_photo_delete ON storage.objects;
CREATE POLICY safewatch_senior_photo_delete ON storage.objects FOR DELETE TO authenticated
  USING(bucket_id='senior-photos' AND public.safewatch_has_app_access('dashboard'));
DROP POLICY IF EXISTS safewatch_senior_photo_delete_guard ON storage.objects;
CREATE POLICY safewatch_senior_photo_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING(bucket_id<>'senior-photos' OR public.safewatch_has_app_access('dashboard'));
DROP POLICY IF EXISTS safewatch_senior_photo_anonymous ON storage.objects;
CREATE POLICY safewatch_senior_photo_anonymous ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING(bucket_id<>'senior-photos') WITH CHECK(bucket_id<>'senior-photos');

-- Narrow privileged endpoint validates the stored object before staff attach it.
-- The public wrapper is invoker; the private definer checks fresh staff access.
CREATE OR REPLACE FUNCTION safewatch_private.set_senior_photo(p_device_id UUID,p_path TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE old_path TEXT; BEGIN
  IF auth.uid() IS NULL OR NOT public.safewatch_has_app_access('dashboard') THEN
    RAISE EXCEPTION 'Authorized staff access is required' USING ERRCODE='42501'; END IF;
  SELECT photo_path INTO old_path FROM public.devices WHERE id=p_device_id AND patient_name<>'[HIDDEN]' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This senior is unavailable' USING ERRCODE='22023'; END IF;
  IF p_path IS NOT NULL AND (p_path !~ ('^'||p_device_id::text||'/[0-9a-f-]{36}\.webp$') OR NOT EXISTS(
    SELECT 1 FROM storage.objects o WHERE o.bucket_id='senior-photos' AND o.name=p_path
      AND o.metadata->>'mimetype'='image/webp' AND (o.metadata->>'size')::bigint BETWEEN 1 AND 2097152)) THEN
    RAISE EXCEPTION 'Upload a valid senior photo up to 2 MB first' USING ERRCODE='22023'; END IF;
  UPDATE public.devices SET photo_path=p_path WHERE id=p_device_id;
  RETURN jsonb_build_object('photo_path',p_path,'previous_path',old_path);
END; $$;
REVOKE ALL ON FUNCTION safewatch_private.set_senior_photo(UUID,TEXT) FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA safewatch_private TO authenticated;
GRANT EXECUTE ON FUNCTION safewatch_private.set_senior_photo(UUID,TEXT) TO authenticated;
CREATE OR REPLACE FUNCTION public.set_senior_photo(p_device_id UUID,p_path TEXT)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT safewatch_private.set_senior_photo(p_device_id,p_path) $$;
REVOKE ALL ON FUNCTION public.set_senior_photo(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_senior_photo(UUID,TEXT) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
