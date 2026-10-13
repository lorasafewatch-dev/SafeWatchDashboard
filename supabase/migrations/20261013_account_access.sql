-- Separate family/barangay accounts, approval, and a transferable super admin.
-- Apply after the notification and family-senior migrations. Does not create users.
BEGIN;

CREATE TABLE IF NOT EXISTS public.safewatch_account_access (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_app TEXT NOT NULL CHECK (requested_app IN ('family', 'dashboard')),
  role TEXT NOT NULL CHECK (role IN ('family', 'barangay', 'super_admin')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK ((requested_app = 'family' AND role = 'family') OR (requested_app = 'dashboard' AND role IN ('barangay', 'super_admin')))
);
CREATE UNIQUE INDEX IF NOT EXISTS safewatch_one_super_admin
  ON public.safewatch_account_access(role) WHERE role = 'super_admin' AND status = 'approved';
CREATE TABLE IF NOT EXISTS public.safewatch_access_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  bootstrap_email TEXT NOT NULL,
  bootstrap_used BOOLEAN NOT NULL DEFAULT false,
  bootstrap_user_id UUID
);
INSERT INTO public.safewatch_access_control(singleton, bootstrap_email)
  VALUES (true, 'lorasafewatch@gmail.com') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.safewatch_access_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID NOT NULL,
  target_id UUID NOT NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.safewatch_account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safewatch_access_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safewatch_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.safewatch_account_access, public.safewatch_access_control, public.safewatch_access_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.safewatch_account_access, public.safewatch_access_audit TO authenticated;
GRANT ALL ON TABLE public.safewatch_account_access, public.safewatch_access_control, public.safewatch_access_audit TO service_role;
REVOKE ALL ON SEQUENCE public.safewatch_access_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON SEQUENCE public.safewatch_access_audit_id_seq TO service_role;
DROP POLICY IF EXISTS safewatch_own_account_access ON public.safewatch_account_access;
CREATE POLICY safewatch_own_account_access ON public.safewatch_account_access FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Intent is accepted only when the Auth user is created. Later metadata edits
-- cannot change the immutable account type or approve/promote the account.
CREATE OR REPLACE FUNCTION public.safewatch_create_account_access()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE app TEXT := CASE WHEN NEW.raw_user_meta_data->>'requested_app' = 'dashboard' THEN 'dashboard' ELSE 'family' END;
BEGIN
  INSERT INTO public.safewatch_account_access(user_id, requested_app, role, status)
    VALUES (NEW.id, app, CASE WHEN app = 'dashboard' THEN 'barangay' ELSE 'family' END,
      CASE WHEN app = 'dashboard' THEN 'pending' ELSE 'approved' END) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_create_account_access() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS safewatch_auth_account_created ON auth.users;
CREATE TRIGGER safewatch_auth_account_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.safewatch_create_account_access();

-- Existing accounts without a trusted staff role become family accounts. No
-- client-editable name/email/role field grants existing users barangay access.
INSERT INTO public.safewatch_account_access(user_id, requested_app, role, status)
SELECT u.id,
  CASE WHEN u.raw_user_meta_data->>'requested_app' = 'dashboard' OR u.raw_app_meta_data->>'role' IN ('barangay','bhw','admin') THEN 'dashboard' ELSE 'family' END,
  CASE WHEN u.raw_user_meta_data->>'requested_app' = 'dashboard' OR u.raw_app_meta_data->>'role' IN ('barangay','bhw','admin') THEN 'barangay' ELSE 'family' END,
  CASE WHEN u.raw_app_meta_data->>'role' IN ('barangay','bhw','admin') THEN 'approved'
    WHEN u.raw_user_meta_data->>'requested_app' = 'dashboard' THEN 'pending' ELSE 'approved' END
