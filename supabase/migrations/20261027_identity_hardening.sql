-- Preserve current accounts/admins. New privileged access requires enrolled MFA.
BEGIN;
CREATE OR REPLACE FUNCTION public.safewatch_has_app_access(p_app TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.safewatch_account_access a JOIN auth.users u ON u.id=a.user_id
    WHERE a.user_id=auth.uid() AND a.status='approved' AND u.email_confirmed_at IS NOT NULL
      AND (p_app='any' OR (p_app='family' AND a.role='family')
        OR (p_app='dashboard' AND a.role IN ('barangay','super_admin')) OR (p_app='super_admin' AND a.role='super_admin'))
      AND (CASE WHEN a.role IN ('barangay','super_admin') THEN
          auth.jwt()->>'aal'='aal2' AND EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=a.user_id AND f.status='verified')
        ELSE auth.jwt()->>'aal'='aal2' OR NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=a.user_id AND f.status='verified') END));
$$;
REVOKE ALL ON FUNCTION public.safewatch_has_app_access(TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.safewatch_has_app_access(TEXT) TO authenticated;
-- Existing administrators remain intact. Initial setup now needs an operator.
CREATE OR REPLACE FUNCTION public.safewatch_assign_initial_super_admin(p_user_id UUID)
RETURNS UUID LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT NULL::uuid $$;
REVOKE ALL ON FUNCTION public.safewatch_assign_initial_super_admin(UUID) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
