-- Apply after 20261013_account_access.sql. The first dashboard registration for
-- the reserved email becomes super admin; later staff accounts wait for approval.
BEGIN;

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