FROM auth.users u ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.safewatch_has_app_access(p_app TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.safewatch_account_access a JOIN auth.users u ON u.id = a.user_id
    WHERE a.user_id = auth.uid() AND a.status = 'approved' AND u.email_confirmed_at IS NOT NULL
      AND (p_app = 'any' OR (p_app = 'family' AND a.role = 'family')
        OR (p_app = 'dashboard' AND a.role IN ('barangay','super_admin')) OR (p_app = 'super_admin' AND a.role = 'super_admin'))
      AND (auth.jwt()->>'aal' = 'aal2' OR NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified')));
$$;
REVOKE ALL ON FUNCTION public.safewatch_has_app_access(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safewatch_has_app_access(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_safewatch_account_access()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in again' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('user_id',a.user_id,'requested_app',a.requested_app,'role',a.role,'status',a.status,
    'email_confirmed',u.email_confirmed_at IS NOT NULL) INTO result
    FROM public.safewatch_account_access a JOIN auth.users u ON u.id = a.user_id WHERE a.user_id = auth.uid();
  IF result IS NULL THEN RAISE EXCEPTION 'Account access has not been configured' USING ERRCODE = '42501'; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_safewatch_account_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_safewatch_account_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.safewatch_require_super_admin()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('super_admin') THEN RAISE EXCEPTION 'Approved super-admin access and any required two-factor verification are required' USING ERRCODE = '42501'; END IF;
  RETURN auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_require_super_admin() FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS safewatch_super_admin_audit ON public.safewatch_access_audit;
CREATE POLICY safewatch_super_admin_audit ON public.safewatch_access_audit FOR SELECT TO authenticated USING (public.safewatch_has_app_access('super_admin'));

-- Legacy operator initializer retained for compatibility. Normal first signup
-- is handled automatically by the reserved-email trigger below.
CREATE OR REPLACE FUNCTION public.initialize_safewatch_super_admin()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE settings public.safewatch_access_control; target_id UUID; target_app TEXT;
BEGIN
  SELECT * INTO settings FROM public.safewatch_access_control WHERE singleton FOR UPDATE;
  IF settings.bootstrap_used THEN
    IF EXISTS (SELECT 1 FROM public.safewatch_account_access WHERE user_id = settings.bootstrap_user_id AND role = 'super_admin' AND status = 'approved') THEN RETURN settings.bootstrap_user_id; END IF;
    RAISE EXCEPTION 'Initial setup is already complete. Use the current super admin to transfer access.';
  END IF;
  SELECT id INTO target_id FROM auth.users WHERE lower(email) = lower(settings.bootstrap_email) AND email_confirmed_at IS NOT NULL;
  IF target_id IS NULL THEN RAISE EXCEPTION 'First register and confirm lorasafewatch@gmail.com through the dashboard Sign Up form'; END IF;
  SELECT requested_app INTO target_app FROM public.safewatch_account_access WHERE user_id = target_id FOR UPDATE;
  IF target_app IS DISTINCT FROM 'dashboard' THEN RAISE EXCEPTION 'The initial super admin must be a dashboard account, not a family account'; END IF;
  UPDATE public.safewatch_account_access SET role = 'super_admin', status = 'approved', reviewed_at = now(), reviewed_by = target_id WHERE user_id = target_id;
  UPDATE public.safewatch_access_control SET bootstrap_used = true, bootstrap_user_id = target_id WHERE singleton;
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action) VALUES(target_id,target_id,'initialize_super_admin');
  RETURN target_id;
END; $$;
REVOKE ALL ON FUNCTION public.initialize_safewatch_super_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_safewatch_super_admin() TO service_role;

CREATE OR REPLACE FUNCTION public.list_safewatch_dashboard_accounts()
RETURNS TABLE(user_id UUID, full_name TEXT, email TEXT, role TEXT, status TEXT, email_confirmed BOOLEAN, created_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ BEGIN
  PERFORM public.safewatch_require_super_admin();
  RETURN QUERY SELECT a.user_id, COALESCE(NULLIF(u.raw_user_meta_data->>'full_name',''),concat_ws(' ',u.raw_user_meta_data->>'first_name',u.raw_user_meta_data->>'last_name')),
    u.email::text,a.role,a.status,u.email_confirmed_at IS NOT NULL,a.created_at,a.reviewed_at
    FROM public.safewatch_account_access a JOIN auth.users u ON u.id = a.user_id WHERE a.requested_app = 'dashboard' ORDER BY a.created_at DESC;
END; $$;
REVOKE ALL ON FUNCTION public.list_safewatch_dashboard_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_safewatch_dashboard_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.review_safewatch_dashboard_account(p_user_id UUID,p_decision TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID := public.safewatch_require_super_admin(); target public.safewatch_account_access; next_status TEXT;
BEGIN
  -- Serialize approvals with transfers so an old super admin cannot approve
  -- after the transfer committed, even if their request began earlier.
  PERFORM 1 FROM public.safewatch_access_control WHERE singleton FOR UPDATE;
  actor := public.safewatch_require_super_admin();
  IF p_decision NOT IN ('approve','reject','suspend') OR p_decision IS NULL THEN RAISE EXCEPTION 'Choose approve, reject or suspend' USING ERRCODE='22023'; END IF;
  SELECT * INTO target FROM public.safewatch_account_access WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR target.requested_app <> 'dashboard' OR target.role <> 'barangay' THEN RAISE EXCEPTION 'Only barangay dashboard accounts can be reviewed' USING ERRCODE='42501'; END IF;
  IF p_decision = 'approve' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'This account must confirm its email first' USING ERRCODE='42501'; END IF;
  next_status := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'suspended' END;
  UPDATE public.safewatch_account_access SET status = next_status, reviewed_at = now(), reviewed_by = actor WHERE user_id = p_user_id;
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action,details) VALUES(actor,p_user_id,p_decision,jsonb_build_object('previous_status',target.status,'status',next_status));
  RETURN jsonb_build_object('user_id',p_user_id,'role','barangay','status',next_status);
END; $$;
REVOKE ALL ON FUNCTION public.review_safewatch_dashboard_account(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_safewatch_dashboard_account(UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_safewatch_super_admin(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE actor UUID; target public.safewatch_account_access;
BEGIN
  PERFORM 1 FROM public.safewatch_access_control WHERE singleton FOR UPDATE;
  actor := public.safewatch_require_super_admin();
  IF p_user_id = actor THEN RAISE EXCEPTION 'Choose another approved barangay account' USING ERRCODE='22023'; END IF;
  SELECT * INTO target FROM public.safewatch_account_access WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR target.role <> 'barangay' OR target.status <> 'approved' OR target.requested_app <> 'dashboard'
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The new super admin must be an approved barangay account with a confirmed email' USING ERRCODE='42501';
  END IF;
  UPDATE public.safewatch_account_access SET role='barangay',reviewed_at=now(),reviewed_by=actor WHERE user_id=actor;
  UPDATE public.safewatch_account_access SET role='super_admin',reviewed_at=now(),reviewed_by=actor WHERE user_id=p_user_id;
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action) VALUES(actor,p_user_id,'transfer_super_admin');
  RETURN jsonb_build_object('previous_super_admin',actor,'super_admin',p_user_id);
END; $$;
REVOKE ALL ON FUNCTION public.transfer_safewatch_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_safewatch_super_admin(UUID) TO authenticated;

-- Restrictive policies apply in addition to existing policies, never granting
-- access to an unapproved account. Keep gateway ingestion policies intact.
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['devices','telemetry','alerts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_approved_account ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_approved_account ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.safewatch_has_app_access(''any'')) WITH CHECK (public.safewatch_has_app_access(''any''))',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_staff_update ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_staff_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.safewatch_has_app_access(''dashboard'')) WITH CHECK (public.safewatch_has_app_access(''dashboard''))',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_staff_delete ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_staff_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.safewatch_has_app_access(''dashboard''))',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_history ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_history ON public.%I AS RESTRICTIVE FOR SELECT TO anon USING (false)',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_update ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_update ON public.%I AS RESTRICTIVE FOR UPDATE TO anon USING (false) WITH CHECK (false)',table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_delete ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_delete ON public.%I AS RESTRICTIVE FOR DELETE TO anon USING (false)',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['telemetry','alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS safewatch_owned_family_history ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_owned_family_history ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.safewatch_has_app_access(''dashboard'') OR (public.safewatch_has_app_access(''family'') AND EXISTS (SELECT 1 FROM public.family_seniors f WHERE f.user_id=auth.uid() AND f.device_id=%I.device_id)))',table_name,table_name);
    EXECUTE format('DROP POLICY IF EXISTS safewatch_staff_insert ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_staff_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.safewatch_has_app_access(''dashboard''))',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['devices','alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS safewatch_no_anonymous_insert ON public.%I',table_name);
    EXECUTE format('CREATE POLICY safewatch_no_anonymous_insert ON public.%I AS RESTRICTIVE FOR INSERT TO anon WITH CHECK (false)',table_name);
  END LOOP;
END; $$;
DROP POLICY IF EXISTS safewatch_family_account_only ON public.family_seniors;
CREATE POLICY safewatch_family_account_only ON public.family_seniors AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.safewatch_has_app_access('family')) WITH CHECK (public.safewatch_has_app_access('family'));

-- Guard the incident functions too: their SECURITY DEFINER wrappers allow a
-- linked family to acknowledge/SOS without granting global table updates.
DO $$ BEGIN
  IF to_regprocedure('public._safewatch_acknowledge_incident(bigint,text)') IS NULL THEN
    ALTER FUNCTION public.acknowledge_alert_incident(BIGINT,TEXT) RENAME TO _safewatch_acknowledge_incident;
  END IF;
  IF to_regprocedure('public._safewatch_request_family_sos(uuid)') IS NULL THEN
    ALTER FUNCTION public.request_family_sos(UUID) RENAME TO _safewatch_request_family_sos;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public._safewatch_acknowledge_incident(BIGINT,TEXT), public._safewatch_request_family_sos(UUID) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.acknowledge_alert_incident(p_alert_id BIGINT,p_role TEXT DEFAULT 'family')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE watch_id UUID; BEGIN
  IF p_role = 'family' THEN
    IF NOT public.safewatch_has_app_access('family') THEN RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
    SELECT device_id INTO watch_id FROM public.alerts WHERE id=p_alert_id;
    IF watch_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=watch_id) THEN RAISE EXCEPTION 'This alert is not linked to your family account' USING ERRCODE='42501'; END IF;
  ELSIF p_role = 'barangay' THEN
    IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION 'Choose a valid acknowledgment role' USING ERRCODE='22023'; END IF;
  RETURN public._safewatch_acknowledge_incident(p_alert_id,p_role);
END; $$;
CREATE OR REPLACE FUNCTION public.request_family_sos(p_device_id UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('family') OR NOT EXISTS(SELECT 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=p_device_id) THEN
    RAISE EXCEPTION 'An approved family account linked to this watch is required' USING ERRCODE='42501';
  END IF;
  RETURN public._safewatch_request_family_sos(p_device_id);
END; $$;
REVOKE ALL ON FUNCTION public.acknowledge_alert_incident(BIGINT,TEXT),public.request_family_sos(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_alert_incident(BIGINT,TEXT),public.request_family_sos(UUID) TO authenticated;
NOTIFY pgrst,'reload schema';

-- Automatic initial super admin (normal dashboard signup).
CREATE OR REPLACE FUNCTION public.safewatch_assign_initial_super_admin(p_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE settings public.safewatch_access_control; target public.safewatch_account_access;
BEGIN
  SELECT * INTO settings FROM public.safewatch_access_control WHERE singleton FOR UPDATE;
  IF NOT FOUND OR settings.bootstrap_used THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.safewatch_account_access WHERE role='super_admin' AND status='approved') THEN RETURN NULL; END IF;
  SELECT a.* INTO target FROM public.safewatch_account_access a JOIN auth.users u ON u.id=a.user_id
    WHERE a.user_id=p_user_id AND a.requested_app='dashboard' AND a.role='barangay'
      AND a.status IN ('pending','approved') AND lower(btrim(u.email))=lower(settings.bootstrap_email)
    FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.safewatch_account_access SET role='super_admin',status='approved',reviewed_at=now(),reviewed_by=p_user_id WHERE user_id=p_user_id;
  UPDATE public.safewatch_access_control SET bootstrap_used=true,bootstrap_user_id=p_user_id WHERE singleton;
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action,details)
    VALUES(p_user_id,p_user_id,'initialize_super_admin','{"source":"automatic_signup"}'::jsonb);
  RETURN p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_assign_initial_super_admin(UUID) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.safewatch_create_account_access()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE app TEXT := CASE WHEN NEW.raw_user_meta_data->>'requested_app'='dashboard' THEN 'dashboard' ELSE 'family' END;
BEGIN
  INSERT INTO public.safewatch_account_access(user_id,requested_app,role,status)
    VALUES(NEW.id,app,CASE WHEN app='dashboard' THEN 'barangay' ELSE 'family' END,
      CASE WHEN app='dashboard' THEN 'pending' ELSE 'approved' END) ON CONFLICT DO NOTHING;
  PERFORM public.safewatch_assign_initial_super_admin(NEW.id);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_create_account_access() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS safewatch_auth_account_created ON auth.users;
CREATE TRIGGER safewatch_auth_account_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.safewatch_create_account_access();

-- Also handles a dashboard signup made before this update, without requiring
-- a separate initializer. Reapplication never reclaims a transferred role.
DO $$ DECLARE existing_id UUID; BEGIN
  SELECT u.id INTO existing_id FROM auth.users u JOIN public.safewatch_account_access a ON a.user_id=u.id
    JOIN public.safewatch_access_control s ON s.singleton
    WHERE lower(btrim(u.email))=lower(s.bootstrap_email) AND a.requested_app='dashboard' LIMIT 1;
  IF existing_id IS NOT NULL THEN PERFORM public.safewatch_assign_initial_super_admin(existing_id); END IF;
END; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
