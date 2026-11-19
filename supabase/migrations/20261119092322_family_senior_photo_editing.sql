BEGIN;
-- Resolve the exact watch folder under the caller's existing RLS permissions.
-- This invoker helper grants no access by itself; only approved links qualify.
CREATE OR REPLACE FUNCTION safewatch_private.can_edit_senior_photo(p_name TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT CASE WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]webp$' THEN EXISTS (
  SELECT 1 FROM public.devices d WHERE d.id=split_part(p_name,'/',1)::uuid AND d.patient_name<>'[HIDDEN]'
    AND ((SELECT public.safewatch_has_app_access('dashboard')) OR
      ((SELECT public.safewatch_has_app_access('family')) AND EXISTS (
        SELECT 1 FROM public.family_seniors f WHERE f.device_id=d.id AND f.user_id=(SELECT auth.uid()))))
) ELSE false END $$;
REVOKE ALL ON FUNCTION safewatch_private.can_edit_senior_photo(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION safewatch_private.can_edit_senior_photo(TEXT) TO authenticated;

DROP POLICY IF EXISTS safewatch_senior_photo_staff_write ON storage.objects;
DROP POLICY IF EXISTS safewatch_senior_photo_upload ON storage.objects;
CREATE POLICY safewatch_senior_photo_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='senior-photos' AND safewatch_private.can_edit_senior_photo(name)
    AND ((SELECT public.safewatch_has_app_access('dashboard')) OR owner_id=(SELECT auth.uid())::text));
DROP POLICY IF EXISTS safewatch_senior_photo_write_guard ON storage.objects;
CREATE POLICY safewatch_senior_photo_write_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id<>'senior-photos' OR (safewatch_private.can_edit_senior_photo(name)
    AND ((SELECT public.safewatch_has_app_access('dashboard')) OR owner_id=(SELECT auth.uid())::text)));

-- Families read the current linked photo and their own uploads for cleanup.
-- Other families' unattached/superseded uploads remain private.
CREATE OR REPLACE FUNCTION safewatch_private.can_read_senior_photo(p_name TEXT,p_owner TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT (SELECT public.safewatch_has_app_access('dashboard')) OR
  (safewatch_private.can_edit_senior_photo(p_name) AND
    (p_owner=(SELECT auth.uid())::text OR EXISTS (SELECT 1 FROM public.devices d WHERE d.photo_path=p_name))) $$;
REVOKE ALL ON FUNCTION safewatch_private.can_read_senior_photo(TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION safewatch_private.can_read_senior_photo(TEXT,TEXT) TO authenticated;
DROP POLICY IF EXISTS safewatch_senior_photo_read ON storage.objects;
CREATE POLICY safewatch_senior_photo_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='senior-photos' AND safewatch_private.can_read_senior_photo(name,owner_id));
DROP POLICY IF EXISTS safewatch_senior_photo_private ON storage.objects;
CREATE POLICY safewatch_senior_photo_private ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id<>'senior-photos' OR safewatch_private.can_read_senior_photo(name,owner_id));

-- A family may clean up only its own detached uploads, never the current photo.
-- Detaching a current photo requires the checked RPC below.
CREATE OR REPLACE FUNCTION safewatch_private.can_delete_senior_photo(p_name TEXT,p_owner TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT (SELECT public.safewatch_has_app_access('dashboard')) OR
  (p_owner=(SELECT auth.uid())::text AND safewatch_private.can_edit_senior_photo(p_name)
    AND NOT EXISTS (SELECT 1 FROM public.devices d WHERE d.photo_path=p_name)) $$;
REVOKE ALL ON FUNCTION safewatch_private.can_delete_senior_photo(TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION safewatch_private.can_delete_senior_photo(TEXT,TEXT) TO authenticated;
DROP POLICY IF EXISTS safewatch_senior_photo_delete ON storage.objects;
CREATE POLICY safewatch_senior_photo_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='senior-photos' AND safewatch_private.can_delete_senior_photo(name,owner_id));
DROP POLICY IF EXISTS safewatch_senior_photo_delete_guard ON storage.objects;
CREATE POLICY safewatch_senior_photo_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id<>'senior-photos' OR safewatch_private.can_delete_senior_photo(name,owner_id));

-- Retain existing immutable uploads, private bucket, MIME/size limits and anon guard.
CREATE OR REPLACE FUNCTION safewatch_private.set_senior_photo(p_device_id UUID,p_path TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE old_path TEXT; is_staff BOOLEAN; BEGIN
  is_staff := public.safewatch_has_app_access('dashboard');
  IF auth.uid() IS NULL OR NOT (is_staff OR
    (public.safewatch_has_app_access('family') AND EXISTS (
      SELECT 1 FROM public.family_seniors f WHERE f.user_id=auth.uid() AND f.device_id=p_device_id))) THEN
    RAISE EXCEPTION 'Approved family access or authorized staff access is required' USING ERRCODE='42501';
  END IF;
  SELECT photo_path INTO old_path FROM public.devices WHERE id=p_device_id AND patient_name<>'[HIDDEN]' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This senior is unavailable' USING ERRCODE='22023'; END IF;
  IF p_path IS NOT NULL AND (p_path !~ ('^'||p_device_id::text||'/[0-9a-f-]{36}[.]webp$') OR NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id='senior-photos' AND o.name=p_path
      AND o.metadata->>'mimetype'='image/webp' AND (o.metadata->>'size')::bigint BETWEEN 1 AND 2097152
      AND (is_staff OR o.owner_id=auth.uid()::text OR p_path=old_path))) THEN
    RAISE EXCEPTION 'Upload a valid senior photo up to 2 MB first' USING ERRCODE='22023';
  END IF;
  UPDATE public.devices SET photo_path=p_path WHERE id=p_device_id;
  RETURN jsonb_build_object('photo_path',p_path,'previous_path',old_path);
END; $$;
REVOKE ALL ON FUNCTION safewatch_private.set_senior_photo(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION safewatch_private.set_senior_photo(UUID,TEXT) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
