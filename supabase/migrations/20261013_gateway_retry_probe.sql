-- Read-only gateway retry capability. Does not grant access to watch history.
BEGIN;
CREATE OR REPLACE FUNCTION public.safewatch_gateway_retry_ready()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_class x ON x.oid=i.indexrelid
    WHERE n.nspname='public' AND t.relname='telemetry'
      AND x.relname='telemetry_gateway_rx_unique'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=3
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,position)
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
        WHERE k.position<=i.indnkeyatts ORDER BY k.position
      )=ARRAY['gateway_id','gateway_boot_id','rx_seq']::text[]
  );
$$;
REVOKE ALL ON FUNCTION public.safewatch_gateway_retry_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.safewatch_gateway_retry_ready() TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
