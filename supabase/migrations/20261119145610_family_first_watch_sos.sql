BEGIN;

-- The routing receipt, rather than a browser's clock, grants staff visibility.
-- Older completed/escalated incidents retain their existing visibility.
CREATE OR REPLACE FUNCTION safewatch_private.sos_staff_visible(p_details JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT COALESCE(p_details->>'sos_family_first','false')<>'true' OR COALESCE(p_details ? 'sos_transferred_at',false) $$;
REVOKE ALL ON FUNCTION safewatch_private.sos_staff_visible(JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION safewatch_private.sos_staff_visible(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION safewatch_private.route_watch_sos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ DECLARE opened TIMESTAMPTZ; BEGIN
  IF NEW.alert_type<>'SOS' THEN RETURN NEW; END IF;
  NEW.details:=COALESCE(NEW.details,'{}'::jsonb);
  IF TG_OP='INSERT' THEN
    -- Existing explicit family assistance requests remain intentional handoffs.
    IF NEW.details->>'source'='family_app' THEN
      NEW.details:=NEW.details||jsonb_build_object('status','ESCALATED_BHW','sos_assigned_to','barangay',
        'sos_transferred_at',clock_timestamp(),'sos_transfer_reason','family_request','sos_transferred_by',auth.uid());
      RETURN NEW;
    END IF;
    IF COALESCE(NEW.details->>'status','PENDING_FAMILY') NOT IN ('PENDING_FAMILY','ESCALATED_BHW') THEN RETURN NEW; END IF;
    opened:=COALESCE((NEW.details->>'first_seen_at')::timestamptz,NEW.created_at,clock_timestamp());
    NEW.details:=NEW.details||jsonb_build_object('sos_family_first',true,'first_seen_at',opened,
      'sos_family_deadline_at',opened+interval '3 minutes','status','PENDING_FAMILY','sos_assigned_to','family');
  ELSE
    IF OLD.details->>'sos_family_first'='true' THEN
      -- Repeated telemetry cannot restart the deadline or change the first handoff.
      NEW.details:=NEW.details||jsonb_build_object('sos_family_first',true,'first_seen_at',OLD.details->'first_seen_at',
        'sos_family_deadline_at',OLD.details->'sos_family_deadline_at');
      IF OLD.details ? 'sos_transferred_at' THEN
        NEW.details:=NEW.details||jsonb_build_object('sos_transferred_at',OLD.details->'sos_transferred_at',
          'sos_transfer_reason',OLD.details->'sos_transfer_reason');
        IF OLD.details ? 'sos_transferred_by' THEN NEW.details:=NEW.details||jsonb_build_object('sos_transferred_by',OLD.details->'sos_transferred_by'); END IF;
      END IF;
    END IF;
    IF NEW.details->>'sos_family_first'='true' AND COALESCE(NEW.details->>'status','PENDING_FAMILY') IN ('PENDING_FAMILY','ESCALATED_BHW') THEN
      IF NEW.details ? 'sos_transferred_at' THEN
        IF NEW.details->>'sos_assigned_to' IN ('barangay','both') THEN
          NEW.details:=NEW.details||jsonb_build_object('status','ESCALATED_BHW');
        END IF;
      ELSE
        NEW.details:=NEW.details||jsonb_build_object('status','PENDING_FAMILY','sos_assigned_to','family');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION safewatch_private.route_watch_sos() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS safewatch_sos_family_routing ON public.alerts;
CREATE TRIGGER safewatch_sos_family_routing BEFORE INSERT OR UPDATE ON public.alerts
  FOR EACH ROW EXECUTE FUNCTION safewatch_private.route_watch_sos();

-- Keep the existing append-only activity structure and include the route receipt.
CREATE OR REPLACE FUNCTION public.safewatch_record_alert_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE kind TEXT; BEGIN
  IF TG_OP='INSERT' THEN kind:='alert_opened';
  ELSIF (NEW.details->>'status',NEW.details->>'incident_open',NEW.details->'sos_responses')
    IS NOT DISTINCT FROM (OLD.details->>'status',OLD.details->>'incident_open',OLD.details->'sos_responses') THEN RETURN NEW;
  ELSIF NEW.details->'sos_responses' IS DISTINCT FROM OLD.details->'sos_responses'
    AND NEW.details->'sos_responses' IS NOT NULL THEN kind:='sos_response';
  ELSIF NEW.details->>'incident_open'='false' THEN kind:='alert_closed';
  ELSIF NEW.details->>'status' IN ('ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW') THEN kind:='alert_confirmed';
  ELSE kind:='alert_changed'; END IF;
  INSERT INTO public.safewatch_activity_events(device_id,category,event_kind,alert_type,status,details,source_key)
    VALUES(NEW.device_id,'alerts',kind,NEW.alert_type,NEW.details->>'status',
      jsonb_strip_nulls(jsonb_build_object('alert_id',NEW.id,'incident_open',NEW.details->'incident_open',
        'family_decision',NEW.details->'sos_responses'->'family'->>'decision',
        'barangay_decision',NEW.details->'sos_responses'->'barangay'->>'decision',
        'battery_percent',NEW.details->'battery_percent','sos_family_first',NEW.details->'sos_family_first',
        'sos_transferred_at',NEW.details->'sos_transferred_at','sos_transfer_reason',NEW.details->'sos_transfer_reason')),
      CASE WHEN TG_OP='INSERT' THEN 'alert:'||NEW.id||':initial' END)
    ON CONFLICT(source_key) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.safewatch_record_alert_activity() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
  IF to_regclass('public.safewatch_activity_events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS safewatch_family_first_sos_activity ON public.safewatch_activity_events';
    EXECUTE $policy$CREATE POLICY safewatch_family_first_sos_activity ON public.safewatch_activity_events
      AS RESTRICTIVE FOR SELECT TO authenticated USING(
        alert_type IS DISTINCT FROM 'SOS' OR NOT (SELECT public.safewatch_has_app_access('dashboard'))
        OR COALESCE(details->>'sos_family_first','false')<>'true'
        OR EXISTS(SELECT 1 FROM public.alerts a WHERE a.id::text=safewatch_activity_events.details->>'alert_id'))$policy$;
  END IF;
END $$;

-- Pending unassigned watch incidents receive a fixed deadline. Never rewrite a
-- saved family/staff response or an incident already handed to staff.
UPDATE public.alerts SET details=COALESCE(details,'{}'::jsonb)||jsonb_build_object(
  'sos_family_first',true,'sos_assigned_to','family',
  'first_seen_at',COALESCE((details->>'first_seen_at')::timestamptz,created_at),
  'sos_family_deadline_at',COALESCE((details->>'first_seen_at')::timestamptz,created_at)+interval '3 minutes')
WHERE alert_type='SOS' AND details->>'status'='PENDING_FAMILY' AND details->>'incident_open' IS DISTINCT FROM 'false'
  AND COALESCE(details->>'source','watch')<>'family_app' AND NOT details ? 'sos_family_first'
  AND NOT details ? 'sos_response_at' AND COALESCE(details->>'sos_assigned_to','family')='family';

DROP POLICY IF EXISTS safewatch_family_first_sos_read ON public.alerts;
CREATE POLICY safewatch_family_first_sos_read ON public.alerts AS RESTRICTIVE FOR SELECT TO authenticated
  USING(alert_type<>'SOS' OR NOT (SELECT public.safewatch_has_app_access('dashboard'))
    OR safewatch_private.sos_staff_visible(details));

-- The unattended worker runs only as its database owner. It is not a client RPC
-- and needs no definer privileges. All writers take the watch lock first.
CREATE OR REPLACE FUNCTION safewatch_private.transfer_unanswered_watch_sos()
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ DECLARE candidate RECORD; changed INTEGER; total INTEGER:=0; checked_at TIMESTAMPTZ:=clock_timestamp(); BEGIN
  FOR candidate IN SELECT id,device_id FROM public.alerts
    WHERE alert_type='SOS' AND details->>'sos_family_first'='true' AND details->>'status'='PENDING_FAMILY'
      AND details->>'incident_open' IS DISTINCT FROM 'false' AND NOT details ? 'sos_transferred_at'
      AND (details->>'sos_family_deadline_at')::timestamptz<=checked_at
    ORDER BY created_at,id LIMIT 100
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(candidate.device_id::text,0)) THEN CONTINUE; END IF;
    PERFORM 1 FROM public.devices WHERE id=candidate.device_id AND patient_name<>'[HIDDEN]' FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.alerts SET details=details||jsonb_build_object('status','ESCALATED_BHW','sos_assigned_to','barangay',
      'sos_transferred_at',checked_at,'sos_transfer_reason','automatic_timeout',
      'sos_response_version',COALESCE((details->>'sos_response_version')::integer,0)+1)
    WHERE id=candidate.id AND details->>'status'='PENDING_FAMILY' AND NOT details ? 'sos_transferred_at'
      AND details->>'incident_open' IS DISTINCT FROM 'false'
      AND NOT COALESCE(details->'sos_responses','{}'::jsonb) ? 'family'
      AND (details->>'sos_family_deadline_at')::timestamptz<=checked_at;
    GET DIAGNOSTICS changed=ROW_COUNT;
    total:=total+changed;
  END LOOP;
  RETURN total;
END; $$;
REVOKE ALL ON FUNCTION safewatch_private.transfer_unanswered_watch_sos() FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS alerts_sos_family_pending ON public.alerts(created_at,id)
  WHERE alert_type='SOS' AND details->>'sos_family_first'='true' AND details->>'status'='PENDING_FAMILY'
    AND NOT details ? 'sos_transferred_at';

CREATE OR REPLACE FUNCTION public.respond_to_sos(p_alert_id bigint, p_decision text, p_role text DEFAULT 'family'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ DECLARE target public.alerts; watch_id UUID; responses JSONB; other_role TEXT;
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
  IF p_role='barangay' AND NOT safewatch_private.sos_staff_visible(target.details) THEN
    RAISE EXCEPTION 'This SOS is awaiting a family response. It has not been transferred to barangay.' USING ERRCODE='42501';
  END IF;
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
    || CASE WHEN p_role='family' AND p_decision='declined' AND NOT details ? 'sos_transferred_at'
      THEN jsonb_build_object('sos_transferred_at',response_at,'sos_transfer_reason','family_unavailable','sos_transferred_by',auth.uid())
      ELSE '{}'::jsonb END
    WHERE id=p_alert_id RETURNING * INTO target;
  RETURN jsonb_build_object('saved',true,'alert',to_jsonb(target));
END; $function$;

-- Response feed is invoker: the new alerts policy hides family-only receipts
-- from staff while linked families still see their own automatic transfer.
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
      AND (a.details ? 'sos_response_at' OR a.details ? 'sos_transferred_at' OR a.details->>'status' IN ('ACKNOWLEDGED_FAMILY','ACKNOWLEDGED_BHW'))
    ORDER BY COALESCE((a.details->>'sos_response_at')::timestamptz,(a.details->>'sos_transferred_at')::timestamptz,
      (a.details->>'acknowledged_at')::timestamptz,a.created_at) DESC,a.id DESC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION public.list_sos_response_updates(INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_sos_response_updates(INTEGER) TO authenticated;

-- BEGIN HOSTED CRON
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule('safewatch-family-sos-timeout','5 seconds',
  'SELECT safewatch_private.transfer_unanswered_watch_sos();');
-- Bound only this new worker's execution-log storage; patient history is untouched.
SELECT cron.schedule('safewatch-family-sos-log-retention','15 0 * * *',
  $job$DELETE FROM cron.job_run_details WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='safewatch-family-sos-timeout')
    AND end_time<clock_timestamp()-interval '3 days';$job$);
-- END HOSTED CRON
NOTIFY pgrst,'reload schema';
COMMIT;
