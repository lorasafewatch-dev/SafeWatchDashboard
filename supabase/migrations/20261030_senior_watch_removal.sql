-- Apply after the 27 October approval and identity-hardening migrations.
-- Adds a staff-only deletion action. Applying this migration deletes no records.
BEGIN;

-- Acquire the watch lock before the request row, in the same order as deletion
-- and revocation. Re-read the request after waiting to reject a deleted request.
CREATE OR REPLACE FUNCTION public.review_family_senior_request(p_request_id BIGINT,p_decision TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE request public.safewatch_family_requests; actor UUID:=auth.uid(); current_name TEXT; BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'Choose approve or reject' USING ERRCODE='22023'; END IF;
  SELECT * INTO request FROM public.safewatch_family_requests WHERE id=p_request_id;
  IF NOT FOUND OR request.status<>'pending' THEN RAISE EXCEPTION 'This request has already changed. Refresh the list.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(request.device_id::text,0));
  SELECT * INTO request FROM public.safewatch_family_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR request.status<>'pending' THEN RAISE EXCEPTION 'This request has already changed. Refresh the list.' USING ERRCODE='22023'; END IF;
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

CREATE OR REPLACE FUNCTION public.delete_senior_watch(p_device_id UUID,p_confirmation TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  IF p_device_id IS NULL OR p_confirmation IS DISTINCT FROM 'DELETE' THEN
    RAISE EXCEPTION 'Type DELETE to confirm permanent deletion' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_device_id::text,0));
  PERFORM 1 FROM public.devices WHERE id=p_device_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This senior has already been removed. Refresh the senior list.' USING ERRCODE='P0002'; END IF;
  IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;

  -- Explicit child deletes also support older databases without cascading FKs.
  -- The whole operation is one transaction, including the administrative audit.
  DELETE FROM public.alerts WHERE device_id=p_device_id;
  DELETE FROM public.telemetry WHERE device_id=p_device_id;
  DELETE FROM public.family_seniors WHERE device_id=p_device_id;
  DELETE FROM public.safewatch_family_requests WHERE device_id=p_device_id;
  DELETE FROM public.devices WHERE id=p_device_id;
  INSERT INTO public.safewatch_access_audit(actor_id,target_id,action,details)
    VALUES(auth.uid(),p_device_id,'delete_senior_watch',jsonb_build_object('device_id',p_device_id));
  RETURN p_device_id;
END; $$;

-- All client deletion of a watch goes through the complete, audited operation.
REVOKE DELETE ON public.devices FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delete_senior_watch(UUID,TEXT),public.review_family_senior_request(BIGINT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_senior_watch(UUID,TEXT),public.review_family_senior_request(BIGINT,TEXT) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
