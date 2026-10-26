-- Apply after 20261013_account_access.sql. Preserves every existing family link.
-- Both registration and access to an existing watch require barangay approval.
BEGIN;

CREATE TABLE IF NOT EXISTS public.safewatch_family_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link','register')),
  requested_name TEXT,
  requested_age SMALLINT CHECK (requested_age BETWEEN 0 AND 130),
  requested_gender TEXT CHECK (requested_gender IN ('Male','Female','Other','Not specified')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','canceled','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.safewatch_family_requests DROP CONSTRAINT IF EXISTS safewatch_family_requests_status_check;
ALTER TABLE public.safewatch_family_requests ADD CONSTRAINT safewatch_family_requests_status_check CHECK(status IN ('pending','approved','rejected','canceled','revoked'));
CREATE UNIQUE INDEX IF NOT EXISTS safewatch_family_request_pending
  ON public.safewatch_family_requests(user_id,device_id) WHERE status='pending';
ALTER TABLE public.safewatch_family_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.safewatch_family_requests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.safewatch_family_requests_id_seq FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.safewatch_family_requests TO authenticated;
GRANT ALL ON public.safewatch_family_requests TO service_role;
GRANT ALL ON SEQUENCE public.safewatch_family_requests_id_seq TO service_role;
DROP POLICY IF EXISTS safewatch_own_family_requests ON public.safewatch_family_requests;
CREATE POLICY safewatch_own_family_requests ON public.safewatch_family_requests
  FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.safewatch_has_app_access('family'));

-- A family may see many approved seniors, never the global device directory.
DROP POLICY IF EXISTS safewatch_private_devices ON public.devices;
CREATE POLICY safewatch_private_devices ON public.devices AS RESTRICTIVE FOR SELECT TO authenticated
  USING(public.safewatch_has_app_access('dashboard') OR EXISTS (
    SELECT 1 FROM public.family_seniors f WHERE f.user_id=auth.uid() AND f.device_id=devices.id
      AND public.safewatch_has_app_access('family')));
DROP POLICY IF EXISTS safewatch_staff_register_devices ON public.devices;
CREATE POLICY safewatch_staff_register_devices ON public.devices AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK(public.safewatch_has_app_access('dashboard'));

-- The same boundary must hold for direct REST inserts, not just the UI/RPC.
REVOKE INSERT,UPDATE ON public.family_seniors FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS "Family links own seniors" ON public.family_seniors;
DROP POLICY IF EXISTS safewatch_no_direct_family_link ON public.family_seniors;
CREATE POLICY safewatch_no_direct_family_link ON public.family_seniors AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK(false);

CREATE OR REPLACE FUNCTION public.link_family_senior(p_device_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('family') THEN
    RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501';
  END IF;
  IF p_device_id IS NULL THEN RAISE EXCEPTION 'Enter the complete Watch ID' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=p_device_id) THEN RETURN p_device_id; END IF;
  -- Do not disclose whether an unapproved Watch ID exists or who wears it.
  INSERT INTO public.safewatch_family_requests(user_id,device_id,kind)
    VALUES(auth.uid(),p_device_id,'link')
    ON CONFLICT(user_id,device_id) WHERE status='pending' DO NOTHING;
  RETURN p_device_id;
END; $$;

CREATE OR REPLACE FUNCTION public.register_family_senior(p_device_id UUID,p_name TEXT,p_age INTEGER DEFAULT NULL,p_gender TEXT DEFAULT 'Not specified')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE clean_name TEXT:=btrim(p_name); BEGIN
  IF NOT public.safewatch_has_app_access('family') THEN RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
  IF p_device_id IS NULL OR clean_name IS NULL OR length(clean_name) NOT BETWEEN 1 AND 100 OR clean_name='[HIDDEN]' THEN
    RAISE EXCEPTION 'Enter a valid Watch ID and senior name' USING ERRCODE='22023';
  END IF;
  IF p_age IS NOT NULL AND p_age NOT BETWEEN 0 AND 130 THEN RAISE EXCEPTION 'Enter an age from 0 to 130' USING ERRCODE='22023'; END IF;
  IF p_gender IS NULL OR p_gender NOT IN ('Male','Female','Other','Not specified') THEN RAISE EXCEPTION 'Choose a valid gender' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=p_device_id) THEN RETURN p_device_id; END IF;
  INSERT INTO public.safewatch_family_requests(user_id,device_id,kind,requested_name,requested_age,requested_gender)
    VALUES(auth.uid(),p_device_id,'register',clean_name,p_age,p_gender)
    ON CONFLICT(user_id,device_id) WHERE status='pending' DO NOTHING;
  RETURN p_device_id;
END; $$;

