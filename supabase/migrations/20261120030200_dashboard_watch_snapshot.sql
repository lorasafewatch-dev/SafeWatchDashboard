BEGIN;

-- One indexed lookup per visible watch, ordered by the time it was observed.
CREATE OR REPLACE FUNCTION public.get_dashboard_watch_snapshot()
RETURNS TABLE(device JSONB, packet JSONB)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$
  SELECT to_jsonb(d), latest.packet
  FROM public.devices d
  LEFT JOIN LATERAL (
    SELECT to_jsonb(t) AS packet
    FROM public.telemetry t
    WHERE t.device_id=d.id
      AND (t.received_at IS NOT NULL OR t.rx_uptime_ms IS NULL)
      AND COALESCE(t.received_at,t.created_at) <= now()+interval '5 seconds'
    ORDER BY COALESCE(t.received_at,t.created_at) DESC,t.id DESC
    LIMIT 1
  ) latest ON true
  WHERE (SELECT public.safewatch_has_app_access('dashboard'))
    AND d.patient_name <> '[HIDDEN]';
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_watch_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_watch_snapshot() TO authenticated;
NOTIFY pgrst,'reload schema';

COMMIT;
