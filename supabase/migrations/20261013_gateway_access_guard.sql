-- Final guard for legacy anonymous policies. Preserves gateway telemetry INSERT
-- and its SELECT ... LIMIT 0 schema probe. Safe to run after account_access.sql.
BEGIN;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['devices','telemetry','alerts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_history ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_history ON public.%I AS RESTRICTIVE FOR SELECT TO anon USING (false)',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_update ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_update ON public.%I AS RESTRICTIVE FOR UPDATE TO anon USING (false) WITH CHECK (false)',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_delete ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_delete ON public.%I AS RESTRICTIVE FOR DELETE TO anon USING (false)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['devices','alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_insert ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_insert ON public.%I AS RESTRICTIVE FOR INSERT TO anon WITH CHECK (false)',table_name);
  END LOOP;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
