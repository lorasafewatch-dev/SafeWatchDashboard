BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;

CREATE TABLE IF NOT EXISTS public.trusted_hubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius INTEGER NOT NULL CHECK (radius BETWEEN 10 AND 200),
  CHECK (lat <> 0 OR lng <> 0)
);

ALTER TABLE public.trusted_hubs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trusted_hubs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.trusted_hubs TO authenticated;

DROP POLICY IF EXISTS trusted_hubs_read ON public.trusted_hubs;
CREATE POLICY trusted_hubs_read ON public.trusted_hubs FOR SELECT TO authenticated USING (
  (SELECT public.safewatch_has_app_access('dashboard')) OR (
    (SELECT public.safewatch_has_app_access('family')) AND EXISTS (
      SELECT 1 FROM public.family_seniors WHERE user_id = (SELECT auth.uid())
    )
  )
);
DROP POLICY IF EXISTS trusted_hubs_insert ON public.trusted_hubs;
CREATE POLICY trusted_hubs_insert ON public.trusted_hubs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.safewatch_has_app_access('dashboard')));
DROP POLICY IF EXISTS trusted_hubs_delete ON public.trusted_hubs;
CREATE POLICY trusted_hubs_delete ON public.trusted_hubs FOR DELETE TO authenticated
  USING ((SELECT public.safewatch_has_app_access('dashboard')));

-- A hub extends the default district boundary. An assigned family zone keeps
-- its existing per-watch coverage and takes precedence over the default.
CREATE OR REPLACE FUNCTION public._safewatch_monitored_zone_contains(point GEOGRAPHY, zone JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public,extensions
AS $$
  SELECT public._safewatch_family_zone_contains(point, zone) OR (
    zone IS NULL AND EXISTS (
      SELECT 1 FROM public.trusted_hubs hub
      WHERE public._safewatch_family_zone_contains(point, to_jsonb(hub))
    )
  );
$$;
REVOKE ALL ON FUNCTION public._safewatch_monitored_zone_contains(GEOGRAPHY,JSONB) FROM PUBLIC,anon,authenticated;

-- Extend only the coverage test in the installed trigger and keep its incident,
-- GPS freshness and SOS rules, including updates installed since the baseline.
DO $migration$
DECLARE
  definition TEXT := pg_get_functiondef('public.check_geofence()'::regprocedure);
  before_check TEXT := 'is_inside := public._safewatch_family_zone_contains(NEW.location, family_zone);';
  after_check TEXT := 'is_inside := public._safewatch_monitored_zone_contains(NEW.location, family_zone);';
BEGIN
  IF strpos(definition, after_check) > 0 THEN RETURN; END IF;
  IF strpos(definition, before_check) = 0 THEN
    RAISE EXCEPTION 'The geofence monitor does not match the supported safe-zone migration';
  END IF;
  EXECUTE replace(definition, before_check, after_check);
END;
$migration$;

NOTIFY pgrst,'reload schema';
COMMIT;