-- New endpoint names make updated clients fail closed against an old database.
CREATE OR REPLACE FUNCTION public.request_family_senior_access(p_device_id UUID)
RETURNS UUID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT public.link_family_senior(p_device_id) $$;
CREATE OR REPLACE FUNCTION public.request_family_senior_registration(p_device_id UUID,p_name TEXT,p_age INTEGER DEFAULT NULL,p_gender TEXT DEFAULT 'Not specified')
RETURNS UUID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT public.register_family_senior(p_device_id,p_name,p_age,p_gender) $$;
REVOKE ALL ON FUNCTION public.request_family_senior_access(UUID),public.request_family_senior_registration(UUID,TEXT,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_family_senior_access(UUID),public.request_family_senior_registration(UUID,TEXT,INTEGER,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_family_senior_request(p_request_id BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('family') THEN RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
  UPDATE public.safewatch_family_requests SET status='canceled',reviewed_at=now()
    WHERE id=p_request_id AND user_id=auth.uid() AND status='pending';
  RETURN FOUND;
END; $$;

CREATE OR REPLACE FUNCTION public.list_family_senior_requests()
RETURNS TABLE(id BIGINT,user_id UUID,device_id UUID,kind TEXT,requested_name TEXT,requested_age SMALLINT,requested_gender TEXT,
  status TEXT,created_at TIMESTAMPTZ,applicant_name TEXT,applicant_email TEXT,registered_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.id,r.user_id,r.device_id,r.kind,r.requested_name,r.requested_age,r.requested_gender,
    r.status,r.created_at,coalesce(u.raw_user_meta_data->>'full_name','Family applicant'),u.email::text,d.patient_name
    FROM public.safewatch_family_requests r JOIN auth.users u ON u.id=r.user_id
    LEFT JOIN public.devices d ON d.id=r.device_id
    ORDER BY (r.status='pending') DESC,r.created_at DESC LIMIT 500;
END; $$;

CREATE OR REPLACE FUNCTION public.review_family_senior_request(p_request_id BIGINT,p_decision TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE request public.safewatch_family_requests; actor UUID:=auth.uid(); current_name TEXT; BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE='22023'; END IF;
  SELECT * INTO request FROM public.safewatch_family_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR request.status<>'pending' THEN RAISE EXCEPTION 'This request has already changed. Refresh the list.' USING ERRCODE='22023'; END IF;
  -- Serialize approvals for the same watch; never overwrite an existing senior.
  PERFORM pg_advisory_xact_lock(hashtextextended(request.device_id::text,0));
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  IF p_decision='approve' THEN
    IF NOT EXISTS(SELECT 1 FROM public.safewatch_account_access a JOIN auth.users u ON u.id=a.user_id
      WHERE a.user_id=request.user_id AND a.role='family' AND a.status='approved' AND u.email_confirmed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'The applicant must have an approved, confirmed family account' USING ERRCODE='42501';
    END IF;
    SELECT patient_name INTO current_name FROM public.devices WHERE devices.id=request.device_id FOR UPDATE;
    IF current_name='[HIDDEN]' THEN RAISE EXCEPTION 'This watch is unavailable' USING ERRCODE='22023'; END IF;
    IF current_name IS NULL THEN
      IF request.kind<>'register' THEN RAISE EXCEPTION 'Verify and register this physical watch before approving access' USING ERRCODE='22023'; END IF;
      INSERT INTO public.devices(id,patient_name,device_name,age,gender)
        VALUES(request.device_id,request.requested_name,'SafeWatch Watch',request.requested_age,request.requested_gender);
    END IF;
    INSERT INTO public.family_seniors(user_id,device_id) VALUES(request.user_id,request.device_id)
      ON CONFLICT(user_id,device_id) DO NOTHING;
  END IF;
  UPDATE public.safewatch_family_requests SET status=CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
    reviewed_at=now(),reviewed_by=actor WHERE safewatch_family_requests.id=request.id;
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action,details)
    VALUES(actor,request.user_id,'family_access_'||p_decision,jsonb_build_object('request_id',request.id,'device_id',request.device_id));
  RETURN jsonb_build_object('id',request.id,'status',CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END);
END; $$;

CREATE OR REPLACE FUNCTION public.list_family_senior_links()
RETURNS TABLE(user_id UUID,device_id UUID,applicant_name TEXT,applicant_email TEXT,senior_name TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT f.user_id,f.device_id,coalesce(u.raw_user_meta_data->>'full_name','Family member'),u.email::text,d.patient_name,f.created_at
    FROM public.family_seniors f JOIN auth.users u ON u.id=f.user_id JOIN public.devices d ON d.id=f.device_id ORDER BY f.created_at DESC;
END; $$;
CREATE OR REPLACE FUNCTION public.revoke_family_senior_access(p_user_id UUID,p_device_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id::text,0));
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  DELETE FROM public.family_seniors WHERE user_id=p_user_id AND device_id=p_device_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'This access link has already changed' USING ERRCODE='22023'; END IF;
  UPDATE public.safewatch_family_requests SET status='revoked',reviewed_at=now(),reviewed_by=auth.uid()
    WHERE user_id=p_user_id AND device_id=p_device_id AND status='approved';
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action,details)
    VALUES(auth.uid(),p_user_id,'family_access_revoke',jsonb_build_object('device_id',p_device_id));
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.list_family_senior_links(),public.revoke_family_senior_access(UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_family_senior_links(),public.revoke_family_senior_access(UUID,UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.link_family_senior(UUID),public.register_family_senior(UUID,TEXT,INTEGER,TEXT),
  public.cancel_family_senior_request(BIGINT),public.list_family_senior_requests(),public.review_family_senior_request(BIGINT,TEXT)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_family_senior(UUID),public.register_family_senior(UUID,TEXT,INTEGER,TEXT),
  public.cancel_family_senior_request(BIGINT),public.list_family_senior_requests(),public.review_family_senior_request(BIGINT,TEXT)
  TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
