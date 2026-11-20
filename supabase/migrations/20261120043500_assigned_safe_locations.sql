BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;

ALTER TABLE public.trusted_hubs ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE;
ALTER TABLE public.trusted_hubs ADD COLUMN IF NOT EXISTS revision UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.trusted_hubs DROP CONSTRAINT IF EXISTS trusted_hubs_radius_check;
ALTER TABLE public.trusted_hubs ADD CONSTRAINT trusted_hubs_radius_check CHECK (radius BETWEEN 10 AND 5000);
CREATE INDEX IF NOT EXISTS trusted_hubs_device_id_idx ON public.trusted_hubs(device_id);

-- Give migrated locations the same radius limits while they are mirrored to
-- the legacy device field for older clients.
DO $legacy_radius$
DECLARE definition TEXT := pg_get_functiondef('public._safewatch_valid_safe_zone(jsonb)'::regprocedure);
BEGIN
  IF strpos(definition,'BETWEEN 10 AND 5000')>0 THEN RETURN; END IF;
  IF strpos(definition,'BETWEEN 50 AND 5000')=0 THEN RAISE EXCEPTION 'Unexpected legacy safe-zone validator'; END IF;
  EXECUTE replace(definition,'BETWEEN 50 AND 5000','BETWEEN 10 AND 5000');
END;
$legacy_radius$;

-- Existing staff clients may still add shared locations. Staff and linked
-- families use the restricted RPC below for changes to assigned locations.
DROP POLICY IF EXISTS trusted_hubs_read ON public.trusted_hubs;
CREATE POLICY trusted_hubs_read ON public.trusted_hubs FOR SELECT TO authenticated USING (
  (SELECT public.safewatch_has_app_access('dashboard')) OR (
    (SELECT public.safewatch_has_app_access('family')) AND EXISTS (
      SELECT 1 FROM public.family_seniors link WHERE link.user_id = (SELECT auth.uid())
        AND (trusted_hubs.device_id IS NULL OR link.device_id = trusted_hubs.device_id)
    )
  )
);
DROP POLICY IF EXISTS trusted_hubs_insert ON public.trusted_hubs;
CREATE POLICY trusted_hubs_insert ON public.trusted_hubs FOR INSERT TO authenticated WITH CHECK (
  device_id IS NULL AND (SELECT public.safewatch_has_app_access('dashboard'))
);
DROP POLICY IF EXISTS trusted_hubs_delete ON public.trusted_hubs;
CREATE POLICY trusted_hubs_delete ON public.trusted_hubs FOR DELETE TO authenticated USING (
  device_id IS NULL AND (SELECT public.safewatch_has_app_access('dashboard'))
);

-- Keep the old per-watch editor compatible during cached-app rollout. Its
-- circle has a stable ID, so backfill and older edits cannot duplicate it.
INSERT INTO public.trusted_hubs(id,device_id,name,lat,lng,radius)
SELECT id,id,family_safe_zone->>'name',(family_safe_zone->>'lat')::float8,
  (family_safe_zone->>'lng')::float8,(family_safe_zone->>'radius')::int
FROM public.devices WHERE family_safe_zone IS NOT NULL
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public._safewatch_sync_legacy_safe_location()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.family_safe_zone IS NULL THEN
    DELETE FROM public.trusted_hubs WHERE id=NEW.id AND device_id=NEW.id;
  ELSE
    INSERT INTO public.trusted_hubs AS existing(id,device_id,name,lat,lng,radius)
    VALUES(NEW.id,NEW.id,NEW.family_safe_zone->>'name',(NEW.family_safe_zone->>'lat')::float8,
      (NEW.family_safe_zone->>'lng')::float8,(NEW.family_safe_zone->>'radius')::int)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,
      radius=EXCLUDED.radius,revision=gen_random_uuid()
    WHERE existing.device_id=NEW.id AND (existing.name,existing.lat,existing.lng,existing.radius)
      IS DISTINCT FROM (EXCLUDED.name,EXCLUDED.lat,EXCLUDED.lng,EXCLUDED.radius);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._safewatch_sync_legacy_safe_location() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS safewatch_sync_legacy_safe_location ON public.devices;
CREATE TRIGGER safewatch_sync_legacy_safe_location AFTER UPDATE OF family_safe_zone ON public.devices
  FOR EACH ROW WHEN (NEW.family_safe_zone IS DISTINCT FROM OLD.family_safe_zone)
  EXECUTE FUNCTION public._safewatch_sync_legacy_safe_location();

