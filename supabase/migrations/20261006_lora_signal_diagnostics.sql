-- Additive migration for an existing database. Existing telemetry stays intact.
BEGIN;
ALTER TABLE public.telemetry
    ADD COLUMN IF NOT EXISTS rssi_dbm REAL,
    ADD COLUMN IF NOT EXISTS snr_db REAL,
    ADD COLUMN IF NOT EXISTS gateway_id TEXT,
    ADD COLUMN IF NOT EXISTS gateway_boot_id TEXT,
    ADD COLUMN IF NOT EXISTS rx_seq BIGINT,
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rx_uptime_ms BIGINT;

-- Makes retries idempotent for instrumented gateways; legacy rows have NULLs.
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_gateway_rx_unique
    ON public.telemetry (gateway_id, gateway_boot_id, rx_seq);

COMMENT ON COLUMN public.telemetry.rssi_dbm IS 'Gateway measured LoRa packet RSSI in dBm; NULL for legacy telemetry.';
COMMENT ON COLUMN public.telemetry.snr_db IS 'Gateway measured LoRa packet SNR in dB; negative values are valid.';
COMMENT ON COLUMN public.telemetry.received_at IS 'Gateway RF receipt time in UTC; NULL until NTP synchronizes. created_at is cloud insert time.';
COMMENT ON COLUMN public.telemetry.rx_seq IS 'Gateway reception sequence per boot, including rejected RF packets; not a transmitter sequence.';
NOTIFY pgrst, 'reload schema';
COMMIT;
