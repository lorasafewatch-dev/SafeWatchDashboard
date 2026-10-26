-- Coordinated cutover: provision a gateway token and flash the matching firmware.
-- Public browser keys must never be sufficient to submit medical telemetry.
BEGIN;
CREATE SCHEMA IF NOT EXISTS safewatch_private;
REVOKE ALL ON SCHEMA safewatch_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA safewatch_private TO service_role;
CREATE TABLE IF NOT EXISTS safewatch_private.gateway_credentials (
  gateway_id TEXT PRIMARY KEY,
  token_hash BYTEA NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_window TIMESTAMPTZ,
  window_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS safewatch_private.gateway_devices (
  gateway_id TEXT NOT NULL REFERENCES safewatch_private.gateway_credentials ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices ON DELETE CASCADE,
  PRIMARY KEY(gateway_id,device_id)
);
CREATE TABLE IF NOT EXISTS safewatch_private.gateway_receipts (
  gateway_id TEXT NOT NULL REFERENCES safewatch_private.gateway_credentials ON DELETE CASCADE,
  boot_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(gateway_id,boot_id,sequence)
);
REVOKE ALL ON ALL TABLES IN SCHEMA safewatch_private FROM PUBLIC,anon,authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA safewatch_private TO service_role;
ALTER TABLE safewatch_private.gateway_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE safewatch_private.gateway_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE safewatch_private.gateway_receipts ENABLE ROW LEVEL SECURITY;

-- Operator/service-role only. Returns the new token once; only its hash is kept.
CREATE OR REPLACE FUNCTION public.provision_safewatch_gateway(p_gateway_id TEXT,p_device_ids UUID[])
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE token TEXT; BEGIN
  IF p_gateway_id IS NULL OR p_gateway_id !~ '^[A-Za-z0-9:_-]{1,64}$' OR coalesce(array_length(p_device_ids,1),0)=0 THEN
    RAISE EXCEPTION 'Specify a gateway and its registered watches' USING ERRCODE='22023';
  END IF;
  token:='swg_'||replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  INSERT INTO safewatch_private.gateway_credentials(gateway_id,token_hash)
    VALUES(p_gateway_id,sha256(convert_to(token,'UTF8')))
    ON CONFLICT(gateway_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,active=true,last_window=NULL,window_count=0;
  DELETE FROM safewatch_private.gateway_devices WHERE gateway_id=p_gateway_id;
  INSERT INTO safewatch_private.gateway_devices(gateway_id,device_id) SELECT p_gateway_id,id FROM unnest(p_device_ids) id;
  RETURN token;
END; $$;
REVOKE ALL ON FUNCTION public.provision_safewatch_gateway(TEXT,UUID[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.provision_safewatch_gateway(TEXT,UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.ingest_safewatch_telemetry(p_gateway_id TEXT,p_token TEXT,p_payload JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE credentials safewatch_private.gateway_credentials; packet public.telemetry;
  latitude NUMERIC; longitude NUMERIC; packet_sequence BIGINT; boot TEXT; stamp TIMESTAMPTZ;
BEGIN
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 32 AND 128 THEN RAISE EXCEPTION 'Gateway authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO credentials FROM safewatch_private.gateway_credentials c WHERE c.gateway_id=p_gateway_id
    AND c.active AND c.token_hash=sha256(convert_to(p_token,'UTF8')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gateway authentication required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_payload)<>'object' OR p_payload IS NULL THEN RAISE EXCEPTION 'Invalid telemetry payload' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM safewatch_private.gateway_devices d WHERE d.gateway_id=p_gateway_id AND d.device_id=(p_payload->>'device_id')::uuid) THEN
    RAISE EXCEPTION 'Watch is not assigned to this gateway' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_payload->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'longitude') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload->'heart_rate') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'spo2') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_payload->'battery_percent') IS DISTINCT FROM 'number' OR jsonb_typeof(p_payload->'is_sos') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_payload->'rx_seq') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid telemetry fields' USING ERRCODE='22023';
  END IF;
  latitude:=(p_payload->>'latitude')::numeric; longitude:=(p_payload->>'longitude')::numeric;
  packet_sequence:=(p_payload->>'rx_seq')::bigint; boot:=p_payload->>'gateway_boot_id';
  IF latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180 OR
    (p_payload->>'heart_rate')::numeric NOT BETWEEN 0 AND 255 OR (p_payload->>'spo2')::numeric NOT BETWEEN 0 AND 100 OR
    (p_payload->>'battery_percent')::numeric NOT BETWEEN 0 AND 100 OR packet_sequence NOT BETWEEN 1 AND 4294967295 OR
    boot IS NULL OR boot !~ '^[a-f0-9]{16}$' THEN RAISE EXCEPTION 'Telemetry is outside valid bounds' USING ERRCODE='22023'; END IF;
  stamp:=(p_payload->>'received_at')::timestamptz;
  IF stamp IS NOT NULL AND (stamp>now()+interval '1 minute' OR stamp<now()-interval '1 day') THEN
    RAISE EXCEPTION 'Telemetry timestamp is outside the accepted window' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM safewatch_private.gateway_receipts r WHERE r.gateway_id=p_gateway_id AND r.boot_id=boot AND r.sequence=packet_sequence) THEN RETURN true; END IF;
  IF credentials.last_window IS NOT NULL AND credentials.last_window>clock_timestamp()-interval '1 second' THEN
    IF credentials.window_count>=10 THEN RAISE EXCEPTION 'Gateway upload rate exceeded' USING ERRCODE='PT429'; END IF;
    UPDATE safewatch_private.gateway_credentials SET window_count=window_count+1 WHERE gateway_id=p_gateway_id;
  ELSE UPDATE safewatch_private.gateway_credentials SET last_window=clock_timestamp(),window_count=1 WHERE gateway_id=p_gateway_id; END IF;
  -- Populate the actual row type so PostGIS parses the geography input safely.
  SELECT * INTO packet FROM jsonb_populate_record(NULL::public.telemetry,p_payload||jsonb_build_object(
    'location',format('SRID=4326;POINT(%s %s)',longitude,latitude),'gateway_id',p_gateway_id));
  INSERT INTO safewatch_private.gateway_receipts(gateway_id,boot_id,sequence) VALUES(p_gateway_id,boot,packet_sequence);
  INSERT INTO public.telemetry(device_id,location,heart_rate,spo2,battery_percent,is_sos,rssi_dbm,snr_db,gateway_id,gateway_boot_id,rx_seq,received_at,rx_uptime_ms)
    VALUES(packet.device_id,packet.location,packet.heart_rate,packet.spo2,packet.battery_percent,packet.is_sos,
      packet.rssi_dbm,packet.snr_db,p_gateway_id,boot,packet_sequence,stamp,packet.rx_uptime_ms);
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.ingest_safewatch_telemetry(TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_safewatch_telemetry(TEXT,TEXT,JSONB) TO anon,authenticated;
REVOKE INSERT ON public.telemetry FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS safewatch_no_direct_telemetry ON public.telemetry;
CREATE POLICY safewatch_no_direct_telemetry ON public.telemetry AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(false);
NOTIFY pgrst,'reload schema';
COMMIT;
