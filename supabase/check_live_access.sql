-- Read-only configuration diagnostic. Returns no senior records or credentials.
SELECT jsonb_build_object(
  'database', current_database(),
  'tables', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'rls_enabled',c.relrowsecurity))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('devices','telemetry','alerts')),
  'device_policies', (SELECT jsonb_agg(jsonb_build_object('name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check))
    FROM pg_policies WHERE schemaname='public' AND tablename='devices'),
  'anon_role', (SELECT jsonb_build_object('superuser',rolsuper,'bypass_rls',rolbypassrls) FROM pg_roles WHERE rolname='anon')
) AS access_diagnostic;
