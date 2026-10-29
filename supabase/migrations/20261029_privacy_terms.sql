-- Apply after 20261027_identity_hardening.sql. Additive and repeatable.
-- An acceptance is an account declaration, not a senior's monitoring consent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.safewatch_privacy_acceptances (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app TEXT NOT NULL CHECK (app IN ('family','dashboard')),
  version TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('signup','first_login')),
  terms_accepted BOOLEAN NOT NULL CHECK (terms_accepted),
  account_consent BOOLEAN NOT NULL CHECK (account_consent),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id,app,version,stage)
);
ALTER TABLE public.safewatch_privacy_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.safewatch_privacy_acceptances FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.safewatch_privacy_acceptances TO authenticated;
GRANT ALL ON TABLE public.safewatch_privacy_acceptances TO service_role;
DROP POLICY IF EXISTS safewatch_own_privacy_acceptances ON public.safewatch_privacy_acceptances;
CREATE POLICY safewatch_own_privacy_acceptances ON public.safewatch_privacy_acceptances
  FOR SELECT TO authenticated USING (user_id=auth.uid());

-- Capture a sign-up declaration only at account creation. Later edits to
-- client-controlled user metadata cannot fabricate a first-login receipt.
CREATE OR REPLACE FUNCTION public.safewatch_capture_signup_privacy()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'privacy_terms_version'='2026-10-29'
    AND NEW.raw_user_meta_data->'privacy_terms_accepted'='true'::jsonb
    AND NEW.raw_user_meta_data->'privacy_account_consent'='true'::jsonb
    AND NEW.raw_user_meta_data->>'requested_app' IN ('family','dashboard') THEN
    INSERT INTO public.safewatch_privacy_acceptances(user_id,app,version,stage,terms_accepted,account_consent)
      VALUES(NEW.id,NEW.raw_user_meta_data->>'requested_app','2026-10-29','signup',true,true)
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_capture_signup_privacy() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS safewatch_auth_privacy_created ON auth.users;
CREATE TRIGGER safewatch_auth_privacy_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.safewatch_capture_signup_privacy();

CREATE OR REPLACE FUNCTION public.get_safewatch_privacy_acceptance(p_app TEXT,p_version TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.safewatch_account_access a
    WHERE a.user_id=auth.uid() AND a.requested_app=p_app) THEN
    RAISE EXCEPTION 'Sign in with the account for this application' USING ERRCODE='42501';
  END IF;
  IF p_version IS DISTINCT FROM '2026-10-29' THEN
    RAISE EXCEPTION 'Reload SafeWatch to review the current privacy notice' USING ERRCODE='22023';
  END IF;
  SELECT to_jsonb(r) INTO result FROM public.safewatch_privacy_acceptances r
    WHERE r.user_id=auth.uid() AND r.app=p_app AND r.version=p_version AND r.stage='first_login';
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.accept_safewatch_privacy_terms(
  p_app TEXT,p_version TEXT,p_terms_accepted BOOLEAN,p_account_consent BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
BEGIN
  -- The read validates the authenticated actor, immutable app and current notice.
  PERFORM public.get_safewatch_privacy_acceptance(p_app,p_version);
  IF p_terms_accepted IS DISTINCT FROM true OR p_account_consent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Both the terms and account-data consent must be accepted' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.safewatch_privacy_acceptances(user_id,app,version,stage,terms_accepted,account_consent)
    VALUES(auth.uid(),p_app,p_version,'first_login',true,true) ON CONFLICT DO NOTHING;
  RETURN public.get_safewatch_privacy_acceptance(p_app,p_version);
END; $$;
REVOKE ALL ON FUNCTION public.get_safewatch_privacy_acceptance(TEXT,TEXT),
  public.accept_safewatch_privacy_terms(TEXT,TEXT,BOOLEAN,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_safewatch_privacy_acceptance(TEXT,TEXT),
  public.accept_safewatch_privacy_terms(TEXT,TEXT,BOOLEAN,BOOLEAN) TO authenticated;

-- Preserve approval, verified email and mandatory staff MFA. Protected data
-- also requires the current first-login receipt, even for direct API requests.
CREATE OR REPLACE FUNCTION public.safewatch_has_app_access(p_app TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.safewatch_account_access a JOIN auth.users u ON u.id=a.user_id
    WHERE a.user_id=auth.uid() AND a.status='approved' AND u.email_confirmed_at IS NOT NULL
      AND (p_app='any' OR (p_app='family' AND a.role='family')
        OR (p_app='dashboard' AND a.role IN ('barangay','super_admin')) OR (p_app='super_admin' AND a.role='super_admin'))
      AND EXISTS(SELECT 1 FROM public.safewatch_privacy_acceptances r WHERE r.user_id=a.user_id
        AND r.app=a.requested_app AND r.stage='first_login' AND r.version='2026-10-29'
        AND r.terms_accepted AND r.account_consent)
      AND (CASE WHEN a.role IN ('barangay','super_admin') THEN
          auth.jwt()->>'aal'='aal2' AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=a.user_id AND f.status='verified')
        ELSE auth.jwt()->>'aal'='aal2' OR NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=a.user_id AND f.status='verified') END));
$$;
REVOKE ALL ON FUNCTION public.safewatch_has_app_access(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.safewatch_has_app_access(TEXT) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