CREATE OR REPLACE FUNCTION public.save_safewatch_safe_location(p_id UUID,p_device_id UUID,p_location JSONB,p_expected UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE
  previous public.trusted_hubs; saved public.trusted_hubs;
  staff BOOLEAN := coalesce(public.safewatch_has_app_access('dashboard'),false);
  location_name TEXT; latitude FLOAT8; longitude FLOAT8; meters NUMERIC;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'A location ID is required' USING ERRCODE='22023'; END IF;
  IF p_device_id IS NULL THEN
    IF NOT staff THEN
      RAISE EXCEPTION 'Approved staff access is required' USING ERRCODE='42501';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id::text,0));
    IF NOT staff THEN
      PERFORM 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=p_device_id FOR SHARE;
      IF NOT FOUND OR NOT coalesce(public.safewatch_has_app_access('family'),false) THEN
        RAISE EXCEPTION 'Approved access to the assigned watch is required' USING ERRCODE='42501';
      END IF;
    END IF;
    PERFORM 1 FROM public.devices WHERE id=p_device_id AND patient_name<>'[HIDDEN]' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This watch is unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_id IS DISTINCT FROM p_device_id AND EXISTS(SELECT 1 FROM public.devices WHERE id=p_id) THEN
    RAISE EXCEPTION 'This location ID is unavailable' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  SELECT * INTO previous FROM public.trusted_hubs WHERE id=p_id FOR UPDATE;
  IF previous.id IS NOT NULL AND previous.device_id IS DISTINCT FROM p_device_id THEN
    RAISE EXCEPTION 'This safe location is unavailable' USING ERRCODE='42501';
  END IF;
  IF p_location IS NULL THEN
    IF previous.id IS NOT NULL AND previous.revision IS DISTINCT FROM p_expected THEN
      RAISE EXCEPTION 'The safe location changed. Reload before removing it.' USING ERRCODE='40001';
    END IF;
    IF p_id=p_device_id THEN UPDATE public.devices SET family_safe_zone=NULL WHERE id=p_device_id; END IF;
    DELETE FROM public.trusted_hubs WHERE id=p_id AND device_id IS NOT DISTINCT FROM p_device_id;
    RETURN jsonb_build_object('id',p_id,'device_id',p_device_id,'deleted',true);
  END IF;

  IF jsonb_typeof(p_location->'name') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_location->'lat') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_location->'lng') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_location->'radius') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Enter a name, coordinates and radius' USING ERRCODE='22023';
  END IF;
  location_name := btrim(regexp_replace(p_location->>'name','\s+',' ','g'));
  latitude := (p_location->>'lat')::float8;
  longitude := (p_location->>'lng')::float8;
  meters := (p_location->>'radius')::numeric;
  IF length(location_name) NOT BETWEEN 1 AND 80 OR latitude NOT BETWEEN -90 AND 90
    OR longitude NOT BETWEEN -180 AND 180 OR (latitude=0 AND longitude=0)
    OR meters NOT BETWEEN 10 AND 5000 OR meters<>trunc(meters) THEN
    RAISE EXCEPTION 'Choose valid coordinates and a whole-number radius from 10 to 5000 meters' USING ERRCODE='22023';
  END IF;
  IF (previous.name,previous.lat,previous.lng,previous.radius) IS NOT DISTINCT FROM (location_name,latitude,longitude,meters::int) THEN
    RETURN to_jsonb(previous); -- Retried acknowledgement of a committed save.
  END IF;
  IF previous.revision IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'The safe location changed. Reload before saving it.' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.trusted_hubs AS existing(id,device_id,name,lat,lng,radius)
  VALUES(p_id,p_device_id,location_name,latitude,longitude,meters::int)
  ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,
    radius=EXCLUDED.radius,revision=gen_random_uuid()
    WHERE existing.device_id IS NOT DISTINCT FROM p_device_id AND existing.revision=p_expected
  RETURNING * INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'The safe location changed. Reload before saving it.' USING ERRCODE='40001'; END IF;
  -- Preserve the old editor's view of the migrated circle during rollout.
  IF p_id=p_device_id THEN
    UPDATE public.devices SET family_safe_zone=jsonb_build_object('name',saved.name,'lat',saved.lat,'lng',saved.lng,
      'radius',saved.radius,'revision',saved.revision,'updated_at',now()) WHERE id=p_device_id;
  END IF;
  RETURN to_jsonb(saved);
END;
$$;
REVOKE ALL ON FUNCTION public.save_safewatch_safe_location(UUID,UUID,JSONB,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_safewatch_safe_location(UUID,UUID,JSONB,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public._safewatch_safe_location_contains(point GEOGRAPHY, watch_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public,extensions
AS $$
  SELECT public._safewatch_family_zone_contains(point,NULL) OR EXISTS (
    SELECT 1 FROM public.trusted_hubs location WHERE (location.device_id IS NULL OR location.device_id=watch_id)
      AND public._safewatch_family_zone_contains(point,to_jsonb(location))
  );
$$;
REVOKE ALL ON FUNCTION public._safewatch_safe_location_contains(GEOGRAPHY,UUID) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE
  definition TEXT := pg_get_functiondef('public.check_geofence()'::regprocedure);
  before_check TEXT := 'is_inside := public._safewatch_monitored_zone_contains(NEW.location, family_zone);';
  after_check TEXT := 'is_inside := public._safewatch_safe_location_contains(NEW.location, NEW.device_id);';
BEGIN
  IF strpos(definition,after_check)>0 THEN RETURN; END IF;
  IF strpos(definition,before_check)=0 THEN RAISE EXCEPTION 'Install the previous safe-hub migration first'; END IF;
  EXECUTE replace(definition,before_check,after_check);
END;
$migration$;

NOTIFY pgrst,'reload schema';
COMMIT;
