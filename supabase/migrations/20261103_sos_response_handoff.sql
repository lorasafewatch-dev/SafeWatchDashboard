-- Run after 20261103_battery_location_history.sql. Preserve all existing alerts.
BEGIN;

CREATE OR REPLACE FUNCTION public.respond_to_sos(p_alert_id BIGINT,p_decision TEXT,p_role TEXT DEFAULT 'family')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE target public.alerts; watch_id UUID; responses JSONB; other_role TEXT;
  assigned TEXT; response_at TIMESTAMPTZ:=clock_timestamp(); BEGIN
  IF p_role IS NULL OR p_role NOT IN ('family','barangay') OR p_decision IS NULL OR p_decision NOT IN ('confirmed','declined') THEN
    RAISE EXCEPTION 'Choose a valid SOS response and role' USING ERRCODE='22023';
  END IF;
  IF NOT public.safewatch_has_app_access(CASE WHEN p_role='family' THEN 'family' ELSE 'dashboard' END) THEN
    RAISE EXCEPTION 'Approved access is required to respond' USING ERRCODE='42501';
  END IF;
  SELECT device_id INTO watch_id FROM public.alerts WHERE id=p_alert_id AND alert_type='SOS';
  IF NOT FOUND THEN RAISE EXCEPTION 'This SOS is unavailable. Refresh alerts.' USING ERRCODE='40001'; END IF;
  -- Coordinate with family-link revocation/deletion, then telemetry and responses.
  PERFORM pg_advisory_xact_lock(hashtextextended(watch_id::text,0));
  IF p_role='family' THEN
    PERFORM 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=watch_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This SOS is not linked to your family' USING ERRCODE='42501'; END IF;
  END IF;
  IF NOT public.safewatch_has_app_access(CASE WHEN p_role='family' THEN 'family' ELSE 'dashboard' END) THEN
    RAISE EXCEPTION 'Approved access is required to respond' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.devices WHERE id=watch_id AND patient_name<>'[HIDDEN]' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This watch is unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO target FROM public.alerts WHERE id=p_alert_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This SOS changed. Refresh alerts.' USING ERRCODE='40001'; END IF;
  -- A competing confirmation wins. Decline must never undo a saved response.
  IF target.details->>'status' IN ('ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW') THEN
    IF p_decision='declined' THEN RAISE EXCEPTION 'This SOS has already been confirmed. Refresh alerts.' USING ERRCODE='40001'; END IF;
    RETURN jsonb_build_object('saved',true,'alert',to_jsonb(target));
  END IF;
  IF target.details->>'incident_open'='false' OR COALESCE(target.details->>'status','PENDING_FAMILY') NOT IN ('PENDING_FAMILY','ESCALATED_BHW') THEN
    RAISE EXCEPTION 'This SOS is no longer pending. Refresh alerts.' USING ERRCODE='40001';
  END IF;
  responses:=COALESCE(target.details->'sos_responses','{}'::jsonb);
  IF responses->p_role->>'decision'=p_decision THEN RETURN jsonb_build_object('saved',true,'alert',to_jsonb(target)); END IF;
  responses:=responses || jsonb_build_object(p_role,jsonb_build_object('decision',p_decision,'at',response_at,'by',auth.uid()));
  other_role:=CASE WHEN p_role='family' THEN 'barangay' ELSE 'family' END;
  IF p_decision='confirmed' THEN assigned:='none';
  ELSIF responses->other_role->>'decision'='declined' THEN assigned:='both';
  ELSE assigned:=other_role; END IF;
  UPDATE public.alerts SET details=COALESCE(details,'{}'::jsonb) || jsonb_build_object(
    'sos_responses',responses,'sos_assigned_to',assigned,'sos_response_at',response_at,
    'sos_response_version',COALESCE((details->>'sos_response_version')::integer,0)+1,
    'status',CASE WHEN p_decision='confirmed' THEN CASE WHEN p_role='family' THEN 'ACKNOWLEDGED_FAMILY' ELSE 'ACKNOWLEDGED_BHW' END
      WHEN assigned='family' THEN 'PENDING_FAMILY' ELSE 'ESCALATED_BHW' END,
    -- Only watch-generated incidents occupy the unique open-incident slot.
    -- Manual SOS requests can coexist with a separate watch SOS.
    'incident_open',CASE WHEN p_decision='declined' THEN
      CASE WHEN details->>'source'='family_app' THEN NULL::boolean ELSE true END
      ELSE COALESCE(details->>'source','')<>'family_app' END)
    || CASE WHEN p_decision='confirmed' THEN jsonb_build_object('acknowledged_at',response_at,'acknowledged_by',auth.uid()) ELSE '{}'::jsonb END
    WHERE id=p_alert_id RETURNING * INTO target;
  RETURN jsonb_build_object('saved',true,'alert',to_jsonb(target));
END; $$;
REVOKE ALL ON FUNCTION public.respond_to_sos(BIGINT,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.respond_to_sos(BIGINT,TEXT,TEXT) TO authenticated;

-- Old deployed clients also write shared confirmation indicators through this RPC.
CREATE OR REPLACE FUNCTION public.acknowledge_alert_incident(p_alert_id BIGINT,p_role TEXT DEFAULT 'family')
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE watch_id UUID; kind TEXT; result JSONB; BEGIN
  IF p_role='family' THEN
    IF NOT public.safewatch_has_app_access('family') THEN RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
    SELECT device_id INTO watch_id FROM public.alerts WHERE id=p_alert_id;
    IF watch_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.family_seniors WHERE user_id=auth.uid() AND device_id=watch_id) THEN
      RAISE EXCEPTION 'This alert is not linked to your family account' USING ERRCODE='42501'; END IF;
  ELSIF p_role='barangay' THEN
    IF NOT public.safewatch_has_app_access('dashboard') THEN RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION 'Choose a valid acknowledgment role' USING ERRCODE='22023'; END IF;
  SELECT alert_type INTO kind FROM public.alerts WHERE id=p_alert_id;
  IF kind='SOS' THEN
    result:=public.respond_to_sos(p_alert_id,'confirmed',p_role);
    RETURN (result->>'saved')::boolean;
  END IF;
  RETURN public._safewatch_acknowledge_incident(p_alert_id,p_role);
END; $$;
REVOKE ALL ON FUNCTION public.acknowledge_alert_incident(BIGINT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_alert_incident(BIGINT,TEXT) TO authenticated;

-- Separate bounded query: closed confirmations cannot crowd active alerts out.
CREATE OR REPLACE FUNCTION public.list_sos_response_updates(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(id BIGINT,device_id UUID,alert_type TEXT,created_at TIMESTAMPTZ,details JSONB,patient_name TEXT)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NOT (public.safewatch_has_app_access('family') OR public.safewatch_has_app_access('dashboard')) THEN
    RAISE EXCEPTION 'Approved access is required' USING ERRCODE='42501'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose a valid response limit' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT a.id,a.device_id,a.alert_type,a.created_at,a.details,d.patient_name
    FROM public.alerts a JOIN public.devices d ON d.id=a.device_id
    WHERE a.alert_type='SOS' AND d.patient_name<>'[HIDDEN]'
      AND (a.details ? 'sos_response_at' OR a.details->>'status' IN ('ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW'))
    ORDER BY COALESCE((a.details->>'sos_response_at')::timestamptz,(a.details->>'acknowledged_at')::timestamptz,a.created_at) DESC,a.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.list_sos_response_updates(INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sos_response_updates(INTEGER) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
